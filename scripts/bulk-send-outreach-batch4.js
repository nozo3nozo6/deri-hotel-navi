// 熊本・宮崎デリヘル店舗 34件へ営業メール一括送信（一回限りスクリプト）
// 使用前: SSHトンネルを起動 (`ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6051.wpx.ne.jp -N`)
// 実行:   node scripts/bulk-send-outreach-batch4.js

const db = require('../db-local');

const SUBJECT = '【Deli YobuHo】貴店専用ページを無料で作りませんか？ - デリヘル対応ホテル検索';

const BODY = `ご担当者様

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
─────────────────`;

const RECIPIENTS = [
    { shop_name: '熊本ESTE ALLURE', email: 'weareallure1310@gmail.com', area: '熊本県' },
    { shop_name: '熊本ぴゅあグループ', email: 'purepaikm@gmail.com', area: '熊本県' },
    { shop_name: '熊本天空のマット熊本店', email: 't_kumamoto_job@star-group.co.jp', area: '熊本県' },
    { shop_name: '熊本Ribbon 1st', email: 'the.die.is.cast.sho@gmail.com', area: '熊本県' },
    { shop_name: '熊本セラヴィ', email: 'se-junko@ezweb.ne.jp', area: '熊本県' },
    { shop_name: '熊本Club Moet熊本', email: 'clubmoet.gr@gmail.com', area: '熊本県' },
    { shop_name: '熊本わんないとらぶ', email: 'l0ve.ace1121@docomo.ne.jp', area: '熊本県' },
    { shop_name: '熊本ココだけの話！！熊本店', email: 'kokodakenohanashi.kumamoto@gmail.com', area: '熊本県' },
    { shop_name: '熊本MANDALA', email: 'info@mandala-kumamoto.com', area: '熊本県' },
    { shop_name: '熊本九州熟女 熊本店', email: 'k9juku@docomo.ne.jp', area: '熊本県' },
    { shop_name: '熊本AVANT GARDE', email: 'info@canon-production.net', area: '熊本県' },
    { shop_name: '熊本Jewelry Club（ジュエリークラブ）', email: 'jewelryclub1977@gmail.com', area: '熊本県' },
    { shop_name: '熊本サンキュー熊本店', email: '3900kumamoto@gmail.com', area: '熊本県' },
    { shop_name: '熊本ぴゅあぱい＆ぷりてぃ♡八代宇土', email: 'purepaiyt@gmail.com', area: '熊本県' },
    { shop_name: '熊本BON BON', email: 'presentygs@gmail.com', area: '熊本県' },
    { shop_name: '熊本熟年カップル熊本～生電話からの営み～', email: 'keisei.eng2019@gmail.com', area: '熊本県' },
    { shop_name: '熊本縁-EN- 熊本人妻(20代、30代、40代)', email: 'ayumiooishi1@gmail.com', area: '熊本県' },
    { shop_name: '熊本AVANCE 熊本', email: 'avance.kuma@gmail.com', area: '熊本県' },
    { shop_name: '熊本ちょっとそこの奥さん', email: '09013665321club@gmail.com', area: '熊本県' },
    { shop_name: '熊本イットク 1109', email: '1109gogo@gmail.com', area: '熊本県' },
    { shop_name: '熊本デリバリーヘルス熊本インターちゃんこ', email: 'chanko.kmmt@gmail.com', area: '熊本県' },
    { shop_name: '熊本ポッチャリ専門店オーロラ', email: 'aurora6999@icloud.com', area: '熊本県' },
    { shop_name: '熊本ちゃんこ 八代店', email: 'newyatsushirochanko@gmail.com', area: '熊本県' },
    { shop_name: '熊本1,980円！PARTY～Hand Healing～', email: 'kumaparty29@gmail.com', area: '熊本県' },
    { shop_name: '熊本LEGEND熊本', email: 'legend.moet00@gmail.com', area: '熊本県' },
    { shop_name: '熊本五十路マダム 熊本店(ｶｻﾌﾞﾗﾝｶｸﾞﾙｰﾌﾟ)', email: 'kumacasa@icloud.com', area: '熊本県' },
    { shop_name: '熊本ぽちゃカワ＆熟女専門店Theobroma', email: 'theobroma.k.01@ezweb.ne.jp', area: '熊本県' },
    { shop_name: '熊本FF～我慢出来ない不倫in熊本', email: 'souhei0304@gmail.com', area: '熊本県' },
    { shop_name: '熊本club Refresh(クラブ・リフレッシュ)', email: 'refresh.km6644@gmail.com', area: '熊本県' },
    { shop_name: '熊本熟女性店', email: 'jukuten@icloud.com', area: '熊本県' },
    { shop_name: '熊本club GALAXY in 八代', email: '07091230684y@gmail.com', area: '熊本県' },
    { shop_name: '熊本人妻インフォメーション熊本Grace', email: 'kyujin@docomo.ne.jp', area: '熊本県' },
    { shop_name: '宮崎宮崎SANSAIN', email: 'sansainmiyazaki@gmail.com', area: '宮崎県' },
    { shop_name: '宮崎EXE GROUP', email: 'frontier19940812@gmail.com', area: '宮崎県' },
];

const SEND_URL = 'https://yobuho.com/api/send-mail.php';
const GENRE = 'deli';
const INTERVAL_MS = 2000;

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

async function main() {
    console.log(`▶ 営業メール送信開始: ${RECIPIENTS.length} 件`);
    console.log(`  件名: ${SUBJECT}`);
    console.log(`  間隔: ${INTERVAL_MS}ms\n`);

    const results = [];
    for (let i = 0; i < RECIPIENTS.length; i++) {
        const r = RECIPIENTS[i];
        const tag = `[${i + 1}/${RECIPIENTS.length}]`;
        process.stdout.write(`${tag} ${r.email}  (${r.shop_name}) ... `);
        let outcome;
        try {
            const result = await sendOne(r.email, SUBJECT, BODY);
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
                genre: GENRE,
                area: r.area,
                status: outcome,
                notes: SUBJECT,
            });
        } catch (err) {
            console.log(`   ⚠ DB記録失敗: ${err.message}`);
        }

        results.push({ ...r, status: outcome });
        if (i < RECIPIENTS.length - 1) await sleep(INTERVAL_MS);
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const errors = results.filter(r => r.status !== 'sent').length;
    console.log(`\n▶ 完了: 送信 ${sent} 件 / エラー ${errors} 件`);
    if (errors > 0) {
        console.log('エラー一覧:');
        results.filter(r => r.status !== 'sent').forEach(r => console.log(`  - ${r.email} (${r.shop_name})`));
    }

    await db.close();
}

main().catch(err => { console.error(err); process.exit(1); });
