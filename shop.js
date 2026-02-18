const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let isLoginMode = false;

window.onload = async function() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        checkShopStatus(session.user);
    }
};

// 認証モードの切り替え
function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? "店舗ログイン" : "店舗新規登録";
    document.getElementById('auth-btn').innerText = isLoginMode ? "ログイン" : "登録メールを送信";
}

function togglePasswordVisibility() {
    const pwdInput = document.getElementById('auth-password');
    pwdInput.type = document.getElementById('show-password').checked ? "text" : "password";
}

// ログイン・登録処理
async function handleAuth() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    if (isLoginMode) {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) alert(error.message); else location.reload();
    } else {
        const { error } = await supabaseClient.auth.signUp({ email, password });
        if (error) alert(error.message); else alert("確認メールを送信しました。");
    }
}

async function logout() {
    await supabaseClient.auth.signOut();
    location.reload();
}

// ★ 審査ステータスの判定ロジック
async function checkShopStatus(user) {
    const { data: shop } = await supabaseClient
        .from('shops')
        .select('*')
        .eq('id', user.id)
        .single();

    document.getElementById('auth-section').style.display = "none";

    if (!shop) {
        // 未登録：プロフィール入力画面へ
        document.getElementById('profile-registration').style.display = "block";
    } else if (shop.is_approved === false) {
        // 審査中：待機画面へ
        document.getElementById('pending-section').style.display = "block";
    } else {
        // 承認済み：メインパネルへ
        document.getElementById('shop-main-section').style.display = "block";
        document.getElementById('plan-display').innerText = `プラン: ${shop.plan === 'paid' ? '有料掲載' : '無料掲載'}`;
        const baseUrl = window.location.origin + window.location.pathname.replace('shop.html', 'portal.html');
        document.getElementById('dedicated-url').value = `${baseUrl}?shop_id=${user.id}`;
    }
}

// プロフィール登録 ＆ 書類アップロード
async function submitProfile() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const name = document.getElementById('reg-shop-name').value;
    const url = document.getElementById('reg-shop-url').value;
    const phone = document.getElementById('reg-shop-phone').value;
    const file = document.getElementById('reg-document').files[0];

    if (!name || !file) return alert("店舗名と書類は必須です");

    // 1. Storageバケット 'documents' に保存
    const fileExt = file.name.split('.').pop();
    const filePath = `${session.user.id}/${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabaseClient.storage
        .from('documents')
        .upload(filePath, file);

    if (uploadError) return alert("書類のアップロードに失敗しました。Storage設定を確認してください。");

    // 2. shopsテーブルにデータを挿入
    const { error } = await supabaseClient.from('shops').insert([{
        id: session.user.id,
        name: name,
        url: url,
        phone: phone,
        document_url: filePath,
        is_approved: false
    }]);

    if (error) alert("データ保存エラー"); else location.reload();
}