// ==========================================================================
// apply-ylka-schema.js — sql/ylka/*.sql を yobuho_ylka に流し込む
//
// 前提:
//   1. SSHトンネル起動済み: ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6051.wpx.ne.jp -N
//   2. .env.ylka を作成（YLKA_DB_HOST / NAME / USER / PASS）
//   3. sql/ylka/01-schema.sql, 02-master.sql, 03-hotels.sql が生成済み
//
// 使い方: node scripts/apply-ylka-schema.js
// ==========================================================================
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.ylka') });

const FILES = ['01-schema.sql', '02-master.sql', '03-hotels.sql'];

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.YLKA_DB_HOST || '127.0.0.1',
        port: parseInt(process.env.YLKA_DB_PORT || '3307'),
        database: process.env.YLKA_DB_NAME,
        user: process.env.YLKA_DB_USER,
        password: process.env.YLKA_DB_PASS,
        charset: 'utf8mb4',
        multipleStatements: true,
    });

    console.log(`Connected to ${process.env.YLKA_DB_NAME} as ${process.env.YLKA_DB_USER}`);

    for (const f of FILES) {
        const fp = path.join(__dirname, '..', 'sql', 'ylka', f);
        if (!fs.existsSync(fp)) {
            console.error(`× ${f} not found`);
            continue;
        }
        const sql = fs.readFileSync(fp, 'utf8');
        console.log(`\n▶ Applying ${f} (${(sql.length / 1024).toFixed(1)}KB)...`);
        try {
            await conn.query(sql);
            console.log(`✓ ${f} applied`);
        } catch (e) {
            console.error(`× ${f} failed:`, e.message);
            console.error('  SQL state:', e.sqlState, 'errno:', e.errno);
            await conn.end();
            process.exit(1);
        }
    }

    // 確認クエリ
    const [tables] = await conn.query('SHOW TABLES');
    const [hotelCount] = await conn.query('SELECT COUNT(*) AS c FROM hotels');
    const [roomTypeCount] = await conn.query('SELECT COUNT(*) AS c FROM room_types');
    console.log('\n=== 投入結果 ===');
    console.log('テーブル数:', tables.length);
    console.log('hotels:', hotelCount[0].c + ' 件');
    console.log('room_types:', roomTypeCount[0].c + ' 件');

    await conn.end();
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
