const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 1. 翻訳・文言データ
const i18n = {
    ja: {
        title: "デリ呼ぶホテル検索", tagline: "全国エリア別・呼べるホテル検索",
        success_report: "成功報告", call_btn: "呼べた！", loading: "検索中...",
        no_hotel: "未登録です", verified: "✨ 提携店舗確認済み", visit_shop: "店舗ページを見る"
    },
    en: {
        title: "Hotel Delivery Search", tagline: "Search hotels for delivery",
        success_report: "Success", call_btn: "Success!", loading: "Loading...",
        no_hotel: "No hotels", verified: "✨ Verified by Shop", visit_shop: "Visit Shop"
    }
    // (CN/KRは既存のものを継続使用してください)
};

let currentMode = 'men';
let currentLang = localStorage.getItem('app_lang') || 'ja';

window.onload = function() {
    currentMode = sessionStorage.getItem('session_mode') || 'men';
    if (currentMode === 'women') document.body.classList.add('mode-women');
    applyLanguage();
    if(typeof renderButtons === 'function') renderButtons();
};

// -----------------------------------------
// ★ 進化した検索ロジック
// -----------------------------------------
async function fetchHotels() {
    const keyword = document.getElementById('keyword').value;
    const listContainer = document.getElementById('hotel-list');
    const texts = i18n[currentLang];
    
    listContainer.innerHTML = `<p style="text-align:center; padding:20px;">🔍 ${texts.loading}</p>`;

    // 1. まずホテルデータを取得
    let { data: hotels, error } = await supabaseClient
        .from('hotels')
        .select(`
            *,
            shops:last_posted_by (
                name,
                url,
                plan
            )
        `)
        .or(`name.ilike.%${keyword}%,city.ilike.%${keyword}%,town.ilike.%${keyword}%`)
        .limit(50);

    if (error) return console.error(error);

    // 2. JavaScript側で「有料プラン」を最優先に並び替え
    // 有料(paid) > 無料(free) > 未投稿(null) の順
    hotels.sort((a, b) => {
        const planA = a.shops?.plan === 'paid' ? 2 : (a.shops?.plan === 'free' ? 1 : 0);
        const planB = b.shops?.plan === 'paid' ? 2 : (b.shops?.plan === 'free' ? 1 : 0);
        if (planB !== planA) return planB - planA;
        
        // プランが同じなら成功数順
        const okCol = currentMode === 'men' ? 'men_ok' : 'women_ok';
        return (b[okCol] || 0) - (a[okCol] || 0);
    });

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
        const isPaid = h.shops?.plan === 'paid';
        const card = document.createElement('div');
        // 有料店舗の投稿には特別な枠線を付ける
        card.className = `hotel-card ${isPaid ? 'premium-card' : ''}`;
        
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <h3 style="margin:0;">${h.name}</h3>
                ${isPaid ? `<span class="badge-paid">${texts.verified}</span>` : ''}
            </div>
            <small style="color:#8e8e93;">${h.address}</small>
            
            <div class="tips-box">
                <p style="margin:0; font-size:13px;">${h.description || ''}</p>
                ${isPaid ? `
                    <div style="margin-top:10px; border-top:1px solid rgba(0,0,0,0.05); padding-top:8px;">
                        <p style="font-size:11px; color:#666; margin:0;">情報提供: <b>${h.shops.name}</b></p>
                        <a href="${h.shops.url}" target="_blank" class="btn-shop-link">${texts.visit_shop}</a>
                    </div>
                ` : ''}
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="color:var(--accent-color); font-weight:bold;">${texts.success_report}: <span id="count-${h.id}">${h[okCol] || 0}</span></span>
                <button class="btn-ok" onclick="reportSuccess(${h.id}, '${okCol}')">${texts.call_btn}</button>
            </div>
        `;
        listContainer.appendChild(card);
    });
}