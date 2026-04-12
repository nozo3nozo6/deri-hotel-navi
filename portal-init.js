// ==========================================================================
// portal-init.js — ポータル初期化、イベント委譲、インラインscript外部化
// ==========================================================================

// ── 店舗専用URL: 法的ページSPA読み込み ──
var _legalSavedHTML = null;
var _legalSavedScroll = 0;
function loadLegalPageInline(url, title) {
    var main = document.getElementById('main-content') || document.querySelector('.portal-main');
    if (!main) { window.location.href = url; return; }
    // 現在の表示を保存
    _legalSavedHTML = main.innerHTML;
    _legalSavedScroll = window.scrollY;
    // フェッチして .content 部分を抽出
    fetch(url).then(function(r) { return r.text(); }).then(function(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var content = doc.querySelector('.content') || doc.querySelector('main') || doc.body;
        var backBtn = '<div style="padding:12px 16px 0;"><button onclick="closeLegalPage()" style="background:none;border:1px solid var(--border,#ddd);border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px;color:var(--accent,#7b6fa0);font-family:inherit;">← 戻る</button></div>';
        main.innerHTML = backBtn + '<div style="max-width:720px;margin:0 auto;padding:16px 20px 40px;">' + content.innerHTML + '</div>';
        window.scrollTo(0, 0);
    }).catch(function() { window.location.href = url; });
}
function closeLegalPage() {
    var main = document.getElementById('main-content') || document.querySelector('.portal-main');
    if (main && _legalSavedHTML !== null) {
        main.innerHTML = _legalSavedHTML;
        _legalSavedHTML = null;
        window.scrollTo(0, _legalSavedScroll);
    }
}

// ── モード別フォント遅延読込（Astroモードではビルド時に<link>出力済みのためスキップ） ──
(function(){
    if (window.__ASTRO_MODE) return;
    // パスベースURL対応: /deli/, /jofu/, /same-m/, /same-f/, /este/
    var pathMap = { 'deli': 'men', 'jofu': 'women', 'same-m': 'men_same', 'same-f': 'women_same', 'este': 'este' };
    var seg = location.pathname.split('/').filter(Boolean)[0] || '';
    var m = pathMap[seg] || new URLSearchParams(location.search).get('mode') || 'men';
    if (m === 'women' || m === 'women_same') {
        var l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@300;400;500&display=swap';
        document.head.appendChild(l);
    }
})();

// ── モード初期化（旧インラインscript） ──
document.addEventListener('DOMContentLoaded', function() {
    var urlParams = new URLSearchParams(window.location.search);
    // Astro SSGページではwindow.__ASTRO_MODEがビルド時に埋め込まれる
    var astroMode = window.__ASTRO_MODE || null;
    // パスベースURL対応
    var pathModeMap = { 'deli': 'men', 'jofu': 'women', 'same-m': 'men_same', 'same-f': 'women_same', 'este': 'este' };
    var firstSeg = location.pathname.split('/').filter(Boolean)[0] || '';
    var pathMode = pathModeMap[firstSeg] || null;
    // モード未指定の場合、/men/ にリダイレクト
    if (!urlParams.get('mode') && !astroMode && !pathMode) {
        location.replace('/deli/');
        return;
    }
    window.MODE = pathMode || urlParams.get('mode') || astroMode || 'men';
    var MODE = window.MODE;
    document.body.setAttribute('data-mode', MODE);

    // Astroモードではロゴ・バッジはビルド時に出力済み
    if (!astroMode) {
        // モードドロップダウンのアイコン設定
        var modeBadgeIcons = { men: '♂', women: '♀', este: '💆', men_same: '♂♂', women_same: '♀♀' };
        var badgeIconEl = document.getElementById('mode-badge-icon');
        if (badgeIconEl) badgeIconEl.textContent = modeBadgeIcons[MODE] || '♂';
        // active状態設定
        document.querySelectorAll('.mode-menu-item[data-mode]').forEach(function(item) {
            if (item.dataset.mode === MODE) item.classList.add('active');
            else item.classList.remove('active');
        });

        var logoMap = {
            'men': '<span style="font-style:italic; color:#666; font-weight:300; font-size:0.85em; letter-spacing:2px;">Deli</span> <b style="color:#c0392b; font-size:1.2em; letter-spacing:1px;">YobuHo</b> <span style="color:#c0392b; font-size:0.9em;">♂</span>',
            'women': 'JoFu <b>YobuHo</b>',
            'women_same': '<b>YobuHo</b>',
            'men_same': '<b>YobuHo</b>'
        };
        document.getElementById('header-logo-text').innerHTML = logoMap[MODE] || '<b>YobuHo</b>';
        document.getElementById('mode-title-bar').style.display = 'none';
    }

    var titleMap = {
        'men': 'デリヘルを呼べるホテル検索 | Deli YobuHo',
        'women': '女性用風俗を呼べるホテル検索 | JoFu YobuHo',
        'women_same': '女性同士で利用できるホテル検索 | YobuHo',
        'men_same': '男性同士で利用できるホテル検索 | YobuHo'
    };
    if (!astroMode) {
        document.title = titleMap[MODE] || 'YobuHo - 呼べるホテル検索';
    }

    // Astroモードではmeta/OGはビルド時に確定済み、portal.html用のみ動的更新
    if (!astroMode) {
        var pageDesc = document.getElementById('page-desc');
        var ogTitle = document.getElementById('og-title');
        var ogDesc = document.getElementById('og-desc');
        if (pageDesc && ogTitle && ogDesc) {
            if (MODE === 'men' || MODE === 'men_same') {
                pageDesc.setAttribute('content',
                    'デリヘルをホテルに呼べるか地域から検索。全国のラブホテル・シティホテル・ビジネスホテルのデリヘル入室情報を確認。直通・カードキー・フロント相談など入り方の実績もわかります。');
                ogTitle.setAttribute('content', titleMap[MODE]);
                ogDesc.setAttribute('content',
                    'デリヘルをホテルに呼べるか地域から検索。直通・カードキー・フロント相談など入り方の実績もわかります。');
            } else {
                pageDesc.setAttribute('content',
                    '女性用風俗・女風をホテルに呼べるか地域から検索。全国のラブホテル・シティホテル・ビジネスホテルへの出張女風俗の入室情報・呼べた実績を確認できます。');
                ogTitle.setAttribute('content', titleMap[MODE]);
                ogDesc.setAttribute('content',
                    '女性用風俗・女風をホテルに呼べるか地域から検索。出張女風俗の入室情報・呼べた実績を確認。');
            }
        }
    }

    // canonical動的設定（パスベースURL）
    var modePathMap = { men: 'deli', women: 'jofu', men_same: 'same-m', women_same: 'same-f', este: 'este' };
    var canonicalPath = '/' + (modePathMap[MODE] || 'deli');
    var shopSlugParam = urlParams.get('shop');
    var parsed = typeof parseUrlPath === 'function' ? parseUrlPath() : {};
    if (parsed.hotel) {
        // ホテル詳細クリーンURL: /deli/hotel/29599
        canonicalPath += '/hotel/' + parsed.hotel;
    } else if (shopSlugParam) {
        // 店舗専用URL: /deli/shop/slug/
        canonicalPath += '/shop/' + encodeURIComponent(shopSlugParam);
    } else {
        if (parsed.pref) canonicalPath += '/' + encodeURIComponent(parsed.pref);
        if (parsed.city) canonicalPath += '/' + encodeURIComponent(parsed.city);
    }
    var canonicalUrl = 'https://yobuho.com' + canonicalPath;
    document.querySelector('link[rel="canonical"]').setAttribute('href', canonicalUrl);
    var ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute('content', canonicalUrl);

    // 店舗専用URL時: 店舗登録リンク非表示のみ（ゲートボタンはgetGateUrl()で/deli/等へ）
    if (urlParams.get('shop') || _shopParam) {
        var shopLink = document.getElementById('shop-register-link');
        if (shopLink) shopLink.style.display = 'none';
        // フッターの法的ページリンクをSPA化（ヘッダー維持、コンテンツ差し替え）
        ['/terms/', '/privacy/', '/contact/'].forEach(function(path) {
            document.querySelectorAll('footer a[href="' + path + '"]').forEach(function(a) {
                a.addEventListener('click', function(e) {
                    e.preventDefault();
                    loadLegalPageInline(path, a.textContent.trim());
                });
            });
        });
    }
    if (MODE) {
        document.querySelectorAll('a[href*="shop-register"]').forEach(function(a) {
            a.href = '/shop-register/?genre=' + MODE;
        });
    }

    // プレースホルダーをスクリーン幅に合わせて調整
    var kwInput = document.getElementById('keyword');
    if (kwInput) {
        kwInput.placeholder = window.innerWidth < 480
            ? 'ホテル名・住所で検索'
            : 'ホテル名・住所で検索（Enterで実行）';
    }
});

// ── イベント委譲（onclick属性の代替） ──
document.addEventListener('click', function(e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;
    var action = target.dataset.action;
    var param = target.dataset.param;

    // 関数名→引数付き呼び出し
    switch (action) {
        case 'goToGate':
            location.href = getGateUrl();
            break;
        case 'goToNationalTop':
            if (typeof goToNationalTop === 'function') goToNationalTop();
            break;
        case 'changeLang':
            if (typeof changeLang === 'function') changeLang(param);
            break;
        case 'selectFlagReason':
            if (typeof selectFlagReason === 'function') selectFlagReason(param, target);
            break;
        case 'openHotelRequestModal':
            e.preventDefault();
            if (typeof openHotelRequestModal === 'function') openHotelRequestModal();
            break;
        case 'openCorrectionModal':
            e.preventDefault();
            if (typeof openCorrectionModal === 'function') openCorrectionModal(target.dataset.hotelId, target.dataset.hotelName);
            break;
        case 'selectCorrectionCategory':
            if (typeof selectCorrectionCategory === 'function') selectCorrectionCategory(param, target);
            break;
        default:
            // 引数なし関数の汎用呼び出し
            if (typeof window[action] === 'function') window[action]();
            break;
    }
});

// ── input イベント委譲（oninput属性の代替） ──
document.addEventListener('input', function(e) {
    var action = e.target.dataset.oninput;
    if (action && typeof window[action] === 'function') window[action]();
});

