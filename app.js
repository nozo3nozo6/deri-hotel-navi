const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; //
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 翻訳データ
const i18n = {
    ja: {
        title: "デリ呼ぶホテル検索", tagline: "全国エリア別・呼べるホテル検索", select_mode: "モードを選択してください",
        men_btn: "男性用（デリ呼ぶ）入口", women_btn: "女性用（女風呼ぶ）入口", shop_btn: "店舗様・掲載用はこちら",
        select_area: "エリアを選択してください", back: "戻る", region_select: "地域を選択", back_level: "一つ前に戻る",
        search_placeholder: "地域名やホテル名を入力...", list_placeholder: "エリアを選択するとホテルが表示されます",
        success_report: "成功報告", call_btn: "呼べた！", loading: "検索中...", no_hotel: "ホテルは未登録です"
    },
    en: {
        title: "Hotel Delivery Search", tagline: "Search hotels that allow delivery services", select_mode: "Select Mode",
        men_btn: "Men's Entrance", women_btn: "Women's Entrance", shop_btn: "For Shops / Listings",
        select_area: "Select Area", back: "Back", region_select: "Select Region", back_level: "Back",
        search_placeholder: "Search area or hotel...", list_placeholder: "Select area to see hotels",
        success_report: "Success", call_btn: "Success!", loading: "Searching...", no_hotel: "No hotels registered"
    },
    zh: {
        title: "酒店外送搜索", tagline: "全国区域分类・可外送酒店搜索", select_mode: "请选择模式",
        men_btn: "男性入口", women_btn: "女性入口", shop_btn: "商家/刊登入口",
        select_area: "请选择区域", back: "返回", region_select: "选择地区", back_level: "返回",
        search_placeholder: "输入区域或酒店名...", list_placeholder: "选择区域后显示酒店",
        success_report: "成功案例", call_btn: "叫到了！", loading: "正在搜索...", no_hotel: "尚未注册酒店"
    },
    ko: {
        title: "호텔 딜리버리 검색", tagline: "전국 지역별·부를 수 있는 호텔 검색", select_mode: "모드를 선택해 주세요",
        men_btn: "남성용 입구", women_btn: "여성용 입구", shop_btn: "매장/게재 문의",
        select_area: "지역을 선택해 주세요", back: "뒤로", region_select: "지역 선택", back_level: "뒤로",
        search_placeholder: "지역명이나 호텔명 입력...", list_placeholder: "지역을 선택하면 호텔이 표시됩니다",
        success_report: "성공 보고", call_btn: "불렀다!", loading: "검색 중...", no_hotel: "등록된 호텔이 없습니다"
    }
};

let currentLang = localStorage.getItem('app_lang') || 'ja';

function changeLang(lang) {
    currentLang = lang;
    localStorage.setItem('app_lang', lang);
    applyLanguage();
}

function applyLanguage() {
    const texts = i18n[currentLang];
    document.querySelectorAll('[data-lang]').forEach(el => {
        const key = el.getAttribute('data-lang');
        if (texts[key]) el.innerText = texts[key];
    });
    document.querySelectorAll('[data-lang-placeholder]').forEach(el => {
        const key = el.getAttribute('data-lang-placeholder');
        if (texts[key]) el.placeholder = texts[key];
    });
}

// ... (既存の areaData, fetchHotels, renderButtons などのロジックは維持) ...
// 既存の window.onload の中で applyLanguage() を実行するようにしてください
window.onload = function() {
    currentMode = sessionStorage.getItem('session_mode') || 'men';
    if (currentMode === 'women') document.body.classList.add('mode-women');
    applyLanguage(); // 言語適用
    if(typeof renderButtons === 'function') renderButtons();
};