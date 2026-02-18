const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; //
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let map, marker;

// 地図の初期化
window.onload = function() {
    // 日本全体を初期表示
    map = L.map('map-selection').setView([35.6895, 139.6917], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // 地図をクリックした時のイベント
    map.on('click', function(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;

        // ピンを立てる（既存のピンがあれば移動）
        if (marker) {
            marker.setLatLng(e.latlng);
        } else {
            marker = L.marker(e.latlng).addTo(map);
        }

        // 入力欄に値をセット
        document.getElementById('shop-lat').value = lat;
        document.getElementById('shop-lng').value = lng;
    });
};

async function saveHotel() {
    const btn = document.getElementById('save-btn');
    const msg = document.getElementById('msg');
    
    const hotelData = {
        name: document.getElementById('shop-name').value,
        city: document.getElementById('shop-city').value,
        town: document.getElementById('shop-town').value,
        address: document.getElementById('shop-address').value,
        lat: parseFloat(document.getElementById('shop-lat').value), // 緯度を保存
        lng: parseFloat(document.getElementById('shop-lng').value), // 経度を保存
        description: document.getElementById('shop-desc').value,
        men_ok: 0,
        women_ok: 0
    };

    if(!hotelData.name || !hotelData.city || !hotelData.lat) {
        alert("ホテル名、都道府県、地図での場所指定は必須です！");
        return;
    }

    btn.disabled = true;
    msg.innerText = "登録しています...";

    const { error } = await supabaseClient
        .from('hotels')
        .insert([hotelData]);

    if (error) {
        console.error(error);
        msg.style.color = "red";
        msg.innerText = "エラー：登録できませんでした。";
        btn.disabled = false;
    } else {
        msg.style.color = "green";
        msg.innerText = "✨ 登録完了！地図にも表示されます。";
        setTimeout(() => location.reload(), 2000);
    }
}