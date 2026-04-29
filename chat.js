// chat.js — YobuCha (スタンドアロンチャット + ウィジェット共用)
// モード:
//   - 訪問者: session_token (localStorage:chat_session_<slug>) で会話継続
//   - オーナー: device_token (localStorage:chat_owner_token) 優先、無ければ
//               shop-auth PHPセッションから自動発行
//   - URLパスでのトークン受け渡しは廃止（セキュリティ強化）

(function(){
'use strict';

const API = '/api/chat-api.php';
const CHAT_SEND_API = '/api/chat-send.php';  // 統一送信エンドポイント (4 auth kind を単一URLへ集約)
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

// 訪問者セッション復元: ?resume=<session_token> で既存セッションを LS に投入してからチャットを開く.
// chat-notify-visitor.php がメール内「続きを見る」リンクに付与する. 別端末/他ブラウザからもトークン所持者は履歴を引き継げる.
// 形式は DO(UUID) / PHP(48桁hex) 両対応.
function getResumeToken() {
    try {
        const p = new URLSearchParams(window.location.search);
        const v = (p.get('resume') || '').trim().toLowerCase();
        return /^[a-f0-9\-]{32,64}$/.test(v) ? v : '';
    } catch (_) { return ''; }
}

// キャスト URL HMAC bearer (HIGH 2026-04-29).
// chat-notify.php がメール通知URLに ?ct=<base64url>&iat=<epoch> で付与.
// cast-url-* (reply / toggle-notify) を叩く時にそのまま転送し、PHP 側で
// shop_cast_id + session_token + iat の HMAC として検証される.
// session_token 漏洩時の cast 名義成りすまし防止.
function getCastBearer() {
    try {
        const p = new URLSearchParams(window.location.search);
        const ct = (p.get('ct') || '').trim();
        const iat = parseInt(p.get('iat') || '0', 10);
        if (!/^[A-Za-z0-9_\-]{16,64}$/.test(ct) || !Number.isFinite(iat) || iat <= 0) return null;
        return { ct, iat };
    } catch (_) { return null; }
}

const SLUG = getSlug();
const CAST_ID = getCastParam();
const CAST_BEARER = getCastBearer();
const VIEW_TOKEN = getViewToken();
const CAST_INBOX_TOKEN = getCastInboxToken();
const RESUME_TOKEN = getResumeToken();
const IS_CAST_VIEW = !!(CAST_ID && VIEW_TOKEN);
const IS_CAST_INBOX = !!CAST_INBOX_TOKEN;
// キャストモード (view / inbox) は入力中の非表示ルールを viewport 問わず適用するため body クラスで識別.
if (IS_CAST_VIEW || IS_CAST_INBOX) {
    try { document.body.classList.add('cast-mode'); } catch (_) {}
}
if (!SLUG) {
    document.getElementById('chat-root').innerHTML = '<div style="padding:40px;text-align:center;color:#888;">チャットURLが不正です</div>';
    return;
}

const LS_SESSION = 'chat_session_' + SLUG + '_' + (CAST_ID || 'shop');
const LS_NICKNAME = 'chat_nickname_' + SLUG;
// 下書き自動保存: 送信前に入力欄の内容を session 単位で保持. リロード/回線断でも復元.
// キーは LS_SESSION と同じ粒度 (slug + cast/shop). 送信成功 or 明示ログアウトでクリア.
const LS_DRAFT = 'chat_draft_' + SLUG + '_' + (CAST_ID || 'shop') + (IS_CAST_INBOX ? '_inbox' : '');
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
    nickname_locked: false,   // [legacy] 過去は最初の送信後に true で固定. 現在は変更可のため常に false.
    // 2026-04-23 翻訳アンカー: 訪問者の入力言語. visitor=ja なら両側翻訳OFF, 非ja なら shop viewer=ja / visitor viewer=visitor_input_lang で翻訳.
    visitor_input_lang: 'ja',
    // 2026-04-23 アバター: お店/キャストのメッセージバブル左に表示する丸アイコン (訪問者はアイコン無し)
    shop_avatar_url: null,
    cast_avatar_url: null,
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
    visitorNotify: $('visitor-notify'),
    visitorNotifyToggle: $('visitor-notify-toggle'),
    visitorNotifyBody: $('visitor-notify-body'),
    visitorNotifyEmail: $('visitor-notify-email'),
    visitorNotifySave: $('visitor-notify-save'),
    visitorNotifyStatus: $('visitor-notify-status'),
    visitorNotifyStatusMsg: $('visitor-notify-status-msg'),
    visitorNotifyCloseLink: $('visitor-notify-close-link'),
    visitorNotifyResend: $('visitor-notify-resend'),
    visitorNotifyEdit: $('visitor-notify-edit'),
};

// ===== ユーティリティ =====
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showError(msg) {
    refs.error.textContent = msg;
    refs.error.classList.remove('hidden');
    setTimeout(() => refs.error.classList.add('hidden'), 3500);
}
function setLoading(on) { refs.root.classList.toggle('loading', on); }

// ===== スクロール・ダウン ボタン =====
// LINE流: ユーザーが履歴を遡り読み中に新着が届いても画面を勝手にジャンプさせない.
// 代わりに右下にカウント付きピルを出し、タップで末尾へ飛ぶ.
// しきい値 NEAR_BOTTOM_PX より上にいる時だけ「未読扱い」でカウントを増やす.
const NEAR_BOTTOM_PX = 120;
let _unreadBelowCount = 0;
let _scrollBottomBtn = null;
function isNearBottom() {
    const el = refs.chatMessages;
    if (!el) return true;
    return (el.scrollHeight - el.scrollTop - el.clientHeight) < NEAR_BOTTOM_PX;
}
function ensureScrollBottomBtn() {
    if (_scrollBottomBtn) return _scrollBottomBtn;
    const thread = refs.chatThread;
    if (!thread) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'scroll-bottom-btn';
    btn.setAttribute('aria-label', '最新メッセージへ');
    btn.innerHTML = '<span class="scroll-bottom-arrow" aria-hidden="true">▼</span><span class="scroll-bottom-count hidden">0</span>';
    btn.addEventListener('click', () => scrollChatToBottom(true));
    thread.appendChild(btn);
    _scrollBottomBtn = btn;
    return btn;
}
function updateScrollBottomBtn() {
    const btn = ensureScrollBottomBtn();
    if (!btn) return;
    const near = isNearBottom();
    if (near) {
        _unreadBelowCount = 0;
        btn.classList.remove('visible');
        const c = btn.querySelector('.scroll-bottom-count');
        if (c) { c.textContent = '0'; c.classList.add('hidden'); }
        return;
    }
    if (_unreadBelowCount > 0) {
        btn.classList.add('visible');
        const c = btn.querySelector('.scroll-bottom-count');
        if (c) {
            c.textContent = String(_unreadBelowCount);
            c.classList.remove('hidden');
        }
    } else {
        btn.classList.add('visible');
        const c = btn.querySelector('.scroll-bottom-count');
        if (c) c.classList.add('hidden');
    }
}
function scrollChatToBottom(force) {
    if (!refs.chatMessages) return;
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
    _unreadBelowCount = 0;
    updateScrollBottomBtn();
    if (force) {
        // レイアウト変動 (keyboard, 翻訳描画) による微妙なズレを次tickで補正
        requestAnimationFrame(() => {
            if (refs.chatMessages) refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
        });
    }
}
// 新着到着時: 末尾近くなら auto-scroll、そうでないならボタン表示 + カウント++
function autoScrollOnIncoming(isSelf) {
    // 自分の送信は常に末尾へ（LINE流: 送信直後は画面を追従）
    if (isSelf) { scrollChatToBottom(true); return; }
    if (isNearBottom()) {
        scrollChatToBottom(false);
    } else {
        _unreadBelowCount++;
        updateScrollBottomBtn();
    }
}

// ===== 下書き自動保存 =====
// 入力欄の内容を localStorage に保持. 送信成功/ログアウトでクリア.
// キャスト受信箱など選択セッションが変わるモードでは restoreDraft の呼び元が LS_DRAFT を上書きする前提.
let _draftSaveTimer = 0;
function saveDraftNow() {
    if (!refs.input) return;
    if (state.mode !== 'visitor') return;
    const val = String(refs.input.value || '');
    try {
        if (val) localStorage.setItem(LS_DRAFT, val);
        else localStorage.removeItem(LS_DRAFT);
    } catch (_) {}
}
function scheduleDraftSave() {
    // オーナー/キャスト受信箱モードではセッションを跨いで返信するため、
    // 共通キーに下書きを溜めるとセッション間で内容が混線する. visitor/cast_view のみ対象.
    if (state.mode !== 'visitor') return;
    if (_draftSaveTimer) clearTimeout(_draftSaveTimer);
    _draftSaveTimer = setTimeout(() => {
        _draftSaveTimer = 0;
        saveDraftNow();
    }, 350);
}
function restoreDraft() {
    if (!refs.input) return;
    let saved = '';
    try { saved = localStorage.getItem(LS_DRAFT) || ''; } catch (_) {}
    if (saved && !refs.input.value) {
        refs.input.value = saved;
    }
}
function clearDraft() {
    if (_draftSaveTimer) { clearTimeout(_draftSaveTimer); _draftSaveTimer = 0; }
    try { localStorage.removeItem(LS_DRAFT); } catch (_) {}
}

// Day 8 typing-stop state. _bindChatInputEvents が closure で参照するため、
// このモジュールの早い位置で宣言しておく (rebind 後も同じ変数を共有する).
let _hadTypingValue = false;
// 送信後 IME コミット用の focus 切替中は class toggle / parent postMessage を抑止.
// 抑止しないと chat-input-focused が外れて footer 復活 → 親 iframe 高さ変更 → flicker.
let _imeCommitGuard = false;
// 送信時に IME composition 中で gentle clear が拒否された場合のフラグ.
// compositionend で拾って遅延クリアする (2026-04-27 v=164).
let _pendingClearAfterComposition = false;
// 変換前送信した text を一時保持. iOS IME state restore で再 inject された場合に即クリア (v=165).
let _recentSentSnapshot = null;
let _recentSentSnapshotTimer = null;
// IME composition 中フラグ. 送信ボタンの disabled 制御用 (v=168, ユーザー提案).
// 変換確定してから送信させる方式 = iOS IME buffer 問題が根本から発生しない.
let _isComposing = false;

// 送信後の入力欄クリア.
// CSS 側に `-webkit-user-select:text !important` を入れたことで iOS Safari でも
// 単純な value='' で連続入力できるようになった (textarea swap は副作用でレイアウトが崩れるため撤去).
// _bindChatInputEvents は初期バインドにも流用するためヘルパとして残す.
function _bindChatInputEvents(input) {
    input.addEventListener('input', () => {
        // 変換前送信後の iOS IME composition buffer 復活対策 (v=167):
        // iOS は textarea の value を消しても OS レベルで composition buffer を保持しており、
        // user が再 tap → typing 開始すると compositionstart で snapshot を再 inject する.
        // ① 完全一致 (value === snapshot): IME buffer 単体復活 → 即クリア
        // ② prefix 一致 (value.startsWith(snapshot) && longer): snapshot + 新文字 → snapshot 部分だけ剥がす
        if (_recentSentSnapshot) {
            if (input.value === _recentSentSnapshot) {
                try { input.value = ''; } catch (_) {}
                return;
            }
            if (input.value.startsWith(_recentSentSnapshot) && input.value.length > _recentSentSnapshot.length) {
                const tail = input.value.substring(_recentSentSnapshot.length);
                try { input.setRangeText(tail, 0, input.value.length, 'end'); } catch (_) {
                    try { input.value = tail; } catch (__) {}
                }
                // snapshot は剥がし終わったので無効化
                _recentSentSnapshot = null;
                if (_recentSentSnapshotTimer) {
                    clearTimeout(_recentSentSnapshotTimer);
                    _recentSentSnapshotTimer = null;
                }
            }
        }
        if (input.value) {
            _hadTypingValue = true;
            emitTyping();
        } else if (_hadTypingValue) {
            _hadTypingValue = false;
            emitTypingStop();
        }
        scheduleDraftSave();
        // v=179: 絵文字専用 reset 削除. 文字/絵文字で挙動を分けないため不要.
    });
    // compositionupdate も同条件で拾う (input event より早く飛ぶケースあり).
    input.addEventListener('compositionupdate', (e) => {
        if (!_recentSentSnapshot || !e.data) return;
        if (e.data === _recentSentSnapshot) {
            try { input.value = ''; } catch (_) {}
        } else if (e.data.startsWith(_recentSentSnapshot) && e.data.length > _recentSentSnapshot.length) {
            const tail = e.data.substring(_recentSentSnapshot.length);
            try { input.setRangeText(tail, 0, input.value.length, 'end'); } catch (_) {
                try { input.value = tail; } catch (__) {}
            }
            _recentSentSnapshot = null;
            if (_recentSentSnapshotTimer) {
                clearTimeout(_recentSentSnapshotTimer);
                _recentSentSnapshotTimer = null;
            }
        }
    });
    // 変換中は送信ボタンを視覚的に無効化 (v=168→v=178).
    // ── disabled 属性は付けない (2026-04-27): iOS 絵文字パレットは compositionstart は発火するが
    // compositionend が抜けることがあり, disabled が解除されず連打が必要になっていた
    // (memory: feedback_ios_emoji_palette_composition).
    // 代わりに click handler で value に \p{L}\p{Nd} を含む場合のみ送信ブロック → 純記号/絵文字は通す.
    // 変換中送信で文字復活問題への根本ガードは「value に文字を含む = 変換中」という条件で同等効果.
    input.addEventListener('compositionstart', () => {
        _isComposing = true;
        if (refs.sendBtn) {
            refs.sendBtn.classList.add('composing');
        }
    });
    input.addEventListener('compositionend', () => {
        _isComposing = false;
        if (refs.sendBtn) {
            refs.sendBtn.classList.remove('composing');
        }
    });
    input.addEventListener('blur', () => {
        if (_imeCommitGuard) return;
        if (_hadTypingValue) {
            _hadTypingValue = false;
            emitTypingStop();
        }
        saveDraftNow();
        document.body.classList.remove('chat-input-focused');
        if (isEmbedded()) {
            try { window.parent.postMessage({ type: 'ychat:input-blur', slug: SLUG }, '*'); } catch (_) {}
        }
    });
    input.addEventListener('focus', () => {
        if (_imeCommitGuard) return;
        document.body.classList.add('chat-input-focused');
        if (isEmbedded()) {
            try { window.parent.postMessage({ type: 'ychat:input-focus', source: 'focus', slug: SLUG }, '*'); } catch (_) {}
        }
    });
    // 変換前送信で gentle clear が IME composition に拒否されたケースの fallback.
    // composition が自然終了 (確定 / キャンセル / blur 等) した瞬間に value を空にする.
    // (2026-04-27 v=164: blur で IME強制コミットする戦略は iOS Safari の最適化で
    //  no-op 化されたり kb-close edge を引いて iframe 縮小を起こすため撤回.
    //  「変換前送信時に文字が残る」UX は許容し、composition 終了時に clean up する方針.)
    input.addEventListener('compositionend', () => {
        if (_pendingClearAfterComposition) {
            _pendingClearAfterComposition = false;
            try { input.value = ''; } catch (_) {}
        }
    });
    // Enter キー: PC (hover:hover + pointer:fine) のみ Gmail/Slack 流で送信.
    //   - Enter (修飾なし) → 送信
    //   - Shift+Enter → 改行 (デフォルト挙動、preventDefault しない)
    //   - 変換中 (_isComposing / e.isComposing) → 送信しない (ユーザールール: 変換前は送信禁止)
    // タッチデバイス (スマホ/タブレット) は LINE 流: Enter は常に textarea デフォルト=改行.
    //   - mobile では Enter→送信は誤爆が多くユーザー却下済み (memory: feedback_chat_enterkeyhint_send).
    input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        // composition 中は触らない (改行も送信もしない. textarea の確定入力に任せる).
        if (e.isComposing || _isComposing) return;
        // 修飾キー: Shift+Enter は改行 (デフォルト). Ctrl/Cmd/Alt+Enter は誤爆防止のため何もしない.
        if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
        // PC/desktop 判定: hover:hover and pointer:fine = mouse プライマリの環境.
        // iPad で外付けキーボード使用時も pointer:fine になるが、iPad で Enter=送信は LINE 流で問題なし
        // という判断 (要望があれば再検討).
        let isDesktop = false;
        try {
            isDesktop = typeof window.matchMedia === 'function'
                && window.matchMedia('(hover:hover) and (pointer:fine)').matches;
        } catch (_) {}
        if (!isDesktop) return;
        e.preventDefault();
        _doSendFromButton();
    });
}
// IME composition を強制コミット.
// mousedown.preventDefault で focus 維持型の送信ボタンを使うと iOS Safari は
// compositionend を自動発火しないため、value を読む / クリアする前に明示的に
// blur → focus でコミットさせる必要がある. user gesture context 内なら blur で
// keyboard が一瞬閉じても直後の focus で再オープン可能.
// _imeCommitGuard で blur/focus listener の副作用 (chat-input-focused class /
// parent postMessage) を抑止し flicker を防止.
// 隠し input への focus 移動で IME を強制コミット.
// 同一要素の blur→focus は iOS Safari が「変化なし」と最適化して compositionend を発火しないが、
// 別要素へ focus を移すと確実にコミットされる (ログで確認済み, 2026-04-26).
// _imeCommitGuard で _bindChatInputEvents の blur/focus 副作用を抑止し flicker を防止.
let _imeCommitTempEl = null;
function getImeCommitTempEl() {
    if (_imeCommitTempEl && _imeCommitTempEl.isConnected) return _imeCommitTempEl;
    const t = document.createElement('input');
    t.type = 'text';
    t.tabIndex = -1;
    t.setAttribute('aria-hidden', 'true');
    t.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(t);
    _imeCommitTempEl = t;
    return t;
}
function commitImeIfNeeded() {
    const el = refs.input;
    if (!el) return;
    if (document.activeElement !== el) return;
    const tmp = getImeCommitTempEl();
    _imeCommitGuard = true;
    try { tmp.focus(); } catch (_) {}
    try { el.focus({ preventScroll: true }); } catch (_) {}
    setTimeout(() => { _imeCommitGuard = false; }, 0);
}

// iOS Safari の textarea を focus 中に value='' で空にすると
//  ① placeholder 描画が崩れる (字間バラバラ)
//  ② IME state が壊れて 再タップするまで文字入力を silently 拒否
// が起きる. -webkit-user-select:text を CSS で当てるだけでは ② が完全には消えない.
// document.execCommand('insertText', false, '') は iOS Safari が「ユーザー操作」扱いに
// するため focus / IME state / 描画が全部 native に保たれる (Slack/Discord 系の定番).
// execCommand 自体は deprecated だが対応は全ブラウザに残っており, この用途では現役.
function clearInputPreservingIme() {
    const el = refs.input;
    if (!el) return;
    if (el.value.length === 0) return;
    // 戦略 (2026-04-27 v=166 LINE越え版):
    //   ① snapshot 記憶: 送信 text を 3秒間 _recentSentSnapshot に保持し、その間の
    //      input/compositionupdate で値一致すれば即クリア (= iOS IME buffer 再 inject 対策)
    //   ② execCommand('delete')  — selectAll後の delete は user action 扱いで IME commit を促す
    //   ③ execCommand('insertText','') — paint/IME state を native に保つ正攻法
    //   ④ value='' fallback
    //   ⑤ readOnly toggle — iOS IME composition buffer を強制 reset (focus 維持)
    //   ⑥ compositionend listener fallback (_pendingClearAfterComposition)
    _recentSentSnapshot = el.value;
    if (_recentSentSnapshotTimer) clearTimeout(_recentSentSnapshotTimer);
    _recentSentSnapshotTimer = setTimeout(() => {
        _recentSentSnapshot = null;
        _recentSentSnapshotTimer = null;
    }, 1500);  // v=179: 5秒→1.5秒. iOS IME re-injection は ms 単位なので十分.
                // 5秒だと user が同じ絵文字/文字を連投したときに input 自動クリアされ送信できなくなる.
    try {
        // ② selectAll + delete (IME commit を促す)
        try { el.select(); } catch (_) {}
        try { document.execCommand('delete'); } catch (_) {}
        // ③ insertText('') fallback
        if (el.value.length > 0) {
            try { el.select(); } catch (_) {}
            try { document.execCommand('insertText', false, ''); } catch (_) {}
        }
        // ④ value='' fallback
        if (el.value.length > 0) {
            try { el.value = ''; } catch (_) {}
        }
        // ⑤ readOnly toggle: iOS IME composition buffer を強制 reset.
        //    readOnly=true → false は同期で完結し focus を失わない (キーボードも閉じない、実機検証済).
        //    blur と違って vv.resize を発火させないため chat-embed.js iframe 縮小も起きない.
        if (el.value.length > 0) {
            try {
                el.readOnly = true;
                el.value = '';
                el.readOnly = false;
            } catch (_) {}
        }
        // ⑥ それでも残れば compositionend で拾う
        if (el.value.length > 0) {
            _pendingClearAfterComposition = true;
        }
    } catch (_) {
        try { el.value = ''; } catch (__) {}
    }
}

function setThemeMode(mode) {
    const m = ['men','women','men_same','women_same','este'].includes(mode) ? mode : 'men';
    try { document.body.dataset.mode = m; } catch (_) {}
    try { updateCastIconForMode(m); } catch (_) {}
    // chat-sheet.html (親) にもテーマ通知 (women=jofu のネオモーフUI適用に必須).
    // 直URL/埋込どちらでも安全 (top===self なら NoOp).
    try {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'ychat:theme', mode: m, slug: SLUG }, '*');
        }
    } catch (_) {}
}
// 指名ラベルのアイコンを店舗ジャンルに合わせて切替.
// deli(men)/este/women_same → 女性キャスト, jofu(women)/men_same → 男性キャスト.
function updateCastIconForMode(mode) {
    const el = document.getElementById('embed-cast-icon');
    if (!el) return;
    const female = (mode === 'men' || mode === 'este' || mode === 'women_same');
    el.textContent = female ? '💁‍♀️' : '💁‍♂️';
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

// =========================================================
// 統一送信 (/api/chat-send.php).
// 4 auth kind (visitor / owner / cast_view / cast_inbox) を単一エンドポイントに集約.
// PHP が MySQL へ書き込んでから DO /broadcast へリレーし、接続中の WebSocket に push する.
// respondSessionBatch / respondOwnerBatch と同形のバッチを返すので、既存の applyVisitorBatch /
// applyOwnerBatch でそのまま反映できる.
//
// payload = {
//   auth: { kind, session_token?, shop_cast_id?, inbox_token?, device_token? },
//   message, client_msg_id, since_id,
//   session_id?, nickname?, lang?
// }
// =========================================================
async function sendUnified(payload) {
    const res = await fetch(CHAT_SEND_API, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false || data.error) {
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.status = res.status;
        err.authFailed = res.status === 401 && /device/i.test(data.error || '');
        throw err;
    }
    return data;
}

// =========================================================
// Outbox + 楽観的UI (Day 4)
// - 送信ボタン押下で即 addMessage. サーバ応答を待たずに画面反映 (LINE UX).
// - 送信成功: bubble の .sending 削除 + data-msg-id を正式 id で更新.
// - 送信失敗: .failed + 再送ボタン. outbox に残し、visibilitychange/online で再試行.
// - outbox は in-memory (リロードで消える). 永続化は Day 4.5 以降 (必要なら localStorage).
// =========================================================
const _outbox = new Map(); // cmid -> {payload, text, attempts, createdAt, nextRetryAt, lastErrorKind}
const _retryTimers = new Map(); // cmid -> setTimeout id (単発の自動再送用)

// 送信失敗の3分岐: offline (端末がオフライン) / network (通信エラー) / temporary (5xx) / permanent (4xx).
// retryable=false なら再送ボタンを出さず outbox からも破棄 (連投/blocked/closed 等).
function classifyFailure(err) {
    const status = err && typeof err.status === 'number' ? err.status : 0;
    // 4xx: サーバーが明示的に拒否. 再送しても同じ結果.
    if (status >= 400 && status < 500) {
        return { kind: 'permanent', icon: '✕', retryable: false };
    }
    // 5xx: サーバー一時障害. 自動再送する価値あり.
    if (status >= 500) {
        return { kind: 'temporary', icon: '⚠️', retryable: true };
    }
    // status 未設定 = fetch失敗 (network). 端末がオフラインかネット経路の問題.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return { kind: 'offline', icon: '📡', retryable: true };
    }
    return { kind: 'network', icon: '🔄', retryable: true };
}

// 自動再送の指数バックオフ: 2^(attempts-1) 秒, 上限 60s.
function computeBackoffMs(attempts) {
    const n = Math.max(1, attempts | 0);
    const sec = Math.min(60, Math.pow(2, n - 1));
    return sec * 1000;
}

// ネットワーク状態バナー. offline→赤, online復帰→緑(1.5s autohide).
let _netBannerTimer = 0;
function showNetworkBanner(kind, text) {
    const el = document.getElementById('network-banner');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden', 'offline', 'reconnected');
    el.classList.add(kind);
    // reflow で transition 起動
    void el.offsetHeight;
    el.classList.add('visible');
    if (_netBannerTimer) { clearTimeout(_netBannerTimer); _netBannerTimer = 0; }
    if (kind === 'reconnected') {
        _netBannerTimer = setTimeout(() => hideNetworkBanner(), 1800);
    }
}
function hideNetworkBanner() {
    const el = document.getElementById('network-banner');
    if (!el) return;
    el.classList.remove('visible');
    if (_netBannerTimer) { clearTimeout(_netBannerTimer); _netBannerTimer = 0; }
    setTimeout(() => { try { el.classList.add('hidden'); } catch (_) {} }, 300);
}

// =========================================================
// 描画規約: 位置クラスの単一ソース
// CSS固定: .msg-row.visitor=flex-end(右/自分側), .msg-row.shop=flex-start(左/相手側)
// 命名はレガシー互換のまま維持 (POS_SELF/POS_OTHER を参照させる)
// =========================================================
const POS_SELF = 'visitor';   // 自分側の位置クラス (右)
const POS_OTHER = 'shop';     // 相手側の位置クラス (左)

// 現在のviewer視点が shop-side (owner/cast送信者) か visitor-side か
function viewerIsShopSide() {
    return !!(IS_CAST_VIEW || IS_CAST_INBOX
        || state.mode === 'owner' || state.mode === 'cast_owner');
}
// sender_type の msg を、現在のviewer視点で「自分側」か「相手側」か判定
function positionClassFor(senderType) {
    const senderIsVisitor = senderType === 'visitor';
    const isSelf = viewerIsShopSide() ? !senderIsVisitor : senderIsVisitor;
    return isSelf ? POS_SELF : POS_OTHER;
}

function addOutgoingOptimistic(cmid, text) {
    // 自送信は常に自分側(POS_SELF=右). viewer役割に関係なく固定.
    const renderAs = POS_SELF;
    // dedupe: 既にバブルがあれば既存を返す (retry 時は別 cmid を使うので基本衝突しない)
    const existing = refs.chatMessages
        ? refs.chatMessages.querySelector(`[data-cmid="${CSS.escape(cmid)}"]`)
        : null;
    if (existing) return existing;

    const nowIso = new Date().toISOString();
    const dateKey = getDateKey(nowIso);
    if (dateKey && dateKey !== state.last_msg_date) {
        addDateSeparator(dateKey);
        state.last_msg_date = dateKey;
    }

    const row = document.createElement('div');
    row.className = 'msg-row ' + renderAs;
    row.dataset.cmid = cmid;
    row.dataset.sentAt = nowIso;

    const bubble = document.createElement('div');
    bubble.className = 'msg ' + renderAs + ' sending';
    bubble.textContent = text;

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const timeEl = document.createElement('div');
    timeEl.className = 'msg-time';
    timeEl.textContent = formatTime(nowIso);
    meta.appendChild(timeEl);
    // "送信中…" ラベル
    const status = document.createElement('div');
    status.className = 'msg-send-status';
    status.textContent = t('msg.sending') || '送信中…';
    meta.appendChild(status);

    if (renderAs === POS_SELF) { row.appendChild(meta); row.appendChild(bubble); }
    else { row.appendChild(bubble); row.appendChild(meta); }
    refs.chatMessages.appendChild(row);
    // 自分送信は常に末尾へ (scroll-bottom カウンタもリセット)
    scrollChatToBottom(true);
    return row;
}

function markOptimisticSent(cmid, serverMsg) {
    if (!refs.chatMessages) return;
    const row = refs.chatMessages.querySelector(`[data-cmid="${CSS.escape(cmid)}"]`);
    if (!row) return;
    if (serverMsg && serverMsg.id) row.dataset.msgId = serverMsg.id;
    const bubble = row.querySelector('.msg');
    if (bubble) bubble.classList.remove('sending', 'failed');
    const status = row.querySelector('.msg-send-status');
    if (status) status.remove();
    // サーバー時刻で時刻ラベル更新 (楽観時は端末時刻で描画)
    if (serverMsg && serverMsg.sent_at) {
        const timeEl = row.querySelector('.msg-time');
        if (timeEl) timeEl.textContent = formatTime(serverMsg.sent_at);
        row.dataset.sentAt = serverMsg.sent_at;
    }
}

function markOptimisticFailed(cmid, err) {
    if (!refs.chatMessages) return;
    const row = refs.chatMessages.querySelector(`[data-cmid="${CSS.escape(cmid)}"]`);
    if (!row) return;
    const cls = classifyFailure(err);
    const entry = _outbox.get(cmid);
    if (entry) entry.lastErrorKind = cls.kind;

    const bubble = row.querySelector('.msg');
    if (bubble) {
        bubble.classList.remove('sending', 'pending-retry');
        bubble.classList.add('failed');
        // 自動再送予定ありの時は黄色表示にして「失敗で確定」ではないことを示す.
        if (cls.retryable && entry && entry.nextRetryAt) bubble.classList.add('pending-retry');
        if (err && err.message) bubble.title = err.message;
    }
    const meta = row.querySelector('.msg-meta');
    if (!meta) return;
    const oldStatus = meta.querySelector('.msg-send-status');
    if (oldStatus) oldStatus.remove();
    const oldActions = meta.querySelector('.msg-failed-actions');
    if (oldActions) oldActions.remove();

    const status = document.createElement('div');
    status.className = 'msg-send-status ' + (cls.retryable && entry && entry.nextRetryAt ? 'pending-retry' : 'failed');
    const icon = document.createElement('span');
    icon.className = 'msg-send-status-icon';
    icon.textContent = cls.icon;
    icon.setAttribute('aria-hidden', 'true');
    status.appendChild(icon);

    const label = document.createElement('span');
    const failedLabel = t('msg.failed') || '送信失敗';
    // kind 別の短文を優先表示 (詳細はツールチップで補完).
    let kindLabel = failedLabel;
    if (cls.kind === 'offline') kindLabel = (t('msg.offlineRetry') || 'オフライン — 再接続時に再送');
    else if (cls.kind === 'network') kindLabel = (t('msg.networkRetry') || '通信エラー — まもなく再送');
    else if (cls.kind === 'temporary') kindLabel = (t('msg.tempRetry') || '一時的な障害 — まもなく再送');
    label.textContent = kindLabel;
    status.appendChild(label);

    if (err) {
        try { console.warn('[chat] send failed (' + cls.kind + '):', err); } catch (_) {}
    }

    if (!cls.retryable) {
        // 永続エラー (4xx). 連投ブロック/セッションclosed等、再送しても無駄なので outbox からも破棄.
        dequeueOutbox(cmid);
        clearRetryTimer(cmid);
        // ユーザールール (2026-04-27): コピーボタンは廃止. 代わりに送信できなかった理由を短文で表示.
        // reason は server から来た err.message (例: "同じ内容の連投は送信できません").
        const reason = shortFailReason(err);
        const actions = buildFailedActions(cmid, /*showRetry*/ false, reason);
        meta.appendChild(status);
        meta.appendChild(actions);
        return;
    }

    // 再送可能: 手動「再送」リンク + アクションバー (削除のみ).
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'msg-retry-btn';
    retryBtn.textContent = t('msg.retry') || '再送';
    retryBtn.addEventListener('click', (e) => { e.stopPropagation(); retryOutbox(cmid); });
    status.appendChild(retryBtn);

    meta.appendChild(status);
    meta.appendChild(buildFailedActions(cmid, /*showRetry*/ false, ''));
}

// 永続エラー (4xx) の理由を短文に整形. server からの長い文言は適度に切り詰める.
function shortFailReason(err) {
    if (!err) return '送信できません';
    const raw = (err.message || '').trim();
    if (!raw || /^HTTP\s+\d/i.test(raw)) return '送信できません';
    // サーバ文言が長すぎる場合は先頭の節 (。/—/( まで) を抽出して短縮.
    const head = raw.split(/[。．\n\(（—–]/)[0].trim();
    const text = head || raw;
    return text.length > 40 ? text.slice(0, 38) + '…' : text;
}

function buildFailedActions(cmid, showRetry, reasonText) {
    const wrap = document.createElement('div');
    wrap.className = 'msg-failed-actions';
    if (showRetry) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'msg-act-retry';
        retry.textContent = t('msg.retry') || '再送';
        retry.addEventListener('click', (e) => { e.stopPropagation(); retryOutbox(cmid); });
        wrap.appendChild(retry);
    }
    if (reasonText) {
        const reason = document.createElement('span');
        reason.className = 'msg-act-reason';
        reason.textContent = reasonText;
        wrap.appendChild(reason);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'msg-act-delete';
    del.textContent = t('msg.delete') || '削除';
    del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteFailedMessage(cmid);
    });
    wrap.appendChild(del);
    return wrap;
}

function deleteFailedMessage(cmid) {
    if (!refs.chatMessages) return;
    const row = refs.chatMessages.querySelector(`[data-cmid="${CSS.escape(cmid)}"]`);
    if (row) row.remove();
    dequeueOutbox(cmid);
    clearRetryTimer(cmid);
}

function clearRetryTimer(cmid) {
    const id = _retryTimers.get(cmid);
    if (id) { try { clearTimeout(id); } catch (_) {} _retryTimers.delete(cmid); }
}

function enqueueOutbox(cmid, entry) {
    _outbox.set(cmid, { ...entry, attempts: entry.attempts || 0, createdAt: Date.now(), nextRetryAt: 0 });
}

function dequeueOutbox(cmid) {
    _outbox.delete(cmid);
    clearRetryTimer(cmid);
}

async function retryOutbox(cmid) {
    const entry = _outbox.get(cmid);
    if (!entry) return;
    clearRetryTimer(cmid);
    entry.attempts = (entry.attempts || 0) + 1;
    entry.nextRetryAt = 0;
    // UI: failed→sending に戻す
    const row = refs.chatMessages
        ? refs.chatMessages.querySelector(`[data-cmid="${CSS.escape(cmid)}"]`)
        : null;
    if (row) {
        const bubble = row.querySelector('.msg');
        if (bubble) { bubble.classList.remove('failed', 'pending-retry'); bubble.classList.add('sending'); }
        const oldStatus = row.querySelector('.msg-send-status');
        if (oldStatus) {
            oldStatus.innerHTML = '';
            oldStatus.textContent = t('msg.sending') || '送信中…';
            oldStatus.classList.remove('failed', 'pending-retry');
        }
        const oldActions = row.querySelector('.msg-failed-actions');
        if (oldActions) oldActions.remove();
    }
    try {
        const resp = await sendUnified(entry.payload);
        markOptimisticSent(cmid, (resp.messages || []).find(m => m.client_msg_id === cmid));
        dequeueOutbox(cmid);
        // auth.kind で apply 関数を分岐 (renderAs だけでは cast_view と owner を区別できない).
        const kind = (entry.payload && entry.payload.auth && entry.payload.auth.kind) || '';
        if (kind === 'visitor' || kind === 'cast_view') {
            applyVisitorBatch(resp);
        } else {
            // owner / cast_inbox → 選択中セッション宛て
            const sid = (entry.payload && entry.payload.session_id)
                || (state.selected_session && state.selected_session.id)
                || null;
            applyOwnerBatch(resp, sid);
        }
    } catch (e) {
        // 再試行可能なら指数バックオフで自動再送をスケジュール. 永続エラーなら markOptimisticFailed が dequeue.
        const cls = classifyFailure(e);
        if (cls.retryable && _outbox.has(cmid)) {
            const delay = computeBackoffMs(entry.attempts);
            const stillEntry = _outbox.get(cmid);
            if (stillEntry) {
                stillEntry.nextRetryAt = Date.now() + delay;
                // offline の時はタイマーを貼らず、online イベントに任せる (無駄打ち防止).
                if (cls.kind !== 'offline') {
                    const tid = setTimeout(() => {
                        _retryTimers.delete(cmid);
                        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
                        // 個別 retryOutbox でなく flushOutbox を呼ぶ: 他の先行 cmid の送信を
                        // 追い越さないよう FIFO 順で再評価 (#113: 順序保証).
                        flushOutbox();
                    }, delay);
                    _retryTimers.set(cmid, tid);
                }
            }
        }
        markOptimisticFailed(cmid, e);
        if (e && e.authFailed) handleDeviceAuthFailure();
    }
}

// 同時 flush 防止: serial に await するためのロック.
// オフライン→復帰で N 件を一気に送るとき、並列 fetch() は到着順が保証されないため
// サーバー側で順序が崩れる可能性がある. シリアル+FIFO で受信者にも同順序で届けたい.
let _flushing = false;
async function flushOutbox() {
    if (_flushing) return;
    if (!_outbox.size) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    _flushing = true;
    try {
        const now = Date.now();
        // Map.keys() は挿入順を保持するので、これで送信順 (= ユーザー入力順) になる.
        const cmids = Array.from(_outbox.keys());
        for (const cmid of cmids) {
            const entry = _outbox.get(cmid);
            if (!entry) continue;
            // 厳密 FIFO: 先頭がバックオフ中ならそれ以降も待つ.
            // そうしないと Msg1 失敗→Msg2 送信成功 でサーバー側到着順が逆転する.
            // (手動「再送」ボタンは retryOutbox() 直呼びで個別スキップ可能).
            if (entry.nextRetryAt && entry.nextRetryAt > now) break;
            // シリアル await: HTTP 完了まで次に進まない.
            // retryOutbox 内で再失敗時の schedule もここで setTimeout が貼られるので、
            // 次回の flush も自然に順序付けされる.
            await retryOutbox(cmid);
            // 永続 4xx で dequeue された場合は次の cmid へ (既にループの break 条件で対応済み).
        }
    } finally {
        _flushing = false;
    }
}

// =====================================================
// Day 8: typing indicator
// -----------------------------------------------------
// emitTyping(): 入力中に ~3 秒おきにサーバーへ set-typing を投げる.
// サーバーは typing_until = NOW()+6s にするので、3s 間隔で続ければ相手側に常時 true が届く.
// 送信 or 送信失敗 or blur では何もしない (6s で自然減衰する).
// renderTypingIndicator(): バッチ応答に other_typing が入ってきたら相手側の 3ドット吹き出しを出す.
// =====================================================
const TYPING_EMIT_INTERVAL_MS = 3000;
let _lastTypingEmit = 0;

function buildTypingPayload() {
    if (state.mode === 'owner') {
        if (!state.device_token || !state.selected_session) return null;
        return {
            auth: { kind: 'owner', device_token: state.device_token },
            session_id: state.selected_session.id,
        };
    }
    if (state.mode === 'cast_owner') {
        if (typeof CAST_INBOX_TOKEN === 'undefined' || !CAST_INBOX_TOKEN) return null;
        if (!state.cast_device_token || !state.selected_session) return null;
        return {
            auth: {
                kind: 'cast_inbox',
                inbox_token: CAST_INBOX_TOKEN,
                device_token: state.cast_device_token,
            },
            session_id: state.selected_session.id,
        };
    }
    if (!state.session_token) return null;
    if (IS_CAST_VIEW && typeof CAST_ID !== 'undefined' && CAST_ID) {
        return {
            auth: { kind: 'cast_view', session_token: state.session_token, shop_cast_id: CAST_ID },
        };
    }
    return {
        auth: { kind: 'visitor', session_token: state.session_token },
    };
}

function emitTyping() {
    const now = Date.now();
    if (now - _lastTypingEmit < TYPING_EMIT_INTERVAL_MS) return;
    const payload = buildTypingPayload();
    if (!payload) return;
    _lastTypingEmit = now;
    api('set-typing', payload, 'POST').catch(() => {});
}

// #3: 入力中停止を明示通知. 送信完了 / blur / 画面非表示 / アンロード時に呼ぶ.
// 相手側の 6s 自然減衰を待たず即時にインジケーター非表示になる.
function emitTypingStop(opts) {
    const payload = buildTypingPayload();
    if (!payload) return;
    payload.stop = true;
    _lastTypingEmit = 0; // 次の入力で emitTyping が即発火できるようリセット
    // beforeunload / pagehide では sendBeacon を使う (fetch は abort されうる)
    if (opts && opts.beacon && navigator.sendBeacon) {
        try {
            const blob = new Blob(
                [JSON.stringify({ action: 'set-typing', ...payload })],
                { type: 'application/json' }
            );
            navigator.sendBeacon(API, blob);
            return;
        } catch (_) { /* fallthrough */ }
    }
    api('set-typing', payload, 'POST').catch(() => {});
}

// #3: 相手側インジケーターのローカル watchdog.
// WS push or poll で typing=true を受けたら 6.5s 後に自動で非表示にする.
// ネットワーク断で stop 信号を取りこぼしても bubble が残り続けない保険.
let _typingWatchdog = null;
const TYPING_LOCAL_TIMEOUT_MS = 6500;

function ensureTypingIndicatorEl() {
    let el = document.getElementById('typing-indicator');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'typing-indicator';
    el.className = 'msg-row shop typing-indicator hidden';
    const bubble = document.createElement('div');
    bubble.className = 'msg shop typing-bubble';
    bubble.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    el.appendChild(bubble);
    return el;
}

function renderTypingIndicator(show) {
    if (!refs.chatMessages) return;
    const el = ensureTypingIndicatorEl();
    if (show) {
        // 常に末尾に移動 (新規メッセージが追加されても下に押し出されない)
        refs.chatMessages.appendChild(el);
        el.classList.remove('hidden');
        const near = refs.chatMessages.scrollHeight - refs.chatMessages.scrollTop - refs.chatMessages.clientHeight < 80;
        if (near) refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
        // #3: watchdog — stop 信号を取りこぼしても 6.5s で自動非表示.
        if (_typingWatchdog) clearTimeout(_typingWatchdog);
        _typingWatchdog = setTimeout(() => {
            const e = document.getElementById('typing-indicator');
            if (e) e.classList.add('hidden');
            _typingWatchdog = null;
        }, TYPING_LOCAL_TIMEOUT_MS);
    } else {
        el.classList.add('hidden');
        if (_typingWatchdog) { clearTimeout(_typingWatchdog); _typingWatchdog = null; }
    }
}

// =====================================================
// Day 9: Web Push (VAPID)
// -----------------------------------------------------
// buildPushAuth: モード別 auth オブジェクトを組み立てる（session_id 不要）.
// pushSupported: 現ブラウザで Push が使えるか.
// ensurePushSW: /chat-push-sw.js を登録. 成功で Registration を返す.
// ensurePushConfig: /api/chat-api.php?action=push-config で公開鍵取得.
// subscribeToPush: 許可要求 → SW登録 → pushManager.subscribe → push-subscribe API保存.
// unsubscribeFromPush: 端末の購読解除 + サーバーからも削除.
// pushIsSubscribed: 現在このモードで購読済みかローカル判定用.
// refreshPushButton: ボタン表示/ラベル/disabled 状態を現在のパーミッションに合わせる.
// =====================================================
const LS_PUSH_SUBSCRIBED = 'ychat_push_sub_v1';
let _pushConfigCache = null;

function pushSupported() {
    return (
        typeof window !== 'undefined' &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window
    );
}

function buildPushAuth() {
    const payload = buildTypingPayload();
    if (!payload) return null;
    return payload.auth;
}

function b64urlToUint8(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

function bufToB64url(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function ensurePushSW() {
    if (!pushSupported()) return null;
    try {
        const existing = await navigator.serviceWorker.getRegistration('/chat-push-sw.js');
        if (existing) return existing;
        return await navigator.serviceWorker.register('/chat-push-sw.js', { scope: '/' });
    } catch (e) {
        return null;
    }
}

async function ensurePushConfig() {
    if (_pushConfigCache !== null) return _pushConfigCache;
    try {
        const res = await api('push-config', null, 'GET');
        _pushConfigCache = (res && res.enabled && res.public_key) ? res : { enabled: false };
    } catch (_) {
        _pushConfigCache = { enabled: false };
    }
    return _pushConfigCache;
}

function pushIsSubscribed() {
    try { return !!localStorage.getItem(LS_PUSH_SUBSCRIBED); } catch (_) { return false; }
}

function markPushSubscribed(hash) {
    try { localStorage.setItem(LS_PUSH_SUBSCRIBED, hash || '1'); } catch (_) {}
}

function clearPushSubscribed() {
    try { localStorage.removeItem(LS_PUSH_SUBSCRIBED); } catch (_) {}
}

async function subscribeToPush() {
    if (!pushSupported()) { showError('このブラウザは通知に対応していません'); return false; }

    const auth = buildPushAuth();
    if (!auth) { showError('まずチャットセッションを開始してください'); return false; }

    const cfg = await ensurePushConfig();
    if (!cfg.enabled) { showError('通知機能は現在利用できません'); return false; }

    let perm = Notification.permission;
    if (perm === 'default') {
        try { perm = await Notification.requestPermission(); } catch (_) { perm = 'denied'; }
    }
    if (perm !== 'granted') {
        showError('通知許可がブロックされています');
        return false;
    }

    const reg = await ensurePushSW();
    if (!reg) { showError('Service Worker登録に失敗しました'); return false; }

    let sub;
    try {
        sub = await reg.pushManager.getSubscription();
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: b64urlToUint8(cfg.public_key),
            });
        }
    } catch (e) {
        showError('通知購読に失敗しました: ' + (e && e.message ? e.message : ''));
        return false;
    }

    const json = sub.toJSON();
    const p256dh = json.keys && json.keys.p256dh;
    const authKey = json.keys && json.keys.auth;
    if (!p256dh || !authKey) { showError('購読データが不正です'); return false; }

    try {
        const r = await api('push-subscribe', {
            auth,
            subscription: {
                endpoint: json.endpoint,
                keys: { p256dh, auth: authKey },
            },
        }, 'POST');
        markPushSubscribed(r.endpoint_hash || '1');
        refreshPushButton();
        return true;
    } catch (e) {
        showError('サーバー登録に失敗しました');
        return false;
    }
}

async function unsubscribeFromPush() {
    if (!pushSupported()) return;
    const auth = buildPushAuth();
    try {
        const reg = await navigator.serviceWorker.getRegistration('/chat-push-sw.js');
        if (reg) {
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                const endpoint = sub.endpoint;
                try { await sub.unsubscribe(); } catch (_) {}
                if (auth) {
                    try {
                        await api('push-unsubscribe', { auth, endpoint }, 'POST');
                    } catch (_) {}
                }
            }
        }
    } catch (_) {}
    clearPushSubscribed();
    refreshPushButton();
}

function ensurePushButton() {
    let btn = document.getElementById('chat-push-btn');
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = 'chat-push-btn';
    btn.type = 'button';
    btn.className = 'chat-push-btn hidden';
    btn.setAttribute('aria-label', '通知を許可');
    btn.textContent = '🔔 通知を許可';
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        if (pushIsSubscribed()) {
            await unsubscribeFromPush();
        } else {
            await subscribeToPush();
        }
        btn.disabled = false;
    });
    return btn;
}

function placePushButton() {
    const btn = ensurePushButton();
    if (btn.parentNode) return btn;
    const host = document.querySelector('#chat-header .chat-header-right') || document.getElementById('chat-header');
    if (!host) return btn;
    host.insertBefore(btn, host.firstChild);
    return btn;
}

function refreshPushButton() {
    const btn = ensurePushButton();
    placePushButton();

    if (!pushSupported()) { btn.classList.add('hidden'); return; }

    // モード判定: owner / cast_owner / cast_view / visitor で有効。
    // visitor モードでも push は登録できるがセッション期限切れでは無効になるため条件緩め.
    const auth = buildPushAuth();
    if (!auth) { btn.classList.add('hidden'); return; }

    // 未設定サーバーでは隠す
    if (_pushConfigCache && _pushConfigCache.enabled === false) {
        btn.classList.add('hidden');
        return;
    }

    btn.classList.remove('hidden');

    const perm = Notification.permission;
    if (perm === 'denied') {
        btn.textContent = '🔕 通知ブロック中';
        btn.disabled = true;
        return;
    }
    btn.disabled = false;
    if (pushIsSubscribed()) {
        btn.textContent = '🔔 通知ON (解除)';
        btn.classList.add('is-on');
    } else {
        btn.textContent = '🔔 通知を許可';
        btn.classList.remove('is-on');
    }
}

// SW からのメッセージ処理 (通知クリック時に URL を共有する等)
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (ev) => {
        try {
            if (!ev.data) return;
            if (ev.data.type === 'ychat:push-lost') {
                clearPushSubscribed();
                refreshPushButton();
            }
        } catch (_) {}
    });
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
// 契約 (Day 3: subscribe-only 化):
//   - Transport.subscribeVisitor / subscribeOwner は {stop} ハンドルを返す
//   - Transport.startVisitorSession / canConnect / closeSession は従来どおり
//   - 送信 (sendVisitor/sendOwner) は Transport から抜き、sendUnified() で統一 (/api/chat-send.php).
//     理由: PHP が authoritative に writeし、その後 DO /broadcast にリレーする単方向フローへ集約するため.
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
                const params = {
                    session_token: token,
                    since_id: getSinceId()
                };
                if (IS_CAST_VIEW) params.as_cast = 1;
                const data = await api('poll-messages', params, 'GET');
                if (active) onBatch(data);
            } catch (_) { /* retry next tick */ }
        };
        // 即時 catchup (visibility復帰時の待ち時間を消す)
        tick();
        const timer = setInterval(tick, intervalMs || POLL_INTERVAL);
        return {
            stop: () => { active = false; clearInterval(timer); },
            // 2026-04-23 ゼロ設計: PHP 暗黙既読を全廃したので PollingTransport も明示 mark-read が必須.
            // view signal は polling では heartbeat 代替がないため no-op (mark-read で毎回明示通知).
            setView: () => {},
            markRead: (upToId) => {
                const tok = getSessionToken && getSessionToken();
                if (!tok) return;
                api('mark-read', { session_token: tok, up_to_id: upToId || 0, reader: 'visitor' }).catch(() => {});
            },
        };
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
        // 即時 catchup
        tick();
        const timer = setInterval(tick, intervalMs || INBOX_INTERVAL);
        return {
            stop: () => { active = false; clearInterval(timer); },
            // 2026-04-23 ゼロ設計: PHP 暗黙既読を全廃したので PollingTransport も明示 mark-read が必須.
            setView: () => {},
            markRead: (sessionId, upToId, sessionToken) => {
                const dt = getDeviceToken && getDeviceToken();
                if (!dt) return;
                const body = {
                    device_token: dt,
                    up_to_id: upToId || 0,
                    reader: 'shop',
                };
                if (sessionToken) body.session_token = sessionToken;
                if (sessionId) body.session_id = sessionId;
                if (!body.session_token && !body.session_id) return;
                api('mark-read', body).catch(() => {});
            },
        };
    },

    // 訪問者: セッション作成
    async startVisitorSession({ shopSlug, source, sessionToken, cast }) {
        const payload = { shop_slug: shopSlug, source };
        if (sessionToken) payload.session_token = sessionToken;
        if (cast) payload.cast = cast;
        return api('start-session', payload);
    },

    // 送信は sendUnified() に移行. Transport には subscribe のみ残す (Day 3).

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
        // #2: 訪問者がフォアグラウンドで開いている session_token.
        // WS open / 再接続のたびに再送し DO 側 presence を復元する.
        let currentViewToken = null;

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
                    if (data.type === 'typing') {
                        // #3: 相手 (shop 側) の typing 状態を即時反映.
                        // role は typist のロール. 訪問者 UI では自セッションの shop typing のみ反映.
                        if (data.role === 'shop' && data.session_token === getSessionToken()) {
                            onBatch({ messages: [], other_typing: !!data.typing });
                        }
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
                // #2: 再接続時に訪問者 presence を DO に復元.
                if (currentViewToken) {
                    try { ws.send(JSON.stringify({ type: 'view', session_token: currentViewToken })); } catch (_) {}
                }
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
            // #2: 訪問者がチャット画面をフォアグラウンド表示 / 非表示にしたタイミングで呼ぶ.
            // session_token=null でクリア.
            setView: (token) => {
                currentViewToken = token || null;
                if (!ws || ws.readyState !== 1) return;
                try {
                    ws.send(JSON.stringify({ type: 'view', session_token: currentViewToken }));
                } catch (_) {}
            },
            // 2026-04-23 ゼロ設計: isWindowActive() 時のみ chat.js から呼ぶ明示既読.
            markRead: (upToId) => {
                if (!ws || ws.readyState !== 1) return;
                try {
                    ws.send(JSON.stringify({ type: 'mark-read', up_to_id: upToId || 0 }));
                } catch (_) {}
            },
        };
    },

    subscribeOwner({ getDeviceToken, getSelectedSessionId, getSinceId, onBatch, intervalMs: _iv }) {
        let active = true;
        let ws = null;
        let reconnectTimer = null;
        let heartbeat = null;
        // B-1: オーナーが現在開いているスレッドの session_token.
        // WS open / 再接続のたびに再送し DO 側 presence を復元する.
        let currentViewToken = null;

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
                    if (data.type === 'typing') {
                        // #3: 相手 (visitor 側) の typing を即時反映.
                        // 選択中スレッドでのみ表示 (inbox 一覧には出さない).
                        if (data.role === 'visitor' && matchSelected) {
                            onBatch({ messages: [], other_typing: !!data.typing }, selectedSid);
                        }
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
                // B-1: 再接続時に現在のスレッド presence を DO に復元.
                if (currentViewToken) {
                    try { ws.send(JSON.stringify({ type: 'view', session_token: currentViewToken })); } catch (_) {}
                }
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
            // B-1: オーナーがスレッドを開いた / 閉じたタイミングで呼ぶ.
            // session_token=null でクリア.
            setView: (token) => {
                currentViewToken = token || null;
                if (!ws || ws.readyState !== 1) return;
                try {
                    ws.send(JSON.stringify({ type: 'view', session_token: currentViewToken }));
                } catch (_) {}
            },
            // 2026-04-23 ゼロ設計: isWindowActive() 時のみ chat.js から呼ぶ明示既読.
            // session_token を第一識別子にする (MySQL session_id は DO 内 id と不一致のため).
            markRead: (sessionId, upToId, sessionToken) => {
                if (!ws || ws.readyState !== 1) return;
                const payload = { type: 'mark-read', up_to_id: upToId || 0 };
                if (sessionToken) payload.session_token = sessionToken;
                if (sessionId) payload.session_id = sessionId;
                if (!payload.session_token && !payload.session_id) return;
                try {
                    ws.send(JSON.stringify(payload));
                } catch (_) {}
            },
        };
    },

    async startVisitorSession({ shopSlug: _s, source, sessionToken, cast }) {
        const payload = { source: source || 'standalone' };
        if (sessionToken) payload.session_token = sessionToken;
        if (cast) payload.cast = cast;
        return doFetch('/session/start', payload);
    },

    // 送信は sendUnified() に移行. Transport には subscribe のみ残す (Day 3).

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
// - cast-view (?cast=&view=): DOは配信専用で read_at 管理しないため PHP polling に固定
//   → as_cast=1 で handlePollMessages が visitor メッセージを既読化する
const DO_DENYLIST_SLUGS = [];
const Transport = (IS_CAST_VIEW || DO_DENYLIST_SLUGS.includes(SLUG)) ? PollingTransport : DurableObjectTransport;

// ===== i18n =====
// 辞書は /chat-i18n.json から fetch。chat-widget-inline.html とは同一ソースを共有（scripts/build-chat-widget.js が注入）
const LS_LANG = 'chat_lang_' + SLUG;
let I18N = { ja: { 'load': '読み込み中…' } }; // fetch完了まで最小限
async function loadI18N() {
    try {
        const res = await fetch('/chat-i18n.json?v=58', { cache: 'force-cache' });
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
        // 右下 YobuChat ブランドリンク: モバイルは _self (戻るで戻れる), PC は _blank (新タブ).
        // (memory: feedback_external_link_target — ハードコード _blank 禁止)
        if (refs.footerBrand) {
            const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
            refs.footerBrand.target = isTouch ? '_self' : '_blank';
        }

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
        // ?resume=<session_token>: メール通知リンクからの復帰. 既存トークンを LS_SESSION に投入して
        // enterVisitorMode の adopt パスに乗せる. 別端末/他ブラウザでも履歴を引き継げる.
        // URL からは即座に削除（ブックマーク/履歴汚染防止, 誤共有抑止）.
        if (RESUME_TOKEN) {
            try {
                localStorage.setItem(LS_SESSION, JSON.stringify({
                    token: RESUME_TOKEN,
                    session_id: 0,
                    last_message_id: 0,
                    cast_name: null,
                }));
            } catch (_) {}
            try {
                const p = new URLSearchParams(location.search);
                p.delete('resume');
                const newQs = p.toString();
                history.replaceState(null, '', location.pathname + (newQs ? '?' + newQs : ''));
            } catch (_) {}
        }
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
        try { await ensurePushConfig(); refreshPushButton(); } catch (_) {}
    }
}

// ===== 訪問者モード =====
// 訪問者ヘッダー（shop-name 左寄せ + ♥認証バッジ）の ON/OFF を切り替えるヘルパー.
// 2026-04-29: 訪問者画面でのみ店舗名/キャスト名の左にYobuHo認証バッジを表示する仕様.
function enableVisitorHeader() {
    const badge = document.getElementById('chat-verified-badge');
    const shopName = document.getElementById('chat-shop-name');
    const left = document.querySelector('.chat-header-left');
    if (badge) badge.classList.remove('hidden');
    if (shopName && left && shopName.parentElement !== left) {
        left.appendChild(shopName);
    }
    document.body.classList.add('visitor-header');
}
function disableVisitorHeader() {
    const badge = document.getElementById('chat-verified-badge');
    const shopName = document.getElementById('chat-shop-name');
    const center = document.querySelector('.chat-header-center');
    if (badge) badge.classList.add('hidden');
    if (shopName && center && shopName.parentElement !== center) {
        center.appendChild(shopName);
    }
    document.body.classList.remove('visitor-header');
}

async function enterVisitorMode() {
    refs.shopName.textContent = state.shop_name;
    updateStatusIndicator(state.is_online);
    enableVisitorHeader();
    refs.ownerToggle.classList.add('hidden');
    // ユーザー側は言語切替を表示
    if (refs.langSelect) refs.langSelect.classList.remove('hidden');
    refs.ownerInbox.classList.add('hidden');
    refs.chatThread.classList.remove('hidden');
    refs.inputArea.classList.remove('hidden');
    if (refs.quickQuestions) refs.quickQuestions.classList.remove('hidden');
    // キャスト指名URL (?cast=) の訪問者画面ではお店共通の予約ヒントは出さない.
    // 店舗 Instagram/LINE への誘導ではなく「このキャスト個人に相談する」文脈のため.
    if (refs.reservationHint) {
        if (CAST_ID) refs.reservationHint.classList.add('hidden');
        else refs.reservationHint.classList.remove('hidden');
    }
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
    // キャスト指名URL の訪問者画面では「受付時間 HH:MM-HH:MM」ラベルは出さない.
    // 店舗全体の営業時間表示は、キャスト個人に相談する文脈では冗長.
    if (refs.statusLabel) {
        if (CAST_ID) refs.statusLabel.classList.add('hidden');
        else refs.statusLabel.classList.remove('hidden');
    }
    if (refs.nicknameArea) {
        refs.nicknameArea.classList.remove('hidden');
        if (refs.nicknameInput) {
            try { refs.nicknameInput.value = localStorage.getItem(LS_NICKNAME) || ''; } catch (_) {}
        }
    }

    // 下書き復元 (回線断・リロードで消えていた入力を戻す)
    restoreDraft();

    // メール通知 opt-in UI (キャスト指名セッション ?cast= でも訪問者側では有効)
    // visitor-notify ラッパー（メール入力パネル）はトグル ON 時のみ表示. ここでは unhide しない.

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
            // 2026-04-28: WS 履歴 replay より前にアバター URL を state に反映する.
            // DO `/session/start` / PHP `start-session` どちらも shop_avatar_url / cast_avatar_url を返すので
            // adopt 直後に state へ書き込むことで, 後続の addMessage(履歴1件目) が正しいアバターで描画される.
            if (adopt && typeof adopt.shop_avatar_url !== 'undefined') {
                state.shop_avatar_url = adopt.shop_avatar_url || null;
            }
            if (adopt && typeof adopt.cast_avatar_url !== 'undefined') {
                state.cast_avatar_url = adopt.cast_avatar_url || null;
            }
            // 2026-04-29: ?cast= 訪問者URLでは緑丸をキャストの notify トグルに同期.
            // cast_notify_mode が 'off' 以外なら点灯, 'off' なら消灯. 受付時間は無視.
            if (CAST_ID && adopt && typeof adopt.cast_notify_mode !== 'undefined') {
                const castOn = adopt.cast_notify_mode && adopt.cast_notify_mode !== 'off';
                state.notify_enabled = !!castOn;
                state.is_online = !!castOn;
            }
            // adopt レスポンスは verified/pending を含まないため必ず PHP (my-notify-settings) で完全取得.
            // Magic Link 確認状態は UI バッジ表示に必須で、adopt 側のフィールドだけでは不十分.
            loadVisitorNotifyState();
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
        if (typeof s.shop_avatar_url !== 'undefined') state.shop_avatar_url = s.shop_avatar_url || null;
        if (typeof s.cast_avatar_url !== 'undefined') state.cast_avatar_url = s.cast_avatar_url || null;
        // 2026-04-29: ?cast= 訪問者URL は緑丸をキャストの notify_mode に同期 (受付時間無視)
        if (CAST_ID && typeof s.cast_notify_mode !== 'undefined') {
            const castOn = s.cast_notify_mode && s.cast_notify_mode !== 'off';
            state.notify_enabled = !!castOn;
            state.is_online = !!castOn;
        }
        saveVisitorSession();
        updateCastHeader();
        addSystemMessage(state.welcome_message || t('visitor.note'));
        // 新規セッションは通知設定も空なので UI を初期化のみ
        hydrateVisitorNotify({ email: '', enabled: false });
    }

    startVisitorPolling();
}

// ===== キャスト閲覧専用モード =====
// メール通知URL ?cast=&view=<session_token> で開いた時の read-only 表示.
// 既存訪問者セッションの履歴を見るだけで送信はできない（返信は電話/LINE経由）.
async function enterCastViewMode() {
    refs.shopName.textContent = state.shop_name;
    disableVisitorHeader();
    // キャスト本人向け通知トグル (shop_casts.chat_notify_mode). 初期値は adopt 応答でセット.
    refs.ownerToggle.classList.remove('hidden');
    if (refs.langSelect) refs.langSelect.classList.remove('hidden');
    refs.ownerInbox.classList.add('hidden');
    refs.chatThread.classList.remove('hidden');
    // 入力欄をキャスト返信用に明示的に表示 (他モードから遷移したケースや
    // applyVisitorBatch で closed 扱いで hidden されたケースのリカバリ).
    refs.inputArea.classList.remove('hidden');
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
            if (typeof adopt.shop_avatar_url !== 'undefined') state.shop_avatar_url = adopt.shop_avatar_url || null;
            if (typeof adopt.cast_avatar_url !== 'undefined') state.cast_avatar_url = adopt.cast_avatar_url || null;
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

    // 下書き復元 (キャスト返信画面も同じドラフト方針)
    restoreDraft();

    // 履歴取得 + 新着ポーリング（受付時間外でもメッセージは表示される）
    if (Transport.kind !== 'durable-object') {
        await pollMessages(true);
    }
    startVisitorPolling();
}

// キャスト指名セッションの場合、ヘッダーに「キャスト名」のみを表示.
// cast_owner / cast_inbox モードと同じ format で一貫させる（店名は冗長なので表示しない）.
function updateCastHeader() {
    if (!state.cast_name) return;
    try {
        if (refs.shopName) {
            refs.shopName.textContent = state.cast_name;
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

// ===== 訪問者メール通知 opt-in =====
// chat_sessions.visitor_email / visitor_notify_enabled を読み書きする UI 制御.
// DO は通知設定を持たず PHP が権威なので、GET は /api/chat-api.php?action=my-notify-settings を叩く.
//
// Magic Link 確認:
//   入力直後は verified=0 (pending). 確認メールのリンクをクリックすると verified=1.
//   verified=0 の間は chat-notify-visitor.php が送信をスキップする (いたずら防止).
function hydrateVisitorNotify({ email, enabled, verified, pending }) {
    if (!refs.visitorNotifyToggle) return;
    refs.visitorNotifyToggle.checked = !!enabled;
    if (refs.visitorNotifyEmail) refs.visitorNotifyEmail.value = email || '';
    if (refs.visitorNotify) refs.visitorNotify.classList.toggle('hidden', !enabled);
    // 既存の verified email を state に保持. OFF→ON 切替時のフォーム再表示を回避.
    state.visitor_notify_email = email || '';
    state.visitor_notify_verified = !!(verified && email);

    // 状態に応じて persistent ステータス表示
    if (enabled && email && !verified && pending) {
        showNotifyStatus(t('notify.verification_pending') || '📧 確認メール送信済み — メール内のリンクをクリックしてください', 'pending');
    } else if (enabled && verified) {
        showNotifyStatus(t('notify.verified') || '✓ 確認済み — 通知が有効です', 'ok');
    } else if (refs.visitorNotifyStatus) {
        if (refs.visitorNotifyStatusMsg) refs.visitorNotifyStatusMsg.textContent = '';
        refs.visitorNotifyStatus.className = 'visitor-notify-status hidden';
    }

    // 「確認メールを再送」ボタン: pending 状態 (メール登録済み & 未確認) のときだけ表示
    if (refs.visitorNotifyResend) {
        const showResend = enabled && email && !verified && pending;
        refs.visitorNotifyResend.classList.toggle('hidden', !showResend);
    }

    // 匿名感の維持: verified 済みはメール入力欄を畳んで「変更」リンクだけ残す.
    // これによりチャット画面に自分のメールアドレスが常時表示されなくなる.
    // enabled は条件から外す — OFF→ON 再切替時もフォームを出さず再登録不要にするため.
    if (refs.visitorNotify && refs.visitorNotifyEdit) {
        const collapse = !!(verified && email);
        refs.visitorNotify.classList.toggle('verified-collapsed', collapse);
        refs.visitorNotifyEdit.classList.toggle('hidden', !collapse);
        // 畳まれた状態になるときは 「確認画面を閉じる」リンクも隠す.
        if (collapse && refs.visitorNotifyCloseLink) {
            refs.visitorNotifyCloseLink.classList.add('hidden');
        }
    }
}

async function resendVisitorEmailVerify() {
    if (!state.session_token) return;
    if (!refs.visitorNotifyResend) return;
    try {
        refs.visitorNotifyResend.disabled = true;
        await api('resend-visitor-email-verify', { session_token: state.session_token });
        showNotifyStatus(t('notify.verification_sent') || '📧 確認メールを送信しました — メール内のリンクをクリックしてください', 'pending');
    } catch (e) {
        showNotifyStatus(e.message || '再送に失敗しました', 'err');
    } finally {
        refs.visitorNotifyResend.disabled = false;
    }
}

async function loadVisitorNotifyState() {
    if (!state.session_token) return;
    try {
        const data = await api('my-notify-settings', { session_token: state.session_token });
        hydrateVisitorNotify({
            email: data.email || '',
            enabled: !!data.enabled,
            verified: !!data.verified,
            pending: !!data.pending,
        });
    } catch (_) {
        // 取得失敗は致命的ではない（UI は既定のOFF状態のまま）
    }
}

function showNotifyStatus(msg, kind) {
    if (!refs.visitorNotifyStatus) return;
    if (refs.visitorNotifyStatusMsg) refs.visitorNotifyStatusMsg.textContent = msg || '';
    refs.visitorNotifyStatus.className = 'visitor-notify-status ' + (kind || '');
    refs.visitorNotifyStatus.classList.toggle('hidden', !msg);
}

async function saveVisitorNotify() {
    if (!state.session_token) {
        showNotifyStatus('セッションが確立していません', 'err');
        return;
    }
    const enabled = !!(refs.visitorNotifyToggle && refs.visitorNotifyToggle.checked);
    const email = (refs.visitorNotifyEmail && refs.visitorNotifyEmail.value || '').trim();
    if (enabled) {
        if (!email) { showNotifyStatus(t('notify.email_required') || 'メールアドレスを入力してください', 'err'); return; }
        // ざっくりフォーマット検証（PHP 側でも validate）
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showNotifyStatus(t('notify.email_invalid') || 'メールアドレスの形式が正しくありません', 'err');
            return;
        }
    }
    try {
        if (refs.visitorNotifySave) refs.visitorNotifySave.disabled = true;
        const res = await api('visitor-notify-settings', {
            session_token: state.session_token,
            email,
            enabled: enabled ? 1 : 0,
        });
        if (!enabled) {
            showNotifyStatus(t('notify.saved_off') || '通知を停止しました', 'ok');
        } else if (res && res.verification_sent) {
            showNotifyStatus(t('notify.verification_sent') || '📧 確認メールを送信しました — メール内のリンクをクリックしてください', 'pending');
        } else if (res && res.verified) {
            showNotifyStatus(t('notify.saved_on') || '✓ 通知を有効にしました', 'ok');
        } else {
            showNotifyStatus(t('notify.saved_on') || '✓ 通知を有効にしました', 'ok');
        }
    } catch (e) {
        showNotifyStatus(e.message || '保存に失敗しました', 'err');
    } finally {
        if (refs.visitorNotifySave) refs.visitorNotifySave.disabled = false;
    }
}

// JST 換算で reception_start/end (HH:MM) の受付時間内かを判定. PHP isWithinReceptionHours と同等.
function isWithinReceptionHoursClient(rs, re, nowDate) {
    if (!rs || !re || rs === re) return true; // 24h
    const tokyo = new Date((nowDate || new Date()).getTime() + 9 * 60 * 60 * 1000);
    const hm = tokyo.getUTCHours() * 60 + tokyo.getUTCMinutes();
    const toMin = (t) => {
        const p = String(t).split(':');
        return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10);
    };
    const s = toMin(rs);
    const e = toMin(re);
    if (s < e) return hm >= s && hm < e;
    return hm >= s || hm < e; // 日跨ぎ
}

// 次の受付境界 (start or end) までの ms. これを過ぎたら状態が逆転する.
function msUntilNextReceptionBoundary(rs, re, nowDate) {
    if (!rs || !re || rs === re) return 0;
    const now = nowDate || new Date();
    const tokyo = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const curMin = tokyo.getUTCHours() * 60 + tokyo.getUTCMinutes();
    const curSec = tokyo.getUTCSeconds();
    const curMs = tokyo.getUTCMilliseconds();
    const toMin = (t) => {
        const p = String(t).split(':');
        return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10);
    };
    const s = toMin(rs);
    const e = toMin(re);
    // 今 curMin から見て、次に来る s or e (どちらか早い方) までの分数
    const candidates = [s, e].map(target => {
        let diff = target - curMin;
        if (diff <= 0) diff += 24 * 60; // 翌日に持ち越し
        return diff;
    });
    const nextMin = Math.min(...candidates);
    // 分の境界で発火させたいので、現在の秒/ミリ秒を引く
    const ms = nextMin * 60 * 1000 - (curSec * 1000 + curMs);
    return Math.max(ms, 1000); // 最低1秒は空ける (再帰暴走防止)
}

// 受付境界 (5:00 ぴったり等) で緑丸を即時更新するためのタイマー.
// 境界に到達したら (a) ローカルで受付時間内/外を再判定し、外なら即offline表示、
// (b) PHP/DO に can-connect 再問合わせ (公式判定でラベルや next_reception_start も更新).
let _receptionBoundaryTimer = null;
function scheduleReceptionBoundaryRefresh() {
    if (_receptionBoundaryTimer) {
        clearTimeout(_receptionBoundaryTimer);
        _receptionBoundaryTimer = null;
    }
    if (IS_CAST_VIEW || CAST_ID) return; // ?cast= URL はキャスト notify_mode 基準で受付時間と独立
    const rs = state.reception_start;
    const re = state.reception_end;
    if (!rs || !re || rs === re) return; // 24h は境界なし
    const ms = msUntilNextReceptionBoundary(rs, re);
    _receptionBoundaryTimer = setTimeout(() => {
        _receptionBoundaryTimer = null;
        // (a) 即時ローカル反映: 受付時間外になった瞬間、現在 online 表示中なら offline に.
        const inHours = isWithinReceptionHoursClient(state.reception_start, state.reception_end);
        if (!inHours && state.is_online) {
            updateStatusIndicator(false);
        }
        // (b) PHP の公式判定で同期 (緑→消, 灰→緑 両方向). 失敗しても (a) の即時反映で実害なし.
        try {
            const params = state.session_token ? { session_token: state.session_token } : { shop_slug: SLUG };
            api('can-connect', params, 'GET').then(d => {
                if (!d) return;
                if (typeof d.shop_online !== 'undefined') updateStatusIndicator(!!d.shop_online);
                if (typeof d.reception_start !== 'undefined') state.reception_start = d.reception_start || null;
                if (typeof d.reception_end !== 'undefined') state.reception_end = d.reception_end || null;
                if (typeof d.next_reception_start !== 'undefined') state.next_reception_start = d.next_reception_start || null;
            }).catch(() => {});
        } catch (_) {}
        // 次の境界をスケジュール (24時間後の同じ HH:MM 等)
        scheduleReceptionBoundaryRefresh();
    }, ms);
}

// タブ非アクティブ時は setTimeout が throttle されるため、復帰時に即時再判定.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (IS_CAST_VIEW) return;
    const rs = state.reception_start;
    const re = state.reception_end;
    if (!rs || !re || rs === re) return;
    // 表示中で、かつ受付時間外なら緑を即消す (throttle 中に境界を跨いだケース).
    const inHours = isWithinReceptionHoursClient(rs, re);
    if (!inHours && state.is_online) updateStatusIndicator(false);
    // 念のためタイマーも貼り直す (throttle 後に発火しない可能性に備える).
    scheduleReceptionBoundaryRefresh();
});

function updateStatusIndicator(online) {
    state.is_online = online;
    // 2026-04-29: ?cast= URL (訪問者/閲覧両方) は緑丸をキャストの notify トグルに同期.
    // キャスト個人は受付時間という概念を持たず、トグル ON/OFF のみで表現する.
    // IS_CAST_VIEW (?cast=&view=) と CAST_ID (?cast=) のどちらも同じロジックを適用.
    if (IS_CAST_VIEW || CAST_ID) {
        const castOn = !!state.notify_enabled;
        refs.statusDot.classList.toggle('online', castOn);
        refs.statusDot.classList.toggle('offline', !castOn);
        return;
    }
    refs.statusDot.classList.toggle('online', online);
    refs.statusDot.classList.toggle('offline', !online);
    const rs = state.reception_start;
    const re = state.reception_end;
    // 24時間受付: 両方未設定 OR 開始=終了（shop-admin の「24時間受付」チェック時は両方 null）
    const is24H = (!rs || !re) || (rs === re);
    // 受付時間が設定されていれば常に「受付時間 HH:MM-HH:MM」表示。24H なら営業時間の代わりに「24H」。
    // トグルONで緑丸、OFFで丸非表示（chat.cssの.status-dot.offline{display:none}）
    if (is24H) {
        refs.statusLabel.innerHTML = `<span class="status-label-line">${t('reception.hours')}</span><span class="status-label-line">24H</span>`;
    } else {
        const hours = `${formatHM(rs)}-${formatHM(re)}`;
        refs.statusLabel.innerHTML = `<span class="status-label-line">${t('reception.hours')}</span><span class="status-label-line">${hours}</span>`;
    }
    // 次の受付境界 (5:00 等) でローカル再判定するタイマーを再セット.
    scheduleReceptionBoundaryRefresh();
}

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'msg msg-system';
    div.textContent = text;
    refs.chatMessages.appendChild(div);
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
}

// セッション終了UIの適用（idempotent）.
// applyVisitorBatch で status='closed' を受信した時、または送信が 410 で
// 弾かれた時（次の poll を待たずに即時反映したい）の両方から呼ぶ.
function applyClosedState() {
    if (state._closedMsgShown) return;
    state._closedMsgShown = true;
    stopPolling();
    addSystemMessage(t('thread.closedThanks'));
    if (refs.inputArea) refs.inputArea.classList.add('hidden');
    if (state.mode === 'visitor' && !IS_CAST_VIEW) addRestartButton();
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
    clearDraft();
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
        if (typeof s.shop_avatar_url !== 'undefined') state.shop_avatar_url = s.shop_avatar_url || null;
        if (typeof s.cast_avatar_url !== 'undefined') state.cast_avatar_url = s.cast_avatar_url || null;
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

// LINE 互換: メッセージ行を sent_at で昇順に並び替え (古い→新しい=上→下).
// 楽観的UI(optimistic)と履歴 polling の appendChild 順が混在するケース向け.
// 日付セパレーターも再構築して散らからないようにする.
function sortMessagesByTime() {
    if (!refs.chatMessages) return;
    const rows = Array.from(refs.chatMessages.querySelectorAll('.msg-row'));
    if (rows.length < 2) return;
    rows.sort((a, b) => {
        const ta = a.dataset.sentAt || '';
        const tb = b.dataset.sentAt || '';
        if (ta === tb) {
            // 同秒: id > cmid (confirmed) > pending の順で安定化
            const ia = Number(a.dataset.msgId || 0);
            const ib = Number(b.dataset.msgId || 0);
            return ia - ib;
        }
        return ta < tb ? -1 : 1;
    });
    refs.chatMessages.querySelectorAll('.msg-date-sep').forEach(s => s.remove());
    let lastDate = '';
    for (const row of rows) {
        const key = getDateKey(row.dataset.sentAt || '');
        if (key && key !== lastDate) {
            const sep = document.createElement('div');
            sep.className = 'msg-date-sep';
            sep.dataset.dateKey = key;
            sep.innerHTML = '<span>' + esc(formatDateLabel(key)) + '</span>';
            refs.chatMessages.appendChild(sep);
            lastDate = key;
        }
        refs.chatMessages.appendChild(row);
    }
    state.last_msg_date = lastDate;
}
function addMessage(m, _fromOwnerLegacy) {
    // dedup: 同 client_msg_id が既に描画済みならスキップ.
    // DO と MySQL の message.id 空間は独立しており (DO は自前カウンタ, MySQL は auto_increment)
    // id ベース dedup では DO 新規セッションの msg が MySQL の max id より小さくなって消える.
    if (m.client_msg_id) {
        if (refs.chatMessages.querySelector(`[data-cmid="${CSS.escape(m.client_msg_id)}"]`)) return;
    } else if (m.id) {
        if (refs.chatMessages.querySelector(`[data-msg-id="${m.id}"]`)) return;
    }

    // 位置クラスは positionClassFor() に集約. viewer役割 (visitor/owner/cast_view/cast_owner)
    // は viewerIsShopSide() が globals から判定するので、呼び出し元から viewer 情報を渡す必要なし.
    // 旧 fromOwner 引数は後方互換のため受けるが無視.
    const renderAs = positionClassFor(m.sender_type);

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
    if (m.sent_at) row.dataset.sentAt = m.sent_at;

    const bubble = document.createElement('div');
    bubble.className = 'msg ' + renderAs;
    bubble.textContent = m.message;

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const t = document.createElement('div');
    t.className = 'msg-time';
    t.textContent = formatTime(m.sent_at);
    meta.appendChild(t);

    // アバター (2026-04-23): 相手側 (POS_OTHER) かつ sender_type='shop' の時のみ表示.
    // 訪問者のメッセージ (sender_type='visitor') には表示しない.
    // キャスト指名セッション: cast_avatar_url を優先, 通常セッション: shop_avatar_url.
    let avatar = null;
    if (renderAs === POS_OTHER && m.sender_type === 'shop') {
        const hasCast = !!(state.selected_session && state.selected_session.cast_id)
                       || !!state.cast_avatar_url
                       || IS_CAST_VIEW
                       || state.mode === 'cast_owner';
        const url = hasCast ? (state.cast_avatar_url || state.shop_avatar_url)
                            : state.shop_avatar_url;
        if (url) {
            avatar = document.createElement('div');
            avatar.className = 'msg-avatar';
            avatar.style.backgroundImage = "url('" + String(url).replace(/'/g, "\\'") + "')";
        }
    }

    // 自分側=時刻を吹き出しの左, 相手側=アバター+吹き出し+時刻
    if (renderAs === POS_SELF) { row.appendChild(meta); row.appendChild(bubble); }
    else {
        if (avatar) row.appendChild(avatar);
        row.appendChild(bubble);
        row.appendChild(meta);
    }
    refs.chatMessages.appendChild(row);
    // LINE流: 自分送信は常に末尾へ. 相手メッセージは末尾近くに居る時のみ追従、遡り読み中はボタン表示.
    autoScrollOnIncoming(renderAs === POS_SELF);

    // 2026-04-23 翻訳アンカー仕様:
    //   - visitor_input_lang = 'ja' → 翻訳OFF (お互い日本語、翻訳不要)
    //   - visitor_input_lang != 'ja' →
    //       shop viewer (左=相手が visitor の発言) : target='ja' (お店側は日本語で読む)
    //       visitor viewer (左=相手が shop の返信) : target=visitor_input_lang (訪問者は自分の入力言語で読む)
    //   - 自分の発言 (POS_SELF) は翻訳しない (原文を残す)
    const isOthers = (renderAs === POS_OTHER);
    const src = ((m.source_lang || '').toLowerCase()) || detectLang(m.message);
    const anchor = (state.visitor_input_lang || 'ja').toLowerCase();
    if (isOthers && src && anchor !== 'ja') {
        const target = viewerIsShopSide() ? 'ja' : anchor;
        if (target !== src && I18N[src] && I18N[target]) {
            maybeTranslate(bubble, m.message, src, target);
        }
    }
}
function updateReadMarkers() {
    // LINE 式: 既読マーカーは自分側の「id <= threshold」の全行に付ける.
    // (LINE 実挙動で全ての自分msgに 既読 が並ぶのが確認された仕様.)
    //
    // 自分側のクラスは viewer 役割に関わらず常に POS_SELF.
    // renderAs は「位置クラス」統一 (POS_SELF='visitor'=右/自分, POS_OTHER='shop'=左/相手).
    const ownClass = POS_SELF;
    const threshold = state.last_read_own_id || 0;
    const rows = refs.chatMessages.querySelectorAll('.msg-row.' + ownClass);
    rows.forEach(row => {
        const id = Number(row.dataset.msgId || 0);
        const existing = row.querySelector('.msg-meta .msg-read');
        const shouldMark = (threshold > 0 && id > 0 && id <= threshold);
        if (shouldMark && !existing) {
            const meta = row.querySelector('.msg-meta');
            if (meta) {
                const mark = document.createElement('div');
                mark.className = 'msg-read';
                mark.textContent = t('msg.read') || '既読';
                meta.appendChild(mark);
            }
        } else if (!shouldMark && existing) {
            existing.remove();
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
    // 初期ロード時の「最新メッセージが隠れる」対策:
    // async で翻訳が戻る時にメッセージ高さが伸びる → 事前に末尾近くに居たなら終わったあと再スクロール.
    const wasNearBottom = isNearBottom();
    const key = from + '|' + to + '|' + text;
    const trDiv = document.createElement('div');
    trDiv.className = 'msg-translation';
    trDiv.textContent = '翻訳中…';
    msgDiv.appendChild(trDiv);
    if (wasNearBottom) scrollChatToBottom(false);
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
        if (wasNearBottom) scrollChatToBottom(true);
    } catch (e) {
        trDiv.remove();
    }
}

// 訪問者メッセージバッチを画面に反映（Transport.subscribeVisitor の onBatch、および初期ロードから呼ばれる）
function applyVisitorBatch(data) {
    let sawVisitorMsg = false;
    let restoredNick = '';
    let addedAny = false;
    let maxIncomingId = 0;
    // cast view mode: cast = shop側. incoming = visitor msg.
    // 通常 visitor mode: incoming = shop msg.
    const incomingType = IS_CAST_VIEW ? 'visitor' : 'shop';
    for (const m of (data.messages || [])) {
        // 翻訳: 訪問者入力言語を addMessage より前に更新する.
        // addMessage は state.visitor_input_lang をアンカーに翻訳判定するため、
        // 先に更新しないと初回の非日本語メッセージが翻訳されない (anchor='ja'のまま).
        // DB の source_lang が無い/壊れている時は本文から detectLang で補完
        // (古い lang=currentLang 送信で source_lang='ja' が入ってしまったレガシー対応).
        if (m.sender_type === 'visitor') {
            const raw = (m.source_lang || '').toLowerCase();
            const detected = detectLang(m.message);
            const lang = (raw && I18N && I18N[raw]) ? raw : detected;
            if (lang && I18N && I18N[lang]) {
                state.visitor_input_lang = lang;
            }
        }
        // cmid があれば常に addMessage に渡す (addMessage 側で cmid dedup).
        // cmid 無しの legacy msg のみ id ベース dedup.
        if (m.client_msg_id || !m.id || m.id > state.last_message_id) {
            addMessage(m, false);
            addedAny = true;
            if (m.id) state.last_message_id = Math.max(state.last_message_id, m.id);
        }
        if (m.sender_type === 'visitor') {
            sawVisitorMsg = true;
            if (!restoredNick && m.nickname) restoredNick = String(m.nickname).trim().slice(0, 20);
        }
        if (m.sender_type === incomingType && m.id > maxIncomingId) maxIncomingId = m.id;
    }
    if (addedAny) sortMessagesByTime();
    // 既存セッション復元: 過去のニックネームを再入力欄にも反映（変更可、ロックしない）
    if (state.mode === 'visitor' && sawVisitorMsg && refs.nicknameInput && restoredNick && !refs.nicknameInput.value) {
        refs.nicknameInput.value = restoredNick;
    }
    if (typeof data.last_read_own_id !== 'undefined') {
        state.last_read_own_id = Math.max(state.last_read_own_id, Number(data.last_read_own_id) || 0);
        updateReadMarkers();
    }
    if (typeof data.shop_avatar_url !== 'undefined') state.shop_avatar_url = data.shop_avatar_url || null;
    if (typeof data.cast_avatar_url !== 'undefined') state.cast_avatar_url = data.cast_avatar_url || null;
    // 2026-04-23 ゼロ設計: ウィンドウ見てる時のみ incoming msg を明示既読化 (暗黙既読は全廃)
    if (addedAny && maxIncomingId > 0 && isWindowActive()) {
        sendMarkReadForCurrentView(maxIncomingId);
    }
    if (typeof data.other_typing !== 'undefined') renderTypingIndicator(!!data.other_typing);
    updateStatusIndicator(data.shop_online);
    if (data.status === 'closed') applyClosedState();
    if ((data.messages || []).length) saveVisitorSession();
}

// 初期ロード / 送信直後の一回取得
async function pollMessages(initial) {
    if (!state.session_token) return;
    try {
        const params = {
            session_token: state.session_token,
            since_id: state.last_message_id
        };
        if (IS_CAST_VIEW) params.as_cast = 1;
        const data = await api('poll-messages', params, 'GET');
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
    // #2: 訪問者がフォアグラウンド かつ ウィンドウにフォーカスがある間だけ
    // DO に view signal を送る. 別ウィンドウに隠れてるタブは既読対象外.
    // (document.hidden だけではウィンドウ後ろ隠しを検出できない)
    if (isWindowActive() && state.session_token) {
        try { state._visitorSub.setView && state._visitorSub.setView(state.session_token); } catch (_) {}
    }
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
    // キャスト指名URL (?cast=) では店舗の受付時間に依存しない.
    // キャスト個人は受付時間という概念を持たないため「営業時間外」バナーは出さない.
    if (CAST_ID) {
        note.classList.remove('reception-closed');
        note.textContent = '';
        note.classList.add('hidden');
        return;
    }
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

// 過去仕様: 最初の送信後にニックネームを readOnly+locked 表示で固定していた。
// 変更可に戻したため、空欄なら "匿名" を埋める表示補助のみ残す（送信時に literal "匿名" は空送信に変換）.
function lockVisitorNickname() {
    const input = refs.nicknameInput;
    if (!input) return;
    const val = String(input.value || '').trim().slice(0, 20);
    if (!val) {
        input.value = t('nickname.anonymous');
    }
}

async function sendVisitorMessage(msg) {
    msg = String(msg || '').trim();
    if (!msg) return;
    let nick = '';
    if (refs.nicknameInput) {
        nick = String(refs.nicknameInput.value || '').trim().slice(0, 20);
        // 表示補助で埋めた "匿名" は名前として送らない（毎送信で再評価. ロック廃止後も同じ判定）.
        if (nick === t('nickname.anonymous')) nick = '';
    }
    if (nick) { try { localStorage.setItem(LS_NICKNAME, nick); } catch (_) {} }
    const wasOffline = !state.is_online;
    // client_msg_id: ネットワーク再送でもサーバー側が同一メッセージと判定 (UNIQUE制約).
    const clientMsgId = uuidv4();
    // 入力本文から言語を検出. currentLang (UI言語) は参照しない.
    // memory: feedback_chat_translation_anchor — 翻訳アンカーは「訪問者が打った言語」.
    const msgLang = detectLang(msg) || currentLang || '';
    const payload = {
        auth: { kind: 'visitor', session_token: state.session_token },
        message: msg,
        nickname: nick || '',
        lang: msgLang,
        client_msg_id: clientMsgId,
        since_id: state.last_message_id || 0,
    };
    // 楽観UI: 送信即バブル描画. 入力欄もクリア (LINE UX).
    addOutgoingOptimistic(clientMsgId, msg);
    clearInputPreservingIme();
    clearDraft();
    lockVisitorNickname();
    try {
        const resp = await sendUnified(payload);
        markOptimisticSent(clientMsgId, (resp.messages || []).find(m => m.client_msg_id === clientMsgId));
        // 統一バッチ応答を同じハンドラで反映. addMessage は cmid dedup で 新規描画スキップ.
        applyVisitorBatch(resp);
        if (wasOffline && !state.offlineNotifiedShown) {
            showOfflineNotifiedHint();
            state.offlineNotifiedShown = true;
        }
    } catch (e) {
        markOptimisticFailed(clientMsgId, e);
        enqueueOutbox(clientMsgId, { payload, text: msg });
        // 410 = サーバー側で既に closed. 次の poll を待たず即時にUIを終了状態へ.
        if (e && e.status === 410) applyClosedState();
    }
}

// キャストURL返信: /chat/{slug}/?cast=<shop_cast_id>&view=<session_token> の画面から
// URL-only auth (device_token 不要) で PHP 統一送信へ投げる.
// PHP が INSERT 後に respondOwnerBatch 経由で DO /broadcast を叩き、訪問者 WS に push される.
// ── 以前は cast-url-reply が DO を経由しなかったため doFetch('/owner/reply') ハックが必要だったが、
// 統一送信+/broadcast リレー導入後は不要になったため削除.
async function sendCastReply(msg) {
    msg = String(msg || '').trim();
    if (!msg) return;
    const clientMsgId = uuidv4();
    const auth = {
        kind: 'cast_view',
        session_token: state.session_token,
        shop_cast_id: CAST_ID,
    };
    // HIGH 2026-04-29: メールURL の HMAC bearer を転送.
    if (CAST_BEARER) {
        auth.ct = CAST_BEARER.ct;
        auth.iat = CAST_BEARER.iat;
    }
    const payload = {
        auth,
        message: msg,
        client_msg_id: clientMsgId,
        since_id: state.last_message_id || 0,
    };
    // cast view 自送信 (位置クラスは positionClassFor が globals から判定)
    addOutgoingOptimistic(clientMsgId, msg);
    clearInputPreservingIme();
    clearDraft();
    try {
        const resp = await sendUnified(payload);
        markOptimisticSent(clientMsgId, (resp.messages || []).find(m => m.client_msg_id === clientMsgId));
        // owner-reply と同じ形状の batch が返る. applyVisitorBatch は cast view 視点と整合する (positionClassFor).
        applyVisitorBatch(resp);
    } catch (e) {
        markOptimisticFailed(clientMsgId, e);
        enqueueOutbox(clientMsgId, { payload, text: msg });
        if (e && e.status === 410) applyClosedState();
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
    disableVisitorHeader();
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
    // 上限30件の注釈: 受信箱は last_activity_at DESC LIMIT 30 なので
    // 31件目以降の古いスレッドは表示されない. 見落とし防止の案内を末尾に出す.
    const note = document.createElement('li');
    note.className = 'inbox-limit-note';
    note.textContent = t('inbox.limitNote');
    refs.inboxList.appendChild(note);
}

async function openOwnerThread(sessionId) {
    state.selected_session = state.inbox_sessions.find(s => Number(s.id) === Number(sessionId));
    if (!state.selected_session) return;
    // B-1: DO にオーナー presence を通知 (自動既読トリガ).
    //   visitor からの新着は owner WS が受信 → この presence があれば DO が即時 read 反映.
    //   ウィンドウにフォーカスが無い (別ウィンドウの裏など) 場合は既読対象外にするため setView しない.
    //   フォーカス復帰時に focus リスナーが setView(token) を再送する.
    if (state._ownerSub && state._ownerSub.setView && state.selected_session.session_token && isWindowActive()) {
        state._ownerSub.setView(state.selected_session.session_token);
    }
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
        let maxVisitorId = 0;
        for (const m of (data.messages || [])) {
            addMessage(m, true);
            state.last_message_id = Math.max(state.last_message_id, m.id);
            if (m.sender_type === 'visitor' && m.id > maxVisitorId) maxVisitorId = m.id;
        }
        if (typeof data.last_read_own_id !== 'undefined') {
            state.last_read_own_id = Math.max(state.last_read_own_id, Number(data.last_read_own_id) || 0);
            updateReadMarkers();
        }
        state.selected_session.is_blocked = !!data.is_blocked;
        updateBlockButton();
        // 2026-04-23 ゼロ設計: スレッドを開いた瞬間、見ている visitor msg を明示既読化.
        // (以前は PHP owner-inbox が暗黙 auto-read していたが、その経路を廃止したため明示必須.)
        if (maxVisitorId > 0 && isWindowActive()) {
            sendMarkReadForCurrentView(maxVisitorId);
        }
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
    const clientMsgId = uuidv4();
    const sessionId = state.selected_session.id;
    const payload = {
        auth: { kind: 'owner', device_token: state.device_token },
        session_id: sessionId,
        message: msg,
        client_msg_id: clientMsgId,
        since_id: state.last_message_id || 0,
    };
    // オーナー自送信 (位置クラスは positionClassFor が globals から判定)
    addOutgoingOptimistic(clientMsgId, msg);
    clearInputPreservingIme();
    try {
        const r = await sendUnified(payload);
        markOptimisticSent(clientMsgId, (r.messages || []).find(m => m.client_msg_id === clientMsgId));
        // 統一バッチ応答を applyOwnerBatch で反映 (自送信メッセージも同経由で画面に出る).
        applyOwnerBatch(r, sessionId);
    } catch (e) {
        markOptimisticFailed(clientMsgId, e);
        enqueueOutbox(clientMsgId, { payload, text: msg });
        if (e && e.authFailed) handleDeviceAuthFailure();
    }
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
    let addedAny = false;
    let maxIncomingId = 0;
    for (const m of (data.messages || [])) {
        // オーナー視点: incoming = visitor msg. 訪問者入力言語を addMessage より前に更新.
        // addMessage は state.visitor_input_lang をアンカーに翻訳判定するため、
        // 先に更新しないと初回の非日本語メッセージが翻訳されない (anchor='ja'のまま).
        // DB の source_lang が無い/壊れている時は本文から detectLang で補完
        // (古い lang=currentLang 送信で source_lang='ja' が入ってしまったレガシー対応).
        if (m.sender_type === 'visitor') {
            const raw = (m.source_lang || '').toLowerCase();
            const detected = detectLang(m.message);
            const lang = (raw && I18N && I18N[raw]) ? raw : detected;
            if (lang && I18N && I18N[lang]) {
                state.visitor_input_lang = lang;
            }
        }
        if (m.client_msg_id || !m.id || m.id > state.last_message_id) {
            addMessage(m, true);
            addedAny = true;
            if (m.id) state.last_message_id = Math.max(state.last_message_id, m.id);
        }
        if (m.sender_type === 'visitor' && m.id > maxIncomingId) maxIncomingId = m.id;
    }
    if (addedAny) sortMessagesByTime();
    if (typeof data.last_read_own_id !== 'undefined') {
        state.last_read_own_id = Math.max(state.last_read_own_id, Number(data.last_read_own_id) || 0);
        updateReadMarkers();
    }
    if (typeof data.shop_avatar_url !== 'undefined') state.shop_avatar_url = data.shop_avatar_url || null;
    if (typeof data.cast_avatar_url !== 'undefined') state.cast_avatar_url = data.cast_avatar_url || null;
    if (typeof data.other_typing !== 'undefined') renderTypingIndicator(!!data.other_typing);
    // 2026-04-23 ゼロ設計: オーナーがスレッド表示中かつウィンドウ見てる時のみ visitor msg を既読化
    if (addedAny && maxIncomingId > 0 && isWindowActive() && state.selected_session) {
        sendMarkReadForCurrentView(maxIncomingId);
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
    disableVisitorHeader();
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
    // キャスト自身のアバター: cast_inbox API が返す cast_avatar_url を保持.
    // 受信箱 → スレッド開封時にこの値を使って自分のメッセージ横に表示（POS_SELF側は非表示だが、
    // もし cast thread で相手=visitor が閲覧した場合の将来拡張のため保持）
    if (typeof data.cast_avatar_url !== 'undefined') state.cast_avatar_url = data.cast_avatar_url || null;
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
    // キャスト受信箱では「受付中/停止中」ラベルは出さない（緑丸と通知トグルだけで状態は十分伝わる）
    if (refs.statusLabel) refs.statusLabel.classList.add('hidden');
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
        let maxVisitorId = 0;
        for (const m of (data.messages || [])) {
            addMessage(m, true);
            state.last_message_id = Math.max(state.last_message_id, m.id);
            if (m.sender_type === 'visitor' && m.id > maxVisitorId) maxVisitorId = m.id;
        }
        if (typeof data.last_read_own_id !== 'undefined') {
            state.last_read_own_id = Math.max(state.last_read_own_id, Number(data.last_read_own_id) || 0);
            updateReadMarkers();
        }
        if (typeof data.shop_avatar_url !== 'undefined') state.shop_avatar_url = data.shop_avatar_url || null;
        if (typeof data.cast_avatar_url !== 'undefined') state.cast_avatar_url = data.cast_avatar_url || null;
        // 2026-04-23 ゼロ設計: スレッドを開いた瞬間、見ている visitor msg を明示既読化.
        // cast-inbox poll は暗黙既読しないため、開封時の1発は必須.
        if (maxVisitorId > 0 && isWindowActive()) {
            sendMarkReadForCurrentView(maxVisitorId);
        }
    } catch (e) { showError(e.message); }

    const isClosed = state.selected_session.status === 'closed';
    refs.inputArea.classList.toggle('hidden', isClosed);
    if (refs.emojiToggle) refs.emojiToggle.classList.toggle('hidden', isClosed);
    if (isClosed) addSystemMessage(t('thread.closedThanks'));
    if (refs.castViewBanner) refs.castViewBanner.classList.add('hidden');
}

async function sendCastInboxReply(msg) {
    if (!state.selected_session) return;
    msg = String(msg || '').trim();
    if (!msg) return;
    const clientMsgId = uuidv4();
    const sessionId = state.selected_session.id;
    const payload = {
        auth: {
            kind: 'cast_inbox',
            inbox_token: CAST_INBOX_TOKEN,
            device_token: state.cast_device_token,
        },
        session_id: sessionId,
        message: msg,
        client_msg_id: clientMsgId,
        since_id: state.last_message_id || 0,
    };
    // キャスト受信箱 自送信 (位置クラスは positionClassFor が globals から判定)
    addOutgoingOptimistic(clientMsgId, msg);
    clearInputPreservingIme();
    try {
        const r = await sendUnified(payload);
        markOptimisticSent(clientMsgId, (r.messages || []).find(m => m.client_msg_id === clientMsgId));
        // respondOwnerBatch と同形なので applyOwnerBatch で反映可能
        applyOwnerBatch(r, sessionId);
    } catch (e) {
        markOptimisticFailed(clientMsgId, e);
        enqueueOutbox(clientMsgId, { payload, text: msg });
    }
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
    // 即時 catchup (visibility復帰時の待ち時間を消す)
    tick();
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
// 送信ボタンの focus 維持戦略:
//
// iOS Safari の touch tap で input から focus が外れる問題は mousedown preventDefault だけでは
// 解消しない. iOS では touch event の発火順序が
//   touchstart → touchend → focus shift → click
// で, focus shift は touchstart/touchend のタイミングで起きるため mousedown preventDefault は遅すぎる.
//
// → touch device は touchstart で focus shift をブロック + touchend で送信を直接実行.
//   PC mouse は mousedown preventDefault + click で従来通り.
// (memory: feedback_chat_send_button_no_blur — touch では mousedown 不十分という追記が必要)
function _doSendFromButton() {
    // v=184 (2026-04-27): 変換前 (実際に IME composition 中) は送信しない.
    // ただし iOS 絵文字パレットは compositionstart は来るが compositionend が抜ける
    // (memory: feedback_ios_emoji_palette_composition) → _isComposing が stuck-true に.
    // 値が純絵文字/記号 (\p{L}\p{Nd} 含まない) の時は composition stuck 扱いで force-reset して送信.
    const msg = refs.input.value;
    if (_isComposing) {
        const hasLetter = /[\p{L}\p{Nd}]/u.test(msg);
        if (hasLetter) return; // 本物の変換中: 送信しない
        _isComposing = false;  // 絵文字 stuck: 解除して送信
    }
    if (IS_CAST_VIEW) sendCastReply(msg);
    else if (state.mode === 'cast_owner') sendCastInboxReply(msg);
    else if (state.mode === 'owner') sendOwnerReply(msg);
    else sendVisitorMessage(msg);
}
let _sendBtnTouched = false;
refs.sendBtn.addEventListener('touchstart', (e) => {
    // touch tap で input から focus が外れるのを防ぐ. passive:false 必須.
    e.preventDefault();
    _sendBtnTouched = true;
}, { passive: false });
refs.sendBtn.addEventListener('touchend', (e) => {
    // touchend で送信処理を直接実行. 続く click event は preventDefault で抑制.
    e.preventDefault();
    _doSendFromButton();
    // _sendBtnTouched は次の click を skip させるためにそのまま立てておき, 短時間で reset.
    setTimeout(() => { _sendBtnTouched = false; }, 350);
});
refs.sendBtn.addEventListener('mousedown', (e) => {
    // PC mouse 用: focus shift 抑止.
    e.preventDefault();
});
refs.sendBtn.addEventListener('click', (e) => {
    // touch 経路で送信済みなら skip (touchend.preventDefault が click を抑制するはずだが
    // iOS の一部状況で ghost click が来るので二重防御).
    if (_sendBtnTouched) return;
    _doSendFromButton();
});

// Enter キー処理は _bindChatInputEvents 内 (input リスナ群と co-located).

// Day 8: typing emit (スロットル付き — 3秒おきに再発火)
// #3: 値が空になった / blur / 送信時は stop 信号を明示送信.
// イベント定義本体は clearInputPreservingIme と共有させるため _bindChatInputEvents に切り出した.
// (送信のたびに textarea を clone で差し替えてリスナを再アタッチする運用)
_bindChatInputEvents(refs.input);
// ページ離脱時も確実に保存 (iOS では beforeunload が発火しない事があるため pagehide も付ける)
window.addEventListener('pagehide', saveDraftNow);
window.addEventListener('beforeunload', saveDraftNow);

// scroll-to-bottom ボタン: メッセージ領域のスクロール変化で表示更新.
// passive:true で scroll perf を確保.
if (refs.chatMessages) {
    refs.chatMessages.addEventListener('scroll', updateScrollBottomBtn, { passive: true });
}

if (refs.quickQuestions) {
    refs.quickQuestions.addEventListener('click', (e) => {
        const btn = e.target.closest('.quick-btn');
        if (!btn) return;
        sendVisitorMessage(btn.dataset.quick);
    });
}

// 訪問者メール通知: チェックボックス切替で入力欄の表示/非表示を同期.
// OFF 操作は即保存 (メールアドレスは PHP 側で保持される).
if (refs.visitorNotifyToggle) {
    refs.visitorNotifyToggle.addEventListener('change', () => {
        const on = refs.visitorNotifyToggle.checked;
        if (refs.visitorNotify) refs.visitorNotify.classList.toggle('hidden', !on);
        if (!on) {
            // OFF は即保存（メアド未入力でも OK）
            saveVisitorNotify();
        } else if (state.visitor_notify_verified && state.visitor_notify_email) {
            // 既に確認済みのメアドがある: 再入力不要で即有効化 (PHP 側は同一メール+verified なら verification skip)
            saveVisitorNotify();
        } else {
            // 未登録 or 未確認: フォームを見せる. 入力欄の auto-focus は **絶対に呼ばない**.
            // 理由: iOS Safari + iframe 埋込で programmatic focus() を呼ぶと
            //   ① focusin → notifyParent('focus') → chat-embed.js が prefocus (iframe 150px に縮小)
            //   ② iOS が input-only autofill を出す
            //   ③ vv.resize 後の expandToVV が autofill 干渉で発火せず iframe が 150px で固着
            //   ④ 結果: メール入力欄が画面外、parent ページが下に見える状態 (2026-04-26 報告)
            // ユーザー自身が email input を tap した場合は touchend → source='touch' で正常に
            // prefocus → expand のフルライフサイクルが走るため、auto-focus は不要.
            showNotifyStatus('', '');
            // メール入力欄を可視範囲にスクロール (chat-messages 内に scroll させる).
            try {
                if (refs.visitorNotify && typeof refs.visitorNotify.scrollIntoView === 'function') {
                    refs.visitorNotify.scrollIntoView({ block: 'end', behavior: 'smooth' });
                }
            } catch (_) {}
        }
    });
}
if (refs.visitorNotifySave) {
    refs.visitorNotifySave.addEventListener('click', saveVisitorNotify);
}
if (refs.visitorNotifyResend) {
    refs.visitorNotifyResend.addEventListener('click', resendVisitorEmailVerify);
}
if (refs.visitorNotifyEdit) {
    refs.visitorNotifyEdit.addEventListener('click', () => {
        // verified-collapsed を解除してメール入力欄を再表示. 「確認画面を閉じる」リンクも見せる.
        if (refs.visitorNotify) refs.visitorNotify.classList.remove('verified-collapsed');
        refs.visitorNotifyEdit.classList.add('hidden');
        if (refs.visitorNotifyCloseLink) refs.visitorNotifyCloseLink.classList.remove('hidden');
        // programmatic focus() は iframe iOS で iframe 縮小固着を引き起こすので呼ばない.
        // 入力欄を見える位置にスクロールするだけ.
        try {
            if (refs.visitorNotify && typeof refs.visitorNotify.scrollIntoView === 'function') {
                refs.visitorNotify.scrollIntoView({ block: 'end', behavior: 'smooth' });
            }
        } catch (_) {}
    });
}
if (refs.visitorNotifyCloseLink) {
    refs.visitorNotifyCloseLink.addEventListener('click', () => {
        // 変更せずに畳む: verified-collapsed を戻して「変更」リンクだけ残す.
        if (refs.visitorNotify) refs.visitorNotify.classList.add('verified-collapsed');
        if (refs.visitorNotifyEdit) refs.visitorNotifyEdit.classList.remove('hidden');
        refs.visitorNotifyCloseLink.classList.add('hidden');
    });
}
if (refs.visitorNotifyEmail) {
    refs.visitorNotifyEmail.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            saveVisitorNotify();
        }
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

// 絵文字ボタン/popup は mousedown preventDefault で chat-input の focus を維持する.
// 送信ボタンと同じパターン (memory: feedback_chat_send_button_no_blur).
// これがないと tap で input が blur → chat-input-focused class が外れて nickname/email 等が再表示
// → iframe レイアウトが変動 → ボタン位置がズレて popup が次タップを取りこぼす.
const preventBlurOnQuickBtn = (popup) => {
    if (!popup) return;
    popup.addEventListener('mousedown', (e) => {
        if (e.target.closest('.quick-btn')) e.preventDefault();
    });
};

if (refs.ownerQuick) {
    preventBlurOnQuickBtn(refs.ownerQuick);
    refs.ownerQuick.addEventListener('click', (e) => {
        const btn = e.target.closest('.quick-btn');
        if (!btn) return;
        insertEmojiAtCursor(btn.dataset.quick || '');
        refs.ownerQuick.classList.add('hidden');
    });
}

if (refs.visitorQuick) {
    preventBlurOnQuickBtn(refs.visitorQuick);
    refs.visitorQuick.addEventListener('click', (e) => {
        const btn = e.target.closest('.quick-btn');
        if (!btn) return;
        insertEmojiAtCursor(btn.dataset.quick || '');
        refs.visitorQuick.classList.add('hidden');
    });
}

// chat-input-area の "隙間" (textarea/送信ボタン以外の余白) を tap した時も focus を失わせない.
// 送信ボタン狙いで少しズレた tap が gap に落ちると blur → chat-input-focused 解除 →
// レイアウト変動で送信ボタンの位置が動き、続く click が空振りする問題への保険 (v=171).
if (refs.inputArea) {
    refs.inputArea.addEventListener('mousedown', (e) => {
        if (e.target.closest('textarea, input')) return;
        e.preventDefault();
    });
}

if (refs.emojiToggle) {
    refs.emojiToggle.addEventListener('mousedown', (e) => {
        e.preventDefault();
    });
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
            // キャスト指名ビュー: URL-only auth + HMAC bearer (HIGH 2026-04-29)
            const tnPayload = {
                session_token: state.session_token,
                shop_cast_id: CAST_ID,
                enabled: isOn ? 1 : 0
            };
            if (CAST_BEARER) { tnPayload.ct = CAST_BEARER.ct; tnPayload.iat = CAST_BEARER.iat; }
            await api('cast-url-toggle-notify', tnPayload);
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
    // B-1: presence クリア. DO 側で自動既読の対象外になる.
    if (state._ownerSub && state._ownerSub.setView) {
        state._ownerSub.setView(null);
    }
    state.selected_session = null;
    renderTypingIndicator(false);
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
    // #3: タブを閉じる前に入力中なら stop 信号を送る (sendBeacon).
    if (_hadTypingValue) { emitTypingStop({ beacon: true }); _hadTypingValue = false; }
    stopPolling();
    sendOwnerGoOffline();
});
window.addEventListener('pagehide', () => {
    if (_hadTypingValue) { emitTypingStop({ beacon: true }); _hadTypingValue = false; }
    sendOwnerGoOffline();
});
// 既読トリガ用のプレゼンス判定:
// - document.hidden = false だけでは別ウィンドウの裏に隠れているタブを「表示中」扱いしてしまい、
//   相手が実際に見ていないのに既読が付く (送信した瞬間既読になる) バグになる.
// - document.hasFocus() 併用で「同じウィンドウが最前面にあるタブ」だけを viewing と判定.
// 2026-04-23 ゼロ設計: 明示 mark-read ディスパッチ.
// モード別に正しい reader で呼び分ける. isWindowActive() は呼び出し側でゲート.
//
// セッション所有権ルール:
//   - cast_id IS NULL のセッション → 店舗オーナーが既読権限を持つ
//   - cast_id IS NOT NULL のセッション → キャスト本人のみが既読権限を持つ
//   - 店舗オーナーが shop-admin 等で cast セッションを閲覧しても mark-read しない
function sendMarkReadForCurrentView(upToId) {
    if (!upToId) return;

    // [owner] 店舗オーナー: cast セッションは対象外 (所有権違反防止)
    if (state.mode === 'owner' && state.selected_session) {
        if (state.selected_session.cast_id) return;  // cast セッションは触らない
        if (state._ownerSub && state._ownerSub.markRead) {
            const tok = state.selected_session.session_token;
            try { state._ownerSub.markRead(state.selected_session.id, upToId, tok); } catch (_) {}
        }
        return;
    }

    // [cast_owner] キャスト自分用受信箱 (?cast_inbox=<uuid>)
    if (state.mode === 'cast_owner' && state.selected_session) {
        api('cast-mark-read', {
            inbox_token: CAST_INBOX_TOKEN,
            device_token: state.cast_device_token,
            session_id: state.selected_session.id,
            up_to_id: upToId,
        }, 'POST').catch(() => {});
        return;
    }

    // [visitor] 訪問者 (cast view 含む)
    if (state.mode === 'visitor' && state.session_token) {
        if (IS_CAST_VIEW && CAST_ID) {
            // キャストメール返信URL (?cast=&view=): cast-mark-read auth branch B + HMAC bearer
            const mrPayload = {
                session_token: state.session_token,
                shop_cast_id: CAST_ID,
                up_to_id: upToId,
            };
            if (CAST_BEARER) { mrPayload.ct = CAST_BEARER.ct; mrPayload.iat = CAST_BEARER.iat; }
            api('cast-mark-read', mrPayload, 'POST').catch(() => {});
        } else if (state._visitorSub && state._visitorSub.markRead) {
            // 通常訪問者: DO WS 経由 mark-read (sender_type='shop' 既読化)
            try { state._visitorSub.markRead(upToId); } catch (_) {}
        }
        return;
    }
}

function isWindowActive() {
    if (document.hidden) return false;
    try { return typeof document.hasFocus === 'function' ? document.hasFocus() : true; }
    catch (_) { return true; }
}

function updatePresenceFromActivity() {
    const active = isWindowActive();
    // 訪問者 presence
    if (state._visitorSub && state._visitorSub.setView) {
        try { state._visitorSub.setView(active && state.session_token ? state.session_token : null); } catch (_) {}
    }
    // オーナー presence (スレッド選択中のみ)
    if (state._ownerSub && state._ownerSub.setView) {
        const tok = state.selected_session && state.selected_session.session_token;
        try { state._ownerSub.setView(active && tok ? tok : null); } catch (_) {}
    }
    // 2026-04-23 ゼロ設計: active になった瞬間に catch-up mark-read.
    // (見てない間に届いた incoming msg を明示的に既読化)
    if (active && state.last_message_id > 0) {
        sendMarkReadForCurrentView(state.last_message_id);
    }
}

// 2026-04-23: DO 側 last_view_at 鮮度 (45s) を切らさないための view heartbeat.
// isWindowActive 中は 20s 周期で view signal を再送.
let _viewHeartbeatTimer = null;
function ensureViewHeartbeat() {
    if (_viewHeartbeatTimer) return;
    _viewHeartbeatTimer = setInterval(() => {
        if (!isWindowActive()) return;
        if (state._visitorSub && state._visitorSub.setView && state.session_token) {
            try { state._visitorSub.setView(state.session_token); } catch (_) {}
        }
        if (state._ownerSub && state._ownerSub.setView && state.selected_session) {
            const tok = state.selected_session.session_token;
            if (tok) { try { state._ownerSub.setView(tok); } catch (_) {} }
        }
    }, 20000);
}
ensureViewHeartbeat();

// ウィンドウフォーカスの取得/喪失 (別ウィンドウへの切り替え) で presence を切り替える.
// visibilitychange はタブ切替/最小化のみ、blur/focus は別ウィンドウへの移動もカバーする.
window.addEventListener('blur', () => { updatePresenceFromActivity(); });
window.addEventListener('focus', () => { updatePresenceFromActivity(); });

window.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // #2: 訪問者 presence を DO 側からクリア (WS close でも消えるが明示).
        if (state._visitorSub && state._visitorSub.setView) {
            try { state._visitorSub.setView(null); } catch (_) {}
        }
        if (state._ownerSub && state._ownerSub.setView) {
            try { state._ownerSub.setView(null); } catch (_) {}
        }
        // #3: 画面が隠れた瞬間 typing 停止を相手に伝える.
        if (_hadTypingValue) { emitTypingStop({ beacon: true }); _hadTypingValue = false; }
        stopPolling();
        sendOwnerGoOffline();
    } else if (state.mode === 'visitor' && state.session_token) {
        startVisitorPolling();
        flushOutbox();
        updatePresenceFromActivity();
    } else if (state.mode === 'owner') {
        startInboxPolling();
        flushOutbox();
        updatePresenceFromActivity();
    } else if (state.mode === 'cast_owner') {
        startCastInboxPolling();
        flushOutbox();
        updatePresenceFromActivity();
    }
});
// ネットワーク復帰時に outbox を再試行 (オフライン→オンラインで失敗メッセージを自動リトライ)
// バナー: offline で赤, online で緑(1.5s autohide).
window.addEventListener('online', () => {
    showNetworkBanner('reconnected', t('net.reconnected') || '✓ 再接続しました');
    flushOutbox();
});
window.addEventListener('offline', () => {
    showNetworkBanner('offline', t('net.offline') || '📡 オフライン — 接続を待っています');
});
// 初回ロード時にオフラインなら即バナー.
if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setTimeout(() => showNetworkBanner('offline', t('net.offline') || '📡 オフライン — 接続を待っています'), 100);
}

// ===== 埋込時の直リンク/キャスト指名フッター =====
// iframe で埋め込まれている時だけ、chat 下部に「直リンクはこちら ↗」と
// キャスト指名プルダウンを表示する。どちらも _blank で chat.html を標準ページとして開く。
// スマホは embed 親スニペットで iframe→ボタン差替されるため、このフッターは主にデスクトップで見える。
function setupEmbedDirectLinkFooter() {
    if (!isEmbedded()) return;
    const el = document.getElementById('embed-direct-link');
    if (!el) return;
    const anchor = document.getElementById('embed-direct-link-anchor');
    // ?cast=&view=... 等の特殊モードでは出さない
    if (CAST_ID || location.search.includes('cast_inbox=') || location.search.includes('owner=')) return;
    const directUrl = location.origin + '/chat/' + encodeURIComponent(SLUG) + '/';
    if (anchor) anchor.href = directUrl;
    el.classList.remove('hidden');

    // キャスト一覧を chat-api から取得してチップ <a target="_top"> の列で出す（cast 有効店舗のみ）.
    // target="_top" の理由 (2026-04-28): _blank だと iOS Safari で新規タブに履歴が無く
    // 戻るボタンで埋込元 (例: go-kichi.com) に戻れない. _top で親ウィンドウを置換すれば
    // 履歴に [親ページ → cast ページ] が積まれ、戻るボタンが正しく動作する.
    // 過去に <select> + change → window.open / a.click() を試したが iOS Safari の popup blocker や
    // iframe sandbox で抑止される事例があり、実ユーザータップの <a> なら必ずブラウザが処理.
    const picker = document.getElementById('embed-cast-picker');
    const list = document.getElementById('embed-cast-list');
    if (!picker || !list) return;
    fetch('/api/chat-api.php?action=cast-list-public&slug=' + encodeURIComponent(SLUG), {
        credentials: 'omit'
    }).then(r => r.ok ? r.json() : null).then(data => {
        if (!data || !Array.isArray(data.casts) || !data.casts.length) return;
        list.innerHTML = '';
        data.casts.forEach(c => {
            if (!c || !c.id) return;
            const a = document.createElement('a');
            a.href = directUrl + '?cast=' + encodeURIComponent(c.id);
            a.target = '_top';
            a.className = 'embed-cast-link';
            a.textContent = c.display_name || '';
            list.appendChild(a);
        });
        picker.classList.remove('hidden');
        try { updateCastIconForMode(document.body.dataset.mode || 'men'); } catch (_) {}
    }).catch(() => {});
}
setupEmbedDirectLinkFooter();

// ===== 埋込時の入力フォーカス → 親にアンカースクロール依頼 =====
// 方針: iframe を全画面化しない（本体ヘッダー/フッター/他ページ遷移を守る）。
// 入力フォーカス時は親ページ側で iframe.scrollIntoView({block:'end'}) を呼んでもらい、
// iframe 末尾（入力欄）が可視領域に入るだけにする。内部レイアウトは visualViewport ハンドラが担当。
// 入力フォーカス時の postMessage は refs.input.focus() ハンドラ内で ychat:input-focus を送信済み.
// nickname / cdr-code 等の他の入力欄もカバーするため、focusin でも同じメッセージを送る.
(function setupEmbedInputScroll() {
    const embedded = isEmbedded();
    if (!embedded) return;
    const hasMM = typeof window.matchMedia === 'function';
    if (!hasMM) return;
    const isTouch = window.matchMedia('(pointer:coarse)').matches;
    const isDesktop = window.matchMedia('(hover:hover) and (pointer:fine)').matches;
    if (!isTouch || isDesktop) return;

    // iframe内の全入力欄で fit を発動させる。
    // 直リンクのスマホアクセスと同じ UX（入力欄がキーボード直上に出る）を
    // 埋込時にも再現する。nickname/email/認証コード/チャット本体すべて対象.
    const inputSelector = '#chat-input, .nickname-input, #cdr-code, textarea, input[type=text], input[type=email], input[type=password], input[type=tel], input[type=search], input[type=url], input[type=number]';
    // インタラクティブ要素 (送信ボタン/各種ボタン/リンク等). これらをタップしたら fireBodyTap で
    // blur+widget-tap させずに普通の click handler に任せる.
    // 重要: 送信ボタン (#chat-send) を fireBodyTap 対象にすると ae.blur() で kb 閉じ → kb-close
    // アニメ中に送信ボタン位置がズレ → click ミスヒットで送信できなくなる
    // (memory: feedback_chat_send_button_no_blur).
    // #chat-input-area: 入力欄+送信ボタンのコンテナ. gap/padding に落ちた "ニアミス tap" でも
    // blur させない (v=172). iOS は touchend → mousedown 順なので chat-input-area の
    // mousedown.preventDefault では touchend での blur を防げないため touch 側で塞ぐ必要がある.
    const interactiveSelector = '#chat-input-area, button, a[href], [role="button"], select, label, summary, input[type=button], input[type=submit], input[type=checkbox], input[type=radio], input[type=file]';
    // source を付けて親に送る: 'touch' = 直接タップ(確実にユーザー意図), 'focus' = focusin のみ(iOS auto-refocus の可能性あり).
    // chat-embed.js は widget-tap 直後の 'focus' は auto-refocus と判定して無視するが 'touch' は通す.
    const notifyParent = (source) => {
        try { window.parent.postMessage({ type: 'ychat:input-focus', source: source, slug: SLUG }, '*'); } catch (_) {}
    };
    document.addEventListener('focusin', (e) => {
        if (!e.target || !e.target.matches) return;
        if (e.target.matches(inputSelector)) notifyParent('focus');
    }, true);
    // 入力欄以外のタップ → 親に通知 + 同期 blur で kb を即閉.
    let _lastBodyTapTs = 0;
    const fireBodyTap = (target) => {
        if (target && target.matches && target.matches(inputSelector)) return;
        const now = Date.now();
        if (now - _lastBodyTapTs < 200) return;
        _lastBodyTapTs = now;
        try {
            const ae = document.activeElement;
            if (ae && typeof ae.blur === 'function' && ae.matches && ae.matches(inputSelector)) {
                ae.blur();
            }
        } catch (_) {}
        try { window.parent.postMessage({ type: 'ychat:widget-tap', slug: SLUG }, '*'); } catch (_) {}
    };

    // タップ vs スクロール判定: touchstart で開始位置を記録、touchmove で移動量追跡、
    // touchend で「ほぼ動いてない」場合のみ tap として処理する.
    // 旧実装は touchstart で即発火 → スクロール開始時の touchstart も「タップ」扱いされ
    // iframe が縮む副作用 (2026-04-25 ユーザー指摘).
    const TAP_MOVE_THRESHOLD = 10; // px
    const TAP_TIME_THRESHOLD = 600; // ms (long press は除外)
    let _tapStart = null;
    document.addEventListener('touchstart', (e) => {
        const t = (e.touches && e.touches[0]) ? e.touches[0] : null;
        if (!t || !t.target) { _tapStart = null; return; }
        // input 判定は matches だけでなく closest() で祖先も見る.
        // ラッパー要素 (label/wrapper div/sticky-bottom padding 等) を tap した場合でも
        // 入力欄を tap した意図を取りこぼさない. 取りこぼすと fireBodyTap → widget-tap →
        // iOS auto-refocus 由来の input-focus が 1500ms 抑制でブロック → kb 開かず.
        var isInputTarget = false;
        if (t.target.matches && t.target.matches(inputSelector)) {
            isInputTarget = true;
        } else if (t.target.closest && t.target.closest(inputSelector)) {
            isInputTarget = true;
        }
        _tapStart = {
            x: t.clientX,
            y: t.clientY,
            target: t.target,
            ts: Date.now(),
            moved: false,
            isInput: isInputTarget
        };
    }, { capture: true, passive: true });
    document.addEventListener('touchmove', (e) => {
        if (!_tapStart) return;
        const t = (e.touches && e.touches[0]) ? e.touches[0] : null;
        if (!t) return;
        const dx = Math.abs(t.clientX - _tapStart.x);
        const dy = Math.abs(t.clientY - _tapStart.y);
        if (dx > TAP_MOVE_THRESHOLD || dy > TAP_MOVE_THRESHOLD) {
            _tapStart.moved = true;
        }
    }, { capture: true, passive: true });
    // 要素が interactive (button/link 等) かどうか. これらは click handler に任せる.
    const isInteractiveTarget = (el) => {
        if (!el) return false;
        if (el.matches && el.matches(interactiveSelector)) return true;
        if (el.closest && el.closest(interactiveSelector)) return true;
        return false;
    };
    document.addEventListener('touchend', (e) => {
        const start = _tapStart;
        _tapStart = null;
        if (!start || start.moved) return;
        if (Date.now() - start.ts > TAP_TIME_THRESHOLD) return;
        if (start.isInput) {
            // 入力欄タップ: source='touch' で chat-embed.js に確実なユーザー意図を伝える
            notifyParent('touch');
        } else if (isInteractiveTarget(start.target)) {
            // 送信ボタン等のインタラクティブ要素: blur せず widget-tap も送らず click に任せる
            return;
        } else {
            fireBodyTap(start.target);
        }
    }, { capture: true, passive: true });
    document.addEventListener('touchcancel', () => {
        _tapStart = null;
    }, { capture: true, passive: true });

    // PC (mouse) 用フォールバック. touch device は上記 touch* で処理済み.
    document.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') return;
        if (isInteractiveTarget(e.target)) return;
        fireBodyTap(e.target);
    }, { capture: true, passive: true });
})();

// ===== iOS キーボード対応 (LINE方式) =====
// 設計思想:
//   - #chat-root は CSS で top/bottom 固定 → 常に全画面サイズ. ヘッダーは絶対に動かない.
//   - JS は --kb-h (キーボード高さ) を padding-bottom 経由で反映するだけ.
//     これで中身 (messages/input/footer) だけがキーボード分スライド、LINE/native iOS と同じ.
//   - close 時は --kb-h を 0 にスナップ (iOS keyboard slide-down を待たない).
//     chat-root サイズは不変なので flash が絶対に出ない.
(function setupViewportSystem(){
    const vv = window.visualViewport;
    const docEl = document.documentElement;
    let isClosing = false;
    let closingTimer = null;
    let keyboardOpen = false;
    // 親ページから ychat:embed-h で「可視領域の高さ」をもらった時の override 値.
    // 埋込時、iframe内のvisualViewportはiOSでキーボードを検知できないため、
    // 親側で計算した値を優先する.
    let parentEmbedH = null;
    const embedded = isEmbedded();
    // 埋込時は body.embedded を付け、chat-root の高さを vv.height 直読みで制御する.
    // iframe 内では 100svh が iframe 初期高さに張り付く iOS 挙動があり、
    // 100svh - kb-h の計算式が破綻する (keyboard 開でヘッダーしか残らない症状).
    if (embedded) document.body.classList.add('embedded');

    const setKbH = (px) => {
        docEl.style.setProperty('--kb-h', px + 'px');
    };
    const setEmbedH = (px) => {
        docEl.style.setProperty('--embed-h', px + 'px');
    };
    const scrollMessagesToBottom = () => {
        // キーボード開閉で chat-messages の高さが変わった直後に最下部へ. LINE UX.
        // CSS の --embed-h 変更 → layout reflow が走るのを 1 frame 待つ. 同じ tick で
        // scrollTop を書くと clientHeight がまだ古い値のため、新しい iframe サイズで
        // 正しく最下部にならず古い相対位置が残る (2回目 kb-open で起きる). rAF 二重で
        // layout 確定後に scrollTop を再適用してずれを回収.
        const msgs = document.getElementById('chat-messages');
        if (!msgs) return;
        msgs.scrollTop = msgs.scrollHeight;
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                msgs.scrollTop = msgs.scrollHeight;
                requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
            });
        }
    };
    const snapClose = () => {
        isClosing = true;
        keyboardOpen = false;
        setKbH(0);
        if (closingTimer) clearTimeout(closingTimer);
        // iOS keyboard close アニメ (~300ms) 中は vv 追従しない.
        closingTimer = setTimeout(() => { isClosing = false; }, 400);
    };
    const applyKbH = () => {
        // 埋込時は 親の override が来ていればそれを優先.
        // override が無い時は --embed-h を除去して CSS フォールバック (100%) に戻す.
        // iframe 自身の vv.height を使うと、親で iframe 高さを変えた直後にラグで
        // 古い値が返り chat-root が縮んだまま残るので、null リセット時は明示的に消す.
        // NOTE: isClosing ガードは直URLモード専用. 埋込モードでは親が権威なので,
        // input.blur() 直後の embed-h 受信を isClosing で 400ms ブロックすると
        // chat-root が前サイズ (319) で固着する致命バグになる (2026-04-25 ユーザー指摘).
        if (embedded) {
            const wasOpen = keyboardOpen;
            if (parentEmbedH !== null) {
                // embed-h 変動の度に, ユーザーが下端付近にいるなら追従する (LINE風 sticky-bottom).
                // prefocus(h=338) → expand(h=319) のように複数回 embed-h が来るケースで,
                // !wasOpen ガードだと expand 時に scroll しないため最新メッセージが下に押し出される
                // (2026-04-27 ユーザー報告: 入力欄タップで「ですの」「あいうえお」が隠れる).
                const msgs = document.getElementById('chat-messages');
                const stickToBottom = msgs
                    ? (msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 120)
                    : true;
                setEmbedH(parentEmbedH);
                keyboardOpen = true;
                if (!wasOpen || stickToBottom) scrollMessagesToBottom();
            } else {
                docEl.style.removeProperty('--embed-h');
                keyboardOpen = false;
            }
            return;
        }
        // 直URL: 従来通り kb-h を計算 (kb-close アニメ中の flicker 防止に isClosing 適用).
        if (isClosing) return;
        const kb = vv ? Math.max(0, window.innerHeight - vv.height) : 0;
        setKbH(kb);
        const wasOpen = keyboardOpen;
        keyboardOpen = kb > 0;
        if (!wasOpen && keyboardOpen) scrollMessagesToBottom();
    };
    applyKbH();

    // 親ページ（chat-embed.js）からの可視領域高さ通知を受ける。
    // iOS Safari iframe内では親ページのキーボード状態を検知できないので、親が計算した値を反映。
    if (embedded) {
        window.addEventListener('message', (e) => {
            const d = e.data;
            if (!d || typeof d !== 'object') return;
            if (d.type === 'ychat:embed-h') {
                if (typeof d.h === 'number' && d.h > 0) {
                    parentEmbedH = d.h;
                } else {
                    parentEmbedH = null;
                }
                applyKbH();
                return;
            }
            if (d.type === 'ychat:blur-input') {
                // 親から「入力欄 blur して kb を閉じてほしい」要求. widget-tap で fit モードに移る時に使う.
                try {
                    const ae = document.activeElement;
                    if (ae && typeof ae.blur === 'function') ae.blur();
                } catch (_) {}
                return;
            }
        });
    }

    if (vv) {
        // rAF throttle は付けない: iOS keyboard アニメは 60fps で resize 発火、同期更新で 1:1 追従.
        vv.addEventListener('resize', applyKbH);
        if (embedded) vv.addEventListener('scroll', applyKbH);
    }
    window.addEventListener('orientationchange', () => setTimeout(() => {
        isClosing = false;
        applyKbH();
    }, 200));
    if (embedded) window.addEventListener('resize', applyKbH);

    const inputSelector = '#chat-input, .nickname-input, #cdr-code, textarea, input[type=text], input[type=email], input[type=password], input[type=tel], input[type=search], input[type=url], input[type=number]';
    document.addEventListener('focusin', (e) => {
        if (e.target && e.target.matches && e.target.matches(inputSelector)) {
            isClosing = false;
            if (closingTimer) { clearTimeout(closingTimer); closingTimer = null; }
            // iOS auto-scroll 巻き戻し (念のため — chat-root は top+bottom 固定なので本来不要だが).
            if (window.scrollY !== 0 || window.scrollX !== 0) {
                window.scrollTo(0, 0);
            }
        }
    }, true);
    document.addEventListener('focusout', (e) => {
        if (!e.target || !e.target.matches || !e.target.matches(inputSelector)) return;
        // input→input 遷移は relatedTarget で判定 (rAF は使わない = 即 snap).
        const next = e.relatedTarget;
        if (next && next.matches && next.matches(inputSelector)) return;
        snapClose();
    }, true);

    // iOS の auto-scroll を根本から抑止: touch/mousedown で default の focus を
    // 止めて、preventScroll:true で手動 focus する.
    // これでブラウザが scrollIntoView を起こさないため「下から上」のアニメ自体が出ない.
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) {
        const manualFocus = (e) => {
            const t = e.target;
            if (!t || !t.matches || !t.matches(inputSelector)) return;
            if (document.activeElement === t) return; // 既に focus 済みなら何もしない
            e.preventDefault();
            try { t.focus({ preventScroll: true }); } catch (_) { t.focus(); }
        };
        document.addEventListener('touchend', manualFocus, true);
        document.addEventListener('mousedown', manualFocus, true);
    }

    // keyboard 開いてる間の iOS auto-scroll 巻き戻し.
    window.addEventListener('scroll', () => {
        if (!keyboardOpen) return;
        if (window.scrollY !== 0 || window.scrollX !== 0) {
            window.scrollTo(0, 0);
        }
    }, { passive: true });
})();

// ===== 起動 =====
init();

})();
