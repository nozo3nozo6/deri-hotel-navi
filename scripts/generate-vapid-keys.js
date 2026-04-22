// ==========================================================================
// scripts/generate-vapid-keys.js
// Web Push 用 VAPID keypair 生成 (ECDSA P-256)
// Usage: node scripts/generate-vapid-keys.js
// Output: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY を base64url 形式で出力
//   これらを GitHub Secrets に登録する。
//   公開鍵はデプロイ時に api/vapid-config.php / chat.js に配布、
//   秘密鍵は CF Worker に wrangler secret で登録。
// ==========================================================================
const crypto = require('crypto');

function b64urlFromBuf(buf) {
    return Buffer.from(buf)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function b64urlToBuf(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return Buffer.from(s, 'base64');
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
});

const pubJwk = publicKey.export({ format: 'jwk' });
const privJwk = privateKey.export({ format: 'jwk' });

const x = b64urlToBuf(pubJwk.x);
const y = b64urlToBuf(pubJwk.y);
if (x.length !== 32 || y.length !== 32) {
    console.error('ERROR: unexpected key component length', x.length, y.length);
    process.exit(1);
}

const pubRaw = Buffer.concat([Buffer.from([0x04]), x, y]);
const pubB64url = b64urlFromBuf(pubRaw);

const d = b64urlToBuf(privJwk.d);
if (d.length !== 32) {
    console.error('ERROR: unexpected private scalar length', d.length);
    process.exit(1);
}
const privB64url = b64urlFromBuf(d);

console.log('==============================================================');
console.log('VAPID keypair generated (ECDSA P-256)');
console.log('==============================================================');
console.log('');
console.log('# GitHub Secrets に追加:');
console.log('');
console.log('VAPID_PUBLIC_KEY=' + pubB64url);
console.log('');
console.log('VAPID_PRIVATE_KEY=' + privB64url);
console.log('');
console.log('VAPID_SUBJECT=mailto:hotel@yobuho.com');
console.log('');
console.log('# Cloudflare Worker に wrangler secret で登録:');
console.log('# wrangler secret put VAPID_PRIVATE_KEY  (値は上の VAPID_PRIVATE_KEY)');
console.log('# wrangler secret put VAPID_SUBJECT      (値は mailto:hotel@yobuho.com)');
console.log('');
console.log('# 検証:');
console.log('#   pub raw length = ' + pubRaw.length + ' bytes (must be 65)');
console.log('#   priv scalar    = ' + d.length + ' bytes (must be 32)');
console.log('#   pub b64url len = ' + pubB64url.length + ' chars');
console.log('#   priv b64url len= ' + privB64url.length + ' chars');
console.log('==============================================================');
