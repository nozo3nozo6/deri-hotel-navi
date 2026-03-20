/**
 * update-detail-area.js
 *
 * 【モード1】detailClassを持つ都市 → detailCode単位でdetail_area更新
 * 【モード2】detailClassのない都市  → smallClass単位でdetail_area = smallName に更新
 *
 * 実行: node update-detail-area.js
 * 事前にSSHトンネル起動: ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6825.wpx.ne.jp -N
 */

require('dotenv').config();
const { query, close } = require('./db-local');
const axios = require('axios');

const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const HEADERS = {
    'Referer': 'https://yobuho.com',
    'Origin': 'https://yobuho.com',
    'Authorization': `Bearer ${RAKUTEN_ACCESS_KEY}`
};
const WAIT_TIME = 2000;
const MAX_RETRY = 5;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── モード1: detailClassあり都市（GetAreaClassから動的に取得） ──────────────
const DETAIL_CITIES = [
    { prefCode: 'tokyo',    smallCode: 'tokyo',     label: '東京２３区内（池袋リトライ）', retryCode: 'G' },
];

// ── モード2: detailClassなし都市（smallClass単位で更新） ──────────────────────
const SIMPLE_CITIES = [
    { prefCode: 'kanagawa',  smallCode: 'yokohama',  smallName: '横浜',                              prefName: '神奈川県' },
    { prefCode: 'hukuoka',   smallCode: 'fukuoka',   smallName: '博多・キャナルシティ・海の中道・太宰府・二日市', prefName: '福岡県' },
    { prefCode: 'miyagi',    smallCode: 'sendai',    smallName: '仙台・多賀城・名取',                 prefName: '宮城県' },
    { prefCode: 'hyogo',     smallCode: 'kobe',      smallName: '神戸・有馬温泉・六甲山',             prefName: '兵庫県' },
    { prefCode: 'hiroshima', smallCode: 'hiroshima', smallName: '広島',                              prefName: '広島県' },
    { prefCode: 'okinawa',   smallCode: 'nahashi',   smallName: '那覇',                              prefName: '沖縄県' },
];

// ── API共通 ──────────────────────────────────────────────────────────────────
async function rakutenRequest(params, retry = 0) {
    try {
        const res = await axios.get(
            'https://openapi.rakuten.co.jp/engine/api/Travel/SimpleHotelSearch/20170426',
            { params, headers: HEADERS, timeout: 30000 }
        );
        return res;
    } catch (err) {
        const code = err.response?.status;
        const isRetryable = code === 503 || code === 429 || code === 500 || err.code === 'ECONNRESET' || err.code === 'ECONNABORTED';
        if (isRetryable && retry < MAX_RETRY) {
            const wait = 5000 * (retry + 1);
            console.log(`  ⚠️  ${code || err.code} — ${wait/1000}秒後リトライ (${retry + 1}/${MAX_RETRY})`);
            await sleep(wait);
            return rakutenRequest(params, retry + 1);
        }
        throw err;
    }
}

// ── モード1: detailCode指定で更新 ────────────────────────────────────────────
async function updateByDetail(prefCode, smallCode, detailCode, detailName) {
    let page = 1;
    let totalUpdated = 0;
    while (true) {
        const params = {
            applicationId: RAKUTEN_APP_ID,
            accessKey: RAKUTEN_ACCESS_KEY,
            format: 'json',
            largeClassCode: 'japan',
            middleClassCode: prefCode,
            smallClassCode: smallCode,
            detailClassCode: detailCode,
            hits: 30,
            page,
            datumType: 1
        };
        const res = await rakutenRequest(params);
        const hotels = res.data.hotels || [];
        if (hotels.length === 0) break;

        const hotelNos = hotels
            .map(h => h.hotel[0]?.hotelBasicInfo?.hotelNo)
            .filter(Boolean)
            .map(String);

        if (hotelNos.length > 0) {
            const placeholders = hotelNos.map(() => '?').join(',');
            try {
                await query(
                    `UPDATE hotels SET detail_area = ?, detail_area_code = ? WHERE rakuten_hotel_no IN (${placeholders})`,
                    [detailName, detailCode, ...hotelNos]
                );
                totalUpdated += hotelNos.length;
            } catch (e) {
                console.error(`    💥 UPDATE エラー:`, e.message);
            }
        }

        const pageInfo = res.data.pagingInfo;
        if (!pageInfo || page >= pageInfo.pageCount) break;
        page++;
        await sleep(WAIT_TIME);
    }
    return totalUpdated;
}

// ── モード2: smallCode指定で更新（detailClassなし都市） ──────────────────────
async function updateBySmall(prefCode, smallCode, smallName) {
    let page = 1;
    let totalUpdated = 0;
    while (true) {
        const params = {
            applicationId: RAKUTEN_APP_ID,
            accessKey: RAKUTEN_ACCESS_KEY,
            format: 'json',
            largeClassCode: 'japan',
            middleClassCode: prefCode,
            smallClassCode: smallCode,
            hits: 30,
            page,
            datumType: 1
        };
        const res = await rakutenRequest(params);
        const hotels = res.data.hotels || [];
        if (hotels.length === 0) break;

        const hotelNos = hotels
            .map(h => h.hotel[0]?.hotelBasicInfo?.hotelNo)
            .filter(Boolean)
            .map(String);

        if (hotelNos.length > 0) {
            const placeholders = hotelNos.map(() => '?').join(',');
            try {
                await query(
                    `UPDATE hotels SET detail_area = ?, detail_area_code = ? WHERE rakuten_hotel_no IN (${placeholders})`,
                    [smallName, smallCode, ...hotelNos]
                );
                totalUpdated += hotelNos.length;
            } catch (e) {
                console.error(`    💥 UPDATE エラー:`, e.message);
            }
        }

        const pageInfo = res.data.pagingInfo;
        if (!pageInfo || page >= pageInfo.pageCount) break;
        page++;
        await sleep(WAIT_TIME);
    }
    return totalUpdated;
}

// ── 完了後の集計クエリ ────────────────────────────────────────────────────────
async function showSummary() {
    console.log('\n========================================');
    console.log('📊 detail_area 設定状況（完了後集計）');
    console.log('========================================');

    const [{ cnt: totalCount }] = await query(
        'SELECT COUNT(*) as cnt FROM hotels WHERE detail_area IS NOT NULL'
    );
    console.log(`\n✅ detail_area が入っているホテル総数: ${totalCount} 件`);

    const cities = [
        { label: '東京23区',  where: "prefecture = '東京都'" },
        { label: '大阪',      where: "prefecture = '大阪府'" },
        { label: '京都',      where: "prefecture = '京都府'" },
        { label: '札幌',      where: "major_area = '札幌'" },
        { label: '名古屋',    where: "major_area = '名古屋'" },
        { label: '横浜',      where: "major_area = '横浜'" },
        { label: '福岡（博多）', where: "major_area = '博多・キャナルシティ・海の中道・太宰府・二日市'" },
        { label: '仙台',      where: "major_area = '仙台'" },
        { label: '神戸',      where: "major_area = '神戸'" },
        { label: '広島',      where: "major_area = '広島'" },
        { label: '那覇',      where: "major_area = '那覇'" },
    ];

    console.log('\n--- 都市別 detail_area件数 ---');
    for (const city of cities) {
        const [{ cnt }] = await query(
            `SELECT COUNT(*) as cnt FROM hotels WHERE detail_area IS NOT NULL AND ${city.where}`
        );
        console.log(`  ${city.label}: ${cnt} 件`);
    }

    console.log('\n--- 東京23区 detail_area 種類 ---');
    const tokyoAreas = await query(
        "SELECT DISTINCT detail_area FROM hotels WHERE prefecture = '東京都' AND detail_area IS NOT NULL ORDER BY detail_area"
    );
    tokyoAreas.forEach(r => console.log('  - ' + r.detail_area));
}

// ── メイン ────────────────────────────────────────────────────────────────────
async function main() {
    console.log('📡 GetAreaClass を取得中...\n');
    const areaRes = await axios.get(
        'https://openapi.rakuten.co.jp/engine/api/Travel/GetAreaClass/20140210',
        { params: { applicationId: RAKUTEN_APP_ID, accessKey: RAKUTEN_ACCESS_KEY, format: 'json' }, headers: HEADERS }
    );
    const middles = areaRes.data.areaClasses.largeClasses[0].largeClass.middleClasses;

    const detailTasks = [];
    for (const cityDef of DETAIL_CITIES) {
        const mObj = middles.find(m => m.middleClass.middleClassCode === cityDef.prefCode);
        if (!mObj) continue;
        const m = mObj.middleClass;
        const sObj = (m.smallClasses || []).find(s => s.smallClass.smallClassCode === cityDef.smallCode);
        if (!sObj) continue;
        const s = sObj.smallClass;
        for (const dObj of (s.detailClasses || [])) {
            const d = dObj.detailClass;
            if (cityDef.retryCode && d.detailClassCode !== cityDef.retryCode) continue;
            detailTasks.push({
                prefCode: m.middleClassCode,
                prefName: m.middleClassName,
                smallCode: s.smallClassCode,
                smallName: s.smallClassName,
                detailCode: d.detailClassCode,
                detailName: d.detailClassName,
            });
        }
    }

    console.log('========================================');
    console.log('📋 実行予定タスク一覧');
    console.log('========================================');
    console.log('\n【モード1: detailClass指定更新】');
    if (detailTasks.length === 0) {
        console.log('  (なし)');
    } else {
        detailTasks.forEach(t => console.log(`  - ${t.prefName}/${t.smallName}/${t.detailName} (${t.detailCode})`));
    }
    console.log('\n【モード2: smallClass単位更新（detailClassなし都市）】');
    SIMPLE_CITIES.forEach(c => console.log(`  - ${c.prefName}/${c.smallName} (${c.smallCode}) → detail_area="${c.smallName}"`));
    console.log('');

    let grandTotal = 0;

    if (detailTasks.length > 0) {
        console.log('=== 【モード1】detailClass指定更新 ===\n');
        for (const task of detailTasks) {
            process.stdout.write(`  🔄 ${task.prefName}/${task.detailName} ... `);
            try {
                const n = await updateByDetail(task.prefCode, task.smallCode, task.detailCode, task.detailName);
                console.log(`✅ ${n}件更新`);
                grandTotal += n;
            } catch (err) {
                console.log(`❌ ${err.response?.data?.errors?.errorMessage || err.message}`);
            }
            await sleep(WAIT_TIME);
        }
    }

    console.log('\n=== 【モード2】smallClass単位更新（detailClassなし6都市） ===\n');
    for (const city of SIMPLE_CITIES) {
        process.stdout.write(`  🔎 ${city.prefName}/${city.smallName} → detail_area="${city.smallName}" ... `);
        try {
            const n = await updateBySmall(city.prefCode, city.smallCode, city.smallName);
            console.log(`✅ ${n}件更新`);
            grandTotal += n;
        } catch (err) {
            console.log(`❌ ${err.response?.data?.errors?.errorMessage || err.message}`);
        }
        await sleep(WAIT_TIME);
    }

    console.log(`\n🎉 完了! 合計 ${grandTotal} 件を更新しました。`);

    await showSummary();
    await close();
}

main().catch(async err => { console.error('❌ 致命的エラー:', err.message); await close(); });
