// 直近の営業メール送信履歴を確認
const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
    const conn = await mysql.createConnection({
        host: '127.0.0.1', port: 3308,
        database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS,
    });
    const [rows] = await conn.execute(
        `SELECT DATE_FORMAT(sent_at,'%H:%i:%s') AS t, area, shop_name, email, status
         FROM outreach_emails ORDER BY sent_at DESC LIMIT 80`
    );
    console.log(`直近${rows.length}件:\n`);
    const sentCount = rows.filter(r => r.status === 'sent').length;
    const errorCount = rows.filter(r => r.status !== 'sent').length;
    rows.forEach(r => {
        const mark = r.status === 'sent' ? '✓' : '✗';
        console.log(`${r.t}  ${mark}  ${r.area || '-'}  ${r.email.padEnd(36)}  ${r.shop_name}`);
    });
    console.log(`\n成功: ${sentCount} / エラー: ${errorCount}`);
    await conn.end();
})().catch(e => { console.error(e.message); process.exit(1); });
