// ==================== app.js - グロック先生 完全版 (2026年2月版) ====================

const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB';

const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==================== グローバル変数 ====================
let currentMode = 'men';     // 'men' or 'women'
let currentLang = localStorage.getItem('app_lang') || 'ja';
let currentLevel = 'japan';
let historyStack = [];

// ==================== 多言語データ ====================
const i18n = {
    ja: {
        title: "デリ呼ぶホテル検索",
        tagline: "全国エリア別・呼べるホテル検索",
        select_mode: "ご利用のモードを選択してください",
        men_btn: "男性用（デリ呼ぶ）入口",
        women_btn: "女性用（女風呼ぶ）入口",
        shop_btn: "店舗様・掲載用はこちら",
        region_select: "地域を選択",
        back_level: "一つ前に戻る",
        search_placeholder: "地域名やホテル名を入力...",
        list_placeholder: "エリアを選択すると、ここにホテルが表示されます",
        success_report: "成功報告",
        call_btn: "呼べた！",
        loading: "検索中...",
        no_hotel: "まだ情報がありません",
        verified: "✨ 提携店舗確認済み",
        visit_shop: "店舗ページを見る"
    },
    en: { /* 必要なら追加 */ }
};

// ==================== 言語切り替え ====================
function changeLang(lang) {
    currentLang = lang;
    localStorage.setItem('app_lang', lang);
    document.documentElement.lang = lang;
    
    document.querySelectorAll('[data-lang]').forEach(el => {
        const key = el.getAttribute('data-lang');
        if (i18n[lang] && i18n[lang][key]) {
            el.textContent = i18n[lang][key];
        }
    });
}

// ==================== 階層メニュー ====================
async function loadLevel(level = 'japan', parentCode = null) {
    const container = document.getElementById('map-button-container');
    container.innerHTML = '';

    document.getElementById('current-level').innerHTML = 
        `現在: ${level === 'japan' ? '日本全国' : level === 'prefecture' ? '都道府県' : '市区町村'}`;

    document.getElementById('btn-map-back').style.display = level === 'japan' ? 'none' : 'block';

    let query = supabase.from('hotels').select('*');

    if (level === 'prefecture') {
        query = query.eq('middle_class_code', parentCode);
    } else if (level === 'smallClass') {
        query = query.eq('small_class_code', parentCode);
    }

    const { data } = await query.not('name', 'is', null).order('name');

    const unique = {};
    data.forEach(h => {
        const key = level === 'japan' ? h.prefecture : h.city || h.name;
        if (!unique[key]) unique[key] = h;
    });

    Object.values(unique).forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'map-btn';
        btn.textContent = level === 'japan' ? item.prefecture : (item.city || item.name);
        btn.onclick = () => {
            historyStack.push({ level, code: parentCode });
            loadLevel(level === 'japan' ? 'prefecture' : 'smallClass', 
                      level === 'japan' ? item.middle_class_code : item.small_class_code);
        };
        container.appendChild(btn);
    });
}

function backLevel() {
    if (historyStack.length === 0) return;
    const prev = historyStack.pop();
    loadLevel(prev.level, prev.code);
}

// ==================== ホテル検索 ====================
async function fetchHotels() {
    const keyword = document.getElementById('keyword').value.trim();
    const listContainer = document.getElementById('hotel-list');
    const texts = i18n[currentLang];

    listContainer.innerHTML = `<p style="text-align:center; padding:40px 20px;">🔍 ${texts.loading}</p>`;

    let query = supabase
        .from('hotels')
        .select(`
            *,
            reviews!inner(count)
        `);

    if (keyword) {
        query = query.or(`name.ilike.%${keyword}%,address.ilike.%${keyword}%,city.ilike.%${keyword}%`);
    }

    const { data: hotels, error } = await query.order('name').limit(100);

    if (error) {
        console.error(error);
        return;
    }

    renderHotels(hotels || []);
}

function renderHotels(hotels) {
    const listContainer = document.getElementById('hotel-list');
    const texts = i18n[currentLang];
    listContainer.innerHTML = '';

    if (hotels.length === 0) {
        listContainer.innerHTML = `<p class="list-placeholder">${texts.no_hotel}</p>`;
        return;
    }

    const okCol = currentMode === 'men' ? 'men_ok' : 'women_ok';

    hotels.forEach(h => {
        const card = document.createElement('div');
        card.className = 'hotel-card';
        card.innerHTML = `
            <h3>${h.name}</h3>
            <small style="color:#666;">${h.address}</small>
            
            <div class="tips-box">
                <p style="margin:8px 0;">${h.description || 'まだ投稿がありません'}</p>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px;">
                <span style="color:var(--accent-color); font-weight:bold;">
                    ${texts.success_report}: <span id="count-${h.id}">${h[okCol] || 0}</span>
                </span>
                <button class="btn-ok" onclick="reportSuccess('${h.id}', '${okCol}')">
                    ${texts.call_btn}
                </button>
            </div>
        `;
        listContainer.appendChild(card);
    });
}

// ==================== 成功報告 ====================
async function reportSuccess(hotelId, okCol) {
    if (!confirm('このホテルで呼べましたか？')) return;

    const { data: { user } } = await supabase.auth.getUser();

    // reviewsテーブルに記録
    await supabase.from('reviews').insert({
        hotel_id: hotelId,
        is_official: false,
        author_shop_id: null,
        used_shop_id: null,
        used_shop_name_custom: null,
        condition_id: 1, // 例: 直通OK (後で拡張)
        comment: '呼べました！',
        visit_date: new Date().toISOString().split('T')[0]
    });

    // hotelsテーブルのカウントを+1
    await supabase
        .from('hotels')
        .update({ [okCol]: supabase.rpc('increment', { column: okCol }) })
        .eq('id', hotelId);

    // UI即時更新
    const countEl = document.getElementById(`count-${hotelId}`);
    if (countEl) countEl.textContent = parseInt(countEl.textContent) + 1;

    alert('✅ 成功報告ありがとうございます！');
}

// ==================== 初期化 ====================
window.onload = async function() {
    currentMode = sessionStorage.getItem('session_mode') || 'men';
    if (currentMode === 'women') document.body.classList.add('mode-women');

    changeLang(currentLang);
    loadLevel('japan');        // 階層メニュー開始
    fetchHotels();             // 初期表示
};