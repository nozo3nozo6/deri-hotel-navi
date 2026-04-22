// sql/visitor_email_verify.sql を本番 MariaDB (SSHトンネル経由) に流す.
// Usage: node scripts/apply-visitor-email-verify-migration.js
require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '3307'),
        database: process.env.DB_NAME || 'yobuho_db',
        user: process.env.DB_USER || 'yobuho_user',
        password: process.env.DB_PASS || '',
        charset: 'utf8mb4',
    });

    try {
        // 既存カラム確認 (冪等性担保: 2度流しても壊れない)
        const [cols] = await pool.query(
            "SHOW COLUMNS FROM chat_sessions LIKE 'visitor_email_verified'"
        );
        if (cols.length > 0) {
            console.log('[skip] visitor_email_verified already exists');
        } else {
            await pool.query(`ALTER TABLE chat_sessions
                ADD COLUMN visitor_email_verified TINYINT(1) NOT NULL DEFAULT 0,
                ADD COLUMN visitor_email_verify_token VARCHAR(64) DEFAULT NULL,
                ADD COLUMN visitor_email_verify_expires_at DATETIME DEFAULT NULL`);
            console.log('[ok] ALTER TABLE chat_sessions: 3 columns added');
        }

        const [idx] = await pool.query(
            "SHOW INDEX FROM chat_sessions WHERE Key_name='idx_chat_sessions_verify_token'"
        );
        if (idx.length > 0) {
            console.log('[skip] idx_chat_sessions_verify_token already exists');
        } else {
            await pool.query(
                'CREATE INDEX idx_chat_sessions_verify_token ON chat_sessions (visitor_email_verify_token)'
            );
            console.log('[ok] CREATE INDEX idx_chat_sessions_verify_token');
        }

        // 検証
        const [verify] = await pool.query(
            "SHOW COLUMNS FROM chat_sessions WHERE Field IN ('visitor_email_verified','visitor_email_verify_token','visitor_email_verify_expires_at')"
        );
        console.log('[verify] columns present:', verify.map(c => c.Field).join(', '));
    } finally {
        await pool.end();
    }
}

main().catch(e => { console.error(e); process.exit(1); });
