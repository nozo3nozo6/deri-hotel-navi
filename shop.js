const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

window.onload = async function() {
    // 1. 起動時、念のため全ての要素を非表示のままにする
    document.querySelectorAll('.js-hide').forEach(el => el.style.display = 'none');

    // 2. ログイン状態を確認
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        // 【未ログイン】→ 100%確実に「メール/パス」画面を出す
        showElement('auth-section');
    } else {
        // 【ログイン済み】→ 次のステップへ誘導
        if (session.user.email_confirmed_at) {
            checkShopStatus(session.user);
        } else {
            // メール未認証なら追い出す
            await supabaseClient.auth.signOut();
            showElement('auth-section');
        }
    }
};

function showElement(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('js-hide');
        el.style.display = 'block';
    }
}

// ... 以前の checkShopStatus, handleAuth, submitProfile 等 ...

async function logout() {
    await supabaseClient.auth.signOut();
    localStorage.clear(); // ブラウザの全記憶を消去
    location.reload();
}
// shop.js の window.onload の一番上にこれを1行だけ追加してください
// 一度読み込んでログイン画面が出たら、この行は消して大丈夫です！
await supabaseClient.auth.signOut(); localStorage.clear();