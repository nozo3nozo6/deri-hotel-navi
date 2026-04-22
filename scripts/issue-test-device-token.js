// scripts/issue-test-device-token.js
// 立川秘密基地(dgqeiw1i)用のテスト用 device_token を発行してDBに登録
// Usage:
//   1. SSH tunnel: ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6051.wpx.ne.jp -N
//   2. node scripts/issue-test-device-token.js
const crypto = require('crypto');
const { query, close } = require('../db-local');

const SLUG = 'dgqeiw1i';
const DEVICE_NAME = 'テスト端末(Claude発行)';

(async () => {
    try {
        const shops = await query('SELECT id, shop_name FROM shops WHERE slug = ? LIMIT 1', [SLUG]);
        if (!shops.length) { console.error(`slug=${SLUG} not found`); process.exit(1); }
        const shop = shops[0];

        const token = crypto.randomBytes(48).toString('hex');
        await query(
            'INSERT INTO shop_chat_devices (shop_id, device_token, device_name) VALUES (?, ?, ?)',
            [shop.id, token, DEVICE_NAME]
        );

        console.log('=== device_token issued ===');
        console.log(`Shop:   ${shop.shop_name} (${SLUG})`);
        console.log(`Token:  ${token}`);
        console.log('');
        console.log('=== ブラウザでのセットアップ手順 ===');
        console.log('1. 以下のURLを開く:');
        console.log('   https://yobuho.com/chat.html?slug=' + SLUG);
        console.log('2. DevTools (F12) → Console で以下を実行:');
        console.log(`   localStorage.setItem('chat_owner_token', '${token}')`);
        console.log('3. ページをリロード → オーナーモードUIが表示されます');
        console.log('');
        console.log('※ テスト後はDBからレコード削除を推奨:');
        console.log(`   DELETE FROM shop_chat_devices WHERE device_token = '${token}';`);
    } catch (e) {
        console.error('[error]', e.message);
        process.exitCode = 1;
    } finally {
        await close();
    }
})();
