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
    { shop_name: '宮崎PRISM都城', email: 'purizumu7716@icloud.com', area: '宮崎県' },
    { shop_name: '宮崎PRISM宮崎', email: 'prism.myzk@icloud.com', area: '宮崎県' },
    { shop_name: '宮崎マドンナSANSAIN', email: 'sansainmiyazaki@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎フェアリー都城店', email: 'fairy07110801@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎FResh(素人・可愛い)都城店', email: 'fresh.health0000@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎花の都～人妻の都～延岡店', email: 'miyako@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎Alice', email: 'aris.t-r@ezweb.ne.jp', area: '宮崎県' },
    { shop_name: '宮崎摩天楼～MATENROW～宮崎', email: 'matenrow.miyazaki@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎アップル倶楽部', email: 'tm.08018181@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎ちゃんこ中央通店', email: 'miyazaki.chanko@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎ココだけの話！！宮崎店', email: 'kokodakenohanasi.miyazaki@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎ちゃんこ都城店', email: 'miyakonojo.chanko@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎Sincere ～シンシア～', email: 'sincere@ymobile.ne.jp', area: '宮崎県' },
    { shop_name: '宮崎EXECUTIVE [都城本店]', email: 'exe.miyakonojohonten@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎Mariage(姉・人妻)', email: 'mariage.health@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎Roots（ルーツ）', email: 'dh-roots.go-go@ezweb.ne.jp', area: '宮崎県' },
    { shop_name: '宮崎爆安＜元祖＞どすこい倶楽部', email: 'dosukoi.12345678@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎マドンナSANSAIN', email: 'sansainmiyazaki@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎マドンナSANSAIN', email: 'sansainmiyazaki@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎ミセス[都城店]', email: 'misesu.miyakonojo@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎EXECUTIVE [延岡店]', email: 'frontier19940812@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎Premium Belle', email: 'k772989@au.com', area: '宮崎県' },
    { shop_name: '宮崎アップルティ 都城店', email: 'ap8181@ezweb.ne.jp', area: '宮崎県' },
    { shop_name: '宮崎PRISM宮崎', email: 'prism.myzk@icloud.com', area: '宮崎県' },
    { shop_name: '宮崎PRISM都城', email: 'purizumu7716@icloud.com', area: '宮崎県' },
    { shop_name: '宮崎人妻・密会倶楽部', email: 'sssskkk1993@icloud.com', area: '宮崎県' },
    { shop_name: '宮崎フェアリー都城店', email: '0pa5575738d385f@au.com', area: '宮崎県' },
    { shop_name: '宮崎フェアリー都城店', email: '0pa5575738d385f@au.com', area: '宮崎県' },
    { shop_name: '宮崎ミセス[都城店]', email: 'misesu.miyakonojo@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎ミセス[都城店]', email: 'misesu.miyakonojo@gmail.com', area: '宮崎県' },
    { shop_name: '鹿児島ギャルサー', email: 'o.knz0720@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島フェアリー鹿児島店', email: '0pa5575738d385f@au.com', area: '鹿児島県' },
    { shop_name: '鹿児島キャンディ', email: 'oubo.kagodeli@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島こすらぶ鹿児島店', email: 'coslove1300@ezweb.ne.jp', area: '鹿児島県' },
    { shop_name: '鹿児島わっしょい☆元祖廃男コース鹿児島店', email: 'kabushikigaisyatakapi@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島Lime Spa', email: 'lime@icloud.com', area: '鹿児島県' },
    { shop_name: '鹿児島Sチャンネル', email: 'oubo.kagodeli@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島人妻宅急便', email: 'deli.chopper099@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島CLUB A', email: 'kagoshimakyujin@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島NEWビビアン＆ガールズコレクション', email: 'newvivian.recruite@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島薩摩♂風俗の神様 鹿児島店', email: 'info@of-nightwork-qjin.com', area: '鹿児島県' },
    { shop_name: '鹿児島楊貴妃', email: 'oubo.kagodeli@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島摩天楼～MATENROW～鹿児島', email: 'matenrow.kagoshima@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島EXECUTIVE[霧島店]', email: 'exe.kirishima@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島ヴェルファーレ-VELFARRE-鹿児島', email: 'velfaree@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島人妻ステーション鹿児島', email: 'station.recruit@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島ちゃんこ 霧島店', email: 'kirishima.chanko@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島momo♡霧島店', email: 'momokirishimaderi@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島ちゃんこ 薩摩川内店', email: 'sendai.chanko@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島ちゃんこ 天文館店', email: 'kagoshima.chanko@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島ギャルサー', email: 'o.knz0720@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島ラブ♡エル', email: 'oubo.kagodeli@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島Chou♡Chou', email: 'fairy.fairy.fairy2022@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島7800円', email: 'deliblog099@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島ラブ♡エル霧島店', email: 'oubo.kagodeli@gmail.com', area: '鹿児島県' },
    { shop_name: '鹿児島フェアリー鹿児島店', email: '0pa5575738d385f@au.com', area: '鹿児島県' },
    { shop_name: '鹿児島CANDY BELOVED', email: 'oubo.kagodeli@gmail.com', area: '鹿児島県' },
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
