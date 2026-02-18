//
const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: false,     // セッションを保存しない
        detectSessionInUrl: false, // 自動ログインを防止
        autoRefreshToken: true
    }
});

let isLoginMode = false; // 初期は登録モード

window.onload = async function() {
    // 1. 全て隠す
    const sections = ['auth-section', 'profile-registration', 'pending-section', 'shop-main-section'];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // 2. メール承認リンクから来たか判定
    const hash = window.location.hash;
    if (hash.includes('access_token') || hash.includes('type=signup')) {
        const msgDiv = document.getElementById('verify-success-msg');
        msgDiv.style.cssText = 'background: #d4edda; color: #155724; padding: 20px; margin: 20px auto; max-width: 500px; border-radius: 8px; text-align: center; border: 1px solid #c3e6cb; display: block; font-weight:bold;';
        msgDiv.innerHTML = `✅ メール認証に成功しました！<br><span style="font-weight:normal; font-size:13px;">アカウントが有効になりました。以下からログインしてください。</span>`;
        
        // ★強制的にログインモードへセット
        setAuthMode('login');
        
        history.replaceState(null, null, window.location.pathname);
    } else {
        // 通常時は登録モードからスタート
        setAuthMode('signup');
    }

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        showElement('auth-section');
    } else {
        checkShopStatus(session.user);
    }
};

// モードを明示的にセットする関数
function setAuthMode(mode) {
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('auth-btn');
    const link = document.getElementById('switch-link');
    const text = document.getElementById('switch-text');
    const badge = document.getElementById('mode-badge');

    if (mode === 'login') {
        isLoginMode = true;
        title.textContent = '店舗ログイン';
        btn.textContent = 'ログイン';
        text.textContent = 'まだ登録がお済みでないですか？';
        link.textContent = '新規登録画面へ';
        badge.textContent = '現在のモード: ログイン';
        badge.style.background = '#e7f3ff';
        badge.style.color = '#007aff';
    } else {
        isLoginMode = false;
        title.textContent = '店舗新規登録';
        btn.textContent = '登録メールを送信';
        text.textContent = '既にアカウントをお持ちですか？';
        link.textContent = 'ログイン画面へ';
        badge.textContent = '現在のモード: 新規登録';
        badge.style.background = '#eee';
        badge.style.color = '#666';
    }
}

// リンククリック時の切り替え用
function toggleAuthMode() {
    setAuthMode(isLoginMode ? 'signup' : 'login');
}

// 認証ボタン押下時
async function handleAuth() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;

    if (!email || !password) return alert('入力してください');

    try {
        if (isLoginMode) {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) {
                alert("ログイン失敗: メールアドレスまたはパスワードが違います。");
                return;
            }
            checkShopStatus(data.user);
        } else {
            const { error } = await supabaseClient.auth.signUp({
                email, password,
                options: { emailRedirectTo: window.location.origin + window.location.pathname }
            });
            if (error) throw error;
            alert('確認メールを送信しました。承認後にログインしてください。');
            setAuthMode('login'); // 送信後はログイン画面で待機
        }
    } catch (error) {
        alert('エラー: ' + error.message);
    }
}

// 他の関数（checkShopStatus, submitProfile等）は変更なしで継続