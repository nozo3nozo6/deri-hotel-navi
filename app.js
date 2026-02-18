const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentLevel = 'bigArea';   // bigArea → prefecture → majorArea → city
let currentFilter = null;
let historyStack = [];

// ====================== 大エリア定義 ======================
const bigAreas = [
    { name: "北海道", code: "hokkaido" },
    { name: "東北", code: "tohoku" },
    { name: "関東", code: "kanto" },
    { name: "中部", code: "chubu" },
    { name: "近畿", code: "kinki" },
    { name: "中国", code: "chugoku" },
    { name: "四国", code: "shikoku" },
    { name: "九州", code: "kyushu" },
    { name: "沖縄", code: "okinawa" }
];

// ====================== 主要エリア定義（例） ======================
const majorAreas = {
    "東京都": ["東京23区", "多摩エリア", "立川・八王子エリア"],
    "神奈川県": ["横浜エリア", "川崎エリア", "湘南エリア"],
    "大阪府": ["大阪市内", "堺・南大阪エリア"],
    // 必要に応じて追加してください
};

// ====================== 階層メニュー ======================
async function loadLevel(level = 'bigArea', filter = null) {
    currentLevel = level;
    currentFilter = filter;

    const container = document.getElementById('map-button-container');
    const statusEl = document.getElementById('current-level');

    container.innerHTML = '<p>読み込み中...</p>';
    document.getElementById('btn-map-back').style.display = level === 'bigArea' ? 'none' : 'block';

    let items = [];

    if (level === 'bigArea') {
        items = bigAreas.map(area => ({ name: area.name, type: 'prefecture', code: area.code }));
        statusEl.innerHTML = '現在: 日本全国';
    } 
    else if (level === 'prefecture') {
        // 大エリアから都道府県を表示（簡易マッピング）
        const areaMap = {
            'hokkaido': ['北海道'],
            'tohoku': ['青森県','岩手県','宮城県','秋田県','山形県','福島県'],
            'kanto': ['茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県'],
            'chubu': ['新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県'],
            'kinki': ['三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県'],
            'chugoku': ['鳥取県','島根県','岡山県','広島県','山口県'],
            'shikoku': ['徳島県','香川県','愛媛県','高知県'],
            'kyushu': ['福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県'],
            'okinawa': ['沖縄県']
        };

        items = areaMap[filter] ? areaMap[filter].map(name => ({ name, type: 'majorArea', code: name })) : [];
        statusEl.innerHTML = `現在: ${filter}`;
    } 
    else if (level === 'majorArea') {
        // 都道府県から主要エリアを表示
        items = majorAreas[filter] ? majorAreas[filter].map(name => ({ name, type: 'city', code: name })) : [];
        statusEl.innerHTML = `現在: ${filter}`;
    } 
    else if (level === 'city') {
        // 市区町村を表示（実際のデータから）
        const { data } = await supabaseClient
            .from('hotels')
            .select('city')
            .eq('prefecture', filter);   // 必要に応じて調整

        items = data.map(h => ({ name: h.city, type: 'city', code: h.city }));
        items = [...new Set(items.map(i => i.name))].map(name => ({ name, type: 'city', code: name }));
        statusEl.innerHTML = `現在: ${filter}`;
    }

    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = '<p>該当するエリアがありません</p>';
        return;
    }

    items.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'map-btn';
        btn.textContent = item.name;
        btn.onclick = () => {
            historyStack.push({ level, filter });
            loadLevel(item.type, item.name);
        };
        container.appendChild(btn);
    });
}

function backLevel() {
    if (historyStack.length === 0) return;
    const prev = historyStack.pop();
    loadLevel(prev.level, prev.filter);
}

window.onload = () => {
    loadLevel('bigArea');
};