// 

const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 階層の設定：[表示するレベル名, DBの列名, 次のレベル]
const HIERARCHY = {
    'japan':      { col: 'region',     next: 'region' },
    'region':     { col: 'prefecture', next: 'prefecture' },
    'prefecture': { col: 'major_area', next: 'major_area' },
    'major_area': { col: 'city',       next: 'city' },
    'city':       { col: null,         next: 'finish' } // 最後はホテル表示
};

let historyStack = [];

// -----------------------------------------
// 🚀 動的階層ロード関数
// -----------------------------------------
async function loadLevel(level = 'japan', filterObj = {}) {
    const container = document.getElementById('map-button-container');
    const statusEl = document.getElementById('current-level');
    const config = HIERARCHY[level];

    // 「戻る」ボタンの制御
    document.getElementById('btn-map-back').style.display = level === 'japan' ? 'none' : 'block';

    // ホテル表示フェーズなら別関数へ
    if (config.next === 'finish') {
        return fetchHotels(filterObj);
    }

    container.innerHTML = `<p style="text-align:center; grid-column:1/-1;">読み込み中...</p>`;

    // 1. クエリ作成
    let query = supabaseClient.from('hotels').select('*');
    
    // これまでの選択条件をすべて適用（例：region="関東" AND prefecture="東京都"）
    Object.keys(filterObj).forEach(key => {
        query = query.eq(key, filterObj[key]);
    });

    const { data, error } = await query;
    if (error) return console.error(error);

    // 2. 次に表示すべきエリア名（列）を重複なしで抽出
    const targetCol = config.col;
    const uniqueAreas = [...new Set(data.map(h => h[targetCol]))].filter(Boolean);

    // 3. ボタン生成
    container.innerHTML = '';
    statusEl.innerText = `現在: ${Object.values(filterObj).join(' > ') || '日本全国'}`;

    if (uniqueAreas.length === 0) {
        container.innerHTML = `<p style="text-align:center; grid-column:1/-1;">データがありません</p>`;
        return;
    }

    uniqueAreas.forEach(areaName => {
        const btn = document.createElement('button');
        btn.className = 'map-btn';
        btn.textContent = areaName;
        btn.onclick = () => {
            const nextFilter = { ...filterObj, [targetCol]: areaName };
            historyStack.push({ level, filter: filterObj });
            loadLevel(config.next, nextFilter);
        };
        container.appendChild(btn);
    });
}

// -----------------------------------------
// 🏨 ホテル一覧表示
// -----------------------------------------
async function fetchHotels(filterObj) {
    const listContainer = document.getElementById('hotel-list');
    const container = document.getElementById('map-button-container');
    container.innerHTML = ''; 

    listContainer.innerHTML = `<p style="text-align:center;">ホテルを検索中...</p>`;

    let query = supabaseClient.from('hotels').select(`*, shops:last_posted_by(name, plan, url)`);
    Object.keys(filterObj).forEach(key => {
        query = query.eq(key, filterObj[key]);
    });

    const { data: hotels, error } = await query;
    if (error) return console.error(error);

    // 有料プラン店舗の情報を優先（ソート）
    hotels.sort((a, b) => (b.shops?.plan === 'paid' ? 1 : 0) - (a.shops?.plan === 'paid' ? 1 : 0));

    renderHotelCards(hotels);
}

// 戻る処理
function backLevel() {
    const prev = historyStack.pop();
    if (prev) {
        loadLevel(prev.level, prev.filter);
    } else {
        loadLevel('japan', {});
    }
    document.getElementById('hotel-list').innerHTML = '';
}

window.onload = () => loadLevel('japan', {});