// ==========================================================================
// hotel-search.js — ホテル検索、カード描画、ラブホタブ、詳細
// ==========================================================================

let _fetchGeneration = 0;

// モバイル: 同タブ遷移（戻るで戻れる）、PC: 新タブ
const _extTarget = ('ontouchstart' in window || navigator.maxTouchPoints > 0) ? '_self' : '_blank';

// 共通ユーティリティ（ホテル/ラブホ両方で使用）
const SHOP_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
function shopSortDate(r) {
    const d = new Date(r.updated_at || r.created_at);
    if (Date.now() - d.getTime() > SHOP_REFRESH_MS) {
        const cycles = Math.floor((Date.now() - d.getTime()) / SHOP_REFRESH_MS);
        return new Date(d.getTime() + cycles * SHOP_REFRESH_MS);
    }
    return d;
}
function scrollableSection(items, buildFn, emptyMsg) {
    if (!items.length) return emptyMsg || '';
    if (items.length <= 3) return items.map(buildFn).join('');
    // 最初の3件は外に表示、4件目以降をスクロール枠に
    const first3 = items.slice(0, 3).map(buildFn).join('');
    const rest = items.slice(3).map(buildFn).join('');
    const remaining = items.length - 3;
    return first3
        + `<div class="scroll-hint">▼ 他${remaining}件の口コミを表示（スクロール）</div>`
        + `<div class="scrollable-reviews">${rest}</div>`;
}

// AppState 登録（検索・表示状態の発見・デバッグ用）
// 各 let 宣言は既存コードとの互換性のためそのまま維持し、
// AppState経由でも読み書き可能にする（Object.defineProperties は各変数宣言後に実行）

// PHP API経由ホテル検索ヘルパー
async function queryHotelsAPI(params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== '') qs.set(k, v);
    }
    const res = await fetch('/api/hotels.php?' + qs.toString());
    if (!res.ok) return [];
    return await res.json();
}

// ==========================================================================
// Pagefind + Fuse.js ハイブリッド検索（最適化版）
// 戦略: Pagefind優先（WASM、高速）→ Fuse.js補完（曖昧検索）
// 事前初期化: ページ読み込み直後にバックグラウンドで両エンジン準備
// ==========================================================================

// --- Pagefind ---
let _pagefind = null;
let _pagefindLoading = false;
const _MODE_FILTER_KEY = { men: 'deri', women: 'jofu', men_same: 'same_m', women_same: 'same_f' };

async function ensurePagefind() {
    if (_pagefind) return _pagefind;
    if (_pagefindLoading) return null;
    _pagefindLoading = true;
    try {
        const pf = await import('/pagefind/pagefind.js');
        await pf.init();
        _pagefind = pf;
        return _pagefind;
    } catch (e) {
        _pagefind = null;
        _pagefindLoading = false;
        return null;
    }
}

/** Pagefind検索 → ホテルIDの配列を返す */
// 半角/全角統一（NFKC: ＩＮＮ→INN、全角数字→半角等）+ 小文字化
function _norm(s) { return s ? s.normalize('NFKC').toLowerCase() : ''; }

async function pagefindSearchIds(keyword, filters, limit) {
    const pf = await ensurePagefind();
    if (!pf) return null;
    try {
        const opts = {};
        if (filters && Object.keys(filters).length) opts.filters = filters;
        const result = await pf.search(keyword ? keyword.normalize('NFKC') : null, opts);
        if (!result?.results?.length) return [];
        const slice = result.results.slice(0, limit || 30);
        const ids = await Promise.all(slice.map(async r => {
            const data = await r.data();
            return data?.meta?.id ? parseInt(data.meta.id) : null;
        }));
        return ids.filter(Boolean);
    } catch (e) {
        return null;
    }
}

// --- Fuse.js (Web Worker) ---
let _fuseWorker = null;
let _fuseReady = false;
let _fuseReadyPromise = null;

function ensureFuseWorker() {
    if (_fuseWorker) return _fuseReadyPromise;
    try {
        _fuseWorker = new Worker('/fuse-worker.js?v=CACHE_HASH');
        _fuseReadyPromise = new Promise((resolve) => {
            _fuseWorker.onmessage = (e) => {
                if (e.data.type === 'ready') { _fuseReady = true; resolve(true); }
                if (e.data.type === 'error') { resolve(false); }
            };
        });
        _fuseWorker.postMessage({ type: 'init' });
    } catch (e) {
        _fuseReadyPromise = Promise.resolve(false);
    }
    return _fuseReadyPromise;
}

/** Fuse.js検索 → ホテルIDの配列を返す（Web Worker経由） */
async function fuseSearchIds(keyword, limit) {
    if (!_fuseReady) await ensureFuseWorker();
    if (!_fuseReady || !_fuseWorker) return null;
    return new Promise((resolve) => {
        const handler = (e) => {
            if (e.data.type === 'result') {
                _fuseWorker.removeEventListener('message', handler);
                resolve(e.data.ids);
            }
        };
        _fuseWorker.addEventListener('message', handler);
        _fuseWorker.postMessage({ type: 'search', keyword, limit: limit || 30 });
    });
}

// --- 事前初期化（ページ読み込み後バックグラウンドで準備） ---
setTimeout(() => {
    ensurePagefind();
    ensureFuseWorker();
}, 1500);

// --- ハイブリッド検索 ---
/** Pagefind + Fuse.js 並列 → マージ → PHP APIフォールバック */
async function hybridSearch(keyword, limit) {
    const lim = limit || 50;

    // キーワード検索ではモードフィルタを使わない（名前で探しているため）
    // フィルタはエリアブラウジング等で別途使用

    // Pagefind + Fuse.js 並列実行
    const [pgIds, fuseIds] = await Promise.all([
        pagefindSearchIds(keyword, {}, lim),
        fuseSearchIds(keyword, lim)
    ]);

    // マージ: 両方の結果を統合、重複排除
    const seen = new Set();
    const mergedIds = [];
    for (const id of [...(pgIds || []), ...(fuseIds || [])]) {
        if (!seen.has(id)) { seen.add(id); mergedIds.push(id); }
    }

    if (!mergedIds.length) return null;
    const hotels = await queryHotelsAPI({ ids: mergedIds.slice(0, lim).join(','), type: 'all', limit: lim });
    // キーワード一致度でソート（完全一致 > 先頭一致 > 部分一致 > それ以外）
    const kw = _norm(keyword);
    hotels.sort((a, b) => {
        const na = _norm(a.name), nb = _norm(b.name);
        const scoreA = na === kw ? 0 : na.startsWith(kw) ? 1 : na.includes(kw) ? 2 : 3;
        const scoreB = nb === kw ? 0 : nb.startsWith(kw) ? 1 : nb.includes(kw) ? 2 : 3;
        if (scoreA !== scoreB) return scoreA - scoreB;
        // 同スコアならマージ順（Pagefind/Fuse.js関連度）を維持
        const idOrder = new Map(mergedIds.map((id, i) => [id, i]));
        return (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999);
    });
    return hotels;
}

/** 後方互換: 旧fuseSearch（hybridSearchに委譲） */
async function fuseSearch(keyword, limit) {
    return hybridSearch(keyword, limit);
}

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
        const apiParams = { limit: 50 };
        if (filterObj.prefecture) apiParams.pref = filterObj.prefecture;
        if (filterObj.major_area) apiParams.major_area = filterObj.major_area;
        if (filterObj.detail_area) apiParams.detail_area = filterObj.detail_area;
        if (filterObj.city) apiParams.city = filterObj.city;
        if (keyword) apiParams.keyword = keyword;

        const rawHotels = await queryHotelsAPI(apiParams);
        let hotels = await fetchHotelsWithSummary(rawHotels);
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
    if (region && !isSinglePrefRegion(region)) crumbs.push({ label: regionLabel, onclick: `showPrefPage(REGION_MAP.find(r=>r.label==='${regionLabel}'))` });
    if (pref) crumbs.push({ label: pref, onclick: `showMajorAreaPage(REGION_MAP.find(r=>r.label==='${regionLabel}'), '${pref}')` });
    if (majorArea) crumbs.push({ label: majorArea, onclick: `showCityPage(REGION_MAP.find(r=>r.label==='${regionLabel}'), '${pref}', '${majorArea}')` });
    if (detailArea) crumbs.push({ label: detailArea, onclick: `showDetailAreaPage(REGION_MAP.find(r=>r.label==='${regionLabel}'), '${pref}', '${majorArea}', '${detailArea}')` });
    crumbs.push({ label: city });
    setBreadcrumb(crumbs);
    const _adFb = [];
    if (majorArea) _adFb.push({ type: 'area', target: majorArea });
    if (pref) _adFb.push({ type: 'big', target: pref });
    loadAds('spot', city, _adFb);
    setBackBtn(true);

    try {
        const apiParams = { limit: 50, city };
        if (filterObj.prefecture) apiParams.pref = filterObj.prefecture;

        const rawHotels = await queryHotelsAPI(apiParams);
        let hotels = await fetchHotelsWithSummary(rawHotels);
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
    _stationForLoveho = null; // 通常エリアナビなので駅フラグリセット
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
    // フォールバック: JSONにない場合はPHP API
    if (!lovehoCount && !_areaData) {
        const fbHotels = await queryHotelsAPI({ pref, city_like: city, type: 'loveho', cols: 'id', limit: 50 });
        lovehoCount = fbHotels ? fbHotels.length : 0;
    }
    const urlTab = new URLSearchParams(window.location.search).get('tab');

    const tabsDiv = document.createElement('div');
    tabsDiv.id = 'hotel-loveho-tabs';
    tabsDiv.style.cssText = 'display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid #ddd;max-width:640px;margin-left:auto;margin-right:auto;padding:0 16px;';
    const lovehoTab = lovehoCount
        ? `<button class="hotel-tab detail-tab detail-tab--inactive" data-tab="loveho" onclick="switchTab('loveho')">🏩 ラブホ (<span id="loveho-count">${lovehoCount}</span>)</button>`
        : '';
    tabsDiv.innerHTML = `
        <button class="hotel-tab detail-tab detail-tab--active" data-tab="hotel" onclick="switchTab('hotel')">🏨 ホテル (<span id="hotel-count">${hotelCount}</span>)</button>
        ${lovehoTab}
        <button id="btn-map-toggle" class="btn-map-toggle" onclick="toggleMapView()"><span class="btn-location-icon">🗺️</span><span class="btn-location-label">地図で見る</span></button>
    `;

    const hotelList = document.getElementById('hotel-list');
    hotelList.parentNode.insertBefore(tabsDiv, hotelList);

    if (urlTab === 'loveho' && lovehoCount) {
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

    document.querySelectorAll('#hotel-loveho-tabs .hotel-tab, #hotel-loveho-tabs-bottom .hotel-tab').forEach(t => {
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

    // タブ状態をURLに反映（パスは維持、tabパラメータのみ操作）
    const curPath = window.location.pathname;
    const cur = new URLSearchParams(window.location.search);
    if (tab === 'loveho') cur.set('tab', 'loveho');
    else cur.delete('tab');
    const qs = cur.toString();
    history.replaceState(null, '', curPath + (qs ? '?' + qs : ''));

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
    // 駅検索の場合は駅名ベースでラブホ取得
    if (_stationForLoveho) {
        return loadLovehoForStation(_stationForLoveho);
    }
    if (!_tabFilterObj || !_tabCity) return;
    const gen = ++_fetchGeneration;
    showLoading();
    try {
        const pref = _tabFilterObj.prefecture;
        const apiP = { type: 'loveho', city_like: _tabCity, limit: 50 };
        if (pref) apiP.pref = pref;
        const hotels = await queryHotelsAPI(apiP);
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

/** 駅名ベースでラブホ取得（駅検索時のタブ切替用） */
async function loadLovehoForStation(stationName) {
    const gen = ++_fetchGeneration;
    showLoading();
    try {
        const hotels = await queryHotelsAPI({ station: stationName, type: 'loveho', limit: 50 });
        if (gen !== _fetchGeneration) return;
        if (!hotels || !hotels.length) { cachedLovehoData = []; renderLovehoCards([]); return; }
        const hotelIds = hotels.map(h => h.id);
        const summaries = await fetchLovehoReviewSummaries(hotelIds);
        if (gen !== _fetchGeneration) return;
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
function lhStarsHTML() {
    return '';
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
    const reviewBadge = reviewCount > 0 ? `<span class="review-count-badge">💬 ${reviewCount}件</span>` : '';
    const distHTML = showDist && h.distance != null ? `<div class="hotel-distance-badge">📍 ${h.distance < 1 ? Math.round(h.distance * 1000) + 'm' : h.distance.toFixed(1) + 'km'}</div>` : '';
    return `
    <div class="hotel-card-lux loveho-card-bg" style="animation-delay:${Math.min(i*0.04,0.4)}s;" onclick="openLovehoDetail(${h.id})" role="button">
        ${distHTML}
        <div class="hotel-card-body">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <div style="flex:1;min-width:0;font-size:14px;font-weight:500;color:var(--text);line-height:1.5;word-break:break-all;">${esc(h.name)}</div>
                ${reviewBadge}
            </div>
            <div class="hotel-info-row"><span class="hotel-info-icon">📍</span><span class="hotel-info-text">${esc(h.address || '')}</span></div>
            ${h.nearest_station ? `<div class="hotel-info-row"><span class="hotel-info-icon">🚉</span><span class="hotel-info-text">${esc(h.nearest_station)}</span></div>` : ''}
            ${h.tel ? `<div style="font-size:11px;color:var(--text-3);margin-top:2px;">📞 ${esc(h.tel)}</div>` : ''}
            <div class="hotel-card-footer card-footer">
                <button onclick="event.stopPropagation();openLovehoDetail(${h.id})" class="card-action-btn card-action-btn--lh-primary">✨ 口コミを見る${reviewCount > 0 ? ` (${reviewCount})` : ''}</button>
                <button onclick="event.stopPropagation();openLovehoDetail(${h.id})" class="card-action-btn card-action-btn--lh-secondary">📝 口コミを投稿</button>
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
            <div id="load-more-container" class="load-more-wrap">
                <button onclick="loadMoreLovehoCards()" class="load-more-btn load-more-btn--loveho">もっと見る（残り${remaining}件）</button>
            </div>`);
    }

    if (displayedCount >= allHotels.length) {
        const shopRegLink = SHOP_ID ? '' : '<a href="/shop-register.html?genre=' + (typeof MODE !== 'undefined' ? MODE : 'men') + '" class="info-link-pill">🏪 店舗様・掲載用はこちら</a>';
        container.insertAdjacentHTML('beforeend', `
            <div class="info-links-bar">
                <a href="#" onclick="openHotelRequestModal();return false;" class="info-link-pill">📝 未掲載ホテル情報提供</a>
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
    content.innerHTML = `<div class="detail-loading">読み込み中...</div>`;
    try {
        // マスタデータロード（タイプ別）
        if (isLoveho) await loadLhMasters();
        else await Promise.all([loadConditionsMaster(), loadCanCallReasonsMaster(), loadCannotCallReasonsMaster(), loadRoomTypesMaster()]);

        // データ取得（PHP API経由）
        const detailType = isLoveho ? 'loveho' : 'hotel';
        const detailRes = await fetch(`/api/hotel-detail.php?hotel_id=${hotelId}&type=${detailType}`);
        if (!detailRes.ok) throw new Error('Hotel not found');
        const detailData = await detailRes.json();
        if (!detailData.hotel) throw new Error('Hotel not found');
        const hotel = detailData.hotel;
        let reports = detailData.reports || [];

        // 店舗情報マップ構築（共通）
        const shopInfoMap = {};
        const shopFeeMap = {};
        (detailData.shop_info || []).forEach(info => {
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
            if (_shopParam && (SHOP_ID || SHOP_DATA?.shop_name)) {
                const shopName = SHOP_DATA?.shop_name;
                reports = reports.filter(r => {
                    if (r.poster_type === 'shop') return r.shop_id === SHOP_ID || (shopName && r.poster_name === shopName);
                    return true;
                });
            }
            const posterShopNames = [...new Set(reports.filter(r => r.poster_type === 'shop' && r.poster_name).map(r => r.poster_name))];
            if (posterShopNames.length > 0) {
                const shopRows = detailData.poster_shops || [];
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
        if (_region && !isSinglePrefRegion(_region)) _crumbs.push({ label: _rl, onclick: `leaveHotelDetail();showPrefPage(REGION_MAP.find(r=>r.label==='${_rl}'))` });
        if (_pref) _crumbs.push({ label: _pref, onclick: `leaveHotelDetail();showMajorAreaPage(REGION_MAP.find(r=>r.label==='${_rl}'),'${_pref}')` });
        if (_majorArea) _crumbs.push({ label: _majorArea, onclick: `leaveHotelDetail();showCityPage(REGION_MAP.find(r=>r.label==='${_rl}'),'${_pref}','${_majorArea}')` });
        if (_detailArea) _crumbs.push({ label: _detailArea, onclick: `leaveHotelDetail();showDetailAreaPage(REGION_MAP.find(r=>r.label==='${_rl}'),'${_pref}','${_majorArea}','${_detailArea}')` });
        if (_city) _crumbs.push({ label: _city, onclick: `leaveHotelDetail();fetchAndShowHotelsByCity({prefecture:'${_pref}',major_area:'${_majorArea}'},'${_city}')` });
        _crumbs.push({ label: hotel.name });
        setBreadcrumb(_crumbs);

        // レンダリング（タイプ別）
        if (isLoveho) {
            // 店舗モード時: ラブホ店舗投稿も自店舗のみ表示
            // loveho_reportsにはposter_typeがないためshopInfoMapで店舗投稿を判別
            if (_shopParam && SHOP_DATA?.shop_name) {
                const shopName = SHOP_DATA.shop_name;
                reports = reports.filter(r => {
                    if (shopInfoMap[r.poster_name]) return r.poster_name === shopName;
                    return true; // ユーザー投稿はそのまま
                });
            }
            hotel._lhShopFeeMap = shopFeeMap;
            hotel._lhShopInfoMap = shopInfoMap;
            renderLovehoDetail(hotel, reports);
        } else {
            renderHotelDetail(hotel, reports, detailData.summary || null, shopInfoMap, shopFeeMap);
        }

        // 3段階広告ロード（共通、店舗モード時も自店舗情報は表示）
        if (hotel.city) {
            const genderMode = typeof MODE !== 'undefined' ? MODE : 'men';
            const [cityShops, areaAds, prefAds] = await Promise.all([
                fetchAreaShops(hotel.prefecture, hotel.city, genderMode),
                hotel.major_area ? fetchDetailAds('area', hotel.major_area) : Promise.resolve(''),
                hotel.prefecture ? fetchDetailAds('big', hotel.prefecture) : Promise.resolve('')
            ]);
            // 店舗モード時は自店舗のみ表示
            let filteredCityShops = cityShops || [];
            if (_shopParam && filteredCityShops.length) {
                filteredCityShops = filteredCityShops.filter(s =>
                    (SHOP_ID && s.id === SHOP_ID) ||
                    (SHOP_SLUG && s.slug === SHOP_SLUG) ||
                    s.slug === _shopParam ||
                    s.id === _shopParam
                );
            }
            const citySlot = document.getElementById('detail-ad-slot');
            if (citySlot && filteredCityShops.length) citySlot.innerHTML = renderDetailShopCards(filteredCityShops, hotel.city);
            // 店舗モード時は他店舗のエリア/都道府県広告を非表示
            if (!_shopParam) {
                const areaSlot = document.getElementById('detail-ad-area-slot');
                if (areaSlot && areaAds) areaSlot.innerHTML = areaAds;
                const prefSlot = document.getElementById('detail-ad-pref-slot');
                if (prefSlot && prefAds) prefSlot.innerHTML = prefAds;
            }
        }
    } catch(e) {
        content.innerHTML = `<div class="detail-error">読み込みエラーが発生しました</div>`;
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
        const gpTagHTML = (items) => items.map(gp=>`<span class="tag-chip tag-chip--gp">${esc(gp)}</span>`).join('');
        const gm=r.gender_mode;const gmIcon=gm==='women'?'♀':gm==='men_same'?'♂♂':gm==='women_same'?'♀♀':'♂';const gmCol=gm==='women'?'#c47a88':gm==='men_same'?'#2c5282':gm==='women_same'?'#8264b4':'#4a7ab0';
        const pName=r.poster_name||'匿名';
        const si=lhShopInfoMap[pName];
        const shopBadge=si?(si.isPaid?` <span class="shop-premium-badge">認定店舗</span>`:` <span class="shop-verified-badge">認証店舗</span>`):'';
        const posterHTML=si&&si.isPaid&&si.url?`<a href="${esc(si.url)}" target="${_extTarget}" rel="noopener" class="poster-name" style="color:${gmCol};">${gmIcon} ${esc(pName)} 🔗</a>${shopBadge}`:`<span class="poster-name" style="color:${gmCol};">${gmIcon} ${esc(pName)}</span>${shopBadge}`;
        const fee=lhShopFeeMap[pName];
        const feeLabel=formatTransportFee(fee);
        const feeHTML=feeLabel?`<span class="fee-badge">🚕 交通費: ${feeLabel}</span>`:'';
        const entryMethodLabels={front:'フロント経由(部屋番号を伝えて入室)',direct:'直接入室(お部屋に直行)',lobby:'ロビー待ち合わせ',waiting:'待合室で待ち合わせ'};
        return `<div class="review-card">
            <div class="review-meta-row">
                <div class="review-poster-row">${posterHTML}${feeHTML}</div>
                <span class="text-sub3">${formatDate(r.created_at)}</span>
            </div>
            ${r.solo_entry && shopNames.includes(pName) && (r.solo_entry==='yes'||r.solo_entry==='together') ? `<div style="margin:6px 0;"><span class="round-badge round-badge--solo-can">✅ ご案内実績有</span></div>` : ''}
            ${r.solo_entry && !shopNames.includes(pName) ? `<div style="margin:6px 0;"><span class="round-badge ${r.solo_entry==='yes'?'round-badge--solo-can':'round-badge--solo-ng'}">${r.solo_entry==='yes'?'🚪 一人で先に入れた':r.solo_entry==='no'?'🚪 一人で先に入れなかった':r.solo_entry==='together'?'🚪 一緒に入った':''}</span></div>` : ''}
            ${r.comment ? `<div class="text-comment" style="margin-top:4px;">${esc(r.comment)}</div>` : ''}
            ${r.atmosphere ? `<div style="margin-bottom:6px;"><span class="review-gp-label">✨ 雰囲気　</span><span class="atmo-badge">${atmosphereIcon(r.atmosphere)}${esc(r.atmosphere)}</span></div>` : ''}
            ${gpRoom.length ? `<div class="review-gp-section"><div class="review-gp-label">🛁 設備・お部屋</div><div class="review-gp-tags">${gpTagHTML(gpRoom)}</div></div>` : ''}
            ${gpService.length ? `<div class="review-gp-section"><div class="review-gp-label">🏨 サービス・利便性</div><div class="review-gp-tags">${gpTagHTML(gpService)}</div></div>` : ''}
            ${r.entry_method ? `<div class="review-detail-text">🚪 ${MODE==='women'?'セラピスト':'キャスト'}の入室方法: ${esc(entryMethodLabels[r.entry_method]||r.entry_method)}</div>` : ''}
            ${r.time_slot ? `<div class="review-detail-text">🕐 ${esc(r.time_slot)}</div>` : ''}
            ${r.multi_person ? `<div style="font-size:12px;color:var(--accent,#b5627a);margin-top:4px;">👥 複数人利用OK${r.guest_male||r.guest_female ? `<span class="text-sub3" style="margin-left:4px;">（${r.guest_male ? `男性${r.guest_male}名`:''}${r.guest_male&&r.guest_female?'・':''}${r.guest_female ? `女性${r.guest_female}名`:''}）</span>`:''}${r.multi_fee ? ' <span style="color:#c9a96e;font-size:10px;">💰追加料金あり</span>' : ''}</div>` : ''}
            <button onclick="event.stopPropagation();openFlagModal('${r.id}')" class="report-flag-btn" style="margin-top:6px;opacity:0.6;">🚩 報告</button>
        </div>`;
    }

    // 店舗投稿とユーザー投稿を分離
    const lhShopReports = reports.filter(r => shopNames.includes(r.poster_name) && r.gender_mode === MODE);
    // ソート: 有料プラン高い順 → 30日自動更新ベースで新しい順
    lhShopReports.sort((a, b) => {
        const pa = lhShopInfoMap[a.poster_name]?.isPaid ? 1 : 0;
        const pb = lhShopInfoMap[b.poster_name]?.isPaid ? 1 : 0;
        if (pb !== pa) return pb - pa;
        return shopSortDate(b) - shopSortDate(a);
    });
    const lhUserReports = reports.filter(r => !shopNames.includes(r.poster_name));

    const lhShopSection = lhShopReports.length === 0 ? '' : `
        <div class="section-official">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <span class="section-label section-label--official">✅ 店舗公式情報</span>
                <span style="font-size:11px;color:#9a8050;">${lhShopReports.length}件</span>
            </div>
            ${scrollableSection(lhShopReports, buildLhReviewCard)}
        </div>`;

    // ラブホユーザーフィルタータブ
    window._lhUserReports = lhUserReports;
    window._buildLhReviewCard = buildLhReviewCard;
    const lhYesCount = lhUserReports.filter(r => r.solo_entry === 'yes').length;
    const lhNoCount = lhUserReports.filter(r => r.solo_entry === 'no').length;
    const lhTogetherCount = lhUserReports.filter(r => r.solo_entry === 'together').length;
    const lhFilterTabs = lhUserReports.length > 1 ? `<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
        <button onclick="filterLhUserReports('all')" class="lhu-tab filter-tab filter-tab--lg" data-filter="all" style="background:var(--accent-bg);color:var(--accent);">全て (${lhUserReports.length})</button>
        ${lhYesCount ? `<button onclick="filterLhUserReports('yes')" class="lhu-tab filter-tab filter-tab--lg" data-filter="yes" style="border-color:rgba(58,154,96,0.25);color:#3a9a60;">🚪 入れた (${lhYesCount})</button>` : ''}
        ${lhNoCount ? `<button onclick="filterLhUserReports('no')" class="lhu-tab filter-tab filter-tab--lg" data-filter="no" style="border-color:rgba(192,80,80,0.25);color:#c05050;">🚪 入れなかった (${lhNoCount})</button>` : ''}
        ${lhTogetherCount ? `<button onclick="filterLhUserReports('together')" class="lhu-tab filter-tab filter-tab--lg" data-filter="together" style="border-color:rgba(106,130,180,0.25);color:#4a6a9a;">🚪 一緒に入った (${lhTogetherCount})</button>` : ''}
    </div>` : '';

    const lhUserSection = lhUserReports.length === 0 ? '' : `
        <div style="margin-bottom:16px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <span class="section-label section-label--user">👤 ユーザー口コミ</span>
                <span style="font-size:11px;color:var(--text-3);">${lhUserReports.length}件</span>
            </div>
            ${lhFilterTabs}
            <div id="lh-user-reports-list">${scrollableSection(lhUserReports, buildLhReviewCard)}</div>
        </div>`;

    const selOpts = (arr) => '<option value="">選択してください</option>' + arr.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');

    // 統計HTML
    const statsHTML = soloTotal > 0 ? `
        <div style="margin-bottom:16px;">
            <div class="stat-heading">👤 一人で先に入れる？（${soloTotal}件回答）</div>
            <div class="progress-bar">
                ${Object.entries(soloCounts).map(([key, count]) => `<div style="width:${Math.round(count/soloTotal*100)}%;background:${soloColors[key]||'#ccc'};"></div>`).join('')}
            </div>
            <div class="stat-legend">
                ${Object.entries(soloCounts).map(([key, count]) => `<span class="stat-legend-item"><span class="stat-legend-dot" style="background:${soloColors[key]||'#ccc'};"></span>${soloMap[key]||key} ${Math.round(count/soloTotal*100)}%</span>`).join('')}
            </div>
        </div>` : '';

    // 口コミセクション（ユーザー投稿のみ — 店舗公式は shopSection で別表示）
    const userSection = lhUserReports.length > 0 ? `
        <div style="margin-bottom:24px;">
            <h3 style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:12px;">💬 口コミ一覧 (${lhUserReports.length}件)</h3>
            ${lhUserSection}
        </div>` : (lhShopReports.length === 0 ? `
        <div style="margin-bottom:24px;">
            <h3 style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:12px;">💬 口コミ一覧 (0件)</h3>
            <div style="color:var(--text-3);font-size:13px;">まだ口コミがありません。最初の投稿をお待ちしています！</div>
        </div>` : '');

    // フォームHTML
    const formHTML = `
        <div class="lh-form-wrap">
            <div style="text-align:center;margin-bottom:16px;">
                <div class="text-sub3" style="margin-bottom:4px;">${esc(h.name)}</div>
                <h3 style="font-size:16px;font-weight:600;color:var(--text);margin:0;">🏩 口コミを投稿する</h3>
            </div>
            <div class="lh-form-row">
                <label class="lh-form-label">${SHOP_ID ? 'チェックイン方法' : '一人で先に入れる？'}</label>
                <select id="lh-solo-entry" onchange="lhFormState.solo_entry=this.value" class="lh-form-select">
                    ${SHOP_ID
                        ? '<option value="">選択してください</option><option value="yes">はい！ご案内実績有</option><option value="no">いいえ</option><option value="together">一緒にチェックインでご案内実績有</option>'
                        : '<option value="">選択してください</option><option value="yes">はい</option><option value="no">いいえ</option><option value="together">一緒に入った</option><option value="lobby">待合室で待ち合わせ</option><option value="unknown">わからない</option>'}
                </select>
            </div>
            ${LH_MASTER.atmospheres.length ? `<div class="lh-form-row"><label class="lh-form-label">雰囲気</label><select onchange="lhFormState.atmosphere=this.value" class="lh-form-select">${selOpts(LH_MASTER.atmospheres)}</select></div>` : ''}
            ${LH_MASTER.good_points && LH_MASTER.good_points.length ? (() => {
                const categories = ['設備・お部屋', 'サービス・利便性'];
                const catIcons = { '設備・お部屋': '🛁', 'サービス・利便性': '🏨' };
                return categories.map(cat => {
                    const items = LH_MASTER.good_points.filter(p => p.category === cat);
                    if (!items.length) return '';
                    return `<div class="lh-form-row"><label class="lh-form-label">${catIcons[cat] || '📝'} ${cat} <span class="text-sub3" style="font-weight:400;">複数選択可</span></label><div class="review-gp-tags" style="gap:8px;">${items.map(p => `<div onclick="lhToggleGoodPoint(this,'${esc(p.label)}')" class="gp-select-btn">${esc(p.label)}</div>`).join('')}</div></div>`;
                }).join('');
            })() : ''}
            <div class="lh-form-row">
                <label class="multi-check-label">
                    <input type="checkbox" id="lh-multi-person" onchange="lhFormState.multi_person=this.checked; document.getElementById('lh-multi-detail').style.display=this.checked?'flex':'none';" class="multi-check-input" style="accent-color:#c9a96e;">
                    <span class="text-sub">👥 3P・4P…複数人で利用OK（任意）</span>
                </label>
                <div id="lh-multi-detail" class="multi-detail-row" style="margin-bottom:4px;flex-direction:column;">
                    <div style="display:flex;gap:8px;">
                        <span style="font-size:13px;color:var(--text-2);min-width:32px;">男性</span><select onchange="lhFormState.guest_male=this.value" class="multi-select"><option value="">-</option><option value="1">1名</option><option value="2">2名</option><option value="3">3名</option><option value="4">4名</option></select>
                        <span style="font-size:13px;color:var(--text-2);min-width:32px;">女性</span><select onchange="lhFormState.guest_female=this.value" class="multi-select"><option value="">-</option><option value="1">1名</option><option value="2">2名</option><option value="3">3名</option><option value="4">4名</option></select>
                    </div>
                    <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--text-2);cursor:pointer;"><input type="checkbox" id="lh-multi-fee" onchange="lhFormState.multi_fee=this.checked" style="width:14px;height:14px;accent-color:#c9a96e;cursor:pointer;">追加料金あり</label>
                </div>
            </div>
            <div class="lh-form-row"><label class="lh-form-label">利用時間帯</label><select onchange="lhFormState.time_slot=this.value" class="lh-form-select">${selOpts(LH_MASTER.time_slots)}</select></div>
            <div class="lh-form-row"><label class="lh-form-label">フリーコメント</label><textarea id="lh-comment" rows="3" maxlength="500" oninput="lhFormState.comment=this.value" placeholder="良かった点、気になった点など" class="lh-form-select" style="resize:vertical;"></textarea></div>
            <div class="lh-form-row"><label class="lh-form-label">投稿者名（任意）</label><input type="text" oninput="lhFormState.poster_name=this.value" placeholder="無記名" class="lh-form-select"><div class="text-sub3" style="margin-top:4px;">※未入力の場合は「匿名」として表示されます。</div></div>
            <button onclick="submitLovehoReport()" id="lh-submit-btn" class="lh-submit-btn">確認画面に進む</button>
        </div>`;

    renderDetailPage(hotel, true, { statsHTML, shopSection: lhShopSection, userSection, formHTML });

    lhFormState = { solo_entry: '', atmosphere: '', time_slot: '', comment: '', poster_name: '', good_points: [], multi_person: false, multi_fee: false, guest_male: '', guest_female: '' };
}

function setResultStatus(count) {
    const el = document.getElementById('result-status');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = count > 0 ? `<strong>${count}</strong> ${t('results')}` : t('no_results');
}

// ==========================================================================
// 最寄駅検索（サジェスト→選択→ホテル一覧）
// ==========================================================================
// 駅名の表示統一: 末尾「駅」なら除去して「駅」付与、「駅前」「駅東口」等や駅を含まない名前はそのまま
function formatStationName(name) {
    if (name.endsWith('駅')) return name;
    if (name.includes('駅')) return name; // 「長崎駅前」等はそのまま
    return name + '駅';
}
let stationTimeout = null;

function suggestStations() {
    const val = document.getElementById('station-input')?.value?.trim() || '';
    const box = document.getElementById('station-suggest');
    clearTimeout(stationTimeout);
    if (!val || val.length < 1) { box.innerHTML = ''; box.style.display = 'none'; return; }

    stationTimeout = setTimeout(async () => {
        try {
            const res = await fetch('/api/hotels.php?suggest_station=' + encodeURIComponent(val));
            if (!res.ok) return;
            const stations = await res.json();
            if (!stations.length) { box.innerHTML = '<div class="station-suggest-empty">該当する駅が見つかりません</div>'; box.style.display = 'block'; return; }
            box.innerHTML = stations.map(s => {
                const display = formatStationName(s.name);
                return `<div class="station-suggest-item" onclick="selectStation('${esc(s.name).replace(/'/g, "\\'")}')"><span class="station-suggest-name">${esc(display)}</span> <span class="station-suggest-cnt">${s.cnt}件</span></div>`;
            }).join('');
            box.style.display = 'block';
        } catch (e) { /* silenced */ }
    }, 300);
}

function selectStation(dbName) {
    const input = document.getElementById('station-input');
    const box = document.getElementById('station-suggest');
    input.value = formatStationName(dbName);
    box.innerHTML = '';
    box.style.display = 'none';
    input.blur();
    fetchHotelsByStation(dbName);
}

async function fetchHotelsByStation(stationName) {
    const name = stationName || document.getElementById('station-input')?.value?.trim() || '';
    if (!name) return;
    const displayName = formatStationName(name);

    // ホテル詳細が開いていれば閉じる
    if (currentHotelId) leaveHotelDetail();
    showLoading();
    showSkeletonLoader();
    setBreadcrumb([{ label: t('japan'), onclick: 'showJapanPage()' }, { label: `🚉 ${esc(displayName)} 周辺` }]);
    setTitle(`${displayName} 周辺のホテル`);
    setBackBtn(true);
    pageStack.push(showJapanPage);
    document.getElementById('area-button-container').innerHTML = '';

    try {
        const rawHotels = await queryHotelsAPI({ station: name, limit: 50 });
        const hotels = await fetchHotelsWithSummary(rawHotels);
        sortHotelsByReviews(hotels);
        renderHotelCards(hotels);
        setResultStatus(hotels.length);

        // 駅周辺ラブホタブ表示
        showStationLovehoTabs(name, hotels);
    } catch (e) {
        /* error silenced */
    } finally {
        hideLoading();
    }
}

/** 駅検索用ラブホタブ表示 */
async function showStationLovehoTabs(stationName, hotels) {
    hideLovehoTabs();
    cachedHotelData = hotels;
    cachedLovehoData = null;
    _tabFilterObj = null;
    _tabCity = null;
    _tabCityKey = 'station|||' + stationName;
    _stationForLoveho = stationName;

    // 駅名でラブホ件数を取得
    const lovehoHotels = await queryHotelsAPI({ station: stationName, type: 'loveho', cols: 'id', limit: 50 });
    const lovehoCount = lovehoHotels ? lovehoHotels.length : 0;

    const tabsDiv = document.createElement('div');
    tabsDiv.id = 'hotel-loveho-tabs';
    tabsDiv.style.cssText = 'display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid #ddd;max-width:640px;margin-left:auto;margin-right:auto;padding:0 16px;';
    const lovehoTab = lovehoCount
        ? `<button class="hotel-tab detail-tab detail-tab--inactive" data-tab="loveho" onclick="switchTab('loveho')">🏩 ラブホ (<span id="loveho-count">${lovehoCount}</span>)</button>`
        : '';
    tabsDiv.innerHTML = `
        <button class="hotel-tab detail-tab detail-tab--active" data-tab="hotel" onclick="switchTab('hotel')">🏨 ホテル (<span id="hotel-count">${hotels.length}</span>)</button>
        ${lovehoTab}
        <button id="btn-map-toggle" class="btn-map-toggle" onclick="toggleMapView()"><span class="btn-location-icon">🗺️</span><span class="btn-location-label">地図で見る</span></button>
    `;
    const hotelList = document.getElementById('hotel-list');
    hotelList.parentNode.insertBefore(tabsDiv, hotelList);
}

let _stationForLoveho = null;

// サジェスト外クリックで閉じる
document.addEventListener('click', (e) => {
    const box = document.getElementById('station-suggest');
    if (box && !e.target.closest('.station-search-wrapper')) {
        box.innerHTML = '';
        box.style.display = 'none';
    }
});

// ==========================================================================
// キーワード検索（Enter/検索ボタンで実行）
// ==========================================================================
let _isComposing = false; // IME変換中フラグ
document.addEventListener('compositionstart', () => { _isComposing = true; });
document.addEventListener('compositionend', () => { _isComposing = false; });

// ✕ボタン表示切替（入力中に動かす）
document.addEventListener('input', (e) => {
    if (e.target.id === 'keyword') {
        const v = e.target.value.trim();
        document.getElementById('search-clear-btn').style.display = v ? 'block' : 'none';
    }
});

// Enterキーまたはスマホ検索ボタンで検索実行
document.addEventListener('keydown', (e) => {
    if (e.target.id !== 'keyword') return;
    if (e.key !== 'Enter') return;
    if (_isComposing) return; // IME変換確定のEnterはスキップ
    e.preventDefault();
    executeKeywordSearch();
});

async function executeKeywordSearch() {
    const keyword = document.getElementById('keyword')?.value?.trim() || '';
    if (!keyword) return;

    // ホテル詳細が開いていれば閉じる
    if (currentHotelId) leaveHotelDetail();
    // キーボードを閉じる（スマホ）
    document.getElementById('keyword')?.blur();
    showLoading();
    showSkeletonLoader();
    setBreadcrumb([{ label: t('japan'), onclick: 'showJapanPage()' }, { label: `「${keyword}」の検索結果` }]);
    setTitle(`「${keyword}」の検索結果`);
    setBackBtn(true);
    pageStack.push(showJapanPage);
    document.getElementById('area-button-container').innerHTML = '';
    window.scrollTo(0, 0);

    try {
        // ハイブリッド検索（Pagefind+Fuse.js）、フォールバック: PHP API
        let rawHotels = await fuseSearch(keyword, 50);
        if (rawHotels === null) rawHotels = await queryHotelsAPI({ keyword, type: 'all', limit: 50 });
        const hotels = await fetchHotelsWithSummary(rawHotels);

        // ホテル/ラブホに分離
        const isLoveho = h => h.hotel_type === 'love_hotel' || h.hotel_type === 'rental_room';
        const hotelResults = hotels.filter(h => !isLoveho(h));
        const lovehoResults = hotels.filter(h => isLoveho(h));

        // タブ表示
        hideLovehoTabs();
        _keywordHotelCache = hotelResults;
        _keywordLovehoCache = lovehoResults;
        const tabsDiv = document.createElement('div');
        tabsDiv.id = 'hotel-loveho-tabs';
        tabsDiv.style.cssText = 'display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid #ddd;max-width:640px;margin-left:auto;margin-right:auto;padding:0 16px;';
        const lovehoTab = lovehoResults.length
            ? `<button class="hotel-tab detail-tab detail-tab--inactive" data-tab="loveho" onclick="switchKeywordTab('loveho')">🏩 ラブホ (${lovehoResults.length})</button>`
            : '';
        tabsDiv.innerHTML = `
            <button class="hotel-tab detail-tab detail-tab--active" data-tab="hotel" onclick="switchKeywordTab('hotel')">🏨 ホテル (${hotelResults.length})</button>
            ${lovehoTab}
        `;
        const hotelList = document.getElementById('hotel-list');
        hotelList.parentNode.insertBefore(tabsDiv, hotelList);

        renderHotelCards(hotelResults);
        setResultStatus(hotelResults.length);
    } catch (e) {
        /* error silenced */
    } finally {
        hideLoading();
    }
}

// キーワード検索タブ切り替え
let _keywordHotelCache = [];
let _keywordLovehoCache = [];
function switchKeywordTab(tab) {
    const tabs = document.querySelectorAll('#hotel-loveho-tabs .hotel-tab');
    tabs.forEach(t => {
        t.classList.toggle('detail-tab--active', t.dataset.tab === tab);
        t.classList.toggle('detail-tab--inactive', t.dataset.tab !== tab);
    });
    const data = tab === 'loveho' ? _keywordLovehoCache : _keywordHotelCache;
    renderHotelCards(data);
    setResultStatus(data.length);
}

// 後方互換（名前だけ残す。inputイベント委譲から呼ばれても何もしない）
function fetchHotelsFromSearch() { /* Enter方式に移行済み */ }

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

    // Load Leaflet CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    // Load GestureHandling CSS
    const ghLink = document.createElement('link');
    ghLink.rel = 'stylesheet';
    ghLink.href = 'https://unpkg.com/leaflet-gesture-handling@latest/dist/leaflet-gesture-handling.min.css';
    document.head.appendChild(ghLink);

    // Load Leaflet JS → then GestureHandling JS
    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = () => {
            // Load GestureHandling plugin
            const ghScript = document.createElement('script');
            ghScript.src = 'https://unpkg.com/leaflet-gesture-handling@latest/dist/leaflet-gesture-handling.min.js';
            ghScript.onload = () => { _leafletLoaded = true; _leafletLoading = false; resolve(true); };
            ghScript.onerror = () => { _leafletLoaded = true; _leafletLoading = false; resolve(true); }; // プラグイン失敗でもLeafletは使える
            document.head.appendChild(ghScript);
        };
        script.onerror = () => { _leafletLoading = false; resolve(false); };
        document.head.appendChild(script);
    });
}

function syncTabState(source) {
    // 上下タブの見た目を同期
    const other = source.id === 'hotel-loveho-tabs' ? document.getElementById('hotel-loveho-tabs-bottom') : document.getElementById('hotel-loveho-tabs');
    if (!other) return;
    other.querySelectorAll('[data-tab]').forEach(btn => {
        const src = source.querySelector(`[data-tab="${btn.dataset.tab}"]`);
        if (src) { btn.className = src.className; }
    });
    // 地図/リストボタンも同期
    const srcMap = source.querySelector('.btn-map-toggle');
    const otherMap = other.querySelector('.btn-map-toggle');
    if (srcMap && otherMap) {
        otherMap.className = srcMap.className;
        otherMap.querySelector('.btn-location-icon').textContent = srcMap.querySelector('.btn-location-icon').textContent;
        otherMap.querySelector('.btn-location-label').textContent = srcMap.querySelector('.btn-location-label').textContent;
    }
}

async function toggleMapView() {
    const mapEl = document.getElementById('hotel-map');
    const btn = document.getElementById('btn-map-toggle');
    const tabs = document.getElementById('hotel-loveho-tabs');
    if (mapEl.style.display === 'none') {
        mapEl.style.display = 'block';
        // 上下両方のボタンを更新
        document.querySelectorAll('.btn-map-toggle').forEach(b => {
            const i = b.querySelector('.btn-location-icon'); if (i) i.textContent = '📋';
            const l = b.querySelector('.btn-location-label'); if (l) l.textContent = 'リストで見る';
            b.classList.add('active');
        });
        // タブを地図の直前に移動
        if (tabs) mapEl.parentNode.insertBefore(tabs, mapEl);
        // 下側タブを地図の直後に追加
        let bottomTabs = document.getElementById('hotel-loveho-tabs-bottom');
        if (!bottomTabs) {
            bottomTabs = tabs.cloneNode(true);
            bottomTabs.id = 'hotel-loveho-tabs-bottom';
            // クローンのボタンにもイベントを設定
            bottomTabs.querySelectorAll('[data-tab]').forEach(b => {
                b.onclick = () => { switchTab(b.dataset.tab); syncTabState(bottomTabs); };
            });
            const mapBtn = bottomTabs.querySelector('.btn-map-toggle');
            if (mapBtn) { mapBtn.id = ''; mapBtn.onclick = () => { toggleMapView(); }; }
        }
        mapEl.parentNode.insertBefore(bottomTabs, mapEl.nextSibling);
        bottomTabs.style.display = 'flex';
        await showMap();
    } else {
        mapEl.style.display = 'none';
        // 上下両方のボタンを更新
        document.querySelectorAll('.btn-map-toggle').forEach(b => {
            const i = b.querySelector('.btn-location-icon'); if (i) i.textContent = '🗺️';
            const l = b.querySelector('.btn-location-label'); if (l) l.textContent = '地図で見る';
            b.classList.remove('active');
        });
        // 下側タブを非表示
        const bottomTabs = document.getElementById('hotel-loveho-tabs-bottom');
        if (bottomTabs) bottomTabs.style.display = 'none';
        // タブをホテルリストの直前に戻す
        const hotelList = document.getElementById('hotel-list');
        if (tabs && hotelList) hotelList.parentNode.insertBefore(tabs, hotelList);
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
            bounceAtZoomLimits: true,
            scrollWheelZoom: 'center',
            wheelDebounceTime: 200,
            wheelPxPerZoomLevel: 120,
            zoomSnap: 0.5,
            zoomDelta: 0.5,
            gestureHandling: true
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

        const stationHTML = h.nearest_station
            ? `<div class="hotel-info-row"><span class="hotel-info-icon">🚉</span><span class="hotel-info-text">${esc(h.nearest_station)}</span></div>`
            : '';


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
                <div class="hotel-info-row" style="justify-content:space-between;flex-wrap:wrap;">
                    <div style="display:flex;align-items:flex-start;gap:4px;flex:1;min-width:0;">
                        <span class="hotel-info-icon">📍</span>
                        <span class="hotel-info-text">${esc(h.address || '')}</span>
                    </div>
                    ${h.tel ? '<span style="font-size:11px;color:var(--text-3);white-space:nowrap;margin-left:8px;">📞 ' + esc(h.tel) + '</span>' : ''}
                </div>
                ${stationHTML}

                <!-- 投稿サマリー -->
                ${reportAreaHTML}

                <!-- フッター -->
                <div class="hotel-card-footer card-footer" style="padding-top:8px;">
                    <button onclick="event.stopPropagation();openHotelDetail(${h.id})" class="card-action-btn card-action-btn--h-primary" style="letter-spacing:0.03em;text-shadow:0 1px 2px rgba(0,0,0,0.18);">✨ 今すぐCHECK！${reviewCount > 0 ? ` <span style="display:inline-flex;align-items:center;background:rgba(255,255,255,0.35);border-radius:10px;padding:2px 8px;margin-left:4px;font-size:12px;text-shadow:none;">💬${reviewCount}</span>` : ''}</button>
                    <button onclick="event.stopPropagation();openHotelDetail(${h.id})" class="card-action-btn card-action-btn--h-secondary" style="letter-spacing:0.03em;overflow:hidden;text-overflow:ellipsis;">📝 口コミを投稿</button>
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
            <div id="load-more-container" class="load-more-wrap">
                <button id="load-more-btn" onclick="loadMoreHotels()" class="load-more-btn load-more-btn--hotel">もっと見る（残り${remaining}件）</button>
            </div>
        `);
    }

    const shopRegLink = SHOP_ID ? '' : '<a href="/shop-register.html?genre=' + (typeof MODE !== 'undefined' ? MODE : 'men') + '" class="info-link-pill">🏪 店舗様・掲載用はこちら</a>';
    container.insertAdjacentHTML('beforeend', `
        <div class="info-links-bar">
            <a href="#" onclick="openHotelRequestModal();return false;" class="info-link-pill">📝 未掲載ホテル情報提供</a>
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
    hotelFormState = { can_call: null, conditions: new Set(), time_slot: '', can_call_reasons: new Set(), cannot_call_reasons: new Set(), comment: '', poster_name: '', room_type: '', multi_person: false, multi_fee: false, guest_male: 1, guest_female: 1 };

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
    content.innerHTML = `<div class="detail-loading">読み込み中...</div>`;

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


// ==========================================================================
// 詳細ページ共通骨組み
// ==========================================================================
function renderDetailPage(hotel, isLoveho, sections) {
    updatePageTitle(hotel.name + (isLoveho ? ' - ラブホ口コミ' : ' - 口コミ・対応情報'));
    const googleSearch = `https://www.google.com/search?q=${encodeURIComponent(hotel.name)}`;
    const googleMap = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hotel.address || hotel.name)}`;
    const modeParam = typeof MODE !== 'undefined' ? MODE : 'men';

    getDetailContainer().innerHTML = `
    <div class="detail-wrap">
        <div class="detail-header-row">
            <h2 class="detail-title">
                <a href="${googleSearch}" target="${_extTarget}" rel="noopener">
                    ${esc(hotel.name)} ${isLoveho ? '<span style="font-size:14px;">🏩</span>' : ''} <span style="font-size:12px;color:#999;">🔍</span>
                </a>
            </h2>
        </div>
        <div class="detail-info-box">
            <div class="detail-info-inner">
                <span class="detail-info-addr">${hotel.address ? '<a href="' + googleMap + '" target="' + _extTarget + '" rel="noopener">📍 ' + esc(hotel.address) + '</a>' : ''}</span>
                ${hotel.tel ? '<span class="detail-info-tel">📞 ' + esc(hotel.tel) + '</span>' : ''}
            </div>
            ${(hotel.nearest_station || hotel.prefecture) ? `<div class="detail-info-sub">
                ${hotel.nearest_station ? `<span class="text-sub">🚉 ${esc(hotel.nearest_station)}</span>` : '<span></span>'}
                ${hotel.prefecture ? `<span class="text-sub2">📌 ${esc(hotel.major_area || hotel.prefecture)}</span>` : ''}
            </div>` : ''}
        </div>
        <div id="detail-ad-slot"></div>
        ${sections.statsHTML || ''}
        ${sections.shopSection || ''}
        ${sections.userSection || ''}
        <div id="detail-ad-area-slot"></div>
        ${sections.formHTML || ''}
        <div id="detail-ad-pref-slot"></div>
        <div class="info-links-bar">
            <a href="#" onclick="openHotelRequestModal();return false;" class="info-link-pill">📝 未掲載ホテル情報提供</a>
            <a href="/shop-register.html?genre=${modeParam}" class="info-link-pill">🏪 店舗様・掲載用はこちら</a>
        </div>
    </div>`;
}

// ==========================================================================
// ホテル詳細セクション生成 → renderDetailPage に委譲
// ==========================================================================
function renderHotelDetail(hotel, reports, summary, shopInfoMap, shopFeeMap) {
    shopInfoMap = shopInfoMap || {};
    shopFeeMap = shopFeeMap || {};

    function buildReportCard(r) {
        const entryTags = [
            ...(r.can_call ? (r.can_call_reasons||[]) : (r.cannot_call_reasons||[])),
            ...(r.conditions||[])
        ];
        const tagCls = r.can_call ? 'tag-chip--can' : 'tag-chip--ng';
        const tagsHTML = entryTags.map(t =>
            `<span class="tag-chip ${tagCls}">${esc(t)}</span>`
        ).join('');
        const multiFeeTag = r.multi_fee ? ' <span style="color:#c9a96e;font-size:10px;">💰追加料金あり</span>' : '';
        const guestChip = r.multi_person
            ? `<span class="tag-chip tag-chip--guest">👥 複数人利用OK${r.guest_male||r.guest_female ? `<span style="color:var(--text-3);margin-left:3px;">（${r.guest_male?`男性${r.guest_male}名`:''}${r.guest_male&&r.guest_female?'・':''}${r.guest_female?`女性${r.guest_female}名`:''}）</span>`:''}${multiFeeTag}</span>`
            : (r.guest_female != null && r.guest_female > 0)
            ? `<span class="tag-chip tag-chip--guest">👥 男性${r.guest_male}名・女性${r.guest_female}名</span>`
            : '';
        const metaChips = [
            r.time_slot  ? `<span class="tag-chip tag-chip--time">🕐${esc(r.time_slot)}</span>` : '',
            r.room_type  ? `<span class="tag-chip tag-chip--room">🛏${esc(r.room_type)}</span>` : '',
            guestChip,
        ].join('');
        const isShop = r.poster_type === 'shop';
        const feeLabel = isShop ? formatTransportFee(shopFeeMap[r.poster_name]) : null;
        const posterHTML = r.poster_name ? (()=>{
            const gm=r.gender_mode;const icon=gm==='women'?'♀':gm==='men_same'?'♂♂':gm==='women_same'?'♀♀':gm==='este'?'💆‍♂️':'♂';const col=gm==='women'?'#c47a88':gm==='men_same'?'#2c5282':gm==='women_same'?'#8264b4':gm==='este'?'#2aa8b8':'#4a7ab0';
            const si=isShop?shopInfoMap[r.poster_name]:null;
            if(isShop&&si&&si.status&&si.status!=='active'){return`<span style="font-size:10px;color:var(--text-3);">${icon} 🏢 店舗提供情報</span>`;}
            const badge = si?.isPaid ? `<span class="shop-premium-badge">認定店舗</span>` : `<span class="shop-verified-badge">認証店舗</span>`;
            if(isShop&&si&&si.status==='active'&&si.isPaid&&si.shop_url){return`<a href="${esc(si.shop_url)}" target="${_extTarget}" rel="noopener" style="font-size:10px;color:${col};font-weight:700;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'" onclick="event.stopPropagation()">${icon} ${esc(r.poster_name)} 🔗</a> ${badge}`;}
            if(isShop&&si&&si.status==='active'){return`<span style="font-size:10px;color:${col};font-weight:600;">${icon} ${esc(r.poster_name)}</span> ${badge}`;}
            return`<span style="font-size:10px;color:${col};font-weight:600;">${icon} ${esc(r.poster_name)}</span>`;
        })() : '';
        const feeHTML = feeLabel ? `<span class="fee-badge">🚕 交通費: ${feeLabel}</span>` : '';
        const flagHTML = r.id ? `<button onclick="showFlagModal('${r.id}')" class="report-flag-btn">🚩 報告</button>` : '';
        const badgeCls = r.can_call ? (r.poster_type === 'shop' ? 'round-badge--shop-can' : 'round-badge--user-can') : (r.poster_type === 'shop' ? 'round-badge--shop-ng' : 'round-badge--user-ng');

        return `
        <div class="review-card review-card--compact">
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                <span style="font-size:11px;font-weight:700;color:var(--text-3);white-space:nowrap;">${formatDate(r.created_at)}</span>
                <span class="round-badge ${badgeCls}">
                    ${r.poster_type === 'shop' ? (r.can_call ? '✅ ご案内実績あり' : '❌ ご案内不可') : (r.can_call ? '✅ ' + t('can_call') : '❌ ' + t('cannot_call'))}
                </span>
                ${tagsHTML}
                ${metaChips}
            </div>
            ${(posterHTML || feeHTML) ? `<div style="display:flex;align-items:center;gap:12px;margin-top:6px;flex-wrap:wrap;">${posterHTML}${feeHTML}</div>` : ''}
            ${r.comment ? `<div class="text-comment--sm" style="margin-top:6px;">${esc(r.comment)}</div>` : ''}
            ${flagHTML ? `<div style="text-align:right;margin-top:4px;">${flagHTML}</div>` : ''}
        </div>`;
    }

    const userReports = reports.filter(r => r.poster_type !== 'shop');
    const userCanCall = userReports.filter(r => r.can_call).length;
    const userPct = userReports.length > 0 ? Math.round(userCanCall / userReports.length * 100) : null;
    const shopReports = reports.filter(r => r.poster_type === 'shop' && r.gender_mode === MODE);
    shopReports.sort((a, b) => {
        const priceA = shopInfoMap[a.poster_name]?.planPrice || 0;
        const priceB = shopInfoMap[b.poster_name]?.planPrice || 0;
        if (priceB !== priceA) return priceB - priceA;
        return shopSortDate(b) - shopSortDate(a);
    });
    const shopCanCall = shopReports.filter(r => r.can_call).length;
    const shopPct = shopReports.length > 0 ? Math.round(shopCanCall / shopReports.length * 100) : null;
    const noReports = `<div style="text-align:center;padding:16px 0;color:var(--text-3);font-size:12px;">まだ投稿がありません</div>`;

    // 店舗フィルタータブ
    window._shopReports = shopReports;
    window._buildReportCard = buildReportCard;
    const shopCanCount = shopReports.filter(r => r.can_call).length;
    const shopNgCount = shopReports.filter(r => !r.can_call).length;
    const shopFilterTabs = (shopReports.length > 1 && shopCanCount > 0 && shopNgCount > 0) ? `
                <button onclick="filterShopReports('all')" class="sr-tab sr-tab-active filter-tab" data-filter="all" style="border-color:rgba(201,168,76,0.4);background:rgba(201,168,76,0.12);color:#7a5c10;">全て</button>
                <button onclick="filterShopReports('can')" class="sr-tab filter-tab" data-filter="can" style="border-color:rgba(58,154,96,0.25);color:#3a9a60;">✅ 案内可 ${shopCanCount}</button>
                <button onclick="filterShopReports('ng')" class="sr-tab filter-tab" data-filter="ng" style="border-color:rgba(192,80,80,0.25);color:#c05050;">❌ 案内不可 ${shopNgCount}</button>` : '';

    const shopSection = shopReports.length === 0 ? '' : `
        <div class="section-official">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;border-bottom:1px solid rgba(201,168,76,0.3);padding-bottom:8px;">
                <span class="section-label section-label--official">✅ 店舗公式情報 (${shopReports.length})</span>
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
                <button onclick="filterUserReports('all')" class="ur-tab ur-tab-active filter-tab" data-filter="all" style="background:var(--accent-bg);color:var(--accent);">全て</button>
                ${canCount ? `<button onclick="filterUserReports('can')" class="ur-tab filter-tab" data-filter="can" style="border-color:rgba(33,150,243,0.25);color:#1976d2;">✅ 呼べた ${canCount}</button>` : ''}
                ${ngCount ? `<button onclick="filterUserReports('ng')" class="ur-tab filter-tab" data-filter="ng" style="border-color:rgba(192,80,80,0.25);color:#c05050;">❌ 呼べない ${ngCount}</button>` : ''}
            ` : ''}
        </div>
        <div id="user-reports-list">${userReports.length > 0 ? scrollableSection(userReports, buildReportCard) : noReports}</div>`;



    // 統計HTML
    const statsHTML = (shopPct !== null ? `
        <div style="margin-bottom:12px;">
            <div class="stat-heading">🏪 店舗実績（${shopReports.length}件）</div>
            <div class="progress-bar">
                <div style="width:${shopPct}%;background:#3a9a60;"></div>
                <div style="width:${100-shopPct}%;background:#c05050;"></div>
            </div>
            <div class="stat-legend">
                <span class="stat-legend-item"><span class="stat-legend-dot" style="background:#3a9a60;"></span>ご案内実績あり ${shopPct}%</span>
                <span class="stat-legend-item"><span class="stat-legend-dot" style="background:#c05050;"></span>ご案内不可 ${100-shopPct}%</span>
            </div>
        </div>` : '')
        + (userPct !== null ? `
        <div style="margin-bottom:12px;">
            <div class="stat-heading">📊 呼べる？（${userReports.length}件）</div>
            <div class="progress-bar">
                <div style="width:${userPct}%;background:#2196f3;"></div>
                <div style="width:${100-userPct}%;background:#c05050;"></div>
            </div>
            <div class="stat-legend">
                <span class="stat-legend-item"><span class="stat-legend-dot" style="background:#2196f3;"></span>${t('can_call')} ${userPct}%</span>
                <span class="stat-legend-item"><span class="stat-legend-dot" style="background:#c05050;"></span>${t('cannot_call')} ${100-userPct}%</span>
            </div>
        </div>` : '');

    // フォームHTML
    const castLabel = (typeof MODE !== 'undefined' ? MODE : 'men') === 'women' ? 'セラピスト' : 'キャスト';
    const formHTML = `
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
                <input type="text" id="form-poster-name" placeholder="未入力の場合は「匿名希望」で表示されます" oninput="hotelFormState.poster_name=this.value" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:var(--bg-3);outline:none;color:var(--text-2);box-sizing:border-box;">
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
                        <input type="checkbox" id="form-multi-person" onchange="hotelToggleMultiPerson(this.checked)" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent);">
                        3P・4P…複数人で利用OK（任意）
                    </label>
                    <div id="form-multi-person-section" style="display:none;margin-top:10px;padding:10px 12px;background:var(--bg-3);border:1px solid var(--border);border-radius:8px;">
                        <div style="display:flex;gap:16px;">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span style="font-size:12px;color:var(--text-2);width:40px;">男性</span>
                                <button type="button" onclick="hotelStepGuest('male',-1)" style="width:30px;height:30px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text-2);font-size:16px;cursor:pointer;font-family:inherit;line-height:1;display:flex;align-items:center;justify-content:center;">－</button>
                                <span id="form-guest-male" style="width:20px;text-align:center;font-size:14px;font-weight:600;color:var(--text);">1</span>
                                <button type="button" onclick="hotelStepGuest('male',1)" style="width:30px;height:30px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text-2);font-size:16px;cursor:pointer;font-family:inherit;line-height:1;display:flex;align-items:center;justify-content:center;">＋</button>
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span style="font-size:12px;color:var(--text-2);width:40px;">女性</span>
                                <button type="button" onclick="hotelStepGuest('female',-1)" style="width:30px;height:30px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text-2);font-size:16px;cursor:pointer;font-family:inherit;line-height:1;display:flex;align-items:center;justify-content:center;">－</button>
                                <span id="form-guest-female" style="width:20px;text-align:center;font-size:14px;font-weight:600;color:var(--text);">1</span>
                                <button type="button" onclick="hotelStepGuest('female',1)" style="width:30px;height:30px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text-2);font-size:16px;cursor:pointer;font-family:inherit;line-height:1;display:flex;align-items:center;justify-content:center;">＋</button>
                            </div>
                        </div>
                        <label style="display:inline-flex;align-items:center;gap:4px;margin-top:8px;font-size:12px;color:var(--text-2);cursor:pointer;"><input type="checkbox" id="form-multi-fee-top" onchange="hotelFormState.multi_fee=this.checked" style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer;">追加料金あり</label>
                    </div>
                </div>
            </div>
            <div class="form-group">
                <div style="display:flex;gap:10px;">
                    <div style="flex:1;min-width:0;">
                        <label class="form-label" style="margin-bottom:6px;display:block;">時間帯 <span style="color:var(--text-3);font-weight:400;">(任意)</span></label>
                        <select id="form-time-slot" onchange="hotelFormState.time_slot=this.value" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:var(--bg-3);outline:none;color:var(--text-2);appearance:none;">
                            <option value="">未選択</option><option value="早朝 (5:00~8:00)">早朝 (5:00~8:00)</option><option value="朝 (8:00~11:00)">朝 (8:00~11:00)</option><option value="昼 (11:00~16:00)">昼 (11:00~16:00)</option><option value="夕方 (16:00~18:00)">夕方 (16:00~18:00)</option><option value="夜 (18:00~23:00)">夜 (18:00~23:00)</option><option value="深夜 (23:00~5:00)">深夜 (23:00~5:00)</option>
                        </select>
                    </div>
                    <div style="flex:1;min-width:0;">
                        <label class="form-label" style="margin-bottom:6px;display:block;">部屋タイプ <span style="color:var(--text-3);font-weight:400;">(任意)</span></label>
                        <select id="form-room-type" onchange="hotelFormState.room_type=this.value" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:var(--bg-3);outline:none;color:var(--text-2);appearance:none;">
                            <option value="">未選択</option>${ROOM_TYPES.map(r => `<option value="${r}">${r}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </div>
            <div style="margin-bottom:14px;">
                <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;user-select:none;">
                    <input type="checkbox" id="multi-person-check" onchange="hotelFormState.multi_person=this.checked; document.getElementById('multi-person-detail').style.display=this.checked?'flex':'none';" style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer;">
                    <span style="font-size:13px;color:var(--text-2);">👥 3P・4P…複数人で利用OK（任意）</span>
                </label>
                <div id="multi-person-detail" style="display:none;flex-direction:column;gap:8px;margin-top:8px;">
                    <div style="display:flex;gap:8px;">
                        <span style="font-size:13px;color:var(--text-2);min-width:32px;">男性</span><select onchange="hotelFormState.guest_male=parseInt(this.value)||1" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;font-family:inherit;"><option value="">-</option><option value="1">1名</option><option value="2">2名</option><option value="3">3名</option><option value="4">4名</option></select>
                        <span style="font-size:13px;color:var(--text-2);min-width:32px;">女性</span><select onchange="hotelFormState.guest_female=parseInt(this.value)||0" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;font-family:inherit;"><option value="">-</option><option value="1">1名</option><option value="2">2名</option><option value="3">3名</option><option value="4">4名</option></select>
                    </div>
                    <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--text-2);cursor:pointer;"><input type="checkbox" id="multi-person-fee" onchange="hotelFormState.multi_fee=this.checked" style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer;">追加料金あり</label>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">コメント <span style="color:var(--text-3);font-weight:400;">（任意）</span></label>
                <textarea class="form-textarea" id="form-comment" maxlength="500" placeholder="状況や注意点など自由に記入してください..." oninput="hotelFormState.comment=this.value"></textarea>
                <div style="font-size:11px;color:var(--text-3);margin-top:6px;line-height:1.7;">※お店名・${castLabel}情報・ホテルの批判・URL・電話番号を含む投稿は非表示となります</div>
            </div>
            <button class="btn-submit" id="btn-submit" onclick="hotelSubmitReport()">確認画面に進む</button>
        </div>`;

    renderDetailPage(hotel, false, { statsHTML, shopSection, userSection: userReportsHTML, formHTML });
}

// ==========================================================================
// エリア店舗セクション表示
// ==========================================================================
// フィルタータブ切替
const _filterEmptyMsg = '<div style="text-align:center;padding:16px 0;color:var(--text-3);font-size:12px;">該当する投稿がありません</div>';
function filterUserReports(filter) {
    const items = window._userReports || [];
    const buildFn = window._buildReportCard;
    const filtered = filter === 'can' ? items.filter(r => r.can_call) : filter === 'ng' ? items.filter(r => !r.can_call) : items;
    document.getElementById('user-reports-list').innerHTML = scrollableSection(filtered, buildFn, _filterEmptyMsg);
    document.querySelectorAll('.ur-tab').forEach(t => {
        if (t.dataset.filter === filter) { t.style.background = 'var(--accent-bg)'; t.style.color = 'var(--accent)'; }
        else { t.style.background = 'transparent'; t.style.color = t.dataset.filter === 'can' ? '#1976d2' : t.dataset.filter === 'ng' ? '#c05050' : 'var(--text-3)'; }
    });
}
function filterShopReports(filter) {
    const items = window._shopReports || [];
    const buildFn = window._buildReportCard;
    const filtered = filter === 'can' ? items.filter(r => r.can_call) : filter === 'ng' ? items.filter(r => !r.can_call) : items;
    document.getElementById('shop-reports-list').innerHTML = scrollableSection(filtered, buildFn, _filterEmptyMsg);
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
    document.getElementById('lh-user-reports-list').innerHTML = scrollableSection(filtered, buildFn, _filterEmptyMsg);
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
        return `<div class="shop-ad-card">
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

    // 店舗モード時は自店舗のみ表示（他店舗広告は非表示）
    // _shopParamは同期的に取得済み（SHOP_IDは非同期のためフォールバック）
    if (_shopParam && shops) {
        shops = shops.filter(s =>
            (SHOP_ID && s.id === SHOP_ID) ||
            (SHOP_SLUG && s.slug === SHOP_SLUG) ||
            s.slug === _shopParam ||
            s.id === _shopParam
        );
        if (!shops.length) return;
    }

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
