//
const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 

// ★★★ セキュリティ設定：自動ログインを完全に無効化 ★★★
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: false,     // ブラウザを閉じたりリロードするとセッション破棄
        detectSessionInUrl: false, // メールリンクからの自動ログインを防止
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
    // 全てのセクションを一旦隠す（初期化）
    const sections = ['auth-section', 'profile-registration', 'pending-section', 'shop-main-section'];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // セッション確認
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        // 未ログイン → ログイン/登録画面を表示
        showElement('auth-section');
    } else if (!session.user.email_confirmed_at) {
        // メール未確認 → 強制ログアウトして戻す
        await supabaseClient.auth.signOut();
        alert('メールアドレスの承認が必要です。');
        showElement('auth-section');
    } else {
        // ログイン済み ＋ メール確認済み → 店舗ステータスチェックへ
        checkShopStatus(session.user);
    }
};

// 表示切り替え用ヘルパー
function showElement(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block';
}

// -----------------------------------------
// 2. 認証 (Auth) 処理
// -----------------------------------------
function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').textContent = isLoginMode ? '店舗ログイン' : '店舗新規登録';
    document.getElementById('auth-btn').textContent = isLoginMode ? 'ログイン' : '登録メールを送信';
    document.getElementById('switch-link').textContent = isLoginMode ? '新規登録に切り替える' : 'ログインに切り替える';
}

async function handleAuth() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;

    if (!email || !password) return alert('メールアドレスとパスワードを入力してください');

    try {
        if (isLoginMode) {
            // ログイン実行
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;

            if (data.user.email_confirmed_at) {
                checkShopStatus(data.user); // 承認済みならステータスチェックへ
            } else {
                alert('メール承認が完了していません。受信メールを確認してください。');
                await supabaseClient.auth.signOut();
            }
        } else {
            // 新規登録（メール送信）
            const { error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: window.location.origin + window.location.pathname 
                }
            });
            if (error) throw error;
            alert('登録確認メールを送信しました。\n承認後、この画面でログインしてください。');
            if (!isLoginMode) toggleAuthMode(); // ログインモードに切り替え
        }
    } catch (error) {
        alert('エラー: ' + error.message);
    }
}

// -----------------------------------------
// 3. 審査ステータス判定（shopsテーブル連動）
// -----------------------------------------
async function checkShopStatus(user) {
    const { data: shop, error } = await supabaseClient
        .from('shops')
        .select('*')
        .eq('id', user.id)
        .single();

    // 認証画面を隠す
    document.getElementById('auth-section').style.display = 'none';

    if (!shop) {
        showElement('profile-registration');
    } else if (shop.is_approved === false) {
        showElement('pending-section');
    } else {
        showElement('shop-main-section');
        const planText = shop.plan === 'paid' ? '有料掲載' : '無料掲載';
        document.getElementById('plan-display').innerHTML = 
            `プラン: ${planText}<br><span style="font-size:12px; color:#666;">管理用メール: ${shop.email}</span>`;
        
        const baseUrl = window.location.origin + window.location.pathname.replace('shop.html', 'portal.html');
        document.getElementById('dedicated-url').value = `${baseUrl}?shop_id=${user.id}`;
    }
}

// プロフィール登録・書類アップ、ログアウト等の既存機能はそのまま維持
async function logout() { await supabaseClient.auth.signOut(); location.reload(); }

function togglePasswordVisibility() {
    const pwdInput = document.getElementById('auth-password');
    pwdInput.type = document.getElementById('show-password').checked ? "text" : "password";
}

// 以下、submitProfile, searchHotelsForFeedback, submitFeedback は前回の内容を継続