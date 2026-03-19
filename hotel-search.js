// ==========================================================================
// hotel-search.js — ホテル検索、カード描画、ラブホタブ、詳細
// ==========================================================================

let _fetchGeneration = 0;

// モバイル: 同タブ遷移（戻るで戻れる）、PC: 新タブ
const _extTarget = ('ontouchstart' in window || navigator.maxTouchPoints > 0) ? '_self' : '_blank';

// AppState 登録（検索・表示状態の発見・デバッグ用）
// 各 let 宣言は既存コードとの互換性のためそのまま維持し、
// AppState経由でも読み書き可能にする（Object.defineProperties は各変数宣言後に実行）

async function fetchAndShowHotels(filterObj) {
    const gen = ++_fetchGeneration;
    ++_areaGeneration;
    currentPage = () => fetchAndShowHotels(filterObj);
    showLoading();
    showSkeletonLoader();
    document.getElementById('area-button-container').innerHTML = '';
    hideLovehoTabs();

    try {
        const keyword = document.getElementById('keyword')?.value?.trim() || '';
        let query = supabaseClient.from('hotels').select('*').eq('is_published', true).not('hotel_type','eq','love_hotel').not('hotel_type','eq','rental_room').limit(50);
        Object.keys(filterObj).forEach(k => { query = query.eq(k, filterObj[k]); });
        query = applyKeywordFilter(query, keyword);
        query = query.order('review_average', { ascending: false, nullsFirst: false });

        let hotels = await fetchHotelsWithSummary(query);
        if (gen !== _fetchGeneration) return; // stale, abort
        sortHotelsByReviews(hotels);
        renderHotelCards(hotels);
        setResultStatus(hotels.length);

        // エリア店舗セクション表示
        const pref = filterObj.prefecture;
        if (pref) {
            const genderMode = typeof MODE !== 'undefined' ? MODE : 'men';
            fetchAreaShops(pref, filterObj.city || null, genderMode).then(shops => renderAreaShopSection(shops));
        }
    } catch (e) {
        /* error silenced */
    } finally {
        hideLoading();
    }
}

async function fetchAndShowHotelsByCity(filterObj, city) {
    const gen = ++_fetchGeneration;
    ++_areaGeneration;
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
        let query = supabaseClient.from('hotels').select('*').eq('is_published', true).not('hotel_type','eq','love_hotel').not('hotel_type','eq','rental_room').limit(50);
        if (filterObj.prefecture) query = query.eq('prefecture', filterObj.prefecture);
        query = query.eq('city', city);
        query = query.order('review_average', { ascending: false, nullsFirst: false });

        let hotels = await fetchHotelsWithSummary(query);
        if (gen !== _fetchGeneration) return; // stale, abort
        sortHotelsByReviews(hotels);
        renderHotelCards(hotels);
        setResultStatus(hotels.length);

        _tabFilterObj = filterObj;
        _tabCity = city;

        showLovehoTabs(pref, city, hotels.length, hotels);

        // エリア店舗セクション表示
        const genderMode = typeof MODE !== 'undefined' ? MODE : 'men';
        fetchAreaShops(pref, city, genderMode).then(shops => renderAreaShopSection(shops));
    } catch (e) {
        /* error silenced */
    } finally {
        hideLoading();
    }
}

// ==========================================================================
// ラブホタブ
// ==========================================================================
let currentTab = 'hotel';
let cachedHotelData = null;
let cachedLovehoData = null;
let _tabCityKey = null;
let _tabFilterObj = null;
let _tabCity = null;

// AppState.search 登録
Object.defineProperties(AppState.search, {
    _fetchGeneration:  { get() { return _fetchGeneration; },  set(v) { _fetchGeneration = v; } },
    currentTab:        { get() { return currentTab; },        set(v) { currentTab = v; } },
    cachedHotelData:   { get() { return cachedHotelData; },   set(v) { cachedHotelData = v; } },
    cachedLovehoData:  { get() { return cachedLovehoData; },  set(v) { cachedLovehoData = v; } },
    _tabCityKey:       { get() { return _tabCityKey; },       set(v) { _tabCityKey = v; } },
    _tabFilterObj:     { get() { return _tabFilterObj; },     set(v) { _tabFilterObj = v; } },
    _tabCity:          { get() { return _tabCity; },          set(v) { _tabCity = v; } },
});

async function showLovehoTabs(pref, city, hotelCount, hotels) {
    hideLovehoTabs();
    if (!pref || !city) return;

    const cacheKey = pref + '|||' + city;
    if (_tabCityKey !== cacheKey) {
        cachedHotelData = null;
        cachedLovehoData = null;
        _tabCityKey = cacheKey;
    }
    cachedHotelData = hotels;

    // area-data.jsonからラブホ件数を取得（APIコール不要）
    let lovehoCount = 0;
    if (_areaData) {
        for (const areaInfo of Object.values(_areaData.area || {})) {
            const found = (areaInfo.ct || []).find(c => c[0] === city);
            if (found) { lovehoCount = found[2] || 0; break; }
        }
        if (!lovehoCount) {
            for (const daInfo of Object.values(_areaData.da || {})) {
                const found = (daInfo.ct || []).find(c => c[0] === city);
                if (found) { lovehoCount = found[2] || 0; break; }
            }
        }
    }
    // フォールバック: JSONにない場合はSupabaseクエリ
    if (!lovehoCount && !_areaData) {
        const { data: lovehoRows } = await supabaseClient.from('hotels')
            .select('id')
            .eq('prefecture', pref)
            .ilike('city', `${city}%`)
            .in('hotel_type', ['love_hotel', 'rental_room'])
            .eq('is_published', true)
            .limit(50);
        lovehoCount = lovehoRows ? lovehoRows.length : 0;
    }
    if (!lovehoCount) return;

    const urlTab = new URLSearchParams(window.location.search).get('tab');

    const tabsDiv = document.createElement('div');
    tabsDiv.id = 'hotel-loveho-tabs';
    tabsDiv.style.cssText = 'display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid #ddd;max-width:640px;margin-left:auto;margin-right:auto;padding:0 16px;';
    tabsDiv.innerHTML = `
        <button class="hotel-tab" data-tab="hotel" onclick="switchTab('hotel')" style="padding:10px 16px;border:none;background:transparent;cursor:pointer;font-size:14px;font-weight:bold;border-bottom:3px solid var(--accent,#b5627a);color:var(--accent,#b5627a);font-family:inherit;">🏨 ホテル (<span id="hotel-count">${hotelCount}</span>)</button>
        <button class="hotel-tab" data-tab="loveho" onclick="switchTab('loveho')" style="padding:10px 16px;border:none;background:transparent;cursor:pointer;font-size:14px;color:#999;border-bottom:3px solid transparent;font-family:inherit;">🏩 ラブホ (<span id="loveho-count">${lovehoCount}</span>)</button>
        <button id="btn-map-toggle" onclick="toggleMapView()" style="margin-left:auto;padding:8px 14px;border:none;background:rgba(59,130,246,0.08);border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;color:#3b82f6;font-family:inherit;white-space:nowrap;display:flex;align-items:center;gap:4px;"><span class="btn-location-icon">🗺️</span><span class="btn-location-label">地図で見る</span></button>
    `;

    const hotelList = document.getElementById('hotel-list');
    hotelList.parentNode.insertBefore(tabsDiv, hotelList);

    if (urlTab === 'loveho') {
        switchTab('loveho');
    } else {
        currentTab = 'hotel';
    }
}

function hideLovehoTabs() {
    hideMap();
    const existing = document.getElementById('hotel-loveho-tabs');
    if (existing) existing.remove();
    currentTab = 'hotel';
}

async function switchTab(tab) {
    currentTab = tab;

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

    const cur = new URLSearchParams(window.location.search);
    if (tab === 'loveho') cur.set('tab', 'loveho');
    else cur.delete('tab');
    history.replaceState(null, '', '?' + cur.toString());

    // ラブホタブ: ムード切替
    const hotelList = document.getElementById('hotel-list');
    if (tab === 'loveho') {
        hotelList.classList.add('loveho-mood');
    } else {
        hotelList.classList.remove('loveho-mood');
    }

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
    // 地図が表示中ならタブに合わせてマーカーを更新
    refreshMapIfVisible();
}

async function loadLovehoForCurrentCity() {
    if (!_tabFilterObj || !_tabCity) return;
    const gen = ++_fetchGeneration;
    showLoading();
    try {
        const pref = _tabFilterObj.prefecture;
        let query = supabaseClient.from('hotels').select('*')
            .eq('is_published', true)
            .in('hotel_type', ['love_hotel', 'rental_room'])
            .ilike('city', `${_tabCity}%`)
            .limit(50);
        if (pref) query = query.eq('prefecture', pref);
        const { data: hotels, error } = await query;
        if (error) throw error;
        if (gen !== _fetchGeneration) return; // stale, abort
        if (!hotels || !hotels.length) { cachedLovehoData = []; renderLovehoCards([]); return; }
        const hotelIds = hotels.map(h => h.id);
        const summaries = await fetchLovehoReviewSummaries(hotelIds);
        if (gen !== _fetchGeneration) return; // stale, abort
        const withSummary = hotels.map(h => ({ ...h, lhSummary: summaries[h.id] || null }));
        const LOVEHO_ORDER = { love_hotel: 0, rental_room: 1 };
        withSummary.sort((a, b) => {
            const ca = a.lhSummary ? a.lhSummary.count : 0;
            const cb = b.lhSummary ? b.lhSummary.count : 0;
            if (ca !== cb) return cb - ca;
            const da = (a.lhSummary && a.lhSummary.latestAt) || '';
            const db = (b.lhSummary && b.lhSummary.latestAt) || '';
            if (da !== db) return da < db ? 1 : -1;
            const ta = LOVEHO_ORDER[a.hotel_type] ?? 1, tb = LOVEHO_ORDER[b.hotel_type] ?? 1;
            if (ta !== tb) return ta - tb;
            return (a.name || '').localeCompare(b.name || '', 'ja');
        });
        cachedLovehoData = withSummary;
        renderLovehoCards(withSummary);
    } catch (e) { /* error silenced */ }
    finally { hideLoading(); }
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

function renderLovehoCards(hotels, showDistance = false) {
    const container = document.getElementById('hotel-list');
    const rs = document.getElementById('result-status');
    if (rs) { rs.style.display = 'block'; rs.innerHTML = hotels.length > 0 ? `<strong>${hotels.length}</strong> 件のラブホテル` : 'ラブホテルが見つかりませんでした'; }
    if (!hotels.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-text">ラブホテルが見つかりませんでした</p></div>';
        return;
    }
    allHotels = hotels;
    displayedCount = 0;
    showDistanceFlag = showDistance;
    container.innerHTML = '';
    loadMoreLovehoCards();
}

function buildLovehoCardHTML(h, i, showDist) {
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
    const distHTML = showDist && h.distance != null ? `<div class="hotel-distance-badge">📍 ${h.distance < 1 ? Math.round(h.distance * 1000) + 'm' : h.distance.toFixed(1) + 'km'}</div>` : '';
    return `
    <div class="hotel-card-lux" style="animation-delay:${Math.min(i*0.04,0.4)}s;background:#f9f5f0;border:1px solid rgba(201,169,110,0.2);" onclick="openLovehoDetail(${h.id})" role="button">
        ${distHTML}
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
    container.insertAdjacentHTML('beforeend', nextBatch.map((h, i) => buildLovehoCardHTML(h, displayedCount + i, showDistanceFlag)).join(''));
    displayedCount += nextBatch.length;

    const remaining = allHotels.length - displayedCount;
    if (remaining > 0) {
        container.insertAdjacentHTML('beforeend', `
            <div id="load-more-container" style="text-align:center;margin:20px 0;">
                <button onclick="loadMoreLovehoCards()" style="background:#c9a96e;color:#fff;border:none;padding:12px 32px;border-radius:6px;font-size:14px;cursor:pointer;font-family:inherit;">もっと見る（残り${remaining}件）</button>
            </div>`);
    }

    if (displayedCount >= allHotels.length) {
        const shopRegLink = SHOP_ID ? '' : '<a href="/shop-register.html?genre=' + (typeof MODE !== 'undefined' ? MODE : 'men') + '" style="color:#8b5e6b; text-decoration:none; padding:6px 16px; border:1px solid #d4b8c1; border-radius:20px; background:#fdf6f8; transition:background 0.2s; font-size:12px; white-space:nowrap;">🏪 店舗様・掲載用はこちら</a>';
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
let lhFormState = {};

function openLovehoDetail(hotelId) {
    if (document.activeElement) document.activeElement.blur();
    showHotelPanel(hotelId, true);
}

// ==========================================================================
// 統一詳細ローダー（ホテル/ラブホ共通）
// ==========================================================================
async function loadDetail(hotelId, isLoveho) {
    const content = getDetailContainer();
    content.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-3);">読み込み中...</div>`;
    try {
        // マスタデータロード（タイプ別）
        if (isLoveho) await loadLhMasters();
        else await Promise.all([loadConditionsMaster(), loadCanCallReasonsMaster(), loadCannotCallReasonsMaster(), loadRoomTypesMaster()]);

        // データ取得（共通パターン）
        const reportTable = isLoveho ? 'loveho_reports' : 'reports';
        const fetches = [
            supabaseClient.from('hotels').select('*').eq('id', hotelId).eq('is_published', true).maybeSingle(),
            supabaseClient.from(reportTable).select('*').eq('hotel_id', hotelId).order('created_at', { ascending: false }).limit(50),
            supabaseClient.from('shop_hotel_info').select('shop_id,transport_fee,shops(id,shop_name,shop_url,plan_id,status,shop_contracts(plan_id,contract_plans(price)))').eq('hotel_id', hotelId),
        ];
        if (!isLoveho) fetches.push(supabaseClient.from('hotel_report_summary').select('*').eq('hotel_id', hotelId).maybeSingle());

        const results = await Promise.all(fetches);
        const [hotelRes, reportsRes, shiRes] = results;
        if (!hotelRes.data) throw new Error('Hotel not found');
        const hotel = hotelRes.data;
        let reports = reportsRes.data || [];

        // 店舗情報マップ構築（共通）
        const shopInfoMap = {};
        const shopFeeMap = {};
        (shiRes.data || []).forEach(info => {
            const shop = info.shops;
            if (!shop) return;
            if (isLoveho && shop.status !== 'active') return;
            const name = shop.shop_name;
            if (!name) return;
            shopFeeMap[name] = info.transport_fee;
            const maxPrice = Math.max(...(shop.shop_contracts || []).map(c => c.contract_plans?.price || 0), 0);
            shopInfoMap[name] = { shop_url: shop.shop_url, isPaid: maxPrice > 0, planPrice: maxPrice, status: shop.status, shopId: shop.id, url: shop.shop_url };
        });

        // ホテル固有: レポート投稿者の店舗情報を追加取得
        if (!isLoveho) {
            if (SHOP_ID) {
                const shopName = SHOP_DATA?.shop_name;
                reports = reports.filter(r => {
                    if (r.poster_type === 'shop') return r.shop_id === SHOP_ID || (shopName && r.poster_name === shopName);
                    return true;
                });
            }
            const posterShopNames = [...new Set(reports.filter(r => r.poster_type === 'shop' && r.poster_name).map(r => r.poster_name))];
            if (posterShopNames.length > 0) {
                const { data: shopRows } = await supabaseClient.from('shops').select('id,shop_name,status,shop_url,plan_id,shop_contracts(plan_id,contract_plans(price))').in('shop_name', posterShopNames);
                (shopRows || []).forEach(s => {
                    const price = Math.max(...(s.shop_contracts || []).map(c => c.contract_plans?.price || 0), 0);
                    shopInfoMap[s.shop_name] = { ...shopInfoMap[s.shop_name], status: s.status, shop_url: s.shop_url, isPaid: price > 0, planPrice: price, shopId: s.id, url: s.shop_url };
                });
            }
            if (SHOP_DATA?.shop_name) {
                const name = SHOP_DATA.shop_name;
                const existing = shopInfoMap[name] || {};
                const price = Math.max(...(SHOP_DATA?.shop_contracts || []).map(c => c.contract_plans?.price || 0), 0);
                shopInfoMap[name] = {
                    shop_url: existing.shop_url || SHOP_DATA?.shop_url || null,
                    isPaid: existing.isPaid || price > 0,
                    planPrice: Math.max(price, existing.planPrice || 0),
                    status: existing.status || SHOP_DATA?.status || null,
                    shopId: existing.shopId || SHOP_ID || null,
                    url: existing.shop_url || SHOP_DATA?.shop_url || null
                };
            }
        }

        // パンくず構築（共通）
        const _pref = hotel.prefecture || '';
        const _city = hotel.city || '';
        const _majorArea = hotel.major_area || '';
        const _detailArea = hotel.detail_area || '';
        const _region = REGION_MAP.find(r => r.prefs.includes(_pref)) || null;
        const _rl = _region ? _region.label : '';
        const _crumbs = [{ label: '全国', onclick: 'leaveHotelDetail();showJapanPage()' }];
        if (_region) _crumbs.push({ label: _rl, onclick: `leaveHotelDetail();showPrefPage(REGION_MAP.find(r=>r.label==='${_rl}'))` });
        if (_pref) _crumbs.push({ label: _pref, onclick: `leaveHotelDetail();showMajorAreaPage(REGION_MAP.find(r=>r.label==='${_rl}'),'${_pref}')` });
        if (_majorArea) _crumbs.push({ label: _majorArea, onclick: `leaveHotelDetail();showCityPage(REGION_MAP.find(r=>r.label==='${_rl}'),'${_pref}','${_majorArea}')` });
        if (_detailArea) _crumbs.push({ label: _detailArea, onclick: `leaveHotelDetail();showDetailAreaPage(REGION_MAP.find(r=>r.label==='${_rl}'),'${_pref}','${_majorArea}','${_detailArea}')` });
        if (_city) _crumbs.push({ label: _city, onclick: `leaveHotelDetail();fetchAndShowHotelsByCity({prefecture:'${_pref}',major_area:'${_majorArea}'},'${_city}')` });
        _crumbs.push({ label: hotel.name });
        setBreadcrumb(_crumbs);

        // レンダリング（タイプ別）
        if (isLoveho) {
            hotel._lhShopFeeMap = shopFeeMap;
            hotel._lhShopInfoMap = shopInfoMap;
            renderLovehoDetail(hotel, reports);
        } else {
            renderHotelDetail(hotel, reports, results[3]?.data, [], shiRes.data || [], shopInfoMap);
        }

        // 3段階広告ロード（共通）
        if (hotel.city && !SHOP_ID) {
            const genderMode = typeof MODE !== 'undefined' ? MODE : 'men';
            const [cityShops, areaAds, prefAds] = await Promise.all([
                fetchAreaShops(hotel.prefecture, hotel.city, genderMode),
                hotel.major_area ? fetchDetailAds('area', hotel.major_area) : Promise.resolve(''),
                hotel.prefecture ? fetchDetailAds('big', hotel.prefecture) : Promise.resolve('')
            ]);
            const citySlot = document.getElementById('detail-ad-slot');
            if (citySlot && cityShops && cityShops.length) citySlot.innerHTML = renderDetailShopCards(cityShops, hotel.city);
            const areaSlot = document.getElementById('detail-ad-area-slot');
            if (areaSlot && areaAds) areaSlot.innerHTML = areaAds;
            const prefSlot = document.getElementById('detail-ad-pref-slot');
            if (prefSlot && prefAds) prefSlot.innerHTML = prefAds;
        }
    } catch(e) {
        content.innerHTML = `<div style="text-align:center;padding:60px;color:#c47a88;">読み込みエラーが発生しました</div>`;
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

    const gpCatMap = {};
    if (LH_MASTER.good_points) LH_MASTER.good_points.forEach(p => { gpCatMap[p.label] = p.category; });

    const soloMap = { yes: 'はい', no: 'いいえ', together: '一緒に入った', waiting: '待合室待ち', unknown: 'わからない' };
    const soloColors = { yes: '#c9a96e', no: '#b5627a', together: '#7a9bc9', waiting: '#9b7ac9', unknown: '#ccc' };
    const soloReports = reports.filter(r => r.solo_entry && r.solo_entry !== '');
    const soloCounts = {};
    soloReports.forEach(r => { soloCounts[r.solo_entry] = (soloCounts[r.solo_entry] || 0) + 1; });
    const soloTotal = soloReports.length;

    const lhShopFeeMap = hotel._lhShopFeeMap || {};
    const lhShopInfoMap = hotel._lhShopInfoMap || {};
    const shopNames = Object.keys(lhShopInfoMap);

    function buildLhReviewCard(r) {
        const gps = r.good_points && Array.isArray(r.good_points) ? r.good_points : [];
        const gpRoom = gps.filter(gp => gpCatMap[gp] === '設備・お部屋');
        const gpService = gps.filter(gp => gpCatMap[gp] === 'サービス・利便性');
        const gpTagHTML = (items) => items.map(gp=>`<span style="background:rgba(58,154,96,0.1);border:1px solid rgba(58,154,96,0.25);border-radius:10px;padding:2px 8px;font-size:10px;color:#3a9a60;">${esc(gp)}</span>`).join('');
        const gm=r.gender_mode;const gmIcon=gm==='women'?'♀':gm==='men_same'?'♂♂':gm==='women_same'?'♀♀':'♂';const gmCol=gm==='women'?'#c47a88':gm==='men_same'?'#2c5282':gm==='women_same'?'#8264b4':'#4a7ab0';
        const pName=r.poster_name||'匿名';
        const si=lhShopInfoMap[pName];
        const posterHTML=si&&si.isPaid&&si.url?`<a href="${esc(si.url)}" target="${_extTarget}" rel="noopener" style="font-size:10px;color:${gmCol};font-weight:600;text-decoration:none;">${gmIcon} ${esc(pName)} 🔗</a>`:`<span style="font-size:10px;color:${gmCol};font-weight:600;">${gmIcon} ${esc(pName)}</span>`;
        const fee=lhShopFeeMap[pName];
        const feeLabel=fee===0?'無料':fee>0?'¥'+Number(fee).toLocaleString():null;
        const feeHTML=feeLabel?`<span style="padding:2px 8px;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.3);border-radius:8px;font-size:10px;color:#9a7030;">🚕 交通費: ${feeLabel}</span>`:'';
        const entryMethodLabels={front:'フロント経由(部屋番号を伝えて入室)',direct:'直接入室(お部屋に直行)',lobby:'ロビー待ち合わせ',waiting:'待合室で待ち合わせ'};
        return `<div style="background:var(--bg-2,#fff);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <div style="display:flex;align-items:center;gap:8px;">${posterHTML}${feeHTML}</div>
                <span style="font-size:11px;color:var(--text-3);">${formatDate(r.created_at)}</span>
            </div>
            ${r.solo_entry && shopNames.includes(pName) && (r.solo_entry==='yes'||r.solo_entry==='together') ? `<div style="margin:6px 0;"><span style="padding:3px 10px;background:rgba(58,154,96,0.1);border:1px solid rgba(58,154,96,0.3);border-radius:20px;font-size:11px;color:#2e7d32;font-weight:600;">✅ ご案内実績有</span></div>` : ''}
            ${r.solo_entry && !shopNames.includes(pName) ? `<div style="margin:6px 0;"><span style="padding:3px 10px;background:${r.solo_entry==='yes'?'rgba(58,154,96,0.1)':'rgba(181,98,122,0.1)'};border:1px solid ${r.solo_entry==='yes'?'rgba(58,154,96,0.3)':'rgba(181,98,122,0.3)'};border-radius:20px;font-size:11px;color:${r.solo_entry==='yes'?'#2e7d32':'#9a4e65'};font-weight:600;">${r.solo_entry==='yes'?'🚪 一人で先に入れた':r.solo_entry==='no'?'🚪 一人で先に入れなかった':r.solo_entry==='together'?'🚪 一緒に入った':''}</span></div>` : ''}
            ${r.comment ? `<div style="font-size:13px;color:var(--text);line-height:1.7;white-space:pre-wrap;margin-top:4px;">${esc(r.comment)}</div>` : ''}
            ${r.atmosphere ? `<div style="margin-bottom:6px;"><span style="font-size:11px;font-weight:600;color:var(--text-3);">✨ 雰囲気　</span><span style="padding:3px 10px;border:1px solid rgba(201,169,110,0.4);border-radius:20px;font-size:12px;color:#c9a96e;background:rgba(201,169,110,0.08);">${atmosphereIcon(r.atmosphere)}${esc(r.atmosphere)}</span></div>` : ''}
            ${gpRoom.length ? `<div style="margin-top:6px;"><div style="font-size:10px;font-weight:600;color:var(--text-3);margin-bottom:3px;">🛁 設備・お部屋</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${gpTagHTML(gpRoom)}</div></div>` : ''}
            ${gpService.length ? `<div style="margin-top:6px;"><div style="font-size:10px;font-weight:600;color:var(--text-3);margin-bottom:3px;">🏨 サービス・利便性</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${gpTagHTML(gpService)}</div></div>` : ''}
            ${r.entry_method ? `<div style="font-size:11px;color:var(--text-2);margin-top:6px;">🚪 ${MODE==='women'?'セラピスト':'キャスト'}の入室方法: ${esc(entryMethodLabels[r.entry_method]||r.entry_method)}</div>` : ''}
            ${r.time_slot ? `<div style="font-size:11px;color:var(--text-2);margin-top:6px;">🕐 ${esc(r.time_slot)}</div>` : ''}
            ${r.multi_person ? `<div style="font-size:12px;color:var(--accent,#b5627a);margin-top:4px;">👥 複数人利用OK${r.guest_male||r.guest_female ? `<span style="color:var(--text-3);margin-left:4px;">（${r.guest_male ? `男性${r.guest_male}名`:''}${r.guest_male&&r.guest_female?'・':''}${r.guest_female ? `女性${r.guest_female}名`:''}）</span>`:''}</div>` : ''}
            <button onclick="event.stopPropagation();openFlagModal('${r.id}')" style="background:none;border:none;color:var(--text-3);font-size:11px;cursor:pointer;font-family:inherit;margin-top:6px;opacity:0.6;">🚩 報告</button>
        </div>`;
    }

    // 店舗投稿とユーザー投稿を分離
    const lhShopReports = reports.filter(r => shopNames.includes(r.poster_name) && r.gender_mode === MODE);
    // ソート: 有料プラン高い順 → 30日自動更新ベースで新しい順
    const SHOP_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
    function shopSortDate(r) {
        const d = new Date(r.updated_at || r.created_at);
        // 30日以上経過していたら現在時刻に近い値として扱う（自動更新相当）
        if (Date.now() - d.getTime() > SHOP_REFRESH_MS) {
            const cycles = Math.floor((Date.now() - d.getTime()) / SHOP_REFRESH_MS);
            return new Date(d.getTime() + cycles * SHOP_REFRESH_MS);
        }
        return d;
    }
    lhShopReports.sort((a, b) => {
        const pa = lhShopInfoMap[a.poster_name]?.isPaid ? 1 : 0;
        const pb = lhShopInfoMap[b.poster_name]?.isPaid ? 1 : 0;
        if (pb !== pa) return pb - pa;
        return shopSortDate(b) - shopSortDate(a);
    });
    const lhUserReports = reports.filter(r => !shopNames.includes(r.poster_name));

    function lhScrollable(items, buildFn) {
        if (!items.length) return '';
        const html = items.map(buildFn).join('');
        if (items.length <= 5) return html;
        return `<div style="max-height:420px;overflow-y:auto;padding-right:4px;">${html}</div>`;
    }

    const lhShopSection = lhShopReports.length === 0 ? '' : `
        <div style="border:2px solid rgba(201,168,76,0.5);border-radius:12px;padding:14px 16px;margin-bottom:16px;background:linear-gradient(135deg,rgba(201,168,76,0.07) 0%,rgba(255,248,220,0.5) 100%);box-shadow:0 2px 12px rgba(201,168,76,0.12);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <span style="font-size:11px;font-weight:700;padding:4px 12px;background:rgba(201,168,76,0.18);color:#7a5c10;border:1px solid rgba(201,168,76,0.4);border-radius:20px;">✅ 店舗公式情報</span>
                <span style="font-size:11px;color:#9a8050;">${lhShopReports.length}件</span>
            </div>
            ${lhScrollable(lhShopReports, buildLhReviewCard)}
        </div>`;

    // ラブホユーザーフィルタータブ
    window._lhUserReports = lhUserReports;
    window._buildLhReviewCard = buildLhReviewCard;
    const lhYesCount = lhUserReports.filter(r => r.solo_entry === 'yes').length;
    const lhNoCount = lhUserReports.filter(r => r.solo_entry === 'no').length;
    const lhTogetherCount = lhUserReports.filter(r => r.solo_entry === 'together').length;
    const lhFilterTabs = lhUserReports.length > 1 ? `<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
        <button onclick="filterLhUserReports('all')" class="lhu-tab" data-filter="all" style="padding:4px 12px;border-radius:16px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid var(--border);background:var(--accent-bg);color:var(--accent);">全て (${lhUserReports.length})</button>
        ${lhYesCount ? `<button onclick="filterLhUserReports('yes')" class="lhu-tab" data-filter="yes" style="padding:4px 12px;border-radius:16px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid rgba(58,154,96,0.25);background:transparent;color:#3a9a60;">🚪 入れた (${lhYesCount})</button>` : ''}
        ${lhNoCount ? `<button onclick="filterLhUserReports('no')" class="lhu-tab" data-filter="no" style="padding:4px 12px;border-radius:16px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid rgba(192,80,80,0.25);background:transparent;color:#c05050;">🚪 入れなかった (${lhNoCount})</button>` : ''}
        ${lhTogetherCount ? `<button onclick="filterLhUserReports('together')" class="lhu-tab" data-filter="together" style="padding:4px 12px;border-radius:16px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid rgba(106,130,180,0.25);background:transparent;color:#4a6a9a;">🚪 一緒に入った (${lhTogetherCount})</button>` : ''}
    </div>` : '';

    const lhUserSection = lhUserReports.length === 0 ? '' : `
        <div style="margin-bottom:16px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <span style="font-size:11px;font-weight:700;padding:4px 12px;background:rgba(181,98,122,0.1);color:#8a4a5e;border:1px solid rgba(181,98,122,0.3);border-radius:20px;">👤 ユーザー口コミ</span>
                <span style="font-size:11px;color:var(--text-3);">${lhUserReports.length}件</span>
            </div>
            ${lhFilterTabs}
            <div id="lh-user-reports-list">${lhScrollable(lhUserReports, buildLhReviewCard)}</div>
        </div>`;

    const reviewsHTML = lhShopSection + lhUserSection;

    const selOpts = (arr) => '<option value="">選択してください</option>' + arr.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');

    const content = getDetailContainer();
    content.innerHTML = `
      <div style="padding:16px 14px 120px; max-width:640px; margin:0 auto;">
        <div style="font-size:23px;font-weight:700;color:var(--text);margin-bottom:12px;">
            <a href="https://www.google.com/search?q=${encodeURIComponent(h.name)}" target="${_extTarget}" rel="noopener" style="text-decoration:none;color:inherit;">${esc(h.name)}</a> <span style="font-size:14px;">🏩</span>
        </div>
        <div style="font-size:13px;color:var(--text-2);margin-bottom:6px;">
            ${h.address ? `📍 <a href="https://www.google.com/maps/search/${encodeURIComponent(h.address)}" target="${_extTarget}" rel="noopener" style="color:var(--text-2);text-decoration:underline;">${esc(h.address)}</a>` : ''}
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

        <div id="detail-ad-area-slot"></div>

        <div style="background:var(--bg-2,#fff);border:1px solid rgba(201,169,110,0.25);border-radius:12px;padding:20px 16px;margin-bottom:24px;">
            <div style="text-align:center;margin-bottom:16px;">
                <div style="font-size:11px;color:var(--text-3);margin-bottom:4px;">${esc(h.name)}</div>
                <h3 style="font-size:16px;font-weight:600;color:var(--text);margin:0;">🏩 口コミを投稿する</h3>
            </div>
            <div style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:5px;">${SHOP_ID ? 'チェックイン方法' : '一人で先に入れる？'}</label>
                <select id="lh-solo-entry" onchange="lhFormState.solo_entry=this.value" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:#fff;outline:none;">
                    ${SHOP_ID
                        ? '<option value="">選択してください</option><option value="yes">はい！ご案内実績有</option><option value="no">いいえ</option><option value="together">一緒にチェックインでご案内実績有</option>'
                        : '<option value="">選択してください</option><option value="yes">はい</option><option value="no">いいえ</option><option value="together">一緒に入った</option><option value="lobby">待合室で待ち合わせ</option><option value="unknown">わからない</option>'
                    }
                </select>
            </div>
            ${LH_MASTER.atmospheres.length ? `<div style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:5px;">雰囲気</label>
                <select onchange="lhFormState.atmosphere=this.value" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:#fff;outline:none;">${selOpts(LH_MASTER.atmospheres)}</select>
            </div>` : ''}
            <div style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:5px;">おすすめ度</label>
                <div id="lh-star-recommendation" style="display:flex;gap:4px;font-size:24px;cursor:pointer;color:#ccc;">
                    ${[1,2,3,4,5].map(n => `<span onclick="lhSetStar('recommendation',${n})">★</span>`).join('')}
                </div>
            </div>
            <div style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:5px;">清潔感</label>
                <div id="lh-star-cleanliness" style="display:flex;gap:4px;font-size:24px;cursor:pointer;color:#ccc;">
                    ${[1,2,3,4,5].map(n => `<span onclick="lhSetStar('cleanliness',${n})">★</span>`).join('')}
                </div>
            </div>
            <div style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:5px;">コスパ</label>
                <div id="lh-star-cost_performance" style="display:flex;gap:4px;font-size:24px;cursor:pointer;color:#ccc;">
                    ${[1,2,3,4,5].map(n => `<span onclick="lhSetStar('cost_performance',${n})">★</span>`).join('')}
                </div>
            </div>
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
        <div id="detail-ad-pref-slot"></div>
      </div>
    `;

    lhFormState = { solo_entry: '', atmosphere: '', recommendation: 0, cleanliness: 0, cost_performance: 0, time_slot: '', comment: '', poster_name: '', good_points: [], multi_person: false, guest_male: '', guest_female: '' };
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
async function searchByLocation() {
    const gen = ++_fetchGeneration;
    const btn = document.getElementById('btn-location');
    if (btn) {
        btn.classList.add('loading');
        btn.querySelector('.btn-location-label').textContent = t('locating');
    }

    if (!navigator.geolocation) {
        showToast('位置情報がサポートされていません', 3000);
        resetLocationBtn();
        return;
    }

    showLoading(t('locating'));
    showSkeletonLoader();

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const userLat = pos.coords.latitude;
            const userLng = pos.coords.longitude;

            const cityName = await reverseGeocode(userLat, userLng);
            if (gen !== _fetchGeneration) { hideLoading(); resetLocationBtn(); return; } // stale, abort
            const locationLabel = cityName ? `📍 ${cityName}周辺` : '📍 現在地周辺';

            setBreadcrumb([{ label: t('japan'), onclick: 'showJapanPage()' }, { label: locationLabel }]);
            setTitle(cityName ? `${cityName}周辺のホテル` : '現在地周辺のホテル');
            setBackBtn(true);
            pageStack.push(showJapanPage);
            document.getElementById('area-button-container').innerHTML = '';

            try {
                const isLovehoSearch = currentTab === 'loveho';
                let candidates = [];

                function applyTypeFilter(q) {
                    if (isLovehoSearch) return q.in('hotel_type', ['love_hotel', 'rental_room']);
                    return q.not('hotel_type','eq','love_hotel').not('hotel_type','eq','rental_room');
                }

                // Step 1: 市区町村で検索
                if (cityName) {
                    let q = supabaseClient.from('hotels').select('*')
                        .ilike('city', `%${cityName}%`).eq('is_published', true);
                    q = applyTypeFilter(q);
                    const { data, error: e1 } = await q.limit(500);
                    candidates = data || [];
                }
                // Step 2: 市区町村で少なければ都道府県全体で補完
                if (candidates.length < 20) {
                    const prefName = await reverseGeocodePref(userLat, userLng);
                    if (prefName) {
                        const existIds = new Set(candidates.map(h => h.id));
                        let q = supabaseClient.from('hotels').select('*')
                            .eq('prefecture', prefName).eq('is_published', true)
                            .not('latitude', 'is', null).not('longitude', 'is', null);
                        q = applyTypeFilter(q);
                        const { data, error: e2 } = await q.limit(3000);
                        (data || []).forEach(h => { if (!existIds.has(h.id)) candidates.push(h); });
                    }
                }
                // Step 3: それでも足りなければ全国から
                if (!candidates.length) {
                    let q = supabaseClient.from('hotels').select('*')
                        .not('latitude', 'is', null).not('longitude', 'is', null)
                        .eq('is_published', true);
                    q = applyTypeFilter(q);
                    const { data, error } = await q.limit(2000);
                    if (error) throw error;
                    candidates = data || [];
                }
                // 距離を計算して近い順にソート、上位60件を取得
                const withDist = candidates
                    .filter(h => h.latitude && h.longitude)
                    .map(h => ({ ...h, distance: calcDistance(userLat, userLng, h.latitude, h.longitude) }))
                    .sort((a, b) => a.distance - b.distance)
                    .slice(0, 60);

                if (isLovehoSearch) {
                    // ラブホタブ: lhSummaryを付与してラブホカードで表示
                    const hotelIds = withDist.map(h => h.id);
                    const lhSummaries = await fetchLovehoReviewSummaries(hotelIds);
                    const sorted = withDist.map(h => ({ ...h, lhSummary: lhSummaries[h.id] || null }));
                    cachedLovehoData = sorted;
                    renderLovehoCards(sorted, true);
                } else {
                    // ホテルタブ: 通常のsummaryを付与
                    const hotelIds = withDist.map(h => h.id);
                    const [summaries, latestMap] = await Promise.all([
                        fetchReportSummaries(hotelIds),
                        fetchLatestReportDates(hotelIds),
                    ]);
                    const sorted = withDist.map(h => ({ ...h, summary: summaries[h.id] || null, latestReportAt: latestMap[h.id] || null }));
                    renderHotelCards(sorted, true);
                }
                const status = document.getElementById('result-status');
                if (status) {
                    status.style.display = 'block';
                    status.innerHTML = `${esc(locationLabel)} — <strong>${withDist.length}</strong> ${t('results')}`;
                }
            } catch (e) {
                /* error silenced */
                showToast('検索中にエラーが発生しました', 4000);
            } finally {
                hideLoading();
                resetLocationBtn();
            }
        },
        (err) => {
            hideLoading();
            resetLocationBtn();
            const msgs = { 1: '位置情報の使用が許可されていません。', 2: '位置情報を取得できませんでした。', 3: 'タイムアウトしました。' };
            showToast(msgs[err.code] || t('location_error'), 4000);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

function resetLocationBtn() {
    const btn = document.getElementById('btn-location');
    if (btn) {
        btn.classList.remove('loading');
        const label = btn.querySelector('.btn-location-label');
        if (label) label.textContent = t('current_location');
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
                .not('hotel_type','eq','love_hotel').not('hotel_type','eq','rental_room')
                .order('review_average', { ascending: false, nullsFirst: false })
                .limit(50);

            const hotels = await fetchHotelsWithSummary(query);
            sortHotelsByReviews(hotels);
            renderHotelCards(hotels);
            setResultStatus(hotels.length);
        } catch (e) {
            /* error silenced */
        } finally {
            hideLoading();
        }
    }, 500);
}

// ==========================================================================
// キーワード検索
// ==========================================================================
let searchTimeout = null;
let _isComposing = false; // IME変換中フラグ

// IME変換中は検索を実行しない
document.addEventListener('compositionstart', () => { _isComposing = true; });
document.addEventListener('compositionend', () => {
    _isComposing = false;
    fetchHotelsFromSearch();
});

function fetchHotelsFromSearch() {
    if (_isComposing) return; // IME変換中はスキップ
    const keyword = document.getElementById('keyword')?.value?.trim() || '';
    document.getElementById('search-clear-btn').style.display = keyword ? 'block' : 'none';

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => { // 500ms debounce（日本語入力の変換中に発火しないよう）
        if (keyword.length < 2) return;
        showLoading();
        showSkeletonLoader();
        setBreadcrumb([{ label: t('japan'), onclick: 'showJapanPage()' }, { label: `「${keyword}」の検索結果` }]);
        setTitle(`「${keyword}」の検索結果`);
        setBackBtn(true);
        pageStack.push(showJapanPage);
        document.getElementById('area-button-container').innerHTML = '';

        try {
            let query = supabaseClient.from('hotels').select('*').eq('is_published', true).not('hotel_type','eq','love_hotel').not('hotel_type','eq','rental_room').limit(50);
            query = applyKeywordFilter(query, keyword);
            query = query.order('review_average', { ascending: false, nullsFirst: false });

            const hotels = await fetchHotelsWithSummary(query);
            sortHotelsByReviews(hotels);
            renderHotelCards(hotels);
            setResultStatus(hotels.length);
        } catch (e) {
            /* error silenced */
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
// ホテルカードレンダリング
// ==========================================================================
let allHotels = [];
let displayedCount = 0;
let showDistanceFlag = false;
const HOTELS_PER_PAGE = 20;

Object.defineProperties(AppState.search, {
    allHotels:        { get() { return allHotels; },        set(v) { allHotels = v; } },
    displayedCount:   { get() { return displayedCount; },   set(v) { displayedCount = v; } },
    showDistanceFlag: { get() { return showDistanceFlag; }, set(v) { showDistanceFlag = v; } },
});

function showFilterBar() {
    // 地図ボタンはタブ内に統合済み、特に操作不要
}

function hideFilterBar() {
    hideMap();
}

// ==========================================================================
// 地図表示（Leaflet）
// ==========================================================================
let mapInstance = null;
let mapMarkers = [];
let _leafletLoading = false;
let _leafletLoaded = false;

Object.defineProperties(AppState.map, {
    instance:        { get() { return mapInstance; },      set(v) { mapInstance = v; } },
    markers:         { get() { return mapMarkers; },       set(v) { mapMarkers = v; } },
    _leafletLoading: { get() { return _leafletLoading; },  set(v) { _leafletLoading = v; } },
    _leafletLoaded:  { get() { return _leafletLoaded; },   set(v) { _leafletLoaded = v; } },
});

async function ensureLeaflet() {
    if (_leafletLoaded || typeof L !== 'undefined') { _leafletLoaded = true; return true; }
    if (_leafletLoading) return false;
    _leafletLoading = true;

    // Load CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    // Load JS
    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = () => { _leafletLoaded = true; _leafletLoading = false; resolve(true); };
        script.onerror = () => { _leafletLoading = false; resolve(false); };
        document.head.appendChild(script);
    });
}

async function toggleMapView() {
    const mapEl = document.getElementById('hotel-map');
    const btn = document.getElementById('btn-map-toggle');
    const iconEl = btn.querySelector('.btn-location-icon');
    const labelEl = btn.querySelector('.btn-location-label');
    if (mapEl.style.display === 'none') {
        mapEl.style.display = 'block';
        if (iconEl) iconEl.textContent = '📋';
        if (labelEl) labelEl.textContent = 'リストで見る';
        btn.classList.add('active');
        await showMap();
    } else {
        mapEl.style.display = 'none';
        if (iconEl) iconEl.textContent = '🗺️';
        if (labelEl) labelEl.textContent = '地図で見る';
        btn.classList.remove('active');
    }
}

async function showMap() {
    const ready = await ensureLeaflet();
    if (!ready) {
        showToast('地図ライブラリの読み込みに失敗しました', 2000);
        return;
    }
    // タブに応じたデータを使用
    const hotels = (currentTab === 'loveho' ? cachedLovehoData : allHotels) || [];
    const hotelsWithCoords = hotels.filter(h => h.latitude && h.longitude);

    if (!mapInstance) {
        mapInstance = L.map('hotel-map', {
            touchZoom: true,
            doubleClickZoom: true,
            dragging: true,
            bounceAtZoomLimits: true
        }).setView([35.6762, 139.6503], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }).addTo(mapInstance);
        // モバイル用ダブルタップズーム
        (function() {
            var lastTap = 0;
            mapInstance.getContainer().addEventListener('touchend', function(e) {
                if (e.touches.length > 0) return;
                var now = Date.now();
                if (now - lastTap < 350) {
                    e.preventDefault();
                    var rect = mapInstance.getContainer().getBoundingClientRect();
                    var touch = e.changedTouches[0];
                    var point = L.point(touch.clientX - rect.left, touch.clientY - rect.top);
                    var latlng = mapInstance.containerPointToLatLng(point);
                    mapInstance.setView(latlng, mapInstance.getZoom() + 1);
                    lastTap = 0;
                } else {
                    lastTap = now;
                }
            });
        })();
        // 現在地ボタン
        const LocBtn = L.Control.extend({
            options: { position: 'topright' },
            onAdd: function() {
                const btn = L.DomUtil.create('button', 'leaflet-bar');
                btn.innerHTML = '📍';
                btn.title = '現在地へ移動';
                btn.style.cssText = 'width:36px;height:36px;background:#fff;border:none;border-radius:4px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.2);';
                L.DomEvent.disableClickPropagation(btn);
                btn.onclick = function() {
                    btn.innerHTML = '⏳';
                    navigator.geolocation.getCurrentPosition(
                        function(pos) {
                            const lat = pos.coords.latitude, lng = pos.coords.longitude;
                            mapInstance.setView([lat, lng], 15);
                            if (window._userLocMarker) window._userLocMarker.remove();
                            window._userLocMarker = L.circleMarker([lat, lng], {
                                radius: 8, fillColor: '#4285F4', fillOpacity: 1,
                                color: '#fff', weight: 3
                            }).addTo(mapInstance).bindPopup('現在地');
                            btn.innerHTML = '📍';
                        },
                        function(err) { const msgs = { 1: '位置情報の使用が許可されていません', 2: '位置情報を取得できませんでした', 3: 'タイムアウトしました' }; showToast(msgs[err.code] || '位置情報を取得できませんでした'); btn.innerHTML = '📍'; },
                        { enableHighAccuracy: true, timeout: 10000 }
                    );
                };
                return btn;
            }
        });
        mapInstance.addControl(new LocBtn());
    }

    // 既存マーカーをクリア
    mapMarkers.forEach(m => m.remove());
    mapMarkers = [];

    if (hotelsWithCoords.length === 0) {
        showToast('位置情報のあるホテルがありません', 2000);
        return;
    }

    // マーカーアイコン（ラブホはピンク）
    const isLoveho = currentTab === 'loveho';
    const markerIcon = L.divIcon({
        className: '',
        html: `<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;"><div style="width:28px;height:28px;border-radius:50%;background:${isLoveho ? '#e91e8c' : '#3388ff'};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px;">${isLoveho ? '🏩' : '🏨'}</div></div>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        popupAnchor: [0, -22]
    });

    // マーカー追加
    const bounds = [];
    hotelsWithCoords.forEach(h => {
        const marker = L.marker([h.latitude, h.longitude], { icon: markerIcon })
            .addTo(mapInstance)
            .bindPopup('<b>' + esc(h.name) + '</b><br><a href="javascript:openHotelFromMap(' + h.id + ',' + isLoveho + ')">' + t('view_detail') + '</a>');
        mapMarkers.push(marker);
        bounds.push([h.latitude, h.longitude]);
    });

    // 全マーカーが見えるようにズーム
    if (bounds.length > 0) {
        mapInstance.fitBounds(bounds, { padding: [20, 20] });
    }

    // Leafletのサイズ問題を解消
    setTimeout(() => mapInstance.invalidateSize(), 100);
}

function hideMap() {
    const mapEl = document.getElementById('hotel-map');
    if (mapEl) mapEl.style.display = 'none';
    const btn = document.getElementById('btn-map-toggle');
    if (btn) {
        const iconEl = btn.querySelector('.btn-location-icon');
        const labelEl = btn.querySelector('.btn-location-label');
        if (iconEl) iconEl.textContent = '🗺️';
        if (labelEl) labelEl.textContent = '地図で見る';
        btn.classList.remove('active');
    }
}

function refreshMapIfVisible() {
    const mapEl = document.getElementById('hotel-map');
    if (mapEl && mapEl.style.display !== 'none') {
        showMap();
    }
}

function buildCardHTML(h, i, showDistance) {
        const s = h.summary;

        const userCan    = s ? (s.can_call_count    || 0) : 0;
        const userCannot = s ? (s.cannot_call_count || 0) : 0;
        const shopCan    = s ? (s.shop_can_count    || 0) : 0;
        const shopNg     = s ? (s.shop_ng_count     || 0) : 0;
        const hasAny     = userCan + userCannot + shopCan + shopNg > 0;

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
                                <span class="csb-label">${t('can_call')}</span>
                            </div>
                            <div class="card-summary-box user-cannot">
                                <span class="csb-val">${userCannot}</span>
                                <span class="csb-label">${t('cannot_call')}</span>
                            </div>
                        </div>
                    </div>
                </div>`;
        }

        const totalAll = userCan + userCannot + shopCan + shopNg;
        const successRate = totalAll > 0 ? Math.round((userCan + shopCan) / totalAll * 100) : null;
        const rateHTML = successRate !== null
            ? `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;background:${successRate >= 70 ? 'rgba(58,154,96,0.1)' : successRate >= 40 ? 'rgba(201,168,76,0.1)' : 'rgba(192,80,80,0.1)'};border-radius:10px;font-size:11px;font-weight:700;color:${successRate >= 70 ? '#3a9a60' : successRate >= 40 ? '#9a8030' : '#c05050'};white-space:nowrap;">✅${successRate}%</span>`
            : '';

        const rankHTML = hotelRankBadge(h.review_average);

        const reviewCount = getReportCount(h);

        const priceInline = h.min_charge
            ? `<span class="hotel-price-inline">最安値 ¥${parseInt(h.min_charge).toLocaleString()}~</span>`
            : '';
        const stationHTML = h.nearest_station
            ? `<div class="hotel-info-row"><span class="hotel-info-icon">🚉</span><span class="hotel-info-text">${esc(h.nearest_station)}</span>${priceInline}</div>`
            : (priceInline ? `<div class="hotel-info-row">${priceInline}</div>` : '');


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
                    ${rateHTML}
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

                <!-- 投稿サマリー -->
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
    showDistanceFlag = showDistance;

    if (!hotels.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-text">${t('no_results')}</p></div>`;
        allHotels = [];
        displayedCount = 0;
        showFilterBar();
        return;
    }

    allHotels = hotels;
    displayedCount = 0;

    container.innerHTML = '';
    loadMoreHotels();
    showFilterBar();
}

function loadMoreHotels() {
    const container = document.getElementById('hotel-list');

    const oldLoadMore = document.getElementById('load-more-container');
    if (oldLoadMore) oldLoadMore.remove();
    const oldLinksBar = container.querySelector('.info-links-bar');
    if (oldLinksBar) oldLinksBar.remove();

    const nextBatch = allHotels.slice(displayedCount, displayedCount + HOTELS_PER_PAGE);
    const html = nextBatch.map((h, i) => buildCardHTML(h, displayedCount + i, showDistanceFlag)).join('');
    container.insertAdjacentHTML('beforeend', html);
    displayedCount += nextBatch.length;

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

    const shopRegLink = SHOP_ID ? '' : '<a href="/shop-register.html?genre=' + (typeof MODE !== 'undefined' ? MODE : 'men') + '" style="color:#8b5e6b; text-decoration:none; padding:6px 16px; border:1px solid #d4b8c1; border-radius:20px; background:#fdf6f8; transition:background 0.2s; font-size:12px; white-space:nowrap;">🏪 店舗様・掲載用はこちら</a>';
    container.insertAdjacentHTML('beforeend', `
        <div class="info-links-bar" style="display:flex; justify-content:center; gap:16px; padding:14px 20px; margin-top:12px; background:#fff; border:1px solid #e0d5d0; border-radius:8px; font-size:13px;">
            <a href="#" onclick="openHotelRequestModal();return false;" style="color:#8b5e6b; text-decoration:none; padding:6px 16px; border:1px solid #d4b8c1; border-radius:20px; background:#fdf6f8; transition:background 0.2s; font-size:12px; white-space:nowrap;">📝 未掲載ホテル情報提供</a>
            ${shopRegLink}
        </div>
    `);
}

// ==========================================================================
// ホテル詳細ページ
// ==========================================================================
function openHotelDetail(hotelId) {
    if(document.activeElement)document.activeElement.blur();
    showHotelPanel(hotelId);
}

let _mapDetailMode = false;
let currentHotelId = null;

Object.defineProperties(AppState.detail, {
    currentHotelId: { get() { return currentHotelId; }, set(v) { currentHotelId = v; } },
    _savedBreadcrumbHTML: { get() { return _savedBreadcrumbHTML; }, set(v) { _savedBreadcrumbHTML = v; } },
    _savedTabsHTML: { get() { return _savedTabsHTML; }, set(v) { _savedTabsHTML = v; } },
});
Object.defineProperty(AppState.map, '_detailMode', { get() { return _mapDetailMode; }, set(v) { _mapDetailMode = v; } });

function getDetailContainer() {
    return document.getElementById(_mapDetailMode ? 'map-detail-content' : 'hotel-detail-content');
}
function openHotelFromMap(hotelId, isLoveho) {
    _mapDetailMode = true;
    showHotelPanel(hotelId, isLoveho);
}

async function showHotelPanel(hotelId, isLoveho) {
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

    if (_mapDetailMode) {
        // 地図から開いた場合：地図・タブはそのまま残し、一覧は隠す
        document.getElementById('area-button-container').style.display = 'none';
        document.getElementById('hotel-list').style.display = 'none';
        const rs = document.getElementById('result-status');
        if (rs) rs.style.display = 'none';
        // 通常の詳細エリアは非表示、地図下の詳細エリアを使用
        document.getElementById('hotel-detail-content').style.display = 'none';
    } else {
        saveListState();
        document.getElementById('area-button-container').style.display = 'none';
        document.getElementById('hotel-list').style.display = 'none';
        const rs = document.getElementById('result-status');
        if (rs) rs.style.display = 'none';
        hideLovehoTabs();
        hideFilterBar();
        // 地図下の詳細エリアは非表示
        const mapDetail = document.getElementById('map-detail-content');
        if (mapDetail) { mapDetail.style.display = 'none'; mapDetail.innerHTML = ''; }
    }

    // 地図モードでは地図下に表示、通常は元の位置に表示
    const content = _mapDetailMode
        ? document.getElementById('map-detail-content')
        : document.getElementById('hotel-detail-content');
    content.style.display = 'block';
    content.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-3);">読み込み中...</div>`;

    await loadDetail(hotelId, isLoveho);
    if (_mapDetailMode) {
        // 地図と詳細の境目あたりにスクロール（地図の半分が見える位置）
        const mapEl = document.getElementById('hotel-map');
        if (mapEl) {
            const mapRect = mapEl.getBoundingClientRect();
            const scrollTarget = window.scrollY + mapRect.top + mapRect.height / 2 - 60;
            setTimeout(() => window.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' }), 100);
        }
    } else {
        window.scrollTo(0, 0);
    }
}

function closeHotelPanel() {
    history.back();
}

let _savedBreadcrumbHTML = '';
let _savedTabsHTML = '';

function saveListState() {
    const bc = document.querySelector('.breadcrumb-inner');
    if (bc) _savedBreadcrumbHTML = bc.innerHTML;
    const tabs = document.getElementById('hotel-loveho-tabs');
    if (tabs) _savedTabsHTML = tabs.outerHTML;
}

function leaveHotelDetail() {
    _mapDetailMode = false;
    currentHotelId = null;
    const content = document.getElementById('hotel-detail-content');
    if (content) { content.style.display = 'none'; content.innerHTML = ''; }
    const mapDetail = document.getElementById('map-detail-content');
    if (mapDetail) { mapDetail.style.display = 'none'; mapDetail.innerHTML = ''; }
    document.getElementById('area-button-container').style.display = '';
    const rs = document.getElementById('result-status');
    if (rs) rs.style.display = '';
    document.getElementById('hotel-list').style.display = '';
    // パンくず復元
    if (_savedBreadcrumbHTML) {
        const bc = document.querySelector('.breadcrumb-inner');
        if (bc) bc.innerHTML = _savedBreadcrumbHTML;
    }
    // タブ復元
    if (_savedTabsHTML) {
        const existingTabs = document.getElementById('hotel-loveho-tabs');
        if (!existingTabs) {
            const hotelList = document.getElementById('hotel-list');
            if (hotelList) hotelList.insertAdjacentHTML('beforebegin', _savedTabsHTML);
        }
    }
    // ラブホムード解除
    document.getElementById('hotel-list').classList.remove('loveho-mood');
}

// loadHotelDetail / loadLovehoDetail は loadDetail に統合済み

function renderHotelDetail(hotel, reports, summary, _shops, shopHotelInfoList, shopStatusMap) {
    shopStatusMap = shopStatusMap || {};
    updatePageTitle(hotel.name + ' - 口コミ・対応情報');
    const can     = summary?.can_call_count    || 0;
    const cannot  = summary?.cannot_call_count || 0;
    const shopCan = summary?.shop_can_count    || 0;
    const shopNg  = summary?.shop_ng_count     || 0;
    const total   = can + cannot;

    const shopFeeMap = {};
    const shopInfoMap = {};
    Object.entries(shopStatusMap).forEach(([name, info]) => {
        shopInfoMap[name] = { shop_url: info.shop_url || null, isPaid: info.isPaid || false, planPrice: info.planPrice || 0, status: info.status || null, shopId: info.shopId || null };
    });
    (shopHotelInfoList || []).forEach(info => {
        const shop = info.shops;
        const name = shop?.shop_name;
        if (!name) return;
        shopFeeMap[name] = info.transport_fee;
        const price = Math.max(...(shop?.shop_contracts || []).map(c => c.contract_plans?.price || 0), 0);
        const existing = shopInfoMap[name] || {};
        shopInfoMap[name] = {
            shop_url: shop?.shop_url || existing.shop_url || null,
            isPaid: price > 0 || existing.isPaid || false,
            planPrice: Math.max(price, existing.planPrice || 0),
            status: shop?.status || existing.status || null,
            shopId: shop?.id || existing.shopId || null
        };
    });
    if (SHOP_DATA?.shop_name) {
        const name = SHOP_DATA.shop_name;
        const existing = shopInfoMap[name] || {};
        const price = Math.max(...(SHOP_DATA?.shop_contracts || []).map(c => c.contract_plans?.price || 0), 0);
        shopInfoMap[name] = {
            shop_url: existing.shop_url || SHOP_DATA?.shop_url || null,
            isPaid: existing.isPaid || price > 0,
            planPrice: Math.max(price, existing.planPrice || 0),
            status: existing.status || SHOP_DATA?.status || null,
            shopId: existing.shopId || SHOP_ID || null
        };
    }

    function buildReportCard(r) {
        const entryTags = [
            ...(r.can_call ? (r.can_call_reasons||[]) : (r.cannot_call_reasons||[])),
            ...(r.conditions||[])
        ];
        const tagColor = r.can_call ? '#1976d2' : '#c05050';
        const tagBg   = r.can_call ? 'rgba(33,150,243,0.1)'  : 'rgba(192,80,80,0.08)';
        const tagBorder = r.can_call ? 'rgba(33,150,243,0.3)' : 'rgba(192,80,80,0.25)';
        const tagsHTML = entryTags.map(t =>
            `<span style="padding:2px 7px;background:${tagBg};border:1px solid ${tagBorder};border-radius:8px;font-size:10px;color:${tagColor};">${esc(t)}</span>`
        ).join('');
        const guestChip = r.multi_person
            ? `<span style="padding:2px 7px;background:rgba(181,98,122,0.08);border:1px solid rgba(181,98,122,0.2);border-radius:8px;font-size:10px;color:var(--accent,#b5627a);">👥 複数人利用OK${r.guest_male||r.guest_female ? `<span style="color:var(--text-3);margin-left:3px;">（${r.guest_male?`男性${r.guest_male}名`:''}${r.guest_male&&r.guest_female?'・':''}${r.guest_female?`女性${r.guest_female}名`:''}）</span>`:''}</span>`
            : (r.guest_female != null && r.guest_female > 0)
            ? `<span style="padding:2px 7px;background:rgba(181,98,122,0.08);border:1px solid rgba(181,98,122,0.2);border-radius:8px;font-size:10px;color:var(--accent,#b5627a);">👥 男性${r.guest_male}名・女性${r.guest_female}名</span>`
            : '';
        const metaChips = [
            r.time_slot  ? `<span style="padding:2px 7px;background:rgba(106,138,188,0.1);border:1px solid rgba(106,138,188,0.25);border-radius:8px;font-size:10px;color:#6a8abc;">🕐${esc(r.time_slot)}</span>` : '',
            r.room_type  ? `<span style="padding:2px 7px;background:var(--bg-3);border:1px solid var(--border);border-radius:8px;font-size:10px;color:var(--text-2);">🛏${esc(r.room_type)}</span>` : '',
            guestChip,
        ].join('');
        const isShop = r.poster_type === 'shop';
        const feeLabel = isShop ? formatTransportFee(shopFeeMap[r.poster_name]) : null;
        const posterHTML = r.poster_name ? (()=>{
            const gm=r.gender_mode;const icon=gm==='women'?'♀':gm==='men_same'?'♂♂':gm==='women_same'?'♀♀':'♂';const col=gm==='women'?'#c47a88':gm==='men_same'?'#2c5282':gm==='women_same'?'#8264b4':'#4a7ab0';
            const si=isShop?shopInfoMap[r.poster_name]:null;
            if(isShop&&si&&si.status&&si.status!=='active'){return`<span style="font-size:10px;color:var(--text-3);">${icon} 🏢 店舗提供情報</span>`;}
            const badge = si?.isPaid ? `<span class="shop-premium-badge">認定店舗</span>` : `<span class="shop-verified-badge">認証店舗</span>`;
            if(isShop&&si&&si.status==='active'&&si.isPaid&&si.shop_url){return`<a href="${esc(si.shop_url)}" target="${_extTarget}" rel="noopener" style="font-size:10px;color:${col};font-weight:700;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'" onclick="event.stopPropagation()">${icon} ${esc(r.poster_name)} 🔗</a> ${badge}`;}
            if(isShop&&si&&si.status==='active'){return`<span style="font-size:10px;color:${col};font-weight:600;">${icon} ${esc(r.poster_name)}</span> ${badge}`;}
            return`<span style="font-size:10px;color:${col};font-weight:600;">${icon} ${esc(r.poster_name)}</span>`;
        })() : '';
        const feeHTML = feeLabel ? `<span style="padding:2px 8px;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.3);border-radius:8px;font-size:10px;color:#9a7030;">🚕 交通費: ${feeLabel}</span>` : '';
        const flagHTML = r.id ? `<button onclick="showFlagModal('${r.id}')" style="padding:2px 7px;background:transparent;border:1px solid rgba(180,150,100,0.2);border-radius:8px;font-size:10px;color:var(--text-3);cursor:pointer;font-family:inherit;white-space:nowrap;">🚩 報告</button>` : '';

        return `
        <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:5px;">
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                <span style="font-size:11px;font-weight:700;color:var(--text-3);white-space:nowrap;">${formatDate(r.created_at)}</span>
                <span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;${r.can_call ? (r.poster_type === 'shop' ? 'background:rgba(58,154,96,0.08);color:#3a9a60;' : 'background:rgba(33,150,243,0.08);color:#1976d2;') : 'background:rgba(192,80,80,0.08);color:#c05050;'}">
                    ${r.poster_type === 'shop' ? (r.can_call ? '✅ ご案内実績あり' : '❌ ご案内不可') : (r.can_call ? '✅ ' + t('can_call') : '❌ ' + t('cannot_call'))}
                </span>
                ${tagsHTML}
                ${metaChips}
            </div>
            ${(posterHTML || feeHTML) ? `<div style="display:flex;align-items:center;gap:12px;margin-top:6px;flex-wrap:wrap;">${posterHTML}${feeHTML}</div>` : ''}
            ${r.comment ? `<div style="font-size:12px;color:var(--text-2);line-height:1.6;margin-top:6px;">${esc(r.comment)}</div>` : ''}
            ${flagHTML ? `<div style="text-align:right;margin-top:4px;">${flagHTML}</div>` : ''}
        </div>`;
    }

    const userReports = reports.filter(r => r.poster_type !== 'shop');
    const userCanCall = userReports.filter(r => r.can_call).length;
    const userPct = userReports.length > 0 ? Math.round(userCanCall / userReports.length * 100) : null;
    const shopReports = reports.filter(r => r.poster_type === 'shop' && r.gender_mode === MODE);
    const SHOP_REFRESH_MS2 = 30 * 24 * 60 * 60 * 1000;
    function shopSortDate2(r) {
        const d = new Date(r.updated_at || r.created_at);
        if (Date.now() - d.getTime() > SHOP_REFRESH_MS2) {
            const cycles = Math.floor((Date.now() - d.getTime()) / SHOP_REFRESH_MS2);
            return new Date(d.getTime() + cycles * SHOP_REFRESH_MS2);
        }
        return d;
    }
    shopReports.sort((a, b) => {
        const priceA = shopInfoMap[a.poster_name]?.planPrice || 0;
        const priceB = shopInfoMap[b.poster_name]?.planPrice || 0;
        if (priceB !== priceA) return priceB - priceA;
        return shopSortDate2(b) - shopSortDate2(a);
    });
    const shopCanCall = shopReports.filter(r => r.can_call).length;
    const shopPct = shopReports.length > 0 ? Math.round(shopCanCall / shopReports.length * 100) : null;
    const noReports = `<div style="text-align:center;padding:16px 0;color:var(--text-3);font-size:12px;">まだ投稿がありません</div>`;

    window._scrollableSection = function(items, buildFn) {
        if (!items.length) return '<div style="text-align:center;padding:16px 0;color:var(--text-3);font-size:12px;">該当する投稿がありません</div>';
        const html = items.map(buildFn).join('');
        if (items.length <= 5) return html;
        return `<div style="max-height:420px;overflow-y:auto;padding-right:4px;">${html}</div>`;
    };
    function scrollableSection(items, buildFn) {
        if (!items.length) return '';
        const html = items.map(buildFn).join('');
        if (items.length <= 5) return html;
        return `<div style="max-height:420px;overflow-y:auto;padding-right:4px;">${html}</div>`;
    }

    // 店舗フィルタータブ
    window._shopReports = shopReports;
    window._buildReportCard = buildReportCard;
    const shopCanCount = shopReports.filter(r => r.can_call).length;
    const shopNgCount = shopReports.filter(r => !r.can_call).length;
    const shopFilterTabs = (shopReports.length > 1 && shopCanCount > 0 && shopNgCount > 0) ? `
                <button onclick="filterShopReports('all')" class="sr-tab sr-tab-active" data-filter="all" style="padding:3px 10px;border-radius:14px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid rgba(201,168,76,0.4);background:rgba(201,168,76,0.12);color:#7a5c10;">全て</button>
                <button onclick="filterShopReports('can')" class="sr-tab" data-filter="can" style="padding:3px 10px;border-radius:14px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid rgba(58,154,96,0.25);background:transparent;color:#3a9a60;">✅ 案内可 ${shopCanCount}</button>
                <button onclick="filterShopReports('ng')" class="sr-tab" data-filter="ng" style="padding:3px 10px;border-radius:14px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid rgba(192,80,80,0.25);background:transparent;color:#c05050;">❌ 案内不可 ${shopNgCount}</button>` : '';

    const shopSection = shopReports.length === 0 ? '' : `
        <div style="border:2px solid rgba(201,168,76,0.5);border-radius:12px;padding:14px 16px;margin-bottom:16px;background:linear-gradient(135deg,rgba(201,168,76,0.07) 0%,rgba(255,248,220,0.5) 100%);box-shadow:0 2px 12px rgba(201,168,76,0.12);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;border-bottom:1px solid rgba(201,168,76,0.3);padding-bottom:8px;">
                <span style="font-size:12px;font-weight:700;color:#7a5c10;white-space:nowrap;">✅ 店舗公式情報 (${shopReports.length})</span>
                ${shopFilterTabs}
            </div>
            <div id="shop-reports-list">${scrollableSection(shopReports, buildReportCard)}</div>
        </div>`;

    // フィルタータブ用にグローバル保持
    window._userReports = userReports;
    window._buildReportCard = buildReportCard;
    const canCount = userReports.filter(r => r.can_call).length;
    const ngCount = userReports.filter(r => !r.can_call).length;
    const filterTabs = (userReports.length > 1 && canCount > 0 && ngCount > 0) ? `<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
        <button onclick="filterUserReports('all')" class="ur-tab ur-tab-active" data-filter="all" style="padding:4px 12px;border-radius:16px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid var(--border);background:var(--accent-bg);color:var(--accent);">全て (${userReports.length})</button>
        ${canCount ? `<button onclick="filterUserReports('can')" class="ur-tab" data-filter="can" style="padding:4px 12px;border-radius:16px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid rgba(33,150,243,0.25);background:transparent;color:#1976d2;">✅ 呼べた (${canCount})</button>` : ''}
        ${ngCount ? `<button onclick="filterUserReports('ng')" class="ur-tab" data-filter="ng" style="padding:4px 12px;border-radius:16px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid rgba(192,80,80,0.25);background:transparent;color:#c05050;">❌ 呼べなかった (${ngCount})</button>` : ''}
    </div>` : '';

    const userReportsHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin:4px 0 10px;">
            <span style="font-size:16px;font-weight:600;color:var(--text);">みんなの体験談</span>
            <div style="flex:1;height:1px;background:var(--border);"></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:8px;">
            <span style="font-size:12px;font-weight:700;color:var(--text-2);white-space:nowrap;">${{ men: '♂', women: '♀', men_same: '♂♂', women_same: '♀♀' }[MODE] || '♂'} ユーザー投稿 (${userReports.length})</span>
            ${(userReports.length > 1 && canCount > 0 && ngCount > 0) ? `
                <button onclick="filterUserReports('all')" class="ur-tab ur-tab-active" data-filter="all" style="padding:3px 10px;border-radius:14px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid var(--border);background:var(--accent-bg);color:var(--accent);">全て</button>
                ${canCount ? `<button onclick="filterUserReports('can')" class="ur-tab" data-filter="can" style="padding:3px 10px;border-radius:14px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid rgba(33,150,243,0.25);background:transparent;color:#1976d2;">✅ 呼べた ${canCount}</button>` : ''}
                ${ngCount ? `<button onclick="filterUserReports('ng')" class="ur-tab" data-filter="ng" style="padding:3px 10px;border-radius:14px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid rgba(192,80,80,0.25);background:transparent;color:#c05050;">❌ 呼べない ${ngCount}</button>` : ''}
            ` : ''}
        </div>
        <div id="user-reports-list">${userReports.length > 0 ? scrollableSection(userReports, buildReportCard) : noReports}</div>`;



    getDetailContainer().innerHTML = `
    <div style="max-width:640px;margin:0 auto;padding:16px 14px 120px;">

        <!-- ホテル名 + 参考料金 -->
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin:0 0 12px 0;">
            <h2 style="font-size:23px;font-weight:600;color:#1a1410 !important;line-height:1.4;margin:0;padding:0;flex:1;min-width:0;"><a href="https://www.google.com/search?q=${encodeURIComponent(hotel.name)}" target="${_extTarget}" rel="noopener" style="color:inherit;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${esc(hotel.name)} <span style="font-size:12px;color:#999;">🔍</span></a></h2>
            ${hotel.min_charge ? '<span style="font-size:13px;font-weight:600;color:var(--accent-dim);white-space:nowrap;flex-shrink:0;">最安値 ¥' + parseInt(hotel.min_charge).toLocaleString() + '~</span>' : ''}
        </div>

        <!-- ホテル基本情報 -->
        <div style="background:#ffffff;border:1px solid rgba(180,140,80,0.2);border-radius:10px;padding:14px 18px;margin-bottom:12px;box-shadow:0 2px 16px rgba(0,0,0,0.06);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px;">
                <span style="font-size:13px;color:var(--text-2);line-height:1.5;flex:1;">${hotel.address ? '<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(hotel.address) + '" target="${_extTarget}" rel="noopener" style="color:inherit;text-decoration:none;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'" onclick="event.stopPropagation()">📍 ' + esc(hotel.address) + ' <span style="font-size:12px;color:#999;">📍</span></a>' : ''}</span>
                ${hotel.tel ? '<span style="font-size:13px;color:var(--text-2);white-space:nowrap;flex-shrink:0;">📞 ' + esc(hotel.tel) + '</span>' : ''}
            </div>
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
                <div style="width:${userPct}%;background:#2196f3;"></div>
                <div style="width:${100-userPct}%;background:#c05050;"></div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
                <span style="font-size:11px;color:var(--text-2);"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#2196f3;margin-right:3px;"></span>${t('can_call')} ${userPct}%</span>
                <span style="font-size:11px;color:var(--text-2);"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#c05050;margin-right:3px;"></span>${t('cannot_call')} ${100-userPct}%</span>
            </div>
        </div>` : ''}

        ${userReportsHTML}

        <div id="detail-ad-area-slot"></div>

        <div style="text-align:center;margin:28px 0 10px;">
            <div style="font-size:11px;color:var(--text-3);margin-bottom:4px;">${esc(hotel.name)}</div>
            <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:16px;font-weight:600;color:var(--text);">情報を投稿する</span>
                <div style="flex:1;height:1px;background:var(--border);"></div>
            </div>
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
                    <button class="toggle-btn can" id="btn-can" onclick="hotelSetCanCall(true)">✅ ${t('can_call')}</button>
                    <button class="toggle-btn cannot" id="btn-cannot" onclick="hotelSetCanCall(false)">❌ ${t('cannot_call')}</button>
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
        <div id="detail-ad-pref-slot"></div>
        <div style="display:flex; justify-content:center; gap:16px; padding:14px 20px; margin-top:12px; background:#fff; border:1px solid #e0d5d0; border-radius:8px; font-size:13px;">
            <a href="#" onclick="openHotelRequestModal();return false;" style="color:#8b5e6b; text-decoration:none; padding:6px 16px; border:1px solid #d4b8c1; border-radius:20px; background:#fdf6f8; font-size:12px; white-space:nowrap;">📝 未掲載ホテル情報提供</a>
            <a href="/shop-register.html?genre=' + (typeof MODE !== 'undefined' ? MODE : 'men') + '" style="color:#8b5e6b; text-decoration:none; padding:6px 16px; border:1px solid #d4b8c1; border-radius:20px; background:#fdf6f8; font-size:12px; white-space:nowrap;">🏪 店舗様・掲載用はこちら</a>
        </div>
    </div>`;
}

// ==========================================================================
// エリア店舗セクション表示
// ==========================================================================
// フィルタータブ切替
function filterUserReports(filter) {
    const items = window._userReports || [];
    const buildFn = window._buildReportCard;
    const filtered = filter === 'can' ? items.filter(r => r.can_call) : filter === 'ng' ? items.filter(r => !r.can_call) : items;
    document.getElementById('user-reports-list').innerHTML = window._scrollableSection(filtered, buildFn);
    document.querySelectorAll('.ur-tab').forEach(t => {
        if (t.dataset.filter === filter) { t.style.background = 'var(--accent-bg)'; t.style.color = 'var(--accent)'; }
        else { t.style.background = 'transparent'; t.style.color = t.dataset.filter === 'can' ? '#1976d2' : t.dataset.filter === 'ng' ? '#c05050' : 'var(--text-3)'; }
    });
}
function filterShopReports(filter) {
    const items = window._shopReports || [];
    const buildFn = window._buildReportCard;
    const filtered = filter === 'can' ? items.filter(r => r.can_call) : filter === 'ng' ? items.filter(r => !r.can_call) : items;
    document.getElementById('shop-reports-list').innerHTML = window._scrollableSection(filtered, buildFn);
    document.querySelectorAll('.sr-tab').forEach(t => {
        if (t.dataset.filter === filter) { t.style.background = 'rgba(201,168,76,0.12)'; t.style.color = '#7a5c10'; }
        else { t.style.background = 'transparent'; t.style.color = t.dataset.filter === 'can' ? '#3a9a60' : t.dataset.filter === 'ng' ? '#c05050' : 'var(--text-3)'; }
    });
}
function filterLhUserReports(filter) {
    const items = window._lhUserReports || [];
    const buildFn = window._buildLhReviewCard;
    let filtered;
    if (filter === 'yes') filtered = items.filter(r => r.solo_entry === 'yes');
    else if (filter === 'no') filtered = items.filter(r => r.solo_entry === 'no');
    else if (filter === 'together') filtered = items.filter(r => r.solo_entry === 'together');
    else filtered = items;
    document.getElementById('lh-user-reports-list').innerHTML = window._scrollableSection(filtered, buildFn);
    document.querySelectorAll('.lhu-tab').forEach(t => {
        if (t.dataset.filter === filter) { t.style.background = 'var(--accent-bg)'; t.style.color = 'var(--accent)'; }
        else { t.style.background = 'transparent'; }
    });
}

function renderDetailShopCards(shops, cityName) {
    return shops.map(s => {
        const nameHtml = s.shop_url
            ? `<a href="${esc(s.shop_url)}" target="${_extTarget}" rel="noopener" style="color:#b5627a;font-size:13px;text-decoration:none;font-weight:500;">${esc(s.shop_name)} 🔗</a>`
            : `<span style="font-size:13px;color:var(--text);font-weight:500;">${esc(s.shop_name)}</span>`;
        const thumbHtml = s.thumbnail_url
            ? `<img src="${esc(s.thumbnail_url)}" width="48" height="64" loading="lazy" style="object-fit:cover;border-radius:4px;border:1px solid #e8ddd5;flex-shrink:0;">`
            : '';
        return `<div style="background:#faf7f4;border:1px solid #e8ddd5;border-radius:8px;padding:12px 14px;margin-bottom:8px;font-size:12px;">
            <div style="color:#999;font-size:10px;margin-bottom:6px;">📢 ${esc(cityName)}で呼べる店舗</div>
            <div style="display:flex;align-items:center;gap:12px;">
                ${thumbHtml}
                <div>
                    <div style="margin-bottom:4px;">
                        <span style="background:#b5627a;color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;">認定店</span>
                        <span style="color:#999;font-size:11px;margin-left:6px;">${s.hotel_count}件対応</span>
                    </div>
                    ${nameHtml}
                </div>
            </div>
        </div>`;
    }).join('');
}

function renderAreaShopSection(shops) {
    // 既存のセクションを削除
    const existing = document.getElementById('area-shop-section');
    if (existing) existing.remove();

    // ?shop= パラメータがある場合は表示しない（店舗自身のビュー）
    if (SHOP_ID) return;

    const hotelList = document.getElementById('hotel-list');
    if (!hotelList) return;

    const section = document.createElement('div');
    section.id = 'area-shop-section';
    section.className = 'area-shop-section';

    let html = '';

    if (shops && shops.length > 0) {
        shops.forEach(s => {
            const nameHtml = s.shop_url
                ? `<a href="${esc(s.shop_url)}" target="${_extTarget}" rel="noopener" style="color:#b5627a; font-size:13px; text-decoration:none; font-weight:500;">${esc(s.shop_name)} 🔗</a>`
                : `<span style="font-size:13px; color:var(--text); font-weight:500;">${esc(s.shop_name)}</span>`;
            const thumbHtml = s.thumbnail_url
                ? `<img src="${esc(s.thumbnail_url)}" style="width:48px;height:64px;object-fit:cover;border-radius:4px;border:1px solid #e8ddd5;flex-shrink:0;">`
                : '';
            html += `<div style="background:#faf7f4; border:1px solid #e8ddd5; border-radius:8px; padding:12px 14px; margin-bottom:8px; font-size:12px;">
                <div style="color:#999; font-size:10px; margin-bottom:6px;">📢 このエリアの掲載店舗</div>
                <div style="display:flex;align-items:center;gap:12px;">
                    ${thumbHtml}
                    <div>
                        <div style="margin-bottom:4px;">
                            <span style="background:#b5627a; color:#fff; font-size:9px; padding:1px 5px; border-radius:2px;">認定店</span>
                            <span style="color:#999; font-size:11px; margin-left:6px;">${s.hotel_count}件対応</span>
                        </div>
                        ${nameHtml}
                    </div>
                </div>
            </div>`;
        });
    }

    if (!html) return; // 店舗がなければセクション自体を表示しない

    section.innerHTML = html;
    hotelList.parentNode.insertBefore(section, hotelList);
}
