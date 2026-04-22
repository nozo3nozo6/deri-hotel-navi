// ==========================================================================
// scripts/apply-cast-inbox-devices.js
// sql/cast_inbox_device_registration.sql をMySQLに適用 (cast_inbox_devices / cast_inbox_codes)
// Usage:
//   1. SSHトンネル起動: ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6051.wpx.ne.jp -N
//   2. node scripts/apply-cast-inbox-devices.js
// ==========================================================================
const fs = require('fs');
const path = require('path');
const { query, close } = require('../db-local');

const SQL_FILE = path.join(__dirname, '..', 'sql', 'cast_inbox_device_registration.sql');

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
            await query(stmt);
        }
        console.log('All statements applied.');
        const devCheck = await query("SHOW TABLES LIKE 'cast_inbox_devices'");
        const codCheck = await query("SHOW TABLES LIKE 'cast_inbox_codes'");
        console.log('cast_inbox_devices:', devCheck.length ? 'OK' : 'MISSING');
        console.log('cast_inbox_codes:', codCheck.length ? 'OK' : 'MISSING');
    } catch (e) {
        console.error('ERROR:', e.message);
        process.exit(1);
    } finally {
        await close();
    }
})();
