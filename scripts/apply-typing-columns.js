// ==========================================================================
// scripts/apply-typing-columns.js
// Day 8: sql/add_chat_typing_columns.sql を MySQL に適用
// Usage:
//   1. SSHトンネル起動: ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6051.wpx.ne.jp -N
//   2. node scripts/apply-typing-columns.js
// ==========================================================================
const fs = require('fs');
const path = require('path');
const { query, close } = require('../db-local');

const SQL_FILE = path.join(__dirname, '..', 'sql', 'add_chat_typing_columns.sql');

function splitStatements(sql) {
    const clean = sql.replace(/^\s*--.*$/gm, '');
    return clean.split(';').map(s => s.trim()).filter(s => s.length > 0);
}

(async () => {
    try {
        const sql = fs.readFileSync(SQL_FILE, 'utf8');
        const statements = splitStatements(sql);
        console.log(`[add_chat_typing_columns.sql] ${statements.length} statements`);
        for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i];
            const preview = stmt.split('\n')[0].slice(0, 80);
            console.log(`  [${i + 1}/${statements.length}] ${preview}...`);
            try {
                await query(stmt);
            } catch (e) {
                const msg = (e && e.message) || String(e);
                if (/Duplicate column name|already exists|Duplicate key name/i.test(msg)) {
                    console.log(`  -> skip (already applied): ${msg.split('\n')[0]}`);
                    continue;
                }
                throw e;
            }
        }

        console.log('\n[verify] chat_sessions typing columns:');
        const cols = await query(
            `SELECT column_name, column_type, is_nullable
             FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'chat_sessions'
             AND column_name IN ('visitor_typing_until','shop_typing_until')
             ORDER BY ordinal_position`
        );
        for (const c of cols) {
            const name = c.column_name || c.COLUMN_NAME;
            const type = c.column_type || c.COLUMN_TYPE;
            const nul = c.is_nullable || c.IS_NULLABLE;
            console.log(`  ${name}: ${type} NULL=${nul}`);
        }

        console.log('\n[done] typing columns applied');
        process.exit(0);
    } catch (e) {
        console.error('[ERROR]', e.message || e);
        process.exit(1);
    } finally {
        try { await close(); } catch (_) {}
    }
})();
