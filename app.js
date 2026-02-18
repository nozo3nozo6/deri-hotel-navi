const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
// 確認済みの公開キーを適用
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentMode = 'men';

window.onload = function() {
    currentMode = sessionStorage.getItem('session_mode') || 'men';
    if (currentMode === 'women') {
        document.body.classList.add('mode-women');
    }
};

async function setArea(areaName) {
    document.getElementById('keyword').value = areaName;
    document.getElementById('dynamic-title').innerText = `${areaName}の検索結果`;
    fetchHotels();
}

async function fetchHotels() {
    const keyword = document.getElementById('keyword').value;
    const listContainer = document.getElementById('hotel-list');
    
    if (!listContainer) return;
    listContainer.innerHTML = '<p style="text-align:center; padding:20px;">🔍 検索中...</p>';

    let { data: hotels, error } = await supabaseClient
        .from('hotels')
        .select('*')
        .or(`name.ilike.%${keyword}%,address.ilike.%${keyword}%,city.ilike.%${keyword}%`)
        .limit(30);

    if (error) {
        listContainer.innerHTML = '<p style="text-align:center; color:red;">エラーが発生しました</p>';
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
            <div>
                <h3 style="margin:0;">${h.name}</h3>
                <small style="color:#8e8e93;">${h.address}</small>
            </div>
            <div class="tips-box">
                <p style="margin:0; font-size:13px;">${h.description || 'フロントの目が厳しくないとの報告あり。'}</p>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="color:var(--accent-color); font-weight:bold;">成功数: ${h[okCol] || 0}</span>
                <button class="btn-ok">呼べた！</button>
            </div>
        `;
        listContainer.appendChild(card);
    });
}