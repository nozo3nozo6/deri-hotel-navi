/**
 * add-kana-to-hotels.js
 * 英語のみのホテル名にカタカナ読みを追加するスクリプト
 *
 * Usage:
 *   1. SSHトンネル起動: ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6825.wpx.ne.jp -N
 *   2. node scripts/add-kana-to-hotels.js          → プレビュー（DB変更なし）
 *   3. node scripts/add-kana-to-hotels.js --apply   → DB更新実行
 */
require('dotenv').config();
const db = require('../db-local');
const Anthropic = require('@anthropic-ai/sdk').default;

const BATCH_SIZE = 50; // Claude APIに一度に送るホテル数
const DRY_RUN = !process.argv.includes('--apply');

async function main() {
    const client = new Anthropic();
    const pool = await db.query('SELECT 1'); // 接続テスト

    // 英語のみのホテル名を取得
    const rows = await db.query(`
        SELECT id, name FROM hotels
        WHERE name NOT REGEXP '[ぁ-んァ-ヶ亜-熙々〇]'
        AND name REGEXP '[a-zA-Z]'
        ORDER BY id
    `);
    console.log(`対象: ${rows.length}件`);
    if (DRY_RUN) console.log('--- プレビューモード（--apply で実行） ---\n');

    const results = [];

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const hotelList = batch.map(h => `${h.id}: ${h.name}`).join('\n');

        console.log(`[${i + 1}-${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}] Claude APIに送信中...`);

        const response = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            messages: [{
                role: 'user',
                content: `以下はホテル名のリストです。各ホテル名にカタカナ読みを括弧で追加してください。

ルール:
- 出力形式: ID: 新しいホテル名
- 英語部分をカタカナに変換して括弧（）で追加
- 既に括弧付きの場合はそのまま（変更不要なら "SKIP" と書く）
- 数字はそのまま残す
- 固有名詞は音をそのままカタカナに
- "HOTEL" → "ホテル", "RESORT" → "リゾート" 等、一般的な訳語を使用
- &#39; は ' に修正
- 例: "HOTEL IVY" → "HOTEL IVY (ホテル アイヴィー)"
- 例: "MALIBU HOTEL" → "MALIBU HOTEL (マリブ ホテル)"
- 例: "THE KNOT SAPPORO" → "THE KNOT SAPPORO (ザ ノット サッポロ)"

${hotelList}`
            }]
        });

        const text = response.content[0].text;
        const lines = text.split('\n').filter(l => l.trim());

        for (const line of lines) {
            const match = line.match(/^(\d+):\s*(.+)$/);
            if (!match) continue;
            const id = parseInt(match[1]);
            const newName = match[2].trim();
            if (newName === 'SKIP') continue;
            const original = batch.find(h => h.id === id);
            if (!original) continue;
            if (newName === original.name) continue;
            results.push({ id, oldName: original.name, newName });
        }

        // レート制限対策
        if (i + BATCH_SIZE < rows.length) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    console.log(`\n変換結果: ${results.length}件\n`);

    // プレビュー表示
    for (const r of results) {
        console.log(`[${r.id}] ${r.oldName}`);
        console.log(`    → ${r.newName}`);
    }

    if (DRY_RUN) {
        console.log(`\n--- プレビュー完了。"node scripts/add-kana-to-hotels.js --apply" で実行 ---`);
    } else {
        console.log(`\nDB更新中...`);
        let updated = 0;
        for (const r of results) {
            await db.query('UPDATE hotels SET name = ?, updated_at = NOW() WHERE id = ?', [r.newName, r.id]);
            updated++;
        }
        console.log(`${updated}件更新完了`);
    }

    await db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
