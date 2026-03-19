// ==========================================================================
// LoveHo YobuHo — loveho-app.js
// ラブホテル専用ポータル (hotel_type = 'love_hotel' のみ)
// ==========================================================================

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const HOTEL_TYPE_FILTERS = ['love_hotel', 'rental_room'];

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

// ==========================================================================
// URL状態管理
// ==========================================================================
let _skipPushState = false;

function findRegionByPref(pref) { return REGION_MAP.find(r => r.prefs.includes(pref)); }
function findRegionByLabel(label) { return REGION_MAP.find(r => r.label === label); }

function updateUrl(params) {
    if (_skipPushState) return;
    const newParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v != null) newParams.set(k, v); });
    const newUrl = newParams.toString() ? '?' + newParams.toString() : location.pathname;
    history.pushState(null, '', newUrl);
}

function updatePageTitle(prefix) {
    document.title = prefix + ' | LoveHo YobuHo';
}

// ==========================================================================
// Supabase クエリヘルパー（hotel_type フィルタ自動付与）
// ==========================================================================
function hotelsQuery() {
    return supabaseClient.from('hotels').select('*').in('hotel_type', HOTEL_TYPE_FILTERS).eq('is_published', true);
}
function hotelsQueryColumns(cols) {
    return supabaseClient.from('hotels').select(cols).in('hotel_type', HOTEL_TYPE_FILTERS).eq('is_published', true);
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
    const el = document.getElementById('breadcrumb');
    if (!el) return;
    el.innerHTML = crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return `${i > 0 ? '<span class="lh-breadcrumb-sep">›</span>' : ''}
            <span class="lh-breadcrumb-item ${isLast ? 'active' : ''}"
                  ${!isLast && c.onclick ? `style="cursor:pointer" onclick="${c.onclick}"` : ''}>
                ${esc(c.label)}
            </span>`;
    }).join('');
}
function clearHotelList() {
    const el = document.getElementById('hotel-list');
    if (el) el.innerHTML = '';
    const s = document.getElementById('result-status');
    if (s) s.style.display = 'none';
    hideHotelTabs();
}
function showToast(msg, duration = 2500) {
    let el = document.getElementById('lh-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'lh-toast';
        el.className = 'lh-toast';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(-12px)'; }, duration);
}
function showSuccessModal(title, message) {
    document.getElementById('success-modal-title').textContent = title;
    document.getElementById('success-modal-message').textContent = message || '';
    document.getElementById('success-modal').style.display = 'flex';
}
function closeSuccessModal() { document.getElementById('success-modal').style.display = 'none'; }
function showLoading(msg) {
    const el = document.getElementById('loading-overlay');
    if (el) { el.style.display = 'flex'; const t = el.querySelector('.lh-loading-text'); if (t) t.textContent = msg || '検索中...'; }
}
function hideLoading() {
    const el = document.getElementById('loading-overlay');
    if (el) el.style.display = 'none';
}

// ==========================================================================
// 星表示
// ==========================================================================
function starsHTML(rating, max = 5) {
    if (!rating) return '';
    let html = '<span class="lh-stars">';
    for (let i = 1; i <= max; i++) {
        html += i <= Math.round(rating) ? '★' : '<span class="empty">★</span>';
    }
    html += '</span>';
    return html;
}

// ==========================================================================
// extractCity
// ==========================================================================
function extractCity(address) {
    if (!address) return null;
    const PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
    let after = address;
    for (const pref of PREFS) { if (address.startsWith(pref)) { after = address.slice(pref.length).trimStart(); break; } }
    if (!after) return null;
    const base = after.replace(/^[\u4E00-\u9FFF\u3040-\u30FF]{1,5}郡/, '');
    let m;
    m = base.match(/^((?:(?!区)[\u4E00-\u9FFF\u3040-\u30FF]){1,10}?市)/); if (m) return m[1];
    m = base.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}?区)/); if (m) return m[1];
    m = after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,5}郡[\u4E00-\u9FFF\u3040-\u30FF]{1,5}[町村])/); if (m) return m[1];
    m = after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}郡)/); if (m) return m[1];
    m = after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}[町村])/); if (m) return m[1];
    return null;
}

// ==========================================================================
// 口コミ集計（loveho_reports テーブル）
// ==========================================================================
async function fetchReviewSummaries(hotelIds) {
    if (!hotelIds.length) return {};
    try {
        const { data, error } = await supabaseClient
            .from('loveho_reports')
            .select('hotel_id,recommendation,cleanliness,cost_performance,solo_entry,can_go_out')
            .in('hotel_id', hotelIds);
        if (error || !data) return {};
        const map = {};
        data.forEach(r => {
            if (!map[r.hotel_id]) map[r.hotel_id] = { count: 0, recommend_sum: 0, cleanliness_sum: 0, cp_sum: 0, alone_yes: 0, alone_no: 0, alone_unknown: 0, outside_yes: 0, outside_no: 0, outside_unknown: 0 };
            const s = map[r.hotel_id];
            s.count++;
            if (r.recommendation) s.recommend_sum += r.recommendation;
            if (r.cleanliness) s.cleanliness_sum += r.cleanliness;
            if (r.cost_performance) s.cp_sum += r.cost_performance;
            if (r.solo_entry === 'yes') s.alone_yes++;
            else if (r.solo_entry === 'no') s.alone_no++;
            else s.alone_unknown++;
            if (r.can_go_out === 'yes') s.outside_yes++;
            else if (r.can_go_out === 'no') s.outside_no++;
            else s.outside_unknown++;
        });
        return map;
    } catch (e) { return {}; }
}

// ==========================================================================
// ページ描画
// ==========================================================================
function showJapanPage() {
    if (document.activeElement) document.activeElement.blur();
    pageStack = [];
    currentPage = showJapanPage;
    updateUrl({});
    setTitle('地域を選択');
    updatePageTitle('全国のラブホテル検索');
    setBackBtn(false);
    setBreadcrumb([{ label: '日本全国' }]);
    clearHotelList();
    showPortalMode();

    const container = document.getElementById('area-button-container');
    container.innerHTML = '';
    container.className = 'lh-area-grid region-level';

    REGION_MAP.forEach((region, i) => {
        const btn = document.createElement('button');
        btn.className = 'lh-area-btn has-children';
        btn.style.animationDelay = `${i * 0.04}s`;
        btn.textContent = region.label;
        btn.onclick = () => { pageStack.push(showJapanPage); showPrefPage(region); };
        container.appendChild(btn);
    });
}

async function showPrefPage(region) {
    if (document.activeElement) document.activeElement.blur();
    currentPage = () => showPrefPage(region);
    updateUrl({ region: region.label });
    setTitle(region.label);
    updatePageTitle(region.label + 'のラブホテル検索');
    setBackBtn(true);
    setBreadcrumb([
        { label: '日本全国', onclick: 'showJapanPage()' },
        { label: region.label }
    ]);
    clearHotelList();

    const container = document.getElementById('area-button-container');
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--lh-text-3);font-size:13px;">読み込み中...</div>';
    container.className = 'lh-area-grid';

    const prefCountResults = await Promise.all(
        region.prefs.map(pref =>
            hotelsQueryColumns('id').eq('prefecture', pref).then(({ data }) => ({ pref, count: data ? data.length : 0 }))
        )
    );
    const sorted = prefCountResults.filter(r => r.count > 0).sort((a, b) => b.count - a.count);

    container.innerHTML = '';
    sorted.forEach((item, i) => {
        const btn = document.createElement('button');
        btn.className = 'lh-area-btn has-children';
        btn.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
        btn.innerHTML = `<span>${item.pref}</span><span class="city-count">${item.count}</span>`;
        btn.onclick = () => { pageStack.push(() => showPrefPage(region)); showMajorAreaPage(region, item.pref); };
        container.appendChild(btn);
    });
}

async function showMajorAreaPage(region, pref) {
    if (document.activeElement) document.activeElement.blur();
    currentPage = () => showMajorAreaPage(region, pref);
    updateUrl({ pref });
    setTitle(pref);
    updatePageTitle(pref + 'のラブホテル検索');
    setBackBtn(true);
    setBreadcrumb([
        { label: '日本全国', onclick: 'showJapanPage()' },
        { label: region.label, onclick: `showPrefPage(REGION_MAP.find(r=>r.label==='${region.label}'))` },
        { label: pref }
    ]);
    clearHotelList();

    const container = document.getElementById('area-button-container');
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--lh-text-3);font-size:13px;">読み込み中...</div>';
    container.className = 'lh-area-grid';

    let data = [];
    let from = 0;
    while (true) {
        const { data: chunk, error } = await hotelsQueryColumns('id,major_area').eq('prefecture', pref).range(from, from + 999);
        if (error || !chunk || !chunk.length) break;
        data = data.concat(chunk);
        if (chunk.length < 1000) break;
        from += 1000;
    }

    const areaCount = {};
    data.forEach(h => { if (h.major_area) areaCount[h.major_area] = (areaCount[h.major_area] || 0) + 1; });
    const areas = Object.keys(areaCount).sort((a, b) => areaCount[b] - areaCount[a]);

    if (!areas.length) { fetchAndShowHotels({ prefecture: pref }); return; }

    container.innerHTML = '';
    areas.forEach((area, i) => {
        const btn = document.createElement('button');
        btn.className = 'lh-area-btn has-children';
        btn.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
        btn.innerHTML = `<span>${area}</span><span class="city-count">${areaCount[area]}</span>`;
        btn.onclick = () => { pageStack.push(() => showMajorAreaPage(region, pref)); showCityPage(region, pref, area); };
        container.appendChild(btn);
    });
    // 全て表示ボタン
    const allBtn = document.createElement('button');
    allBtn.className = 'lh-area-btn all-btn';
    allBtn.style.cssText = 'grid-column:1/-1;margin-top:8px;';
    allBtn.textContent = '▶ このエリア全体を見る';
    allBtn.onclick = () => { pageStack.push(() => showMajorAreaPage(region, pref)); fetchAndShowHotels({ prefecture: pref }); };
    container.appendChild(allBtn);
}

async function showCityPage(region, pref, majorArea) {
    if (document.activeElement) document.activeElement.blur();
    currentPage = () => showCityPage(region, pref, majorArea);
    updateUrl({ pref, area: majorArea });
    setTitle(majorArea);
    updatePageTitle(majorArea + 'のラブホテル検索');
    setBackBtn(true);
    setBreadcrumb([
        { label: '日本全国', onclick: 'showJapanPage()' },
        { label: region.label, onclick: `showPrefPage(REGION_MAP.find(r=>r.label==='${region.label}'))` },
        { label: pref, onclick: `showMajorAreaPage(REGION_MAP.find(r=>r.label==='${region.label}'), '${pref}')` },
        { label: majorArea }
    ]);
    clearHotelList();

    const container = document.getElementById('area-button-container');
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--lh-text-3);font-size:13px;">読み込み中...</div>';
    container.className = 'lh-area-grid';

    let data = [];
    let from = 0;
    while (true) {
        const { data: chunk, error } = await hotelsQueryColumns('id,address,city,detail_area').eq('prefecture', pref).eq('major_area', majorArea).range(from, from + 999);
        if (error || !chunk || !chunk.length) break;
        data = data.concat(chunk);
        if (chunk.length < 1000) break;
        from += 1000;
    }

    // detail_area チェック
    const detailAreaCount = {};
    data.forEach(h => { if (h.detail_area && h.detail_area !== majorArea) detailAreaCount[h.detail_area] = (detailAreaCount[h.detail_area] || 0) + 1; });
    if (Object.keys(detailAreaCount).length > 0) {
        const detailAreas = Object.keys(detailAreaCount).sort((a, b) => detailAreaCount[b] - detailAreaCount[a]);
        container.innerHTML = '';
        detailAreas.forEach((area, i) => {
            const btn = document.createElement('button');
            btn.className = 'lh-area-btn';
            btn.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
            btn.innerHTML = `<span>${area}</span><span class="city-count">${detailAreaCount[area]}</span>`;
            btn.onclick = () => { pageStack.push(() => showCityPage(region, pref, majorArea)); showDetailAreaPage(region, pref, majorArea, area); };
            container.appendChild(btn);
        });
        const allBtn = document.createElement('button');
        allBtn.className = 'lh-area-btn all-btn';
        allBtn.style.cssText = 'grid-column:1/-1;margin-top:8px;';
        allBtn.textContent = '▶ このエリア全体を見る';
        allBtn.onclick = () => { pageStack.push(() => showCityPage(region, pref, majorArea)); fetchAndShowHotels({ prefecture: pref, major_area: majorArea }); };
        container.appendChild(allBtn);
        return;
    }

    // city 一覧（エリア内のラブホから市区町村候補を取得）
    const citySetLocal = new Set();
    data.forEach(h => { const c = h.city || extractCity(h.address); if (c) citySetLocal.add(c); });
    const candidateCities = [...citySetLocal];

    // 都道府県全体での件数を取得（ポータルと統一）
    const cityCount = {};
    if (candidateCities.length > 0) {
        let countRows = [];
        let countFrom = 0;
        while (true) {
            const { data: chunk } = await hotelsQueryColumns('city').eq('prefecture', pref).in('city', candidateCities).range(countFrom, countFrom + 999);
            if (!chunk || !chunk.length) break;
            countRows = countRows.concat(chunk);
            if (chunk.length < 1000) break;
            countFrom += 1000;
        }
        countRows.forEach(h => { if (h.city) cityCount[h.city] = (cityCount[h.city] || 0) + 1; });
    }
    const cities = candidateCities.sort((a, b) => (cityCount[b] || 0) - (cityCount[a] || 0));

    if (!cities.length) { fetchAndShowHotels({ prefecture: pref, major_area: majorArea }); return; }

    container.innerHTML = '';
    cities.forEach((city, i) => {
        const btn = document.createElement('button');
        btn.className = 'lh-area-btn';
        btn.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
        btn.innerHTML = `<span>${city}</span><span class="city-count">${cityCount[city] || 0}</span>`;
        btn.onclick = () => { pageStack.push(() => showCityPage(region, pref, majorArea)); fetchAndShowHotelsByCity({ prefecture: pref }, city); };
        container.appendChild(btn);
    });
    const allBtn = document.createElement('button');
    allBtn.className = 'lh-area-btn all-btn';
    allBtn.style.cssText = 'grid-column:1/-1;margin-top:8px;';
    allBtn.textContent = '▶ このエリア全体を見る';
    allBtn.onclick = () => { pageStack.push(() => showCityPage(region, pref, majorArea)); fetchAndShowHotels({ prefecture: pref, major_area: majorArea }); };
    container.appendChild(allBtn);
}

async function showDetailAreaPage(region, pref, majorArea, detailArea) {
    if (document.activeElement) document.activeElement.blur();
    currentPage = () => showDetailAreaPage(region, pref, majorArea, detailArea);
    updateUrl({ pref, area: majorArea, detail: detailArea });
    setTitle(detailArea);
    updatePageTitle(detailArea + 'のラブホテル検索');
    setBackBtn(true);
    setBreadcrumb([
        { label: '日本全国', onclick: 'showJapanPage()' },
        { label: region.label, onclick: `showPrefPage(REGION_MAP.find(r=>r.label==='${region.label}'))` },
        { label: pref, onclick: `showMajorAreaPage(REGION_MAP.find(r=>r.label==='${region.label}'), '${pref}')` },
        { label: majorArea, onclick: `showCityPage(REGION_MAP.find(r=>r.label==='${region.label}'), '${pref}', '${majorArea}')` },
        { label: detailArea }
    ]);
    clearHotelList();

    const container = document.getElementById('area-button-container');
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--lh-text-3);font-size:13px;">読み込み中...</div>';
    container.className = 'lh-area-grid';

    let data = [];
    let from = 0;
    while (true) {
        const { data: chunk, error } = await hotelsQueryColumns('id,address,city').eq('prefecture', pref).eq('major_area', majorArea).eq('detail_area', detailArea).range(from, from + 999);
        if (error || !chunk || !chunk.length) break;
        data = data.concat(chunk);
        if (chunk.length < 1000) break;
        from += 1000;
    }

    const citySetDA = new Set();
    data.forEach(h => { const c = h.city || extractCity(h.address); if (c) citySetDA.add(c); });
    const candidateCitiesDA = [...citySetDA];

    const cityCount = {};
    if (candidateCitiesDA.length > 0) {
        let countRows = [];
        let countFrom = 0;
        while (true) {
            const { data: chunk } = await hotelsQueryColumns('city').eq('prefecture', pref).in('city', candidateCitiesDA).range(countFrom, countFrom + 999);
            if (!chunk || !chunk.length) break;
            countRows = countRows.concat(chunk);
            if (chunk.length < 1000) break;
            countFrom += 1000;
        }
        countRows.forEach(h => { if (h.city) cityCount[h.city] = (cityCount[h.city] || 0) + 1; });
    }
    const cities = candidateCitiesDA.sort((a, b) => (cityCount[b] || 0) - (cityCount[a] || 0));

    if (!cities.length) { fetchAndShowHotels({ prefecture: pref, major_area: majorArea, detail_area: detailArea }); return; }

    container.innerHTML = '';
    cities.forEach((city, i) => {
        const btn = document.createElement('button');
        btn.className = 'lh-area-btn';
        btn.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
        btn.innerHTML = `<span>${city}</span><span class="city-count">${cityCount[city] || 0}</span>`;
        btn.onclick = () => {
            pageStack.push(() => showDetailAreaPage(region, pref, majorArea, detailArea));
            fetchAndShowHotelsByCity({ prefecture: pref }, city);
        };
        container.appendChild(btn);
    });
    const allBtn = document.createElement('button');
    allBtn.className = 'lh-area-btn all-btn';
    allBtn.style.cssText = 'grid-column:1/-1;margin-top:8px;';
    allBtn.textContent = '▶ このエリア全体を見る';
    allBtn.onclick = () => {
        pageStack.push(() => showDetailAreaPage(region, pref, majorArea, detailArea));
        fetchAndShowHotels({ prefecture: pref, major_area: majorArea, detail_area: detailArea });
    };
    container.appendChild(allBtn);
}

// ==========================================================================
// 戻る
// ==========================================================================
function backLevel() { history.back(); }

// ==========================================================================
// ホテル取得 + サマリー
// ==========================================================================
async function fetchHotelsWithSummary(query) {
    const { data: hotels, error } = await query;
    if (error) throw error;
    if (!hotels || !hotels.length) return [];
    const hotelIds = hotels.map(h => h.id);
    const summaries = await fetchReviewSummaries(hotelIds);
    return hotels.map(h => ({ ...h, reviewSummary: summaries[h.id] || null }));
}

function getReviewCount(h) { return h.reviewSummary ? h.reviewSummary.count : 0; }

function sortHotelsByReviews(hotels) {
    hotels.sort((a, b) => {
        const ca = getReviewCount(a), cb = getReviewCount(b);
        if (ca !== cb) return cb - ca;
        return (a.name || '').localeCompare(b.name || '', 'ja');
    });
}

async function fetchAndShowHotels(filterObj) {
    currentPage = () => fetchAndShowHotels(filterObj);
    showLoading();
    document.getElementById('area-button-container').innerHTML = '';
    hideHotelTabs();
    try {
        let query = hotelsQuery().limit(1000);
        Object.keys(filterObj).forEach(k => { query = query.eq(k, filterObj[k]); });
        const keyword = document.getElementById('keyword')?.value?.trim() || '';
        query = applyKeywordFilter(query, keyword);
        let hotels = await fetchHotelsWithSummary(query);
        sortHotelsByReviews(hotels);
        renderHotelCards(hotels);
        setResultStatus(hotels.length);
    } catch (e) { /* error silenced */ }
    finally { hideLoading(); }
}

async function fetchAndShowHotelsByCity(filterObj, city) {
    const _urlP = {};
    if (filterObj.prefecture) _urlP.pref = filterObj.prefecture;
    if (filterObj.major_area) _urlP.area = filterObj.major_area;
    if (filterObj.detail_area) _urlP.detail = filterObj.detail_area;
    _urlP.city = city;
    updateUrl(_urlP);
    showLoading();
    document.getElementById('area-button-container').innerHTML = '';
    setTitle(city);
    updatePageTitle(city + 'のラブホテル一覧');

    const pref = filterObj.prefecture;
    const majorArea = filterObj.major_area;
    const detailArea = filterObj.detail_area;
    const region = REGION_MAP.find(r => r.prefs.includes(pref));
    const regionLabel = region ? region.label : '';
    const crumbs = [{ label: '日本全国', onclick: 'showJapanPage()' }];
    if (regionLabel) crumbs.push({ label: regionLabel, onclick: `showPrefPage(REGION_MAP.find(r=>r.label==='${regionLabel}'))` });
    if (pref) crumbs.push({ label: pref, onclick: `showMajorAreaPage(REGION_MAP.find(r=>r.label==='${regionLabel}'), '${pref}')` });
    if (majorArea) crumbs.push({ label: majorArea, onclick: `showCityPage(REGION_MAP.find(r=>r.label==='${regionLabel}'), '${pref}', '${majorArea}')` });
    if (detailArea) crumbs.push({ label: detailArea, onclick: `showDetailAreaPage(REGION_MAP.find(r=>r.label==='${regionLabel}'), '${pref}', '${majorArea}', '${detailArea}')` });
    crumbs.push({ label: city });
    setBreadcrumb(crumbs);

    try {
        let query = hotelsQuery().limit(1000);
        if (filterObj.prefecture) query = query.eq('prefecture', filterObj.prefecture);
        query = query.ilike('city', `${city}%`);
        let hotels = await fetchHotelsWithSummary(query);
        sortHotelsByReviews(hotels);
        renderHotelCards(hotels);
        setResultStatus(hotels.length);

        // ホテルタブ表示
        showHotelTabs(pref, city, hotels.length);
    } catch (e) { /* error silenced */ }
    finally { hideLoading(); }
}

// ==========================================================================
// ホテルタブ（portal.htmlへの逆リンク）
// ==========================================================================
async function showHotelTabs(pref, city, lovehoCount) {
    hideHotelTabs();
    if (!pref || !city) return;

    // 通常ホテル件数を取得（love_hotel除外）
    const { data: hotelRows } = await supabaseClient.from('hotels')
        .select('id')
        .eq('prefecture', pref)
        .eq('city', city)
        .not('hotel_type', 'in', '("love_hotel","rental_room")')
        .eq('is_published', true)
        .limit(50);
    const hotelCount = hotelRows ? hotelRows.length : 0;

    const portalUrl = 'https://yobuho.com/portal.html?mode=men&pref=' + encodeURIComponent(pref) + '&city=' + encodeURIComponent(city);
    const tabsDiv = document.createElement('div');
    tabsDiv.id = 'lh-hotel-tabs';
    tabsDiv.style.cssText = 'display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid rgba(255,255,255,0.1);max-width:640px;margin-left:auto;margin-right:auto;padding:0 16px;';
    tabsDiv.innerHTML = `
        <a href="${portalUrl}" style="padding:10px 24px;border:none;background:transparent;cursor:pointer;font-size:14px;color:var(--lh-text-3);border-bottom:3px solid transparent;text-decoration:none;font-family:inherit;display:flex;align-items:center;">🏨 ホテル (${hotelCount || 0})</a>
        <button style="padding:10px 24px;border:none;background:transparent;cursor:default;font-size:14px;font-weight:bold;border-bottom:3px solid var(--lh-accent);color:var(--lh-accent);font-family:inherit;">🏩 ラブホ (${lovehoCount})</button>
    `;

    const hotelList = document.getElementById('hotel-list');
    hotelList.parentNode.insertBefore(tabsDiv, hotelList);
}

function hideHotelTabs() {
    const existing = document.getElementById('lh-hotel-tabs');
    if (existing) existing.remove();
}

function setResultStatus(count) {
    const el = document.getElementById('result-status');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = count > 0 ? `<strong>${count}</strong> 件のラブホテル` : 'ラブホテルが見つかりませんでした';
}

// ==========================================================================
// 検索
// ==========================================================================
function applyKeywordFilter(query, rawKeyword) {
    if (!rawKeyword) return query;
    const words = rawKeyword.trim().split(/[\s　]+/).filter(w => w.length > 0);
    for (const word of words) { query = query.or(`name.ilike.%${word}%,address.ilike.%${word}%`); }
    return query;
}

let searchTimeout = null;
function fetchHotelsFromSearch() {
    const keyword = document.getElementById('keyword')?.value?.trim() || '';
    document.getElementById('search-clear-btn').style.display = keyword ? 'block' : 'none';
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        if (keyword.length < 2) return;
        showLoading();
        setBreadcrumb([{ label: '日本全国', onclick: 'showJapanPage()' }, { label: `「${keyword}」の検索結果` }]);
        setTitle(`「${keyword}」の検索結果`);
        setBackBtn(true);
        pageStack.push(showJapanPage);
        document.getElementById('area-button-container').innerHTML = '';
        try {
            let query = hotelsQuery().limit(1000);
            query = applyKeywordFilter(query, keyword);
            let hotels = await fetchHotelsWithSummary(query);
            sortHotelsByReviews(hotels);
            renderHotelCards(hotels);
            setResultStatus(hotels.length);
        } catch (e) { /* error silenced */ }
        finally { hideLoading(); }
    }, 500);
}
function clearSearch() {
    const input = document.getElementById('keyword');
    if (input) { input.value = ''; input.focus(); }
    document.getElementById('search-clear-btn').style.display = 'none';
}

let stationTimeout = null;
function fetchHotelsByStation() {
    const val = document.getElementById('station-input')?.value?.trim() || '';
    clearTimeout(stationTimeout);
    if (!val) return;
    stationTimeout = setTimeout(async () => {
        showLoading();
        setBreadcrumb([{ label: '日本全国', onclick: 'showJapanPage()' }, { label: `🚉 ${val}駅周辺` }]);
        setTitle(`${val}駅 周辺のラブホテル`);
        setBackBtn(true);
        pageStack.push(showJapanPage);
        document.getElementById('area-button-container').innerHTML = '';
        try {
            let query = hotelsQuery().ilike('nearest_station', `%${val}%`).limit(1000);
            let hotels = await fetchHotelsWithSummary(query);
            sortHotelsByReviews(hotels);
            renderHotelCards(hotels);
            setResultStatus(hotels.length);
        } catch (e) { /* error silenced */ }
        finally { hideLoading(); }
    }, 500);
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

async function searchByLocation() {
    const btn = document.getElementById('btn-location');
    if (btn) { btn.querySelector('.label').textContent = '取得中...'; }
    if (!navigator.geolocation) { showToast('位置情報がサポートされていません', 3000); resetLocationBtn(); return; }
    showLoading('位置情報を取得中...');
    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            setBreadcrumb([{ label: '日本全国', onclick: 'showJapanPage()' }, { label: '📍 現在地周辺' }]);
            setTitle('現在地周辺のラブホテル');
            setBackBtn(true);
            pageStack.push(showJapanPage);
            document.getElementById('area-button-container').innerHTML = '';
            try {
                const { data: allH, error } = await hotelsQuery().not('latitude', 'is', null).not('longitude', 'is', null).limit(5000);
                if (error) throw error;
                const withDist = allH.map(h => ({ ...h, distance: calcDistance(lat, lng, h.latitude, h.longitude) })).sort((a, b) => a.distance - b.distance).slice(0, 60);
                const hotelIds = withDist.map(h => h.id);
                const summaries = await fetchReviewSummaries(hotelIds);
                const withSummary = withDist.map(h => ({ ...h, reviewSummary: summaries[h.id] || null }));
                const withReviews = withSummary.filter(h => getReviewCount(h) > 0);
                const noReviews = withSummary.filter(h => getReviewCount(h) === 0);
                sortHotelsByReviews(withReviews);
                const sorted = [...withReviews, ...noReviews];
                renderHotelCards(sorted, true);
                const status = document.getElementById('result-status');
                if (status) { status.style.display = 'block'; status.innerHTML = `📍 現在地周辺 — <strong>${sorted.length}</strong> 件`; }
            } catch (e) { /* error silenced */ showToast('検索中にエラーが発生しました', 4000); }
            finally { hideLoading(); resetLocationBtn(); }
        },
        () => { hideLoading(); resetLocationBtn(); showToast('位置情報を取得できませんでした', 4000); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
}
function resetLocationBtn() {
    const el = document.getElementById('btn-location-label');
    if (el) el.textContent = '現在地';
}

// ==========================================================================
// ホテルカード
// ==========================================================================
let allHotels = [];
let displayedCount = 0;
let showDistanceFlag = false;
const HOTELS_PER_PAGE = 20;

function buildCardHTML(h, i, showDistance) {
    const s = h.reviewSummary;
    const reviewCount = s ? s.count : 0;
    const avgRecommend = s && s.count ? (s.recommend_sum / s.count) : 0;
    const avgCleanliness = s && s.count ? (s.cleanliness_sum / s.count) : 0;

    const distHTML = showDistance && h.distance != null
        ? `<div style="font-size:11px;color:var(--lh-accent);margin-bottom:4px;">📍 ${h.distance < 1 ? Math.round(h.distance * 1000) + 'm' : h.distance.toFixed(1) + 'km'}</div>`
        : '';

    const starsRow = avgRecommend > 0
        ? `<div class="lh-summary-bar">
            <div class="lh-summary-item"><span class="label">おすすめ</span>${starsHTML(avgRecommend)}<span class="value">${avgRecommend.toFixed(1)}</span></div>
            ${avgCleanliness > 0 ? `<div class="lh-summary-item"><span class="label">清潔感</span><span class="value">${avgCleanliness.toFixed(1)}</span></div>` : ''}
          </div>`
        : '';

    const reviewBadge = reviewCount > 0 ? `<span class="lh-review-badge">💬 ${reviewCount}件</span>` : '';

    return `
    <div class="lh-hotel-card" style="animation-delay:${Math.min(i * 0.04, 0.4)}s" onclick="openHotelDetail(${h.id})">
        ${distHTML}
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <div class="hotel-name" style="flex:1;min-width:0;">${esc(h.name)}</div>
            ${reviewBadge}
        </div>
        <div class="hotel-address">📍 ${esc(h.address || '')}</div>
        ${h.nearest_station ? `<div class="hotel-station">🚉 ${esc(h.nearest_station)}</div>` : ''}
        ${h.tel ? `<div class="hotel-tel">📞 ${esc(h.tel)}</div>` : ''}
        ${starsRow}
        <div class="lh-card-footer">
            <button class="lh-btn-check" onclick="event.stopPropagation();openHotelDetail(${h.id})">✨ 詳細をCHECK${reviewCount > 0 ? ` (💬${reviewCount})` : ''}</button>
            <button class="lh-btn-review" onclick="event.stopPropagation();openHotelDetail(${h.id})">📝 口コミを投稿</button>
        </div>
    </div>`;
}

function renderHotelCards(hotels, showDistance = false) {
    const container = document.getElementById('hotel-list');
    if (!hotels.length) {
        container.innerHTML = '<div style="text-align:center;padding:60px;color:var(--lh-text-3);">🔍 ラブホテルが見つかりませんでした</div>';
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
    const old = document.getElementById('lh-load-more');
    if (old) old.remove();

    const nextBatch = allHotels.slice(displayedCount, displayedCount + HOTELS_PER_PAGE);
    container.insertAdjacentHTML('beforeend', nextBatch.map((h, i) => buildCardHTML(h, displayedCount + i, showDistanceFlag)).join(''));
    displayedCount += nextBatch.length;

    const remaining = allHotels.length - displayedCount;
    if (remaining > 0) {
        container.insertAdjacentHTML('beforeend', `
            <div id="lh-load-more" class="lh-load-more">
                <button onclick="loadMoreHotels()">もっと見る（残り${remaining}件）</button>
            </div>`);
    }
}

// ==========================================================================
// ホテル詳細
// ==========================================================================
let currentHotelId = null;
let formState = {};

function openHotelDetail(hotelId) {
    if (document.activeElement) document.activeElement.blur();
    showHotelPanel(hotelId);
}

function showPortalMode() {
    document.querySelector('.lh-area-section').style.display = '';
    document.querySelector('.lh-search-tools').style.display = '';
    document.getElementById('hotel-list').style.display = '';
    document.getElementById('hotel-detail-panel').style.display = 'none';
    const rs = document.getElementById('result-status');
    if (rs) rs.style.display = '';
}

function showHotelPanel(hotelId) {
    updateUrl({ hotel: hotelId });
    currentHotelId = hotelId;
    formState = { solo_entry: '', can_go_out: '', atmosphere: '', cleanliness: 0, recommend: 0, cost_performance: 0, parking: '', room_type: '', facilities: [], rest_price: '', stay_price: '', time_slot: '', comment: '', poster_name: '' };

    document.querySelector('.lh-area-section').style.display = 'none';
    document.querySelector('.lh-search-tools').style.display = 'none';
    const rs = document.getElementById('result-status');
    if (rs) rs.style.display = 'none';
    document.getElementById('hotel-list').style.display = 'none';

    const panel = document.getElementById('hotel-detail-panel');
    panel.style.display = 'block';
    loadHotelDetail(hotelId);
    window.scrollTo(0, 0);
}

function closeHotelPanel() { history.back(); }

function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

// マスタデータ
let MASTER = { atmospheres: [], room_types: [], facilities: [], price_ranges_rest: [], price_ranges_stay: [], time_slots: [] };

async function loadMasters() {
    const [atm, rt, fac, pr, ts] = await Promise.all([
        supabaseClient.from('loveho_atmospheres').select('label').order('sort_order').then(r => r.data || []),
        supabaseClient.from('loveho_room_types').select('label').order('sort_order').then(r => r.data || []),
        supabaseClient.from('loveho_facilities').select('label').order('sort_order').then(r => r.data || []),
        supabaseClient.from('loveho_price_ranges').select('label,type').order('sort_order').then(r => r.data || []),
        supabaseClient.from('loveho_time_slots').select('label').order('sort_order').then(r => r.data || []),
    ]);
    MASTER.atmospheres = atm.map(r => r.label);
    MASTER.room_types = rt.map(r => r.label);
    MASTER.facilities = fac.map(r => r.label);
    MASTER.price_ranges_rest = pr.filter(r => r.type === 'rest').map(r => r.label);
    MASTER.price_ranges_stay = pr.filter(r => r.type === 'stay').map(r => r.label);
    MASTER.time_slots = ts.map(r => r.label);
    // フォールバック
    if (!MASTER.time_slots.length) MASTER.time_slots = ['早朝（5:00〜8:00）','朝（8:00〜11:00）','昼（11:00〜16:00）','夕方（16:00〜18:00）','夜（18:00〜23:00）','深夜（23:00〜5:00）'];
}

async function loadHotelDetail(hotelId) {
    const content = document.getElementById('hotel-detail-content');
    content.innerHTML = '<div style="text-align:center;padding:60px;color:var(--lh-text-3);">読み込み中...</div>';

    try {
        await loadMasters();
        const [hotelRes, reportsRes] = await Promise.all([
            supabaseClient.from('hotels').select('*').eq('id', hotelId).eq('is_published', true).maybeSingle(),
            supabaseClient.from('loveho_reports').select('*').eq('hotel_id', hotelId).order('created_at', { ascending: false }).limit(50),
        ]);
        if (!hotelRes.data) throw new Error('Hotel not found');
        renderHotelDetail(hotelRes.data, reportsRes.data || []);
    } catch (e) {
        /* error silenced */
        content.innerHTML = '<div style="text-align:center;padding:60px;color:#c05050;">読み込みエラーが発生しました</div>';
    }
}

function renderHotelDetail(hotel, reports) {
    const h = hotel;
    const googleSearch = `https://www.google.com/search?q=${encodeURIComponent(h.name)}`;
    const googleMap = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.address || h.name)}`;

    // サマリー集計
    let recSum = 0, cleanSum = 0, cpSum = 0, rated = 0;
    let aloneY = 0, aloneN = 0, aloneU = 0, outsideY = 0, outsideN = 0, outsideU = 0;
    let parkingY = 0, parkingN = 0, parkingU = 0;
    const facilityCount = {};

    reports.forEach(r => {
        if (r.recommendation) { recSum += r.recommendation; rated++; }
        if (r.cleanliness) cleanSum += r.cleanliness;
        if (r.cost_performance) cpSum += r.cost_performance;
        if (r.solo_entry === 'yes') aloneY++;
        else if (r.solo_entry === 'no') aloneN++;
        else aloneU++;
        if (r.can_go_out === 'yes') outsideY++;
        else if (r.can_go_out === 'no') outsideN++;
        else outsideU++;
        if (r.parking === 'yes') parkingY++;
        else if (r.parking === 'no') parkingN++;
        else parkingU++;
        if (r.facilities) {
            (Array.isArray(r.facilities) ? r.facilities : []).forEach(f => {
                facilityCount[f] = (facilityCount[f] || 0) + 1;
            });
        }
    });

    const avgRec = rated ? (recSum / rated).toFixed(1) : '-';
    const avgClean = rated ? (cleanSum / rated).toFixed(1) : '-';
    const avgCp = rated ? (cpSum / rated).toFixed(1) : '-';

    function ynBarHTML(title, yes, no, unknown) {
        const total = yes + no + unknown;
        if (!total) return '';
        const yPct = Math.round(yes/total*100), nPct = Math.round(no/total*100), uPct = 100 - yPct - nPct;
        return `<div class="lh-yn-bar">
            <div class="title">${title}</div>
            <div class="bar">
                ${yPct > 0 ? `<div class="yes" style="width:${yPct}%">Yes ${yPct}%</div>` : ''}
                ${nPct > 0 ? `<div class="no" style="width:${nPct}%">No ${nPct}%</div>` : ''}
                ${uPct > 0 ? `<div class="unknown" style="width:${uPct}%">?</div>` : ''}
            </div>
        </div>`;
    }

    // 設備タグ
    const facilityTags = Object.entries(facilityCount).sort((a,b) => b[1]-a[1]).map(([f,c]) => `<span class="lh-facility-tag">${esc(f)} (${c})</span>`).join('');

    // 口コミ一覧
    const reviewsHTML = reports.map(r => {
        const tags = [];
        if (r.atmosphere) tags.push(r.atmosphere);
        if (r.room_type) tags.push(r.room_type);
        if (r.time_slot) tags.push(r.time_slot);
        if (r.rest_price) tags.push('休憩: ' + r.rest_price);
        if (r.stay_price) tags.push('宿泊: ' + r.stay_price);
        return `<div class="lh-review-card">
            <div class="header">
                <span class="poster">${esc(r.poster_name || '匿名')}</span>
                <span class="date">${formatDate(r.created_at)}</span>
            </div>
            <div class="ratings">
                ${r.recommendation ? `<span>おすすめ ${starsHTML(r.recommendation)} ${r.recommendation}</span>` : ''}
                ${r.cleanliness ? `<span>清潔感 ${r.cleanliness}</span>` : ''}
                ${r.cost_performance ? `<span>コスパ ${r.cost_performance}</span>` : ''}
            </div>
            ${r.comment ? `<div class="comment">${esc(r.comment)}</div>` : ''}
            <div class="tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
            <button class="flag-btn" onclick="event.stopPropagation();openFlagModal('${r.id}')">🚩 報告</button>
        </div>`;
    }).join('');

    // フォーム
    const selectOptions = (arr, name) => `<option value="">選択してください</option>` + arr.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    const facilitiesCheckboxes = MASTER.facilities.map(f =>
        `<label class="lh-checkbox-item" onclick="toggleFacility(this,'${esc(f)}')">
            <input type="checkbox" value="${esc(f)}"><span>${esc(f)}</span>
        </label>`
    ).join('');

    const content = document.getElementById('hotel-detail-content');
    content.innerHTML = `
        <button onclick="closeHotelPanel()" style="display:inline-flex;align-items:center;gap:4px;background:transparent;border:1px solid var(--lh-border);border-radius:20px;padding:6px 14px;color:var(--lh-text-2);font-size:12px;cursor:pointer;font-family:inherit;margin-bottom:16px;">← 一覧に戻る</button>

        <div class="lh-detail-name">
            <a href="${googleSearch}" target="_blank" rel="noopener">${esc(h.name)}</a>
        </div>

        <div class="lh-detail-info">
            <div class="row"><span class="icon">📍</span><a href="${googleMap}" target="_blank" rel="noopener">${esc(h.address || '住所不明')}</a></div>
            ${h.tel ? `<div class="row"><span class="icon">📞</span><a href="tel:${h.tel}">${esc(h.tel)}</a></div>` : ''}
            ${h.nearest_station ? `<div class="row"><span class="icon">🚉</span><span>${esc(h.nearest_station)}</span></div>` : ''}
        </div>

        ${reports.length > 0 ? `
        <div class="lh-detail-summary">
            <div class="item"><div class="label">おすすめ度</div><div class="value">${avgRec}</div>${rated ? starsHTML(recSum/rated) : ''}</div>
            <div class="item"><div class="label">清潔感</div><div class="value">${avgClean}</div></div>
            <div class="item"><div class="label">コスパ</div><div class="value">${avgCp}</div></div>
        </div>

        ${ynBarHTML('一人で入れる？', aloneY, aloneN, aloneU)}
        ${ynBarHTML('外出可能？', outsideY, outsideN, outsideU)}
        ${ynBarHTML('駐車場', parkingY, parkingN, parkingU)}

        ${facilityTags ? `<div style="margin-bottom:16px;"><div style="font-size:12px;font-weight:600;color:var(--lh-text-2);margin-bottom:8px;">設備（口コミから集計）</div><div class="lh-facility-tags">${facilityTags}</div></div>` : ''}
        ` : '<div style="text-align:center;padding:20px;color:var(--lh-text-3);font-size:13px;">まだ口コミがありません</div>'}

        <div class="lh-reviews-section">
            <h3>💬 口コミ一覧 (${reports.length}件)</h3>
            ${reviewsHTML || '<div style="color:var(--lh-text-3);font-size:13px;">まだ口コミがありません。最初の投稿をお待ちしています！</div>'}
        </div>

        <div class="lh-report-form">
            <h3>口コミを投稿する</h3>

            <div class="lh-form-group">
                <label>一人で先に入れる？</label>
                <select id="form-alone" onchange="formState.solo_entry=this.value">
                    <option value="">選択してください</option>
                    <option value="yes">はい</option>
                    <option value="no">いいえ</option>
                    <option value="unknown">わからない</option>
                </select>
            </div>

            <div class="lh-form-group">
                <label>外出可能？</label>
                <select id="form-outside" onchange="formState.can_go_out=this.value">
                    <option value="">選択してください</option>
                    <option value="yes">はい</option>
                    <option value="no">いいえ</option>
                    <option value="unknown">わからない</option>
                </select>
            </div>

            ${MASTER.atmospheres.length ? `
            <div class="lh-form-group">
                <label>雰囲気</label>
                <select id="form-atmosphere" onchange="formState.atmosphere=this.value">
                    ${selectOptions(MASTER.atmospheres)}
                </select>
            </div>` : ''}

            <div class="lh-form-group">
                <label>清潔感</label>
                <div class="lh-star-select" id="star-cleanliness">
                    ${[1,2,3,4,5].map(n => `<span onclick="setStarRating('cleanliness',${n})">★</span>`).join('')}
                </div>
            </div>

            <div class="lh-form-group">
                <label>おすすめ度</label>
                <div class="lh-star-select" id="star-recommend">
                    ${[1,2,3,4,5].map(n => `<span onclick="setStarRating('recommend',${n})">★</span>`).join('')}
                </div>
            </div>

            <div class="lh-form-group">
                <label>コスパ</label>
                <div class="lh-star-select" id="star-cost_performance">
                    ${[1,2,3,4,5].map(n => `<span onclick="setStarRating('cost_performance',${n})">★</span>`).join('')}
                </div>
            </div>

            <div class="lh-form-group">
                <label>駐車場</label>
                <select id="form-parking" onchange="formState.parking=this.value">
                    <option value="">選択してください</option>
                    <option value="yes">あり</option>
                    <option value="no">なし</option>
                    <option value="unknown">わからない</option>
                </select>
            </div>

            ${MASTER.room_types.length ? `
            <div class="lh-form-group">
                <label>ルームタイプ</label>
                <select id="form-room-type" onchange="formState.room_type=this.value">
                    ${selectOptions(MASTER.room_types)}
                </select>
            </div>` : ''}

            ${MASTER.facilities.length ? `
            <div class="lh-form-group">
                <label>設備（複数選択可）</label>
                <div class="lh-checkbox-grid" id="facility-checkboxes">${facilitiesCheckboxes}</div>
            </div>` : ''}

            ${MASTER.price_ranges_rest.length ? `
            <div class="lh-form-group">
                <label>休憩料金帯</label>
                <select id="form-rest-price" onchange="formState.rest_price=this.value">
                    ${selectOptions(MASTER.price_ranges_rest)}
                </select>
            </div>` : ''}

            ${MASTER.price_ranges_stay.length ? `
            <div class="lh-form-group">
                <label>宿泊料金帯</label>
                <select id="form-stay-price" onchange="formState.stay_price=this.value">
                    ${selectOptions(MASTER.price_ranges_stay)}
                </select>
            </div>` : ''}

            <div class="lh-form-group">
                <label>利用時間帯</label>
                <select id="form-time-slot" onchange="formState.time_slot=this.value">
                    ${selectOptions(MASTER.time_slots)}
                </select>
            </div>

            <div class="lh-form-group">
                <label>フリーコメント</label>
                <textarea id="form-comment" placeholder="良かった点、気になった点など自由にお書きください" oninput="formState.comment=this.value"></textarea>
            </div>

            <div class="lh-form-group">
                <label>投稿者名（任意）</label>
                <input type="text" id="form-poster-name" placeholder="無記名" oninput="formState.poster_name=this.value">
            </div>

            <button class="lh-btn-submit" onclick="showPostConfirm()">投稿する</button>
        </div>
    `;
}

// ==========================================================================
// フォームヘルパー
// ==========================================================================
function setStarRating(field, value) {
    formState[field] = value;
    const container = document.getElementById('star-' + field);
    if (!container) return;
    const spans = container.querySelectorAll('span');
    spans.forEach((s, i) => { s.classList.toggle('active', i < value); });
}

function toggleFacility(el, name) {
    const cb = el.querySelector('input');
    cb.checked = !cb.checked;
    el.classList.toggle('checked', cb.checked);
    if (cb.checked) { if (!formState.facilities.includes(name)) formState.facilities.push(name); }
    else { formState.facilities = formState.facilities.filter(f => f !== name); }
}

// ==========================================================================
// 投稿確認 + 送信
// ==========================================================================
function showPostConfirm() {
    const items = [];
    if (formState.solo_entry) items.push(`一人で入れる: ${formState.solo_entry === 'yes' ? 'はい' : formState.solo_entry === 'no' ? 'いいえ' : 'わからない'}`);
    if (formState.can_go_out) items.push(`外出可能: ${formState.can_go_out === 'yes' ? 'はい' : formState.can_go_out === 'no' ? 'いいえ' : 'わからない'}`);
    if (formState.atmosphere) items.push(`雰囲気: ${formState.atmosphere}`);
    if (formState.cleanliness) items.push(`清潔感: ${'★'.repeat(formState.cleanliness)}`);
    if (formState.recommend) items.push(`おすすめ度: ${'★'.repeat(formState.recommend)}`);
    if (formState.cost_performance) items.push(`コスパ: ${'★'.repeat(formState.cost_performance)}`);
    if (formState.parking) items.push(`駐車場: ${formState.parking === 'yes' ? 'あり' : formState.parking === 'no' ? 'なし' : 'わからない'}`);
    if (formState.room_type) items.push(`ルームタイプ: ${formState.room_type}`);
    if (formState.facilities.length) items.push(`設備: ${formState.facilities.join(', ')}`);
    if (formState.rest_price) items.push(`休憩料金帯: ${formState.rest_price}`);
    if (formState.stay_price) items.push(`宿泊料金帯: ${formState.stay_price}`);
    if (formState.time_slot) items.push(`利用時間帯: ${formState.time_slot}`);
    if (formState.comment) items.push(`コメント: ${formState.comment}`);
    items.push(`投稿者名: ${formState.poster_name || '匿名'}`);

    if (items.length <= 1) { showToast('少なくとも1つ以上の項目を入力してください'); return; }

    document.getElementById('post-confirm-content').innerHTML = items.map(i => `<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px;color:var(--lh-text);">${esc(i)}</div>`).join('');
    document.getElementById('post-confirm-modal').style.display = 'flex';
}

function closePostConfirmModal() { document.getElementById('post-confirm-modal').style.display = 'none'; }

async function doSubmitReport() {
    const btn = document.getElementById('btn-do-submit');
    btn.disabled = true;
    btn.textContent = '送信中...';

    if (!currentHotelId) {
        showToast('ホテルが選択されていません。ページを再読み込みしてください。');
        btn.disabled = false;
        btn.textContent = 'この内容で投稿する';
        return;
    }

    try {
        const payload = {
            hotel_id: currentHotelId,
            solo_entry: formState.solo_entry || null,
            atmosphere: formState.atmosphere || null,
            cleanliness: formState.cleanliness || null,
            recommendation: formState.recommend || null,
            cost_performance: formState.cost_performance || null,
            good_points: formState.facilities && formState.facilities.length ? formState.facilities : null,
            time_slot: formState.time_slot || null,
            comment: formState.comment || null,
            poster_name: formState.poster_name || null,
        };

        const { error } = await supabaseClient.from('loveho_reports').insert(payload);
        if (error) throw error;

        closePostConfirmModal();
        showSuccessModal('投稿完了', '口コミを投稿しました。ありがとうございます！');
        loadHotelDetail(currentHotelId);
    } catch (e) {
        /* error silenced */
        showToast('投稿エラーが発生しました');
    } finally {
        btn.disabled = false;
        btn.textContent = 'この内容で投稿する';
    }
}

// ==========================================================================
// 報告（フラグ）
// ==========================================================================
let flagTargetId = null;
let flagReason = '';

function openFlagModal(reportId) {
    flagTargetId = reportId;
    flagReason = '';
    document.getElementById('flag-step1').style.display = 'block';
    document.getElementById('flag-step2').style.display = 'none';
    document.getElementById('flag-reason-err').style.display = 'none';
    document.getElementById('flag-comment-input').value = '';
    document.querySelectorAll('#flag-reason-btns .lh-area-btn').forEach(b => { b.style.borderColor = ''; b.style.background = ''; });
    document.getElementById('flag-modal').style.display = 'flex';
}

function selectFlagReason(reason, el) {
    flagReason = reason;
    document.querySelectorAll('#flag-reason-btns .lh-area-btn').forEach(b => { b.style.borderColor = ''; b.style.background = ''; });
    el.style.borderColor = 'var(--lh-accent)';
    el.style.background = 'rgba(201,169,110,0.1)';
    document.getElementById('flag-reason-err').style.display = 'none';
}

function showFlagConfirm() {
    if (!flagReason) { document.getElementById('flag-reason-err').style.display = 'block'; return; }
    document.getElementById('flag-confirm-reason').textContent = flagReason;
    const comment = document.getElementById('flag-comment-input').value.trim();
    const cw = document.getElementById('flag-confirm-comment-wrap');
    if (comment) { cw.style.display = 'block'; document.getElementById('flag-confirm-comment').textContent = comment; }
    else { cw.style.display = 'none'; }
    document.getElementById('flag-step1').style.display = 'none';
    document.getElementById('flag-step2').style.display = 'block';
}

function showFlagStep1() {
    document.getElementById('flag-step1').style.display = 'block';
    document.getElementById('flag-step2').style.display = 'none';
}

function closeFlagModal() { document.getElementById('flag-modal').style.display = 'none'; }

async function submitFlag() {
    if (!flagTargetId || !flagReason) return;
    const flag_comment = document.getElementById('flag-comment-input').value.trim() || null;
    const { error } = await supabaseClient.from('loveho_reports').update({
        flagged_at: new Date().toISOString(),
        flag_reason: flagReason,
        flag_comment,
    }).eq('id', flagTargetId);
    closeFlagModal();
    if (error) {
        showToast('報告の送信に失敗しました');
    } else {
        showToast('🚩 報告を受け付けました。ご協力ありがとうございます。');
    }
}

// ==========================================================================
// URL復元 + 起動
// ==========================================================================
function restoreFromUrl() {
    const params = new URLSearchParams(window.location.search);
    _skipPushState = true;

    if (params.get('hotel')) {
        showHotelPanel(parseInt(params.get('hotel')));
        _skipPushState = false;
        return;
    }

    showPortalMode();

    if (params.get('city')) {
        const pref = params.get('pref'), area = params.get('area'), detail = params.get('detail'), city = params.get('city');
        const region = findRegionByPref(pref);
        pageStack = [showJapanPage];
        if (region) pageStack.push(() => showPrefPage(region));
        if (pref) pageStack.push(() => showMajorAreaPage(region, pref));
        if (pref && area) pageStack.push(() => showCityPage(region, pref, area));
        if (detail) pageStack.push(() => showDetailAreaPage(region, pref, area, detail));
        const filterObj = { prefecture: pref };
        if (area) filterObj.major_area = area;
        if (detail) filterObj.detail_area = detail;
        fetchAndShowHotelsByCity(filterObj, city);
    } else if (params.get('detail')) {
        const pref = params.get('pref'), area = params.get('area'), detail = params.get('detail');
        const region = findRegionByPref(pref);
        pageStack = [showJapanPage];
        if (region) pageStack.push(() => showPrefPage(region));
        if (pref && area) pageStack.push(() => showMajorAreaPage(region, pref));
        if (area) pageStack.push(() => showCityPage(region, pref, area));
        showDetailAreaPage(region, pref, area, detail);
    } else if (params.get('area')) {
        const pref = params.get('pref'), area = params.get('area');
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
        if (region) { pageStack = [showJapanPage]; showPrefPage(region); }
        else showJapanPage();
    } else {
        showJapanPage();
    }
    _skipPushState = false;
}

window.addEventListener('popstate', () => restoreFromUrl());

// 起動
restoreFromUrl();
