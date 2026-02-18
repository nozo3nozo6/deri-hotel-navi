const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 

//
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: false,     // 毎回ログインを強制
        detectSessionInUrl: false, // URLハッシュからの自動ログインを防止
        autoRefreshToken: true
    }
});

let isLoginMode = false;
let selectedHotelId = null;
let feedbackStatus = null;

// -----------------------------------------
// 1. 初期ロード処理
// -----------------------------------------
window.onload = async function() {
    // 全てを隠す初期化
    const sections = ['auth-section', 'profile-registration', 'pending-section', 'shop-main-section'];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // ★認証成功ハッシュの検知ロジック
    const hash = window.location.hash;
    if (hash.includes('access_token') || hash.includes('type=signup')) {
        const msgDiv = document.getElementById('verify-success-msg');
        msgDiv.style.cssText = 'background: #d4edda; color: #155724; padding: 15px; margin: 20px auto; max-width: 500px; border-radius: 8px; text-align: center; border: 1px solid #c3e6cb; display: block;';
        msgDiv.innerHTML = `<h3>✅ メール認証が完了しました！</h3><p>下記からログインしてください。</p>`;
        
        // 成功時はログインモードへ切り替え
        if (!isLoginMode) toggleAuthMode(); 
        history.replaceState(null, null, window.location.pathname);
    }

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        showElement('auth-section');
    } else {
        checkShopStatus(session.user);
    }
};

// -----------------------------------------
// 2. 認証処理
// -----------------------------------------
async function handleAuth() {
    const emailInput = document.getElementById('auth-email');
    const passInput = document.getElementById('auth-password');
    const email = emailInput.value.trim();
    const password = passInput.value;

    if (!email || !password) return alert('入力してください');

    try {
        if (isLoginMode) {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) {
                // 日本語エラーの出し分け
                if (error.message === "Invalid login credentials") {
                    alert("メールアドレスまたはパスワードが違います。");
                } else if (error.message === "Email not confirmed") {
                    alert("メールの承認が完了していません。");
                } else {
                    alert("ログイン失敗: " + error.message);
                }
                return;
            }
            checkShopStatus(data.user);
        } else {
            const { error } = await supabaseClient.auth.signUp({
                email, password,
                options: { emailRedirectTo: window.location.origin + window.location.pathname }
            });
            if (error) throw error;
            alert('確認メールを送信しました。メール内リンクをクリックしてください。');
            toggleAuthMode();
        }
    } catch (error) {
        alert('エラー: ' + error.message);
    }
}

// -----------------------------------------
// 3. 審査ステータス判定
// -----------------------------------------
async function checkShopStatus(user) {
    const { data: shop } = await supabaseClient.from('shops').select('*').eq('id', user.id).single();
    
    document.getElementById('auth-section').style.display = 'none';
    const successMsg = document.getElementById('verify-success-msg');
    if (successMsg) successMsg.style.display = 'none';

    if (!shop) {
        showElement('profile-registration');
    } else if (shop.is_approved === false) {
        showElement('pending-section');
    } else {
        showElement('shop-main-section');
        const planText = shop.plan === 'paid' ? '有料掲載' : '無料掲載';
        document.getElementById('plan-display').innerHTML = `プラン: ${planText}<br>管理メール: ${shop.email}`;
        
        const baseUrl = window.location.origin + window.location.pathname.replace('shop.html', 'portal.html');
        document.getElementById('dedicated-url').value = `${baseUrl}?shop_id=${user.id}`;
    }
}

// -----------------------------------------
// 共通関数
// -----------------------------------------
function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').textContent = isLoginMode ? '店舗ログイン' : '店舗新規登録';
    document.getElementById('auth-btn').textContent = isLoginMode ? 'ログイン' : '登録メールを送信';
    document.getElementById('switch-link').textContent = isLoginMode ? '新規登録に切り替える' : 'ログインに切り替える';
}

function showElement(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block';
}

function togglePasswordVisibility() {
    const pwdInput = document.getElementById('auth-password');
    pwdInput.type = document.getElementById('show-password').checked ? "text" : "password";
}

async function logout() { await supabaseClient.auth.signOut(); location.reload(); }

// -----------------------------------------
// 4. プロフィール登録・ホテル投稿（既存維持）
// -----------------------------------------
async function submitProfile() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const name = document.getElementById('reg-shop-name').value;
    const url = document.getElementById('reg-shop-url').value;
    const phone = document.getElementById('reg-shop-phone').value;
    const file = document.getElementById('reg-document').files[0];

    if (!name || !file) return alert("必須項目を埋めてください");

    const fileExt = file.name.split('.').pop();
    const filePath = `${session.user.id}/${Date.now()}.${fileExt}`;
    const { error: upErr } = await supabaseClient.storage.from('documents').upload(filePath, file);
    if (upErr) return alert("アップロード失敗");

    const { error } = await supabaseClient.from('shops').insert([{
        id: session.user.id, name, url, phone, document_url: filePath, is_approved: false, email: session.user.email
    }]);

    if (error) alert("データ保存失敗"); else location.reload();
}

async function searchHotelsForFeedback() {
    const kw = document.getElementById('hotel-search').value;
    if(kw.length < 2) return;
    const { data } = await supabaseClient.from('hotels').select('*').ilike('name', `%${kw}%`).limit(5);
    const resDiv = document.getElementById('search-results');
    resDiv.innerHTML = '';
    data.forEach(h => {
        const div = document.createElement('div');
        div.style = "padding:10px; border-bottom:1px solid #eee; cursor:pointer; background:#fff;";
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
    if(!selectedHotelId || feedbackStatus === null) return alert("未入力");
    const comm = document.getElementById('hotel-comment').value;
    const { data: { session } } = await supabaseClient.auth.getSession();
    const { error } = await supabaseClient.from('hotels').update({ description: comm, last_posted_by: session.user.id }).eq('id', selectedHotelId);
    if (error) alert("エラー"); else { alert("投稿完了"); location.reload(); }
}