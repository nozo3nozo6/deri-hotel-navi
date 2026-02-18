const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

window.onload = async function() {
    // ログインセッションをチェック
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        // 【ログインしていない】→ ログイン画面を表示
        showSection('auth-section');
    } else {
        // 【ログイン中】→ メール認証が済んでいるか？
        if (session.user.email_confirmed_at) {
            checkShopStatus(session.user);
        } else {
            // メール認証未完了なら強制ログアウトしてログイン画面へ
            await supabaseClient.auth.signOut();
            showSection('auth-section');
            alert("メール認証を完了させてください。");
        }
    }
};

// 指定したIDのセクションだけを表示し、loading-guardを外す関数
function showSection(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('loading-guard');
        el.style.display = 'block';
    }
}

async function checkShopStatus(user) {
    const { data: shop } = await supabaseClient.from('shops').select('*').eq('id', user.id).single();

    if (!shop) {
        showSection('profile-registration');
    } else if (shop.is_approved === false) {
        showSection('pending-section');
    } else {
        showSection('shop-main-section');
    }
}

// ログアウト：これを実行すれば、次回は必ずログイン画面から始まります
async function logout() {
    await supabaseClient.auth.signOut();
    localStorage.clear(); // ローカルの記憶も完全に消去
    location.reload();
}