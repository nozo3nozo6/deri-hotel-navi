// URLのパラメータからエリアを取得 (?area=東京 など)
const urlParams = new URLSearchParams(window.location.search);
let currentArea = urlParams.get('area') || "";

// ページ読み込み時の処理
window.onload = function() {
    // セッションからモード復元
    currentMode = sessionStorage.getItem('session_mode') || 'men';
    if (currentMode === 'women') document.body.classList.add('mode-women');

    // エリアがある場合はSEO設定を更新
    if (currentArea) {
        updateSEOMeta(currentArea);
        document.getElementById('keyword').value = currentArea;
        // 地図ナビを閉じてリストを表示
        document.getElementById('map-navigation').style.display = 'none';
    }

    initMap();
    fetchHotels();
};

// 🆕 SEOメタ情報を動的に書き換える（Google対策）
function updateSEOMeta(area) {
    const modeName = currentMode === 'men' ? 'デリヘル' : '女性向け風俗';
    const title = `${area}で${modeName}が呼べるホテル一覧 | デリ呼ぶ検索`;
    const desc = `${area}周辺のビジネスホテル・シティホテルで、${modeName}の利用が許可されているか、口コミや店舗情報を元に集計。裏口情報やフロントの厳しさも掲載中。`;
    
    document.title = title;
    document.querySelector('meta[name="description"]').setAttribute('content', desc);
    document.getElementById('dynamic-title').innerText = `${area}の検索結果`;
}

// 🆕 エリアをセットしてURLを書き換える
function setArea(areaName) {
    const newUrl = `${window.location.pathname}?area=${encodeURIComponent(areaName)}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
    
    currentArea = areaName;
    updateSEOMeta(areaName);
    document.getElementById('map-navigation').style.display = 'none';
    document.getElementById('keyword').value = areaName;
    fetchHotels();
}