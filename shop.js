const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; //
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let isLoginMode = false;
let selectedHotelId = null;
let feedbackStatus = null;

// 初期化：ログイン状態のチェック
window.onload = async function() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        showShopSection(session.user);
    }
};

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? "店舗ログイン" : "店舗新規登録（無料）";
    document.getElementById('auth-btn').innerText = isLoginMode ? "ログイン" : "登録メールを送信";
}

// 会員登録・ログイン処理
async function handleAuth() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const shopName = document.getElementById('email-shop-name').value;

    if (isLoginMode) {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) alert("ログイン失敗: " + error.message);
        else location.reload();
    } else {
        const { error } = await supabaseClient.auth.signUp({ 
            email, 
            password,
            options: { data: { shop_name: shopName } }
        });
        if (error) alert("登録失敗: " + error.message);
        else alert("確認メールを送信しました。承認後にログイン可能になります。");
    }
}

async function logout() {
    await supabaseClient.auth.signOut();
    location.reload();
}

// ログイン成功後の表示
function showShopSection(user) {
    document.getElementById('auth-section').style.display = "none";
    document.getElementById('shop-section').style.display = "block";
    
    // 専用URLを生成 (portal.html?shop_id=ユーザーID)
    const baseUrl = window.location.origin + window.location.pathname.replace('shop.html', 'portal.html');
    document.getElementById('dedicated-url').value = `${baseUrl}?shop_id=${user.id}`;
}

// ホテル検索 & フィードバック（前回のロジックを継承）
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
        div.onclick = () => {
            selectedHotelId = h.id;
            document.getElementById('selected-hotel-name').innerText = h.name;
            document.getElementById('feedback-form').style.display = "block";
            resDiv.innerHTML = '';
        };
        resDiv.appendChild(div);
    });
}

function setOkNg(isOk) { feedbackStatus = isOk; alert(isOk ? "YESを選択" : "NOを選択"); }

async function submitFeedback() {
    if(!selectedHotelId || feedbackStatus === null) return alert("情報を選択してください");
    const { data: { session } } = await supabaseClient.auth.getSession();
    const comment = document.getElementById('hotel-comment').value;

    // 投稿内容をDBに記録（hotelsテーブルのposted_by列にshop_idを記録する想定）
    // 実際には専用の feedback テーブルに保存し、app.js でそれを読み込むのがベスト
    const { error } = await supabaseClient.from('hotels').update({
        description: comment,
        last_posted_by: session.user.id, // 誰が投稿したかを記録
        [feedbackStatus ? 'men_ok' : 'men_ng']: 1 // カウントアップ（簡易版）
    }).eq('id', selectedHotelId);

    if (error) alert("更新エラー");
    else alert("投稿完了！専用URLに反映されました。");
}