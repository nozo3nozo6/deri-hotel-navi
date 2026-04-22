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
    { shop_name: '鳥取LUXURY ラグジュアリー', email: 'y_g_r_0612@ezweb.ne.jp', area: '鳥取県' },
    { shop_name: '鳥取FILLIA', email: 'isaonagata1213@gmail.com', area: '鳥取県' },
    { shop_name: '鳥取ねいろ', email: 'sanin.neiro@gmail.com', area: '鳥取県' },
    { shop_name: '鳥取ZEBRA ゼブラ', email: 'sanin.zebra@gmail.com', area: '鳥取県' },
    { shop_name: '島根ORCHIS 松江', email: 'orchis0852@gmail.com', area: '島根県' },
    { shop_name: '島根優月-yuzuki-', email: 'yuzuki28668357@gmail.com', area: '島根県' },
    { shop_name: '島根五十路マダム松江米子店', email: 'shimatori.isoji@gmail.com', area: '島根県' },
    { shop_name: '島根PRODUCE 松江店', email: 'produce.matue@gmail.com', area: '島根県' },
    { shop_name: '松江 人妻 デリヘル 桃屋', email: 'info-matsue@h-momoya.com', area: '島根県' },
    { shop_name: '松江デリヘル 乱妻', email: 'matsue37837019@gmail.com', area: '島根県' },
    { shop_name: '島根カサブランカ松江米子店', email: 'shimatori.isoji@gmail.com', area: '島根県' },
    { shop_name: '島根ごちそうさまでした。', email: 'gochi64395010@gmail.com', area: '島根県' },
    { shop_name: '島根縁結び学園', email: 'sin1128k@gmail.com', area: '島根県' },
    { shop_name: '島根人妻熱く恋', email: 'atsukukoi@gmail.com', area: '島根県' },
    { shop_name: '香川ミラクル愛', email: 'miracle.5577@icloud.com', area: '香川県' },
    { shop_name: '香川エプロンレディー', email: 'apronlady7700@docomo.ne.jp', area: '香川県' },
    { shop_name: '香川秘書と黒パンスト高松店', email: 'kyuuzin.kansai@au.com', area: '香川県' },
    { shop_name: '香川善通寺若妻人妻熟女 Tiamo', email: 'tiamo0930@softbank.ne.jp', area: '香川県' },
    { shop_name: '香川しろうとcollection 高松店', email: 'collection4610@yahoo.com', area: '香川県' },
    { shop_name: '香川高松ちゃんこ', email: 'takamatsu.chanko@gmail.com', area: '香川県' },
    { shop_name: '香川こあくまな熟女たち高松店', email: 'recruit_girls_west@koakumagroup.com', area: '香川県' },
    { shop_name: '香川サンキュー香川店', email: 'thankyou.kagawa@gmail.com', area: '香川県' },
    { shop_name: '香川こあくまな熟女たち善通寺・丸亀店', email: 'recruit_girls_west@koakumagroup.com', area: '香川県' },
    { shop_name: '香川ラブチャンス', email: 'chance00.takamatsu@gmail.com', area: '香川県' },
    { shop_name: '香川中・西讃 ヴィーナス', email: 'club.venus.group@gmail.com', area: '香川県' },
    { shop_name: '香川パジャマdeおじゃま', email: 'pjm6635@ymail.ne.jp', area: '香川県' },
    { shop_name: '香川Cherie', email: 'cherie08029731232@gmail.com', area: '香川県' },
    { shop_name: '香川CLUB ティアラ', email: 'corazon0426@icloud.com', area: '香川県' },
    { shop_name: '香川TOP PLACE', email: 'takamatsu.t.family@gmail.com', area: '香川県' },
    { shop_name: '徳島SCREEN スクリィーン', email: 'atc2000.221@gmail.com', area: '徳島県' },
    { shop_name: '徳島STAR学園', email: 'carisuma0401@docomo.ne.jp', area: '徳島県' },
    { shop_name: '徳島JOKER', email: 'joker13work@gmail.com', area: '徳島県' },
    { shop_name: '徳島激安の虎', email: 'joker13work@gmail.com', area: '徳島県' },
    { shop_name: '徳島DEEP LOVE', email: 'nishi0827@ezweb.ne.jp', area: '徳島県' },
    { shop_name: '徳島Healing Garden', email: 'carisuma0401@docomo.ne.jp', area: '徳島県' },
    { shop_name: '徳島マダムの虎', email: 'joker13work@gmail.com', area: '徳島県' },
    { shop_name: '徳島F Club エフクラブ', email: 'info@club-f.co.jp', area: '徳島県' },
    { shop_name: '徳島妻の友人', email: 'carisuma0401@docomo.ne.jp', area: '徳島県' },
    { shop_name: '徳島Replay', email: 'replay.tokusima@gmail.com', area: '徳島県' },
    { shop_name: '徳島mySTAR', email: 'carisuma0401@docomo.ne.jp', area: '徳島県' },
    { shop_name: '徳島こあくまな熟女たち徳島店', email: 'recruit_girls_west@koakumagroup.com', area: '徳島県' },
    { shop_name: '徳島ecstasy', email: 'ecstasy2041@gmail.com', area: '徳島県' },
    { shop_name: '徳島秘密の人妻倶楽部', email: 'tokusima.himitu@gmail.com', area: '徳島県' },
    { shop_name: '徳島高知ﾃﾞﾘﾍﾙ DIVA', email: 'diva.kochi@gmail.com', area: '徳島県' },
    { shop_name: '徳島・秋田鷹匠ちゃんこ', email: 'akitatakajyochanko@gmail.com', area: '徳島県' },
    { shop_name: '高知ﾃﾞﾘﾍﾙ DIVA', email: 'diva.kochi@gmail.com', area: '高知県' },
    { shop_name: '高知フォルトゥナ', email: 'fortuna.kochi@gmail.com', area: '高知県' },
    { shop_name: '高知シンデレラ', email: 'renraku1182@docomo.ne.jp', area: '高知県' },
    { shop_name: '高知デリヘル倶楽部 人妻熟女専門店', email: 'e-baito@docomo.ne.jp', area: '高知県' },
    { shop_name: '高知おもてなしヒルズ', email: 'diva.kochi@gmail.com', area: '高知県' },
    { shop_name: '高知New Heavens Bless', email: 'diva.kochi@gmail.com', area: '高知県' },
    { shop_name: '高知ちゃんこ', email: 'kochi.chanko@gmail.com', area: '高知県' },
    { shop_name: '高知スタービーチ', email: 'renraku1182@docomo.ne.jp', area: '高知県' },
    { shop_name: '高知パンタシア', email: 'misakikun801@gmail.com', area: '高知県' },
    { shop_name: '高知いちゃラブ', email: 'kochi-ichalove@ymobile.ne.jp', area: '高知県' },
    { shop_name: '愛媛GLOSS MATSUYAMA', email: 'mizukigloss0424@gmail.com', area: '愛媛県' },
    { shop_name: '愛媛Club Dear 松山', email: 'ehime@c-dear.com', area: '愛媛県' },
    { shop_name: '愛媛熟女日和', email: 'recruit@jukujobiyori.jp', area: '愛媛県' },
    { shop_name: '愛媛松山 人妻 Madonna', email: 'mizukigloss0424@gmail.com', area: '愛媛県' },
    { shop_name: '愛媛松山ちゃんこ', email: 'matsuyamachanko@gmail.com', area: '愛媛県' },
    { shop_name: '愛媛素人専門店ラブリーキス', email: 'recruit@lovelykiss.net', area: '愛媛県' },
    { shop_name: '愛媛クラブエンジェルハート松山今治西条店', email: 'club-a.h@ezweb.ne.jp', area: '愛媛県' },
    { shop_name: '愛媛GLOSS 新居浜・西条・今治', email: 'mizukigloss0424@gmail.com', area: '愛媛県' },
    { shop_name: '愛媛マリンスノウ・松山・東予店', email: 'marine-snow_8817@ezweb.ne.jp', area: '愛媛県' },
    { shop_name: '愛媛セレブ パラダイス', email: 'celeb.2234@ezweb.ne.jp', area: '愛媛県' },
    { shop_name: '愛媛西条・新居浜 人妻 Madonna', email: 'mizukigloss0424@gmail.com', area: '愛媛県' },
    { shop_name: '愛媛EXECUTIVE ROSE', email: 'exuctive.rose@gmail.com', area: '愛媛県' },
    { shop_name: '愛媛clubさくら', email: 'clubsakura1111@icloud.com', area: '愛媛県' },
    { shop_name: '愛媛五十路マダム 松山店', email: 'madam-m@docomo.ne.jp', area: '愛媛県' },
    { shop_name: '愛媛MUZERVA WAVE', email: 'allstarsgroup.m@gmail.com', area: '愛媛県' },
    { shop_name: '愛媛GLOSS 今治', email: 'mizukigloss0424@gmail.com', area: '愛媛県' },
    { shop_name: '愛媛人妻愛姫 Kiaro24時', email: 'kiaro7@au.com', area: '愛媛県' },
    { shop_name: '愛媛色恋（宇和島）', email: 'irokoi1151@gmail.com', area: '愛媛県' },
    { shop_name: '愛媛ミニスカぷりぷり倶楽部', email: 'minipuri-club@ezweb.ne.jp', area: '愛媛県' },
    { shop_name: '愛媛今治 人妻 Madonna', email: 'mizukigloss0424@gmail.com', area: '愛媛県' },
    { shop_name: '愛媛La mode ラ・モード', email: 'lamode@docomo.ne.jp', area: '愛媛県' },
    { shop_name: '愛媛秘密の逢瀬〇〇妻', email: 'newyork.20091122@gmail.com', area: '愛媛県' },
    { shop_name: '愛媛奥さま日記（大洲店）', email: 'primoimabari@yahoo.co.jp', area: '愛媛県' },
    { shop_name: '愛媛奥さま日記（今治店）', email: 'ozu8990@docomo.ne.jp', area: '愛媛県' },
    { shop_name: '愛媛ラブステ', email: 'o90.4501.o567.1o23@docomo.ne.jp', area: '愛媛県' },
    { shop_name: '愛媛欲情のよろめき・ポルノⅡ', email: 'yoromeki2@gmail.com', area: '愛媛県' },
    { shop_name: '愛媛新居浜 奥様物語', email: 'okumonogatari@ezweb.ne.jp', area: '愛媛県' },
    { shop_name: '愛媛Hard Style ハードスタイル(新居浜)', email: 'hard-s.2013@docomo.ne.jp', area: '愛媛県' },
    { shop_name: '愛媛華恋 カレン', email: 'karen.niihama@docomo.ne.jp', area: '愛媛県' },
    { shop_name: '愛媛うれっこ娘フレル', email: 'arowana18@icloud.com', area: '愛媛県' },
    { shop_name: '愛媛F CLUB', email: 'fclub.saijo.2004@docomo.ne.jp', area: '愛媛県' },
    { shop_name: '愛媛大人の隠れ家 大洲店', email: 'joy-g@docomo.ne.jp', area: '愛媛県' },
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
