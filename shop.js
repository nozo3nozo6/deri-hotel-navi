// ==================== shop.js (最新版・保存失敗対策強化) ====================

const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'; 

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: false,      // 毎回ログイン必須にする
        detectSessionInUrl: true,   // メール承認リンク対応
        autoRefreshToken: true
    }
});

let selectedHotelId = null;
let feedbackStatus = null;

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

    // メール承認リンクから来た場合
    const hash = window.location.hash;
    if (hash.includes('access_token') || hash.includes('type=signup')) {
        const msgDiv = document.getElementById('verify-success-msg');
        msgDiv.style.display = 'block';
        msgDiv.innerHTML = `
            <div style="background:#d4edda; color:#155724; padding:20px; border-radius:8px; margin:20px auto; max-width:400px; text-align:center; font-size:15px;">
                ✅ <strong>メール認証が完了しました！</strong><br>
                下のフォームからログインしてください。
            </div>
        `;
        history.replaceState(null, null, window.location.pathname);

        // 自動ログインされたセッションを即削除（手動ログイン強制）
        await supabaseClient.auth.signOut();
    }

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && session.user?.email_confirmed_at) {
        checkShopStatus(session.user);
    } else {
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
        alert('登録確認メールを送信しました。\nメール内のリンクをクリック後、ここに戻ってログインしてください。');
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
                alert('メール認証が完了していません。届いたメールを確認してください。');
            } else {
                alert('ログイン失敗: ' + error.message);
            }
            return;
        }

        document.getElementById('auth-section').style.display = 'none';
        checkShopStatus(data.user);
    } catch (error) {
        alert('予期せぬエラー: ' + error.message);
    }
}

// ====================== 店舗ステータスチェック ======================
async function checkShopStatus(user) {
    const { data: shop, error } = await supabaseClient
        .from('shops')
        .select('*')
        .eq('id', user.id)
        .single();

    document.getElementById('verify-success-msg').style.display = 'none';

    if (error && error.code !== 'PGRST116') {  // PGRST116 = 該当レコードなし
        console.error('ショップ取得エラー:', error);
    }

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

// ====================== 店舗情報登録（ここが問題の箇所） ======================
async function submitProfile() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.user?.id) return alert("ログイン状態を確認できません。再度ログインしてください。");

    const name   = document.getElementById('reg-shop-name')?.value?.trim()   || '';
    const url    = document.getElementById('reg-shop-url')?.value?.trim()    || null;
    const phone  = document.getElementById('reg-shop-phone')?.value?.trim()  || null;
    const file   = document.getElementById('reg-document')?.files?.[0];

    if (!name) return alert("店舗名は必須です");
    if (!file) return alert("届出確認書（画像/PDF）を選択してください");

    try {
        // ファイルアップロード
        const fileExt = file.name.split('.').pop().toLowerCase();
        const filePath = `${session.user.id}/${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabaseClient.storage
            .from('documents')
            .upload(filePath, file, { upsert: true });

        if (uploadError) {
            console.error('ストレージアップロードエラー:', uploadError);
            return alert("ファイルのアップロードに失敗しました\n" + uploadError.message);
        }

        // shopsテーブルへINSERT
        const { error: insertError } = await supabaseClient
            .from('shops')
            .insert([{
                id: session.user.id,
                name,
                url,
                phone,
                document_url: filePath,
                is_approved: false,
                email: session.user.email,
                // 必要に応じて created_at などはSupabase側で自動設定
            }]);

        if (insertError) {
            console.error('shops INSERT エラー:', insertError);
            alert("保存に失敗しました\n" + insertError.message + "\n\n詳細はブラウザの開発者ツール（F12）→ Console タブで確認してください");
            return;
        }

        alert("✅ 審査申請が完了しました！\n運営が確認後、メールでお知らせします。");
        location.reload();

    } catch (err) {
        console.error('予期せぬエラー:', err);
        alert("エラーが発生しました。もう一度お試しください。\n詳細: " + err.message);
    }
}

// ====================== ログアウト ======================
async function logout() {
    await supabaseClient.auth.signOut();
    location.reload();
}

// ====================== ホテル検索・投稿関連（変更なし） ======================
async function searchHotelsForFeedback() {
    const kw = document.getElementById('hotel-search').value.trim();
    if (kw.length < 2) return;

    const { data, error } = await supabaseClient
        .from('hotels')
        .select('*')
        .ilike('name', `%${kw}%`)
        .limit(5);

    if (error) return console.error(error);

    const resDiv = document.getElementById('search-results');
    resDiv.innerHTML = '';

    data.forEach(h => {
        const div = document.createElement('div');
        div.style = "padding:10px; border-bottom:1px solid #eee; cursor:pointer; background:#fff;";
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

function setOkNg(isOk) {
    feedbackStatus = isOk;
    alert(isOk ? "✅ 呼べる を選択しました" : "❌ 不可 を選択しました");
}

async function submitFeedback() {
    if (!selectedHotelId || feedbackStatus === null) {
        return alert("ホテルと呼べる/不可を選択してください");
    }

    const comm = document.getElementById('hotel-comment').value.trim();
    const { data: { session } } = await supabaseClient.auth.getSession();

    const { error } = await supabaseClient
        .from('hotels')
        .update({ 
            description: comm, 
            last_posted_by: session.user.id 
        })
        .eq('id', selectedHotelId);

    if (error) {
        alert("投稿エラー: " + error.message);
    } else {
        alert("投稿完了しました！");
        location.reload();
    }
}