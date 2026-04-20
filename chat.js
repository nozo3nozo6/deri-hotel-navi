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

const SLUG = getSlug();
if (!SLUG) {
    document.getElementById('chat-root').innerHTML = '<div style="padding:40px;text-align:center;color:#888;">チャットURLが不正です</div>';
    return;
}

const LS_SESSION = 'chat_session_' + SLUG;
const LS_NICKNAME = 'chat_nickname_' + SLUG;
const LS_DEVICE  = 'chat_owner_token';

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
    async startVisitorSession({ shopSlug, source, sessionToken }) {
        const payload = { shop_slug: shopSlug, source };
        if (sessionToken) payload.session_token = sessionToken;
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

    async startVisitorSession({ shopSlug: _s, source, sessionToken }) {
        const payload = { source: source || 'standalone' };
        if (sessionToken) payload.session_token = sessionToken;
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

// 現在の有効トランスポート。slug allowlist で段階的ロールアウト:
// - allowlist 内の slug → DurableObjectTransport (chat.yobuho.com Worker + DO)
// - それ以外 → PollingTransport (PHP polling)
// 問題発生時は allowlist から該当 slug を外すだけで即ロールバック.
const DO_ALLOWLIST_SLUGS = ['dgqeiw1i']; // 立川秘密基地
const Transport = DO_ALLOWLIST_SLUGS.includes(SLUG) ? DurableObjectTransport : PollingTransport;

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
        if (state.mode === 'owner' && state.inbox_sessions && refs.ownerInbox && !refs.ownerInbox.classList.contains('hidden')) {
            renderInbox();
        }
        if (state.mode === 'visitor') renderReceptionBanner();
        // 選択中のスレッドのヘッダー名
        if (state.mode === 'owner' && state.selected_session && refs.visitorName && !refs.visitorName.classList.contains('hidden')) {
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
        // DO版では既存 session_token を DO に adopt させる（createIfMissing）
        try {
            await Transport.startVisitorSession({
                shopSlug: SLUG,
                source: isEmbedded() ? 'widget' : 'standalone',
                sessionToken: saved.token
            });
        } catch (_) { /* PHP版は本質的に no-op でも可 */ }
        // DO モードでは PHP pollMessages を叩かない: WS snapshot で DO storage から履歴が配信される.
        // PHP を叩くと MySQL mirror の message ID (DOと別空間) で state.last_message_id が汚染され、
        // DO 発行の新規 msg.id (より小さい値) が `m.id > last_message_id` のガードで描画されない.
        if (Transport.kind !== 'durable-object') {
            await pollMessages(true);
        }
    } else {
        const s = await Transport.startVisitorSession({ shopSlug: SLUG, source: isEmbedded() ? 'widget' : 'standalone' });
        state.session_token = s.session_token;
        state.session_id = s.session_id;
        saveVisitorSession();
        addSystemMessage(state.welcome_message || t('visitor.note'));
    }

    startVisitorPolling();
}

function isEmbedded() { return window.self !== window.top; }
function saveVisitorSession() {
    try {
        localStorage.setItem(LS_SESSION, JSON.stringify({
            token: state.session_token,
            session_id: state.session_id,
            last_message_id: state.last_message_id,
        }));
    } catch (_) {}
}

function updateStatusIndicator(online) {
    state.is_online = online;
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
        const s = await Transport.startVisitorSession({ shopSlug: SLUG, source: isEmbedded() ? 'widget' : 'standalone' });
        state.session_token = s.session_token;
        state.session_id = s.session_id;
        saveVisitorSession();
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
    const renderAs = fromOwner ? (isVisitor ? 'shop' : 'visitor') : (isVisitor ? 'visitor' : 'shop');

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
    const ownClass = state.mode === 'owner' ? 'shop' : 'visitor';
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
    if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
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
    for (const m of (data.messages || [])) {
        // cmid があれば常に addMessage に渡す (addMessage 側で cmid dedup).
        // cmid 無しの legacy msg のみ id ベース dedup.
        if (m.client_msg_id || !m.id || m.id > state.last_message_id) {
            addMessage(m, false);
            if (m.id) state.last_message_id = Math.max(state.last_message_id, m.id);
        }
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
        // 訪問者モードのときのみ「新しいチャットを始める」ボタン表示（オーナー側は不要）
        if (state.mode === 'visitor') addRestartButton();
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
    if (state.reception_banner_timer) { clearTimeout(state.reception_banner_timer); state.reception_banner_timer = null; }
}

function applyReceptionStatus(status) {
    state.is_reception_hours = status.is_reception_hours !== false;
    state.reception_start = status.reception_start || null;
    state.reception_end = status.reception_end || null;
    state.next_reception_start = status.next_reception_start || null;
    state.welcome_message = (status.welcome_message || '').trim() || null;
    renderReceptionBanner();
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

async function sendVisitorMessage(msg) {
    msg = String(msg || '').trim();
    if (!msg) return;
    refs.sendBtn.disabled = true;
    const nick = refs.nicknameInput ? String(refs.nicknameInput.value || '').trim().slice(0, 20) : '';
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
}

async function refreshOwnerStatus() {
    try {
        const status = await api('shop-status', { shop_slug: SLUG }, 'GET');
        state.is_online = status.is_online;
        state.reception_start = status.reception_start || null;
        state.reception_end = status.reception_end || null;
        updateStatusIndicator(status.is_online);
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
        const displayName = s.nickname ? esc(s.nickname) : `${esc(t('inbox.visitorPrefix'))} #${s.id}`;
        li.innerHTML = `
            <div class="inbox-item-title">
                <span>${displayName} ${statusBadge}</span>${unread}
            </div>
            <div class="inbox-item-preview">${esc(s.last_sender === 'shop' ? t('inbox.selfPrefix') : '')}${esc(s.last_message || '')}</div>
            <div class="inbox-item-time">${esc(formatTime(s.last_activity_at))}</div>
        `;
        li.addEventListener('click', () => openOwnerThread(s.id));
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
    refs.inputArea.classList.toggle('hidden', isClosed);
    refs.ownerTemplates.classList.toggle('hidden', isClosed);
    if (refs.emojiToggle) refs.emojiToggle.classList.toggle('hidden', isClosed);
    if (isClosed && refs.ownerQuick) refs.ownerQuick.classList.add('hidden');
    if (isClosed) addSystemMessage(t('thread.closedThanks'));
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
    if (state.mode === 'owner') sendOwnerReply(msg);
    else sendVisitorMessage(msg);
});

refs.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        refs.sendBtn.click();
    }
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
        const res = await api('toggle-notify', {
            device_token: state.device_token,
            enabled: isOn ? 1 : 0
        });
        state.notify_enabled = isOn;
        // 受付トグルは is_online も同時に切り替える → オーナー画面のステータスドット即時反映
        updateStatusIndicator(res && typeof res.is_online !== 'undefined' ? !!res.is_online : isOn);
    } catch (err) {
        showError(err.message);
        e.target.checked = !isOn;
    }
});

refs.btnRefresh.addEventListener('click', () => showInbox());
function backToInbox() {
    state.selected_session = null;
    if (refs.btnBlock) refs.btnBlock.classList.add('hidden');
    if (refs.btnCloseSession) refs.btnCloseSession.classList.add('hidden');
    refs.ownerTemplates.classList.add('hidden');
    if (refs.ownerQuick) refs.ownerQuick.classList.add('hidden');
    if (refs.emojiToggle) refs.emojiToggle.classList.add('hidden');
    if (refs.visitorName) refs.visitorName.classList.add('hidden');
    if (refs.btnHeaderBack) refs.btnHeaderBack.classList.add('hidden');
    refs.shopName.textContent = state.shop_name;
    showInbox();
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
        await Transport.closeSession({
            deviceToken: state.device_token,
            sessionId: state.selected_session.id,
            sessionToken: state.selected_session.session_token
        });
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
