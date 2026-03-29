// ==========================================================================
// api-service.js — Supabase接続、API呼び出し、マスタデータロード
// ==========================================================================

// グローバル状態オブジェクト（全ファイル共通）
const AppState = {
    // Navigation (area-navigation.js)
    nav: { pageStack: [], currentPage: null, _skipPushState: false, _areaGeneration: 0 },
    // Search / Display (hotel-search.js)
    search: {
        _fetchGeneration: 0, currentTab: 'hotel',
        cachedHotelData: null, cachedLovehoData: null,
        _tabCityKey: null, _tabFilterObj: null, _tabCity: null,
        allHotels: [], displayedCount: 0, showDistanceFlag: false,
    },
    // Map (hotel-search.js)
    map: { instance: null, markers: [], _leafletLoading: false, _leafletLoaded: false, _detailMode: false },
    // Hotel detail (hotel-search.js)
    detail: { currentHotelId: null, _savedBreadcrumbHTML: '', _savedTabsHTML: '' },
    // Form (form-handler.js + hotel-search.js)
    form: {
        hotel: { can_call: null, conditions: new Set(), time_slot: '', can_call_reasons: new Set(), cannot_call_reasons: new Set(), comment: '', poster_name: '', room_type: '', multi_person: false, guest_male: 1, guest_female: 1 },
        loveho: {},
        flag: { targetId: null, selectedReason: null, targetTable: 'reports' },
    },
    // Timers (hotel-search.js)
    timers: { station: null, search: null, _isComposing: false },
    // Master data (api-service.js)
    master: { canCallReasons: null, cannotCallReasons: null, roomTypes: null, lhMaster: null },
};

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const GATE_PATH_MAP = {
    'men': '/deli/',
    'women': '/jofu/',
    'men_same': '/same-m/',
    'women_same': '/same-f/',
    'este': '/este/',
};
function getGateUrl() {
    const mode = window.MODE || new URLSearchParams(window.location.search).get('mode') || 'men';
    return GATE_PATH_MAP[mode] || '/deli/';
}

// Supabase anon key removed — all data access via PHP API

// 店舗専用URL: /deli/shop/slug/ or ?shop=slug or ?shop=uuid
const _shopParam = (() => {
    const qs = new URLSearchParams(window.location.search).get('shop');
    if (qs) return qs;
    const m = window.location.pathname.match(/\/shop\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
})();
let SHOP_ID = null;   // UUID（API比較用）
let SHOP_SLUG = null; // slug（URL生成用）
let SHOP_DATA = null;

async function initShopMode() {
    if (!_shopParam) return;
    try {
        // UUIDっぽいか判定（8-4-4-4-12）
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(_shopParam);
        const param = isUuid ? `shop_id=${encodeURIComponent(_shopParam)}` : `slug=${encodeURIComponent(_shopParam)}`;
        const res = await fetch(`/api/shop-info.php?${param}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data) {
            SHOP_DATA = data;
            SHOP_ID = data.id || _shopParam;
            SHOP_SLUG = data.slug || _shopParam;
        }
    } catch (e) { /* silently fail */ }
}

async function fetchReportSummaries(hotelIds) {
    if (!hotelIds.length) return {};
    try {
        const res = await fetch('/api/report-summaries.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hotel_ids: hotelIds }),
        });
        if (!res.ok) return {};
        const data = await res.json();
        return data.summaries || {};
    } catch (e) { return {}; }
}

async function fetchLatestReportDates(hotelIds) {
    if (!hotelIds.length) return {};
    try {
        const res = await fetch('/api/report-summaries.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hotel_ids: hotelIds, latest_only: true }),
        });
        if (!res.ok) return {};
        const data = await res.json();
        return data.latest_dates || {};
    } catch (e) { return {}; }
}

async function fetchHotelsWithSummary(hotels) {
    if (!hotels || !hotels.length) return [];
    const hotelIds = hotels.map(h => h.id);
    const res = await fetch('/api/report-summaries.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotel_ids: hotelIds }),
    });
    let summaries = {}, latestMap = {};
    if (res.ok) {
        const data = await res.json();
        summaries = data.summaries || {};
        latestMap = data.latest_dates || {};
    }
    return hotels.map(h => ({ ...h, summary: summaries[h.id] || null, latestReportAt: latestMap[h.id] || null }));
}

async function fetchLovehoReviewSummaries(hotelIds) {
    if (!hotelIds.length) return {};
    try {
        const res = await fetch('/api/report-summaries.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hotel_ids: hotelIds, loveho: true }),
        });
        if (!res.ok) return {};
        const data = await res.json();
        return data.loveho_summaries || {};
    } catch (e) { return {}; }
}

// 呼べた理由マスタ
let CAN_CALL_REASONS = ['直通', 'カードキー必須', 'EVフロント階スキップ', '玄関待ち合わせ', '深夜玄関待合', '2名予約必須', 'フロント相談', 'ノウハウ', 'バスタオル依頼推奨', 'その他'];

const CAN_CALL_REASONS_NARROW = {
    'カードキー必須':    'ｶｰﾄﾞｷｰ必須',
    'EVフロント階スキップ': 'EVﾌﾛﾝﾄ階ｽｷｯﾌﾟ',
    'フロント相談':      'ﾌﾛﾝﾄ相談',
    'ノウハウ':          'ﾉｳﾊｳ',
    'バスタオル依頼推奨': 'ﾊﾞｽﾀｵﾙ依頼推奨',
    '玄関待ち合わせ':    '玄関待合わせ',
};

let CANNOT_CALL_REASONS = ['フロントSTOP', '防犯カメラ確認', '深夜外出NG', 'その他'];
let ROOM_TYPES = ['シングル', 'ダブル', 'ツイン', 'スイート', '和室', 'その他'];
let LH_MASTER = { atmospheres: [], room_types: [], facilities: [], price_ranges_rest: [], price_ranges_stay: [], time_slots: [], good_points: [] };

let _masterDataLoaded = false;
let _masterDataPromise = null;
async function loadMasterData() {
    if (_masterDataLoaded) return;
    // 重複呼び出し防止: 既にロード中ならそのPromiseを待つ
    if (_masterDataPromise) return _masterDataPromise;
    _masterDataPromise = _doLoadMasterData();
    try { await _masterDataPromise; } finally { _masterDataPromise = null; }
}
async function _doLoadMasterData() {
    // リトライ付き（最大2回）
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch('/master-data.json');
            if (!res.ok) { if (attempt === 0) continue; return; }
            const md = await res.json();
            _applyMasterData(md);
            _masterDataLoaded = true;
            return;
        } catch (e) {
            if (attempt === 0) continue; // 1回目失敗→リトライ
        }
    }
}
function _applyMasterData(md) {
    if (md.can_call_reasons?.length) CAN_CALL_REASONS = md.can_call_reasons;
    if (md.cannot_call_reasons?.length) CANNOT_CALL_REASONS = md.cannot_call_reasons;
    if (md.room_types?.length) ROOM_TYPES = md.room_types;
    if (md.loveho) {
        const lh = md.loveho;
        if (lh.atmospheres?.length) LH_MASTER.atmospheres = lh.atmospheres;
        if (lh.room_types?.length) LH_MASTER.room_types = lh.room_types;
        if (lh.facilities?.length) LH_MASTER.facilities = lh.facilities;
        if (lh.price_ranges_rest?.length) LH_MASTER.price_ranges_rest = lh.price_ranges_rest;
        if (lh.price_ranges_stay?.length) LH_MASTER.price_ranges_stay = lh.price_ranges_stay;
        if (lh.time_slots?.length) LH_MASTER.time_slots = lh.time_slots;
        if (lh.good_points?.length) LH_MASTER.good_points = lh.good_points;
    }
}

// Legacy function signatures (called from other files)
async function loadCanCallReasonsMaster() { await loadMasterData(); }
async function loadCannotCallReasonsMaster() { await loadMasterData(); }
async function loadRoomTypesMaster() { await loadMasterData(); }
function loadConditionsMaster() {}
async function loadLhMasters() { await loadMasterData(); }

function renderAdHTML(ad) {
    if (ad.banner_image_url) {
        const size = ad.banner_size || 'medium';
        const alt = esc(ad.banner_alt || '広告バナー');
        const linkUrl = ad.banner_link_url || ad.shops?.shop_url || '#';
        return `<div class="ad-banner-container">
            <a href="${esc(linkUrl)}" target="_blank" rel="noopener">
                <img src="${esc(ad.banner_image_url)}" alt="${alt}" class="ad-banner-${size}" width="640" height="${size === 'small' ? '80' : size === 'large' ? '200' : '120'}" loading="lazy">
            </a>
        </div>`;
    }
    const shopName = ad.shops?.shop_name || '掲載店舗';
    const url = ad.shops?.shop_url;
    const thumbUrl = ad.shops?.thumbnail_url;
    const catchphrase = ad.shops?.catchphrase || '';
    const description = ad.shops?.description || '';
    const businessHours = ad.shops?.business_hours || '';
    const minPrice = ad.shops?.min_price || '';
    const nameHTML = url
        ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="ad-shop-name">${esc(shopName)}</a>`
        : `<span class="ad-shop-name" style="color:var(--text);">${esc(shopName)}</span>`;
    const thumbHTML = thumbUrl
        ? `<img src="${esc(thumbUrl)}" class="ad-main-thumb" alt="${esc(shopName)}" loading="lazy">`
        : `<div class="ad-main-thumb ad-shop-thumb--empty">📢</div>`;
    const catchHTML = catchphrase ? `<div class="ad-main-catch">${esc(catchphrase)}</div>` : '';
    const descHTML = description ? `<div class="ad-main-desc">${esc(description)}</div>` : '';
    const priceText = (() => {
        if (!minPrice) return '';
        const pp = minPrice.split(',');
        if (pp.length !== 2) return '';
        const toFull = n => String(n).replace(/[0-9]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0));
        const fmtYen = n => Number(n).toLocaleString('ja-JP');
        return `${toFull(pp[0])}分 ${fmtYen(pp[1])}円〜`;
    })();
    const bottomParts = [];
    if (priceText) bottomParts.push(`<span class="ad-main-price-text">${priceText}</span>`);
    if (businessHours) bottomParts.push(`<span class="ad-main-hours-text"><span class="ad-main-hours-label">🕐営業時間🕐</span><span class="ad-main-hours-value">${esc(businessHours)}</span></span>`);
    const bottomHTML = bottomParts.length ? `<div class="ad-main-bottom">${bottomParts.join('')}</div>` : '';
    const reportCount = ad.report_count || 0;
    const countBadge = reportCount > 0 ? `<span class="ad-main-count">📋${reportCount}件</span>` : '';
    const rankClass = ad.rank === 1 ? 'ad-rank-gold' : ad.rank === 2 ? 'ad-rank-silver' : ad.rank === 3 ? 'ad-rank-bronze' : '';
    return `<div class="ad-main-card ${rankClass}">
        ${thumbHTML}
        <div class="ad-main-info">
            <div class="ad-main-name-row">${nameHTML}${countBadge}</div>
            ${catchHTML}
            ${descHTML}
            ${bottomHTML}
        </div>
    </div>`;
}

let _adGeneration = 0;
function suppressAds() { ++_adGeneration; const c = document.getElementById('ad-container'); if (c) { c.innerHTML = ''; c.style.display = 'none'; } }
async function loadAds(placementType, placementTarget, fallbacks) {
    const container = document.getElementById('ad-container');
    if (!container) return;
    container.innerHTML = '';
    const belowSearch = document.getElementById('ad-container-below-search');
    if (belowSearch) belowSearch.innerHTML = '';
    const gen = ++_adGeneration;
    try {
        const currentMode = window.MODE || new URLSearchParams(window.location.search).get('mode') || 'men';
        // そのエリアの掲載店のみ表示（フォールバックなし）
        const res = await fetch(`/api/ads.php?type=${encodeURIComponent(placementType)}&target=${encodeURIComponent(placementTarget)}&mode=${encodeURIComponent(currentMode)}`);
        let allAds = [];
        if (res.ok) {
            const data = await res.json();
            if (data && data.length) {
                const seen = new Set();
                data.forEach(ad => { if (!seen.has(ad.shop_id)) { seen.add(ad.shop_id); allAds.push(ad); } });
            }
        }
        if (gen !== _adGeneration) return; // suppressed
        if (allAds.length) {
            const genreMap = {men:'デリヘル',women:'女性用風俗',men_same:'男性同士',women_same:'女性同士',este:'風俗エステ'};
            const genreName = genreMap[currentMode] || 'お店';
            const header = `<div class="ad-shop-header">📢 このエリアで呼べる${genreName}の<span class="shop-premium-badge">認定店</span>名をクリック🔗</div>`;
            container.style.display = '';
            container.innerHTML = header + `<div class="ad-shop-list">${allAds.slice(0,3).map(ad => renderAdHTML(ad)).join('')}</div>`;
        }
    } catch (e) { /* ad load failed silently */ }
}

async function fetchDetailAds(placementType, placementTarget) {
    try {
        const currentMode = window.MODE || new URLSearchParams(window.location.search).get('mode') || 'men';
        const res = await fetch(`/api/ads.php?type=${encodeURIComponent(placementType)}&target=${encodeURIComponent(placementTarget)}&mode=${encodeURIComponent(currentMode)}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || !data.length) return null;
        return data;
    } catch (e) { return null; }
}

function clearAds() {
    const container = document.getElementById('ad-container');
    if (container) container.innerHTML = '';
    const belowSearch = document.getElementById('ad-container-below-search');
    if (belowSearch) belowSearch.innerHTML = '';
}

async function loadAdsBelowSearch(placementType, placementTarget) {
    const container = document.getElementById('ad-container-below-search');
    if (!container) return;
    container.innerHTML = '';
    try {
        const currentMode = window.MODE || new URLSearchParams(window.location.search).get('mode') || 'men';
        const res = await fetch(`/api/ads.php?type=${encodeURIComponent(placementType)}&target=${encodeURIComponent(placementTarget)}&mode=${encodeURIComponent(currentMode)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data || !data.length) return;
        const seen = new Set();
        const allAds = [];
        data.forEach(ad => { if (!seen.has(ad.shop_id)) { seen.add(ad.shop_id); allAds.push(ad); } });
        if (!allAds.length) return;
        const genreMap = {men:'デリヘル',women:'女性用風俗',men_same:'男性同士',women_same:'女性同士',este:'風俗エステ'};
        const genreName = genreMap[currentMode] || 'お店';
        const badge = '<span class="shop-premium-badge">認定店</span>';
        container.innerHTML = renderSubAdCards(allAds, `📢 全国で呼べる${genreName}の ${badge} 名をクリック🔗`);
    } catch (e) { /* silently */ }
}

// ==========================================================================
// エリア内の案内可能店舗を取得
// ==========================================================================
async function fetchAreaShops(pref, city, genderMode) {
    try {
        let url = `/api/area-shops.php?pref=${encodeURIComponent(pref)}&mode=${encodeURIComponent(genderMode)}`;
        if (city) url += `&city=${encodeURIComponent(city)}`;
        const res = await fetch(url);
        if (!res.ok) return [];
        return await res.json();
    } catch (e) {
        return [];
    }
}

let _lastReverseResult = null;
async function reverseGeocode(lat, lng) {
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ja`,
            { headers: { 'User-Agent': 'DeriHotelNavi/1.0' } }
        );
        if (!res.ok) return null;
        const data = await res.json();
        const a = data.address || {};
        _lastReverseResult = a;
        return a.city || a.town || a.village || a.county || null;
    } catch {
        return null;
    }
}
const _ALL_PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
function normalizePrefName(raw) {
    if (!raw) return null;
    if (_ALL_PREFS.includes(raw)) return raw;
    for (const p of _ALL_PREFS) { if (p.startsWith(raw) || raw.includes(p)) return p; }
    return raw;
}
const _ISO_PREF_MAP = {'JP-01':'北海道','JP-02':'青森県','JP-03':'岩手県','JP-04':'宮城県','JP-05':'秋田県','JP-06':'山形県','JP-07':'福島県','JP-08':'茨城県','JP-09':'栃木県','JP-10':'群馬県','JP-11':'埼玉県','JP-12':'千葉県','JP-13':'東京都','JP-14':'神奈川県','JP-15':'新潟県','JP-16':'富山県','JP-17':'石川県','JP-18':'福井県','JP-19':'山梨県','JP-20':'長野県','JP-21':'岐阜県','JP-22':'静岡県','JP-23':'愛知県','JP-24':'三重県','JP-25':'滋賀県','JP-26':'京都府','JP-27':'大阪府','JP-28':'兵庫県','JP-29':'奈良県','JP-30':'和歌山県','JP-31':'鳥取県','JP-32':'島根県','JP-33':'岡山県','JP-34':'広島県','JP-35':'山口県','JP-36':'徳島県','JP-37':'香川県','JP-38':'愛媛県','JP-39':'高知県','JP-40':'福岡県','JP-41':'佐賀県','JP-42':'長崎県','JP-43':'熊本県','JP-44':'大分県','JP-45':'宮崎県','JP-46':'鹿児島県','JP-47':'沖縄県'};
async function reverseGeocodePref(lat, lng) {
    // キャッシュからISO or province/stateを取得
    if (_lastReverseResult) {
        const iso = _lastReverseResult['ISO3166-2-lvl4'];
        if (iso && _ISO_PREF_MAP[iso]) return _ISO_PREF_MAP[iso];
        const state = _lastReverseResult.province || _lastReverseResult.state || null;
        if (state) return normalizePrefName(state);
    }
    // zoom=5で都道府県レベルを取得
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ja&zoom=5`,
            { headers: { 'User-Agent': 'DeriHotelNavi/1.0' } }
        );
        if (!res.ok) return null;
        const data = await res.json();
        const a = data.address || {};
        const iso = a['ISO3166-2-lvl4'];
        if (iso && _ISO_PREF_MAP[iso]) return _ISO_PREF_MAP[iso];
        return normalizePrefName(a.province || a.state || null);
    } catch {
        return null;
    }
}
