// ==========================================================================
// scripts/apply-do-ready-migration.js
// sql/chat_do_ready_migration.sql を本番MariaDBに適用 (冪等)
// Usage:
//   1. ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6051.wpx.ne.jp -N
//   2. node scripts/apply-do-ready-migration.js
// ==========================================================================
const { query, close } = require('../db-local');

async function hasColumn(table, column) {
    const rows = await query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
        [table, column]
    );
    return rows.length > 0;
}

async function hasIndex(table, indexName) {
    const rows = await query(
        `SELECT 1 FROM information_schema.statistics
         WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
        [table, indexName]
    );
    return rows.length > 0;
}

(async () => {
    try {
        // 1. chat_messages.client_msg_id + UNIQUE
        if (await hasColumn('chat_messages', 'client_msg_id')) {
            console.log('[skip] chat_messages.client_msg_id already exists');
        } else {
            await query(
                `ALTER TABLE chat_messages
                 ADD COLUMN client_msg_id VARCHAR(36) NULL
                 COMMENT 'クライアント生成UUID. 重複送信の冪等化に使用' AFTER id,
                 ADD UNIQUE KEY uq_client_msg_id (client_msg_id)`
            );
            console.log('[ok] chat_messages.client_msg_id + UNIQUE added');
        }

        // 2. chat_sessions heartbeat columns
        if (await hasColumn('chat_sessions', 'last_visitor_heartbeat_at')) {
            console.log('[skip] chat_sessions.last_visitor_heartbeat_at already exists');
        } else {
            await query(
                `ALTER TABLE chat_sessions
                 ADD COLUMN last_visitor_heartbeat_at DATETIME NULL
                 COMMENT 'visitor側が最後にsubscribe tickした時刻',
                 ADD COLUMN last_owner_heartbeat_at DATETIME NULL
                 COMMENT 'owner側が最後にsubscribe tickした時刻'`
            );
            console.log('[ok] chat_sessions heartbeat columns added');
        }

        // 3. chat_messages idx_session_id
        if (await hasIndex('chat_messages', 'idx_session_id')) {
            console.log('[skip] chat_messages.idx_session_id already exists');
        } else {
            await query(`ALTER TABLE chat_messages ADD INDEX idx_session_id (session_id, id)`);
            console.log('[ok] chat_messages.idx_session_id added');
        }

        // Verify
        const c1 = await hasColumn('chat_messages', 'client_msg_id');
        const c2 = await hasColumn('chat_sessions', 'last_visitor_heartbeat_at');
        const c3 = await hasColumn('chat_sessions', 'last_owner_heartbeat_at');
        const i1 = await hasIndex('chat_messages', 'uq_client_msg_id');
        const i2 = await hasIndex('chat_messages', 'idx_session_id');
        console.log('\n[verify]');
        console.log('  chat_messages.client_msg_id          :', c1 ? 'OK' : 'MISSING');
        console.log('  chat_messages.uq_client_msg_id       :', i1 ? 'OK' : 'MISSING');
        console.log('  chat_messages.idx_session_id         :', i2 ? 'OK' : 'MISSING');
        console.log('  chat_sessions.last_visitor_heartbeat :', c2 ? 'OK' : 'MISSING');
        console.log('  chat_sessions.last_owner_heartbeat   :', c3 ? 'OK' : 'MISSING');

        if (c1 && c2 && c3 && i1 && i2) {
            console.log('\n[done] DO-Ready migration applied successfully');
        } else {
            console.log('\n[warn] some objects missing');
            process.exitCode = 1;
        }
    } catch (err) {
        console.error('[error]', err.code || '', err.message);
        if (err.sqlMessage) console.error('[sql]', err.sqlMessage);
        process.exitCode = 1;
    } finally {
        await close();
    }
})();
