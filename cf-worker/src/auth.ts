// =========================================================
// Auth / validation helpers (security 2026-04-29 hardening)
// - timing-safe secret 比較
// - WebSocket Origin allowlist
// - owner device_token 検証 (PHP verify-device に問合せ)
// - Web Push endpoint host allowlist (SSRF 対策)
// - 入力バリデーション ヘルパー
// =========================================================

import type { Env } from './types';

// ---------- timing-safe ----------

/**
 * 文字列の timing-safe 比較.
 * 早期 return しないため secret 推測攻撃に強い.
 * 異なる長さは即 false (長さは秘密ではない前提).
 */
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ---------- Origin allowlist ----------

export function allowedOriginsList(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isOriginAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  return allowedOriginsList(env).includes(origin);
}

// ---------- Web Push endpoint allowlist ----------

// 公式 Push Service ホスト. これ以外への fetch は SSRF 防止のため拒否する.
const PUSH_HOST_ALLOWLIST: ReadonlyArray<RegExp> = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^updates-autopush\.stage\.mozaws\.net$/,
  /\.push\.apple\.com$/,             // *.push.apple.com (web.push.apple.com 等)
  /\.notify\.windows\.com$/,         // *.notify.windows.com (WNS / Edge)
  /\.windows\.com$/,                 // wns2-*.notify.windows.com
];

export function isAllowedPushEndpoint(rawUrl: string): boolean {
  let host: string;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return PUSH_HOST_ALLOWLIST.some((re) => re.test(host));
}

// ---------- Content-Length guard ----------

const MAX_REQUEST_BODY_BYTES = 64 * 1024; // 64 KB. 通常 chat msg は 500 char + meta で十分.

/**
 * Content-Length が大きすぎる JSON リクエストを拒否.
 * 攻撃者が DO の CPU/メモリを消費するのを防ぐ.
 * Content-Length 未指定 (chunked など) は通すが、req.json() が後段で例外を投げる.
 */
export function isContentLengthOk(req: Request): boolean {
  const cl = req.headers.get('content-length');
  if (!cl) return true; // 未指定は通す (受信中に DO 側で 例外 catch される)
  const n = parseInt(cl, 10);
  if (!Number.isFinite(n)) return false;
  return n <= MAX_REQUEST_BODY_BYTES;
}

// ---------- 入力バリデーション ----------

/** 文字列 + 長さ上限. 不正なら null. */
export function asString(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  if (v.length > maxLen) return null;
  return v;
}

/** 必須文字列. 空なら null. */
export function asNonEmpty(v: unknown, maxLen: number): string | null {
  const s = asString(v, maxLen);
  if (!s || !s.length) return null;
  return s;
}

/** allowlist のいずれか. */
export function asEnum<T extends string>(v: unknown, allowed: ReadonlyArray<T>): T | null {
  if (typeof v !== 'string') return null;
  return (allowed as ReadonlyArray<string>).includes(v) ? (v as T) : null;
}

/** UUID v4 風 (ハイフン入り 36文字 / 32 hex). */
export function isUuidLike(v: string): boolean {
  return /^[0-9a-fA-F-]{32,36}$/.test(v);
}

// ---------- Owner device_token 検証 ----------

// device 検証結果のメモリキャッシュ (DO instance 単位).
// PHP 往復のレイテンシ削減. 60s で expire.
const DEVICE_VERIFY_TTL_MS = 60_000;
const deviceVerifyCache = new Map<string, { expires: number; ok: boolean }>();

/**
 * device_token が PHP 側 shop_chat_devices に有効登録されており、
 * かつ指定 shopId に紐づくかを検証.
 * 失敗時 false (= 接続/操作拒否).
 *
 * 60s メモリキャッシュ. token revoke は最悪 60s 遅延で反映.
 */
export async function verifyOwnerDevice(
  env: Env,
  shopId: string,
  deviceToken: string
): Promise<boolean> {
  if (!shopId || !deviceToken) return false;
  // device_token の形式: bin2hex(random_bytes(48)) = 96 hex.
  // これ以外は PHP に投げる前に reject (無駄クエリ削減 + DoS 軽減).
  if (!/^[a-f0-9]{32,128}$/.test(deviceToken)) return false;

  const cacheKey = `${shopId}:${deviceToken}`;
  const cached = deviceVerifyCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.ok;
  }

  const base = env.NOTIFY_BASE_URL || 'https://yobuho.com';
  const secret = env.CHAT_SYNC_SECRET || '';
  if (!secret) return false;

  let ok = false;
  try {
    const res = await fetch(`${base}/api/chat-api.php?action=verify-device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Secret': secret,
      },
      body: JSON.stringify({ shop_id: shopId, device_token: deviceToken }),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as any;
      ok = !!(data && data.ok && data.valid);
    }
  } catch (_) {
    ok = false;
  }

  deviceVerifyCache.set(cacheKey, { expires: Date.now() + DEVICE_VERIFY_TTL_MS, ok });
  return ok;
}

/**
 * キャッシュを明示的に invalidate.
 * 将来 owner-logout 経路で呼ぶ.
 */
export function invalidateDeviceCache(shopId: string, deviceToken: string): void {
  deviceVerifyCache.delete(`${shopId}:${deviceToken}`);
}
