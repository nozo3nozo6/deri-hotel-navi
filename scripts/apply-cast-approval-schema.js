// ==========================================================================
// scripts/apply-cast-approval-schema.js
// sql/cast_approval.sql + sql/cast_chat_tables.sql をMySQLに適用
// Usage:
//   1. SSHトンネル起動: ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6051.wpx.ne.jp -N
//   2. node scripts/apply-cast-approval-schema.js
// ==========================================================================
const fs = require('fs');
const path = require('path');
const { query, close } = require('../db-local');

const SQL_FILES = [
    path.join(__dirname, '..', 'sql', 'cast_approval.sql'),
    path.join(__dirname, '..', 'sql', 'cast_chat_tables.sql'),
];

function splitStatements(sql) {
    const clean = sql.replace(/^\s*--.*$/gm, '');
    return clean.split(';').map(s => s.trim()).filter(s => s.length > 0);
}

(async () => {
    try {
        for (const file of SQL_FILES) {
            const label = path.basename(file);
            const sql = fs.readFileSync(file, 'utf8');
            const statements = splitStatements(sql);
            console.log(`\n[${label}] ${statements.length} statements`);
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
        }

        console.log('\n[verify] shop_casts columns:');
        const cols = await query(
            `SELECT column_name, column_type, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'shop_casts'
             AND column_name IN ('status','approved_at','chat_is_online','chat_last_online_at','chat_notify_mode')
             ORDER BY ordinal_position`
        );
        for (const c of cols) {
            const name = c.column_name || c.COLUMN_NAME;
            const type = c.column_type || c.COLUMN_TYPE;
            const nul = c.is_nullable || c.IS_NULLABLE;
            const def = c.column_default != null ? c.column_default : (c.COLUMN_DEFAULT != null ? c.COLUMN_DEFAULT : '(none)');
            console.log(`  ${name}: ${type} NULL=${nul} DEFAULT=${def}`);
        }

        console.log('\n[verify] chat_sessions.cast_id:');
        const cs = await query(
            `SELECT column_name, column_type FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'chat_sessions' AND column_name = 'cast_id'`
        );
        console.log(cs.length ? `  OK: ${cs[0].column_type || cs[0].COLUMN_TYPE}` : '  MISSING');

        console.log('\n[verify] existing shop_casts status counts:');
        const counts = await query(`SELECT status, COUNT(*) AS cnt FROM shop_casts GROUP BY status`);
        for (const r of counts) console.log(`  ${r.status}: ${r.cnt}`);

        console.log('\n[done] cast approval + chat schema applied');
        process.exit(0);
    } catch (e) {
        console.error('[ERROR]', e.message || e);
        process.exit(1);
    } finally {
        try { await close(); } catch (_) {}
    }
})();
