const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; //
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 1. 翻訳データ（4カ国語）
const i18n = {
    ja: {
        title: "デリ呼ぶホテル検索", tagline: "全国エリア別・呼べるホテル検索", select_mode: "モードを選択してください",
        men_btn: "男性用（デリ呼ぶ）入口", women_btn: "女性用（女風呼ぶ）入口", shop_btn: "店舗様・掲載用はこちら",
        select_area: "エリアを選択してください", back: "戻る", region_select: "地域を選択", back_level: "一つ前に戻る",
        search_placeholder: "地域名やホテル名を入力...", list_placeholder: "エリアを選択すると、ここにホテルが表示されます",
        success_report: "成功報告", call_btn: "呼べた！", loading: "検索中...", no_hotel: "このエリアのホテルは未登録です"
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

// 2. 全国エリアマスターデータ（ここにある名前がボタンになります）
const areaData = {
    'regions': ['北海道', '東北', '北関東', '首都圏', '甲信越', '北陸', '東海', '近畿', '中国', '四国', '九州', '沖縄'],
    'prefectures': {
        '北海道': ['北海道'],
        '東北': ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
        '北関東': ['茨城県', '栃木県', '群馬県'],
        '首都圏': ['東京都', '神奈川県', '千葉県', '埼玉県'],
        '甲信越': ['山梨県', '長野県', '新潟県'],
        '北陸': ['富山県', '石川県', '福井県'],
        '東海': ['愛知県', '岐阜県', '静岡県', '三重県'],
        '近畿': ['大阪府', '兵庫県', '京都府', '滋賀県', '奈良県', '和歌山県'],
        '中国': ['鳥取県', '島根県', '岡山県', '広島県', '山口県'],
        '四国': ['徳島県', '香川県', '愛媛県', '高知県'],
        '九州': ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県'],
        '沖縄': ['沖縄県']
    },
    'cities': {
        '北海道': ['札幌市中央区', '札幌市北区', '札幌市ススキノ', '函館市', '旭川市'],
        '宮城県': ['仙台市青葉区', '仙台市宮城野区', '仙台市泉区'],
        '東京都': ['新宿区', '渋谷区', '豊島区(池袋)', '港区', '台東区(上野)', '江戸川区', '立川市', '町田市', '八王子市'],
        '神奈川県': ['横浜市中区', '横浜市西区', '川崎市川崎区', '相模原市', '厚木市', '大和市'],
        '千葉県': ['千葉市中央区', '船橋市', '松戸市', '柏市', '市川市', '木更津市'],
        '埼玉県': ['さいたま市大宮区', 'さいたま市浦和区', '川越市', '川口市', '越谷市'],
        '愛知県': ['名古屋市中区(錦)', '名古屋市中村区', '豊橋市', '岡崎市', '一宮市'],
        '大阪府': ['大阪市北区(梅田)', '大阪市中央区(難波)', '大阪市淀川区(十三)', '堺市', '東大阪市'],
        '兵庫県': ['神戸市中央区(三宮)', '姫路市', '尼崎市', '西宮市'],
        '京都府': ['京都市中京区', '京都市下京区', '京都市南区'],
        '福岡県': ['福岡市博多区(中洲)', '福岡市中央区(天神)', '北九州市小倉', '久留米市'],
        '沖縄県': ['那覇市', '沖縄市', '石垣市']
    }
};

let currentLang = localStorage.getItem('app_lang') || 'ja';
let currentLevel = 'region'; 
let selection = { region: '', prefecture: '', town: '' };
let currentMode = 'men';

window.onload = function() {
    currentMode = sessionStorage.getItem('session_mode') || 'men';
    if (currentMode === 'women') document.body.classList.add('mode-women');
    applyLanguage();
    renderButtons();
};

// 言語切り替えロジック
function changeLang(lang) {
    currentLang = lang;
    localStorage.setItem('app_lang', lang);
    applyLanguage();
    renderButtons(); // ボタンのテキストも（もし翻訳データがあれば）更新
}

function applyLanguage() {
    const texts = i18n[currentLang];
    document.querySelectorAll('[data-lang]').forEach(el => {
        const key = el.getAttribute('data-lang');
        if (texts[key]) el.innerText = texts[key];
    });
    const searchInput = document.getElementById('keyword');
    if (searchInput && texts.search_placeholder) searchInput.placeholder = texts.search_placeholder;
}

// エリア選択ボタンの描画ロジック
function renderButtons() {
    const container = document.getElementById('map-button-container');
    if (!container) return;
    const label = document.getElementById('map-label');
    const backBtn = document.getElementById('btn-map-back');
    const texts = i18n[currentLang];
    
    container.innerHTML = '';

    let items = [];
    if (currentLevel === 'region') {
        items = areaData.regions;
        label.innerText = texts.region_select;
        backBtn.style.display = "none";
    } else if (currentLevel === 'prefecture') {
        items = areaData.prefectures[selection.region] || [];
        label.innerText = selection.region;
        backBtn.style.display = "block";
    } else if (currentLevel === 'city') {
        // 固定の市区町村リストを表示（これで空っぽにならない）
        items = areaData.cities[selection.prefecture] || ['その他・全域'];
        label.innerText = selection.prefecture;
        backBtn.style.display = "block";
    }

    let row = document.createElement('div');
    row.className = 'map-row';
    items.forEach((name, index) => {
        const btn = document.createElement('button');
        btn.className = 'map-btn';
        btn.innerText = name;
        btn.onclick = () => handleSelect(name);
        row.appendChild(btn);
        
        if ((index + 1) % 3 === 0 || index === items.length - 1) {
            container.appendChild(row);
            row = document.createElement('div');
            row.className = 'map-row';
        }
    });
}

function handleSelect(name) {
    if (currentLevel === 'region') {
        selection.region = name;
        currentLevel = 'prefecture';
    } else if (currentLevel === 'prefecture') {
        selection.prefecture = name;
        currentLevel = 'city';
    } else {
        selection.town = name;
    }
    
    document.getElementById('keyword').value = name;
    document.getElementById('dynamic-title').innerText = name;
    fetchHotels();
    renderButtons();
}

function backLevel() {
    if (currentLevel === 'city') currentLevel = 'prefecture';
    else if (currentLevel === 'prefecture') currentLevel = 'region';
    renderButtons();
}

async function fetchHotels() {
    const keyword = document.getElementById('keyword').value;
    const listContainer = document.getElementById('hotel-list');
    const texts = i18n[currentLang];
    
    listContainer.innerHTML = `<p style="text-align:center; padding:20px;">🔍 ${texts.loading}</p>`;

    let { data: hotels, error } = await supabaseClient
        .from('hotels')
        .select('*')
        .or(`name.ilike.%${keyword}%,address.ilike.%${keyword}%,city.ilike.%${keyword}%,town.ilike.%${keyword}%`)
        .limit(30);

    if (error) {
        listContainer.innerHTML = '<p>Error</p>';
        return;
    }
    renderHotels(hotels);
}

function renderHotels(hotels) {
    const listContainer = document.getElementById('hotel-list');
    const texts = i18n[currentLang];
    listContainer.innerHTML = '';

    if (!hotels || hotels.length === 0) {
        listContainer.innerHTML = `<p class="list-placeholder">${texts.no_hotel}</p>`;
        return;
    }

    const okCol = currentMode === 'men' ? 'men_ok' : 'women_ok';
    hotels.forEach(h => {
        const card = document.createElement('div');
        card.className = 'hotel-card';
        card.innerHTML = `
            <h3 style="margin:0;">${h.name}</h3>
            <small style="color:#8e8e93;">${h.address}</small>
            <div class="tips-box"><p style="margin:0; font-size:13px;">${h.description || ''}</p></div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="color:var(--accent-color); font-weight:bold;">${texts.success_report}: ${h[okCol] || 0}</span>
                <button class="btn-ok">${texts.call_btn}</button>
            </div>
        `;
        listContainer.appendChild(card);
    });
}