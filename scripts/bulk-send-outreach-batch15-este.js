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

const TEMPLATE_KEY = 'este'; // deli / general / jofu / same / loveho / este

const RECIPIENTS = [
    { shop_name: "luxury%20aroma%20咲", email: "8739.recruit@gmail.com", area: "福岡" },
    { shop_name: "博多アロマ戦隊", email: "aromasentai.s@gmail.com", area: "福岡" },
    { shop_name: "Hot%20aroma～ホットアロマ～", email: "hot.aroma.p@gmail.com", area: "福岡" },
    { shop_name: "密着エステ柔肌", email: "hengshangongxian@gmail.com", area: "福岡" },
    { shop_name: "アロマ戦隊2", email: "aromasentai4@gmail.com", area: "福岡" },
    { shop_name: "Aroma%20Bloom（アロマブルーム）", email: "aromabloom.otoiawase@gmail.com", area: "福岡" },
    { shop_name: "ハイグレードM性感%20過呼吸", email: "midara72@icloud.com", area: "福岡" },
    { shop_name: "たっぷりハニーオイルSPA福岡店", email: "tappuri_fukuoka_job@star-group.co.jp", area: "福岡" },
    { shop_name: "ごほうびSPA福岡店", email: "gohoubi_fukuoka_job@star-group.co.jp", area: "福岡" },
    { shop_name: "久留米ﾃﾞﾘﾊﾞﾘｱﾛﾏﾏｯｻｰｼﾞ%20Aroma%20Quest", email: "aromaquest1@gmail.com", area: "福岡" },
    { shop_name: "アロマエステ%20アイアール", email: "info@fuk-air.com", area: "福岡" },
    { shop_name: "E-girl%20Aroma", email: "egirlaroma@gmail.com", area: "長崎" },
    { shop_name: "アロマックス2012", email: "aro-max.since-20xx-.s@ezweb.ne.jp", area: "大分" },
    { shop_name: "fraiche（フレーシェ）", email: "fraiche-aroma@docomo.ne.jp", area: "大分" },
    { shop_name: "Ritz%20Aroma", email: "g.p@i.softbank.jp", area: "大分" },
    { shop_name: "リラリラ", email: "rira2888@gmail.com", area: "大分" },
    { shop_name: "ESTE ALLURE", email: "weareallure1310@gmail.com", area: "熊本" },
    { shop_name: "Aroma Resort", email: "rin.0303.judo.ida@gmail.com", area: "熊本" },
    { shop_name: "メンズスパ ミント", email: "mensspamint8117@gmail.com", area: "熊本" },
    { shop_name: "OLIVE SPA 熊本店", email: "job@olivespa.site", area: "熊本" },
    { shop_name: "メンズエステ アロキャン", email: "arocam.km@gmail.com", area: "熊本" },
    { shop_name: "club Refresh(クラブ・リフレッシュ)", email: "refresh.km6644@gmail.com", area: "熊本" },
    { shop_name: "AROMA OLIVE [宮崎店]", email: "ktt.2022.olive@gmail.com", area: "宮崎" },
    { shop_name: "性感エステLabo", email: "cl_kyujin3269@icloud.com", area: "宮崎" },
    { shop_name: "AROMA LUXE PLATINUM", email: "aromaluxe2016@gmail.com", area: "宮崎" },
    { shop_name: "宮崎アロマエステのお店 アロマ学園", email: "k.company.go@gmail.com", area: "宮崎" },
    { shop_name: "ハートセラピー", email: "miyazaki-heart2007@ezweb.ne.jp", area: "宮崎" },
    { shop_name: "Lime Spa", email: "lime@icloud.com", area: "鹿児島" },
    { shop_name: "ハンドリング 亀頭責め専門店", email: "shirakobato0530@icloud.com", area: "沖縄" },
    { shop_name: "沖縄ハイブリッドエステ", email: "recruit.moepro@gmail.com", area: "沖縄" },
    { shop_name: "banana heaven spa", email: "bananaheavenspa@gmail.com", area: "沖縄" },
    { shop_name: "密着SPA素人エステ専門店グループ", email: "mizugi.de.esute@gmail.com", area: "沖縄" },
    { shop_name: "ナースと女医の出張マッサージ", email: "narse.joi.4471@gmail.com", area: "沖縄" },
    { shop_name: "直電デリヘル TOUCH", email: "info@okinawa-touch.com", area: "沖縄" },
    { shop_name: "広島で評判のお店はココです！", email: "aromacherie082@gmail.com", area: "広島" },
    { shop_name: "aroma ace. －アロマエース－", email: "ace.job2021@gmail.com", area: "広島" },
    { shop_name: "広島性感マッサージ倶楽部マル秘世界", email: "info.maruhi@gmail.com", area: "広島" },
    { shop_name: "ごほうびSPA 広島店", email: "gohoubi_hiroshima_job@star-group.co.jp", area: "広島" },
    { shop_name: "広島回春性感マッサージ倶楽部", email: "k_hiroshima_job@star-group.co.jp", area: "広島" },
    { shop_name: "天国にいちばん近い島（カサグループ）", email: "aroma.tengoku@docomo.ne.jp", area: "広島" },
    { shop_name: "五十路エステハイブリッド", email: "isoji.hi@docomo.ne.jp", area: "広島" },
    { shop_name: "アロマセラピーエステサロン Feather", email: "feather-aroma@softbank.ne.jp", area: "広島" },
    { shop_name: "最後の楽園 ～愛のある場所～", email: "esute-s@softbank.ne.jp", area: "広島" },
    { shop_name: "LovingTouch 広島店", email: "lovingtouch0167@gmail.com", area: "広島" },
    { shop_name: "高級ｱﾛﾏｴｽﾃ＆性感 Felice-ﾌｪﾘｰﾁｪ-", email: "aroma-felice@docomo.ne.jp", area: "広島" },
    { shop_name: "とろける時間～脳バグ♡エステ～", email: "roundg.hiro@gmail.com", area: "広島" },
    { shop_name: "シャングリラ 東広島 ～桃源郷～", email: "shangrila_higashihiroshima@docomo.ne.jp", area: "広島" },
    { shop_name: "シャングリラ 呉 ～桃源郷～", email: "shangrila_recruit@icloud.com", area: "広島" },
    { shop_name: "Melty Esthe 性感回春エステ", email: "xinqui5369@icloud.com", area: "広島" },
    { shop_name: "広島性感マッサージマル秘世界東広島店", email: "info.maruhi.higashi@gmail.com", area: "広島" },
    { shop_name: "新・回春マッサージTSUBAKI", email: "adhwd55@gmail.com", area: "岡山" },
    { shop_name: "天使のゆびさき岡山店（カサグループ）", email: "aroma-o@docomo.ne.jp", area: "岡山" },
    { shop_name: "密着アロマにゃんにゃんSPA", email: "recruit.nyan.nyan.spa@gmail.com", area: "岡山" },
    { shop_name: "オフィスアロマ", email: "ofiaro.ube1919@gmail.com", area: "山口" },
    { shop_name: "ハナハナSPA～花華～", email: "hanahanaspa.aroma@gmail.com", area: "山口" },
    { shop_name: "山陰回春マッサージ", email: "saninkaishun@gmail.com", area: "鳥取" },
    { shop_name: "回春マッサージSAKURA", email: "i.tky0712@ezweb.ne.jp", area: "島根" },
    { shop_name: "ご奉仕アロマ 猫の宅急便", email: "takuroro2580@softbank.ne.jp", area: "香川" },
    { shop_name: "メンズエステ・VIVIANA♀HAND高松店", email: "viviana-hand@docomo.ne.jp", area: "香川" },
    { shop_name: "アロマエステ H.club", email: "tokusima.h.club@gmail.com", area: "徳島" },
    { shop_name: "出張メンズエステ TORICO SPA 高知店", email: "e-baito@docomo.ne.jp", area: "高知" },
    { shop_name: "ディープエステプラス", email: "honey6840@docomo.ne.jp", area: "愛媛" },
    { shop_name: "松山回春性感エステオールスターズ", email: "pon.allstars@gmail.com", area: "愛媛" },
    { shop_name: "ドキワク逆マッサージ愛媛", email: "dokiwaku.gyaku@gmail.com", area: "愛媛" },
    { shop_name: "アロマ性感エステ・ガーデンヒルズ松山", email: "ghs.m.ghs@gmail.com", area: "愛媛" },
    { shop_name: "Maria Belle Aroma（ｱｲﾝｽﾞｸﾞﾙｰﾌﾟ）", email: "mariabelle@recruit-kansai.com", area: "大阪" },
    { shop_name: "Remote Spa Premium(ﾘﾓｰﾄｽﾊﾟﾌﾟﾚﾐｱﾑ)", email: "remote.spa.umeda.0333@gmail.com", area: "大阪" },
    { shop_name: "Aroma De Paris（アインズグループ）", email: "aropari@recruit-kansai.com", area: "大阪" },
    { shop_name: "めっちゃスイスク梅田店", email: "umedaestheswimming@gmail.com", area: "大阪" },
    { shop_name: "ぽちゃSPA", email: "recruit@queens-w.com", area: "大阪" },
    { shop_name: "大阪回春性感エステティーク谷九店", email: "tique.recruit@gmail.com", area: "大阪" },
    { shop_name: "リチスパ", email: "richgakuen-job@docomo.ne.jp", area: "大阪" },
    { shop_name: "ごほうびSPA大阪店（スターグループ)", email: "gohoubi_osaka_job@star-group.co.jp", area: "大阪" },
    { shop_name: "大阪回春性感マッサージ倶楽部", email: "k_osaka_job@star-group.co.jp", area: "大阪" },
    { shop_name: "ヒルズスパ梅田＋", email: "hills.spa.umeda.plus@gmail.com", area: "大阪" },
    { shop_name: "エステティシャンの恋人", email: "info@esthe-koibito.com", area: "大阪" },
    { shop_name: "あのスパ茨木・枚方店", email: "anospa0501@gmail.com", area: "大阪" },
    { shop_name: "梅田ムチSPA女学院", email: "muchispa.kyujin@gmail.com", area: "大阪" },
    { shop_name: "大阪☆出張マッサージ委員会", email: "iinkaijob@gmail.com", area: "大阪" },
    { shop_name: "AROMA性感倶楽部", email: "esth.tennouji@gmail.com", area: "大阪" },
    { shop_name: "癒しの円環-Art of Massage- 梅田", email: "info@artofmassage.jp", area: "大阪" },
    { shop_name: "オトコのたしなみSPA", email: "tashinamispa@gmail.com", area: "大阪" },
    { shop_name: "BaliSpa", email: "balispa.osaka@gmail.com", area: "大阪" },
    { shop_name: "アロマエステ NADIA 神戸店", email: "nadia.group.kobe@gmail.com", area: "兵庫" },
    { shop_name: "よくばりﾄﾛﾘｯ痴-ﾌｪﾁなM性感ﾍﾙｽ-神戸店", email: "y_kobe_job@star-group.co.jp", area: "兵庫" },
    { shop_name: "ごほうびSPA神戸店（スターグループ）", email: "gohoubi_kobe_job@star-group.co.jp", area: "兵庫" },
    { shop_name: "高級出張メンズエステ 神戸ChouChou", email: "kyuzinchou@gmail.com", area: "兵庫" },
    { shop_name: "神戸回春性感ﾏｯｻｰｼﾞ倶楽部(ｽﾀｰｸﾞﾙｰﾌﾟ)", email: "k_kobe_job@star-group.co.jp", area: "兵庫" },
    { shop_name: "アロマエステ NADIA 神戸店", email: "himejiaromaesute1212@gmail.com", area: "兵庫" },
    { shop_name: "大人の風俗エステ", email: "otonanoesute2163@gmail.com", area: "兵庫" },
    { shop_name: "性感エステ ヴィラ", email: "progress54321@yahoo.co.jp", area: "兵庫" },
    { shop_name: "アロマエステ NADIA 京都店", email: "n.kyoto.job@gmail.com", area: "京都" },
    { shop_name: "ごほうびSPA京都店(スターグループ)", email: "gohoubi_kyoto_job@star-group.co.jp", area: "京都" },
    { shop_name: "京都回春性感ﾏｯｻｰｼﾞ倶楽部(ｽﾀｰｸﾞﾙｰﾌﾟ)", email: "k_kyoto_job@star-group.co.jp", area: "京都" },
    { shop_name: "プルプル京都性感エステ はんなり", email: "puru.hannari.recruit@gmail.com", area: "京都" },
    { shop_name: "すごいエステ京都店(スターグループ)", email: "sugoi_kyoto_job@star-group.co.jp", area: "京都" },
    { shop_name: "京都性感NEWエステ", email: "kyoto.neweses@gmail.com", area: "京都" },
    { shop_name: "ECSTASY〜極上の快楽エステ〜", email: "ecstasy.19960102@gmail.com", area: "滋賀" },
    { shop_name: "出張メンズエステ ロマンスSPA 奈良", email: "recruit@romance-spa.net", area: "奈良" },
    { shop_name: "大和ナデシコ～人妻M性感～", email: "shop@nadesiko-mseikan.com", area: "奈良" },
    { shop_name: "Nukeru de Spa (ぬける で すぱ)", email: "johndoe18@i.softbank.jp", area: "和歌山" },
    { shop_name: "アロマっち（オーレングループ）", email: "aromachi2321477@gmail.com", area: "愛知" },
    { shop_name: "ラルム", email: "k.este.larme@gmail.com", area: "愛知" },
    { shop_name: "やみつきエステ2nd名古屋店", email: "nagoya.ymt@gmail.com", area: "愛知" },
    { shop_name: "タッチdeエステ", email: "kigumi27@yahoo.co.jp", area: "愛知" },
    { shop_name: "THE ESUTE HOUSE 池下", email: "esute_i_job@luna-group.net", area: "愛知" },
    { shop_name: "THE ESUTE HOUSE 柴田", email: "esute_s_job@luna-group.net", area: "愛知" },
    { shop_name: "MUSEspa（ミューズスパ）", email: "info@musespa.jp", area: "愛知" },
    { shop_name: "すごいエステ名古屋店", email: "sugoi_job@star-group.co.jp", area: "愛知" },
    { shop_name: "THE ESUTE HOUSE 名古屋", email: "esute_n_job@luna-group.net", area: "愛知" },
    { shop_name: "ごほうびSPA 名古屋店", email: "gohoubi_nagoya_job@star-group.co.jp", area: "愛知" },
    { shop_name: "名古屋回春性感マッサージ倶楽部", email: "k_nagoya_job@star-group.co.jp", area: "愛知" },
    { shop_name: "Aroma de TOKYO 三河店", email: "aromade.mikawa0009@docomo.ne.jp", area: "愛知" },
    { shop_name: "メンズエステ フレグランス", email: "jj_fr@icloud.com", area: "愛知" },
    { shop_name: "熟女の風俗アウトレット 半田知多店", email: "outlethanda@gmail.com", area: "愛知" },
    { shop_name: "ごくらくSPA HANARE", email: "gokurakuspahanare@gmail.com", area: "愛知" },
    { shop_name: "MIDARA SPA", email: "midaraspa2@gmail.com", area: "愛知" },
    { shop_name: "姉エステ フレグランス", email: "fro5000@docomo.ne.jp", area: "愛知" },
    { shop_name: "メンズエステ フレグランス池下", email: "spgj@docomo.ne.jp", area: "愛知" },
    { shop_name: "濃密バブルSPA VIP", email: "densegroup2020@gmail.com", area: "静岡" },
    { shop_name: "浜松回春性感マッサージ倶楽部", email: "k_hamamatsu_job@star-group.co.jp", area: "静岡" },
    { shop_name: "優しいM性感 沼津", email: "yasam.numa@gmail.com", area: "静岡" },
    { shop_name: "高級アロマエステ&性感 ～4H～", email: "the.world-21@docomo.ne.jp", area: "静岡" },
    { shop_name: "高級アロマエステ&性感 ～4H～静岡店", email: "4h16815566@gmail.com", area: "静岡" },
    { shop_name: "Ｍ性感Mirage", email: "mseikan.mirage@gmail.com", area: "静岡" },
    { shop_name: "ごほうびSPA浜松店", email: "gohoubi_hamamatsu_job@star-group.co.jp", area: "静岡" },
    { shop_name: "回春メンズエステグッドレディ", email: "goodbrain214@gmail.com", area: "三重" },
    { shop_name: "極嬢S&M 四日市店", email: "gokujoukaisyunseikansupa@gmail.com", area: "三重" },
    { shop_name: "PREMIUM ESTHE(プレミアムエステ)", email: "premiumesthe@ymail.ne.jp", area: "三重" },
    { shop_name: "Aroma de TOKYO 岐阜店", email: "aromagifu016@gmail.com", area: "岐阜" },
    { shop_name: "岐阜Loveタッチ", email: "lovetuch@icloud.com", area: "岐阜" },
    { shop_name: "素人パパ活アロマクリニック金沢店", email: "celjimada1115@gmail.com", area: "石川" },
    { shop_name: "金沢M性感Empressエンプレス", email: "info@empress-kanazawa.com", area: "石川" },
    { shop_name: "福井性感回春アロマSpa", email: "fukuihc@gmail.com", area: "福井" },
    { shop_name: "新潟風俗Noel手コキ・デリヘル・エステ", email: "o8o20923236@ymobile.ne.jp", area: "新潟" },
    { shop_name: "メンズスパ", email: "s_kanpani_0618@yahoo.co.jp", area: "新潟" },
    { shop_name: "人妻浪漫", email: "hitodumaroman.net@gmail.com", area: "新潟" },
    { shop_name: "長野回春性感SPA かいかんエステ", email: "musounagano.k@gmail.com", area: "長野" },
    { shop_name: "松本回春性感SPA", email: "musou.matsumoto@gmail.com", area: "長野" },
    { shop_name: "恋のリフレイン", email: "koinorefrain@gmail.com", area: "長野" },
    { shop_name: "甲府回春アロマージュ", email: "aromaje.kofu@gmail.com", area: "山梨" },
    { shop_name: "シンデレラエステ", email: "cinderella20220301@gmail.com", area: "山梨" },
    { shop_name: "宇都宮/回春・性感クリニック", email: "info@u-lovebody.com", area: "栃木" },
    { shop_name: "地元女子のメンズエステ AROMA DREAM", email: "aroma.dream.aroma@gmail.com", area: "栃木" },
    { shop_name: "回春マッサージメンズエステ宇都宮", email: "uutunomiya7887@gmail.com", area: "栃木" },
    { shop_name: "宇都宮回春性感マッサージ熟女SPA", email: "jyuku.spa9010@gmail.com", area: "栃木" },
    { shop_name: "アロマDEハンド", email: "jb.u3712@docomo.ne.jp", area: "栃木" },
    { shop_name: "relaxation salon AROMA", email: "mito.aroma.310@gmail.com", area: "茨城" },
    { shop_name: "至福の密着エステ&禁断のM性感 Luxeaz", email: "luxeaz_kyujin@ymail.ne.jp", area: "茨城" },
    { shop_name: "高級出張性感ﾏｯｻｰｼﾞ＆回春ｴｽﾃ ｾﾚﾌﾞﾘﾌﾚ", email: "refremito@gmail.com", area: "茨城" },
    { shop_name: "高崎回春性感SPA", email: "asianspa.takasaki@gmail.com", area: "群馬" },
    { shop_name: "回春性感メンズエステ CLUB AROMA", email: "club.aroma88@gmail.com", area: "群馬" },
    { shop_name: "恋色性感ﾒﾝｽﾞｴｽﾃ Elegance Spa 高崎店", email: "dream.sayonara@icloud.com", area: "群馬" },
    { shop_name: "夢の国 デリランド", email: "ota.deli.7788@gmail.com", area: "群馬" },
    { shop_name: "secret spa", email: "a1002m0917@i.softbank.jp", area: "群馬" },
    { shop_name: "極みエステ太田", email: "kyujin@kiwami-ota.com", area: "群馬" }
];

// ===== 以下はテンプレート定義 =====

const TEMPLATES = {
    deli: {
        subject: '【Deli YobuHo】1ヶ月無料｜匿名お客様チャット機能つき＆店舗専用ページ - デリヘル対応ホテル検索',
        body: `ご担当者様

突然のご連絡失礼いたします。
デリヘル対応ホテル検索サイト「Deli YobuHo」を運営しております、YobuHo Check-In Partnersと申します。

当サイトでは、全国43,000件以上のホテルについて「デリヘルを呼べるかどうか」の情報を提供しており、多くのユーザー様にご利用いただいております。

現在、掲載店舗様からのホテル対応情報を募集しており、貴店にも無料でご掲載いただけないかと思いご連絡差し上げました。

━━━━━━━━━━━━━━━━━━━
📍 詳しくはキャンペーン特設ページでご確認ください
━━━━━━━━━━━━━━━━━━━

▼ 料金プラン・キャンペーン詳細
https://yobuho.com/plan-campaign/

▼ YobuChat（匿名チャット）機能・導入手順
https://yobuho.com/yobuchat-campaign/

※どちらのページも、店舗様向けにキャンペーン特典を分かりやすくまとめています。

━━━━━━━━━━━━━━━━━━━
■ 貴店だけの専用ページが作れます
【投稿リンクプラン 1ヶ月無料キャンペーン】
🗓 2026年5月末までのご登録限定
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
■ 💬 YobuChat（匿名チャット）も無料期間中に使い放題
━━━━━━━━━━━━━━━━━━━

投稿リンクプランには、お客様と直接やり取りできる
匿名チャットツール「YobuChat」が標準装備されています。

✅ 貴店のホームページ・SNSに「💬 チャットで相談」ボタンを
   コピペ1行で設置可能（HTML知識不要）
✅ 自動翻訳機能つき（英語・中国語・韓国語のお客様にも対応）
✅ キャスト個別の指名チャットURLも発行できます
   （投稿リンクプランは キャスト5名様分 まで作成可）
✅ 受付時間外は自動で「営業時間外」表示、新着はメール通知
✅ お客様は登録不要・匿名でメッセージ送信OK

キャストさん向けのチャットサービスは他にも存在しますが、
多くは会員登録やアプリインストールが必要で、
「ちょっと聞きたいだけ」のお客様は途中で離脱してしまいます。

YobuChat は ─ 登録不要・アプリ不要・匿名でその場で送信 ─
電話やLINEにハードルを感じるお客様も気軽に問い合わせOK。

電話しづらくて、つい同じお店ばかり使ってしまうお客様も多いものです。
匿名チャットなら気軽に問い合わせられるため、貴店への新規獲得の窓口が大きく広がります。

▼ YobuChat 機能・導入手順の詳細はこちら（キャンペーン詳細あり）
https://yobuho.com/yobuchat-campaign/

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

▼ 料金プラン詳細（キャンペーン情報あり）
https://yobuho.com/plan-campaign/

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
    este: {
        subject: '【Este YobuHo】1ヶ月無料｜匿名お客様チャット機能つき＆店舗専用ページ - デリエステ対応ホテル検索',
        body: `ご担当者様

突然のご連絡失礼いたします。
デリエステ（回春マッサージ・M性感・風俗エステ）対応ホテル検索サイト「Este YobuHo」を運営しております、YobuHo Check-In Partnersと申します。

当サイトでは、全国43,000件以上のホテルについて「デリエステを呼べるかどうか」の情報を提供しております。

━━━━━━━━━━━━━━━━━━━
📍 詳しくはキャンペーン特設ページでご確認ください
━━━━━━━━━━━━━━━━━━━

▼ 料金プラン・キャンペーン詳細
https://yobuho.com/plan-campaign/

▼ YobuChat（匿名チャット）機能・導入手順
https://yobuho.com/yobuchat-campaign/

※どちらのページも、店舗様向けにキャンペーン特典を分かりやすくまとめています。

━━━━━━━━━━━━━━━━━━━
■ 無料プランでできること
━━━━━━━━━━━━━━━━━━━

✅ お店様名テキスト掲載（口コミに店名表示）
✅ 認証バッジ付与（信頼性UP）
✅ お店様専用URL発行（SNS・HP設置可能）
✅ ホテルごとのご案内実績を公式発信

━━━━━━━━━━━━━━━━━━━
■ 貴店だけの専用ページが作れます
【投稿リンクプラン 1ヶ月無料キャンペーン】
🗓 2026年5月末までのご登録限定
━━━━━━━━━━━━━━━━━━━

今なら「投稿リンクプラン（月額5,500円・税込）」を1ヶ月間無料でお試しいただけます！
キャンペーン期間終了後も、無料プランとしてそのまま掲載を継続いただけます。

・貴店の情報だけが表示される専用ページ（URL）をご用意
・他店舗の情報は一切表示されず、オフィシャルサイトやSNSにそのまま設置可能
・ホテル情報ページに貴店名からオフィシャルサイトへ直接リンク
・掲載ホテルまでの交通費も掲載可（非掲載も可）

※お試し期間が終わっても、そのまま無料プランでお使いいただけます。

▼▼ 店舗登録はこちら（無料・最短3分）▼▼
https://yobuho.com/shop-register/

━━━━━━━━━━━━━━━━━━━
■ 💬 YobuChat（匿名チャット）も無料期間中に使い放題
━━━━━━━━━━━━━━━━━━━

投稿リンクプランには、お客様と直接やり取りできる
匿名チャットツール「YobuChat」が標準装備されています。

✅ 貴店のホームページ・SNSに「💬 チャットで相談」ボタンを
   コピペ1行で設置可能（HTML知識不要）
✅ 自動翻訳機能つき（英語・中国語・韓国語のお客様にも対応）
✅ セラピスト個別の指名チャットURLも発行できます
   （投稿リンクプランは セラピスト5名様分 まで作成可）
✅ 受付時間外は自動で「営業時間外」表示、新着はメール通知
✅ お客様は登録不要・匿名でメッセージ送信OK

セラピストさん向けのチャットサービスは他にも存在しますが、
多くは会員登録やアプリインストールが必要で、
「ちょっと聞きたいだけ」のお客様は途中で離脱してしまいます。

YobuChat は ─ 登録不要・アプリ不要・匿名でその場で送信 ─
電話やLINEにハードルを感じるお客様も気軽に問い合わせOK。

電話しづらくて、つい同じお店ばかり使ってしまうお客様も多いものです。
匿名チャットなら気軽に問い合わせられるため、貴店への新規獲得の窓口が大きく広がります。

▼ YobuChat 機能・導入手順の詳細はこちら（キャンペーン詳細あり）
https://yobuho.com/yobuchat-campaign/

━━━━━━━━━━━━━━━━━━━
■ お客様の信頼感アップ → ご依頼に直結
━━━━━━━━━━━━━━━━━━━

・店舗様からの投稿は「公式情報」として、ユーザー口コミと区別して表示
・「このホテルなら呼べる」という安心感が、貴店への依頼につながります
・交通費やサービス内容も掲載でき、お客様の不安を事前に解消

━━━━━━━━━━━━━━━━━━━
■ 無料プランですぐに始められます
━━━━━━━━━━━━━━━━━━━

費用は一切かかりません。届出確認書をお持ちの店舗様であれば、どなたでもご登録いただけます。

1. 下記URLからメールアドレスを登録
2. 届出確認書の画像をアップロード
3. 審査完了後、すぐにご利用開始

▼ 店舗登録はこちら（無料）
https://yobuho.com/shop-register/?genre=este

▼ サイトはこちら
https://este.yobuho.com/

▼ プラン詳細
https://yobuho.com/plan/

まずは無料プランからお試しいただき、効果を実感してください。

ご不明点がございましたら、お気軽にお問い合わせください。
何卒よろしくお願いいたします。

─────────────────
YobuHo Check-In Partners
デリエステ対応ホテル検索「Este YobuHo」
https://este.yobuho.com/
お問い合わせ: https://yobuho.com/contact/
担当窓口: hotel@yobuho.com
─────────────────`,
    },
    // 必要に応じて jofu / same / loveho / general を追加
};

const SEND_URL = 'https://yobuho.com/api/send-mail.php';
const INTERVAL_MS = 5000;
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
