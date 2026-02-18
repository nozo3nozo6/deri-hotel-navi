const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; //
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let isLoginMode = false;

window.onload = async function() {
    // 1. まず全てのセクションを一旦隠す（念のため）
    const sections = ['auth-section', 'profile-registration', 'pending-section', 'shop-main-section'];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // 2. ログインセッションを取得
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        // 【未ログイン】ならログイン画面だけを表示
        document.getElementById('auth-section').style.display = 'block';
    } else {
        // 【ログイン中】ならメール認証済みかチェック
        const user = session.user;
        
        if (user.email_confirmed_at) {
            // メール認証済みなら、店舗ステータスのチェックへ進む
            checkShopStatus(user);
        } else {
            // メール認証がまだなら、警告を出してログイン画面に戻す
            alert("メール認証が完了していません。届いたメールのリンクをクリックしてください。");
            await logout(); // 強制的にログアウト状態にして戻す
        }
    }
};

// -----------------------------------------
// 店舗ステータス判定（メール表示込み）
// -----------------------------------------
async function checkShopStatus(user) {
    const { data: shop } = await supabaseClient
        .from('shops')
        .select('*')
        .eq('id', user.id)
        .single();

    if (!shop) {
        // プロフィール未登録（ここがフェーズ2）
        document.getElementById('profile-registration').style.display = "block";
    } else if (shop.is_approved === false) {
        // 審査中（フェーズ3）
        document.getElementById('pending-section').style.display = "block";
    } else {
        // 承認済み（メインパネル）
        document.getElementById('shop-main-section').style.display = "block";
        const planText = shop.plan === 'paid' ? '有料掲載' : '無料掲載';
        const planEl = document.getElementById('plan-display');
        planEl.innerHTML = `現在のプラン: <strong>${planText}</strong><br>` +
                           `<span style="font-size:12px; color:#666;">登録メール: ${shop.email}</span>`;

        const baseUrl = window.location.origin + window.location.pathname.replace('shop.html', 'portal.html');
        document.getElementById('dedicated-url').value = `${baseUrl}?shop_id=${user.id}`;
    }
}

// --- 以下、handleAuth, logout, submitProfile などの関数は前回のまま継続 ---