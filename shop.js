const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; //
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function saveHotel() {
    const btn = document.getElementById('save-btn');
    const hotelData = {
        name: document.getElementById('shop-name').value,
        city: document.getElementById('shop-city').value,
        town: document.getElementById('shop-town').value,
        address: document.getElementById('shop-address').value,
        description: document.getElementById('shop-desc').value,
        men_ok: 0, women_ok: 0
    };
    if(!hotelData.name || !hotelData.city) { alert("ホテル名と都道府県は必須です"); return; }
    btn.disabled = true;
    const { error } = await supabaseClient.from('hotels').insert([hotelData]);
    if (error) { alert("エラーが発生しました"); btn.disabled = false; }
    else { alert("登録完了しました！"); location.reload(); }
}