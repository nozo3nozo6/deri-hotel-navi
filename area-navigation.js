// ==========================================================================
// area-navigation.js — エリア選択、ページ遷移、URL状態管理
// 静的JSON (area-data.json) から事前計算済みデータを読み込み、
// Supabase APIコールなしでエリアナビを描画する。
// ==========================================================================

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
let currentPage = null;
let _skipPushState = false;
let _areaGeneration = 0;
let _areaData = null;

// AppState 登録（状態の発見・デバッグ用）
Object.defineProperties(AppState.nav, {
    pageStack:       { get() { return pageStack; },       set(v) { pageStack = v; } },
    currentPage:     { get() { return currentPage; },     set(v) { currentPage = v; } },
    _skipPushState:  { get() { return _skipPushState; },  set(v) { _skipPushState = v; } },
    _areaGeneration: { get() { return _areaGeneration; }, set(v) { _areaGeneration = v; } },
});

// ==========================================================================
// 静的JSONローダー（1回だけfetch、以降はメモリキャッシュ）
// ==========================================================================
async function loadAreaData() {
    if (_areaData) return _areaData;
    try {
        const res = await fetch('/area-data.json');
        if (!res.ok) return null;
        _areaData = await res.json();
        return _areaData;
    } catch(e) { return null; }
}

function findRegionByPref(pref) {
    return REGION_MAP.find(r => r.prefs.includes(pref));
}
function isSinglePrefRegion(region) {
    return region && region.prefs.length === 1;
}
function regionBreadcrumb(region) {
    // 1県のみの地方（北海道・沖縄）はパンくずで地方ラベルを省略
    if (isSinglePrefRegion(region)) return [];
    return [{ label: region.label, handler: () => showPrefPage(region) }];
}

function findRegionByLabel(label) {
    return REGION_MAP.find(r => r.label === label);
}

// MODE → URLパスセグメント
const MODE_PATH_MAP = { men: 'deli', women: 'jofu', men_same: 'same-m', women_same: 'same-f', este: 'este' };
const PATH_MODE_MAP = { 'deli': 'men', 'jofu': 'women', 'same-m': 'men_same', 'same-f': 'women_same', 'este': 'este' };

function getModePath() {
    return MODE_PATH_MAP[window.MODE] || 'deli';
}

function buildUrl(params) {
    const base = '/' + getModePath();
    const p = params || {};
    let path = base;
    // 店舗専用URL: /deli/shop/slug/ パスベース（ホテル詳細含め常に維持）
    if (SHOP_SLUG) {
        path += '/shop/' + encodeURIComponent(SHOP_SLUG) + '/';
    } else if (p.hotel) {
        // ホテル詳細クリーンURL: /deli/hotel/29599
        path += '/hotel/' + p.hotel;
    } else if (p.pref) {
        path += '/' + encodeURIComponent(p.pref);
        if (p.area) path += '/' + encodeURIComponent(p.area);
        if (p.detail) path += '/' + encodeURIComponent(p.detail);
        if (p.city) path += '/' + encodeURIComponent(p.city);
    }
    const qs = new URLSearchParams();
    if (p.tab) qs.set('tab', p.tab);
    // 地方ページ用: regionクエリパラメータを保持（パスに含まれないため）
    if (p.region) qs.set('region', p.region);
    // キーワード検索用: qクエリパラメータを保持
    if (p.q) qs.set('q', p.q);
    // 駅検索用: stationクエリパラメータを保持
    if (p.station) qs.set('station', p.station);
    // 店舗モード時にエリアパラメータ+ホテルIDもクエリで維持
    if (SHOP_SLUG && p.pref) qs.set('pref', p.pref);
    if (SHOP_SLUG && p.area) qs.set('area', p.area);
    if (SHOP_SLUG && p.city) qs.set('city', p.city);
    if (SHOP_SLUG && p.hotel) qs.set('hotel', p.hotel);
    const qsStr = qs.toString();
    return path + (qsStr ? '?' + qsStr : '');
}

function updateUrl(params) {
    if (_skipPushState) return;
    history.pushState(null, '', buildUrl(params));
}

function goToNationalTop() {
    if (typeof leaveHotelDetail === 'function') leaveHotelDetail();
    // 法的ページSPA表示中なら先にクリーンアップ
    if (typeof _legalActive !== 'undefined' && _legalActive && typeof closeLegalPage === 'function') closeLegalPage();
    // showJapanPage()内でupdateUrl({})が呼ばれるため、ここでは追加のpushStateは不要
    if (typeof showJapanPage === 'function') showJapanPage();
}

function ensurePortalMode() {
    const content = document.getElementById('hotel-detail-content');
    if (content && content.style.display !== 'none') {
        closeHotelPanel();
    }
    const st = document.querySelector('.search-tools');
    if (st) st.style.display = 'flex';
}

// 店舗URLの全国ページに LP コンテンツを追加するヘルパー
function appendShopModeLpContent() {
    const hlc = document.getElementById('hotel-list');
    if (!hlc || hlc.querySelector('.shop-lp-content')) return;
    const mode = window.MODE || 'men';
    const heroMap = {
        men: 'デリヘルを呼べるホテル検索',
        women: '女性用風俗を呼べるホテル検索',
        men_same: '男性同士で利用できるホテル検索',
        women_same: '女性同士で利用できるホテル検索',
        este: 'デリエステを呼べるホテル検索'
    };
    const hero = heroMap[mode] || 'YobuHoで呼べるホテルを検索';
    hlc.insertAdjacentHTML('beforeend', `
        <div class="shop-lp-content" style="margin-top:20px;">
            <div style="text-align:center;padding:20px 16px 8px;">
                <p style="font-size:1.1em;font-weight:700;color:var(--accent);margin:0 0 6px;">${hero}</p>
                <p style="font-size:13px;color:var(--text-2);margin:0;">全国43,000件以上のホテルから最適なホテルを見つけよう</p>
            </div>
            <div style="padding:12px 4px;">
                <p style="font-size:12px;font-weight:700;color:var(--text);margin:0 0 10px;text-align:center;">なぜYobuHoの情報は信頼できるのか</p>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
                    <div style="background:var(--bg-3);border:1px solid var(--border);border-radius:8px;padding:10px 6px;text-align:center;">
                        <div style="font-size:1.4em;margin-bottom:4px;">💬</div>
                        <div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:3px;">実体験口コミ</div>
                        <div style="font-size:11px;color:var(--text-2);line-height:1.4;">実際に利用した方の投稿情報</div>
                    </div>
                    <div style="background:var(--bg-3);border:1px solid var(--border);border-radius:8px;padding:10px 6px;text-align:center;">
                        <div style="font-size:1.4em;margin-bottom:4px;">🏪</div>
                        <div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:3px;">店舗の公式情報</div>
                        <div style="font-size:11px;color:var(--text-2);line-height:1.4;">届出確認済み店舗の実績</div>
                    </div>
                    <div style="background:var(--bg-3);border:1px solid var(--border);border-radius:8px;padding:10px 6px;text-align:center;">
                        <div style="font-size:1.4em;margin-bottom:4px;">✅</div>
                        <div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:3px;">ダブルチェック</div>
                        <div style="font-size:11px;color:var(--text-2);line-height:1.4;">口コミ×店舗で高い信頼性</div>
                    </div>
                </div>
            </div>
            <div style="padding:4px 4px 16px;">
                <p style="font-size:12px;font-weight:700;color:var(--text);margin:0 0 10px;text-align:center;">使い方はかんたん3ステップ</p>
                <div style="display:flex;flex-direction:column;gap:6px;">
                    <div style="display:flex;align-items:flex-start;gap:10px;background:var(--bg-3);border-radius:8px;padding:9px 12px;">
                        <span style="font-size:1em;font-weight:700;color:var(--accent);min-width:22px;">01</span>
                        <div><div style="font-size:12px;font-weight:600;color:var(--text);">エリアを選ぶ</div><div style="font-size:11px;color:var(--text-2);">地方→都道府県→市区町村の順に絞り込み</div></div>
                    </div>
                    <div style="display:flex;align-items:flex-start;gap:10px;background:var(--bg-3);border-radius:8px;padding:9px 12px;">
                        <span style="font-size:1em;font-weight:700;color:var(--accent);min-width:22px;">02</span>
                        <div><div style="font-size:12px;font-weight:600;color:var(--text);">ホテルを選ぶ</div><div style="font-size:11px;color:var(--text-2);">口コミ件数・呼べた率でホテルを確認</div></div>
                    </div>
                    <div style="display:flex;align-items:flex-start;gap:10px;background:var(--bg-3);border-radius:8px;padding:9px 12px;">
                        <span style="font-size:1em;font-weight:700;color:var(--accent);min-width:22px;">03</span>
                        <div><div style="font-size:12px;font-weight:600;color:var(--text);">口コミを確認</div><div style="font-size:11px;color:var(--text-2);">実体験に基づいた情報で安心して利用</div></div>
                    </div>
                </div>
            </div>
        </div>
    `);
}

// info-links-bar を hotel-list に追加するヘルパー
async function appendRecentReviews() {
    if (typeof _shopParam !== 'undefined' && _shopParam) return;
    const mode = typeof MODE !== 'undefined' ? MODE : 'men';
    try {
        // ルール: 店舗投稿は該当ジャンル、ユーザー投稿は全ジャンル統一（APIが poster_type='user' OR gender_mode=mode で対応済み）
        const res = await fetch(`/api/recent-reviews.php?mode=${encodeURIComponent(mode)}&limit=30`);
        if (!res.ok) return;
        const reviews = await res.json();
        if (!reviews || !reviews.length) return;
        const _mp = typeof MODE_PATH_MAP !== 'undefined' ? MODE_PATH_MAP[mode] : '';
        const modePath = _mp ? `/${_mp}/` : '/deli/';
        const lines = reviews.map(function(r) {
            const d = r.created_at ? new Date(r.created_at) : null;
            const timeStr = d ? `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '';
            const name = typeof esc === 'function' ? esc(r.hotel_name) : r.hotel_name;
            const poster = r.poster_name ? (typeof esc === 'function' ? esc(r.poster_name) : r.poster_name) : (typeof t === 'function' ? t('anonymous') : '匿名');
            const hotelLink = `${modePath}hotel/${r.hotel_id}`;
            let badge = '';
            if (r.type === 'hotel') {
                badge = r.can_call ? '<span style="color:#3a9a60;font-weight:600;">✅</span>' : '<span style="color:#c05050;font-weight:600;">❌</span>';
            } else {
                badge = r.solo_entry === 'yes' ? '<span style="color:#3a9a60;">🚪</span>' : r.solo_entry === 'no' ? '<span style="color:#c05050;">🚪</span>' : '<span style="color:#a09080;">🏩</span>';
            }
            return `<a href="${hotelLink}" style="display:flex;align-items:center;gap:6px;padding:6px 0;font-size:12px;color:var(--text-2);text-decoration:none;border-bottom:1px solid var(--border,#eee);min-width:0;" class="hover-bg"><span style="color:var(--text-3);flex-shrink:0;">${timeStr}</span><span style="flex-shrink:0;">${badge}</span><span style="font-weight:600;color:var(--text);flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span></a>`;
        }).join('');
        const hlc = document.getElementById('hotel-list');
        if (hlc) {
            const title = typeof t === 'function' ? (t('recent_reviews') || '最新の口コミ') : '最新の口コミ';
            hlc.insertAdjacentHTML('beforeend', `<div style="padding:12px 14px;margin-top:8px;background:var(--bg-2,#fff);border:1px solid var(--border,#e0d5d0);border-radius:10px;max-width:100%;box-sizing:border-box;overflow:hidden;"><div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:6px;">💬 ${title}</div><div style="max-height:190px;overflow-y:auto;overflow-x:hidden;padding-right:4px;">${lines}</div></div>`);
        }
    } catch(e) { /* silent */ }
}

async function appendRecentShops() {
    if (typeof _shopParam !== 'undefined' && _shopParam) return;
    const mode = typeof MODE !== 'undefined' ? MODE : 'men';
    const _mp = typeof MODE_PATH_MAP !== 'undefined' ? MODE_PATH_MAP[mode] : '';
    const modePath = _mp ? `/${_mp}/` : '/deli/';
    try {
        const res = await fetch(`/api/recent-shops.php?mode=${encodeURIComponent(mode)}`);
        if (!res.ok) return;
        const shops = await res.json();
        if (!shops.length) return;
        const iconMap = { men: '♂', women: '♀', men_same: '♂♂', women_same: '♀♀', este: '💆‍♂️' };
        const _ext = typeof _extTarget !== 'undefined' ? _extTarget : '_blank';
        const lines = shops.map(s => {
            const _dm = s.approved_at ? String(s.approved_at).replace('T',' ').match(/(\d{4})-(\d{2})-(\d{2})/) : null;
            const dateStr = _dm ? `${_dm[2]}/${_dm[3]}` : '';
            const icon = iconMap[s.gender_mode] || '♂';
            const name = typeof esc === 'function' ? esc(s.shop_name) : s.shop_name;
            const shopLink = s.shop_url || (s.slug ? `${modePath}shop/${s.slug}/` : '');
            const nameHTML = shopLink ? `<a href="${shopLink}" target="${_ext}" rel="noopener" style="color:var(--accent,#9b2d35);font-weight:600;text-decoration:none;" class="hover-underline">${icon} ${name}</a>` : `<span style="color:var(--accent,#9b2d35);font-weight:600;">${icon} ${name}</span>`;
            return `<div style="font-size:13px;color:var(--text-2);padding:3px 0;"><span style="color:var(--text-3);margin-right:6px;">${dateStr}</span>${nameHTML} <span style="color:var(--text-3);">${t('shop_registered')}</span></div>`;
        }).join('');
        const hlc = document.getElementById('hotel-list');
        if (hlc) {
            const lpContent = hlc.querySelector('.shop-lp-content');
            const html = `<div class="recent-shops-section" style="padding:12px 16px;margin-top:12px;background:linear-gradient(135deg,#fffbf0 0%,#fff8e8 100%);border:1px solid #e8d9a8;border-left:4px solid #c9a96e;border-radius:8px;box-shadow:0 1px 4px rgba(201,169,110,0.1);">${lines}</div>`;
            if (lpContent) {
                lpContent.insertAdjacentHTML('beforebegin', html);
            } else {
                hlc.insertAdjacentHTML('beforeend', html);
            }
        }
    } catch(e) { /* silent */ }
}

function appendInfoLinksBar() {
    const hlc = document.getElementById('hotel-list');
    if (hlc && !hlc.querySelector('.info-links-bar')) {
        hlc.insertAdjacentHTML('beforeend', `
            <div class="info-links-bar" style="display:flex;justify-content:center;gap:16px;padding:14px 20px;margin-top:12px;background:#fff;border:1px solid #e0d5d0;border-radius:8px;">
                <a href="#" data-action="openHotelRequestModal" style="color:#8b5e6b;text-decoration:none;padding:6px 16px;border:1px solid #d4b8c1;border-radius:20px;background:#fdf6f8;font-size:12px;white-space:nowrap;">${t('hotel_not_listed')}</a>
                ${SHOP_ID ? '' : '<a href="/shop-register/?genre=' + (typeof MODE !== 'undefined' ? MODE : 'men') + '" style="color:#8b5e6b;text-decoration:none;padding:6px 16px;border:1px solid #d4b8c1;border-radius:20px;background:#fdf6f8;font-size:12px;white-space:nowrap;">' + t('shop_register_link') + '</a>'}
            </div>
        `);
    }
}

// 市区町村ボタンを描画するヘルパー (cities: [[name, hotelCount, lovehoCount], ...])
// 件数は全major_area合計を表示（市区町村ページと一致させるため）
var _renderPref = ''; // renderCityButtons用の都道府県コンテキスト
function renderCityButtons(container, cities, onCityClick) {
    container.innerHTML = '';
    cities.forEach(([city, hCount, lCount], i) => {
        // 全major_area合計で上書き
        if (_renderPref && typeof getCityTotalFromAreaData === 'function' && _areaData) {
            const total = getCityTotalFromAreaData(_renderPref, null, city);
            if (total) { hCount = total.hotel; lCount = total.loveho; }
        }
        const btn = document.createElement('button');
        btn.className = 'area-btn';
        btn.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
        btn.innerHTML = `
            <span class="city-name">${esc(city)}</span>
            <span style="display:flex;gap:4px;align-items:center;flex-shrink:0;">
                ${hCount > 0 ? `<span class="city-count">🏨${hCount}</span>` : ''}
                ${lCount > 0 ? `<span class="city-count" style="background:rgba(201,169,110,0.12);border-color:rgba(201,169,110,0.3);color:#c9a96e;">🏩${lCount}</span>` : ''}
            </span>`;
        btn.onclick = () => onCityClick(city);
        container.appendChild(btn);
    });
}

// URLパスからパラメータを抽出: /men/東京都/エリア/市区町村 → {pref, area, city}
function parseUrlPath() {
    const path = decodeURIComponent(window.location.pathname);
    const segments = path.split('/').filter(Boolean);
    // .htmlファイル名はパスパラメータではないので除去
    if (segments.length > 0 && segments[0].endsWith('.html')) segments.shift();
    // 先頭がモードパスか確認
    if (segments.length > 0 && PATH_MODE_MAP[segments[0]]) {
        segments.shift(); // モードセグメントを除去
    }
    const qs = new URLSearchParams(window.location.search);
    // ホテル詳細クリーンURL: /deli/hotel/29599
    const isHotelPath = segments[0] === 'hotel' && segments[1];
    // 店舗専用URL: /deli/shop/slug/ → パスセグメントを無視、クエリのみ使用
    const isShopPath = segments[0] === 'shop';
    return {
        pref: qs.get('pref') || (isShopPath || isHotelPath ? null : segments[0] || null),
        area: qs.get('area') || (isShopPath || isHotelPath ? null : segments[1] || null),
        detail: qs.get('detail') || (isShopPath || isHotelPath ? null : (segments.length >= 4 ? segments[2] : null)),
        city: qs.get('city') || (isShopPath || isHotelPath ? null : (segments.length >= 4 ? segments[3] : segments.length === 3 ? segments[2] : null)),
        hotel: qs.get('hotel') || (isHotelPath ? segments[1] : null),
        region: qs.get('region') || null,
        tab: qs.get('tab') || null,
        q: qs.get('q') || null,
        station: qs.get('station') || null,
    };
}

async function restoreFromUrl() {
    const searchTools = document.querySelector('.search-tools');
    if (searchTools) searchTools.style.display = 'flex';
    const params = parseUrlPath();
    _skipPushState = true;

    if (params.hotel) {
        const hotelId = parseInt(params.hotel);
        const hArr = await queryHotelsAPI({ hotel_id: hotelId, cols: 'hotel_type', limit: 1 });
        const h = hArr && hArr.length ? hArr[0] : null;
        const isLoveho = h && ['love_hotel', 'rental_room'].includes(h.hotel_type);
        showHotelPanel(hotelId, isLoveho);
        _skipPushState = false;
        return;
    }

    ensurePortalMode();

    // キーワード検索結果の復元
    if (params.q) {
        const kw = params.q;
        const kwInput = document.getElementById('keyword');
        if (kwInput) kwInput.value = kw;
        if (typeof executeKeywordSearch === 'function') executeKeywordSearch();
        _skipPushState = false;
        return;
    }

    // 駅検索結果の復元
    if (params.station) {
        const st = params.station;
        const stInput = document.getElementById('station-input');
        if (stInput) stInput.value = typeof formatStationName === 'function' ? formatStationName(st) : st;
        if (typeof fetchHotelsByStation === 'function') fetchHotelsByStation(st);
        _skipPushState = false;
        return;
    }

    if (params.city) {
        const { pref, area, detail, city } = params;
        const region = findRegionByPref(pref);
        // 3セグメントURL判別: cityがdetail_area名の場合はshowDetailAreaPageへ
        if (!detail && area && city) {
            const ad = await loadAreaData();
            const aKey = pref + '\t' + area;
            const aEntry = ad?.area?.[aKey];
            const isDetailArea = aEntry?.da?.some(([name]) => name === city);
            if (isDetailArea) {
                pageStack = [showJapanPage];
                if (region && !isSinglePrefRegion(region)) pageStack.push(() => showPrefPage(region));
                if (pref) pageStack.push(() => showMajorAreaPage(region, pref));
                pageStack.push(() => showCityPage(region, pref, area));
                showDetailAreaPage(region, pref, area, city);
                _skipPushState = false;
                return;
            }
        }
        pageStack = [showJapanPage];
        if (region && !isSinglePrefRegion(region)) pageStack.push(() => showPrefPage(region));
        if (pref && area) pageStack.push(() => showMajorAreaPage(region, pref));
        if (area) pageStack.push(() => showCityPage(region, pref, area));
        if (detail) pageStack.push(() => showDetailAreaPage(region, pref, area, detail));
        const filterObj = { prefecture: pref };
        if (area) filterObj.major_area = area;
        if (detail) filterObj.detail_area = detail;
        setBackBtn(true);
        fetchAndShowHotelsByCity(filterObj, city);
    } else if (params.detail) {
        const { pref, area, detail } = params;
        const region = findRegionByPref(pref);
        pageStack = [showJapanPage];
        if (region && !isSinglePrefRegion(region)) pageStack.push(() => showPrefPage(region));
        if (pref && area) pageStack.push(() => showMajorAreaPage(region, pref));
        if (area) pageStack.push(() => showCityPage(region, pref, area));
        showDetailAreaPage(region, pref, area, detail);
    } else if (params.area) {
        const { pref, area } = params;
        const region = findRegionByPref(pref);
        // 2セグメントURL判別: area-data.jsonに存在するエリア名か、市区町村名か
        const ad = await loadAreaData();
        const isValidArea = area === '_other' || ad?.pref?.[pref]?.areas?.some(([name]) => name === area);
        if (isValidArea) {
            pageStack = [showJapanPage];
            if (region && !isSinglePrefRegion(region)) pageStack.push(() => showPrefPage(region));
            if (pref) pageStack.push(() => showMajorAreaPage(region, pref));
            showCityPage(region, pref, area);
        } else {
            // areaではなくcity名 → ホテル一覧を直接表示
            pageStack = [showJapanPage];
            if (region && !isSinglePrefRegion(region)) pageStack.push(() => showPrefPage(region));
            if (pref) pageStack.push(() => showMajorAreaPage(region, pref));
            setBackBtn(true);
            fetchAndShowHotelsByCity({ prefecture: pref }, area);
        }
    } else if (params.pref) {
        const pref = params.pref;
        const region = findRegionByPref(pref);
        pageStack = [showJapanPage];
        if (region && !isSinglePrefRegion(region)) pageStack.push(() => showPrefPage(region));
        showMajorAreaPage(region, pref);
    } else if (params.region) {
        const region = findRegionByLabel(params.region);
        if (region) {
            pageStack = [showJapanPage];
            if (isSinglePrefRegion(region)) {
                showMajorAreaPage(region, region.prefs[0]);
            } else {
                showPrefPage(region);
            }
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
    const mapDetail = document.getElementById('map-detail-content');
    const isDetailVisible = (content && content.style.display !== 'none' && content.innerHTML !== '') ||
                            (mapDetail && mapDetail.style.display !== 'none' && mapDetail.innerHTML !== '');
    if (isDetailVisible) {
        // ホテル詳細表示中にブラウザ戻る → 詳細を閉じて一覧に戻る
        // 一覧のDOMは hidden 状態で残っているので leaveHotelDetail() で復元するだけでよい
        // restoreFromUrl() は呼ばない（再フェッチが走り画面がちらつくため）
        if (typeof leaveHotelDetail === 'function') leaveHotelDetail();
        return;
    }
    restoreFromUrl();
});

// ==========================================================================
// ページ描画
// ==========================================================================
function showJapanPage() {
    if(document.activeElement)document.activeElement.blur();
    window.scrollTo(0,0);
    ++_areaGeneration;
    if (typeof resetSearchInput === 'function') resetSearchInput();
    pageStack = [];
    currentPage = showJapanPage;
    updateUrl({});
    setTitle(t('select_area'));
    updatePageTitle('全国のホテル検索');
    setBackBtn(false);
    setBreadcrumb([{ label: t('japan') }]);
    clearHotelList();
    clearAds();
    loadAds('premium', '全国');

    const container = document.getElementById('area-button-container');
    container.innerHTML = '';
    container.className = 'area-grid region-level';

    // お気に入りボタン
    const favCount = typeof getFavorites === 'function' ? getFavorites().length : 0;
    if (favCount > 0) {
        const favBar = document.createElement('div');
        favBar.className = 'fav-bar';
        favBar.style.gridColumn = '1/-1';
        favBar.innerHTML = `<button id="fav-btn" class="fav-bar-btn" data-action="showFavoritesPage">⭐ ${t('favorites')} (<span id="fav-count">${favCount}</span>)</button>`;
        container.appendChild(favBar);
    }

    REGION_MAP.forEach((region, i) => {
        const btn = document.createElement('button');
        btn.className = 'area-btn has-children';
        btn.style.animationDelay = `${i * 0.04}s`;
        btn.textContent = region.label;
        btn.onclick = () => {
            pageStack.push(showJapanPage);
            if (isSinglePrefRegion(region)) {
                showMajorAreaPage(region, region.prefs[0]);
            } else {
                showPrefPage(region);
            }
        };
        container.appendChild(btn);
    });
    appendRecentReviews();
    appendInfoLinksBar();
    appendRecentShops();
    appendShopModeLpContent();
}

async function showPrefPage(region) {
    if(document.activeElement)document.activeElement.blur();
    window.scrollTo(0,0);
    if (typeof resetSearchInput === 'function') resetSearchInput();
    const gen = ++_areaGeneration;
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
    loadAds('region', region.label);

    const container = document.getElementById('area-button-container');
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);font-size:13px;">${t('loading')}</div>`;
    container.className = 'area-grid col-2';

    const ad = await loadAreaData();
    if (gen !== _areaGeneration) return;

    let sorted;
    if (ad && ad.prefCounts) {
        sorted = region.prefs
            .filter(p => (ad.prefCounts[p] || 0) > 0)
            .sort((a, b) => (ad.prefCounts[b] || 0) - (ad.prefCounts[a] || 0));
    } else {
        // フォールバック: PHP API
        const fbHotels = await queryHotelsAPI({ cols: 'prefecture', limit: 5000 });
        if (gen !== _areaGeneration) return;
        const prefCount = {};
        (fbHotels || []).forEach(h => { if (region.prefs.includes(h.prefecture)) prefCount[h.prefecture] = (prefCount[h.prefecture] || 0) + 1; });
        sorted = Object.keys(prefCount).filter(p => prefCount[p] > 0).sort((a, b) => prefCount[b] - prefCount[a]);
    }

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
    appendInfoLinksBar();
}

async function showMajorAreaPage(region, pref) {
    if(document.activeElement)document.activeElement.blur();
    window.scrollTo(0,0);
    if (typeof resetSearchInput === 'function') resetSearchInput();
    const gen = ++_areaGeneration;
    currentPage = () => showMajorAreaPage(region, pref);
    updateUrl({ pref });
    setTitle(pref);
    updatePageTitle(pref + 'のホテル検索');
    setBackBtn(true);
    setBreadcrumb([
        { label: t('japan'), onclick: 'showJapanPage()' },
        ...regionBreadcrumb(region),
        { label: pref }
    ]);
    clearHotelList();
    loadAds('big', pref);

    const container = document.getElementById('area-button-container');
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);font-size:13px;">${t('loading')}</div>`;
    container.className = 'area-grid col-2';

    const ad = await loadAreaData();
    if (gen !== _areaGeneration) return;

    let areas = [];
    let hasNoArea = false;

    if (ad && ad.pref && ad.pref[pref]) {
        areas = ad.pref[pref].areas.map(a => a[0]); // [[name, count], ...] -> [name, ...]
        hasNoArea = ad.pref[pref].hasNoArea;
    } else {
        // フォールバック: PHP API
        const maRows = await queryHotelsAPI({ pref, cols: 'major_area', limit: 5000 });
        if (gen !== _areaGeneration) return;
        const areaCount = {};
        (maRows || []).forEach(h => { if (h.major_area) areaCount[h.major_area] = (areaCount[h.major_area] || 0) + 1; });
        areas = Object.keys(areaCount).sort((a, b) => areaCount[b] - areaCount[a]);
        hasNoArea = (maRows || []).some(h => !h.major_area);
    }

    if (!areas.length && !hasNoArea) { container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);">${t('no_data')}</div>`; return; }

    buildAreaButtons(
        areas,
        () => { pageStack.push(() => showMajorAreaPage(region, pref)); fetchAndShowHotels({ prefecture: pref }); },
        (area) => { pageStack.push(() => showMajorAreaPage(region, pref)); showCityPage(region, pref, area); }
    );
    appendInfoLinksBar();
}

async function showCityPage(region, pref, majorArea) {
    _renderPref = pref;
    if(document.activeElement)document.activeElement.blur();
    window.scrollTo(0,0);
    if (typeof resetSearchInput === 'function') resetSearchInput();
    const gen = ++_areaGeneration;
    currentPage = () => showCityPage(region, pref, majorArea);
    updateUrl({ pref, area: majorArea });
    setTitle(majorArea);
    updatePageTitle(majorArea + 'のホテル検索');
    setBackBtn(true);
    setBreadcrumb([
        { label: t('japan'), onclick: 'showJapanPage()' },
        ...regionBreadcrumb(region),
        { label: pref, handler: () => showMajorAreaPage(region, pref) },
        { label: majorArea }
    ]);
    clearHotelList();


    const container = document.getElementById('area-button-container');
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);font-size:13px;">${t('loading')}</div>`;
    container.className = 'area-grid col-2';

    const ad = await loadAreaData();
    if (gen !== _areaGeneration) return;

    const areaKey = pref + '\t' + majorArea;
    const areaInfo = ad && ad.area && ad.area[areaKey];

    if (areaInfo) {
        // --- 静的JSONから描画 ---
        const detailAreas = areaInfo.da || [];
        const cities = areaInfo.ct || [];

        if (detailAreas.length === 1) {
            // detail_areaが1つだけ: スキップして直接そのdetail_areaを表示
            suppressAds();
            pageStack.push(() => showCityPage(region, pref, majorArea));
            showDetailAreaPage(region, pref, majorArea, detailAreas[0][0]);
            return;
        }
        if (detailAreas.length > 1) {
            // 詳細エリア一覧を表示
            loadAds('area', majorArea);
            container.innerHTML = '';
            detailAreas.forEach(([area, count], i) => {
                const btn = document.createElement('button');
                btn.className = 'area-btn';
                btn.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
                btn.innerHTML = `<span class="city-name">${esc(area)}</span><span class="city-count">${count}</span>`;
                btn.onclick = () => { pageStack.push(() => showCityPage(region, pref, majorArea)); showDetailAreaPage(region, pref, majorArea, area); };
                container.appendChild(btn);
            });
            const allBtn = document.createElement('button');
            allBtn.className = 'area-btn all-btn';
            allBtn.style.cssText = 'grid-column:1/-1; margin-top:8px;';
            allBtn.textContent = `▶ ${t('show_all')}`;
            allBtn.onclick = () => { pageStack.push(() => showCityPage(region, pref, majorArea)); fetchAndShowHotels({ prefecture: pref, major_area: majorArea }); };
            container.appendChild(allBtn);
            appendInfoLinksBar();
            return;
        }

        if (!cities.length || (cities.length === 1 && cities[0][0] === majorArea)) {
            suppressAds();
            fetchAndShowHotels({ prefecture: pref, major_area: majorArea });
            return;
        }

        loadAds('area', majorArea);
        renderCityButtons(container, cities, (city) => {
            pageStack.push(() => showCityPage(region, pref, majorArea));
            fetchAndShowHotelsByCity({ prefecture: pref, major_area: majorArea }, city);
        });

        const allBtn = document.createElement('button');
        allBtn.className = 'area-btn all-btn';
        allBtn.style.cssText = 'grid-column:1/-1; margin-top:8px;';
        allBtn.textContent = `▶ ${t('show_all')}`;
        allBtn.onclick = () => { pageStack.push(() => showCityPage(region, pref, majorArea)); fetchAndShowHotels({ prefecture: pref, major_area: majorArea }); };
        container.appendChild(allBtn);
        appendInfoLinksBar();
        return;
    }

    // --- フォールバック: PHP API ---
    const data = await queryHotelsAPI({ pref, major_area: majorArea, cols: 'id,address,city,detail_area', limit: 5000 });
    if (gen !== _areaGeneration) return;

    const detailAreaCount = {};
    data.forEach(h => { if (h.detail_area && h.detail_area !== majorArea) detailAreaCount[h.detail_area] = (detailAreaCount[h.detail_area] || 0) + 1; });

    if (Object.keys(detailAreaCount).length > 0) {
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
        appendInfoLinksBar();
        return;
    }

    const citySetLocal = new Set();
    data.forEach(h => { const c = h.city || extractCity(h.address); if (c) citySetLocal.add(c); });
    const fallbackCities = [...citySetLocal];
    if (!fallbackCities.length || (fallbackCities.length === 1 && fallbackCities[0] === majorArea)) {
        fetchAndShowHotels({ prefecture: pref, major_area: majorArea });
        return;
    }
    const fbCities = fallbackCities.map(c => [c, 0, 0]);
    renderCityButtons(container, fbCities, (city) => {
        pageStack.push(() => showCityPage(region, pref, majorArea));
        fetchAndShowHotelsByCity({ prefecture: pref, major_area: majorArea }, city);
    });
    appendInfoLinksBar();
}

async function showDetailAreaPage(region, pref, majorArea, detailArea) {
    _renderPref = pref;
    if(document.activeElement)document.activeElement.blur();
    window.scrollTo(0,0);
    if (typeof resetSearchInput === 'function') resetSearchInput();
    const gen = ++_areaGeneration;
    currentPage = () => showDetailAreaPage(region, pref, majorArea, detailArea);
    updateUrl({ pref, area: majorArea, detail: detailArea });
    setTitle(detailArea);
    updatePageTitle(detailArea + 'のホテル検索');
    setBackBtn(true);
    setBreadcrumb([
        { label: t('japan'), onclick: 'showJapanPage()' },
        ...regionBreadcrumb(region),
        { label: pref, handler: () => showMajorAreaPage(region, pref) },
        { label: majorArea, handler: () => showCityPage(region, pref, majorArea) },
        { label: detailArea }
    ]);
    clearHotelList();

    const container = document.getElementById('area-button-container');
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);font-size:13px;">${t('loading')}</div>`;
    container.className = 'area-grid col-2';

    const ad = await loadAreaData();
    if (gen !== _areaGeneration) return;

    const daKey = pref + '\t' + majorArea + '\t' + detailArea;
    const daInfo = ad && ad.da && ad.da[daKey];

    if (daInfo) {
        const cities = daInfo.ct || [];
        if (cities.length <= 1) {
            // 市区町村が0-1件: detail_areaをスキップして直接ホテル一覧
            suppressAds();
            const city = cities.length === 1 ? cities[0][0] : null;
            if (city) {
                fetchAndShowHotelsByCity({ prefecture: pref, major_area: majorArea, detail_area: detailArea }, city);
            } else {
                fetchAndShowHotels({ prefecture: pref, major_area: majorArea, detail_area: detailArea });
            }
            return;
        }
        loadAds('town', detailArea);
        renderCityButtons(container, cities, (city) => {
            pageStack.push(() => showDetailAreaPage(region, pref, majorArea, detailArea));
            fetchAndShowHotelsByCity({ prefecture: pref, major_area: majorArea, detail_area: detailArea }, city);
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
        appendInfoLinksBar();
        return;
    }

    // フォールバック: PHP API
    const data = await queryHotelsAPI({ pref, major_area: majorArea, detail_area: detailArea, cols: 'id,address,city', limit: 5000 });
    if (gen !== _areaGeneration) return;

    const citySet = new Set();
    data.forEach(h => { const c = h.city || extractCity(h.address); if (c) citySet.add(c); });
    const fallbackCities = [...citySet];
    if (!fallbackCities.length) {
        fetchAndShowHotels({ prefecture: pref, major_area: majorArea, detail_area: detailArea });
        return;
    }
    const fbCities = fallbackCities.map(c => [c, 0, 0]);
    renderCityButtons(container, fbCities, (city) => {
        pageStack.push(() => showDetailAreaPage(region, pref, majorArea, detailArea));
        fetchAndShowHotelsByCity({ prefecture: pref, major_area: majorArea, detail_area: detailArea }, city);
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
    appendInfoLinksBar();
}

function backLevel() {
    const detail = document.getElementById('hotel-detail-content');
    const mapDetail = document.getElementById('map-detail-content');
    const isDetailVisible = (detail && detail.style.display !== 'none' && detail.innerHTML !== '') ||
                            (mapDetail && mapDetail.style.display !== 'none' && mapDetail.innerHTML !== '');
    if (isDetailVisible) {
        leaveHotelDetail();
        // 直接URLでホテル詳細に入った場合、一覧が空なので全国ページに戻す
        if (pageStack.length === 0) {
            showJapanPage();
        }
        return;
    }
    if (pageStack.length > 0) {
        const prevPage = pageStack.pop();
        prevPage();
    } else {
        showJapanPage();
    }
}

function goToHotelCity(regionLabel, pref, majorArea, city) {
    const region = REGION_MAP.find(r => r.label === regionLabel);
    pageStack.push(() => showCityPage(region, pref, majorArea));
    fetchAndShowHotelsByCity({ prefecture: pref, major_area: majorArea }, city);
}

// major_area=null のホテルを市区町村一覧で表示
async function showNoAreaCityPage(region, pref) {
    _renderPref = pref;
    if(document.activeElement)document.activeElement.blur();
    if (typeof resetSearchInput === 'function') resetSearchInput();
    const gen = ++_areaGeneration;
    currentPage = () => showNoAreaCityPage(region, pref);
    updateUrl({ pref, area: '_other' });
    setTitle(t('other_areas'));
    updatePageTitle(pref + ' その他のエリアのホテル検索');
    setBackBtn(true);
    setBreadcrumb([
        { label: t('japan'), onclick: 'showJapanPage()' },
        ...regionBreadcrumb(region),
        { label: pref, handler: () => showMajorAreaPage(region, pref) },
        { label: t('other_areas') }
    ]);
    clearHotelList();

    const container = document.getElementById('area-button-container');
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);font-size:13px;">${t('loading')}</div>`;
    container.className = 'area-grid col-2';

    const ad = await loadAreaData();
    if (gen !== _areaGeneration) return;

    if (ad && ad.noArea && ad.noArea[pref]) {
        const cities = ad.noArea[pref];
        renderCityButtons(container, cities, (city) => {
            pageStack.push(() => showNoAreaCityPage(region, pref));
            fetchAndShowHotelsByCity({ prefecture: pref }, city);
        });
        if (!cities.length) {
            container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);">${t('no_data')}</div>`;
        }
        appendInfoLinksBar();
        return;
    }

    // フォールバック: PHP API
    const data = await queryHotelsAPI({ pref, no_major_area: 'true', cols: 'city,address', limit: 5000 });
    if (gen !== _areaGeneration) return;

    const cityCount = {};
    data.forEach(h => {
        const city = h.city || extractCity(h.address);
        if (city) cityCount[city] = (cityCount[city] || 0) + 1;
    });
    const cities = Object.entries(cityCount).sort((a, b) => b[1] - a[1]).map(([c, n]) => [c, n, 0]);

    renderCityButtons(container, cities, (city) => {
        pageStack.push(() => showNoAreaCityPage(region, pref));
        fetchAndShowHotelsByCity({ prefecture: pref }, city);
    });

    if (!cities.length) {
        container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);">${t('no_data')}</div>`;
    }
    appendInfoLinksBar();
}
