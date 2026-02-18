const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; //
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ユーザーが検索するための「全国エリアマスターデータ」
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
        '東京都': ['新宿・大久保', '渋谷・恵比寿', '池袋・豊島区', '上野・浅草', '品川・港区', '立川・八王子', '町田市'],
        '大阪府': ['梅田・北新地', '難波・心斎橋', '天王寺・阿倍野', '京橋・十三', '堺市', '東大阪市'],
        '神奈川県': ['横浜市', '川崎市', '相模原市', '藤沢市', '小田原・箱根'],
        '愛知県': ['名古屋市', '豊橋市', '岡崎市', '一宮市'],
        '福岡県': ['博多・中洲', '天神・大名', '北九州市', '久留米市'],
        '北海道': ['札幌市', '函館市', '旭川市'],
        '宮城県': ['仙台市'], '広島県': ['広島市'], '京都府': ['京都市']
        // ※必要に応じて市区町村をここに追加するだけでボタンが増えます
    }
};

let currentLevel = 'region'; 
let selection = { region: '', prefecture: '' };
let currentMode = 'men';

window.onload = function() {
    currentMode = sessionStorage.getItem('session_mode') || 'men';
    if (currentMode === 'women') document.body.classList.add('mode-women');
    renderButtons();
};

function renderButtons() {
    const container = document.getElementById('map-button-container');
    const label = document.getElementById('map-label');
    const backBtn = document.getElementById('btn-map-back');
    container.innerHTML = '';

    let items = [];
    if (currentLevel === 'region') {
        items = areaData.regions;
        label.innerText = "地域を選択";
        backBtn.style.display = "none";
    } else if (currentLevel === 'prefecture') {
        items = areaData.prefectures[selection.region] || [];
        label.innerText = `${selection.region}の都道府県`;
        backBtn.style.display = "block";
    } else if (currentLevel === 'city') {
        items = areaData.cities[selection.prefecture] || ['全域'];
        label.innerText = `${selection.prefecture}のエリア`;
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
    }
    
    document.getElementById('keyword').value = name;
    document.getElementById('dynamic-title').innerText = `${name}の検索結果`;
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
    listContainer.innerHTML = '<p style="text-align:center; padding:20px;">🔍 検索中...</p>';

    let { data: hotels, error } = await supabaseClient
        .from('hotels')
        .select('*')
        .or(`name.ilike.%${keyword}%,address.ilike.%${keyword}%,city.ilike.%${keyword}%,town.ilike.%${keyword}%`)
        .limit(30);

    if (error) {
        listContainer.innerHTML = '<p>通信エラー</p>';
        return;
    }
    renderHotels(hotels);
}

function renderHotels(hotels) {
    const listContainer = document.getElementById('hotel-list');
    listContainer.innerHTML = '';
    if (!hotels || hotels.length === 0) {
        listContainer.innerHTML = '<p class="list-placeholder">このエリアはまだ登録がありません。<br>店舗様からの情報をお待ちしております。</p>';
        return;
    }
    const okCol = currentMode === 'men' ? 'men_ok' : 'women_ok';
    hotels.forEach(h => {
        const card = document.createElement('div');
        card.className = 'hotel-card';
        card.innerHTML = `
            <h3 style="margin:0;">${h.name}</h3>
            <small style="color:#8e8e93;">${h.address}</small>
            <div class="tips-box"><p style="margin:0; font-size:13px;">${h.description || '攻略情報なし'}</p></div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="color:var(--accent-color); font-weight:bold;">成功数: ${h[okCol] || 0}</span>
                <button class="btn-ok">呼べた！</button>
            </div>
        `;
        listContainer.appendChild(card);
    });
}