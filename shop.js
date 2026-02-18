//
const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 

// ★★★ グロック流：自動ログインを完全に封鎖する設定 ★★★
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: false,     // セッションを保存しない
        detectSessionInUrl: false, // URLのハッシュからの自動ログインを無効化
        autoRefreshToken: true
    }
});

let isLoginMode = false;
let selectedHotelId = null;
let feedbackStatus = null;

// -----------------------------------------
// 1. 初期ロード処理（認証成功の検知）
// -----------------------------------------
window.onload = async function() {
    // 全てのセクションを一旦非表示
    const sections = ['auth-section', 'profile-registration', 'pending-section', 'shop-main-section'];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // ★ 新規：メール確認リンクから戻ってきたかを判定 ★
    const hash = window.location.hash;
    if (hash.includes('access_token') || hash.includes('type=signup')) {
        // 緑色の成功メッセージを表示
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = 'background: #d4edda; color: #155724; padding: 15px; margin: 20px auto; max-width: 500px; border-radius: 8px; text-align: center; border: 1px solid #c3e6cb;';
        messageDiv.innerHTML = `
            <h3 style="margin-top:0;">✅ メール認証が完了しました！</h3>
            <p style="margin-bottom:0;">店舗アカウントの確認に成功しました。<br>
            下記のフォームからログインして登録を進めてください。</p>
        `;
        document.body.insertBefore(messageDiv, document.getElementById('auth-section'));
        
        // URLのハッシュを消して見た目をきれいにする
        history.replaceState(null, null, window.location.pathname);
    }

    // セッション確認
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        showElement('auth-section');
    } else if (!session.user.email_confirmed_at) {
        // メール未確認ならログアウトさせて戻す
        await supabaseClient.auth.signOut();
        showElement('auth-section');
    } else {
        // ログイン済み ＋ 確認済みならステータスチェックへ
        checkShopStatus(session.user);
    }
};

function showElement(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block';
}

// -----------------------------------------
// 2. 認証処理（ログイン・登録）
// -----------------------------------------
async function handleAuth() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;

    if (!email || !password) return alert('入力してください');

    try {
        if (isLoginMode) {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;

            if (data.user.email_confirmed_at) {
                checkShopStatus(data.user);
            } else {
                alert('メール確認が終わっていません。');
                await supabaseClient.auth.signOut();
            }
        } else {
            // 新規登録
            const { error } = await supabaseClient.auth.signUp({
                email, password,
                options: { emailRedirectTo: window.location.origin + window.location.pathname }
            });
            if (error) throw error;
            alert('登録確認メールを送りました。');
            if (!isLoginMode) toggleAuthMode();
        }
    } catch (error) {
        alert('エラー: ' + error.message);
    }
}

// -----------------------------------------
// 3. 以降、店舗ステータスチェックや投稿機能（省略せず保持）
// -----------------------------------------
async function checkShopStatus(user) {
    const { data: shop } = await supabaseClient.from('shops').select('*').eq('id', user.id).single();
    document.getElementById('auth-section').style.display = 'none';
    if (!shop) { showElement('profile-registration'); }
    else if (shop.is_approved === false) { showElement('pending-section'); }
    else {
        showElement('shop-main-section');
        const planText = shop.plan === 'paid' ? '有料掲載' : '無料掲載';
        document.getElementById('plan-display').innerHTML = `プラン: ${planText}<br>管理メール: ${shop.email}`;
    }
}

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').textContent = isLoginMode ? '店舗ログイン' : '店舗新規登録';
    document.getElementById('auth-btn').textContent = isLoginMode ? 'ログイン' : '登録メールを送信';
}

async function logout() { await supabaseClient.auth.signOut(); location.reload(); }
// ...その他UI用関数（togglePasswordVisibility等）...