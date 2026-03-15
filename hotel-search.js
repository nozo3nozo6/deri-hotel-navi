// ==========================================================================
// hotel-search.js — ホテル検索、カード描画、ラブホタブ、詳細
// ==========================================================================

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
        let query = supabaseClient.from('hotels').select('*').eq('is_published', true).not('hotel_type','in','("love_hotel","rental_room")').limit(1000);
        Object.keys(filterObj).forEach(k => { query = query.eq(k, filterObj[k]); });
        query = query.eq('city', city);
        query = query.order('review_average', { ascending: false, nullsFirst: false });

        let hotels = await fetchHotelsWithSummary(query);
        sortHotelsByReviews(hotels);
        renderHotelCards(hotels);
        setResultStatus(hotels.length);

        _tabFilterObj = filterObj;
        _tabCity = city;

        showLovehoTabs(pref, city, hotels.length, hotels);
    } catch (e) {
        console.error(e);
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

    const { count: lovehoCount } = await supabaseClient.from('hotels')
        .select('*', { count: 'exact', head: true })
        .eq('prefecture', pref)
        .eq('city', city)
        .in('hotel_type', ['love_hotel', 'rental_room'])
        .eq('is_published', true);

    if (!lovehoCount) return;

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
    if (!_tabFilterObj || !_tabCity) { console.log('[loveho] missing filter/city, skip'); return; }
    showLoading();
    try {
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
let lhFormState = {};

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

    const gpCatMap = {};
    if (LH_MASTER.good_points) LH_MASTER.good_points.forEach(p => { gpCatMap[p.label] = p.category; });

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
            const locationLabel = cityName ? `📍 ${cityName}周辺` : '📍 現在地周辺';

            setBreadcrumb([{ label: t('japan'), onclick: 'showJapanPage()' }, { label: locationLabel }]);
            setTitle(cityName ? `${cityName}周辺のホテル` : '現在地周辺のホテル');
            setBackBtn(true);
            pageStack.push(showJapanPage);
            document.getElementById('area-button-container').innerHTML = '';

            try {
                let withDist;
                if (cityName) {
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

                const hotelIds = withDist.map(h => h.id);
                const [summaries, latestMap] = await Promise.all([
                    fetchReportSummaries(hotelIds),
                    fetchLatestReportDates(hotelIds),
                ]);
                const withSummary = withDist.map(h => ({ ...h, summary: summaries[h.id] || null, latestReportAt: latestMap[h.id] || null }));

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
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
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
// ホテルカードレンダリング
// ==========================================================================
let allHotels = [];
let unfilteredHotels = [];
let currentFilter = 'all';
let displayedCount = 0;
let showDistanceFlag = false;
const HOTELS_PER_PAGE = 20;

function getFilterLabel(type) {
    const keyMap = { all: 'filter_all', business: 'filter_business', city: 'filter_city', resort: 'filter_resort', ryokan: 'filter_ryokan', love_hotel: 'filter_loveho' };
    return t(keyMap[type] || type);
}

const FILTER_TYPE_MAP = { filter_all: 'all', filter_business: 'business', filter_city: 'city', filter_resort: 'resort', filter_ryokan: 'ryokan', filter_loveho: 'love_hotel' };

function toggleFilter(type) {
    currentFilter = type;
    document.querySelectorAll('.filter-chip').forEach(c => {
        const chipType = c.dataset.filterKey ? FILTER_TYPE_MAP[c.dataset.filterKey] : null;
        c.classList.toggle('active', chipType === type);
    });
    applyFilter();
}

function applyFilter() {
    if (!unfilteredHotels || unfilteredHotels.length === 0) return;
    const filtered = currentFilter === 'all'
        ? unfilteredHotels
        : unfilteredHotels.filter(h => h.hotel_type === currentFilter);
    allHotels = filtered;
    displayedCount = 0;
    const container = document.getElementById('hotel-list');
    container.innerHTML = '';
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-text">' + t('no_results') + '</p></div>';
    } else {
        loadMoreHotels();
    }
    setResultStatus(filtered.length);
    refreshMapIfVisible();
}

function showFilterBar() {
    const mapToggle = document.getElementById('map-toggle-bar');
    if (mapToggle) mapToggle.style.display = 'flex';
}

function hideFilterBar() {
    hideMap();
}

// ==========================================================================
// 地図表示（Leaflet）
// ==========================================================================
let mapInstance = null;
let mapMarkers = [];

function toggleMapView() {
    const mapEl = document.getElementById('hotel-map');
    const btn = document.getElementById('btn-map-toggle');
    if (mapEl.style.display === 'none') {
        mapEl.style.display = 'block';
        btn.textContent = '📋 リストで見る';
        btn.classList.add('active');
        showMap();
    } else {
        mapEl.style.display = 'none';
        btn.textContent = '🗺️ 地図で見る';
        btn.classList.remove('active');
    }
}

function showMap() {
    if (typeof L === 'undefined') {
        showToast('地図ライブラリを読み込み中です…', 2000);
        return;
    }
    // タブに応じたデータを使用
    const hotels = (currentTab === 'loveho' ? cachedLovehoData : allHotels) || [];
    const hotelsWithCoords = hotels.filter(h => h.latitude && h.longitude);

    if (!mapInstance) {
        mapInstance = L.map('hotel-map').setView([35.6762, 139.6503], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }).addTo(mapInstance);
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
        html: `<div style="width:28px;height:28px;border-radius:50%;background:${isLoveho ? '#e91e8c' : '#3388ff'};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px;">${isLoveho ? '🏩' : '🏨'}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -16]
    });

    // マーカー追加
    const bounds = [];
    hotelsWithCoords.forEach(h => {
        const marker = L.marker([h.latitude, h.longitude], { icon: markerIcon })
            .addTo(mapInstance)
            .bindPopup('<b>' + esc(h.name) + '</b><br><a href="javascript:openHotelDetail(' + h.id + ',' + isLoveho + ')">' + t('view_detail') + '</a>');
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
    const mapToggle = document.getElementById('map-toggle-bar');
    if (mapToggle) mapToggle.style.display = 'none';
    const btn = document.getElementById('btn-map-toggle');
    if (btn) {
        btn.textContent = '🗺️ 地図で見る';
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

        const rankHTML = hotelRankBadge(h.review_average);

        const reviewCount = getReportCount(h);
        if (reviewCount > 0) console.log('[renderCard]', h.name, '口コミ数:', reviewCount, 'summary:', JSON.stringify(h.summary));

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

    // フィルタ用に元データを保持
    unfilteredHotels = hotels;
    showDistanceFlag = showDistance;

    // フィルタが適用中なら絞り込む
    const filtered = currentFilter === 'all'
        ? hotels
        : hotels.filter(h => h.hotel_type === currentFilter);

    if (!filtered.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-text">${t('no_results')}</p></div>`;
        allHotels = filtered;
        displayedCount = 0;
        showFilterBar();
        return;
    }

    allHotels = filtered;
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

    const shopRegLink = SHOP_ID ? '' : '<a href="/shop-register.html" style="color:#8b5e6b; text-decoration:none; padding:6px 16px; border:1px solid #d4b8c1; border-radius:20px; background:#fdf6f8; transition:background 0.2s; font-size:12px; white-space:nowrap;">🏪 店舗様・掲載用はこちら</a>';
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

let currentHotelId = null;

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
    document.getElementById('hotel-list').style.display = 'none';
    const rs = document.getElementById('result-status');
    if (rs) rs.style.display = 'none';
    hideLovehoTabs();
    hideFilterBar();

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
        let allReports = reportsRes.data || [];
        console.log('[loadHotelDetail] SHOP_ID:', SHOP_ID, 'total reports:', allReports.length);
        if (SHOP_ID) {
            console.log('[loadHotelDetail] shop reports before filter:', allReports.filter(r => r.poster_type === 'shop').map(r => ({ shop_id: r.shop_id, poster_name: r.poster_name })));
            const shopName = SHOP_DATA?.shop_name;
            allReports = allReports.filter(r => {
                if (r.poster_type === 'shop') return r.shop_id === SHOP_ID || (shopName && r.poster_name === shopName);
                return true;
            });
            console.log('[loadHotelDetail] after filter:', allReports.length, 'reports');
        }
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
        shopInfoMap[name] = { shop_url: info.shop_url || null, isPaid: info.isPaid || false, status: info.status || null, shopId: info.shopId || null };
    });
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
            if(isShop&&si&&si.status&&si.status!=='active'){return`<span style="font-size:10px;color:var(--text-3);">${icon} 🏢 店舗提供情報</span>`;}
            if(isShop&&si&&si.status==='active'&&si.isPaid&&si.shop_url){return`<a href="${si.shop_url}" target="_blank" rel="noopener" style="font-size:10px;color:${col};font-weight:700;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'" onclick="event.stopPropagation()">${icon} ${r.poster_name} 🔗</a>`;}
            return`<span style="font-size:10px;color:${col};font-weight:600;">${icon} ${r.poster_name}</span>`;
        })() : '';
        const feeHTML = feeLabel ? `<span style="padding:2px 8px;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.3);border-radius:8px;font-size:10px;color:#9a7030;">🚕 交通費: ${feeLabel}</span>` : '';
        const flagHTML = r.id ? `<button onclick="showFlagModal('${r.id}')" style="padding:2px 7px;background:transparent;border:1px solid rgba(180,150,100,0.2);border-radius:8px;font-size:10px;color:var(--text-3);cursor:pointer;font-family:inherit;white-space:nowrap;">🚩 報告</button>` : '';

        return `
        <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:5px;">
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                <span style="font-size:11px;font-weight:700;color:var(--text-3);white-space:nowrap;">${formatDate(r.created_at)}</span>
                <span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;${r.can_call ? 'background:rgba(58,154,96,0.08);color:#3a9a60;' : 'background:rgba(192,80,80,0.08);color:#c05050;'}">
                    ${r.poster_type === 'shop' ? (r.can_call ? '✅ ご案内実績あり' : '❌ ご案内不可') : (r.can_call ? '✅ ' + t('can_call') : '❌ ' + t('cannot_call'))}
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

        <!-- ホテル名 + 参考料金 -->
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin:0 0 12px 0;">
            <h2 style="font-size:23px;font-weight:600;color:#1a1410 !important;line-height:1.4;margin:0;padding:0;flex:1;min-width:0;"><a href="https://www.google.com/search?q=${encodeURIComponent(hotel.name)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${esc(hotel.name)} <span style="font-size:12px;color:#999;">🔍</span></a></h2>
            ${hotel.min_charge ? '<span style="font-size:13px;font-weight:600;color:var(--accent-dim);white-space:nowrap;flex-shrink:0;">最安値 ¥' + parseInt(hotel.min_charge).toLocaleString() + '~</span>' : ''}
        </div>

        <!-- ホテル基本情報 -->
        <div style="background:#ffffff;border:1px solid rgba(180,140,80,0.2);border-radius:10px;padding:14px 18px;margin-bottom:12px;box-shadow:0 2px 16px rgba(0,0,0,0.06);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px;">
                <span style="font-size:13px;color:var(--text-2);line-height:1.5;flex:1;">${hotel.address ? '<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(hotel.address) + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'" onclick="event.stopPropagation()">📍 ' + esc(hotel.address) + ' <span style="font-size:12px;color:#999;">📍</span></a>' : ''}</span>
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
                <div style="width:${userPct}%;background:#3a9a60;"></div>
                <div style="width:${100-userPct}%;background:#c05050;"></div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
                <span style="font-size:11px;color:var(--text-2);"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3a9a60;margin-right:3px;"></span>${t('can_call')} ${userPct}%</span>
                <span style="font-size:11px;color:var(--text-2);"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#c05050;margin-right:3px;"></span>${t('cannot_call')} ${100-userPct}%</span>
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
        <div style="display:flex; justify-content:center; gap:16px; padding:14px 20px; margin-top:12px; background:#fff; border:1px solid #e0d5d0; border-radius:8px; font-size:13px;">
            <a href="#" onclick="openHotelRequestModal();return false;" style="color:#8b5e6b; text-decoration:none; padding:6px 16px; border:1px solid #d4b8c1; border-radius:20px; background:#fdf6f8; font-size:12px; white-space:nowrap;">📝 未掲載ホテル情報提供</a>
            <a href="/shop-register.html" style="color:#8b5e6b; text-decoration:none; padding:6px 16px; border:1px solid #d4b8c1; border-radius:20px; background:#fdf6f8; font-size:12px; white-space:nowrap;">🏪 店舗様・掲載用はこちら</a>
        </div>
    </div>`;
}
