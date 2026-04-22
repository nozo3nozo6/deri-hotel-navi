// ==========================================================================
// scripts/apply-cast-soft-delete.js
// sql/cast_soft_delete.sql をMySQLに適用 (shop_casts.deleted_at)
// Usage:
//   1. SSHトンネル起動: ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6051.wpx.ne.jp -N
//   2. node scripts/apply-cast-soft-delete.js
// ==========================================================================
const fs = require('fs');
const path = require('path');
const { query, close } = require('../db-local');

const SQL_FILE = path.join(__dirname, '..', 'sql', 'cast_soft_delete.sql');

function splitStatements(sql) {
    const clean = sql.replace(/^\s*--.*$/gm, '');
    return clean.split(';').map(s => s.trim()).filter(s => s.length > 0);
}

(async () => {
    try {
        const sql = fs.readFileSync(SQL_FILE, 'utf8');
        const statements = splitStatements(sql);
        for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i];
            const preview = stmt.split('\n')[0].slice(0, 80);
            console.log(`[${i + 1}/${statements.length}] ${preview}`);
            try {
                await query(stmt);
            } catch (e) {
                // ALTER/CREATE INDEX を二重実行した場合だけ通す
                if (/Duplicate column name|already exists|Duplicate key name/i.test(e.message)) {
                    console.log(`  skip: ${e.message}`);
                    continue;
                }
                throw e;
            }
        }
        console.log('All statements applied.');
        const cols = await query("SHOW COLUMNS FROM shop_casts LIKE 'deleted_at'");
        console.log('shop_casts.deleted_at:', cols.length ? 'OK' : 'MISSING');
    } catch (e) {
        console.error('ERROR:', e.message);
        process.exit(1);
    } finally {
        await close();
    }
})();
