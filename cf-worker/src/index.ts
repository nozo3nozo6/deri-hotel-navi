// =========================================================
// Worker Router (entrypoint)
// - chat.yobuho.com への全リクエストを受ける
// - shop_slug / shop_id から DO instance を idFromName で取得
// - shop メタ情報 (yobuho.com の PHP から取得) を X-Shop-Meta で DO に伝搬
// - /can-connect プリゲートは DO を経由せず Router で即判定可能
// - WebSocket upgrade は DO の /ws に転送
// =========================================================

import type { Env, ShopStatus, CanConnectResult } from './types';
import { corsHeaders, corsPreflight, jsonResponse } from './cors';
import { safeEqual, isContentLengthOk, isUuidLike } from './auth';

export { ChatRoom } from './ChatRoom';

// shop メタキャッシュ (Worker isolate 内のメモリ)
// 同じ isolate が継続する限り TTL までは PHP に再問合せしない
const SHOP_META_TTL_MS = 60_000; // 60s
const metaCache = new Map<string, { expires: number; meta: ShopStatus }>();

export default {
  // 2026-05-16: 受付時間外で保留されたメール通知を 10 分ごとに flush.
  // wrangler.toml の [triggers] crons = ["*/10 * * * *"] と連動.
  // 認証: X-Sync-Secret (PHP 側 chat-flush-pending.php と共有).
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const url = `${env.NOTIFY_BASE_URL}/api/chat-flush-pending.php`;
    ctx.waitUntil(
      fetch(url, {
        method: 'POST',
        headers: {
          'X-Sync-Secret': env.CHAT_SYNC_SECRET || '',
          'Content-Type': 'application/json',
        },
      }).then(async (res) => {
        if (!res.ok) {
          console.warn(`chat-flush-pending returned ${res.status}: ${await res.text().catch(() => '')}`);
        }
      }).catch((e) => {
        console.error('chat-flush-pending failed', e);
      })
    );
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      return corsPreflight(req, env);
    }

    const url = new URL(req.url);
    const path = url.pathname;

    // Health check
    if (path === '/' || path === '/health') {
      return jsonResponse({ ok: true, service: 'yobuchat-do' }, req, env);
    }

    // 全パス共通: Content-Length 上限ガード (DoS 対策).
    // WebSocket upgrade は GET なので body を持たず、自然にスキップされる.
    if (req.method === 'POST' && !isContentLengthOk(req)) {
      return jsonResponse({ ok: false, error: 'payload_too_large' }, req, env, 413);
    }

    // shop_slug or shop_id を特定
    const slug = url.searchParams.get('shop_slug') || url.searchParams.get('slug') || '';
    const shopIdParam = url.searchParams.get('shop_id') || '';
    const key = slug || shopIdParam;
    if (!key) {
      return jsonResponse({ ok: false, error: 'missing_shop' }, req, env, 400);
    }

    // /broadcast・/broadcast-read・/broadcast-typing: PHP→DO リレー. shop_meta 不要のため shop-lookup を短絡.
    // shop_id 前提 (PHP 側が session から解決して渡す) でメタ取得をスキップ.
    //
    // セキュリティ (2026-04-29):
    //  - secret 検証を idFromName より前に実施 → 任意キーで DO instance を spawn する
    //    DoS amplification を防ぐ.
    //  - shop_id は UUID 形式のみ受理 → /broadcast?shop_id=ランダム文字列 で
    //    DO instance を無限作成されるのを防ぐ.
    //  - 比較は timing-safe.
    if (path === '/broadcast' || path === '/broadcast-read' || path === '/broadcast-typing') {
      const provided = req.headers.get('X-Sync-Secret') || '';
      const expected = env.CHAT_SYNC_SECRET || '';
      if (!safeEqual(provided, expected)) {
        return jsonResponse({ ok: false, error: 'forbidden' }, req, env, 403);
      }
      if (!shopIdParam || !isUuidLike(shopIdParam)) {
        return jsonResponse({ ok: false, error: 'invalid_shop_id' }, req, env, 400);
      }
      const id = env.CHAT_ROOM.idFromName(shopIdParam);
      const stub = env.CHAT_ROOM.get(id);
      const forward = new Request(req, { headers: new Headers(req.headers) });
      forward.headers.set('X-Shop-Id', shopIdParam);
      const res = await stub.fetch(forward);
      const h = new Headers(res.headers);
      const cors = corsHeaders(req, env);
      for (const [k, v] of Object.entries(cors)) h.set(k, v);
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: h,
      });
    }

    // shop メタ取得
    let meta: ShopStatus | null;
    try {
      meta = await fetchShopMeta(key, !!slug, env);
    } catch (e) {
      console.error('fetchShopMeta failed', e);
      return jsonResponse({ ok: false, error: 'shop_lookup_failed' }, req, env, 502);
    }
    if (!meta) {
      return jsonResponse({ ok: false, error: 'not_found' }, req, env, 404);
    }

    // /can-connect: DO を経由せず Router 側で判定 (軽量)
    if (path === '/can-connect') {
      const res = buildCanConnect(meta);
      return jsonResponse(res, req, env);
    }

    // 他は DO に転送
    const id = env.CHAT_ROOM.idFromName(meta.shop_id);
    const stub = env.CHAT_ROOM.get(id);

    // DO に渡すヘッダーを追加
    const forward = new Request(req, {
      headers: new Headers(req.headers),
    });
    forward.headers.set('X-Shop-Id', meta.shop_id);
    forward.headers.set('X-Shop-Slug', meta.slug);
    forward.headers.set('X-Shop-Meta', JSON.stringify(meta));

    const res = await stub.fetch(forward);

    // DO レスポンスに CORS ヘッダー付与
    const h = new Headers(res.headers);
    const cors = corsHeaders(req, env);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: h,
      // WebSocket の場合は webSocket を継承
      webSocket: (res as any).webSocket,
    } as ResponseInit & { webSocket?: WebSocket });
  },
};

// ========== Shop meta fetch ==========
// yobuho.com/api/chat-shop-lookup.php から shop メタを取得
// 認証: X-Sync-Secret (wrangler secret put MYSQL_SYNC_SECRET)
async function fetchShopMeta(key: string, isSlug: boolean, env: Env): Promise<ShopStatus | null> {
  const cacheKey = `${isSlug ? 'slug:' : 'id:'}${key}`;
  const cached = metaCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.meta;
  }

  const qs = isSlug ? `slug=${encodeURIComponent(key)}` : `shop_id=${encodeURIComponent(key)}`;
  const url = `${env.NOTIFY_BASE_URL}/api/chat-shop-lookup.php?${qs}`;
  const res = await fetch(url, {
    headers: {
      'X-Sync-Secret': env.CHAT_SYNC_SECRET || '',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`shop-lookup returned ${res.status}`);

  const meta = (await res.json()) as ShopStatus;
  // 正規化: id を必ず shop_id へ
  if ((meta as any).id && !meta.shop_id) {
    meta.shop_id = (meta as any).id;
  }

  metaCache.set(cacheKey, { expires: Date.now() + SHOP_META_TTL_MS, meta });
  return meta;
}

// ========== can-connect 判定 ==========
function buildCanConnect(meta: ShopStatus): CanConnectResult {
  // 受付時間チェック (Asia/Tokyo)
  const hoursOk = isWithinReceptionHours(meta.reception_start, meta.reception_end);
  if (!hoursOk) {
    return {
      ok: false,
      reason: 'outside_hours',
      next_reception_start: meta.reception_start,
      shop_name: meta.shop_name,
      welcome_message: meta.welcome_message,
      reservation_hint: meta.reservation_hint,
      shop_online: false,
    };
  }

  return {
    ok: true,
    reason: 'ok',
    shop_name: meta.shop_name,
    welcome_message: meta.welcome_message,
    reservation_hint: meta.reservation_hint,
    shop_online: isShopOnline(meta),
  };
}

function isShopOnline(meta: ShopStatus): boolean {
  // A案 (厳格2値ルール): is_online フラグのみで判定。
  // 時間帯制御は受付時間で行うため auto_off_minutes は廃止。
  return !!meta.is_online;
}

function isWithinReceptionHours(start?: string, end?: string): boolean {
  if (!start || !end) return true; // 未設定なら24h扱い
  // Asia/Tokyo の HH:MM に変換
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const hh = parts.find((p) => p.type === 'hour')?.value || '00';
  const mm = parts.find((p) => p.type === 'minute')?.value || '00';
  const nowMin = parseInt(hh, 10) * 60 + parseInt(mm, 10);
  const [sh, sm] = start.split(':').map((x) => parseInt(x, 10));
  const [eh, em] = end.split(':').map((x) => parseInt(x, 10));
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  if (s === e) return true;
  if (s < e) return nowMin >= s && nowMin < e;
  // 日跨ぎ (例 22:00-03:00)
  return nowMin >= s || nowMin < e;
}
