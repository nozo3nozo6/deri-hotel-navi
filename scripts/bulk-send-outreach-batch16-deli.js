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
    { shop_name: "美少女制服学園 クラスメイト", email: "kyu-jin@cm-group-inc.jp", area: "東京" },
    { shop_name: "Chloe五反田本店 S級素人清楚系ﾃﾞﾘﾍﾙ", email: "info@xn--edk8azcf5709ahtgo34d.com", area: "東京" },
    { shop_name: "デザインプリズム新宿", email: "hello@de-prism.jp", area: "東京" },
    { shop_name: "GINGIRA☆TOKYO～ギンギラ東京～", email: "gingiragroup.recruit@gmail.com", area: "東京" },
    { shop_name: "STELLA TOKYO ～ステラ東京～", email: "stella.00513@gmail.com", area: "東京" },
    { shop_name: "THE ESUTE五反田店", email: "rct@gt.the-esute.jp", area: "東京" },
    { shop_name: "品川やすらぎ", email: "info@s-yasuragi.jp", area: "東京" },
    { shop_name: "E+錦糸町(E+グループ)", email: "eplus.kinshichou@gmail.com", area: "東京" },
    { shop_name: "五反田メンズエステ イマジン東京", email: "imagine-tokyo@ezweb.ne.jp", area: "東京" },
    { shop_name: "東京リップ 渋谷店（リップグループ）", email: "shibuya.lip.src@gmail.com", area: "東京" },
    { shop_name: "SPIN（スピン）", email: "recruit_ikebukuro@yahoo.co.jp", area: "東京" },
    { shop_name: "One More 奥様 錦糸町店", email: "kinshi1more@gmail.com", area: "東京" },
    { shop_name: "STELLA NEXT－ステラネクスト－", email: "stellanext.1114@gmail.com", area: "東京" },
    { shop_name: "サティアンまーと", email: "toaruikesa2024@gmail.com", area: "東京" },
    { shop_name: "ウルトラグレイス24(ｳﾙﾄﾗｸﾞﾙｰﾌﾟ)", email: "ug.work.apply@gmail.com", area: "東京" },
    { shop_name: "グランドオペラ東京", email: "recruit@t-opera.com", area: "東京" },
    { shop_name: "ごほうびSPA 五反田店", email: "gohoubi_job@star-group.co.jp", area: "東京" },
    { shop_name: "Chloe鶯谷・上野店 S級素人清楚系", email: "info@xn--edk8azcf5838a773f.com", area: "東京" },
    { shop_name: "東京メンズボディクリニックTMBC上野", email: "uenojobb@gmail.com", area: "東京" },
    { shop_name: "MIRAI TOKYO 六本木店", email: "info@mirai10.tokyo", area: "東京" },
    { shop_name: "39グループ 求人部", email: "thankyoujin.39@gmail.com", area: "東京" },
    { shop_name: "ふーどる×ふーどるin池袋", email: "ffudoru@gmail.com", area: "東京" },
    { shop_name: "ごほうびSPA 池袋店", email: "gohoubi_ikebukuro_job@star-group.co.jp", area: "東京" },
    { shop_name: "東京メンズボディクリニックTMBC池袋", email: "ikebukuro@staff-mail.com", area: "東京" },
    { shop_name: "東京リップ 立川店（リップグループ）", email: "tachikawa@d.lip-group.co.jp", area: "東京" },
    { shop_name: "フィーリングループ（東京エリア）", email: "info@hontsuma-machida.com", area: "東京" },
    { shop_name: "華恋人（カレント）", email: "recruit@karent-u.com", area: "東京" },
    { shop_name: "しろうと娘", email: "shiroutojob@docomo.ne.jp", area: "東京" },
    { shop_name: "BLENDA VIP 東京店", email: "blenda-vip-tokyo@recruit-kansai.com", area: "東京" },
    { shop_name: "One More 奥様 蒲田店", email: "kamata1more@gmail.com", area: "東京" },
    { shop_name: "大塚アテネ", email: "info@venus-plan.com", area: "東京" },
    { shop_name: "渋谷じゃっくす", email: "takumakazuhito1205@gmail.com", area: "東京" },
    { shop_name: "Tokyo Escort OTOME(ユメオト)", email: "job@tokyoescort-otome.com", area: "東京" },
    { shop_name: "秋葉原コスプレ学園(秋コスグループ)", email: "rct@a-maid.jp", area: "東京" },
    { shop_name: "E+五反田(E+グループ)", email: "eplus.g.family@gmail.com", area: "東京" },
    { shop_name: "東京名花", email: "info@tokyo-meika.com", area: "東京" },
    { shop_name: "Bell～ベル～", email: "info@xn--bell-yp4cydufj9879d48wa.com", area: "東京" },
    { shop_name: "ファインモーション", email: "finemotionxxx@gmail.com", area: "東京" },
    { shop_name: "SEASONS 369 sP", email: "gotanda.78group@gmail.com", area: "東京" },
    { shop_name: "学園collection", email: "co-girl@i.softbank.jp", area: "東京" },
    { shop_name: "Number Five 品川(シンデレラグループ)", email: "rct@shinagawa-five.jp", area: "東京" },
    { shop_name: "貧乳パラダイス", email: "info@hin-para.com", area: "東京" },
    { shop_name: "Welcome Cafe八王子本店", email: "welcomecafegroup@gmail.com", area: "東京" },
    { shop_name: "池袋人妻アデージョ", email: "adeejo77@gmail.com", area: "東京" },
    { shop_name: "錦糸町人妻セレブリティ(ユメオト)", email: "job@celeb-ks.com", area: "東京" },
    { shop_name: "CLUB 虎の穴 青山店", email: "girls_reruit@tora-ana.jp", area: "東京" },
    { shop_name: "錦糸町はじめてのエステ(ユメオト)", email: "job@ks-hajies.com", area: "東京" },
    { shop_name: "国分寺人妻研究会", email: "info@kenkyukai-kb.com", area: "東京" },
    { shop_name: "プリコレ（PRINCESS COLLECTION）", email: "info@pricolle.jp", area: "東京" },
    { shop_name: "池袋アクトレス(ユメオト)", email: "job@ik-actress.com", area: "東京" },
    { shop_name: "逢いトーク", email: "rierie031711@gmail.com", area: "東京" },
    { shop_name: "八王子人妻城（モアグループ", email: "recruit@riri-group.net", area: "東京" },
    { shop_name: "昼顔妻 五反田店", email: "info@hirugao-duma.com", area: "東京" },
    { shop_name: "現役女子大生コレクション", email: "info@josidaisei1.com", area: "東京" },
    { shop_name: "月の真珠-新宿-", email: "job@tsukinoshinju-shinjuku.jp", area: "東京" },
    { shop_name: "えちちSPA五反田店", email: "echichi.gotanda@gmail.com", area: "東京" },
    { shop_name: "こあくまな熟女たち鶯谷・日暮里店", email: "recruit_girls_east@koakumagroup.com", area: "東京" },
    { shop_name: "恋の履歴書", email: "koinorirekisho@gmail.com", area: "東京" },
    { shop_name: "ドキドキＮＴＲ寝取られ生電話", email: "job@n-namaden.com", area: "東京" },
    { shop_name: "One More 奥様 町田相模原店", email: "machida1more@gmail.com", area: "東京" },
    { shop_name: "クラブアイリス東京", email: "iris-tokyo@vipclub-iris.com", area: "東京" },
    { shop_name: "櫻女学院", email: "machidakaisya@gmail.com", area: "東京" },
    { shop_name: "コーチと私とビート板", email: "coach.watashi.03@gmail.com", area: "東京" },
    { shop_name: "東京貴楼館", email: "info@tokyokirokan.com", area: "東京" },
    { shop_name: "素人妻達☆マイふぇらレディー", email: "feralady.03@gmail.com", area: "東京" },
    { shop_name: "熟女デリヘル秘宝館Z", email: "info.hihoukan.z@gmail.com", area: "東京" },
    { shop_name: "東京巨乳デリヘル おっぱいマート", email: "oppaimart.03@gmail.com", area: "東京" },
    { shop_name: "Charme（シャルム）", email: "tachikawacharme@gmail.com", area: "東京" },
    { shop_name: "君とふわふわプリンセス立川店", email: "fuwa.tachikawa@gmail.com", area: "東京" },
    { shop_name: "Tokyo Style", email: "recruit@tokyostyle-delivery.jp", area: "東京" },
    { shop_name: "名門大学物語", email: "info@meimondai.com", area: "東京" },
    { shop_name: "女々艶グループ", email: "jojokyujin@gmail.com", area: "東京" },
    { shop_name: "奥様はｴﾝｼﾞｪﾙ町田(ｴﾝｼﾞｪﾙﾗｲﾝｸﾞﾙｰﾌﾟ)", email: "machida@okusama-angel.net", area: "東京" },
    { shop_name: "MIRAI TOKYO 新宿店", email: "info@mirai-shinjuku.tokyo", area: "東京" },
    { shop_name: "ティアリズム代官山", email: "info@tiarism.com", area: "東京" },
    { shop_name: "E+アイドルスクール池袋店(E+グループ)", email: "edol.ikebukuro@gmail.com", area: "東京" },
    { shop_name: "性の極み 技の伝道師 ver.匠", email: "kiwami.kyujinsogo@gmail.com", area: "東京" },
    { shop_name: "KAWAII", email: "ykawaii275@gmail.com", area: "東京" },
    { shop_name: "東京エステコレクション", email: "info@gmax.jp", area: "東京" },
    { shop_name: "東京不倫", email: "support@tokyofurin.com", area: "東京" },
    { shop_name: "あなたに逢いたくて", email: "aitakute03@gmail.com", area: "東京" },
    { shop_name: "エンジェルマスカット", email: "cc99.cupid99@gmail.com", area: "東京" },
    { shop_name: "脱がされたい人妻町田・相模原店", email: "info@frontier-group.info", area: "東京" },
    { shop_name: "鶯谷デリヘル倶楽部", email: "udc.recruit@gmail.com", area: "東京" },
    { shop_name: "新大久保・新宿歌舞伎町ちゃんこ", email: "2021chanko@gmail.com", area: "東京" },
    { shop_name: "アナラードライ五反田店", email: "koubo314@gmail.com", area: "東京" },
    { shop_name: "アロマエステGarden 東京", email: "recruit@garden-tokyo.net", area: "東京" },
    { shop_name: "ベリー", email: "info@tokyo-berry.com", area: "東京" },
    { shop_name: "ザイオン 会員制アロマエステ", email: "sssjob@au.com", area: "東京" },
    { shop_name: "ラブセレクション", email: "shinkoiwa01@gmail.com", area: "東京" },
    { shop_name: "五反田人妻城（モアグループ）", email: "gtdjooo@more-g.jp", area: "東京" },
    { shop_name: "ファーストクラス", email: "info@sm-first-class.com", area: "東京" },
    { shop_name: "奥様はｴﾝｼﾞｪﾙ国分寺(ｴﾝｼﾞｪﾙﾗｲﾝｸﾞﾙｰﾌﾟ)", email: "kokubunji@okusama-angel.net", area: "東京" },
    { shop_name: "バタフライ立川", email: "butterflytachikawa0601@gmail.com", area: "東京" },
    { shop_name: "人妻ネットワークグループ", email: "recruit@deai-tuma.net", area: "東京" },
    { shop_name: "BBW", email: "info@bb-w.net", area: "東京" },
    { shop_name: "メリッサ東京 品川店", email: "recruit@melissa-shinagawa.net", area: "東京" },
    { shop_name: "完熟ばななグループ", email: "info@job-banana.com", area: "東京" },
    { shop_name: "逢Tokyo", email: "info@ai-tokyo.com", area: "東京" },
    { shop_name: "池袋デリヘル倶楽部", email: "deli.ikbkr.club@gmail.com", area: "東京" },
    { shop_name: "ELEGANCE", email: "ec3@elegance2025.jp", area: "東京" },
    { shop_name: "SM東京 池袋店", email: "ikebukuro2825@gmail.com", area: "東京" },
    { shop_name: "ヴィクトリアクラブ東京", email: "info@victoria-tokyo.com", area: "東京" },
    { shop_name: "錦糸町 夜這右衛門娼店", email: "kinshicho.481@gmail.com", area: "東京" },
    { shop_name: "Delice(デリス)錦糸町店", email: "shiryu20004645@gmail.com", area: "東京" },
    { shop_name: "新宿 秘書課女子", email: "recruit@love-hips.com", area: "東京" },
    { shop_name: "松戸人妻花壇（モアグループ）", email: "kyuzin@ls-group.jp", area: "東京" },
    { shop_name: "ファンタジアルージュ五反田", email: "recruit@fantasiarouge-gotanda.com", area: "東京" },
    { shop_name: "麗奈TOKYO", email: "reserve@madam-rena.com", area: "東京" },
    { shop_name: "吉祥寺人妻研究会", email: "info@hitoduma-joji-shimokita.com", area: "東京" },
    { shop_name: "池袋おかあさん", email: "madre3@chorus.ocn.ne.jp", area: "東京" },
    { shop_name: "月の真珠-五反田-", email: "job@tsukinoshinju-gotanda.jp", area: "東京" },
    { shop_name: "サンキュー五反田店", email: "thankyou.gotanda@gmail.com", area: "東京" },
    { shop_name: "東京乙女組 新宿校", email: "otome.job@gmail.com", area: "東京" },
    { shop_name: "ホワイトベル渋谷", email: "rct@whitebell-shibuya.com", area: "東京" },
    { shop_name: "Delice(デリス)池袋店", email: "delice_ikebukuro@icloud.com", area: "東京" },
    { shop_name: "クラブ ブレンダ東京池袋店", email: "blenda-shinjuku@recruit-kansai.com", area: "東京" },
    { shop_name: "ごほうびSPA 新宿店", email: "gohoubi_shinjuku_job@star-group.co.jp", area: "東京" },
    { shop_name: "びくびくサークル五反田店", email: "gotanda.4035@gmail.com", area: "東京" },
    { shop_name: "THE ORDER（ジオーダー）", email: "info@the-order.jp", area: "東京" },
    { shop_name: "PURE MAISON（ピュアメゾン）", email: "info@pure-maison.com", area: "東京" },
    { shop_name: "罪なエステ 品川", email: "tsumi.ethe@gmail.com", area: "東京" },
    { shop_name: "A Beauty", email: "a.beauty0402@gmail.com", area: "東京" },
    { shop_name: "五反田エース", email: "gotandaace@ymail.ne.jp", area: "東京" },
    { shop_name: "裸でマッサージ＋デリヘルサービス！TOKYO VIP", email: "tokyovip@ymail.ne.jp", area: "東京" },
    { shop_name: "五反田はじめてのエステ(ユメオト)", email: "job@g-hajies.com", area: "東京" },
    { shop_name: "十恋人～トレンド～", email: "recruit@trend-no1.com", area: "東京" },
    { shop_name: "新宿ハニープラザ(ユメオト)", email: "job-shinjuku@honeyplaza.biz", area: "東京" },
    { shop_name: "OTONA JOSHI", email: "job@o-joshi.tokyo", area: "東京" },
    { shop_name: "シンデレラグループ", email: "rct@cin-gr.com", area: "東京" },
    { shop_name: "C級グル女 鶯谷店", email: "oubo_work@cgourmet.biz", area: "東京" },
    { shop_name: "六本木ルミエール", email: "ike.nyandafull@gmail.com", area: "東京" },
    { shop_name: "銀座ミセスアロマ(ユメオト)", email: "job@gz-mrs.com", area: "東京" },
    { shop_name: "断りきれない美人マッサージ嬢たち", email: "job@k-b-m.net", area: "東京" },
    { shop_name: "サンキュー町田・相模原店", email: "39machidasagami@gmail.com", area: "東京" },
    { shop_name: "トムソーヤ 町田店", email: "machidahitoduma@gmail.com", area: "東京" },
    { shop_name: "女神の極み(エンジェルライングループ)", email: "tachikawa@megami-kiwami.jp", area: "東京" },
    { shop_name: "即痴女る", email: "afkakumei@yahoo.co.jp", area: "東京" },
    { shop_name: "新橋プリンセス", email: "akasaka2gro@gmail.com", area: "東京" },
    { shop_name: "Alice池袋", email: "alice.ikebukuro2@gmail.com", area: "東京" },
    { shop_name: "オトナのマル秘最前線！！", email: "info.otona.szs@gmail.com", area: "東京" },
    { shop_name: "ニューミラージュ", email: "taki.401crk@docomo.ne.jp", area: "東京" },
    { shop_name: "奥様はエンジェル八王子(エンジェルライングループ)", email: "hachioji@okusama-angel.net", area: "東京" },
    { shop_name: "Okini東京", email: "info@bokuoki.com", area: "東京" },
    { shop_name: "蒲田ちゃんこ(ちゃんこグループ)", email: "kamata.chanko.2nd@gmail.com", area: "東京" },
    { shop_name: "東京エンジェルライン立川(エンジェルライングループ)", email: "info@angelline.net", area: "東京" },
    { shop_name: "新宿泡洗体デラックスエステ", email: "recruit@shinjuku-deluxe.com", area: "東京" },
    { shop_name: "ミセスラウンジ東京", email: "guidebook@delivery-wife.net", area: "東京" },
    { shop_name: "人妻万華", email: "kyuujinn.kama@gmail.com", area: "東京" },
    { shop_name: "秘密倶楽部 凛 TOKYO", email: "h_rintokyo@yahoo.co.jp", area: "東京" },
    { shop_name: "TALL", email: "info@tall-tokyo.net", area: "東京" },
    { shop_name: "アドミsince 2002", email: "admi2002fantasy@gmail.com", area: "東京" },
    { shop_name: "錦糸町人妻ヒットパレード(シンデレラグループ)", email: "rct@k-hitotsuma.com", area: "東京" },
    { shop_name: "エロティックマッサージ 新橋", email: "cnp_7777@yahoo.co.jp", area: "東京" },
    { shop_name: "池袋はじめてのエステ(ユメオト)", email: "job@ik.hajies.com", area: "東京" },
    { shop_name: "白金プラチナ(ユメオト)", email: "job@s.pln.jp", area: "東京" },
    { shop_name: "新宿はじめてのエステ(ユメオト)", email: "job@sj.hajies.com", area: "東京" },
    { shop_name: "池袋Lumiere‐ルミエール‐", email: "ikenyandafull@gmail.com", area: "東京" },
    { shop_name: "上野ヒーローズ(ユメオト)", email: "job@ueno.gheros.jp", area: "東京" },
    { shop_name: "五反田人妻ヒットパレード(シンデレラグループ)", email: "rct@g-cin.jp", area: "東京" },
    { shop_name: "恥じらいエステ", email: "h1esesg@gmail.com", area: "東京" },
    { shop_name: "美妻隊", email: "bitsuma1415@gmail.com", area: "東京" },
    { shop_name: "上野回春性感マッサージ倶楽部", email: "k_ueno_job@star-group.co.jp", area: "東京" },
    { shop_name: "奥鉄オクテツ東京店（デリヘル市場）", email: "derikyu@dh2020.jp", area: "東京" },
    { shop_name: "もみもみワンダーランド", email: "info.momi1.boin@gmail.com", area: "東京" },
    { shop_name: "One More 奥様 五反田店", email: "gotanda1more@gmail.com", area: "東京" },
    { shop_name: "あかね治療院 なでしこ診療所", email: "info@akane-in.com", area: "東京" },
    { shop_name: "品川夢見る乙女(ユメオト)", email: "job@yumeoto-tk.com", area: "東京" },
    { shop_name: "上野デリヘル倶楽部", email: "uenodelihelclub@gmail.com", area: "東京" },
    { shop_name: "金の玉クラブ池袋～密着睾丸マッサージ", email: "recruit.goldball@gmail.com", area: "東京" },
    { shop_name: "OTONA JOSHI 錦糸町", email: "job@kinshicho.o-joshi.tokyo", area: "東京" },
    { shop_name: "八王子 アロマガーデン", email: "y0806676xxxx@ezweb.ne.jp", area: "東京" },
    { shop_name: "奥様はエンジェル立川(エンジェルライングループ)", email: "info@okusama-angel.jp", area: "東京" },
    { shop_name: "人妻・若妻 レディプレイス", email: "ookubo.epron.03@gmail.com", area: "東京" },
    { shop_name: "品川CELINE(セリーヌ)", email: "info@shinagawa-celine.com", area: "東京" },
    { shop_name: "KODOKU（コドク）", email: "deep.sea0055@gmail.com", area: "東京" },
    { shop_name: "濃厚 即19妻(秋コスグループ)", email: "rct@19tuma.com", area: "東京" },
    { shop_name: "丸妻町田店", email: "leakyujin@gmail.com", area: "東京" },
    { shop_name: "DEVIANCE(ディビアンス)", email: "info@deviance.tokyo", area: "東京" },
    { shop_name: "THE MUSE", email: "mu3@muse2022.jp", area: "東京" },
    { shop_name: "全裸にされた女たちor欲しがり痴漢電車", email: "zenragp.office.staff@gmail.com", area: "東京" },
    { shop_name: "渋谷とある風俗店やりすぎコレクション", email: "yarisugicollection@gmail.com", area: "東京" },
    { shop_name: "しろうと娘in新宿", email: "shinjyuku-shirouto@docomo.ne.jp", area: "東京" },
    { shop_name: "渋谷現役女子大生図鑑", email: "info@siroutojosidaisei.com", area: "東京" },
    { shop_name: "Made In Japan", email: "mj3@mij-escorts.jp", area: "東京" },
    { shop_name: "THC Group", email: "thc2.shinjuku@gmail.com", area: "東京" },
    { shop_name: "東京♂風俗の神様 町田・相模原店", email: "info@of-nightwork-qjin.com", area: "東京" },
    { shop_name: "纏Classic", email: "info@matoi-classic.jp", area: "東京" },
    { shop_name: "E+アイドルスクール新宿・歌舞伎町店", email: "edol.shinjuku@gmail.com", area: "東京" },
    { shop_name: "Delice(デリス)渋谷店", email: "delice.koyama@gmail.com", area: "東京" },
    { shop_name: "CLUB FOCUS 渋谷", email: "info@focus-shibuya.jp", area: "東京" },
    { shop_name: "熟女道楽 小岩店", email: "info@jukujodoraku.com", area: "東京" },
    { shop_name: "錦糸町ちゃんこ", email: "kinshichochankolove@gmail.com", area: "東京" },
    { shop_name: "ぽっちゃり巨乳素人専門店ぷにめろ池袋", email: "punimelo.ikebukuro@gmail.com", area: "東京" },
    { shop_name: "新宿ミセスアロマ(ユメオト)", email: "job@sj-mrs.com", area: "東京" },
    { shop_name: "ぽっちゃり巨乳素人専門店ぷにめろ蒲田", email: "punimelo.kamata@gmail.com", area: "東京" },
    { shop_name: "熟女の風俗最終章 池袋店", email: "info@saisyuusyou-ikebukuro.com", area: "東京" },
    { shop_name: "マネLOVE", email: "recruit@fuzoku-lovegrp.net", area: "東京" },
    { shop_name: "CCキャッツ", email: "c.c.cats1981@gmail.com", area: "東京" },
    { shop_name: "八王子ペロンチョ学園", email: "hachiouji.pero@gmail.com", area: "東京" },
    { shop_name: "ピュアエンジェル(エンジェルライングループ)", email: "info@pureangel.jp", area: "東京" },
    { shop_name: "月経仮面", email: "wgoodjob@dune.ocn.ne.jp", area: "東京" },
    { shop_name: "E+アイドルスクール(E+グループ)", email: "eplus.idol.school@gmail.com", area: "東京" },
    { shop_name: "本格メンズエステ 禅～ZEN～", email: "info@zen-kinshicho.com", area: "東京" },
    { shop_name: "やみつきエステ錦糸町店", email: "yamitsuki1213@gmail.com", area: "東京" },
    { shop_name: "おいしい人妻熟女", email: "info@okusama.jp", area: "東京" },
    { shop_name: "性春放課後スクワット五反田編", email: "cast@peroncho92gotanda.com", area: "東京" },
    { shop_name: "丸妻池袋店", email: "g4-kyuzin@more-g.jp", area: "東京" },
    { shop_name: "Themis", email: "themisginza@icloud.com", area: "東京" },
    { shop_name: "品川ミセスアロマ(ユメオト)", email: "job@tk-mrs.com", area: "東京" },
    { shop_name: "立川人妻研究会", email: "info@hitoduma-tachikawa.com", area: "東京" },
    { shop_name: "クンニ専門店おクンニ学園池袋・大宮校", email: "rec.okuni@gmail.com", area: "東京" },
    { shop_name: "白いぽっちゃりさん 錦糸町店", email: "rct@kinshicho-siropocha.jp", area: "東京" },
    { shop_name: "tryst", email: "t_gyo_mu@icloud.com", area: "東京" },
    { shop_name: "白いぽっちゃりさん 五反田店", email: "rct@gotanda-siropocha.jp", area: "東京" },
    { shop_name: "錦糸町人妻花壇（モアグループ）", email: "ju-recruit@more-g.jp", area: "東京" },
    { shop_name: "ピュアセレクラブ錦糸町", email: "pureselection0420@yahoo.co.jp", area: "東京" },
    { shop_name: "ＭＳＣ妄想紳士倶楽部 鶯谷店", email: "rct@msc-ugu.jp", area: "東京" },
    { shop_name: "やりすぎさーくる新宿大久保店", email: "genba.4035@gmail.com", area: "東京" },
    { shop_name: "妊婦母乳風俗専門店ミルクランド", email: "milkland2@yahoo.co.jp", area: "東京" },
    { shop_name: "しろうと娘in秋葉原", email: "akiba-shirouto@docomo.ne.jp", area: "東京" },
    { shop_name: "恋するセレブ 立川店", email: "dh.celeb@gmail.com", area: "東京" },
    { shop_name: "BBW 五反田店", email: "info@gotanda-bbw.net", area: "東京" },
    { shop_name: "パールドロップ銀座", email: "staff@gotanda.me", area: "東京" },
    { shop_name: "THC SHINJUKU", email: "thc.shinjuku@gmail.com", area: "東京" },
    { shop_name: "銀座セレブ", email: "recruit@ginza-celeb.com", area: "東京" },
    { shop_name: "東京不倫 渋谷店", email: "tokyooffice.shibuya@gmail.com", area: "東京" },
    { shop_name: "五反田M性感フェチ倶楽部マスカレード", email: "3pl.saiyou@gmail.com", area: "東京" },
    { shop_name: "東京ららら", email: "support@t-lalala.net", area: "東京" },
    { shop_name: "マダムアシュレイ麻布", email: "madameashleymail@gmail.com", area: "東京" },
    { shop_name: "Eureka!EGOISTエゴイスト-美とエロスの饗宴", email: "egoist.group.hachiouji88@gmail.com", area: "東京" },
    { shop_name: "E+アイドルスクール品川店(E+グループ)", email: "edol.gotanda@gmail.com", area: "東京" },
    { shop_name: "99 Memories", email: "99memories802@gmail.com", area: "東京" },
    { shop_name: "上野M性感フェチ倶楽部 インサニティ東京", email: "info@insanity-tokyo.com", area: "東京" },
    { shop_name: "池袋東口添い寝女子", email: "rct@ikesoine.com", area: "東京" },
    { shop_name: "性の極み 技の伝道師 五反田店", email: "seiden.kiwami.gotanda@gmail.com", area: "東京" },
    { shop_name: "僕のぽっちゃり伝説", email: "info@bokupocha.com", area: "東京" },
    { shop_name: "町田相模原ちゃんこ(ちゃんこグループ)", email: "machida.chanko@gmail.com", area: "東京" },
    { shop_name: "e-body-イーボディ-", email: "info@menseste-gotanda.com", area: "東京" },
    { shop_name: "ハーモニー", email: "mail@club-harmony.com", area: "東京" },
    { shop_name: "池袋ギャルデリ", email: "ecg9004@yahoo.co.jp", area: "東京" },
    { shop_name: "エピソード", email: "episodejob@docomo.ne.jp", area: "東京" },
    { shop_name: "ぽっちゃり巨乳素人専門店ぷにめろ渋谷", email: "punimelo.shibuya@gmail.com", area: "東京" },
    { shop_name: "Unmoral～アンモラル～", email: "recruit@unmoral.jp", area: "東京" },
    { shop_name: "渋谷ラブストーリー（ユメオト）", email: "job@sb.lv-story.com", area: "東京" },
    { shop_name: "アバンチュール", email: "aventure.job@docomo.ne.jp", area: "東京" },
    { shop_name: "熟女紹介センター", email: "exlsp2009@gmail.com", area: "東京" },
    { shop_name: "新宿アロマ＆スイート アラマンダ", email: "ookubo_nyanda@yahoo.co.jp", area: "東京" },
    { shop_name: "町田ラ・ムーン", email: "info@club-lamoon.com", area: "東京" },
    { shop_name: "池袋高級アロマメンズエステ ALLAMANDA-アラマンダ-", email: "ike.allamandarec@gmail.com", area: "東京" },
    { shop_name: "いちゃいちゃ素人パパ活女子", email: "popantingu1031@outlook.com", area: "東京" },
    { shop_name: "フィーリングループ（厚木エリア）", email: "info@feeling-atsugi.com", area: "神奈川" },
    { shop_name: "グランドオペラ横浜", email: "recruit@y-opera.com", area: "神奈川" },
    { shop_name: "横浜人妻セレブリティ(ユメオト)", email: "job@yk-celeb.com", area: "神奈川" },
    { shop_name: "abc+", email: "abcatsugi@gmail.com", area: "神奈川" },
    { shop_name: "One More 奥様 横浜関内店", email: "info1oku@gmail.com", area: "神奈川" },
    { shop_name: "フィーリングin横浜", email: "info.feeling2008@gmail.com", area: "神奈川" },
    { shop_name: "熟女10000円デリヘル", email: "info@j1g-045.com", area: "神奈川" },
    { shop_name: "4Cグループ横浜", email: "info@4c-group.net", area: "神奈川" },
    { shop_name: "One More 奥様 厚木店", email: "atsugi.office@gmail.com", area: "神奈川" },
    { shop_name: "恋する人妻", email: "realg9009@gmail.com", area: "神奈川" },
    { shop_name: "横浜関内人妻城", email: "kyujin-kannai@more-g.jp", area: "神奈川" },
    { shop_name: "性の極み技の伝道師Ver.新横浜店", email: "k.yokohama8.27@gmail.com", area: "神奈川" },
    { shop_name: "横浜人妻ヒットパレード(シンデレラグループ)", email: "rct@tsuma-parade.jp", area: "神奈川" },
    { shop_name: "ぐっすり山田 横浜店", email: "g_yokohama_job@star-group.co.jp", area: "神奈川" },
    { shop_name: "LOVE横浜店(Iグループ)", email: "yokohama.love@yahoo.ne.jp", area: "神奈川" },
    { shop_name: "♡横浜デリヘル♡LaRouge", email: "job@larouge.jp", area: "神奈川" },
    { shop_name: "横浜回春性感マッサージ倶楽部", email: "k_yokohama_job@star-group.co.jp", area: "神奈川" },
    { shop_name: "熟女の風俗最終章 本厚木店", email: "kyuuzin.atsugi@gmail.com", area: "神奈川" },
    { shop_name: "奥鉄オクテツ神奈川店", email: "derikyu-kanagawa@dh2020.jp", area: "神奈川" },
    { shop_name: "横浜シンデレラ（シンデレラグループ）", email: "rct@y-cin.jp", area: "神奈川" },
    { shop_name: "ごほうびSPA横浜店", email: "gohoubi_yokohama_job@star-group.co.jp", area: "神奈川" },
    { shop_name: "熟女の風俗最終章 新横浜店", email: "shinyoko.kyujin@gmail.com", area: "神奈川" },
    { shop_name: "横浜駅前M性感rooM", email: "yokohama-room@ezweb.ne.jp", area: "神奈川" },
    { shop_name: "ちぇっくいん横浜女学園", email: "recruit@yokohama-j.com", area: "神奈川" },
    { shop_name: "～それいけヤリスギ学園～横浜校", email: "yarisugi363@gmail.com", area: "神奈川" },
    { shop_name: "メンヘラ専門デリヘルゼロワン横浜本店", email: "kyujin.yokohama045@gmail.com", area: "神奈川" },
    { shop_name: "なめこ治療院（横浜ハレ系）", email: "yk-tekoki@harekei.com", area: "神奈川" },
    { shop_name: "Via横浜", email: "viayokohama@yahoo.co.jp", area: "神奈川" },
    { shop_name: "横浜コスプレデビュー(シンデレラグループ)", email: "rct@mm21-cin.jp", area: "神奈川" },
    { shop_name: "横浜モンデミーテ(シンデレラグループ)", email: "rct@hama-boin.com", area: "神奈川" },
    { shop_name: "横浜夢見る乙女(ユメオト)", email: "job@yumemiruotome.com", area: "神奈川" },
    { shop_name: "五十路マダムエクスプレス厚木店", email: "isoji.atsugi@au.com", area: "神奈川" },
    { shop_name: "Delice(デリス)横浜店", email: "delice.kyujin@gmail.com", area: "神奈川" },
    { shop_name: "やみつきエステ厚木店", email: "info.yamitsuki.atsugi@gmail.com", area: "神奈川" },
    { shop_name: "BBW 横浜店", email: "bbw.yokohama@gmail.com", area: "神奈川" },
    { shop_name: "タイタニック", email: "taitanic@taitanic.net", area: "神奈川" },
    { shop_name: "川崎人妻城", email: "shiro-kawasaki@e4u.co.jp", area: "神奈川" },
    { shop_name: "こあくまな熟女たち 相模原・橋本店", email: "recruit_girls_kg@koakumagroup.com", area: "神奈川" },
    { shop_name: "Lovely", email: "fujisawadokidoki@gmail.com", area: "神奈川" },
    { shop_name: "虹色メロンパイ 横浜店", email: "melon-banira@yokohama.pie-gr.com", area: "神奈川" },
    { shop_name: "私立にじいろ女学園～横浜校～", email: "nijiirojo@gmail.com", area: "神奈川" },
    { shop_name: "横浜プラチナ(ユメオト)", email: "job-yk@pln.jp", area: "神奈川" },
    { shop_name: "人妻小旅行～アバンチュール～", email: "info@hs-aventure.com", area: "神奈川" },
    { shop_name: "横浜泡洗体デラックスエステ", email: "recruit@yokohama-deluxe.com", area: "神奈川" },
    { shop_name: "ぷよラブ れぼりゅ～しょん", email: "info@winning-group.jp", area: "神奈川" },
    { shop_name: "厚木OL委員会", email: "atsugi-ol@venus-atsugi.com", area: "神奈川" },
    { shop_name: "ザ・シークレット", email: "info@secret-sm.com", area: "神奈川" },
    { shop_name: "奥様はエンジェル相模原(エンジェルライングループ)", email: "sagamihara@okusama-angel.net", area: "神奈川" },
    { shop_name: "La Pace（ラパーチェ）", email: "ylfnjz8310@yahoo.co.jp", area: "神奈川" },
    { shop_name: "厚木メンズエステm", email: "info@nanaplaza.jp", area: "神奈川" },
    { shop_name: "OLIVE SPA 横浜店", email: "olive.job12@gmail.com", area: "神奈川" },
    { shop_name: "人妻熟女の秘密の関係 新横浜店", email: "sinyokohama.himitunokankei@gmail.com", area: "神奈川" },
    { shop_name: "ちゃんこ本厚木店", email: "atugichanko@gmail.com", area: "神奈川" },
    { shop_name: "神奈川小田原ちゃんこ", email: "hiroki.baba17@gmail.com", area: "神奈川" },
    { shop_name: "Spicyな女たち", email: "spicy045@gmail.com", area: "神奈川" },
    { shop_name: "ちゃんこ藤沢茅ヶ崎店", email: "chanko.fujisawa@gmail.com", area: "神奈川" },
    { shop_name: "脱がされたい人妻 厚木店", email: "atg@saretuma.com", area: "神奈川" },
    { shop_name: "完熟ばなな横浜", email: "info@yokohama-banana.com", area: "神奈川" },
    { shop_name: "横浜魅惑の人妻", email: "info@yokohama-j-mrs.jp", area: "神奈川" },
    { shop_name: "ぽちゃカワ女子専門店 藤沢湘南店", email: "potyakawafujisawa@gmail.com", area: "神奈川" },
    { shop_name: "おクンニ学園横浜関内校", email: "okunnikannai@gmail.com", area: "神奈川" },
    { shop_name: "熟女待機所 厚木店", email: "info@j-taikijyo.com", area: "神奈川" },
    { shop_name: "神奈川★出張マッサージ委員会Z", email: "iinkaijob@gmail.com", area: "神奈川" },
    { shop_name: "Flower（フラワー）", email: "flowerdelivery.yokosuka@gmail.com", area: "神奈川" },
    { shop_name: "ほんつま 横浜本店", email: "info.hontsuma2008@gmail.com", area: "神奈川" },
    { shop_name: "五十路マダムEX横浜店", email: "yokoisojiex@docomo.ne.jp", area: "神奈川" },
    { shop_name: "横浜痴女性感フェチ倶楽部", email: "c_yokohama_job@star-group.co.jp", area: "神奈川" },
    { shop_name: "Mrs.Revoir-ミセスレヴォアール-", email: "information@mrs-revoir.com", area: "神奈川" },
    { shop_name: "フィーリングループ（柏エリア", email: "info@hontsuma-kashiwa.com", area: "千葉" },
    { shop_name: "わちゃわちゃ密着リアルフルーちゅ西船橋", email: "job@nf.kitty-s.net", area: "千葉" },
    { shop_name: "One More 奥様 西船橋店", email: "nishifuna1more@gmail.com", area: "千葉" },
    { shop_name: "千葉人妻セレブリティ(ユメオト)", email: "job@cb-celeb.com", area: "千葉" },
    { shop_name: "T-BACKS てぃ～ばっくす栄町店", email: "goldharlem@yahoo.co.jp", area: "千葉" },
    { shop_name: "千葉人妻花壇（モアグループ）", email: "mirise-recruit@more-g.jp", area: "千葉" },
    { shop_name: "キャンパスサミットグループ", email: "cansami3366@yahoo.co.jp", area: "千葉" },
    { shop_name: "まつど女学園", email: "job@image-club.jp", area: "千葉" },
    { shop_name: "千葉メイドリーム(ユメオト)", email: "job@cb-maid.com", area: "千葉" },
    { shop_name: "One More 奥様 松戸店", email: "matsudo1more@gmail.com", area: "千葉" },
    { shop_name: "やみつきエステ千葉栄町店", email: "yamitsukio41@gmail.com", area: "千葉" },
    { shop_name: "ワンダーホール24", email: "wonderholerecruit@ezweb.ne.jp", area: "千葉" },
    { shop_name: "千葉プラチナ(ユメオト)", email: "job@pln.jp", area: "千葉" },
    { shop_name: "即イキ淫乱倶楽部 松戸店", email: "active.group0055.com@gmail.com", area: "千葉" },
    { shop_name: "千葉サンキュー", email: "happy.camper@live.jp", area: "千葉" },
    { shop_name: "ごほうびSPA千葉店", email: "gohoubi_chiba_job@star-group.co.jp", area: "千葉" },
    { shop_name: "千葉 快楽M性感倶楽部", email: "k.cont.joboffer@gmail.com", area: "千葉" },
    { shop_name: "素人妻御奉仕倶楽部Hip's松戸店", email: "info@hips-matsudo.jp", area: "千葉" },
    { shop_name: "千葉boobs !～ 巨乳専門店～", email: "tfs.sakae@gmail.com", area: "千葉" },
    { shop_name: "エスッテ×エスッテ(ネロスグループ)", email: "recruit@neros-gr.com", area: "千葉" },
    { shop_name: "究極の素人専門店Alice -アリス-", email: "alice-funabashi@inertennis.co.jp", area: "千葉" },
    { shop_name: "船橋ガマン汁天国手コキ百華店", email: "info@tekoki100.tokyo", area: "千葉" },
    { shop_name: "姉新地 船橋本店", email: "info@anesinchi.email", area: "千葉" },
    { shop_name: "合同会社e-ascent", email: "cansamichiba2021@gmail.com", area: "千葉" },
    { shop_name: "夢幻", email: "info@kashiwa-mugen.com", area: "千葉" },
    { shop_name: "レッドダイヤ", email: "info@kamisu-deli.com", area: "千葉" },
    { shop_name: "OTONA JOSHI 千葉", email: "job@chiba.o-joshi.tokyo", area: "千葉" },
    { shop_name: "コスプレ戦隊ヌケルンジャー", email: "asatoihigami@gmail.com", area: "千葉" },
    { shop_name: "千葉はじめてのエステ(ユメオト)", email: "job@hajies-c.com", area: "千葉" },
    { shop_name: "オズ 千葉栄町店", email: "ozsakae01@gmail.com", area: "千葉" },
    { shop_name: "奥様プリモ", email: "matsudo-primo@outlook.jp", area: "千葉" },
    { shop_name: "千葉泡洗体デラックスエステ", email: "recruit@chiba-deluxe.com", area: "千葉" },
    { shop_name: "シルキーグループ", email: "hitodumanohimitu.narita@gmail.com", area: "千葉" },
    { shop_name: "ちょい！ぽちゃロリ倶楽部Hip's馬橋店", email: "info@hips-pm.com", area: "千葉" },
    { shop_name: "千葉ミセスアロマ(ユメオト)", email: "job@cb-mrs.com", area: "千葉" },
    { shop_name: "E+アイドルスクール船橋店(E+グループ)", email: "edol.funabashi@gmail.com", area: "千葉" },
    { shop_name: "西船橋 ムンムン熟女妻", email: "info@million-job.net", area: "千葉" },
    { shop_name: "ぽっちゃり巨乳素人専門ぷにめろ西船橋", email: "punimelo.nishihunabashi@gmail.com", area: "千葉" },
    { shop_name: "千葉ミニスカM性感学園", email: "info@sm-japan.com", area: "千葉" },
    { shop_name: "千葉栄町ムンムン熟女妻", email: "sakae@munmunjyukujyo.net", area: "千葉" },
    { shop_name: "巨乳専門 木更津君津ちゃんこin千葉", email: "kisarazu.chanko@gmail.com", area: "千葉" },
    { shop_name: "即イキ淫乱倶楽部 木更津店", email: "kisarazu.active0055@gmail.com", area: "千葉" },
    { shop_name: "人妻楼 木更津店", email: "kisarazu-star@ezweb.ne.jp", area: "千葉" },
    { shop_name: "One More 奥様 千葉店", email: "chiba1more@gmail.com", area: "千葉" },
    { shop_name: "癒したくて成田店～日本人アロマ性感～", email: "i.cont.joboffer@gmail.com", area: "千葉" },
    { shop_name: "船橋ぽちゃドル学園", email: "info@funabashi-pochadol.com", area: "千葉" },
    { shop_name: "船橋SMクラブ女王様の館", email: "info@chiba-smclub.com", area: "千葉" },
    { shop_name: "ラブセレクション", email: "info@love-sele.com", area: "千葉" },
    { shop_name: "幕張・船橋競馬場ちゃんこ", email: "makuhari.chanko@gmail.com", area: "千葉" },
    { shop_name: "脱がされたい人妻 成田店", email: "narita@saretuma.com", area: "千葉" },
    { shop_name: "千葉★出張マッサージ委員会Z", email: "tsm.ashida@gmail.com", area: "千葉" },
    { shop_name: "まつど回春エステ", email: "momoiro1919@gmail.com", area: "千葉" },
    { shop_name: "松戸デリヘル 熟女ヘブン", email: "m1914heaven@outlook.jp", area: "千葉" },
    { shop_name: "成田富里インターちゃんこ", email: "naritatomisato.chanko@gmail.com", area: "千葉" },
    { shop_name: "人妻快速", email: "kaisokuhitozuma@gmail.com", area: "千葉" },
    { shop_name: "千葉人妻最高級倶楽部", email: "cb_recruit@vip-madame.com", area: "千葉" },
    { shop_name: "素人巨乳ちゃんこ「東千葉店」", email: "chiba.chanko@gmail.com", area: "千葉" },
    { shop_name: "千葉松戸ちゃんこ", email: "chanko.matsudo@gmail.com", area: "千葉" },
    { shop_name: "天使のゆびさき船橋店", email: "tenyubifuna@au.com", area: "千葉" },
    { shop_name: "セクハラ商事 成田店", email: "sekuhara.narita@gmail.com", area: "千葉" },
    { shop_name: "恋せよ乙女", email: "otomekashiwa@gmail.com", area: "千葉" },
    { shop_name: "セクハラ商事 柏店", email: "sekuhara.kashiwa@gmail.com", area: "千葉" },
    { shop_name: "BBW 西船橋店", email: "info@nishifunabashi-bbw.net", area: "千葉" },
    { shop_name: "船橋・西船橋ちゃんこ", email: "hunabashi.chanko@gmail.com", area: "千葉" },
    { shop_name: "人妻の出会い", email: "info@hitozuma-deai.net", area: "千葉" },
    { shop_name: "成田人妻最高級倶楽部", email: "nr@vip-madame.com", area: "千葉" },
    { shop_name: "千葉中央人妻援護会", email: "chibachuo.he@gmail.com", area: "千葉" },
    { shop_name: "柏OL委員会", email: "venuskashiwa@icloud.com", area: "千葉" },
    { shop_name: "もも尻 本店", email: "naritabbg@gmail.com", area: "千葉" },
    { shop_name: "五十路マダムEX船橋店", email: "funaiso@docomo.ne.jp", area: "千葉" },
    { shop_name: "セカンドハウス", email: "nmisesu3@yahoo.co.jp", area: "千葉" },
    { shop_name: "ぽっちゃりきぶん", email: "rouge123kibun@gmail.com", area: "千葉" },
    { shop_name: "ベストマダム", email: "bestmadam2022@gmail.com", area: "千葉" },
    { shop_name: "千葉北インターちゃんこ", email: "chanko.chibakita@gmail.com", area: "千葉" },
    { shop_name: "人妻ネットワーク さいたま～大宮編", email: "saitama@deai-tuma.net", area: "埼玉" },
    { shop_name: "若妻淫乱倶楽部", email: "womansstyle.k@gmail.com", area: "埼玉" },
    { shop_name: "ミセス ファースト", email: "mrsfirst.koshigaya.smile@gmail.com", area: "埼玉" },
    { shop_name: "One More 奥様 大宮店", email: "omiya1more@gmail.com", area: "埼玉" },
    { shop_name: "セレブクエスト-omiya-", email: "omiya.kyujin@y-dgroup.com", area: "埼玉" },
    { shop_name: "マリアージュ大宮(KDグループ)", email: "kdgroupworks1300@gmail.com", area: "埼玉" },
    { shop_name: "ラブリップ 川越店", email: "kawagoe.lovelip@gmail.com", area: "埼玉" },
    { shop_name: "One More 奥様 西川口店", email: "nishikawa1more@gmail.com", area: "埼玉" },
    { shop_name: "マリアージュ熊谷(KDグループ)", email: "kumagayaseita1130@gmail.com", area: "埼玉" },
    { shop_name: "僕らのぽっちゃリーノin春日部", email: "potyakawastyle@gmail.com", area: "埼玉" },
    { shop_name: "若妻淫乱倶楽部 久喜店", email: "womansstyle.kuki@gmail.com", area: "埼玉" },
    { shop_name: "川越人妻花壇（モアグループ）", email: "kyuzin-kawagoe@h-kadan.com", area: "埼玉" },
    { shop_name: "大人の遊園地 大宮店", email: "yuuenchiotona@yahoo.co.jp", area: "埼玉" },
    { shop_name: "洗体アカスリとHなスパのお店", email: "st-shampoo@harekei.com", area: "埼玉" },
    { shop_name: "TIANA", email: "tiana.boygroup@gmail.com", area: "埼玉" },
    { shop_name: "ミセスファースト 熊谷店", email: "mrsfirst.kumagaya.smile@gmail.com", area: "埼玉" },
    { shop_name: "大宮人妻セレブリティ(ユメオト)", email: "job@st-celeb.com", area: "埼玉" },
    { shop_name: "君とふわふわプリンセスin熊谷", email: "fuwapri@gmail.com", area: "埼玉" },
    { shop_name: "セレブクエスト-koshigaya-", email: "kosigaya.kyujin@y-dgroup.com", area: "埼玉" },
    { shop_name: "バニラシュガー 久喜店", email: "vanillasugar.jp@gmail.com", area: "埼玉" },
    { shop_name: "紳士の嗜み 大宮", email: "recruit.tashinami.omiya@gmail.com", area: "埼玉" },
    { shop_name: "埼玉西川口ショートケーキ(シンデレラグループ)", email: "rct@s-cin.jp", area: "埼玉" },
    { shop_name: "M＆m Maidとm男の夢物語", email: "mandom@softbank.ne.jp", area: "埼玉" },
    { shop_name: "人妻倶楽部 内緒の関係 大宮店", email: "pfgomiya.rec@gmail.com", area: "埼玉" },
    { shop_name: "埼玉メイドリーム(ユメオト)", email: "job@st-maid.com", area: "埼玉" },
    { shop_name: "脱がされたい人妻 越谷店", email: "koshigaya@saretuma.com", area: "埼玉" },
    { shop_name: "西川口ぷよステーション", email: "puyo.station2025@gmail.com", area: "埼玉" },
    { shop_name: "埼玉プラチナスタイル(ユメオト)", email: "job@st-pltn.com", area: "埼玉" },
    { shop_name: "クンニ専門店おクンニ学園池袋・大宮校", email: "okunnioomiya@gmail.com", area: "埼玉" },
    { shop_name: "イキなり生彼女from大宮", email: "o9o93677891@yahoo.co.jp", area: "埼玉" },
    { shop_name: "越谷発デリヘル 生イキッ娘!", email: "0xk32202388222s@au.com", area: "埼玉" },
    { shop_name: "西川口人妻城", email: "nishikawajooo@more-g.jp", area: "埼玉" },
    { shop_name: "美熟女倶楽部Hip's春日部店", email: "info@hips-jk.com", area: "埼玉" },
    { shop_name: "Hip's越谷店（Hip's-group）", email: "info@hips.jp", area: "埼玉" },
    { shop_name: "ぼくらのデリヘルランドin春日部・久喜店", email: "info@bokuderi-kuki.com", area: "埼玉" },
    { shop_name: "美熟女倶楽部Hip's西川口店", email: "info@hips-nishikawa.jp", area: "埼玉" },
    { shop_name: "FAIRY大宮", email: "fairygruop@gmail.com", area: "埼玉" },
    { shop_name: "ラブライフ", email: "saitama@love-life.jp", area: "埼玉" },
    { shop_name: "君とふわふわプリンセスin西川口", email: "fuwa.nishikawa@gmail.com", area: "埼玉" },
    { shop_name: "Honey Bee（ハニービー）", email: "honeybee@room.ocn.ne.jp", area: "埼玉" },
    { shop_name: "君とサプライズ学園～越谷校", email: "teamsurprise2015@gmail.com", area: "埼玉" },
    { shop_name: "女の子市場 川越店", email: "info@onnanoko-ichiba-kawagoe.net", area: "埼玉" },
    { shop_name: "BBW 西川口店", email: "nkbbw888@docomo.ne.jp", area: "埼玉" },
    { shop_name: "美妻川越 ～熟女との時間～", email: "bisai.kawagoe.0500@gmail.com", area: "埼玉" },
    { shop_name: "Porn HAREM 熊谷店", email: "porn.harem.kumagaya@gmail.com", area: "埼玉" },
    { shop_name: "Candy Style", email: "candystyle0611@gmail.com", area: "埼玉" },
    { shop_name: "西川口淑女館", email: "info.shukujo.kan@gmail.com", area: "埼玉" },
    { shop_name: "熊谷ぽちゃカワ女子専門店", email: "kumagaya.shop9@gmail.com", area: "埼玉" },
    { shop_name: "MUGEN", email: "info@ugen-deli.com", area: "埼玉" },
    { shop_name: "ハレンチ熟女 西川口店", email: "job@harejuku-nk.com", area: "埼玉" },
    { shop_name: "熊谷スキャンダル", email: "scandalkumagaya@gmail.com", area: "埼玉" },
    { shop_name: "BBW大宮", email: "omybbw0038@gmail.com", area: "埼玉" },
    { shop_name: "Muse（ミューズ）", email: "muse@world.ocn.ne.jp", area: "埼玉" },
    { shop_name: "Honey Bee(ハニービー) West川越", email: "kawagoehoney@icloud.com", area: "埼玉" },
    { shop_name: "春日部人妻花壇", email: "tssoryushonzu@gmail.com", area: "埼玉" },
    { shop_name: "埼玉熊谷ちゃんこ", email: "saitamakumagaya.chanko55@gmail.com", area: "埼玉" },
    { shop_name: "所沢東村山ちゃんこ", email: "officegg.222@gmail.com", area: "埼玉" },
    { shop_name: "君とふわふわプリンセスin川越", email: "wisteriafive555@gmail.com", area: "埼玉" },
    { shop_name: "人妻こゆびの約束久喜店", email: "job@koyubinoyakusoku.com", area: "埼玉" },
    { shop_name: "エッチな熟女", email: "info@extuti-zyukuzyo.com", area: "埼玉" },
    { shop_name: "完熟ばなな 大宮店", email: "info@oomiya-banana.com", area: "埼玉" },
    { shop_name: "君とふわふわプリンセスin本庄", email: "honjo.fuwapuri@gmail.com", area: "埼玉" },
    { shop_name: "Love&Republic（ラブ＆リパブリック）", email: "loveandrepublic@docomo.ne.jp", area: "埼玉" },
    { shop_name: "人妻ネットワーク 小江戸・川越", email: "p0wg95cmchi66ffet9wd@docomo.ne.jp", area: "埼玉" },
    { shop_name: "埼玉ちゅっぱ大宮店", email: "office@ccgroup.jp", area: "埼玉" },
    { shop_name: "coin d amour ～愛の片隅～", email: "info1@m-cda.com", area: "埼玉" },
    { shop_name: "凄いよビンビンパラダイス", email: "oomiyazimusho@gmail.com", area: "埼玉" },
    { shop_name: "ヘルス24本庄店", email: "h24g.honjo@gmail.com", area: "埼玉" },
    { shop_name: "本庄人妻城", email: "shiro-honjo@of-gbl.com", area: "埼玉" },
    { shop_name: "越谷熟女デリヘル マダムエプロン", email: "koshideli-renraku@koshideli.com", area: "埼玉" },
    { shop_name: "熊谷 熟女の達人", email: "jukujo.no.tatsujin@gmail.com", area: "埼玉" },
    { shop_name: "西川口デリバリー セカンドストーリー", email: "sec.story.nishikawaguchi@gmail.com", area: "埼玉" },
    { shop_name: "川越 熟女の達人", email: "wisteria.five555@gmail.com", area: "埼玉" },
    { shop_name: "ハプニング熊谷店", email: "reo.y0925@gmail.com", area: "埼玉" },
    { shop_name: "ｍSS 僕と2人の御主人様達", email: "mandm_maid@yahoo.co.jp", area: "埼玉" },
    { shop_name: "ぱんだ本店(川越・大宮)", email: "mura24panda@gmail.com", area: "埼玉" },
    { shop_name: "お取り寄せスイーツ 女の子市場", email: "omiya@onnanoko-ichiba.net", area: "埼玉" },
    { shop_name: "久喜鷲宮ちゃんこ", email: "chanko0503@gmail.com", area: "埼玉" },
    { shop_name: "脱がされたい人妻 春日部店", email: "kasukabe@saretuma.com", area: "埼玉" },
    { shop_name: "ふわふわコレクション川越店", email: "fuwakorekawagoe1@gmail.com", area: "埼玉" },
    { shop_name: "フェアリードール", email: "staff@f-doll.com", area: "埼玉" },
    { shop_name: "大宮逆マッサージ", email: "gyakuma.job@gmail.com", area: "埼玉" },
    { shop_name: "大人生活 熊谷", email: "info@otona-kumagaya.com", area: "埼玉" },
    { shop_name: "埼玉越谷ちゃんこ", email: "saitamakoshigayachanko@gmail.com", area: "埼玉" },
    { shop_name: "New Romance（ニューロマンス）", email: "skyskysky1200@gmail.com", area: "埼玉" },
    { shop_name: "密着体温37.5℃", email: "taion37.5@ymail.ne.jp", area: "埼玉" },
    { shop_name: "所沢デリヘル桜", email: "td-sakura@samba.ocn.ne.jp", area: "埼玉" },
    { shop_name: "AZUL 本庄", email: "azul.honjo@gmail.com", area: "埼玉" },
    { shop_name: "所沢人妻援護会", email: "qjin-t@o-n-e.jp", area: "埼玉" },
    { shop_name: "ふわふわコレクション川越店", email: "fuwakore@gmail.com", area: "埼玉" },
    { shop_name: "変態美熟女お貸しします。", email: "staff@hentai-bijyukujyo.com", area: "埼玉" },
    { shop_name: "可憐な妻とアロマセラピストたち", email: "karen4976honjyou@gmail.com", area: "埼玉" },
    { shop_name: "Moist八戸", email: "moist8@docomo.ne.jp", area: "青森" },
    { shop_name: "アイドル", email: "idol-8@docomo.ne.jp", area: "青森" },
    { shop_name: "My Lover八戸", email: "mylover8@docomo.ne.jp", area: "青森" },
    { shop_name: "青森人妻デリヘル 桃屋", email: "niihara7010@gmail.com", area: "青森" },
    { shop_name: "出張手コキ＆エステ コキっ娘クローバー", email: "aomori1397@gmail.com", area: "青森" },
    { shop_name: "A-girl's", email: "a-girls0329@docomo.ne.jp", area: "青森" },
    { shop_name: "ANON-アノン", email: "s52@au.com", area: "青森" },
    { shop_name: "REAL盛岡店", email: "real-iwate@ezweb.ne.jp", area: "青森" },
    { shop_name: "G-1", email: "g1.deri0178@gmail.com", area: "青森" },
    { shop_name: "Lime* 青森県の大型トップブランド", email: "lgjob@docomo.ne.jp", area: "青森" },
    { shop_name: "人妻倶楽部 花椿盛岡店", email: "juicy-job@softbank.ne.jp", area: "岩手" },
    { shop_name: "人妻の極み マドンナ盛岡店", email: "madonna-iwate@docomo.ne.jp", area: "岩手" },
    { shop_name: "しゅうくりぃむ", email: "ahaufuehe@ezweb.ne.jp", area: "岩手" },
    { shop_name: "Breaking Spa", email: "breaking0001@icloud.com", area: "岩手" },
    { shop_name: "岩手人妻・熟女デリヘルプレイシス", email: "playses@ezweb.ne.jp", area: "岩手" },
    { shop_name: "Juicy kiss北上", email: "kita.azarasi@i.softbank.jp", area: "岩手" },
    { shop_name: "Love Rose", email: "s.y.m.r1230@icloud.com", area: "岩手" },
    { shop_name: "LAVIAN", email: "lavian.morioka1000@gmail.com", area: "岩手" },
    { shop_name: "Aroma the Essential", email: "team.noa.xxx@gol.com", area: "岩手" },
    { shop_name: "バニーコレクション秋田", email: "bunnycolleakita@gmail.com", area: "秋田" },
    { shop_name: "テコキッシュ", email: "tekokish@gmail.com", area: "山形" },
    { shop_name: "ディアイズム", email: "d08018445659@docomo.ne.jp", area: "山形" },
    { shop_name: "GRAND DIAMOND-グランドダイヤモンド-", email: "granddiamond5111@docomo.ne.jp", area: "山形" },
    { shop_name: "デリっ娘。山形店", email: "yamagata.allone@docomo.ne.jp", area: "山形" },
    { shop_name: "44 heart ～ヨンヨンハート～", email: "s44heart@au.com", area: "山形" },
    { shop_name: "至極 no AROMA", email: "459qzin@gmail.com", area: "山形" },
    { shop_name: "ライズアップ 山形店", email: "info@riseup.cc", area: "山形" },
    { shop_name: "Salus", email: "salussalus0622@gmail.com", area: "山形" },
    { shop_name: "さくらんぼ娘", email: "sakuranbomusume.t@gmail.com", area: "山形" },
    { shop_name: "Creation（クリエーション）", email: "c09060751509@docomo.ne.jp", area: "山形" },
    { shop_name: "デイトナ", email: "info@daytonagals.com", area: "山形" },
    { shop_name: "恋するラブセレブ", email: "koisurulovecelebymg@gmail.com", area: "山形" },
    { shop_name: "エレクション", email: "derikyujin@gmail.com", area: "山形" },
    { shop_name: "不倫くらぶ", email: "yamagata.furin.club1@gmail.com", area: "山形" },
    { shop_name: "LOVE DIVA-ラブディバ-", email: "lovediva911410@gmail.com", area: "山形" },
    { shop_name: "QT（キュート）", email: "info@qute-dane.com", area: "山形" },
    { shop_name: "S級鑑定団", email: "69ssg.job@gmail.com", area: "福島" },
    { shop_name: "風俗イキタイいわき店", email: "iwaki@y-dgroup.com", area: "福島" },
    { shop_name: "放課後ぴゅあらぶ", email: "purelove11250113@gmail.com", area: "福島" },
    { shop_name: "Mドグマ郡山店", email: "md.kooriyama@icloud.com", area: "福島" },
    { shop_name: "プレイガール+福島店", email: "w_group@icloud.com", area: "福島" },
    { shop_name: "KiRaRi", email: "kyujin.senyou@icloud.com", area: "福島" },
    { shop_name: "Crest", email: "tsuyotsuyo244105@gmail.com", area: "福島" },
    { shop_name: "GOOD DAYグループ", email: "goodday.recruit@gmail.com", area: "福島" },
    { shop_name: "アロマ＆アロマ福島", email: "goodday.fukushima@gmail.com", area: "福島" },
    { shop_name: "五十路マダム郡山店", email: "madam50-k@docomo.ne.jp", area: "福島" },
    { shop_name: "ぴーちゅプリンセス", email: "satoshi5814@gmail.com", area: "福島" },
    { shop_name: "愛の人妻 いわき", email: "rjsnasu@icloud.com", area: "福島" },
    { shop_name: "福島郡山ちゃんこ", email: "get_get_ski@yahoo.co.jp", area: "福島" },
    { shop_name: "OL精薬", email: "ol.seiyaku@ezweb.ne.jp", area: "福島" },
    { shop_name: "ドルフィン郡山", email: "dolphin.koriyama@gmail.com", area: "福島" },
    { shop_name: "福島駅前ちゃんこ", email: "hukushima.chanko@gmail.com", area: "福島" },
    { shop_name: "人妻倶楽部 花椿大崎店", email: "tsumasuki@docomo.ne.jp", area: "宮城" },
    { shop_name: "セレブガーデン", email: "info@celeb-garden.net", area: "宮城" },
    { shop_name: "熟女の風俗最終章 仙台店", email: "chapter0.send@gmail.com", area: "宮城" },
    { shop_name: "サンキュー仙台店", email: "thankyou.sendai@gmail.com", area: "宮城" },
    { shop_name: "仙台回春性感マッサージ倶楽部", email: "k_sendai_job@star-group.co.jp", area: "宮城" },
    { shop_name: "すごいエステ仙台店", email: "sugoi_sendai_job@star-group.co.jp", area: "宮城" },
    { shop_name: "SEINOKIWAMI", email: "seinokiwami@gmail.com", area: "宮城" },
    { shop_name: "WASUreNA勿忘", email: "recruit.sen2020@gmail.com", area: "宮城" },
    { shop_name: "夜間飛行 60分￥10,000", email: "olivekikaku4@gmail.com", area: "宮城" },
    { shop_name: "奥鉄オクテツ仙台店", email: "derikyu-sendai@dh2020.jp", area: "宮城" },
    { shop_name: "瀬音ゆかしき仙台妻", email: "mouri-m@i.softbank.jp", area: "宮城" },
    { shop_name: "Club JAM", email: "j.sendai@gmail.com", area: "宮城" },
    { shop_name: "ウープスグループ", email: "sakura.sdj@gmail.com", area: "宮城" },
    { shop_name: "隣の人妻お口で愛して", email: "la.cure7@gmail.com", area: "宮城" },
    { shop_name: "デリっ娘。石巻", email: "spgspg0703@gmail.com", area: "宮城" },
    { shop_name: "デリっ娘。 仙台店", email: "dc.sendai@gmail.com", area: "宮城" },
    { shop_name: "ロイヤル アテンダー", email: "attender102030@gmail.com", area: "宮城" },
    { shop_name: "Club Vogue-クラブヴォーグ-", email: "club-vogue@i.softbank.jp", area: "宮城" },
    { shop_name: "ろいやるくらぶ", email: "royalclub.secret@gmail.com", area: "宮城" },
    { shop_name: "素敵な女の子は好きですか？", email: "sutekisan5-mail@ezweb.ne.jp", area: "宮城" },
    { shop_name: "SAKURA石巻店", email: "sakura.isi0403@gmail.com", area: "宮城" },
    { shop_name: "秋葉原コスプレ学園in仙台", email: "akira.73266221@gmail.com", area: "宮城" },
    { shop_name: "夢-chu", email: "muchu_work@yahoo.co.jp", area: "宮城" },
    { shop_name: "仙台大人の秘密倶楽部", email: "sendaihimitu2015@yahoo.co.jp", area: "宮城" },
    { shop_name: "ゆらら", email: "yurara.1201y@gmail.com", area: "宮城" },
    { shop_name: "虹色メロンパイ", email: "melon-can@pie-gr.com", area: "宮城" },
    { shop_name: "石巻PLAYGIRL+", email: "pg.ishinomaki0715@icloud.com", area: "宮城" },
    { shop_name: "ディーノ 石巻店", email: "dino.job11@gmail.com", area: "宮城" },
    { shop_name: "Keep", email: "keep.sendai@gmail.com", area: "宮城" },
    { shop_name: "デリーズキュア", email: "info@deli-aso.com", area: "宮城" },
    { shop_name: "トップモデル", email: "topmodel1205@yahoo.co.jp", area: "宮城" },
    { shop_name: "ディーノ～会えるアイドル～", email: "excellent.shift@gmail.com", area: "宮城" },
    { shop_name: "ダンシングおっぱいTEAM爆", email: "kigarunimaildouzo@gmail.com", area: "宮城" },
    { shop_name: "人妻生レンタルNTR", email: "okuren-s@softbank.ne.jp", area: "宮城" },
    { shop_name: "ノア(NOA)", email: "job@noajob.com", area: "宮城" },
    { shop_name: "ごほうびSPA仙台店", email: "gohoubi_sendai_job@star-group.co.jp", area: "宮城" },
    { shop_name: "バニーオンデマンド", email: "9yoshi69@gmail.com", area: "宮城" },
    { shop_name: "オッジ", email: "job-oggi@au.com", area: "宮城" },
    { shop_name: "DRAMA-ドラマ-", email: "dmt.corporation224@gmail.com", area: "宮城" },
    { shop_name: "S-style club", email: "info@s-styleclub.com", area: "宮城" },
    { shop_name: "奥様メモリアル", email: "info@okumemo.com", area: "宮城" },
    { shop_name: "Juicy kiss 古川", email: "romance.device004@gmail.com", area: "宮城" },
    { shop_name: "プライベートレッスン", email: "info@p-lesson.net", area: "宮城" },
    { shop_name: "まりも治療院（札幌ハレ系）", email: "sp-marimo@harekei.com", area: "北海道" },
    { shop_name: "セレブリティコレクション", email: "tsr287@yahoo.co.jp", area: "北海道" },
    { shop_name: "宅配おねちゃんおかあさんおばあちゃん", email: "info@jmh.jp", area: "北海道" },
    { shop_name: "銀座セレブ札幌", email: "ginza.celeb.sapporo@gmail.com", area: "北海道" },
    { shop_name: "札幌回春性感マッサージ倶楽部", email: "k_sapporo_job@star-group.co.jp", area: "北海道" },
    { shop_name: "洗体アカスリとHなスパのお店", email: "sp-sentai@harekei.com", area: "北海道" },
    { shop_name: "人妻ネットワークグループ", email: "sapporo@deai-tuma.net", area: "北海道" },
    { shop_name: "ドMな奥さんススキノ", email: "susukinookusan@gmail.com", area: "北海道" },
    { shop_name: "LIONS OPERA ～高級エスコート～", email: "info@sap-lionsopera.eyesgroup.jp", area: "北海道" },
    { shop_name: "プルプル札幌性感エステはんなり", email: "puru-s@docomo.ne.jp", area: "北海道" },
    { shop_name: "どMばすたーず すすきの店", email: "bsusukino@gmail.com", area: "北海道" },
    { shop_name: "快楽堂", email: "k90901234@docomo.ne.jp", area: "北海道" },
    { shop_name: "ちょこmoca", email: "info@chocomoca.jp", area: "北海道" },
    { shop_name: "癒し妻", email: "info@iyashizuma.net", area: "北海道" },
    { shop_name: "SAPPORO 医乳", email: "info@inyu.jp", area: "北海道" },
    { shop_name: "エッセンス", email: "essence.mail81@gmail.com", area: "北海道" },
    { shop_name: "SAPPORO ばつぐんnet", email: "info@batsugunn.net", area: "北海道" },
    { shop_name: "札幌パラダイス天国", email: "sp-para@harekei.com", area: "北海道" },
    { shop_name: "PlatinumClub 釧路店", email: "platina.kushiro@gmail.com", area: "北海道" },
    { shop_name: "札幌シークレットサービス", email: "sapporo.no.1@icloud.com", area: "北海道" },
    { shop_name: "Rosa Rossa（ローザ・ロッサ）", email: "sagroup.rosarossa@gmail.com", area: "北海道" },
    { shop_name: "aku美 出張エステ", email: "callkyujin@gmail.com", area: "北海道" },
    { shop_name: "出張回春エステ Ventura+", email: "naotennis717@icloud.com", area: "北海道" },
    { shop_name: "BLANC SPA", email: "bellelisersapporoasabu@gmail.com", area: "北海道" },
    { shop_name: "イッツブーリー&ナース・女医治療院", email: "sp-bully@harekei.com", area: "北海道" },
    { shop_name: "ぬくもりLABO", email: "labonukumori@gmail.com", area: "北海道" },
    { shop_name: "札幌SOPHIA（ソフィア）", email: "info@s-sophia.net", area: "北海道" },
    { shop_name: "REVERE", email: "hhh19791217@gmail.com", area: "北海道" },
    { shop_name: "シロガネーゼ", email: "esthe.sirogane@gmail.com", area: "北海道" },
    { shop_name: "万華鏡", email: "mangekyo.0112994949@gmail.com", area: "北海道" },
    { shop_name: "不倫館", email: "n09087081637@docomo.ne.jp", area: "北海道" },
    { shop_name: "エッチな熟女旭川人妻専科", email: "hitodumasenka11@yahoo.co.jp", area: "北海道" },
    { shop_name: "アニバーサリー", email: "anni.sapporo@gmail.com", area: "北海道" },
    { shop_name: "BBW札幌店", email: "akidukidaria@gmail.com", area: "北海道" },
    { shop_name: "函館人妻デリヘル 桃屋", email: "haya56369906@gmail.com", area: "北海道" },
    { shop_name: "テミス", email: "info@temis.jp", area: "北海道" },
    { shop_name: "Bellflora（札幌YESグループ", email: "b_flora@yesgrp.com", area: "北海道" },
    { shop_name: "YOASOBI 札幌", email: "yoasobi.sapporo@icloud.com", area: "北海道" },
    { shop_name: "Mspaすすきの店", email: "mspasusukino@gmail.com", area: "北海道" },
    { shop_name: "秘書のおもてなし すすきの店", email: "hisyonoomotenasi@gmail.com", area: "北海道" },
    { shop_name: "函館 ばつぐんnet", email: "tzztb0jr64symbwmqzd3@docomo.ne.jp", area: "北海道" },
    { shop_name: "人妻ステーション", email: "genuine-k@docomo.ne.jp", area: "北海道" },
    { shop_name: "CHOICE LOVE", email: "susukinochoicelove@gmail.com", area: "北海道" },
    { shop_name: "お姉さんセレブR38", email: "info@niiduma.net", area: "北海道" },
    { shop_name: "華椿（札幌YESグループ）", email: "hanatsubaki_s@yesgrp.com", area: "北海道" },
    { shop_name: "ENTERTAINMENT SOAP LOVE VEGAS", email: "love.vegas.raku@gmail.com", area: "北海道" },
    { shop_name: "PLATINA R-30", email: "platina@yesgrp.com", area: "北海道" },
    { shop_name: "恋愛マット同好会", email: "girls-entry@renai-group.com", area: "北海道" },
    { shop_name: "BodyCareSalon Vatech ヴァテック", email: "vatech20231001@gmail.com", area: "北海道" },
    { shop_name: "SOAPLAND COSPA SAPPORO", email: "job@cospa.site", area: "北海道" },
    { shop_name: "札幌お姉さんCLUB", email: "info@s-oneesan.com", area: "北海道" },
    { shop_name: "レガリア 札幌", email: "regaria0801@icloud.com", area: "北海道" },
    { shop_name: "札幌ススキノちゃんこ", email: "susukinochanko@gmail.com", area: "北海道" },
    { shop_name: "アンジェール", email: "pt0505co@gmail.com", area: "北海道" },
    { shop_name: "即会い.net 札幌", email: "info@sokuai-s.net", area: "北海道" },
    { shop_name: "まんまるHONEY旭川店", email: "okuyou1998@gmail.com", area: "北海道" },
    { shop_name: "黒い金魚", email: "kurokin.kyujin1778@gmail.com", area: "北海道" },
    { shop_name: "ミルクアイドル", email: "milkynny@gmail.com", area: "北海道" },
    { shop_name: "Seven", email: "kokochipurasu@gmail.com", area: "北海道" },
    { shop_name: "ソープランド看護学院ディエックス", email: "kangogakuin1919@gmail.com", area: "北海道" },
    { shop_name: "ハピネス札幌", email: "recruit@happiness-group.com", area: "北海道" }
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
