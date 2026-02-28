// ==========================================================================
// DERI HOTEL NAVI — app.js
// ==========================================================================

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
// 多言語
// ==========================================================================
const state = { lang: 'ja' };
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
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[onclick="changeLang('${lang}')"]`)?.classList.add('active');
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
    const el = document.getElementById('breadcrumb');
    if (!el) return;
    el.innerHTML = crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return `
            ${i > 0 ? '<span class="breadcrumb-sep">›</span>' : ''}
            <span class="breadcrumb-item ${isLast ? 'active' : ''}"
                  ${!isLast && c.onclick ? `style="cursor:pointer" onclick="${c.onclick}"` : ''}>
                ${c.label}
            </span>`;
    }).join('');
}

function clearHotelList() {
    const el = document.getElementById('hotel-list');
    if (el) el.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">🗾</div>
            <p class="empty-text">${t('list_placeholder')}</p>
        </div>`;
    const s = document.getElementById('result-status');
    if (s) s.style.display = 'none';
}

function showToast(msg, duration = 2500) {
    let el = document.getElementById('toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%) translateY(-12px);background:#1a1410;color:#fff;padding:12px 24px;border-radius:30px;font-size:13px;opacity:0;transition:all 0.3s;z-index:9999;white-space:nowrap;pointer-events:none;';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(-12px)';
    }, duration);
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
    try {
        const { data, error } = await supabaseClient
            .from('hotel_report_summary')
            .select('*')
            .in('hotel_id', hotelIds);
        if (error) return {};
        // hotel_id をキーにしたマップを返す
        const map = {};
        (data || []).forEach(r => { map[r.hotel_id] = r; });
        return map;
    } catch {
        return {};
    }
}

// ==========================================================================
// ページ描画
// ==========================================================================
function showJapanPage() {
    pageStack = [];
    currentPage = showJapanPage;
    setTitle(t('select_area'));
    setBackBtn(false);
    setBreadcrumb([{ label: t('japan') }]);
    clearHotelList();

    const container = document.getElementById('area-button-container');
    container.innerHTML = '';
    container.className = 'area-grid region-level';

    REGION_MAP.forEach((region, i) => {
        const btn = document.createElement('button');
        btn.className = 'area-btn has-children';
        btn.style.animationDelay = `${i * 0.04}s`;
        btn.textContent = region.label;
        btn.onclick = () => {
            pageStack.push(showJapanPage);
            showPrefPage(region);
        };
        container.appendChild(btn);
    });
}

async function showPrefPage(region) {
    currentPage = () => showPrefPage(region);
    setTitle(region.label);
    setBackBtn(true);
    setBreadcrumb([
        { label: t('japan'), onclick: 'showJapanPage()' },
        { label: region.label }
    ]);
    clearHotelList();

    const container = document.getElementById('area-button-container');
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);font-size:13px;">読み込み中...</div>`;
    container.className = 'area-grid col-2';

    // 都道府県ごとのホテル数を並行取得（全件）して多い順にソート
    const prefCountResults = await Promise.all(
        region.prefs.map(pref =>
            supabaseClient.from('hotels').select('id', { count: 'exact', head: true }).eq('prefecture', pref)
                .then(({ count }) => ({ pref, count: count || 0 }))
        )
    );
    const sorted = prefCountResults
        .filter(r => r.count > 0)
        .sort((a, b) => b.count - a.count)
        .map(r => r.pref);

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
}

async function showMajorAreaPage(region, pref) {
    currentPage = () => showMajorAreaPage(region, pref);
    setTitle(pref);
    setBackBtn(true);
    setBreadcrumb([
        { label: t('japan'), onclick: 'showJapanPage()' },
        { label: region.label, onclick: `showPrefPage(REGION_MAP.find(r=>r.label==='${region.label}'))` },
        { label: pref }
    ]);
    clearHotelList();

    const container = document.getElementById('area-button-container');
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);font-size:13px;">読み込み中...</div>`;
    container.className = 'area-grid col-2';

    // まずエリア一覧を取得（全件）
    const { data, error } = await supabaseClient.from('hotels').select('major_area').eq('prefecture', pref).limit(5000);
    if (error) { container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#c47a88;">エラー</div>`; return; }

    // エリアごとのホテル数を集計して多い順
    const areaCount = {};
    data.forEach(h => { if (h.major_area) areaCount[h.major_area] = (areaCount[h.major_area] || 0) + 1; });
    const areas = Object.keys(areaCount).sort((a, b) => areaCount[b] - areaCount[a]);
    if (!areas.length) { container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);">${t('no_data')}</div>`; return; }

    buildAreaButtons(
        areas,
        () => { pageStack.push(() => showMajorAreaPage(region, pref)); fetchAndShowHotels({ prefecture: pref }); },
        (area) => { pageStack.push(() => showMajorAreaPage(region, pref)); showCityPage(region, pref, area); }
    );
}

async function showCityPage(region, pref, majorArea) {
    currentPage = () => showCityPage(region, pref, majorArea);
    setTitle(majorArea);
    setBackBtn(true);
    setBreadcrumb([
        { label: t('japan'), onclick: 'showJapanPage()' },
        { label: region.label, onclick: `showPrefPage(REGION_MAP.find(r=>r.label==='${region.label}'))` },
        { label: pref, onclick: `showMajorAreaPage(REGION_MAP.find(r=>r.label==='${region.label}'), '${pref}')` },
        { label: majorArea }
    ]);
    clearHotelList();

    const container = document.getElementById('area-button-container');
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);font-size:13px;">読み込み中...</div>`;
    container.className = 'area-grid col-2';

    const { data, error } = await supabaseClient
        .from('hotels').select('address,city,detail_area')
        .eq('prefecture', pref).eq('major_area', majorArea);

    if (error) { container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#c47a88;">エラー</div>`; return; }

    // detail_area がある場合は detailClass 階層を先に表示
    const detailAreaCount = {};
    data.forEach(h => { if (h.detail_area) detailAreaCount[h.detail_area] = (detailAreaCount[h.detail_area] || 0) + 1; });
    const hasDetailArea = Object.keys(detailAreaCount).length > 0;

    if (hasDetailArea) {
        // detail_area ボタンを件数順に表示
        const detailAreas = Object.keys(detailAreaCount).sort((a, b) => detailAreaCount[b] - detailAreaCount[a]);
        container.innerHTML = '';
        detailAreas.forEach((area, i) => {
            const btn = document.createElement('button');
            btn.className = 'area-btn';
            btn.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
            btn.innerHTML = `<span class="city-name">${area}</span><span class="city-count">${detailAreaCount[area]}</span>`;
            btn.onclick = () => { pageStack.push(() => showCityPage(region, pref, majorArea)); showDetailAreaPage(region, pref, majorArea, area); };
            container.appendChild(btn);
        });
        const allBtn = document.createElement('button');
        allBtn.className = 'area-btn all-btn';
        allBtn.style.cssText = 'grid-column:1/-1; margin-top:8px;';
        allBtn.textContent = `▶ ${t('show_all')}`;
        allBtn.onclick = () => { pageStack.push(() => showCityPage(region, pref, majorArea)); fetchAndShowHotels({ prefecture: pref, major_area: majorArea }); };
        container.appendChild(allBtn);
        return;
    }

    // detail_area なし → 市区町村ごとの件数を集計（従来動作）
    const cityCount = {};
    data.forEach(h => {
        const city = h.city || extractCity(h.address);
        if (city) cityCount[city] = (cityCount[city] || 0) + 1;
    });

    const cities = Object.keys(cityCount).sort((a, b) => cityCount[b] - cityCount[a]);

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
            <span class="city-name">${city}</span>
            <span class="city-count">${cityCount[city]}</span>`;
        btn.onclick = () => { pageStack.push(() => showCityPage(region, pref, majorArea)); fetchAndShowHotelsByCity({ prefecture: pref, major_area: majorArea }, city); };
        container.appendChild(btn);
    });

    const allBtn = document.createElement('button');
    allBtn.className = 'area-btn all-btn';
    allBtn.style.cssText = 'grid-column:1/-1; margin-top:8px;';
    allBtn.textContent = `▶ ${t('show_all')}`;
    allBtn.onclick = () => { pageStack.push(() => showCityPage(region, pref, majorArea)); fetchAndShowHotels({ prefecture: pref, major_area: majorArea }); };
    container.appendChild(allBtn);
}

// ==========================================================================
// detail_area ページ（detailClass階層: smallClass → detailClass → city）
// ==========================================================================
async function showDetailAreaPage(region, pref, majorArea, detailArea) {
    currentPage = () => showDetailAreaPage(region, pref, majorArea, detailArea);
    setTitle(detailArea);
    setBackBtn(true);
    setBreadcrumb([
        { label: t('japan'), onclick: 'showJapanPage()' },
        { label: region.label, onclick: `showPrefPage(REGION_MAP.find(r=>r.label==='${region.label}'))` },
        { label: pref, onclick: `showMajorAreaPage(REGION_MAP.find(r=>r.label==='${region.label}'), '${pref}')` },
        { label: majorArea, onclick: `showCityPage(REGION_MAP.find(r=>r.label==='${region.label}'), '${pref}', '${majorArea}')` },
        { label: detailArea }
    ]);
    clearHotelList();

    const container = document.getElementById('area-button-container');
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);font-size:13px;">読み込み中...</div>`;
    container.className = 'area-grid col-2';

    const { data, error } = await supabaseClient
        .from('hotels').select('address,city')
        .eq('prefecture', pref).eq('major_area', majorArea).eq('detail_area', detailArea);

    if (error) { container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#c47a88;">エラー</div>`; return; }

    // 市区町村ごとの件数を集計
    const cityCount = {};
    data.forEach(h => {
        const city = h.city || extractCity(h.address);
        if (city) cityCount[city] = (cityCount[city] || 0) + 1;
    });

    const cities = Object.keys(cityCount).sort((a, b) => cityCount[b] - cityCount[a]);

    if (!cities.length) {
        fetchAndShowHotels({ prefecture: pref, major_area: majorArea, detail_area: detailArea });
        return;
    }

    container.innerHTML = '';

    cities.forEach((city, i) => {
        const btn = document.createElement('button');
        btn.className = 'area-btn';
        btn.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
        btn.innerHTML = `<span class="city-name">${city}</span><span class="city-count">${cityCount[city]}</span>`;
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
}

// ==========================================================================
// 戻るボタン
// ==========================================================================
function backLevel() {
    const prev = pageStack.pop();
    if (prev) {
        prev();
    } else {
        showJapanPage();
    }
    clearHotelList();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

    // ホテルデータに集計を合体
    return hotels.map(h => ({ ...h, summary: summaries[h.id] || null }));
}

async function fetchAndShowHotels(filterObj) {
    currentPage = () => fetchAndShowHotels(filterObj);
    showLoading();
    document.getElementById('area-button-container').innerHTML = '';

    try {
        const keyword = document.getElementById('keyword')?.value?.trim() || '';
        let query = supabaseClient.from('hotels').select('*').limit(80);
        Object.keys(filterObj).forEach(k => { query = query.eq(k, filterObj[k]); });
        query = applyKeywordFilter(query, keyword);
        query = query.order('review_average', { ascending: false, nullsFirst: false });

        const hotels = await fetchHotelsWithSummary(query);
        renderHotelCards(hotels);
        setResultStatus(hotels.length);
    } catch (e) {
        console.error(e);
    } finally {
        hideLoading();
    }
}

async function fetchAndShowHotelsByCity(filterObj, city) {
    showLoading();
    document.getElementById('area-button-container').innerHTML = '';
    setTitle(city);

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

    try {
        let query = supabaseClient.from('hotels').select('*').limit(80);
        Object.keys(filterObj).forEach(k => { query = query.eq(k, filterObj[k]); });
        query = query.eq('city', city);
        query = query.order('review_average', { ascending: false, nullsFirst: false });

        const hotels = await fetchHotelsWithSummary(query);
        const TYPE_ORDER = { business: 0, city: 1, resort: 2, other: 3, ryokan: 4, pension: 5, minshuku: 6 };
        const repCount = h => {
            const s = h.summary;
            if (!s) return 0;
            return (s.can_call_count||0) + (s.cannot_call_count||0) + (s.shop_can_count||0) + (s.shop_ng_count||0);
        };
        hotels.sort((a, b) => {
            const ca = repCount(a), cb = repCount(b);
            if (ca !== cb) return cb - ca;  // 投稿数多い順
            const oa = TYPE_ORDER[a.hotel_type ?? 'other'] ?? 3;
            const ob = TYPE_ORDER[b.hotel_type ?? 'other'] ?? 3;
            return oa - ob;
        });
        renderHotelCards(hotels);
        setResultStatus(hotels.length);
    } catch (e) {
        console.error(e);
    } finally {
        hideLoading();
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
                        .ilike('city', `%${cityName}%`);
                    if (e1) throw e1;
                    let matched = byCity || [];
                    if (!matched.length) {
                        const { data: byArea } = await supabaseClient
                            .from('hotels').select('*')
                            .ilike('major_area', `%${cityName}%`);
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
                        .limit(1000);
                    if (error) throw error;
                    withDist = allH
                        .map(h => ({ ...h, distance: calcDistance(userLat, userLng, h.latitude, h.longitude) }))
                        .sort((a, b) => a.distance - b.distance)
                        .slice(0, 60);
                }

                // 集計を追加
                const hotelIds = withDist.map(h => h.id);
                const summaries = await fetchReportSummaries(hotelIds);
                const withSummary = withDist.map(h => ({ ...h, summary: summaries[h.id] || null }));

                renderHotelCards(withSummary, true);
                const status = document.getElementById('result-status');
                if (status) {
                    status.style.display = 'block';
                    status.innerHTML = `${locationLabel} — <strong>${withSummary.length}</strong> ${t('results')}`;
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
        setBreadcrumb([{ label: t('japan'), onclick: 'showJapanPage()' }, { label: `🚉 ${val}駅周辺` }]);
        setTitle(`${val}駅 周辺のホテル`);
        setBackBtn(true);
        pageStack.push(showJapanPage);
        document.getElementById('area-button-container').innerHTML = '';

        try {
            let query = supabaseClient.from('hotels').select('*')
                .ilike('nearest_station', `%${val}%`)
                .order('review_average', { ascending: false, nullsFirst: false })
                .limit(80);

            const hotels = await fetchHotelsWithSummary(query);
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
        setBreadcrumb([{ label: t('japan'), onclick: 'showJapanPage()' }, { label: `「${keyword}」の検索結果` }]);
        setTitle(`「${keyword}」の検索結果`);
        setBackBtn(true);
        pageStack.push(showJapanPage);
        document.getElementById('area-button-container').innerHTML = '';

        try {
            let query = supabaseClient.from('hotels').select('*').limit(80);
            query = applyKeywordFilter(query, keyword);
            query = query.order('review_average', { ascending: false, nullsFirst: false });

            const hotels = await fetchHotelsWithSummary(query);
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
function renderHotelCards(hotels, showDistance = false) {
    const container = document.getElementById('hotel-list');

    if (!hotels.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-text">${t('no_results')}</p></div>`;
        return;
    }

    container.innerHTML = hotels.map((h, i) => {
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

        // ===== 最寄駅 + 参考料金（横並び） =====
        const priceInline = h.min_charge
            ? `<span class="hotel-price-inline">最安値 ¥${parseInt(h.min_charge).toLocaleString()}~</span>`
            : '';
        const stationHTML = h.nearest_station
            ? `<div class="hotel-info-row"><span class="hotel-info-icon">🚉</span><span class="hotel-info-text">${h.nearest_station}</span>${priceInline}</div>`
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
                    <div class="hotel-name" style="flex:1;min-width:0;font-size:14px;font-weight:500;color:var(--text);line-height:1.5;word-break:break-all;">${h.name}</div>
                    ${rankHTML}
                </div>

                <!-- 住所・駅 -->
                <div class="hotel-info-row" style="justify-content:space-between;">
                    <span style="display:flex;align-items:flex-start;gap:4px;flex:1;min-width:0;">
                        <span class="hotel-info-icon">📍</span>
                        <span class="hotel-info-text">${h.address || ''}</span>
                    </span>
                    ${h.tel ? '<span style="font-size:11px;color:var(--text-3);white-space:nowrap;flex-shrink:0;margin-left:8px;">📞 ' + h.tel + '</span>' : ''}
                </div>
                ${stationHTML}

                <!-- 投稿サマリー（競合と差別化） -->
                ${reportAreaHTML}

                <!-- フッター -->
                <div class="hotel-card-footer" style="display:flex;gap:6px;padding-top:8px;">
                    <button onclick="event.stopPropagation();openHotelDetail(${h.id})" style="flex:1;min-width:0;padding:8px 6px;background:linear-gradient(135deg,#c9a84c,#e0c060);border:none;border-radius:8px;font-size:11px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:0.03em;text-shadow:0 1px 2px rgba(0,0,0,0.18);">✨ 今すぐCHECK！</button>
                    <button onclick="event.stopPropagation();openHotelDetail(${h.id})" style="flex:1;min-width:0;padding:8px 6px;background:transparent;border:1.5px solid rgba(180,150,100,0.35);border-radius:8px;font-size:11px;font-weight:700;color:var(--gold-dim,#a08030);cursor:pointer;font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:0.03em;">📝 口コミを投稿</button>
                </div>

            </div>
        </div>`;
    }).join('');
}

// ==========================================================================
// ホテル詳細ページへ遷移
// ==========================================================================
function openHotelDetail(hotelId) {
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

async function loadConditionsMaster() {
    try {
        const { data } = await supabaseClient
            .from('conditions_master')
            .select('label')
            .eq('is_active', true)
            .order('sort_order');
        if (data && data.length > 0) {
            CONDITIONS = data.map(d => d.label);
        }
    } catch(e) {
        console.log('conditions_master not found, using defaults');
    }
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
        console.log('can_call_reasons not found, using defaults');
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
        console.log('cannot_call_reasons not found, using defaults');
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
        console.log('room_types not found, using defaults');
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

function showHotelPanel(hotelId) {
    currentHotelId = hotelId;
    hotelFormState = { can_call: null, conditions: new Set(), time_slot: '', can_call_reasons: new Set(), cannot_call_reasons: new Set(), comment: '', poster_name: '', room_type: '', multi_person: false, guest_male: 1, guest_female: 1 };

    // ポータルコンテンツを隠す（ヘッダーはそのまま）
    document.querySelector('.area-section').style.display = 'none';
    document.querySelector('.search-tools').style.display = 'none';
    const rs = document.getElementById('result-status');
    if (rs) rs.style.display = 'none';
    document.getElementById('hotel-list').style.display = 'none';

    const panel = document.getElementById('hotel-detail-panel');
    panel.style.display = 'block';
    // ヘッダーを詳細用に切り替え
    const header = document.querySelector('.portal-header');
    header.innerHTML = `
        <div class="header-inner" style="max-width:640px;margin:0 auto;padding:10px 14px;display:flex;align-items:center;gap:12px;">
            <button onclick="location.href='index.html'" class="btn-to-gate">
                <span class="btn-gate-icon">⛩</span>
                <span class="btn-gate-text">ゲートへ</span>
            </button>
            <div class="header-logo" style="flex:1;text-align:center;">
                <span class="logo-text">Deri <em>Hotel</em> Navi</span>
            </div>
            <button class="btn-area-back" onclick="closeHotelPanel()" style="display:flex;">
                <span class="back-arrow">←</span>
                <span class="back-text">前へ</span>
            </button>
        </div>`;

    // パネルを通常フローで表示（fixed廃止）
    panel.style.cssText = 'display:block;';

    loadHotelDetail(hotelId);
    window.scrollTo(0, 0);
}

function closeHotelPanel() {
    // パネルを閉じてポータルに戻る
    const panel = document.getElementById('hotel-detail-panel');
    panel.style.display = 'none';

    // ヘッダーを元に戻す
    const header = document.querySelector('.portal-header');
    header.innerHTML = `
        <div class="header-inner">
            <button onclick="location.href='index.html'" class="btn-to-gate">
                <span class="btn-gate-icon">⛩</span>
                <span class="btn-gate-text">ゲートへ</span>
            </button>
            <div class="header-logo">
                <span class="logo-text">Deri <em>Hotel</em> Navi</span>
            </div>
            <div class="lang-buttons">
                <button onclick="changeLang('ja')" class="lang-btn ${state.lang==='ja'?'active':''}">JP</button>
                <button onclick="changeLang('en')" class="lang-btn ${state.lang==='en'?'active':''}">EN</button>
                <button onclick="changeLang('zh')" class="lang-btn ${state.lang==='zh'?'active':''}">CN</button>
                <button onclick="changeLang('ko')" class="lang-btn ${state.lang==='ko'?'active':''}">KR</button>
            </div>
        </div>
        <div class="mode-title-bar" id="mode-title-bar" style="display:none;">
        </div>`;

    // ポータルを再表示
    document.querySelector('.area-section').style.display = '';
    document.querySelector('.search-tools').style.display = '';
    document.getElementById('hotel-list').style.display = '';
}

async function loadHotelDetail(hotelId) {
    const content = document.getElementById('hotel-detail-content');
    content.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-3);">読み込み中...</div>`;

    try {
        await Promise.all([loadConditionsMaster(), loadCanCallReasonsMaster(), loadCannotCallReasonsMaster(), loadRoomTypesMaster()]);
        const [hotelRes, reportsRes, summaryRes, shopsRes] = await Promise.all([
            supabaseClient.from('hotels').select('*').eq('id', hotelId).single(),
            supabaseClient.from('reports').select('*').eq('hotel_id', hotelId).order('created_at', { ascending: false }).limit(50),
            supabaseClient.from('hotel_report_summary').select('*').eq('hotel_id', hotelId).maybeSingle(),
            Promise.resolve({ data: [] }),  // 店舗フィールド削除のため不使用
        ]);

        if (!hotelRes.data) throw new Error('Hotel not found');
        renderHotelDetail(hotelRes.data, reportsRes.data || [], summaryRes.data, shopsRes.data || []);
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

function renderHotelDetail(hotel, reports, summary, _shops) {
    const can     = summary?.can_call_count    || 0;
    const cannot  = summary?.cannot_call_count || 0;
    const shopCan = summary?.shop_can_count    || 0;
    const shopNg  = summary?.shop_ng_count     || 0;
    const total   = can + cannot;

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
        const guestChip = (r.guest_female != null && r.guest_female > 0)
            ? `<span style="padding:2px 7px;background:rgba(130,100,180,0.08);border:1px solid rgba(130,100,180,0.2);border-radius:8px;font-size:10px;color:#8264b4;">👥 男性${r.guest_male}名・女性${r.guest_female}名</span>`
            : '';
        const metaChips = [
            r.time_slot  ? `<span style="padding:2px 7px;background:rgba(106,138,188,0.1);border:1px solid rgba(106,138,188,0.25);border-radius:8px;font-size:10px;color:#6a8abc;">🕐${r.time_slot}</span>` : '',
            r.room_type  ? `<span style="padding:2px 7px;background:var(--bg-3);border:1px solid var(--border);border-radius:8px;font-size:10px;color:var(--text-2);">🛏${r.room_type}</span>` : '',
            guestChip,
        ].join('');
        return `
        <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:5px;">
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:${r.comment ? '6px' : '0'};">
                <span style="font-size:11px;font-weight:700;color:var(--text-3);white-space:nowrap;">${formatDate(r.created_at)}</span>
                <span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;${r.can_call ? 'background:rgba(58,154,96,0.08);color:#3a9a60;' : 'background:rgba(192,80,80,0.08);color:#c05050;'}">
                    ${r.can_call ? '✅ 呼べた' : '❌ 呼べなかった'}
                </span>
                ${tagsHTML}
                ${metaChips}
                ${r.poster_name ? (()=>{const gm=r.gender_mode;const icon=gm==='women'?'♀':gm==='men_same'?'♂♂':gm==='women_same'?'♀♀':'♂';const col=gm==='women'?'#c47a88':gm==='men_same'?'#2c5282':gm==='women_same'?'#8264b4':'#4a7ab0';return`<span style="font-size:10px;color:${col};margin-left:auto;font-weight:600;">${icon} ${r.poster_name}</span>`})() : '<span style="flex:1;"></span>'}
                ${r.id ? `<button onclick="showFlagModal('${r.id}')" style="padding:2px 7px;background:transparent;border:1px solid rgba(180,150,100,0.2);border-radius:8px;font-size:10px;color:var(--text-3);cursor:pointer;font-family:inherit;white-space:nowrap;">🚩 報告</button>` : ''}
            </div>
            ${r.comment ? `<div style="font-size:12px;color:var(--text-2);line-height:1.6;">${r.comment}</div>` : ''}
        </div>`;
    }

    const userReports = reports.filter(r => r.poster_type !== 'shop');
    const shopReports = reports.filter(r => r.poster_type === 'shop' && (!r.gender_mode || r.gender_mode === MODE));
    const noReports = `<div style="text-align:center;padding:16px 0;color:var(--text-3);font-size:12px;">まだ投稿がありません</div>`;

    const shopSection = shopReports.length === 0 ? '' : `
        <div style="border:2px solid rgba(201,168,76,0.5);border-radius:12px;padding:14px 16px;margin-bottom:16px;background:linear-gradient(135deg,rgba(201,168,76,0.07) 0%,rgba(255,248,220,0.5) 100%);box-shadow:0 2px 12px rgba(201,168,76,0.12);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <span style="font-size:11px;font-weight:700;padding:4px 12px;background:rgba(201,168,76,0.18);color:#7a5c10;border:1px solid rgba(201,168,76,0.4);border-radius:20px;letter-spacing:0.03em;">✅ 店舗公式情報</span>
                <span style="font-size:11px;color:#9a8050;">${shopReports.length}件</span>
            </div>
            ${shopReports.map(buildReportCard).join('')}
        </div>`;

    const reportsHTML = `
        ${shopSection}
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
            <h2 style="font-size:23px;font-weight:600;color:#1a1410 !important;line-height:1.4;margin:0;padding:0;flex:1;min-width:0;">${hotel.name}</h2>
            ${hotel.min_charge ? '<span style="font-size:13px;font-weight:600;color:var(--accent-dim);white-space:nowrap;flex-shrink:0;">最安値 ¥' + parseInt(hotel.min_charge).toLocaleString() + '~</span>' : ''}
        </div>

        <!-- ホテル基本情報 -->
        <div style="background:#ffffff;border:1px solid rgba(180,140,80,0.2);border-radius:10px;padding:14px 18px;margin-bottom:12px;box-shadow:0 2px 16px rgba(0,0,0,0.06);">
            <!-- 行1: 住所 | 電話番号 -->
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px;">
                <span style="font-size:13px;color:var(--text-2);line-height:1.5;flex:1;">${hotel.address ? '📍 ' + hotel.address : ''}</span>
                ${hotel.tel ? '<span style="font-size:13px;color:var(--text-2);white-space:nowrap;flex-shrink:0;">📞 ' + hotel.tel + '</span>' : ''}
            </div>
            <!-- 行2: 最寄駅 | エリア -->
            ${(hotel.nearest_station || hotel.prefecture) ? `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                ${hotel.nearest_station ? `<span style="font-size:13px;color:var(--text-2);">🚉 ${hotel.nearest_station}</span>` : '<span></span>'}
                ${hotel.prefecture ? `<span style="font-size:12px;color:var(--text-3);">📌 ${hotel.major_area || hotel.prefecture}</span>` : ''}
            </div>` : ''}
        </div>

        <!-- 呼べる？情報 -->
        <div style="display:flex;align-items:center;gap:10px;margin:20px 0 10px;">
            <span style="font-size:16px;font-weight:600;color:var(--text);">呼べる？情報</span>
            <div style="flex:1;height:1px;background:var(--border);"></div>
        </div>

        <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:12px;box-shadow:var(--shadow);">
            <!-- 店舗様提供情報 -->
            <div style="font-size:11px;font-weight:700;padding:4px 10px;background:var(--accent-bg);color:var(--accent-dim);border:1px solid var(--border-strong);border-radius:6px;display:inline-block;margin-bottom:10px;">🏪 店舗様提供情報</div>
            ${shopCan + shopNg === 0
                ? `<div style="text-align:center;padding:8px 0 14px;color:var(--text-3);font-size:12px;">まだ情報がありません</div>`
                : `<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;padding:10px 14px;border:1px solid var(--border-strong);border-radius:8px;background:var(--accent-bg);">
                    <div style="flex:1;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                            <span style="font-size:13px;color:var(--text-2);font-weight:500;min-width:32px;">可</span>
                            <span style="font-size:26px;font-weight:700;color:#3a9a60;line-height:1;">${shopCan}<span style="font-size:12px;font-weight:400;margin-left:2px;">件</span></span>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:13px;color:var(--text-2);font-weight:500;min-width:32px;">不可</span>
                            <span style="font-size:26px;font-weight:700;color:#c05050;line-height:1;">${shopNg}<span style="font-size:12px;font-weight:400;margin-left:2px;">件</span></span>
                        </div>
                    </div>
                    <div style="flex-shrink:0;">${buildDonutSVG(shopCan, shopNg)}</div>
                </div>`
            }
            <!-- ユーザー投稿情報 -->
            <div style="font-size:11px;font-weight:700;padding:4px 10px;background:rgba(58,154,96,0.1);color:#3a7a50;border:1px solid rgba(58,154,96,0.2);border-radius:6px;display:inline-block;margin-bottom:10px;">👤 ユーザー投稿情報</div>
            ${can + cannot === 0
                ? `<div style="text-align:center;padding:8px 0;color:var(--text-3);font-size:12px;">まだ情報がありません</div>`
                : `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid rgba(58,154,96,0.2);border-radius:8px;background:rgba(58,154,96,0.03);">
                    <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                        <div style="text-align:center;padding:8px 4px;border:1px solid rgba(58,154,96,0.2);border-radius:8px;background:rgba(58,154,96,0.04);">
                            <div style="font-size:11px;color:#3a7a50;margin-bottom:3px;font-weight:500;">呼べた</div>
                            <div style="font-size:24px;font-weight:700;color:#3a9a60;line-height:1;">${can}<span style="font-size:11px;font-weight:400;margin-left:1px;">件</span></div>
                        </div>
                        <div style="text-align:center;padding:8px 4px;border:1px solid rgba(192,80,80,0.15);border-radius:8px;background:rgba(192,80,80,0.03);">
                            <div style="font-size:11px;color:#a05050;margin-bottom:3px;font-weight:500;">呼べなかった</div>
                            <div style="font-size:24px;font-weight:700;color:#c05050;line-height:1;">${cannot}<span style="font-size:11px;font-weight:400;margin-left:1px;">件</span></div>
                        </div>
                    </div>
                    <div style="flex-shrink:0;">${buildDonutSVG(can, cannot, 64, true)}</div>
                </div>`
            }
        </div>

        ${reportsHTML}

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
            <div class="form-group">
                <label class="form-label">コメント <span style="color:var(--text-3);font-weight:400;">（任意）</span></label>
                <textarea class="form-textarea" id="form-comment" placeholder="状況や注意点など自由に記入してください..." oninput="hotelFormState.comment=this.value"></textarea>
                <div style="font-size:11px;color:var(--text-3);margin-top:6px;line-height:1.7;">
                    ${(typeof MODE !== 'undefined' ? MODE : 'men') === 'women'
                        ? '※お店名・セラピスト情報・ホテルの批判・URL・電話番号を含む投稿は非表示となります'
                        : '※お店名・キャスト情報・ホテルの批判・URL・電話番号を含む投稿は非表示となります'}
                </div>
            </div>
            <button class="btn-submit" id="btn-submit" onclick="hotelSubmitReport()">確認画面に進む</button>
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
        comment: hotelFormState.comment || null,
        poster_name: hotelFormState.poster_name?.trim() || '無記名',
        room_type: hotelFormState.room_type || null,
        guest_male: hotelFormState.multi_person ? hotelFormState.guest_male : 1,
        guest_female: hotelFormState.multi_person ? hotelFormState.guest_female : 0,
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
    showToast('✅ 投稿しました！ありがとうございます');
    setTimeout(() => loadHotelDetail(currentHotelId), 1500);
}

// ==========================================================================
// 投稿報告
// ==========================================================================
let flagTargetId = null;
let flagSelectedReason = null;

function showFlagModal(reportId) {
    if (!reportId || reportId === 'null' || reportId === 'undefined') {
        console.error('[flag] showFlagModal called with invalid id:', reportId);
        showToast('報告対象が取得できませんでした');
        return;
    }
    flagTargetId = reportId;
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

function closeFlagModal() {
    document.getElementById('flag-modal').style.display = 'none';
    flagTargetId = null;
    flagSelectedReason = null;
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
        document.getElementById('flag-reason-err').style.display = '';
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

    closeFlagModal(); // ここで flagTargetId = null になるが targetId は安全

    const { error } = await supabaseClient.from('reports').update(flagPayload).eq('id', targetId);
    if (error) {
        console.error('[flag] error:', error);
        showToast('報告の送信に失敗しました: ' + error.message);
    } else {
        showToast('🚩 報告を受け付けました');
    }
}

// ==========================================================================
// ホテル追加申請モーダル
// ==========================================================================
const HOTEL_TYPE_LABELS = {
    business: 'ビジネスホテル', city: 'シティホテル', resort: 'リゾートホテル',
    ryokan: '旅館', pension: 'ペンション', minshuku: '民宿', other: 'その他',
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
        errEl.style.display = '';
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

    document.getElementById('hreq-step2').style.display = 'none';
    document.getElementById('hreq-done').style.display = '';
}

// ==========================================================================
// 初期化
// ==========================================================================
window.onload = () => {
    showJapanPage();
};