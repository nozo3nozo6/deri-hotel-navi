// app.js の fetchHotels 部分を修正
async function fetchHotels() {
    const keyword = document.getElementById('keyword').value;
    const listContainer = document.getElementById('hotel-list');
    const urlParams = new URLSearchParams(window.location.search);
    const shopId = urlParams.get('shop_id'); // URLからshop_idを取得

    listContainer.innerHTML = `<p style="text-align:center;">検索中...</p>`;

    let query = supabaseClient.from('hotels').select('*');

    // ★店舗専用URLの場合のフィルタリング
    if (shopId) {
        // 例: その店舗が投稿したホテル、または一般ユーザー(null)が投稿したホテルのみ表示
        query = query.or(`last_posted_by.eq.${shopId},last_posted_by.is.null`);
    }

    let { data: hotels, error } = await query
        .or(`name.ilike.%${keyword}%,city.ilike.%${keyword}%,town.ilike.%${keyword}%`)
        .limit(30);

    // ... その後の renderHotels 処理 ...
}