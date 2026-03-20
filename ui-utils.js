// ==========================================================================
// ui-utils.js — toast、モーダル制御、DOM操作、多言語、SEO
// ==========================================================================

const TITLE_SUFFIX_MAP = {
    'men': 'Deli YobuHo',
    'women': 'JoFu YobuHo',
    'women_same': 'Same YobuHo',
    'men_same': 'Same YobuHo'
};
const MODE_DESC_MAP = {
    'men': 'デリヘル（デリバリーヘルス・出張ヘルス）を呼べるホテルを全国43,000件以上から検索。ユーザー口コミと店舗情報のダブルチェックで信頼できるホテル情報。',
    'women': '女性用風俗（女風）・出張マッサージ・セラピストを呼べるホテルを全国43,000件以上から検索。口コミと店舗情報で安心のホテル選び。',
    'men_same': '男性同士（ゲイカップル）で利用できるホテルを全国43,000件以上から検索。LGBTフレンドリーなホテル情報を口コミでチェック。',
    'women_same': '女性同士（レズビアンカップル）で利用できるホテルを全国43,000件以上から検索。LGBTフレンドリーなホテル情報を口コミでチェック。'
};
function getSiteSuffix() {
    const mode = window.MODE || new URLSearchParams(window.location.search).get('mode') || 'men';
    return TITLE_SUFFIX_MAP[mode] || 'YobuHo';
}
function updatePageTitle(prefix) {
    document.title = prefix + ' | ' + getSiteSuffix();
    // Update meta description based on mode
    const mode = window.MODE || new URLSearchParams(window.location.search).get('mode') || 'men';
    const descMeta = document.querySelector('meta[name="description"]');
    if (descMeta && MODE_DESC_MAP[mode]) descMeta.content = MODE_DESC_MAP[mode];
    // Update OG tags
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogTitle) ogTitle.content = document.title;
    if (ogDesc && MODE_DESC_MAP[mode]) ogDesc.content = MODE_DESC_MAP[mode];
    // Update JSON-LD
    const ldScript = document.querySelector('script[type="application/ld+json"]');
    if (ldScript) {
        try {
            const ld = JSON.parse(ldScript.textContent);
            ld.name = document.title;
            ld.description = descMeta?.content || '';
            ldScript.textContent = JSON.stringify(ld);
        } catch(e) {}
    }
}

const state = { lang: localStorage.getItem('yobuho_lang') || 'ja' };
const LANG = {
    ja: {
        select_area: '地域を選択', japan: '日本全国', back: '前へ',
        search_placeholder: 'ホテル名・住所・キーワードで検索...',
        station_placeholder: '最寄駅で検索...',
        list_placeholder: '市区町村まで選択するとホテルが表示されます',
        results: '件のホテル', no_results: 'ホテルが見つかりませんでした',
        min_charge: '最安料金', nearest: '最寄駅', no_data: 'データがありません',
        show_all: 'このエリア全体を見る',
        current_location: '現在地',
        locating: '位置情報を取得中...', location_error: '位置情報を取得できませんでした',
        nearby: '現在地から近い順',
        can_call: '呼べた', cannot_call: '呼べなかった',
        no_reports: '投稿なし',
        view_detail: '詳細を見る',
        submit: '投稿する', cancel: 'キャンセル', confirm: '決定する',
        loading: '読み込み中...',
        filter_all: 'すべて', filter_business: 'ビジネス', filter_city: 'シティ',
        filter_resort: 'リゾート', filter_ryokan: '旅館', filter_loveho: 'ラブホ',
        terms: '利用規約', privacy: 'プライバシーポリシー', contact: 'お問い合わせ',
        top_page: 'トップページ', shop_register: '店舗登録',
        select_reason: '理由を選んでください',
        post_success: '投稿ありがとうございます', post_error: '送信エラー',
    },
    en: {
        select_area: 'Select Area', japan: 'All Japan', back: 'Back',
        search_placeholder: 'Hotel name, address, keyword...',
        station_placeholder: 'Search by station',
        list_placeholder: 'Select a city to view hotels',
        results: 'hotels', no_results: 'No hotels found',
        min_charge: 'From', nearest: 'Station', no_data: 'No data', show_all: 'View all',
        current_location: 'Location',
        locating: 'Getting location...', location_error: 'Could not get location',
        nearby: 'Near you',
        can_call: 'Available', cannot_call: 'Unavailable',
        no_reports: 'No reviews',
        view_detail: 'View Details',
        submit: 'Submit', cancel: 'Cancel', confirm: 'Confirm',
        loading: 'Loading...',
        filter_all: 'All', filter_business: 'Business', filter_city: 'City',
        filter_resort: 'Resort', filter_ryokan: 'Ryokan', filter_loveho: 'Love Hotel',
        terms: 'Terms', privacy: 'Privacy Policy', contact: 'Contact',
        top_page: 'Top Page', shop_register: 'Shop Registration',
        select_reason: 'Select a reason',
        post_success: 'Thank you for your review', post_error: 'Submission error',
    },
    zh: {
        select_area: '选择地区', japan: '全日本', back: '返回',
        search_placeholder: '酒店名·地址·关键词搜索...',
        station_placeholder: '按车站搜索',
        list_placeholder: '请选择城市查看酒店',
        results: '家酒店', no_results: '未找到酒店',
        min_charge: '最低价', nearest: '最近车站', no_data: '没有数据', show_all: '查看全部',
        current_location: '当前位置',
        locating: '获取位置中...', location_error: '无法获取位置',
        nearby: '离您最近',
        can_call: '可以叫', cannot_call: '不能叫',
        no_reports: '暂无评价',
        view_detail: '查看详情',
        submit: '提交', cancel: '取消', confirm: '确定',
        loading: '加载中...',
        filter_all: '全部', filter_business: '商务', filter_city: '城市',
        filter_resort: '度假', filter_ryokan: '旅馆', filter_loveho: '情侣酒店',
        terms: '使用条款', privacy: '隐私政策', contact: '联系我们',
        top_page: '首页', shop_register: '店铺注册',
        select_reason: '请选择原因',
        post_success: '感谢您的评价', post_error: '提交错误',
    },
    ko: {
        select_area: '지역 선택', japan: '일본 전국', back: '뒤로',
        search_placeholder: '호텔명·주소·키워드 검색...',
        station_placeholder: '역명으로 검색',
        list_placeholder: '도시를 선택하면 호텔이 표시됩니다',
        results: '개 호텔', no_results: '호텔을 찾을 수 없습니다',
        min_charge: '최저가', nearest: '역', no_data: '데이터 없음', show_all: '전체 보기',
        current_location: '현재 위치',
        locating: '위치 가져오는 중...', location_error: '위치를 가져올 수 없습니다',
        nearby: '가까운 순',
        can_call: '가능', cannot_call: '불가능',
        no_reports: '리뷰 없음',
        view_detail: '상세 보기',
        submit: '제출', cancel: '취소', confirm: '확인',
        loading: '로딩 중...',
        filter_all: '전체', filter_business: '비즈니스', filter_city: '시티',
        filter_resort: '리조트', filter_ryokan: '료칸', filter_loveho: '러브호텔',
        terms: '이용약관', privacy: '개인정보처리방침', contact: '문의',
        top_page: '홈', shop_register: '매장 등록',
        select_reason: '이유를 선택하세요',
        post_success: '리뷰를 남겨주셔서 감사합니다', post_error: '제출 오류',
    },
};
function t(key) { return (LANG[state.lang] || LANG.ja)[key] || key; }

function changeLang(lang) {
    state.lang = lang;
    localStorage.setItem('yobuho_lang', lang);
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-action="changeLang"][data-param="${lang}"]`)?.classList.add('active');
    updateUILanguage();
    if (currentPage) currentPage();
}

function updateUILanguage() {
    // エリアタイトル（デフォルトテキストの場合のみ更新）
    const areaTitle = document.getElementById('area-title');
    if (areaTitle) {
        const defaultTitles = ['地域を選択', 'Select Area', '选择地区', '지역 선택'];
        if (defaultTitles.includes(areaTitle.textContent)) {
            areaTitle.textContent = t('select_area');
        }
    }

    // 検索プレースホルダー
    const searchInput = document.querySelector('.search-input-lux');
    if (searchInput) searchInput.placeholder = t('search_placeholder');
    const stationInput = document.querySelector('.station-input');
    if (stationInput) stationInput.placeholder = t('station_placeholder');

    // 現在地ボタン
    const locLabel = document.querySelector('.btn-location-label');
    if (locLabel) locLabel.textContent = t('current_location');

    // 戻るボタン
    const backText = document.querySelector('.back-text');
    if (backText) backText.textContent = t('back');

    // フィルタチップ（data-filter-key属性を使って翻訳）
    document.querySelectorAll('.filter-chip[data-filter-key]').forEach(chip => {
        chip.textContent = t(chip.dataset.filterKey);
    });

    // フッターリンク
    document.querySelectorAll('.footer-link').forEach(link => {
        const href = link.getAttribute('href') || '';
        if (href.includes('terms')) link.textContent = t('terms');
        else if (href.includes('privacy')) link.textContent = t('privacy');
        else if (href.includes('contact')) link.textContent = t('contact');
        else if (href.includes('index.html')) link.textContent = t('top_page');
        else if (href.includes('shop-register')) link.textContent = t('shop_register');
    });
}

function setTitle(text) {
    const el = document.getElementById('area-title');
    if (el) el.textContent = text;
}

function setBackBtn(show) {
    const el = document.getElementById('btn-area-back');
    if (el) el.style.display = show ? 'flex' : 'none';
}

function setBreadcrumb(crumbs) {
    const html = crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return `
            ${i > 0 ? '<span class="breadcrumb-sep">›</span>' : ''}
            <span class="breadcrumb-item ${isLast ? 'active' : ''}"
                  ${!isLast && c.onclick ? `style="cursor:pointer" onclick="${c.onclick}"` : ''}>
                ${esc(c.label)}
            </span>`;
    }).join('');
    const el = document.getElementById('breadcrumb');
    if (el) el.innerHTML = html;
}

function clearHotelList() {
    const el = document.getElementById('hotel-list');
    if (el) el.innerHTML = '';
    const s = document.getElementById('result-status');
    if (s) s.style.display = 'none';
    const links = document.getElementById('bottom-info-links');
    if (links) links.style.display = 'none';
    hideLovehoTabs();
    if (typeof hideFilterBar === 'function') hideFilterBar();
    if (typeof hideMap === 'function') hideMap();
}

function showToast(msg, duration = 2500) {
    let el = document.getElementById('toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translateX(-50%) translateY(calc(-50% - 12px));background:#1a1410;color:#fff;padding:12px 24px;border-radius:30px;font-size:13px;opacity:0;transition:all 0.3s;z-index:9999;white-space:nowrap;pointer-events:none;';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(-50%)';
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(calc(-50% - 12px))';
    }, duration);
}

function showSuccessModal(title, message) {
    document.getElementById('success-modal-title').textContent = title;
    document.getElementById('success-modal-message').textContent = message || '';
    document.getElementById('success-modal').style.display = 'flex';
}
function closeSuccessModal() {
    document.getElementById('success-modal').style.display = 'none';
}

// モーダル背景クリックで閉じる
document.addEventListener('click', function(e) {
    if (!e.target.classList.contains('modal-overlay') && !e.target.classList.contains('modal-overlay-success')) return;
    const map = {
        'can-reasons-modal': 'cancelCanReasons',
        'cannot-reasons-modal': 'cancelCannotReasons',
        'post-confirm-modal': 'closePostConfirmModal',
        'flag-modal': 'closeFlagModal',
        'hotel-request-modal': 'closeHotelRequestModal',
        'success-modal': 'closeSuccessModal',
    };
    const fn = map[e.target.id];
    if (fn && typeof window[fn] === 'function') window[fn]();
    else e.target.style.display = 'none';
});

function showLoading(msg) {
    const el = document.getElementById('loading-overlay');
    if (el) {
        el.style.display = 'flex';
        const txt = el.querySelector('.loading-text');
        if (txt) txt.textContent = msg || t('loading');
    }
}

function hideLoading() {
    const el = document.getElementById('loading-overlay');
    if (el) el.style.display = 'none';
}

function showSkeletonLoader() {
    const container = document.getElementById('hotel-list');
    if (!container) return;
    container.innerHTML = Array(5).fill(0).map(() =>
        '<div class="skeleton skeleton-card"></div>'
    ).join('');
}

function buildAreaButtons(items, onAllClick, onItemClick, hasChildren = true) {
    const container = document.getElementById('area-button-container');
    container.innerHTML = '';
    container.className = 'area-grid col-2';

    items.forEach((item, i) => {
        const btn = document.createElement('button');
        btn.className = `area-btn ${hasChildren ? 'has-children' : ''}`;
        btn.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
        btn.textContent = item;
        btn.onclick = () => onItemClick(item);
        container.appendChild(btn);
    });

    if (onAllClick) {
        const allBtn = document.createElement('button');
        allBtn.className = 'area-btn all-btn';
        allBtn.style.cssText = 'grid-column:1/-1; margin-top:8px;';
        allBtn.textContent = `▶ ${t('show_all')}`;
        allBtn.onclick = onAllClick;
        container.appendChild(allBtn);
    }
}

function extractCity(address) {
    if (!address) return null;

    const PREFS = [
        '北海道',
        '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
        '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
        '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県',
        '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
        '鳥取県', '島根県', '岡山県', '広島県', '山口県',
        '徳島県', '香川県', '愛媛県', '高知県',
        '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
    ];

    let after = address;
    for (const pref of PREFS) {
        if (address.startsWith(pref)) {
            after = address.slice(pref.length).trimStart();
            break;
        }
    }
    if (!after) return null;

    const base = after.replace(/^[\u4E00-\u9FFF\u3040-\u30FF]{1,5}郡/, '');
    let m;

    m = base.match(/^((?:(?!区)[\u4E00-\u9FFF\u3040-\u30FF]){1,10}?市)/);
    if (m) return m[1];

    m = base.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}?区)/);
    if (m) return m[1];

    m = after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,5}郡[\u4E00-\u9FFF\u3040-\u30FF]{1,5}[町村])/);
    if (m) return m[1];

    m = after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}郡)/);
    if (m) return m[1];

    m = after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}[町村])/);
    if (m) return m[1];

    return null;
}

function hotelRankBadge(_score) {
    return '';
}

function freshnessLabel(isoDate) {
    if (!isoDate) return '';
    const diff = Math.floor((Date.now() - new Date(isoDate)) / 86400000);
    if      (diff === 0)  return '<span class="freshness fresh">本日更新</span>';
    else if (diff <= 7)   return `<span class="freshness recent">${diff}日前に更新</span>`;
    else if (diff <= 30)  return `<span class="freshness normal">${diff}日前に更新</span>`;
    else                  return `<span class="freshness old">${diff}日前に更新</span>`;
}

function calcDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function formatTransportFee(val) {
    if (val === null || val === undefined || val === '') return null;
    if (val === 0 || val === '0') return '無料';
    const num = parseInt(String(val).replace(/,/g, ''), 10);
    if (isNaN(num)) return null;
    return '¥' + num.toLocaleString('ja-JP') + '-';
}

function buildDonutSVG(greenCount, redCount, size = 60, showPct = false) {
    const r = 22, sw = 8;
    const cx = size / 2, cy = size / 2;
    const C = 2 * Math.PI * r;
    const total = greenCount + redCount;
    if (total === 0) return '';
    const gLen = (greenCount / total) * C;
    const rLen = (redCount / total) * C;
    const off = (C * 0.25).toFixed(2);
    const offR = (C * 0.25 - gLen).toFixed(2);
    const pct = Math.round((greenCount / total) * 100);
    const pctColor = greenCount >= redCount ? '#3a9a60' : '#c05050';
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block;flex-shrink:0;">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(0,0,0,0.07)" stroke-width="${sw}"/>
      ${gLen > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#3a9a60" stroke-width="${sw}" stroke-dasharray="${gLen.toFixed(2)} ${(C - gLen).toFixed(2)}" stroke-dashoffset="${off}"/>` : ''}
      ${rLen > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#c05050" stroke-width="${sw}" stroke-dasharray="${rLen.toFixed(2)} ${(C - rLen).toFixed(2)}" stroke-dashoffset="${offR}"/>` : ''}
      ${showPct ? `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" style="font-size:11px;font-weight:700;fill:${pctColor};">${pct}%</text>` : ''}
    </svg>`;
}

function getReportCount(h) {
    const s = h.summary;
    if (!s) return 0;
    if (s.total_reports != null) return s.total_reports;
    return (s.can_call_count||0) + (s.cannot_call_count||0) + (s.shop_can_count||0) + (s.shop_ng_count||0);
}

const HOTEL_TYPE_ORDER = { business: 0, city: 1, resort: 2, ryokan: 3, pension: 4, minshuku: 5, other: 6 };
function sortHotelsByReviews(hotels) {
    hotels.sort((a, b) => {
        const ca = getReportCount(a), cb = getReportCount(b);
        if (ca !== cb) return cb - ca;
        const da = a.latestReportAt || '', db = b.latestReportAt || '';
        if (da !== db) return da < db ? 1 : -1;
        const ta = HOTEL_TYPE_ORDER[a.hotel_type] ?? 6, tb = HOTEL_TYPE_ORDER[b.hotel_type] ?? 6;
        if (ta !== tb) return ta - tb;
        return (a.name || '').localeCompare(b.name || '', 'ja');
    });
    return hotels;
}

function applyKeywordFilter(query, rawKeyword) {
    if (!rawKeyword) return query;
    const words = rawKeyword.trim().split(/[\s　]+/).filter(w => w.length > 0);
    for (const word of words) {
        query = query.or(`name.ilike.%${word}%,address.ilike.%${word}%`);
    }
    return query;
}
