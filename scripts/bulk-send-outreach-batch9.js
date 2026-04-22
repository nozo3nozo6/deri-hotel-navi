// ==========================================================================
// 営業メール一括送信テンプレート（再利用版）
//
// 使い方:
//   1. SSHトンネル起動: ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6051.wpx.ne.jp -N
//   2. 下記の RECIPIENTS / TEMPLATE_KEY を編集
//   3. 実行: node scripts/bulk-send-outreach-template.js
//      強制送信（全ルール無視）: node scripts/bulk-send-outreach-template.js --force
//
// 自動スキップルール:
//   1. 14日以内に同一テンプレートで送信済み
//   2. 過去にバウンス済み（永久スキップ）
//   3. shops テーブルに status='active'（掲載中）で登録済み
//   4. バッチ内で同一メールが複数行 → 最初の1行のみ採用
// ==========================================================================

const db = require('../db-local');

// ===== バッチごとに編集する箇所 =====

const TEMPLATE_KEY = 'deli'; // deli / general / jofu / same / loveho / este

const RECIPIENTS = [
    { shop_name: '宮城♂風俗の神様 仙台店', email: 'info@of-nightwork-qjin.com', area: '宮城県' },
    { shop_name: '宮城SUTEKIな奥様は好きですか', email: 'sutekisan5-mail@ezweb.ne.jp', area: '宮城県' },
    { shop_name: '宮城奥様メモリアル', email: 'info@okumemo.com', area: '宮城県' },
    { shop_name: '宮城Juicy kiss 古川', email: 'romance.device004@gmail.com', area: '宮城県' },
    { shop_name: '宮城プライベートレッスン', email: 'info@p-lesson.net', area: '宮城県' },
    { shop_name: '宮城ディーノ 石巻店', email: 'dino.job11@gmail.com', area: '宮城県' },
    { shop_name: '北海道まりも治療院（札幌ハレ系）', email: 'sp-marimo@harekei.com', area: '北海道' },
    { shop_name: '宮城バニーオンデマンド', email: '9yoshi69@gmail.com', area: '宮城県' },
    { shop_name: '宮城Club Vogue', email: 'club-vogue@i.softbank.jp', area: '宮城県' },
    { shop_name: '宮城オッジ', email: 'job-oggi@au.com', area: '宮城県' },
    { shop_name: '宮城DRAMA-ドラマ-', email: 'dmt.corporation224@gmail.com', area: '宮城県' },
    { shop_name: '宮城S-style club', email: 'info@s-styleclub.com', area: '宮城県' },
    { shop_name: '宮城セレブガーデン', email: 'info@celeb-garden.net', area: '宮城県' },
    { shop_name: '宮城TWO×TOP', email: 'dmt.corporation224@gmail.com', area: '宮城県' },
    { shop_name: '宮城SEINOKIWAMI', email: 'seinokiwami@gmail.com', area: '宮城県' },
    { shop_name: '宮城WASUreNA勿忘', email: 'recruit.sen2020@gmail.com', area: '宮城県' },
    { shop_name: '宮城熟女の風俗最終章 仙台店', email: 'chapter0.send@gmail.com', area: '宮城県' },
    { shop_name: '宮城夜間飛行 60分10000円', email: 'olivekikaku4@gmail.com', area: '宮城県' },
    { shop_name: '宮城奥鉄オクテツ仙台店', email: 'derikyu-sendai@dh2020.jp', area: '宮城県' },
    { shop_name: '宮城瀬音ゆかしき仙台妻', email: 'mouri-m@i.softbank.jp', area: '宮城県' },
    { shop_name: '宮城Club JAM', email: 'j.sendai@gmail.com', area: '宮城県' },
    { shop_name: '宮城ウープスグループ', email: 'sakura.sdj@gmail.com', area: '宮城県' },
    { shop_name: '宮城隣の人妻お口で愛して', email: 'la.cure7@gmail.com', area: '宮城県' },
    { shop_name: '宮城デリっ娘。石巻', email: 'spgspg0703@gmail.com', area: '宮城県' },
    { shop_name: '宮城デリっ娘。 仙台店', email: 'dc.sendai@gmail.com', area: '宮城県' },
    { shop_name: '宮城ロイヤル アテンダー', email: 'attender102030@gmail.com', area: '宮城県' },
    { shop_name: '宮城Club Vogue', email: 'club-vogue@i.softbank.jp', area: '宮城県' },
    { shop_name: '宮城ろいやるくらぶ', email: 'royalclub.secret@gmail.com', area: '宮城県' },
    { shop_name: '宮城素敵な女の子は好きですか', email: 'sutekisan5-mail@ezweb.ne.jp', area: '宮城県' },
    { shop_name: '宮城SAKURA石巻店', email: 'sakura.isi0403@gmail.com', area: '宮城県' },
    { shop_name: '宮城秋葉原コスプレ学園in仙台', email: 'akira.73266221@gmail.com', area: '宮城県' },
    { shop_name: '宮城素敵な女の子は好きですか', email: 'sutekisan5-mail@ezweb.ne.jp', area: '宮城県' },
    { shop_name: '宮城夢-chu', email: 'muchu_work@yahoo.co.jp', area: '宮城県' },
    { shop_name: '宮城仙台大人の秘密倶楽部', email: 'sendaihimitu2015@yahoo.co.jp', area: '宮城県' },
    { shop_name: '宮城ゆらら', email: 'yurara.1201y@gmail.com', area: '宮城県' },
    { shop_name: '宮城虹色メロンパイ', email: 'melon-can@pie-gr.com', area: '宮城県' },
    { shop_name: '宮城石巻PLAYGIRL+', email: 'pg.ishinomaki0715@icloud.com', area: '宮城県' },
    { shop_name: '宮城ディーノ 石巻店', email: 'dino.job11@gmail.com', area: '宮城県' },
    { shop_name: '宮城Keep', email: 'keep.sendai@gmail.com', area: '宮城県' },
    { shop_name: '宮城デリーズキュア', email: 'info@deli-aso.com', area: '宮城県' },
    { shop_name: '宮城至極 no AROMA', email: '459qzin@gmail.com', area: '宮城県' },
    { shop_name: '宮城トップモデル', email: 'topmodel1205@yahoo.co.jp', area: '宮城県' },
    { shop_name: '宮城ディーノ 会えるアイドル', email: 'excellent.shift@gmail.com', area: '宮城県' },
    { shop_name: '宮城ダンシングおっぱいTEAM爆', email: 'kigarunimaildouzo@gmail.com', area: '宮城県' },
    { shop_name: '宮城人妻生レンタルNTR', email: 'okuren-s@softbank.ne.jp', area: '宮城県' },
    { shop_name: '宮城人妻倶楽部 花椿石巻店', email: 'tsumasuki@docomo.ne.jp', area: '宮城県' },
    { shop_name: '宮城SAKURA石巻店', email: 'sakura.isi0403@gmail.com', area: '宮城県' },
    { shop_name: '宮城グランドオペラ 名古屋', email: 'recruit@g-opera.com', area: '宮城県' },
    { shop_name: '宮城ノア(NOA)', email: 'job@noajob.com', area: '宮城県' },
    { shop_name: '福島乳首責め倶楽部郡山店', email: 'w_group@icloud.com', area: '福島県' },
    { shop_name: '福島駅前ちゃんこ', email: 'hukushima.chanko@gmail.com', area: '福島県' },
    { shop_name: '福島郡山デリヘル向上委員会', email: '69ssg.job@gmail.com', area: '福島県' },
    { shop_name: '宮城人妻倶楽部 花椿大崎店', email: 'tsumasuki@docomo.ne.jp', area: '宮城県' },
    { shop_name: '宮城セレブガーデン', email: 'info@celeb-garden.net', area: '宮城県' },
    { shop_name: '宮城熟女の風俗最終章 仙台店', email: 'chapter0.send@gmail.com', area: '宮城県' },
    { shop_name: '宮城サンキュー仙台店', email: 'thankyou.sendai@gmail.com', area: '宮城県' },
    { shop_name: '宮城人妻倶楽部 花椿大崎店', email: 'tsumasuki@docomo.ne.jp', area: '宮城県' },
    { shop_name: '福島熟女バンク', email: 'goodday.recruit@gmail.com', area: '福島県' },
    { shop_name: '福島郡山デリヘル向上委員会', email: '69ssg.job@gmail.com', area: '福島県' },
    { shop_name: '福島郡山ちゃんこ', email: 'get_get_ski@yahoo.co.jp', area: '福島県' },
    { shop_name: '福島風俗イキタイいわき店', email: 'iwaki@y-dgroup.com', area: '福島県' },
    { shop_name: '福島私立 郡山学園', email: 'goodday.recruit@gmail.com', area: '福島県' },
    { shop_name: '福島熟女の園', email: 'w_group@icloud.com', area: '福島県' },
    { shop_name: '福島郡山ちゃんこ', email: 'get_get_ski@yahoo.co.jp', area: '福島県' },
    { shop_name: '福島♂風俗の神様 郡山店', email: 'info@of-nightwork-qjin.com', area: '福島県' },
    { shop_name: '福島OL精薬', email: 'ol.seiyaku@ezweb.ne.jp', area: '福島県' },
    { shop_name: '福島ドルフィン郡山', email: 'dolphin.koriyama@gmail.com', area: '福島県' },
    { shop_name: '福島出張アロマ アロマオレンジ', email: 'w_group@icloud.com', area: '福島県' },
    { shop_name: '福島郡山デリへル プレイガール+', email: 'w_group@icloud.com', area: '福島県' },
    { shop_name: '福島五十路マダム郡山店', email: 'madam50-k@docomo.ne.jp', area: '福島県' },
    { shop_name: '福島ぴーちゅプリンセス', email: 'satoshi5814@gmail.com', area: '福島県' },
    { shop_name: '福島姫マーケット', email: '69ssg.job@gmail.com', area: '福島県' },
    { shop_name: '福島恋する人妻倶楽部 郡山店', email: 'goodday.recruit@gmail.com', area: '福島県' },
    { shop_name: '福島愛の人妻 いわき', email: 'rjsnasu@icloud.com', area: '福島県' },
    { shop_name: '青森A-girls', email: 'a-girls0329@docomo.ne.jp', area: '青森県' },
    { shop_name: '青森ANON-アノン', email: 's52@au.com', area: '青森県' },
    { shop_name: '青森REAL盛岡店', email: 'real-iwate@ezweb.ne.jp', area: '青森県' },
    { shop_name: '青森G-1', email: 'g1.deri0178@gmail.com', area: '青森県' },
    { shop_name: '青森Lime', email: 'lgjob@docomo.ne.jp', area: '青森県' },
    { shop_name: '青森アイドル', email: 'idol-8@docomo.ne.jp', area: '青森県' },
    { shop_name: '岩手REAL盛岡店', email: 'real-iwate@ezweb.ne.jp', area: '岩手県' },
    { shop_name: '岩手REAL盛岡店', email: 'real-iwate@ezweb.ne.jp', area: '岩手県' },
    { shop_name: '岩手人妻倶楽部 花椿盛岡店', email: 'juicy-job@softbank.ne.jp', area: '岩手県' },
    { shop_name: '岩手人妻の極み マドンナ盛岡店', email: 'madonna-iwate@docomo.ne.jp', area: '岩手県' },
    { shop_name: '岩手しゅうくりぃむ', email: 'ahaufuehe@ezweb.ne.jp', area: '岩手県' },
    { shop_name: '岩手REAL北上店', email: 'real-iwate@ezweb.ne.jp', area: '岩手県' },
    { shop_name: '岩手Breaking Spa', email: 'breaking0001@icloud.com', area: '岩手県' },
    { shop_name: '岩手人妻・熟女デリヘルプレイシス', email: 'playses@ezweb.ne.jp', area: '岩手県' },
    { shop_name: '岩手Juicy kiss北上', email: 'kita.azarasi@i.softbank.jp', area: '岩手県' },
    { shop_name: '岩手人妻倶楽部 花椿北上店', email: 'kita.azarasi@i.softbank.jp', area: '岩手県' },
    { shop_name: '岩手Love Rose', email: 's.y.m.r1230@icloud.com', area: '岩手県' },
    { shop_name: '岩手LAVIAN', email: 'lavian.morioka1000@gmail.com', area: '岩手県' },
    { shop_name: '岩手Aroma the Essential', email: 'team.noa.xxx@gol.com', area: '岩手県' },
    { shop_name: '秋田バニーコレクション秋田', email: 'bunnycolleakita@gmail.com', area: '秋田県' },
    { shop_name: '山形テコキッシュ', email: 'tekokish@gmail.com', area: '山形県' },
    { shop_name: '山形ディアイズム', email: 'd08018445659@docomo.ne.jp', area: '山形県' },
    { shop_name: '山形GRAND DIAMOND', email: 'granddiamond5111@docomo.ne.jp', area: '山形県' },
    { shop_name: '山形デリっ娘。山形店', email: 'yamagata.allone@docomo.ne.jp', area: '山形県' },
    { shop_name: '山形44 heart', email: 's44heart@au.com', area: '山形県' },
    { shop_name: '山形至極 no AROMA', email: '459qzin@gmail.com', area: '山形県' },
    { shop_name: '山形ライズアップ 山形店', email: 'info@riseup.cc', area: '山形県' },
    { shop_name: '山形ライズアップ', email: 'info@riseup.cc', area: '山形県' },
    { shop_name: '山形Salus', email: 'salussalus0622@gmail.com', area: '山形県' },
    { shop_name: '山形さくらんぼ娘', email: 'sakuranbomusume.t@gmail.com', area: '山形県' },
    { shop_name: '山形Creation', email: 'c09060751509@docomo.ne.jp', area: '山形県' },
    { shop_name: '山形デイトナ', email: 'info@daytonagals.com', area: '山形県' },
    { shop_name: '山形恋するラブセレブ', email: 'koisurulovecelebymg@gmail.com', area: '山形県' },
    { shop_name: '山形エレクション', email: 'derikyujin@gmail.com', area: '山形県' },
    { shop_name: '山形不倫くらぶ', email: 'yamagata.furin.club1@gmail.com', area: '山形県' },
    { shop_name: '山形ミセスクリエーション', email: 'c09060751509@docomo.ne.jp', area: '山形県' },
    { shop_name: '山形LOVE DIVA', email: 'lovediva911410@gmail.com', area: '山形県' },
    { shop_name: '山形QT', email: 'info@qute-dane.com', area: '山形県' },
    { shop_name: '福島S級鑑定団', email: '69ssg.job@gmail.com', area: '福島県' },
    { shop_name: '福島風俗イキタイいわき店', email: 'iwaki@y-dgroup.com', area: '福島県' },
    { shop_name: '福島PREMIUM 萌', email: 'iwaki@y-dgroup.com', area: '福島県' },
    { shop_name: '福島放課後ぴゅあらぶ', email: 'purelove11250113@gmail.com', area: '福島県' },
    { shop_name: '福島Mドグマ郡山店', email: 'md.kooriyama@icloud.com', area: '福島県' },
    { shop_name: '福島プレイガール+福島店', email: 'w_group@icloud.com', area: '福島県' },
    { shop_name: '福島KiRaRi', email: 'kyujin.senyou@icloud.com', area: '福島県' },
    { shop_name: '福島ウープスグループ', email: 'w_group@icloud.com', area: '福島県' },
    { shop_name: '福島S級鑑定団', email: '69ssg.job@gmail.com', area: '福島県' },
    { shop_name: '福島Crest', email: 'tsuyotsuyo244105@gmail.com', area: '福島県' },
    { shop_name: '福島GOOD DAYグループ', email: 'goodday.recruit@gmail.com', area: '福島県' },
];

// ===== 以下はテンプレート定義 =====

const TEMPLATES = {
    deli: {
        subject: '【Deli YobuHo】貴店専用ページを無料で作りませんか？ - デリヘル対応ホテル検索',
        body: `ご担当者様

突然のご連絡失礼いたします。
デリヘル対応ホテル検索サイト「Deli YobuHo」を運営しております、YobuHo Check-In Partnersと申します。

当サイトでは、全国43,000件以上のホテルについて「デリヘルを呼べるかどうか」の情報を提供しており、多くのユーザー様にご利用いただいております。

現在、掲載店舗様からのホテル対応情報を募集しており、貴店にも無料でご掲載いただけないかと思いご連絡差し上げました。

━━━━━━━━━━━━━━━━━━━
■ 貴店だけの専用ページが作れます
【投稿リンクプラン 1ヶ月無料キャンペーン】
🗓 2026年4月末までのご登録限定
━━━━━━━━━━━━━━━━━━━

今なら「投稿リンクプラン（月額5,500円・税込）」を1ヶ月間無料でお試しいただけます！
キャンペーン期間終了後も、無料プランとしてそのまま掲載を継続いただけます。

・貴店の情報だけが表示される専用ページ（URL）をご用意
・他店舗の情報は一切表示されず、オフィシャルサイトやSNSにそのまま設置可能
・ホテル情報ページに貴店名からオフィシャルサイトへ直接リンク
・掲載ホテルまでの交通費も掲載可（非掲載も可）
・貴店の公式情報とユーザー口コミの両方が確認できるため、お客様へのご案内がスムーズに。スタッフ間の情報共有にも活用でき、業務効率もアップ

※お試し期間が終わっても、そのまま無料プランでお使いいただけます。

▼▼ 店舗登録はこちら（無料・最短3分）▼▼
https://yobuho.com/shop-register/

━━━━━━━━━━━━━━━━━━━
■ お客様の信頼感アップ → ご依頼に直結
━━━━━━━━━━━━━━━━━━━

・店舗様からの投稿は「公式情報」として、ユーザー口コミと区別して表示
・「このホテルなら呼べる」という安心感が、貴店への依頼につながります
・交通費やサービス内容も掲載でき、お客様の不安を事前に解消

━━━━━━━━━━━━━━━━━━━
■ 認知度アップ・新規顧客の獲得
━━━━━━━━━━━━━━━━━━━

・ホテル情報を登録するほど、検索結果の上位に表示
・ユーザーがホテルを検索するたびに、貴店の名前が目に入ります
・新規のお客様の目に触れる機会が増え、ご依頼増加が期待できます

━━━━━━━━━━━━━━━━━━━
■ 無料プランですぐに始められます
━━━━━━━━━━━━━━━━━━━

費用は一切かかりません。届出確認書をお持ちの店舗様であれば、どなたでもご登録いただけます。
※当サイトは届出確認書の審査を行い、風営法に基づく届出済みの店舗様のみ掲載しております。

1. 下記URLからメールアドレスを登録
2. 届出確認書の画像をアップロード
3. 審査完了後、すぐにご利用開始

▼ 店舗登録はこちら（無料）
https://yobuho.com/shop-register/?genre=men

▼ サイトはこちら
https://deli.yobuho.com/

▼ 料金プラン詳細
https://yobuho.com/plan/

まずは無料プランからお試しいただき、効果を実感してください。

ご不明点がございましたら、お気軽にお問い合わせください。
何卒よろしくお願いいたします。

─────────────────
YobuHo Check-In Partners
デリヘル対応ホテル検索「Deli YobuHo」
https://deli.yobuho.com/
お問い合わせ: https://yobuho.com/contact/
担当窓口: hotel@yobuho.com
─────────────────`,
    },
    // 必要に応じて jofu / same / loveho / este / general を追加
};

const SEND_URL = 'https://yobuho.com/api/send-mail.php';
const INTERVAL_MS = 2000;
const COOLDOWN_DAYS = 14;
const FORCE = process.argv.includes('--force');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendOne(to, subject, body) {
    const res = await fetch(SEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': 'https://yobuho.com' },
        body: JSON.stringify({ to, subject, body }),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { ok: res.ok && json && json.success, status: res.status, body: text };
}

async function recordHistory({ shop_name, email, genre, area, status, notes }) {
    await db.query(
        `INSERT INTO outreach_emails (shop_name, email, genre, area, status, notes) VALUES (?, ?, ?, ?, ?, ?)`,
        [shop_name, email, genre, area, status, notes]
    );
}

// 送信前チェック: 4条件をDB照合してスキップ判定
async function classifyRecipients(recipients, templateKey) {
    const lowerEmails = [...new Set(recipients.map(r => r.email.toLowerCase()))];
    if (lowerEmails.length === 0) return { send: [], skip: [] };

    const placeholders = lowerEmails.map(() => '?').join(',');

    // 1. 14日以内に同一テンプレートで送信済み
    const recent = await db.query(
        `SELECT LOWER(email) AS email FROM outreach_emails
         WHERE genre = ? AND LOWER(email) IN (${placeholders})
           AND sent_at >= NOW() - INTERVAL ${COOLDOWN_DAYS} DAY
           AND status = 'sent'`,
        [templateKey, ...lowerEmails]
    );
    const recentSet = new Set(recent.map(r => r.email));

    // 2. 過去にバウンス済み
    const bounced = await db.query(
        `SELECT DISTINCT LOWER(email) AS email FROM outreach_emails
         WHERE LOWER(email) IN (${placeholders}) AND status = 'bounced'`,
        lowerEmails
    );
    const bouncedSet = new Set(bounced.map(r => r.email));

    // 3. shops テーブルに status='active' で登録済み
    const activeShops = await db.query(
        `SELECT DISTINCT LOWER(email) AS email FROM shops
         WHERE LOWER(email) IN (${placeholders}) AND status = 'active'`,
        lowerEmails
    );
    const activeSet = new Set(activeShops.map(r => r.email));

    // 4. バッチ内重複（最初の1行のみ採用）
    const seenInBatch = new Set();

    const send = [];
    const skip = [];
    for (const r of recipients) {
        const key = r.email.toLowerCase();
        if (seenInBatch.has(key)) {
            skip.push({ ...r, reason: 'バッチ内重複' });
            continue;
        }
        seenInBatch.add(key);

        if (FORCE) { send.push(r); continue; }

        if (bouncedSet.has(key)) {
            skip.push({ ...r, reason: 'バウンス済み（永久スキップ）' });
        } else if (activeSet.has(key)) {
            skip.push({ ...r, reason: '掲載中店舗（active）' });
        } else if (recentSet.has(key)) {
            skip.push({ ...r, reason: `${COOLDOWN_DAYS}日以内に同テンプレート既送信` });
        } else {
            send.push(r);
        }
    }
    return { send, skip };
}

async function main() {
    const tpl = TEMPLATES[TEMPLATE_KEY];
    if (!tpl) { console.error(`✗ 未定義テンプレート: ${TEMPLATE_KEY}`); process.exit(1); }
    if (RECIPIENTS.length === 0) { console.error('✗ RECIPIENTS が空です'); process.exit(1); }

    console.log(`▶ 営業メール送信準備: ${RECIPIENTS.length} 件`);
    console.log(`  テンプレート: ${TEMPLATE_KEY}`);
    console.log(`  件名: ${tpl.subject}`);
    console.log(`  強制送信: ${FORCE ? 'はい (--force)' : 'いいえ'}\n`);

    const { send, skip } = await classifyRecipients(RECIPIENTS, TEMPLATE_KEY);

    if (skip.length > 0) {
        const byReason = {};
        skip.forEach(s => { (byReason[s.reason] = byReason[s.reason] || []).push(s); });
        console.log(`▶ スキップ ${skip.length} 件:`);
        for (const [reason, list] of Object.entries(byReason)) {
            console.log(`  [${reason}] ${list.length}件`);
            list.forEach(s => console.log(`    - ${s.email}  (${s.shop_name})`));
        }
        console.log('');
    }

    if (send.length === 0) {
        console.log('▶ 送信対象なし。終了します。');
        await db.close();
        return;
    }

    console.log(`▶ ${send.length} 件を ${INTERVAL_MS}ms 間隔で送信開始\n`);

    const results = [];
    for (let i = 0; i < send.length; i++) {
        const r = send[i];
        const tag = `[${i + 1}/${send.length}]`;
        process.stdout.write(`${tag} ${r.email}  (${r.shop_name}) ... `);
        let outcome;
        try {
            const result = await sendOne(r.email, tpl.subject, tpl.body);
            outcome = result.ok ? 'sent' : 'error';
            console.log(result.ok ? '✓ sent' : `✗ error (HTTP ${result.status}): ${result.body}`);
        } catch (err) {
            outcome = 'error';
            console.log(`✗ exception: ${err.message}`);
        }

        try {
            await recordHistory({
                shop_name: r.shop_name,
                email: r.email,
                genre: TEMPLATE_KEY,
                area: r.area || null,
                status: outcome,
                notes: tpl.subject,
            });
        } catch (err) {
            console.log(`   ⚠ DB記録失敗: ${err.message}`);
        }

        results.push({ ...r, status: outcome });
        if (i < send.length - 1) await sleep(INTERVAL_MS);
    }

    const sentCount = results.filter(r => r.status === 'sent').length;
    const errorCount = results.filter(r => r.status !== 'sent').length;
    console.log(`\n▶ 完了: 送信 ${sentCount} 件 / 即時エラー ${errorCount} 件 / スキップ ${skip.length} 件`);
    if (errorCount > 0) {
        console.log('即時エラー一覧:');
        results.filter(r => r.status !== 'sent').forEach(r => console.log(`  - ${r.email} (${r.shop_name})`));
    }
    console.log('※ 送信後数時間でバウンスメールが返ることがあり、process-bounces.php が status を bounced に更新します。');

    await db.close();
}

main().catch(err => { console.error(err); process.exit(1); });
