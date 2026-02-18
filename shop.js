const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; //
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let selectedHotelId = null;
let feedbackStatus = null;

// 店舗登録
async function registerShop() {
    const name = document.getElementById('shop-reg-name').value;
    const type = document.getElementById('shop-reg-type').value;
    if(!name) return alert("店名を入力してください");

    const { error } = await supabaseClient.from('shops').insert([{ name, type }]);
    if (error) alert("エラーが発生しました");
    else alert("店舗登録が完了しました！");
}

// ホテル検索
async function searchHotelsForFeedback() {
    const kw = document.getElementById('hotel-search').value;
    if(kw.length < 2) return;

    const { data } = await supabaseClient.from('hotels').select('*').ilike('name', `%${kw}%`).limit(5);
    const resDiv = document.getElementById('search-results');
    resDiv.innerHTML = '';

    data.forEach(h => {
        const div = document.createElement('div');
        div.style = "padding: 10px; border-bottom: 1px solid #eee; cursor: pointer;";
        div.innerText = h.name;
        div.onclick = () => selectHotel(h);
        resDiv.appendChild(div);
    });
}

function selectHotel(hotel) {
    selectedHotelId = hotel.id;
    document.getElementById('selected-hotel-name').innerText = "対象: " + hotel.name;
    document.getElementById('feedback-form').style.display = "block";
    document.getElementById('hotel-search').value = hotel.name;
    document.getElementById('search-results').innerHTML = '';
}

function setOkNg(isOk) {
    feedbackStatus = isOk;
    alert(isOk ? "YESを選択しました" : "NOを選択しました");
}

// 既存ホテルへのコメント・ステータス更新
async function submitFeedback() {
    if(!selectedHotelId || feedbackStatus === null) return alert("ホテル選択とYES/NOの選択が必要です");
    
    const comment = document.getElementById('hotel-comment').value;
    const mode = document.getElementById('shop-reg-type').value; // 店舗種別でどっちのカウントを増やすか決める
    const col = mode === 'men' ? 'men_ok' : 'women_ok';
    const colNg = mode === 'men' ? 'men_ng' : 'women_ng';

    const updateData = {};
    if(comment) updateData.description = comment;

    // 現在のカウントを取得して＋1する処理（簡易版）
    const { data: current } = await supabaseClient.from('hotels').select('*').eq('id', selectedHotelId).single();
    
    if(feedbackStatus) {
        updateData[col] = (current[col] || 0) + 1;
    } else {
        updateData[colNg] = (current[colNg] || 0) + 1;
    }

    const { error } = await supabaseClient.from('hotels').update(updateData).eq('id', selectedHotelId);
    if (error) alert("更新に失敗しました");
    else {
        alert("情報の更新が完了しました。ご協力ありがとうございます！");
        location.reload();
    }
}