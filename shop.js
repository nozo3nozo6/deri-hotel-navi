const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let isLoginMode = false;
let selectedHotelId = null;
let feedbackStatus = null;

// ページ読み込み時にログイン状態と審査状況をチェック
window.onload = async function() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        checkShopStatus(session.user);
    }
};

// -----------------------------------------
// 1. 審査ステータス判定（メール表示追加分）
// -----------------------------------------
async function checkShopStatus(user) {
    // shopsテーブルから店舗情報を取得
    const { data: shop } = await supabaseClient
        .from('shops')
        .select('*')
        .eq('id', user.id)
        .single();

    document.getElementById('auth-section').style.display = "none";

    if (!shop) {
        // A. プロフィール未登録の場合
        document.getElementById('profile-registration').style.display = "block";
    } else if (shop.is_approved === false) {
        // B. 運営の承認待ち（is_approved: false）の場合
        document.getElementById('pending-section').style.display = "block";
    } else {
        // C. 承認済みの場合：メインパネルを表示
        document.getElementById('shop-main-section').style.display = "block";
        
        // プラン情報とメールアドレスを表示（ご要望の追加箇所）
        const planText = shop.plan === 'paid' ? '有料掲載' : '無料掲載';
        const planEl = document.getElementById('plan-display');
        planEl.innerHTML = `現在のプラン: <strong>${planText}</strong>`;
        planEl.innerHTML += `<br><span style="font-size:12px; color:#666;">登録メール: ${shop.email || '未設定'}</span>`;

        // 専用URLの生成
        const baseUrl = window.location.origin + window.location.pathname.replace('shop.html', 'portal.html');
        document.getElementById('dedicated-url').value = `${baseUrl}?shop_id=${user.id}`;
    }
}

// -----------------------------------------
// 2. プロフィール登録 ＆ 書類アップロード
// -----------------------------------------
async function submitProfile() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const name = document.getElementById('reg-shop-name').value;
    const url = document.getElementById('reg-shop-url').value;
    const phone = document.getElementById('reg-shop-phone').value;
    const file = document.getElementById('reg-document').files[0];

    if (!name || !file) return alert("店舗名と書類は必須です");

    // 書類をStorageの'documents'バケットへ保存
    const fileExt = file.name.split('.').pop();
    const filePath = `${session.user.id}/${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabaseClient.storage
        .from('documents')
        .upload(filePath, file);

    if (uploadError) return alert("書類の送信に失敗しました");

    // shopsテーブルに新規レコードを挿入
    const { error } = await supabaseClient.from('shops').insert([{
        id: session.user.id,
        name: name,
        url: url,
        phone: phone,
        document_url: filePath,
        is_approved: false,
        // emailはSQLのトリガーで自動同期される設定ですが、念のためJSでも送信可能
        email: session.user.email 
    }]);

    if (error) alert("登録エラーが発生しました");
    else location.reload();
}

// -----------------------------------------
// 3. 認証関連（ログイン・登録・ログアウト）
// -----------------------------------------
function togglePasswordVisibility() {
    const pwdInput = document.getElementById('auth-password');
    pwdInput.type = document.getElementById('show-password').checked ? "text" : "password";
}

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? "店舗ログイン" : "店舗新規登録";
    document.getElementById('auth-btn').innerText = isLoginMode ? "ログイン" : "登録メールを送信";
}

async function handleAuth() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    if (!email || !password) return alert("入力してください");

    if (isLoginMode) {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) alert("ログイン失敗: " + error.message);
        else location.reload();
    } else {
        const { error } = await supabaseClient.auth.signUp({ email, password });
        if (error) alert("登録エラー: " + error.message);
        else alert("確認メールを送信しました。メール内のリンクをクリックして承認してください。");
    }
}

async function logout() {
    await supabaseClient.auth.signOut();
    location.reload();
}

// -----------------------------------------
// 4. ホテル検索・フィードバック投稿
// -----------------------------------------
async function searchHotelsForFeedback() {
    const kw = document.getElementById('hotel-search').value;
    if(kw.length < 2) return;
    const { data } = await supabaseClient.from('hotels').select('*').ilike('name', `%${kw}%`).limit(5);
    const resDiv = document.getElementById('search-results');
    resDiv.innerHTML = '';
    data.forEach(h => {
        const div = document.createElement('div');
        div.style = "padding: 10px; border-bottom: 1px solid #eee; cursor: pointer; font-size:14px;";
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

function setOkNg(isOk) { feedbackStatus = isOk; alert(isOk ? "呼べる(YES)を選択" : "不可(NO)を選択"); }

async function submitFeedback() {
    if(!selectedHotelId || feedbackStatus === null) return alert("ホテル選択とYES/NOを選択してください");
    const comment = document.getElementById('hotel-comment').value;
    const { data: { session } } = await supabaseClient.auth.getSession();

    const { error } = await supabaseClient.from('hotels').update({
        description: comment,
        last_posted_by: session.user.id
    }).eq('id', selectedHotelId);

    if (error) alert("投稿エラー");
    else {
        alert("情報を更新しました！");
        location.reload();
    }
}