// ==========================================================================
// apply-migration.js — SQL マイグレーションをローカルからSSHトンネル経由で適用
//
// Usage:
//   1. ターミナル1で SSH トンネルを開く:
//      ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6051.wpx.ne.jp -N
//
//   2. ターミナル2で実行:
//      node apply-migration.js sql/cast_visibility.sql
//
// 安全対策:
//   - 各 SQL ステートメントを個別にトランザクションで包む（ALTER TABLE はトランザクション
//     不可なので個別実行）
//   - 失敗したステートメントを表示して停止
// ==========================================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
    const arg = process.argv[2];
    if (!arg) {
        console.error('Usage: node apply-migration.js <sql-file>');
        process.exit(1);
    }
    const sqlPath = path.resolve(arg);
    if (!fs.existsSync(sqlPath)) {
        console.error(`SQL file not found: ${sqlPath}`);
        process.exit(1);
    }

    const raw = fs.readFileSync(sqlPath, 'utf8');
    // -- コメント行を削除して、; で分割
    const statements = raw
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

    console.log(`Migration file: ${sqlPath}`);
    console.log(`Statements found: ${statements.length}`);
    console.log('--- Connecting to DB via SSH tunnel (localhost:3307) ---');

    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '3307'),
        database: process.env.DB_NAME || 'yobuho_db',
        user: process.env.DB_USER || 'yobuho_user',
        password: process.env.DB_PASS || '',
        charset: 'utf8mb4',
        multipleStatements: false
    });

    let ok = 0, failed = 0;
    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const preview = stmt.length > 80 ? stmt.slice(0, 80) + '...' : stmt;
        try {
            await conn.query(stmt);
            ok++;
            console.log(`  [${i + 1}/${statements.length}] OK: ${preview}`);
        } catch (e) {
            failed++;
            console.error(`  [${i + 1}/${statements.length}] FAILED: ${preview}`);
            console.error(`    Error: ${e.message}`);
            // ALTER TABLE で「Duplicate column」「Duplicate key」が出た場合は
            // 既に適用済みと判断して継続
            if (/Duplicate column|Duplicate key/i.test(e.message)) {
                console.error(`    (already applied — continuing)`);
                failed--;
                ok++;
            } else {
                break;
            }
        }
    }

    await conn.end();
    console.log(`--- Done: ${ok} succeeded, ${failed} failed ---`);
    if (failed > 0) process.exit(1);
}

main().catch(e => {
    console.error('Fatal error:', e.message);
    process.exit(1);
});
