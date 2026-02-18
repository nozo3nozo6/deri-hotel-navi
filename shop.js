const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let isLoginMode = false;
let selectedHotelId = null;
let feedbackStatus = null;

window.onload = async function() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) checkShopStatus(session.user);
};

// -----------------------------------------
// 画面切り替えと審査ステータス判定
// -----------------------------------------
async function checkShopStatus(user) {
    const { data: shop } = await supabaseClient
        .from('shops')
        .select('*')
        .eq('id', user.id)
        .single();

    document.getElementById('auth-section').style.display = "none";

    if (!shop) {
        document.getElementById('profile-registration').style.display = "block";
    } else if (shop.is_approved === false) {
        document.getElementById('pending-section').style.display = "block";
    } else {
        document.getElementById('shop-main-section').style.display = "block";
        const planText = shop.plan === 'paid' ? '有料掲載' : '無料掲載';
        document.getElementById('plan-display').innerHTML = 
            `プラン: ${planText}<br><span style="font-size:12px; color:#666;">管理用メール: ${shop.email || '確認中'}</span>`;
        
        const baseUrl = window.location.origin + window.location.pathname.replace('shop.html', 'portal.html');
        document.getElementById('dedicated-url').value = `${baseUrl}?shop_id=${user.id}`;
    }
}

// -----------------------------------------
// 認証 (Auth) 処理
// -----------------------------------------
function togglePasswordVisibility() {
    const pwdInput = document.getElementById('auth-password');
    pwdInput.type = document.getElementById('show-password').checked ? "text" : "password";
}

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? "店舗ログイン" : "店舗新規登録";
    document.getElementById('auth-btn').innerText = isLoginMode ? "ログイン" : "登録メールを送信";
    document.getElementById('switch-link').innerText = isLoginMode ? "新規登録に切り替える" : "ログインに切り替える";
}

async function handleAuth() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    if (!email || !password) return alert("入力してください");

    if (isLoginMode) {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) alert("失敗: " + error.message); else location.reload();
    } else {
        const { error } = await supabaseClient.auth.signUp({ email, password });
        if (error) alert("エラー: " + error.message); else alert("確認メールを送信しました。");
    }
}

async function logout() { await supabaseClient.auth.signOut(); location.reload(); }

// -----------------------------------------
// プロフィール登録・書類アップ
// -----------------------------------------
async function submitProfile() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const name = document.getElementById('reg-shop-name').value;
    const url = document.getElementById('reg-shop-url').value;
    const phone = document.getElementById('reg-shop-phone').value;
    const file = document.getElementById('reg-document').files[0];

    if (!name || !file) return alert("店名と書類は必須です");

    const fileExt = file.name.split('.').pop();
    const filePath = `${session.user.id}/${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabaseClient.storage.from('documents').upload(filePath, file);

    if (uploadError) return alert("送信失敗。Storageのポリシーを確認してください。");

    const { error } = await supabaseClient.from('shops').insert([{
        id: session.user.id,
        name: name, url: url, phone: phone,
        document_url: filePath, is_approved: false, email: session.user.email
    }]);

    if (error) alert("保存失敗: " + error.message); else location.reload();
}

// -----------------------------------------
// ホテル投稿機能 (承認後のみ)
// -----------------------------------------
async function searchHotelsForFeedback() {
    const kw = document.getElementById('hotel-search').value;
    if(kw.length < 2) return;
    const { data } = await supabaseClient.from('hotels').select('*').ilike('name', `%${kw}%`).limit(5);
    const resDiv = document.getElementById('search-results');
    resDiv.innerHTML = '';
    data.forEach(h => {
        const div = document.createElement('div');
        div.style = "padding: 10px; border-bottom: 1px solid #eee; cursor: pointer; font-size:14px; background:#fff;";
        div.innerText = h.name;
        div.onclick = () => {
            selectedHotelId = h.id;
            document.getElementById('selected-hotel-name').innerText = "対象: " + h.name;
            document.getElementById('feedback-form').style.display = "block";
            resDiv.innerHTML = '';
        };
        resDiv.appendChild(div);
    });
}

function setOkNg(isOk) { feedbackStatus = isOk; alert(isOk ? "YESを選択" : "NOを選択"); }

async function submitFeedback() {
    if(!selectedHotelId || feedbackStatus === null) return alert("内容を確認してください");
    const comment = document.getElementById('hotel-comment').value;
    const { data: { session } } = await supabaseClient.auth.getSession();
    const { error } = await supabaseClient.from('hotels').update({
        description: comment, last_posted_by: session.user.id
    }).eq('id', selectedHotelId);
    if (error) alert("失敗"); else { alert("投稿完了！"); location.reload(); }
}