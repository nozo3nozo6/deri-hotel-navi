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

const HEARTBEAT_INTERVAL_MS = 30_000;        // 30s
const ALARM_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h retention sweep
const SESSION_RETENTION_DAYS = 30;

const router = buildDefaultRouter();

export class ChatRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private shopMeta: ShopStatus | null = null;
  private initialized = false;
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

    // shopMeta の初期化 (Router から Shop 情報を JSON で渡される)
    if (!this.initialized) {
      await this.loadShopMeta(req);
      this.initialized = true;
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

    let sess = await this.findSessionByToken(token);
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
      };
      await this.saveSession(sess);
    }

    return this.okBatch({
      messages: [],
      status: sess.status,
      shop_online: this.isShopOnline(),
      session_token: sess.session_token,
      session_id: sess.id,
    });
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

      // 通知 (初回 or every)
      const first = !sess.notified_at;
      if (this.shopMeta) {
        await router.notify(
          ['email'],
          {
            shop: this.shopMeta,
            session_id: sess.id,
            session_token: sess.session_token,
            nickname: sess.nickname,
            message: msg,
            first_in_session: first,
          },
          this.env
        );
        if (first) {
          sess.notified_at = msg.sent_at;
          await this.saveSession(sess);
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
    // 受信箱: 全セッション + 各々のlast msg
    const map = await this.state.storage.list<ChatSession>({ prefix: 'session:', limit: 100 });
    const sessions: any[] = [];
    for (const s of map.values()) {
      // 最新メッセージ1件
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

  private broadcastToRole(role: WsRole, payload: unknown): void {
    const clients = this.state.getWebSockets(`role:${role}`);
    const json = JSON.stringify(payload);
    for (const ws of clients) {
      try { ws.send(json); } catch (_) {}
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
