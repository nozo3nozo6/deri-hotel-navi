const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; //
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function saveHotel() {
    const btn = document.getElementById('save-btn');
    const msg = document.getElementById('msg');
    
    const hotelData = {
        name: document.getElementById('shop-name').value,
        city: document.getElementById('shop-city').value,   // 都道府県（例：東京都）
        town: document.getElementById('shop-town').value,   // 市町村（例：立川市）
        address: document.getElementById('shop-address').value,
        description: document.getElementById('shop-desc').value,
        men_ok: 0,
        women_ok: 0
    };

    if(!hotelData.name || !hotelData.city || !hotelData.town) {
        alert("ホテル名、都道府県、市町村は必須入力です！");
        return;
    }

    btn.disabled = true;
    msg.innerText = "登録しています...";

    const { error } = await supabaseClient
        .from('hotels')
        .insert([hotelData]);

    if (error) {
        msg.style.color = "red";
        msg.innerText = "エラー：登録できませんでした";
        btn.disabled = false;
    } else {
        msg.style.color = "green";
        msg.innerText = "✨ 登録完了！検索画面にボタンが表示されます。";
        setTimeout(() => location.reload(), 2000);
    }
}