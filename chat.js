// chat.js — YobuCha (スタンドアロンチャット + ウィジェット共用)
// モード:
//   - 訪問者: session_token (localStorage:chat_session_<slug>) で会話継続
//   - オーナー: device_token (localStorage:chat_owner_token) 優先、無ければ
//               shop-auth PHPセッションから自動発行
//   - URLパスでのトークン受け渡しは廃止（セキュリティ強化）

(function(){
'use strict';

const API = '/api/chat-api.php';
const SHOP_AUTH_API = '/api/shop-auth.php';
const POLL_INTERVAL = 10000; // 10秒
const INBOX_INTERVAL = 15000;

// ===== URL から slug 取得 =====
function getSlug() {
    const m = window.location.pathname.match(/^\/chat\/([^\/?]+)\/?/);
    if (m) return decodeURIComponent(m[1]);
    const p = new URLSearchParams(window.location.search);
    return p.get('slug') || '';
}

// キャスト指名: ?cast=<shop_cast_id> があれば該当キャスト宛の session として start する.
// サーバー側で承認済み(active)か検証し、非activeなら店舗直通に fallback する.
function getCastParam() {
    try {
        const p = new URLSearchParams(window.location.search);
        const v = (p.get('cast') || '').trim();
        return /^[A-Za-z0-9\-]{8,40}$/.test(v) ? v : '';
    } catch (_) { return ''; }
}

// キャスト閲覧専用モード: ?cast=&view=<session_token> で既存訪問者セッションを read-only 表示.
// chat-notify.php がキャスト宛通知メールに付与する. 入力UIは全非表示, キャストは電話/LINEで返信する.
// session_token の形式は 2 種: DO発行=UUID (8-4-4-4-12, ハイフン含む36文字), PHP発行=bin2hex 48桁hex.
// 両方許容するため [a-f0-9\-]{32,64} で判定.
function getViewToken() {
    try {
        const p = new URLSearchParams(window.location.search);
        const v = (p.get('view') || '').trim().toLowerCase();
        return /^[a-f0-9\-]{32,64}$/.test(v) ? v : '';
    } catch (_) { return ''; }
}

// キャスト自分用受信箱: ?cast_inbox=<uuid> (shop_casts.inbox_token) で受信箱モード.
// cast-admin でブックマーク用URLを発行. 店舗オーナーの device_token は使わず URL-only auth で PHP API を叩く.
function getCastInboxToken() {
    try {
        const p = new URLSearchParams(window.location.search);
        const v = (p.get('cast_inbox') || '').trim().toLowerCase();
        return /^[a-f0-9\-]{32,36}$/.test(v) ? v : '';
    } catch (_) { return ''; }
}

const SLUG = getSlug();
const CAST_ID = getCastParam();
const VIEW_TOKEN = getViewToken();
const CAST_INBOX_TOKEN = getCastInboxToken();
const IS_CAST_VIEW = !!(CAST_ID && VIEW_TOKEN);
const IS_CAST_INBOX = !!CAST_INBOX_TOKEN;
if (!SLUG) {
    document.getElementById('chat-root').innerHTML = '<div style="padding:40px;text-align:center;color:#888;">チャットURLが不正です</div>';
    return;
}

const LS_SESSION = 'chat_session_' + SLUG + '_' + (CAST_ID || 'shop');
const LS_NICKNAME = 'chat_nickname_' + SLUG;
const LS_DEVICE  = 'chat_owner_token';
// キャスト受信箱 端末登録: URL + device_token の2要素。URL漏洩時の防壁.
const LS_CAST_DEVICE = CAST_INBOX_TOKEN ? ('cast_device_' + CAST_INBOX_TOKEN) : '';
function getCastDeviceToken() {
    if (!LS_CAST_DEVICE) return '';
    try { return localStorage.getItem(LS_CAST_DEVICE) || ''; } catch (_) { return ''; }
}
function setCastDeviceToken(token) {
    if (!LS_CAST_DEVICE) return;
    try { localStorage.setItem(LS_CAST_DEVICE, token); } catch (_) {}
}

// ===== State =====
let state = {
    mode: 'visitor',        // 'visitor' | 'owner'
    shop_name: '',
    shop_id: '',
    is_online: false,
    session_token: '',
    session_id: 0,
    last_message_id: 0,
    last_read_own_id: 0,
    last_msg_date: '',
    device_token: '',
    inbox_sessions: [],
    selected_session: null,
    templates: [],
    _visitorSub: null,
    _ownerSub: null,
    is_reception_hours: true,
    reception_start: null,
    reception_end: null,
    next_reception_start: null,
    reception_banner_timer: null,
    welcome_message: null,
    reservation_hint: null,
    nickname_locked: false,   // 最初の訪問者メッセージ送信後に true: このチャット内ではニックネーム固定
};

// ===== DOM refs =====
const $ = id => document.getElementById(id);
const refs = {
    root: $('chat-root'),
    shopName: $('chat-shop-name'),
    visitorName: $('chat-visitor-name'),
    btnHeaderBack: $('btn-header-back'),
    statusDot: $('chat-status-dot'),
    statusLabel: $('chat-status-label'),
    ownerToggle: $('chat-owner-toggle'),
    onlineToggle: $('online-toggle'),
    ownerLoginLink: $('owner-login-link'),
    footerBrand: $('footer-brand'),
    fontSizeBtn: $('font-size-toggle'),
    langSelect: $('lang-select'),
    ownerInbox: $('owner-inbox'),
    inboxList: $('inbox-list'),
    chatThread: $('chat-thread'),
    chatMessages: $('chat-messages'),
    quickQuestions: $('quick-questions'),
    visitorNote: $('visitor-note'),
    reservationHint: $('reservation-hint'),
    castViewBanner: $('cast-view-banner'),
    ownerQuick: $('owner-quick'),
    visitorQuick: $('visitor-quick'),
    emojiToggle: $('emoji-toggle'),
    nicknameArea: document.getElementById('nickname-area'),
    nicknameInput: document.getElementById('visitor-nickname'),
    ownerTemplates: $('owner-templates'),
    templateList: $('template-list'),
    inputArea: $('chat-input-area'),
    input: $('chat-input'),
    sendBtn: $('chat-send'),
    btnRefresh: $('btn-refresh-inbox'),
    btnBlock: $('btn-block-user'),
    btnCloseSession: $('btn-close-session'),
    btnOwnerLogout: $('btn-owner-logout'),
    error: $('chat-error'),
    loginModal: $('owner-login-modal'),
    loginForm: $('owner-login-form'),
    loginEmail: $('owner-login-email'),
    loginPassword: $('owner-login-password'),
    loginError: $('owner-login-error'),
    loginSubmit: $('owner-login-submit'),
    loginClose: $('owner-login-close'),
};

// ===== ユーティリティ =====
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showError(msg) {
    refs.error.textContent = msg;
    refs.error.classList.remove('hidden');
    setTimeout(() => refs.error.classList.add('hidden'), 3500);
}
function setLoading(on) { refs.root.classList.toggle('loading', on); }
function setThemeMode(mode) {
    const m = ['men','women','men_same','women_same','este'].includes(mode) ? mode : 'men';
    try { document.body.dataset.mode = m; } catch (_) {}
}
// MySQL形式("YYYY-MM-DD HH:MM:SS"、JSTとして扱う) と ISO8601("...T...Z" or "...+00:00") の両対応
function parseChatDate(s) {
    if (!s) return null;
    // ISO8601 は new Date() がそのまま解釈可能
    if (/[TZ]/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }
    // MySQL DATETIME は JST として補正
    const d = new Date(s.replace(' ', 'T') + '+09:00');
    return isNaN(d.getTime()) ? null : d;
}
function formatTime(s) {
    const d = parseChatDate(s);
    if (!d) return '';
    return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}
function getDateKey(s) {
    const d = parseChatDate(s);
    if (!d) return '';
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function formatDateLabel(key) {
    if (!key) return '';
    const now = new Date();
    const today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    const y = new Date(now); y.setDate(y.getDate()-1);
    const yday = y.getFullYear() + '-' + String(y.getMonth()+1).padStart(2,'0') + '-' + String(y.getDate()).padStart(2,'0');
    if (key === today) return t('date.today') || '今日';
    if (key === yday) return t('date.yesterday') || '昨日';
    const [yr, mo, da] = key.split('-');
    return yr + '年' + Number(mo) + '月' + Number(da) + '日';
}

async function api(action, params, method, baseUrl) {
    method = method || 'POST';
    const base = baseUrl || API;
    const url = method === 'GET'
        ? `${base}?action=${encodeURIComponent(action)}&${new URLSearchParams(params || {}).toString()}`
        : `${base}?action=${encodeURIComponent(action)}`;
    const opts = {
        method,
        credentials: 'include',
        headers: method === 'POST' ? {'Content-Type': 'application/json'} : {}
    };
    if (method === 'POST') opts.body = JSON.stringify(params || {});
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false || data.error) {
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.status = res.status;
        err.authFailed = res.status === 401 && /device/i.test(data.error || '');
        throw err;
    }
    return data;
}

// 401 device_token無効を検知したら polling を止めて再ログインを促す（reload はしない）
let _authRecovering = false;
function handleDeviceAuthFailure() {
    if (_authRecovering) return;
    _authRecovering = true;
    try {
        if (state._ownerSub) { state._ownerSub.stop(); state._ownerSub = null; }
        if (state._visitorSub) { state._visitorSub.stop(); state._visitorSub = null; }
    } catch (_) {}
    try { localStorage.removeItem(LS_DEVICE); } catch (_) {}
    state.device_token = null;
    try { showError('セッションが切れました。「店舗オーナーの方はこちら」から再ログインしてください'); } catch (_) {}
    // owner-login-link を表示（訪問者モードに落とさず、オーナーが再ログインできるようにする）
    try { if (refs.ownerLoginLink) refs.ownerLoginLink.classList.remove('owner-login-link-hidden'); } catch (_) {}
    setTimeout(() => { _authRecovering = false; }, 30000);
}

// UUID v4 生成 (client_msg_id 用). crypto.randomUUID が使えない古環境でのフォールバック付き.
function uuidv4() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // RFC 4122 v4 フォールバック
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

// ===== Transport Layer =====
// メッセージ配信・送信を抽象化。現在はHTTP polling、将来はWebSocket/Cloudflare Durable Objectsに
// 差し替え可能。UIコード（enter*Mode / addMessage / renderInbox 等）は触らずに swap できる。
//
// DO移行時の手順:
//   1) DurableObjectTransport を実装（subscribe* / send* 同じシグネチャ）
//      - shop_id → DO instance にマッピング（stub.fetch('/ws')）
//      - WebSocket.onmessage → onBatch({messages, shop_online, status, last_read_own_id, ...})
//   2) 下の `const Transport = PollingTransport;` を差し替えるだけ
//   3) send* は WS で broadcast or HTTP のまま (Cloudflare推奨: 書き込みはHTTP、購読はWS)
//
// 契約:
//   - Transport.subscribeVisitor / subscribeOwner は {stop} ハンドルを返す
//   - Transport.sendVisitor / sendOwner は {message_id, client_msg_id, messages[], ...} を返す
//   - client_msg_id を呼び出し元が生成して渡す (冪等送信: ネットワーク再送でも重複しない)
//   - onBatch が受け取るデータ: {messages[], shop_online, status, last_read_own_id, server_time, ...}
const PollingTransport = {
    kind: 'polling',

    // 訪問者: 自分のセッションの新着メッセージを購読
    subscribeVisitor({ getSessionToken, getSinceId, onBatch, intervalMs }) {
        let active = true;
        const tick = async () => {
            if (!active) return;
            const token = getSessionToken();
            if (!token) return;
            try {
                const data = await api('poll-messages', {
                    session_token: token,
                    since_id: getSinceId()
                }, 'GET');
                if (active) onBatch(data);
            } catch (_) { /* retry next tick */ }
        };
        const timer = setInterval(tick, intervalMs || POLL_INTERVAL);
        return { stop: () => { active = false; clearInterval(timer); } };
    },

    // オーナー: 受信箱 or 選択中スレッドを購読（selected_session の有無で自動切替）
    subscribeOwner({ getDeviceToken, getSelectedSessionId, getSinceId, onBatch, intervalMs }) {
        let active = true;
        const tick = async () => {
            if (!active) return;
            const dt = getDeviceToken();
            if (!dt) return;
            try {
                const sid = getSelectedSessionId();
                const since = sid && getSinceId ? getSinceId() : 0;
                const params = sid
                    ? { device_token: dt, session_id: sid, since_id: since }
                    : { device_token: dt };
                const data = await api('owner-inbox', params, 'GET');
                if (active) onBatch(data, sid);
            } catch (e) {
                if (e && e.authFailed) { active = false; clearInterval(timer); handleDeviceAuthFailure(); return; }
                /* retry next tick */
            }
        };
        const timer = setInterval(tick, intervalMs || INBOX_INTERVAL);
        return { stop: () => { active = false; clearInterval(timer); } };
    },

    // 訪問者: セッション作成
    async startVisitorSession({ shopSlug, source, sessionToken, cast }) {
        const payload = { shop_slug: shopSlug, source };
        if (sessionToken) payload.session_token = sessionToken;
        if (cast) payload.cast = cast;
        return api('start-session', payload);
    },

    // 訪問者: メッセージ送信 (client_msg_id で冪等化)
    async sendVisitor({ sessionToken, message, nickname, lang, clientMsgId, sinceId }) {
        return api('send-message', {
            session_token: sessionToken,
            message,
            nickname: nickname || '',
            lang: lang || '',
            client_msg_id: clientMsgId,
            since_id: sinceId || 0
        });
    },

    // オーナー: メッセージ送信 (client_msg_id で冪等化)
    async sendOwner({ deviceToken, sessionId, message, clientMsgId, sinceId }) {
        return api('owner-reply', {
            device_token: deviceToken,
            session_id: sessionId,
            message,
            client_msg_id: clientMsgId,
            since_id: sinceId || 0
        });
    },

    // subscribe前のゲート判定. WS版でもconnect拒否を同形で返せる.
    async canConnect({ sessionToken, shopSlug }) {
        const params = sessionToken ? { session_token: sessionToken } : { shop_slug: shopSlug };
        return api('can-connect', params, 'GET');
    },

    // オーナー: チャットを終了
    async closeSession({ deviceToken, sessionId, sessionToken: _t }) {
        return api('close-session', { device_token: deviceToken, session_id: sessionId });
    }
};

// =========================================================
// DurableObjectTransport (Cloudflare Durable Objects + WebSocket Hibernation)
// - chat.yobuho.com Worker に WebSocket で接続. 購読は WS, 送信は HTTP POST.
// - PollingTransport と同じシグネチャ (subscribeVisitor/subscribeOwner/sendVisitor/sendOwner/canConnect).
// - 差替えは「const Transport = DurableObjectTransport;」1行のみ.
// =========================================================
const DO_BASE = (window.CHAT_WORKER_URL || 'https://chat.yobuho.com').replace(/\/$/, '');
const DO_WS_BASE = DO_BASE.replace(/^http/, 'ws');

async function doFetch(path, payload, method = 'POST') {
    const url = `${DO_BASE}${path}?shop_slug=${encodeURIComponent(SLUG)}`;
    const init = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
    };
    if (method === 'POST') init.body = JSON.stringify(payload || {});
    let res;
    try {
        res = await fetch(url, init);
    } catch (netErr) {
        const err = new Error(`network_error: ${netErr.message || netErr.name || 'fetch failed'} @ ${path}`);
        err.cause = netErr;
        throw err;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false || data.error) {
        const err = new Error(data.error || `do_fetch_${res.status} @ ${path}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

function openDoWebSocket(query) {
    const qs = new URLSearchParams({ shop_slug: SLUG, ...query }).toString();
    return new WebSocket(`${DO_WS_BASE}/ws?${qs}`);
}

const DurableObjectTransport = {
    kind: 'durable-object',

    subscribeVisitor({ getSessionToken, getSinceId, onBatch, intervalMs: _iv }) {
        let active = true;
        let ws = null;
        let reconnectTimer = null;
        let heartbeat = null;

        const connect = () => {
            if (!active) return;
            const token = getSessionToken();
            if (!token) { reconnectTimer = setTimeout(connect, 2000); return; }
            try {
                ws = openDoWebSocket({ role: 'visitor', token, since_id: String(getSinceId() || 0) });
            } catch (_) { reconnectTimer = setTimeout(connect, 2000); return; }

            ws.addEventListener('message', (ev) => {
                if (!active) return;
                try {
                    const data = JSON.parse(ev.data);
                    if (data.type === 'pong') return;
                    // WS push (type:'message'/'status'/'read') を applyVisitorBatch が期待する
                    // {messages[], status, last_read_own_id, shop_online} 形に正規化
                    if (data.type === 'message' && data.data) {
                        onBatch({ messages: [data.data] });
                        return;
                    }
                    if (data.type === 'status') {
                        onBatch({ messages: [], status: data.status });
                        return;
                    }
                    if (data.type === 'read') {
                        onBatch({ messages: [], last_read_own_id: data.up_to_id });
                        return;
                    }
                    // snapshot / batch 応答はそのまま通す
                    onBatch(data);
                } catch (_) {}
            });
            ws.addEventListener('close', () => {
                if (!active) return;
                clearInterval(heartbeat);
                reconnectTimer = setTimeout(connect, 3000);
            });
            ws.addEventListener('error', () => { try { ws.close(); } catch (_) {} });
            ws.addEventListener('open', () => {
                heartbeat = setInterval(() => {
                    try { ws.send(JSON.stringify({ type: 'ping' })); } catch (_) {}
                }, 30000);
            });
        };
        connect();

        return {
            stop: () => {
                active = false;
                clearTimeout(reconnectTimer);
                clearInterval(heartbeat);
                try { ws && ws.close(); } catch (_) {}
            },
        };
    },

    subscribeOwner({ getDeviceToken, getSelectedSessionId, getSinceId, onBatch, intervalMs: _iv }) {
        let active = true;
        let ws = null;
        let reconnectTimer = null;
        let heartbeat = null;

        const connect = () => {
            if (!active) return;
            const dt = getDeviceToken();
            if (!dt) { reconnectTimer = setTimeout(connect, 2000); return; }
            try {
                ws = openDoWebSocket({ role: 'owner', device: dt });
            } catch (_) { reconnectTimer = setTimeout(connect, 2000); return; }

            ws.addEventListener('message', (ev) => {
                if (!active) return;
                try {
                    const data = JSON.parse(ev.data);
                    if (data.type === 'pong') return;
                    const selectedSid = getSelectedSessionId();
                    // selectedSid (PHP 由来の MySQL id) と DO session_id は独立カウンタで一致しない.
                    // 選択中スレッド判定は state.selected_session.session_token と
                    // broadcast payload の session_token で照合する.
                    const curTok = state.selected_session && state.selected_session.session_token;
                    const matchSelected = (curTok && data.session_token && curTok === data.session_token)
                        || (selectedSid && data.session_id === selectedSid);
                    // WS push の正規化
                    if (data.type === 'message' && data.data) {
                        if (matchSelected) {
                            // 選択中スレッドの新着 → messages として適用
                            onBatch({ messages: [data.data] }, selectedSid);
                        } else if (!selectedSid) {
                            // 受信箱ビュー中 → PHP owner-inbox を再取得して未読/last_message更新
                            refreshInboxViaPhp();
                        } else {
                            // 他スレッド宛の push → 未読バッジ更新のため inbox を裏で再取得
                            refreshInboxViaPhp();
                        }
                        return;
                    }
                    if (data.type === 'status') {
                        if (matchSelected) {
                            onBatch({ messages: [], status: data.status }, selectedSid);
                        } else if (!selectedSid) {
                            refreshInboxViaPhp();
                        }
                        return;
                    }
                    if (data.type === 'read') {
                        if (matchSelected) {
                            onBatch({ messages: [], last_read_own_id: data.up_to_id }, selectedSid);
                        }
                        return;
                    }
                    if (data.type === 'inbox') {
                        // DO の inbox スナップショットは read_at を持たない (PHP 側が権威) ため無視.
                        // 代わりに PHP owner-inbox を叩いて MySQL 基準の未読状態を取得する.
                        if (!selectedSid) refreshInboxViaPhp();
                        return;
                    }
                    onBatch(data, selectedSid);
                } catch (_) {}
            });
            ws.addEventListener('close', () => {
                if (!active) return;
                clearInterval(heartbeat);
                reconnectTimer = setTimeout(connect, 3000);
            });
            ws.addEventListener('error', () => { try { ws.close(); } catch (_) {} });
            ws.addEventListener('open', () => {
                heartbeat = setInterval(() => {
                    try { ws.send(JSON.stringify({ type: 'ping' })); } catch (_) {}
                }, 30000);
            });
        };

        // inbox 再取得ヘルパ.
        // DO の inbox は read_at を保持しない (MySQL/PHP が権威) ため, PHP owner-inbox を叩く.
        // これにより owner がスレッドを開いて PHP が read_at=NOW() を打った後も未読カウントが正しくクリアされる.
        const refreshInboxViaPhp = async () => {
            try {
                const dt = getDeviceToken();
                if (!dt) return;
                const data = await api('owner-inbox', { device_token: dt }, 'GET');
                onBatch(data, null);
            } catch (_) {}
        };

        connect();

        return {
            stop: () => {
                active = false;
                clearTimeout(reconnectTimer);
                clearInterval(heartbeat);
                try { ws && ws.close(); } catch (_) {}
            },
        };
    },

    async startVisitorSession({ shopSlug: _s, source, sessionToken, cast }) {
        const payload = { source: source || 'standalone' };
        if (sessionToken) payload.session_token = sessionToken;
        if (cast) payload.cast = cast;
        return doFetch('/session/start', payload);
    },

    async sendVisitor({ sessionToken, message, nickname, lang, clientMsgId, sinceId }) {
        return doFetch('/session/send', {
            session_token: sessionToken,
            message,
            nickname: nickname || '',
            lang: lang || '',
            client_msg_id: clientMsgId,
            since_id: sinceId || 0,
        });
    },

    async sendOwner({ deviceToken, sessionId, sessionToken, message, clientMsgId, sinceId }) {
        // session_id は PHP owner-inbox 由来の MySQL auto_increment ID であり DO 内部 ID と一致しない.
        // session_token を優先して DO 側で findSessionByToken できるようにする.
        return doFetch('/owner/reply', {
            device_token: deviceToken,
            session_id: sessionId,
            session_token: sessionToken || '',
            message,
            client_msg_id: clientMsgId,
            since_id: sinceId || 0,
        });
    },

    async canConnect({ sessionToken: _t, shopSlug: _s }) {
        return doFetch('/can-connect', null, 'GET');
    },

    async closeSession({ deviceToken: _d, sessionId, sessionToken }) {
        return doFetch('/session/close', { session_id: sessionId, session_token: sessionToken });
    },
};

// 現在の有効トランスポート。
// - デフォルト: DurableObjectTransport (chat.yobuho.com Worker + DO, WebSocket Hibernation でリアルタイム配信)
// - 個別店舗で問題が起きた際は DO_DENYLIST_SLUGS にその slug を追加して PHP polling へフォールバック
const DO_DENYLIST_SLUGS = [];
const Transport = DO_DENYLIST_SLUGS.includes(SLUG) ? PollingTransport : DurableObjectTransport;

// ===== i18n =====
// 辞書は /chat-i18n.json から fetch。chat-widget-inline.html とは同一ソースを共有（scripts/build-chat-widget.js が注入）
const LS_LANG = 'chat_lang_' + SLUG;
let I18N = { ja: { 'load': '読み込み中…' } }; // fetch完了まで最小限
async function loadI18N() {
    try {
        const res = await fetch('/chat-i18n.json?v=46', { cache: 'force-cache' });
        if (res.ok) I18N = await res.json();
    } catch (_) {}
}
let currentLang = 'ja';
function t(key) { return (I18N[currentLang] && I18N[currentLang][key]) || (I18N.ja[key] || key); }
function applyLang(lang) {
    if (!I18N[lang]) lang = 'ja';
    currentLang = lang;
    document.documentElement.setAttribute('lang', lang);
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    const loginModal = document.getElementById('owner-login-modal');
    if (loginModal) {
        const title = loginModal.querySelector('#owner-login-title'); if (title) title.textContent = t('login.title');
        const desc = loginModal.querySelector('.owner-login-desc'); if (desc) desc.textContent = t('login.desc');
        const spans = loginModal.querySelectorAll('.owner-login-label > span');
        if (spans[0]) spans[0].textContent = t('login.email');
        if (spans[1]) spans[1].textContent = t('login.password');
        const submit = loginModal.querySelector('#owner-login-submit'); if (submit) submit.textContent = t('login.submit');
        const note = loginModal.querySelector('.owner-login-note'); if (note) note.textContent = t('login.note');
    }
    if (state && state.is_online !== undefined) updateStatusIndicator(state.is_online);
    // 動的生成の文字を再描画
    try {
        if (refs.ownerLoginLink) refs.ownerLoginLink.textContent = t('owner.loginLink');
        if ((state.mode === 'owner' || state.mode === 'cast_owner') && state.inbox_sessions && refs.ownerInbox && !refs.ownerInbox.classList.contains('hidden')) {
            renderInbox();
        }
        if (state.mode === 'visitor') renderReceptionBanner();
        // 選択中のスレッドのヘッダー名
        if ((state.mode === 'owner' || state.mode === 'cast_owner') && state.selected_session && refs.visitorName && !refs.visitorName.classList.contains('hidden')) {
            const s = state.selected_session;
            refs.visitorName.textContent = s.nickname ? s.nickname : `${t('inbox.visitorPrefix')} #${s.id}`;
        }
        // 既読マーク
        document.querySelectorAll('.msg-read').forEach(el => { el.textContent = t('msg.read'); });
        // ブロックボタンの label（ブロック済み/未ブロックで切替が必要）
        if (refs.btnBlock) {
            const isBlocked = refs.btnBlock.dataset.blocked === '1';
            refs.btnBlock.textContent = t(isBlocked ? 'thread.unblock' : 'thread.block');
        }
    } catch (_) {}
    try { localStorage.setItem(LS_LANG, lang); } catch (_) {}
}

// ===== フォントサイズ =====
const LS_FONT_SIZE = 'chat_font_size_' + SLUG;
const FONT_SIZES = ['s', 'm', 'l', 'xl'];
const FONT_SIZE_LABELS = { s: '小', m: '中', l: '大', xl: '特大' };
function applyFontSize(size) {
    if (!FONT_SIZES.includes(size)) size = 'm';
    refs.root.setAttribute('data-font-size', size);
    const label = document.getElementById('font-size-label');
    if (label) label.textContent = FONT_SIZE_LABELS[size];
    try { localStorage.setItem(LS_FONT_SIZE, size); } catch (_) {}
}
function cycleFontSize() {
    const cur = refs.root.getAttribute('data-font-size') || 'm';
    const idx = FONT_SIZES.indexOf(cur);
    applyFontSize(FONT_SIZES[(idx + 1) % FONT_SIZES.length]);
}

// ===== 初期化 =====
async function init() {
    await loadI18N();
    try {
        const savedLang = localStorage.getItem(LS_LANG);
        const browserLang = (navigator.language || 'ja').slice(0, 2);
        const initLang = savedLang || (I18N[browserLang] ? browserLang : 'ja');
        if (refs.langSelect) refs.langSelect.value = initLang;
        applyLang(initLang);
    } catch (_) { applyLang('ja'); }
    if (refs.langSelect) {
        const onLangChange = e => { if (e.target && e.target.id === 'lang-select') applyLang(e.target.value); };
        refs.langSelect.addEventListener('change', onLangChange);
        refs.langSelect.addEventListener('input', onLangChange);
    }

    try {
        const saved = localStorage.getItem(LS_FONT_SIZE);
        applyFontSize(saved || 'm');
    } catch (_) { applyFontSize('m'); }
    if (refs.fontSizeBtn) refs.fontSizeBtn.addEventListener('click', cycleFontSize);
    await _init();
}
async function _init() {
    try {
        // ?cast_inbox=<uuid>: キャスト自分用受信箱. オーナー類似UIで cast-inbox 系 API を叩く.
        // 店舗の device_token も shop-auth セッションも使わず URL-only auth.
        // URL に cast_inbox が指定されていれば、トークン形式が不正でも訪問者画面には落とさず明示エラー.
        // (silent fallback にすると URL指定時のバグが見えなくなり、診断に時間がかかる)
        const rawInboxParam = (() => {
            try { return new URLSearchParams(window.location.search).get('cast_inbox') || ''; }
            catch (_) { return ''; }
        })();
        if (rawInboxParam) {
            if (!IS_CAST_INBOX) {
                refs.root.innerHTML = '<div style="padding:40px;text-align:center;color:#c0392b;">キャスト受信箱URLが不正です (token形式エラー)</div>';
                return;
            }
            await enterCastOwnerMode();
            setLoading(false);
            return;
        }

        // ?cast=&view=<session_token>: キャスト宛メール通知URL. 既存訪問者セッションを閲覧専用で表示.
        if (IS_CAST_VIEW) {
            const status = await api('shop-status', { shop_slug: SLUG }, 'GET');
            if (!status.chat_enabled) {
                refs.root.innerHTML = '<div style="padding:40px;text-align:center;color:#888;">この店舗ではYobuChatをご利用いただけません</div>';
                return;
            }
            state.shop_name = status.shop_name;
            state.is_online = status.is_online;
            applyReceptionStatus(status);
            setThemeMode(status.gender_mode);
            await enterCastViewMode();
            setLoading(false);
            return;
        }

        // ?cast=... 指名URLの場合は必ず訪問者モード。
        // 店舗オーナーが同じブラウザで開いた時にオーナー画面へ乗っ取られるのを防ぐ。
        if (!CAST_ID) {
            // 1. localStorage の device_token で verify-device
            let savedToken = null;
            try { savedToken = localStorage.getItem(LS_DEVICE); } catch (_) { savedToken = null; }
            if (savedToken) {
                try {
                    const dev = await api('verify-device', { device_token: savedToken });
                    if (dev.slug === SLUG) {
                        state.mode = 'owner';
                        state.device_token = savedToken;
                        state.shop_name = dev.shop_name;
                        state.notify_enabled = dev.notify_enabled !== false;
                        setThemeMode(dev.gender_mode);
                        await enterOwnerMode();
                        setLoading(false);
                        return;
                    }
                    // slug不一致 → トークン削除（他店アクセス）
                    localStorage.removeItem(LS_DEVICE);
                } catch (e) {
                    // トークン無効 → 削除
                    localStorage.removeItem(LS_DEVICE);
                }
            }

            // 2. shop-auth PHPセッション確認（店舗オーナーがshop-admin経由でログイン済みか）
            try {
                const chk = await fetch(SHOP_AUTH_API + '?action=check', { credentials: 'include' });
                const chkData = await chk.json().catch(() => ({}));
                if (chkData.authenticated && chkData.shop && chkData.shop.slug === SLUG) {
                    // 自動的に device_token 発行 → オーナーモード
                    try {
                        const reg = await api('register-device', { device_name: 'ブラウザ自動登録' });
                        if (reg.device_token) {
                            localStorage.setItem(LS_DEVICE, reg.device_token);
                            state.mode = 'owner';
                            state.device_token = reg.device_token;
                            state.shop_name = chkData.shop.shop_name || '';
                            setThemeMode(chkData.shop.gender_mode || reg.gender_mode);
                            await enterOwnerMode();
                            setLoading(false);
                            return;
                        }
                    } catch (e) {
                        // チャット未有効化の場合など → 訪問者モードへフォールバック
                    }
                }
            } catch (e) { /* session check fail → visitor fallback */ }
        }

        // 3. 訪問者モード
        const status = await api('shop-status', { shop_slug: SLUG }, 'GET');
        if (!status.chat_enabled) {
            refs.root.innerHTML = '<div style="padding:40px;text-align:center;color:#888;">この店舗ではYobuChatをご利用いただけません</div>';
            return;
        }
        state.shop_name = status.shop_name;
        state.is_online = status.is_online;
        applyReceptionStatus(status);
        setThemeMode(status.gender_mode);
        await enterVisitorMode();

        // URLパラメータ ?owner=1 でオーナーログインモーダル自動起動
        try {
            const params = new URLSearchParams(location.search);
            if (params.get('owner') === '1') {
                openLoginModal();
                params.delete('owner');
                const newQs = params.toString();
                history.replaceState(null, '', location.pathname + (newQs ? '?' + newQs : ''));
            }
        } catch (_) {}
    } catch (e) {
        showError(e.message || 'エラーが発生しました');
    } finally {
        setLoading(false);
    }
}

// ===== 訪問者モード =====
async function enterVisitorMode() {
    refs.shopName.textContent = state.shop_name;
    updateStatusIndicator(state.is_online);
    refs.ownerToggle.classList.add('hidden');
    // ユーザー側は言語切替を表示
    if (refs.langSelect) refs.langSelect.classList.remove('hidden');
    refs.ownerInbox.classList.add('hidden');
    refs.chatThread.classList.remove('hidden');
    refs.inputArea.classList.remove('hidden');
    if (refs.quickQuestions) refs.quickQuestions.classList.remove('hidden');
    if (refs.reservationHint) refs.reservationHint.classList.remove('hidden');
    renderReceptionBanner();
    refs.ownerTemplates.classList.add('hidden');
    if (refs.emojiToggle) refs.emojiToggle.classList.remove('hidden');
    if (refs.ownerQuick) refs.ownerQuick.classList.add('hidden');
    if (refs.visitorQuick) refs.visitorQuick.classList.add('hidden');
    if (refs.visitorName) refs.visitorName.classList.add('hidden');
    if (refs.btnHeaderBack) refs.btnHeaderBack.classList.add('hidden');
    if (refs.btnBlock) refs.btnBlock.classList.add('hidden');
    if (refs.btnCloseSession) refs.btnCloseSession.classList.add('hidden');
    if (refs.footerBrand) refs.footerBrand.classList.remove('hidden');
    if (refs.statusDot) refs.statusDot.classList.remove('hidden');
    if (refs.statusLabel) refs.statusLabel.classList.remove('hidden');
    if (refs.nicknameArea) {
        refs.nicknameArea.classList.remove('hidden');
        if (refs.nicknameInput) {
            try { refs.nicknameInput.value = localStorage.getItem(LS_NICKNAME) || ''; } catch (_) {}
        }
    }

    // 既存セッション or 新規作成
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_SESSION) || 'null'); } catch (_) { saved = null; }
    if (saved && saved.token) {
        state.session_token = saved.token;
        state.session_id = saved.session_id || 0;
        // リロード時は全履歴を再取得（since_id=0）
        state.last_message_id = 0;
        // 既存セッションのキャスト名をヘッダーに復元（LS_SESSION から優先、無ければ adopt レスポンスで上書き）
        if (saved.cast_name) state.cast_name = saved.cast_name;
        // LS に cast_name があれば await 前にヘッダーを即更新（体感速度＋ネットワークエラー時の保険）
        updateCastHeader();
        // DO版では既存 session_token を DO に adopt させる（createIfMissing）
        try {
            const adopt = await Transport.startVisitorSession({
                shopSlug: SLUG,
                source: isEmbedded() ? 'widget' : 'standalone',
                sessionToken: saved.token,
                cast: CAST_ID || undefined
            });
            if (adopt && adopt.cast_name) {
                state.cast_name = adopt.cast_name;
                // adopt で得た cast_name を LS に反映（旧バージョンで保存されたセッションを救済）
                saveVisitorSession();
            }
        } catch (_) { /* PHP版は本質的に no-op でも可 */ }
        updateCastHeader();
        // DO モードでは PHP pollMessages を叩かない: WS snapshot で DO storage から履歴が配信される.
        // PHP を叩くと MySQL mirror の message ID (DOと別空間) で state.last_message_id が汚染され、
        // DO 発行の新規 msg.id (より小さい値) が `m.id > last_message_id` のガードで描画されない.
        if (Transport.kind !== 'durable-object') {
            await pollMessages(true);
        }
    } else {
        const s = await Transport.startVisitorSession({ shopSlug: SLUG, source: isEmbedded() ? 'widget' : 'standalone', cast: CAST_ID || undefined });
        state.session_token = s.session_token;
        state.session_id = s.session_id;
        if (s.cast_name) state.cast_name = s.cast_name;
        saveVisitorSession();
        updateCastHeader();
        addSystemMessage(state.welcome_message || t('visitor.note'));
    }

    startVisitorPolling();
}

// ===== キャスト閲覧専用モード =====
// メール通知URL ?cast=&view=<session_token> で開いた時の read-only 表示.
// 既存訪問者セッションの履歴を見るだけで送信はできない（返信は電話/LINE経由）.
async function enterCastViewMode() {
    refs.shopName.textContent = state.shop_name;
    // キャスト本人向け通知トグル (shop_casts.chat_notify_mode). 初期値は adopt 応答でセット.
    refs.ownerToggle.classList.remove('hidden');
    if (refs.langSelect) refs.langSelect.classList.remove('hidden');
    refs.ownerInbox.classList.add('hidden');
    refs.chatThread.classList.remove('hidden');
    // 入力欄はキャスト返信用に残す. ニックネーム/quick/絵文字/オーナー系は不要なので非表示.
    if (refs.quickQuestions) refs.quickQuestions.classList.add('hidden');
    // 予約案内はキャスト向け文言に差し替えて表示
    if (refs.reservationHint) {
        refs.reservationHint.setAttribute('data-i18n', 'note.reservation.cast');
        refs.reservationHint.textContent = t('note.reservation.cast');
        refs.reservationHint.classList.remove('hidden');
    }
    if (refs.nicknameArea) refs.nicknameArea.classList.add('hidden');
    if (refs.emojiToggle) refs.emojiToggle.classList.add('hidden');
    if (refs.ownerQuick) refs.ownerQuick.classList.add('hidden');
    if (refs.visitorQuick) refs.visitorQuick.classList.add('hidden');
    refs.ownerTemplates.classList.add('hidden');
    if (refs.visitorName) refs.visitorName.classList.add('hidden');
    if (refs.btnHeaderBack) refs.btnHeaderBack.classList.add('hidden');
    if (refs.btnBlock) refs.btnBlock.classList.add('hidden');
    if (refs.btnCloseSession) refs.btnCloseSession.classList.add('hidden');
    if (refs.footerBrand) refs.footerBrand.classList.remove('hidden');
    // キャスト視点: 緑丸はキャスト自身の通知ON/OFFで出す. 営業時間ラベルは不要（店舗向け情報）.
    if (refs.statusDot) refs.statusDot.classList.remove('hidden');
    if (refs.statusLabel) refs.statusLabel.classList.add('hidden');

    state.mode = 'visitor'; // poll/apply を visitor ロジックで流用するため
    state.session_token = VIEW_TOKEN;
    state.session_id = 0;
    state.last_message_id = 0;

    // 既存セッションを adopt して cast_name を取得（header表示用）
    try {
        const adopt = await Transport.startVisitorSession({
            shopSlug: SLUG,
            source: 'standalone',
            sessionToken: VIEW_TOKEN,
            cast: CAST_ID || undefined
        });
        if (adopt) {
            if (adopt.session_id) state.session_id = adopt.session_id;
            if (adopt.cast_name) state.cast_name = adopt.cast_name;
            if (typeof adopt.is_online !== 'undefined') state.is_online = !!adopt.is_online;
            // 通知トグル初期値: chat_notify_mode が 'off' 以外なら ON
            if (typeof adopt.cast_notify_mode !== 'undefined') {
                const enabled = adopt.cast_notify_mode && adopt.cast_notify_mode !== 'off';
                state.notify_enabled = !!enabled;
                if (refs.onlineToggle) refs.onlineToggle.checked = !!enabled;
            }
        }
    } catch (e) {
        showError(e.message || 'セッションを読み込めませんでした');
        return;
    }
    // adopt で notify_enabled が決まったので緑丸を同期
    updateStatusIndicator(state.is_online);
    updateCastHeader();

    // キャスト返信モードの案内バナー
    if (refs.castViewBanner) {
        const castName = state.cast_name || 'あなた';
        refs.castViewBanner.textContent = `👤 ${castName} 宛てのお問い合わせです。ここから直接返信できます。`;
        refs.castViewBanner.classList.remove('hidden');
    }
    // 入力欄の placeholder を返信用に差し替え
    if (refs.input) refs.input.placeholder = '返信メッセージを入力…';

    // 履歴取得 + 新着ポーリング（受付時間外でもメッセージは表示される）
    if (Transport.kind !== 'durable-object') {
        await pollMessages(true);
    }
    startVisitorPolling();
}

// キャスト指名セッションの場合、ヘッダーに「キャスト名 — 店舗名」を表示.
// cast_owner / cast_inbox モードと同じ format で一貫させる.
function updateCastHeader() {
    if (!state.cast_name) return;
    try {
        if (refs.shopName) {
            refs.shopName.textContent = state.cast_name + (state.shop_name ? ' — ' + state.shop_name : '');
        }
    } catch (_) {}
}

function isEmbedded() { return window.self !== window.top; }
function saveVisitorSession() {
    // 閲覧専用モードでは LS_SESSION に書き込まない.
    // 書き込むと ?cast= 単独で開いた時に訪問者セッションを adopt してしまい、
    // 入力欄から訪問者として送信できてしまうため.
    if (IS_CAST_VIEW) return;
    try {
        localStorage.setItem(LS_SESSION, JSON.stringify({
            token: state.session_token,
            session_id: state.session_id,
            last_message_id: state.last_message_id,
            cast_name: state.cast_name || null,
        }));
    } catch (_) {}
}

function updateStatusIndicator(online) {
    state.is_online = online;
    // キャスト指名ビュー: 緑丸はキャスト自身の通知ON/OFFに同期. 営業時間ラベルは出さない.
    if (IS_CAST_VIEW) {
        const castOn = !!state.notify_enabled;
        refs.statusDot.classList.toggle('online', castOn);
        refs.statusDot.classList.toggle('offline', !castOn);
        return;
    }
    refs.statusDot.classList.toggle('online', online);
    refs.statusDot.classList.toggle('offline', !online);
    const hours = state.reception_start && state.reception_end
        ? `${formatHM(state.reception_start)}-${formatHM(state.reception_end)}`
        : '';
    // 受付時間が設定されていれば常に「受付時間 HH:MM-HH:MM」表示。未設定店舗のみフォールバック。
    // トグルONで緑丸、OFFで丸非表示（chat.cssの.status-dot.offline{display:none}）
    if (hours) {
        refs.statusLabel.innerHTML = `<span class="status-label-line">${t('reception.hours')}</span><span class="status-label-line">${hours}</span>`;
    } else {
        refs.statusLabel.textContent = t(online ? 'status.online' : 'status.offline');
    }
}

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'msg msg-system';
    div.textContent = text;
    refs.chatMessages.appendChild(div);
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
}

function addRestartButton() {
    if (refs.chatMessages.querySelector('.msg-restart-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'msg-restart-wrap';
    wrap.style.cssText = 'display:flex;justify-content:center;margin:8px 0 12px;';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-restart-chat';
    btn.textContent = t('thread.restart');
    btn.style.cssText = 'padding:10px 20px;border:1px solid #d4af37;border-radius:20px;background:#fff;color:#9b2d35;font-weight:600;cursor:pointer;font-size:14px;';
    btn.addEventListener('click', restartVisitorSession);
    wrap.appendChild(btn);
    refs.chatMessages.appendChild(wrap);
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
}

async function restartVisitorSession() {
    try { localStorage.removeItem(LS_SESSION); } catch (_) {}
    stopPolling();
    state.session_token = null;
    state.session_id = 0;
    state.last_message_id = 0;
    state.last_read_own_id = 0;
    state._closedMsgShown = false;
    refs.chatMessages.innerHTML = '';
    refs.inputArea.classList.remove('hidden');
    try {
        const s = await Transport.startVisitorSession({ shopSlug: SLUG, source: isEmbedded() ? 'widget' : 'standalone', cast: CAST_ID || undefined });
        state.session_token = s.session_token;
        state.session_id = s.session_id;
        if (s.cast_name) state.cast_name = s.cast_name;
        saveVisitorSession();
        updateCastHeader();
        addSystemMessage(state.welcome_message || t('visitor.note'));
        startVisitorPolling();
    } catch (e) {
        showError(e.message || 'エラーが発生しました');
    }
}

function addDateSeparator(key) {
    const sep = document.createElement('div');
    sep.className = 'msg-date-sep';
    sep.dataset.dateKey = key;
    sep.innerHTML = '<span>' + esc(formatDateLabel(key)) + '</span>';
    refs.chatMessages.appendChild(sep);
}
function addMessage(m, fromOwner) {
    // dedup: 同 client_msg_id が既に描画済みならスキップ.
    // DO と MySQL の message.id 空間は独立しており (DO は自前カウンタ, MySQL は auto_increment)
    // id ベース dedup では DO 新規セッションの msg が MySQL の max id より小さくなって消える.
    if (m.client_msg_id) {
        if (refs.chatMessages.querySelector(`[data-cmid="${CSS.escape(m.client_msg_id)}"]`)) return;
    } else if (m.id) {
        if (refs.chatMessages.querySelector(`[data-msg-id="${m.id}"]`)) return;
    }

    const isVisitor = m.sender_type === 'visitor';
    // キャスト返信モードは shop 視点で描画 (訪問者=左/他, 自分=右/自).
    const asOwner = fromOwner || IS_CAST_VIEW;
    const renderAs = asOwner ? (isVisitor ? 'shop' : 'visitor') : (isVisitor ? 'visitor' : 'shop');

    // 日付セパレーター
    const dateKey = getDateKey(m.sent_at);
    if (dateKey && dateKey !== state.last_msg_date) {
        addDateSeparator(dateKey);
        state.last_msg_date = dateKey;
    }

    const row = document.createElement('div');
    row.className = 'msg-row ' + renderAs;
    if (m.id) row.dataset.msgId = m.id;
    if (m.client_msg_id) row.dataset.cmid = m.client_msg_id;

    const bubble = document.createElement('div');
    bubble.className = 'msg ' + renderAs;
    bubble.textContent = m.message;

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const t = document.createElement('div');
    t.className = 'msg-time';
    t.textContent = formatTime(m.sent_at);
    meta.appendChild(t);

    // visitor(自分)=時刻を吹き出しの左, shop(相手)=時刻を吹き出しの右
    if (renderAs === 'visitor') { row.appendChild(meta); row.appendChild(bubble); }
    else { row.appendChild(bubble); row.appendChild(meta); }
    refs.chatMessages.appendChild(row);
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;

    // 翻訳表示: 相手のメッセージで、言語が viewer 側と異なる場合に自動翻訳
    const isOthers = fromOwner ? isVisitor : !isVisitor;
    const src = ((m.source_lang || '').toLowerCase()) || detectLang(m.message);
    if (isOthers && src && src !== currentLang && I18N[src] && I18N[currentLang]) {
        maybeTranslate(bubble, m.message, src, currentLang);
    }
}
function updateReadMarkers() {
    // cast_owner / owner 共に自分の発言は 'shop' として描画される (addMessage の asOwner 分岐)
    const isOwnerSide = state.mode === 'owner' || state.mode === 'cast_owner';
    const ownClass = isOwnerSide ? 'shop' : 'visitor';
    const threshold = state.last_read_own_id || 0;
    refs.chatMessages.querySelectorAll('.msg-row.' + ownClass).forEach(row => {
        const id = Number(row.dataset.msgId || 0);
        const meta = row.querySelector('.msg-meta');
        if (!meta) return;
        let mark = meta.querySelector('.msg-read');
        if (id && id <= threshold) {
            if (!mark) {
                mark = document.createElement('div');
                mark.className = 'msg-read';
                mark.textContent = t('msg.read') || '既読';
                meta.appendChild(mark);
            }
        } else if (mark) {
            mark.remove();
        }
    });
}

function detectLang(text) {
    if (!text) return '';
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja';
    if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
    // 漢字のみ（ひらがな/カタカナ無し）は日本語/中国語の判別不可能なので翻訳しない.
    // 例:「何時」は日本語でも中国語でも使われる → ja 扱いで ZH→JA 誤訳(「日時」等)を防ぐ.
    if (/[\u4E00-\u9FFF]/.test(text)) return 'ja';
    if (/[A-Za-z]/.test(text)) return 'en';
    return '';
}

const _translateCache = new Map();
async function maybeTranslate(msgDiv, text, from, to) {
    const key = from + '|' + to + '|' + text;
    const trDiv = document.createElement('div');
    trDiv.className = 'msg-translation';
    trDiv.textContent = '翻訳中…';
    msgDiv.appendChild(trDiv);
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
    try {
        let translated = _translateCache.get(key);
        if (!translated) {
            const res = await api('translate', { text, from, to }, 'POST');
            translated = res.translated || '';
            if (translated) _translateCache.set(key, translated);
        }
        if (translated) {
            trDiv.innerHTML = '';
            const badge = document.createElement('span');
            badge.className = 'msg-translation-badge';
            badge.textContent = '🌐 ' + from.toUpperCase() + '→' + to.toUpperCase();
            const body = document.createElement('div');
            body.className = 'msg-translation-body';
            body.textContent = translated;
            trDiv.appendChild(badge);
            trDiv.appendChild(body);
        } else {
            trDiv.remove();
        }
    } catch (e) {
        trDiv.remove();
    }
}

// 訪問者メッセージバッチを画面に反映（Transport.subscribeVisitor の onBatch、および初期ロードから呼ばれる）
function applyVisitorBatch(data) {
    let sawVisitorMsg = false;
    let restoredNick = '';
    for (const m of (data.messages || [])) {
        // cmid があれば常に addMessage に渡す (addMessage 側で cmid dedup).
        // cmid 無しの legacy msg のみ id ベース dedup.
        if (m.client_msg_id || !m.id || m.id > state.last_message_id) {
            addMessage(m, false);
            if (m.id) state.last_message_id = Math.max(state.last_message_id, m.id);
        }
        if (m.sender_type === 'visitor') {
            sawVisitorMsg = true;
            if (!restoredNick && m.nickname) restoredNick = String(m.nickname).trim().slice(0, 20);
        }
    }
    // 既存セッション復元: 過去に訪問者メッセージがあればニックネームを固定
    if (state.mode === 'visitor' && sawVisitorMsg && !state.nickname_locked) {
        if (refs.nicknameInput && restoredNick) refs.nicknameInput.value = restoredNick;
        lockVisitorNickname();
    }
    if (typeof data.last_read_own_id !== 'undefined') {
        state.last_read_own_id = Math.max(state.last_read_own_id, Number(data.last_read_own_id) || 0);
        updateReadMarkers();
    }
    updateStatusIndicator(data.shop_online);
    if (data.status === 'closed' && !state._closedMsgShown) {
        state._closedMsgShown = true;
        stopPolling();
        addSystemMessage(t('thread.closedThanks'));
        refs.inputArea.classList.add('hidden');
        // 訪問者モードのときのみ「新しいチャットを始める」ボタン表示.
        // ただしキャスト閲覧専用モードでは、訪問者セッションを勝手に再開させないよう非表示.
        if (state.mode === 'visitor' && !IS_CAST_VIEW) addRestartButton();
    }
    if ((data.messages || []).length) saveVisitorSession();
}

// 初期ロード / 送信直後の一回取得
async function pollMessages(initial) {
    if (!state.session_token) return;
    try {
        const data = await api('poll-messages', {
            session_token: state.session_token,
            since_id: state.last_message_id
        }, 'GET');
        applyVisitorBatch(data);
    } catch (e) {
        if (!initial) return;
        showError(e.message);
    }
}

function startVisitorPolling() {
    stopPolling();
    // 受付時間外はポーリング停止（返信は受付時間内に再開時 or リロード時に反映）
    if (state.is_reception_hours === false) {
        scheduleReceptionReopenCheck();
        return;
    }
    state._visitorSub = Transport.subscribeVisitor({
        getSessionToken: () => state.session_token,
        getSinceId: () => state.last_message_id,
        onBatch: applyVisitorBatch
    });
}
function stopPolling() {
    if (state._visitorSub) { state._visitorSub.stop(); state._visitorSub = null; }
    if (state._ownerSub) { state._ownerSub.stop(); state._ownerSub = null; }
    if (state._ownerStatusTimer) { clearInterval(state._ownerStatusTimer); state._ownerStatusTimer = null; }
    if (state.reception_banner_timer) { clearTimeout(state.reception_banner_timer); state.reception_banner_timer = null; }
}

function applyReceptionStatus(status) {
    state.is_reception_hours = status.is_reception_hours !== false;
    state.reception_start = status.reception_start || null;
    state.reception_end = status.reception_end || null;
    state.next_reception_start = status.next_reception_start || null;
    state.welcome_message = (status.welcome_message || '').trim() || null;
    state.reservation_hint = (status.reservation_hint || '').trim() || null;
    applyReservationHint();
    renderReceptionBanner();
}

function applyReservationHint() {
    const el = refs.reservationHint;
    if (!el) return;
    if (state.reservation_hint) {
        el.removeAttribute('data-i18n');
        el.textContent = state.reservation_hint;
    } else {
        el.setAttribute('data-i18n', 'note.reservation');
        el.textContent = t('note.reservation');
    }
}

function formatHM(timeStr) {
    if (!timeStr) return '';
    const m = /^(\d{1,2}):(\d{2})/.exec(String(timeStr));
    if (!m) return '';
    return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function renderReceptionBanner() {
    const note = refs.visitorNote;
    if (!note) return;
    if (state.mode !== 'visitor') return;
    if (state.is_reception_hours !== false) {
        // 通常時: 常時表示の上部ノートは廃止（挨拶はシステムメッセージで代替）
        note.classList.remove('reception-closed');
        note.textContent = '';
        note.classList.add('hidden');
        return;
    }
    note.classList.remove('hidden');
    const hours = state.reception_start && state.reception_end
        ? `${formatHM(state.reception_start)} - ${formatHM(state.reception_end)}`
        : '';
    const parts = [t('reception.closed')];
    if (hours) parts.push(`${t('reception.hours')}: ${hours}`);
    parts.push(t('reception.sendOk'));
    note.classList.add('reception-closed');
    note.textContent = parts.join('  /  ');
    note.classList.remove('hidden');
}

function scheduleReceptionReopenCheck() {
    // 次回受付開始時刻まで setTimeout で 1 回だけ shop-status を再取得
    if (!state.next_reception_start) return;
    const openAt = Date.parse(state.next_reception_start);
    if (!openAt || isNaN(openAt)) return;
    const wait = Math.max(30 * 1000, openAt - Date.now() + 5000); // 最短 30 秒後
    if (state.reception_banner_timer) clearTimeout(state.reception_banner_timer);
    state.reception_banner_timer = setTimeout(async () => {
        try {
            const status = await api('shop-status', { shop_slug: SLUG }, 'GET');
            if (status.chat_enabled) {
                state.is_online = !!status.is_online;
                applyReceptionStatus(status);
                updateStatusIndicator(state.is_online);
                if (state.is_reception_hours) startVisitorPolling();
                else scheduleReceptionReopenCheck();
            }
        } catch (_) { /* 失敗時は次回リロード時に再判定 */ }
    }, wait);
}

function lockVisitorNickname() {
    if (state.nickname_locked) return;
    state.nickname_locked = true;
    const input = refs.nicknameInput;
    if (!input) return;
    const val = String(input.value || '').trim().slice(0, 20);
    if (!val) {
        input.value = t('nickname.anonymous');
    }
    input.readOnly = true;
    input.classList.add('locked');
}

async function sendVisitorMessage(msg) {
    msg = String(msg || '').trim();
    if (!msg) return;
    refs.sendBtn.disabled = true;
    let nick = '';
    if (refs.nicknameInput) {
        nick = String(refs.nicknameInput.value || '').trim().slice(0, 20);
        // ロック済み & 匿名表示になっている場合は空文字で送信（"匿名"という文字列を名前として送らない）
        if (state.nickname_locked && nick === t('nickname.anonymous')) nick = '';
    }
    if (nick) { try { localStorage.setItem(LS_NICKNAME, nick); } catch (_) {} }
    const wasOffline = !state.is_online;
    // client_msg_id: ネットワーク再送でもサーバー側が同一メッセージと判定 (UNIQUE制約).
    const clientMsgId = uuidv4();
    try {
        const resp = await Transport.sendVisitor({
            sessionToken: state.session_token,
            message: msg,
            nickname: nick,
            lang: currentLang,
            clientMsgId,
            sinceId: state.last_message_id
        });
        refs.input.value = '';
        // 送信成功したらニックネームを固定（このチャット内では変更不可）
        lockVisitorNickname();
        // 統一バッチ応答を同じハンドラで反映. pollMessages を追加で叩く必要なし.
        applyVisitorBatch(resp);
        if (wasOffline && !state.offlineNotifiedShown) {
            showOfflineNotifiedHint();
            state.offlineNotifiedShown = true;
        }
    } catch (e) {
        showError(e.message);
    } finally {
        refs.sendBtn.disabled = false;
    }
}

// キャストURL返信: /chat/{slug}/?cast=<shop_cast_id>&view=<session_token> の画面から
// device_token 不要で chat-api の cast-url-reply へ送信 (サーバ側で cast_id 一致検証).
async function sendCastReply(msg) {
    msg = String(msg || '').trim();
    if (!msg) return;
    refs.sendBtn.disabled = true;
    const clientMsgId = uuidv4();
    try {
        const resp = await api('cast-url-reply', {
            session_token: state.session_token,
            shop_cast_id: CAST_ID,
            message: msg,
            client_msg_id: clientMsgId,
            since_id: state.last_message_id
        }, 'POST');
        refs.input.value = '';
        // owner-reply と同じ形状の batch が返る. applyVisitorBatch は cast view の addMessage 分岐
        // (IS_CAST_VIEW で fromOwner=true 扱い) と整合するので流用可.
        applyVisitorBatch(resp);
    } catch (e) {
        showError(e.message);
    } finally {
        refs.sendBtn.disabled = false;
    }
}

function showOfflineNotifiedHint() {
    if (!refs.chatMessages) return;
    const div = document.createElement('div');
    div.className = 'chat-system-note';
    div.textContent = t('offline.notified');
    refs.chatMessages.appendChild(div);
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
}

// ===== オーナーモード =====
async function enterOwnerMode() {
    refs.shopName.textContent = state.shop_name;
    refs.ownerToggle.classList.remove('hidden');
    // オーナー側は日本語固定（言語切替はユーザーのみ）
    if (refs.langSelect) {
        refs.langSelect.classList.add('hidden');
        if (currentLang !== 'ja') { refs.langSelect.value = 'ja'; applyLang('ja'); }
    }
    if (refs.footerBrand) refs.footerBrand.classList.remove('hidden');
    if (refs.statusDot) refs.statusDot.classList.remove('hidden');
    if (refs.statusLabel) refs.statusLabel.classList.remove('hidden');
    if (refs.quickQuestions) refs.quickQuestions.classList.add('hidden');
    if (refs.visitorNote) refs.visitorNote.classList.add('hidden');
    if (refs.reservationHint) refs.reservationHint.classList.add('hidden');
    if (refs.ownerQuick) refs.ownerQuick.classList.add('hidden');
    if (refs.visitorQuick) refs.visitorQuick.classList.add('hidden');
    if (refs.emojiToggle) refs.emojiToggle.classList.add('hidden');
    if (refs.visitorName) refs.visitorName.classList.add('hidden');
    if (refs.btnHeaderBack) refs.btnHeaderBack.classList.add('hidden');
    if (refs.nicknameArea) refs.nicknameArea.classList.add('hidden');

    await refreshOwnerStatus();
    await loadTemplates();
    await showInbox();
    startInboxPolling();
    // shop-admin 側のトグル切替をオーナー画面に反映するため shop-status を定期リフレッシュ
    if (state._ownerStatusTimer) clearInterval(state._ownerStatusTimer);
    state._ownerStatusTimer = setInterval(refreshOwnerStatus, 15000);
}

async function refreshOwnerStatus() {
    try {
        const status = await api('shop-status', { shop_slug: SLUG }, 'GET');
        state.is_online = status.is_online;
        state.reception_start = status.reception_start || null;
        state.reception_end = status.reception_end || null;
        updateStatusIndicator(status.is_online);
        // shop-admin 側と連動: notify_mode をサーバー権威として同期
        if (typeof status.notify_enabled !== 'undefined') {
            state.notify_enabled = !!status.notify_enabled;
        }
        refs.onlineToggle.checked = state.notify_enabled !== false;
    } catch (e) { /* ignore */ }
}

async function showInbox() {
    refs.ownerInbox.classList.remove('hidden');
    refs.chatThread.classList.add('hidden');
    try {
        const data = await api('owner-inbox', { device_token: state.device_token }, 'GET');
        state.inbox_sessions = data.sessions || [];
        renderInbox();
    } catch (e) { showError(e.message); }
}

function renderInbox() {
    refs.inboxList.innerHTML = '';
    if (!state.inbox_sessions.length) {
        refs.inboxList.innerHTML = `<li class="inbox-empty">${esc(t('inbox.empty'))}</li>`;
        return;
    }
    for (const s of state.inbox_sessions) {
        const li = document.createElement('li');
        li.className = 'inbox-item' + (s.unread_count > 0 ? ' unread' : '');
        li.dataset.sessionId = s.id;
        const unread = s.unread_count > 0 ? `<span class="unread-badge">${s.unread_count}</span>` : '';
        const statusBadge = s.status === 'closed' ? `<span style="color:#999;font-size:11px;">${esc(t('inbox.closedTag'))}</span>` : '';
        // キャスト担当セッションはバッジで一覧からも判別可能に（店舗は閲覧のみ）.
        // cast_owner モードでは全セッションが自分宛なのでバッジ抑止.
        const castBadge = (s.cast_id && !IS_CAST_INBOX)
            ? `<span style="background:#fff3cd;color:#7a5200;font-size:10px;padding:1px 6px;border-radius:8px;margin-left:4px;font-weight:700;">👤 ${esc(s.cast_name || 'キャスト担当')}</span>`
            : '';
        const displayName = s.nickname ? esc(s.nickname) : `${esc(t('inbox.visitorPrefix'))} #${s.id}`;
        li.innerHTML = `
            <div class="inbox-item-title">
                <span>${displayName} ${statusBadge}${castBadge}</span>${unread}
            </div>
            <div class="inbox-item-preview">${esc(s.last_sender === 'shop' ? t('inbox.selfPrefix') : '')}${esc(s.last_message || '')}</div>
            <div class="inbox-item-time">${esc(formatTime(s.last_activity_at))}</div>
        `;
        li.addEventListener('click', () => (IS_CAST_INBOX ? openCastThread(s.id) : openOwnerThread(s.id)));
        refs.inboxList.appendChild(li);
    }
}

async function openOwnerThread(sessionId) {
    state.selected_session = state.inbox_sessions.find(s => Number(s.id) === Number(sessionId));
    if (!state.selected_session) return;
    refs.ownerInbox.classList.add('hidden');
    refs.chatThread.classList.remove('hidden');
    if (refs.btnBlock) refs.btnBlock.classList.remove('hidden');
    if (refs.btnCloseSession) {
        const isClosed = state.selected_session.status === 'closed';
        refs.btnCloseSession.classList.toggle('hidden', isClosed);
    }
    refs.ownerTemplates.classList.remove('hidden');
    if (refs.ownerQuick) refs.ownerQuick.classList.add('hidden');
    if (refs.emojiToggle) refs.emojiToggle.classList.remove('hidden');
    refs.chatMessages.innerHTML = '';
    state.last_message_id = 0;
    state.last_msg_date = '';
    state.last_read_own_id = 0;

    const visitorLabel = state.selected_session.nickname
        ? state.selected_session.nickname
        : `${t('inbox.visitorPrefix')} #${state.selected_session.id}`;
    refs.shopName.textContent = state.shop_name;
    if (refs.visitorName) {
        refs.visitorName.textContent = visitorLabel;
        refs.visitorName.classList.remove('hidden');
    }
    if (refs.btnHeaderBack) refs.btnHeaderBack.classList.remove('hidden');

    try {
        const data = await api('owner-inbox', {
            device_token: state.device_token,
            session_id: sessionId
        }, 'GET');
        for (const m of (data.messages || [])) {
            addMessage(m, true);
            state.last_message_id = Math.max(state.last_message_id, m.id);
        }
        if (typeof data.last_read_own_id !== 'undefined') {
            state.last_read_own_id = Math.max(state.last_read_own_id, Number(data.last_read_own_id) || 0);
            updateReadMarkers();
        }
        state.selected_session.is_blocked = !!data.is_blocked;
        updateBlockButton();
    } catch (e) { showError(e.message); }

    const isClosed = state.selected_session.status === 'closed';
    const isCast = !!state.selected_session.cast_id;
    // キャスト担当セッションは店舗から閲覧のみ（返信UI非表示）
    const hideInput = isClosed || isCast;
    refs.inputArea.classList.toggle('hidden', hideInput);
    refs.ownerTemplates.classList.toggle('hidden', hideInput);
    if (refs.emojiToggle) refs.emojiToggle.classList.toggle('hidden', hideInput);
    if (hideInput && refs.ownerQuick) refs.ownerQuick.classList.add('hidden');
    if (isClosed) addSystemMessage(t('thread.closedThanks'));
    if (refs.castViewBanner) {
        if (isCast) {
            const castName = state.selected_session.cast_name || 'キャスト';
            refs.castViewBanner.textContent = `👤 ${castName} 担当のセッションです。閲覧のみで返信できません（不正監視用）`;
            refs.castViewBanner.classList.remove('hidden');
        } else {
            refs.castViewBanner.classList.add('hidden');
        }
    }
}

function updateBlockButton() {
    if (!refs.btnBlock || !state.selected_session) return;
    if (state.selected_session.is_blocked) {
        refs.btnBlock.textContent = t('thread.unblock');
        refs.btnBlock.dataset.blocked = '1';
        refs.btnBlock.classList.remove('danger');
        refs.btnBlock.classList.add('success');
    } else {
        refs.btnBlock.textContent = t('thread.block');
        refs.btnBlock.dataset.blocked = '0';
        refs.btnBlock.classList.remove('success');
        refs.btnBlock.classList.add('danger');
    }
}

async function sendOwnerReply(msg) {
    if (!state.selected_session) return;
    msg = String(msg || '').trim();
    if (!msg) return;
    refs.sendBtn.disabled = true;
    const clientMsgId = uuidv4();
    try {
        const r = await Transport.sendOwner({
            deviceToken: state.device_token,
            sessionId: state.selected_session.id,
            sessionToken: state.selected_session.session_token,
            message: msg,
            clientMsgId,
            sinceId: state.last_message_id
        });
        refs.input.value = '';
        // 統一バッチ応答を applyOwnerBatch で反映 (自送信メッセージも同経由で画面に出る).
        applyOwnerBatch(r, state.selected_session.id);
    } catch (e) {
        if (e && e.authFailed) { handleDeviceAuthFailure(); return; }
        showError(e.message);
    }
    finally { refs.sendBtn.disabled = false; }
}

async function loadTemplates() {
    try {
        const data = await api('get-templates', { device_token: state.device_token }, 'GET');
        state.templates = data.templates || [];
        renderTemplates();
    } catch (e) { /* ignore */ }
}

function renderTemplates() {
    refs.templateList.innerHTML = '';
    if (!state.templates.length) {
        refs.templateList.innerHTML = `<span style="color:#999;font-size:12px;">${esc(t('template.empty'))}</span>`;
        return;
    }
    for (const t of state.templates) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'template-btn';
        btn.innerHTML = `<span class="template-btn-title">${esc(t.title)}</span>`;
        btn.title = t.content;
        btn.addEventListener('click', () => {
            refs.input.value = t.content;
            refs.input.focus();
        });
        refs.templateList.appendChild(btn);
    }
}

// オーナー受信箱/スレッドバッチを画面に反映（Transport.subscribeOwner の onBatch）
function applyOwnerBatch(data, selectedSid) {
    if (!selectedSid) {
        // 受信箱ビュー: 非表示なら無視（スレッド表示中に裏でinbox tickが来る可能性ない設計だが念のため）
        if (!refs.ownerInbox.classList.contains('hidden')) {
            state.inbox_sessions = data.sessions || [];
            renderInbox();
        }
        return;
    }
    if (!state.selected_session) return;
    for (const m of (data.messages || [])) {
        if (m.client_msg_id || !m.id || m.id > state.last_message_id) {
            addMessage(m, true);
            if (m.id) state.last_message_id = Math.max(state.last_message_id, m.id);
        }
    }
    if (typeof data.last_read_own_id !== 'undefined') {
        state.last_read_own_id = Math.max(state.last_read_own_id, Number(data.last_read_own_id) || 0);
        updateReadMarkers();
    }
}

function startInboxPolling() {
    stopPolling();
    state._ownerSub = Transport.subscribeOwner({
        getDeviceToken: () => state.device_token,
        getSelectedSessionId: () => state.selected_session ? state.selected_session.id : null,
        getSinceId: () => state.last_message_id,
        onBatch: applyOwnerBatch
    });
}

// ===== キャスト自分用受信箱モード (IS_CAST_INBOX) =====
// 店舗オーナーの device_token は使わず URL-only auth で cast-inbox 系エンドポイントを叩く.
// UI はオーナー受信箱と同じ (inbox list → thread) を流用. DO は経由せず PHP 直結.
async function enterCastOwnerMode() {
    state.mode = 'cast_owner';
    // 端末登録トークンがあれば一緒に送る。未登録 or 無効なら registration_required が返る.
    state.cast_device_token = getCastDeviceToken();
    const data = await api('cast-inbox', {
        inbox_token: CAST_INBOX_TOKEN,
        device_token: state.cast_device_token
    }, 'GET');
    if (data.registration_required) {
        // 端末登録フローへ: キャスト登録メール宛に6桁コード送信.
        await showCastDeviceRegistration(data);
        return;
    }
    state.shop_name = data.shop_name || '';
    state.cast_name = data.cast_name || '';
    state.shop_cast_id_self = data.shop_cast_id || '';
    state.notify_enabled = !!data.notify_enabled;
    state.is_online = state.notify_enabled;
    state.inbox_sessions = data.sessions || [];
    // 店舗ジャンル(gender_mode)に合わせてテーマ適用.
    // data-role="cast" は CSS で店舗オーナーと区別するための装飾フック.
    setThemeMode(data.gender_mode || 'men');
    try { document.body.dataset.role = 'cast'; } catch (_) {}

    // ヘッダ/UI整備
    // キャスト自分用(受信箱)は店名を出さない（自分の受信箱という文脈で冗長）
    refs.shopName.textContent = state.cast_name || state.shop_name;
    refs.ownerToggle.classList.remove('hidden');
    if (refs.langSelect) {
        refs.langSelect.classList.add('hidden');
        if (currentLang !== 'ja') { refs.langSelect.value = 'ja'; applyLang('ja'); }
    }
    if (refs.footerBrand) refs.footerBrand.classList.remove('hidden');
    if (refs.statusDot) refs.statusDot.classList.remove('hidden');
    if (refs.statusLabel) refs.statusLabel.classList.remove('hidden');
    if (refs.quickQuestions) refs.quickQuestions.classList.add('hidden');
    if (refs.visitorNote) refs.visitorNote.classList.add('hidden');
    if (refs.reservationHint) refs.reservationHint.classList.add('hidden');
    if (refs.ownerQuick) refs.ownerQuick.classList.add('hidden');
    if (refs.visitorQuick) refs.visitorQuick.classList.add('hidden');
    if (refs.emojiToggle) refs.emojiToggle.classList.add('hidden');
    if (refs.visitorName) refs.visitorName.classList.add('hidden');
    if (refs.btnHeaderBack) refs.btnHeaderBack.classList.add('hidden');
    if (refs.nicknameArea) refs.nicknameArea.classList.add('hidden');
    // キャストは店舗オーナーではないので、オーナーログイン/ログアウトは非表示
    if (refs.ownerLoginLink) refs.ownerLoginLink.classList.add('hidden');
    if (refs.btnOwnerLogout) refs.btnOwnerLogout.classList.add('hidden');

    refs.onlineToggle.checked = state.notify_enabled;
    updateStatusIndicator(state.notify_enabled);

    showCastInbox();
    startCastInboxPolling();
}

// 端末登録フロー: 受信箱URLは盗まれうるので、初回のみキャスト登録メール宛に6桁コードを送って
// この端末だけで受信箱を開けるようにする (localStorage に cast_device_xxx として保存).
async function showCastDeviceRegistration(data) {
    setLoading(false);
    const castName = data.cast_name || '';
    const shopName = data.shop_name || '';
    const maskedEmail = data.masked_email || '';
    if (refs.btnHeaderBack) refs.btnHeaderBack.classList.add('hidden');
    if (refs.ownerToggle) refs.ownerToggle.classList.add('hidden');
    if (refs.statusDot) refs.statusDot.classList.add('hidden');
    if (refs.statusLabel) refs.statusLabel.classList.add('hidden');
    if (refs.shopName) refs.shopName.textContent = castName || shopName || '受信箱';
    try { document.body.dataset.role = 'cast'; } catch (_) {}

    const panel = document.createElement('div');
    panel.className = 'cast-device-reg';
    panel.style.cssText = 'padding:24px 20px;max-width:520px;margin:0 auto;line-height:1.6;font-size:15px;';
    panel.innerHTML = [
        '<h2 style="font-size:18px;margin:0 0 12px;">端末を認証する</h2>',
        '<p style="margin:0 0 12px;color:#333;">この端末で受信箱を開くには、登録メール宛の6桁コードで認証が必要です。<br>認証後はこの端末だけでURLから受信箱を直接開けます。</p>',
        '<div style="background:#f6f6f8;border-radius:10px;padding:12px 14px;margin:0 0 16px;font-size:14px;">送信先: <b id="cdr-email" style="letter-spacing:.03em;"></b></div>',
        '<button type="button" id="cdr-send" style="width:100%;padding:14px;background:var(--chat-primary,#2a5a8f);color:#fff;border:0;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;">認証コードを送信</button>',
        '<div id="cdr-step2" style="display:none;margin-top:18px;">',
            '<p style="margin:0 0 8px;color:#333;">メールに届いた6桁のコードを入力してください (15分有効)</p>',
            '<input type="tel" id="cdr-code" maxlength="6" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" placeholder="123456" style="width:100%;padding:14px;font-size:22px;letter-spacing:.4em;text-align:center;border:2px solid #ddd;border-radius:10px;box-sizing:border-box;">',
            '<button type="button" id="cdr-verify" style="width:100%;padding:14px;margin-top:10px;background:#2a5a8f;color:#fff;border:0;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;">この端末を認証する</button>',
            '<button type="button" id="cdr-resend" style="width:100%;padding:10px;margin-top:6px;background:transparent;color:#666;border:0;font-size:13px;cursor:pointer;text-decoration:underline;">コードを再送信</button>',
        '</div>',
        '<div id="cdr-msg" style="margin-top:14px;min-height:20px;font-size:13px;"></div>',
        '<p style="margin:24px 0 0;font-size:12px;color:#888;line-height:1.5;">心当たりがない場合、受信箱URLが流出している可能性があります。<br>所属店舗のオーナーに連絡し、URLを再発行してもらってください。</p>'
    ].join('');
    // 既存パネルは全て隠し、受付トグルも消す。登録完了後は location.reload() でUI再構築.
    if (refs.ownerInbox) refs.ownerInbox.classList.add('hidden');
    if (refs.chatThread) refs.chatThread.classList.add('hidden');
    // 既存の登録パネルが残っていたら除去してから挿入 (reload 経路でなくても冪等にする)
    const prev = refs.root.querySelector('.cast-device-reg');
    if (prev) prev.remove();
    const footer = document.getElementById('chat-footer');
    if (footer && footer.parentNode === refs.root) refs.root.insertBefore(panel, footer);
    else refs.root.appendChild(panel);

    const $cdr = id => panel.querySelector('#cdr-' + id);
    $cdr('email').textContent = maskedEmail;

    const setMsg = (text, ok) => {
        const el = $cdr('msg');
        el.textContent = text || '';
        el.style.color = ok ? '#2a7a3a' : '#c0392b';
    };

    const requestCode = async () => {
        $cdr('send').disabled = true;
        $cdr('send').textContent = '送信中...';
        setMsg('');
        try {
            const r = await api('cast-inbox-request-code', { inbox_token: CAST_INBOX_TOKEN });
            $cdr('step2').style.display = 'block';
            $cdr('send').textContent = 'コードを送信しました';
            setMsg(`${r.masked_email || maskedEmail} にコードを送信しました`, true);
            setTimeout(() => $cdr('code').focus(), 100);
        } catch (e) {
            $cdr('send').disabled = false;
            $cdr('send').textContent = '認証コードを送信';
            setMsg(e.message || '送信に失敗しました');
        }
    };

    const verify = async () => {
        const code = ($cdr('code').value || '').trim();
        if (!/^\d{6}$/.test(code)) { setMsg('6桁の数字を入力してください'); return; }
        $cdr('verify').disabled = true;
        $cdr('verify').textContent = '認証中...';
        setMsg('');
        try {
            const r = await api('cast-inbox-verify-code', {
                inbox_token: CAST_INBOX_TOKEN,
                code,
                device_name: (navigator.userAgent || '').substring(0, 80)
            });
            if (!r || !r.device_token) throw new Error('認証に失敗しました');
            setCastDeviceToken(r.device_token);
            setMsg('認証しました。受信箱を開きます...', true);
            setTimeout(async () => {
                // 元のチャットbodyに戻して受信箱を開く
                location.reload();
            }, 600);
        } catch (e) {
            $cdr('verify').disabled = false;
            $cdr('verify').textContent = 'この端末を認証する';
            setMsg(e.message || '認証に失敗しました');
        }
    };

    $cdr('send').addEventListener('click', requestCode);
    $cdr('verify').addEventListener('click', verify);
    $cdr('resend').addEventListener('click', () => {
        $cdr('send').disabled = false;
        $cdr('send').textContent = '認証コードを送信';
        $cdr('step2').style.display = 'none';
        $cdr('code').value = '';
        requestCode();
    });
    $cdr('code').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') verify();
    });
}

function showCastInbox() {
    refs.ownerInbox.classList.remove('hidden');
    refs.chatThread.classList.add('hidden');
    renderInbox();
}

async function openCastThread(sessionId) {
    state.selected_session = state.inbox_sessions.find(s => Number(s.id) === Number(sessionId));
    if (!state.selected_session) return;
    refs.ownerInbox.classList.add('hidden');
    refs.chatThread.classList.remove('hidden');
    // キャスト自分用: ブロック権限なし、閉じる権限はあり
    if (refs.btnBlock) refs.btnBlock.classList.add('hidden');
    if (refs.btnCloseSession) {
        const isClosed = state.selected_session.status === 'closed';
        refs.btnCloseSession.classList.toggle('hidden', isClosed);
    }
    refs.ownerTemplates.classList.add('hidden'); // キャストは店舗定型文を使わない
    if (refs.ownerQuick) refs.ownerQuick.classList.add('hidden');
    if (refs.emojiToggle) refs.emojiToggle.classList.remove('hidden');
    refs.chatMessages.innerHTML = '';
    state.last_message_id = 0;
    state.last_msg_date = '';
    state.last_read_own_id = 0;

    const visitorLabel = state.selected_session.nickname
        ? state.selected_session.nickname
        : `${t('inbox.visitorPrefix')} #${state.selected_session.id}`;
    refs.shopName.textContent = state.cast_name || state.shop_name;
    if (refs.visitorName) {
        refs.visitorName.textContent = visitorLabel;
        refs.visitorName.classList.remove('hidden');
    }
    if (refs.btnHeaderBack) refs.btnHeaderBack.classList.remove('hidden');

    try {
        const data = await api('cast-inbox', {
            inbox_token: CAST_INBOX_TOKEN,
            device_token: state.cast_device_token,
            session_id: sessionId
        }, 'GET');
        for (const m of (data.messages || [])) {
            addMessage(m, true);
            state.last_message_id = Math.max(state.last_message_id, m.id);
        }
        if (typeof data.last_read_own_id !== 'undefined') {
            state.last_read_own_id = Math.max(state.last_read_own_id, Number(data.last_read_own_id) || 0);
            updateReadMarkers();
        }
    } catch (e) { showError(e.message); }

    const isClosed = state.selected_session.status === 'closed';
    refs.inputArea.classList.toggle('hidden', isClosed);
    if (refs.emojiToggle) refs.emojiToggle.classList.toggle('hidden', isClosed);
    if (isClosed) addSystemMessage(t('thread.closedThanks'));
    if (refs.castViewBanner) refs.castViewBanner.classList.add('hidden');
}

async function sendCastReply(msg) {
    if (!state.selected_session) return;
    msg = String(msg || '').trim();
    if (!msg) return;
    refs.sendBtn.disabled = true;
    const clientMsgId = uuidv4();
    try {
        const r = await api('cast-inbox-reply', {
            inbox_token: CAST_INBOX_TOKEN,
            device_token: state.cast_device_token,
            session_id: state.selected_session.id,
            message: msg,
            client_msg_id: clientMsgId,
            since_id: state.last_message_id
        });
        refs.input.value = '';
        // respondOwnerBatch と同形なので applyOwnerBatch で反映可能
        applyOwnerBatch(r, state.selected_session.id);
    } catch (e) {
        showError(e.message);
    }
    finally { refs.sendBtn.disabled = false; }
}

function startCastInboxPolling() {
    stopPolling();
    const tick = async () => {
        try {
            const sid = state.selected_session ? state.selected_session.id : null;
            const params = { inbox_token: CAST_INBOX_TOKEN, device_token: state.cast_device_token };
            if (sid) { params.session_id = sid; params.since_id = state.last_message_id; }
            const data = await api('cast-inbox', params, 'GET');
            if (typeof data.notify_enabled !== 'undefined') {
                state.notify_enabled = !!data.notify_enabled;
                state.is_online = state.notify_enabled;
                refs.onlineToggle.checked = state.notify_enabled;
                updateStatusIndicator(state.notify_enabled);
            }
            if (sid && state.selected_session) {
                // スレッド表示中: 新メッセージ/既読を反映
                applyOwnerBatch({
                    messages: data.messages || [],
                    last_read_own_id: data.last_read_own_id,
                    status: data.status
                }, sid);
            } else {
                // 受信箱表示中: セッション一覧更新
                state.inbox_sessions = data.sessions || [];
                if (!refs.ownerInbox.classList.contains('hidden')) renderInbox();
            }
        } catch (_) { /* ignore transient errors */ }
    };
    const timer = setInterval(tick, INBOX_INTERVAL);
    state._ownerSub = { stop: () => clearInterval(timer) };
}

// ===== ログインモーダル =====
function openLoginModal() {
    refs.loginError.classList.add('hidden');
    refs.loginError.textContent = '';
    refs.loginModal.classList.remove('hidden');
    setTimeout(() => refs.loginEmail && refs.loginEmail.focus(), 100);
}
function closeLoginModal() {
    refs.loginModal.classList.add('hidden');
}

async function handleLogin(ev) {
    ev.preventDefault();
    const email = refs.loginEmail.value.trim();
    const password = refs.loginPassword.value;
    if (!email || !password) return;
    refs.loginError.classList.add('hidden');
    refs.loginSubmit.disabled = true;
    refs.loginSubmit.textContent = 'ログイン中…';
    try {
        const res = await fetch(SHOP_AUTH_API + '?action=login', {
            method: 'POST',
            credentials: 'include',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ email, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error || !data.shop) {
            throw new Error(data.error || 'ログインに失敗しました');
        }
        if (data.shop.slug !== SLUG) {
            throw new Error('このチャットの店舗アカウントではありません');
        }
        // オーナー端末登録
        const reg = await api('register-device', { device_name: 'ブラウザ登録' });
        if (!reg.device_token) throw new Error('端末登録に失敗しました');
        localStorage.setItem(LS_DEVICE, reg.device_token);
        refs.loginPassword.value = '';
        closeLoginModal();
        // オーナーモードに切替
        stopPolling();
        state.mode = 'owner';
        state.device_token = reg.device_token;
        state.shop_name = data.shop.shop_name || '';
        await enterOwnerMode();
    } catch (e) {
        refs.loginError.textContent = e.message || 'エラーが発生しました';
        refs.loginError.classList.remove('hidden');
    } finally {
        refs.loginSubmit.disabled = false;
        refs.loginSubmit.textContent = 'ログイン';
    }
}

async function handleOwnerLogout() {
    if (!confirm('この端末からログアウトしますか？以降このブラウザではオーナー画面に入れなくなります。')) return;
    // サーバー側のdevice_tokenを無効化（ブラウザからlocalStorageを盗まれても悪用不可にするため）
    if (state.device_token) {
        try { await api('owner-logout', { device_token: state.device_token }); } catch (_) { /* ignore, proceed with client-side cleanup */ }
    }
    try {
        // PHPセッションも破棄
        await fetch(SHOP_AUTH_API + '?action=logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    } catch (e) {}
    localStorage.removeItem(LS_DEVICE);
    stopPolling();
    window.location.reload();
}

// ===== イベントバインド =====
refs.sendBtn.addEventListener('click', () => {
    const msg = refs.input.value;
    if (IS_CAST_VIEW) sendCastReply(msg);
    else if (state.mode === 'cast_owner') sendCastReply(msg);
    else if (state.mode === 'owner') sendOwnerReply(msg);
    else sendVisitorMessage(msg);
});

// IME 確定 Enter の誤送信ガード:
// - Mac/Chrome 等は IME 確定 Enter の keydown が `isComposing=false` で届く一方、
//   同タイミングで `keyCode === 229` になることが多い (ブラウザによる).
// - 一部環境では compositionend 直後の keydown でも 229 が立たないため、
//   compositionend からの経過時間をフラグで見て 50ms 以内の Enter は無視する.
let lastCompositionEndAt = 0;
refs.input.addEventListener('compositionend', () => { lastCompositionEndAt = Date.now(); });
refs.input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.isComposing || e.keyCode === 229) return;
    if (Date.now() - lastCompositionEndAt < 50) return; // IME 確定 Enter を誤認しない
    e.preventDefault();
    refs.sendBtn.click();
});

if (refs.quickQuestions) {
    refs.quickQuestions.addEventListener('click', (e) => {
        const btn = e.target.closest('.quick-btn');
        if (!btn) return;
        sendVisitorMessage(btn.dataset.quick);
    });
}

function insertEmojiAtCursor(emoji) {
    const el = refs.input;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + emoji + el.value.slice(end);
    const pos = start + emoji.length;
    el.focus();
    try { el.setSelectionRange(pos, pos); } catch (_) {}
}

function currentQuickPopup() {
    return state.mode === 'visitor' ? refs.visitorQuick : refs.ownerQuick;
}

if (refs.ownerQuick) {
    refs.ownerQuick.addEventListener('click', (e) => {
        const btn = e.target.closest('.quick-btn');
        if (!btn) return;
        insertEmojiAtCursor(btn.dataset.quick || '');
        refs.ownerQuick.classList.add('hidden');
    });
}

if (refs.visitorQuick) {
    refs.visitorQuick.addEventListener('click', (e) => {
        const btn = e.target.closest('.quick-btn');
        if (!btn) return;
        insertEmojiAtCursor(btn.dataset.quick || '');
        refs.visitorQuick.classList.add('hidden');
    });
}

if (refs.emojiToggle) {
    refs.emojiToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const popup = currentQuickPopup();
        if (!popup) return;
        popup.classList.toggle('hidden');
        // もう片方のポップアップは確実に閉じる
        const other = popup === refs.ownerQuick ? refs.visitorQuick : refs.ownerQuick;
        if (other) other.classList.add('hidden');
    });
    document.addEventListener('click', (e) => {
        if (e.target.closest('#owner-quick') || e.target.closest('#visitor-quick') || e.target.closest('#emoji-toggle')) return;
        if (refs.ownerQuick) refs.ownerQuick.classList.add('hidden');
        if (refs.visitorQuick) refs.visitorQuick.classList.add('hidden');
    });
}

refs.onlineToggle.addEventListener('change', async (e) => {
    const isOn = e.target.checked;
    try {
        if (IS_CAST_INBOX) {
            // キャスト自分用受信箱: URL-token auth で chat_notify_mode をトグル
            await api('cast-inbox-toggle-notify', {
                inbox_token: CAST_INBOX_TOKEN,
                device_token: state.cast_device_token,
                enabled: isOn ? 1 : 0
            });
            state.notify_enabled = isOn;
            state.is_online = isOn;
            updateStatusIndicator(isOn);
        } else if (IS_CAST_VIEW) {
            // キャスト指名ビュー: URL-only auth で自分の chat_notify_mode をトグル
            await api('cast-url-toggle-notify', {
                session_token: state.session_token,
                shop_cast_id: CAST_ID,
                enabled: isOn ? 1 : 0
            });
            state.notify_enabled = isOn;
            // 緑丸をキャスト自身の通知状態に同期
            updateStatusIndicator(state.is_online);
        } else {
            const res = await api('toggle-notify', {
                device_token: state.device_token,
                enabled: isOn ? 1 : 0
            });
            state.notify_enabled = isOn;
            // 受付トグルは is_online も同時に切り替える → オーナー画面のステータスドット即時反映
            updateStatusIndicator(res && typeof res.is_online !== 'undefined' ? !!res.is_online : isOn);
        }
    } catch (err) {
        showError(err.message);
        e.target.checked = !isOn;
    }
});

refs.btnRefresh.addEventListener('click', () => (IS_CAST_INBOX ? showCastInbox() : showInbox()));
function backToInbox() {
    state.selected_session = null;
    if (refs.btnBlock) refs.btnBlock.classList.add('hidden');
    if (refs.btnCloseSession) refs.btnCloseSession.classList.add('hidden');
    refs.ownerTemplates.classList.add('hidden');
    if (refs.ownerQuick) refs.ownerQuick.classList.add('hidden');
    if (refs.emojiToggle) refs.emojiToggle.classList.add('hidden');
    if (refs.visitorName) refs.visitorName.classList.add('hidden');
    if (refs.btnHeaderBack) refs.btnHeaderBack.classList.add('hidden');
    if (refs.castViewBanner) refs.castViewBanner.classList.add('hidden');
    refs.shopName.textContent = IS_CAST_INBOX
        ? (state.cast_name || state.shop_name)
        : state.shop_name;
    if (IS_CAST_INBOX) showCastInbox();
    else showInbox();
}
if (refs.btnHeaderBack) refs.btnHeaderBack.addEventListener('click', backToInbox);

refs.btnBlock.addEventListener('click', async () => {
    if (!state.selected_session) return;
    if (state.selected_session.is_blocked) {
        if (!confirm('このユーザーのブロックを解除しますか？以降このユーザーから新しくチャットを開始できるようになります。')) return;
        try {
            await api('unblock-visitor', {
                device_token: state.device_token,
                session_id: state.selected_session.id
            });
            state.selected_session.is_blocked = false;
            updateBlockButton();
            showError('ブロックを解除しました');
        } catch (e) { showError(e.message); }
    } else {
        if (!confirm('このユーザーをブロックしますか？以降このユーザーからは新規チャット不可になります。')) return;
        try {
            await api('block-visitor', {
                device_token: state.device_token,
                session_id: state.selected_session.id,
                reason: 'manual block'
            });
            showError('ブロックしました');
            state.selected_session = null;
            if (refs.btnBlock) refs.btnBlock.classList.add('hidden');
            if (refs.btnCloseSession) refs.btnCloseSession.classList.add('hidden');
            refs.ownerTemplates.classList.add('hidden');
            await showInbox();
        } catch (e) { showError(e.message); }
    }
});

if (refs.btnCloseSession) refs.btnCloseSession.addEventListener('click', async () => {
    if (!state.selected_session) return;
    if (!confirm(t('thread.closeConfirm'))) return;
    try {
        if (IS_CAST_INBOX) {
            await api('cast-inbox-close', {
                inbox_token: CAST_INBOX_TOKEN,
                device_token: state.cast_device_token,
                session_id: state.selected_session.id
            });
        } else {
            await Transport.closeSession({
                deviceToken: state.device_token,
                sessionId: state.selected_session.id,
                sessionToken: state.selected_session.session_token
            });
        }
        state.selected_session.status = 'closed';
        refs.btnCloseSession.classList.add('hidden');
        // オーナー側にもシステムメッセージを表示
        addSystemMessage(t('thread.closedThanks'));
        // 入力欄を隠す（返信不可）
        if (refs.inputArea) refs.inputArea.classList.add('hidden');
        if (refs.ownerTemplates) refs.ownerTemplates.classList.add('hidden');
        if (refs.ownerQuick) refs.ownerQuick.classList.add('hidden');
        if (refs.visitorQuick) refs.visitorQuick.classList.add('hidden');
        if (refs.emojiToggle) refs.emojiToggle.classList.add('hidden');
    } catch (e) { showError(e.message); }
});

// ログインモーダル
if (refs.ownerLoginLink) refs.ownerLoginLink.addEventListener('click', openLoginModal);
if (refs.loginClose) refs.loginClose.addEventListener('click', closeLoginModal);
if (refs.loginModal) refs.loginModal.addEventListener('click', (e) => {
    if (e.target === refs.loginModal) closeLoginModal();
});
if (refs.loginForm) refs.loginForm.addEventListener('submit', handleLogin);
if (refs.btnOwnerLogout) refs.btnOwnerLogout.addEventListener('click', handleOwnerLogout);

function sendOwnerGoOffline() {
    if (state.mode !== 'owner' || !state.device_token) return;
    try {
        const blob = new Blob(
            [JSON.stringify({ action: 'owner-go-offline', device_token: state.device_token })],
            { type: 'application/json' }
        );
        navigator.sendBeacon(API, blob);
    } catch (_) { /* ignore */ }
}

window.addEventListener('beforeunload', () => {
    stopPolling();
    sendOwnerGoOffline();
});
window.addEventListener('pagehide', sendOwnerGoOffline);
window.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopPolling();
        sendOwnerGoOffline();
    } else if (state.mode === 'visitor' && state.session_token) {
        startVisitorPolling();
    } else if (state.mode === 'owner') {
        startInboxPolling();
    } else if (state.mode === 'cast_owner') {
        startCastInboxPolling();
    }
});

// ===== 親iframeへの高さ通知（埋込時のみ） =====
// chat.html が iframe で埋め込まれた際、親ページが iframe の高さを中身に追従させられるよう
// ResizeObserver で body の高さを監視し、変化時に postMessage で通知する。
// 親側は {type:'ychat:resize', h:Number} を受信して iframe.style.height を更新する想定。
function setupEmbedResizeNotifier() {
    if (!isEmbedded()) return;
    const send = () => {
        try {
            const h = Math.max(
                document.documentElement.scrollHeight,
                document.body.scrollHeight,
                refs.root ? refs.root.scrollHeight : 0
            );
            window.parent.postMessage({ type: 'ychat:resize', slug: SLUG, h }, '*');
        } catch (_) {}
    };
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => send());
        ro.observe(document.body);
        if (refs.root) ro.observe(refs.root);
    }
    window.addEventListener('load', send);
    window.addEventListener('resize', send);
    // 初回送信（レイアウト確定後）
    setTimeout(send, 100);
    setTimeout(send, 500);
    setTimeout(send, 1500);
}
setupEmbedResizeNotifier();

// ===== 起動 =====
init();

})();
