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
    device_token: '',
    inbox_sessions: [],
    selected_session: null,
    templates: [],
    polling: null,
    inbox_polling: null,
};

// ===== DOM refs =====
const $ = id => document.getElementById(id);
const refs = {
    root: $('chat-root'),
    shopName: $('chat-shop-name'),
    statusDot: $('chat-status-dot'),
    statusLabel: $('chat-status-label'),
    ownerToggle: $('chat-owner-toggle'),
    onlineToggle: $('online-toggle'),
    ownerLoginLink: $('owner-login-link'),
    homeLink: $('home-link'),
    fontSizeBtn: $('font-size-toggle'),
    langSelect: $('lang-select'),
    ownerInbox: $('owner-inbox'),
    inboxList: $('inbox-list'),
    chatThread: $('chat-thread'),
    chatMessages: $('chat-messages'),
    quickQuestions: $('quick-questions'),
    visitorNote: $('visitor-note'),
    ownerQuick: $('owner-quick'),
    nicknameArea: document.getElementById('nickname-area'),
    nicknameInput: document.getElementById('visitor-nickname'),
    ownerTemplates: $('owner-templates'),
    templateList: $('template-list'),
    inputArea: $('chat-input-area'),
    input: $('chat-input'),
    sendBtn: $('chat-send'),
    chatExit: $('chat-exit'),
    btnRefresh: $('btn-refresh-inbox'),
    btnBackInbox: $('btn-back-inbox'),
    btnBlock: $('btn-block-user'),
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
function formatTime(s) {
    if (!s) return '';
    const d = new Date(s.replace(' ', 'T') + '+09:00');
    return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
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
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
}

// ===== i18n =====
const LS_LANG = 'chat_lang_' + SLUG;
const I18N = {
    ja: {
        'status.online': 'オンライン', 'status.offline': 'オフライン',
        'owner.accept': '受付',
        'inbox.title': '📥 受信チャット', 'inbox.refresh': '更新', 'inbox.logout': 'ログアウト',
        'inbox.empty': 'まだチャットはありません',
        'quick.now': '今すぐ呼べる？', 'quick.price': '料金は？', 'quick.hours': '何時まで？', 'quick.hotel': 'このホテル呼べる？',
        'nickname.label': 'ニックネーム（任意）', 'nickname.placeholder': '例: たろう',
        'template.title': '定型文:', 'template.empty': '定型文は shop-admin で登録してください',
        'input.placeholder': 'メッセージを入力...', 'input.send': '送信',
        'thread.back': '← 受信一覧に戻る', 'thread.block': '🚫 このユーザーをブロック', 'thread.unblock': '✅ ブロック解除',
        'exit.title': '予約は以下からどうぞ:', 'exit.tel': '📞 電話する', 'exit.line': '💬 LINEで続きを',
        'login.title': '👤 オーナーログイン', 'login.desc': 'shop-admin のログイン情報でサインインしてください',
        'login.email': 'メールアドレス', 'login.password': 'パスワード', 'login.submit': 'ログイン',
        'login.note': '※ このチャットの店舗を運営するオーナー専用です',
        'load': '読み込み中…', 'owner.loginLink': '店舗オーナーの方はこちら →'
    },
    en: {
        'status.online': 'Online', 'status.offline': 'Offline',
        'owner.accept': 'Accept',
        'inbox.title': '📥 Inbox', 'inbox.refresh': 'Refresh', 'inbox.logout': 'Log out',
        'inbox.empty': 'No chats yet',
        'quick.now': 'Available now?', 'quick.price': 'Price?', 'quick.hours': 'Until what time?', 'quick.hotel': 'This hotel OK?',
        'nickname.label': 'Nickname (optional)', 'nickname.placeholder': 'e.g. John',
        'template.title': 'Templates:', 'template.empty': 'Add templates in shop-admin',
        'input.placeholder': 'Type a message...', 'input.send': 'Send',
        'thread.back': '← Back to inbox', 'thread.block': '🚫 Block this user', 'thread.unblock': '✅ Unblock',
        'exit.title': 'Book via:', 'exit.tel': '📞 Call', 'exit.line': '💬 Continue on LINE',
        'login.title': '👤 Owner login', 'login.desc': 'Sign in with your shop-admin credentials',
        'login.email': 'Email', 'login.password': 'Password', 'login.submit': 'Log in',
        'login.note': '* For the shop owner running this chat only',
        'load': 'Loading…', 'owner.loginLink': 'Are you the shop owner? Log in →'
    },
    zh: {
        'status.online': '在线', 'status.offline': '离线',
        'owner.accept': '受理',
        'inbox.title': '📥 收件箱', 'inbox.refresh': '刷新', 'inbox.logout': '登出',
        'inbox.empty': '暂无聊天',
        'quick.now': '现在可以叫吗？', 'quick.price': '价格？', 'quick.hours': '营业到几点？', 'quick.hotel': '可以到这家酒店吗？',
        'nickname.label': '昵称（可选）', 'nickname.placeholder': '例: 太郎',
        'template.title': '模板:', 'template.empty': '请在 shop-admin 添加模板',
        'input.placeholder': '输入消息...', 'input.send': '发送',
        'thread.back': '← 返回收件箱', 'thread.block': '🚫 屏蔽此用户', 'thread.unblock': '✅ 解除屏蔽',
        'exit.title': '通过以下方式预约:', 'exit.tel': '📞 电话', 'exit.line': '💬 LINE继续',
        'login.title': '👤 店主登录', 'login.desc': '使用 shop-admin 账号登录',
        'login.email': '邮箱', 'login.password': '密码', 'login.submit': '登录',
        'login.note': '※ 仅限经营此聊天的店主',
        'load': '加载中…', 'owner.loginLink': '店主登录 →'
    },
    ko: {
        'status.online': '온라인', 'status.offline': '오프라인',
        'owner.accept': '접수',
        'inbox.title': '📥 받은 채팅', 'inbox.refresh': '새로고침', 'inbox.logout': '로그아웃',
        'inbox.empty': '아직 채팅이 없습니다',
        'quick.now': '지금 부를 수 있나요？', 'quick.price': '요금은？', 'quick.hours': '몇 시까지？', 'quick.hotel': '이 호텔 가능？',
        'nickname.label': '닉네임 (선택)', 'nickname.placeholder': '예: 타로',
        'template.title': '템플릿:', 'template.empty': 'shop-admin 에서 템플릿을 등록하세요',
        'input.placeholder': '메시지를 입력...', 'input.send': '전송',
        'thread.back': '← 받은 채팅으로', 'thread.block': '🚫 이 사용자 차단', 'thread.unblock': '✅ 차단 해제',
        'exit.title': '예약은 아래에서:', 'exit.tel': '📞 전화', 'exit.line': '💬 LINE으로 계속',
        'login.title': '👤 점주 로그인', 'login.desc': 'shop-admin 로그인 정보로 로그인하세요',
        'login.email': '이메일', 'login.password': '비밀번호', 'login.submit': '로그인',
        'login.note': '※ 이 채팅을 운영하는 점주 전용',
        'load': '로딩 중…', 'owner.loginLink': '점주 로그인 →'
    }
};
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
    try {
        const savedLang = localStorage.getItem(LS_LANG);
        const browserLang = (navigator.language || 'ja').slice(0, 2);
        const initLang = savedLang || (I18N[browserLang] ? browserLang : 'ja');
        if (refs.langSelect) refs.langSelect.value = initLang;
        applyLang(initLang);
    } catch (_) { applyLang('ja'); }
    if (refs.langSelect) refs.langSelect.addEventListener('change', e => applyLang(e.target.value));

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
        const savedToken = localStorage.getItem(LS_DEVICE);
        if (savedToken) {
            try {
                const dev = await api('verify-device', { device_token: savedToken });
                if (dev.slug === SLUG) {
                    state.mode = 'owner';
                    state.device_token = savedToken;
                    state.shop_name = dev.shop_name;
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
            refs.root.innerHTML = '<div style="padding:40px;text-align:center;color:#888;">この店舗ではチャット機能をご利用いただけません</div>';
            return;
        }
        state.shop_name = status.shop_name;
        state.is_online = status.is_online;
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
    refs.ownerInbox.classList.add('hidden');
    refs.chatThread.classList.remove('hidden');
    refs.inputArea.classList.remove('hidden');
    refs.quickQuestions.classList.remove('hidden');
    if (refs.visitorNote) refs.visitorNote.classList.remove('hidden');
    refs.ownerTemplates.classList.add('hidden');
    refs.chatExit.classList.add('hidden');
    if (refs.homeLink) refs.homeLink.classList.remove('hidden');
    if (refs.nicknameArea) {
        refs.nicknameArea.classList.remove('hidden');
        if (refs.nicknameInput) refs.nicknameInput.value = localStorage.getItem(LS_NICKNAME) || '';
    }

    // 既存セッション or 新規作成
    const saved = JSON.parse(localStorage.getItem(LS_SESSION) || 'null');
    if (saved && saved.token) {
        state.session_token = saved.token;
        state.session_id = saved.session_id || 0;
        // リロード時は全履歴を再取得（since_id=0）
        state.last_message_id = 0;
        await pollMessages(true);
    } else {
        const s = await api('start-session', { shop_slug: SLUG, source: isEmbedded() ? 'widget' : 'standalone' });
        state.session_token = s.session_token;
        state.session_id = s.session_id;
        saveVisitorSession();
        addSystemMessage('チャットを開始しました。お気軽にご質問ください。');
    }

    startVisitorPolling();
}

function isEmbedded() { return window.self !== window.top; }
function saveVisitorSession() {
    localStorage.setItem(LS_SESSION, JSON.stringify({
        token: state.session_token,
        session_id: state.session_id,
        last_message_id: state.last_message_id,
    }));
}

function updateStatusIndicator(online) {
    state.is_online = online;
    refs.statusDot.classList.toggle('online', online);
    refs.statusDot.classList.toggle('offline', !online);
    refs.statusLabel.textContent = t(online ? 'status.online' : 'status.offline');
}

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'msg msg-system';
    div.textContent = text;
    refs.chatMessages.appendChild(div);
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
}

function addMessage(m, fromOwner) {
    const div = document.createElement('div');
    const isVisitor = m.sender_type === 'visitor';
    const renderAs = fromOwner ? (isVisitor ? 'shop' : 'visitor') : (isVisitor ? 'visitor' : 'shop');
    div.className = 'msg ' + renderAs;
    div.textContent = m.message;

    const t = document.createElement('div');
    t.className = 'msg-time';
    t.textContent = formatTime(m.sent_at);
    div.appendChild(t);
    refs.chatMessages.appendChild(div);
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;

    // 翻訳表示: 相手のメッセージで、言語が viewer 側と異なる場合に自動翻訳
    const isOthers = fromOwner ? isVisitor : !isVisitor;
    const src = ((m.source_lang || '').toLowerCase()) || detectLang(m.message);
    if (isOthers && src && src !== currentLang && I18N[src] && I18N[currentLang]) {
        maybeTranslate(div, m.message, src, currentLang);
    }
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

async function pollMessages(initial) {
    if (!state.session_token) return;
    try {
        const data = await api('poll-messages', {
            session_token: state.session_token,
            since_id: state.last_message_id
        }, 'GET');
        for (const m of (data.messages || [])) {
            addMessage(m, false);
            state.last_message_id = Math.max(state.last_message_id, m.id);
        }
        updateStatusIndicator(data.shop_online);
        if (data.status === 'closed') {
            stopPolling();
            addSystemMessage('チャットが終了しました');
            refs.inputArea.classList.add('hidden');
        }
        if ((data.messages || []).length) saveVisitorSession();
    } catch (e) {
        if (!initial) return;
        showError(e.message);
    }
}

function startVisitorPolling() {
    stopPolling();
    state.polling = setInterval(() => pollMessages(false), POLL_INTERVAL);
}
function stopPolling() {
    if (state.polling) { clearInterval(state.polling); state.polling = null; }
    if (state.inbox_polling) { clearInterval(state.inbox_polling); state.inbox_polling = null; }
}

async function sendVisitorMessage(msg) {
    msg = String(msg || '').trim();
    if (!msg) return;
    refs.sendBtn.disabled = true;
    const nick = refs.nicknameInput ? String(refs.nicknameInput.value || '').trim().slice(0, 20) : '';
    if (nick) localStorage.setItem(LS_NICKNAME, nick);
    try {
        await api('send-message', {
            session_token: state.session_token,
            message: msg,
            nickname: nick,
            lang: currentLang
        });
        refs.input.value = '';
        await pollMessages(false);
    } catch (e) {
        showError(e.message);
    } finally {
        refs.sendBtn.disabled = false;
    }
}

// ===== オーナーモード =====
async function enterOwnerMode() {
    refs.shopName.textContent = state.shop_name;
    refs.ownerToggle.classList.remove('hidden');
    if (refs.homeLink) refs.homeLink.classList.add('hidden');
    refs.quickQuestions.classList.add('hidden');
    if (refs.visitorNote) refs.visitorNote.classList.add('hidden');
    if (refs.ownerQuick) refs.ownerQuick.classList.add('hidden');
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
        updateStatusIndicator(status.is_online);
        refs.onlineToggle.checked = status.is_online;
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
        const statusBadge = s.status === 'closed' ? '<span style="color:#999;font-size:11px;">(終了)</span>' : '';
        const displayName = s.nickname ? esc(s.nickname) : `訪問者 #${s.id}`;
        li.innerHTML = `
            <div class="inbox-item-title">
                <span>${displayName} ${statusBadge}</span>${unread}
            </div>
            <div class="inbox-item-preview">${esc(s.last_sender === 'shop' ? '自分: ' : '')}${esc(s.last_message || '')}</div>
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
    refs.chatExit.classList.remove('hidden');
    refs.ownerTemplates.classList.remove('hidden');
    if (refs.ownerQuick) refs.ownerQuick.classList.remove('hidden');
    refs.chatMessages.innerHTML = '';
    state.last_message_id = 0;

    const visitorLabel = state.selected_session.nickname
        ? state.selected_session.nickname
        : `訪問者 #${state.selected_session.id}`;
    refs.shopName.textContent = `${state.shop_name} ← ${visitorLabel}`;

    try {
        const data = await api('owner-inbox', {
            device_token: state.device_token,
            session_id: sessionId
        }, 'GET');
        for (const m of (data.messages || [])) {
            addMessage(m, true);
            state.last_message_id = Math.max(state.last_message_id, m.id);
        }
        state.selected_session.is_blocked = !!data.is_blocked;
        updateBlockButton();
    } catch (e) { showError(e.message); }

    const isClosed = state.selected_session.status === 'closed';
    refs.inputArea.classList.toggle('hidden', isClosed);
    refs.ownerTemplates.classList.toggle('hidden', isClosed);
    if (refs.ownerQuick) refs.ownerQuick.classList.toggle('hidden', isClosed);
}

function updateBlockButton() {
    if (!refs.btnBlock || !state.selected_session) return;
    if (state.selected_session.is_blocked) {
        refs.btnBlock.textContent = t('thread.unblock');
        refs.btnBlock.classList.remove('danger');
        refs.btnBlock.classList.add('success');
    } else {
        refs.btnBlock.textContent = t('thread.block');
        refs.btnBlock.classList.remove('success');
        refs.btnBlock.classList.add('danger');
    }
}

async function sendOwnerReply(msg) {
    if (!state.selected_session) return;
    msg = String(msg || '').trim();
    if (!msg) return;
    refs.sendBtn.disabled = true;
    try {
        const r = await api('owner-reply', {
            device_token: state.device_token,
            session_id: state.selected_session.id,
            message: msg
        });
        refs.input.value = '';
        const now = new Date();
        const pad = n => n.toString().padStart(2,'0');
        const jstStr = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) + ' '
                     + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
        addMessage({ sender_type: 'shop', message: msg, sent_at: jstStr }, true);
        if (r && r.message_id) state.last_message_id = Math.max(state.last_message_id, Number(r.message_id));
    } catch (e) { showError(e.message); }
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

function startInboxPolling() {
    stopPolling();
    state.inbox_polling = setInterval(async () => {
        if (!refs.ownerInbox.classList.contains('hidden')) {
            await showInbox();
        } else if (state.selected_session) {
            try {
                const data = await api('owner-inbox', {
                    device_token: state.device_token,
                    session_id: state.selected_session.id
                }, 'GET');
                for (const m of (data.messages || [])) {
                    if (m.id > state.last_message_id) {
                        addMessage(m, true);
                        state.last_message_id = m.id;
                    }
                }
            } catch (e) { /* ignore */ }
        }
    }, INBOX_INTERVAL);
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

refs.quickQuestions.addEventListener('click', (e) => {
    const btn = e.target.closest('.quick-btn');
    if (!btn) return;
    sendVisitorMessage(btn.dataset.quick);
});

if (refs.ownerQuick) {
    refs.ownerQuick.addEventListener('click', (e) => {
        const btn = e.target.closest('.quick-btn');
        if (!btn) return;
        refs.input.value = btn.dataset.quick || '';
        refs.input.focus();
    });
}

refs.onlineToggle.addEventListener('change', async (e) => {
    try {
        const res = await api('toggle-online', {
            device_token: state.device_token,
            is_online: e.target.checked ? 1 : 0
        });
        updateStatusIndicator(res.is_online);
    } catch (err) {
        showError(err.message);
        e.target.checked = !e.target.checked;
    }
});

refs.btnRefresh.addEventListener('click', () => showInbox());
refs.btnBackInbox.addEventListener('click', () => {
    state.selected_session = null;
    refs.chatExit.classList.add('hidden');
    refs.ownerTemplates.classList.add('hidden');
    if (refs.ownerQuick) refs.ownerQuick.classList.add('hidden');
    refs.shopName.textContent = state.shop_name;
    showInbox();
});

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
            refs.chatExit.classList.add('hidden');
            refs.ownerTemplates.classList.add('hidden');
            await showInbox();
        } catch (e) { showError(e.message); }
    }
});

// ログインモーダル
if (refs.ownerLoginLink) refs.ownerLoginLink.addEventListener('click', openLoginModal);
if (refs.loginClose) refs.loginClose.addEventListener('click', closeLoginModal);
if (refs.loginModal) refs.loginModal.addEventListener('click', (e) => {
    if (e.target === refs.loginModal) closeLoginModal();
});
if (refs.loginForm) refs.loginForm.addEventListener('submit', handleLogin);
if (refs.btnOwnerLogout) refs.btnOwnerLogout.addEventListener('click', handleOwnerLogout);

window.addEventListener('beforeunload', stopPolling);
window.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else if (state.mode === 'visitor' && state.session_token) startVisitorPolling();
    else if (state.mode === 'owner') startInboxPolling();
});

// ===== 起動 =====
init();

})();
