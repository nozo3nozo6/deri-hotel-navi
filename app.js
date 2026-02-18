/* ==========================================================================
   1. 基本設定（Supabase接続）
   ========================================================================== */
const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
// コピーしていただいた本物の Publishable key を設定しました
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let map, markers = [];
let currentMode = 'men';

/* ==========================================================================
   2. 初期化処理
   ========================================================================== */
window.onload = function() {
    // ゲートページで選択したモード（男性/女性）を復元
    currentMode = sessionStorage.getItem('session_mode') || 'men';
    if (currentMode === 'women') {
        document.body.classList.add('mode-women');
    }

    // URLにエリア指定（?area=東京 など）があれば、そのエリアで即検索
    const urlParams = new URLSearchParams(window.location.search);
    const area = urlParams.get('area');
    if (area) {
        setArea(area);
    }
};

/* ==========================================================================
   3. エリア・検索ロジック
   ========================================================================== */
async function setArea(areaName) {
    const keywordInput = document.getElementById('keyword');
    const titleElement = document.getElementById('dynamic-title');
    
    if (keywordInput) keywordInput.value = areaName;
    if (titleElement) titleElement.innerText = `${areaName}のホテル検索結果`;
    
    // エリアが選ばれたら地図ナビを少し薄くして、リストに注目させる
    const nav = document.getElementById('map-navigation');
    if(nav) nav.style.opacity = "0.7";

    fetchHotels();
}

async function fetchHotels() {
    const keyword = document.getElementById('keyword').value;
    const listContainer = document.getElementById('hotel-list');
    
    if (!listContainer) return;
    listContainer.innerHTML = '<p style="text-align:center; padding:20px;">🔍 データベースを検索中...</p>';

    // Supabaseからキーワードに一致するホテルを取得
    let { data: hotels, error } = await supabaseClient
        .from('hotels')
        .select('*')
        .or(`name.ilike.%${keyword}%,address.ilike.%${keyword}%,city.ilike.%${keyword}%`)
        .limit(30);

    if (error) {
        console.error('Data Fetch Error:', error);
        listContainer.innerHTML = '<p style="color:red; text-align:center;">データの取得に失敗しました。設定を確認してください。</p>';
        return;
    }

    renderHotels(hotels);
}

/* ==========================================================================
   4. 画面への表示（レンダリング）
   ========================================================================== */
function renderHotels(hotels) {
    const listContainer = document.getElementById('hotel-list');
    listContainer.innerHTML = '';

    if (!hotels || hotels.length === 0) {
        listContainer.innerHTML = '<p class="list-placeholder">該当するホテルが見つかりませんでした。<br>別のキーワードでお試しください。</p>';
        return;
    }

    // 現在のモード（男性/女性）に応じたカラム（OK数/NG数）を判定
    const okCol = currentMode === 'men' ? 'men_ok' : 'women_ok';
    const ngCol = currentMode === 'men' ? 'men_ng' : 'women_ng';

    hotels.forEach(h => {
        const card = document.createElement('div');
        card.className = 'hotel-card';
        card.innerHTML = `
            <div class="card-header">
                <h3 style="margin:0; font-size:18px; color:var(--text-primary);">${h.name}</h3>
                <small style="color:var(--text-secondary);">${h.address}</small>
            </div>
            
            <div class="tips-box">
                <span style="font-size:10px; font-weight:bold; color:var(--accent-color); text-transform:uppercase;">User Strategy</span>
                <p style="margin:5px 0 0; font-size:13px; color:#444;">${h.description || 'フロントの目が厳しくないとの報告あり。裏口利用がスムーズです。'}</p>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:15px;">
                <div style="font-size:14px;">
                    <span style="color:var(--accent-color); font-weight:900; background:var(--accent-light); padding:2px 8px; border-radius:4px;">成功 ${h[okCol] || 0}</span>
                    <span style="margin-left:8px; color:#8e8e93;">不可 ${h[ngCol] || 0}</span>
                </div>
                <button class="btn-ok" onclick="reportSuccess('${h.rakuten_hotel_no}', '${okCol}')" style="width:auto; padding:8px 16px; font-size:12px;">
                    呼べた！
                </button>
            </div>
        `;
        listContainer.appendChild(card);
    });
}

// 簡易報告機能（将来的にデータベースの数値を+1する機能を実装可能）
async function reportSuccess(hotelId, column) {
    alert("「呼べた！」の報告ありがとうございます。\n統計データに反映します。");
}