const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: false,     // 毎回ログイン必須
        detectSessionInUrl: false, // 自動ログイン防止
        autoRefreshToken: true
    }
});

// ページ読み込み時の初期化
window.onload = async function() {
    hideAllSections();
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (session && session.user.email_confirmed_at) {
        checkShopStatus(session.user);
    } else {
        showLogin(); // デフォルトはログイン画面
    }
};

// --- 表示切り替え ---
function hideAllSections() {
    const ids = ['login-section', 'register-section', 'profile-registration', 'pending-section', 'shop-main-section'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

function showLogin() {
    hideAllSections();
    document.getElementById('login-section').style.display = 'block';
}

function showRegister() {
    hideAllSections();
    document.getElementById('register-section').style.display = 'block';
}

// --- 認証処理 ---

// ログイン
async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) return alert('入力してください');

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    
    if (error) {
        alert('ログイン失敗: ' + error.message);
    } else if (!data.user.email_confirmed_at) {
        alert('メール承認が完了していません。');
        await supabaseClient.auth.signOut();
    } else {
        checkShopStatus(data.user);
    }
}

// 新規登録
async function handleRegister() {
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    if (!email || !password) return alert('入力してください');

    const { error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + window.location.pathname }
    });

    if (error) {
        alert('登録エラー: ' + error.message);
    } else {
        alert('登録確認メールを送信しました。\n承認後、ログイン画面からログインしてください。');
        showLogin();
    }
}

// （checkShopStatus, submitProfile 等の以降の関数は前回と同様）