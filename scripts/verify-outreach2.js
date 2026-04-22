const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
    const conn = await mysql.createConnection({
        host: '127.0.0.1', port: 3309,
        database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS,
    });

    // 1) status分布
    const [s] = await conn.execute(
        `SELECT status, COUNT(*) AS n FROM outreach_emails
         WHERE sent_at >= '2026-04-17 00:00:00' GROUP BY status ORDER BY n DESC`
    );
    console.log('=== 本日のstatus分布 ===');
    s.forEach(r => console.log(`  ${r.status.padEnd(15)} ${r.n}件`));

    // 2) sent以外の詳細（notes全文）
    const [bad] = await conn.execute(
        `SELECT DATE_FORMAT(sent_at,'%H:%i:%s') AS t, status, email, shop_name, notes
         FROM outreach_emails
         WHERE sent_at >= '2026-04-17 00:00:00' AND status != 'sent'
         ORDER BY sent_at DESC`
    );
    console.log('\n=== sent以外のレコード詳細 ===');
    bad.forEach(r => {
        console.log(`${r.t}  [${r.status}]  ${r.email}  (${r.shop_name})`);
        console.log(`         notes: ${r.notes}`);
    });

    await conn.end();
})().catch(e => { console.error(e.message); process.exit(1); });
