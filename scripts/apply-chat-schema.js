// ==========================================================================
// scripts/apply-chat-schema.js
// sql/chat_tables.sql をMySQLに適用 + パイロット店舗(dgqeiw1i)を有効化
// Usage:
//   1. SSHトンネル起動: ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6051.wpx.ne.jp -N
//   2. node scripts/apply-chat-schema.js
// ==========================================================================
const fs = require('fs');
const path = require('path');
const { query, close } = require('../db-local');

const PILOT_SLUG = 'dgqeiw1i';
const SQL_FILE = path.join(__dirname, '..', 'sql', 'chat_tables.sql');

function splitStatements(sql) {
    const clean = sql.replace(/^\s*--.*$/gm, '');
    return clean.split(';').map(s => s.trim()).filter(s => s.length > 0);
}

(async () => {
    try {
        const sql = fs.readFileSync(SQL_FILE, 'utf8');
        const statements = splitStatements(sql);
        console.log(`[schema] ${statements.length} statements to execute`);

        for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i];
            const preview = stmt.split('\n')[0].slice(0, 80);
            console.log(`[schema] [${i + 1}/${statements.length}] ${preview}...`);
            await query(stmt);
        }
        console.log('[schema] All CREATE TABLE statements executed');

        const tables = ['chat_sessions', 'chat_messages', 'shop_chat_templates', 'shop_chat_status', 'shop_chat_devices', 'chat_blocks'];
        const existing = await query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?, ?, ?, ?, ?, ?)`,
            tables
        );
        const existingSet = new Set(existing.map(r => (r.table_name || r.TABLE_NAME).toLowerCase()));
        for (const t of tables) {
            console.log(`[verify] ${t}: ${existingSet.has(t) ? 'OK' : 'MISSING'}`);
        }

        const shop = await query(`SELECT id, shop_name, slug FROM shops WHERE slug = ? LIMIT 1`, [PILOT_SLUG]);
        if (shop.length === 0) {
            console.log(`[pilot] slug="${PILOT_SLUG}" not found, skipping activation`);
        } else {
            const shopId = shop[0].id;
            const existing = await query(`SELECT shop_id FROM shop_chat_status WHERE shop_id = ?`, [shopId]);
            if (existing.length > 0) {
                console.log(`[pilot] ${PILOT_SLUG} (${shop[0].shop_name}) already activated`);
            } else {
                await query(
                    `INSERT INTO shop_chat_status (shop_id, is_online, notify_mode, notify_min_interval_minutes) VALUES (?, 0, 'first', 3)`,
                    [shopId]
                );
                console.log(`[pilot] Activated chat for ${PILOT_SLUG} (${shop[0].shop_name})`);
            }
        }

        console.log('[done] Phase 1 schema applied successfully');
    } catch (err) {
        console.error('[error]', err.code || '', err.message);
        if (err.sqlMessage) console.error('[sql]', err.sqlMessage);
        process.exitCode = 1;
    } finally {
        await close();
    }
})();
