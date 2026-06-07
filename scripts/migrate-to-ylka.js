// ==========================================================================
// migrate-to-ylka.js — yobuho_db → ylka.jp 用SQLファイル生成
//
// 出力:
//   sql/ylka/01-schema.sql   テーブルDDL（22テーブル + ビュー1）
//   sql/ylka/02-master.sql   マスタデータ（room_types, can/cannot_call_reasons, contract_plans, shop_service_options）
//   sql/ylka/03-hotels.sql   西東京・三多摩の通常ホテル179件
//
// 使い方: node scripts/migrate-to-ylka.js
// ==========================================================================
const fs = require('fs');
const path = require('path');
const db = require('../db-local.js');

const TARGET_AREA = { prefecture: '東京都', major_area: '西東京・三多摩' };
const EXCLUDE_HOTEL_TYPES = ['love_hotel', 'rental_room'];

const TABLES = [
    // ホテル本体
    'hotels',
    // 投稿系（空）
    'reports', 'report_votes',
    // 店舗系（空）
    'shops', 'shop_hotel_info', 'shop_hotel_services',
    'shop_contracts', 'shop_placements', 'shop_service_areas',
    'shop_images', 'shop_plan_requests', 'shop_email_tokens',
    // マスタ系（データもコピー）
    'room_types', 'can_call_reasons', 'cannot_call_reasons',
    'shop_service_options', 'contract_plans',
    // 訂正・リクエスト系（空）
    'hotel_requests', 'hotel_corrections',
    // 広告枠（空）
    'ad_placements',
    // 管理系
    'admin_users', 'agent_users',
    // 営業メール（空）
    'outreach_emails',
];

const MASTER_TABLES_WITH_DATA = [
    'room_types', 'can_call_reasons', 'cannot_call_reasons',
    'shop_service_options', 'contract_plans',
];

const OUT_DIR = path.join(__dirname, '..', 'sql', 'ylka');

function escapeValue(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
    if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`;
    return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
}

function buildInsert(table, rows) {
    if (rows.length === 0) return `-- ${table}: 0 rows\n`;
    const cols = Object.keys(rows[0]);
    const values = rows.map(r => '(' + cols.map(c => escapeValue(r[c])).join(', ') + ')').join(',\n  ');
    return `INSERT INTO \`${table}\` (\`${cols.join('`, `')}\`) VALUES\n  ${values};\n`;
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    // === 01-schema.sql ===
    const schemaLines = [
        '-- ============================================================',
        '-- ylka.jp スキーマ（yobuho_db から派生、ラブホ系除外）',
        '-- 生成: ' + new Date().toISOString(),
        '-- ============================================================',
        '',
        'SET FOREIGN_KEY_CHECKS = 0;',
        'SET NAMES utf8mb4;',
        '',
    ];

    for (const t of TABLES) {
        const rows = await db.query(`SHOW CREATE TABLE \`${t}\``);
        if (!rows[0]) {
            schemaLines.push(`-- !! ${t} not found in yobuho_db, skipped`);
            continue;
        }
        let ddl = rows[0]['Create Table'];
        // AUTO_INCREMENT のスタート値をリセット
        ddl = ddl.replace(/AUTO_INCREMENT=\d+\s*/g, '');
        schemaLines.push(`-- --- ${t} ---`);
        schemaLines.push(`DROP TABLE IF EXISTS \`${t}\`;`);
        schemaLines.push(ddl + ';');
        schemaLines.push('');
    }

    // hotel_report_summary ビュー（reports のみで集計、loveho_reports は除外）
    schemaLines.push('-- --- hotel_report_summary (view) ---');
    schemaLines.push('DROP VIEW IF EXISTS `hotel_report_summary`;');
    schemaLines.push(`CREATE VIEW \`hotel_report_summary\` AS
SELECT
    h.id AS hotel_id,
    COUNT(r.id) AS total_reports,
    SUM(CASE WHEN r.can_call = 1 AND (r.poster_type IS NULL OR r.poster_type = 'user') THEN 1 ELSE 0 END) AS user_can_call,
    SUM(CASE WHEN r.can_call = 0 AND (r.poster_type IS NULL OR r.poster_type = 'user') THEN 1 ELSE 0 END) AS user_cannot_call,
    SUM(CASE WHEN r.can_call = 1 AND r.poster_type = 'shop' THEN 1 ELSE 0 END) AS shop_can_call,
    SUM(CASE WHEN r.can_call = 0 AND r.poster_type = 'shop' THEN 1 ELSE 0 END) AS shop_cannot_call
FROM hotels h
LEFT JOIN reports r ON r.hotel_id = h.id AND (r.is_hidden = 0 OR r.is_hidden IS NULL)
GROUP BY h.id;`);
    schemaLines.push('');

    schemaLines.push('SET FOREIGN_KEY_CHECKS = 1;');

    fs.writeFileSync(path.join(OUT_DIR, '01-schema.sql'), schemaLines.join('\n'));
    console.log('✓ 01-schema.sql (' + TABLES.length + ' tables + 1 view)');

    // === 02-master.sql ===
    const masterLines = [
        '-- ============================================================',
        '-- ylka.jp マスタデータ（yobuho_db から完全コピー）',
        '-- 注: 後で ylka.jp 用に絞り込み・編集可能',
        '-- ============================================================',
        '',
        'SET NAMES utf8mb4;',
        '',
    ];
    for (const t of MASTER_TABLES_WITH_DATA) {
        const rows = await db.query(`SELECT * FROM \`${t}\``);
        masterLines.push(`-- --- ${t} (${rows.length} rows) ---`);
        masterLines.push(`TRUNCATE TABLE \`${t}\`;`);
        masterLines.push(buildInsert(t, rows));
    }
    fs.writeFileSync(path.join(OUT_DIR, '02-master.sql'), masterLines.join('\n'));
    console.log('✓ 02-master.sql (' + MASTER_TABLES_WITH_DATA.length + ' tables)');

    // === 03-hotels.sql ===
    const excludePlaceholders = EXCLUDE_HOTEL_TYPES.map(() => '?').join(',');
    const hotels = await db.query(
        `SELECT * FROM hotels
         WHERE prefecture = ? AND major_area = ? AND is_published = 1
           AND hotel_type NOT IN (${excludePlaceholders})
         ORDER BY id`,
        [TARGET_AREA.prefecture, TARGET_AREA.major_area, ...EXCLUDE_HOTEL_TYPES]
    );
    const hotelsLines = [
        '-- ============================================================',
        '-- ylka.jp 西東京・三多摩エリアのホテルデータ',
        '-- 抽出条件: prefecture=東京都, major_area=西東京・三多摩, is_published=1, hotel_type NOT IN (love_hotel, rental_room)',
        '-- 件数: ' + hotels.length,
        '-- 生成: ' + new Date().toISOString(),
        '-- ============================================================',
        '',
        'SET NAMES utf8mb4;',
        '',
        `-- ${hotels.length} hotels`,
        buildInsert('hotels', hotels),
    ];
    fs.writeFileSync(path.join(OUT_DIR, '03-hotels.sql'), hotelsLines.join('\n'));
    console.log('✓ 03-hotels.sql (' + hotels.length + ' hotels)');

    // 統計
    const cityStats = {};
    hotels.forEach(h => { cityStats[h.city] = (cityStats[h.city] || 0) + 1; });
    console.log('\n市区町村別件数:');
    Object.entries(cityStats).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
        console.log('  ' + c + ': ' + n);
    });

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
