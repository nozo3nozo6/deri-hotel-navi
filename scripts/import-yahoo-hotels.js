// ==========================================================================
// Yahoo!ローカルサーチAPI → Supabase hotels テーブル インポート
// ==========================================================================
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const YAHOO_CLIENT_ID = process.env.YAHOO_CLIENT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!YAHOO_CLIENT_ID || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ 環境変数が不足しています。.env を確認してください。');
  console.error('   必要: YAHOO_CLIENT_ID, SUPABASE_URL, SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const DELAY_PER_REQUEST = 500;
const DELAY_PER_PREF = 1000;
const MAX_RETRY = 3;
const RESULTS_PER_PAGE = 100;

// ジャンルコード → hotel_type マッピング
const GENRES = [
  { gc: '0304001', hotel_type: 'hotel',          label: 'ホテル' },
  { gc: '0304004', hotel_type: 'business_hotel',  label: 'ビジネスホテル' },
  { gc: '0304009', hotel_type: 'love_hotel',      label: 'ラブホテル' },
];

// 都道府県コード
const prefCodes = {
  '01': '北海道', '02': '青森県', '03': '岩手県', '04': '宮城県',
  '05': '秋田県', '06': '山形県', '07': '福島県', '08': '茨城県',
  '09': '栃木県', '10': '群馬県', '11': '埼玉県', '12': '千葉県',
  '13': '東京都', '14': '神奈川県', '15': '新潟県', '16': '富山県',
  '17': '石川県', '18': '福井県', '19': '山梨県', '20': '長野県',
  '21': '岐阜県', '22': '静岡県', '23': '愛知県', '24': '三重県',
  '25': '滋賀県', '26': '京都府', '27': '大阪府', '28': '兵庫県',
  '29': '奈良県', '30': '和歌山県', '31': '鳥取県', '32': '島根県',
  '33': '岡山県', '34': '広島県', '35': '山口県', '36': '徳島県',
  '37': '香川県', '38': '愛媛県', '39': '高知県', '40': '福岡県',
  '41': '佐賀県', '42': '長崎県', '43': '熊本県', '44': '大分県',
  '45': '宮崎県', '46': '鹿児島県', '47': '沖縄県',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 住所から市区町村を抽出
function extractCity(address, prefecture) {
  if (!address || !prefecture) return null;
  const withoutPref = address.replace(prefecture, '');
  // 政令指定都市: ○○市○○区
  const cityKu = withoutPref.match(/^(.+?市.+?区)/);
  if (cityKu) return cityKu[1];
  // 通常の市区町村
  const match = withoutPref.match(/^(.+?[市区町村])/) || withoutPref.match(/^(.+?郡.+?[町村])/);
  return match ? match[1] : null;
}

// リトライ付き fetch
async function fetchWithRetry(url, retry = 0) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    return await res.json();
  } catch (err) {
    if (retry < MAX_RETRY) {
      const wait = 2000 * (retry + 1);
      console.log(`  ⚠️  ${err.message} — ${wait / 1000}秒後にリトライ (${retry + 1}/${MAX_RETRY})`);
      await sleep(wait);
      return fetchWithRetry(url, retry + 1);
    }
    throw err;
  }
}

// 既存ホテルの name+address セットを取得
async function loadExistingKeys() {
  console.log('📦 既存ホテルデータを読み込み中...');
  const keys = new Set();
  const PAGE_SIZE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('hotels')
      .select('name, address')
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error('❌ 既存データ読み込みエラー:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      keys.add(`${row.name}|||${row.address}`);
    }
    from += PAGE_SIZE;
  }
  console.log(`📦 既存ホテル: ${keys.size}件\n`);
  return keys;
}

// Yahoo API から1ページ取得
async function fetchPage(gc, ac, start) {
  const params = new URLSearchParams({
    appid: YAHOO_CLIENT_ID,
    gc,
    ac,
    output: 'json',
    results: String(RESULTS_PER_PAGE),
    start: String(start),
  });
  const url = `https://map.yahooapis.jp/search/local/V1/localSearch?${params}`;
  return fetchWithRetry(url);
}

// メイン処理
async function main() {
  console.log('🇯🇵 Yahoo!ローカルサーチ ホテルインポート開始\n');

  const existingKeys = await loadExistingKeys();

  let totalAdded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const [ac, prefName] of Object.entries(prefCodes)) {
    console.log(`\n========================================`);
    console.log(`🗾 ${prefName} (ac=${ac})`);
    console.log(`========================================`);

    for (const genre of GENRES) {
      console.log(`  🔎 ${genre.label} (gc=${genre.gc})`);

      let start = 1;
      let prefAdded = 0;
      let prefSkipped = 0;

      while (true) {
        let data;
        try {
          data = await fetchPage(genre.gc, ac, start);
        } catch (err) {
          console.error(`  ❌ API エラー: ${err.message}`);
          totalErrors++;
          break;
        }

        const features = data.Feature;
        if (!features || features.length === 0) break;

        const totalAvailable = data.ResultInfo?.Total || 0;

        // バッチ用の配列
        const toInsert = [];

        for (const f of features) {
          const name = f.Name || '';
          const address = f.Property?.Address || '';
          const key = `${name}|||${address}`;

          if (existingKeys.has(key)) {
            prefSkipped++;
            continue;
          }

          // 座標: Yahoo APIは "経度,緯度" の順
          let latitude = null;
          let longitude = null;
          if (f.Geometry?.Coordinates) {
            const coords = f.Geometry.Coordinates.split(',');
            longitude = parseFloat(coords[0]) || null;
            latitude = parseFloat(coords[1]) || null;
          }

          // 最寄り駅
          let nearestStation = null;
          if (f.Property?.Station && f.Property.Station.length > 0) {
            nearestStation = f.Property.Station[0].Name || null;
          }

          toInsert.push({
            name,
            address,
            tel: f.Property?.Tel1 || null,
            hotel_type: genre.hotel_type,
            prefecture: prefName,
            latitude,
            longitude,
            nearest_station: nearestStation,
            source: 'yahoo',
            is_published: true,
            city: extractCity(address, prefName),
          });

          existingKeys.add(key);
        }

        // Supabase に INSERT（50件ずつバッチ）
        for (let i = 0; i < toInsert.length; i += 50) {
          const batch = toInsert.slice(i, i + 50);
          const { error } = await supabase.from('hotels').insert(batch);
          if (error) {
            console.error(`  💥 INSERT エラー: ${error.message}`);
            totalErrors += batch.length;
          } else {
            prefAdded += batch.length;
          }
        }

        prefSkipped += (features.length - toInsert.length);

        // 次ページ判定
        if (start + RESULTS_PER_PAGE - 1 >= totalAvailable) break;
        start += RESULTS_PER_PAGE;
        await sleep(DELAY_PER_REQUEST);
      }

      if (prefAdded > 0 || prefSkipped > 0) {
        console.log(`     ✅ 追加: ${prefAdded}件 / スキップ: ${prefSkipped}件`);
      } else {
        console.log(`     ☁️  該当なし`);
      }

      totalAdded += prefAdded;
      totalSkipped += prefSkipped;

      await sleep(DELAY_PER_REQUEST);
    }

    await sleep(DELAY_PER_PREF);
  }

  console.log(`\n========================================`);
  console.log(`🎉 インポート完了`);
  console.log(`   追加: ${totalAdded}件`);
  console.log(`   スキップ（重複）: ${totalSkipped}件`);
  console.log(`   エラー: ${totalErrors}件`);
  console.log(`========================================`);
}

main().catch((err) => {
  console.error('❌ 致命的エラー:', err);
  process.exit(1);
});
