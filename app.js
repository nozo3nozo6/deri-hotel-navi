const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 階層データ（例：首都圏の構成）
const areaData = {
    'regions': ['北海道', '東北', '北関東', '首都圏', '甲信越', '北陸', '東海', '近畿', '中国', '四国', '九州', '沖縄'],
    'prefectures': {
        '首都圏': ['東京都', '神奈川県', '千葉県', '埼玉県'],
        '近畿': ['大阪府', '京都府', '兵庫県', '奈良県', '滋賀県', '和歌山県'],
        '東海': ['愛知県', '岐阜県', '三重県', '静岡県'],
        // 他の地域も同様に追加可能
    },
    'cities': {
        '東京都': ['新宿区', '渋谷区', '池袋・豊島区', '上野・浅草', '品川・港区', '立川・八王子'],
        '大阪府': ['梅田・北新地', '難波・心斎橋', '天王寺・阿倍野', '京橋・十三'],
        '神奈川県': ['横浜市', '川崎市', '相模原市', '厚木・大和'],
        // 必要に応じて追加
    }
};

let currentLevel = 'region'; // region -> prefecture -> city
let selection = { region: '', prefecture: '', city: '' };
let currentMode = 'men';

window.onload = function() {
    currentMode = sessionStorage.getItem('session_mode') || 'men';
    if (currentMode === 'women') document.body.classList.add('mode-women');
    
    renderButtons(); // 最初のボタン（地域）を表示
};

// ボタンを描画する関数
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
        items = areaData.cities[selection.prefecture] || [];
        label.innerText = `${selection.prefecture}のエリア`;
        backBtn.style.display = "block";
    }

    // 2列または3列の行を作成してボタンを配置
    let row = document.createElement('div');
    row.className = 'map-row';
    
    items.forEach((name, index) => {
        const btn = document.createElement('button');
        btn.className = 'map-btn';
        btn.innerText = name;
        btn.onclick = () => handleSelect(name);
        row.appendChild(btn);
        
        // 3つごとに改行
        if ((index + 1) % 3 === 0 || index === items.length - 1) {
            container.appendChild(row);
            row = document.createElement('div');
            row.className = 'map-row';
        }
    });

    if (items.length === 0 && currentLevel !== 'region') {
        container.innerHTML = '<p style="font-size:12px; color:#888;">このエリアの詳細は準備中です</p>';
    }
}

// 選択した時の処理
function handleSelect(name) {
    if (currentLevel === 'region') {
        selection.region = name;
        currentLevel = 'prefecture';
    } else if (currentLevel === 'prefecture') {
        selection.prefecture = name;
        currentLevel = 'city';
    } else {
        selection.city = name;
    }
    
    // 検索窓に反映させて、ホテルを検索
    document.getElementById('keyword').value = name;
    document.getElementById('dynamic-title').innerText = `${name}の検索結果`;
    fetchHotels();
    renderButtons();
}

// 「戻る」ボタンの処理
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
        .or(`name.ilike.%${keyword}%,address.ilike.%${keyword}%,city.ilike.%${keyword}%`)
        .limit(30);

    if (error) {
        listContainer.innerHTML = '<p>エラーが発生しました</p>';
        return;
    }
    renderHotels(hotels);
}

function renderHotels(hotels) {
    const listContainer = document.getElementById('hotel-list');
    listContainer.innerHTML = '';
    if (!hotels || hotels.length === 0) {
        listContainer.innerHTML = '<p class="list-placeholder">ホテルが見つかりませんでした</p>';
        return;
    }
    const okCol = currentMode === 'men' ? 'men_ok' : 'women_ok';
    hotels.forEach(h => {
        const card = document.createElement('div');
        card.className = 'hotel-card';
        card.innerHTML = `
            <h3 style="margin:0;">${h.name}</h3>
            <small style="color:#8e8e93;">${h.address}</small>
            <div class="tips-box"><p style="margin:0; font-size:13px;">${h.description || 'フロントの目が厳しくないとの報告あり。'}</p></div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="color:var(--accent-color); font-weight:bold;">成功数: ${h[okCol] || 0}</span>
                <button class="btn-ok">呼べた！</button>
            </div>
        `;
        listContainer.appendChild(card);
    });
}