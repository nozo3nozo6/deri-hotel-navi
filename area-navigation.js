// ==========================================================================
// area-navigation.js — エリア選択、ページ遷移、URL状態管理
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

    const query_ma = supabaseClient.from('hotels').select('id,major_area,city,address').eq('prefecture', pref).eq('is_published', true).not('hotel_type','in','("love_hotel","rental_room")').limit(5000);
    const { data, error } = await query_ma;
    if (error) { container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#c47a88;">エラー</div>`; return; }

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

    if (noAreaCount > 0) {
        const noAreaHotels = data.filter(h => !h.major_area);
        const noAreaCityCount = {};
        noAreaHotels.forEach(h => {
            const city = h.city || extractCity(h.address);
            if (city) noAreaCityCount[city] = (noAreaCityCount[city] || 0) + 1;
        });
        const noAreaCities = Object.entries(noAreaCityCount).sort((a, b) => b[1] - a[1]);
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

    const detailAreaCount = {};
    data.forEach(h => { if (h.detail_area && h.detail_area !== majorArea) detailAreaCount[h.detail_area] = (detailAreaCount[h.detail_area] || 0) + 1; });
    const hasDetailArea = Object.keys(detailAreaCount).length > 0;

    if (hasDetailArea) {
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

    const citySetLocal = new Set();
    data.forEach(h => {
        const city = h.city || extractCity(h.address);
        if (city) citySetLocal.add(city);
    });
    const candidateCities = [...citySetLocal];

    const cityCount = {};
    const cityAreaCount = {};
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

    const citySet = new Set();
    data.forEach(h => {
        const city = h.city || extractCity(h.address);
        if (city) citySet.add(city);
    });
    const candidateCitiesDA = [...citySet];

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

function backLevel() {
    history.back();
}

function goToHotelCity(regionLabel, pref, majorArea, city) {
    const region = REGION_MAP.find(r => r.label === regionLabel);
    pageStack.push(() => showCityPage(region, pref, majorArea));
    fetchAndShowHotelsByCity({ prefecture: pref, major_area: majorArea }, city);
}
