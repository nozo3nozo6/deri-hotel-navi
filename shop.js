const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

window.onload = async function() {
    // 全て隠す
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('profile-registration').style.display = 'none';
    document.getElementById('pending-section').style.display = 'none';
    document.getElementById('shop-main-section').style.display = 'none';

    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        // 未ログインなら登録画面へ
        document.getElementById('auth-section').style.display = 'block';
    } else {
        // ログイン中の場合、メール認証が済んでいるか確認
        if (session.user.email_confirmed_at) {
            checkShopStatus(session.user);
        } else {
            // メール認証がまだなら強制ログアウトさせてログイン画面へ戻す
            await supabaseClient.auth.signOut();
            document.getElementById('auth-section').style.display = 'block';
            alert("メール認証を完了させてからログインしてください。");
        }
    }
};

async function checkShopStatus(user) {
    const { data: shop } = await supabaseClient
        .from('shops')
        .select('*')
        .eq('id', user.id)
        .single();

    if (!shop) {
        document.getElementById('profile-registration').style.display = "block";
    } else if (shop.is_approved === false) {
        document.getElementById('pending-section').style.display = "block";
    } else {
        document.getElementById('shop-main-section').style.display = "block";
    }
}

async function logout() {
    await supabaseClient.auth.signOut();
    location.reload();
}

// ... handleAuth などの他の関数は変更なし ...