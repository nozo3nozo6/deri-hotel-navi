// ==========================================================================
// db-local.js — ローカルからSSHトンネル経由でMySQL接続するヘルパー
// Usage:
//   1. ターミナルでSSHトンネル起動: ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6051.wpx.ne.jp -N
//   2. スクリプト実行: node generate-sitemap.js 等
// ==========================================================================
require('dotenv').config();
const mysql = require('mysql2/promise');

let _pool = null;

async function getPool() {
    if (_pool) return _pool;
    _pool = mysql.createPool({
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '3307'),  // SSHトンネルのローカルポート
        database: process.env.DB_NAME || 'yobuho_db',
        user: process.env.DB_USER || 'yobuho_user',
        password: process.env.DB_PASS || '',
        charset: 'utf8mb4',
        waitForConnections: true,
        connectionLimit: 5,
    });
    return _pool;
}

async function query(sql, params) {
    const pool = await getPool();
    const [rows] = await pool.execute(sql, params);
    return rows;
}

async function close() {
    if (_pool) { await _pool.end(); _pool = null; }
}

module.exports = { getPool, query, close };
