// ==================== app.js - グロック先生 最終仕様版 ====================

const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB';

const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentMode = 'men';
let currentLang = localStorage.getItem('app_lang') || 'ja';
let currentLevel = 'japan';
let historyStack = [];

// ==================== 多言語 ====================
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
    }
};

// ==================== 言語切り替え ====================
function changeLang(lang) {
    currentLang = lang;
    localStorage.setItem('app_lang', lang);
    document.querySelectorAll('[data-lang]').forEach(el => {
        const key = el.getAttribute('data-lang');
        if (i18n[lang] && i18n[lang][key]) el.textContent = i18n[lang][key];
    });
}

// ==================== 階層メニュー（動的） ====================
async function loadLevel(level = 'japan', parentCode = null) {
    const container = document.getElementById('map-button-container');
    container.innerHTML = '';

    document.getElementById('current-level').innerHTML = 
        `現在: ${level === 'japan' ? '日本全国' : level === 'prefecture' ? '都道府県' : '市区町村'}`;

    document.getElementById('btn-map-back').style.display = level === 'japan' ? 'none' : 'block';

    let query = supabase.from('hotels').select('*');

    if (level === 'prefecture') query = query.eq('middle_class_code', parentCode);
    else if (level === 'smallClass') query = query.eq('small_class_code', parentCode);

    const { data } = await query.not('name', 'is', null).order('name');

    const unique = {};
    data.forEach(h => {
        const key = level === 'japan' ? h.prefecture : h.city;
        if (!unique[key]) unique[key] = h;
    });

    Object.values(unique).forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'map-btn';
        btn.textContent = level === 'japan' ? item.prefecture : item.city;
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
    listContainer.innerHTML = `<p style="text-align:center; padding:40px;">🔍 検索中...</p>`;

    let q = supabase.from('hotels').select('*');

    if (keyword) {
        q = q.or(`name.ilike.%${keyword}%,address.ilike.%${keyword}%,city.ilike.%${keyword}%`);
    }

    const { data: hotels } = await q.order('name').limit(100);

    renderHotels(hotels || []);
}

function renderHotels(hotels) {
    const container = document.getElementById('hotel-list');
    container.innerHTML = '';

    if (hotels.length === 0) {
        container.innerHTML = `<p class="list-placeholder">エリアを選択すると、ここにホテルが表示されます</p>`;
        return;
    }

    hotels.forEach(h => {
        const card = document.createElement('div');
        card.className = 'hotel-card';
        card.innerHTML = `
            <h3>${h.name}</h3>
            <small>${h.address}</small>
            <div class="tips-box">
                <p>${h.description || 'まだ投稿がありません'}</p>
            </div>
            <button class="btn-ok" onclick="goToHotel('${h.rakuten_hotel_no}')">詳細を見る</button>
        `;
        container.appendChild(card);
    });
}

function goToHotel(rakutenNo) {
    location.href = `hotel.html?id=${rakutenNo}`;
}

// ==================== 初期化 ====================
window.onload = () => {
    currentMode = sessionStorage.getItem('session_mode') || 'men';
    if (currentMode === 'women') document.body.classList.add('mode-women');

    changeLang(currentLang);
    loadLevel('japan');   // 階層メニュー開始
    fetchHotels();        // 初期表示
};