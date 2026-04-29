// =========================================================
// ChatRoom Durable Object
// - 1 DO instance = 1 shop (shop_id で idFromName)
// - WebSocket Hibernation: idle中は課金ゼロ
// - セッション/メッセージ/冪等化/既読 を SQLite-backed storage で管理
// - 新着msg時にWS broadcast + email通知 (NotificationRouter)
// =========================================================

import type {
  Env,
  ChatMessage,
  ChatSession,
  BatchResponse,
  ShopStatus,
  SenderType,
  WsAttachment,
  WsRole,
} from './types';
import { buildDefaultRouter } from './notify';
import { MysqlSync } from './sync';
import { sendPushToSubject, type PushPayload } from './push';
import {
  safeEqual,
  isOriginAllowed,
  verifyOwnerDevice,
  asString,
  asNonEmpty,
  asEnum,
} from './auth';

const HEARTBEAT_INTERVAL_MS = 30_000;        // 30s
const ALARM_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h retention sweep
const SESSION_RETENTION_DAYS = 30;

const router = buildDefaultRouter();

export class ChatRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private shopMeta: ShopStatus | null = null;
  private sync: MysqlSync;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.sync = new MysqlSync(env);

    // DO起動時に Hibernation から復帰した WebSocket を再取得
    // (自動的に state.getWebSockets() で取れる、特別な初期化は不要)
  }

  // ========== HTTP entry ==========

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Router 側でパース済みの shop_id ヘッダー
    const shopId = req.headers.get('X-Shop-Id');
    const shopSlug = req.headers.get('X-Shop-Slug');

    // shopMeta を毎リクエストで更新 (X-Shop-Meta は Worker Router 側で 60s キャッシュ済み).
    // ここで `initialized` ガードをかけると DO インスタンスが生き続ける間、shop-admin で
    // notify_mode / reception 時間 / notify_email 等を変えても DO が古い値を持ち続けて
    // 「every に変えたのに 2通目からメール来ない」等の事故になるため、毎回上書きする。
    // /broadcast・/broadcast-read・/broadcast-typing は shopMeta 不要のためスキップ (PHP→DO 高頻度パス).
    if (path !== '/broadcast' && path !== '/broadcast-read' && path !== '/broadcast-typing') {
      await this.loadShopMeta(req);
    }

    // WebSocket upgrade
    if (path === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      return this.handleWsUpgrade(req);
    }

    // HTTP: start-session / send-message / owner-reply / can-connect など
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({})) as any;
      if (!body || typeof body !== 'object') {
        return this.errJson('invalid_body', 400);
      }

      // ===== owner / 状態変更系エンドポイントの認証 (CRITICAL 2026-04-29) =====
      // /owner/reply, /owner/inbox, /owner/mark-read, /session/close は店舗オーナー専用.
      // device_token 必須化 + PHP verify-device で都度検証.
      // 旧実装では認証ゼロで誰でも /owner/reply で偽返信ができた.
      if (
        path === '/owner/reply' ||
        path === '/owner/inbox' ||
        path === '/owner/mark-read' ||
        path === '/session/close'
      ) {
        const auth = await this.requireOwnerAuth(req, body);
        if (!auth.ok) return this.errJson(auth.error || 'forbidden', auth.status || 401);
      }

      switch (path) {
        case '/session/start':     return this.httpStartSession(body);
        case '/session/send':      return this.httpSendMessage(body);
        case '/session/close':     return this.httpCloseSession(body);
        case '/owner/reply':       return this.httpOwnerReply(body);
        case '/owner/inbox':       return this.httpOwnerInbox(body);
        case '/owner/mark-read':   return this.httpOwnerMarkRead(body);
        case '/visitor/mark-read': return this.httpVisitorMarkRead(body);
        case '/admin/purge':       return this.httpAdminPurge(req, body);
        case '/broadcast':         return this.httpBroadcast(req, body);
        case '/broadcast-read':    return this.httpBroadcastRead(req, body);
        case '/broadcast-typing':  return this.httpBroadcastTyping(req, body);
      }
    }

    return new Response('not found', { status: 404 });
  }

  /**
   * Owner 系 HTTP エンドポイントの認証.
   * - X-Shop-Id ヘッダ (Worker Router 側で X-Shop-Meta から付与済み) と
   *   body.device_token / Authorization: Bearer <device_token> を組合わせて
   *   PHP verify-device で都度検証.
   * - 60s メモリキャッシュ (auth.ts).
   * - PHP 経由 (X-Sync-Secret 持ち) のリクエストは内部信頼チャネルとしてバイパス可
   *   (今は使われていないが将来 PHP→DO で owner 系を呼ぶ場合の互換).
   */
  private async requireOwnerAuth(
    req: Request,
    body: any
  ): Promise<{ ok: true } | { ok: false; error?: string; status?: number }> {
    // PHP 内部チャネル (X-Sync-Secret 一致) は信頼.
    const sync = req.headers.get('X-Sync-Secret') || '';
    const expected = this.env.CHAT_SYNC_SECRET || '';
    if (expected && safeEqual(sync, expected)) {
      return { ok: true };
    }

    const shopId = req.headers.get('X-Shop-Id') || '';
    if (!shopId) return { ok: false, error: 'shop_unknown', status: 401 };

    // device_token は Authorization: Bearer か body.device_token のどちらか.
    let deviceToken = '';
    const authHeader = req.headers.get('Authorization') || '';
    const m = /^Bearer\s+([A-Za-z0-9._\-]+)$/i.exec(authHeader);
    if (m) deviceToken = m[1];
    if (!deviceToken && body && typeof body.device_token === 'string') {
      deviceToken = body.device_token;
    }
    if (!deviceToken) return { ok: false, error: 'unauthenticated', status: 401 };

    const ok = await verifyOwnerDevice(this.env, shopId, deviceToken);
    if (!ok) return { ok: false, error: 'forbidden', status: 403 };
    return { ok: true };
  }

  // ========== Shop meta ==========

  private async loadShopMeta(req: Request): Promise<void> {
    // Router が POST body or 独自ヘッダーで shopMeta を渡す
    // Router 側で shop情報をMySQL/PHPから取得し、DO に渡す
    const cached = await this.state.storage.get<ShopStatus>('shop_meta');
    if (cached) {
      this.shopMeta = cached;
    }
    const metaHeader = req.headers.get('X-Shop-Meta');
    if (metaHeader) {
      try {
        const fresh = JSON.parse(metaHeader) as ShopStatus;
        this.shopMeta = fresh;
        await this.state.storage.put('shop_meta', fresh);
      } catch (_) {}
    }
  }

  // ========== Counters ==========

  private async nextSessionId(): Promise<number> {
    const cur = (await this.state.storage.get<number>('session_counter')) || 0;
    const next = cur + 1;
    await this.state.storage.put('session_counter', next);
    return next;
  }

  private async nextMessageId(sessionId: number): Promise<number> {
    const key = `msg_counter:${sessionId}`;
    const cur = (await this.state.storage.get<number>(key)) || 0;
    const next = cur + 1;
    await this.state.storage.put(key, next);
    return next;
  }

  // ========== Session CRUD ==========

  private async findSessionByToken(token: string): Promise<ChatSession | null> {
    const id = await this.state.storage.get<number>(`session_by_token:${token}`);
    if (!id) return null;
    return (await this.state.storage.get<ChatSession>(`session:${id}`)) || null;
  }

  private async getSession(id: number): Promise<ChatSession | null> {
    return (await this.state.storage.get<ChatSession>(`session:${id}`)) || null;
  }

  private async saveSession(s: ChatSession): Promise<void> {
    await this.state.storage.put(`session:${s.id}`, s);
    await this.state.storage.put(`session_by_token:${s.session_token}`, s.id);
    // MySQL ミラー (shop_id 必要). waitUntil で fire-and-forget
    if (this.shopMeta?.shop_id) {
      this.state.waitUntil(this.sync.upsertSession(this.shopMeta.shop_id, s));
    }
  }

  /**
   * /broadcast 到達時に DO storage にセッションが無い場合、最小限の stub を作って返す.
   * PHP 側 (MySQL) が権威なので blocked / started_at 等は触らず、あくまで message 保存用の入れ物.
   * 既に存在する場合はそのまま返す.
   */
  private async ensureSessionStub(token: string, row: any): Promise<ChatSession> {
    const existing = await this.findSessionByToken(token);
    if (existing) return existing;
    const id = await this.nextSessionId();
    const now = String(row?.sent_at || new Date().toISOString());
    const stub: ChatSession = {
      id,
      session_token: token,
      visitor_hash: '',
      nickname: '',
      lang: '',
      started_at: now,
      last_activity_at: now,
      status: 'open',
      source: 'standalone',
      blocked: false,
    };
    // MySQL 側を壊さないため sync.upsertSession は呼ばない → storage put のみ.
    await this.state.storage.put(`session:${id}`, stub);
    await this.state.storage.put(`session_by_token:${token}`, id);
    return stub;
  }

  /**
   * リロード時の空白バグ対策:
   * DO storage に session が無い (hibernate退避後 / 再デプロイ後 / 古い MySQL-only セッション) 状態で
   * client が既存 token を持って戻ってきた時、PHP 経由で MySQL の履歴を取り寄せて
   * DO storage に書き戻す. 併せて msg_counter を MySQL 最大 id まで引き上げ,
   * 以降 DO が発行する id が MySQL id と衝突しないようにする.
   *
   * 冪等: 既に DO storage に同じ id が入っていればスキップ (read_at 保持).
   * 失敗: ネットワークエラー等は warn のみで握り潰し, 空の storage で継続.
   */
  private async backfillFromMysql(sess: ChatSession): Promise<void> {
    const hist = await this.sync.fetchHistory(sess.session_token);
    if (!hist || !hist.messages || !hist.messages.length) {
      // MySQL 側にも履歴が無い → 何もしない (普通の新規同等)
      if (hist?.session) {
        // セッション自体のメタデータは反映 (nickname/status 等)
        this.applyMysqlSessionMeta(sess, hist.session);
        await this.state.storage.put(`session:${sess.id}`, sess);
        await this.state.storage.put(`session_by_token:${sess.session_token}`, sess.id);
      }
      return;
    }

    let maxId = 0;
    for (const row of hist.messages) {
      const mid = Number(row.id || 0);
      if (mid <= 0) continue;
      const existing = await this.state.storage.get<ChatMessage>(`message:${sess.id}:${mid}`);
      const mirrored: ChatMessage = {
        id: mid,
        session_id: sess.id,
        sender_type: row.sender_type === 'shop' ? 'shop' : 'visitor',
        message: String(row.message || ''),
        client_msg_id: row.client_msg_id ? String(row.client_msg_id) : undefined,
        sent_at: String(row.sent_at || new Date().toISOString()),
        read_at: row.read_at || existing?.read_at || null,
      };
      await this.state.storage.put(`message:${sess.id}:${mid}`, mirrored);
      if (mirrored.client_msg_id) {
        await this.state.storage.put(`cmid:${sess.id}:${mirrored.client_msg_id}`, mid);
      }
      if (mid > maxId) maxId = mid;
      if (mirrored.sent_at > sess.last_activity_at) sess.last_activity_at = mirrored.sent_at;
      // 最新 visitor msg の nickname をセッションに反映
      if (row.sender_type === 'visitor' && row.nickname && !sess.nickname) {
        sess.nickname = String(row.nickname);
      }
    }

    // counter を MySQL 最大 id に合わせて以降の衝突を回避
    if (maxId > 0) {
      const curCounter = (await this.state.storage.get<number>(`msg_counter:${sess.id}`)) || 0;
      if (maxId > curCounter) {
        await this.state.storage.put(`msg_counter:${sess.id}`, maxId);
      }
    }

    // セッション側のメタ (status/blocked 等) も MySQL と合わせる
    if (hist.session) {
      this.applyMysqlSessionMeta(sess, hist.session);
    }
    await this.state.storage.put(`session:${sess.id}`, sess);
    await this.state.storage.put(`session_by_token:${sess.session_token}`, sess.id);
    // 二重 backfill 回避用マーカー. 以降の adopt ではスキップされる.
    await this.state.storage.put(`backfilled:${sess.id}`, new Date().toISOString());
  }

  private async hasBackfilled(sessionId: number): Promise<boolean> {
    const v = await this.state.storage.get(`backfilled:${sessionId}`);
    return !!v;
  }

  private applyMysqlSessionMeta(sess: ChatSession, meta: any): void {
    if (meta.nickname && !sess.nickname) sess.nickname = String(meta.nickname);
    if (meta.status === 'closed' && sess.status !== 'closed') {
      sess.status = 'closed';
      if (meta.closed_at) sess.closed_at = String(meta.closed_at);
    }
    if (meta.blocked) sess.blocked = true;
    if (meta.started_at && !sess.started_at) sess.started_at = String(meta.started_at);
    if (meta.last_activity_at && meta.last_activity_at > sess.last_activity_at) {
      sess.last_activity_at = String(meta.last_activity_at);
    }
  }

  // ========== Message CRUD ==========

  private async saveMessage(sessionId: number, m: ChatMessage): Promise<void> {
    await this.state.storage.put(`message:${sessionId}:${m.id}`, m);
    if (m.client_msg_id) {
      await this.state.storage.put(`cmid:${sessionId}:${m.client_msg_id}`, m.id);
    }
    // MySQL ミラー (session_token 必要)
    const sess = await this.getSession(sessionId);
    if (sess) {
      this.state.waitUntil(this.sync.upsertMessage(sess.session_token, m));
    }
  }

  private async messagesSince(sessionId: number, sinceId: number, limit = 1000): Promise<ChatMessage[]> {
    // storage.list の範囲指定は文字列辞書順なので数値 id では正しく並ばない
    // (例: "10" は "2" より lex 的に前). prefix で一括取得後に数値ソート & filter する.
    const prefix = `message:${sessionId}:`;
    const map = await this.state.storage.list<ChatMessage>({ prefix, limit });
    const msgs: ChatMessage[] = [];
    for (const m of map.values()) {
      if (m && typeof m.id === 'number' && m.id > sinceId) msgs.push(m);
    }
    msgs.sort((a, b) => a.id - b.id);
    return msgs;
  }

  private async messageByCmid(sessionId: number, cmid: string): Promise<ChatMessage | null> {
    const mid = await this.state.storage.get<number>(`cmid:${sessionId}:${cmid}`);
    if (!mid) return null;
    return (await this.state.storage.get<ChatMessage>(`message:${sessionId}:${mid}`)) || null;
  }

  // ========== HTTP handlers ==========

  private async httpStartSession(body: any): Promise<Response> {
    // ===== 入力検証 (HIGH 2026-04-29) =====
    // 旧実装は `body.source || 'standalone'` 等で型/長さ検証なし.
    // MySQL ENUM('portal','widget','standalone') を超える値が入ると 1366 エラー、
    // VARCHAR の場合は攻撃者ペイロードがそのまま保管される可能性があった.

    // session_token: クライアント既存 token (adopt) があれば検証. 無ければ新規生成.
    const providedToken = body.session_token;
    let clientProvidedToken = false;
    let token: string;
    if (typeof providedToken === 'string' && providedToken.length > 0) {
      // UUID 風 (ハイフン入り 36文字 / 32 hex) のみ受理.
      if (!/^[0-9a-fA-F-]{32,36}$/.test(providedToken) || providedToken.length > 64) {
        return this.errJson('invalid_token', 400);
      }
      token = providedToken;
      clientProvidedToken = true;
    } else {
      token = crypto.randomUUID();
    }

    // 各フィールドを長さ上限と型で検証. 不正なら空文字 (DB 側で安全に NULL/空として保存).
    const visitorHash = asString(body.visitor_hash, 128) || '';
    const nickname = asString(body.nickname, 60) || '';
    const lang = asString(body.lang, 10) || 'ja';
    const source = asEnum(body.source, ['portal', 'widget', 'standalone'] as const) || 'standalone';
    // shop_cast_id: shop_casts.id (UUID). 空 OK (店舗直通).
    const shopCastIdRaw = typeof body.cast === 'string' ? body.cast.trim() : '';
    const shopCastId = shopCastIdRaw && /^[0-9a-fA-F-]{32,36}$/.test(shopCastIdRaw) ? shopCastIdRaw : '';

    let sess = await this.findSessionByToken(token);
    const isNew = !sess;

    // キャスト指名解決:
    // - 新規セッション: 必ず resolve
    // - 既存セッションで cast_id 未設定かつ URL に cast 指定あり: retrofit
    //   (旧 DO バージョンで作られた「cast 無視」セッションを救済)
    // - 既存セッションで cast_id 設定済み: 変えない（別キャストへの乗っ取り防止）
    const shouldResolveCast = !!(shopCastId && this.shopMeta?.shop_id && (isNew || (sess && !sess.cast_id)));
    let castInfo: { shop_cast_id?: string; cast_id?: string; cast_name?: string; cast_avatar_url?: string | null; cast_notify_mode?: string | null } = {};
    if (shouldResolveCast) {
      castInfo = await this.resolveCast(this.shopMeta!.shop_id, shopCastId);
    }

    // cast_notify_mode は session storage に persist しない（キャストが頻繁にトグルする想定で
    // 毎リクエスト fresh が必要なため). castInfo から最初に得る、無ければ adopt パスで再 resolve.
    let castNotifyMode: string | null = castInfo.cast_notify_mode ?? null;

    if (!sess) {
      const id = await this.nextSessionId();
      const now = new Date().toISOString();
      sess = {
        id,
        session_token: token,
        visitor_hash: visitorHash,
        nickname,
        lang,
        started_at: now,
        last_activity_at: now,
        status: 'open',
        source,
        blocked: false,
        shop_cast_id: castInfo.shop_cast_id || null,
        cast_id: castInfo.cast_id || null,
        cast_name: castInfo.cast_name || null,
        cast_avatar_url: castInfo.cast_avatar_url ?? null,
      };
      await this.saveSession(sess);

      // クライアントが既存 token を持って戻ってきた場合 (= リロード) は
      // MySQL 側に履歴があり得る. DO storage が空のままだと WS snapshot が
      // 空配列を返して画面が真っ白になるため, backfill して DO ↔ MySQL を揃える.
      if (clientProvidedToken) {
        await this.backfillFromMysql(sess);
      }
    } else if (clientProvidedToken && !(await this.hasBackfilled(sess.id))) {
      // 既存 stub セッションだが backfill マーカーが無い場合:
      // 古い DO バージョンで作られた空 stub (storage にメッセージ無し) を救済.
      // 冪等 (backfillFromMysql 内で storage.put の id 重複は上書きされない).
      await this.backfillFromMysql(sess);
    } else if (castInfo.cast_id && !sess.cast_id) {
      // retrofit: 既存セッションに cast 情報を付与
      sess.shop_cast_id = castInfo.shop_cast_id || null;
      sess.cast_id = castInfo.cast_id;
      sess.cast_name = castInfo.cast_name || null;
      sess.cast_avatar_url = castInfo.cast_avatar_url ?? null;
      await this.saveSession(sess);
    } else if (sess.cast_id && sess.shop_cast_id && this.shopMeta?.shop_id) {
      // adopt パス: cast セッションは毎回 resolveCast して fresh cast_notify_mode を取る.
      // - cast_avatar_url が未設定 (旧 DO バージョン) なら同時に persist.
      // - cast_notify_mode は session に persist しないが、レスポンスには含める.
      const fresh = await this.resolveCast(this.shopMeta.shop_id, sess.shop_cast_id);
      if (fresh) {
        if (fresh.cast_notify_mode) castNotifyMode = fresh.cast_notify_mode;
        if ((sess.cast_avatar_url === undefined || sess.cast_avatar_url === null) && (fresh.cast_avatar_url || fresh.cast_id)) {
          sess.cast_avatar_url = fresh.cast_avatar_url ?? null;
          await this.saveSession(sess);
        }
      }
    }

    return this.okBatch({
      messages: [],
      status: sess.status,
      shop_online: this.isShopOnline(),
      session_token: sess.session_token,
      session_id: sess.id,
      cast_name: sess.cast_name || null,
      shop_avatar_url: this.shopMeta?.chat_avatar_url ?? null,
      cast_avatar_url: sess.cast_avatar_url ?? null,
      cast_notify_mode: castNotifyMode,
    });
  }

  // shop_casts.id → cast_id + display_name + profile_image_url + chat_notify_mode を PHP から解決.
  // 承認済み(active)でなければ空を返す（店舗直通にフォールバック）.
  private async resolveCast(shopId: string, shopCastId: string): Promise<{ shop_cast_id?: string; cast_id?: string; cast_name?: string; cast_avatar_url?: string | null; cast_notify_mode?: string | null }> {
    const base = this.env.NOTIFY_BASE_URL || 'https://yobuho.com';
    const secret = this.env.CHAT_SYNC_SECRET || '';
    if (!secret) return {};
    try {
      const qs = `shop_id=${encodeURIComponent(shopId)}&shop_cast_id=${encodeURIComponent(shopCastId)}`;
      const res = await fetch(`${base}/api/chat-cast-lookup.php?${qs}`, {
        headers: { 'X-Sync-Secret': secret },
      });
      if (!res.ok) return {};
      const data = await res.json() as any;
      if (!data?.ok) return {};
      return {
        shop_cast_id: data.shop_cast_id,
        cast_id: data.cast_id,
        cast_name: data.display_name,
        cast_avatar_url: data.profile_image_url || null,
        cast_notify_mode: data.chat_notify_mode || 'off',
      };
    } catch (_) {
      return {};
    }
  }

  private async httpSendMessage(body: any): Promise<Response> {
    const token = body.session_token as string;
    const text = (body.message as string || '').trim();
    const cmid = body.client_msg_id as string | undefined;
    const sinceId = Number(body.since_id || 0);
    const nickname = (body.nickname as string || '').trim();
    const lang = (body.lang as string || '').trim();
    if (!token || !text) return this.errJson('missing_fields', 400);

    const sess = await this.findSessionByToken(token);
    if (!sess) return this.errJson('session_not_found', 404);
    if (sess.status === 'closed') return this.errJson('session_closed', 409);
    if (sess.blocked) return this.errJson('blocked', 403);

    // 送信時の nickname / lang でセッション情報を更新（オーナー受信箱の表示用）
    if (nickname) sess.nickname = nickname;
    if (lang) sess.lang = lang;

    // 冪等化: 同じclient_msg_idなら既存を返す
    let msg: ChatMessage | null = null;
    if (cmid) msg = await this.messageByCmid(sess.id, cmid);
    if (!msg) {
      const id = await this.nextMessageId(sess.id);
      msg = {
        id,
        session_id: sess.id,
        sender_type: 'visitor',
        message: text.slice(0, 500),
        client_msg_id: cmid,
        sent_at: new Date().toISOString(),
        read_at: null,
      };
      await this.saveMessage(sess.id, msg);

      // last_activity 更新
      sess.last_activity_at = msg.sent_at;
      await this.saveSession(sess);

      // broadcast to connected owner WS (session_token も含める: owner側 selectedSid は MySQL id であり DO session_id と不一致のため token で照合させる)
      this.broadcastToRole('owner', { type: 'message', data: msg, session_id: sess.id, session_token: sess.session_token });

      // 2026-04-23 ゼロ設計: 暗黙 auto-read は廃止. 既読は受信側クライアントが isWindowActive() 時に
      // 明示 mark-read を打つ 1 経路のみ. ここで auto-read すると「送信直後に既読がフラッシュ」バグ再発.

      // メール通知判定 (PHP handleSendMessage と同じロジック):
      //  - off         → 送らない
      //  - first       → そのセッションで未通知のときだけ
      //  - every       → 前回通知から notify_min_interval_minutes 未満ならスキップ
      //  送信成功したら `notified_at` を必ず更新 (every の throttle 判定に使うため).
      const mode = this.shopMeta?.notify_mode || 'off';
      const first = !sess.notified_at;
      let shouldNotify = false;
      if (sess.cast_id) {
        // キャスト指名セッション: 店舗モードを無視し, PHP 側で shop_casts.chat_notify_mode を適用.
        //   throttle も PHP に委譲する. (店舗の notified_at カウンタは使わない)
        shouldNotify = true;
      } else if (mode === 'first') {
        shouldNotify = first;
      } else if (mode === 'every') {
        if (first) {
          shouldNotify = true;
        } else {
          const minInterval = Math.max(1, this.shopMeta?.notify_min_interval_minutes || 3);
          const elapsedMs = Date.now() - new Date(sess.notified_at as string).getTime();
          shouldNotify = elapsedMs >= minInterval * 60 * 1000;
        }
      }

      if (shouldNotify && this.shopMeta) {
        await router.notify(
          ['email'],
          {
            shop: this.shopMeta,
            session_id: sess.id,
            session_token: sess.session_token,
            nickname: sess.nickname,
            message: msg,
            first_in_session: first,
            cast_id: sess.cast_id || null,
            cast_name: sess.cast_name || null,
          },
          this.env
        );
        sess.notified_at = msg.sent_at;
        await this.saveSession(sess);
      }

      // Web Push (best-effort, 受信側の subscription 切れは自動削除).
      // - キャスト指名セッション: 該当キャストの購読者のみ (店舗オーナーに通知しない設計)
      // - 店舗直通セッション: 店舗の購読者全員
      // shouldNotify とは独立 — push はマナーモード的な位置付けで「店舗が off でも個人端末は通知される」.
      // Day 10 時点では shouldNotify と揃える方が安全なので中に入れる.
      if (shouldNotify && this.shopMeta) {
        const pushPayload = buildVisitorMessagePushPayload(this.shopMeta, sess, msg);
        if (sess.cast_id) {
          this.state.waitUntil(sendPushToSubject(this.env, 'cast', sess.cast_id, pushPayload));
        } else {
          this.state.waitUntil(sendPushToSubject(this.env, 'shop', this.shopMeta.shop_id, pushPayload));
        }
      }
    }

    // 送信側にも統一バッチ形式で返す (since_id 以降の新着もマージ)
    // 注: MySQL mirror と DO 内部カウンタが乖離していると msg.id < sinceId になり得るため、
    // 今作ったメッセージは必ず含める (dedup は client 側 last_message_id で行う).
    const newer = await this.messagesSince(sess.id, sinceId);
    const messages = newer.some(m => m.id === msg.id) ? newer : [...newer, msg];
    return this.okBatch({
      messages,
      status: sess.status,
      shop_online: this.isShopOnline(),
      session_token: sess.session_token,
      message_id: msg.id,
      client_msg_id: msg.client_msg_id,
    });
  }

  private async httpOwnerReply(body: any): Promise<Response> {
    // session_token 優先 (オーナー画面は PHP owner-inbox 由来の MySQL session_id を持つため DO 内部 ID と合致しない).
    const token = (body.session_token as string) || '';
    const text = (body.message as string || '').trim();
    const cmid = body.client_msg_id as string | undefined;
    const sinceId = Number(body.since_id || 0);
    if (!text) return this.errJson('missing_fields', 400);

    let sess: ChatSession | null = null;
    if (token) {
      sess = await this.findSessionByToken(token);
    } else if (body.session_id) {
      sess = await this.getSession(Number(body.session_id));
    }
    // DO storage が欠けている場合 (purge 後 or pre-DO session) は token から stub session を DO 側だけに作成.
    // MySQL 側は PHP オーナー受信箱から既に正しい session_token が得られている前提なので,
    // saveSession() は呼ばずに MySQL mirror をスキップ (blocked/started_at 等を破壊しないため).
    if (!sess && token) {
      const hid = await this.nextSessionId();
      const now = new Date().toISOString();
      sess = {
        id: hid,
        session_token: token,
        visitor_hash: '',
        nickname: '',
        lang: '',
        started_at: now,
        last_activity_at: now,
        status: 'open',
        source: 'standalone',
        blocked: false,
      };
      await this.state.storage.put(`session:${hid}`, sess);
      await this.state.storage.put(`session_by_token:${token}`, hid);
    }
    if (!sess) return this.errJson('session_not_found', 404);
    if (sess.status === 'closed') return this.errJson('session_closed', 409);

    const sid = sess.id;
    let msg: ChatMessage | null = null;
    if (cmid) msg = await this.messageByCmid(sid, cmid);
    if (!msg) {
      const id = await this.nextMessageId(sid);
      msg = {
        id,
        session_id: sid,
        sender_type: 'shop',
        message: text.slice(0, 500),
        client_msg_id: cmid,
        sent_at: new Date().toISOString(),
        read_at: null,
      };
      await this.saveMessage(sid, msg);
      sess.last_activity_at = msg.sent_at;
      await this.saveSession(sess);

      this.broadcastToSession(sid, 'visitor', { type: 'message', data: msg, session_id: sid, session_token: sess.session_token });

      // 訪問者への Web Push (店舗/キャストが返信したとき).
      // shop_slug / cast_id は URL 復元に使うため、訪問者端末が chat.yobuho.com 埋め込みか
      // standalone ページか判別せず、shop.slug + session_token だけで復元できる形で渡す.
      if (this.shopMeta) {
        const pushPayload = buildOwnerReplyPushPayload(this.shopMeta, sess, msg);
        this.state.waitUntil(sendPushToSubject(this.env, 'visitor', sess.session_token, pushPayload));
        this.state.waitUntil(sendVisitorEmailNotification(this.env, this.shopMeta, sess, msg));
      }
    }

    const newer = await this.messagesSince(sid, sinceId);
    const messages = newer.some(m => m.id === msg.id) ? newer : [...newer, msg];
    return this.okBatch({
      messages,
      status: sess.status,
      shop_online: this.isShopOnline(),
      session_token: sess.session_token,
      message_id: msg.id,
      client_msg_id: msg.client_msg_id,
    });
  }

  private async httpCloseSession(body: any): Promise<Response> {
    // session_token 優先 (オーナー側は MySQL session_id を保持しており DO の session_id と一致しないため)
    const token = (body.session_token as string) || '';
    let sess: ChatSession | null = null;
    if (token) {
      sess = await this.findSessionByToken(token);
    } else if (body.session_id) {
      sess = await this.getSession(Number(body.session_id));
    }
    // DO storage 欠け時の hydration (httpOwnerReply と同じ理由). close も token があれば受け入れる.
    if (!sess && token) {
      const hid = await this.nextSessionId();
      const now = new Date().toISOString();
      sess = {
        id: hid,
        session_token: token,
        visitor_hash: '',
        nickname: '',
        lang: '',
        started_at: now,
        last_activity_at: now,
        status: 'open',
        source: 'standalone',
        blocked: false,
      };
      await this.state.storage.put(`session:${hid}`, sess);
      await this.state.storage.put(`session_by_token:${token}`, hid);
    }
    if (!sess) return this.errJson('session_not_found', 404);
    const sid = sess.id;
    if (sess.status !== 'closed') {
      sess.status = 'closed';
      sess.closed_at = new Date().toISOString();
      await this.saveSession(sess);
      this.broadcastToSession(sid, 'visitor', { type: 'status', status: 'closed', session_token: sess.session_token });
      this.broadcastToRole('owner', { type: 'status', session_id: sid, session_token: sess.session_token, status: 'closed' });
    }
    return this.okBatch({ messages: [], status: sess.status, shop_online: this.isShopOnline() });
  }

  private async httpOwnerInbox(_body: any): Promise<Response> {
    // 受信箱: 店舗直通セッション (cast_id 無) のみ. キャスト指名は shop-admin 側で閲覧.
    const map = await this.state.storage.list<ChatSession>({ prefix: 'session:', limit: 100 });
    const sessions: any[] = [];
    for (const s of map.values()) {
      if (s.cast_id) continue;
      const msgs = await this.messagesSince(s.id, 0);
      const last = msgs[msgs.length - 1];
      sessions.push({
        id: s.id,
        session_token: s.session_token,
        nickname: s.nickname,
        status: s.status,
        last_activity_at: s.last_activity_at,
        last_message: last ? last.message : '',
        last_sender: last ? last.sender_type : null,
        unread_count: msgs.filter((m) => m.sender_type === 'visitor' && !m.read_at).length,
      });
    }
    sessions.sort((a, b) => (a.last_activity_at < b.last_activity_at ? 1 : -1));
    return this.okBatch({ messages: [], status: null, shop_online: this.isShopOnline(), sessions });
  }

  private async httpOwnerMarkRead(body: any): Promise<Response> {
    // 重要: chat.js が渡す session_id は PHP 由来 MySQL id で DO 内 session.id とは不一致.
    // 正しい DO session を引くため session_token を優先キーにする. session_id は後方互換.
    const token = String(body.session_token || '');
    const upTo = Number(body.up_to_id || 0);

    let sess: ChatSession | null = null;
    if (token) {
      sess = await this.findSessionByToken(token);
    } else if (body.session_id) {
      sess = (await this.state.storage.get<ChatSession>(`session:${Number(body.session_id)}`)) ?? null;
    }
    if (!sess) return this.errJson('session_not_found', 404);
    const sid = sess.id;

    const msgs = await this.messagesSince(sid, 0);
    const now = new Date().toISOString();
    let upToSentAt = '';
    for (const m of msgs) {
      if (m.sender_type === 'visitor' && !m.read_at && (upTo === 0 || m.id <= upTo)) {
        m.read_at = now;
        await this.saveMessage(sid, m);
        if (m.sent_at > upToSentAt) upToSentAt = m.sent_at;
      }
    }
    this.broadcastToSession(sid, 'visitor', {
      type: 'read',
      session_id: sid,
      session_token: sess.session_token,
      up_to_id: upTo,
    });
    if (upToSentAt) {
      this.state.waitUntil(this.sync.markRead(sess.session_token, 'shop', upToSentAt));
    }
    return this.okBatch({ messages: [], status: null, shop_online: this.isShopOnline() });
  }

  /**
   * 2026-04-23 ゼロ設計: visitor 側の明示 mark-read.
   * chat.js が isWindowActive() 時のみ発火. shop msg の read_at を更新 + owner WS に broadcast.
   */
  private async httpVisitorMarkRead(body: any): Promise<Response> {
    const token = String(body.session_token || '');
    const upTo = Number(body.up_to_id || 0);
    if (!token) return this.errJson('missing_fields', 400);

    const sess = await this.findSessionByToken(token);
    if (!sess) return this.errJson('session_not_found', 404);

    const msgs = await this.messagesSince(sess.id, 0);
    const now = new Date().toISOString();
    let upToSentAt = '';
    for (const m of msgs) {
      if (m.sender_type === 'shop' && !m.read_at && (upTo === 0 || m.id <= upTo)) {
        m.read_at = now;
        await this.saveMessage(sess.id, m);
        if (m.sent_at > upToSentAt) upToSentAt = m.sent_at;
      }
    }

    // owner WS に broadcast (送信者=shop なので owner 側UIに既読マーカー反映)
    const payload = JSON.stringify({
      type: 'read',
      session_token: token,
      session_id: sess.id,
      up_to_id: upTo,
    });
    const all = this.state.getWebSockets();
    for (const ws of all) {
      try {
        const a = ws.deserializeAttachment() as WsAttachment | null;
        if (a && a.role === 'owner') ws.send(payload);
      } catch (_) {}
    }

    // MySQL mirror (reader='visitor' → sender_type='shop' を既読化)
    if (upToSentAt) {
      this.state.waitUntil(this.sync.markRead(token, 'visitor', upToSentAt));
    }
    return this.okBatch({ messages: [], status: null, shop_online: this.isShopOnline() });
  }

  // DO storage 全消去 (shop_meta は保持). CHAT_SYNC_SECRET で認証.
  private async httpAdminPurge(req: Request, _body: any): Promise<Response> {
    const provided = req.headers.get('X-Sync-Secret') || '';
    const expected = this.env.CHAT_SYNC_SECRET || '';
    if (!safeEqual(provided, expected)) {
      return this.errJson('forbidden', 403);
    }
    // shop_meta は残して他を全消去
    const meta = await this.state.storage.get<ShopStatus>('shop_meta');
    await this.state.storage.deleteAll();
    if (meta) await this.state.storage.put('shop_meta', meta);
    return new Response(JSON.stringify({ ok: true, purged: true }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  // ========== WebSocket ==========

  private async handleWsUpgrade(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const role = (url.searchParams.get('role') || 'visitor') as WsRole;
    const sessionToken = url.searchParams.get('token') || '';
    const deviceToken = url.searchParams.get('device') || '';
    const sinceId = Number(url.searchParams.get('since_id') || 0);

    // ===== CSWSH 対策 (CRITICAL 2026-04-29) =====
    // WebSocket は CORS preflight が効かないため、別途 Origin 検証が必須.
    // 旧実装は Origin 未検証のため、攻撃者サイトを被害者ブラウザで開かせるだけで
    // 任意 session に接続できた (Cross-Site WebSocket Hijacking).
    const origin = req.headers.get('Origin');
    if (!origin || !isOriginAllowed(origin, this.env)) {
      return new Response('forbidden_origin', { status: 403 });
    }

    // role の正当性
    if (role !== 'visitor' && role !== 'owner') {
      return new Response('invalid_role', { status: 400 });
    }

    // ===== owner role の device_token 必須検証 (CRITICAL 2026-04-29) =====
    // 旧実装は role=owner で接続するだけで全 session の inbox snapshot を受信し、
    // 偽返信 / mark-read / close-session を実行できた.
    if (role === 'owner') {
      const shopId = req.headers.get('X-Shop-Id') || '';
      if (!shopId) {
        return new Response('shop_unknown', { status: 401 });
      }
      if (!deviceToken) {
        return new Response('unauthenticated', { status: 401 });
      }
      const ok = await verifyOwnerDevice(this.env, shopId, deviceToken);
      if (!ok) {
        return new Response('forbidden', { status: 403 });
      }
    }

    // セッション解決 (visitor のみ)
    let session: ChatSession | null = null;
    if (role === 'visitor') {
      // visitor は session_token (UUID 形式) 必須. 形式不正なら DB lookup する前に reject.
      if (!sessionToken || !/^[0-9a-fA-F-]{32,36}$/.test(sessionToken)) {
        return new Response('invalid_token', { status: 400 });
      }
      session = await this.findSessionByToken(sessionToken);
      if (!session) return new Response('session_not_found', { status: 404 });
      if (session.blocked) return new Response('blocked', { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    const attach: WsAttachment = {
      role,
      session_id: session?.id,
      session_token: sessionToken || undefined,
      device_token: deviceToken || undefined,
      last_since_id: sinceId,
      connected_at: Date.now(),
      heartbeat_at: Date.now(),
    };

    // Hibernation API: tag で後から getWebSockets(tag) できるようにする
    const tags: string[] = [`role:${role}`];
    if (session) tags.push(`session:${session.id}`);
    this.state.acceptWebSocket(server, tags);
    server.serializeAttachment(attach);

    // 初回スナップショット送信 (接続直後に取りこぼし防止)
    if (session) {
      const newer = await this.messagesSince(session.id, sinceId);
      // 既読マーカー復元: storage 全 visitor メッセージの中で read_at が立っている最大 id.
      // sinceId > 0 の再接続では newer に既読済みメッセージが含まれない可能性があるため、
      // sinceId=0 のとき以外は storage 全体を再スキャンする.
      let lastReadOwnId = 0;
      const scan = sinceId === 0 ? newer : await this.messagesSince(session.id, 0);
      for (const m of scan) {
        if (m.sender_type === 'visitor' && m.read_at && m.id > lastReadOwnId) {
          lastReadOwnId = m.id;
        }
      }
      server.send(JSON.stringify({
        type: 'snapshot',
        messages: newer,
        status: session.status,
        shop_online: this.isShopOnline(),
        last_read_own_id: lastReadOwnId,
        server_time: new Date().toISOString(),
      }));
    } else if (role === 'owner') {
      // オーナー接続時は inbox を送る
      const inboxRes = await this.httpOwnerInbox({});
      const inbox = await inboxRes.json() as any;
      server.send(JSON.stringify({ type: 'inbox', ...inbox }));
    }

    // heartbeat alarm をセット
    await this.ensureAlarm();

    return new Response(null, { status: 101, webSocket: client });
  }

  // WebSocket から client → server へのメッセージ (Hibernation API)
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    // ===== サイズ上限ガード (DoS 対策) =====
    // chat msg 本文 500 char + JSON ラッパー余裕で 2KB 以内. 余裕持って 8KB.
    if (message.length > 8192) return;

    let data: any;
    try { data = JSON.parse(message); } catch { return; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;

    const attach = ws.deserializeAttachment() as WsAttachment | null;
    if (!attach) {
      // hibernation 復活時の attachment 取得失敗 → 接続を閉じて再接続を促す
      try { ws.close(1011, 'no_attach'); } catch (_) {}
      return;
    }
    attach.heartbeat_at = Date.now();
    ws.serializeAttachment(attach);

    // 共通ヘルパー: client 入力の文字列バリデーション
    const dType = asEnum(data.type, ['ping', 'send', 'mark-read', 'view', 'close-session'] as const);
    if (!dType) return;

    switch (dType) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
        break;
      case 'send': {
        const text = asNonEmpty(data.text, 500);
        const cmid = data.client_msg_id != null ? asString(data.client_msg_id, 64) : undefined;
        if (!text) return;
        // visitor: {text, client_msg_id} / owner: {session_id, text, client_msg_id}
        if (attach.role === 'visitor' && attach.session_token) {
          await this.httpSendMessage({
            session_token: attach.session_token,
            message: text,
            client_msg_id: cmid || undefined,
            since_id: attach.last_since_id,
          });
        } else if (attach.role === 'owner') {
          // owner WS は session_token / session_id どちらかで対象 session 指定可.
          // ただし WS 経由の owner 操作では session_token を優先 (DO ↔ MySQL の id 食い違い対策).
          const tok = data.session_token != null ? asString(data.session_token, 64) : '';
          const sid = Number.isFinite(Number(data.session_id)) ? Number(data.session_id) : 0;
          if (!tok && !sid) return;
          await this.httpOwnerReply({
            session_token: tok || undefined,
            session_id: sid || undefined,
            message: text,
            client_msg_id: cmid || undefined,
            since_id: attach.last_since_id,
          });
        }
        break;
      }
      case 'mark-read': {
        const upTo = Number.isFinite(Number(data.up_to_id)) ? Number(data.up_to_id) : 0;
        if (attach.role === 'owner') {
          const tok = data.session_token != null ? asString(data.session_token, 64) : '';
          const sid = Number.isFinite(Number(data.session_id)) ? Number(data.session_id) : 0;
          if (!tok && !sid) return;
          await this.httpOwnerMarkRead({
            session_token: tok || undefined,
            session_id: sid || undefined,
            up_to_id: upTo,
          });
        } else if (attach.role === 'visitor' && attach.session_token) {
          await this.httpVisitorMarkRead({ session_token: attach.session_token, up_to_id: upTo });
        }
        break;
      }
      case 'view': {
        // B-1 (owner): オーナーが開いているスレッドの session_token を記録.
        // #2 (visitor): 自分の画面が visible の間 session_token を自己セット.
        const tokRaw = data.session_token != null ? asString(data.session_token, 64) : undefined;
        if (attach.role === 'owner') {
          attach.viewing_session_token = tokRaw || undefined;
          if (tokRaw) attach.last_view_at = Date.now();
          ws.serializeAttachment(attach);
        } else if (attach.role === 'visitor') {
          // visitor は自分の session_token のみ登録可
          if (!tokRaw || tokRaw === attach.session_token) {
            attach.viewing_session_token = tokRaw || undefined;
            if (tokRaw) attach.last_view_at = Date.now();
            ws.serializeAttachment(attach);
          }
        }
        break;
      }
      case 'close-session': {
        if (attach.role === 'owner') {
          const tok = data.session_token != null ? asString(data.session_token, 64) : '';
          const sid = Number.isFinite(Number(data.session_id)) ? Number(data.session_id) : 0;
          if (!tok && !sid) return;
          await this.httpCloseSession({
            session_token: tok || undefined,
            session_id: sid || undefined,
          });
        }
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    try { ws.close(code, 'closed'); } catch (_) {}
  }

  async webSocketError(ws: WebSocket, _err: unknown): Promise<void> {
    try { ws.close(1011, 'error'); } catch (_) {}
  }

  // ========== Broadcast ==========

  /**
   * POST /broadcast — PHP 統一送信からのリレー受信口.
   * 認証: X-Sync-Secret (CHAT_SYNC_SECRET を PHP と共有).
   *
   * Body: { session_token: string, message_row: { id, sender_type, message, sent_at, client_msg_id, ... } }
   *
   * 配信ルール (sender の重複反映は sender 側の client_msg_id で抑止):
   *   - sender_type = 'visitor' → 全 owner WS + 同一 session_token の visitor WS
   *   - sender_type = 'shop'    → 同一 session_token の visitor WS + 全 owner WS
   *   - 結果: 「room 内全員」にブロードキャスト. sender 自身の他タブも同期できる.
   */
  private async httpBroadcast(req: Request, body: any): Promise<Response> {
    const provided = req.headers.get('X-Sync-Secret') || '';
    const expected = this.env.CHAT_SYNC_SECRET || '';
    if (!safeEqual(provided, expected)) {
      return this.errJson('forbidden', 403);
    }

    const token = String(body?.session_token || '');
    const row = body?.message_row;
    if (!token || !row || typeof row !== 'object') {
      return this.errJson('missing_fields', 400);
    }

    // DO storage にミラー保存.
    //   - リロード時 handleWsUpgrade → messagesSince() が空にならないよう snapshot 供給源を作る
    //   - MySQL id (row.id) をそのまま DO 内 message.id として保存 (DO nextMessageId は使わない)
    //   - session stub: DO storage に未登録のセッションなら httpOwnerReply と同じパターンで最小 stub を作成
    //   - client_msg_id が来ていれば cmid マップも張り, 冪等性 & 再送検出に使える
    const sess = await this.ensureSessionStub(token, row);
    const mid = Number(row.id || 0);
    // 既存が有る場合は read_at を保持 (auto-read が先行して read_at を立てていたのを
    // 後から届いた initial insert の /broadcast で null に戻さないため).
    const existing = await this.state.storage.get<ChatMessage>(`message:${sess.id}:${mid}`);
    const mirrored: ChatMessage = {
      id: mid,
      session_id: sess.id,
      sender_type: row.sender_type === 'shop' ? 'shop' : 'visitor',
      message: String(row.message || ''),
      client_msg_id: row.client_msg_id ? String(row.client_msg_id) : undefined,
      sent_at: String(row.sent_at || new Date().toISOString()),
      read_at: row.read_at || existing?.read_at || null,
    };
    await this.state.storage.put(`message:${sess.id}:${mid}`, mirrored);
    if (mirrored.client_msg_id) {
      await this.state.storage.put(`cmid:${sess.id}:${mirrored.client_msg_id}`, mid);
    }
    // last_activity 更新 (DO inbox の並び順で使う)
    if (sess.last_activity_at < mirrored.sent_at) {
      sess.last_activity_at = mirrored.sent_at;
      await this.state.storage.put(`session:${sess.id}`, sess);
      await this.state.storage.put(`session_by_token:${sess.session_token}`, sess.id);
    }

    const payload = {
      type: 'message',
      data: row,
      session_token: token,
      session_id: sess.id,
    };
    const json = JSON.stringify(payload);

    // getWebSockets() = 全接続取得 (Hibernation API).
    // tag は role:<role> や session:<id> で絞れるが、ここは visitor の session_token 照合が必要なので全件走査.
    let delivered = 0;
    const all = this.state.getWebSockets();
    for (const ws of all) {
      try {
        const a = ws.deserializeAttachment() as WsAttachment;
        if (!a) continue;
        // owner WS: 全件に送る (owner は全セッションの inbox を一元管理)
        if (a.role === 'owner') {
          ws.send(json);
          delivered++;
          continue;
        }
        // visitor WS: 自セッションにのみ送る
        if (a.role === 'visitor' && a.session_token === token) {
          ws.send(json);
          delivered++;
        }
      } catch (_) {
        /* stale / already-closed WS — skip */
      }
    }

    // 2026-04-23 ゼロ設計: PHP 経由 broadcast でも DO auto-read はしない.
    // 既読は受信側クライアントが isWindowActive() 時に明示 mark-read を打つ 1 経路のみ.

    return new Response(JSON.stringify({ ok: true, delivered }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  /**
   * POST /broadcast-read — PHP が read_at を打った直後に呼び出す.
   * 認証: X-Sync-Secret.
   *
   * Body: { session_token: string, reader: 'shop'|'visitor', up_to_id: number }
   *   - reader='shop'    → shop が visitor メッセージを既読化 → visitor WS に type:'read' 通知
   *   - reader='visitor' → visitor が shop メッセージを既読化 → owner WS (+ cast_inbox) に type:'read' 通知
   *
   * up_to_id は MySQL 側の最大既読 ID (PHP 権威). DO 内 storage の read_at は触らない.
   */
  private async httpBroadcastRead(req: Request, body: any): Promise<Response> {
    const provided = req.headers.get('X-Sync-Secret') || '';
    const expected = this.env.CHAT_SYNC_SECRET || '';
    if (!safeEqual(provided, expected)) {
      return this.errJson('forbidden', 403);
    }

    const token = String(body?.session_token || '');
    const reader = String(body?.reader || '');
    const upTo = Number(body?.up_to_id || 0);
    if (!token || (reader !== 'shop' && reader !== 'visitor')) {
      return this.errJson('missing_fields', 400);
    }

    // DO storage 側の read_at も更新 (リロード時の snapshot で既読マーカーが消えないように).
    //   - reader='shop'    → sender_type='visitor' の未既読メッセージを一括既読化
    //   - reader='visitor' → sender_type='shop' の未既読メッセージを一括既読化
    const sess = await this.findSessionByToken(token);
    if (sess) {
      const targetSender: SenderType = reader === 'shop' ? 'visitor' : 'shop';
      const msgs = await this.messagesSince(sess.id, 0);
      const now = new Date().toISOString();
      for (const m of msgs) {
        if (m.sender_type === targetSender && !m.read_at && (upTo === 0 || m.id <= upTo)) {
          m.read_at = now;
          await this.state.storage.put(`message:${sess.id}:${m.id}`, m);
        }
      }
    }

    // reader='shop' → 通知先 = visitor (自分のメッセージが既読になった)
    // reader='visitor' → 通知先 = owner (自分のメッセージが既読になった)
    const targetRole: WsRole = reader === 'shop' ? 'visitor' : 'owner';
    const payload = JSON.stringify({
      type: 'read',
      session_token: token,
      up_to_id: upTo,
    });

    let delivered = 0;
    const all = this.state.getWebSockets();
    for (const ws of all) {
      try {
        const a = ws.deserializeAttachment() as WsAttachment;
        if (!a) continue;
        if (targetRole === 'owner' && a.role === 'owner') {
          ws.send(payload);
          delivered++;
          continue;
        }
        if (targetRole === 'visitor' && a.role === 'visitor' && a.session_token === token) {
          ws.send(payload);
          delivered++;
        }
      } catch (_) {
        /* stale — skip */
      }
    }

    return new Response(JSON.stringify({ ok: true, delivered }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  /**
   * POST /broadcast-typing — PHP の handleSetTyping 相当が呼ぶ.
   * 認証: X-Sync-Secret.
   *
   * Body: { session_token, role: 'visitor'|'shop', typing: boolean }
   *   - role='visitor' typing → 通知先 = 全 owner WS (inbox / 選択中 両方が同じ session_token をフィルタ)
   *   - role='shop'    typing → 通知先 = 同一 session_token の visitor WS
   *
   * クライアント側は 6s のローカル watchdog を持つので、stop (typing=false) を取りこぼしても
   * 自然消滅する. ただし reliability 向上のため typing=false も明示 push する.
   */
  private async httpBroadcastTyping(req: Request, body: any): Promise<Response> {
    const provided = req.headers.get('X-Sync-Secret') || '';
    const expected = this.env.CHAT_SYNC_SECRET || '';
    if (!safeEqual(provided, expected)) {
      return this.errJson('forbidden', 403);
    }

    const token = String(body?.session_token || '');
    const role = String(body?.role || '');
    const typing = !!body?.typing;
    if (!token || (role !== 'visitor' && role !== 'shop')) {
      return this.errJson('missing_fields', 400);
    }

    // role='visitor'(typist) → targetRole='owner'(display side)
    // role='shop'(typist)    → targetRole='visitor'(display side)
    const targetRole: WsRole = role === 'visitor' ? 'owner' : 'visitor';
    const payload = JSON.stringify({
      type: 'typing',
      session_token: token,
      role,
      typing,
    });

    let delivered = 0;
    const all = this.state.getWebSockets();
    for (const ws of all) {
      try {
        const a = ws.deserializeAttachment() as WsAttachment | null;
        if (!a) continue;
        if (targetRole === 'owner' && a.role === 'owner') {
          ws.send(payload);
          delivered++;
          continue;
        }
        if (targetRole === 'visitor' && a.role === 'visitor' && a.session_token === token) {
          ws.send(payload);
          delivered++;
        }
      } catch (_) {
        /* stale — skip */
      }
    }

    return new Response(JSON.stringify({ ok: true, delivered }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  private broadcastToRole(role: WsRole, payload: unknown): void {
    const clients = this.state.getWebSockets(`role:${role}`);
    const json = JSON.stringify(payload);
    for (const ws of clients) {
      try { ws.send(json); } catch (_) {}
    }
  }

  /**
   * B-1 owner presence: 指定 session_token のスレッドを表示中のオーナー WS が
   * 1つでもあれば true. 自動既読トリガに使う.
   */
  private isOwnerViewingToken(token: string): boolean {
    if (!token) return false;
    // 2026-04-23 (revised): last_view_at が付いていれば 45s 鮮度ゲート, 付いていなければ
    // 旧 chat.js / 互換 WS なので viewing_session_token 一致のみで viewing とみなす.
    // (鮮度ゲートを厳格化しすぎて既読が完全に止まるリグレッションを避ける)
    const fresh = Date.now() - 45_000;
    const owners = this.state.getWebSockets('role:owner');
    for (const ws of owners) {
      try {
        const a = ws.deserializeAttachment() as WsAttachment | null;
        if (!a || a.viewing_session_token !== token) continue;
        if (!a.last_view_at || a.last_view_at >= fresh) return true;
      } catch (_) {}
    }
    return false;
  }

  /**
   * #2 visitor presence: 指定 session_token の訪問者がフォアグラウンド表示中なら true.
   * shop/cast メッセージ到着時の自動既読トリガに使う.
   */
  private isVisitorViewingToken(token: string): boolean {
    if (!token) return false;
    // 2026-04-23 (revised): last_view_at が付いていれば 45s 鮮度ゲート, 付いていなければ
    // 旧 chat.js / 互換 WS なので viewing_session_token 一致のみで viewing とみなす.
    const fresh = Date.now() - 45_000;
    const visitors = this.state.getWebSockets('role:visitor');
    for (const ws of visitors) {
      try {
        const a = ws.deserializeAttachment() as WsAttachment | null;
        if (!a) continue;
        if (a.session_token !== token || a.viewing_session_token !== token) continue;
        if (!a.last_view_at || a.last_view_at >= fresh) return true;
      } catch (_) {}
    }
    return false;
  }

  // 2026-04-23 ゼロ設計: autoReadIfOwnerViewing / autoReadIfVisitorViewing は全廃.
  // 既読は受信側クライアントが isWindowActive() 時に明示 mark-read を打つ 1 経路のみ.
  // 「送信した瞬間に自分のメッセージが既読化される」バグの原因だった.

  private broadcastToSession(sessionId: number, role: WsRole, payload: unknown): void {
    const clients = this.state.getWebSockets(`session:${sessionId}`);
    const json = JSON.stringify(payload);
    for (const ws of clients) {
      try {
        const a = ws.deserializeAttachment() as WsAttachment;
        if (a.role === role) ws.send(json);
      } catch (_) {}
    }
  }

  // ========== Alarm (heartbeat + retention) ==========

  private async ensureAlarm(): Promise<void> {
    const current = await this.state.storage.getAlarm();
    if (!current) {
      await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  async alarm(): Promise<void> {
    // 古いセッション(30日超)削除
    const cutoff = Date.now() - SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const sessions = await this.state.storage.list<ChatSession>({ prefix: 'session:', limit: 1000 });
    for (const [key, s] of sessions.entries()) {
      if (new Date(s.last_activity_at).getTime() < cutoff) {
        await this.state.storage.delete(key);
        await this.state.storage.delete(`session_by_token:${s.session_token}`);
        // そのセッションのメッセージも削除
        const msgs = await this.state.storage.list({ prefix: `message:${s.id}:`, limit: 10000 });
        for (const mk of msgs.keys()) await this.state.storage.delete(mk);
        await this.state.storage.delete(`msg_counter:${s.id}`);
      }
    }
    // 次回 alarm
    await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
  }

  // ========== Helpers ==========

  private isShopOnline(): boolean {
    // is_online (受付トグル) AND 現在が受付時間内 の AND 条件のみ true.
    // 受付時間外でもトグルONなら緑が残る問題を防ぐ (PHP effectiveOnline と同期).
    if (!this.shopMeta) return false;
    if (!this.shopMeta.is_online) return false;
    return this.isWithinReceptionHours();
  }

  private isWithinReceptionHours(): boolean {
    const start = this.shopMeta?.reception_start;
    const end = this.shopMeta?.reception_end;
    if (!start || !end || start === end) return true; // 24h 受付
    const now = new Date();
    // Asia/Tokyo の HH:MM を分に変換 (Cloudflare Workers は UTC なので +9h オフセット)
    const tokyoMs = now.getTime() + 9 * 60 * 60 * 1000;
    const tokyoNow = new Date(tokyoMs);
    const hm = tokyoNow.getUTCHours() * 60 + tokyoNow.getUTCMinutes();
    const toMin = (t: string) => {
      const [h, m] = t.split(':');
      return parseInt(h, 10) * 60 + parseInt(m || '0', 10);
    };
    const s = toMin(start);
    const e = toMin(end);
    if (s < e) return hm >= s && hm < e;
    // 日跨ぎ (例 18:00-05:00)
    return hm >= s || hm < e;
  }

  private okBatch(extra: Partial<BatchResponse>): Response {
    const body: BatchResponse = {
      ok: true,
      messages: extra.messages || [],
      status: extra.status ?? null,
      shop_online: extra.shop_online ?? null,
      last_read_own_id: extra.last_read_own_id || 0,
      server_time: new Date().toISOString(),
      ...extra,
    };
    return new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  private errJson(msg: string, status = 400): Response {
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

// ========== Push payload builders ==========

function truncateBody(s: string, max = 120): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// 訪問者→店舗/キャスト: オーナー/キャスト端末に表示.
function buildVisitorMessagePushPayload(shop: ShopStatus, sess: ChatSession, msg: ChatMessage): PushPayload {
  const who = sess.nickname && sess.nickname.trim() !== '' ? sess.nickname : 'ゲスト';
  const title = sess.cast_name
    ? `${sess.cast_name}｜${who}から新着メッセージ`
    : `${shop.shop_name || 'YobuChat'}｜${who}から新着メッセージ`;
  // URL: キャスト指名なら ?cast=... 、店舗直通なら shop slug のみ
  const base = `https://yobuho.com/chat/${encodeURIComponent(shop.slug || '')}/`;
  const url = sess.shop_cast_id
    ? `${base}?cast=${encodeURIComponent(sess.shop_cast_id)}&view=${encodeURIComponent(sess.session_token)}`
    : `${base}?view=${encodeURIComponent(sess.session_token)}`;
  return {
    title,
    body: truncateBody(msg.message),
    url,
    tag: `ychat-v-${sess.session_token.slice(0, 16)}`,
    icon: '/favicon.ico',
    renotify: true,
  };
}

// 店舗→訪問者: 訪問者端末に表示.
function buildOwnerReplyPushPayload(shop: ShopStatus, sess: ChatSession, msg: ChatMessage): PushPayload {
  const sender = sess.cast_name || shop.shop_name || 'YobuChat';
  const base = `https://yobuho.com/chat/${encodeURIComponent(shop.slug || '')}/`;
  const url = sess.shop_cast_id
    ? `${base}?cast=${encodeURIComponent(sess.shop_cast_id)}&resume=${encodeURIComponent(sess.session_token)}`
    : `${base}?resume=${encodeURIComponent(sess.session_token)}`;
  return {
    title: `${sender} から返信`,
    body: truncateBody(msg.message),
    url,
    tag: `ychat-o-${sess.session_token.slice(0, 16)}`,
    icon: '/favicon.ico',
    renotify: true,
  };
}

// 訪問者メール通知: オーナー/キャスト返信時に opt-in 済み訪問者へメール.
// PHP 側 (chat-notify-visitor.php) が visitor_notify_enabled / クールダウン / 解除リンク生成を担当.
// ここは単純に POST を打つだけ. DO 側で重い処理はしない.
async function sendVisitorEmailNotification(env: Env, shop: ShopStatus, sess: ChatSession, msg: ChatMessage): Promise<void> {
  if (!env.CHAT_NOTIFY_SECRET) return;
  const base = env.NOTIFY_BASE_URL || 'https://yobuho.com';
  try {
    await fetch(`${base}/api/chat-notify-visitor.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.CHAT_NOTIFY_SECRET,
        session_token: sess.session_token,
        shop_name: shop.shop_name,
        shop_slug: shop.slug,
        cast_name: sess.cast_name || null,
        shop_cast_id: sess.shop_cast_id || null,
        message: msg.message,
        sent_at: msg.sent_at,
      }),
    });
  } catch (e) {
    console.warn('[visitor-notify] fetch failed', e);
  }
}
