// ==========================================================================
// DERI HOTEL NAVI — app.js v69
// ==========================================================================

// ==========================================================================
// TODO: モジュール分割計画（INP改善のため）
// 現在3200+行の単一ファイル。以下の分割を検討：
//   - hotel-search.js: ホテル検索・フィルタリング・ソート
//   - form-handler.js: 投稿フォーム・バリデーション
//   - api-service.js: Supabase API連携
//   - ui-utils.js: toast・モーダル・DOM操作ユーティリティ
//   - area-navigation.js: エリア選択・ページ遷移
// 分割時はES Modules (import/export) またはビルドツール (Vite等) を使用
// ==========================================================================

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const GATE_URL_MAP = {
    'men': 'https://deli.yobuho.com/',
    'women': 'https://jofu.yobuho.com/',
    'men_same': 'https://same.yobuho.com/',
    'women_same': 'https://same.yobuho.com/',
};
function getGateUrl() {
    const mode = new URLSearchParams(window.location.search).get('mode') || 'men';
    return GATE_URL_MAP[mode] || 'https://yobuho.com/';
}

const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const REGION_MAP = [
    { label: '北海道', prefs: ['北海道'] },
    { label: '東北',   prefs: ['青森県','岩手県','宮城県','秋田県','山形県','福島県'] },
    { label: '関東',   prefs: ['茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県'] },
    { label: '北陸',   prefs: ['富山県','石川県','福井県'] },
    { label: '甲信越', prefs: ['新潟県','山梨県','長野県'] },
    { label: '東海',   prefs: ['岐阜県','静岡県','愛知県','三重県'] },
    { label: '関西',   prefs: ['滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県'] },
    { label: '中国',   prefs: ['鳥取県','島根県','岡山県','広島県','山口県'] },
    { label: '四国',   prefs: ['徳島県','香川県','愛媛県','高知県'] },
    { label: '九州',   prefs: ['福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県'] },
    { label: '沖縄',   prefs: ['沖縄県'] },
];

let pageStack = [];
let currentPage = null;  // 現在のページ描画関数を保持（言語切替時の再描画用）

// ==========================================================================
// SEO: 動的タイトル
// ==========================================================================
const TITLE_SUFFIX_MAP = {
    'men': 'Deli YobuHo',
    'women': 'JoFu YobuHo',
    'women_same': 'YobuHo',
    'men_same': 'YobuHo'
};
function getSiteSuffix() {
    const mode = new URLSearchParams(window.location.search).get('mode') || 'men';
    return TITLE_SUFFIX_MAP[mode] || 'YobuHo';
}
function updatePageTitle(prefix) {
    document.title = prefix + ' | ' + getSiteSuffix();
    const ldScript = document.querySelector('script[type="application/ld+json"]');
    if (ldScript) {
        try {
            const ld = JSON.parse(ldScript.textContent);
            ld.name = document.title;
            ld.description = document.querySelector('meta[name="description"]')?.content || '';
            ldScript.textContent = JSON.stringify(ld);
        } catch(e) {}
    }
}

// ==========================================================================
// 店舗専用表示モード
// ==========================================================================
const SHOP_ID = new URLSearchParams(window.location.search).get('shop') || null;
let SHOP_DATA = null;

async function initShopMode() {
    if (!SHOP_ID) return;
    const { data: shop } = await supabaseClient.from('shops').select('shop_name,gender_mode,shop_url,plan_id,status,contract_plans(price)').eq('id', SHOP_ID).eq('status', 'active').maybeSingle();
    if (!shop) return;
    SHOP_DATA = shop;
}

// ==========================================================================
// URL状態管理
// ==========================================================================
let _skipPushState = false;

function findRegionByPref(pref) {
    return REGION_MAP.find(r => r.prefs.includes(pref));
}

function findRegionByLabel(label) {
    return REGION_MAP.find(r => r.label === label);
}

function updateUrl(params) {
    if (_skipPushState) return;
    const cur = new URLSearchParams(window.location.search);
    const newParams = new URLSearchParams();
    newParams.set('mode', cur.get('mode') || 'men');
    if (SHOP_ID) newParams.set('shop', SHOP_ID);
    Object.entries(params).forEach(([k, v]) => {
        if (v != null) newParams.set(k, v);
    });
    const newUrl = '?' + newParams.toString();
    console.log('[updateUrl] pushState:', newUrl);
    history.pushState(null, '', newUrl);
}

function ensurePortalMode() {
    const content = document.getElementById('hotel-detail-content');
    if (content && content.style.display !== 'none') {
        closeHotelPanel();
    }
    // search-toolsを常に表示
    const st = document.querySelector('.search-tools');
    if (st) st.style.display = '';
}

async function restoreFromUrl() {
    const searchTools = document.querySelector('.search-tools');
    if (searchTools) searchTools.style.display = '';
    const params = new URLSearchParams(window.location.search);
    console.log('[restoreFromUrl] URL params:', Object.fromEntries(params));
    _skipPushState = true;

    if (params.get('hotel')) {
        const hotelId = parseInt(params.get('hotel'));
        const { data: h } = await supabaseClient.from('hotels').select('hotel_type').eq('id', hotelId).maybeSingle();
        const isLoveho = h && ['love_hotel', 'rental_room'].includes(h.hotel_type);
        showHotelPanel(hotelId, isLoveho);
        _skipPushState = false;
        return;
    }

    ensurePortalMode();

    if (params.get('city')) {
        const pref = params.get('pref');
        const area = params.get('area');
        const detail = params.get('detail');
        const city = params.get('city');
        const region = findRegionByPref(pref);
        pageStack = [showJapanPage];
        if (region) pageStack.push(() => showPrefPage(region));
        if (pref && area) pageStack.push(() => showMajorAreaPage(region, pref));
        if (area) pageStack.push(() => showCityPage(region, pref, area));
        if (detail) pageStack.push(() => showDetailAreaPage(region, pref, area, detail));
        const filterObj = { prefecture: pref };
        if (area) filterObj.major_area = area;
        if (detail) filterObj.detail_area = detail;
        setBackBtn(true);
        fetchAndShowHotelsByCity(filterObj, city);
    } else if (params.get('detail')) {
        const pref = params.get('pref');
        const area = params.get('area');
        const detail = params.get('detail');
        const region = findRegionByPref(pref);
        pageStack = [showJapanPage];
        if (region) pageStack.push(() => showPrefPage(region));
        if (pref && area) pageStack.push(() => showMajorAreaPage(region, pref));
        if (area) pageStack.push(() => showCityPage(region, pref, area));
        showDetailAreaPage(region, pref, area, detail);
    } else if (params.get('area')) {
        const pref = params.get('pref');
        const area = params.get('area');
        const region = findRegionByPref(pref);
        pageStack = [showJapanPage];
        if (region) pageStack.push(() => showPrefPage(region));
        if (pref) pageStack.push(() => showMajorAreaPage(region, pref));
        showCityPage(region, pref, area);
    } else if (params.get('pref')) {
        const pref = params.get('pref');
        const region = findRegionByPref(pref);
        pageStack = [showJapanPage];
        if (region) pageStack.push(() => showPrefPage(region));
        showMajorAreaPage(region, pref);
    } else if (params.get('region')) {
        const region = findRegionByLabel(params.get('region'));
        if (region) {
            pageStack = [showJapanPage];
            showPrefPage(region);
        } else {
            showJapanPage();
        }
    } else {
        showJapanPage();
    }

    _skipPushState = false;
}

window.addEventListener('popstate', () => {
    const content = document.getElementById('hotel-detail-content');
    if (content && content.style.display !== 'none') return;
    restoreFromUrl();
});

// ==========================================================================
// 多言語
// ==========================================================================
const state = { lang: localStorage.getItem('yobuho_lang') || 'ja' };
const LANG = {
    ja: {
        select_area: '地域を選択', japan: '日本全国', back: '前へ',
        search_placeholder: 'ホテル名で検索...',
        list_placeholder: '市区町村まで選択するとホテルが表示されます',
        results: '件のホテル', no_results: 'ホテルが見つかりませんでした',
        min_charge: '最安料金', nearest: '最寄駅', no_data: 'データがありません',
        show_all: 'このエリア全体を見る',
        locating: '位置情報を取得中...', location_error: '位置情報を取得できませんでした',
        nearby: '現在地から近い順',
    },
    en: {
        select_area: 'Select Area', japan: 'All Japan', back: 'Back',
        search_placeholder: 'Search hotel...', list_placeholder: 'Select a city to view hotels',
        results: 'hotels', no_results: 'No hotels found',
        min_charge: 'From', nearest: 'Station', no_data: 'No data', show_all: 'View all',
        locating: 'Getting location...', location_error: 'Could not get location',
        nearby: 'Near you',
    },
    zh: {
        select_area: '选择地区', japan: '全日本', back: '返回',
        search_placeholder: '搜索酒店...', list_placeholder: '请选择城市查看酒店',
        results: '家酒店', no_results: '没有找到酒店',
        min_charge: '最低价', nearest: '最近车站', no_data: '没有数据', show_all: '查看全部',
        locating: '获取位置中...', location_error: '无法获取位置',
        nearby: '离您最近',
    },
    ko: {
        select_area: '지역 선택', japan: '일본 전국', back: '이전',
        search_placeholder: '호텔 검색...', list_placeholder: '도시를 선택하면 호텔이 표시됩니다',
        results: '개 호텔', no_results: '호텔을 찾을 수 없습니다',
        min_charge: '최저가', nearest: '역', no_data: '데이터 없음', show_all: '전체 보기',
        locating: '위치 가져오는 중...', location_error: '위치를 가져올 수 없습니다',
        nearby: '가까운 순',
    },
};
function t(key) { return (LANG[state.lang] || LANG.ja)[key] || key; }

function changeLang(lang) {
    state.lang = lang;
    localStorage.setItem('yobuho_lang', lang);
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[onclick="changeLang('${lang}')"]`)?.classList.add('active');
    // TODO: 実際の多言語対応は将来実装
    if (lang !== 'ja') {
        showToast('多言語対応は準備中です', 2000);
    }
    // 現在のページを再描画
    if (currentPage) currentPage();
}

// ==========================================================================
// UI ヘルパー
// ==========================================================================
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
                ${c.label}
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

// ==========================================================================
// 広告表示
// ==========================================================================
async function loadAds(placementType, placementTarget) {
    const container = document.getElementById('ad-container');
    if (!container) return;
    container.innerHTML = '';
    try {
        const currentMode = new URLSearchParams(window.location.search).get('mode') || 'men';
        const { data, error } = await supabaseClient.from('ad_placements')
            .select('*, shops(shop_name, shop_url), ad_plans(name)')
            .eq('placement_type', placementType)
            .eq('placement_target', placementTarget)
            .eq('status', 'active')
            .or('mode.eq.' + currentMode + ',mode.eq.all,mode.is.null');
        console.log('[loadAds]', placementType, placementTarget, 'results:', data?.length, error?.message);
        if (!data || !data.length) return;
        container.innerHTML = data.map(ad => {
            const shopName = ad.shops?.shop_name || '掲載店舗';
            const url = ad.shops?.shop_url;
            const nameHTML = url
                ? `<a href="${esc(url)}" target="_blank" rel="noopener" style="color:#b5627a; font-size:13px; text-decoration:none; margin-left:4px;">${esc(shopName)} 🔗</a>`
                : `<span style="font-size:13px; color:var(--text); margin-left:4px;">${esc(shopName)}</span>`;
            return `<div style="background:#faf7f4; border:1px solid #e8ddd5; border-radius:6px; padding:10px 14px; margin:16px 0; font-size:12px;">
                <span style="color:#999; font-size:10px;">📢 このエリアの掲載店舗</span>
                <div style="margin-top:4px;">
                    <span style="background:#b5627a; color:#fff; font-size:9px; padding:1px 5px; border-radius:2px;">認定店</span>
                    ${nameHTML}
                </div>
            </div>`;
        }).join('');
    } catch (e) { console.error('[loadAds] error:', e); }
}

async function fetchDetailAds(placementType, placementTarget) {
    try {
        const currentMode = new URLSearchParams(window.location.search).get('mode') || 'men';
        const { data } = await supabaseClient.from('ad_placements')
            .select('*, shops(shop_name, shop_url), ad_plans(name)')
            .eq('placement_type', placementType)
            .eq('placement_target', placementTarget)
            .eq('status', 'active')
            .or('mode.eq.' + currentMode + ',mode.eq.all,mode.is.null');
        if (!data || !data.length) return '';
        return data.map(ad => {
            const shopName = ad.shops?.shop_name || '掲載店舗';
            const url = ad.shops?.shop_url;
            const nameHTML = url
                ? `<a href="${esc(url)}" target="_blank" rel="noopener" style="color:#b5627a; font-size:13px; text-decoration:none; margin-left:4px;">${esc(shopName)} 🔗</a>`
                : `<span style="font-size:13px; color:var(--text); margin-left:4px;">${esc(shopName)}</span>`;
            return `<div style="background:#faf7f4; border:1px solid #e8ddd5; border-radius:6px; padding:10px 14px; margin:16px 0; font-size:12px;">
                <span style="color:#999; font-size:10px;">📢 このエリアの掲載店舗</span>
                <div style="margin-top:4px;">
                    <span style="background:#b5627a; color:#fff; font-size:9px; padding:1px 5px; border-radius:2px;">認定店</span>
                    ${nameHTML}
                </div>
            </div>`;
        }).join('');
    } catch (e) { console.error('[fetchDetailAds] error:', e); return ''; }
}

function clearAds() {
    const container = document.getElementById('ad-container');
    if (container) container.innerHTML = '';
}

function showLoading(msg) {
    const el = document.getElementById('loading-overlay');
    if (el) {
        el.style.display = 'flex';
        const txt = el.querySelector('.loading-text');
        if (txt) txt.textContent = msg || '検索中...';
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

// NOTE: extractCity() は「新宿区市谷」のようなケースでも正しく動作する。
//   「区」が出現する前に「市」で終わるパターンのみ市として抽出するため、
//   「新宿区」→ 区マッチで正しく「新宿区」を返す（市谷の「市」は誤マッチしない）。
function extractCity(address) {
    if (!address) return null;

    // ① 全47都道府県を完全名称リストで先頭から除去
    //    startsWith で完全一致するため、正規表現の誤マッチは発生しない
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

    // ② 市区町村を抽出
    //    正規表現リテラルを使用（new RegExp + \\u の解釈ずれを回避）
    //    文字クラス: 漢字(\u4E00-\u9FFF) + ひらがな(\u3040-\u309F) + カタカナ(\u30A0-\u30FF)

    // 「〜市」最優先。「〜郡〜市」の場合は郡を除き市名のみ返す
    const base = after.replace(/^[\u4E00-\u9FFF\u3040-\u30FF]{1,5}郡/, '');
    let m;

    // 「区」が出現する前に「市」で終わる場合のみ市として抽出
    // （例: 新宿区市谷→「区」で止まり市マッチしない / 京都市伏見区→「京都市」を抽出）
    m = base.match(/^((?:(?!区)[\u4E00-\u9FFF\u3040-\u30FF]){1,10}?市)/);
    if (m) return m[1];

    // 「〜区」（特別区・政令市の区）
    m = base.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}?区)/);
    if (m) return m[1];

    // 「〜郡〜町」「〜郡〜村」
    m = after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,5}郡[\u4E00-\u9FFF\u3040-\u30FF]{1,5}[町村])/);
    if (m) return m[1];

    // 「〜郡」単体
    m = after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}郡)/);
    if (m) return m[1];

    // 「〜町」「〜村」（市・区がない場合のみ到達）
    m = after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}[町村])/);
    if (m) return m[1];

    return null;
}

// ==========================================================================
// 投稿集計を一括取得（ホテルIDリストから）
// ==========================================================================
async function fetchReportSummaries(hotelIds) {
    if (!hotelIds.length) return {};
    console.log('[fetchReportSummaries] hotelIds count:', hotelIds.length);
    try {
        // まずサマリービューを試行
        const { data, error } = await supabaseClient
            .from('hotel_report_summary')
            .select('*')
            .in('hotel_id', hotelIds);
        console.log('[fetchReportSummaries] view result:', error ? 'ERROR: '+error.message : (data ? data.length+' rows' : 'null'));
        if (!error && data && data.length > 0) {
            const map = {};
            data.forEach(r => { map[r.hotel_id] = r; });
            return map;
        }
    } catch(e) { console.log('[fetchReportSummaries] view exception:', e); }
    // フォールバック: reportsテーブルから直接集計
    console.log('[fetchReportSummaries] falling back to reports table');
    try {
        const { data: reports, error: repErr } = await supabaseClient
            .from('reports')
            .select('hotel_id,can_call,poster_type')
            .in('hotel_id', hotelIds);
        console.log('[fetchReportSummaries] reports result:', repErr ? 'ERROR: '+repErr.message : (reports ? reports.length+' rows' : 'null'));
        if (!reports) return {};
        const map = {};
        reports.forEach(r => {
            if (!map[r.hotel_id]) map[r.hotel_id] = { hotel_id: r.hotel_id, can_call_count: 0, cannot_call_count: 0, shop_can_count: 0, shop_ng_count: 0 };
            const s = map[r.hotel_id];
            if (r.poster_type === 'shop') { r.can_call ? s.shop_can_count++ : s.shop_ng_count++; }
            else { r.can_call ? s.can_call_count++ : s.cannot_call_count++; }
        });
        return map;
    } catch(e) { console.log('[fetchReportSummaries] reports exception:', e); return {}; }
}

// ==========================================================================
// ページ描画
// ==========================================================================
function showJapanPage() {
    if(document.activeElement)document.activeElement.blur();
    pageStack = [];
    currentPage = showJapanPage;
    updateUrl({});
    setTitle(t('select_area'));
    updatePageTitle('全国のホテル検索');
    setBackBtn(false);
    setBreadcrumb([{ label: t('japan') }]);
    clearHotelList();
    loadAds('premium', '全国');

    const container = document.getElementById('area-button-container');
    container.innerHTML = '';
    container.className = 'area-grid region-level';

    REGION_MAP.forEach((region, i) => {
        const btn = document.createElement('button');
        btn.className = 'area-btn has-children';
        btn.style.animationDelay = `${i * 0.04}s`;
        btn.textContent = region.label;
        btn.onclick = () => { pageStack.push(showJapanPage); showPrefPage(region); };
        container.appendChild(btn);
    });
    // リンクバー追加
    const hlcJp = document.getElementById('hotel-list');
    if (hlcJp && !hlcJp.querySelector('.info-links-bar')) {
        hlcJp.insertAdjacentHTML('beforeend', `
            <div class="info-links-bar" style="display:flex;justify-content:center;gap:16px;padding:14px 20px;margin-top:12px;background:#fff;border:1px solid #e0d5d0;border-radius:8px;">
                <a href="#" onclick="openHotelRequestModal();return false;" style="color:#8b5e6b;text-decoration:none;padding:6px 16px;border:1px solid #d4b8c1;border-radius:20px;background:#fdf6f8;font-size:12px;white-space:nowrap;">📝 未掲載ホテル情報提供</a>
                ${SHOP_ID ? '' : '<a href="/shop-register.html" style="color:#8b5e6b;text-decoration:none;padding:6px 16px;border:1px solid #d4b8c1;border-radius:20px;background:#fdf6f8;font-size:12px;white-space:nowrap;">🏪 店舗様・掲載用はこちら</a>'}
            </div>
        `);
    }
}

async function showPrefPage(region) {
    if(document.activeElement)document.activeElement.blur();
    currentPage = () => showPrefPage(region);
    updateUrl({ region: region.label });
    setTitle(region.label);
    updatePageTitle(region.label + 'のホテル検索');
    setBackBtn(true);
    setBreadcrumb([
        { label: t('japan'), onclick: 'showJapanPage()' },
        { label: region.label }
    ]);
    clearHotelList();
    clearAds();

    const container = document.getElementById('area-button-container');
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);font-size:13px;">読み込み中...</div>`;
    container.className = 'area-grid col-2';

    // 都道府県ごとのホテル数を並行取得（全件）して多い順にソート
    const prefCountResults = await Promise.all(
        region.prefs.map(pref =>
            supabaseClient.from('hotels').select('id', { count: 'exact', head: true }).eq('prefecture', pref).eq('is_published', true).not('hotel_type','in','("love_hotel","rental_room")')
                .then(({ count }) => ({ pref, count: count || 0 }))
        )
    );
    const sorted = prefCountResults.filter(r => r.count > 0).sort((a, b) => b.count - a.count).map(r => r.pref);

    container.innerHTML = '';
    sorted.forEach((pref, i) => {
        const btn = document.createElement('button');
        btn.className = 'area-btn has-children';
        btn.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
        btn.textContent = pref;
        btn.onclick = () => {
            pageStack.push(() => showPrefPage(region));
            showMajorAreaPage(region, pref);
        };
        container.appendChild(btn);
    });
    // リンクバー追加
    const hlcPref = document.getElementById('hotel-list');
    if (hlcPref && !hlcPref.querySelector('.info-links-bar')) {
        hlcPref.insertAdjacentHTML('beforeend', `
            <div class="info-links-bar" style="display:flex;justify-content:center;gap:16px;padding:14px 20px;margin-top:12px;background:#fff;border:1px solid #e0d5d0;border-radius:8px;">
                <a href="#" onclick="openHotelRequestModal();return false;" style="color:#8b5e6b;text-decoration:none;padding:6px 16px;border:1px solid #d4b8c1;border-radius:20px;background:#fdf6f8;font-size:12px;white-space:nowrap;">📝 未掲載ホテル情報提供</a>
                ${SHOP_ID ? '' : '<a href="/shop-register.html" style="color:#8b5e6b;text-decoration:none;padding:6px 16px;border:1px solid #d4b8c1;border-radius:20px;background:#fdf6f8;font-size:12px;white-space:nowrap;">🏪 店舗様・掲載用はこちら</a>'}
            </div>
        `);
    }
}

async function showMajorAreaPage(region, pref) {
    if(document.activeElement)document.activeElement.blur();
    currentPage = () => showMajorAreaPage(region, pref);
    updateUrl({ pref });
    setTitle(pref);
    updatePageTitle(pref + 'のホテル検索');
    setBackBtn(true);
    setBreadcrumb([
        { label: t('japan'), onclick: 'showJapanPage()' },
        { label: region.label, onclick: `showPrefPage(REGION_MAP.find(r=>r.label==='${region.label}'))` },
        { label: pref }
    ]);
    clearHotelList();
    loadAds('big', pref);

    const container = document.getElementById('area-button-container');
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);font-size:13px;">読み込み中...</div>`;
    container.className = 'area-grid col-2';

    // まずエリア一覧を取得（全件）
    const query_ma = supabaseClient.from('hotels').select('id,major_area,city,address').eq('prefecture', pref).eq('is_published', true).not('hotel_type','in','("love_hotel","rental_room")').limit(5000);
    const { data, error } = await query_ma;
    if (error) { container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#c47a88;">エラー</div>`; return; }

    // エリアごとのホテル数を集計して多い順
    const areaCount = {};
    let noAreaCount = 0;
    data.forEach(h => {
        if (h.major_area) areaCount[h.major_area] = (areaCount[h.major_area] || 0) + 1;
        else noAreaCount++;
    });
    const areas = Object.keys(areaCount).sort((a, b) => areaCount[b] - areaCount[a]);
    if (!areas.length && !noAreaCount) { container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);">${t('no_data')}</div>`; return; }

    buildAreaButtons(
        areas,
        () => { pageStack.push(() => showMajorAreaPage(region, pref)); fetchAndShowHotels({ prefecture: pref }); },
        (area) => { pageStack.push(() => showMajorAreaPage(region, pref)); showCityPage(region, pref, area); }
    );

    // major_area未設定のホテルはcity別にボタン表示
    if (noAreaCount > 0) {
        const noAreaHotels = data.filter(h => !h.major_area);
        const noAreaCityCount = {};
        noAreaHotels.forEach(h => {
            const city = h.city || extractCity(h.address);
            if (city) noAreaCityCount[city] = (noAreaCityCount[city] || 0) + 1;
        });
        const noAreaCities = Object.entries(noAreaCityCount).sort((a, b) => b[1] - a[1]);
        // ラブホ件数も取得
        const noAreaCityNames = noAreaCities.map(c => c[0]);
        const noAreaLovehoCount = {};
        if (noAreaCityNames.length > 0) {
            const { data: lhRows } = await supabaseClient.from('hotels').select('city').eq('prefecture', pref).in('hotel_type', ['love_hotel', 'rental_room']).eq('is_published', true).in('city', noAreaCityNames);
            (lhRows || []).forEach(h => { if (h.city) noAreaLovehoCount[h.city] = (noAreaLovehoCount[h.city] || 0) + 1; });
        }
        const allBtn = container.querySelector('.all-btn');
        noAreaCities.forEach(([city, count]) => {
            const btn = document.createElement('button');
            btn.className = 'area-btn';
            btn.innerHTML = `
                <span class="city-name">${esc(city)}</span>
                <span style="display:flex;gap:4px;align-items:center;flex-shrink:0;">
                    ${count > 0 ? `<span class="city-count">🏨${count}</span>` : ''}
                    ${(noAreaLovehoCount[city]||0) > 0 ? `<span class="city-count" style="background:rgba(201,169,110,0.12);border-color:rgba(201,169,110,0.3);color:#c9a96e;">🏩${noAreaLovehoCount[city]||0}</span>` : ''}
                </span>`;
            btn.onclick = () => { pageStack.push(() => showMajorAreaPage(region, pref)); fetchAndShowHotelsByCity({ prefecture: pref }, city); };
            if (allBtn) container.insertBefore(btn, allBtn);
            else container.appendChild(btn);
        });
    }
    // リンクバー追加
    const hlc = document.getElementById('hotel-list');
    if (hlc && !hlc.querySelector('.info-links-bar')) {
        hlc.insertAdjacentHTML('beforeend', `
            <div class="info-links-bar" style="display:flex;justify-content:center;gap:16px;padding:14px 20px;margin-top:12px;background:#fff;border:1px solid #e0d5d0;border-radius:8px;">
                <a href="#" onclick="openHotelRequestModal();return false;" style="color:#8b5e6b;text-decoration:none;padding:6px 16px;border:1px solid #d4b8c1;border-radius:20px;background:#fdf6f8;font-size:12px;white-space:nowrap;">📝 未掲載ホテル情報提供</a>
                ${SHOP_ID ? '' : '<a href="/shop-register.html" style="color:#8b5e6b;text-decoration:none;padding:6px 16px;border:1px solid #d4b8c1;border-radius:20px;background:#fdf6f8;font-size:12px;white-space:nowrap;">🏪 店舗様・掲載用はこちら</a>'}
            </div>
        `);
    }
}

async function showCityPage(region, pref, majorArea) {
    if(document.activeElement)document.activeElement.blur();
    currentPage = () => showCityPage(region, pref, majorArea);
    updateUrl({ pref, area: majorArea });
    setTitle(majorArea);
    updatePageTitle(majorArea + 'のホテル検索');
    setBackBtn(true);
    setBreadcrumb([
        { label: t('japan'), onclick: 'showJapanPage()' },
        { label: region.label, onclick: `showPrefPage(REGION_MAP.find(r=>r.label==='${region.label}'))` },
        { label: pref, onclick: `showMajorAreaPage(REGION_MAP.find(r=>r.label==='${region.label}'), '${pref}')` },
        { label: majorArea }
    ]);
    clearHotelList();
    loadAds('area', majorArea);

    const container = document.getElementById('area-button-container');
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);font-size:13px;">読み込み中...</div>`;
    container.className = 'area-grid col-2';

    // major_area内の全ホテル取得（ページネーション対応）
    let data = [];
    let cpFrom = 0;
    const CP_PAGE = 1000;
    while (true) {
        const { data: chunk, error: chunkErr } = await supabaseClient.from('hotels').select('id,address,city,detail_area').eq('prefecture', pref).eq('major_area', majorArea).eq('is_published', true).not('hotel_type','in','("love_hotel","rental_room")').range(cpFrom, cpFrom + CP_PAGE - 1);
        if (chunkErr) { container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#c47a88;">エラー</div>`; return; }
        if (!chunk || !chunk.length) break;
        data = data.concat(chunk);
        if (chunk.length < CP_PAGE) break;
        cpFrom += CP_PAGE;
    }

    // detail_area がある場合は detailClass 階層を先に表示
    // ただし detail_area == major_area の場合はサブ分類として無意味なので除外
    const detailAreaCount = {};
    data.forEach(h => { if (h.detail_area && h.detail_area !== majorArea) detailAreaCount[h.detail_area] = (detailAreaCount[h.detail_area] || 0) + 1; });
    const hasDetailArea = Object.keys(detailAreaCount).length > 0;

    if (hasDetailArea) {
        // detail_area ボタンを件数順に表示
        const detailAreas = Object.keys(detailAreaCount).sort((a, b) => detailAreaCount[b] - detailAreaCount[a]);
        container.innerHTML = '';
        detailAreas.forEach((area, i) => {
            const btn = document.createElement('button');
            btn.className = 'area-btn';
            btn.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
            btn.innerHTML = `<span class="city-name">${esc(area)}</span><span class="city-count">${detailAreaCount[area]}</span>`;
            btn.onclick = () => { pageStack.push(() => showCityPage(region, pref, majorArea)); showDetailAreaPage(region, pref, majorArea, area); };
            container.appendChild(btn);
        });
        const allBtn = document.createElement('button');
        allBtn.className = 'area-btn all-btn';
        allBtn.style.cssText = 'grid-column:1/-1; margin-top:8px;';
        allBtn.textContent = `▶ ${t('show_all')}`;
        allBtn.onclick = () => { pageStack.push(() => showCityPage(region, pref, majorArea)); fetchAndShowHotels({ prefecture: pref, major_area: majorArea }); };
        container.appendChild(allBtn);
        // リンクバー追加（detail_areaパス）
        const hlcDA = document.getElementById('hotel-list');
        if (hlcDA && !hlcDA.querySelector('.info-links-bar')) {
            hlcDA.insertAdjacentHTML('beforeend', `
                <div class="info-links-bar" style="display:flex;justify-content:center;gap:16px;padding:14px 20px;margin-top:12px;background:#fff;border:1px solid #e0d5d0;border-radius:8px;">
                    <a href="#" onclick="openHotelRequestModal();return false;" style="color:#8b5e6b;text-decoration:none;padding:6px 16px;border:1px solid #d4b8c1;border-radius:20px;background:#fdf6f8;font-size:12px;white-space:nowrap;">📝 未掲載ホテル情報提供</a>
                    ${SHOP_ID ? '' : '<a href="/shop-register.html" style="color:#8b5e6b;text-decoration:none;padding:6px 16px;border:1px solid #d4b8c1;border-radius:20px;background:#fdf6f8;font-size:12px;white-space:nowrap;">🏪 店舗様・掲載用はこちら</a>'}
                </div>
            `);
        }
        return;
    }

    // detail_area なし → 市区町村を抽出
    const citySetLocal = new Set();
    data.forEach(h => {
        const city = h.city || extractCity(h.address);
        if (city) citySetLocal.add(city);
    });
    const candidateCities = [...citySetLocal];

    // 全エリアでのcity別・major_area別ホテル数を取得
    const cityCount = {};
    const cityAreaCount = {}; // city -> { major_area -> count }
    let countRows = [];
    let countFrom = 0;
    const COUNT_PAGE = 1000;
    while (true) {
        const { data: chunk } = await supabaseClient.from('hotels').select('city,major_area').eq('prefecture', pref).eq('major_area', majorArea).in('city', candidateCities).eq('is_published', true).not('hotel_type','in','("love_hotel","rental_room")').range(countFrom, countFrom + COUNT_PAGE - 1);
        if (!chunk || !chunk.length) break;
        countRows = countRows.concat(chunk);
        if (chunk.length < COUNT_PAGE) break;
        countFrom += COUNT_PAGE;
    }
    countRows.forEach(h => {
        if (!h.city) return;
        cityCount[h.city] = (cityCount[h.city] || 0) + 1;
        if (h.major_area) {
            if (!cityAreaCount[h.city]) cityAreaCount[h.city] = {};
            cityAreaCount[h.city][h.major_area] = (cityAreaCount[h.city][h.major_area] || 0) + 1;
        }
    });

    const lovehoCount = {};
    const { data: lovehoRows } = await supabaseClient.from('hotels')
        .select('city')
        .eq('prefecture', pref)
        .in('hotel_type', ['love_hotel', 'rental_room'])
        .eq('is_published', true)
        .in('city', candidateCities);
    (lovehoRows || []).forEach(h => {
        if (h.city) lovehoCount[h.city] = (lovehoCount[h.city] || 0) + 1;
    });

    // 現在のmajor_areaが最多（同数含む）のcityのみ表示
    const displayCities = candidateCities.filter(city => {
        const ac = cityAreaCount[city];
        if (!ac) return true;
        const maxCount = Math.max(...Object.values(ac));
        const currentCount = ac[majorArea] || 0;
        return currentCount >= maxCount;
    });

    const cities = displayCities.sort((a, b) => (cityCount[b] || 0) - (cityCount[a] || 0));

    if (!cities.length || (cities.length === 1 && cities[0] === majorArea)) {
        fetchAndShowHotels({ prefecture: pref, major_area: majorArea });
        return;
    }

    container.innerHTML = '';

    cities.forEach((city, i) => {
        const btn = document.createElement('button');
        btn.className = 'area-btn';
        btn.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
        btn.innerHTML = `
            <span class="city-name">${esc(city)}</span>
            <span style="display:flex;gap:4px;align-items:center;flex-shrink:0;">
                ${(cityCount[city]||0) > 0 ? `<span class="city-count">🏨${cityCount[city]||0}</span>` : ''}
                ${(lovehoCount[city]||0) > 0 ? `<span class="city-count" style="background:rgba(201,169,110,0.12);border-color:rgba(201,169,110,0.3);color:#c9a96e;">🏩${lovehoCount[city]||0}</span>` : ''}
            </span>`;
        btn.onclick = () => { pageStack.push(() => showCityPage(region, pref, majorArea)); fetchAndShowHotelsByCity({ prefecture: pref, major_area: majorArea }, city); };
        container.appendChild(btn);
    });

    const allBtn = document.createElement('button');
    allBtn.className = 'area-btn all-btn';
    allBtn.style.cssText = 'grid-column:1/-1; margin-top:8px;';
    allBtn.textContent = `▶ ${t('show_all')}`;
    allBtn.onclick = () => { pageStack.push(() => showCityPage(region, pref, majorArea)); fetchAndShowHotels({ prefecture: pref, major_area: majorArea }); };
    container.appendChild(allBtn);
    // リンクバー追加（cityパス）
    const hlcCity = document.getElementById('hotel-list');
    if (hlcCity && !hlcCity.querySelector('.info-links-bar')) {
        hlcCity.insertAdjacentHTML('beforeend', `
            <div class="info-links-bar" style="display:flex;justify-content:center;gap:16px;padding:14px 20px;margin-top:12px;background:#fff;border:1px solid #e0d5d0;border-radius:8px;">
                <a href="#" onclick="openHotelRequestModal();return false;" style="color:#8b5e6b;text-decoration:none;padding:6px 16px;border:1px solid #d4b8c1;border-radius:20px;background:#fdf6f8;font-size:12px;white-space:nowrap;">📝 未掲載ホテル情報提供</a>
                ${SHOP_ID ? '' : '<a href="/shop-register.html" style="color:#8b5e6b;text-decoration:none;padding:6px 16px;border:1px solid #d4b8c1;border-radius:20px;background:#fdf6f8;font-size:12px;white-space:nowrap;">🏪 店舗様・掲載用はこちら</a>'}
            </div>
        `);
    }
}

// ==========================================================================
// detail_area ページ（detailClass階層: smallClass → detailClass → city）
// ==========================================================================
async function showDetailAreaPage(region, pref, majorArea, detailArea) {
    if(document.activeElement)document.activeElement.blur();
    currentPage = () => showDetailAreaPage(region, pref, majorArea, detailArea);
    updateUrl({ pref, area: majorArea, detail: detailArea });
    setTitle(detailArea);
    updatePageTitle(detailArea + 'のホテル検索');
    setBackBtn(true);
    setBreadcrumb([
        { label: t('japan'), onclick: 'showJapanPage()' },
        { label: region.label, onclick: `showPrefPage(REGION_MAP.find(r=>r.label==='${region.label}'))` },
        { label: pref, onclick: `showMajorAreaPage(REGION_MAP.find(r=>r.label==='${region.label}'), '${pref}')` },
        { label: majorArea, onclick: `showCityPage(REGION_MAP.find(r=>r.label==='${region.label}'), '${pref}', '${majorArea}')` },
        { label: detailArea }
    ]);
    clearHotelList();
    loadAds('town', detailArea);

    const container = document.getElementById('area-button-container');
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);font-size:13px;">読み込み中...</div>`;
    container.className = 'area-grid col-2';

    // detail_area内のcity一覧取得（ページネーション対応）
    let data = [];
    let daFrom = 0;
    const DA_PAGE = 1000;
    while (true) {
        const { data: chunk, error: chunkErr } = await supabaseClient.from('hotels').select('id,address,city').eq('prefecture', pref).eq('major_area', majorArea).eq('detail_area', detailArea).eq('is_published', true).not('hotel_type','in','("love_hotel","rental_room")').range(daFrom, daFrom + DA_PAGE - 1);
        if (chunkErr) { container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#c47a88;">エラー</div>`; return; }
        if (!chunk || !chunk.length) break;
        data = data.concat(chunk);
        if (chunk.length < DA_PAGE) break;
        daFrom += DA_PAGE;
    }
    const error = null;

    if (error) { container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#c47a88;">エラー</div>`; return; }

    // このdetail_area内の市区町村を抽出（ラブホも含む）
    const citySet = new Set();
    data.forEach(h => {
        const city = h.city || extractCity(h.address);
        if (city) citySet.add(city);
    });
    const candidateCitiesDA = [...citySet];

    // 各cityの全ホテル数を取得（detail_areaに関係なくprefecture+cityで集計）
    const cityCount = {};
    if (candidateCitiesDA.length > 0) {
        let allCityRows = [];
        let cFrom = 0;
        const C_PAGE = 1000;
        while (true) {
            const { data: chunk } = await supabaseClient.from('hotels').select('city').eq('prefecture', pref).eq('major_area', majorArea).eq('detail_area', detailArea).in('city', candidateCitiesDA).eq('is_published', true).not('hotel_type','in','("love_hotel","rental_room")').range(cFrom, cFrom + C_PAGE - 1);
            if (!chunk || !chunk.length) break;
            allCityRows = allCityRows.concat(chunk);
            if (chunk.length < C_PAGE) break;
            cFrom += C_PAGE;
        }
        allCityRows.forEach(h => {
            if (h.city) cityCount[h.city] = (cityCount[h.city] || 0) + 1;
        });
    }

    const lovehoCount = {};
    const lovehoResult = await supabaseClient.from('hotels')
        .select('city')
        .eq('prefecture', pref)
        .in('hotel_type', ['love_hotel', 'rental_room'])
        .eq('is_published', true)
        .in('city', candidateCitiesDA);
    (lovehoResult.data || []).forEach(h => {
        if (h.city) lovehoCount[h.city] = (lovehoCount[h.city] || 0) + 1;
    });

    const cities = candidateCitiesDA.sort((a, b) => (cityCount[b] || 0) - (cityCount[a] || 0));

    if (!cities.length) {
        fetchAndShowHotels({ prefecture: pref, major_area: majorArea, detail_area: detailArea });
        return;
    }

    container.innerHTML = '';

    cities.forEach((city, i) => {
        const btn = document.createElement('button');
        btn.className = 'area-btn';
        btn.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
        btn.innerHTML = `
            <span class="city-name">${esc(city)}</span>
            <span style="display:flex;gap:4px;align-items:center;flex-shrink:0;">
                ${(cityCount[city]||0) > 0 ? `<span class="city-count">🏨${cityCount[city]||0}</span>` : ''}
                ${(lovehoCount[city]||0) > 0 ? `<span class="city-count" style="background:rgba(201,169,110,0.12);border-color:rgba(201,169,110,0.3);color:#c9a96e;">🏩${lovehoCount[city]||0}</span>` : ''}
            </span>`;
        btn.onclick = () => {
            pageStack.push(() => showDetailAreaPage(region, pref, majorArea, detailArea));
            fetchAndShowHotelsByCity({ prefecture: pref, major_area: majorArea, detail_area: detailArea }, city);
        };
        container.appendChild(btn);
    });

    const allBtn = document.createElement('button');
    allBtn.className = 'area-btn all-btn';
    allBtn.style.cssText = 'grid-column:1/-1; margin-top:8px;';
    allBtn.textContent = `▶ ${t('show_all')}`;
    allBtn.onclick = () => {
        pageStack.push(() => showDetailAreaPage(region, pref, majorArea, detailArea));
        fetchAndShowHotels({ prefecture: pref, major_area: majorArea, detail_area: detailArea });
    };
    container.appendChild(allBtn);
    // リンクバー追加
    const hlc2 = document.getElementById('hotel-list');
    if (hlc2 && !hlc2.querySelector('.info-links-bar')) {
        hlc2.insertAdjacentHTML('beforeend', `
            <div class="info-links-bar" style="display:flex;justify-content:center;gap:16px;padding:14px 20px;margin-top:12px;background:#fff;border:1px solid #e0d5d0;border-radius:8px;">
                <a href="#" onclick="openHotelRequestModal();return false;" style="color:#8b5e6b;text-decoration:none;padding:6px 16px;border:1px solid #d4b8c1;border-radius:20px;background:#fdf6f8;font-size:12px;white-space:nowrap;">📝 未掲載ホテル情報提供</a>
                ${SHOP_ID ? '' : '<a href="/shop-register.html" style="color:#8b5e6b;text-decoration:none;padding:6px 16px;border:1px solid #d4b8c1;border-radius:20px;background:#fdf6f8;font-size:12px;white-space:nowrap;">🏪 店舗様・掲載用はこちら</a>'}
            </div>
        `);
    }
}

// ==========================================================================
// 戻るボタン
// ==========================================================================
function backLevel() {
    history.back();
}

// ==========================================================================
// ホテル取得（共通）
// ==========================================================================
async function fetchHotelsWithSummary(query) {
    const { data: hotels, error } = await query;
    if (error) throw error;
    if (!hotels || !hotels.length) return [];

    // 投稿集計を一括取得
    const hotelIds = hotels.map(h => h.id);
    const summaries = await fetchReportSummaries(hotelIds);

    // 最新投稿日時を一括取得
    const latestMap = await fetchLatestReportDates(hotelIds);

    // ホテルデータに集計を合体
    console.log('[fetchHotelsWithSummary] summaries:', JSON.stringify(summaries));
    return hotels.map(h => ({ ...h, summary: summaries[h.id] || null, latestReportAt: latestMap[h.id] || null }));
}

async function fetchLatestReportDates(hotelIds) {
    if (!hotelIds.length) return {};
    try {
        const { data } = await supabaseClient.from('reports').select('hotel_id,created_at').in('hotel_id', hotelIds).order('created_at', { ascending: false });
        const map = {};
        (data || []).forEach(r => { if (!map[r.hotel_id]) map[r.hotel_id] = r.created_at; });
        return map;
    } catch { return {}; }
}

function getReportCount(h) {
    const s = h.summary;
    if (!s) return 0;
    if (s.total_reports != null) return s.total_reports;
    return (s.can_call_count||0) + (s.cannot_call_count||0) + (s.shop_can_count||0) + (s.shop_ng_count||0);
}

function sortHotelsByReviews(hotels) {
    hotels.sort((a, b) => {
        const ca = getReportCount(a), cb = getReportCount(b);
        if (ca !== cb) return cb - ca;
        const da = a.latestReportAt || '', db = b.latestReportAt || '';
        if (da !== db) return da < db ? 1 : -1;
        return (a.name || '').localeCompare(b.name || '', 'ja');
    });
    return hotels;
}

async function fetchAndShowHotels(filterObj) {
    currentPage = () => fetchAndShowHotels(filterObj);
    showLoading();
    showSkeletonLoader();
    document.getElementById('area-button-container').innerHTML = '';
    hideLovehoTabs();

    try {
        const keyword = document.getElementById('keyword')?.value?.trim() || '';
        let query = supabaseClient.from('hotels').select('*').eq('is_published', true).not('hotel_type','in','("love_hotel","rental_room")').limit(1000);
        Object.keys(filterObj).forEach(k => { query = query.eq(k, filterObj[k]); });
        query = applyKeywordFilter(query, keyword);
        query = query.order('review_average', { ascending: false, nullsFirst: false });

        let hotels = await fetchHotelsWithSummary(query);
        sortHotelsByReviews(hotels);
        renderHotelCards(hotels);
        setResultStatus(hotels.length);
    } catch (e) {
        console.error(e);
    } finally {
        hideLoading();
    }
}

function goToHotelCity(regionLabel, pref, majorArea, city) {
    const region = REGION_MAP.find(r => r.label === regionLabel);
    pageStack.push(() => showCityPage(region, pref, majorArea));
    fetchAndShowHotelsByCity({ prefecture: pref, major_area: majorArea }, city);
}

async function fetchAndShowHotelsByCity(filterObj, city) {
    const _urlP = {};
    if (filterObj.prefecture) _urlP.pref = filterObj.prefecture;
    if (filterObj.major_area) _urlP.area = filterObj.major_area;
    if (filterObj.detail_area) _urlP.detail = filterObj.detail_area;
    _urlP.city = city;
    updateUrl(_urlP);
    showLoading();
    showSkeletonLoader();
    document.getElementById('area-button-container').innerHTML = '';
    setTitle(city);
    updatePageTitle(city + 'の呼べるホテル一覧');

    // パンくず全階層を再構築（全レベルをクリック可能に）
    const pref = filterObj.prefecture;
    const majorArea = filterObj.major_area;
    const detailArea = filterObj.detail_area;
    const region = REGION_MAP.find(r => r.prefs.includes(pref));
    const regionLabel = region ? region.label : '';
    const crumbs = [{ label: t('japan'), onclick: 'showJapanPage()' }];
    if (regionLabel) crumbs.push({ label: regionLabel, onclick: `showPrefPage(REGION_MAP.find(r=>r.label==='${regionLabel}'))` });
    if (pref) crumbs.push({ label: pref, onclick: `showMajorAreaPage(REGION_MAP.find(r=>r.label==='${regionLabel}'), '${pref}')` });
    if (majorArea) crumbs.push({ label: majorArea, onclick: `showCityPage(REGION_MAP.find(r=>r.label==='${regionLabel}'), '${pref}', '${majorArea}')` });
    if (detailArea) crumbs.push({ label: detailArea, onclick: `showDetailAreaPage(REGION_MAP.find(r=>r.label==='${regionLabel}'), '${pref}', '${majorArea}', '${detailArea}')` });
    crumbs.push({ label: city });
    setBreadcrumb(crumbs);
    loadAds('spot', city);
    setBackBtn(true);

    try {
        // love_hotel除外で取得
        let query = supabaseClient.from('hotels').select('*').eq('is_published', true).not('hotel_type','in','("love_hotel","rental_room")').limit(1000);
        Object.keys(filterObj).forEach(k => { query = query.eq(k, filterObj[k]); });
        query = query.eq('city', city);
        query = query.order('review_average', { ascending: false, nullsFirst: false });

        let hotels = await fetchHotelsWithSummary(query);
        sortHotelsByReviews(hotels);
        renderHotelCards(hotels);
        setResultStatus(hotels.length);

        // タブ用にフィルタ情報を保存
        _tabFilterObj = filterObj;
        _tabCity = city;

        // ラブホタブ表示
        showLovehoTabs(pref, city, hotels.length, hotels);
    } catch (e) {
        console.error(e);
    } finally {
        hideLoading();
    }
}

// ==========================================================================
// ラブホタブ（ページ内切替）
// ==========================================================================
let currentTab = 'hotel';
let cachedHotelData = null;
let cachedLovehoData = null;
let _tabCityKey = null; // pref+city でキャッシュ管理
let _tabFilterObj = null;
let _tabCity = null;

async function showLovehoTabs(pref, city, hotelCount, hotels) {
    hideLovehoTabs();
    if (!pref || !city) return;

    // キャッシュリセット（city変更時）
    const cacheKey = pref + '|||' + city;
    if (_tabCityKey !== cacheKey) {
        cachedHotelData = null;
        cachedLovehoData = null;
        _tabCityKey = cacheKey;
    }
    cachedHotelData = hotels;

    // ラブホ件数を取得
    const { count: lovehoCount } = await supabaseClient.from('hotels')
        .select('*', { count: 'exact', head: true })
        .eq('prefecture', pref)
        .eq('city', city)
        .in('hotel_type', ['love_hotel', 'rental_room'])
        .eq('is_published', true);

    if (!lovehoCount) return;

    // URL tab パラメータ確認
    const urlTab = new URLSearchParams(window.location.search).get('tab');

    const tabsDiv = document.createElement('div');
    tabsDiv.id = 'hotel-loveho-tabs';
    tabsDiv.style.cssText = 'display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid #ddd;max-width:640px;margin-left:auto;margin-right:auto;padding:0 16px;';
    tabsDiv.innerHTML = `
        <button class="hotel-tab" data-tab="hotel" onclick="switchTab('hotel')" style="padding:10px 24px;border:none;background:transparent;cursor:pointer;font-size:14px;font-weight:bold;border-bottom:3px solid var(--accent,#b5627a);color:var(--accent,#b5627a);font-family:inherit;">🏨 ホテル (<span id="hotel-count">${hotelCount}</span>)</button>
        <button class="hotel-tab" data-tab="loveho" onclick="switchTab('loveho')" style="padding:10px 24px;border:none;background:transparent;cursor:pointer;font-size:14px;color:#999;border-bottom:3px solid transparent;font-family:inherit;">🏩 ラブホ (<span id="loveho-count">${lovehoCount}</span>)</button>
    `;

    const hotelList = document.getElementById('hotel-list');
    hotelList.parentNode.insertBefore(tabsDiv, hotelList);

    // URL にtab=lovehoがある場合は自動切替
    if (urlTab === 'loveho') {
        switchTab('loveho');
    } else {
        currentTab = 'hotel';
    }
}

function hideLovehoTabs() {
    const existing = document.getElementById('hotel-loveho-tabs');
    if (existing) existing.remove();
    currentTab = 'hotel';
}

async function switchTab(tab) {
    console.log('[switchTab]', tab);
    currentTab = tab;

    // タブスタイル切替
    document.querySelectorAll('#hotel-loveho-tabs .hotel-tab').forEach(t => {
        if (t.dataset.tab === tab) {
            t.style.fontWeight = 'bold';
            t.style.borderBottomColor = tab === 'loveho' ? '#c9a96e' : 'var(--accent,#b5627a)';
            t.style.color = tab === 'loveho' ? '#c9a96e' : 'var(--accent,#b5627a)';
        } else {
            t.style.fontWeight = 'normal';
            t.style.borderBottomColor = 'transparent';
            t.style.color = '#999';
        }
    });

    // URL更新（tab パラメータ）
    const cur = new URLSearchParams(window.location.search);
    if (tab === 'loveho') cur.set('tab', 'loveho');
    else cur.delete('tab');
    history.replaceState(null, '', '?' + cur.toString());

    // データ取得と表示
    if (tab === 'hotel') {
        if (cachedHotelData) {
            renderHotelCards(cachedHotelData);
            setResultStatus(cachedHotelData.length);
        }
    } else {
        if (cachedLovehoData) {
            renderLovehoCards(cachedLovehoData);
        } else {
            await loadLovehoForCurrentCity();
        }
    }
}

async function loadLovehoForCurrentCity() {
    if (!_tabFilterObj || !_tabCity) { console.log('[loveho] missing filter/city, skip'); return; }
    showLoading();
    try {
        // prefecture + city のみでフィルタ（major_area/detail_area はラブホに設定されていない場合があるため除外）
        const pref = _tabFilterObj.prefecture;
        let query = supabaseClient.from('hotels').select('*')
            .eq('is_published', true)
            .in('hotel_type', ['love_hotel', 'rental_room'])
            .eq('city', _tabCity)
            .limit(1000);
        if (pref) query = query.eq('prefecture', pref);
        const { data: hotels, error } = await query;
        if (error) throw error;
        console.log('[loveho] loaded:', hotels ? hotels.length : 0, 'hotels');
        if (!hotels || !hotels.length) { cachedLovehoData = []; renderLovehoCards([]); return; }
        // loveho_reports からサマリー取得
        const hotelIds = hotels.map(h => h.id);
        const summaries = await fetchLovehoReviewSummaries(hotelIds);
        const withSummary = hotels.map(h => ({ ...h, lhSummary: summaries[h.id] || null }));
        withSummary.sort((a, b) => {
            const ca = a.lhSummary ? a.lhSummary.count : 0;
            const cb = b.lhSummary ? b.lhSummary.count : 0;
            return cb - ca;
        });
        cachedLovehoData = withSummary;
        renderLovehoCards(withSummary);
    } catch (e) { console.error(e); }
    finally { hideLoading(); }
}

async function fetchLovehoReviewSummaries(hotelIds) {
    if (!hotelIds.length) return {};
    try {
        const { data, error } = await supabaseClient
            .from('loveho_reports')
            .select('hotel_id,recommendation,cleanliness,cost_performance,solo_entry,can_go_out')
            .in('hotel_id', hotelIds);
        if (error || !data) return {};
        const map = {};
        data.forEach(r => {
            if (!map[r.hotel_id]) map[r.hotel_id] = { count: 0, recommendation_sum: 0, cleanliness_sum: 0, cp_sum: 0 };
            const s = map[r.hotel_id];
            s.count++;
            if (r.recommendation != null) s.recommendation_sum += r.recommendation;
            if (r.cleanliness != null) s.cleanliness_sum += r.cleanliness;
            if (r.cost_performance != null) s.cp_sum += r.cost_performance;
        });
        return map;
    } catch { return {}; }
}

// ==========================================================================
// ラブホカードレンダリング
// ==========================================================================
function lhStarsHTML(rating) {
    if (!rating) return '';
    let html = '';
    for (let i = 1; i <= 5; i++) html += i <= Math.round(rating) ? '<span style="color:#c9a96e;">★</span>' : '<span style="color:#ccc;">★</span>';
    return html;
}

function renderLovehoCards(hotels) {
    console.log('[renderLoveho] rendering', hotels.length, 'cards');
    const container = document.getElementById('hotel-list');
    const rs = document.getElementById('result-status');
    if (rs) { rs.style.display = 'block'; rs.innerHTML = hotels.length > 0 ? `<strong>${hotels.length}</strong> 件のラブホテル` : 'ラブホテルが見つかりませんでした'; }
    if (!hotels.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-text">ラブホテルが見つかりませんでした</p></div>';
        return;
    }
    allHotels = hotels;
    displayedCount = 0;
    showDistanceFlag = false;
    container.innerHTML = '';
    loadMoreLovehoCards();
}

function buildLovehoCardHTML(h, i) {
    const s = h.lhSummary;
    const reviewCount = s ? s.count : 0;
    const avgRec = s && s.count ? s.recommendation_sum / s.count : 0;
    const avgClean = s && s.count ? s.cleanliness_sum / s.count : 0;
    const starsRow = avgRec > 0
        ? `<div style="display:flex;gap:10px;align-items:center;margin-top:8px;font-size:12px;color:var(--text-2,#6a5a4a);">
            <span>おすすめ ${lhStarsHTML(avgRec)} ${avgRec.toFixed(1)}</span>
            ${avgClean > 0 ? `<span>清潔感 ${avgClean.toFixed(1)}</span>` : ''}
          </div>` : '';
    const reviewBadge = reviewCount > 0 ? `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(201,169,110,0.12);color:#c9a96e;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;">💬 ${reviewCount}件</span>` : '';
    return `
    <div class="hotel-card-lux" style="animation-delay:${Math.min(i*0.04,0.4)}s;background:#f9f5f0;border:1px solid rgba(201,169,110,0.2);" onclick="openLovehoDetail(${h.id})" role="button">
        <div class="hotel-card-body">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <div style="flex:1;min-width:0;font-size:14px;font-weight:500;color:var(--text);line-height:1.5;word-break:break-all;">${esc(h.name)}</div>
                ${reviewBadge}
            </div>
            <div class="hotel-info-row"><span class="hotel-info-icon">📍</span><span class="hotel-info-text">${esc(h.address || '')}</span></div>
            ${h.nearest_station ? `<div class="hotel-info-row"><span class="hotel-info-icon">🚉</span><span class="hotel-info-text">${esc(h.nearest_station)}</span></div>` : ''}
            ${h.tel ? `<div style="font-size:11px;color:var(--text-3);margin-top:2px;">📞 ${esc(h.tel)}</div>` : ''}
            ${starsRow}
            <div class="hotel-card-footer" style="display:flex;gap:6px;padding-top:10px;">
                <button onclick="event.stopPropagation();openLovehoDetail(${h.id})" style="flex:1;padding:8px 6px;background:linear-gradient(135deg,#c9a96e,#e0c88a);border:none;border-radius:8px;font-size:11px;font-weight:700;color:#1a1a2e;cursor:pointer;font-family:inherit;white-space:nowrap;">✨ 口コミを見る${reviewCount > 0 ? ` (${reviewCount})` : ''}</button>
                <button onclick="event.stopPropagation();openLovehoDetail(${h.id})" style="flex:1;padding:8px 6px;background:transparent;border:1.5px solid rgba(201,169,110,0.35);border-radius:8px;font-size:11px;font-weight:700;color:#c9a96e;cursor:pointer;font-family:inherit;white-space:nowrap;">📝 口コミを投稿</button>
            </div>
        </div>
    </div>`;
}

function loadMoreLovehoCards() {
    const container = document.getElementById('hotel-list');
    const old = document.getElementById('load-more-container');
    if (old) old.remove();
    const oldLinks = container.querySelector('.info-links-bar');
    if (oldLinks) oldLinks.remove();

    const nextBatch = allHotels.slice(displayedCount, displayedCount + HOTELS_PER_PAGE);
    container.insertAdjacentHTML('beforeend', nextBatch.map((h, i) => buildLovehoCardHTML(h, displayedCount + i)).join(''));
    displayedCount += nextBatch.length;

    const remaining = allHotels.length - displayedCount;
    if (remaining > 0) {
        container.insertAdjacentHTML('beforeend', `
            <div id="load-more-container" style="text-align:center;margin:20px 0;">
                <button onclick="loadMoreLovehoCards()" style="background:#c9a96e;color:#fff;border:none;padding:12px 32px;border-radius:6px;font-size:14px;cursor:pointer;font-family:inherit;">もっと見る（残り${remaining}件）</button>
            </div>`);
    }

    if (displayedCount >= allHotels.length) {
        const shopRegLink = SHOP_ID ? '' : '<a href="/shop-register.html" style="color:#8b5e6b; text-decoration:none; padding:6px 16px; border:1px solid #d4b8c1; border-radius:20px; background:#fdf6f8; transition:background 0.2s; font-size:12px; white-space:nowrap;">🏪 店舗様・掲載用はこちら</a>';
        container.insertAdjacentHTML('beforeend', `
            <div class="info-links-bar" style="display:flex; justify-content:center; gap:16px; padding:14px 20px; margin-top:12px; background:#fff; border:1px solid #e0d5d0; border-radius:8px; font-size:13px;">
                <a href="#" onclick="openHotelRequestModal();return false;" style="color:#8b5e6b; text-decoration:none; padding:6px 16px; border:1px solid #d4b8c1; border-radius:20px; background:#fdf6f8; transition:background 0.2s; font-size:12px; white-space:nowrap;">📝 未掲載ホテル情報提供</a>
                ${shopRegLink}
            </div>
        `);
    }
}

// ==========================================================================
// ラブホ詳細ページ
// ==========================================================================
let LH_MASTER = { atmospheres: [], room_types: [], facilities: [], price_ranges_rest: [], price_ranges_stay: [], time_slots: [] };
let lhFormState = {};

async function loadLhMasters() {
    if (LH_MASTER._loaded) return;
    const [atm, rt, fac, pr, ts] = await Promise.all([
        supabaseClient.from('loveho_atmospheres').select('name').order('sort_order').then(r => r.data || []).catch(() => []),
        supabaseClient.from('loveho_room_types').select('name').order('sort_order').then(r => r.data || []).catch(() => []),
        supabaseClient.from('loveho_facilities').select('name').order('sort_order').then(r => r.data || []).catch(() => []),
        supabaseClient.from('loveho_price_ranges').select('name,type').order('sort_order').then(r => r.data || []).catch(() => []),
        supabaseClient.from('loveho_time_slots').select('name').order('sort_order').then(r => r.data || []).catch(() => []),
    ]);
    LH_MASTER.atmospheres = atm.map(r => r.name);
    LH_MASTER.room_types = rt.map(r => r.name);
    LH_MASTER.facilities = fac.map(r => r.name);
    LH_MASTER.price_ranges_rest = pr.filter(r => r.type === 'rest').map(r => r.name);
    LH_MASTER.price_ranges_stay = pr.filter(r => r.type === 'stay').map(r => r.name);
    LH_MASTER.time_slots = ts.map(r => r.name);
    if (!LH_MASTER.time_slots.length) LH_MASTER.time_slots = ['早朝（5:00〜8:00）','朝（8:00〜11:00）','昼（11:00〜16:00）','夕方（16:00〜18:00）','夜（18:00〜23:00）','深夜（23:00〜5:00）'];
    const gpRes = await supabaseClient
        .from('loveho_good_points')
        .select('label, category')
        .eq('is_active', true)
        .order('sort_order');
    LH_MASTER.good_points = (gpRes.data || []);
    LH_MASTER._loaded = true;
}

function openLovehoDetail(hotelId) {
    if (document.activeElement) document.activeElement.blur();
    showHotelPanel(hotelId, true);
}

async function loadLovehoDetail(hotelId) {
    const content = document.getElementById('hotel-detail-content');
    content.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-3);">読み込み中...</div>`;
    try {
        await loadLhMasters();
        const [hotelRes, reportsRes] = await Promise.all([
            supabaseClient.from('hotels').select('*').eq('id', hotelId).eq('is_published', true).maybeSingle(),
            supabaseClient.from('loveho_reports').select('*').eq('hotel_id', hotelId).order('created_at', { ascending: false }).limit(50),
        ]);
        if (!hotelRes.data) throw new Error('Hotel not found');
        const _hotel = hotelRes.data;
        const _pref = _hotel.prefecture || '';
        const _city = _hotel.city || '';
        const _majorArea = _hotel.major_area || '';
        const _detailArea = _hotel.detail_area || '';
        const _region = REGION_MAP.find(r => r.prefs.includes(_pref)) || null;
        const _rl = _region ? _region.label : '';
        const _crumbs = [{ label: '全国', onclick: 'leaveHotelDetail();showJapanPage()' }];
        if (_region) _crumbs.push({ label: _rl, onclick: `leaveHotelDetail();showPrefPage(REGION_MAP.find(r=>r.label==='${_rl}'))` });
        if (_pref) _crumbs.push({ label: _pref, onclick: `leaveHotelDetail();showMajorAreaPage(REGION_MAP.find(r=>r.label==='${_rl}'),'${_pref}')` });
        if (_majorArea) _crumbs.push({ label: _majorArea, onclick: `leaveHotelDetail();showCityPage(REGION_MAP.find(r=>r.label==='${_rl}'),'${_pref}','${_majorArea}')` });
        if (_detailArea) _crumbs.push({ label: _detailArea, onclick: `leaveHotelDetail();showDetailAreaPage(REGION_MAP.find(r=>r.label==='${_rl}'),'${_pref}','${_majorArea}','${_detailArea}')` });
        if (_city) _crumbs.push({ label: _city, onclick: `leaveHotelDetail();fetchAndShowHotelsByCity({prefecture:'${_pref}',major_area:'${_majorArea}'},'${_city}')` });
        _crumbs.push({ label: _hotel.name });
        setBreadcrumb(_crumbs);
        renderLovehoDetail(hotelRes.data, reportsRes.data || []);
        // ラブホ詳細ページに広告を挿入
        const hotelCity = hotelRes.data.city;
        if (hotelCity) {
            const adHTML = await fetchDetailAds('spot', hotelCity);
            if (adHTML) {
                const adSlot = document.getElementById('detail-ad-slot');
                if (adSlot) adSlot.innerHTML = adHTML;
            }
        }
    } catch (e) {
        console.error(e);
        content.innerHTML = '<div style="text-align:center;padding:60px;color:#c47a88;">読み込みエラー</div>';
    }
}

function atmosphereIcon(atm) {
    const map = {
        'おしゃれ': '🎨',
        'ラグジュアリー': '👑',
        'きれい': '✨',
        '普通': '🏨',
        'レトロ': '🕰️',
    };
    return map[atm] ? map[atm] + ' ' : '✨ ';
}

function renderLovehoDetail(hotel, reports) {
    const h = hotel;
    const googleSearch = `https://www.google.com/search?q=${encodeURIComponent(h.name)}`;
    const googleMap = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.address || h.name)}`;

    // カテゴリ参照マップ
    const gpCatMap = {};
    if (LH_MASTER.good_points) LH_MASTER.good_points.forEach(p => { gpCatMap[p.label] = p.category; });

    // 一人入室の集計
    const soloMap = { yes: 'はい', no: 'いいえ', together: '一緒に入った', waiting: '待合室待ち', unknown: 'わからない' };
    const soloColors = { yes: '#c9a96e', no: '#b5627a', together: '#7a9bc9', waiting: '#9b7ac9', unknown: '#ccc' };
    const soloReports = reports.filter(r => r.solo_entry && r.solo_entry !== '');
    const soloCounts = {};
    soloReports.forEach(r => { soloCounts[r.solo_entry] = (soloCounts[r.solo_entry] || 0) + 1; });
    const soloTotal = soloReports.length;

    const reviewsHTML = reports.map(r => {
        const gps = r.good_points && Array.isArray(r.good_points) ? r.good_points : [];
        const gpRoom = gps.filter(gp => gpCatMap[gp] === '設備・お部屋');
        const gpService = gps.filter(gp => gpCatMap[gp] === 'サービス・利便性');
        const gpTagHTML = (items) => items.map(gp=>`<span style="background:rgba(58,154,96,0.1);border:1px solid rgba(58,154,96,0.25);border-radius:10px;padding:2px 8px;font-size:10px;color:#3a9a60;">${esc(gp)}</span>`).join('');
        const gm=r.gender_mode;const gmIcon=gm==='women'?'♀':gm==='men_same'?'♂♂':gm==='women_same'?'♀♀':'♂';const gmCol=gm==='women'?'#c47a88':gm==='men_same'?'#2c5282':gm==='women_same'?'#8264b4':'#4a7ab0';
        return `<div style="background:var(--bg-2,#fff);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <span style="font-size:10px;color:${gmCol};font-weight:600;">${gmIcon} ${esc(r.poster_name || '匿名')}</span>
                <span style="font-size:11px;color:var(--text-3);">${formatDate(r.created_at)}</span>
            </div>
            ${r.comment ? `<div style="font-size:13px;color:var(--text);line-height:1.7;white-space:pre-wrap;margin-top:4px;">${esc(r.comment)}</div>` : ''}
            ${r.atmosphere ? `<div style="margin-bottom:6px;"><span style="font-size:11px;font-weight:600;color:var(--text-3);">✨ 雰囲気　</span><span style="padding:3px 10px;border:1px solid rgba(201,169,110,0.4);border-radius:20px;font-size:12px;color:#c9a96e;background:rgba(201,169,110,0.08);">${atmosphereIcon(r.atmosphere)}${esc(r.atmosphere)}</span></div>` : ''}
            ${gpRoom.length ? `<div style="margin-top:6px;"><div style="font-size:10px;font-weight:600;color:var(--text-3);margin-bottom:3px;">🛁 設備・お部屋</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${gpTagHTML(gpRoom)}</div></div>` : ''}
            ${gpService.length ? `<div style="margin-top:6px;"><div style="font-size:10px;font-weight:600;color:var(--text-3);margin-bottom:3px;">🏨 サービス・利便性</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${gpTagHTML(gpService)}</div></div>` : ''}
            ${r.time_slot ? `<div style="font-size:11px;color:var(--text-2);margin-top:6px;">🕐 ${esc(r.time_slot)}</div>` : ''}
            ${r.multi_person ? `<div style="font-size:12px;color:var(--accent,#b5627a);margin-top:4px;">👥 複数人利用OK${r.guest_male||r.guest_female ? `<span style="color:var(--text-3);margin-left:4px;">（${r.guest_male ? `男性${r.guest_male}名`:''}${r.guest_male&&r.guest_female?'・':''}${r.guest_female ? `女性${r.guest_female}名`:''}）</span>`:''}</div>` : ''}
            <button onclick="event.stopPropagation();openFlagModal('${r.id}')" style="background:none;border:none;color:var(--text-3);font-size:11px;cursor:pointer;font-family:inherit;margin-top:6px;opacity:0.6;">🚩 報告</button>
        </div>`;
    }).join('');

    // フォーム用 select 生成
    const selOpts = (arr) => '<option value="">選択してください</option>' + arr.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    const content = document.getElementById('hotel-detail-content');
    content.innerHTML = `
      <div style="padding:16px 14px 120px; max-width:640px; margin:0 auto;">
        <div style="font-size:23px;font-weight:700;color:var(--text);margin-bottom:12px;">
            <a href="https://www.google.com/search?q=${encodeURIComponent(h.name)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;">${esc(h.name)}</a> <span style="font-size:14px;">🏩</span>
        </div>
        <div style="font-size:13px;color:var(--text-2);margin-bottom:6px;">
            ${h.address ? `📍 <a href="https://www.google.com/maps/search/${encodeURIComponent(h.address)}" target="_blank" rel="noopener" style="color:var(--text-2);text-decoration:underline;">${esc(h.address)}</a>` : ''}
            ${h.tel ? `　📞 ${esc(h.tel)}` : ''}
        </div>
        <div style="font-size:13px;color:var(--text-2);">
            ${h.nearest_station ? `🚉 ${esc(h.nearest_station)}` : ''}
            ${h.major_area ? `　📌 ${esc(h.major_area)}` : ''}
        </div>
        ${soloTotal > 0 ? `
        <div style="margin-top:12px;margin-bottom:16px;">
            <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;">👤 一人で先に入れる？（${soloTotal}件回答）</div>
            <div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin-bottom:6px;">
                ${Object.entries(soloCounts).map(([key, count]) => `<div style="width:${Math.round(count/soloTotal*100)}%;background:${soloColors[key]||'#ccc'};"></div>`).join('')}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
                ${Object.entries(soloCounts).map(([key, count]) => `<span style="font-size:11px;color:var(--text-2);"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${soloColors[key]||'#ccc'};margin-right:3px;"></span>${soloMap[key]||key} ${Math.round(count/soloTotal*100)}%</span>`).join('')}
            </div>
        </div>` : ''}

        <div id="detail-ad-slot"></div>

        <div style="margin-bottom:24px;">
            <h3 style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:12px;">💬 口コミ一覧 (${reports.length}件)</h3>
            ${reviewsHTML || '<div style="color:var(--text-3);font-size:13px;">まだ口コミがありません。最初の投稿をお待ちしています！</div>'}
        </div>

        <div style="background:var(--bg-2,#fff);border:1px solid rgba(201,169,110,0.25);border-radius:12px;padding:20px 16px;margin-bottom:24px;">
            <h3 style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:16px;text-align:center;">🏩 口コミを投稿する</h3>
            <div style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:5px;">一人で先に入れる？</label>
                <select id="lh-solo-entry" onchange="lhFormState.solo_entry=this.value" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:#fff;outline:none;">
                    <option value="">選択してください</option><option value="yes">はい</option><option value="no">いいえ</option><option value="together">一緒に入った</option><option value="lobby">待合室で待ち合わせ</option><option value="unknown">わからない</option>
                </select>
            </div>
            ${LH_MASTER.atmospheres.length ? `<div style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:5px;">雰囲気</label>
                <select onchange="lhFormState.atmosphere=this.value" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:#fff;outline:none;">${selOpts(LH_MASTER.atmospheres)}</select>
            </div>` : ''}
            ${LH_MASTER.good_points && LH_MASTER.good_points.length ? (() => {
                const categories = ['設備・お部屋', 'サービス・利便性'];
                const catIcons = { '設備・お部屋': '🛁', 'サービス・利便性': '🏨' };
                return categories.map(cat => {
                    const items = LH_MASTER.good_points.filter(p => p.category === cat);
                    if (!items.length) return '';
                    return `<div style="margin-bottom:14px;">
                        <label style="display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:8px;">${catIcons[cat] || '📝'} ${cat} <span style="font-size:10px;font-weight:400;color:var(--text-3);">複数選択可</span></label>
                        <div style="display:flex;flex-wrap:wrap;gap:8px;">
                            ${items.map(p => `
                                <div onclick="lhToggleGoodPoint(this,'${esc(p.label)}')" style="cursor:pointer;padding:6px 12px;border:1px solid rgba(201,169,110,0.4);border-radius:20px;font-size:12px;color:var(--text-2);background:#fff;transition:all 0.15s;user-select:none;">${esc(p.label)}</div>
                            `).join('')}
                        </div>
                    </div>`;
                }).join('');
            })() : ''}
            <div style="margin-bottom:14px;">
                <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;user-select:none;">
                    <input type="checkbox" id="lh-multi-person" onchange="lhFormState.multi_person=this.checked; document.getElementById('lh-multi-detail').style.display=this.checked?'flex':'none';" style="width:16px;height:16px;accent-color:#c9a96e;cursor:pointer;">
                    <span style="font-size:13px;color:var(--text-2);">👥 3P・4P…複数人で利用OK（任意）</span>
                </label>
                <div id="lh-multi-detail" style="display:none;gap:8px;margin-top:8px;margin-bottom:4px;">
                    <select onchange="lhFormState.guest_male=this.value" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;font-family:inherit;">
                        <option value="">男性</option>
                        <option value="1">男性 1名</option>
                        <option value="2">男性 2名</option>
                        <option value="3">男性 3名</option>
                        <option value="4">男性 4名</option>
                    </select>
                    <select onchange="lhFormState.guest_female=this.value" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;font-family:inherit;">
                        <option value="">女性</option>
                        <option value="1">女性 1名</option>
                        <option value="2">女性 2名</option>
                        <option value="3">女性 3名</option>
                        <option value="4">女性 4名</option>
                    </select>
                </div>
            </div>
            <div style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:5px;">利用時間帯</label>
                <select onchange="lhFormState.time_slot=this.value" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:#fff;outline:none;">${selOpts(LH_MASTER.time_slots)}</select>
            </div>
            <div style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:5px;">フリーコメント</label>
                <textarea id="lh-comment" rows="3" maxlength="500" oninput="lhFormState.comment=this.value" placeholder="良かった点、気になった点など" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;resize:vertical;background:#fff;outline:none;box-sizing:border-box;"></textarea>
            </div>
            <div style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:5px;">投稿者名（任意）</label>
                <input type="text" oninput="lhFormState.poster_name=this.value" placeholder="無記名" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:#fff;outline:none;box-sizing:border-box;">
                <div style="font-size:11px;color:var(--text-3);margin-top:4px;">※未入力の場合は「匿名」として表示されます。</div>
            </div>
            <button onclick="submitLovehoReport()" id="lh-submit-btn" style="width:100%;padding:14px;background:linear-gradient(135deg,#c9a96e,#e0c88a);border:none;border-radius:10px;color:#1a1a2e;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px;">投稿する</button>
        </div>
      </div>
    `;

    lhFormState = { solo_entry: '', atmosphere: '', time_slot: '', comment: '', poster_name: '', good_points: [], multi_person: false, guest_male: '', guest_female: '' };
}

function lhSetStar(field, value) {
    lhFormState[field] = value;
    const container = document.getElementById('lh-star-' + field);
    if (!container) return;
    container.querySelectorAll('span').forEach((s, i) => { s.style.color = i < value ? '#c9a96e' : '#ccc'; });
}

function lhToggleGoodPoint(el, name) {
    const active = el.dataset.active === '1';
    if (active) {
        el.dataset.active = '0';
        el.style.borderColor = 'rgba(201,169,110,0.4)';
        el.style.background = '#fff';
        el.style.color = 'var(--text-2)';
        el.style.fontWeight = 'normal';
        lhFormState.good_points = lhFormState.good_points.filter(p => p !== name);
    } else {
        el.dataset.active = '1';
        el.style.borderColor = '#c9a96e';
        el.style.background = 'rgba(201,169,110,0.12)';
        el.style.color = '#c9a96e';
        el.style.fontWeight = '600';
        if (!lhFormState.good_points.includes(name)) lhFormState.good_points.push(name);
    }
}

function lhToggleFac(el, name) {
    const cb = el.querySelector('input');
    cb.checked = !cb.checked;
    el.style.borderColor = cb.checked ? '#c9a96e' : '';
    el.style.background = cb.checked ? 'rgba(201,169,110,0.1)' : '';
    el.style.color = cb.checked ? '#c9a96e' : '';
    if (cb.checked) { if (!lhFormState.facilities.includes(name)) lhFormState.facilities.push(name); }
    else { lhFormState.facilities = lhFormState.facilities.filter(f => f !== name); }
}

async function submitLovehoReport() {
    const btn = document.getElementById('lh-submit-btn');
    const hasData = lhFormState.solo_entry || lhFormState.atmosphere || lhFormState.time_slot || lhFormState.comment || lhFormState.good_points.length;
    if (!hasData) { showToast('少なくとも1つ以上の項目を入力してください'); return; }

    btn.disabled = true;
    btn.textContent = '送信中...';
    try {
        const payload = {
            hotel_id: currentHotelId,
            solo_entry: lhFormState.solo_entry || null,
            atmosphere: lhFormState.atmosphere || null,
            good_points: lhFormState.good_points.length ? lhFormState.good_points : null,
            time_slot: lhFormState.time_slot || null,
            comment: lhFormState.comment ? lhFormState.comment.slice(0, 500) : null,
            poster_name: lhFormState.poster_name || null,
            gender_mode: typeof MODE !== 'undefined' ? MODE : null,
            multi_person: lhFormState.multi_person || false,
            guest_male: lhFormState.guest_male ? parseInt(lhFormState.guest_male) : null,
            guest_female: lhFormState.guest_female ? parseInt(lhFormState.guest_female) : null,
        };
        const { error } = await supabaseClient.from('loveho_reports').insert(payload);
        if (error) throw error;
        showSuccessModal('投稿完了', '口コミを投稿しました。ありがとうございます！');
        cachedLovehoData = null; // キャッシュクリア
        loadLovehoDetail(currentHotelId);
    } catch (e) {
        console.error(e);
        showToast('投稿エラーが発生しました');
    } finally {
        btn.disabled = false;
        btn.textContent = '投稿する';
    }
}

function setResultStatus(count) {
    const el = document.getElementById('result-status');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = count > 0 ? `<strong>${count}</strong> ${t('results')}` : t('no_results');
}

// ==========================================================================
// 位置情報検索
// ==========================================================================
function calcDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function reverseGeocode(lat, lng) {
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ja`,
            { headers: { 'User-Agent': 'DeriHotelNavi/1.0' } }
        );
        if (!res.ok) return null;
        const data = await res.json();
        const a = data.address || {};
        // 市区町村優先: 市 > 区 > 町 > 村 > 郡
        return a.city || a.town || a.village || a.county || null;
    } catch {
        return null;
    }
}

async function searchByLocation() {
    const btn = document.getElementById('btn-location');
    if (btn) {
        btn.classList.add('loading');
        btn.querySelector('.btn-location-label').textContent = '取得中...';
    }

    if (!navigator.geolocation) {
        alert('位置情報がサポートされていません');
        resetLocationBtn();
        return;
    }

    showLoading(t('locating'));
    showSkeletonLoader();

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const userLat = pos.coords.latitude;
            const userLng = pos.coords.longitude;

            // 市区町村名を逆ジオコーディングで取得
            const cityName = await reverseGeocode(userLat, userLng);
            const locationLabel = cityName ? `📍 ${cityName}周辺` : '📍 現在地周辺';

            setBreadcrumb([{ label: t('japan'), onclick: 'showJapanPage()' }, { label: locationLabel }]);
            setTitle(cityName ? `${cityName}周辺のホテル` : '現在地周辺のホテル');
            setBackBtn(true);
            pageStack.push(showJapanPage);
            document.getElementById('area-button-container').innerHTML = '';

            try {
                let withDist;
                if (cityName) {
                    // city カラムで検索 → なければ major_area でフォールバック
                    const { data: byCity, error: e1 } = await supabaseClient
                        .from('hotels').select('*')
                        .ilike('city', `%${cityName}%`).eq('is_published', true);
                    if (e1) throw e1;
                    let matched = byCity || [];
                    if (!matched.length) {
                        const { data: byArea } = await supabaseClient
                            .from('hotels').select('*')
                            .ilike('major_area', `%${cityName}%`).eq('is_published', true);
                        matched = byArea || [];
                    }
                    withDist = matched.map(h =>
                        h.latitude && h.longitude
                            ? { ...h, distance: calcDistance(userLat, userLng, h.latitude, h.longitude) }
                            : h
                    );
                } else {
                    // cityName 取得失敗時: 座標ベース検索にフォールバック
                    const { data: allH, error } = await supabaseClient
                        .from('hotels').select('*')
                        .not('latitude', 'is', null)
                        .not('longitude', 'is', null)
                        .eq('is_published', true)
                        .limit(1000);
                    if (error) throw error;
                    withDist = allH
                        .map(h => ({ ...h, distance: calcDistance(userLat, userLng, h.latitude, h.longitude) }))
                        .sort((a, b) => a.distance - b.distance)
                        .slice(0, 60);
                }

                // 集計・最新投稿日時を追加
                const hotelIds = withDist.map(h => h.id);
                const [summaries, latestMap] = await Promise.all([
                    fetchReportSummaries(hotelIds),
                    fetchLatestReportDates(hotelIds),
                ]);
                const withSummary = withDist.map(h => ({ ...h, summary: summaries[h.id] || null, latestReportAt: latestMap[h.id] || null }));

                // 口コミありを口コミ数順、口コミなしを距離順
                const withReviews = withSummary.filter(h => getReportCount(h) > 0);
                const noReviews = withSummary.filter(h => getReportCount(h) === 0);
                sortHotelsByReviews(withReviews);
                noReviews.sort((a, b) => (a.distance || 9999) - (b.distance || 9999));
                const sorted = [...withReviews, ...noReviews];

                renderHotelCards(sorted, true);
                const status = document.getElementById('result-status');
                if (status) {
                    status.style.display = 'block';
                    status.innerHTML = `${locationLabel} — <strong>${sorted.length}</strong> ${t('results')}`;
                }
            } catch (e) {
                console.error(e);
                alert('検索中にエラーが発生しました');
            } finally {
                hideLoading();
                resetLocationBtn();
            }
        },
        (err) => {
            hideLoading();
            resetLocationBtn();
            const msgs = { 1: '位置情報の使用が許可されていません。', 2: '位置情報を取得できませんでした。', 3: 'タイムアウトしました。' };
            alert(msgs[err.code] || t('location_error'));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
}

function resetLocationBtn() {
    const btn = document.getElementById('btn-location');
    if (btn) {
        btn.classList.remove('loading');
        const label = btn.querySelector('.btn-location-label');
        if (label) label.textContent = '現在地';
    }
}

// ==========================================================================
// 最寄駅検索
// ==========================================================================
let stationTimeout = null;

function fetchHotelsByStation() {
    const val = document.getElementById('station-input')?.value?.trim() || '';
    clearTimeout(stationTimeout);
    if (!val) return;

    stationTimeout = setTimeout(async () => {
        showLoading();
        showSkeletonLoader();
        setBreadcrumb([{ label: t('japan'), onclick: 'showJapanPage()' }, { label: `🚉 ${val}駅周辺` }]);
        setTitle(`${val}駅 周辺のホテル`);
        setBackBtn(true);
        pageStack.push(showJapanPage);
        document.getElementById('area-button-container').innerHTML = '';

        try {
            let query = supabaseClient.from('hotels').select('*')
                .ilike('nearest_station', `%${val}%`)
                .eq('is_published', true)
                .order('review_average', { ascending: false, nullsFirst: false })
                .limit(1000);

            const hotels = await fetchHotelsWithSummary(query);
            sortHotelsByReviews(hotels);
            renderHotelCards(hotels);
            setResultStatus(hotels.length);
        } catch (e) {
            console.error(e);
        } finally {
            hideLoading();
        }
    }, 500);
}

// ==========================================================================
// キーワード検索ヘルパー（スペース区切りAND検索・全角半角対応）
// ==========================================================================
function applyKeywordFilter(query, rawKeyword) {
    if (!rawKeyword) return query;
    const words = rawKeyword.trim().split(/[\s　]+/).filter(w => w.length > 0);
    for (const word of words) {
        // 各単語を name OR address の ilike で AND 連結
        query = query.or(`name.ilike.%${word}%,address.ilike.%${word}%`);
    }
    return query;
}

// ==========================================================================
// キーワード検索
// ==========================================================================
let searchTimeout = null;

function fetchHotelsFromSearch() {
    const keyword = document.getElementById('keyword')?.value?.trim() || '';
    document.getElementById('search-clear-btn').style.display = keyword ? 'block' : 'none';

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        if (keyword.length < 2) return;
        showLoading();
        showSkeletonLoader();
        setBreadcrumb([{ label: t('japan'), onclick: 'showJapanPage()' }, { label: `「${keyword}」の検索結果` }]);
        setTitle(`「${keyword}」の検索結果`);
        setBackBtn(true);
        pageStack.push(showJapanPage);
        document.getElementById('area-button-container').innerHTML = '';

        try {
            let query = supabaseClient.from('hotels').select('*').eq('is_published', true).limit(1000);
            query = applyKeywordFilter(query, keyword);
            query = query.order('review_average', { ascending: false, nullsFirst: false });

            const hotels = await fetchHotelsWithSummary(query);
            sortHotelsByReviews(hotels);
            renderHotelCards(hotels);
            setResultStatus(hotels.length);
        } catch (e) {
            console.error(e);
        } finally {
            hideLoading();
        }
    }, 500);
}

function clearSearch() {
    const input = document.getElementById('keyword');
    if (input) { input.value = ''; input.focus(); }
    document.getElementById('search-clear-btn').style.display = 'none';
}

// ==========================================================================
// 楽天評価 → 非表示（ソート順のみに使用）
// ==========================================================================
function hotelRankBadge(_score) {
    return ''; // 表示なし
}

// ==========================================================================
// 投稿の鮮度ラベル（最終報告日）
// ==========================================================================
function freshnessLabel(isoDate) {
    if (!isoDate) return '';
    const diff = Math.floor((Date.now() - new Date(isoDate)) / 86400000);
    if      (diff === 0)  return '<span class="freshness fresh">本日更新</span>';
    else if (diff <= 7)   return `<span class="freshness recent">${diff}日前に更新</span>`;
    else if (diff <= 30)  return `<span class="freshness normal">${diff}日前に更新</span>`;
    else                  return `<span class="freshness old">${diff}日前に更新</span>`;
}

// ==========================================================================
// ホテルカードレンダリング
// ==========================================================================
let allHotels = [];
let displayedCount = 0;
let showDistanceFlag = false;
const HOTELS_PER_PAGE = 20;

function buildCardHTML(h, i, showDistance) {
        const s = h.summary;

        // ===== 投稿集計 =====
        const userCan    = s ? (s.can_call_count    || 0) : 0;
        const userCannot = s ? (s.cannot_call_count || 0) : 0;
        const shopCan    = s ? (s.shop_can_count    || 0) : 0;
        const shopNg     = s ? (s.shop_ng_count     || 0) : 0;
        const hasAny     = userCan + userCannot + shopCan + shopNg > 0;

        // 投稿あり → 4ボックス表示、なし → 非表示
        let reportAreaHTML = '';
        if (hasAny) {
            reportAreaHTML = `
                <div class="card-summary-wrap">
                    <div class="card-summary-group">
                        <div class="card-summary-label shop">🏪 店舗様提供情報</div>
                        <div class="card-summary-boxes">
                            <div class="card-summary-box shop-can">
                                <span class="csb-val">${shopCan}</span>
                                <span class="csb-label">可</span>
                            </div>
                            <div class="card-summary-box shop-ng">
                                <span class="csb-val">${shopNg}</span>
                                <span class="csb-label">不可</span>
                            </div>
                        </div>
                    </div>
                    <div class="card-summary-group">
                        <div class="card-summary-label user">👤 ユーザー投稿情報</div>
                        <div class="card-summary-boxes">
                            <div class="card-summary-box user-can">
                                <span class="csb-val">${userCan}</span>
                                <span class="csb-label">呼べた</span>
                            </div>
                            <div class="card-summary-box user-cannot">
                                <span class="csb-val">${userCannot}</span>
                                <span class="csb-label">呼べなかった</span>
                            </div>
                        </div>
                    </div>
                </div>`;
        }

        // ===== ホテルランクバッジ（楽天評価の代替） =====
        const rankHTML = hotelRankBadge(h.review_average);

        // ===== 口コミ数 =====
        const reviewCount = getReportCount(h);
        if (reviewCount > 0) console.log('[renderCard]', h.name, '口コミ数:', reviewCount, 'summary:', JSON.stringify(h.summary));

        // ===== 最寄駅 + 参考料金（横並び） =====
        const priceInline = h.min_charge
            ? `<span class="hotel-price-inline">最安値 ¥${parseInt(h.min_charge).toLocaleString()}~</span>`
            : '';
        const stationHTML = h.nearest_station
            ? `<div class="hotel-info-row"><span class="hotel-info-icon">🚉</span><span class="hotel-info-text">${esc(h.nearest_station)}</span>${priceInline}</div>`
            : (priceInline ? `<div class="hotel-info-row">${priceInline}</div>` : '');


        // ===== 現在地からの距離 =====
        const distHTML = showDistance && h.distance != null
            ? `<div class="hotel-distance-badge">📍 ${h.distance < 1 ? Math.round(h.distance * 1000) + 'm' : h.distance.toFixed(1) + 'km'}</div>`
            : '';

        return `
        <div class="hotel-card-lux" style="animation-delay:${Math.min(i * 0.04, 0.4)}s"
             onclick="openHotelDetail(${h.id})" role="button">
            <div class="hotel-card-body">

                <!-- ホテル名 + ランク + 距離 -->
                <div class="hotel-card-head">
                    ${distHTML}
                    <div class="hotel-name" style="flex:1;min-width:0;font-size:14px;font-weight:500;color:var(--text);line-height:1.5;word-break:break-all;">${esc(h.name)}</div>
                    ${rankHTML}
                </div>

                <!-- 住所・駅 -->
                <div class="hotel-info-row" style="justify-content:space-between;">
                    <div style="display:flex;align-items:flex-start;gap:4px;flex:1;min-width:0;">
                        <span class="hotel-info-icon">📍</span>
                        <span class="hotel-info-text">${esc(h.address || '')}</span>
                    </div>
                    ${h.tel ? '<span style="font-size:11px;color:var(--text-3);white-space:nowrap;flex-shrink:0;margin-left:8px;">📞 ' + esc(h.tel) + '</span>' : ''}
                </div>
                ${stationHTML}

                <!-- 投稿サマリー（競合と差別化） -->
                ${reportAreaHTML}

                <!-- フッター -->
                <div class="hotel-card-footer" style="display:flex;gap:6px;padding-top:8px;">
                    <button onclick="event.stopPropagation();openHotelDetail(${h.id})" style="flex:1;min-width:0;padding:8px 6px;background:linear-gradient(135deg,#c9a84c,#e0c060);border:none;border-radius:8px;font-size:11px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit;white-space:nowrap;letter-spacing:0.03em;text-shadow:0 1px 2px rgba(0,0,0,0.18);">✨ 今すぐCHECK！${reviewCount > 0 ? ` <span style="display:inline-flex;align-items:center;background:rgba(255,255,255,0.35);border-radius:10px;padding:2px 8px;margin-left:4px;font-size:12px;text-shadow:none;">💬${reviewCount}</span>` : ''}</button>
                    <button onclick="event.stopPropagation();openHotelDetail(${h.id})" style="flex:1;min-width:0;padding:8px 6px;background:transparent;border:1.5px solid rgba(180,150,100,0.35);border-radius:8px;font-size:11px;font-weight:700;color:var(--gold-dim,#a08030);cursor:pointer;font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:0.03em;">📝 口コミを投稿</button>
                </div>

            </div>
        </div>`;
}

function renderHotelCards(hotels, showDistance = false) {
    const container = document.getElementById('hotel-list');

    if (!hotels.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-text">${t('no_results')}</p></div>`;
        return;
    }

    allHotels = hotels;
    displayedCount = 0;
    showDistanceFlag = showDistance;

    container.innerHTML = '';
    loadMoreHotels();
}

function loadMoreHotels() {
    const container = document.getElementById('hotel-list');

    // 既存のもっと見るボタンとリンクバーを削除
    const oldLoadMore = document.getElementById('load-more-container');
    if (oldLoadMore) oldLoadMore.remove();
    const oldLinksBar = container.querySelector('.info-links-bar');
    if (oldLinksBar) oldLinksBar.remove();

    const nextBatch = allHotels.slice(displayedCount, displayedCount + HOTELS_PER_PAGE);
    const html = nextBatch.map((h, i) => buildCardHTML(h, displayedCount + i, showDistanceFlag)).join('');
    container.insertAdjacentHTML('beforeend', html);
    displayedCount += nextBatch.length;

    // もっと見るボタン
    const remaining = allHotels.length - displayedCount;
    if (remaining > 0) {
        container.insertAdjacentHTML('beforeend', `
            <div id="load-more-container" style="text-align:center; margin:20px 0;">
                <button id="load-more-btn" onclick="loadMoreHotels()" style="background:#b5627a; color:#fff; border:none; padding:12px 32px; border-radius:6px; font-size:14px; cursor:pointer; font-family:inherit;">
                    もっと見る（残り${remaining}件）
                </button>
            </div>
        `);
    }

    // ホテル一覧の下にリンクバーを追加
    const shopRegLink = SHOP_ID ? '' : '<a href="/shop-register.html" style="color:#8b5e6b; text-decoration:none; padding:6px 16px; border:1px solid #d4b8c1; border-radius:20px; background:#fdf6f8; transition:background 0.2s; font-size:12px; white-space:nowrap;">🏪 店舗様・掲載用はこちら</a>';
    container.insertAdjacentHTML('beforeend', `
        <div class="info-links-bar" style="display:flex; justify-content:center; gap:16px; padding:14px 20px; margin-top:12px; background:#fff; border:1px solid #e0d5d0; border-radius:8px; font-size:13px;">
            <a href="#" onclick="openHotelRequestModal();return false;" style="color:#8b5e6b; text-decoration:none; padding:6px 16px; border:1px solid #d4b8c1; border-radius:20px; background:#fdf6f8; transition:background 0.2s; font-size:12px; white-space:nowrap;">📝 未掲載ホテル情報提供</a>
            ${shopRegLink}
        </div>
    `);
}

// ==========================================================================
// ホテル詳細ページへ遷移
// ==========================================================================
function openHotelDetail(hotelId) {
    if(document.activeElement)document.activeElement.blur();
    // パネルを表示してホテル詳細をロード（SPA）
    showHotelPanel(hotelId);
}

// ===== ホテル詳細パネル =====
// 入り方条件はDBから取得（管理画面で変更可能）
let CONDITIONS = [
    '直通', 'カードキー必須', 'EV待ち合わせ',
    '玄関待ち合わせ', '深夜玄関待合', '2名予約必須',
    'フロント相談', 'ノウハウ', 'その他'
];  // フォールバック用デフォルト値

function loadConditionsMaster() {
    // uses hardcoded defaults above
}

// 呼べた理由マスタ
let CAN_CALL_REASONS = ['直通', 'カードキー必須', 'EVフロント階スキップ', '玄関待ち合わせ', '深夜玄関待合', '2名予約必須', 'フロント相談', 'ノウハウ', 'バスタオル依頼推奨', 'その他'];

// 狭い画面用の半角カタカナ表示マップ（DBラベルは全角のまま維持）
const CAN_CALL_REASONS_NARROW = {
    'カードキー必須':    'ｶｰﾄﾞｷｰ必須',
    'EVフロント階スキップ': 'EVﾌﾛﾝﾄ階ｽｷｯﾌﾟ',
    'フロント相談':      'ﾌﾛﾝﾄ相談',
    'ノウハウ':          'ﾉｳﾊｳ',
    'バスタオル依頼推奨': 'ﾊﾞｽﾀｵﾙ依頼推奨',
    '玄関待ち合わせ':    '玄関待合わせ',
};

async function loadCanCallReasonsMaster() {
    try {
        const { data } = await supabaseClient
            .from('can_call_reasons')
            .select('label')
            .order('sort_order');
        if (data && data.length > 0) {
            CAN_CALL_REASONS = data.map(d => d.label);
        }
    } catch(e) {
        console.warn('can_call_reasons not found, using defaults');
        showToast('マスタデータの読み込みに失敗しました。デフォルト値を使用します。', 3000);
    }
}

// 呼べなかった理由マスタ
let CANNOT_CALL_REASONS = ['フロントSTOP', '防犯カメラ確認', '深夜外出NG', 'その他'];

async function loadCannotCallReasonsMaster() {
    try {
        const { data } = await supabaseClient
            .from('cannot_call_reasons')
            .select('label')
            .order('sort_order');
        if (data && data.length > 0) {
            CANNOT_CALL_REASONS = data.map(d => d.label);
        }
    } catch(e) {
        console.warn('cannot_call_reasons not found, using defaults');
        showToast('マスタデータの読み込みに失敗しました。デフォルト値を使用します。', 3000);
    }
}
// 部屋タイプマスタ
let ROOM_TYPES = ['シングル', 'ダブル', 'ツイン', 'スイート', '和室', 'その他'];

async function loadRoomTypesMaster() {
    try {
        const { data } = await supabaseClient
            .from('room_types')
            .select('label')
            .order('sort_order');
        if (data && data.length > 0) {
            ROOM_TYPES = data.map(d => d.label);
        }
    } catch(e) {
        console.warn('room_types not found, using defaults');
        showToast('マスタデータの読み込みに失敗しました。デフォルト値を使用します。', 3000);
    }
}

const TIME_SLOTS = [
    '早朝（5:00〜8:00）',
    '朝（8:00〜11:00）',
    '昼（11:00〜16:00）',
    '夕方（16:00〜18:00）',
    '夜（18:00〜23:00）',
    '深夜（23:00〜5:00）',
];

let hotelFormState = {
    can_call: null,
    conditions: new Set(),
    time_slot: '',
    can_call_reasons: new Set(),
    cannot_call_reasons: new Set(),
    comment: '',
    poster_name: '',
    room_type: '',
    multi_person: false,
    guest_male: 1,
    guest_female: 1,
};
let currentHotelId = null;

function hotelStepGuest(gender, delta) {
    const key = gender === 'male' ? 'guest_male' : 'guest_female';
    const elId = gender === 'male' ? 'form-guest-male' : 'form-guest-female';
    const next = Math.min(4, Math.max(0, (hotelFormState[key] || 0) + delta));
    hotelFormState[key] = next;
    const el = document.getElementById(elId);
    if (el) el.textContent = next;
}

function hotelToggleMultiPerson(checked) {
    hotelFormState.multi_person = checked;
    const section = document.getElementById('form-multi-person-section');
    if (section) section.style.display = checked ? 'block' : 'none';
    if (checked) {
        // チェック時はデフォルト男性1・女性1にリセット
        hotelFormState.guest_male = 1;
        hotelFormState.guest_female = 1;
        const mEl = document.getElementById('form-guest-male');
        const fEl = document.getElementById('form-guest-female');
        if (mEl) mEl.textContent = 1;
        if (fEl) fEl.textContent = 1;
    }
}

function showHotelPanel(hotelId, isLoveho) {
    if (currentPage) {
        const currentPageStr = currentPage.toString();
        if (!currentPageStr.includes('showHotelPanel')) {
            pageStack.push(currentPage);
        }
    }
    currentHotelId = hotelId;
    currentPage = () => showHotelPanel(hotelId, isLoveho);
    hotelFormState = { can_call: null, conditions: new Set(), time_slot: '', can_call_reasons: new Set(), cannot_call_reasons: new Set(), comment: '', poster_name: '', room_type: '', multi_person: false, guest_male: 1, guest_female: 1 };

    updateUrl({ hotel: hotelId });
    setBackBtn(true);

    document.getElementById('area-button-container').style.display = 'none';
    hideLovehoTabs();

    const content = document.getElementById('hotel-detail-content');
    content.style.display = 'block';
    content.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-3);">読み込み中...</div>`;

    if (isLoveho) {
        loadLovehoDetail(hotelId);
    } else {
        loadHotelDetail(hotelId);
    }
    window.scrollTo(0, 0);
}

function closeHotelPanel() {
    history.back();
}

function leaveHotelDetail() {
    const content = document.getElementById('hotel-detail-content');
    if (content) { content.style.display = 'none'; content.innerHTML = ''; }
    document.getElementById('area-button-container').style.display = '';
    const rs = document.getElementById('result-status');
    if (rs) rs.style.display = '';
    document.getElementById('hotel-list').style.display = '';
}

async function loadHotelDetail(hotelId) {
    const content = document.getElementById('hotel-detail-content');
    content.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-3);">読み込み中...</div>`;

    try {
        await Promise.all([loadConditionsMaster(), loadCanCallReasonsMaster(), loadCannotCallReasonsMaster(), loadRoomTypesMaster()]);
        const [hotelRes, reportsRes, summaryRes, shopsRes, shopHotelInfoRes] = await Promise.all([
            supabaseClient.from('hotels').select('*').eq('id', hotelId).eq('is_published', true).maybeSingle(),
            supabaseClient.from('reports').select('*').eq('hotel_id', hotelId).order('created_at', { ascending: false }).limit(50),
            supabaseClient.from('hotel_report_summary').select('*').eq('hotel_id', hotelId).maybeSingle(),
            Promise.resolve({ data: [] }),
            supabaseClient.from('shop_hotel_info').select('shop_id,transport_fee,shops(id,shop_name,shop_url,plan_id,status,contract_plans(price))').eq('hotel_id', hotelId),
        ]);

        if (!hotelRes.data) throw new Error('Hotel not found');
        // 店舗専用モード時は、この店舗の投稿 + ユーザー投稿のみに絞る
        let allReports = reportsRes.data || [];
        console.log('[loadHotelDetail] SHOP_ID:', SHOP_ID, 'total reports:', allReports.length);
        if (SHOP_ID) {
            console.log('[loadHotelDetail] shop reports before filter:', allReports.filter(r => r.poster_type === 'shop').map(r => ({ shop_id: r.shop_id, poster_name: r.poster_name })));
            const shopName = SHOP_DATA?.shop_name;
            allReports = allReports.filter(r => {
                if (r.poster_type === 'shop') return r.shop_id === SHOP_ID || (shopName && r.poster_name === shopName);
                return true; // ユーザー投稿は残す
            });
            console.log('[loadHotelDetail] after filter:', allReports.length, 'reports');
        }
        // 店舗投稿の店舗名からステータス・プラン情報を一括取得
        const shopNames = [...new Set(allReports.filter(r => r.poster_type === 'shop' && r.poster_name).map(r => r.poster_name))];
        let shopStatusMap = {};
        if (shopNames.length > 0) {
            const { data: shopRows } = await supabaseClient.from('shops').select('id,shop_name,status,shop_url,plan_id,contract_plans(price)').in('shop_name', shopNames);
            (shopRows || []).forEach(s => {
                const price = s.contract_plans?.price || 0;
                shopStatusMap[s.shop_name] = { status: s.status, shop_url: s.shop_url, isPaid: price > 0, shopId: s.id };
            });
        }
        const _hotel = hotelRes.data;
        const _pref = _hotel.prefecture || '';
        const _city = _hotel.city || '';
        const _majorArea = _hotel.major_area || '';
        const _detailArea = _hotel.detail_area || '';
        const _region = REGION_MAP.find(r => r.prefs.includes(_pref)) || null;
        const _rl = _region ? _region.label : '';
        const _crumbs = [{ label: '全国', onclick: 'leaveHotelDetail();showJapanPage()' }];
        if (_region) _crumbs.push({ label: _rl, onclick: `leaveHotelDetail();showPrefPage(REGION_MAP.find(r=>r.label==='${_rl}'))` });
        if (_pref) _crumbs.push({ label: _pref, onclick: `leaveHotelDetail();showMajorAreaPage(REGION_MAP.find(r=>r.label==='${_rl}'),'${_pref}')` });
        if (_majorArea) _crumbs.push({ label: _majorArea, onclick: `leaveHotelDetail();showCityPage(REGION_MAP.find(r=>r.label==='${_rl}'),'${_pref}','${_majorArea}')` });
        if (_detailArea) _crumbs.push({ label: _detailArea, onclick: `leaveHotelDetail();showDetailAreaPage(REGION_MAP.find(r=>r.label==='${_rl}'),'${_pref}','${_majorArea}','${_detailArea}')` });
        if (_city) _crumbs.push({ label: _city, onclick: `leaveHotelDetail();fetchAndShowHotelsByCity({prefecture:'${_pref}',major_area:'${_majorArea}'},'${_city}')` });
        _crumbs.push({ label: _hotel.name });
        setBreadcrumb(_crumbs);
        renderHotelDetail(hotelRes.data, allReports, summaryRes.data, shopsRes.data || [], shopHotelInfoRes.data || [], shopStatusMap);
        // ホテル詳細ページに広告を挿入
        const hotelCity = hotelRes.data.city;
        if (hotelCity) {
            const adHTML = await fetchDetailAds('spot', hotelCity);
            if (adHTML) {
                const adSlot = document.getElementById('detail-ad-slot');
                if (adSlot) adSlot.innerHTML = adHTML;
            }
        }
    } catch(e) {
        console.error(e);
        content.innerHTML = `<div style="text-align:center;padding:60px;color:#c47a88;">読み込みエラーが発生しました</div>`;
    }
}

// ==========================================================================
// ドーナツグラフ SVG（緑=可/呼べた、赤=不可/呼べなかった）
// ==========================================================================
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

function shopVerdict(r) {
    if (r.can_call === true) return '可';
    return '不可';
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

function renderHotelDetail(hotel, reports, summary, _shops, shopHotelInfoList, shopStatusMap) {
    shopStatusMap = shopStatusMap || {};
    updatePageTitle(hotel.name + ' - 口コミ・対応情報');
    const can     = summary?.can_call_count    || 0;
    const cannot  = summary?.cannot_call_count || 0;
    const shopCan = summary?.shop_can_count    || 0;
    const shopNg  = summary?.shop_ng_count     || 0;
    const total   = can + cannot;

    // 店舗名 → { transport_fee, shop_url, isPaid, status } のマップ
    const shopFeeMap = {};
    const shopInfoMap = {};
    // shopStatusMap（reportsのposter_nameからshopsテーブル直接取得）を先にセット
    Object.entries(shopStatusMap).forEach(([name, info]) => {
        shopInfoMap[name] = { shop_url: info.shop_url || null, isPaid: info.isPaid || false, status: info.status || null, shopId: info.shopId || null };
    });
    // shop_hotel_info経由のデータで上書き・補完（transport_feeはここでのみ取得）
    (shopHotelInfoList || []).forEach(info => {
        const shop = info.shops;
        const name = shop?.shop_name;
        if (!name) return;
        shopFeeMap[name] = info.transport_fee;
        const price = shop?.contract_plans?.price || 0;
        const existing = shopInfoMap[name] || {};
        shopInfoMap[name] = {
            shop_url: shop?.shop_url || existing.shop_url || null,
            isPaid: price > 0 || existing.isPaid || false,
            status: shop?.status || existing.status || null,
            shopId: shop?.id || existing.shopId || null
        };
    });
    // SHOP_DATA（shopパラメータ時のinitShopModeで取得）からも補完
    if (SHOP_DATA?.shop_name) {
        const name = SHOP_DATA.shop_name;
        const existing = shopInfoMap[name] || {};
        const price = SHOP_DATA?.contract_plans?.price || 0;
        shopInfoMap[name] = {
            shop_url: existing.shop_url || SHOP_DATA?.shop_url || null,
            isPaid: existing.isPaid || price > 0,
            status: existing.status || SHOP_DATA?.status || null,
            shopId: existing.shopId || SHOP_ID || null
        };
    }
    console.log('[renderHotelDetail] shopInfoMap:', JSON.stringify(shopInfoMap));

    function buildReportCard(r) {
        // 入り方タグ（can_call_reasons / conditions / cannot_call_reasons をまとめて表示）
        const entryTags = [
            ...(r.can_call ? (r.can_call_reasons||[]) : (r.cannot_call_reasons||[])),
            ...(r.conditions||[])
        ];
        const tagColor = r.can_call ? '#3a9a60' : '#c05050';
        const tagBg   = r.can_call ? 'rgba(58,154,96,0.1)'  : 'rgba(192,80,80,0.08)';
        const tagBorder = r.can_call ? 'rgba(58,154,96,0.3)' : 'rgba(192,80,80,0.25)';
        const tagsHTML = entryTags.map(t =>
            `<span style="padding:2px 7px;background:${tagBg};border:1px solid ${tagBorder};border-radius:8px;font-size:10px;color:${tagColor};">${t}</span>`
        ).join('');
        const guestChip = r.multi_person
            ? `<span style="padding:2px 7px;background:rgba(181,98,122,0.08);border:1px solid rgba(181,98,122,0.2);border-radius:8px;font-size:10px;color:var(--accent,#b5627a);">👥 複数人利用OK${r.guest_male||r.guest_female ? `<span style="color:var(--text-3);margin-left:3px;">（${r.guest_male?`男性${r.guest_male}名`:''}${r.guest_male&&r.guest_female?'・':''}${r.guest_female?`女性${r.guest_female}名`:''}）</span>`:''}</span>`
            : (r.guest_female != null && r.guest_female > 0)
            ? `<span style="padding:2px 7px;background:rgba(181,98,122,0.08);border:1px solid rgba(181,98,122,0.2);border-radius:8px;font-size:10px;color:var(--accent,#b5627a);">👥 男性${r.guest_male}名・女性${r.guest_female}名</span>`
            : '';
        const metaChips = [
            r.time_slot  ? `<span style="padding:2px 7px;background:rgba(106,138,188,0.1);border:1px solid rgba(106,138,188,0.25);border-radius:8px;font-size:10px;color:#6a8abc;">🕐${r.time_slot}</span>` : '',
            r.room_type  ? `<span style="padding:2px 7px;background:var(--bg-3);border:1px solid var(--border);border-radius:8px;font-size:10px;color:var(--text-2);">🛏${r.room_type}</span>` : '',
            guestChip,
        ].join('');
        const isShop = r.poster_type === 'shop';
        const feeLabel = isShop ? formatTransportFee(shopFeeMap[r.poster_name]) : null;
        const posterHTML = r.poster_name ? (()=>{
            const gm=r.gender_mode;const icon=gm==='women'?'♀':gm==='men_same'?'♂♂':gm==='women_same'?'♀♀':'♂';const col=gm==='women'?'#c47a88':gm==='men_same'?'#2c5282':gm==='women_same'?'#8264b4':'#4a7ab0';
            const si=isShop?shopInfoMap[r.poster_name]:null;
            console.log('[buildReportCard v16]', r.poster_name, 'isShop:', isShop, 'status:', si?.status, 'isPaid:', si?.isPaid, 'url:', si?.shop_url, 'shopInfoMapKeys:', Object.keys(shopInfoMap));
            // 非activeの店舗 → 店舗名を隠す
            if(isShop&&si&&si.status&&si.status!=='active'){return`<span style="font-size:10px;color:var(--text-3);">${icon} 🏢 店舗提供情報</span>`;}
            // active + 有料 → 店舗専用ポータルリンク付き店舗名
            if(isShop&&si&&si.status==='active'&&si.isPaid&&si.shop_url){return`<a href="${si.shop_url}" target="_blank" rel="noopener" style="font-size:10px;color:${col};font-weight:700;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'" onclick="event.stopPropagation()">${icon} ${r.poster_name} 🔗</a>`;}
            // active + 無料 or ユーザー投稿 → テキストのみ
            return`<span style="font-size:10px;color:${col};font-weight:600;">${icon} ${r.poster_name}</span>`;
        })() : '';
        const feeHTML = feeLabel ? `<span style="padding:2px 8px;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.3);border-radius:8px;font-size:10px;color:#9a7030;">🚕 交通費: ${feeLabel}</span>` : '';
        const flagHTML = r.id ? `<button onclick="showFlagModal('${r.id}')" style="padding:2px 7px;background:transparent;border:1px solid rgba(180,150,100,0.2);border-radius:8px;font-size:10px;color:var(--text-3);cursor:pointer;font-family:inherit;white-space:nowrap;">🚩 報告</button>` : '';

        return `
        <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:5px;">
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                <span style="font-size:11px;font-weight:700;color:var(--text-3);white-space:nowrap;">${formatDate(r.created_at)}</span>
                <span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;${r.can_call ? 'background:rgba(58,154,96,0.08);color:#3a9a60;' : 'background:rgba(192,80,80,0.08);color:#c05050;'}">
                    ${r.poster_type === 'shop' ? (r.can_call ? '✅ ご案内実績あり' : '❌ ご案内不可') : (r.can_call ? '✅ 呼べた' : '❌ 呼べなかった')}
                </span>
                ${tagsHTML}
                ${metaChips}
            </div>
            ${(posterHTML || feeHTML) ? `<div style="display:flex;align-items:center;gap:12px;margin-top:6px;flex-wrap:wrap;">${posterHTML}${feeHTML}</div>` : ''}
            ${r.comment ? `<div style="font-size:12px;color:var(--text-2);line-height:1.6;margin-top:6px;">${r.comment}</div>` : ''}
            ${flagHTML ? `<div style="text-align:right;margin-top:4px;">${flagHTML}</div>` : ''}
        </div>`;
    }

    const userReports = reports.filter(r => r.poster_type !== 'shop');
    const userCanCall = userReports.filter(r => r.can_call).length;
    const userPct = userReports.length > 0 ? Math.round(userCanCall / userReports.length * 100) : null;
    const shopReports = reports.filter(r => r.poster_type === 'shop' && (!r.gender_mode || r.gender_mode === MODE));
    const shopCanCall = shopReports.filter(r => r.can_call).length;
    const shopPct = shopReports.length > 0 ? Math.round(shopCanCall / shopReports.length * 100) : null;
    console.log('[renderHotelDetail] MODE:', MODE, 'shopReports:', shopReports.length, 'userReports:', userReports.length, 'reports gender_modes:', reports.filter(r => r.poster_type === 'shop').map(r => r.gender_mode));
    const noReports = `<div style="text-align:center;padding:16px 0;color:var(--text-3);font-size:12px;">まだ投稿がありません</div>`;

    const shopSection = shopReports.length === 0 ? '' : `
        <div style="border:2px solid rgba(201,168,76,0.5);border-radius:12px;padding:14px 16px;margin-bottom:16px;background:linear-gradient(135deg,rgba(201,168,76,0.07) 0%,rgba(255,248,220,0.5) 100%);box-shadow:0 2px 12px rgba(201,168,76,0.12);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <span style="font-size:11px;font-weight:700;padding:4px 12px;background:rgba(201,168,76,0.18);color:#7a5c10;border:1px solid rgba(201,168,76,0.4);border-radius:20px;letter-spacing:0.03em;">✅ 店舗公式情報</span>
                <span style="font-size:11px;color:#9a8050;">${shopReports.length}件</span>
            </div>
            ${shopReports.map(buildReportCard).join('')}
        </div>`;

    const userReportsHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin:4px 0 10px;">
            <span style="font-size:16px;font-weight:600;color:var(--text);">みんなの体験談</span>
            <div style="flex:1;height:1px;background:var(--border);"></div>
        </div>
        <div style="font-size:11px;font-weight:700;color:var(--text-3);margin-bottom:6px;padding:3px 8px;background:rgba(58,154,96,0.08);border-radius:6px;display:inline-block;">${{ men: '♂', women: '♀', men_same: '♂♂', women_same: '♀♀' }[MODE] || '♂'} ユーザー投稿情報 (${userReports.length}件)</div>
        ${userReports.length > 0 ? userReports.map(buildReportCard).join('') : noReports}`;



    document.getElementById('hotel-detail-content').innerHTML = `
    <div style="max-width:640px;margin:0 auto;padding:16px 14px 120px;">

        <!-- ホテル名 + 参考料金（同行） -->
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin:0 0 12px 0;">
            <h2 style="font-size:23px;font-weight:600;color:#1a1410 !important;line-height:1.4;margin:0;padding:0;flex:1;min-width:0;"><a href="https://www.google.com/search?q=${encodeURIComponent(hotel.name)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${esc(hotel.name)} <span style="font-size:12px;color:#999;">🔍</span></a></h2>
            ${hotel.min_charge ? '<span style="font-size:13px;font-weight:600;color:var(--accent-dim);white-space:nowrap;flex-shrink:0;">最安値 ¥' + parseInt(hotel.min_charge).toLocaleString() + '~</span>' : ''}
        </div>

        <!-- ホテル基本情報 -->
        <div style="background:#ffffff;border:1px solid rgba(180,140,80,0.2);border-radius:10px;padding:14px 18px;margin-bottom:12px;box-shadow:0 2px 16px rgba(0,0,0,0.06);">
            <!-- 行1: 住所 | 電話番号 -->
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px;">
                <span style="font-size:13px;color:var(--text-2);line-height:1.5;flex:1;">${hotel.address ? '<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(hotel.address) + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'" onclick="event.stopPropagation()">📍 ' + esc(hotel.address) + ' <span style="font-size:12px;color:#999;">📍</span></a>' : ''}</span>
                ${hotel.tel ? '<span style="font-size:13px;color:var(--text-2);white-space:nowrap;flex-shrink:0;">📞 ' + esc(hotel.tel) + '</span>' : ''}
            </div>
            <!-- 行2: 最寄駅 | エリア -->
            ${(hotel.nearest_station || hotel.prefecture) ? `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                ${hotel.nearest_station ? `<span style="font-size:13px;color:var(--text-2);">🚉 ${esc(hotel.nearest_station)}</span>` : '<span></span>'}
                ${hotel.prefecture ? `<span style="font-size:12px;color:var(--text-3);">📌 ${esc(hotel.major_area || hotel.prefecture)}</span>` : ''}
            </div>` : ''}
        </div>

        <div id="detail-ad-slot"></div>

        ${shopPct !== null ? `
        <div style="margin-bottom:12px;">
            <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;">🏪 店舗実績（${shopReports.length}件）</div>
            <div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin-bottom:6px;">
                <div style="width:${shopPct}%;background:#3a9a60;"></div>
                <div style="width:${100-shopPct}%;background:#c05050;"></div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
                <span style="font-size:11px;color:var(--text-2);"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3a9a60;margin-right:3px;"></span>ご案内実績あり ${shopPct}%</span>
                <span style="font-size:11px;color:var(--text-2);"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#c05050;margin-right:3px;"></span>ご案内不可 ${100-shopPct}%</span>
            </div>
        </div>` : ''}

        ${shopSection}

        ${userPct !== null ? `
        <div style="margin-bottom:12px;">
            <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;">📊 呼べる？（${userReports.length}件）</div>
            <div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin-bottom:6px;">
                <div style="width:${userPct}%;background:#3a9a60;"></div>
                <div style="width:${100-userPct}%;background:#c05050;"></div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
                <span style="font-size:11px;color:var(--text-2);"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3a9a60;margin-right:3px;"></span>呼べた ${userPct}%</span>
                <span style="font-size:11px;color:var(--text-2);"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#c05050;margin-right:3px;"></span>呼べなかった ${100-userPct}%</span>
            </div>
        </div>` : ''}

        ${userReportsHTML}

        <div style="display:flex;align-items:center;gap:10px;margin:28px 0 10px;">
            <span style="font-size:16px;font-weight:600;color:var(--text);">情報を投稿する</span>
            <div style="flex:1;height:1px;background:var(--border);"></div>
        </div>
        <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:20px;box-shadow:var(--shadow);">
            <div class="form-group">
                <label class="form-label">投稿者名 <span style="color:var(--text-3);font-weight:400;">（任意）</span></label>
                <input type="text" id="form-poster-name" placeholder="未入力の場合は「匿名希望」で表示されます"
                    oninput="hotelFormState.poster_name=this.value"
                    style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:var(--bg-3);outline:none;color:var(--text-2);box-sizing:border-box;">
            </div>
            <div class="form-group">
                <label class="form-label">結果 <span style="display:inline-flex;align-items:center;padding:2px 8px;background:#c05050;color:#fff;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:0.05em;margin-left:4px;vertical-align:middle;">必須</span></label>
                <div class="toggle-row">
                    <button class="toggle-btn can" id="btn-can" onclick="hotelSetCanCall(true)">✅ 呼べた</button>
                    <button class="toggle-btn cannot" id="btn-cannot" onclick="hotelSetCanCall(false)">❌ 呼べなかった</button>
                </div>
                <div id="can-reasons-display"></div>
                <div id="cannot-reasons-display"></div>
                <div style="margin-top:10px;">
                    <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text-2);">
                        <input type="checkbox" id="form-multi-person" onchange="hotelToggleMultiPerson(this.checked)"
                            style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent);">
                        3P・4P…複数人で利用OK（任意）
                    </label>
                    <div id="form-multi-person-section" style="display:none;margin-top:10px;padding:10px 12px;background:var(--bg-3);border:1px solid var(--border);border-radius:8px;">
                        <div style="display:flex;gap:16px;">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span style="font-size:12px;color:var(--text-2);width:40px;">男性</span>
                                <button type="button" onclick="hotelStepGuest('male',-1)"
                                    style="width:30px;height:30px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text-2);font-size:16px;cursor:pointer;font-family:inherit;line-height:1;display:flex;align-items:center;justify-content:center;">－</button>
                                <span id="form-guest-male" style="width:20px;text-align:center;font-size:14px;font-weight:600;color:var(--text);">1</span>
                                <button type="button" onclick="hotelStepGuest('male',1)"
                                    style="width:30px;height:30px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text-2);font-size:16px;cursor:pointer;font-family:inherit;line-height:1;display:flex;align-items:center;justify-content:center;">＋</button>
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span style="font-size:12px;color:var(--text-2);width:40px;">女性</span>
                                <button type="button" onclick="hotelStepGuest('female',-1)"
                                    style="width:30px;height:30px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text-2);font-size:16px;cursor:pointer;font-family:inherit;line-height:1;display:flex;align-items:center;justify-content:center;">－</button>
                                <span id="form-guest-female" style="width:20px;text-align:center;font-size:14px;font-weight:600;color:var(--text);">1</span>
                                <button type="button" onclick="hotelStepGuest('female',1)"
                                    style="width:30px;height:30px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text-2);font-size:16px;cursor:pointer;font-family:inherit;line-height:1;display:flex;align-items:center;justify-content:center;">＋</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="form-group">
                <div style="display:flex;gap:10px;">
                    <div style="flex:1;min-width:0;">
                        <label class="form-label" style="margin-bottom:6px;display:block;">時間帯 <span style="color:var(--text-3);font-weight:400;">(任意)</span></label>
                        <select id="form-time-slot" onchange="hotelFormState.time_slot=this.value"
                            style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:var(--bg-3);outline:none;color:var(--text-2);appearance:none;">
                            <option value="">未選択</option>
                            <option value="早朝 (5:00~8:00)">早朝 (5:00~8:00)</option>
                            <option value="朝 (8:00~11:00)">朝 (8:00~11:00)</option>
                            <option value="昼 (11:00~16:00)">昼 (11:00~16:00)</option>
                            <option value="夕方 (16:00~18:00)">夕方 (16:00~18:00)</option>
                            <option value="夜 (18:00~23:00)">夜 (18:00~23:00)</option>
                            <option value="深夜 (23:00~5:00)">深夜 (23:00~5:00)</option>
                        </select>
                    </div>
                    <div style="flex:1;min-width:0;">
                        <label class="form-label" style="margin-bottom:6px;display:block;">部屋タイプ <span style="color:var(--text-3);font-weight:400;">(任意)</span></label>
                        <select id="form-room-type" onchange="hotelFormState.room_type=this.value"
                            style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:var(--bg-3);outline:none;color:var(--text-2);appearance:none;">
                            <option value="">未選択</option>
                            ${ROOM_TYPES.map(r => `<option value="${r}">${r}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </div>
            <div style="margin-bottom:14px;">
                <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;user-select:none;">
                    <input type="checkbox" id="multi-person-check" onchange="hotelFormState.multi_person=this.checked; document.getElementById('multi-person-detail').style.display=this.checked?'flex':'none';" style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer;">
                    <span style="font-size:13px;color:var(--text-2);">👥 3P・4P…複数人で利用OK（任意）</span>
                </label>
                <div id="multi-person-detail" style="display:none;gap:8px;margin-top:8px;">
                    <select onchange="hotelFormState.guest_male=parseInt(this.value)||1" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;font-family:inherit;">
                        <option value="">男性</option>
                        <option value="1">男性 1名</option>
                        <option value="2">男性 2名</option>
                        <option value="3">男性 3名</option>
                        <option value="4">男性 4名</option>
                    </select>
                    <select onchange="hotelFormState.guest_female=parseInt(this.value)||0" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;font-family:inherit;">
                        <option value="">女性</option>
                        <option value="1">女性 1名</option>
                        <option value="2">女性 2名</option>
                        <option value="3">女性 3名</option>
                        <option value="4">女性 4名</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">コメント <span style="color:var(--text-3);font-weight:400;">（任意）</span></label>
                <textarea class="form-textarea" id="form-comment" maxlength="500" placeholder="状況や注意点など自由に記入してください..." oninput="hotelFormState.comment=this.value"></textarea>
                <div style="font-size:11px;color:var(--text-3);margin-top:6px;line-height:1.7;">
                    ${(typeof MODE !== 'undefined' ? MODE : 'men') === 'women'
                        ? '※お店名・セラピスト情報・ホテルの批判・URL・電話番号を含む投稿は非表示となります'
                        : '※お店名・キャスト情報・ホテルの批判・URL・電話番号を含む投稿は非表示となります'}
                </div>
            </div>
            <button class="btn-submit" id="btn-submit" onclick="hotelSubmitReport()">確認画面に進む</button>
        </div>
        <div style="display:flex; justify-content:center; gap:16px; padding:14px 20px; margin-top:12px; background:#fff; border:1px solid #e0d5d0; border-radius:8px; font-size:13px;">
            <a href="#" onclick="openHotelRequestModal();return false;" style="color:#8b5e6b; text-decoration:none; padding:6px 16px; border:1px solid #d4b8c1; border-radius:20px; background:#fdf6f8; font-size:12px; white-space:nowrap;">📝 未掲載ホテル情報提供</a>
            <a href="/shop-register.html" style="color:#8b5e6b; text-decoration:none; padding:6px 16px; border:1px solid #d4b8c1; border-radius:20px; background:#fdf6f8; font-size:12px; white-space:nowrap;">🏪 店舗様・掲載用はこちら</a>
        </div>
    </div>`;
}

function updatePostDatetime() {
    const el = document.getElementById('post-datetime');
    if (!el) return;
    const now = new Date();
    const fmt = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    el.textContent = fmt;
    // 1分ごとに更新
    setTimeout(updatePostDatetime, 60000);
}

function hotelSetCanCall(val) {
    hotelFormState.can_call = val;
    document.getElementById('btn-can').classList.toggle('active', val === true);
    document.getElementById('btn-cannot').classList.toggle('active', val === false);
    if (val) {
        // 呼べた → 理由選択モーダルを先に表示
        hotelFormState.cannot_call_reasons.clear();
        const cd = document.getElementById('cannot-reasons-display');
        if (cd) cd.innerHTML = '';
        showCanReasonsModal();
    } else {
        // 呼べなかった → 理由選択モーダルを表示
        hotelFormState.can_call_reasons.clear();
        const cd = document.getElementById('can-reasons-display');
        if (cd) cd.innerHTML = '';
        hotelFormState.conditions.clear();
        hotelFormState.time_slot = '';
        const tsEl = document.getElementById('form-time-slot');
        if (tsEl) tsEl.value = '';
        showCannotReasonsModal();
    }
}

// ==========================================================================
// 呼べた理由モーダル
// ==========================================================================
function showCanReasonsModal() {
    hotelFormState.can_call_reasons.clear();
    const checkboxes = document.getElementById('can-reasons-checkboxes');
    checkboxes.innerHTML = CAN_CALL_REASONS.map((r, i) => {
        const narrow = CAN_CALL_REASONS_NARROW[r] || r;
        return `
        <label id="cr-${i}" onclick="toggleCanReason(${i})"
            style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-3,#f0ebe0);border:2px solid var(--border,rgba(180,150,100,0.18));border-radius:8px;cursor:pointer;transition:all 0.15s;">
            <span class="cr-check" style="width:18px;height:18px;border:2px solid rgba(180,150,100,0.4);border-radius:4px;background:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:transparent;"></span>
            <span class="cr-label-full" style="font-size:13px;font-weight:500;color:var(--text,#1a1410);">${r}</span>
            <span class="cr-label-narrow" style="font-size:13px;font-weight:500;color:var(--text,#1a1410);">${narrow}</span>
        </label>`;
    }).join('');
    document.getElementById('can-reasons-modal').style.display = 'flex';
}

function toggleCanReason(idx) {
    const reason = CAN_CALL_REASONS[idx];
    const el = document.getElementById(`cr-${idx}`);
    const check = el.querySelector('.cr-check');
    if (hotelFormState.can_call_reasons.has(reason)) {
        hotelFormState.can_call_reasons.delete(reason);
        el.style.borderColor = '';
        el.style.background = '';
        check.textContent = '';
        check.style.background = '#fff';
        check.style.borderColor = 'rgba(180,150,100,0.4)';
        check.style.color = 'transparent';
    } else {
        hotelFormState.can_call_reasons.add(reason);
        el.style.borderColor = 'rgba(58,154,96,0.5)';
        el.style.background = 'rgba(58,154,96,0.06)';
        check.textContent = '✓';
        check.style.background = '#3a9a60';
        check.style.borderColor = '#3a9a60';
        check.style.color = '#fff';
    }
}

function cancelCanReasons() {
    document.getElementById('can-reasons-modal').style.display = 'none';
    hotelFormState.can_call = null;
    hotelFormState.can_call_reasons.clear();
    document.getElementById('btn-can').classList.remove('active');
}

// ==========================================================================
// 呼べなかった理由モーダル
// ==========================================================================
function showCannotReasonsModal() {
    hotelFormState.cannot_call_reasons.clear();
    const checkboxes = document.getElementById('cannot-reasons-checkboxes');
    checkboxes.innerHTML = CANNOT_CALL_REASONS.map((r, i) => `
        <label id="cnr-${i}" onclick="toggleCannotReason(${i})"
            style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-3,#f0ebe0);border:2px solid var(--border,rgba(180,150,100,0.18));border-radius:8px;cursor:pointer;transition:all 0.15s;">
            <span class="cnr-check" style="width:18px;height:18px;border:2px solid rgba(180,150,100,0.4);border-radius:4px;background:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:transparent;"></span>
            <span style="font-size:13px;font-weight:500;color:var(--text,#1a1410);">${r}</span>
        </label>`).join('');
    document.getElementById('cannot-reasons-modal').style.display = 'flex';
}

function toggleCannotReason(idx) {
    const reason = CANNOT_CALL_REASONS[idx];
    const el = document.getElementById(`cnr-${idx}`);
    const check = el.querySelector('.cnr-check');
    if (hotelFormState.cannot_call_reasons.has(reason)) {
        hotelFormState.cannot_call_reasons.delete(reason);
        el.style.borderColor = '';
        el.style.background = '';
        check.textContent = '';
        check.style.background = '#fff';
        check.style.borderColor = 'rgba(180,150,100,0.4)';
        check.style.color = 'transparent';
    } else {
        hotelFormState.cannot_call_reasons.add(reason);
        el.style.borderColor = 'rgba(192,80,80,0.5)';
        el.style.background = 'rgba(192,80,80,0.06)';
        check.textContent = '✓';
        check.style.background = '#c05050';
        check.style.borderColor = '#c05050';
        check.style.color = '#fff';
    }
}

function cancelCannotReasons() {
    document.getElementById('cannot-reasons-modal').style.display = 'none';
    hotelFormState.can_call = null;
    hotelFormState.cannot_call_reasons.clear();
    document.getElementById('btn-cannot').classList.remove('active');
}

function confirmCannotReasons() {
    document.getElementById('cannot-reasons-modal').style.display = 'none';
    const display = document.getElementById('cannot-reasons-display');
    if (display) {
        const selected = [...hotelFormState.cannot_call_reasons];
        display.innerHTML = selected.length > 0
            ? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:6px 0 2px;">
                <span style="font-size:11px;color:var(--text-3);">呼べなかった理由：</span>
                ${selected.map(r => `<span style="padding:3px 9px;background:rgba(192,80,80,0.1);border:1px solid rgba(192,80,80,0.3);border-radius:10px;font-size:11px;color:#c05050;font-weight:600;">${r}</span>`).join('')}
                <button onclick="showCannotReasonsModal()" style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:10px;background:transparent;cursor:pointer;color:var(--text-3);">変更</button>
               </div>`
            : `<div style="padding:4px 0;"><button onclick="showCannotReasonsModal()" style="font-size:12px;padding:4px 12px;border:1px dashed rgba(192,80,80,0.4);border-radius:10px;background:transparent;cursor:pointer;color:#c05050;">＋ 呼べなかった理由を選択（任意）</button></div>`;
    }
}

function confirmCanReasons() {
    document.getElementById('can-reasons-modal').style.display = 'none';
    // 選択済み理由を表示
    const display = document.getElementById('can-reasons-display');
    if (display) {
        const selected = [...hotelFormState.can_call_reasons];
        display.innerHTML = selected.length > 0
            ? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:6px 0 2px;">
                <span style="font-size:11px;color:var(--text-3);">呼べた理由：</span>
                ${selected.map(r => `<span style="padding:3px 9px;background:rgba(58,154,96,0.1);border:1px solid rgba(58,154,96,0.3);border-radius:10px;font-size:11px;color:#3a9a60;font-weight:600;">${r}</span>`).join('')}
                <button onclick="showCanReasonsModal()" style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:10px;background:transparent;cursor:pointer;color:var(--text-3);">変更</button>
               </div>`
            : `<div style="padding:4px 0;"><button onclick="showCanReasonsModal()" style="font-size:12px;padding:4px 12px;border:1px dashed rgba(58,154,96,0.4);border-radius:10px;background:transparent;cursor:pointer;color:#3a7a50;">＋ 呼べた理由を選択（任意）</button></div>`;
    }
}

function hotelToggleTimeSlot(idx) {
    const slot = TIME_SLOTS[idx];
    const el = document.getElementById(`ts-${idx}`);
    if (!el) { console.warn('[timeslot] element not found: ts-' + idx); return; }

    const isSame = hotelFormState.time_slot === slot;

    // 全ボタンをリセット
    TIME_SLOTS.forEach((_, i) => {
        const btn = document.getElementById(`ts-${i}`);
        if (btn) {
            btn.style.background = 'var(--bg-3)';
            btn.style.borderColor = 'var(--border)';
            btn.style.color = 'var(--text-2)';
            btn.style.fontWeight = '400';
        }
    });

    if (isSame) {
        // 同じボタンを再クリック → 解除
        hotelFormState.time_slot = '';
        console.log('[timeslot] deselected:', slot);
    } else {
        // 別のボタン → 選択切り替え
        hotelFormState.time_slot = slot;
        el.style.background = 'var(--accent-bg)';
        el.style.borderColor = 'var(--border-strong)';
        el.style.color = 'var(--accent-dim)';
        el.style.fontWeight = '600';
        console.log('[timeslot] selected:', slot);
    }
}

function hotelToggleCondition(cond) {
    const el = document.getElementById(`cond-${cond}`);
    if (hotelFormState.conditions.has(cond)) {
        hotelFormState.conditions.delete(cond);
        el.classList.remove('checked');
    } else {
        hotelFormState.conditions.add(cond);
        el.classList.add('checked');
    }
}

async function voteReport(reportId, vote) {
    const fp = btoa([navigator.userAgent, screen.width+'x'+screen.height, Intl.DateTimeFormat().resolvedOptions().timeZone].join('|')).slice(0,32);

    const { error } = await supabaseClient.from('report_votes').insert({
        report_id: reportId,
        fingerprint: fp,
        vote: vote
    });

    if (error) {
        if (error.code === '23505') {
            showToast('既に評価済みです');
        } else {
            showToast('評価に失敗しました');
        }
        return;
    }

    // カウントをリアルタイム更新
    const countEl = document.getElementById(`${vote === 'helpful' ? 'helpful' : 'unhelpful'}-count-${reportId}`);
    if (countEl) countEl.textContent = parseInt(countEl.textContent || '0') + 1;

    // ボタンを押したことを視覚的に表示
    const btnEl = document.getElementById(`vote-${vote}-${reportId}`);
    if (btnEl) {
        btnEl.style.background = vote === 'helpful' ? 'rgba(58,154,96,0.1)' : 'rgba(192,80,80,0.08)';
        btnEl.style.borderColor = vote === 'helpful' ? 'rgba(58,154,96,0.3)' : 'rgba(192,80,80,0.25)';
        btnEl.style.color = vote === 'helpful' ? '#3a9a60' : '#c05050';
    }

    // unhelpfulが3以上の投稿は折りたたむ
    if (vote === 'unhelpful') {
        const unhelpfulCount = parseInt(document.getElementById(`unhelpful-count-${reportId}`)?.textContent || '0');
        if (unhelpfulCount >= 3) {
            const card = btnEl?.closest('div[style*="border-radius:10px"]');
            if (card) {
                card.style.opacity = '0.5';
                card.innerHTML = `<div style="font-size:12px;color:var(--text-3);text-align:center;padding:8px;cursor:pointer;" onclick="this.parentElement.style.opacity='1';this.parentElement.innerHTML='';">
                    ⚠️ 低評価が多い投稿です（タップで表示）
                </div>` + card.innerHTML;
            }
        }
    }

    showToast(vote === 'helpful' ? '👍 参考になりました' : '👎 評価しました');
}

function hotelSubmitReport() {
    if (hotelFormState.can_call === null) {
        showToast('「呼べた」か「呼べなかった」を選択してください');
        return;
    }
    showPostConfirmModal();
}

function showPostConfirmModal() {
    // モーダルを開くたびにボタン状態を必ずリセット
    const doBtn = document.getElementById('btn-do-submit');
    if (doBtn) { doBtn.disabled = false; doBtn.textContent = 'この内容で投稿する'; }

    const s = hotelFormState;
    const posterName = s.poster_name?.trim() || '匿名希望';
    const resultText = s.can_call ? '✅ 呼べた' : '❌ 呼べなかった';
    const resultColor = s.can_call ? '#3a9a60' : '#c05050';
    const reasons = s.can_call ? [...s.can_call_reasons] : [...s.cannot_call_reasons];
    const reasonLabel = s.can_call ? '呼べた理由' : '呼べなかった理由';
    const timeSlot = s.time_slot || '';

    function row(label, value) {
        if (!value) return '';
        return `<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(180,150,100,0.15);">
            <div style="font-size:12px;color:#8a7a6a;width:90px;flex-shrink:0;padding-top:1px;">${label}</div>
            <div style="font-size:13px;color:#1a1410;flex:1;line-height:1.6;">${value}</div>
        </div>`;
    }

    function tags(arr, color) {
        if (!arr || arr.length === 0) return null;
        return arr.map(r => `<span style="display:inline-block;padding:3px 9px;background:${color}1a;border:1px solid ${color}40;border-radius:10px;font-size:11px;color:${color};margin:2px 2px 2px 0;">${r}</span>`).join('');
    }

    const content = `
        ${row('投稿者名', posterName)}
        <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(180,150,100,0.15);">
            <div style="font-size:12px;color:#8a7a6a;width:90px;flex-shrink:0;padding-top:1px;">結果</div>
            <div style="font-size:13px;font-weight:700;color:${resultColor};">${resultText}</div>
        </div>
        ${reasons.length > 0 ? `<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(180,150,100,0.15);">
            <div style="font-size:12px;color:#8a7a6a;width:90px;flex-shrink:0;padding-top:4px;">${reasonLabel}</div>
            <div style="flex:1;">${tags(reasons, s.can_call ? '#3a9a60' : '#c05050')}</div>
        </div>` : ''}
        ${timeSlot ? `<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(180,150,100,0.15);">
            <div style="font-size:12px;color:#8a7a6a;width:90px;flex-shrink:0;padding-top:1px;">時間帯</div>
            <div style="font-size:13px;color:#1a1410;">${timeSlot}</div>
        </div>` : ''}
        ${row('部屋タイプ', s.room_type || null)}
        ${row('コメント', s.comment || null)}
    `;

    document.getElementById('post-confirm-content').innerHTML = content;
    document.getElementById('post-confirm-modal').style.display = 'flex';
}

function closePostConfirmModal() {
    document.getElementById('post-confirm-modal').style.display = 'none';
}

async function doSubmitReport() {
    const doBtn = document.getElementById('btn-do-submit');
    if (doBtn) { doBtn.disabled = true; doBtn.textContent = '送信中...'; }

    // 承認済み店舗セッションチェック
    let posterType = 'user';
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session?.user?.email) {
            const { data: shopRow } = await supabaseClient
                .from('shops')
                .select('id,is_approved')
                .eq('email', session.user.email)
                .eq('is_approved', true)
                .maybeSingle();
            if (shopRow) posterType = 'shop';
        }
    } catch (_) {}

    const fingerprint = btoa([navigator.userAgent, screen.width+'x'+screen.height, Intl.DateTimeFormat().resolvedOptions().timeZone].join('|')).slice(0,32);
    const payload = {
        hotel_id: currentHotelId,
        can_call: hotelFormState.can_call,
        poster_type: posterType,
        can_call_reasons: hotelFormState.can_call ? [...hotelFormState.can_call_reasons] : [],
        cannot_call_reasons: !hotelFormState.can_call ? [...hotelFormState.cannot_call_reasons] : [],
        time_slot: hotelFormState.time_slot || null,
        comment: hotelFormState.comment ? hotelFormState.comment.slice(0, 500) : null,
        poster_name: hotelFormState.poster_name?.trim() || '無記名',
        room_type: hotelFormState.room_type || null,
        multi_person: hotelFormState.multi_person || false,
        // 単一人数モード時: 男性モード→male=1,female=0 / 女性モード→male=0,female=1
        guest_male: hotelFormState.multi_person ? hotelFormState.guest_male
            : (MODE === 'women' || MODE === 'women_same' ? 0 : 1),
        guest_female: hotelFormState.multi_person ? hotelFormState.guest_female
            : (MODE === 'women' || MODE === 'women_same' ? 1 : 0),
        gender_mode: typeof MODE !== 'undefined' ? MODE : 'men',
        fingerprint,
    };
    console.log('[submit] payload:', JSON.stringify(payload, null, 2));

    const { error } = await supabaseClient.from('reports').insert(payload);

    if (error) {
        console.error('[submit] error:', error);
        closePostConfirmModal();
        if (doBtn) { doBtn.disabled = false; doBtn.textContent = 'この内容で投稿する'; }
        if (error.code === '23505') {
            showToast('このホテルへは既に投稿済みです');
        } else {
            alert('送信エラー:\n' + (error.message || JSON.stringify(error)));
        }
        return;
    }
    closePostConfirmModal();
    if (doBtn) { doBtn.disabled = false; doBtn.textContent = 'この内容で投稿する'; }
    showSuccessModal('投稿ありがとうございます！', '口コミが投稿されました。');
    setTimeout(() => loadHotelDetail(currentHotelId), 1500);
}

// ==========================================================================
// 投稿報告
// ==========================================================================
let flagTargetId = null;
let flagSelectedReason = null;
let flagTargetTable = 'reports';

function showFlagModal(reportId, table) {
    if (!reportId || reportId === 'null' || reportId === 'undefined') {
        console.error('[flag] showFlagModal called with invalid id:', reportId);
        showToast('報告対象が取得できませんでした');
        return;
    }
    flagTargetId = reportId;
    flagTargetTable = table || 'reports';
    flagSelectedReason = null;
    document.getElementById('flag-comment-input').value = '';
    document.getElementById('flag-reason-err').style.display = 'none';
    // ボタンをリセット
    document.querySelectorAll('#flag-reason-btns button').forEach(b => {
        b.style.background = 'var(--bg-3,#f0ebe0)';
        b.style.borderColor = 'rgba(180,150,100,0.25)';
        b.style.fontWeight = '400';
        b.style.color = '#1a1410';
    });
    document.getElementById('flag-step1').style.display = '';
    document.getElementById('flag-step2').style.display = 'none';
    document.getElementById('flag-modal').style.display = 'flex';
}

function openFlagModal(reportId) { showFlagModal(reportId, 'loveho_reports'); }
function closeFlagModal() {
    document.getElementById('flag-modal').style.display = 'none';
    flagTargetId = null;
    flagSelectedReason = null;
    flagTargetTable = 'reports';
}

function selectFlagReason(reason, btn) {
    // 同じボタンを再クリックで選択解除
    if (flagSelectedReason === reason) {
        flagSelectedReason = null;
        btn.style.background = 'var(--bg-3,#f0ebe0)';
        btn.style.borderColor = 'rgba(180,150,100,0.25)';
        btn.style.fontWeight = '400';
        btn.style.color = '#1a1410';
        return;
    }
    flagSelectedReason = reason;
    document.getElementById('flag-reason-err').style.display = 'none';
    // 全ボタンをリセット → 選択ボタンをハイライト
    document.querySelectorAll('#flag-reason-btns button').forEach(b => {
        b.style.background = 'var(--bg-3,#f0ebe0)';
        b.style.borderColor = 'rgba(180,150,100,0.25)';
        b.style.fontWeight = '400';
        b.style.color = '#1a1410';
    });
    btn.style.background = 'rgba(192,80,80,0.08)';
    btn.style.borderColor = 'rgba(192,80,80,0.4)';
    btn.style.fontWeight = '700';
    btn.style.color = '#c05050';
}

function showFlagStep1() {
    document.getElementById('flag-step1').style.display = '';
    document.getElementById('flag-step2').style.display = 'none';
}

function showFlagConfirm() {
    if (!flagSelectedReason) {
        document.getElementById('flag-reason-err').style.display = 'block';
        return;
    }
    const comment = document.getElementById('flag-comment-input').value.trim();
    document.getElementById('flag-confirm-reason').textContent = flagSelectedReason;
    const cWrap = document.getElementById('flag-confirm-comment-wrap');
    if (comment) {
        cWrap.style.display = '';
        document.getElementById('flag-confirm-comment').textContent = comment;
    } else {
        cWrap.style.display = 'none';
    }
    document.getElementById('flag-step1').style.display = 'none';
    document.getElementById('flag-step2').style.display = '';
}

async function submitFlag() {
    // closeFlagModal() が flagTargetId を null にリセットするため、先にローカル変数へ退避
    const targetId = flagTargetId;
    const selectedReason = flagSelectedReason;
    const tbl = flagTargetTable || 'reports';

    if (!targetId || targetId === 'null' || targetId === 'undefined') {
        console.error('[flag] invalid targetId:', targetId);
        showToast('報告対象が不明です。ページを再読み込みしてください。');
        return;
    }
    if (!selectedReason) return;

    const flag_comment = document.getElementById('flag-comment-input').value.trim() || null;
    const flagPayload = {
        flagged_at: new Date().toISOString(),
        flag_reason: selectedReason,
        flag_comment,
    };
    console.log('[flag] targetId:', targetId, 'payload:', flagPayload);

    closeFlagModal();

    const { error } = await supabaseClient.from(tbl).update(flagPayload).eq('id', targetId);
    if (error) {
        console.error('[flag] error:', error);
        showToast('報告の送信に失敗しました: ' + error.message);
    } else {
        showToast('🚩 報告を受け付けました。ご協力ありがとうございます。');
    }
}

// ==========================================================================
// ホテル追加申請モーダル
// ==========================================================================
const HOTEL_TYPE_LABELS = {
    business: 'ビジネスホテル', city: 'シティホテル', resort: 'リゾートホテル',
    ryokan: '旅館', pension: 'ペンション', minshuku: '民宿',
    love_hotel: 'ラブホテル', rental_room: 'レンタルルーム', other: 'その他',
};

function openHotelRequestModal() {
    document.getElementById('hreq-name').value = '';
    document.getElementById('hreq-address').value = '';
    document.getElementById('hreq-tel').value = '';
    document.getElementById('hreq-type').value = 'business';
    document.getElementById('hreq-err').style.display = 'none';
    document.getElementById('hreq-step1').style.display = '';
    document.getElementById('hreq-step2').style.display = 'none';
    document.getElementById('hreq-done').style.display = 'none';
    document.getElementById('hotel-request-modal').style.display = 'flex';
}

function closeHotelRequestModal() {
    document.getElementById('hotel-request-modal').style.display = 'none';
}

function hreqToConfirm() {
    const name = document.getElementById('hreq-name').value.trim();
    const address = document.getElementById('hreq-address').value.trim();
    const errEl = document.getElementById('hreq-err');
    if (!name || !address) {
        errEl.textContent = 'ホテル名と住所は必須です';
        errEl.style.display = 'block';
        return;
    }
    errEl.style.display = 'none';

    const tel = document.getElementById('hreq-tel').value.trim();
    const type = document.getElementById('hreq-type').value;
    const rows = [
        ['ホテル名', name],
        ['住所', address],
        ...(tel ? [['電話番号', tel]] : []),
        ['タイプ', HOTEL_TYPE_LABELS[type] || type],
    ];
    document.getElementById('hreq-confirm-body').innerHTML = rows.map(([k, v]) =>
        `<div><span style="font-size:11px;color:#8a7a6a;font-weight:700;">${k}</span><div style="font-size:13px;color:#1a1410;margin-top:2px;">${v}</div></div>`
    ).join('');

    document.getElementById('hreq-step1').style.display = 'none';
    document.getElementById('hreq-step2').style.display = '';
}

function hreqBack() {
    document.getElementById('hreq-step2').style.display = 'none';
    document.getElementById('hreq-step1').style.display = '';
}

async function submitHotelRequest() {
    const btn = document.getElementById('hreq-submit-btn');
    btn.disabled = true;
    btn.textContent = '送信中...';

    const name = document.getElementById('hreq-name').value.trim();
    const address = document.getElementById('hreq-address').value.trim();
    const tel = document.getElementById('hreq-tel').value.trim() || null;
    const type = document.getElementById('hreq-type').value;

    const { error } = await supabaseClient.from('hotel_requests').insert({
        hotel_name: name, address, tel, hotel_type: type, status: 'pending',
    });

    btn.disabled = false;
    btn.textContent = '送信する';

    if (error) {
        showToast('送信に失敗しました: ' + error.message);
        return;
    }

    closeHotelRequestModal();
    showSuccessModal('送信ありがとうございます！', 'ホテル情報を受け付けました。確認後、掲載いたします。');
}

// ==========================================================================
// 初期化
// ==========================================================================
// Escapeキーでモーダルを閉じる
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modals = [
            { id: 'success-modal', close: closeSuccessModal },
            { id: 'can-reasons-modal', close: cancelCanReasons },
            { id: 'cannot-reasons-modal', close: cancelCannotReasons },
            { id: 'post-confirm-modal', close: closePostConfirmModal },
            { id: 'flag-modal', close: closeFlagModal },
            { id: 'hotel-request-modal', close: closeHotelRequestModal },
        ];
        for (const { id, close } of modals) {
            const el = document.getElementById(id);
            if (el && el.style.display !== 'none' && el.style.display !== '') {
                close();
                break;
            }
        }
    }
});

window.onload = async () => {
    // localStorageから言語設定を復元
    const savedLang = localStorage.getItem('yobuho_lang');
    if (savedLang && savedLang !== 'ja') {
        changeLang(savedLang);
    }
    await initShopMode();
    restoreFromUrl();
};