// ==========================================================================
// scripts/apply-visitor-notify-schema.js
// sql/visitor_notify.sql をMySQLに適用
// Usage:
//   1. SSHトンネル起動: ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6051.wpx.ne.jp -N
//   2. node scripts/apply-visitor-notify-schema.js
// ==========================================================================
const fs = require('fs');
const path = require('path');
const { query, close } = require('../db-local');

const SQL_FILE = path.join(__dirname, '..', 'sql', 'visitor_notify.sql');

function splitStatements(sql) {
    const clean = sql.replace(/^\s*--.*$/gm, '');
    return clean.split(';').map(s => s.trim()).filter(s => s.length > 0);
}

(async () => {
    try {
        const sql = fs.readFileSync(SQL_FILE, 'utf8');
        const statements = splitStatements(sql);
        console.log(`[visitor_notify.sql] ${statements.length} statements`);
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

        console.log('\n[verify] chat_sessions visitor_* columns:');
        const cols = await query(
            `SELECT column_name, column_type, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'chat_sessions'
             AND column_name IN ('visitor_email','visitor_notify_enabled','visitor_last_notified_at')
             ORDER BY ordinal_position`
        );
        for (const c of cols) {
            const name = c.column_name || c.COLUMN_NAME;
            const type = c.column_type || c.COLUMN_TYPE;
            const nul = c.is_nullable || c.IS_NULLABLE;
            const def = c.column_default != null ? c.column_default : (c.COLUMN_DEFAULT != null ? c.COLUMN_DEFAULT : '(none)');
            console.log(`  ${name}: ${type} NULL=${nul} DEFAULT=${def}`);
        }

        console.log('\n[done] visitor notify schema applied');
        process.exit(0);
    } catch (e) {
        console.error('[ERROR]', e.message || e);
        process.exit(1);
    } finally {
        try { await close(); } catch (_) {}
    }
})();
