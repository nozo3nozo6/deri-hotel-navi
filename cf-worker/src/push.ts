// =========================================================
// Web Push sender (RFC 8030 + RFC 8291 + VAPID RFC 8292)
// - DO 内で呼ばれる: sendPushToSubject(env, subjectType, subjectId, payload)
// - VAPID: ES256 JWT を毎回構築し Authorization: vapid t=<jwt>, k=<pub>
// - 暗号化: aes128gcm (ephemeral ECDH + HKDF + AES-GCM)
// - 購読先が 404/410 を返したら PHP に unsubscribe を依頼 (chat-api.php)
// - 失敗は warn ログに留め, DO 本線を止めない
//
// 重要: このモジュールは WebCrypto のみで動作する (Workers nodejs_compat 不要).
//       Buffer/crypto 等の Node API は使わない.
// =========================================================

import type { Env } from './types';

export type PushSubjectType = 'shop' | 'cast' | 'visitor';

export interface PushSubscriber {
  endpoint: string;
  p256dh: string;   // base64url (65 bytes uncompressed point)
  auth: string;     // base64url (16 bytes)
  endpoint_hash: string; // sha256 hex (unsubscribe cleanup 用)
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;       // 通知クリック時に開くURL (絶対/相対どちらでも)
  tag?: string;      // 同 tag は上書き表示 (会話スレッドまとめ)
  icon?: string;
  badge?: string;
  renotify?: boolean;
}

// ========== entrypoint ==========

/**
 * 指定 subject の購読者全員に Web Push を送る.
 * 購読0件 / VAPID 未設定 / 失敗いずれも throw しない (通知は best-effort).
 */
export async function sendPushToSubject(
  env: Env,
  subjectType: PushSubjectType,
  subjectId: string,
  payload: PushPayload
): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    // VAPID 未設定: 何もしない (Day 9 の graceful degradation と一貫)
    return;
  }

  const subs = await fetchSubscribers(env, subjectType, subjectId);
  if (!subs.length) return;

  const body = new TextEncoder().encode(JSON.stringify(payload));

  // 並列送信. 1購読失敗しても他は止めない.
  await Promise.all(
    subs.map((s) => sendOne(env, s, body).catch((e) => {
      console.warn('[push] send failed', s.endpoint.slice(0, 60), e?.message || e);
    }))
  );
}

// ========== PHP から購読者を取得 ==========

async function fetchSubscribers(
  env: Env,
  subjectType: PushSubjectType,
  subjectId: string
): Promise<PushSubscriber[]> {
  const base = env.NOTIFY_BASE_URL || 'https://yobuho.com';
  const secret = env.CHAT_SYNC_SECRET || '';
  if (!secret) return [];

  try {
    const res = await fetch(`${base}/api/chat-api.php?action=fetch-push-subscribers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Secret': secret,
      },
      body: JSON.stringify({ subject_type: subjectType, subject_id: subjectId }),
    });
    if (!res.ok) {
      console.warn('[push] fetch-push-subscribers returned', res.status);
      return [];
    }
    const data = await res.json() as any;
    if (!data?.ok || !Array.isArray(data.subscribers)) return [];
    return data.subscribers as PushSubscriber[];
  } catch (e) {
    console.warn('[push] fetch-push-subscribers failed', e);
    return [];
  }
}

// ========== 購読エンドポイント1件に送信 ==========

async function sendOne(env: Env, sub: PushSubscriber, body: Uint8Array): Promise<void> {
  const uaPublic = b64urlToBytes(sub.p256dh);
  const authSecret = b64urlToBytes(sub.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new Error('invalid_p256dh');
  }
  if (authSecret.length !== 16) {
    throw new Error('invalid_auth');
  }

  // 1) ephemeral ECDH P-256 鍵ペアを生成
  const asKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  ) as CryptoKeyPair;
  const asPubJwk = await crypto.subtle.exportKey('jwk', asKeyPair.publicKey) as JsonWebKey;
  const asPublicRaw = jwkToUncompressed(asPubJwk);

  // 2) UA public を CryptoKey として import (ECDH で使う)
  const uaPubKey = await importP256Public(uaPublic);

  // 3) shared secret (ECDH)
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      // Workers types: $public ではなく public. 実行時は WebCrypto 標準仕様
      // (EcdhKeyDeriveParams { name, public: CryptoKey }) に従う.
      { name: 'ECDH', public: uaPubKey } as any,
      asKeyPair.privateKey,
      256
    )
  );

  // 4) RFC 8291 §3.3 の鍵導出
  //    PRK_key = HMAC(auth_secret, ecdh_secret)
  //    key_info = "WebPush: info\0" || ua_public || as_public
  //    IKM = HKDF-Expand(PRK_key, key_info, 32)
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const keyInfo = concatBytes(
    textBytes('WebPush: info\0'),
    uaPublic,
    asPublicRaw
  );
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  // 5) salt ランダム 16B, aes128gcm header 用 CEK/NONCE
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpand(prk, textBytes('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, textBytes('Content-Encoding: nonce\0'), 12);

  // 6) 暗号化 (AES-GCM). plaintext は末尾に 0x02 (last-record delimiter) を付ける
  const plaintext = concatBytes(body, new Uint8Array([0x02]));
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      cekKey,
      plaintext
    )
  );

  // 7) aes128gcm record header: salt(16) || rs(4, BE) || idlen(1) || keyid(65=as_public)
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + asPublicRaw.length);
  header.set(salt, 0);
  const dv = new DataView(header.buffer);
  dv.setUint32(16, rs, false);
  header[20] = asPublicRaw.length; // 65
  header.set(asPublicRaw, 21);
  const encryptedBody = concatBytes(header, ciphertext);

  // 8) VAPID JWT 署名
  const endpointUrl = new URL(sub.endpoint);
  const aud = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const jwt = await buildVapidJwt(env.VAPID_PRIVATE_KEY!, env.VAPID_SUBJECT!, aud);

  // 9) POST to push service
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Urgency': 'high',
    },
    body: encryptedBody,
  });

  if (res.status === 404 || res.status === 410) {
    // 購読失効 → PHP に削除依頼
    await unsubscribeRemote(env, sub.endpoint_hash).catch(() => {});
    return;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`push_send_${res.status}: ${text.slice(0, 200)}`);
  }
}

// ========== VAPID JWT (ES256) ==========

async function buildVapidJwt(privateKeyB64u: string, subject: string, aud: string): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud,
    exp: now + 12 * 60 * 60, // 12h (push service は 24h max 推奨)
    sub: subject,
  };
  const headerB64 = bytesToB64url(textBytes(JSON.stringify(header)));
  const claimsB64 = bytesToB64url(textBytes(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${claimsB64}`;

  const privateKey = await importP256Private(privateKeyB64u);
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      textBytes(signingInput)
    )
  );
  // WebCrypto の ECDSA sign は既に JWT/JWS が要求する raw R||S (64B) 形式を返す.
  return `${signingInput}.${bytesToB64url(sig)}`;
}

// ========== PHP に unsubscribe 依頼 ==========

async function unsubscribeRemote(env: Env, endpointHash: string): Promise<void> {
  const base = env.NOTIFY_BASE_URL || 'https://yobuho.com';
  const secret = env.CHAT_SYNC_SECRET || '';
  if (!secret) return;
  await fetch(`${base}/api/chat-api.php?action=push-unsubscribe-by-endpoint`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sync-Secret': secret,
    },
    body: JSON.stringify({ endpoint_hash: endpointHash }),
  });
}

// ========== Crypto helpers ==========

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// HKDF-Expand: length bytes を導出 (PRK から). RFC 5869 §2.3 一回分の T(1) 実装
// (32B 以下しか使わないため T(1) で十分).
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  if (length > 32) throw new Error('hkdf_expand_length_too_large');
  const input = concatBytes(info, new Uint8Array([0x01]));
  const t1 = await hmacSha256(prk, input);
  return t1.slice(0, length);
}

async function importP256Public(uncompressed65: Uint8Array): Promise<CryptoKey> {
  // JWK 形式で import (raw uncompressed は spki に包む必要がある)
  if (uncompressed65.length !== 65 || uncompressed65[0] !== 0x04) {
    throw new Error('invalid_p256_public');
  }
  const x = uncompressed65.slice(1, 33);
  const y = uncompressed65.slice(33, 65);
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToB64url(x),
      y: bytesToB64url(y),
      ext: true,
    },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
}

async function importP256Private(privateB64u: string): Promise<CryptoKey> {
  // VAPID private key = 32B scalar (d). WebCrypto は JWK に x,y も要求するため
  // secp256r1 の base point から G^d を計算... は重いので, PRIVATE に対応する public
  // (VAPID_PUBLIC_KEY) はあるが, ここでは JWK に d だけ入れて import する.
  // SubtleCrypto (Workers) は d のみでも import 可能 (ただし derive 用途時は x,y 必要).
  // ECDSA sign では d のみで動作する実装が多いが, 念のため x,y も追加するのが堅い.
  // → 代替: PKCS8 (DER) を組み立てる.
  const d = b64urlToBytes(privateB64u);
  if (d.length !== 32) throw new Error('invalid_p256_private');

  // PKCS#8 envelope for prime256v1 private key:
  //   SEQUENCE(
  //     INTEGER 0,
  //     AlgorithmIdentifier(1.2.840.10045.2.1, 1.2.840.10045.3.1.7),
  //     OCTET STRING { ECPrivateKey(1, OCTET STRING d) }
  //   )
  // 事前計算した固定バイト列に d (32B) を差し込む.
  // Ref: RFC 5208 + RFC 5915. 鍵長固定の SEC1 のみのサブセット (publicKey OPTIONAL 省略).
  const pkcs8 = buildPkcs8P256Private(d);
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

function buildPkcs8P256Private(d: Uint8Array): Uint8Array {
  // RFC 5208 PrivateKeyInfo:
  //   SEQUENCE {
  //     version INTEGER (0),
  //     privateKeyAlgorithm AlgorithmIdentifier,
  //     privateKey OCTET STRING (ECPrivateKey DER)
  //   }
  //
  // Algorithm: id-ecPublicKey + namedCurve prime256v1
  //   SEQUENCE { OID 1.2.840.10045.2.1, OID 1.2.840.10045.3.1.7 }
  //
  // ECPrivateKey (RFC 5915):
  //   SEQUENCE {
  //     version INTEGER (1),
  //     privateKey OCTET STRING (d, 32B),
  //     parameters [0] EXPLICIT NULL (省略可)
  //   }
  if (d.length !== 32) throw new Error('d_must_be_32');

  // ECPrivateKey inner
  // 30 len 02 01 01 04 20 <d_32>
  const ecPriv = concatBytes(
    bytes('30 22 02 01 01 04 20'),
    d
  );
  // outer PrivateKeyInfo
  // 30 len 02 01 00  30 13 06 07 2A 86 48 CE 3D 02 01 06 08 2A 86 48 CE 3D 03 01 07  04 len_octet <ecPriv>
  const algId = bytes('30 13 06 07 2A 86 48 CE 3D 02 01 06 08 2A 86 48 CE 3D 03 01 07');
  const ecPrivOctet = concatBytes(new Uint8Array([0x04, ecPriv.length]), ecPriv);
  const inner = concatBytes(
    new Uint8Array([0x02, 0x01, 0x00]), // version
    algId,
    ecPrivOctet
  );
  return concatBytes(new Uint8Array([0x30, inner.length]), inner);
}

function jwkToUncompressed(jwk: JsonWebKey): Uint8Array {
  const x = b64urlToBytes(jwk.x || '');
  const y = b64urlToBytes(jwk.y || '');
  if (x.length !== 32 || y.length !== 32) throw new Error('invalid_jwk_xy');
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(x, 1);
  out.set(y, 33);
  return out;
}

// ========== byte / base64url helpers ==========

function textBytes(s: string): Uint8Array { return new TextEncoder().encode(s); }

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

function bytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function b64urlToBytes(s: string): Uint8Array {
  if (!s) return new Uint8Array(0);
  const pad = '===='.slice((s.length + 3) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(a: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
