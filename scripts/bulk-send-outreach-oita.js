// 大分県デリヘル店舗 11件へ営業メール一括送信（一回限りスクリプト）
// 使用前: SSHトンネルを起動 (`ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6051.wpx.ne.jp -N`)
// 実行:   node scripts/bulk-send-outreach-oita.js

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
    { shop_name: '大分おねだりデリバリー様', email: 'tenten3.3@icloud.com' },
    { shop_name: '大分cherish（チェリッシュ）様', email: 'cherish-oita@docomo.ne.jp' },
    { shop_name: '大分摩天楼～MATENROW～大分様', email: 'matenrow.oita@gmail.com' },
    { shop_name: '大分月花美人様', email: 'gekka.oita@docomo.ne.jp' },
    { shop_name: '大分Madam Cherish様', email: 'cherish.qzin@gmail.com' },
    { shop_name: '大分わっしょい☆元祖廃男コース大分店', email: 'kabushikigaisyatakapi@gmail.com' },
    { shop_name: '大分人妻・熟女MAN♂IN-ONREIマン淫♀御礼様', email: 'manin.onrei123@gmail.com' },
    { shop_name: '大分ROYAL cherish様', email: 'raffine-oita@ezweb.ne.jp' },
    { shop_name: '大分fraiche（フレーシェ）様', email: 'fraiche-aroma@docomo.ne.jp' },
    { shop_name: '大分club NOA様', email: 'oita-club.noa@docomo.ne.jp' },
    { shop_name: '大分Royal Fraiche', email: 'fraiche-aroma@docomo.ne.jp' },
];

const SEND_URL = 'https://yobuho.com/api/send-mail.php';
const GENRE = 'deli';
const AREA = '大分県';
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
    console.log(`▶ 大分デリヘル店舗 ${RECIPIENTS.length} 件への営業メール送信開始`);
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
                area: AREA,
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
