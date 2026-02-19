/**
 * 楽天トラベルAPI 全自動インポートツール（2026年最新版・先生最終修正）
 * - 楽天の正しい4階層（Middle → Small → Detail）を自動取得
 * - 電話番号重複チェック付き
 * - region（11地方）自動判定
 * - レート制限回避 + エラー耐性強化
 */

const RAKUTEN_APP_ID = '18c62ced-24a7-4c8b-9917-b41d6ae300fe';   // ← あなたのIDに変更
const RAKUTEN_ACCESS_KEY = 'pk_42uxCSTpax33Jbgv0zbf89kgrHyfiGk4BstKcHLrp5J'; // ← あなたのキー

const supabaseClient = supabase.createClient(
    'https://ojkhwbvoaiaqekxrbpdd.supabase.co',
    'sb_secret_YTSjsm66P67WKiuXEEVIig_3NyBMHTl'   // Service Role Key（秘密鍵）推奨
);

const WAIT_TIME = 1200; // 1.2秒待機（レート制限回避）

// 11地方自動判定
function getRegion(middleCode) {
    const map = {
        "1": "北海道", "2":"東北","3":"東北","4":"東北","5":"東北","6":"東北","7":"東北",
        "8":"関東","9":"関東","10":"関東","11":"関東","12":"関東","13":"関東","14":"関東",
        "15":"北陸","16":"北陸","17":"北陸",
        "18":"甲信越","19":"甲信越","20":"甲信越",
        "21":"東海","22":"東海","23":"東海","24":"東海",
        "25":"関西","26":"関西","27":"関西","28":"関西","29":"関西","30":"関西",
        "31":"中国","32":"中国","33":"中国","34":"中国","35":"中国",
        "36":"四国","37":"四国","38":"四国","39":"四国",
        "40":"九州","41":"九州","42":"九州","43":"九州","44":"九州","45":"九州","46":"九州",
        "47":"沖縄"
    };
    return map[middleCode] || "その他";
}

// 電話番号お掃除
function cleanTel(tel) {
    return tel ? tel.replace(/\D/g, '') : null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ==================== メイン関数 ====================
async function runFullImport() {
    console.log("🚀 楽天トラベル 全自動インポート開始");

    // エリアマスタ取得（最新バージョン）
    const areaRes = await fetch(`https://openapi.rakuten.co.jp/engine/api/Travel/GetAreaClass/20140210?applicationId=${RAKUTEN_APP_ID}&accessKey=${RAKUTEN_ACCESS_KEY}&format=json&formatVersion=2`);
    const areaData = await areaRes.json();

    const middleClasses = areaData.items[0].middleClasses;

    for (const m of middleClasses) {
        const region = getRegion(m.middleClassCode);
        const prefecture = m.middleClassName;

        console.log(`📍 ${region} - ${prefecture} を処理中...`);

        for (const s of m.smallClasses) {
            const majorArea = s.smallClassName;
            const smallCode = s.smallClassCode;

            if (s.detailClasses && s.detailClasses.length > 0) {
                for (const d of s.detailClasses) {
                    await fetchAndSave(region, prefecture, majorArea, d.detailClass.detailClassName, 
                                      m.middleClassCode, smallCode, d.detailClass.detailClassCode);
                    await sleep(WAIT_TIME);
                }
            } else {
                await fetchAndSave(region, prefecture, majorArea, majorArea, 
                                  m.middleClassCode, smallCode, null);
                await sleep(WAIT_TIME);
            }
        }
    }

    console.log("🎉 全インポートが完了しました！");
}

// ==================== ホテル取得＆保存 ====================
async function fetchAndSave(region, prefecture, majorArea, city, mCode, sCode, dCode) {
    let url = `https://openapi.rakuten.co.jp/engine/api/Travel/SimpleHotelSearch/20170426?` +
              `applicationId=${RAKUTEN_APP_ID}&accessKey=${RAKUTEN_ACCESS_KEY}&format=json` +
              `&largeClassCode=japan&middleClassCode=${mCode}&smallClassCode=${sCode}`;

    if (dCode) url += `&detailClassCode=${dCode}`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        const hotels = (data.hotels || []).map(h => {
            const info = h.hotel[0].hotelBasicInfo;
            return {
                rakuten_hotel_no: info.hotelNo.toString(),
                name: info.hotelName,
                address: (info.address1 || '') + (info.address2 || ''),
                tel: cleanTel(info.telephoneNo),
                postal_code: info.postalCode,
                region: region,
                prefecture: prefecture,
                major_area: majorArea,
                city: city,
                thumbnail_url: info.hotelThumbnailUrl,
                hotel_url: info.hotelInformationUrl,
                rakuten_id: info.hotelNo,
                lat: parseFloat(info.latitude),
                lng: parseFloat(info.longitude)
            };
        });

        if (hotels.length > 0) {
            const { error } = await supabaseClient.from('hotels').upsert(hotels, { 
                onConflict: 'tel' 
            });
            if (error) console.error(`❌ 保存エラー (${city}):`, error.message);
            else console.log(`✅ ${city} : ${hotels.length}件 保存完了`);
        }
    } catch (e) {
        console.error(`APIエラー (${city}):`, e);
    }
}

// ==================== 実行ボタン用 ====================
window.runFullImport = runFullImport;