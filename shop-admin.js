function toast(msg,d=2500){const el=document.getElementById("toast");el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),d);}
function showSuccessModal(title,message){document.getElementById('success-modal-title').textContent=title;document.getElementById('success-modal-message').textContent=message||'';document.getElementById('success-modal').style.display='flex';document.body.style.overflow='hidden';}
function closeSuccessModal(){document.getElementById('success-modal').style.display='none';document.body.style.overflow='';}
function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}

// ===== パスワードリセット =====
function showPasswordReset(){document.getElementById("pw-reset-card").style.display="block";document.getElementById("login-form").closest(".login-card").style.display="none";}
function hidePasswordReset(){document.getElementById("pw-reset-card").style.display="none";document.getElementById("login-form").closest(".login-card").style.display="block";document.getElementById("pw-reset-step1").style.display="block";document.getElementById("pw-reset-step2").style.display="none";document.getElementById("pw-reset-step3").style.display="none";}
let _resetEmail="";
async function sendPasswordReset(){
    const errEl=document.getElementById("reset-error");errEl.style.display="none";
    const email=document.getElementById("reset-email").value.trim();
    if(!email){errEl.textContent="メールアドレスを入力してください";errEl.style.display="block";return;}
    const btn=document.getElementById("reset-send-btn");btn.disabled=true;btn.textContent="送信中...";
    // メールアドレスの存在確認
    try{const lRes=await fetch("/api/shop-auth.php?action=lookup-email&email="+encodeURIComponent(email));const lData=await lRes.json();if(!lData.exists){btn.disabled=false;btn.textContent="リセットメールを送信";errEl.textContent="このメールアドレスは登録されていません";errEl.style.display="block";return;}}catch(e){btn.disabled=false;btn.textContent="リセットメールを送信";errEl.textContent="通信エラー";errEl.style.display="block";return;}
    _resetEmail=email;
    const code=String(Math.floor(100000+Math.random()*900000));
    localStorage.setItem("pw_reset_code",JSON.stringify({code:code,email:email,expires:Date.now()+10*60*1000}));
    const emailBody='<div style="font-family:sans-serif;max-width:520px;margin:0 auto;"><div style="background:#b5627a;padding:24px;text-align:center;border-radius:8px 8px 0 0;"><h1 style="color:#fff;margin:0;font-size:22px;">YobuHo</h1><p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">パスワードリセット</p></div><div style="border:1px solid #e0e0e0;border-top:none;padding:32px 28px;border-radius:0 0 8px 8px;"><p style="font-size:14px;line-height:1.8;">パスワードリセットの認証コードをお知らせします。</p><div style="background:#f8f0f2;padding:20px;border-radius:8px;margin:20px 0;text-align:center;"><p style="margin:0;font-size:36px;font-weight:bold;letter-spacing:8px;color:#b5627a;">'+code+'</p></div><p style="font-size:13px;color:#666;">※ このコードは10分間有効です。<br>※ 心当たりがない場合は無視してください。</p><hr style="border:none;border-top:1px solid #eee;margin:24px 0;"><p style="font-size:12px;color:#999;">このメールは YobuHo (yobuho.com) から自動送信されています。</p></div></div>';
    try{await fetch("/api/send-mail.php",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:email,subject:"【YobuHo】パスワードリセットの認証コード",body:emailBody})});}catch(e){}
    btn.disabled=false;btn.textContent="リセットメールを送信";
    document.getElementById("pw-reset-step1").style.display="none";
    document.getElementById("pw-reset-step2").style.display="block";
}
async function executePasswordReset(){
    const errEl=document.getElementById("reset-step2-error");errEl.style.display="none";
    const inputCode=document.getElementById("reset-code").value.trim();
    const newPw=document.getElementById("reset-new-pw").value;
    const newPw2=document.getElementById("reset-new-pw2").value;
    if(!inputCode){errEl.textContent="認証コードを入力してください";errEl.style.display="block";return;}
    if(!newPw||!newPw2){errEl.textContent="新しいパスワードを入力してください";errEl.style.display="block";return;}
    if(newPw!==newPw2){errEl.textContent="パスワードが一致しません";errEl.style.display="block";return;}
    if(newPw.length<8){errEl.textContent="パスワードは8文字以上にしてください";errEl.style.display="block";return;}
    // コード検証
    const stored=JSON.parse(localStorage.getItem("pw_reset_code")||"null");
    if(!stored){errEl.textContent="認証コードが見つかりません。再度お試しください。";errEl.style.display="block";return;}
    if(Date.now()>stored.expires){localStorage.removeItem("pw_reset_code");errEl.textContent="認証コードの有効期限が切れました。再度お試しください。";errEl.style.display="block";return;}
    if(inputCode!==String(stored.code)){errEl.textContent="認証コードが正しくありません";errEl.style.display="block";return;}
    // パスワード更新（PHP経由）
    try{
        const res=await fetch("/api/submit-shop.php",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:stored.email,shop_name:"_pw_reset_",password_hash:btoa(newPw)})});
        const result=await res.json();
        if(!result.success){errEl.textContent="更新エラー: "+(result.error||"不明");errEl.style.display="block";return;}
    }catch(e){errEl.textContent="通信エラーが発生しました";errEl.style.display="block";return;}
    localStorage.removeItem("pw_reset_code");
    document.getElementById("pw-reset-step2").style.display="none";
    document.getElementById("pw-reset-step3").style.display="block";
}

// ===== 地方・都道府県マッピング =====
const REGION_MAP=[
    {label:"北海道",prefs:["北海道"]},{label:"東北",prefs:["青森県","岩手県","宮城県","秋田県","山形県","福島県"]},
    {label:"関東",prefs:["茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県"]},
    {label:"北陸",prefs:["富山県","石川県","福井県"]},{label:"甲信越",prefs:["新潟県","山梨県","長野県"]},
    {label:"東海",prefs:["岐阜県","静岡県","愛知県","三重県"]},
    {label:"関西",prefs:["滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県"]},
    {label:"中国",prefs:["鳥取県","島根県","岡山県","広島県","山口県"]},
    {label:"四国",prefs:["徳島県","香川県","愛媛県","高知県"]},
    {label:"九州",prefs:["福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県"]},
    {label:"沖縄",prefs:["沖縄県"]}
];
const HOTEL_TYPES={business:"ビジネス",city:"シティ",resort:"リゾート",ryokan:"旅館",pension:"ペンション",minshuku:"民宿",love_hotel:"ラブホテル",rental_room:"レンタルルーム",other:"その他"};

function extractCity(address){
    if(!address)return null;
    const P=["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];
    let after=address;for(const p of P){if(address.startsWith(p)){after=address.slice(p.length).trimStart();break;}}
    if(!after)return null;
    const base=after.replace(/^[\u4E00-\u9FFF\u3040-\u30FF]{1,5}郡/,"");let m;
    m=base.match(/^((?:(?!区)[\u4E00-\u9FFF\u3040-\u30FF]){1,10}?市)/);if(m)return m[1];
    m=base.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}?区)/);if(m)return m[1];
    m=after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,5}郡[\u4E00-\u9FFF\u3040-\u30FF]{1,5}[町村])/);if(m)return m[1];
    return null;
}

// ===== 認証 =====
let currentShop=null;
const SESSION_KEY="shop_admin_session";

function handleLogin(e){e.preventDefault();doLogin();}
async function doLogin(){
    const email=document.getElementById("login-email").value.trim();
    const pw=document.getElementById("login-pw").value;
    const errEl=document.getElementById("login-error");
    errEl.style.display="none";
    if(!email||!pw){errEl.textContent="メールとパスワードを入力してください";errEl.style.display="block";return;}
    try{
        const res=await fetch("/api/shop-auth.php?action=login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:'include',body:JSON.stringify({email:email,password:pw})});
        const result=await res.json();
        if(!result.success){errEl.textContent=result.error||"認証エラー";errEl.style.display="block";return;}
        const data=result.shop;
        if(data.status!=="active"){errEl.textContent="このアカウントはまだ掲載開始されていません（ステータス: "+data.status+"）";errEl.style.display="block";return;}
        currentShop=data;
        localStorage.setItem(SESSION_KEY,JSON.stringify({id:data.id,email:data.email}));
        onLoggedIn();
    }catch(e){errEl.textContent="通信エラーが発生しました";errEl.style.display="block";return;}
}
async function doLogout(){try{await fetch("/api/shop-auth.php?action=logout",{method:'POST',credentials:'include'});}catch(e){}currentShop=null;localStorage.removeItem(SESSION_KEY);location.reload();}

function onLoggedIn(){
    document.getElementById("login-wrap").style.display="none";
    document.getElementById("hdr").style.display="block";
    document.getElementById("main-wrap").style.display="block";
    document.getElementById("hdr-shop-name").textContent=currentShop.shop_name||"店舗";
    document.getElementById("settings-current-email").textContent=currentShop.email||"";
    applyChatTabVisibility();
    applyCastTabVisibility();
    loadMasterData();
    loadRegisteredHotelIds();
    loadRegisteredHotels();
    loadFavAreas().then(()=>showJapanPage());
    loadStatusCard();
    loadDashboard();
}

// YobuChatタブはテスト店舗のみ表示（本番ローンチ時にこの配列を空にすれば全店舗に開放）
const CHAT_TAB_TESTERS=['dgqeiw1i'];
function applyChatTabVisibility(){
    const btn=document.getElementById('tab-btn-chat');
    if(!btn)return;
    const allowed=currentShop&&currentShop.slug&&CHAT_TAB_TESTERS.includes(currentShop.slug);
    btn.style.display=allowed?'':'none';
    if(!allowed){
        const tabContent=document.getElementById('tab-chat');
        if(tabContent&&tabContent.classList.contains('active')){
            switchTab('settings');
        }
    }
}

// キャスト管理タブはshops.cast_enabled=1の店舗のみ表示（テスト段階は立川秘密基地のみ）
function applyCastTabVisibility(){
    const btn=document.getElementById('tab-btn-cast');
    if(!btn)return;
    const allowed=!!(currentShop&&Number(currentShop.cast_enabled)===1);
    btn.style.display=allowed?'':'none';
    if(!allowed){
        const tabContent=document.getElementById('tab-cast');
        if(tabContent&&tabContent.classList.contains('active')){
            switchTab('settings');
        }
    }
}

async function loadStatusCard(){
    let data;
    try{const pRes=await fetch("/api/shop-auth.php?action=profile",{credentials:'include'});data=await pRes.json();if(!data||data.error)return;currentShop=data;}catch(e){return;}
    const st=data.status||"pending";
    const badgeMap={active:['掲載中','st-active'],registered:['審査中','st-registered'],suspended:['掲載停止中','st-suspended'],rejected:['却下','st-rejected'],revision_required:['不備あり・再申請してください','st-revision'],email_pending:['認証待ち','st-pending']};
    const[label,cls]=badgeMap[st]||['不明','st-suspended'];
    document.getElementById("status-badge").innerHTML=`<span class="st-badge ${cls}">${label}</span>`;
    const genreLabels={men:'男性向け（デリヘル）',women:'女性向け（女性用風俗）',este:'デリエステ',men_same:'男性同士向け',women_same:'女性同士向け'};
    document.getElementById("status-genre").textContent=genreLabels[data.gender_mode]||data.gender_mode||'—';
    const contracts=data.shop_contracts||[];
    const topContract=[...contracts].sort((a,b)=>(b.contract_plans?.price||0)-(a.contract_plans?.price||0))[0];
    const plan=topContract?.contract_plans||null;
    const paidContracts=contracts.filter(c=>c.contract_plans&&c.contract_plans.price>0);
    const normalPaid=paidContracts.filter(c=>!c.is_campaign);
    const total=normalPaid.reduce((s,c)=>s+(Number(c.contract_plans.price)||0),0);
    const hasCampaignOnly=paidContracts.length>0&&normalPaid.length===0;
    document.getElementById("status-plan").innerHTML=normalPaid.length?`¥${total.toLocaleString()}/月`:hasCampaignOnly?'キャンペーン適用中<span style="font-size:11px;font-weight:400;color:var(--text-3);margin-left:4px;">（終了後は無料プランに移行します）</span>':"無料プラン";
    // 有料プラン一覧表示（無料プランは非表示）
    const planListEl=document.getElementById("plan-list");
    if(planListEl){
        const normalC=paidContracts.filter(c=>!c.is_campaign);
        let listHtml='';
        normalC.forEach(c=>{const p=c.contract_plans;listHtml+=`<div style="font-size:11px;padding:4px 8px;background:var(--bg-3);border:1px solid var(--border);border-radius:4px;">✅ 【${esc(p.name)}】（¥${Number(p.price).toLocaleString()}/月）</div>`;});
        if(!listHtml&&!paidContracts.some(c=>c.is_campaign))listHtml='<div style="font-size:11px;color:var(--text-3);">無料掲載</div>';
        planListEl.innerHTML=listHtml;
    }
    // 掲載期間表示
    const expiryEl=document.getElementById("plan-expiry");
    if(expiryEl){
        const expiryItems=contracts.filter(c=>c.contract_plans?.price>0).map(c=>{
            const p=c.contract_plans;
            const exp=c.expires_at;
            if(!exp)return null;
            const expDate=new Date(exp);
            const today=new Date();today.setHours(0,0,0,0);
            const diff=Math.ceil((expDate-today)/(1000*60*60*24));
            const dateStr=expDate.toLocaleDateString('ja-JP');
            const diffLabel=diff>0?`（残り${diff}日）`:'<span style="color:var(--red);">（期限切れ）</span>';
            const icon=c.is_campaign?'🎁':'📅';
            const nameLabel=c.is_campaign?`${esc(p.name)}（¥${Number(p.price).toLocaleString()}/月）1ヶ月無料`:esc(p.name);
            const bg=c.is_campaign?'background:linear-gradient(135deg,#fff8e1,#fff3cd);border:1px solid #f0d060;':'background:#f8f6f0;border:1px solid #e8e0d8;';
            return `<div style="font-size:11px;padding:6px 10px;${bg}border-radius:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">${icon} ${nameLabel} — ${dateStr}まで ${diffLabel}</div>`;
        }).filter(Boolean);
        expiryEl.innerHTML=expiryItems.length?expiryItems.join(''):'';
    }
    const shopMode=data.gender_mode||"men";
    document.body.dataset.mode=shopMode;
    const modePathMap={men:'deli',women:'jofu',este:'este',men_same:'same-m',women_same:'same-f'};
    const shopSlug=data.slug||data.id;
    const shopUrl="https://yobuho.com/"+(modePathMap[shopMode]||'deli')+"/shop/"+encodeURIComponent(shopSlug)+"/";
    const urlEl=document.getElementById("status-shop-url");
    urlEl.href=shopUrl;urlEl.textContent=shopUrl;
    // 営業エリア（prefecture/area）— 全プラン対象
    initLocationSection(data);
    // サムネイルセクション（有料プランのみ）
    const thumbSection=document.getElementById("thumbnail-section");
    const isPaid=plan&&plan.price>0;
    window._shopIsPaid=isPaid;
    if(thumbSection){
        thumbSection.style.display=isPaid?'':'none';
        if(isPaid){initBannerMode();loadShopImages();}
    }
    // スタンダード広告セクション（有料プランのみ）
    const stdSection=document.getElementById("standard-ad-section");
    if(stdSection){
        stdSection.style.display=isPaid?'':'none';
        if(isPaid){loadStdImage();}
    }
    // 共通情報セクション（有料プランのみ）
    const catchSection=document.getElementById("catchphrase-section");
    if(catchSection){
        catchSection.style.display=isPaid?'':'none';
        if(isPaid){
            initHoursSelects();
            document.getElementById("catchphrase-input").value=data.catchphrase||'';
            // 営業時間を復元
            if(data.business_hours==='24時間営業'){
                document.getElementById("ad-hours-24h").checked=true;
                toggle24h(true);
            }else if(data.business_hours){
                document.getElementById("ad-hours-24h").checked=false;
                toggle24h(false);
                const parts=data.business_hours.split('〜');
                if(parts[0])document.getElementById("ad-hours-start").value=parts[0];
                if(parts[1])document.getElementById("ad-hours-end").value=parts[1];
            }
            if(data.min_price){
                const pp=data.min_price.split(',');
                if(pp[0])document.getElementById("ad-min-minutes").value=pp[0];
                if(pp[1])document.getElementById("ad-min-yen").value=pp[1];
            }
        }
    }
    // チャット用プロフィール画像 (全プラン表示)
    setShopChatAvatarPreview(data.chat_avatar_url || null);
    const chatAvatarInput = document.getElementById('shop-chat-avatar-input');
    if (chatAvatarInput) chatAvatarInput.value = '';
}

function setShopChatAvatarPreview(url){
    const preview = document.getElementById('shop-chat-avatar-preview');
    const removeBtn = document.getElementById('shop-chat-avatar-remove');
    if (!preview) return;
    if (url) {
        preview.style.backgroundImage = "url('" + String(url).replace(/'/g, "\\'") + "')";
        preview.style.backgroundSize = 'cover';
        if (removeBtn) removeBtn.style.display = 'inline-block';
    } else {
        preview.style.backgroundImage = "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%239ca3af%22><path d=%22M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z%22/></svg>')";
        preview.style.backgroundSize = '60%';
        preview.style.backgroundColor = '#e5e7eb';
        if (removeBtn) removeBtn.style.display = 'none';
    }
}

async function clearShopChatAvatar(){
    if (!confirm('チャット用プロフィール画像を削除しますか？')) return;
    try {
        const res = await fetch('/api/shop-auth.php?action=update-chat-avatar', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            credentials: 'include',
            body: JSON.stringify({chat_avatar_url: null})
        });
        const r = await res.json();
        if (!r.success) { toast('⚠️ ' + (r.error || '削除に失敗しました')); return; }
        setShopChatAvatarPreview(null);
        document.getElementById('shop-chat-avatar-input').value = '';
        toast('✅ 削除しました');
    } catch (e) { toast('⚠️ 通信エラー'); }
}

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('shop-chat-avatar-input');
    if (!input) return;
    input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (!['image/jpeg','image/png'].includes(file.type)) { toast('⚠️ JPG/PNGのみ対応です'); input.value=''; return; }
        if (file.size > 5 * 1024 * 1024) { toast('⚠️ 5MB以下の画像を選択してください'); input.value=''; return; }
        try {
            const dataUrl = await resizeImage(file, 96, 96, 0.82);
            if (dataUrl.length > 90000) { toast('⚠️ 画像が大きすぎます。別の画像を試してください'); return; }
            const res = await fetch('/api/shop-auth.php?action=update-chat-avatar', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                credentials: 'include',
                body: JSON.stringify({chat_avatar_url: dataUrl})
            });
            const r = await res.json();
            if (!r.success) { toast('⚠️ ' + (r.error || '保存に失敗しました')); input.value=''; return; }
            setShopChatAvatarPreview(dataUrl);
            toast('✅ 保存しました');
        } catch (e) {
            toast('⚠️ 画像の読み込みに失敗しました');
            input.value = '';
        }
    });
});

async function loadDashboard(){
    try{
        const res=await fetch('/api/shop-dashboard.php',{credentials:'include'});
        if(!res.ok)return;
        const d=await res.json();
        if(d.error)return;
        document.getElementById('dash-hotel-count').textContent=d.hotel_count;
        document.getElementById('dash-review-count').textContent=d.total_review_count;
        document.getElementById('dash-call-rate').textContent=d.can_call_rate!==null?(d.can_call_rate+'%'):'—';
        if(d.latest_review){
            const dt=new Date(d.latest_review);
            document.getElementById('dash-latest').textContent='最終投稿: '+dt.getFullYear()+'/'+String(dt.getMonth()+1).padStart(2,'0')+'/'+String(dt.getDate()).padStart(2,'0');
        }
    }catch(e){}
}

let _shopImages=[];
let _bannerMode='photos'; // 'photos' or 'banner'
let _photoUploadSlot=0;

async function loadShopImages(){
    try{const res=await fetch('/api/shop-auth.php?action=get-images&usage=rich',{credentials:'include'});_shopImages=await res.json();}catch(e){_shopImages=[];}
    renderShopImages();
    renderPhotoSlots();
    updateBannerPreview();
}
let _savedBannerMode=null;
async function switchBannerMode(mode){
    if(_savedBannerMode && mode !== _savedBannerMode && _shopImages.length > 0){
        if(!confirm(`モードを「${mode==='photos'?'写真3枚':'バナー1枚'}」に変更すると、現在のリッチ広告画像は全て削除されます。よろしいですか？`)){
            // ラジオを元に戻す
            document.querySelectorAll('input[name="banner-mode"]').forEach(r=>{r.checked=r.value===_savedBannerMode;});
            return;
        }
        // API: 旧画像全削除 + banner_type更新（トランザクション）
        try{
            const res=await fetch('/api/shop-auth.php?action=switch-banner-mode',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({mode})});
            const r=await res.json();
            if(!r.success){toast('エラー: '+(r.error||'不明'));document.querySelectorAll('input[name="banner-mode"]').forEach(r=>{r.checked=r.value===_savedBannerMode;});return;}
        }catch(e){toast('通信エラー');document.querySelectorAll('input[name="banner-mode"]').forEach(r=>{r.checked=r.value===_savedBannerMode;});return;}
        _savedBannerMode=mode;
        if(currentShop)currentShop.banner_type=mode;
        await loadShopImages();
        toast(`「${mode==='photos'?'写真3枚':'バナー1枚'}」モードに変更しました`);
    } else if(_savedBannerMode && mode !== _savedBannerMode){
        // 画像がない場合は確認なしで切替
        try{
            await fetch('/api/shop-auth.php?action=switch-banner-mode',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({mode})});
        }catch(e){}
        _savedBannerMode=mode;
        if(currentShop)currentShop.banner_type=mode;
    }
    _bannerMode=mode;
    document.getElementById('banner-mode-photos').style.display=mode==='photos'?'':'none';
    document.getElementById('banner-mode-banner').style.display=mode==='banner'?'':'none';
    updateBannerPreview();
}
function initBannerMode(){
    const mode=(currentShop&&currentShop.banner_type)||'photos';
    _bannerMode=mode;
    _savedBannerMode=mode;
    const radios=document.querySelectorAll('input[name="banner-mode"]');
    radios.forEach(r=>{r.checked=r.value===mode;});
    switchBannerMode(mode);
}
function renderShopImages(){
    const el=document.getElementById('shop-images-preview');
    const countEl=document.getElementById('shop-images-count');
    const addEl=document.getElementById('shop-images-add');
    if(!el)return;
    if(!_shopImages.length){
        el.innerHTML='<span style="font-size:12px;color:var(--text-3);">未設定</span>';
    }else{
        el.innerHTML=_shopImages.map(img=>`<div style="position:relative;display:inline-block;">
            <img src="${esc(img.image_url)}" style="width:120px;height:46px;border-radius:6px;border:1px solid var(--border);object-fit:cover;">
            <button onclick="deleteShopImage(${img.id})" style="position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;background:#c05050;color:#fff;border:2px solid #fff;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;">×</button>
        </div>`).join('');
    }
    const limit=_bannerMode==='banner'?1:3;
    countEl.textContent=`${_shopImages.length}/${limit}枚`;
    if(addEl)addEl.style.display=_shopImages.length>=limit?'none':'flex';
}
function renderPhotoSlots(){
    const labels=['1','2','3','背景'];
    for(let i=0;i<4;i++){
        const slot=document.getElementById('photo-slot-'+i);
        if(!slot)continue;
        const img=_shopImages[i];
        if(img){
            slot.innerHTML=`<img src="${esc(img.image_url)}"><span class="photo-slot-num">${labels[i]}</span><button class="photo-slot-del" onclick="event.stopPropagation();deleteShopImage(${img.id})">×</button>`;
        }else{
            slot.innerHTML=`<span class="photo-slot-num" style="${i===3?'font-size:11px;':''}">${labels[i]}</span>`;
        }
    }
}
function updateBannerPreview(){
    // Photos preview
    const photoPrev=document.getElementById('banner-preview-photos');
    const photoPrevLabel=document.getElementById('banner-preview-photos-label');
    if(photoPrev){
        if(_bannerMode==='photos'&&_shopImages.length>0){
            photoPrev.style.display='';
            if(photoPrevLabel)photoPrevLabel.style.display='';
            const bgImg=_shopImages[3];
            const bgStyle=bgImg?`background-image:url('${esc(bgImg.image_url)}');background-size:cover;background-position:center;`:'background:#1a1a2e;';
            photoPrev.innerHTML=`<div style="position:relative;width:100%;height:100%;${bgStyle}"><div style="display:flex;width:100%;height:100%;justify-content:space-evenly;align-items:stretch;">${_shopImages.slice(0,3).map(img=>`<img src="${esc(img.image_url)}" style="max-width:33.3%;height:100%;object-fit:cover;object-position:center 20%;">`).join('')}</div></div>`;
        }else{photoPrev.style.display='none';photoPrev.innerHTML='';if(photoPrevLabel)photoPrevLabel.style.display='none';}
    }
    // Banner preview
    const bannerPrev=document.getElementById('banner-preview-single');
    const bannerPrevLabel=document.getElementById('banner-preview-single-label');
    if(bannerPrev){
        if(_bannerMode==='banner'&&_shopImages.length>0){
            bannerPrev.style.display='';
            if(bannerPrevLabel)bannerPrevLabel.style.display='';
            bannerPrev.innerHTML=`<img src="${esc(_shopImages[0].image_url)}" style="width:100%;height:100%;object-fit:cover;">`;
        }else{bannerPrev.style.display='none';bannerPrev.innerHTML='';if(bannerPrevLabel)bannerPrevLabel.style.display='none';}
    }
}
function triggerPhotoUpload(slotIndex){
    _photoUploadSlot=slotIndex;
    const input=document.getElementById('photo-upload-input');
    input.value='';
    input.onchange=()=>onPhotoSlotSelect(input,slotIndex);
    input.click();
}
function resizeImage(file,maxW,maxH,quality){
    return new Promise((resolve,reject)=>{
        const img=new Image();
        img.onload=()=>{
            let w=img.width,h=img.height;
            if(w>maxW||h>maxH){const r=Math.min(maxW/w,maxH/h);w=Math.round(w*r);h=Math.round(h*r);}
            const c=document.createElement('canvas');c.width=w;c.height=h;
            c.getContext('2d').drawImage(img,0,0,w,h);
            resolve(c.toDataURL('image/jpeg',quality));
        };
        img.onerror=reject;
        const r=new FileReader();r.onload=e=>{img.src=e.target.result;};r.readAsDataURL(file);
    });
}
async function onPhotoSlotSelect(input,slotIndex){
    if(!input.files[0])return;
    const file=input.files[0];
    if(!['image/jpeg','image/png'].includes(file.type)){showSuccessModal('形式エラー','JPG/PNGのみ対応です');return;}
    if(file.size>5*1024*1024){showSuccessModal('容量エラー','5MB以下の画像を選択してください');return;}
    // 既存画像があれば差し替え（削除→追加）
    const existing=_shopImages[slotIndex];
    if(existing){
        try{await fetch('/api/shop-auth.php?action=delete-image',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({image_id:existing.id})});}catch(e){}
    }
    try{
        const maxW=slotIndex===3?1309:435;
        const maxH=500;
        const base64=await resizeImage(file,maxW,maxH,0.85);
        const res=await fetch('/api/shop-auth.php?action=add-image',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({image_url:base64,usage:'rich'})});
        const r=await res.json();
        if(!r.success){toast('保存エラー: '+(r.error||'不明'));return;}
        await loadShopImages();
        toast(slotIndex===3?'背景画像を設定しました':'写真'+(slotIndex+1)+'を設定しました');
    }catch(e){toast('通信エラー');}
}
async function onShopImageSelect(input){
    if(!input.files[0])return;
    const file=input.files[0];
    if(!['image/jpeg','image/png'].includes(file.type)){showSuccessModal('形式エラー','JPG/PNGのみ対応です');input.value='';return;}
    if(file.size>5*1024*1024){showSuccessModal('容量エラー','5MB以下の画像を選択してください');input.value='';return;}
    if(!confirm('この画像をアップロードしますか？'))return;
    try{
        const base64=await resizeImage(file,1309,500,0.85);
        const res=await fetch('/api/shop-auth.php?action=add-image',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({image_url:base64,usage:'rich'})});
        const r=await res.json();
        if(!r.success){toast('保存エラー: '+(r.error||'不明'));input.value='';return;}
        await loadShopImages();
        toast('バナーをアップロードしました');
    }catch(e){toast('通信エラー');}
    input.value='';
}
async function deleteShopImage(imageId){
    if(!confirm('この画像を削除しますか？'))return;
    try{const res=await fetch('/api/shop-auth.php?action=delete-image',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({image_id:imageId})});const r=await res.json();if(!r.success){toast('削除エラー: '+(r.error||'不明'));return;}}catch(e){toast('通信エラー');return;}
    await loadShopImages();
    toast('画像を削除しました');
}

// === スタンダード広告画像 ===
let _stdImage=null;
async function loadStdImage(){
    try{const res=await fetch('/api/shop-auth.php?action=get-images&usage=standard',{credentials:'include'});const data=await res.json();_stdImage=data&&data.length?data[0]:null;}catch(e){_stdImage=null;}
    renderStdSlot();
}
function renderStdSlot(){
    const slot=document.getElementById('std-thumb-slot');
    if(!slot)return;
    if(_stdImage){
        slot.innerHTML=`<img src="${esc(_stdImage.image_url)}"><span class="photo-slot-num">+</span><button class="photo-slot-del" onclick="event.stopPropagation();deleteStdImage(${_stdImage.id})">×</button>`;
    }else{
        slot.innerHTML='<span class="photo-slot-num" style="font-size:14px;">+</span>';
    }
}
function triggerStdUpload(){
    const input=document.getElementById('std-upload-input');
    input.value='';
    input.onchange=()=>onStdImageSelect(input);
    input.click();
}
async function onStdImageSelect(input){
    if(!input.files[0])return;
    const file=input.files[0];
    if(!['image/jpeg','image/png'].includes(file.type)){showSuccessModal('形式エラー','JPG/PNGのみ対応です');return;}
    if(file.size>5*1024*1024){showSuccessModal('容量エラー','5MB以下の画像を選択してください');return;}
    if(_stdImage){
        try{await fetch('/api/shop-auth.php?action=delete-image',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({image_id:_stdImage.id})});}catch(e){}
    }
    try{
        const base64=await resizeImage(file,435,500,0.85);
        const res=await fetch('/api/shop-auth.php?action=add-image',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({image_url:base64,usage:'standard'})});
        const r=await res.json();
        if(!r.success){toast('保存エラー: '+(r.error||'不明'));return;}
        await loadStdImage();
        toast('サムネイルを設定しました');
    }catch(e){toast('通信エラー');}
}
async function deleteStdImage(imageId){
    if(!confirm('この画像を削除しますか？'))return;
    try{const res=await fetch('/api/shop-auth.php?action=delete-image',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({image_id:imageId})});const r=await res.json();if(!r.success){toast('削除エラー');return;}}catch(e){toast('通信エラー');return;}
    await loadStdImage();
    toast('画像を削除しました');
}

function toggle24h(checked){
    document.getElementById('ad-hours-selects').style.display=checked?'none':'flex';
    if(checked){document.getElementById('ad-hours-start').value='';document.getElementById('ad-hours-end').value='';}
}
function initHoursSelects(){
    const times=['0:00','0:30','1:00','1:30','2:00','2:30','3:00','3:30','4:00','4:30','5:00','5:30','6:00','6:30','7:00','7:30','8:00','8:30','9:00','9:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00','18:30','19:00','19:30','20:00','20:30','21:00','21:30','22:00','22:30','23:00','23:30','翌0:00','翌0:30','翌1:00','翌1:30','翌2:00','翌2:30','翌3:00','翌3:30','翌4:00','翌4:30','翌5:00','翌5:30','翌6:00'];
    ['ad-hours-start','ad-hours-end'].forEach(id=>{
        const sel=document.getElementById(id);if(!sel)return;
        const first=sel.options[0];sel.innerHTML='';sel.appendChild(first);
        times.forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;sel.appendChild(o);});
    });
}
async function saveAdInfo(){
    const catchphrase=document.getElementById('catchphrase-input').value.trim();
    if(catchphrase.length>20){toast('キャッチコピーは20文字以内です');return;}
    const is24h=document.getElementById('ad-hours-24h').checked;
    let businessHours='';
    if(is24h){businessHours='24時間営業';}else{const hStart=document.getElementById('ad-hours-start').value;const hEnd=document.getElementById('ad-hours-end').value;businessHours=(hStart&&hEnd)?hStart+'〜'+hEnd:(hStart||hEnd||'');}
    const minMin=document.getElementById('ad-min-minutes').value.replace(/[^0-9]/g,'');
    const minYen=document.getElementById('ad-min-yen').value.replace(/[^0-9]/g,'');
    const minPrice=(minMin&&minYen)?minMin+','+minYen:'';
    if(!confirm('広告情報を保存しますか？'))return;
    try{
        const res=await fetch("/api/shop-auth.php?action=update-ad-info",{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({catchphrase:catchphrase||null,business_hours:businessHours||null,min_price:minPrice||null,display_tel:null})});
        const r=await res.json();
        if(!r.success){toast('保存エラー: '+(r.error||'不明'));return;}
        if(currentShop){currentShop.catchphrase=catchphrase||null;currentShop.business_hours=businessHours||null;currentShop.min_price=minPrice||null;}
        showSuccessModal('保存完了','広告情報を保存しました');
    }catch(e){toast('通信エラー');}
}

function copyShopUrl(){
    const el=document.getElementById("status-shop-url");
    if(el&&el.href){navigator.clipboard.writeText(el.href);toast("URLをコピーしました");}
}

// 営業エリア（prefecture/area）UI 初期化
const PREFECTURES_47=['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
function initLocationSection(shop){
    const sel=document.getElementById('location-prefecture');
    const areaInp=document.getElementById('location-area');
    if(!sel||!areaInp) return;
    if(sel.options.length<=1){
        PREFECTURES_47.forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;sel.appendChild(o);});
    }
    sel.value=shop?.prefecture||'';
    areaInp.value=shop?.area||'';
}
async function saveShopLocation(){
    const sel=document.getElementById('location-prefecture');
    const areaInp=document.getElementById('location-area');
    const msg=document.getElementById('location-save-msg');
    const prefecture=sel?.value||'';
    const area=(areaInp?.value||'').trim();
    if(msg)msg.textContent='保存中…';
    try{
        const res=await fetch('/api/shop-auth.php?action=update-location',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({prefecture,area})});
        const r=await res.json();
        if(!r.success){if(msg)msg.textContent='保存エラー: '+(r.error||'不明');return;}
        if(currentShop){currentShop.prefecture=r.prefecture;currentShop.area=r.area;}
        if(msg){msg.textContent='✓ 保存しました';setTimeout(()=>{msg.textContent='';},3000);}
    }catch(e){if(msg)msg.textContent='通信エラー';}
}


(async function(){
    // PHPセッション復元を優先、フォールバックとしてlocalStorage
    try{
        const cRes=await fetch("/api/shop-auth.php?action=check",{credentials:'include'});
        const cData=await cRes.json();
        if(cData.authenticated&&cData.shop){
            currentShop=cData.shop;
            localStorage.setItem(SESSION_KEY,JSON.stringify({id:cData.shop.id,email:cData.shop.email}));
            onLoggedIn();return;
        }
    }catch(e){}
    // PHPセッションなし → localStorage確認（ログイン画面表示）
    localStorage.removeItem(SESSION_KEY);
})();

// ===== タブ切替 =====
function switchTab(name){
    document.querySelectorAll(".tab-content").forEach(el=>el.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach(el=>el.classList.remove("active"));
    document.getElementById("tab-"+name).classList.add("active");
    document.getElementById("tab-btn-"+name).classList.add("active");
    if(name==="search"){document.getElementById("hotel-keyword").value="";document.getElementById("text-search-results").innerHTML="";document.getElementById("lh-form-card").style.display="none";showJapanPage();}
    if(name==="list")loadRegisteredHotels();
    if(name==="plan")loadPlanTab();
    if(name==="chat")loadChatAdmin();
    if(name==="cast")loadCastTab();
    if(name==="settings"&&currentShop){document.getElementById("settings-current-email").textContent=currentShop.email||"";}
}

// ===== マスターデータ読み込み =====
let canReasons=[],cannotReasons=[],roomTypes=[],serviceOptions=[];
const TIME_SLOTS=["ALL TIME","早朝 (5:00~8:00)","朝 (8:00~11:00)","昼 (11:00~16:00)","夕方 (16:00~18:00)","夜 (18:00~23:00)","深夜 (23:00~5:00)"];

let _masterJson=null;
async function getMasterJson(){
    if(_masterJson)return _masterJson;
    try{const res=await fetch('/master-data.json');_masterJson=await res.json();}catch(e){_masterJson={};}
    return _masterJson;
}
async function loadMasterData(){
    const md=await getMasterJson();
    canReasons=md.can_call_reasons||[];
    cannotReasons=md.cannot_call_reasons||[];
    roomTypes=md.room_types||[];
    serviceOptions=(md.shop_service_options||[]).map(s=>({id:s.id,name:s.name}));

    // チェックボックスグループ生成
    renderCheckGroup("can-reason-checks",canReasons);
    renderCheckGroup("cant-reason-checks",cannotReasons);
    renderCheckGroup("room-type-checks",roomTypes);
    renderCheckGroup("time-slot-checks",TIME_SLOTS);

    // サービス0件なら非表示
    document.getElementById("service-group").style.display=serviceOptions.length>0?"":"none";
}

function renderCheckGroup(containerId,items,selectedVals=[]){
    const wrap=document.getElementById(containerId);
    if(!wrap)return;
    wrap.innerHTML=items.map(v=>{
        const checked=selectedVals.includes(v);
        return`<label class="check-item${checked?" checked":""}" onclick="toggleCheckItem(this)"><input type="checkbox" value="${esc(v)}"${checked?" checked":""}><span class="ci-dot"></span>${esc(v)}</label>`;
    }).join("");
}
function toggleCheckItem(el){const cb=el.querySelector("input");cb.checked=!cb.checked;el.classList.toggle("checked",cb.checked);
// ALL TIME排他制御（時間帯グループのみ）
const wrap=el.parentElement;if(wrap&&wrap.id==='time-slot-checks'){if(cb.value==='ALL TIME'&&cb.checked){wrap.querySelectorAll('input').forEach(c=>{if(c!==cb){c.checked=false;c.parentElement.classList.remove('checked');c.parentElement.style.opacity='0.4';c.parentElement.style.pointerEvents='none';}});}else if(cb.value==='ALL TIME'&&!cb.checked){wrap.querySelectorAll('label').forEach(l=>{l.style.opacity='';l.style.pointerEvents='';});}else{const allCb=wrap.querySelector('input[value="ALL TIME"]');if(allCb&&allCb.checked){cb.checked=false;el.classList.remove('checked');}}}
}
function getCheckedValues(containerId){return Array.from(document.querySelectorAll("#"+containerId+" input:checked")).map(cb=>cb.value);}
function clearCheckGroup(containerId){document.querySelectorAll("#"+containerId+" .check-item").forEach(el=>{el.classList.remove("checked");el.querySelector("input").checked=false;});}

function renderServiceChecks(selectedIds=[]){
    const wrap=document.getElementById("service-checks");
    if(!serviceOptions.length){wrap.innerHTML="";return;}
    wrap.innerHTML=serviceOptions.map(s=>{
        const checked=selectedIds.includes(s.id);
        return`<label class="svc-check${checked?" checked":""}" onclick="toggleSvcCheck(this)"><input type="checkbox" value="${s.id}"${checked?" checked":""}><span class="svc-dot"></span>${esc(s.name)}</label>`;
    }).join("");
}
function toggleSvcCheck(el){const cb=el.querySelector("input");cb.checked=!cb.checked;el.classList.toggle("checked",cb.checked);}
function getSelectedServices(){return Array.from(document.querySelectorAll("#service-checks input:checked")).map(cb=>parseInt(cb.value));}

// ===== 登録済みホテルID =====
let registeredHotelIds=new Set();
async function loadRegisteredHotelIds(){
    if(!currentShop)return;
    try{const res=await fetch('/api/shop-hotel-api.php?action=registered-ids',{credentials:'include'});const ids=await res.json();registeredHotelIds=new Set((ids||[]).map(d=>String(d)));}catch(e){registeredHotelIds=new Set();}
}

// ===== パンくず =====
function setBreadcrumb(crumbs){
    document.getElementById("breadcrumb").innerHTML=crumbs.map((c,i)=>{
        const isLast=i===crumbs.length-1;
        return`${i>0?'<span class="breadcrumb-sep">›</span>':''}<span class="breadcrumb-item${isLast?' active':''}"${!isLast&&c.onclick?' style="cursor:pointer" onclick="'+c.onclick+'"':''}>${esc(c.label)}</span>`;
    }).join("");
}

// ===== お気に入りエリア =====
// 2026-05-10: レース条件修正 — loadFavAreas が完了する前に addFavArea/removeFavArea が
// 走ると _favAreas=[] のまま保存して既存DBデータを上書き消失させる潜在バグがあった.
// 全ての書込前に必ず loadFavAreas を await で完了させる.
let _favAreas=[];
let _favAreasLoaded=false;
let _favAreasLoading=null;
async function loadFavAreas(){
    if(_favAreasLoaded)return;
    if(_favAreasLoading)return _favAreasLoading;
    _favAreasLoading=(async()=>{
        try{
            const res=await fetch('/api/shop-auth.php?action=get-fav-areas',{credentials:'include'});
            const data=await res.json();
            _favAreas=Array.isArray(data)?data:[];
            _favAreasLoaded=true;
        }catch{
            // 読込失敗時は loaded フラグ立てない → 次回再試行
            _favAreas=[];
        }
        _favAreasLoading=null;
    })();
    return _favAreasLoading;
}
function getFavAreas(){return _favAreas;}
async function saveFavAreas(favs){_favAreas=favs;try{await fetch('/api/shop-auth.php?action=save-fav-areas',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({fav_areas:favs})});}catch{}}
async function addFavArea(fav){
    await loadFavAreas();
    if(!_favAreasLoaded){toast('お気に入りの読込に失敗。再度お試しください');return;}
    const favs=getFavAreas();
    if(favs.some(f=>f.label===fav.label&&f.pref===fav.pref))return;
    favs.push(fav);
    await saveFavAreas(favs);
    toast('⭐ お気に入りに追加しました');
    renderFavAreas();
}
async function removeFavArea(idx){
    await loadFavAreas();
    if(!_favAreasLoaded){toast('お気に入りの読込に失敗。再度お試しください');return;}
    const favs=getFavAreas();
    favs.splice(idx,1);
    await saveFavAreas(favs);
    toast('お気に入りから削除しました');
    renderFavAreas();
}
function renderFavAreas(){
    const favs=getFavAreas();
    const el=document.getElementById('fav-areas');
    if(!el)return;
    if(!favs.length){el.style.display='none';return;}
    el.style.display='block';
    el.innerHTML='<div style="font-size:11px;font-weight:600;color:var(--text-2,#6a5a4a);margin-bottom:6px;">⭐ お気に入りエリア</div><div style="display:flex;flex-wrap:wrap;gap:6px;">'+
        favs.map((f,i)=>`<div onclick="navToFav(${i})" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(201,169,110,0.06);border:1px solid rgba(201,169,110,0.25);border-radius:20px;cursor:pointer;font-size:12px;font-weight:500;color:#8a6a20;"><span>${esc(f.label)}</span><span style="font-size:10px;color:var(--text-3,#999);">${esc(f.pref)}</span><button onclick="event.stopPropagation();removeFavArea(${i})" style="background:none;border:none;font-size:12px;cursor:pointer;color:var(--text-3,#999);padding:0;margin-left:2px;" title="削除">✕</button></div>`).join('')+
    '</div>';
}
function navToFav(idx){
    const f=getFavAreas()[idx];if(!f)return;
    const ri=REGION_MAP.findIndex(r=>r.prefs.includes(f.pref));
    if(ri<0)return;
    if(f.city)showHotels(ri,f.pref,f.majorArea,f.detailArea,f.city);
    else if(f.detailArea)showDetailAreaCities(ri,f.pref,f.majorArea,f.detailArea);
    else if(f.majorArea)showCityPage(ri,f.pref,f.majorArea);
    else showMajorAreaPage(ri,f.pref);
}
function buildFavBtn(label,pref,majorArea,detailArea,city){
    const fav={label:city||detailArea||majorArea||label,pref,majorArea:majorArea||null,detailArea:detailArea||null,city:city||null};
    const favs=getFavAreas();
    const exists=favs.some(f=>f.label===fav.label&&f.pref===fav.pref&&f.city===fav.city&&f.detailArea===fav.detailArea);
    if(exists)return'';
    return`<button onclick="event.stopPropagation();addFavArea(${esc(JSON.stringify(fav)).replace(/"/g,'&quot;')})" title="お気に入りエリアに追加" style="display:inline-flex;align-items:center;padding:2px 6px;border:1px solid rgba(201,169,110,0.3);border-radius:50%;background:rgba(201,169,110,0.06);color:#b08030;font-size:12px;cursor:pointer;font-family:inherit;line-height:1;">⭐</button>`;
}

// ===== ナビゲーション =====
let pageStack=[];
let _skipPush=false;
function backLevel(){history.back();}
function pushNavState(state){
    if(_skipPush)return;
    history.pushState(state,'',"#"+Object.entries(state).filter(([k,v])=>v!=null).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&'));
}
window.addEventListener('popstate',function(e){
    _skipPush=true;
    const s=e.state;
    if(!s||!s.page){showJapanPage();}
    else if(s.page==='pref')showPrefPage(s.ri);
    else if(s.page==='major')showMajorAreaPage(s.ri,s.pref);
    else if(s.page==='city')showCityPage(s.ri,s.pref,s.majorArea);
    else if(s.page==='detail')showDetailAreaCities(s.ri,s.pref,s.majorArea,s.detailArea);
    else if(s.page==='hotels')showHotels(s.ri,s.pref,s.majorArea,s.detailArea,s.city);
    else showJapanPage();
    _skipPush=false;
});

let _areaData=null;
async function getAreaData(){
    if(_areaData)return _areaData;
    try{const res=await fetch('/area-data.json');_areaData=await res.json();}catch(e){_areaData={};}
    return _areaData;
}
async function showJapanPage(){
    pageStack=[];setBreadcrumb([{label:"日本全国"}]);
    pushNavState({page:'japan'});
    const nav=document.getElementById("area-nav");nav.innerHTML='<div class="loading">読み込み中...</div>';
    renderFavAreas();
    const ad=await getAreaData();
    const pc=ad.prefCounts||{};
    const rc=REGION_MAP.map(r=>({label:r.label,count:r.prefs.reduce((s,p)=>s+(pc[p]||0),0)}));
    let h='<div class="area-grid">';
    rc.forEach((r,i)=>{if(r.count>0)h+=`<div class="area-btn" onclick="showPrefPage(${i})"><span class="area-name">${esc(r.label)}</span><span class="area-count">${r.count.toLocaleString()}件</span></div>`;});
    nav.innerHTML=h+'</div>';
}

async function showPrefPage(ri){
    const region=REGION_MAP[ri];pageStack=[()=>showJapanPage()];
    setBreadcrumb([{label:"日本全国",onclick:"showJapanPage()"},{label:region.label}]);
    pushNavState({page:'pref',ri});
    const nav=document.getElementById("area-nav");nav.innerHTML='<div class="loading">読み込み中...</div>';
    const ad=await getAreaData();
    const pc=ad.prefCounts||{};
    const sorted=region.prefs.map(p=>({pref:p,count:pc[p]||0})).filter(r=>r.count>0).sort((a,b)=>b.count-a.count);
    let h=`<button class="btn-back" onclick="backLevel()">← 前へ</button><div class="area-grid">`;
    sorted.forEach(r=>{h+=`<div class="area-btn" onclick="showMajorAreaPage(${ri},'${r.pref}')"><span class="area-name">${esc(r.pref)}</span><span class="area-count">${r.count.toLocaleString()}件</span></div>`;});
    nav.innerHTML=h+'</div>';
}

async function showMajorAreaPage(ri,pref){
    pageStack=[()=>showJapanPage(),()=>showPrefPage(ri)];
    setBreadcrumb([{label:"日本全国",onclick:"showJapanPage()"},{label:REGION_MAP[ri].label,onclick:`showPrefPage(${ri})`},{label:pref}]);
    pushNavState({page:'major',ri,pref});
    const nav=document.getElementById("area-nav");nav.innerHTML='<div class="loading">読み込み中...</div>';
    const ad=await getAreaData();
    const prefData=ad.pref?.[pref];
    const areas=(prefData?.areas||[]).filter(a=>a[1]>0);
    let h=`<button class="btn-back" onclick="backLevel()">← 前へ</button><div class="area-grid">`;
    areas.forEach(([a,cnt])=>{h+=`<div class="area-btn" onclick="showCityPage(${ri},'${esc(pref)}','${esc(a)}')"><span class="area-name">${esc(a)}</span><span class="area-count">${cnt.toLocaleString()}件</span>${buildFavBtn(a,pref,a,null,null)}</div>`;});
    if(!areas.length)h+='<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-3);font-size:13px;">エリアデータがありません</div>';
    nav.innerHTML=h+'</div>';
}

async function showCityPage(ri,pref,majorArea){
    pageStack=[()=>showJapanPage(),()=>showPrefPage(ri),()=>showMajorAreaPage(ri,pref)];
    setBreadcrumb([{label:"日本全国",onclick:"showJapanPage()"},{label:REGION_MAP[ri].label,onclick:`showPrefPage(${ri})`},{label:pref,onclick:`showMajorAreaPage(${ri},'${pref}')`},{label:majorArea}]);
    pushNavState({page:'city',ri,pref,majorArea});
    const nav=document.getElementById("area-nav");nav.innerHTML='<div class="loading">読み込み中...</div>';
    const ad=await getAreaData();
    const aKey=pref+'\t'+majorArea;
    const areaInfo=ad.area?.[aKey]||{da:[],ct:[]};
    if(areaInfo.da&&areaInfo.da.length>0){
        let h=`<button class="btn-back" onclick="backLevel()">← 前へ</button><div class="area-grid">`;
        areaInfo.da.forEach(([da,cnt])=>{h+=`<div class="area-btn" onclick="showDetailAreaCities(${ri},'${esc(pref)}','${esc(majorArea)}','${esc(da)}')"><span class="area-name">${esc(da)}</span><span class="area-count">${cnt.toLocaleString()}件</span>${buildFavBtn(da,pref,majorArea,da,null)}</div>`;});
        nav.innerHTML=h+'</div>';
    }else{
        const cities=(areaInfo.ct||[]).filter(c=>c[1]>0);
        let h=`<button class="btn-back" onclick="backLevel()">← 前へ</button><div class="area-grid">`;
        cities.forEach(([c,cnt])=>{h+=`<div class="area-btn" onclick="showHotels(${ri},'${esc(pref)}','${esc(majorArea)}',null,'${esc(c)}')"><span class="area-name">${esc(c)}</span><span class="area-count">${cnt.toLocaleString()}件</span>${buildFavBtn(c,pref,majorArea,null,c)}</div>`;});
        nav.innerHTML=h+'</div>';
    }
}

async function showDetailAreaCities(ri,pref,majorArea,detailArea){
    pageStack=[()=>showJapanPage(),()=>showPrefPage(ri),()=>showMajorAreaPage(ri,pref),()=>showCityPage(ri,pref,majorArea)];
    setBreadcrumb([{label:"日本全国",onclick:"showJapanPage()"},{label:REGION_MAP[ri].label,onclick:`showPrefPage(${ri})`},{label:pref,onclick:`showMajorAreaPage(${ri},'${pref}')`},{label:majorArea,onclick:`showCityPage(${ri},'${pref}','${majorArea}')`},{label:detailArea}]);
    pushNavState({page:'detail',ri,pref,majorArea,detailArea});
    const nav=document.getElementById("area-nav");nav.innerHTML='<div class="loading">読み込み中...</div>';
    const ad=await getAreaData();
    const daKey=pref+'\t'+majorArea+'\t'+detailArea;
    const daInfo=ad.da?.[daKey]||{ct:[]};
    const cities=(daInfo.ct||[]).filter(c=>c[1]>0);
    let h=`<button class="btn-back" onclick="backLevel()">← 前へ</button><div class="area-grid">`;
    cities.forEach(([c,cnt])=>{h+=`<div class="area-btn" onclick="showHotels(${ri},'${esc(pref)}','${esc(majorArea)}','${esc(detailArea)}','${esc(c)}')"><span class="area-name">${esc(c)}</span><span class="area-count">${cnt.toLocaleString()}件</span>${buildFavBtn(c,pref,majorArea,detailArea,c)}</div>`;});
    nav.innerHTML=h+'</div>';
}

async function showHotels(ri,pref,majorArea,detailArea,city){
    pushNavState({page:'hotels',ri,pref,majorArea,detailArea,city});
    const region=REGION_MAP[ri];
    const crumbs=[{label:"日本全国",onclick:"showJapanPage()"}];
    crumbs.push({label:region.label,onclick:`showPrefPage(${ri})`});
    if(pref)crumbs.push({label:pref,onclick:`showMajorAreaPage(${ri},'${pref}')`});
    if(majorArea)crumbs.push({label:majorArea,onclick:`showCityPage(${ri},'${pref}','${majorArea}')`});
    if(detailArea)crumbs.push({label:detailArea,onclick:`showDetailAreaCities(${ri},'${pref}','${majorArea}','${detailArea}')`});
    if(city)crumbs.push({label:city});else{const last=crumbs[crumbs.length-1];delete last.onclick;}
    setBreadcrumb(crumbs);
    const stack=[()=>showJapanPage(),()=>showPrefPage(ri),()=>showMajorAreaPage(ri,pref)];
    if(majorArea)stack.push(()=>showCityPage(ri,pref,majorArea));
    if(detailArea)stack.push(()=>showDetailAreaCities(ri,pref,majorArea,detailArea));
    pageStack=stack;
    const nav=document.getElementById("area-nav");nav.innerHTML='<div class="loading">読み込み中...</div>';
    const hp=new URLSearchParams({type:'hotel',include_summary:'1',limit:'1000'});
    if(pref)hp.set('pref',pref);
    if(city)hp.set('city',city);
    else if(detailArea)hp.set('detail_area',detailArea);
    else if(majorArea)hp.set('major_area',majorArea);
    let hotels=[];
    try{const hRes=await fetch('/api/hotels.php?'+hp);hotels=await hRes.json();if(hotels.error){nav.innerHTML=`<div class="loading">エラー: ${esc(hotels.error)}</div>`;return;}}catch(e){nav.innerHTML='<div class="loading">通信エラー</div>';return;}
    // ポータルと同じソート: 口コミ件数→ホテルタイプ→名前
    const typeOrder={business:0,city:1,resort:2,ryokan:3,pension:4,minshuku:5,love_hotel:0,rental_room:1,other:6};
    hotels.sort((a,b)=>{
        const ca=a.total_reports||0;
        const cb=b.total_reports||0;
        if(ca!==cb)return cb-ca;
        const ta=typeOrder[a.hotel_type]??6;
        const tb=typeOrder[b.hotel_type]??6;
        if(ta!==tb)return ta-tb;
        return(a.name||'').localeCompare(b.name||'','ja');
    });
    const normalHotels=hotels.filter(h=>!['love_hotel','rental_room'].includes(h.hotel_type));
    // ラブホはmajor_area/detail_areaがnullのため別途取得
    let loveHotels=[];
    if(pref&&city){
        try{const lhRes=await fetch('/api/hotels.php?type=loveho&include_summary=1&limit=1000&pref='+encodeURIComponent(pref)+'&city='+encodeURIComponent(city));loveHotels=await lhRes.json();if(Array.isArray(loveHotels)){loveHotels.sort((a,b)=>{const ca=a.total_reports||0;const cb=b.total_reports||0;if(ca!==cb)return cb-ca;return(a.name||'').localeCompare(b.name||'','ja');});}else{loveHotels=[];}}catch(e){loveHotels=[];}
    }
    const favLabel=city||detailArea||majorArea||pref;
    let html=`<button class="btn-back" onclick="backLevel()">← 前へ</button>`;
    html+=buildFavBtn(favLabel,pref,majorArea,detailArea,city);
    _saHotelPage=0;_saLhPage=0;
    if(pref&&city){
        _saHotels=normalHotels;_saLhHotels=loveHotels;
        html+=`<div style="display:flex;gap:0;border-bottom:1px solid var(--border,#e0d5d0);margin-bottom:12px;">
            <button onclick="saShowSubTab('hotel')" id="sa-subtab-hotel" style="padding:8px 16px;border:none;border-bottom:2px solid var(--rose,#c47a88);background:transparent;font-size:12px;font-weight:600;color:var(--rose,#c47a88);cursor:pointer;font-family:inherit;">🏨 ホテル (${normalHotels.length})</button>
            <button onclick="saShowSubTab('loveho')" id="sa-subtab-loveho" style="padding:8px 16px;border:none;border-bottom:2px solid transparent;background:transparent;font-size:12px;font-weight:600;color:var(--text-3,#999);cursor:pointer;font-family:inherit;">🏩 ラブホ (${loveHotels.length})</button>
        </div>`;
        html+=`<div id="sa-subtab-hotel-content">${saPagedCards(normalHotels,0,'sa-subtab-hotel-content','_saHotelPage')}</div>`;
        html+=`<div id="sa-subtab-loveho-content" style="display:none;">${saPagedCards(loveHotels,0,'sa-subtab-loveho-content','_saLhPage')}</div>`;
    }else{
        _saHotels=hotels;
        html+=`<div id="sa-hotel-list-paged">${saPagedCards(hotels,0,'sa-hotel-list-paged','_saHotelPage')}</div>`;
    }
    nav.innerHTML=html;
    document.getElementById("lh-form-card").style.display="none";
}

const SA_PAGE_SIZE=20;
let _saHotelPage=0,_saHotels=[],_saLhPage=0,_saLhHotels=[];
function saPagedCards(hotels,page,containerId,pageVarName){
    const isLh=pageVarName==='_saLhPage';
    const total=hotels.length;const pages=Math.max(1,Math.ceil(total/SA_PAGE_SIZE));
    if(page>=pages)page=pages-1;if(page<0)page=0;
    const start=page*SA_PAGE_SIZE;const end=Math.min(start+SA_PAGE_SIZE,total);
    const slice=hotels.slice(start,end);
    const pager=total>SA_PAGE_SIZE?`<div style="display:flex;justify-content:center;align-items:center;gap:12px;margin:12px 0;">
        <button class="btn" style="font-size:12px;" onclick="${pageVarName}--;saRepage('${containerId}','${pageVarName}')" ${page===0?'disabled':''}>← 前へ</button>
        <span style="font-size:12px;color:var(--text-3);">${start+1}〜${end}件 / ${total}件（${page+1}/${pages}ページ）</span>
        <button class="btn" style="font-size:12px;" onclick="${pageVarName}++;saRepage('${containerId}','${pageVarName}')" ${page>=pages-1?'disabled':''}>次へ →</button>
    </div>`:'';
    const cards=isLh?lhRenderHotelCards(slice):renderHotelCards(slice);
    return pager+cards+pager;
}
function _saRefreshCards(){
    // 現在表示中のカードリストを再描画（registeredHotelIds更新後に呼ぶ）
    const ids=['sa-subtab-hotel-content','sa-subtab-loveho-content','sa-hotel-list-paged','sa-search-paged'];
    ids.forEach(id=>{const el=document.getElementById(id);if(!el||el.style.display==='none')return;
        if(id==='sa-subtab-loveho-content'){el.innerHTML=saPagedCards(_saLhHotels,_saLhPage,id,'_saLhPage');}
        else{el.innerHTML=saPagedCards(_saHotels,_saHotelPage,id,'_saHotelPage');}
    });
}
function saRepage(containerId,pageVarName){
    const el=document.getElementById(containerId);if(!el)return;
    const hotels=pageVarName==='_saLhPage'?_saLhHotels:_saHotels;
    const page=pageVarName==='_saLhPage'?_saLhPage:_saHotelPage;
    el.innerHTML=saPagedCards(hotels,page,containerId,pageVarName);
    el.scrollIntoView({behavior:'smooth',block:'start'});
}
function renderHotelCards(hotels){
    if(!hotels.length)return'<div class="loading">ホテルがありません</div>';
    return'<div class="hotel-cards">'+hotels.map((h,i)=>{
        const isReg=registeredHotelIds.has(String(h.id));
        const typeLabel=h.hotel_type==='love_hotel'?'🏩 ラブホテル':h.hotel_type==='rental_room'?'🏠 レンタルルーム':HOTEL_TYPES[h.hotel_type]?HOTEL_TYPES[h.hotel_type]:'';
        const rc=h.total_reports||0;
        const rcBadge=rc>0?`<span style="font-size:10px;color:#b5627a;margin-left:6px;">💬${rc}</span>`:'';
        const regInfo=isReg?regData.find(r=>String(r.hotel_id)===String(h.id)):null;
        const actionBtns=isReg
            ?`<button class="btn btn-rose" onclick="selectHotelById(${h.id})">✏️ 編集</button><button class="btn" style="background:var(--bg-3);border:1px solid var(--border);color:var(--red);font-size:12px;" onclick="deleteRegistered('${regInfo?.id||''}')">投稿削除</button>`
            :`<button class="btn btn-rose" onclick="selectHotelById(${h.id})">📝 情報登録</button>`;
        return`<div class="hotel-card" style="animation-delay:${Math.min(i*0.03,0.3)}s"><div class="hotel-card-head"><span class="hotel-card-name">${esc(h.name)}</span>${typeLabel?`<span style="font-size:11px;color:var(--text-3);margin-left:6px;">${typeLabel}</span>`:''}${rcBadge}${isReg?'<span class="hotel-card-badge">✅ 登録済み</span>':''}</div>${h.address?`<div class="hotel-card-info">📍 ${esc(h.address)}</div>`:''}${h.nearest_station?`<div class="hotel-card-info">🚉 ${esc(h.nearest_station)}</div>`:''}<div class="hotel-card-footer">${actionBtns}</div></div>`;
    }).join("")+'</div>';
}

// ===== テキスト検索 =====
async function textSearch(){
    const kw=document.getElementById("hotel-keyword").value.trim();
    if(!kw){toast("検索キーワードを入力してください");return;}
    const wrap=document.getElementById("text-search-results");
    wrap.innerHTML='<div class="loading">検索中...</div>';
    let hotels=[];
    try{const sRes=await fetch('/api/hotels.php?type=all&keyword='+encodeURIComponent(kw)+'&include_summary=1&limit=50');hotels=await sRes.json();if(!Array.isArray(hotels))hotels=[];}catch(e){hotels=[];}
    if(!hotels.length){wrap.innerHTML='<div style="font-size:12px;color:var(--text-3);padding:10px 0;">該当するホテルがありません</div>';return;}
    _saHotels=hotels;_saHotelPage=0;
    wrap.innerHTML=`<div id="sa-search-paged">${saPagedCards(hotels,0,'sa-search-paged','_saHotelPage')}</div>`;
}

// ===== フォーム状態 =====
let formCanCall=null;

function setCanCall(val){
    formCanCall=val;
    document.getElementById("btn-can").classList.toggle("active",val===true);
    document.getElementById("btn-cannot").classList.toggle("active",val===false);
    document.getElementById("can-section").classList.toggle("active",val===true);
    document.getElementById("cant-section").classList.toggle("active",val===false);
    if(val===true){clearCheckGroup("cant-reason-checks");}
    else{clearCheckGroup("can-reason-checks");clearCheckGroup("room-type-checks");clearCheckGroup("time-slot-checks");}
}

// ===== ホテル選択 → モーダルでフォーム表示 =====
async function selectHotelById(hotelId){
    let hotel=null;
    try{const hRes=await fetch('/api/hotels.php?hotel_id='+hotelId+'&type=all');const arr=await hRes.json();hotel=Array.isArray(arr)?arr[0]:null;}catch(e){}
    if(!hotel){toast("ホテルが見つかりません");return;}
    const isLoveho=hotel.hotel_type==='love_hotel'||hotel.hotel_type==='rental_room';
    const modal=document.getElementById('edit-modal');
    const container=document.getElementById('edit-modal-content');
    if(isLoveho){
        const form=document.getElementById('lh-form-card');
        container.innerHTML='';container.appendChild(form);
        form.style.display='block';
        _editModal={type:'loveho',form};
        await lhSelectHotel(hotel.id, hotel.name);
    }else{
        const form=document.getElementById('info-form');
        container.innerHTML='';container.appendChild(form);
        _editModal={type:'hotel',form};
        let existing=null;
        try{const eRes=await fetch('/api/shop-hotel-api.php?action=get-info&hotel_id='+hotelId,{credentials:'include'});existing=await eRes.json();}catch(e){}
        openForm(hotel,existing);
    }
    modal.style.display='flex';
}

function openForm(hotel,existing){
    document.getElementById("lh-form-card").style.display="none";
    document.getElementById("form-hotel-name").textContent=hotel.name;
    document.getElementById("form-hotel-id").value=hotel.id;
    window._currentFormHotelId=String(hotel.id);
    document.getElementById("form-edit-id").value=existing?existing.id:"";

    // リセット
    formCanCall=null;
    document.getElementById("btn-can").classList.remove("active");
    document.getElementById("btn-cannot").classList.remove("active");
    document.getElementById("can-section").classList.remove("active");
    document.getElementById("cant-section").classList.remove("active");
    clearCheckGroup("can-reason-checks");
    clearCheckGroup("cant-reason-checks");
    clearCheckGroup("room-type-checks");
    clearCheckGroup("time-slot-checks");
    document.getElementById("transport-free").checked=false;document.getElementById("transport-fee-wrap").style.display="flex";document.getElementById("form-transport").value="";document.getElementById("form-memo").value="";document.getElementById("sa-multi-person-check").checked=false;document.getElementById("sa-multi-person-detail").style.display="none";document.getElementById("sa-guest-male").value="";document.getElementById("sa-guest-female").value="";

    if(existing){
        setCanCall(existing.can_call);
        setTransportFee(existing.transport_fee);
        document.getElementById("form-memo").value=existing.report_comment||existing.memo||"";
        renderServiceChecks(existing.service_ids||[]);
        // 口コミデータ復元
        if(existing.can_call_reasons&&existing.can_call_reasons.length){renderCheckGroup("can-reason-checks",canReasons,existing.can_call_reasons);}
        if(existing.cannot_call_reasons&&existing.cannot_call_reasons.length){renderCheckGroup("cant-reason-checks",cannotReasons,existing.cannot_call_reasons);}
        if(existing.room_type){renderCheckGroup("room-type-checks",roomTypes,[existing.room_type]);}
        if(existing.time_slot){const _ts=existing.time_slot.split(/,\s*/).filter(Boolean);renderCheckGroup("time-slot-checks",TIME_SLOTS,_ts);}
        if(existing.multi_person){document.getElementById("sa-multi-person-check").checked=true;document.getElementById("sa-multi-person-detail").style.display="flex";if(existing.guest_male)document.getElementById("sa-guest-male").value=existing.guest_male;if(existing.guest_female)document.getElementById("sa-guest-female").value=existing.guest_female;if(existing.multi_fee)document.getElementById("sa-multi-fee").checked=true;}
    }else{
        renderServiceChecks([]);
    }

    document.getElementById("info-form").classList.add("active");
}

function cancelForm(){
    document.getElementById("info-form").classList.remove("active");
    formCanCall=null;
}

// ===== 交通費入力 =====
function formatTransportInput(el){let val=el.value.replace(/[^0-9]/g,'');el.value=val?parseInt(val,10).toLocaleString('ja-JP'):'';}
document.getElementById('form-transport').addEventListener('input',function(){formatTransportInput(this);});
document.getElementById('lh-form-transport').addEventListener('input',function(){formatTransportInput(this);});
function toggleTransportFee(){
    const fc=document.getElementById("transport-free");
    const wrap=document.getElementById("transport-fee-wrap");
    const fi=document.getElementById("form-transport");
    if(fc.checked){wrap.style.display="none";fi.value="";}
    else{wrap.style.display="flex";fi.focus();}
}
function toggleLhTransportFee(){
    const fc=document.getElementById("lh-transport-free");
    const wrap=document.getElementById("lh-transport-fee-wrap");
    const fi=document.getElementById("lh-form-transport");
    if(fc.checked){wrap.style.display="none";fi.value="";}
    else{wrap.style.display="flex";fi.focus();}
}
function getLhTransportFee(){
    if(document.getElementById("lh-transport-free").checked)return 0;
    const v=document.getElementById("lh-form-transport").value.replace(/[,，]/g,"").trim();
    if(!v)return null;
    const n=parseInt(v,10);
    return isNaN(n)?null:n;
}
function getTransportFee(){
    if(document.getElementById("transport-free").checked)return 0;
    const raw=document.getElementById("form-transport").value.replace(/,/g,"");
    return raw?parseInt(raw,10):null;
}
function setTransportFee(num){
    const fc=document.getElementById("transport-free");
    const wrap=document.getElementById("transport-fee-wrap");
    const fi=document.getElementById("form-transport");
    if(num===0||num==='0'){fc.checked=true;wrap.style.display="none";fi.value="";return;}
    if(num===null||num===undefined||num===''){fc.checked=false;wrap.style.display="flex";fi.value="";return;}
    fc.checked=false;wrap.style.display="flex";fi.value=Number(num).toLocaleString("ja-JP");
}
function formatFee(num){if(num===null||num===undefined||num==='')return"未記入";if(num===0||num==='0')return"無料";return"¥"+Number(num).toLocaleString("ja-JP")+"-";}

// ===== 確認画面 =====

function showConfirm(){
    if(formCanCall===null){toast("「呼べる」か「呼べない」を選択してください");return;}

    const canCall=formCanCall;
    const canReasonArr=getCheckedValues("can-reason-checks");
    const cantReasonArr=getCheckedValues("cant-reason-checks");
    const roomTypeArr=getCheckedValues("room-type-checks");
    const timeSlotArr=getCheckedValues("time-slot-checks");
    const transportFee=getTransportFee();
    const memo=document.getElementById("form-memo").value.trim();
    const svcs=getSelectedServices();

    const resultText=canCall?'✅ 呼べる':'❌ 呼べない';
    const resultColor=canCall?'var(--green)':'var(--red)';

    function row(label,value){
        if(!value)return'';
        return`<div class="confirm-row"><div class="confirm-label">${label}</div><div class="confirm-value">${value}</div></div>`;
    }
    function tagsHtml(arr,cls){return arr.map(v=>`<span class="confirm-tag ${cls}">${esc(v)}</span>`).join("");}

    let html=`<div class="confirm-row"><div class="confirm-label">結果</div><div class="confirm-value" style="font-weight:700;color:${resultColor};">${resultText}</div></div>`;
    if(canCall&&canReasonArr.length)html+=row('呼べた理由',tagsHtml(canReasonArr,'green'));
    if(!canCall&&cantReasonArr.length)html+=row('呼べなかった理由',tagsHtml(cantReasonArr,'red'));
    if(canCall&&roomTypeArr.length)html+=row('部屋タイプ',tagsHtml(roomTypeArr,'blue'));
    if(canCall&&timeSlotArr.length)html+=row('時間帯',tagsHtml(timeSlotArr,'blue'));
    if(transportFee!==null&&transportFee!==undefined&&transportFee!=='')html+=row('交通費',formatFee(transportFee));
    if(svcs.length>0){
        const tags=svcs.map(sid=>{const s=serviceOptions.find(x=>x.id===sid);return s?`<span class="confirm-tag rose">${esc(s.name)}</span>`:'';}).join("");
        html+=row('対応サービス',tags);
    }
    if(memo)html+=row('メモ',esc(memo));
    html+=row('投稿者',esc(currentShop.shop_name||"店舗")+'<span style="font-size:11px;color:var(--text-3);margin-left:6px;">(店舗投稿)</span>');

    document.getElementById("confirm-content").innerHTML=html;
    const submitBtn=document.getElementById("btn-do-submit");
    submitBtn.disabled=false;submitBtn.textContent="この内容で保存する";
    document.getElementById("confirm-modal").classList.add("active");
}

function closeConfirm(){document.getElementById("confirm-modal").classList.remove("active");}

// ===== 保存処理 =====
async function doSubmit(){
    const submitBtn=document.getElementById("btn-do-submit");
    submitBtn.disabled=true;submitBtn.textContent="保存中...";

    const hotelId=document.getElementById("form-hotel-id").value;
    const editId=document.getElementById("form-edit-id").value;
    const canCall=formCanCall;
    const canReasonArr=getCheckedValues("can-reason-checks");
    const cantReasonArr=getCheckedValues("cant-reason-checks");
    const roomTypeArr=getCheckedValues("room-type-checks");
    const timeSlotArr=getCheckedValues("time-slot-checks");
    const transportFee=getTransportFee();
    const memo=document.getElementById("form-memo").value.trim()||null;
    const svcs=getSelectedServices();

    const multiPerson=!!document.getElementById("sa-multi-person-check").checked;
    const payload={
        hotel_id:parseInt(hotelId),
        edit_id:editId||null,
        report:{
            can_call:canCall,
            can_call_reasons:canCall?canReasonArr:[],
            cannot_call_reasons:!canCall?cantReasonArr:[],
            time_slot:timeSlotArr.length?timeSlotArr.join(', '):null,
            room_type:roomTypeArr[0]||null,
            comment:memo,
            multi_person:multiPerson,
            multi_fee:multiPerson?(document.getElementById("sa-multi-fee").checked||false):false,
            guest_male:multiPerson?(parseInt(document.getElementById("sa-guest-male").value)||1):1,
            guest_female:multiPerson?(parseInt(document.getElementById("sa-guest-female").value)||0):0
        },
        info:{transport_fee:transportFee!==null&&transportFee!==undefined?transportFee:null,memo:memo},
        service_ids:svcs
    };
    try{
        const res=await fetch('/api/shop-hotel-api.php?action=save-hotel-info',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(payload)});
        const result=await res.json();
        if(!result.success){submitBtn.disabled=false;submitBtn.textContent="この内容で保存する";closeConfirm();toast("保存エラー: "+(result.error||"不明"));return;}
    }catch(e){submitBtn.disabled=false;submitBtn.textContent="この内容で保存する";closeConfirm();toast("通信エラー");return;}

    closeConfirm();
    cancelForm();
    registeredHotelIds.add(String(hotelId));
    loadRegisteredHotels();
    if(_editModal)closeEditModal();
    _saRefreshCards();
    showSuccessModal('登録完了！', 'ホテル情報が登録されました。');
}

// ===== 登録済みホテル一覧 =====
let regData=[];let regPage=1;const PER_PAGE=20;
let regFilter='all'; // all / hotel / loveho
let regSortAsc=false; // false=新しい順, true=古い順

function setRegFilter(f,btn){
    regFilter=f;regPage=1;
    document.querySelectorAll('.reg-tab').forEach(t=>t.classList.remove('active'));
    if(btn)btn.classList.add('active');
    renderRegistered();
}
function toggleRegSort(){
    regSortAsc=!regSortAsc;
    document.getElementById('reg-sort-btn').textContent=regSortAsc?'📅 古い順':'📅 新しい順';
    regPage=1;renderRegistered();
}

async function loadRegisteredHotels(){
    if(!currentShop)return;
    try{const res=await fetch('/api/shop-hotel-api.php?action=registered-list',{credentials:'include'});regData=await res.json();if(!Array.isArray(regData))regData=[];}catch(e){regData=[];}
    regPage=1;renderRegistered();
}

function renderRegistered(){
    // フィルタ
    let filtered=regData;
    if(regFilter==='hotel')filtered=regData.filter(r=>{const ht=r.hotels?.hotel_type||'';return ht!=='love_hotel'&&ht!=='rental_room';});
    else if(regFilter==='loveho')filtered=regData.filter(r=>{const ht=r.hotels?.hotel_type||'';return ht==='love_hotel'||ht==='rental_room';});
    // ソート（投稿日時）
    filtered=[...filtered].sort((a,b)=>{
        const da=new Date(a.refreshed_at||a.created_at||0).getTime();
        const db=new Date(b.refreshed_at||b.created_at||0).getTime();
        return regSortAsc?(da-db):(db-da);
    });
    const total=filtered.length;const totalPages=Math.ceil(total/PER_PAGE)||1;
    if(regPage>totalPages)regPage=totalPages;
    const start=(regPage-1)*PER_PAGE;const pageData=filtered.slice(start,start+PER_PAGE);
    // タブの件数表示
    const hotelCnt=regData.filter(r=>{const ht=r.hotels?.hotel_type||'';return ht!=='love_hotel'&&ht!=='rental_room';}).length;
    const lovehoCnt=regData.filter(r=>{const ht=r.hotels?.hotel_type||'';return ht==='love_hotel'||ht==='rental_room';}).length;
    document.querySelector('.reg-tab[data-filter="all"]').textContent=`すべて (${regData.length})`;
    document.querySelector('.reg-tab[data-filter="hotel"]').textContent=`🏨 ホテル (${hotelCnt})`;
    document.querySelector('.reg-tab[data-filter="loveho"]').textContent=`🏩 ラブホ (${lovehoCnt})`;
    document.getElementById("reg-count").textContent=`全${total}件`;
    const wrap=document.getElementById("reg-list");
    if(!pageData.length){wrap.innerHTML='<div style="text-align:center;padding:30px;color:var(--text-3);font-size:13px;">登録済みホテルがありません</div>';document.getElementById("pagination").innerHTML="";return;}
    wrap.innerHTML=pageData.map(r=>{
        const name=r.hotels?r.hotels.name:"(削除済み)";
        const ht=r.hotels?.hotel_type||'';
        const isLoveho=ht==='love_hotel'||ht==='rental_room';
        const typeTag=isLoveho?'<span style="font-size:10px;color:#b5627a;margin-left:4px;">🏩</span>':'';
        const canLabel=r.can_call?'<span class="reg-status can">ご案内実績あり</span>':'<span class="reg-status cant">ご案内不可</span>';
        const tVal=r.transport_fee;
        const cost=tVal===null||tVal===undefined?"—":formatFee(tVal);
        const refreshedAt=r.refreshed_at?new Date(r.refreshed_at):null;
        const dateStr=refreshedAt?refreshedAt.toLocaleDateString('ja-JP'):'—';
        let refreshHTML='';
        if(window._shopIsPaid){
            refreshHTML='<span style="font-size:11px;color:#6a8a5a;white-space:nowrap;">🔄 自動更新</span>';
        }else if(refreshedAt){
            const canRefresh=Date.now()-refreshedAt.getTime()>30*24*60*60*1000;
            if(canRefresh){
                refreshHTML=`<button class="btn" style="font-size:10px;padding:2px 8px;background:#1976d2;color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;" onclick="refreshDate(${r.hotel_id})">🔄 表示日更新</button>`;
            }else{
                const nextDate=new Date(refreshedAt.getTime()+30*24*60*60*1000);
                refreshHTML=`<span style="font-size:10px;color:var(--text-3);white-space:nowrap;">次回: ${nextDate.toLocaleDateString('ja-JP')}</span>`;
            }
        }
        const dateDisplay=`<span style="font-size:11px;color:var(--text-3);white-space:nowrap;">📅 ${dateStr}</span>`;
        return`<div class="reg-row"><span class="reg-name">${esc(name)}${typeTag}</span>${canLabel}<span class="reg-cost">交通費: ${cost}</span>${dateDisplay} ${refreshHTML}<div class="reg-actions"><button class="btn btn-gold" onclick="editRegistered('${r.id}')">編集</button><button class="btn btn-red" onclick="deleteRegistered('${r.id}')">投稿削除</button></div></div>`;
    }).join("");
    if(totalPages<=1){document.getElementById("pagination").innerHTML="";return;}
    let pg='<button class="page-btn" onclick="goPage('+(regPage-1)+')"'+(regPage<=1?" disabled":"")+'>←</button>';
    for(let i=1;i<=totalPages;i++){if(totalPages>7&&Math.abs(i-regPage)>2&&i!==1&&i!==totalPages){if(i===2||i===totalPages-1)pg+='<span class="page-info">...</span>';continue;}pg+=`<button class="page-btn${i===regPage?" active":""}" onclick="goPage(${i})">${i}</button>`;}
    pg+='<button class="page-btn" onclick="goPage('+(regPage+1)+')"'+(regPage>=totalPages?" disabled":"")+'>→</button>';
    document.getElementById("pagination").innerHTML=pg;
}

function goPage(p){const tp=Math.ceil(regData.length/PER_PAGE)||1;if(p<1||p>tp)return;regPage=p;renderRegistered();}

async function refreshDate(hotelId){
    if(!confirm('表示日を更新しますか？（月1回まで）'))return;
    try{
        const res=await fetch('/api/shop-hotel-api.php?action=refresh-date',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({hotel_id:hotelId})});
        const r=await res.json();
        if(r.error){toast('⚠️ '+r.error+(r.next_refresh?' (次回: '+r.next_refresh+')':''));return;}
        toast('✅ 表示日を更新しました');
        loadRegisteredHotels();
    }catch(e){toast('通信エラー');}
}

let _editModal=null;
async function editRegistered(infoId){
    const info=regData.find(r=>String(r.id)===String(infoId));if(!info)return;
    const ht=info.hotels?.hotel_type||'';
    const isLoveho=ht==='love_hotel'||ht==='rental_room';
    const hotelName=info.hotels?info.hotels.name:"(不明)";
    // モーダルで編集フォームを表示
    const modal=document.getElementById('edit-modal');
    const container=document.getElementById('edit-modal-content');
    if(isLoveho){
        // ラブホフォームをモーダルに移動
        const form=document.getElementById('lh-form-card');
        container.innerHTML='';container.appendChild(form);
        form.style.display='block';
        _editModal={type:'loveho',form};
        await lhSelectHotel(info.hotel_id,hotelName);
    }else{
        // ホテルフォームをモーダルに移動
        const form=document.getElementById('info-form');
        container.innerHTML='';container.appendChild(form);
        _editModal={type:'hotel',form};
        const hotel={id:info.hotel_id,name:hotelName};
        // get-info APIで口コミデータ含む完全なデータを取得
        let fullInfo=info;
        try{const eRes=await fetch('/api/shop-hotel-api.php?action=get-info&hotel_id='+info.hotel_id,{credentials:'include'});const data=await eRes.json();if(data)fullInfo=data;}catch(e){}
        openForm(hotel,fullInfo);
    }
    modal.style.display='flex';
}
function closeEditModal(){
    const modal=document.getElementById('edit-modal');
    modal.style.display='none';
    // フォームを元の位置に戻す
    if(_editModal){
        const searchTab=document.getElementById('tab-search');
        if(_editModal.type==='loveho'){
            _editModal.form.style.display='none';
            searchTab.appendChild(_editModal.form);
        }else{
            _editModal.form.classList.remove('active');
            searchTab.appendChild(_editModal.form);
        }
        _editModal=null;
    }
    loadRegisteredHotels();
}

async function deleteRegistered(infoId){
    if(!confirm("この投稿を削除しますか？（ホテル自体は削除されません）"))return;
    const info=regData.find(r=>String(r.id)===String(infoId));
    try{const res=await fetch('/api/shop-hotel-api.php?action=delete-info',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({info_id:infoId})});const r=await res.json();if(!r.success){toast("削除エラー: "+(r.error||"不明"));return;}}catch(e){toast("通信エラー");return;}
    regData=regData.filter(r=>String(r.id)!==String(infoId));
    if(info)registeredHotelIds.delete(String(info.hotel_id));
    renderRegistered();toast("🗑 削除しました");
}

// ===== 設定: メールアドレス変更 (Step1: 認証コード送信) =====
async function sendEmailVerification(){
    const errEl=document.getElementById("settings-email-error");
    errEl.style.display="none";
    const newEmail=document.getElementById("settings-new-email").value.trim();
    const pw=document.getElementById("settings-email-pw").value;
    if(!newEmail||!pw){errEl.textContent="全ての項目を入力してください";errEl.style.display="block";return;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)){errEl.textContent="メールアドレスの形式が正しくありません";errEl.style.display="block";return;}
    try{const vRes=await fetch("/api/verify-password.php",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:currentShop.email,password:pw})});const vResult=await vRes.json();if(!vResult.success){errEl.textContent=vResult.error||"パスワードが正しくありません";errEl.style.display="block";return;}}catch(e){errEl.textContent="認証エラー";errEl.style.display="block";return;}
    const code=String(Math.floor(100000+Math.random()*900000));
    localStorage.setItem("email_change_code",JSON.stringify({code:code,newEmail:newEmail,expires:Date.now()+10*60*1000}));
    const emailBody='<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #b5627a;">YobuHo - メールアドレス変更</h2><p>メールアドレス変更の認証コードをお知らせします。</p><div style="background: #f8f0f2; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;"><p style="margin: 0; font-size: 32px; font-weight: bold; letter-spacing: 8px;">'+code+'</p></div><p style="color: #888; font-size: 12px;">このコードは10分間有効です。</p><p style="color: #888; font-size: 12px;">心当たりがない場合は無視してください。</p></div>';
    try{await fetch("/api/send-mail.php",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:newEmail,subject:"【YobuHo】メールアドレス変更の認証コード",body:emailBody})});}catch(e){}
    document.getElementById("email-step1").style.display="none";
    document.getElementById("email-step2").style.display="block";
}

// ===== 設定: メールアドレス変更 (Step2: 認証コード確認) =====
async function verifyAndChangeEmail(){
    const errEl=document.getElementById("settings-verify-error");
    errEl.style.display="none";
    const inputCode=document.getElementById("settings-verify-code").value.trim();
    if(!inputCode){errEl.textContent="認証コードを入力してください";errEl.style.display="block";return;}
    const result=verifyEmailChangeCode(inputCode);
    if(!result.valid){errEl.textContent=result.reason;errEl.style.display="block";return;}
    const newEmail=result.newEmail;
    const oldEmail=currentShop.email;
    try{const uRes=await fetch("/api/shop-auth.php?action=update-email",{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({new_email:newEmail})});const uData=await uRes.json();if(!uData.success){errEl.textContent="更新エラー: "+(uData.error||"不明");errEl.style.display="block";return;}}catch(e){errEl.textContent="通信エラー";errEl.style.display="block";return;}
    currentShop.email=newEmail;
    localStorage.setItem(SESSION_KEY,JSON.stringify({id:currentShop.id,email:newEmail}));
    localStorage.removeItem("email_change_code");
    document.getElementById("settings-current-email").textContent=newEmail;
    document.getElementById("settings-new-email").value="";
    document.getElementById("settings-email-pw").value="";
    document.getElementById("settings-verify-code").value="";
    document.getElementById("email-step1").style.display="block";
    document.getElementById("email-step2").style.display="none";
    // 旧アドレスに通知
    try{await fetch("/api/send-mail.php",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:oldEmail,subject:"【YobuHo】メールアドレスが変更されました",body:'<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2 style="color:#b5627a;">YobuHo - メールアドレス変更のお知らせ</h2><p>ご登録のメールアドレスが変更されました。</p><p>心当たりがない場合は、hotel@yobuho.com までお問い合わせください。</p><hr style="border:none;border-top:1px solid #eee;margin:20px 0;"><p style="font-size:12px;color:#888;">このメールは YobuHo (yobuho.com) から自動送信されています。</p></div>'})});}catch(e){}
    toast("メールアドレスを変更しました。次回から新しいアドレスでログインしてください。");
}

function verifyEmailChangeCode(inputCode){
    const stored=JSON.parse(localStorage.getItem("email_change_code")||"null");
    if(!stored)return{valid:false,reason:"認証コードが見つかりません。再度お試しください。"};
    if(Date.now()>stored.expires){localStorage.removeItem("email_change_code");return{valid:false,reason:"認証コードの有効期限が切れました。再度お試しください。"};}
    if(inputCode!==String(stored.code))return{valid:false,reason:"認証コードが正しくありません。"};
    return{valid:true,newEmail:stored.newEmail};
}

function cancelEmailChange(){
    localStorage.removeItem("email_change_code");
    document.getElementById("email-step1").style.display="block";
    document.getElementById("email-step2").style.display="none";
    document.getElementById("settings-verify-code").value="";
    document.getElementById("settings-verify-error").style.display="none";
}

// ===== 設定: パスワード変更 =====
async function changePassword(){
    const errEl=document.getElementById("settings-pw-error");
    errEl.style.display="none";
    const oldPw=document.getElementById("settings-old-pw").value;
    const newPw=document.getElementById("settings-new-pw").value;
    const newPw2=document.getElementById("settings-new-pw2").value;
    if(!oldPw||!newPw||!newPw2){errEl.textContent="全ての項目を入力してください";errEl.style.display="block";return;}
    try{const vRes=await fetch("/api/verify-password.php",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:currentShop.email,password:oldPw})});const vResult=await vRes.json();if(!vResult.success){errEl.textContent=vResult.error||"現在のパスワードが正しくありません";errEl.style.display="block";return;}}catch(e){errEl.textContent="認証エラー";errEl.style.display="block";return;}
    if(newPw!==newPw2){errEl.textContent="新しいパスワードが一致しません";errEl.style.display="block";return;}
    if(newPw.length<6){errEl.textContent="パスワードは6文字以上にしてください";errEl.style.display="block";return;}
    try{const res=await fetch("/api/submit-shop.php",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:currentShop.email,shop_name:"_pw_reset_",password_hash:btoa(newPw)})});const result=await res.json();if(!result.success){errEl.textContent="更新エラー: "+(result.error||"不明");errEl.style.display="block";return;}}catch(e){errEl.textContent="通信エラーが発生しました";errEl.style.display="block";return;}
    document.getElementById("settings-old-pw").value="";
    document.getElementById("settings-new-pw").value="";
    document.getElementById("settings-new-pw2").value="";
    toast("パスワードを変更しました");
}

// ===== ラブホ関連 =====
let lhMaster={atmospheres:[],good_points:[],time_slots:[]};
let lhSelectedHotelId=null;
let lhSelectedGoodPoints=[];

function saShowSubTab(tab){
    const hotelBtn=document.getElementById("sa-subtab-hotel");
    const lovehoBtn=document.getElementById("sa-subtab-loveho");
    const hotelC=document.getElementById("sa-subtab-hotel-content");
    const lovehoC=document.getElementById("sa-subtab-loveho-content");
    if(!hotelBtn||!lovehoBtn)return;
    if(tab==='hotel'){
        hotelBtn.style.borderBottomColor='var(--rose,#c47a88)';hotelBtn.style.color='var(--rose,#c47a88)';
        lovehoBtn.style.borderBottomColor='transparent';lovehoBtn.style.color='var(--text-3,#999)';
        hotelC.style.display='';lovehoC.style.display='none';
        document.getElementById("lh-form-card").style.display="none";
    }else{
        lovehoBtn.style.borderBottomColor='#c9a96e';lovehoBtn.style.color='#c9a96e';
        hotelBtn.style.borderBottomColor='transparent';hotelBtn.style.color='var(--text-3,#999)';
        hotelC.style.display='none';lovehoC.style.display='';
        lhLoadMasters();
    }
}

function lhRenderHotelCards(hotels){
    if(!hotels.length)return'<div class="loading">ラブホがありません</div>';
    return'<div class="hotel-cards">'+hotels.map((h,i)=>{
        const isReg=registeredHotelIds.has(String(h.id));
        const typeLabel=h.hotel_type==='love_hotel'?'🏩 ラブホテル':'🏠 レンタルルーム';
        const rc=h.total_reports||0;
        const rcBadge=rc>0?`<span style="font-size:10px;color:#b5627a;margin-left:6px;">💬${rc}</span>`:'';
        const regInfo=isReg?regData.find(r=>String(r.hotel_id)===String(h.id)):null;
        const actionBtns=isReg
            ?`<button class="btn btn-rose" onclick="selectHotelById(${h.id})">✏️ 編集</button><button class="btn" style="background:var(--bg-3);border:1px solid var(--border);color:var(--red);font-size:12px;" onclick="deleteRegistered('${regInfo?.id||''}')">投稿削除</button>`
            :`<button class="btn btn-rose" onclick="selectHotelById(${h.id})">📝 情報登録</button>`;
        return`<div class="hotel-card" style="animation-delay:${Math.min(i*0.03,0.3)}s"><div class="hotel-card-head"><span class="hotel-card-name">${esc(h.name)}</span><span style="font-size:11px;color:var(--text-3);margin-left:6px;">${typeLabel}</span>${rcBadge}${isReg?'<span class="hotel-card-badge">✅ 登録済み</span>':''}</div>${h.address?`<div class="hotel-card-info">📍 ${esc(h.address)}</div>`:''}${h.nearest_station?`<div class="hotel-card-info">🚉 ${esc(h.nearest_station)}</div>`:''}<div class="hotel-card-footer">${actionBtns}</div></div>`;
    }).join("")+'</div>';
}

async function lhLoadMasters(){
    if(lhMaster._loaded)return;
    const md=await getMasterJson();
    const lh=md.loveho||{};
    lhMaster.atmospheres=lh.atmospheres||[];
    lhMaster.time_slots=lh.time_slots||[];
    if(!lhMaster.time_slots.length)lhMaster.time_slots=['早朝（5:00〜8:00）','朝（8:00〜11:00）','昼（11:00〜16:00）','夕方（16:00〜18:00）','夜（18:00〜23:00）','深夜（23:00〜5:00）'];
    // 店舗投稿用にALL TIMEを先頭に追加
    if(!lhMaster.time_slots.includes('ALL TIME'))lhMaster.time_slots=['ALL TIME',...lhMaster.time_slots];
    lhMaster.good_points=lh.good_points||[];
    lhMaster._loaded=true;
    // populate selects
    const selOpt=arr=>'<option value="">選択してください</option>'+arr.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    document.getElementById("lh-f-atmosphere").innerHTML=selOpt(lhMaster.atmospheres);
    document.getElementById("lh-f-timeslot").innerHTML=selOpt(lhMaster.time_slots);
    // good points by category
    const categories=['設備・お部屋','サービス・利便性'];
    const catIcons={'設備・お部屋':'🛁','サービス・利便性':'🏨'};
    let gpHTML='';
    categories.forEach(cat=>{
        const items=lhMaster.good_points.filter(p=>p.category===cat);
        if(!items.length)return;
        gpHTML+=`<div style="margin-bottom:14px;">
            <label class="form-label">${catIcons[cat]||'📝'} ${cat} <span class="opt">複数選択可</span></label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
                ${items.map(p=>`<div onclick="lhToggleGP(this,'${esc(p.label)}')" style="cursor:pointer;padding:6px 12px;border:1px solid var(--border,#e0d5d0);border-radius:20px;font-size:12px;background:#fff;user-select:none;">${esc(p.label)}</div>`).join('')}
            </div>
        </div>`;
    });
    document.getElementById("lh-f-gp-wrap").innerHTML=gpHTML;
}

function lhToggleGP(el,label){
    const idx=lhSelectedGoodPoints.indexOf(label);
    if(idx>=0){lhSelectedGoodPoints.splice(idx,1);el.style.background='#fff';el.style.borderColor='var(--border,#e0d5d0)';el.style.fontWeight='400';}
    else{lhSelectedGoodPoints.push(label);el.style.background='rgba(201,169,110,0.15)';el.style.borderColor='rgba(201,169,110,0.5)';el.style.fontWeight='600';}
}

async function lhSelectHotel(hotelId,hotelName){
    lhSelectedHotelId=hotelId;
    lhSelectedGoodPoints=[];
    document.getElementById("info-form").classList.remove("active");
    document.getElementById("lh-form-title").textContent='🏩 '+hotelName+' に口コミ投稿';
    document.getElementById("lh-form-card").style.display="block";
    document.getElementById("lh-f-solo").value="";
    document.getElementById("lh-f-entry-method").value="";
    document.getElementById("lh-f-atmosphere").value="";
    document.getElementById("lh-f-timeslot").value="";
    document.getElementById("lh-f-comment").value="";
    document.getElementById("lh-f-poster").value=currentShop.shop_name||"店舗";
    document.getElementById("lh-f-multi").checked=false;
    document.getElementById("lh-f-multi-detail").style.display="none";
    document.getElementById("lh-f-guest-male").value="";
    document.getElementById("lh-f-guest-female").value="";
    document.querySelectorAll("#lh-f-gp-wrap div[onclick]").forEach(el=>{el.style.background='#fff';el.style.borderColor='var(--border,#e0d5d0)';el.style.fontWeight='400';});
    // 交通費リセット
    document.getElementById("lh-transport-free").checked=false;
    document.getElementById("lh-transport-fee-wrap").style.display="flex";
    document.getElementById("lh-form-transport").value="";
    // 既存の交通費データを読み込み
    let shi=null;try{const tfRes=await fetch('/api/shop-hotel-api.php?action=get-transport-fee&hotel_id='+hotelId,{credentials:'include'});shi=await tfRes.json();}catch(e){}
    if(shi){
        if(String(shi.transport_fee)==='0'){document.getElementById("lh-transport-free").checked=true;document.getElementById("lh-transport-fee-wrap").style.display="none";}
        else if(shi.transport_fee!==null&&shi.transport_fee!==''){document.getElementById("lh-form-transport").value=shi.transport_fee;}
    }
    await lhLoadMasters();
    // 既存のラブホ投稿データを読み込みフォームに反映
    const shopName=currentShop.shop_name||"店舗";
    let existLh=null;try{const lhRes=await fetch('/api/shop-hotel-api.php?action=get-existing-loveho&hotel_id='+hotelId,{credentials:'include'});existLh=await lhRes.json();}catch(e){}
    if(existLh){
        document.getElementById("lh-form-title").textContent='🏩 '+hotelName+' の情報を編集';
        if(existLh.solo_entry)document.getElementById("lh-f-solo").value=existLh.solo_entry;
        if(existLh.entry_method)document.getElementById("lh-f-entry-method").value=existLh.entry_method;
        if(existLh.atmosphere)document.getElementById("lh-f-atmosphere").value=existLh.atmosphere;
        if(existLh.time_slot)document.getElementById("lh-f-timeslot").value=existLh.time_slot;
        if(existLh.comment)document.getElementById("lh-f-comment").value=existLh.comment;
        if(existLh.multi_person){document.getElementById("lh-f-multi").checked=true;document.getElementById("lh-f-multi-detail").style.display="flex";if(existLh.guest_male)document.getElementById("lh-f-guest-male").value=existLh.guest_male;if(existLh.guest_female)document.getElementById("lh-f-guest-female").value=existLh.guest_female;if(existLh.multi_fee)document.getElementById("lh-f-multi-fee").checked=true;}
        if(existLh.good_points&&Array.isArray(existLh.good_points)){
            lhSelectedGoodPoints=existLh.good_points;
            document.querySelectorAll("#lh-f-gp-wrap div[onclick]").forEach(el=>{
                const label=el.textContent.trim();
                if(lhSelectedGoodPoints.includes(label)){el.style.background='rgba(201,169,110,0.15)';el.style.borderColor='rgba(201,169,110,0.5)';el.style.fontWeight='600';}
            });
        }
    }
}

let _lhPendingPayload=null;
function lhSubmitReport(){
    if(!lhSelectedHotelId){toast("ホテルを選択してください");return;}
    const solo=document.getElementById("lh-f-solo").value;
    const entryMethod=document.getElementById("lh-f-entry-method").value;
    const atm=document.getElementById("lh-f-atmosphere").value;
    const ts=document.getElementById("lh-f-timeslot").value;
    const comment=document.getElementById("lh-f-comment").value.trim();
    const poster=document.getElementById("lh-f-poster").value.trim();
    const multi=document.getElementById("lh-f-multi").checked;
    const hasData=solo||entryMethod||atm||ts||comment||lhSelectedGoodPoints.length;
    if(!hasData){toast("少なくとも1つ以上の項目を入力してください");return;}
    _lhPendingPayload={
        hotel_id:lhSelectedHotelId,
        report:{solo_entry:solo||null,entry_method:entryMethod||null,atmosphere:atm||null,good_points:lhSelectedGoodPoints.length?lhSelectedGoodPoints:null,time_slot:ts||null,comment:comment||null,poster_name:poster||currentShop.shop_name||"店舗",multi_person:multi,multi_fee:multi?(document.getElementById("lh-f-multi-fee").checked||false):false,guest_male:multi?(parseInt(document.getElementById("lh-f-guest-male").value)||null):null,guest_female:multi?(parseInt(document.getElementById("lh-f-guest-female").value)||null):null},
        transport_fee:getLhTransportFee()
    };
    const r=_lhPendingPayload.report;
    const soloMap={yes:'一人で入れた',no:'一人では入れなかった',together:'一緒に入室',lobby:'ロビー待機',unknown:'不明'};
    const entryMap={front:'フロント経由',direct:'直通',lobby:'ロビー待機',waiting:'外待機'};
    function row(l,v){if(!v)return '';return `<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;"><span style="min-width:90px;color:var(--text-3);font-weight:600;">${l}</span><span style="color:var(--text);word-break:break-all;">${esc(String(v))}</span></div>`;}
    const html=row('投稿者名',r.poster_name)+row('一人入室',soloMap[r.solo_entry]||null)+row('入室方法',entryMap[r.entry_method]||null)+row('雰囲気',r.atmosphere)+row('良かった点',r.good_points?r.good_points.join('、'):null)+row('時間帯',r.time_slot)+(r.multi_person?row('複数人利用',`男性${r.guest_male||0}名・女性${r.guest_female||0}名${r.multi_fee?'（追加料金あり）':''}`):'')+((_lhPendingPayload.transport_fee!=null&&_lhPendingPayload.transport_fee!=='')?row('交通費',formatFee(_lhPendingPayload.transport_fee)):'')+row('コメント',r.comment);
    document.getElementById('lh-confirm-body').innerHTML=html;
    document.getElementById('lh-confirm-modal').classList.add('active');
}
function closeLhConfirm(){document.getElementById('lh-confirm-modal').classList.remove('active');}
async function doLhSubmitReport(){
    const btn=document.getElementById("lh-confirm-submit-btn");
    btn.disabled=true;btn.textContent="送信中...";
    try{
        const res=await fetch('/api/shop-hotel-api.php?action=save-loveho-info',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(_lhPendingPayload)});
        const result=await res.json();
        if(!result.success)throw new Error(result.error||'不明なエラー');
        if(!registeredHotelIds.has(String(_lhPendingPayload.hotel_id)))registeredHotelIds.add(String(_lhPendingPayload.hotel_id));
        document.getElementById("lh-form-card").style.display="none";
        lhSelectedHotelId=null;_lhPendingPayload=null;
        closeLhConfirm();
        if(_editModal)closeEditModal();
        loadRegisteredHotels();
        _saRefreshCards();
        showSuccessModal('投稿完了！', '口コミが投稿されました。');
    }catch(e){
        toast("投稿エラー: "+e.message);
    }finally{
        btn.disabled=false;btn.textContent="この内容で投稿する";
    }
}


// ===== 未掲載ホテル情報提供 =====
function openShopHotelRequest(){
  document.getElementById('sa-hreq-name').value='';
  document.getElementById('sa-hreq-address').value='';
  document.getElementById('sa-hreq-tel').value='';
  document.getElementById('sa-hreq-type').value='business';
  document.getElementById('sa-hreq-err').style.display='none';
  document.getElementById('sa-hreq-step1').style.display='';
  document.getElementById('sa-hreq-step2').style.display='none';
  document.getElementById('sa-hreq-done').style.display='none';
  document.getElementById('sa-hreq-modal').style.display='flex';
}
function closeShopHotelRequest(){document.getElementById('sa-hreq-modal').style.display='none';}
function saHreqConfirm(){
  const name=document.getElementById('sa-hreq-name').value.trim();
  const address=document.getElementById('sa-hreq-address').value.trim();
  const err=document.getElementById('sa-hreq-err');
  if(!name||!address){err.textContent='ホテル名と住所は必須です';err.style.display='block';return;}
  err.style.display='none';
  const tel=document.getElementById('sa-hreq-tel').value.trim();
  const type=document.getElementById('sa-hreq-type').value;
  const tl=HOTEL_TYPES[type]||type;
  document.getElementById('sa-hreq-confirm-body').innerHTML=
    `<div style="margin-bottom:8px;"><span style="font-size:11px;color:var(--text-3);font-weight:600;">ホテル名</span><div style="font-size:13px;margin-top:2px;">${esc(name)}</div></div>`+
    `<div style="margin-bottom:8px;"><span style="font-size:11px;color:var(--text-3);font-weight:600;">住所</span><div style="font-size:13px;margin-top:2px;">${esc(address)}</div></div>`+
    (tel?`<div style="margin-bottom:8px;"><span style="font-size:11px;color:var(--text-3);font-weight:600;">電話番号</span><div style="font-size:13px;margin-top:2px;">${esc(tel)}</div></div>`:'')+
    `<div><span style="font-size:11px;color:var(--text-3);font-weight:600;">タイプ</span><div style="font-size:13px;margin-top:2px;">${esc(tl)}</div></div>`;
  document.getElementById('sa-hreq-step1').style.display='none';
  document.getElementById('sa-hreq-step2').style.display='';
}
function saHreqBack(){document.getElementById('sa-hreq-step2').style.display='none';document.getElementById('sa-hreq-step1').style.display='';}
async function saHreqSubmit(){
  const btn=document.getElementById('sa-hreq-submit');
  btn.disabled=true;btn.textContent='送信中...';
  const payload={hotel_name:document.getElementById('sa-hreq-name').value.trim(),address:document.getElementById('sa-hreq-address').value.trim(),tel:document.getElementById('sa-hreq-tel').value.trim()||null,hotel_type:document.getElementById('sa-hreq-type').value};
  try{const res=await fetch('/api/submit-hotel-request.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const r=await res.json();btn.disabled=false;btn.textContent='送信する';if(!r.success){toast('送信エラー: '+(r.error||'不明'));return;}}catch(e){btn.disabled=false;btn.textContent='送信する';toast('通信エラー');return;}
  document.getElementById('sa-hreq-step2').style.display='none';
  document.getElementById('sa-hreq-done').style.display='';
  showSuccessModal('送信完了！', 'ホテル情報を送信しました。');
}

// ===== プラン申込 =====
let planData=[];let _selectedPlanId=null;

async function loadPlanTab(){
    // 現在のプラン表示
    const statusEl=document.getElementById('plan-current-status');
    if(currentShop){
        try{
            const res=await fetch('/api/shop-auth.php?action=profile',{credentials:'include'});
            const p=await res.json();
            const contracts=(p.shop_contracts||[]).filter(c=>c.contract_plans?.price>0);
            if(contracts.length){
                const normalC=contracts.filter(c=>!c.is_campaign);
                const campC=contracts.filter(c=>c.is_campaign);
                let html='';
                // 通常プラン
                normalC.forEach(c=>{
                    const exp=c.expires_at?new Date(c.expires_at):null;
                    const expStr=exp?exp.toLocaleDateString('ja-JP')+'まで':'';
                    const diff=exp?Math.ceil((exp-new Date().setHours(0,0,0,0))/(1000*60*60*24)):0;
                    const diffStr=diff>0?`（残り${diff}日）`:'<span style="color:var(--red);">（期限切れ）</span>';
                    html+=`<div style="padding:8px 12px;background:var(--bg-3);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;font-size:13px;">✅ <strong>${esc(c.contract_plans.name)}</strong>（¥${Number(c.contract_plans.price).toLocaleString()}/月）${expStr?`<br><span style="font-size:11px;color:var(--text-3);">📅 ${expStr} ${diffStr}</span>`:''}</div>`;
                });
                // キャンペーンプラン
                campC.forEach(c=>{
                    const exp=c.expires_at?new Date(c.expires_at):null;
                    const expStr=exp?exp.toLocaleDateString('ja-JP')+'まで':'';
                    const diff=exp?Math.ceil((exp-new Date().setHours(0,0,0,0))/(1000*60*60*24)):0;
                    const diffStr=diff>0?`（残り${diff}日）`:'<span style="color:var(--red);">（期限切れ）</span>';
                    html+=`<div style="padding:8px 12px;background:linear-gradient(135deg,#fff8e1,#fff3cd);border:1px solid #f0d060;border-radius:8px;margin-bottom:6px;font-size:13px;">🎁 <strong>${esc(c.contract_plans.name)}</strong>（¥${Number(c.contract_plans.price).toLocaleString()}）<strong>1ヶ月無料</strong>${expStr?`<br><span style="font-size:11px;color:#5a4a2a;">📅 ${expStr} ${diffStr}</span>`:''}</div>`;
                });
                statusEl.innerHTML=html;
            }else{
                statusEl.textContent='無料プラン（有料プランへのアップグレードで広告掲載が可能です）';
            }
        }catch(e){statusEl.textContent='取得エラー';}
    }
    // プラン一覧
    try{
        const res=await fetch('/api/shop-plan-api.php?action=plans',{credentials:'include'});
        planData=await res.json();if(!Array.isArray(planData))planData=[];
    }catch(e){planData=[];}
    renderPlanGrid();
    loadPlanHistory();
}

function renderPlanGrid(){
    const grid=document.getElementById('plan-grid');
    const paid=planData.filter(p=>p.price>0);
    if(!paid.length){grid.innerHTML='<div style="color:var(--text-3);font-size:12px;">プランが見つかりません</div>';return;}
    // 無料プランカード
    let cardsHtml=`<div class="plan-card" style="border:1px solid var(--border);background:var(--bg-3);">
        <div class="plan-card-name">無料プラン</div>
        <div class="plan-card-price" style="color:var(--green);">&yen;0<small>/月</small></div>
        <div class="plan-card-desc">店名テキスト掲載・認証バッジ・専用URL発行</div>
    </div>`;
    // 有料プラン説明文マップ
    const planDescMap={
        9:'口コミ内の店舗名にオフィシャルサイトへのリンク付与・専用デザインページ・投稿日毎月自動更新',
        2:'指定した市区町村のホテル一覧・詳細ページにリッチ広告を表示（ヒーロー画像付き）・専用デザインページ・投稿日毎月自動更新',
        8:'エリア一覧にリッチ広告＋該当ホテル詳細にスタンダード広告を表示・専用デザインページ・投稿日毎月自動更新',
        3:'複数市区町村をまとめたエリアにリッチ広告＋該当ホテル詳細にスタンダード広告を表示・専用デザインページ・投稿日毎月自動更新',
        4:'都道府県エリアにリッチ広告＋該当ホテル詳細にスタンダード広告を表示・専用デザインページ・投稿日毎月自動更新',
        13:'地方エリアにリッチ広告＋該当ホテル詳細にスタンダード広告を表示・専用デザインページ・投稿日毎月自動更新',
        10:'全国エリアにリッチ広告＋該当ホテル詳細にスタンダード広告を表示・専用デザインページ・投稿日毎月自動更新',
    };
    // 有料プランカード
    cardsHtml+=paid.map(p=>`<div class="plan-card">
        <div class="plan-card-name">${esc(p.name)}</div>
        <div class="plan-card-price">&yen;${Number(p.price).toLocaleString()}<small>/月(税込)</small></div>
        <div class="plan-card-desc">${esc(planDescMap[p.id]||p.description||'')}</div>
        <div style="margin-bottom:8px;"><a href="/plan/" target="_blank" style="font-size:11px;color:var(--rose);font-weight:600;">詳細はこちら →</a></div>
        <button class="btn-apply" onclick="openPlanForm(${p.id},'${esc(p.name)}',${p.price})">このプランに申し込む</button>
    </div>`).join('');
    grid.innerHTML=cardsHtml;
}

function openPlanForm(planId,name,price){
    _selectedPlanId=planId;
    document.getElementById('plan-form-name').textContent=name+' (¥'+Number(price).toLocaleString()+'/月)';
    document.getElementById('plan-form-areas').value='';
    document.getElementById('plan-form-message').value='';
    document.getElementById('plan-form-agree').checked=false;
    document.getElementById('plan-form-card').style.display='';
    document.getElementById('plan-form-card').scrollIntoView({behavior:'smooth'});
}
function closePlanForm(){document.getElementById('plan-form-card').style.display='none';_selectedPlanId=null;}

async function submitPlanRequest(){
    if(!_selectedPlanId){toast('プランを選択してください');return;}
    if(!document.getElementById('plan-form-agree').checked){toast('広告掲載規約への同意が必要です');return;}
    if(!confirm('このプランに申し込みますか？'))return;
    const areasRaw=document.getElementById('plan-form-areas').value.trim();
    const areas=areasRaw?areasRaw.split(/[,、，\s]+/).map(s=>s.trim()).filter(Boolean):[];
    const message=document.getElementById('plan-form-message').value.trim();
    try{
        const res=await fetch('/api/shop-plan-api.php?action=submit-request',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({plan_id:_selectedPlanId,requested_areas:areas,message,agreed:true})});
        const r=await res.json();
        if(r.error){toast('⚠️ '+r.error);return;}
        closePlanForm();
        showSuccessModal('申込完了！','プラン申込を受け付けました。管理者が確認後、ご連絡いたします。');
        loadPlanHistory();
    }catch(e){toast('通信エラー');}
}

async function loadPlanHistory(){
    const el=document.getElementById('plan-history');
    try{
        const res=await fetch('/api/shop-plan-api.php?action=my-requests',{credentials:'include'});
        const rows=await res.json();if(!Array.isArray(rows)||!rows.length){el.innerHTML='<div style="padding:8px 0;color:var(--text-3);font-size:12px;">申込履歴はありません</div>';return;}
        const statusMap={pending:'審査中',approved:'承認済み',rejected:'却下',cancelled:'キャンセル'};
        el.innerHTML=rows.map(r=>{
            const areas=(r.requested_areas||[]).join(', ')||'未指定';
            const _dm=String(r.created_at||'').replace('T',' ').replace(/Z$/,'').match(/(\d{4})-(\d{2})-(\d{2})/);const date=_dm?`${_dm[1]}/${_dm[2]}/${_dm[3]}`:'—';
            const st=r.status;
            const contractLink=st==='approved'&&r.id?` <a href="/api/contract.php?id=${r.id}" target="_blank" style="color:var(--rose);font-size:11px;">契約書を見る</a>`:'';
            const cancelBtn=st==='pending'?` <button class="btn" style="font-size:10px;padding:2px 8px;" onclick="cancelPlanRequest(${r.id})">取消</button>`:'';
            return`<div class="plan-req-row"><span class="plan-req-badge ${st}">${statusMap[st]||st}</span><span style="font-weight:600;">${esc(r.plan_name)}</span><span style="color:var(--text-3);">${areas}</span><span style="color:var(--text-3);">${date}</span>${contractLink}${cancelBtn}</div>`;
        }).join('');
    }catch(e){el.innerHTML='<div style="color:var(--red);font-size:12px;">取得エラー</div>';}
}

async function cancelPlanRequest(id){
    if(!confirm('この申込を取り消しますか？'))return;
    try{
        const res=await fetch('/api/shop-plan-api.php?action=cancel-request',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({request_id:id})});
        const r=await res.json();
        if(r.error){toast('⚠️ '+r.error);return;}
        toast('✅ 申込を取り消しました');loadPlanHistory();
    }catch(e){toast('通信エラー');}
}

// ===== チャット管理 =====
let _chatOverview = null;
let _chatEditId = 0;

async function chatApi(action, params, method){
    method = method || 'POST';
    const url = method === 'GET'
        ? '/api/chat-api.php?action=' + encodeURIComponent(action) + '&' + new URLSearchParams(params || {}).toString()
        : '/api/chat-api.php?action=' + encodeURIComponent(action);
    const opts = { method, credentials: 'include', headers: method === 'POST' ? {'Content-Type':'application/json'} : {} };
    if (method === 'POST') opts.body = JSON.stringify(params || {});
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP '+res.status));
    return data;
}

async function loadChatAdmin(){
    document.getElementById('chat-admin-loading').style.display = 'block';
    document.getElementById('chat-admin-disabled').style.display = 'none';
    document.getElementById('chat-admin-enabled').style.display = 'none';
    try {
        const data = await chatApi('admin-overview', {}, 'GET');
        _chatOverview = data;
        document.getElementById('chat-admin-loading').style.display = 'none';
        if (!data.enabled) {
            document.getElementById('chat-admin-disabled').style.display = 'block';
            return;
        }
        document.getElementById('chat-admin-enabled').style.display = 'block';
        renderChatAdmin(data);
    } catch (e) {
        document.getElementById('chat-admin-loading').style.display = 'none';
        document.getElementById('chat-admin-disabled').style.display = 'block';
        toast('読み込みエラー: ' + e.message);
    }
}

// chat.html オーナー側のトグルで切り替えた時に shop-admin 側も追従させる
async function syncChatAdminToggle(){
    try {
        const data = await chatApi('admin-overview', {}, 'GET');
        if (!data || !data.enabled) return;
        _chatOverview = data;
        const onlineChk = document.getElementById('chat-admin-online');
        if (!onlineChk) return;
        const isNotifyOn = (data.notify_mode || 'off') !== 'off';
        onlineChk.checked = isNotifyOn;
        // 'off' ラジオは廃止。off の場合は 'first' を選択状態にする（ON復帰時のデフォルト）
        const radioMode = (data.notify_mode && data.notify_mode !== 'off') ? data.notify_mode : 'first';
        document.querySelectorAll('input[name="chat-notify-mode"]').forEach(rr => {
            rr.checked = (rr.value === radioMode);
        });
    } catch (e) { /* silent */ }
}
// タブ復帰時にトグル同期（chat.html 側で切り替わっていた場合の追従）
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const panel = document.getElementById('chat-admin-enabled');
    if (panel && panel.style.display !== 'none') syncChatAdminToggle();
});

function renderChatAdmin(data){
    const slug = data.slug;
    window._shopSlug = slug; // キャスト埋込コード生成で再利用
    const publicUrl = 'https://yobuho.com/chat/' + encodeURIComponent(slug) + '/';
    const sheetUrl = 'https://yobuho.com/chat-sheet.html?slug=' + encodeURIComponent(slug);
    document.getElementById('chat-admin-public-url').value = publicUrl;
    const sheetUrlInput = document.getElementById('chat-admin-sheet-url');
    if (sheetUrlInput) sheetUrlInput.value = sheetUrl;
    const ownerLink = document.getElementById('chat-admin-owner-link');
    if (ownerLink) ownerLink.href = publicUrl + '?owner=1';
    const ownerUrlInput = document.getElementById('chat-admin-owner-url');
    if (ownerUrlInput) ownerUrlInput.value = publicUrl + '?owner=1';

    // 全埋込タイプを chat.html の iframe 方式で統一。
    // 本家 chat.html を直せば 5 タイプ全部に自動反映されるため、個別UI同期作業が不要。
    // postMessage 高さ調整コードのみ埋込タイプごとに別管理（高さ指示時のみ触る）。
    const shopNameRaw = (data.shop_name || '').replace(/-->/g, '--&gt;');
    const tag = shopNameRaw ? (shopNameRaw + '専用 (slug: ' + slug + ')') : ('slug: ' + slug);

    // ① script: chat-widget.js が iframe を右下フローティングで注入（モーダル開閉付き）
    const scriptCode = '<script src="https://yobuho.com/chat-widget.js" data-slug="' + slug + '" async><\/script>';

    // ② iframe: 静的 iframe + 外部スクリプト chat-embed.js が postMessage を処理
    // 外部スクリプト方式の利点:
    //   - inline script なし → 顧客CMS の description auto-extraction を汚染しない
    //   - chat-embed.js はサーバー配信（1時間 revalidate）なので改良が全埋込先に自動反映
    //   - data-ychat-slug/min/max 属性で設定を iframe 側に明示。script 差替え不要
    // chat-embed.js が受けるメッセージ:
    //   ychat:resize / input-focus / enter-fullscreen / exit-fullscreen
    const embedBridgeTag = '<script src="https://yobuho.com/chat-embed.js" async><\/script>';
    const iframeCode =
        '<iframe data-ychat-slug="' + slug + '" data-ychat-min="500" data-ychat-max="900" src="' + publicUrl + '?embed=1" style="width:calc(100% - 16px);max-width:480px;height:640px;border:0;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.15);display:block;margin:20px auto;box-sizing:border-box;" title="お問い合わせチャット"><\/iframe>\n' +
        embedBridgeTag;

    // ③ link: 別タブで /chat/slug/ を開くシンプルリンク
    const linkCode = '<a href="' + publicUrl + '" target="_blank" rel="noopener" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#9b2d35,#7a1f27);color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;box-shadow:0 3px 10px rgba(0,0,0,.2);">💬 チャットで問い合わせる<\/a>';

    // ④ floating: 別タブで /chat/slug/ を開く浮動リンク
    const floatingCode = '<a href="' + publicUrl + '" target="_blank" rel="noopener" style="position:fixed;right:16px;bottom:16px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#9b2d35,#7a1f27);color:#fff;text-decoration:none;display:flex;align-items:center;justify-content:center;font-size:26px;box-shadow:0 4px 14px rgba(0,0,0,.22);z-index:9999;" aria-label="チャット">💬<\/a>';

    // ⑤ CMS用インライン: iframe + 外部スクリプト bridge。② と同じ外部 script 方式。
    // inline script なしなので CMS の description auto-extraction を汚染しない。
    // script が貼れない極稀なCMS向けに legacy 版（固定高さ iframe のみ）を details 内に別提供。
    const cmsCode =
        '<!-- YobuChat — ' + tag + ' -->\n' +
        '<iframe data-ychat-slug="' + slug + '" data-ychat-min="500" data-ychat-max="900" src="' + publicUrl + '?embed=1" style="width:calc(100% - 16px);max-width:480px;height:640px;border:0;display:block;background:#fff;margin:20px auto;box-sizing:border-box;" title="お問い合わせチャット"><\/iframe>\n' +
        embedBridgeTag + '\n' +
        '<!-- /YobuChat -->';

    // 旧版（script 禁止 CMS 用・固定高さ、高さ自動調整なし）
    const cmsLegacyCode =
        '<!-- YobuChat (script禁止CMS用・固定高さ) — ' + tag + ' -->\n' +
        '<iframe src="' + publicUrl + '?embed=1" style="width:100%;max-width:100%;height:640px;border:0;display:block;background:#fff;" title="お問い合わせチャット"><\/iframe>';

    const embedEls = {
        script: document.getElementById('chat-admin-embed-script'),
        iframe: document.getElementById('chat-admin-embed-iframe'),
        link: document.getElementById('chat-admin-embed-link'),
        floating: document.getElementById('chat-admin-embed-floating'),
        cms: document.getElementById('chat-admin-embed-cms'),
        cmsLegacy: document.getElementById('chat-admin-embed-cms-legacy')
    };
    if (embedEls.script) embedEls.script.value = scriptCode;
    if (embedEls.iframe) embedEls.iframe.value = iframeCode;
    if (embedEls.link) embedEls.link.value = linkCode;
    if (embedEls.floating) embedEls.floating.value = floatingCode;
    if (embedEls.cms) embedEls.cms.value = cmsCode;
    if (embedEls.cmsLegacy) embedEls.cmsLegacy.value = cmsLegacyCode;

    const tabBtns = document.querySelectorAll('.embed-tab-btn');
    const tabPanels = document.querySelectorAll('.embed-tab-panel');
    function showEmbedTab(name){
        tabPanels.forEach(p => { p.style.display = (p.dataset.embedPanel === name) ? 'block' : 'none'; });
        tabBtns.forEach(b => {
            const active = b.dataset.embedTab === name;
            b.style.background = active ? 'var(--rose)' : '';
            b.style.color = active ? '#fff' : '';
            b.style.borderColor = active ? 'var(--rose)' : '';
            b.style.fontWeight = active ? '700' : '';
        });
    }
    tabBtns.forEach(b => {
        b.onclick = () => showEmbedTab(b.dataset.embedTab);
    });
    showEmbedTab('script');

    // 通知設定トグル: notify_mode != 'off' なら ON 扱い（デフォルトOFF、DBの永続値を反映）
    const onlineChk = document.getElementById('chat-admin-online');
    const isNotifyOn = (data.notify_mode || 'off') !== 'off';
    onlineChk.checked = isNotifyOn;
    onlineChk.onchange = async () => {
        try {
            const r = await chatApi('admin-toggle-online', { is_online: onlineChk.checked ? 1 : 0 });
            // 'off' ラジオは廃止。notify_mode が off の場合は first をデフォルト選択（ON復帰時のため）
            const rMode = (r.notify_mode && r.notify_mode !== 'off') ? r.notify_mode : 'first';
            document.querySelectorAll('input[name="chat-notify-mode"]').forEach(rr => {
                rr.checked = (rr.value === rMode);
            });
            toast(r.is_online ? '✅ 通知ON（メール通知ON）' : '通知OFF（メール通知OFF）');
        } catch (e) {
            onlineChk.checked = !onlineChk.checked;
            toast('⚠️ ' + e.message);
        }
    };

    // Notify settings — 'off' ラジオは廃止のため、off なら first を選択状態に
    const initialRadioMode = (data.notify_mode && data.notify_mode !== 'off') ? data.notify_mode : 'first';
    document.querySelectorAll('input[name="chat-notify-mode"]').forEach(r => {
        r.checked = (r.value === initialRadioMode);
    });
    document.getElementById('chat-notify-interval').value = data.notify_min_interval_minutes || 3;
    const shopEmailText = data.shop_email || (currentShop && currentShop.email) || '';
    document.getElementById('chat-admin-email').textContent = shopEmailText;
    const notifyEmailInput = document.getElementById('chat-notify-email');
    if (notifyEmailInput) {
        notifyEmailInput.value = data.notify_email || '';
        notifyEmailInput.oninput = updateEffectiveNotifyEmailHint;
    }
    updateEffectiveNotifyEmailHint();

    // Reception hours
    applyReceptionUI(data.reception_start, data.reception_end);
    const r24 = document.getElementById('chat-reception-24h');
    if (r24) r24.onchange = toggleReceptionRange;

    // Welcome message
    const welEl = document.getElementById('chat-welcome-message');
    if (welEl) welEl.value = data.welcome_message || '';

    // Reservation hint
    const hintEl = document.getElementById('chat-reservation-hint');
    if (hintEl) hintEl.value = data.reservation_hint || '';

    // Devices
    renderDeviceList(data.devices || []);
    // Templates
    renderTemplateList(data.templates || []);
    // Blocks
    renderBlockList(data.blocks || []);
}

function renderDeviceList(devices){
    const el = document.getElementById('chat-admin-device-list');
    const countEl = document.getElementById('chat-admin-device-count');
    if (countEl) countEl.textContent = devices.length ? `(${devices.length}件)` : '';
    if (!devices.length) {
        el.innerHTML = '<div style="color:var(--text-3);font-size:12px;">登録済み端末はありません</div>';
        return;
    }
    const localToken = (function(){ try { return localStorage.getItem('chat_owner_token') || ''; } catch(_){ return ''; } })();
    el.innerHTML = devices.map(d => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#fafafa;border:1px solid #eee;border-radius:6px;margin-bottom:4px;gap:8px;">
                <div>
                    <div style="font-weight:600;font-size:12px;">${esc(d.device_name || '名称なし')}</div>
                    <div style="font-size:11px;color:var(--text-3);">登録: ${esc(d.created_at || '')} / 最終アクセス: ${esc(d.last_accessed_at || '未使用')}</div>
                </div>
                <button class="btn" style="padding:4px 10px;font-size:11px;background:#fce4ec;color:#c62828;border-color:#f8bbd0;" onclick="revokeDevice(${d.id})">削除</button>
            </div>
        `).join('');

    // 「このブラウザを登録」ヒント更新
    const hint = document.getElementById('chat-register-device-hint');
    if (hint) {
        if (localToken) {
            hint.textContent = '※ このブラウザは既にチャット受信端末として登録されています。再登録すると別の端末として二重に登録されます。';
            hint.style.color = '#a08000';
        } else {
            hint.textContent = '※ 登録後、このブラウザのlocalStorageに端末トークンが保存されます。共有PCでは使わないでください。';
            hint.style.color = 'var(--text-3)';
        }
    }
}

async function registerThisBrowser(){
    const nameEl = document.getElementById('chat-register-device-name');
    const deviceName = nameEl ? String(nameEl.value || '').trim() : '';
    if (!confirm('このブラウザをチャット受信端末として登録しますか？\n\n登録するとトークンがlocalStorageに保存され、次回から自動で店舗受信画面が開きます。共有PCでは登録しないでください。')) return;
    try {
        const r = await chatApi('register-device', { device_name: deviceName || 'ブラウザ登録' });
        if (!r.device_token) throw new Error('端末トークンの発行に失敗しました');
        try { localStorage.setItem('chat_owner_token', r.device_token); } catch(_){}
        if (nameEl) nameEl.value = '';
        toast('✅ このブラウザを登録しました');
        const data = await chatApi('admin-overview', {}, 'GET');
        renderDeviceList(data.devices || []);
    } catch (e) {
        toast('⚠️ ' + e.message);
    }
}

function renderTemplateList(templates){
    const el = document.getElementById('chat-tpl-list');
    if (!templates.length) {
        el.innerHTML = '<div style="color:var(--text-3);font-size:12px;">定型文はまだ登録されていません</div>';
        return;
    }
    // コンパクトチップ表示: 並替◀▶ + タイトル + 編集/削除。本文はホバーでツールチップ
    el.innerHTML = templates.map((t, i) => {
        const preview = esc(String(t.content).slice(0, 120)) + (String(t.content).length > 120 ? '…' : '');
        const isFirst = i === 0;
        const isLast = i === templates.length - 1;
        return `
        <div title="${preview}" style="display:inline-flex;align-items:center;gap:4px;padding:5px 8px;background:#fce4ec;border:1px solid #f8bbd0;border-radius:16px;font-size:12px;">
            <button class="btn" style="padding:2px 5px;font-size:10px;background:#fff;border:1px solid #e5a4b7;border-radius:10px;${isFirst?'opacity:0.3;cursor:not-allowed;':''}" onclick="moveTemplate(${t.id}, -1)" ${isFirst?'disabled':''} aria-label="左へ">◀</button>
            <span style="font-weight:600;color:#8a2c4a;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.title)}</span>
            <button class="btn" style="padding:2px 5px;font-size:10px;background:#fff;border:1px solid #e5a4b7;border-radius:10px;${isLast?'opacity:0.3;cursor:not-allowed;':''}" onclick="moveTemplate(${t.id}, 1)" ${isLast?'disabled':''} aria-label="右へ">▶</button>
            <button class="btn" style="padding:2px 6px;font-size:10px;background:#fff;border:1px solid #e5a4b7;border-radius:10px;" onclick='editTemplate(${t.id})' aria-label="編集">編集</button>
            <button class="btn" style="padding:2px 6px;font-size:10px;background:#fff;color:#c62828;border:1px solid #f8bbd0;border-radius:10px;" onclick="deleteTemplate(${t.id})" aria-label="削除">×</button>
        </div>
    `}).join('');
}

async function moveTemplate(id, direction){
    if (!_chatOverview) return;
    const templates = _chatOverview.templates || [];
    const idx = templates.findIndex(x => Number(x.id) === Number(id));
    if (idx < 0) return;
    const neighborIdx = idx + direction;
    if (neighborIdx < 0 || neighborIdx >= templates.length) return;
    const a = templates[idx];
    const b = templates[neighborIdx];
    try {
        // sort_order を入れ替え
        await chatApi('admin-save-template', { id: a.id, title: a.title, content: a.content, sort_order: Number(b.sort_order) });
        await chatApi('admin-save-template', { id: b.id, title: b.title, content: b.content, sort_order: Number(a.sort_order) });
        const data = await chatApi('admin-overview', {}, 'GET');
        _chatOverview = data;
        renderTemplateList(data.templates || []);
    } catch (e) { toast('⚠️ ' + e.message); }
}

function renderBlockList(blocks){
    const el = document.getElementById('chat-block-list');
    if (!blocks.length) {
        el.innerHTML = '<div style="color:var(--text-3);font-size:12px;">ブロック中のユーザーはいません</div>';
        return;
    }
    el.innerHTML = blocks.map(b => {
        const label = b.nickname ? esc(b.nickname) : (b.session_id ? `訪問者 #${b.session_id}` : 'ユーザー');
        const lastMsg = b.last_message ? `「${esc(String(b.last_message).slice(0,40))}${String(b.last_message).length>40?'…':''}」` : '';
        return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#fafafa;border:1px solid #eee;border-radius:6px;margin-bottom:4px;gap:8px;">
            <div style="min-width:0;flex:1;">
                <div style="font-size:13px;font-weight:600;color:var(--text-1);">${label}</div>
                ${lastMsg ? `<div style="font-size:11px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${lastMsg}</div>` : ''}
                <div style="font-size:10px;color:var(--text-3);">${esc(b.reason || '理由なし')} / ${esc(b.created_at || '')}</div>
            </div>
            <button class="btn" style="padding:4px 10px;font-size:11px;flex-shrink:0;" onclick="unblockUser(${b.id})">解除</button>
        </div>
    `}).join('');
}

function copyChatUrl(id){
    const el = document.getElementById(id);
    el.select();
    try { document.execCommand('copy'); toast('✅ コピーしました'); }
    catch(e){ navigator.clipboard && navigator.clipboard.writeText(el.value).then(()=>toast('✅ コピーしました')); }
}

async function revokeDevice(id){
    if (!confirm('この端末を削除しますか？削除後はこの端末からチャット受信できなくなります。')) return;
    try {
        await chatApi('admin-revoke-device', { id });
        toast('✅ 削除しました');
        const data = await chatApi('admin-overview', {}, 'GET');
        renderDeviceList(data.devices || []);
    } catch (e) { toast('⚠️ ' + e.message); }
}

async function saveChatSettings(){
    const mode = document.querySelector('input[name="chat-notify-mode"]:checked');
    const interval = parseInt(document.getElementById('chat-notify-interval').value, 10) || 3;
    if (!mode) { toast('通知モードを選択してください'); return; }

    const is24h = document.getElementById('chat-reception-24h').checked;
    let rStart = null, rEnd = null;
    if (!is24h) {
        rStart = document.getElementById('chat-reception-start').value || '';
        rEnd = document.getElementById('chat-reception-end').value || '';
        if (!rStart || !rEnd) { toast('受付時間の開始と終了を入力してください（24時間受付の場合はチェックを入れてください）'); return; }
        if (rStart === rEnd) { toast('開始と終了が同じ時刻です。24時間受付にする場合はチェックボックスを使ってください'); return; }
    }

    const welcomeEl = document.getElementById('chat-welcome-message');
    const welcome = welcomeEl ? String(welcomeEl.value || '').trim() : '';

    const hintEl = document.getElementById('chat-reservation-hint');
    const reservationHint = hintEl ? String(hintEl.value || '').trim() : '';

    const notifyEmailEl = document.getElementById('chat-notify-email');
    const notifyEmail = notifyEmailEl ? String(notifyEmailEl.value || '').trim() : '';
    if (notifyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail)) {
        toast('通知先メールアドレスの形式が正しくありません'); return;
    }

    // 通知トグルが OFF の場合は 'off' を送る（ラジオ値で上書きしない）
    const toggleOn = !!(document.getElementById('chat-admin-online') || {}).checked;
    const notifyModeToSend = toggleOn ? mode.value : 'off';

    try {
        await chatApi('admin-save-settings', {
            notify_mode: notifyModeToSend,
            notify_min_interval_minutes: interval,
            reception_start: rStart,
            reception_end: rEnd,
            welcome_message: welcome,
            reservation_hint: reservationHint,
            notify_email: notifyEmail
        });
        toast('✅ 設定を保存しました');
        updateEffectiveNotifyEmailHint();
    } catch (e) { toast('⚠️ ' + e.message); }
}

function updateEffectiveNotifyEmailHint(){
    const hint = document.getElementById('chat-notify-effective');
    if (!hint) return;
    const notifyEl = document.getElementById('chat-notify-email');
    const shopEl = document.getElementById('chat-admin-email');
    const notify = notifyEl ? String(notifyEl.value || '').trim() : '';
    const shopEmail = shopEl ? shopEl.textContent.trim() : '';
    const effective = notify || shopEmail;
    hint.textContent = effective ? ('→ 現在の通知先: ' + effective) : '';
}

function applyReceptionUI(start, end){
    const is24h = !start || !end;
    document.getElementById('chat-reception-24h').checked = is24h;
    document.getElementById('chat-reception-start').value = start ? String(start).slice(0,5) : '';
    document.getElementById('chat-reception-end').value = end ? String(end).slice(0,5) : '';
    toggleReceptionRange();
}
function toggleReceptionRange(){
    const disabled = document.getElementById('chat-reception-24h').checked;
    document.getElementById('chat-reception-start').disabled = disabled;
    document.getElementById('chat-reception-end').disabled = disabled;
    document.getElementById('chat-reception-range').style.opacity = disabled ? '0.5' : '1';
}

async function saveTemplate(){
    const title = document.getElementById('chat-tpl-title').value.trim();
    const content = document.getElementById('chat-tpl-content').value.trim();
    if (!title || !content) { toast('タイトルと内容を入力してください'); return; }
    try {
        const params = { title, content };
        if (_chatEditId > 0) {
            // 編集時は既存の sort_order を維持
            params.id = _chatEditId;
            const cur = (_chatOverview?.templates || []).find(x => Number(x.id) === _chatEditId);
            params.sort_order = cur ? Number(cur.sort_order) : 100;
        } else {
            // 新規登録: 既存の最大 sort_order + 10（末尾に追加）
            const existing = _chatOverview?.templates || [];
            const maxSort = existing.length ? Math.max(...existing.map(t => Number(t.sort_order) || 0)) : 0;
            params.sort_order = maxSort + 10;
        }
        await chatApi('admin-save-template', params);
        toast('✅ 保存しました');
        document.getElementById('chat-tpl-title').value = '';
        document.getElementById('chat-tpl-content').value = '';
        cancelEditTemplate();
        const data = await chatApi('admin-overview', {}, 'GET');
        _chatOverview = data;
        renderTemplateList(data.templates || []);
    } catch (e) { toast('⚠️ ' + e.message); }
}

function editTemplate(id){
    if (!_chatOverview) return;
    const t = (_chatOverview.templates || []).find(x => Number(x.id) === Number(id));
    if (!t) return;
    _chatEditId = Number(id);
    document.getElementById('chat-tpl-title').value = t.title;
    document.getElementById('chat-tpl-content').value = t.content;
    document.getElementById('chat-tpl-save-btn').textContent = '更新';
    document.getElementById('chat-tpl-cancel-btn').style.display = 'inline-block';
    document.getElementById('chat-tpl-title').focus();
}

function cancelEditTemplate(){
    _chatEditId = 0;
    document.getElementById('chat-tpl-save-btn').textContent = '追加';
    document.getElementById('chat-tpl-cancel-btn').style.display = 'none';
}

async function deleteTemplate(id){
    if (!confirm('この定型文を削除しますか？')) return;
    try {
        await chatApi('admin-delete-template', { id });
        toast('✅ 削除しました');
        const data = await chatApi('admin-overview', {}, 'GET');
        _chatOverview = data;
        renderTemplateList(data.templates || []);
    } catch (e) { toast('⚠️ ' + e.message); }
}

async function unblockUser(id){
    if (!confirm('このユーザーのブロックを解除しますか？')) return;
    try {
        await chatApi('admin-unblock', { id });
        toast('✅ 解除しました');
        const data = await chatApi('admin-overview', {}, 'GET');
        renderBlockList(data.blocks || []);
    } catch (e) { toast('⚠️ ' + e.message); }
}

// ===== キャスト管理 =====
let _castEditingId = null;

async function castApi(action, body = null, method = 'POST'){
    const url = '/api/shop-cast-api.php?action=' + encodeURIComponent(action);
    const opts = { method, credentials: 'include' };
    if (method === 'POST') {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body || {});
    }
    let res;
    try { res = await fetch(url, opts); } catch (e) { throw new Error('通信に失敗しました'); }
    let data;
    try { data = await res.json(); } catch (e) { throw new Error('サーバー応答が不正です'); }
    if (!res.ok || data.error) throw new Error(data.error || 'エラーが発生しました');
    return data;
}

async function loadCastTab(){
    const loading = document.getElementById('cast-admin-loading');
    const body = document.getElementById('cast-admin-body');
    loading.style.display = 'block';
    body.style.display = 'none';
    try {
        const data = await castApi('list', null, 'GET');
        // 埋込コード生成 (openCastEmbedCode) で使う shop slug を保持. chat タブ未訪問でも参照可能に.
        if (data.shop_slug) window._shopSlug = data.shop_slug;
        renderCastSummary(data);
        renderCastList(data.casts || []);
        renderCastPending(data.pending_invites || []);
        loading.style.display = 'none';
        body.style.display = 'block';
    } catch (e) {
        loading.innerHTML = '<div style="color:#c33;">読み込みエラー: ' + esc(e.message) + '</div>';
    }
}

// 「更新」ボタン: ページ全体をリロードせずキャスト一覧/承認待ちのみ再取得
async function refreshCastList(){
    const btn = document.getElementById('btn-refresh-cast-list');
    const icon = document.getElementById('btn-refresh-cast-icon');
    if (!btn) return;
    btn.disabled = true;
    btn.style.opacity = '0.6';
    btn.style.cursor = 'wait';
    if (icon) { icon.style.display = 'inline-block'; icon.style.animation = 'castRefreshSpin 0.8s linear infinite'; }
    try {
        const data = await castApi('list', null, 'GET');
        if (data.shop_slug) window._shopSlug = data.shop_slug;
        renderCastSummary(data);
        renderCastList(data.casts || []);
        renderCastPending(data.pending_invites || []);
    } catch (e) {
        if (typeof showToast === 'function') showToast('更新に失敗しました: ' + (e && e.message ? e.message : '不明なエラー'), 'error');
        else alert('更新に失敗しました: ' + (e && e.message ? e.message : '不明なエラー'));
    } finally {
        btn.disabled = false;
        btn.style.opacity = '';
        btn.style.cursor = '';
        if (icon) { icon.style.animation = ''; }
    }
}

function renderCastSummary(d){
    const limit = Number(d.cast_limit) || 0;
    const used = Number(d.cast_used) || 0;
    const remaining = Math.max(0, limit - used);
    const over = used > limit;
    const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    const barColor = over ? '#c33' : (pct >= 80 ? '#d97706' : '#059669');
    const planName = (d.cast_plan_name || '').trim();
    const summary = document.getElementById('cast-limit-summary');
    if (limit <= 0) {
        summary.innerHTML = '<div style="color:#c33;font-weight:600;">現在のプランではキャスト登録ができません。<a href="#" onclick="switchTab(\'plan\');return false;" style="color:var(--rose);">プランをアップグレード →</a></div>';
        document.getElementById('cast-invite-btn').disabled = true;
        return;
    }
    const planBadge = planName
        ? '<span style="font-size:11px;padding:2px 10px;background:#fff5e6;color:#a05a00;border:1px solid #f0d9a8;border-radius:10px;font-weight:700;white-space:nowrap;">' + esc(planName) + '</span>'
        : '';
    summary.innerHTML =
        '<div style="flex:1;min-width:160px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;">'
        +   '<strong style="font-size:15px;color:var(--text-1);">' + used + ' / ' + limit + ' 名</strong>'
        +   '<span style="color:var(--text-3);">（残り ' + remaining + ' 枠）</span>'
        +   planBadge
        + '</div>'
        + '<div style="flex:1 1 240px;min-width:160px;height:10px;background:#eee;border-radius:5px;overflow:hidden;">'
        + '<div style="width:' + pct + '%;height:100%;background:' + barColor + ';transition:width .3s;"></div></div>';
    const inviteBtn = document.getElementById('cast-invite-btn');
    inviteBtn.disabled = (remaining <= 0);
    if (remaining <= 0) {
        inviteBtn.textContent = '📩 招待メールを送信（枠がいっぱいです）';
    } else {
        inviteBtn.textContent = '📩 招待メールを送信';
    }
}

function renderCastList(casts){
    const el = document.getElementById('cast-list');
    if (!casts.length) {
        el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-3);font-size:13px;">まだキャストが登録されていません。上の招待フォームから追加してください。</div>';
        return;
    }
    el.innerHTML = casts.map(c => {
        const hasPwd = Number(c.has_password) === 1;
        const isPending = c.status === 'pending_approval';
        let statusBadge;
        if (c.status === 'suspended') {
            statusBadge = '<span style="font-size:11px;padding:2px 8px;background:#fff3cd;color:#856404;border-radius:10px;">一時停止中</span>';
        } else if (isPending) {
            statusBadge = hasPwd
                ? '<span style="font-size:11px;padding:2px 8px;background:#ffe4b5;color:#b76500;border-radius:10px;font-weight:700;">⏳ 承認待ち</span>'
                : '<span style="font-size:11px;padding:2px 8px;background:#fef3c7;color:#92400e;border-radius:10px;">メール認証待ち</span>';
        } else {
            statusBadge = '<span style="font-size:11px;padding:2px 8px;background:#d1fae5;color:#065f46;border-radius:10px;">✓ 承認済み</span>';
        }
        const lastLogin = c.last_login_at ? ('最終ログイン: ' + formatCastDate(c.last_login_at)) : 'ログイン履歴なし';
        const bio = c.bio ? '<div style="font-size:12px;color:var(--text-3);margin-top:6px;white-space:pre-wrap;">' + esc(c.bio) + '</div>' : '';
        const approveBtn = (isPending && hasPwd)
            ? '<button type="button" class="btn primary" onclick="approveCast(\'' + esc(c.id) + '\',\'' + esc(c.display_name) + '\')" style="padding:6px 12px;font-size:12px;font-weight:700;">✓ 承認する</button>'
            : '';
        const pendingHint = (isPending && !hasPwd)
            ? '<div style="font-size:11px;color:#b76500;margin-top:6px;">⚠️ キャスト本人が招待メールのリンクからパスワード設定を完了すると承認ボタンが表示されます。</div>'
            : '';
        const cardBg = isPending ? '#fffdf5' : 'var(--bg-2)';
        const cardBorder = isPending ? '#ffd580' : 'var(--border)';
        const chatBtn = (!isPending)
            ? '<button type="button" class="btn" onclick="openCastChatViewer(\'' + esc(c.id) + '\',\'' + esc(c.display_name) + '\')" style="padding:6px 12px;font-size:12px;">💬 チャット履歴</button>'
            : '';
        const embedBtn = (!isPending && c.status !== 'suspended')
            ? '<button type="button" class="btn" onclick="openCastEmbedCode(\'' + esc(c.id) + '\',\'' + esc(c.display_name) + '\')" style="padding:6px 12px;font-size:12px;">🔗 埋込コード</button>'
            : '';
        const notifyOn = (c.chat_notify_mode && c.chat_notify_mode !== 'off');
        const notifyToggle = (!isPending && c.status !== 'suspended')
            ? '<label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;" title="チャット通知メールのON/OFF">'
                + '<span class="cht-tg-label" style="font-size:12px;">🔔 通知</span>'
                + '<span class="cht-tg-switch">'
                    + '<input type="checkbox" ' + (notifyOn ? 'checked' : '') + ' onchange="toggleCastNotify(\'' + esc(c.id) + '\', this.checked)">'
                    + '<span class="cht-tg-slider"></span>'
                + '</span>'
              + '</label>'
            : '';
        return ''
            + '<div style="padding:12px 14px;background:' + cardBg + ';border:1px solid ' + cardBorder + ';border-radius:8px;">'
            + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
            + '<div style="flex:1;min-width:180px;"><strong style="font-size:14px;color:var(--text-1);">' + esc(c.display_name) + '</strong> ' + statusBadge + '</div>'
            + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">'
            + approveBtn
            + notifyToggle
            + chatBtn
            + embedBtn
            + '<button type="button" class="btn" onclick="openCastEdit(\'' + esc(c.id) + '\')" style="padding:6px 12px;font-size:12px;">✏️ 編集</button>'
            + '<button type="button" class="btn" onclick="removeCast(\'' + esc(c.id) + '\',\'' + esc(c.display_name) + '\')" style="padding:6px 12px;font-size:12px;color:#c33;">✕ 削除</button>'
            + '</div></div>'
            + '<div style="font-size:12px;color:var(--text-3);margin-top:6px;">' + esc(c.email) + ' / ' + esc(lastLogin) + '</div>'
            + bio
            + pendingHint
            + '</div>';
    }).join('');
}

function renderCastPending(invites){
    const card = document.getElementById('cast-pending-card');
    const list = document.getElementById('cast-pending-list');
    if (!invites.length) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    list.innerHTML = invites.map(iv => ''
        + '<div style="padding:10px 12px;background:#fffbea;border:1px solid #ffe082;border-radius:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
        + '<div style="flex:1;min-width:180px;font-size:13px;">'
        + '<strong>' + esc(iv.display_name) + '</strong> / ' + esc(iv.email)
        + '<div style="font-size:11px;color:var(--text-3);margin-top:2px;">有効期限: ' + formatCastDate(iv.expires_at) + '</div>'
        + '</div>'
        + '<button type="button" class="btn" onclick="resendCastInvite(\'' + esc(iv.id) + '\')" style="padding:6px 12px;font-size:12px;">📩 再送</button>'
        + '<button type="button" class="btn" onclick="cancelCastInvite(\'' + esc(iv.id) + '\',\'' + esc(iv.display_name) + '\')" style="padding:6px 12px;font-size:12px;color:#c62828;border-color:#ffcdd2;">✕ 取消</button>'
        + '</div>'
    ).join('');
}

async function cancelCastInvite(inviteId, name){
    if (!confirm((name || 'この招待') + ' を取り消します。よろしいですか？\n（キャストは申請できなくなります）')) return;
    try {
        await castApi('cancel-invite', { invite_id: inviteId });
        toast('✅ 招待を取り消しました');
        await loadCastTab();
    } catch (e) {
        toast('⚠️ ' + e.message);
    }
}

function formatCastDate(s){
    if (!s) return '';
    try {
        const d = new Date(s.replace(' ', 'T') + '+09:00');
        if (isNaN(d.getTime())) return s;
        const Y = d.getFullYear(), M = String(d.getMonth()+1).padStart(2,'0'), D = String(d.getDate()).padStart(2,'0');
        const h = String(d.getHours()).padStart(2,'0'), m = String(d.getMinutes()).padStart(2,'0');
        return Y + '/' + M + '/' + D + ' ' + h + ':' + m;
    } catch (e) { return s; }
}

async function inviteCast(){
    const nameEl = document.getElementById('cast-invite-name');
    const emailEl = document.getElementById('cast-invite-email');
    const name = (nameEl.value || '').trim();
    const email = (emailEl.value || '').trim();
    if (!name) { toast('⚠️ 源氏名を入力してください'); nameEl.focus(); return; }
    if (!email) { toast('⚠️ メールアドレスを入力してください'); emailEl.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('⚠️ メールアドレスの形式が正しくありません'); emailEl.focus(); return; }
    if (!confirm(email + ' に招待メールを送信します。よろしいですか？')) return;
    const btn = document.getElementById('cast-invite-btn');
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = '送信中…';
    try {
        await castApi('invite', { email, display_name: name });
        toast('✅ 招待メールを送信しました');
        nameEl.value = ''; emailEl.value = '';
        await loadCastTab();
    } catch (e) {
        toast('⚠️ ' + e.message);
        btn.disabled = false; btn.textContent = original;
    }
}

let _castEditAvatarData = null; // null=変更なし, ''=削除, 'data:...'=新規

// キャスト指名版の埋込コード表示モーダル.
// chat-widget.js に data-cast / data-label を渡して、特定キャスト宛に固定したフローティング
// チャットボタンを生成する. キャスト指名チップは自動で出ない (chat.js setupEmbedDirectLinkFooter
// が CAST_ID 検出で picker を出さない). 緑丸はキャストの notify トグルに同期.
function openCastEmbedCode(shopCastId, displayName){
    const slug = window._shopSlug || '';
    if (!slug) { toast('⚠️ 店舗情報の読み込み待ち。少ししてから再度お試しください'); return; }
    const publicUrl = 'https://yobuho.com/chat/' + encodeURIComponent(slug) + '/';
    const castUrl = publicUrl + '?cast=' + encodeURIComponent(shopCastId);
    // シート版URL: chat-sheet.html?slug=...&cast=... — モバイル(タッチ端末)はシート、PCは /chat/ へ
    // リダイレクト. 既にお店リンクで chat-sheet.html?slug=... を使っている場合のキャスト指名版.
    const sheetUrl = 'https://yobuho.com/chat-sheet.html?slug=' + encodeURIComponent(slug) + '&cast=' + encodeURIComponent(shopCastId);
    const label = displayName + 'に相談';
    // ① script: chat-widget.js でフローティングボタン (推奨)
    const scriptCode = '<script src="https://yobuho.com/chat-widget.js" data-slug="' + slug + '" data-cast="' + shopCastId + '" data-label="' + label.replace(/"/g, '&quot;') + '" async><\/script>';
    // ② iframe: 静的 iframe + chat-embed.js (CMS 向け)
    const iframeCode =
        '<iframe data-ychat-slug="' + slug + '" data-ychat-min="500" data-ychat-max="900" src="' + castUrl + '&embed=1" style="width:calc(100% - 16px);max-width:480px;height:640px;border:0;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.15);display:block;margin:20px auto;box-sizing:border-box;" title="' + label + '"><\/iframe>\n' +
        '<script src="https://yobuho.com/chat-embed.js" async><\/script>';
    // ③ link: 別タブで指名URLを開く
    const linkCode = '<a href="' + castUrl + '" target="_blank" rel="noopener" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#9b2d35,#7a1f27);color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;box-shadow:0 3px 10px rgba(0,0,0,.2);">💬 ' + label + '<\/a>';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = ''
        + '<div style="background:#fff;border-radius:12px;padding:20px;max-width:640px;width:100%;max-height:90vh;overflow:auto;">'
        +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'
        +     '<h3 style="margin:0;font-size:16px;color:var(--text-1);">🔗 ' + esc(displayName) + ' 専用 埋込コード</h3>'
        +     '<button type="button" class="btn" data-cast-embed-close style="padding:4px 10px;font-size:13px;">✕</button>'
        +   '</div>'
        +   '<div style="font-size:12px;color:var(--text-3);margin-bottom:14px;line-height:1.5;">'
        +     'キャスト「' + esc(displayName) + '」に固定で繋がるチャット。指名チップは表示されず、🟢ドットはキャスト本人の通知トグルに同期します。'
        +   '</div>'

        +   '<div style="margin-bottom:18px;">'
        +     '<div style="font-weight:700;font-size:13px;margin-bottom:6px;">① フローティングボタン（推奨）</div>'
        +     '<div style="font-size:11px;color:var(--text-3);margin-bottom:6px;">ページ右下に💬ボタン → タップでモーダル開閉。</div>'
        +     '<textarea readonly rows="3" class="f-input" style="width:100%;font-family:monospace;font-size:11px;background:#fafafa;" id="_cast-embed-script">' + scriptCode + '</textarea>'
        +     '<button type="button" class="btn primary" data-cast-embed-copy="_cast-embed-script" style="margin-top:6px;padding:6px 14px;font-size:12px;">コピー</button>'
        +   '</div>'

        +   '<div style="margin-bottom:18px;">'
        +     '<div style="font-weight:700;font-size:13px;margin-bottom:6px;">② インラインiframe（CMS向け）</div>'
        +     '<div style="font-size:11px;color:var(--text-3);margin-bottom:6px;">記事内に直接表示する場合。</div>'
        +     '<textarea readonly rows="4" class="f-input" style="width:100%;font-family:monospace;font-size:11px;background:#fafafa;" id="_cast-embed-iframe">' + iframeCode + '</textarea>'
        +     '<button type="button" class="btn primary" data-cast-embed-copy="_cast-embed-iframe" style="margin-top:6px;padding:6px 14px;font-size:12px;">コピー</button>'
        +   '</div>'

        +   '<div style="margin-bottom:18px;">'
        +     '<div style="font-weight:700;font-size:13px;margin-bottom:6px;">③ 別タブリンク</div>'
        +     '<div style="font-size:11px;color:var(--text-3);margin-bottom:6px;">ボタンをクリックで別タブにチャット画面を開く。</div>'
        +     '<textarea readonly rows="2" class="f-input" style="width:100%;font-family:monospace;font-size:11px;background:#fafafa;" id="_cast-embed-link">' + linkCode + '</textarea>'
        +     '<button type="button" class="btn primary" data-cast-embed-copy="_cast-embed-link" style="margin-top:6px;padding:6px 14px;font-size:12px;">コピー</button>'
        +   '</div>'

        +   '<div style="margin-bottom:14px;">'
        +     '<div style="font-weight:700;font-size:13px;margin-bottom:6px;">開閉式チャットURL（おすすめ）</div>'
        +     '<div style="font-size:11px;color:var(--text-3);margin-bottom:6px;">SNS/LINE/QR等で共有するURL。スマホは下からシートが開閉、PCは新タブでチャット画面が開きます。</div>'
        +     '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
        +       '<input type="text" readonly class="f-input" value="' + sheetUrl + '" style="flex:1;min-width:240px;font-size:12px;background:#fafafa;" id="_cast-embed-sheet-url">'
        +       '<button type="button" class="btn" data-cast-embed-copy="_cast-embed-sheet-url" style="padding:6px 14px;font-size:12px;">コピー</button>'
        +     '</div>'
        +   '</div>'

        +   '<div style="margin-bottom:8px;">'
        +     '<div style="font-weight:700;font-size:13px;margin-bottom:6px;">直リンクURL（/chat/ 版）</div>'
        +     '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
        +       '<input type="text" readonly class="f-input" value="' + castUrl + '" style="flex:1;min-width:240px;font-size:12px;background:#fafafa;" id="_cast-embed-url">'
        +       '<button type="button" class="btn" data-cast-embed-copy="_cast-embed-url" style="padding:6px 14px;font-size:12px;">コピー</button>'
        +     '</div>'
        +   '</div>'
        + '</div>';
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    const close = () => { overlay.remove(); document.body.style.overflow = ''; };
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
        const closeBtn = e.target.closest('[data-cast-embed-close]');
        if (closeBtn) close();
        const copyBtn = e.target.closest('[data-cast-embed-copy]');
        if (copyBtn) {
            const targetId = copyBtn.getAttribute('data-cast-embed-copy');
            const el = document.getElementById(targetId);
            if (el) {
                el.select();
                try { document.execCommand('copy'); toast('✓ コピーしました'); } catch (_) { toast('⚠️ コピーに失敗。手動で選択してください'); }
            }
        }
    });
}

function openCastEdit(id){
    const card = Array.from(document.querySelectorAll('#cast-list > div')).find(el => el.innerHTML.includes(id));
    _castEditingId = id;
    _castEditAvatarData = null;
    fetch('/api/shop-cast-api.php?action=list', { credentials: 'include' })
        .then(r => r.json()).then(d => {
            const c = (d.casts || []).find(x => x.id === id);
            if (!c) { toast('⚠️ キャスト情報が見つかりません'); return; }
            document.getElementById('cast-edit-name').value = c.display_name || '';
            document.getElementById('cast-edit-bio').value = c.bio || '';
            document.getElementById('cast-edit-sort').value = c.sort_order != null ? c.sort_order : '';
            document.getElementById('cast-edit-status').value = (c.status === 'suspended') ? 'suspended' : 'active';
            document.getElementById('cast-edit-notify-mode').value = c.chat_notify_mode || 'off';
            document.getElementById('cast-edit-notify-email').value = c.chat_notify_email || '';
            document.getElementById('cast-edit-default-email').textContent = c.email || '—';
            setCastAvatarPreview(c.profile_image_url || null);
            document.getElementById('cast-edit-avatar-input').value = '';
            document.getElementById('cast-edit-modal').classList.add('active');
            document.body.style.overflow = 'hidden';
        });
}

function setCastAvatarPreview(url){
    const preview = document.getElementById('cast-edit-avatar-preview');
    const removeBtn = document.getElementById('cast-edit-avatar-remove');
    if (url) {
        preview.style.backgroundImage = "url('" + url.replace(/'/g, "\\'") + "')";
        preview.style.backgroundSize = 'cover';
        removeBtn.style.display = 'inline-block';
    } else {
        preview.style.backgroundImage = "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%239ca3af%22><path d=%22M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z%22/></svg>')";
        preview.style.backgroundSize = '60%';
        preview.style.backgroundColor = '#e5e7eb';
        removeBtn.style.display = 'none';
    }
}

function clearCastAvatar(){
    _castEditAvatarData = '';
    setCastAvatarPreview(null);
    document.getElementById('cast-edit-avatar-input').value = '';
}

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('cast-edit-avatar-input');
    if (input) {
        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            if (!['image/jpeg','image/png'].includes(file.type)) { toast('⚠️ JPG/PNGのみ対応です'); input.value=''; return; }
            if (file.size > 5 * 1024 * 1024) { toast('⚠️ 5MB以下の画像を選択してください'); input.value=''; return; }
            try {
                const dataUrl = await resizeImage(file, 96, 96, 0.82);
                // base64部分だけ長さチェック（上限 65KB 程度 ≒ data URL 87KB）
                if (dataUrl.length > 90000) { toast('⚠️ 画像が大きすぎます。別の画像を試してください'); return; }
                _castEditAvatarData = dataUrl;
                setCastAvatarPreview(dataUrl);
            } catch (e) {
                toast('⚠️ 画像の読み込みに失敗しました');
            }
        });
    }
});

function closeCastEdit(){
    _castEditingId = null;
    document.getElementById('cast-edit-modal').classList.remove('active');
    document.body.style.overflow = '';
}

async function saveCastEdit(){
    if (!_castEditingId) return;
    const name = document.getElementById('cast-edit-name').value.trim();
    if (!name) { toast('⚠️ 源氏名を入力してください'); return; }
    const notifyEmail = document.getElementById('cast-edit-notify-email').value.trim();
    if (notifyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail)) { toast('⚠️ 通知先メールアドレスの形式が正しくありません'); return; }
    const payload = {
        id: _castEditingId,
        display_name: name,
        bio: document.getElementById('cast-edit-bio').value,
        sort_order: (function(){ const v = document.getElementById('cast-edit-sort').value; return v === '' ? null : (Number(v) || 0); })(),
        status: document.getElementById('cast-edit-status').value,
        chat_notify_mode: document.getElementById('cast-edit-notify-mode').value,
        chat_notify_email: notifyEmail
    };
    if (_castEditAvatarData !== null) {
        payload.profile_image_url = _castEditAvatarData; // '' = 削除, data URL = 新規
    }
    const btn = document.getElementById('cast-edit-save-btn');
    btn.disabled = true; btn.textContent = '保存中…';
    try {
        await castApi('update', payload);
        toast('✅ 更新しました');
        closeCastEdit();
        await loadCastTab();
    } catch (e) {
        toast('⚠️ ' + e.message);
    } finally {
        btn.disabled = false; btn.textContent = '保存する';
    }
}

async function approveCast(id, displayName){
    const name = displayName || 'このキャスト';
    if (!confirm(name + ' を承認します。\n承認するとチャット受付やプロフィール表示などの全機能が有効になります。\nよろしいですか？')) return;
    try {
        await castApi('approve', { id });
        toast('✅ ' + name + ' を承認しました');
        await loadCastTab();
    } catch (e) {
        toast('⚠️ ' + e.message);
    }
}

async function removeCast(id, displayName){
    if (!confirm((displayName || 'このキャスト') + ' を店舗から削除します。\nよろしいですか？\n（キャスト本人のアカウントは他店舗があれば維持されます）')) return;
    try {
        await castApi('remove', { id });
        toast('✅ 削除しました');
        await loadCastTab();
    } catch (e) {
        toast('⚠️ ' + e.message);
    }
}

async function resendCastInvite(inviteId){
    if (!confirm('招待メールを再送しますか？')) return;
    try {
        await castApi('resend-invite', { invite_id: inviteId });
        toast('✅ 招待メールを再送しました');
    } catch (e) {
        toast('⚠️ ' + e.message);
    }
}

async function toggleCastNotify(id, enabled){
    try {
        await castApi('update', { id, chat_notify_mode: enabled ? 'every' : 'off' });
        toast(enabled ? '🔔 通知ONにしました' : '🔕 通知OFFにしました');
        // 状態をDB値で同期: 再取得して再描画 (編集モーダルの select と常に一致させる)
        await loadCastTab();
    } catch (e) {
        // 失敗時は再取得でUIを巻き戻す
        toast('⚠️ ' + e.message);
        try { await loadCastTab(); } catch (_) {}
    }
}

// ===== キャストチャット閲覧 (read-only) =====
let _castChatCtx = null; // { shopCastId, displayName }

async function openCastChatViewer(shopCastId, displayName){
    _castChatCtx = { shopCastId, displayName };
    document.getElementById('cast-chat-title').textContent = '💬 ' + displayName + ' のチャット履歴';
    document.getElementById('cast-chat-back-btn').style.display = 'none';
    document.getElementById('cast-chat-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
    await loadCastChatSessions();
}

function closeCastChatViewer(){
    _castChatCtx = null;
    document.getElementById('cast-chat-modal').classList.remove('active');
    document.body.style.overflow = '';
}

async function castChatBackToSessions(){
    await loadCastChatSessions();
}

async function castApiGet(action, params){
    const qs = new URLSearchParams({ action, ...(params || {}) }).toString();
    const res = await fetch('/api/shop-cast-api.php?' + qs, { credentials: 'include' });
    let data;
    try { data = await res.json(); } catch (e) { throw new Error('サーバー応答が不正です'); }
    if (!res.ok || data.error) throw new Error(data.error || 'エラーが発生しました');
    return data;
}

async function loadCastChatSessions(){
    if (!_castChatCtx) return;
    const body = document.getElementById('cast-chat-body');
    document.getElementById('cast-chat-back-btn').style.display = 'none';
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-3);">読み込み中...</div>';
    try {
        const data = await castApiGet('chat-sessions', { shop_cast_id: _castChatCtx.shopCastId });
        const sessions = data.sessions || [];
        if (!sessions.length) {
            body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-3);font-size:13px;">このキャストへのチャットはまだありません。</div>';
            return;
        }
        body.innerHTML = sessions.map(s => {
            const nickname = s.nickname || ('訪問者 #' + s.id);
            const lastMsg = s.last_message ? (s.last_sender === 'shop' ? 'キャスト: ' : '') + s.last_message : '(メッセージなし)';
            const when = s.last_activity_at ? formatCastChatTime(s.last_activity_at) : '';
            const statusBadge = s.status === 'closed'
                ? '<span style="font-size:10px;padding:1px 6px;background:#eee;color:#666;border-radius:8px;margin-left:6px;">終了</span>'
                : '';
            return ''
                + '<div onclick="loadCastChatMessages(' + s.id + ')" style="padding:12px 14px;background:#fff;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;cursor:pointer;transition:background .15s;" onmouseover="this.style.background=\'#fff9fb\'" onmouseout="this.style.background=\'#fff\'">'
                + '<div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:14px;">' + esc(nickname) + '</strong>' + statusBadge + '<span style="flex:1;"></span><span style="font-size:11px;color:var(--text-3);">' + esc(when) + '</span></div>'
                + '<div style="font-size:12px;color:var(--text-2);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(lastMsg) + '</div>'
                + '<div style="font-size:11px;color:var(--text-3);margin-top:4px;">' + Number(s.msg_count || 0) + ' 件のメッセージ</div>'
                + '</div>';
        }).join('');
    } catch (e) {
        body.innerHTML = '<div style="padding:40px;text-align:center;color:#c33;">読み込みエラー: ' + esc(e.message) + '</div>';
    }
}

async function loadCastChatMessages(sessionId){
    const body = document.getElementById('cast-chat-body');
    document.getElementById('cast-chat-back-btn').style.display = 'inline-block';
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-3);">読み込み中...</div>';
    try {
        const data = await castApiGet('chat-messages', { session_id: sessionId });
        const msgs = data.messages || [];
        const sess = data.session || {};
        const header = '<div style="padding:10px 12px;background:#fff;border-radius:8px;margin-bottom:12px;font-size:12px;color:var(--text-3);">'
            + '訪問者: <strong style="color:var(--text-1);">' + esc(sess.nickname || ('#' + sess.id)) + '</strong>'
            + ' / 開始: ' + esc(formatCastChatTime(sess.started_at))
            + (sess.status === 'closed' ? ' / <span style="color:#999;">終了済み</span>' : '')
            + '</div>';
        if (!msgs.length) {
            body.innerHTML = header + '<div style="padding:40px;text-align:center;color:var(--text-3);">メッセージがありません。</div>';
            return;
        }
        const rendered = msgs.map(m => {
            const isShop = m.sender_type === 'shop';
            const align = isShop ? 'flex-end' : 'flex-start';
            const bg = isShop ? '#b5627a' : '#fff';
            const color = isShop ? '#fff' : 'var(--text-1)';
            const border = isShop ? 'none' : '1px solid var(--border)';
            const senderLabel = isShop ? (sess.cast_name || 'キャスト') : (sess.nickname || 'ゲスト');
            return ''
                + '<div style="display:flex;justify-content:' + align + ';margin:6px 0;">'
                + '<div style="max-width:75%;">'
                + '<div style="font-size:10px;color:var(--text-3);margin-bottom:2px;padding:0 4px;">' + esc(senderLabel) + ' · ' + esc(formatCastChatTime(m.sent_at)) + '</div>'
                + '<div style="background:' + bg + ';color:' + color + ';border:' + border + ';padding:8px 12px;border-radius:14px;font-size:13px;word-break:break-word;white-space:pre-wrap;">' + esc(m.message) + '</div>'
                + '</div></div>';
        }).join('');
        body.innerHTML = header + rendered;
        body.scrollTop = body.scrollHeight;
    } catch (e) {
        body.innerHTML = '<div style="padding:40px;text-align:center;color:#c33;">読み込みエラー: ' + esc(e.message) + '</div>';
    }
}

function formatCastChatTime(iso){
    if (!iso) return '';
    const d = new Date(iso.replace(' ', 'T'));
    if (isNaN(d)) return String(iso);
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const pad = n => String(n).padStart(2, '0');
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    return sameDay ? hm : (pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + hm);
}
