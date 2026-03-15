// ==========================================================================
// api-service.js — Supabase接続、API呼び出し、マスタデータロード
// ==========================================================================

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const GATE_URL_MAP = {
    'men': '/subdomain/deli/index.html',
    'women': '/subdomain/jofu/index.html',
    'men_same': '/subdomain/same/index.html',
    'women_same': '/subdomain/same/index.html',
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
    const { data: shop } = await supabaseClient.from('shops').select('shop_name,gender_mode,shop_url,plan_id,status,contract_plans(price)').eq('id', SHOP_ID).eq('status', 'active').maybeSingle();
    if (!shop) return;
    SHOP_DATA = shop;
}

async function fetchReportSummaries(hotelIds) {
    if (!hotelIds.length) return {};
    console.log('[fetchReportSummaries] hotelIds count:', hotelIds.length);
    try {
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
    const summaries = await fetchReportSummaries(hotelIds);
    const latestMap = await fetchLatestReportDates(hotelIds);

    console.log('[fetchHotelsWithSummary] summaries:', JSON.stringify(summaries));
    return hotels.map(h => ({ ...h, summary: summaries[h.id] || null, latestReportAt: latestMap[h.id] || null }));
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
        console.warn('can_call_reasons not found, using defaults');
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
        console.warn('cannot_call_reasons not found, using defaults');
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
        console.warn('room_types not found, using defaults');
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

async function reverseGeocode(lat, lng) {
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ja`,
            { headers: { 'User-Agent': 'DeriHotelNavi/1.0' } }
        );
        if (!res.ok) return null;
        const data = await res.json();
        const a = data.address || {};
        return a.city || a.town || a.village || a.county || null;
    } catch {
        return null;
    }
}
