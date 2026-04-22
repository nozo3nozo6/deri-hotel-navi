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
      switch (path) {
        case '/session/start':     return this.httpStartSession(body);
        case '/session/send':      return this.httpSendMessage(body);
        case '/session/close':     return this.httpCloseSession(body);
        case '/owner/reply':       return this.httpOwnerReply(body);
        case '/owner/inbox':       return this.httpOwnerInbox(body);
        case '/owner/mark-read':   return this.httpOwnerMarkRead(body);
        case '/admin/purge':       return this.httpAdminPurge(req, body);
        case '/broadcast':         return this.httpBroadcast(req, body);
        case '/broadcast-read':    return this.httpBroadcastRead(req, body);
        case '/broadcast-typing':  return this.httpBroadcastTyping(req, body);
      }
    }

    return new Response('not found', { status: 404 });
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

  private async messagesSince(sessionId: number, sinceId: number, limit = 200): Promise<ChatMessage[]> {
    const start = `message:${sessionId}:${sinceId + 1}`;
    const end = `message:${sessionId}:\uffff`;
    const map = await this.state.storage.list<ChatMessage>({
      start,
      end,
      limit,
    });
    return Array.from(map.values());
  }

  private async messageByCmid(sessionId: number, cmid: string): Promise<ChatMessage | null> {
    const mid = await this.state.storage.get<number>(`cmid:${sessionId}:${cmid}`);
    if (!mid) return null;
    return (await this.state.storage.get<ChatMessage>(`message:${sessionId}:${mid}`)) || null;
  }

  // ========== HTTP handlers ==========

  private async httpStartSession(body: any): Promise<Response> {
    const token: string = body.session_token || crypto.randomUUID();
    const visitorHash: string = body.visitor_hash || '';
    const nickname: string = body.nickname || '';
    const lang: string = body.lang || 'ja';
    const source = body.source || 'standalone';
    const shopCastId: string = (body.cast || '').trim();

    let sess = await this.findSessionByToken(token);
    const isNew = !sess;

    // キャスト指名解決:
    // - 新規セッション: 必ず resolve
    // - 既存セッションで cast_id 未設定かつ URL に cast 指定あり: retrofit
    //   (旧 DO バージョンで作られた「cast 無視」セッションを救済)
    // - 既存セッションで cast_id 設定済み: 変えない（別キャストへの乗っ取り防止）
    const shouldResolveCast = !!(shopCastId && this.shopMeta?.shop_id && (isNew || (sess && !sess.cast_id)));
    let castInfo: { shop_cast_id?: string; cast_id?: string; cast_name?: string } = {};
    if (shouldResolveCast) {
      castInfo = await this.resolveCast(this.shopMeta!.shop_id, shopCastId);
    }

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
      };
      await this.saveSession(sess);
    } else if (castInfo.cast_id && !sess.cast_id) {
      // retrofit: 既存セッションに cast 情報を付与
      sess.shop_cast_id = castInfo.shop_cast_id || null;
      sess.cast_id = castInfo.cast_id;
      sess.cast_name = castInfo.cast_name || null;
      await this.saveSession(sess);
    }

    return this.okBatch({
      messages: [],
      status: sess.status,
      shop_online: this.isShopOnline(),
      session_token: sess.session_token,
      session_id: sess.id,
      cast_name: sess.cast_name || null,
    });
  }

  // shop_casts.id → cast_id + display_name を PHP から解決.
  // 承認済み(active)でなければ空を返す（店舗直通にフォールバック）.
  private async resolveCast(shopId: string, shopCastId: string): Promise<{ shop_cast_id?: string; cast_id?: string; cast_name?: string }> {
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

      // B-1: オーナーがそのスレッドを開いている場合、visitor 新着を即時既読化.
      //   - DO storage の read_at 即セット (owner 側リロード時の unread 計算に反映)
      //   - visitor WS に type:'read' push (既読マーカー即時表示)
      //   - MySQL mirror (sync.markRead) を waitUntil で非同期発火
      this.autoReadIfOwnerViewing(sess.session_token, sess.id, msg.id, msg.sent_at, msg);

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
    const sid = Number(body.session_id);
    const upTo = Number(body.up_to_id || 0);
    if (!sid) return this.errJson('missing_fields', 400);

    const msgs = await this.messagesSince(sid, 0);
    const now = new Date().toISOString();
    for (const m of msgs) {
      if (m.sender_type === 'visitor' && !m.read_at && (upTo === 0 || m.id <= upTo)) {
        m.read_at = now;
        await this.saveMessage(sid, m);
      }
    }
    this.broadcastToSession(sid, 'visitor', { type: 'read', session_id: sid, up_to_id: upTo });
    return this.okBatch({ messages: [], status: null, shop_online: this.isShopOnline() });
  }

  // DO storage 全消去 (shop_meta は保持). CHAT_SYNC_SECRET で認証.
  private async httpAdminPurge(req: Request, _body: any): Promise<Response> {
    const provided = req.headers.get('X-Sync-Secret') || '';
    const expected = this.env.CHAT_SYNC_SECRET || '';
    if (!expected || provided !== expected) {
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

    // セッション解決
    let session: ChatSession | null = null;
    if (role === 'visitor' && sessionToken) {
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
      server.send(JSON.stringify({
        type: 'snapshot',
        messages: newer,
        status: session.status,
        shop_online: this.isShopOnline(),
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
    let data: any;
    try { data = JSON.parse(message); } catch { return; }

    const attach = ws.deserializeAttachment() as WsAttachment;
    attach.heartbeat_at = Date.now();
    ws.serializeAttachment(attach);

    switch (data.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
        break;
      case 'send':
        // visitor: {text, client_msg_id} / owner: {session_id, text, client_msg_id}
        if (attach.role === 'visitor' && attach.session_token) {
          await this.httpSendMessage({
            session_token: attach.session_token,
            message: data.text,
            client_msg_id: data.client_msg_id,
            since_id: attach.last_since_id,
          });
        } else if (attach.role === 'owner') {
          await this.httpOwnerReply({
            session_id: data.session_id,
            message: data.text,
            client_msg_id: data.client_msg_id,
            since_id: attach.last_since_id,
          });
        }
        break;
      case 'mark-read':
        if (attach.role === 'owner' && data.session_id) {
          await this.httpOwnerMarkRead({ session_id: data.session_id, up_to_id: data.up_to_id });
        }
        break;
      case 'view':
        // B-1 (owner): オーナーが開いているスレッドの session_token を記録.
        //   visitor 新着メッセージ時に presence 一致すれば自動既読化.
        // #2 (visitor): 自分の画面が visible の間 session_token を自己セット.
        //   shop/cast 新着メッセージ時に presence あれば自動既読化 + owner/cast_inbox に read push.
        if (attach.role === 'owner') {
          const tok = data.session_token ? String(data.session_token) : undefined;
          attach.viewing_session_token = tok;
          ws.serializeAttachment(attach);
        } else if (attach.role === 'visitor') {
          // visitor は自分の session_token のみ登録可 (他セッションの既読は不可)
          const tok = data.session_token ? String(data.session_token) : undefined;
          if (!tok || tok === attach.session_token) {
            attach.viewing_session_token = tok;
            ws.serializeAttachment(attach);
          }
        }
        break;
      case 'close-session':
        if (attach.role === 'owner' && data.session_id) {
          await this.httpCloseSession({ session_id: data.session_id });
        }
        break;
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
    if (!expected || provided !== expected) {
      return this.errJson('forbidden', 403);
    }

    const token = String(body?.session_token || '');
    const row = body?.message_row;
    if (!token || !row || typeof row !== 'object') {
      return this.errJson('missing_fields', 400);
    }

    const payload = {
      type: 'message',
      data: row,
      session_token: token,
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

    // PHP 経由のメッセージ到着時の auto-read:
    //   - visitor 発 → owner が viewing なら read (B-1)
    //   - shop/cast 発 → visitor が viewing なら read (#2, 対称実装)
    // httpBroadcast の row は MySQL INSERT 直後なので DO storage は触らない (updateStorage=null).
    if (row) {
      const upToId = Number(row.id || 0);
      const upToSentAt = String(row.sent_at || new Date().toISOString());
      if (row.sender_type === 'visitor') {
        this.autoReadIfOwnerViewing(token, null, upToId, upToSentAt, null);
      } else if (row.sender_type === 'shop') {
        this.autoReadIfVisitorViewing(token, null, upToId, upToSentAt, null);
      }
    }

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
    if (!expected || provided !== expected) {
      return this.errJson('forbidden', 403);
    }

    const token = String(body?.session_token || '');
    const reader = String(body?.reader || '');
    const upTo = Number(body?.up_to_id || 0);
    if (!token || (reader !== 'shop' && reader !== 'visitor')) {
      return this.errJson('missing_fields', 400);
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
    if (!expected || provided !== expected) {
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
    const owners = this.state.getWebSockets('role:owner');
    for (const ws of owners) {
      try {
        const a = ws.deserializeAttachment() as WsAttachment | null;
        if (a && a.viewing_session_token === token) return true;
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
    const visitors = this.state.getWebSockets('role:visitor');
    for (const ws of visitors) {
      try {
        const a = ws.deserializeAttachment() as WsAttachment | null;
        if (a && a.session_token === token && a.viewing_session_token === token) return true;
      } catch (_) {}
    }
    return false;
  }

  /**
   * B-1: visitor メッセージが届いた時点でオーナーがそのスレッドを開いていれば
   *   - DO storage の msg.read_at を即時セット (必要なら)
   *   - visitor WS へ type:'read' broadcast (クライアント UI 即反映)
   *   - MySQL mirror (sync.markRead) を waitUntil で非同期発火
   * sessionId は DO 内 id / sessionToken は PHP↔DO 共通鍵.
   */
  private autoReadIfOwnerViewing(
    sessionToken: string,
    sessionId: number | null,
    upToId: number,
    upToSentAt: string,
    updateStorage: ChatMessage | null,
  ): void {
    if (!this.isOwnerViewingToken(sessionToken)) return;

    // 1) DO storage 側の read_at を埋める (httpSendMessage の即時発行分).
    //    httpBroadcast 経由は PHP が権威なので storage 更新はスキップ.
    if (updateStorage && sessionId != null && !updateStorage.read_at) {
      updateStorage.read_at = new Date().toISOString();
      this.state.waitUntil(this.saveMessage(sessionId, updateStorage));
    }

    // 2) visitor WS へ read push (session_token で照合).
    const payload = JSON.stringify({
      type: 'read',
      session_token: sessionToken,
      session_id: sessionId ?? undefined,
      up_to_id: upToId,
    });
    const all = this.state.getWebSockets();
    for (const ws of all) {
      try {
        const a = ws.deserializeAttachment() as WsAttachment | null;
        if (a && a.role === 'visitor' && a.session_token === sessionToken) {
          ws.send(payload);
        }
      } catch (_) {}
    }

    // 3) MySQL 反映 (PHP handleMarkRead が chat_messages.read_at を UPDATE).
    //    reader='shop' → sender_type='visitor' を既読化.
    if (upToSentAt) {
      this.state.waitUntil(this.sync.markRead(sessionToken, 'shop', upToSentAt));
    }
  }

  /**
   * #2: shop/cast メッセージが届いた時点で visitor がそのスレッドを開いていれば
   *   - DO storage の msg.read_at を即時セット (必要なら)
   *   - owner / cast_inbox WS へ type:'read' broadcast (送信者UIの既読マーカー即時反映)
   *   - MySQL mirror (sync.markRead reader='visitor') を waitUntil で非同期発火
   * (B-1 の owner 視点と対称の実装).
   */
  private autoReadIfVisitorViewing(
    sessionToken: string,
    sessionId: number | null,
    upToId: number,
    upToSentAt: string,
    updateStorage: ChatMessage | null,
  ): void {
    if (!this.isVisitorViewingToken(sessionToken)) return;

    // 1) DO storage 側の read_at を埋める (httpSendMessage owner path からの直接呼びのみ).
    if (updateStorage && sessionId != null && !updateStorage.read_at) {
      updateStorage.read_at = new Date().toISOString();
      this.state.waitUntil(this.saveMessage(sessionId, updateStorage));
    }

    // 2) owner WS に read push (全 owner に配信. owner 側 UI は session_token で自分向け判定).
    const payload = JSON.stringify({
      type: 'read',
      session_token: sessionToken,
      session_id: sessionId ?? undefined,
      up_to_id: upToId,
    });
    const all = this.state.getWebSockets();
    for (const ws of all) {
      try {
        const a = ws.deserializeAttachment() as WsAttachment | null;
        if (a && a.role === 'owner') ws.send(payload);
      } catch (_) {}
    }

    // 3) MySQL 反映. reader='visitor' → sender_type='shop' を既読化.
    if (upToSentAt) {
      this.state.waitUntil(this.sync.markRead(sessionToken, 'visitor', upToSentAt));
    }
  }

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
    // A案 (厳格2値ルール): is_online フラグのみで判定。
    // auto_off_minutes による時間経過オフは廃止 — 時間帯制御は受付時間側で行う。
    if (!this.shopMeta) return false;
    return !!this.shopMeta.is_online;
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
