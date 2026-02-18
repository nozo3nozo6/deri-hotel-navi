// ==================== shop.js (修正済み・完全版) ====================

const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: false,      // 毎回ログイン必須
        detectSessionInUrl: true,   // メール承認リンクを正しく処理
        autoRefreshToken: true
    }
});

// ====================== パスワード表示切り替え ======================
function togglePasswordVisibility() {
    const pwdInput = document.getElementById('auth-password');
    if (pwdInput) {
        pwdInput.type = (pwdInput.type === 'password') ? 'text' : 'password';
    }
}

// ====================== ページ読み込み時 ======================
window.onload = async function() {
    // 全てのセクションを一旦非表示
    ['auth-section', 'profile-registration', 'pending-section', 'shop-main-section'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // メール承認リンクから戻ってきた場合の処理
    const hash = window.location.hash;
    if (hash.includes('access_token') || hash.includes('type=signup')) {
        const msgDiv = document.getElementById('verify-success-msg');
        msgDiv.style.display = 'block';
        msgDiv.innerHTML = `
            <div style="background:#d4edda; color:#155724; padding:20px; border-radius:8px; margin:20px auto; max-width:400px; text-align:center;">
                ✅ <strong>メール認証が完了しました！</strong><br>
                下のフォームからログインしてください。
            </div>
        `;
        history.replaceState(null, null, window.location.pathname); // URLをきれいにする

        // 自動ログインされたセッションを即削除（手動ログインを強制）
        await supabaseClient.auth.signOut();
    }

    // 現在のセッションを確認
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && session.user?.email_confirmed_at) {
        checkShopStatus(session.user);
    } else {
        // 未ログイン → ログイン画面を表示
        document.getElementById('auth-section').style.display = 'block';
    }
};

// ====================== 新規登録 ======================
async function handleSignUp() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;

    if (!email || password.length < 6) {
        return alert('メールアドレスと6文字以上のパスワードを入力してください');
    }

    try {
        const { error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: window.location.origin + window.location.pathname
            }
        });
        if (error) throw error;
        alert('✅ 登録確認メールを送信しました！\nメール内のリンクをクリックしてから、ここに戻ってログインしてください。');
    } catch (error) {
        alert('登録エラー: ' + error.message);
    }
}

// ====================== ログイン ======================
async function handleLogin() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;

    if (!email || !password) {
        return alert('メールアドレスとパスワードを入力してください');
    }

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) {
            if (error.message.includes('Invalid login credentials')) {
                alert('メールアドレスまたはパスワードが違います');
            } else if (error.message.includes('Email not confirmed')) {
                alert('メール認証が完了していません。届いたメールのリンクをクリックしてください。');
            } else {
                alert('ログイン失敗: ' + error.message);
            }
            return;
        }

        // ログイン成功 → 店舗画面へ
        document.getElementById('auth-section').style.display = 'none';
        checkShopStatus(data.user);
    } catch (error) {
        alert('予期せぬエラー: ' + error.message);
    }
}

// ====================== 以降は変更なし ======================
async function checkShopStatus(user) {
    const { data: shop } = await supabaseClient.from('shops').select('*').eq('id', user.id).single();
    
    document.getElementById('verify-success-msg').style.display = 'none';

    if (!shop) {
        document.getElementById('profile-registration').style.display = 'block';
    } else if (shop.is_approved === false) {
        document.getElementById('pending-section').style.display = 'block';
    } else {
        document.getElementById('shop-main-section').style.display = 'block';
        const planText = shop.plan === 'paid' ? '有料掲載' : '無料掲載';
        document.getElementById('plan-display').innerHTML = `プラン: ${planText}<br>管理メール: ${shop.email}`;
        
        const baseUrl = window.location.origin + window.location.pathname.replace('shop.html', 'portal.html');
        document.getElementById('dedicated-url').value = `${baseUrl}?shop_id=${user.id}`;
    }
}

function showElement(id) {
    document.getElementById(id).style.display = 'block';
}

async function logout() {
    await supabaseClient.auth.signOut();
    location.reload();
}

async function submitProfile() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const name = document.getElementById('reg-shop-name').value.trim();
    const url = document.getElementById('reg-shop-url').value.trim();
    const phone = document.getElementById('reg-shop-phone').value.trim();
    const file = document.getElementById('reg-document').files[0];

    if (!name || !file) return alert("店舗名と届出確認書は必須です");

    const fileExt = file.name.split('.').pop();
    const filePath = `${session.user.id}/${Date.now()}.${fileExt}`;

    const { error: upErr } = await supabaseClient.storage.from('documents').upload(filePath, file);
    if (upErr) return alert("ファイルアップロード失敗");

    const { error } = await supabaseClient.from('shops').insert([{
        id: session.user.id,
        name,
        url,
        phone,
        document_url: filePath,
        is_approved: false,
        email: session.user.email
    }]);

    if (error) alert("保存失敗"); else location.reload();
}

// 投稿関連関数（変更なし）
let selectedHotelId = null;
let feedbackStatus = null;

async function searchHotelsForFeedback() { /* 省略せずそのまま */ 
    const kw = document.getElementById('hotel-search').value.trim();
    if (kw.length < 2) return;
    const { data } = await supabaseClient.from('hotels').select('*').ilike('name', `%${kw}%`).limit(5);
    const resDiv = document.getElementById('search-results');
    resDiv.innerHTML = '';
    data.forEach(h => {
        const div = document.createElement('div');
        div.style = "padding:10px; border-bottom:1px solid #eee; cursor:pointer;";
        div.textContent = h.name;
        div.onclick = () => {
            selectedHotelId = h.id;
            document.getElementById('selected-hotel-name').textContent = h.name;
            document.getElementById('feedback-form').style.display = 'block';
            resDiv.innerHTML = '';
        };
        resDiv.appendChild(div);
    });
}

function setOkNg(isOk) { feedbackStatus = isOk; alert(isOk ? "✅ 呼べる を選択しました" : "❌ 不可 を選択しました"); }

async function submitFeedback() {
    if (!selectedHotelId || feedbackStatus === null) return alert("呼べる/不可を選択してください");
    const comm = document.getElementById('hotel-comment').value.trim();
    const { data: { session } } = await supabaseClient.auth.getSession();
    const { error } = await supabaseClient.from('hotels')
        .update({ description: comm, last_posted_by: session.user.id })
        .eq('id', selectedHotelId);
    if (error) alert("投稿エラー"); else { alert("投稿完了！"); location.reload(); }
}