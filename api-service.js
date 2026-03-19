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

const GATE_URL_MAP = {
    'men': 'https://deli.yobuho.com/',
    'women': 'https://jofu.yobuho.com/',
    'men_same': 'https://same.yobuho.com/',
    'women_same': 'https://same.yobuho.com/',
};
function getGateUrl() {
    const mode = new URLSearchParams(window.location.search).get('mode') || 'men';
    return GATE_URL_MAP[mode] || '/index.html';
}

const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const SHOP_ID = new URLSearchParams(window.location.search).get('shop') || null;
let SHOP_DATA = null;

async function initShopMode() {
    if (!SHOP_ID) return;
    const { data: shop } = await supabaseClient.from('shops').select('shop_name,gender_mode,shop_url,plan_id,status,shop_contracts(plan_id,contract_plans(price))').eq('id', SHOP_ID).eq('status', 'active').maybeSingle();
    if (!shop) return;
    SHOP_DATA = shop;
}

async function fetchReportSummaries(hotelIds) {
    if (!hotelIds.length) return {};
    try {
        const { data, error } = await supabaseClient
            .from('hotel_report_summary')
            .select('*')
            .in('hotel_id', hotelIds);
        if (!error && data && data.length > 0) {
            const map = {};
            data.forEach(r => { map[r.hotel_id] = r; });
            return map;
        }
    } catch(e) { /* view exception, fallback to reports */ }
    try {
        const { data: reports, error: repErr } = await supabaseClient
            .from('reports')
            .select('hotel_id,can_call,poster_type')
            .in('hotel_id', hotelIds);
        if (!reports) return {};
        const map = {};
        reports.forEach(r => {
            if (!map[r.hotel_id]) map[r.hotel_id] = { hotel_id: r.hotel_id, can_call_count: 0, cannot_call_count: 0, shop_can_count: 0, shop_ng_count: 0 };
            const s = map[r.hotel_id];
            if (r.poster_type === 'shop') { r.can_call ? s.shop_can_count++ : s.shop_ng_count++; }
            else { r.can_call ? s.can_call_count++ : s.cannot_call_count++; }
        });
        return map;
    } catch(e) { return {}; }
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

async function fetchHotelsWithSummary(query) {
    const { data: hotels, error } = await query;
    if (error) throw error;
    if (!hotels || !hotels.length) return [];

    const hotelIds = hotels.map(h => h.id);
    const [summaries, latestMap] = await Promise.all([
        fetchReportSummaries(hotelIds),
        fetchLatestReportDates(hotelIds)
    ]);

    return hotels.map(h => ({ ...h, summary: summaries[h.id] || null, latestReportAt: latestMap[h.id] || null }));
}

async function fetchLovehoReviewSummaries(hotelIds) {
    if (!hotelIds.length) return {};
    try {
        const { data, error } = await supabaseClient
            .from('loveho_reports')
            .select('hotel_id,recommendation,cleanliness,cost_performance,solo_entry,can_go_out,created_at')
            .in('hotel_id', hotelIds);
        if (error || !data) return {};
        const map = {};
        data.forEach(r => {
            if (!map[r.hotel_id]) map[r.hotel_id] = { count: 0, recommendation_sum: 0, cleanliness_sum: 0, cp_sum: 0, latestAt: null };
            const s = map[r.hotel_id];
            s.count++;
            if (r.recommendation != null) s.recommendation_sum += r.recommendation;
            if (r.cleanliness != null) s.cleanliness_sum += r.cleanliness;
            if (r.cost_performance != null) s.cp_sum += r.cost_performance;
            if (r.created_at && (!s.latestAt || r.created_at > s.latestAt)) s.latestAt = r.created_at;
        });
        return map;
    } catch { return {}; }
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
        // fallback to defaults
        showToast('マスタデータの読み込みに失敗しました。デフォルト値を使用します。', 3000);
    }
}

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
        // fallback to defaults
        showToast('マスタデータの読み込みに失敗しました。デフォルト値を使用します。', 3000);
    }
}

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
        // fallback to defaults
        showToast('マスタデータの読み込みに失敗しました。デフォルト値を使用します。', 3000);
    }
}

function loadConditionsMaster() {
    // uses hardcoded defaults
}

let LH_MASTER = { atmospheres: [], room_types: [], facilities: [], price_ranges_rest: [], price_ranges_stay: [], time_slots: [] };

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
    const nameHTML = url
        ? `<a href="${esc(url)}" target="_blank" rel="noopener" style="color:#b5627a; font-size:13px; text-decoration:none; font-weight:500;">${esc(shopName)} 🔗</a>`
        : `<span style="font-size:13px; color:var(--text); font-weight:500;">${esc(shopName)}</span>`;
    const thumbHTML = thumbUrl
        ? `<img src="${esc(thumbUrl)}" width="48" height="64" loading="lazy" style="width:48px;height:64px;object-fit:cover;border-radius:4px;border:1px solid #e8ddd5;flex-shrink:0;">`
        : '';
    return `<div style="background:#faf7f4; border:1px solid #e8ddd5; border-radius:8px; padding:12px 14px; margin:16px 0; font-size:12px;">
        <div style="color:#999; font-size:10px; margin-bottom:6px;">📢 このエリアの掲載店舗</div>
        <div style="display:flex;align-items:center;gap:12px;">
            ${thumbHTML}
            <div>
                <div style="margin-bottom:4px;">
                    <span style="background:#b5627a; color:#fff; font-size:9px; padding:1px 5px; border-radius:2px;">認定店</span>
                </div>
                ${nameHTML}
            </div>
        </div>
    </div>`;
}

async function loadAds(placementType, placementTarget) {
    const container = document.getElementById('ad-container');
    if (!container) return;
    container.innerHTML = '';
    try {
        const currentMode = new URLSearchParams(window.location.search).get('mode') || 'men';
        const { data, error } = await supabaseClient.from('ad_placements')
            .select('*, shops(shop_name, shop_url, status, thumbnail_url), ad_plans(name), banner_image_url, banner_link_url, banner_size, banner_alt')
            .eq('placement_type', placementType)
            .eq('placement_target', placementTarget)
            .eq('status', 'active')
            .or('mode.eq.' + currentMode + ',mode.eq.all,mode.is.null');
        if (!data || !data.length) return;
        // 掲載停止中の店舗を除外
        const activeAds = data.filter(ad => !ad.shops || ad.shops.status === 'active');
        if (!activeAds.length) return;
        container.innerHTML = activeAds.map(ad => renderAdHTML(ad)).join('');
    } catch (e) { /* ad load failed silently */ }
}

async function fetchDetailAds(placementType, placementTarget) {
    try {
        const currentMode = new URLSearchParams(window.location.search).get('mode') || 'men';
        const { data } = await supabaseClient.from('ad_placements')
            .select('*, shops(shop_name, shop_url, status, thumbnail_url), ad_plans(name), banner_image_url, banner_link_url, banner_size, banner_alt')
            .eq('placement_type', placementType)
            .eq('placement_target', placementTarget)
            .eq('status', 'active')
            .or('mode.eq.' + currentMode + ',mode.eq.all,mode.is.null');
        if (!data || !data.length) return '';
        const activeAds = data.filter(ad => !ad.shops || ad.shops.status === 'active');
        if (!activeAds.length) return '';
        return activeAds.map(ad => renderAdHTML(ad)).join('');
    } catch (e) { return ''; }
}

function clearAds() {
    const container = document.getElementById('ad-container');
    if (container) container.innerHTML = '';
}

// ==========================================================================
// エリア内の案内可能店舗を取得
// ==========================================================================
async function fetchAreaShops(pref, city, genderMode) {
    try {
        // Step 1: city に該当するホテルIDを取得
        let hotelQuery = supabaseClient.from('hotels').select('id').eq('is_published', true).eq('prefecture', pref);
        if (city) hotelQuery = hotelQuery.eq('city', city);
        const { data: hotelRows, error: hErr } = await hotelQuery.limit(5000);
        if (hErr || !hotelRows || !hotelRows.length) return [];
        const hotelIds = hotelRows.map(h => h.id);

        // Step 2: shop_hotel_info でそのホテルを案内できる店舗を取得
        const { data: shiRows, error: shiErr } = await supabaseClient
            .from('shop_hotel_info')
            .select('shop_id, hotel_id, can_call')
            .in('hotel_id', hotelIds)
            .eq('can_call', true);
        if (shiErr || !shiRows || !shiRows.length) return [];

        // shop_id ごとにホテル数を集計
        const shopHotelCount = {};
        shiRows.forEach(r => {
            if (!shopHotelCount[r.shop_id]) shopHotelCount[r.shop_id] = 0;
            shopHotelCount[r.shop_id]++;
        });
        const shopIds = Object.keys(shopHotelCount);
        if (!shopIds.length) return [];

        // Step 3: 店舗情報を取得（active + gender_mode一致）
        const { data: shops, error: sErr } = await supabaseClient
            .from('shops')
            .select('id, shop_name, shop_url, gender_mode, thumbnail_url, shop_contracts(plan_id, contract_plans(price))')
            .in('id', shopIds)
            .eq('status', 'active');
        if (sErr || !shops || !shops.length) return [];

        // gender_mode フィルタ & 有料プラン契約ありのみ
        const result = shops
            .filter(s => {
                if (s.gender_mode !== genderMode) return false;
                const contracts = s.shop_contracts || [];
                return contracts.some(c => (c.contract_plans?.price || 0) > 0);
            })
            .map(s => {
                const maxPrice = Math.max(...(s.shop_contracts || []).map(c => c.contract_plans?.price || 0), 0);
                return {
                    shop_name: s.shop_name,
                    shop_url: s.shop_url,
                    thumbnail_url: s.thumbnail_url || null,
                    plan_price: maxPrice,
                    hotel_count: shopHotelCount[s.id] || 0
                };
            });

        // ソート: 有料プラン(高い順) → ホテル件数(多い順)
        result.sort((a, b) => {
            if (b.plan_price !== a.plan_price) return b.plan_price - a.plan_price;
            return b.hotel_count - a.hotel_count;
        });

        return result;
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
