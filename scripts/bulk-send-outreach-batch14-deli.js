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
    { shop_name: "博多で評判のお店はココです！", email: "hakatacoco9jin@yahoo.co.jp", area: "福岡" },
    { shop_name: "body=優美", email: "yuubi10011001@gmail.com", area: "福岡" },
    { shop_name: "風雅", email: "fuga.recruit8739@gmail.com", area: "福岡" },
    { shop_name: "姫1", email: "corp.himeka@gmail.com", area: "福岡" },
    { shop_name: "ジュリア（JULIA）", email: "julia.fukuoka@gmail.com", area: "福岡" },
    { shop_name: "ゴッドパイ博多", email: "kt.19861214@gmail.com", area: "福岡" },
    { shop_name: "CHA.CHA.GROUP", email: "feixiongmachengtian@gmail.com", area: "福岡" },
    { shop_name: "久留米デリヘル倶楽部", email: "derikura.kurume@gmail.com", area: "福岡" },
    { shop_name: "博多人妻専科24時", email: "hitodumasenkakyujin@yahoo.co.jp", area: "福岡" },
    { shop_name: "わっしょい☆元祖廃男コース専門店", email: "kabushikigaisyatakapi@gmail.com", area: "福岡" },
    { shop_name: "ときめき☆アイドル部%20博多店", email: "pd.yamao@gmail.com", area: "福岡" },
    { shop_name: "大牟田デリヘル倶楽部", email: "omtclub.woman@gmail.com", area: "福岡" },
    { shop_name: "ZEROグループ", email: "kurumekoakuma@yahoo.co.jp", area: "福岡" },
    { shop_name: "OLIVE%20%28オリーブ%29", email: "f.ol@ezweb.ne.jp", area: "福岡" },
    { shop_name: "福岡サンキュー", email: "3900fukuoka@gmail.com", area: "福岡" },
    { shop_name: "SAZANKA", email: "sazankahanakizoku1001@gmail.com", area: "福岡" },
    { shop_name: "グランドオペラ福岡", email: "recruit@f-opera.com", area: "福岡" },
    { shop_name: "Mercury%20小倉", email: "kyuuzin0501@docomo.ne.jp", area: "福岡" },
    { shop_name: "奥鉄オクテツ福岡", email: "info-fukuoka@dh2020.jp", area: "福岡" },
    { shop_name: "CHLOE", email: "chloe.kurume@gmail.com", area: "福岡" },
    { shop_name: "天空のマット", email: "info@109mat.com", area: "福岡" },
    { shop_name: "On%20a%20best（オンナベスト）", email: "onabest2023@gmail.com", area: "福岡" },
    { shop_name: "小倉人妻デリヘル「夜這いな奥さま！」", email: "kokurafujin@gmail.com", area: "福岡" },
    { shop_name: "ROYAL-X%28ロイヤルエックス%29", email: "dsl.masuda@gmail.com", area: "福岡" },
    { shop_name: "子猫カフェ", email: "rec@koneco-cafe.com", area: "福岡" },
    { shop_name: "久留米デリヘル358", email: "kurumederi358@gmail.com", area: "福岡" },
    { shop_name: "UMA", email: "tiarasekand@gmail.com", area: "福岡" },
    { shop_name: "CLUB%20DEEP%20博多", email: "club.deep.hakata@gmail.com", area: "福岡" },
    { shop_name: "CLUB%20ALLURE", email: "dc-allure@docomo.ne.jp", area: "福岡" },
    { shop_name: "よかろうもんグループ", email: "yokaroumon.red@gmail.com", area: "福岡" },
    { shop_name: "小倉素人コレクション", email: "k.siroto.k@gmail.com", area: "福岡" },
    { shop_name: "CLUB%20虎の穴%20福岡", email: "toranoanafukuoka@gmail.com", area: "福岡" },
    { shop_name: "花の都～人妻の都～", email: "qj.miyako@gmail.com", area: "福岡" },
    { shop_name: "CLUB%20DEEP%20小倉", email: "club.deep.kokura@gmail.com", area: "福岡" },
    { shop_name: "ここだけの話！博多店", email: "kokodakehakata@gmail.com", area: "福岡" },
    { shop_name: "ぐっすり山田%20福岡店", email: "g_fukuoka_job@star-group.co.jp", area: "福岡" },
    { shop_name: "快楽堂", email: "kairakudo3888@icloud.com", area: "福岡" },
    { shop_name: "ゴールド%20リシャール福岡", email: "goldrichardvip@gmail.com", area: "福岡" },
    { shop_name: "ティファニードール", email: "tiffanydoll1216@icloud.com", area: "福岡" },
    { shop_name: "人妻美人館", email: "h.bijinkan@gmail.com", area: "福岡" },
    { shop_name: "恵比寿コレクション%20久留米本店", email: "ys436969@yahoo.co.jp", area: "福岡" },
    { shop_name: "福岡大野城・板付インターちゃんこ", email: "fukuoka.chanko@gmail.com", area: "福岡" },
    { shop_name: "人妻デリヘル～もしづま～福岡博多店", email: "moshiduma.hakata@gmail.com", area: "福岡" },
    { shop_name: "エデンの園", email: "edennosono1107@gmai.com", area: "福岡" },
    { shop_name: "RASTA", email: "chikho-rasta@ezweb.ne.jp", area: "福岡" },
    { shop_name: "奥様恋愛館", email: "renaikan5037@ezweb.ne.jp", area: "福岡" },
    { shop_name: "キャンディ", email: "oubo.kagodeli@gmail.com", area: "福岡" },
    { shop_name: "こあくまな人妻・熟女たち小倉店", email: "recruit_girls_west@koakumagroup.com", area: "福岡" },
    { shop_name: "豊満倶楽部", email: "job@club-houman.com", area: "福岡" },
    { shop_name: "シャルドネ福岡", email: "luxe.recruiting1111@gmail.com", area: "福岡" },
    { shop_name: "桃色☆めぃぷるシロップ", email: "rec@momo-shiro.com", area: "福岡" },
    { shop_name: "爆乳王%20福岡デリヘル", email: "nuretuma@gmail.com", area: "福岡" },
    { shop_name: "福岡ちゃんこ大牟田店", email: "omuta.chanko@gmail.com", area: "福岡" },
    { shop_name: "北九州人妻倶楽部", email: "hito304050@gmail.com", area: "福岡" },
    { shop_name: "蓮華", email: "hakatathaikoshiki@gmail.com", area: "福岡" },
    { shop_name: "NOIR福岡%28ノワール福岡%29", email: "noirfukuoka31@gmail.com", area: "福岡" },
    { shop_name: "久留米新妻倶楽部", email: "niiduma.club.fukuoka@gmail.com", area: "福岡" },
    { shop_name: "アップフロア", email: "2upfloor@gmail.com", area: "福岡" },
    { shop_name: "博多プラチナム", email: "platinumgroup.girls@gmail.com", area: "福岡" },
    { shop_name: "AVANCE%20福岡", email: "avance.fukuoka@gmail.com", area: "福岡" },
    { shop_name: "SILK%20SPA福岡店", email: "ote.fukuoka@gmail.com", area: "福岡" },
    { shop_name: "The%20Most", email: "themost202511@gmail.com", area: "福岡" },
    { shop_name: "ぽちゃかわ天使♡こいびとあんず", email: "info.skygr@gmail.com", area: "福岡" },
    { shop_name: "五十路セレブ", email: "kh6152431@gmail.com", area: "福岡" },
    { shop_name: "ミセスコレクション", email: "kakbkckd@docomo.ne.jp", area: "福岡" },
    { shop_name: "ROYAL%20FACE%20Fukuoka", email: "face.g217180@gmail.com", area: "福岡" },
    { shop_name: "久留米デリバリーヘルス%20艶・ジョイ", email: "enjoy2010@docomo.ne.jp", area: "福岡" },
    { shop_name: "JRもちぷよ駅", email: "sanche_kikaku@icloud.com", area: "福岡" },
    { shop_name: "福岡飯塚田川ちゃんこ", email: "iizukachanko877@gmail.com", area: "福岡" },
    { shop_name: "チュパチャップスグループ", email: "yamaguti202@gmail.com", area: "長崎" },
    { shop_name: "HAREM", email: "haremgroup.kyujin@gmail.com", area: "長崎" },
    { shop_name: "リップ", email: "lip.nagasaki@ezweb.ne.jp", area: "長崎" },
    { shop_name: "セクシー", email: "sexy.apple3154@gmail.com", area: "長崎" },
    { shop_name: "ティンカーベル", email: "tinkerbell.11-01@ezweb.ne.jp", area: "長崎" },
    { shop_name: "佐世保人妻デリヘル「デリ夫人」", email: "delifujin.sasebo@gmail.com", area: "長崎" },
    { shop_name: "Last%20Game", email: "ta0617@docomo.ne.jp", area: "長崎" },
    { shop_name: "佐世保デリヘル%20VERY（ヴェリィ）", email: "very.sasebo@gmail.com", area: "長崎" },
    { shop_name: "E-girl", email: "egirl0401@gmail.com", area: "長崎" },
    { shop_name: "佐世保ちゃんこ", email: "sasebo.tyanko@gmail.com", area: "長崎" },
    { shop_name: "ラブポーション", email: "info@lovepotion-nagasaki.com", area: "長崎" },
    { shop_name: "Crystal", email: "to-mo0525@docomo.ne.jp", area: "長崎" },
    { shop_name: "アップルティ%20長崎店", email: "ap.3344@ezweb.ne.jp", area: "長崎" },
    { shop_name: "プリンセスコレクション", email: "job-princess@docomo.ne.jp", area: "長崎" },
    { shop_name: "E-girl%20Princess%20大村店", email: "prin.0930.prin@gmail.com", area: "長崎" },
    { shop_name: "アップルティ%20佐世保店", email: "ap4444@ezweb.ne.jp", area: "長崎" },
    { shop_name: "佐世保コレクション", email: "sasebokorekusyon@gmail.com", area: "長崎" },
    { shop_name: "E-girl%20Monroe", email: "royalqueen0401@gmail.com", area: "長崎" },
    { shop_name: "四季物語", email: "shikimonogatari-2@docomo.ne.jp", area: "長崎" },
    { shop_name: "Bless（ブレス）", email: "p-style.i.o@docomo.ne.jp", area: "長崎" },
    { shop_name: "花火", email: "greenfam@docomo.ne.jp", area: "長崎" },
    { shop_name: "Peach！", email: "isahaya.peach.1816@gmail.com", area: "長崎" },
    { shop_name: "CLOVER%20HEART（クローバーハート）", email: "clover.h.6963@icloud.com", area: "長崎" },
    { shop_name: "The%20Grand%20Phoenix", email: "oita-grand.phoenix@docomo.ne.jp", area: "大分" },
    { shop_name: "おねだりデリバリー", email: "tenten3.3@icloud.com", area: "大分" },
    { shop_name: "cherish（チェリッシュ）", email: "cherish-oita@docomo.ne.jp", area: "大分" },
    { shop_name: "摩天楼～MATENROW～大分", email: "matenrow.oita@gmail.com", area: "大分" },
    { shop_name: "月花美人", email: "gekka.oita@docomo.ne.jp", area: "大分" },
    { shop_name: "Madam%20Cherish", email: "cherish.qzin@gmail.com", area: "大分" },
    { shop_name: "人妻・熟女MAN♂IN-ONREIマン淫♀御礼", email: "manin.onrei123@gmail.com", area: "大分" },
    { shop_name: "ROYAL%20cherish", email: "raffine-oita@ezweb.ne.jp", area: "大分" },
    { shop_name: "club%20NOA", email: "oita-club.noa@docomo.ne.jp", area: "大分" },
    { shop_name: "とろりんハンズ", email: "mtr106@softbank.ne.jp", area: "大分" },
    { shop_name: "ド淫乱妻倶楽部", email: "tsumakurabu@softbank.ne.jp", area: "大分" },
    { shop_name: "Club%20LUMINE", email: "grand_phoenix@i.softbank.jp", area: "大分" },
    { shop_name: "アップルティ大分店", email: "ap9191@ezweb.ne.jp", area: "大分" },
    { shop_name: "佐賀デリヘル358", email: "sagaderi358@gmail.com", area: "佐賀" },
    { shop_name: "VERY（ヴェリィ）", email: "very4615@gmail.com", area: "佐賀" },
    { shop_name: "ディオーネ", email: "dione.group10@gmail.com", area: "佐賀" },
    { shop_name: "佐賀人妻デリヘル%20「デリ夫人」", email: "delifujin@gmail.com", area: "佐賀" },
    { shop_name: "ぽちゃ雪姫～佐賀ぽちゃかわ専門店", email: "chankosaga@gmail.com", area: "佐賀" },
    { shop_name: "桃色奥様", email: "kyujin@saga-momoiro-group.com", area: "佐賀" },
    { shop_name: "ぴちぴちピーチ", email: "info@saga-momoiro-group.com", area: "佐賀" },
    { shop_name: "COURREGES 唐津", email: "courregesgroup@ezweb.ne.jp", area: "佐賀" },
    { shop_name: "Courreges", email: "hashiguchi0122@gmail.com", area: "佐賀" },
    { shop_name: "吉野ヶ里人妻デリヘル「デリ夫人」", email: "fujin.yoshinogari@gmail.com", area: "佐賀" },
    { shop_name: "ROYAL-X(ロイヤルエックス)佐賀店", email: "royalx.saga@gmail.com", area: "佐賀" },
    { shop_name: "おっぱい専門店 Chiffon", email: "chiffon.saga@gmail.com", area: "佐賀" },
    { shop_name: "熟女の薫り", email: "minorino-aki@docomo.ne.jp", area: "佐賀" },
    { shop_name: "美的", email: "biteki-group@au.com", area: "佐賀" },
    { shop_name: "アイコレクション女学院", email: "liengroup.kumamoto@gmail.com", area: "熊本" },
    { shop_name: "Hills Premier", email: "takechi.1024r@docomo.ne.jp", area: "熊本" },
    { shop_name: "GALAXY PLUS", email: "galaxy-job@i.softbank.jp", area: "熊本" },
    { shop_name: "熊本DH JPR", email: "pp.renraku@icloud.com", area: "熊本" },
    { shop_name: "ぴゅあグループ", email: "purepaikm@gmail.com", area: "熊本" },
    { shop_name: "天空のマット熊本店", email: "t_kumamoto_job@star-group.co.jp", area: "熊本" },
    { shop_name: "Ribbon 1st", email: "the.die.is.cast.sho@gmail.com", area: "熊本" },
    { shop_name: "セラヴィ", email: "se-junko@ezweb.ne.jp", area: "熊本" },
    { shop_name: "Club Moet熊本", email: "clubmoet.gr@gmail.com", area: "熊本" },
    { shop_name: "わんないとらぶ", email: "l0ve.ace1121@docomo.ne.jp", area: "熊本" },
    { shop_name: "ココだけの話！！熊本店", email: "kokodakenohanashi.kumamoto@gmail.com", area: "熊本" },
    { shop_name: "MANDALA", email: "info@mandala-kumamoto.com", area: "熊本" },
    { shop_name: "九州熟女 熊本店", email: "k9juku@docomo.ne.jp", area: "熊本" },
    { shop_name: "AVANT GARDE", email: "info@canon-production.net", area: "熊本" },
    { shop_name: "Jewelry Club（ジュエリークラブ）", email: "jewelryclub1977@gmail.com", area: "熊本" },
    { shop_name: "サンキュー熊本店", email: "3900kumamoto@gmail.com", area: "熊本" },
    { shop_name: "ぴゅあぱい＆ぷりてぃ♡八代宇土", email: "purepaiyt@gmail.com", area: "熊本" },
    { shop_name: "BON BON", email: "presentygs@gmail.com", area: "熊本" },
    { shop_name: "熟年カップル熊本～生電話からの営み～", email: "keisei.eng2019@gmail.com", area: "熊本" },
    { shop_name: "縁-EN- 熊本人妻(20代、30代、40代)", email: "ayumiooishi1@gmail.com", area: "熊本" },
    { shop_name: "AVANCE 熊本", email: "avance.kuma@gmail.com", area: "熊本" },
    { shop_name: "ちょっとそこの奥さん", email: "09013665321club@gmail.com", area: "熊本" },
    { shop_name: "イットク 1109", email: "1109gogo@gmail.com", area: "熊本" },
    { shop_name: "デリバリーヘルス熊本インターちゃんこ", email: "chanko.kmmt@gmail.com", area: "熊本" },
    { shop_name: "ポッチャリ専門店オーロラ", email: "aurora6999@icloud.com", area: "熊本" },
    { shop_name: "熊本ちゃんこ 八代店", email: "newyatsushirochanko@gmail.com", area: "熊本" },
    { shop_name: "1,980円！PARTY～Hand Healing～", email: "kumaparty29@gmail.com", area: "熊本" },
    { shop_name: "LEGEND熊本", email: "legend.moet00@gmail.com", area: "熊本" },
    { shop_name: "五十路マダム 熊本店(ｶｻﾌﾞﾗﾝｶｸﾞﾙｰﾌﾟ)", email: "kumacasa@icloud.com", area: "熊本" },
    { shop_name: "宮崎SANSAIN", email: "sansainmiyazaki@gmail.com", area: "熊本" },
    { shop_name: "ぽちゃカワ＆熟女専門店Theobroma", email: "theobroma.k.01@ezweb.ne.jp", area: "熊本" },
    { shop_name: "FF～我慢出来ない不倫in熊本", email: "souhei0304@gmail.com", area: "熊本" },
    { shop_name: "熟女性店", email: "jukuten@icloud.com", area: "熊本" },
    { shop_name: "club GALAXY in 八代", email: "07091230684y@gmail.com", area: "熊本" },
    { shop_name: "人妻インフォメーション熊本Grace", email: "kyujin@docomo.ne.jp", area: "熊本" },
    { shop_name: "EXE GROUP", email: "frontier19940812@gmail.com", area: "宮崎" },
    { shop_name: "PRISM都城", email: "purizumu7716@icloud.com", area: "宮崎" },
    { shop_name: "PRISM宮崎", email: "prism.myzk@icloud.com", area: "宮崎" },
    { shop_name: "フェアリー都城店", email: "fairy07110801@gmail.com", area: "宮崎" },
    { shop_name: "FResh(素人・可愛い)都城店", email: "fresh.health0000@gmail.com", area: "宮崎" },
    { shop_name: "花の都～人妻の都～延岡店", email: "miyako@gmail.com", area: "宮崎" },
    { shop_name: "Alice", email: "aris.t-r@ezweb.ne.jp", area: "宮崎" },
    { shop_name: "摩天楼～MATENROW～宮崎", email: "matenrow.miyazaki@gmail.com", area: "宮崎" },
    { shop_name: "アップル倶楽部", email: "tm.08018181@gmail.com", area: "宮崎" },
    { shop_name: "宮崎ちゃんこ中央通店", email: "miyazaki.chanko@gmail.com", area: "宮崎" },
    { shop_name: "ココだけの話！！宮崎店", email: "kokodakenohanasi.miyazaki@gmail.com", area: "宮崎" },
    { shop_name: "宮崎ちゃんこ都城店", email: "miyakonojo.chanko@gmail.com", area: "宮崎" },
    { shop_name: "Sincere ～シンシア～", email: "sincere@ymobile.ne.jp", area: "宮崎" },
    { shop_name: "EXECUTIVE [都城本店]", email: "exe.miyakonojohonten@gmail.com", area: "宮崎" },
    { shop_name: "Mariage(姉・人妻)", email: "mariage.health@gmail.com", area: "宮崎" },
    { shop_name: "Roots（ルーツ）", email: "dh-roots.go-go@ezweb.ne.jp", area: "宮崎" },
    { shop_name: "爆安＜元祖＞どすこい倶楽部", email: "dosukoi.12345678@gmail.com", area: "宮崎" },
    { shop_name: "ミセス[都城店]", email: "misesu.miyakonojo@gmail.com", area: "宮崎" },
    { shop_name: "Premium Belle", email: "k772989@au.com", area: "宮崎" },
    { shop_name: "アップルティ 都城店", email: "ap8181@ezweb.ne.jp", area: "宮崎" },
    { shop_name: "人妻・密会倶楽部", email: "sssskkk1993@icloud.com", area: "宮崎" },
    { shop_name: "フェアリー都城店", email: "0pa5575738d385f@au.com", area: "宮崎" },
    { shop_name: "ギャルサー", email: "o.knz0720@gmail.com", area: "鹿児島" },
    { shop_name: "こすらぶ鹿児島店", email: "coslove1300@ezweb.ne.jp", area: "鹿児島" },
    { shop_name: "人妻宅急便", email: "deli.chopper099@gmail.com", area: "鹿児島" },
    { shop_name: "CLUB A", email: "kagoshimakyujin@gmail.com", area: "鹿児島" },
    { shop_name: "NEWビビアン＆ガールズコレクション", email: "newvivian.recruite@gmail.com", area: "鹿児島" },
    { shop_name: "薩摩♂風俗の神様 鹿児島店", email: "info@of-nightwork-qjin.com", area: "鹿児島" },
    { shop_name: "摩天楼～MATENROW～鹿児島", email: "matenrow.kagoshima@gmail.com", area: "鹿児島" },
    { shop_name: "EXECUTIVE[霧島店]", email: "exe.kirishima@gmail.com", area: "鹿児島" },
    { shop_name: "ヴェルファーレ-VELFARRE-鹿児島", email: "velfaree@gmail.com", area: "鹿児島" },
    { shop_name: "人妻ステーション鹿児島", email: "station.recruit@gmail.com", area: "鹿児島" },
    { shop_name: "鹿児島ちゃんこ 霧島店", email: "kirishima.chanko@gmail.com", area: "鹿児島" },
    { shop_name: "momo♡霧島店", email: "momokirishimaderi@gmail.com", area: "鹿児島" },
    { shop_name: "鹿児島ちゃんこ 薩摩川内店", email: "sendai.chanko@gmail.com", area: "鹿児島" },
    { shop_name: "鹿児島ちゃんこ 天文館店", email: "kagoshima.chanko@gmail.com", area: "鹿児島" },
    { shop_name: "Chou♡Chou", email: "fairy.fairy.fairy2022@gmail.com", area: "鹿児島" },
    { shop_name: "7800円", email: "deliblog099@gmail.com", area: "鹿児島" },
    { shop_name: "沖縄素人図鑑", email: "zukan4610@gmail.com", area: "沖縄" },
    { shop_name: "Profile~プロフィール~", email: "profile.naha@gmail.com", area: "沖縄" },
    { shop_name: "YESグループ Lesson.1沖縄校", email: "lesson1n@yesgrp.com", area: "沖縄" },
    { shop_name: "かりゆしOLの秘密", email: "itaka.kouichi@gmail.com", area: "沖縄" },
    { shop_name: "es-1 エスワン", email: "okinawa.es1@gmail.com", area: "沖縄" },
    { shop_name: "sheep-沖縄-", email: "sheepokinawa.d@gmail.com", area: "沖縄" },
    { shop_name: "HANA-okinawa-", email: "oki.clubhana@gmail.com", area: "沖縄" },
    { shop_name: "Bijou R", email: "bijou.naha@gmail.com", area: "沖縄" },
    { shop_name: "素人学園＠", email: "deriheru098@gmail.com", area: "沖縄" },
    { shop_name: "Mode（モード）◆理想の彼女◆", email: "modekyujin@gmail.com", area: "沖縄" },
    { shop_name: "ここだけの話！！那覇店", email: "kokodakenohanashiokinawa@gmail.com", area: "沖縄" },
    { shop_name: "名護らいくAばーじん", email: "nagolike@gmail.com", area: "沖縄" },
    { shop_name: "人妻パラダイス", email: "kyuujinhitopara@gmail.com", area: "沖縄" },
    { shop_name: "沖縄ちゃんこコザ", email: "chanko20251201koza@gmail.com", area: "沖縄" },
    { shop_name: "沖縄 俺のジュニア", email: "cyber1122@me.com", area: "沖縄" },
    { shop_name: "沖縄ちゃんこ那覇店", email: "naha.chanko@gmail.com", area: "沖縄" },
    { shop_name: "秘密倶楽部", email: "himituclub.okinawa@gmail.com", area: "沖縄" },
    { shop_name: "天然素材", email: "mirion8000@gmail.com", area: "沖縄" },
    { shop_name: "沖縄人妻倶楽部 艶女 アデージョ", email: "epiepi789@gmail.com", area: "沖縄" },
    { shop_name: "ちゅら", email: "herusuderi@gmail.com", area: "沖縄" },
    { shop_name: "沖縄姉系・若妻倶楽部 PINK GOLD", email: "8131okinawapg@gmail.com", area: "沖縄" },
    { shop_name: "じゅーしーOKINAWA", email: "0kb6804v2mg571r@au.com", area: "沖縄" },
    { shop_name: "派遣費無料で即ご案内 ミルキー", email: "milky.milky098@gmail.com", area: "沖縄" },
    { shop_name: "妻味喰い", email: "ren231203@icloud.com", area: "沖縄" },
    { shop_name: "オキドキガール沖縄", email: "okidokigirl.okinawa@gmail.com", area: "沖縄" },
    { shop_name: "美熟女専門店 いいなり貴婦人", email: "iinarikihujin2018@gmail.com", area: "沖縄" },
    { shop_name: "五十路有閑マダム～沖縄店～", email: "isogemadamu@gmail.com", area: "沖縄" },
    { shop_name: "RUSH（RUSH ラッシュ グループ）", email: "info.rush47@gmail.com", area: "広島" },
    { shop_name: "百花繚乱（百花繚乱グループ）", email: "hyakka987654@gmail.com", area: "広島" },
    { shop_name: "AMATERAS－アマテラス－", email: "amateras.com@docomo.ne.jp", area: "広島" },
    { shop_name: "ラブコレクション", email: "09053790808@docomo.ne.jp", area: "広島" },
    { shop_name: "ラズベリー広島", email: "yoyakudaiji@yahoo.co.jp", area: "広島" },
    { shop_name: "ラブマシーン広島", email: "lovemachine.recruit@gmail.com", area: "広島" },
    { shop_name: "ママ友倶楽部", email: "mamatomo.girls@gmail.com", area: "広島" },
    { shop_name: "淫らなオンナ性体師", email: "midaranahiroshima@gmail.com", area: "広島" },
    { shop_name: "フルフル60分10000円（RUSHグループ）", email: "fullfull.4545@gmail.com", area: "広島" },
    { shop_name: "カサブランカ広島店（カサブランカG）", email: "kasabulanka-tf@docomo.ne.jp", area: "広島" },
    { shop_name: "ご近所物語（RUSHグループ）", email: "gokinjo0@gmail.com", area: "広島" },
    { shop_name: "エッチな熟女", email: "mn.sakura.mn@docomo.ne.jp", area: "広島" },
    { shop_name: "バレンタイン", email: "s.t.valentine@au.com", area: "広島" },
    { shop_name: "ポポロン☆広島", email: "popo_info@icloud.com", area: "広島" },
    { shop_name: "Luxeグループ", email: "clubluxe@docomo.ne.jp", area: "広島" },
    { shop_name: "人妻館", email: "hitotsuma@docomo.ne.jp", area: "広島" },
    { shop_name: "ELEGANCE(エレガンス)", email: "ele906@docomo.ne.jp", area: "広島" },
    { shop_name: "MOZAIC（モザイク）", email: "moza-h@docomo.ne.jp", area: "広島" },
    { shop_name: "RUSH 東広島店", email: "info.rush.higashihiroshima@gmail.com", area: "広島" },
    { shop_name: "煌き -KIRAMEKI-", email: "sense.hiroshima@ymail.ne.jp", area: "広島" },
    { shop_name: "Ares(アース)超恋人軍団広島最大級！", email: "areskyujin@gmail.com", area: "広島" },
    { shop_name: "五十路マダム 広島店", email: "madam-job@docomo.ne.jp", area: "広島" },
    { shop_name: "尾道デリヘル スマイル", email: "smile25onomichi@gmail.com", area: "広島" },
    { shop_name: "「人妻サロン」ニューヒロシマ", email: "newhiroshimamail@gmail.com", area: "広島" },
    { shop_name: "PLUMERIA", email: "plumeriakyujin@gmail.com", area: "広島" },
    { shop_name: "広島痴女性感フェチ倶楽部", email: "c_hiroshima_job@star-group.co.jp", area: "広島" },
    { shop_name: "福山ガールズセレクションEden", email: "edenfukuyama@gmail.com", area: "広島" },
    { shop_name: "DiamondHearts", email: "d.hearts9494@gmail.com", area: "広島" },
    { shop_name: "広島福山ちゃんこ", email: "fukuyama.chanko@gmail.com", area: "広島" },
    { shop_name: "東広島ちゃんこ", email: "chanko.higahiro@gmail.com", area: "広島" },
    { shop_name: "Vip Club Angelique-アンジェリーク-", email: "vip.angelique@docomo.ne.jp", area: "広島" },
    { shop_name: "五十路マダム 福山店", email: "madam.fu@icloud.com", area: "広島" },
    { shop_name: "5letters ～ファイブレターズ～", email: "five-letters@docomo.ne.jp", area: "広島" },
    { shop_name: "広島デリヘルコレクション", email: "ate32879@gmail.com", area: "広島" },
    { shop_name: "Puzzle", email: "puzzle.f.staff@gmail.com", area: "広島" },
    { shop_name: "奥様鉄道69 広島店", email: "tcnm3523@gmail.com", area: "広島" },
    { shop_name: "デリナビ(デリナビゲーション)", email: "derinavi04@gmail.com", area: "広島" },
    { shop_name: "cocoro", email: "cocoro020929@gmail.com", area: "広島" },
    { shop_name: "広島熟女デリバリーヘルスイマドキ50代", email: "imadoki50@gmail.com", area: "広島" },
    { shop_name: "広島市ちゃんこ", email: "chanko.hiroshima@gmail.com", area: "広島" },
    { shop_name: "神辺府中井原ちゃんこ", email: "kannabechanko@gmail.com", area: "広島" },
    { shop_name: "ｶｻﾌﾞﾗﾝｶ 福山店(ｶｻﾌﾞﾗﾝｶｸﾞﾙｰﾌﾟ)", email: "casa.fuku@au.com", area: "広島" },
    { shop_name: "ぽっちゃりmateマシュマロ", email: "pochamin@docomo.ne.jp", area: "広島" },
    { shop_name: "縁結び学園", email: "sin1128k@gmail.com", area: "広島" },
    { shop_name: "プロフィール倉敷(ｼｸﾞﾏｸﾞﾙｰﾌﾟ)", email: "info@okayama.pro-file.jp", area: "広島" },
    { shop_name: "－PTA－", email: "pta1919@ymobile.ne.jp", area: "広島" },
    { shop_name: "いちゃいちゃパラダイス（福山店）", email: "will.next.2016@gmail.com", area: "広島" },
    { shop_name: "さくらんぼ女学院", email: "ranbo3388@gmail.com", area: "岡山" },
    { shop_name: "COCKTAIL 岡山店", email: "mail@love-cocktail.com", area: "岡山" },
    { shop_name: "DRESS岡山(ｼｸﾞﾏｸﾞﾙｰﾌﾟ)", email: "dress.oka0862062405@gmail.com", area: "岡山" },
    { shop_name: "萌えラブ", email: "moeloveoka@gmail.com", area: "岡山" },
    { shop_name: "スマイリー", email: "info@k-smily.com", area: "岡山" },
    { shop_name: "タレント倶楽部", email: "girlswork.talent@gmail.com", area: "岡山" },
    { shop_name: "五十路マダム岡山店（カサブランカG）", email: "madam-o@docomo.ne.jp", area: "岡山" },
    { shop_name: "ミセスOLスタイル(ｻﾝﾗｲｽﾞｸﾞﾙｰﾌﾟ)", email: "m-o-s0024@ezweb.ne.jp", area: "岡山" },
    { shop_name: "倉敷人妻～エピソード～", email: "08029325050@docomo.ne.jp", area: "岡山" },
    { shop_name: "シュガー岡山", email: "sugar70248686@gmail.com", area: "岡山" },
    { shop_name: "カサブランカ岡山店（カサブランカG）", email: "casa-o@docomo.ne.jp", area: "岡山" },
    { shop_name: "熟女＆人妻＆ぽっちゃりクラブ", email: "pottyariclub@ezweb.ne.jp", area: "岡山" },
    { shop_name: "近所妻", email: "tomonori09087179911@icloud.com", area: "岡山" },
    { shop_name: "ACCENT[アクセントグループ]", email: "accent1187@gmail.com", area: "岡山" },
    { shop_name: "Club Dear", email: "gproject9@gmail.com", area: "岡山" },
    { shop_name: "Vacation（サンライズグループ）", email: "vacation0052@gmail.com", area: "岡山" },
    { shop_name: "デリスタ倉敷", email: "derisuta01@gmail.com", area: "岡山" },
    { shop_name: "岡山倉敷ちゃんこ", email: "kurasiki.chanko@gmail.com", area: "岡山" },
    { shop_name: "WhiteCLUB", email: "wg.kyujin2@docomo.ne.jp", area: "岡山" },
    { shop_name: "COCKTAIL津山店", email: "cocktail.tsuyama7007@gmail.com", area: "岡山" },
    { shop_name: "マダムスタイル（サンライズグループ）", email: "m-d-m3131@ezweb.ne.jp", area: "岡山" },
    { shop_name: "ぽちゃLOVE（サンライズグループ）", email: "love0015love@gmail.com", area: "岡山" },
    { shop_name: "オーダーメイド岡山店", email: "okayama.ordermade@gmail.com", area: "岡山" },
    { shop_name: "人妻の雫 岡山店", email: "yebisu.recruit@gmail.com", area: "岡山" },
    { shop_name: "奥鉄オクテツ岡山", email: "info-osaka@dh2020.jp", area: "岡山" },
    { shop_name: "出張あおぞら治療院", email: "recruit@aozora-delivery.com", area: "岡山" },
    { shop_name: "素人清楚専門店 Ecstasy", email: "mappi.33@i.softbank.jp", area: "岡山" },
    { shop_name: "奥様鉄道69 広島店", email: "q-jin@okutetsu.co.jp", area: "岡山" },
    { shop_name: "岡山市ちゃんこ", email: "okayamashi.chanko@gmail.com", area: "岡山" },
    { shop_name: "高知ﾃﾞﾘﾍﾙ－DIVA 学生から人妻迄在籍", email: "diva.kochi@gmail.com", area: "岡山" },
    { shop_name: "倉敷デリヘル", email: "kurashikideri@gmail.com", area: "岡山" },
    { shop_name: "素人専門 GIFT（ギフト）", email: "gift0505@icloud.com", area: "岡山" },
    { shop_name: "RANKAN Ma cherie-マシェリ-", email: "rankan.macherie@icloud.com", area: "岡山" },
    { shop_name: "RANKAN-ランカン-", email: "rankan.okyama@icloud.com", area: "岡山" },
    { shop_name: "OL俱楽部", email: "yamaguchi.olclub@gmail.com", area: "山口" },
    { shop_name: "多恋人倶楽部", email: "talentclub.yamaguchi@gmail.com", area: "山口" },
    { shop_name: "プラウディア", email: "clubproudia@gmail.com", area: "山口" },
    { shop_name: "セレブスタイル", email: "celeb.qjin@gmail.com", area: "山口" },
    { shop_name: "OL倶楽部周南", email: "olclub.shunan1919@gmail.com", area: "山口" },
    { shop_name: "AroMarquis 周南", email: "4277mbzm@gmail.com", area: "山口" },
    { shop_name: "多恋人倶楽部周南", email: "talentculb.shunan1919@gmail.com", area: "山口" },
    { shop_name: "五十妻（イソップ）40代～60代", email: "cs.group.recruit.1414@gmail.com", area: "山口" },
    { shop_name: "山口周南ちゃんこ", email: "tyankoyamaguchi@gmail.com", area: "山口" },
    { shop_name: "下松にゃんこ", email: "nyanko.kudamatu@gmail.com", area: "山口" },
    { shop_name: "いちご倶楽部～One Night Group～", email: "ichigo.club.yamaguchi@gmail.com", area: "山口" },
    { shop_name: "多恋人倶楽部 宇部店", email: "talentclub.ube@gmail.com", area: "山口" },
    { shop_name: "LOVEろけっと ～イマドキ素人系～", email: "loverocket2025@icloud.com", area: "山口" },
    { shop_name: "山口下関ちゃんこ", email: "s.c5237@outlook.com", area: "山口" },
    { shop_name: "こあくまな熟女たち岩国店", email: "koakuma-group@au.com", area: "山口" },
    { shop_name: "ピーチハニー", email: "peachhoney.yamaguchi@gmail.com", area: "山口" },
    { shop_name: "Club ACE～クラブエース～ 山口店", email: "clubace3111@gmail.com", area: "山口" },
    { shop_name: "OL倶楽部宇部", email: "caclub.ube19@gmail.com", area: "山口" },
    { shop_name: "ぽっちゃりプリンセス", email: "potyapuri@gmail.com", area: "山口" },
    { shop_name: "リンカーン 宇部本店", email: "lincoln@docomo.ne.jp", area: "山口" },
    { shop_name: "S-Cawaii(ｴｽｶﾜ)～宇部S級素人系ﾃﾞﾘﾍﾙ～", email: "s_kawa_s@icloud.com", area: "山口" },
    { shop_name: "Naru～ナル～", email: "naru2025naru@icloud.com", area: "山口" },
    { shop_name: "推しカノ", email: "toshi.360s@gmail.com", area: "山口" },
    { shop_name: "Cos Cos", email: "3cos3cos3@gmail.com", area: "山口" },
    { shop_name: "山口人妻デリヘルフルール", email: "yyyfleur32@gmail.com", area: "山口" },
    { shop_name: "リンカーン 山口支店", email: "lincoln.qjin@gmail.com", area: "山口" },
    { shop_name: "エルメス", email: "hermes6875@icloud.com", area: "山口" },
    { shop_name: "激安～ポッチャリ巨乳専門店～とんとん", email: "tonton.2929@icloud.com", area: "山口" },
    { shop_name: "ラブパコ LOVE PACO", email: "love-9ball-pj@i.softbank.jp", area: "山口" },
    { shop_name: "雫えっちなおくさん-岩国・周南・防府-", email: "h-okusan@ezweb.ne.jp", area: "山口" },
    { shop_name: "SexyRose－セクシーローズ", email: "sexyrose-.-enjoy.yamaguchi@docomo.ne.jp", area: "山口" },
    { shop_name: "山口市湯田ちゃんこ", email: "chankoshankou@gmail.com", area: "山口" },
    { shop_name: "orchis～オルキス～ 米子店", email: "orchis0812.y@gmail.com", area: "鳥取" },
    { shop_name: "〈乱妻〉米子店", email: "yonagoranzuma5010@gmail.com", area: "鳥取" },
    { shop_name: "淫乱秘書室米子店", email: "yonago.hisyo.kyuzin@gmail.com", area: "鳥取" },
    { shop_name: "PRODUCE～プロデュース米子店～", email: "produce.yng@gmail.com", area: "鳥取" },
    { shop_name: "淫乱秘書室鳥取店", email: "olhisyoshitsukyuzin@gmail.com", area: "鳥取" },
    { shop_name: "五十路マダム松江米子店(ｶｻﾌﾞﾗﾝｶG)", email: "shimatori.isoji@gmail.com", area: "鳥取" },
    { shop_name: "Royal SPa", email: "focusyonago1@gmail.com", area: "鳥取" },
    { shop_name: "LUXURY～ラグジュアリー～", email: "y_g_r_0612@ezweb.ne.jp", area: "鳥取" },
    { shop_name: "FILLIA", email: "isaonagata1213@gmail.com", area: "鳥取" },
    { shop_name: "ねいろ", email: "sanin.neiro@gmail.com", area: "鳥取" },
    { shop_name: "ZEBRA（ゼブラ）", email: "sanin.zebra@gmail.com", area: "鳥取" },
    { shop_name: "ORCHIS～オルキス～ 松江", email: "orchis0852@gmail.com", area: "島根" },
    { shop_name: "優月-yuzuki-", email: "yuzuki28668357@gmail.com", area: "島根" },
    { shop_name: "PRODUCE～プロデュース松江店～", email: "produce.matue@gmail.com", area: "島根" },
    { shop_name: "松江 人妻 デリヘル 桃屋", email: "info-matsue@h-momoya.com", area: "島根" },
    { shop_name: "松江デリヘル＜乱妻＞", email: "matsue37837019@gmail.com", area: "島根" },
    { shop_name: "ごちそうさまでした。", email: "gochi64395010@gmail.com", area: "島根" },
    { shop_name: "人妻熱く恋", email: "atsukukoi@gmail.com", area: "島根" },
    { shop_name: "ミラクル愛。。", email: "miracle.5577@icloud.com", area: "香川" },
    { shop_name: "エプロンレディー", email: "apronlady7700@docomo.ne.jp", area: "香川" },
    { shop_name: "秘書と黒パンスト高松店", email: "kyuuzin.kansai@au.com", area: "香川" },
    { shop_name: "善通寺若妻人妻熟女ならｺｺです Tiamo", email: "tiamo0930@softbank.ne.jp", area: "香川" },
    { shop_name: "しろうとcollection～高松店～", email: "collection4610@yahoo.com", area: "香川" },
    { shop_name: "香川高松ちゃんこ", email: "takamatsu.chanko@gmail.com", area: "香川" },
    { shop_name: "サンキュー香川店", email: "thankyou.kagawa@gmail.com", area: "香川" },
    { shop_name: "ラブチャンス", email: "chance00.takamatsu@gmail.com", area: "香川" },
    { shop_name: "中・西讃 ヴィーナス", email: "club.venus.group@gmail.com", area: "香川" },
    { shop_name: "パジャマdeおじゃま", email: "pjm6635@ymail.ne.jp", area: "香川" },
    { shop_name: "Cherie", email: "cherie08029731232@gmail.com", area: "香川" },
    { shop_name: "CLUB ティアラ", email: "corazon0426@icloud.com", area: "香川" },
    { shop_name: "TOP PLACE", email: "takamatsu.t.family@gmail.com", area: "香川" },
    { shop_name: "SCREEN（スクリィーン）", email: "atc2000.221@gmail.com", area: "徳島" },
    { shop_name: "STAR学園", email: "carisuma0401@docomo.ne.jp", area: "徳島" },
    { shop_name: "JOKER", email: "joker13work@gmail.com", area: "徳島" },
    { shop_name: "DEEP LOVE", email: "nishi0827@ezweb.ne.jp", area: "徳島" },
    { shop_name: "F Club エフクラブ", email: "info@club-f.co.jp", area: "徳島" },
    { shop_name: "Replay", email: "replay.tokusima@gmail.com", area: "徳島" },
    { shop_name: "ecstasy", email: "ecstasy2041@gmail.com", area: "徳島" },
    { shop_name: "秘密の人妻倶楽部", email: "tokusima.himitu@gmail.com", area: "徳島" },
    { shop_name: "徳島・秋田鷹匠ちゃんこ", email: "akitatakajyochanko@gmail.com", area: "徳島" },
    { shop_name: "フォルトゥナ-Fortuna-", email: "fortuna.kochi@gmail.com", area: "高知" },
    { shop_name: "「高知」シンデレラ", email: "renraku1182@docomo.ne.jp", area: "高知" },
    { shop_name: "高知ちゃんこ", email: "kochi.chanko@gmail.com", area: "高知" },
    { shop_name: "パンタシア", email: "misakikun801@gmail.com", area: "高知" },
    { shop_name: "いちゃラブ リーズナブルなときめきを", email: "kochi-ichalove@ymobile.ne.jp", area: "高知" },
    { shop_name: "GLOSS MATSUYAMA", email: "mizukigloss0424@gmail.com", area: "愛媛" },
    { shop_name: "Club Dear 松山", email: "ehime@c-dear.com", area: "愛媛" },
    { shop_name: "熟女日和", email: "recruit@jukujobiyori.jp", area: "愛媛" },
    { shop_name: "愛媛松山ちゃんこ", email: "matsuyamachanko@gmail.com", area: "愛媛" },
    { shop_name: "素人専門店ラブリーキス", email: "recruit@lovelykiss.net", area: "愛媛" },
    { shop_name: "クラブエンジェルハート松山今治西条店", email: "club-a.h@ezweb.ne.jp", area: "愛媛" },
    { shop_name: "マリンスノウ・松山・東予店", email: "marine-snow_8817@ezweb.ne.jp", area: "愛媛" },
    { shop_name: "セレブ パラダイス", email: "celeb.2234@ezweb.ne.jp", area: "愛媛" },
    { shop_name: "EXECUTIVE ROSE", email: "exuctive.rose@gmail.com", area: "愛媛" },
    { shop_name: "clubさくら", email: "clubsakura1111@icloud.com", area: "愛媛" },
    { shop_name: "五十路マダム 松山店", email: "madam-m@docomo.ne.jp", area: "愛媛" },
    { shop_name: "MUZERVA WAVE", email: "allstarsgroup.m@gmail.com", area: "愛媛" },
    { shop_name: "人妻愛姫◆Kiaro24時!", email: "kiaro7@au.com", area: "愛媛" },
    { shop_name: "色恋（宇和島）", email: "irokoi1151@gmail.com", area: "愛媛" },
    { shop_name: "ミニスカぷりぷり倶楽部", email: "minipuri-club@ezweb.ne.jp", area: "愛媛" },
    { shop_name: "La mode ラ・モード", email: "lamode@docomo.ne.jp", area: "愛媛" },
    { shop_name: "秘密の逢瀬〇〇妻(西条・東予・今治)", email: "newyork.20091122@gmail.com", area: "愛媛" },
    { shop_name: "奥さま日記（大洲店）", email: "primoimabari@yahoo.co.jp", area: "愛媛" },
    { shop_name: "奥さま日記（今治店）", email: "ozu8990@docomo.ne.jp", area: "愛媛" },
    { shop_name: "ラブステ", email: "o90.4501.o567.1o23@docomo.ne.jp", area: "愛媛" },
    { shop_name: "欲情のよろめき・ポルノⅡ", email: "yoromeki2@gmail.com", area: "愛媛" },
    { shop_name: "新居浜 奥様物語", email: "okumonogatari@ezweb.ne.jp", area: "愛媛" },
    { shop_name: "Hard Style ハードスタイル(新居浜)", email: "hard-s.2013@docomo.ne.jp", area: "愛媛" },
    { shop_name: "華恋～カレン～", email: "karen.niihama@docomo.ne.jp", area: "愛媛" },
    { shop_name: "うれっこ娘フレル", email: "arowana18@icloud.com", area: "愛媛" },
    { shop_name: "F CLUB", email: "fclub.saijo.2004@docomo.ne.jp", area: "愛媛" },
    { shop_name: "大人の隠れ家 大洲店", email: "joy-g@docomo.ne.jp", area: "愛媛" },
    { shop_name: "ピンクコレクション大阪店", email: "dearest@love-work.net", area: "大阪" },
    { shop_name: "シグマグループ大阪", email: "sigmagroupkyujin@gmail.com", area: "大阪" },
    { shop_name: "CASA BIANCA（カーサビアンカ）", email: "fcclass@icloud.com", area: "大阪" },
    { shop_name: "ｸﾗﾌﾞﾌﾞﾚﾝﾀﾞ難波店（ｱｲﾝｽﾞｸﾞﾙｰﾌﾟ）", email: "blenda@recruit-kansai.com", area: "大阪" },
    { shop_name: "プロフィール大阪(ｼｸﾞﾏｸﾞﾙｰﾌﾟ)", email: "info@osaka.pro-file.jp", area: "大阪" },
    { shop_name: "ギャルズネットワーク大阪(ｼｸﾞﾏｸﾞﾙｰﾌﾟ)", email: "info@osaka.galsnetwork.com", area: "大阪" },
    { shop_name: "ｸﾗﾌﾞﾌﾞﾚﾝﾀﾞ梅田北店（ｱｲﾝｽﾞｸﾞﾙｰﾌﾟ）", email: "blenda-umeda@recruit-kansai.com", area: "大阪" },
    { shop_name: "クラブバレンタイン大阪(ｼｸﾞﾏｸﾞﾙｰﾌﾟ)", email: "cvokyujin@gmail.com", area: "大阪" },
    { shop_name: "ドM女学園大阪", email: "recruit.sougou@gmail.com", area: "大阪" },
    { shop_name: "Club NANA", email: "info@osaka-nana.com", area: "大阪" },
    { shop_name: "E+アイドルスクール 大阪・日本橋店", email: "eplus.idol.school.osaka@gmail.com", area: "大阪" },
    { shop_name: "クラブレア堺", email: "sakaigroup8799@gmail.com", area: "大阪" },
    { shop_name: "Linda&Linda(リンダリンダ)大阪", email: "info@lindalinda.jp", area: "大阪" },
    { shop_name: "メルビス＆アトリアーナ", email: "ateliana8@gmail.com", area: "大阪" },
    { shop_name: "義理義理な女学園", email: "kyujin@girigiri-group.com", area: "大阪" },
    { shop_name: "熟女総本店日本橋ミナミエリア店", email: "info@jukujo-souhontenminami.com", area: "大阪" },
    { shop_name: "ﾊﾞｶﾝｽ学園谷九校（ｱｲﾝｽﾞｸﾞﾙｰﾌﾟ）", email: "vacances@recruit-kansai.com", area: "大阪" },
    { shop_name: "ﾉｰﾌﾞﾗで誘惑する奥さん谷九・日本橋店", email: "nobra@recruit-kansai.com", area: "大阪" },
    { shop_name: "人妻セカンドステージ", email: "secondstage41@gmail.com", area: "大阪" },
    { shop_name: "After School", email: "afterschool.jk@gmail.com", area: "大阪" },
    { shop_name: "BLENDA VIP大阪店（アインズグループ）", email: "vip@recruit-kansai.com", area: "大阪" },
    { shop_name: "一夜妻", email: "info@alice-recruit.com", area: "大阪" },
    { shop_name: "素人ぽちゃカワ学園", email: "pothakawa@icloud.com", area: "大阪" },
    { shop_name: "Canx2谷九日本橋店", email: "canx2tanikyuu@gmail.com", area: "大阪" },
    { shop_name: "熟女家グループ", email: "umeda@jukujoya.jp", area: "大阪" },
    { shop_name: "acme（アクメ）", email: "contact@acme-osaka-recruit.com", area: "大阪" },
    { shop_name: "ミセスサマンサPLUS", email: "mrs.samantha.plus@gmail.com", area: "大阪" },
    { shop_name: "熟女総本店堺東店", email: "info@jukujo-souhonten.net", area: "大阪" },
    { shop_name: "エクスタシーPLUS", email: "ecstasy_plus@outlook.jp", area: "大阪" },
    { shop_name: "キラキラ大阪（アインズグループ）", email: "kirakira@recruit-kansai.com", area: "大阪" },
    { shop_name: "アインズグループ", email: "e1ns@recruit-kansai.com", area: "大阪" },
    { shop_name: "ギン妻パラダイスグループ", email: "sakai6955@yahoo.co.jp", area: "大阪" },
    { shop_name: "サマンサ堺店", email: "sakai.ark0101@gmail.com", area: "大阪" },
    { shop_name: "NADIA大阪", email: "info@nadia-umeda.com", area: "大阪" },
    { shop_name: "梅田ムチぽよ女学院", email: "muchipoyo.kyujin@gmail.com", area: "大阪" },
    { shop_name: "YUDEN～油殿～谷九・日本橋店", email: "recruit@yuden-osaka.com", area: "大阪" },
    { shop_name: "club MARIA（アインズグループ）", email: "maria@recruit-kansai.com", area: "大阪" },
    { shop_name: "コマダムアデージョ 堺東店", email: "growup6@docomo.ne.jp", area: "大阪" },
    { shop_name: "39グループ 関西求人部", email: "oosaka3900@gmail.com", area: "大阪" },
    { shop_name: "ﾊﾞｶﾝｽ学園梅田校（ｱｲﾝｽﾞｸﾞﾙｰﾌﾟ）", email: "vacances-umeda@recruit-kansai.com", area: "大阪" },
    { shop_name: "未完の果実", email: "info@mikanokajitu.com", area: "大阪" },
    { shop_name: "ぐっすり山田", email: "job@gussuri-yamada.com", area: "大阪" },
    { shop_name: "大阪枚方八幡ちゃんこ", email: "love39.chanko.hirakata@gmail.com", area: "大阪" },
    { shop_name: "ぽっちゃり女神 あぷろでぃーて", email: "566aphrodita@gmail.com", area: "大阪" },
    { shop_name: "Bianca（ビアンカ）豊中", email: "bianca.toyonaka@gmail.com", area: "大阪" },
    { shop_name: "デザイア日本橋", email: "info@desire-n.com", area: "大阪" },
    { shop_name: "Pinks LAB 大阪", email: "pinks.lab.office@gmail.com", area: "大阪" },
    { shop_name: "アイドル研究所", email: "idol.lab@outlook.jp", area: "大阪" },
    { shop_name: "大阪貴楼館", email: "recruit@osaka.kirokan.com", area: "大阪" },
    { shop_name: "いきなりまかさんかい", email: "hitodumanorakuen@gmail.com", area: "大阪" },
    { shop_name: "ちゃんこりんくう泉佐野", email: "izumisano.chanko@gmail.com", area: "大阪" },
    { shop_name: "CLUB MUTEKI大阪本店", email: "07muteki01@gmail.com", area: "大阪" },
    { shop_name: "MUTEKI LAND大阪店", email: "mutekiland@gmail.com", area: "大阪" },
    { shop_name: "禁断のﾒﾝｽﾞｴｽﾃR-18堺南大阪(CRGｸﾞﾙｰﾌﾟ)", email: "clubrare.recruit@gmail.com", area: "大阪" },
    { shop_name: "プラチナ", email: "saladabar55@gmail.com", area: "大阪" },
    { shop_name: "YUDEN～油殿～堺東店", email: "sakai.recruit@yuden-osaka.com", area: "大阪" },
    { shop_name: "どすけべW痴女倶楽部", email: "dosukebew@gmail.com", area: "大阪" },
    { shop_name: "クラブアイリス大阪", email: "iris-osaka@vipclub-iris.com", area: "大阪" },
    { shop_name: "ROOMiE＋(ルーミープラス)", email: "roomieplus.job@gmail.com", area: "大阪" },
    { shop_name: "Opela －オペラ－", email: "info@opela-r.jp", area: "大阪" },
    { shop_name: "梅田泡洗体ﾊｲﾌﾞﾘｯﾄｴｽﾃ(ﾜﾝﾗｲｽﾞGP)", email: "recruit@umeda-sentai.com", area: "大阪" },
    { shop_name: "ELLE（エル）", email: "oosaka.elle2@gmail.com", area: "大阪" },
    { shop_name: "未熟な人妻", email: "rec@mijyuku.jp", area: "大阪" },
    { shop_name: "非自由人躾専門店 淫姦収容所 日本橋", email: "syuyojyo0201@gmail.com", area: "大阪" },
    { shop_name: "ちゃんこ大阪", email: "sento.kyuzin@gmail.com", area: "大阪" },
    { shop_name: "素人専門デリヘル コンテローゼ", email: "recruit@comterose.jp", area: "大阪" },
    { shop_name: "京橋熟女", email: "info@jukujo-k.com", area: "大阪" },
    { shop_name: "オリーブ", email: "flower-smell@docomo.ne.jp", area: "大阪" },
    { shop_name: "ｷﾞﾝ妻ﾊﾟﾗﾀﾞｲｽ 京橋店(ｷﾞﾝ妻ｸﾞﾙｰﾌﾟ)", email: "gpkybs@gmail.com", area: "大阪" },
    { shop_name: "プルミエールグループ", email: "premiere.entry@gmail.com", area: "大阪" },
    { shop_name: "ジュエリー", email: "jewelry.deli2190@gmail.com", area: "大阪" },
    { shop_name: "豊満奉仕倶楽部", email: "houmanhoushi@gmail.com", area: "大阪" },
    { shop_name: "堺・南大阪泡洗体ﾊｲﾌﾞﾘｯﾄｴｽﾃ(ﾜﾝﾗｲｽﾞGP)", email: "recruit@sakai-sentai.com", area: "大阪" },
    { shop_name: "麗奈OSAKA（レナオオサカ）", email: "recruit@osaka.madam-rena.com", area: "大阪" },
    { shop_name: "Lagna（ラグーナ）", email: "recruit_soft@docomo.ne.jp", area: "大阪" },
    { shop_name: "難波ムチぽよ女学院", email: "muchipoyo.namba@gmail.com", area: "大阪" },
    { shop_name: "奥様電車（関西全駅で待ち合わせ）", email: "info@okudenjob.com", area: "大阪" },
    { shop_name: "クラブ ブレンダ茨木・枚方店", email: "blenda-hokusetu@recruit-kansai.com", area: "大阪" },
    { shop_name: "熟女総本店", email: "info@jukujo-souhonten.com", area: "大阪" },
    { shop_name: "大阪痴女性感フェチ倶楽部(ｽﾀｰｸﾞﾙｰﾌﾟ)", email: "c_osaka_job@star-group.co.jp", area: "大阪" },
    { shop_name: "南大阪デリヘルコレクション", email: "minamiosakadericolle@gmail.com", area: "大阪" },
    { shop_name: "プレジデントオアシス", email: "recruit@oasis1110.jp", area: "大阪" },
    { shop_name: "レッドろまん摂津守口店", email: "bonds19831105@gmail.com", area: "大阪" },
    { shop_name: "Canx2 堺泉大津店", email: "canx2.osaka@gmail.com", area: "大阪" },
    { shop_name: "MocoMoco", email: "mocomoco.job.22@gmail.com", area: "大阪" },
    { shop_name: "テディベア大阪", email: "ossaka.tedhi.recruit@gmail.com", area: "大阪" },
    { shop_name: "レッドろまん枚方店", email: "info@red-roman.com", area: "大阪" },
    { shop_name: "大阪ちゃんこグループ", email: "chank971129@yahoo.co.jp", area: "大阪" },
    { shop_name: "Guilty conceptA", email: "guilty.concept.a@gmail.com", area: "大阪" },
    { shop_name: "OSAKA ESCORT MASSAGE", email: "anikosuanikosu@gmail.com", area: "大阪" },
    { shop_name: "恋色ぱれっと 北大阪店", email: "koipale2025@gmail.com", area: "大阪" },
    { shop_name: "絶対領域！夢の空間~ﾄﾞﾘｰﾑﾌｧﾝﾀｼﾞｰ~", email: "zettairyouikiyumenokukan@gmail.com", area: "大阪" },
    { shop_name: "ACME+", email: "info@yobai-grouprec.jp", area: "大阪" },
    { shop_name: "玉乱堂", email: "kyobashitamarando@docomo.ne.jp", area: "大阪" },
    { shop_name: "SM東京グループ", email: "smtokyo.osaka@gmail.com", area: "大阪" },
    { shop_name: "名門大学物語 大阪校", email: "info@meimondai.com", area: "大阪" },
    { shop_name: "Lady Agent（レディエージェント）", email: "ladyagenttyan@gmail.com", area: "大阪" },
    { shop_name: "変態調教飼育クラブ 梅田店", email: "ponmode@i.softbank.jp", area: "大阪" },
    { shop_name: "ちゃんこ四條畷大東店", email: "shijonawate.chanko@gmail.com", area: "大阪" },
    { shop_name: "MUTEKI人妻倶楽部大阪店", email: "mutekihitodumaclub@gmail.com", area: "大阪" },
    { shop_name: "オーガズム", email: "orgasm.oosaka2021@gmail.com", area: "大阪" },
    { shop_name: "変態調教飼育クラブ 本店", email: "boowy-1224finalx1@docomo.ne.jp", area: "大阪" },
    { shop_name: "THC Osaka", email: "recruit@hentai-osaka.com", area: "大阪" },
    { shop_name: "PLUS 梅田店", email: "umeda@jukujoya-plus.jp", area: "大阪" },
    { shop_name: "Made In Japan", email: "mo3@mij-escorts.jp", area: "大阪" },
    { shop_name: "クレドール大阪", email: "info@cos-doll.jp", area: "大阪" },
    { shop_name: "妻天 十三店", email: "info@osaka-0930.com", area: "大阪" },
    { shop_name: "大阪デリ素人専門 ミセスコンテローゼ", email: "recruit@mrs-comterose.jp", area: "大阪" },
    { shop_name: "高級デリバリーヘルス アンコール", email: "recruit@club-encore.jp", area: "大阪" },
    { shop_name: "PLUS 難波店", email: "nambaplus01@gmail.com", area: "大阪" },
    { shop_name: "快楽園 大阪梅田", email: "kairakuen.osaka@gmail.com", area: "大阪" },
    { shop_name: "六花グループ大阪", email: "mderi-osaka-job@nx-inc.net", area: "大阪" },
    { shop_name: "ガチ妻コレクション", email: "gacicolle0221@gmail.com", area: "大阪" },
    { shop_name: "ガチkawaii", email: "gachi.kawaii.20240221@gmail.com", area: "大阪" },
    { shop_name: "KISEKI", email: "kisekitani9@gmil.com", area: "大阪" },
    { shop_name: "虎の穴×風神会館 難波店", email: "tora.osaka.jp@gmail.com", area: "大阪" },
    { shop_name: "大阪ちゃんこグループ", email: "seikyuusyo.umeda.stellato@gmail.com", area: "大阪" },
    { shop_name: "リアルママ", email: "realmama2011@gmail.com", area: "大阪" },
    { shop_name: "妻天 京橋店", email: "staff8301@yahoo.co.jp", area: "大阪" },
    { shop_name: "人妻が愛人", email: "hitozuma.aijin0888@gmail.com", area: "大阪" },
    { shop_name: "ビギデリ 大阪梅田店", email: "bigideliosaka@gmail.com", area: "大阪" },
    { shop_name: "VIP club belange", email: "vipclubbelange@gmail.com", area: "大阪" },
    { shop_name: "ちゃんこ東大阪 布施・長田店", email: "chanko.fuse@gmail.com", area: "大阪" },
    { shop_name: "艶姫（つやひめ）", email: "tsuyahime@docomo.ne.jp", area: "大阪" },
    { shop_name: "ハニー トラップ", email: "honey.trap.org@gmail.com", area: "大阪" },
    { shop_name: "Kota難波", email: "kotananbaten@gmail.com", area: "大阪" },
    { shop_name: "大阪ぽっちゃりマニア 十三店", email: "info@pochari-mania.net", area: "大阪" },
    { shop_name: "クラブバカラ", email: "info@clubbaccarat.jp", area: "大阪" },
    { shop_name: "大阪摂津茨木ちゃんこ", email: "chankoosaka3150@gmail.com", area: "大阪" },
    { shop_name: "大阪人妻援護会", email: "osaka-engo@kagoya.net", area: "大阪" },
    { shop_name: "熟女家 京橋店", email: "kyobashi@jukujoya.jp", area: "大阪" },
    { shop_name: "完熟ばなな 梅田店", email: "info@osaka-banana.com", area: "大阪" },
    { shop_name: "谷町豊満奉仕倶楽部", email: "tanimachi.jm@gmail.com", area: "大阪" },
    { shop_name: "尼妻十三店", email: "info@amaduma1deri-juso.com", area: "大阪" },
    { shop_name: "大阪ぽっちゃりマニア 谷九店", email: "info@pochari-tani9.net", area: "大阪" },
    { shop_name: "オルゴール 麗しの奥様たち", email: "kyobashi.orgel@gmail.com", area: "大阪" },
    { shop_name: "ただいま難波店", email: "tadaima-namba@ezweb.ne.jp", area: "大阪" },
    { shop_name: "完熟ばなな 谷九店", email: "info@tanikyu-banana.com", area: "大阪" },
    { shop_name: "pretty heaven-osaka-", email: "recruit.girls.p@gmail.com", area: "大阪" },
    { shop_name: "club幻想", email: "fuchiizakaya@gmail.com", area: "大阪" },
    { shop_name: "24グループ", email: "staff130@ezweb.ne.jp", area: "大阪" },
    { shop_name: "八尾藤井寺羽曳野ちゃんこ", email: "chankofujiidera@gmail.com", area: "大阪" },
    { shop_name: "熟女デリヘル女は40から藤井寺店", email: "40fujiidera@gmail.com", area: "大阪" },
    { shop_name: "ｸﾗﾌﾞﾌﾞﾚﾝﾀﾞ奈良店（ｱｲﾝｽﾞｸﾞﾙｰﾌﾟ）", email: "blenda-nara@recruit-kansai.com", area: "大阪" },
    { shop_name: "乳野家", email: "info@chichinoya.com", area: "大阪" },
    { shop_name: "妻天 日本橋店", email: "staff_tiger@yahoo.co.jp", area: "大阪" },
    { shop_name: "美人屋", email: "info@nyoninkan.com", area: "大阪" },
    { shop_name: "ディアクイーンズ", email: "fuzokuqueens@gmail.com", area: "大阪" },
    { shop_name: "c.g.AFTER", email: "cgafter@live.jp", area: "大阪" },
    { shop_name: "妻天 梅田店", email: "umeda2010umeda@yahoo.co.jp", area: "大阪" },
    { shop_name: "有閑婦人＆Diana大阪店", email: "info@yukanfujin.net", area: "大阪" },
    { shop_name: "スプリカンテ", email: "info@suplicante.com", area: "大阪" },
    { shop_name: "新感覚バブみ風俗 MILKYBUNNY", email: "milkybunnyosaka0081@gmail.com", area: "大阪" },
    { shop_name: "妻天尼崎店", email: "h879r@icloud.com", area: "兵庫" },
    { shop_name: "神戸デリヘルクリスタル", email: "head.lemoned@gmail.com", area: "兵庫" },
    { shop_name: "神戸BOOKMARK(ブックマーク)", email: "bookkuuzin@gmail.com", area: "兵庫" },
    { shop_name: "ｸﾗﾌﾞﾌﾞﾚﾝﾀﾞ尼崎店（ｱｲﾝｽﾞｸﾞﾙｰﾌﾟ）", email: "blenda-i@recruit-kansai.com", area: "兵庫" },
    { shop_name: "Ace", email: "acehimeji113@gmail.com", area: "兵庫" },
    { shop_name: "ギャルズネットワーク神戸店", email: "recruit@hyogo.galsnetwork.com", area: "兵庫" },
    { shop_name: "Canx2神戸店", email: "canx2kobe@icloud.com", area: "兵庫" },
    { shop_name: "ﾊﾞｶﾝｽ学園尼崎校（ｱｲﾝｽﾞｸﾞﾙｰﾌﾟ）", email: "vacances-i@recruit-kansai.com", area: "兵庫" },
    { shop_name: "ひと妻ch", email: "hitozumach9999@gmail.com", area: "兵庫" },
    { shop_name: "ﾌﾟﾘﾝｾｽｾﾚｸｼｮﾝ姫路店（ｱｲﾝｽﾞｸﾞﾙｰﾌﾟ）", email: "princess-i@recruit-kansai.com", area: "兵庫" },
    { shop_name: "La Vista（ラビスタ）", email: "myjob7177@gmail.com", area: "兵庫" },
    { shop_name: "ＣＯＣＯグループ", email: "tsuchiyama.naracoco5050@gmail.com", area: "兵庫" },
    { shop_name: "ユナイト人妻熟女姫路店", email: "i3a1636@icloud.com", area: "兵庫" },
    { shop_name: "CLASSY.神戸", email: "classykobe@outlook.jp", area: "兵庫" },
    { shop_name: "姫路東熟女・美少女ならココ", email: "kaibigan0707@icloud.com", area: "兵庫" },
    { shop_name: "姫路マダム大奥", email: "himejimadamu.oooku@gmail.com", area: "兵庫" },
    { shop_name: "五十路マダム 姫路店", email: "himecasajo@docomo.ne.jp", area: "兵庫" },
    { shop_name: "神戸泡洗体ﾊｲﾌﾞﾘｯﾄｴｽﾃ(ﾜﾝﾗｲｽﾞGP)", email: "recruit@kobe-hybrid.com", area: "兵庫" },
    { shop_name: "尼妻十三店", email: "info@emu-wan.com", area: "兵庫" },
    { shop_name: "CLUB ONE 神戸店(ﾜﾝﾗｲｽﾞGP)", email: "recruit@ko-be-one.com", area: "兵庫" },
    { shop_name: "巨乳・ぽっちゃり専門店 蒼いうさぎ", email: "aoiusagi3580@gmail.com", area: "兵庫" },
    { shop_name: "セクシャル", email: "rhy1025rhy@gmail.com", area: "兵庫" },
    { shop_name: "Body Specia1～ボディスペシャル～", email: "body7special@gmail.com", area: "兵庫" },
    { shop_name: "加古川人妻リゾート", email: "hitoduma.resort@softbank.ne.jp", area: "兵庫" },
    { shop_name: "熟女総本店グループ", email: "info@jukujo-souhonten-ama.com", area: "兵庫" },
    { shop_name: "神戸REDDRAGON", email: "kobe.recruitnavi@gmail.com", area: "兵庫" },
    { shop_name: "おもてなし妻", email: "kobe.omt06@gmail.com", area: "兵庫" },
    { shop_name: "Canx2 R40神戸店", email: "canx2r40@gmail.com", area: "兵庫" },
    { shop_name: "神戸ぽっちゃりTIGER", email: "p.tiger.kobe01@gmail.com", area: "兵庫" },
    { shop_name: "XOXO Hug&Kiss 神戸店", email: "redsnake0318@icloud.com", area: "兵庫" },
    { shop_name: "麗奈KOBE(レナコウベ)", email: "recruit@kobe.madam-rena.com", area: "兵庫" },
    { shop_name: "S", email: "info@kobe-s.com", area: "兵庫" },
    { shop_name: "伊川谷熟女・美少女ならココ！", email: "shibekani14@gmail.com", area: "兵庫" },
    { shop_name: "兵庫加東小野ちゃんこ", email: "midori052505250525@yahoo.co.jp", area: "兵庫" },
    { shop_name: "プラチナ姫路", email: "platina-himeji@ezweb.ne.jp", area: "兵庫" },
    { shop_name: "MiYAKO", email: "kobemiyako0385@gmail.com", area: "兵庫" },
    { shop_name: "人妻です", email: "kobe.hitozuma-des@softbank.ne.jp", area: "兵庫" },
    { shop_name: "Clover", email: "clover.akashi113@gmail.com", area: "兵庫" },
    { shop_name: "Candy Smile", email: "candysmile.himeji@gmail.com", area: "兵庫" },
    { shop_name: "美しい大人の女性&乙女専門店!花さくら", email: "kakogawa.hime@gmail.com", area: "兵庫" },
    { shop_name: "兵庫西宮尼崎ちゃんこ", email: "nisinochanko2641@gmail.com", area: "兵庫" },
    { shop_name: "神戸FOXY", email: "seiwa-foxy@docomo.ne.jp", area: "兵庫" },
    { shop_name: "豊岡不倫倶楽部", email: "info@toyooka-furin.com", area: "兵庫" },
    { shop_name: "ちゃんこ神戸三宮店", email: "chanko.kobe@gmail.com", area: "兵庫" },
    { shop_name: "エルミタージュ", email: "2016hermitage@gmail.com", area: "兵庫" },
    { shop_name: "神戸痴女性感フェチ倶楽部", email: "c_kobe_job@star-group.co.jp", area: "兵庫" },
    { shop_name: "姫路東10,000円ポッキー", email: "pokki.himejihigashi@gmail.com", area: "兵庫" },
    { shop_name: "シャブール", email: "info@shaboole.com", area: "兵庫" },
    { shop_name: "姫路手柄10,000円ポッキー", email: "himejitegara10000enpokii@docomo.ne.jp", area: "兵庫" },
    { shop_name: "人妻楼 神戸店", email: "info@hitoduma-koube.net", area: "兵庫" },
    { shop_name: "加古川10,000円ポッキー", email: "ka10000en-pokki@docomo.ne.jp", area: "兵庫" },
    { shop_name: "兵庫姫路・加古川ちゃんこ", email: "himejichanko@gmail.com", area: "兵庫" },
    { shop_name: "ぽっちゃり専門ぽちゃぱい明石/神戸西", email: "pochahime1@icloud.com", area: "兵庫" },
    { shop_name: "兵庫明石 ちゃんこ", email: "hyougoakasiasagiripirocyanko@gmail.com", area: "兵庫" },
    { shop_name: "club lucina", email: "lucina@deriheru-koube.com", area: "兵庫" },
    { shop_name: "COCO GROUP", email: "tsuchiyama.naracoco@docomo.ne.jp", area: "兵庫" },
    { shop_name: "セレブな奥様", email: "celeoku@softbank.ne.jp", area: "兵庫" },
    { shop_name: "夙川人妻倶楽部", email: "shuku8121@gmail.com", area: "兵庫" },
    { shop_name: "五十路マダム 神戸店", email: "koube.isoji@gmail.com", area: "兵庫" },
    { shop_name: "完熟ばなな 神戸・三宮店", email: "info@sannomiya-banana.com", area: "兵庫" },
    { shop_name: "ばすた～ず京都", email: "doemu.kyoto@gmail.com", area: "京都" },
    { shop_name: "ギャルズネットワークネクスト 京都", email: "info@kyoto.galsnetwork.com", area: "京都" },
    { shop_name: "JEWELグループ", email: "kyotojewel2022@gmail.com", area: "京都" },
    { shop_name: "めっちゃスイスク京都", email: "metchaswischkyoto@gmail.com", area: "京都" },
    { shop_name: "Canx2京都店", email: "spum6-gatapiiiiin-bsk4@au.com", area: "京都" },
    { shop_name: "京都美女図鑑-LUXE-", email: "kyoutobijyo1010@gmail.com", area: "京都" },
    { shop_name: "ドMな奥様 京都店", email: "doemuokukyoto@gmail.com", area: "京都" },
    { shop_name: "BEPPIN SELECTION 京都店", email: "support@be-ppin.com", area: "京都" },
    { shop_name: "ゆるふわKISS", email: "yurufuwakiss@gmail.com", area: "京都" },
    { shop_name: "ピンキープリンセス", email: "kyoto.pinky@gmail.com", area: "京都" },
    { shop_name: "京都泡洗体ﾊｲﾌﾞﾘｯﾄﾞｴｽﾃ(ﾜﾝﾗｲｽﾞGP)", email: "recruit@kyoto-sentai.com", area: "京都" },
    { shop_name: "京都デリヘル倶楽部", email: "kyotodcpgroup@gmail.com", area: "京都" },
    { shop_name: "エテルナ", email: "recruit@deli-eterna.com", area: "京都" },
    { shop_name: "ZERO STYLE(ゼロスタイル)", email: "stylekyujin01@gmail.com", area: "京都" },
    { shop_name: "デリヘルラボ・クレージュ極", email: "delilab.crg@gmail.com", area: "京都" },
    { shop_name: "五十路ﾏﾀﾞﾑｴｸｽﾌﾟﾚｽ京都店(ｶｻﾌﾞﾗﾝｶG)", email: "info.kyotoisoji@casa-g.info", area: "京都" },
    { shop_name: "京都痴女性感フェチ倶楽部(ｽﾀｰｸﾞﾙｰﾌﾟ)", email: "c_kyoto_job@star-group.co.jp", area: "京都" },
    { shop_name: "麗奈KYOTO（レナキョウト）", email: "recruit@kyoto.madam-rena.com", area: "京都" },
    { shop_name: "京都右京・沓掛インターちゃんこ", email: "kutsukake.chanko@gmail.com", area: "京都" },
    { shop_name: "Canx2女学院 京都校", email: "canx2girls.college@gmail.com", area: "京都" },
    { shop_name: "コンプレックス", email: "recruit@kyoto-complex.com", area: "京都" },
    { shop_name: "CREA（クレア）京都", email: "toki6485@gmail.com", area: "京都" },
    { shop_name: "テディーベア京都", email: "teddybear.kyoto.recruit@gmail.com", area: "京都" },
    { shop_name: "fuber LADY", email: "fuber.lady@gmail.com", area: "京都" },
    { shop_name: "prettyキャンパス京都校", email: "sirosta.com@gmail.com", area: "京都" },
    { shop_name: "エルモア", email: "elmore.kyoto@gmail.com", area: "京都" },
    { shop_name: "京都祇園ちゃんこ", email: "kyotogioncyanko@gmail.com", area: "京都" },
    { shop_name: "とろとろ学園", email: "k3.jp@icloud.com", area: "京都" },
    { shop_name: "プルデリR40", email: "purupurur40@gmail.com", area: "京都" },
    { shop_name: "マタニティぼにゅう大好き京都店", email: "kyotomaternity001@gmail.com", area: "京都" },
    { shop_name: "ただいま 京都店", email: "kyoto.tadaima.1016@icloud.com", area: "京都" },
    { shop_name: "JapanEscort Erotic Massageclub kyoto", email: "k_kyo_global@star-group.co.jp", area: "京都" },
    { shop_name: "isai～愛妻～", email: "isai.shiga@gmail.com", area: "滋賀" },
    { shop_name: "エテルナ滋賀店", email: "recruit@shiga-eterna.com", area: "滋賀" },
    { shop_name: "エテルナ彦根", email: "recruit@hikone-eterna.com", area: "滋賀" },
    { shop_name: "じゃむじゃむ 滋賀店", email: "nettosutaffu@gmail.com", area: "滋賀" },
    { shop_name: "De愛急行 栗東インター店", email: "ritto@deai-kyukou.com", area: "滋賀" },
    { shop_name: "グランドオペラ 名古屋", email: "recruit@g-opera.com", area: "滋賀" },
    { shop_name: "GAL☆PARADISE彦根店", email: "rifure1515@gmail.com", area: "滋賀" },
    { shop_name: "ミルキーウェイ", email: "an.asaka@ezweb.ne.jp", area: "滋賀" },
    { shop_name: "滋賀彦根ちゃんこ", email: "hikone.chanko@gmail.com", area: "滋賀" },
    { shop_name: "Peach～ピーチ～", email: "peach2@zb.ztv.ne.jp", area: "滋賀" },
    { shop_name: "滋賀守山大津ちゃんこ", email: "moriyamaotsuchanko@gmail.com", area: "滋賀" },
    { shop_name: "ピンキーエコ", email: "it.uemura0901@gmail.com", area: "奈良" },
    { shop_name: "未熟な若奥", email: "seiha1231@gmail.com", area: "奈良" },
    { shop_name: "大和ナデシコ グループ（奈良）", email: "mail@nadesiko6116.com", area: "奈良" },
    { shop_name: "NADIA奈良", email: "nadia.nara0742@gmail.com", area: "奈良" },
    { shop_name: "カレングループ", email: "karen.group.nara@gmail.com", area: "奈良" },
    { shop_name: "ただ離婚してないだけ奈良店", email: "recruit@tadarikon.com", area: "奈良" },
    { shop_name: "KAIJI（カイジ）", email: "gwmpdtp@gmail.com", area: "奈良" },
    { shop_name: "iris~アイリス~", email: "irisnara2000@gmail.com", area: "奈良" },
    { shop_name: "恋のうた", email: "koinouta1151@gmail.com", area: "奈良" },
    { shop_name: "奈良市ちゃんこ", email: "naraekichanko@gmail.com", area: "奈良" },
    { shop_name: "MUTEKI 人妻倶楽部 奈良店", email: "mutekihitodumaclubnara@gmail.com", area: "奈良" },
    { shop_name: "他人の嫁", email: "hitono_yome001@yahoo.co.jp", area: "奈良" },
    { shop_name: "隣の奥様＆隣の熟女 奈良店", email: "otonari.naraten@gmail.com", area: "奈良" },
    { shop_name: "MUTEKI LAND 奈良", email: "mutekilandnara@gmail.com", area: "奈良" },
    { shop_name: "他人の嫁 奈良市店", email: "hitono_yome002@yahoo.co.jp", area: "奈良" },
    { shop_name: "奈良橿原大和高田ちゃんこ", email: "kashihara.chanko@gmail.com", area: "奈良" },
    { shop_name: "CURE", email: "cure.cure.nara@gmail.com", area: "奈良" },
    { shop_name: "Therapist COMPLEX", email: "smsgr.info@gmail.com", area: "奈良" },
    { shop_name: "PINK PLANET", email: "gingadan2023@gmail.com", area: "和歌山" },
    { shop_name: "ミセスサマンサ", email: "samanthagroup8657@gmail.com", area: "和歌山" },
    { shop_name: "サマンサ和歌山", email: "w.samantha8657@gmail.com", area: "和歌山" },
    { shop_name: "ｷﾞﾝ妻ﾊﾟﾗﾀﾞｲｽ 和歌山店(ｷﾞﾝ妻ｸﾞﾙｰﾌﾟ)", email: "gpwk999@yahoo.co.jp", area: "和歌山" },
    { shop_name: "恋色", email: "koiiro6263@gmail.com", area: "和歌山" },
    { shop_name: "和歌山ちゃんこ", email: "wakayamachanko777@gmail.com", area: "和歌山" },
    { shop_name: "クラブフェラーリ", email: "club.ferrari@docomo.ne.jp", area: "和歌山" },
    { shop_name: "五十路マダム 和歌山店(カサブランカG)", email: "m.kinki.isoji@gmail.com", area: "和歌山" },
    { shop_name: "Jade Pure（ジェイド・ピュア）", email: "jadepure9@gmail.com", area: "和歌山" },
    { shop_name: "ZERO 和歌山店", email: "z08066071020@gmal.com", area: "和歌山" },
    { shop_name: "2ndMARO", email: "takeuchi.yo22@outlook.jp", area: "和歌山" },
    { shop_name: "エロエロ星人 本店", email: "r-va@eroero-s.jp", area: "愛知" },
    { shop_name: "やまとなでしこ", email: "r-va@mrs-nadeshiko.jp", area: "愛知" },
    { shop_name: "ダイスキ", email: "info.dsk@dskgrp.jp", area: "愛知" },
    { shop_name: "でりどす", email: "plaisant.group@gmail.com", area: "愛知" },
    { shop_name: "ガーデン -人妻ダイスキ-", email: "info.gdn@dskgrp.jp", area: "愛知" },
    { shop_name: "クラブ アイリス名古屋", email: "iris-nagoya@vipclub-iris.com", area: "愛知" },
    { shop_name: "ドMバスターズ岡崎・安城・豊田店", email: "dmkyujin@gmail.com", area: "愛知" },
    { shop_name: "ファイナル東京グループ", email: "ftokyo@docomo.ne.jp", area: "愛知" },
    { shop_name: "ドルチェ", email: "d.o.l.c.e6569@gmail.com", area: "愛知" },
    { shop_name: "エロエロ星人 豊橋", email: "recruit@es-toyohashi.jp", area: "愛知" },
    { shop_name: "エフルラージュ 大曽根店", email: "o-efl@ymail.ne.jp", area: "愛知" },
    { shop_name: "妹CLUB 萌えリーンのお部屋", email: "moereen.girls@gmail.com", area: "愛知" },
    { shop_name: "じゃむじゃむ", email: "tutumi1989@gmail.com", area: "愛知" },
    { shop_name: "アリス女学院 名古屋校", email: "info@derakawa.jp", area: "愛知" },
    { shop_name: "人妻セレブ宮殿", email: "kyuden1101@gmail.com", area: "愛知" },
    { shop_name: "でりどす岡崎", email: "deidos.happywork@gmail.com", area: "愛知" },
    { shop_name: "ワンカラット", email: "info@n-1ct.com", area: "愛知" },
    { shop_name: "E+名古屋(E+グループ)", email: "recruit.nagoya@icloud.com", area: "愛知" },
    { shop_name: "はぁとぶる", email: "heartbul1101@gmail.com", area: "愛知" },
    { shop_name: "ピーチルパイン", email: "yuuuuzo@icloud.com", area: "愛知" },
    { shop_name: "やまとなでしこ豊橋店", email: "recruit@yn-toyohashi.jp", area: "愛知" },
    { shop_name: "奥鉄オクテツ東海店", email: "info-tokai@dh2020.jp", area: "愛知" },
    { shop_name: "フェアリーテイル", email: "s.fairytail.n@gmail.com", area: "愛知" },
    { shop_name: "ドルチェ 一宮店", email: "dolceichinomiya2024@gmail.com", area: "愛知" },
    { shop_name: "MELT☆UP-メルト・アップ-名古屋", email: "mbg.group.info@gmail.com", area: "愛知" },
    { shop_name: "GRAND STAGE 本店", email: "gskyuujin@gmail.com", area: "愛知" },
    { shop_name: "愛らぶ名古屋本店", email: "lovegaku1001@gmail.com", area: "愛知" },
    { shop_name: "淫乱OL派遣商社 斉藤商事", email: "office3110.758@gmail.com", area: "愛知" },
    { shop_name: "ぐっすり山田 名古屋店", email: "g_nagoya_job@star-group.co.jp", area: "愛知" },
    { shop_name: "ナディア名古屋", email: "nadia.nagoya.s@gmail.com", area: "愛知" },
    { shop_name: "CLUB SELENE deux", email: "clubslene.deux@gmail.com", area: "愛知" },
    { shop_name: "倶楽部 月兎", email: "info@tsukito-nagoya.com", area: "愛知" },
    { shop_name: "HERMITAGE（エルミタージュ）", email: "hermitage7884@outlook.jp", area: "愛知" },
    { shop_name: "名古屋痴女性感フェチ倶楽部", email: "c_nagoya_job@star-group.co.jp", area: "愛知" },
    { shop_name: "JKサークル", email: "b.production.kyuujin@gmail.com", area: "愛知" },
    { shop_name: "ギャルズパラダイス", email: "go.go.088@icloud.com", area: "愛知" },
    { shop_name: "こあくまな熟女たち三河店", email: "recruit_girls_kg@koakumagroup.com", area: "愛知" },
    { shop_name: "愛夫人 西三河店", email: "arrows.aichi@softbank.ne.jp", area: "愛知" },
    { shop_name: "WBC～ウエストBIGキュート～", email: "sokupaku@gmail.com", area: "愛知" },
    { shop_name: "リメイク", email: "y7k1hqih7tz0e9vxvjwz@docomo.ne.jp", area: "愛知" },
    { shop_name: "熟年カップル名古屋", email: "recruit-jn@nnb.jp", area: "愛知" },
    { shop_name: "元祖ぽちゃカワ倶楽部", email: "ladies-support@i.softbank.jp", area: "愛知" },
    { shop_name: "熟女の風俗アウトレット 大高・大府店", email: "outlet.oodakaoobu@gmail.com", area: "愛知" },
    { shop_name: "デリ活 - マッチングデリヘル", email: "rct@derikatu.jp", area: "愛知" },
    { shop_name: "麗奈NAGOYA", email: "recruit@nagoya.madam-rena.com", area: "愛知" },
    { shop_name: "Reposer(ルポゼ)", email: "reposer@g-f-k.com", area: "愛知" },
    { shop_name: "愛知三河安城岡崎ちゃんこ", email: "chankomikawa@gmail.com", area: "愛知" },
    { shop_name: "メンエスプラス", email: "ruf62vip@docomo.ne.jp", area: "愛知" },
    { shop_name: "即アポ奥さん～名古屋店～", email: "recruit-o@aporu.com", area: "愛知" },
    { shop_name: "性腺熟女100％名古屋店", email: "info-okujuku@dh2020.jp", area: "愛知" },
    { shop_name: "ちょっとイキぬき", email: "22nekonote@gmail.com", area: "愛知" },
    { shop_name: "アイドルヘルス キミ☆プロ 名古屋店", email: "info@kimipro-nagoya.jp", area: "愛知" },
    { shop_name: "ぽちゃカワ専門店 マシュマロ", email: "09086706298@docomo.ne.jp", area: "愛知" },
    { shop_name: "ふれんど", email: "luxueux.friend@gmail.com", area: "愛知" },
    { shop_name: "IRIS一宮", email: "irisgroup.job@docomo.ne.jp", area: "愛知" },
    { shop_name: "名古屋貴楼館", email: "recruit@nagoyakirokan.com", area: "愛知" },
    { shop_name: "名古屋覚醒痴女倶楽部", email: "chijoclub.official@gmail.com", area: "愛知" },
    { shop_name: "熟女の風俗アウトレット一宮小牧", email: "outlet.1nomiya@gmail.com", area: "愛知" },
    { shop_name: "愛知豊田みよしちゃんこ", email: "chankotoyota@gmail.com", area: "愛知" },
    { shop_name: "サンキュー名古屋店", email: "nagoya.thankyou@gmail.com", area: "愛知" },
    { shop_name: "もしもし亀よ亀さんよ 名古屋店", email: "moshikame.nagoya@gmail.com", area: "愛知" },
    { shop_name: "愛知半田常滑ちゃんこ", email: "hantokochanko@gmail.com", area: "愛知" },
    { shop_name: "BBW 名古屋店", email: "info@nagoya-bbw.net", area: "愛知" },
    { shop_name: "熟女倶楽部 林檎", email: "apple50601130@gmail.com", area: "愛知" },
    { shop_name: "みにすか名古屋本店", email: "minisuka0401@gmail.com", area: "愛知" },
    { shop_name: "おふくろさん 名古屋本店", email: "ofukurosan1130@gmail.com", area: "愛知" },
    { shop_name: "ラブココ名古屋本店", email: "lc.gp@docomo.ne.jp", area: "愛知" },
    { shop_name: "一宮稲沢小牧ちゃんこ", email: "chanko.1nomiya@gmail.com", area: "愛知" },
    { shop_name: "巨乳&貧乳&美乳 Honey&Spice", email: "09058652708@docomo.ne.jp", area: "愛知" },
    { shop_name: "エフルラージュ 錦", email: "efl_nishiki_0120655448@yahoo.co.jp", area: "愛知" },
    { shop_name: "AVANCE 一宮", email: "avance_i@yahoo.co.jp", area: "愛知" },
    { shop_name: "ぽちゃ猫三河店", email: "pocchanekomikawa@gmail.com", area: "愛知" },
    { shop_name: "cocotteーココットー", email: "cocotte09030455510@gmail.com", area: "愛知" },
    { shop_name: "涼泉", email: "levichi2000@gmail.com", area: "愛知" },
    { shop_name: "逢って30秒で即尺", email: "kyujin@soku30.com", area: "愛知" },
    { shop_name: "五十路マダムEX豊橋店（ｶｻﾌﾞﾗﾝｶG）", email: "toyoiso@au.com", area: "愛知" },
    { shop_name: "きらめき奥さん 三河店", email: "s-h.treasure@au.com", area: "愛知" },
    { shop_name: "P-STYLE", email: "pstyle080@gmail.com", area: "愛知" },
    { shop_name: "岡崎デリヘルコレクション", email: "okazakidericore@gmail.com", area: "愛知" },
    { shop_name: "豊橋POISON", email: "recruit.toyohashi@gmail.com", area: "愛知" },
    { shop_name: "aa east", email: "z63bc85e72erfh@softbank.ne.jp", area: "愛知" },
    { shop_name: "さくらん 人妻Secret Service", email: "secret.honten@gmail.com", area: "愛知" },
    { shop_name: "PERO PERO NINE", email: "katoyu120101@gmail.com", area: "愛知" },
    { shop_name: "激安!巨乳&ぽちゃカワ専門ﾏｰﾒｲﾄﾞin一宮", email: "malias-group@softbank.ne.jp", area: "愛知" },
    { shop_name: "名古屋デリヘル GOLDニット", email: "moederi758@gmail.com", area: "愛知" },
    { shop_name: "大高・大府市・東海市ちゃんこ", email: "obu.chanko@gmail.com", area: "愛知" },
    { shop_name: "ラブココ一宮店", email: "lvcc0701@gmail.com", area: "愛知" },
    { shop_name: "性熟カップル～60代からの営み～", email: "seijuku6070@gmail.com", area: "愛知" },
    { shop_name: "豊橋豊川ちゃんこ", email: "toyohashichanko@gmail.com", area: "愛知" },
    { shop_name: "即アポ奥さん三河FC店", email: "job-mikawa@aporu.com", area: "愛知" },
    { shop_name: "熟専30’S40’S50’S 三河本店", email: "white07210721@icloud.com", area: "愛知" },
    { shop_name: "母乳・妊婦専門 LOVE LIFE", email: "lovelife2525@yahoo.co.jp", area: "愛知" },
    { shop_name: "熟女の風俗最終章 名古屋店", email: "nagoya.recruit2023@gmail.com", area: "愛知" },
    { shop_name: "旦那さん～今日はお疲れですか～", email: "dannasan1130@gmail.com", area: "愛知" },
    { shop_name: "はむはむしょこら", email: "shokora8686@icloud.com", area: "愛知" },
    { shop_name: "名古屋熟女デリやみつき", email: "nagoya8329@gmail.com", area: "愛知" },
    { shop_name: "AVANCE 岡崎", email: "okazaki.avance@gmail.com", area: "愛知" },
    { shop_name: "でり王", email: "skigroup@i.softbank.jp", area: "愛知" },
    { shop_name: "ふわらぶ", email: "fuwarabu@gmail.com", area: "愛知" },
    { shop_name: "紳士クラブ", email: "inoryuu@icloud.com", area: "愛知" },
    { shop_name: "ニューデリー", email: "ndgp1980@gmail.com", area: "愛知" },
    { shop_name: "名古屋デッドボール", email: "nagoya.dead51@gmail.com", area: "愛知" },
    { shop_name: "LUANA ROYAL", email: "luanaroyal.shizuoka@gmail.com", area: "静岡" },
    { shop_name: "静岡ワンナイト", email: "shizudeli.onenight1@gmail.com", area: "静岡" },
    { shop_name: "サンキュー沼津店(サンキューグループ)", email: "shizuokanumazu39@gmail.com", area: "静岡" },
    { shop_name: "ハンパじゃない伝説～静岡校", email: "shizuoka.hanpa@gmail.com", area: "静岡" },
    { shop_name: "Rouge-ルージュ-", email: "rouge-fuji@docomo.ne.jp", area: "静岡" },
    { shop_name: "Pine－パイン－", email: "k.09070254079@gmail.com", area: "静岡" },
    { shop_name: "静岡駅前ちゃんこ", email: "s.e.c.kyuujinn@gmail.com", area: "静岡" },
    { shop_name: "浜松ハンパじゃない学園", email: "delidelijp@gmail.com", area: "静岡" },
    { shop_name: "プリティ2", email: "pretty2.dh@gmail.com", area: "静岡" },
    { shop_name: "熟女の風俗最終章 沼津店", email: "chapter0.nmz@gmail.com", area: "静岡" },
    { shop_name: "沼津人妻花壇（モアグループ）", email: "ju-recruit@more-g.jp", area: "静岡" },
    { shop_name: "女の子の事だけ考えて店創ってみました", email: "mochizuki0024@i.softbank.jp", area: "静岡" },
    { shop_name: "沼津 ハンパじゃない東京", email: "hanpa.tokyo@gmail.com", area: "静岡" },
    { shop_name: "＆Essence", email: "2123essence@gmail.com", area: "静岡" },
    { shop_name: "ほんつま 沼津店", email: "info@hontsuma-numazu.com", area: "静岡" },
    { shop_name: "LUXURIA（ルクスリア）", email: "luxuria14196789@gmail.com", area: "静岡" },
    { shop_name: "Eternal エターナル", email: "angy219@icloud.com", area: "静岡" },
    { shop_name: "Sugar-シュガー-静岡店", email: "sugar202304@gmail.com", area: "静岡" },
    { shop_name: "静岡FINAL STAGE", email: "finalstageshizuoka@yahoo.co.jp", area: "静岡" },
    { shop_name: "奥さまCafe", email: "girl@okusama-cafe.com", area: "静岡" },
    { shop_name: "ぴちゃぴちゃローションおふろ", email: "11pichapicha@gmail.com", area: "静岡" },
    { shop_name: "浜松POISON", email: "recruit@poison-girl.jp", area: "静岡" },
    { shop_name: "浜松人妻なでしこ(ｶｻﾌﾞﾗﾝｶｸﾞﾙｰﾌﾟ)", email: "hamanade@docomo.ne.jp", area: "静岡" },
    { shop_name: "Diana-ダイアナ-", email: "jin.group.20170707@gmail.com", area: "静岡" },
    { shop_name: "Tiara-ティアラ-", email: "dhtiaran@gmail.com", area: "静岡" },
    { shop_name: "Aya-絢", email: "job-aya@ezweb.ne.jp", area: "静岡" },
    { shop_name: "恋するセレブ", email: "koic4120@gmail.com", area: "静岡" },
    { shop_name: "Club Lafestaークラブ ラフェスター", email: "fuji-lafesta@docomo.ne.jp", area: "静岡" },
    { shop_name: "LALA-浜松人妻health-", email: "lala.xxx.recruitment@gmail.com", area: "静岡" },
    { shop_name: "いちゃぷよ★ポッチャdoll［中部店］", email: "master.shizuoka@pottya-doll.jp", area: "静岡" },
    { shop_name: "五十路マダム浜松店（カサブランカG）", email: "hamaiso@docomo.ne.jp", area: "静岡" },
    { shop_name: "ドルチェ", email: "d.gp.9532@gmail.com", area: "静岡" },
    { shop_name: "素人人妻専門店 浜松人妻援護会", email: "hamamatsu-engo@celery.ocn.ne.jp", area: "静岡" },
    { shop_name: "カクテル静岡駅前店", email: "cocktail.shizuoka@gmail.com", area: "静岡" },
    { shop_name: "RGグループ", email: "regalo.numazu@gmail.com", area: "静岡" },
    { shop_name: "本格ｱﾛﾏｴｽﾃ ｻﾛﾝ･ﾄﾞ･ﾃｨｱﾗ 浜松店", email: "salon.de.tiara@heart.ocn.ne.jp", area: "静岡" },
    { shop_name: "masaje～マサージュ～", email: "masaje.numazu@gmail.com", area: "静岡" },
    { shop_name: "厚木人妻城（モアグループ）", email: "g4-kyuzin@more-g.jp", area: "静岡" },
    { shop_name: "はいからさん", email: "haikarasangroup@gmail.com", area: "静岡" },
    { shop_name: "Venus", email: "girl@venus-deli.com", area: "静岡" },
    { shop_name: "静岡☆祭妻", email: "shizuokaes@icloud.com", area: "静岡" },
    { shop_name: "王冠-CROWN-", email: "shizudeli.crown@gmail.com", area: "静岡" },
    { shop_name: "五十路マダム沼津店（ｶｻﾌﾞﾗﾝｶｸﾞﾙｰﾌﾟ）", email: "numaiso0314@au.com", area: "静岡" },
    { shop_name: "るっきんぐらぶ", email: "s.room@softbank.ne.jp", area: "静岡" },
    { shop_name: "五十路マダム静岡店（ｶｻﾌﾞﾗﾝｶｸﾞﾙｰﾌﾟ）", email: "shizuiso@docomo.ne.jp", area: "静岡" },
    { shop_name: "Luminous ルミナス", email: "buchi.1228.r@gmail.com", area: "静岡" },
    { shop_name: "静岡人妻教室", email: "uketsuke2024@gmail.com", area: "静岡" },
    { shop_name: "浜松痴女性感フェチ倶楽部", email: "c_hamamatsu_job@star-group.co.jp", area: "静岡" },
    { shop_name: "ジェラシー", email: "jealousy1020@softbank.ne.jp", area: "静岡" },
    { shop_name: "ピーチパイ", email: "peach-pai@docomo.ne.jp", area: "静岡" },
    { shop_name: "浜松駅前ちゃんこ", email: "gurumecityegogo@yahoo.co.jp", area: "静岡" },
    { shop_name: "JIN.GROUP（ジングループ）", email: "shizuoka.j.group@gmail.com", area: "静岡" },
    { shop_name: "素人・人妻 SHIRAYURI（しらゆり）", email: "shirayuri.321@gmail.com", area: "静岡" },
    { shop_name: "CLASSY.四日市店", email: "recruit@y-classy.com", area: "三重" },
    { shop_name: "隣の奥様＆熟女四日市店", email: "ma.1988.aki@gmail.com", area: "三重" },
    { shop_name: "DIE-SEL おーるじゃんる", email: "pd24ysmi3d@i.softbank.jp", area: "三重" },
    { shop_name: "Secret Service 四日市店", email: "ss.yokkaichiten@gmail.com", area: "三重" },
    { shop_name: "愛のしずく四日市店", email: "ainoshizuku.yokkaichi@gmail.com", area: "三重" },
    { shop_name: "清楚系美女PLATINUMプラチナム", email: "platinum.mie.staff@gmail.com", area: "三重" },
    { shop_name: "デリヘル選びは delivago", email: "mieken.fy@gmail.com", area: "三重" },
    { shop_name: "ZERO", email: "sanz.zero9229@gmail.com", area: "三重" },
    { shop_name: "三重四日市ちゃんこ", email: "chanko5511@gmail.com", area: "三重" },
    { shop_name: "三重松阪ちゃんこ", email: "matsusaka.chanko@gmail.com", area: "三重" },
    { shop_name: "M2三重店", email: "m2mieten@gmail.com", area: "三重" },
    { shop_name: "五十路マダム 三重松阪店", email: "isoji.matsu@gmail.com", area: "三重" },
    { shop_name: "即アポ奥さん～津・松阪店～", email: "recruit-m@aporu.com", area: "三重" },
    { shop_name: "極嬢S&M 松阪店", email: "hunwarikanojo@gmail.com", area: "三重" },
    { shop_name: "即アポ奥さん～四日市・鈴鹿店～", email: "recruit-yok@aporu.com", area: "三重" },
    { shop_name: "COLOR松阪店", email: "recruit@color-matsusaka.com", area: "三重" },
    { shop_name: "レモンハウス", email: "lemon.m5510@gmail.com", area: "三重" },
    { shop_name: "隣の奥様＆隣の熟女 津 松阪店", email: "t-o-tu-ma@docomo.ne.jp", area: "三重" },
    { shop_name: "熟女の風俗アウトレット三重松阪店", email: "matusaka.outlet@gmail.com", area: "三重" },
    { shop_name: "101ichimaruichi", email: "august.eight88@gmail.com", area: "三重" },
    { shop_name: "Rize リゼ", email: "clubrizeyokkaichi@gmail.com", area: "三重" },
    { shop_name: "大垣 不二子chan本店", email: "fjkogaki00@gmail.com", area: "岐阜" },
    { shop_name: "多治見春日井ちゃんこ", email: "chanko.tajimi@gmail.com", area: "岐阜" },
    { shop_name: "熟女の風俗ｱｳﾄﾚｯﾄ 大垣安八羽島店", email: "zhongcunx181@gmail.com", area: "岐阜" },
    { shop_name: "ZERO学園 岐阜校", email: "zerogakuen@icloud.com", area: "岐阜" },
    { shop_name: "熟女ﾊﾟﾗﾀﾞｲｽ岐阜店（ｶｻﾌﾞﾗﾝｶｸﾞﾙｰﾌﾟ）", email: "delivery0444@gmail.com", area: "岐阜" },
    { shop_name: "熟女の風俗アウトレット美濃加茂可児店", email: "out.minokani@gmail.com", area: "岐阜" },
    { shop_name: "熟女パラダイス岐阜羽島店(ｶｻﾌﾞﾗﾝｶG)", email: "jyukupakyuujin@gmail.com", area: "岐阜" },
    { shop_name: "五十路マダム 岐阜店", email: "gifuisoji@docomo.ne.jp", area: "岐阜" },
    { shop_name: "うさぎちゃん", email: "usagichan.2014@docomo.ne.jp", area: "岐阜" },
    { shop_name: "ASOVIVA", email: "aso.viva.gifu@gmail.com", area: "岐阜" },
    { shop_name: "大垣羽島安八ちゃんこ", email: "aichanko0915@gmail.com", area: "岐阜" },
    { shop_name: "岐阜岐南各務原ちゃんこ", email: "gifuginan.chanko@gmail.com", area: "岐阜" },
    { shop_name: "クラブA", email: "work@cluba.jp", area: "岐阜" },
    { shop_name: "デリバリーヘルス Happy", email: "happy.3101.happy.3101@gmail.com", area: "岐阜" },
    { shop_name: "岐阜美濃加茂・可児ちゃんこ", email: "chankominokani@gmail.com", area: "岐阜" },
    { shop_name: "青い部屋", email: "aoiheya@docomo.ne.jp", area: "岐阜" },
    { shop_name: "ぽっちゃりパラダイス", email: "pochapara1@gmail.com", area: "岐阜" },
    { shop_name: "岐阜奥様倶楽部", email: "gifu-okusama@ezweb.ne.jp", area: "岐阜" },
    { shop_name: "AVANCE春日井", email: "avance.kasugai@gmail.com", area: "岐阜" },
    { shop_name: "激安！巨乳＆ぽちゃｶﾜ専門ﾏｰﾒｲﾄﾞin岐阜", email: "mamegifu@docomo.ne.jp", area: "岐阜" },
    { shop_name: "ミセスＡグランプリ", email: "mrsagrandprix2@gmail.com", area: "岐阜" },
    { shop_name: "ルーフ金沢", email: "ruf.kanazawa01@gmail.com", area: "石川" },
    { shop_name: "金妻", email: "kin-tuma@i.softbank.jp", area: "石川" },
    { shop_name: "La.qoo 金沢本店", email: "laqoo.kanazawa@gmail.com", area: "石川" },
    { shop_name: "金沢の20代～50代が集う人妻倶楽部", email: "kanazawahc@au.com", area: "石川" },
    { shop_name: "もえたく", email: "tati116xqx@gmail.com", area: "石川" },
    { shop_name: "Lovin’金沢（ラヴィン金沢）", email: "lovin.kanazawa@gmail.com", area: "石川" },
    { shop_name: "WIZARD ウィザード", email: "wizard_kanazawa@icloud.com", area: "石川" },
    { shop_name: "ROSE～ローズ～", email: "friends.122501@icloud.com", area: "石川" },
    { shop_name: "Minetto", email: "minetto.kanazawa@gmail.com", area: "石川" },
    { shop_name: "AQUA REAL-アクアレアル-金沢店-", email: "allingroup000@gmail.com", area: "石川" },
    { shop_name: "四季～SIKI～", email: "shiki.kyuujin@au.com", area: "石川" },
    { shop_name: "Kiss ミント", email: "ruf-k@ezweb.ne.jp", area: "石川" },
    { shop_name: "Fuwa×Fuwaかなざわ。", email: "pocharaba@gmail.com", area: "石川" },
    { shop_name: "可憐妻～KA・RE・N～", email: "p.cayenne@icloud.com", area: "石川" },
    { shop_name: "人妻倶楽部小松・加賀", email: "hitozumakurabu@gmail.com", area: "石川" },
    { shop_name: "サンキュー金沢店", email: "thankyou.kanazawa39000039@gmail.com", area: "石川" },
    { shop_name: "金沢人妻 Club DEE", email: "club-dee-girls@ezweb.ne.jp", area: "石川" },
    { shop_name: "金沢人妻城", email: "kanazawa@e4u.co.jp", area: "石川" },
    { shop_name: "石川金沢ちゃんこ", email: "kanazawachanko@gmail.com", area: "石川" },
    { shop_name: "五十路マダム金沢店", email: "kanaisoji@docomo.ne.jp", area: "石川" },
    { shop_name: "ぽちゃぶらんか 金沢店", email: "pochakana@docomo.ne.jp", area: "石川" },
    { shop_name: "ぷるぷるコレクション", email: "x.kk.ent2-joker-1353@ezweb.ne.jp", area: "石川" },
    { shop_name: "Pinky★ピンキー", email: "epn1207@yahoo.co.jp", area: "石川" },
    { shop_name: "いちご金沢ハニカミプリーツ", email: "ichigo.kanazawa@gmail.com", area: "石川" },
    { shop_name: "金沢人妻援護会", email: "kanazawa-engo@po4.nsk.ne.jp", area: "石川" },
    { shop_name: "小松・加賀人妻援護会", email: "komatsu-engo@po4.nsk.ne.jp", area: "石川" },
    { shop_name: "ルーフ福井", email: "ruf.fukui@ezweb.ne.jp", area: "福井" },
    { shop_name: "ぽっちゃり専門店 ぽちゃぽちゃLive", email: "fukui.qzin@gmail.com", area: "福井" },
    { shop_name: "Club Topaz", email: "topaz.cast@gmail.com", area: "福井" },
    { shop_name: "ちょいぽちゃMAX 鯖江店", email: "choipocha5094@gmail.com", area: "福井" },
    { shop_name: "福井人妻城", email: "fukui@e4u.co.jp", area: "福井" },
    { shop_name: "福井市ちゃんこ", email: "fukui.chanko@gmail.com", area: "福井" },
    { shop_name: "人妻.com 福井", email: "m.csblnk_f@docomo.ne.jp", area: "福井" },
    { shop_name: "越前隣妻", email: "e.tonari.zm@gmail.com", area: "福井" },
    { shop_name: "ルーフ富山", email: "ruf.toyama01@gmail.com", area: "富山" },
    { shop_name: "SHANTI ～シャンティ～", email: "junya7070@gmail.com", area: "富山" },
    { shop_name: "イキすぎハイスタイル富山", email: "ikisugi.style@gmail.com", area: "富山" },
    { shop_name: "chouchou", email: "chouchoutoyama2024@gmail.com", area: "富山" },
    { shop_name: "富山のまま", email: "goro5656456@yahoo.co.jp", area: "富山" },
    { shop_name: "とやま・たかおか人妻支援協会", email: "tuma.shien9900@au.com", area: "富山" },
    { shop_name: "Kiss～キス～", email: "love.k.k@i.softbank.jp", area: "富山" },
    { shop_name: "La.qoo 富山店", email: "laqoo.toyama@gmail.com", area: "富山" },
    { shop_name: "STYLE（スタイル）", email: "style.toyama0888@gmail.com", area: "富山" },
    { shop_name: "紫苑 -shion-", email: "shion.therapist@gmail.com", area: "富山" },
    { shop_name: "マダムバンク 富山本店", email: "mbk-driver@ezweb.ne.jp", area: "富山" },
    { shop_name: "CLUB CHELSEA（クラブ チェルシー）", email: "r.chelsea1357@gmail.com", area: "富山" },
    { shop_name: "WATER POLE ～ウォーターポール～", email: "waterpole96@gmail.com", area: "富山" },
    { shop_name: "ごらく高岡富山", email: "09032982069@docomo.ne.jp", area: "富山" },
    { shop_name: "富山インターちゃんこ", email: "toyama.namerikawa.uozu.chanko@gmail.com", area: "富山" },
    { shop_name: "富山高岡ちゃんこ 高岡射水氷見店", email: "takaoka.chanko@gmail.com", area: "富山" },
    { shop_name: "LEXE ～レグゼ～", email: "lexe-0937@docomo.ne.jp", area: "富山" },
    { shop_name: "五十路マダム富山店(ｶｻﾌﾞﾗﾝｶｸﾞﾙｰﾌﾟ)", email: "tomiisoji@au.com", area: "富山" },
    { shop_name: "富山・高岡人妻援護会", email: "tomi-engo@po4.nsk.ne.jp", area: "富山" },
    { shop_name: "CLUB VIAGE～クラブ・ヴィアージュ～", email: "viage.toyama@docomo.ne.jp", area: "富山" },
    { shop_name: "新潟デリヘル倶楽部", email: "ndeli5866@gmail.com", area: "新潟" },
    { shop_name: "奥様特急 新潟店", email: "okusamaexp0930@gmail.com", area: "新潟" },
    { shop_name: "Melt-メルト-", email: "niigata.lila.0401@gmail.com", area: "新潟" },
    { shop_name: "新潟市鳥屋野潟ちゃんこ", email: "nigatachanko@gmail.com", area: "新潟" },
    { shop_name: "熟女の風俗最終章 新潟店", email: "chapter0.ngt@gmail.com", area: "新潟" },
    { shop_name: "ROOKIE", email: "rookie.group.qjin@gmail.com", area: "新潟" },
    { shop_name: "HOPE -ホープ-", email: "fancy.creative.2025@gmail.com", area: "新潟" },
    { shop_name: "新潟人妻専門店 オンリーONE", email: "onlyone2907111@gmail.com", area: "新潟" },
    { shop_name: "Cerulean", email: "cerulean0801@yahoo.co.jp", area: "新潟" },
    { shop_name: "Mimi", email: "mimi2017.nagaoka@gmail.com", area: "新潟" },
    { shop_name: "新潟の可憐な妻たち", email: "niigata.deli.r@gmail.com", area: "新潟" },
    { shop_name: "ガロパ", email: "r19861009@icloud.com", area: "新潟" },
    { shop_name: "奥様特急 長岡店", email: "inami0421@gmail.com", area: "新潟" },
    { shop_name: "ばななフレンド", email: "banana.naga.ryo@gmail.com", area: "新潟" },
    { shop_name: "SOARIS-ソアリス-", email: "soaris.niigata0501@gmail.com", area: "新潟" },
    { shop_name: "夢兎～YUMEUSAGI～", email: "yumeusagikyujin@gmail.com", area: "新潟" },
    { shop_name: "密会ゲート", email: "sukamax0009@gmail.com", area: "新潟" },
    { shop_name: "GRACE", email: "grace.niigata@gmail.com", area: "新潟" },
    { shop_name: "BIANCA 長岡店", email: "bianca.nagaoka@gmail.com", area: "新潟" },
    { shop_name: "HONEY", email: "info@n-honey.com", area: "新潟" },
    { shop_name: "新潟デリバリーヘルス エース", email: "k.k.20170611a@amber.plala.or.jp", area: "新潟" },
    { shop_name: "人妻Kirari", email: "ngt.recruit2022@gmail.com", area: "新潟" },
    { shop_name: "ぽっちゃり素人専門店えびすや", email: "p.ebisuya@docomo.ne.jp", area: "新潟" },
    { shop_name: "新潟長岡ちゃんこ", email: "chanko.nagaoka@gmail.com", area: "新潟" },
    { shop_name: "長岡市総合デリヘルCOLOR", email: "color.recruiment2022@gmail.com", area: "新潟" },
    { shop_name: "新潟三条燕ちゃんこ", email: "rika326211@docomo.ne.jp", area: "新潟" },
    { shop_name: "五十路マダム 新潟店", email: "niiisoji@docomo.ne.jp", area: "新潟" },
    { shop_name: "新潟人妻 2nd wife", email: "2ndwife.net@gmail.com", area: "新潟" },
    { shop_name: "Office Amour", email: "office-amour@ezweb.ne.jp", area: "新潟" },
    { shop_name: "La Muse", email: "07042238008@docomo.ne.jp", area: "新潟" },
    { shop_name: "桃屋 新潟店", email: "momoyaniigata@gmail.com", area: "新潟" },
    { shop_name: "新潟人妻デリバリーヘルス下心", email: "shitagokoro1111@gmail.com", area: "新潟" },
    { shop_name: "CHARMANT", email: "syody41@i.softbank.jp", area: "長野" },
    { shop_name: "BIBLEバイブル～奥様の性書～", email: "bible.u@docomo.ne.jp", area: "長野" },
    { shop_name: "クラブオーディション 松本店", email: "sweetlips2matumoto@gmail.com", area: "長野" },
    { shop_name: "Precede Girls&Ladies 松本駅前店", email: "my13331860@gmail.com", area: "長野" },
    { shop_name: "巨乳・美乳っ娘♡Love", email: "whitelove08069353534@gmail.com", area: "長野" },
    { shop_name: "デリヘルヘブン松本店(ｷｭｱｽﾞｸﾞﾙｰﾌﾟ)", email: "matsumoto@deliheru-heaven.com", area: "長野" },
    { shop_name: "デリヘルヘブン長野店(ｷｭｱｽﾞｸﾞﾙｰﾌﾟ)", email: "nagano@deliheru-heaven.com", area: "長野" },
    { shop_name: "激安！Final Stage", email: "finalstage1001@gmail.com", area: "長野" },
    { shop_name: "diary～人妻の軌跡～長野店", email: "recruit.diarygroup@gmail.com", area: "長野" },
    { shop_name: "プレミアムヘブン(キュアズグループ)", email: "matsumoto@premium-heaven.com", area: "長野" },
    { shop_name: "CLUB-ピアチェーレ(キュアズグループ)", email: "nagano@club-piacere.com", area: "長野" },
    { shop_name: "salon Ajna", email: "dolce_syasin@yahoo.co.jp", area: "長野" },
    { shop_name: "Neo 上田佐久店", email: "hana8700011@gmail.com", area: "長野" },
    { shop_name: "Lounge～ラウンジ～", email: "lounge.nagano0@gmail.com", area: "長野" },
    { shop_name: "ちゃんこ長野権堂店", email: "suzuki.tyanko@gmail.com", area: "長野" },
    { shop_name: "人妻華道 上田店", email: "k5455@docomo.ne.jp", area: "長野" },
    { shop_name: "CLUB VENUS", email: "naganovenus@gmail.com", area: "長野" },
    { shop_name: "クラブオーディション長野店", email: "lotus.job.offer@gmail.com", area: "長野" },
    { shop_name: "SECRET SERVICE 松本店", email: "m-plusmile@softbank.ne.jp", area: "長野" },
    { shop_name: "ピーチガール", email: "peachgirl_s2@softbank.ne.jp", area: "長野" },
    { shop_name: "密着Bodyクリニック", email: "bodyclinicnagano@icloud.com", area: "長野" },
    { shop_name: "完熟マダム", email: "info@kjmadam-nagano.com", area: "長野" },
    { shop_name: "ちゃんこ長野塩尻北IC店", email: "matumoto.chanko@gmail.com", area: "長野" },
    { shop_name: "スウィートフェアリー", email: "info@sweetfairy-n.com", area: "長野" },
    { shop_name: "夜ふかし", email: "yohukasi001@gmail.com", area: "長野" },
    { shop_name: "月華美人上田店", email: "gekkabijin20210901@gmail.com", area: "長野" },
    { shop_name: "甲府人妻城（モアグループ）", email: "kyuzin-kofu@more-g.jp", area: "山梨" },
    { shop_name: "LOVE CLOVER～らぶくろーばー～", email: "info@l-clover.com", area: "山梨" },
    { shop_name: "ピサージュ甲府", email: "visage.koufu@gmail.com", area: "山梨" },
    { shop_name: "山梨デリヘル「Sコレクション」甲府", email: "lusias.scollection@gmail.com", area: "山梨" },
    { shop_name: "You＆Me", email: "job.youandme@gmail.com", area: "山梨" },
    { shop_name: "山梨デリヘル絆", email: "kizuna0511@au.com", area: "山梨" },
    { shop_name: "Candy", email: "chuo_candy@yahoo.co.jp", area: "山梨" },
    { shop_name: "山梨甲府甲斐ちゃんこ", email: "yamanashi.kofu.kai.chanko@gmail.com", area: "山梨" },
    { shop_name: "甲府人妻隊", email: "ot_kyujin@yahoo.co.jp", area: "山梨" },
    { shop_name: "ぽちゃぶらんか甲府", email: "pocha.koufu@gmail.com", area: "山梨" },
    { shop_name: "女人と娯楽Ⅱ", email: "rou911188@gmail.com", area: "山梨" },
    { shop_name: "アミューズ/#AMUSE 甲府店", email: "13group.work@gmail.com", area: "山梨" },
    { shop_name: "エメラルド☆フロウジョン", email: "emefuro0721@gmail.com", area: "山梨" },
    { shop_name: "人妻物語～極～", email: "kiwami.x2309@gmail.com", area: "山梨" },
    { shop_name: "THE・TRY", email: "mixi.u@docomo.ne.jp", area: "栃木" },
    { shop_name: "奥様なでしこ", email: "okusamanade@gmail.com", area: "栃木" },
    { shop_name: "宇都宮ムンムン熟女妻", email: "utsunomiya@munmunjyukujyo.net", area: "栃木" },
    { shop_name: "ＣＨＥＲＩＭＯ（シェリモ）", email: "utsunomiyacherimo@gmail.com", area: "栃木" },
    { shop_name: "宇都宮人妻花壇（モアグループ）", email: "info@yumekana-group.net", area: "栃木" },
    { shop_name: "地元女子が勢揃い 宇都宮ガールズ", email: "utsunomiya.girls@gmail.com", area: "栃木" },
    { shop_name: "那須塩原人妻花壇", email: "nasushiobara.kadan@gmail.com", area: "栃木" },
    { shop_name: "プレイガールα宇都宮店", email: "y401.world@gmail.com", area: "栃木" },
    { shop_name: "sexis", email: "sexis.dh@gmail.com", area: "栃木" },
    { shop_name: "NEW GENERATION", email: "final.attack@icloud.com", area: "栃木" },
    { shop_name: "治療院.LOVE宇都宮店", email: "u-esu@umail.plala.or.jp", area: "栃木" },
    { shop_name: "エムドグマ", email: "taka55aqua@icloud.com", area: "栃木" },
    { shop_name: "PREMIUM～プレミアム～", email: "premium9300@yahoo.co.jp", area: "栃木" },
    { shop_name: "熟女の風俗最終章 宇都宮店", email: "chapter0.utm@gmail.com", area: "栃木" },
    { shop_name: "宇都宮LOVEST", email: "kyujin.utm2019@gmail.com", area: "栃木" },
    { shop_name: "宇都宮人妻城", email: "mail@u46.jp", area: "栃木" },
    { shop_name: "治療院.LOVE小山店", email: "o-esu2@docomo.ne.jp", area: "栃木" },
    { shop_name: "脱がされたい人妻 宇都宮店", email: "utsunomiya@saretuma.com", area: "栃木" },
    { shop_name: "栃木宇都宮ちゃんこ", email: "tochigiutunomiya.chanko@gmail.com", area: "栃木" },
    { shop_name: "ふわもこ人妻ランド 那須塩原店", email: "fuwamoko2025@gmail.com", area: "栃木" },
    { shop_name: "五十路マダム宇都宮店 (カサブランカG)", email: "madam50u@docomo.ne.jp", area: "栃木" },
    { shop_name: "人妻洗体倶楽部", email: "sentai@docomo.ne.jp", area: "栃木" },
    { shop_name: "即イキ淫乱倶楽部", email: "llc.zeroone.tochigi@gmail.com", area: "栃木" },
    { shop_name: "ぽちゃカワ女子専門店 宇都宮", email: "takasawaken1975@icloud.com", area: "栃木" },
    { shop_name: "那須塩原大田原黒磯ちゃんこ", email: "shincg1118@gmail.com", area: "栃木" },
    { shop_name: "栃木小山ちゃんこ", email: "tochioyachanko0203@gmail.com", area: "栃木" },
    { shop_name: "Flash宇都宮", email: "ken.yuu0071121@gmail.com", area: "栃木" },
    { shop_name: "奥様アテンド", email: "okusama.atend@gmail.com", area: "栃木" },
    { shop_name: "愛妻倶楽部 宇都宮店", email: "info@aisai-utsunomiya.com", area: "栃木" },
    { shop_name: "バルーン 宇都宮店", email: "arukobarenocompany@gmail.com", area: "栃木" },
    { shop_name: "小山人妻城", email: "info@o46.jp", area: "栃木" },
    { shop_name: "ナチュラルミセス", email: "ut.moshiduma@gmail.com", area: "栃木" },
    { shop_name: "ぱい LOVE YOU 小山店", email: "love8181@docomo.ne.jp", area: "栃木" },
    { shop_name: "人妻熟女アールプロ", email: "daiwa.co@gmail.com", area: "栃木" },
    { shop_name: "ミセスまーと", email: "a0237m1937@yahoo.co.jp", area: "栃木" },
    { shop_name: "宇都宮CLUB", email: "utsuclub1210@gmail.com", area: "栃木" },
    { shop_name: "小山デリヘル★ラブキッス", email: "love-kiss1107@ezweb.ne.jp", area: "栃木" },
    { shop_name: "50代からのお店 紅花", email: "simo0172mie2578@gmail.com", area: "栃木" },
    { shop_name: "人妻大田原・那須塩原デリヘルクラブ", email: "h.nasu.dc@gmail.com", area: "栃木" },
    { shop_name: "人妻家 古河・小山店", email: "runon.kantou@gmail.com", area: "栃木" },
    { shop_name: "ゆらゆらポッチャリcafe", email: "paipaiutsu1210@gmail.com", area: "栃木" },
    { shop_name: "人妻R-PRO", email: "n.madonna6948@gmail.com", area: "栃木" },
    { shop_name: "LUXE-SANO", email: "recruit@luxe-sano.com", area: "栃木" },
    { shop_name: "一期一会", email: "1518.utsunomiya@gmail.com", area: "栃木" },
    { shop_name: "当たり屋", email: "atari.koga.2026@gmail.com", area: "栃木" },
    { shop_name: "若妻人妻半熟熟女の娯楽屋小山店", email: "gorakuoyama@icloud.com", area: "栃木" },
    { shop_name: "DIVAセカンドシーズン", email: "diva3101_2nd@yahoo.co.jp", area: "茨城" },
    { shop_name: "癒し娘診療所 水戸・ひたちなか店", email: "iyashi.recruit@gmail.com", area: "茨城" },
    { shop_name: "水戸人妻花壇（モアグループ）", email: "mirise-recruit@more-g.jp", area: "茨城" },
    { shop_name: "茨城日立ちゃんこ", email: "hitachichanko@gmail.com", area: "茨城" },
    { shop_name: "つくば風俗エキスプレス ヌキ坂46", email: "info@nukizaka.jp", area: "茨城" },
    { shop_name: "茨城水戸ちゃんこ", email: "chankomito@gmail.com", area: "茨城" },
    { shop_name: "INFINITY GOLD", email: "info@hitachinaka-mito-deli.jp", area: "茨城" },
    { shop_name: "Masquerade マスカレード", email: "mmasukaredo@gmail.com", area: "茨城" },
    { shop_name: "スッキリ商事", email: "iam-1980yen@ezweb.ne.jp", area: "茨城" },
    { shop_name: "迷宮の人妻 古河・久喜発", email: "koga@meikyu-tsuma.com", area: "茨城" },
    { shop_name: "癒し娘診療所 日立店", email: "iyashigroup.hitachi@gmail.com", area: "茨城" },
    { shop_name: "恋人感 土浦店", email: "koibitokan@gmail.com", area: "茨城" },
    { shop_name: "素人妻御奉仕倶楽部Hip's取手店", email: "info@hips-toride.com", area: "茨城" },
    { shop_name: "Fairy", email: "chihiro781114@gmail.com", area: "茨城" },
    { shop_name: "茨城神栖ちゃんこ", email: "kamisuchanko@gmail.com", area: "茨城" },
    { shop_name: "秘密の出張部屋", email: "ka19920915@icloud.com", area: "茨城" },
    { shop_name: "ぽちゃらん神栖店", email: "pocharankamisu@gmail.com", area: "茨城" },
    { shop_name: "人妻のから騒ぎ", email: "g-navi@docomo.ne.jp", area: "茨城" },
    { shop_name: "エロいお姉さん倶楽部", email: "eoclub1880@gmail.com", area: "茨城" },
    { shop_name: "乱密", email: "d.ranmitu@gmail.com", area: "茨城" },
    { shop_name: "神栖デリヘルコレクション", email: "kabushiki.traum@gmail.com", area: "茨城" },
    { shop_name: "煌-kirameki-", email: "c.s.speederz.0708@icloud.com", area: "茨城" },
    { shop_name: "ミス＆ミセス", email: "miss.mrs.07@docomo.ne.jp", area: "茨城" },
    { shop_name: "茨城つくば土浦ちゃんこ", email: "tut08096554400@gmail.com", area: "茨城" },
    { shop_name: "牛久美人倶楽部～NEO～", email: "ushiku.bijin@gmail.com", area: "茨城" },
    { shop_name: "舐めていいとも！", email: "t2013ver.i@icloud.com", area: "茨城" },
    { shop_name: "MERMAID～マーメイド～", email: "mermaid.0007@au.com", area: "茨城" },
    { shop_name: "亀と栗ビューティークリニック 水戸", email: "kkbc.mito@gmail.com", area: "茨城" },
    { shop_name: "ちゃんこ 茨城 龍ケ崎・取手店", email: "kyujin.chanko.toride.moriya@gmail.com", area: "茨城" },
    { shop_name: "キレイ計画in土浦", email: "kirei-tuchiura@docomo.ne.jp", area: "茨城" },
    { shop_name: "取手っ娘", email: "info@toridekko.com", area: "茨城" },
    { shop_name: "PUNK", email: "info@punk-deli.com", area: "茨城" },
    { shop_name: "水戸人妻隊", email: "mito@hitodumatai.jp", area: "茨城" },
    { shop_name: "奥様宅配便 神栖支店", email: "0930takuhaibin@gmail.com", area: "茨城" },
    { shop_name: "日本人妻専門店～やまとなでしこ～", email: "gacktxxxkuga@gmail.com", area: "茨城" },
    { shop_name: "春日部人妻花壇", email: "aoishouji0401@gmail.com", area: "茨城" },
    { shop_name: "アルティメイト", email: "h-d1997flstc.1340evo@docomo.ne.jp", area: "茨城" },
    { shop_name: "Minette ～ミネット～ 高崎店", email: "koneko.03.takasaki.01@gmail.com", area: "群馬" },
    { shop_name: "HAPPYLIFE LABEL", email: "happylife.39job@gmail.com", area: "群馬" },
    { shop_name: "いちゃいちゃグループ", email: "office@au.com", area: "群馬" },
    { shop_name: "群馬発若娘特急便027ｷｭｰﾃｨ★ｴｸｽﾌﾟﾚｽ", email: "girl@027cutie.com", area: "群馬" },
    { shop_name: "熟女の風俗最終章 高崎店", email: "woman.work2020@gmail.com", area: "群馬" },
    { shop_name: "シコティッシュ学園", email: "sikogaku.sg@gmail.com", area: "群馬" },
    { shop_name: "ミスミセス", email: "msmisesu.job@gmail.com", area: "群馬" },
    { shop_name: "diary～人妻の軌跡～伊勢崎", email: "diaryisesaki.1234@gmail.com", area: "群馬" },
    { shop_name: "太田人妻城", email: "info@kyujinota-siro.com", area: "群馬" },
    { shop_name: "QUEENDOM～序章～", email: "tfs.honjyo@icloud.com", area: "群馬" },
    { shop_name: "ミスミセス伊勢崎店", email: "msmisesui.job@gmail.com", area: "群馬" },
    { shop_name: "群馬高崎前橋ちゃんこ", email: "takasakichanko@gmail.com", area: "群馬" },
    { shop_name: "姫コレクション高崎前橋店", email: "horitashouta0406@gmail.com", area: "群馬" },
    { shop_name: "可憐な妻たち 太田店", email: "karen-3939@softbank.ne.jp", area: "群馬" },
    { shop_name: "セレブ Rex", email: "himecolle.recruitment@gmail.com", area: "群馬" },
    { shop_name: "群馬デリヘル", email: "gunma-deliheal@docomo.ne.jp", area: "群馬" },
    { shop_name: "君とふわふわプリンセス太田店", email: "ota.fuwapuri@gmail.com", area: "群馬" },
    { shop_name: "大人生活 高崎", email: "info@otona-takasaki.com", area: "群馬" },
    { shop_name: "群馬渋川水沢ちゃんこ", email: "chan.shibukawa@gmail.com", area: "群馬" },
    { shop_name: "群馬伊勢崎ちゃんこ", email: "gunmaisesaki.chanko.qjin55@gmail.com", area: "群馬" },
    { shop_name: "人妻熟女の秘密の関係伊勢崎店", email: "isesaki.himitunokankei.qjin55@gmail.com", area: "群馬" },
    { shop_name: "PHANTOM(ファントム)", email: "recruit@ota-deli.com", area: "群馬" },
    { shop_name: "君とふわふわプリンセスin高崎", email: "fuwatakasaki@gmail.com", area: "群馬" },
    { shop_name: "可憐な妻たち 高崎店", email: "pretty-woman-.-4976@docomo.ne.jp", area: "群馬" },
    { shop_name: "Premium Office 太田・足利・伊勢崎", email: "ikenaiol.ota@gmail.com", area: "群馬" },
    { shop_name: "いちゃぷよ★ポッチャdoll[高崎・前橋]", email: "pottya.doll.gunma@icloud.com", area: "群馬" },
    { shop_name: "太田足利ちゃんこ", email: "otaashikaga.chanko.qjin55@gmail.com", area: "群馬" },
    { shop_name: "高崎 熟女の達人", email: "wisteria.five555@gmail.com", area: "群馬" },
    { shop_name: "出逢い", email: "deait.job@gmail.com", area: "群馬" },
    { shop_name: "人妻熟女の秘密の関係太田足利店", email: "otaashikaga.himitunokankei.qjin@gmail.com", area: "群馬" },
    { shop_name: "ぽちゃラブ専門店♡マシュマロ", email: "nextstage2025.12@gmail.com", area: "群馬" },
    { shop_name: "諭吉専科", email: "yukichi.senka@gmail.com", area: "群馬" },
    { shop_name: "人妻奉仕倶楽部", email: "houshiculb57917914@ymail.ne.jp", area: "群馬" },
    { shop_name: "アイスキャンディーラブ", email: "kaisei8123@gmail.com", area: "群馬" },
    { shop_name: "ROYAL GRACE", email: "r-grace@of-gbl.com", area: "群馬" },
    { shop_name: "即イキ淫乱倶楽部 高崎店", email: "zeroonetakasaki@gmail.com", area: "群馬" },
    { shop_name: "激やみ！痴女伝説 群馬本店", email: "singa696925@gmail.com", area: "群馬" },
    { shop_name: "君とふわふわプリンセスin本庄", email: "honjo.fuwapuri@gmail.com", area: "群馬" },
    { shop_name: "おしゃれカンケイ", email: "osharekankei0701@gmail.com", area: "群馬" },
    { shop_name: "ひみつの宅配便", email: "takushirenqi@gmail.com", area: "群馬" },
    { shop_name: "Belleve～ビリーヴ～", email: "eternalcoup.0888@gmail.com", area: "群馬" },
    { shop_name: "ぽちゃぶらんか伊勢崎店(ｶｻﾌﾞﾗﾝｶG)", email: "pochaisesaki@gmail.com", area: "群馬" },
    { shop_name: "完全会員制SM倶楽部M′s Reboot", email: "mscubederi@gmail.com", area: "群馬" },
    { shop_name: "秘密のプリンセスルーム", email: "himitsunoprincess@gmail.com", area: "群馬" },
    { shop_name: "MTT COCOMO", email: "ttk.ysn9@gmail.com", area: "群馬" },
    { shop_name: "OSIRIS", email: "analdevelopment.pro@gmail.com", area: "群馬" },
    { shop_name: "月華美人～人妻との快楽～", email: "i.karen0930@gmail.com", area: "群馬" },
    { shop_name: "大人生活 太田伊勢崎", email: "info@otona-oota.com", area: "群馬" }
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
