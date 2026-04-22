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
    { shop_name: '鹿児島フェアリー鹿児島店', email: '0pa5575738d385f@au.com', area: '鹿児島県' },
    { shop_name: '鹿児島フェアリー鹿児島店', email: '0pa5575738d385f@au.com', area: '鹿児島県' },
    { shop_name: '沖縄素人図鑑', email: 'zukan4610@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄ハンドリング 亀頭責め専門店', email: 'shirakobato0530@icloud.com', area: '沖縄県' },
    { shop_name: '沖縄Profile~プロフィール~', email: 'profile.naha@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄YESグループ Lesson.1沖縄校', email: 'lesson1n@yesgrp.com', area: '沖縄県' },
    { shop_name: '沖縄ハイブリッドエステ', email: 'recruit.moepro@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄かりゆしOLの秘密', email: 'itaka.kouichi@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄es-1 エスワン', email: 'okinawa.es1@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄sheep-沖縄-', email: 'sheepokinawa.d@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄HANA-okinawa-', email: 'oki.clubhana@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄Bijou R', email: 'bijou.naha@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄♂風俗の神様那覇店', email: 'info@of-nightwork-qjin.com', area: '沖縄県' },
    { shop_name: '沖縄banana heaven spa', email: 'bananaheavenspa@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄素人学園＠', email: 'deriheru098@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄Mode（モード）◆理想の彼女◆', email: 'modekyujin@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄ここだけの話！！那覇店', email: 'kokodakenohanashiokinawa@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄名護らいくAばーじん', email: 'nagolike@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄人妻パラダイス', email: 'kyuujinhitopara@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄ナースと女医の出張マッサージ', email: 'narse.joi.4471@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄ちゃんこコザ', email: 'chanko20251201koza@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄 俺のジュニア', email: 'cyber1122@me.com', area: '沖縄県' },
    { shop_name: '沖縄ちゃんこ那覇店', email: 'naha.chanko@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄秘密倶楽部', email: 'himituclub.okinawa@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄天然素材', email: 'mirion8000@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄ガールズコレクション', email: 'himituclub.okinawa@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄人妻倶楽部 艶女 アデージョ', email: 'epiepi789@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄ちゅら', email: 'herusuderi@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄姉系・若妻倶楽部 PINK GOLD', email: '8131okinawapg@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄じゅーしーOKINAWA', email: '0kb6804v2mg571r@au.com', area: '沖縄県' },
    { shop_name: '沖縄派遣費無料で即ご案内 ミルキー', email: 'milky.milky098@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄Platinum', email: 'bananaheavenspa@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄妻味喰い', email: 'ren231203@icloud.com', area: '沖縄県' },
    { shop_name: '沖縄KAWAIICLUBAmatteurgirlsescortokinawa', email: 'itaka.kouichi@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄素人図鑑', email: 'zukan4610@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄オキドキガール沖縄', email: 'okidokigirl.okinawa@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄直電デリヘル TOUCH', email: 'info@okinawa-touch.com', area: '沖縄県' },
    { shop_name: '沖縄美熟女専門店 いいなり貴婦人', email: 'iinarikihujin2018@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄人妻エクスタシー', email: 'epiepi789@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄カミカゼガールズ', email: 'kyuujinhitopara@gmail.com', area: '沖縄県' },
    { shop_name: '沖縄五十路有閑マダム～沖縄店～', email: 'isogemadamu@gmail.com', area: '沖縄県' },
    { shop_name: '広島RUSH（RUSH ラッシュ グループ）', email: 'info.rush47@gmail.com', area: '広島県' },
    { shop_name: '広島百花繚乱（百花繚乱グループ）', email: 'hyakka987654@gmail.com', area: '広島県' },
    { shop_name: '広島AMATERAS－アマテラス－', email: 'amateras.com@docomo.ne.jp', area: '広島県' },
    { shop_name: '広島ラブコレクション', email: '09053790808@docomo.ne.jp', area: '広島県' },
    { shop_name: '広島で評判のお店はココです！', email: 'aromacherie082@gmail.com', area: '広島県' },
    { shop_name: '広島ラズベリー広島', email: 'yoyakudaiji@yahoo.co.jp', area: '広島県' },
    { shop_name: '広島ラブマシーン広島', email: 'lovemachine.recruit@gmail.com', area: '広島県' },
    { shop_name: '広島ママ友倶楽部', email: 'mamatomo.girls@gmail.com', area: '広島県' },
    { shop_name: '広島淫らなオンナ性体師', email: 'midaranahiroshima@gmail.com', area: '広島県' },
    { shop_name: '広島フルフル60分10000円（RUSHグループ）', email: 'fullfull.4545@gmail.com', area: '広島県' },
    { shop_name: '広島カサブランカ広島店', email: 'kasabulanka-tf@docomo.ne.jp', area: '広島県' },
    { shop_name: '広島ご近所物語（RUSHグループ）', email: 'gokinjo0@gmail.com', area: '広島県' },
    { shop_name: '広島エッチな熟女', email: 'mn.sakura.mn@docomo.ne.jp', area: '広島県' },
    { shop_name: '広島バレンタイン', email: 's.t.valentine@au.com', area: '広島県' },
    { shop_name: '広島ポポロン☆広島', email: 'popo_info@icloud.com', area: '広島県' },
    { shop_name: '広島人妻同窓会ヴィーナス', email: 'yoyakudaiji@yahoo.co.jp', area: '広島県' },
    { shop_name: '広島こあくまな熟女たち広島店', email: 'recruit_girls_west@koakumagroup.com', area: '広島県' },
    { shop_name: '広島Luxeグループ', email: 'clubluxe@docomo.ne.jp', area: '広島県' },
    { shop_name: '広島人妻館', email: 'hitotsuma@docomo.ne.jp', area: '広島県' },
    { shop_name: '広島ELEGANCE(エレガンス)', email: 'ele906@docomo.ne.jp', area: '広島県' },
    { shop_name: '広島五十路エステハイブリッド', email: 'isoji.hi@docomo.ne.jp', area: '広島県' },
    { shop_name: '広島MOZAIC（モザイク）', email: 'moza-h@docomo.ne.jp', area: '広島県' },
    { shop_name: '広島RUSH 東広島店', email: 'info.rush.higashihiroshima@gmail.com', area: '広島県' },
    { shop_name: '広島煌き -KIRAMEKI-', email: 'sense.hiroshima@ymail.ne.jp', area: '広島県' },
    { shop_name: '広島Ares(アース)超恋人軍団', email: 'areskyujin@gmail.com', area: '広島県' },
    { shop_name: '広島五十路マダム 広島店', email: 'madam-job@docomo.ne.jp', area: '広島県' },
    { shop_name: '広島尾道デリヘル スマイル', email: 'smile25onomichi@gmail.com', area: '広島県' },
    { shop_name: '広島「人妻サロン」ニューヒロシマ', email: 'newhiroshimamail@gmail.com', area: '広島県' },
    { shop_name: '広島PLUMERIA', email: 'plumeriakyujin@gmail.com', area: '広島県' },
    { shop_name: '広島最後の楽園', email: 'esute-s@softbank.ne.jp', area: '広島県' },
    { shop_name: '広島痴女性感フェチ倶楽部', email: 'c_hiroshima_job@star-group.co.jp', area: '広島県' },
    { shop_name: '広島福山ガールズセレクションEden', email: 'edenfukuyama@gmail.com', area: '広島県' },
    { shop_name: '広島DiamondHearts', email: 'd.hearts9494@gmail.com', area: '広島県' },
    { shop_name: '広島福山ちゃんこ', email: 'fukuyama.chanko@gmail.com', area: '広島県' },
    { shop_name: '東広島ちゃんこ', email: 'chanko.higahiro@gmail.com', area: '広島県' },
    { shop_name: '広島LovingTouch 広島店', email: 'lovingtouch0167@gmail.com', area: '広島県' },
    { shop_name: '広島Mrs.（ミセス）ジュリエット', email: 'lovemachine.recruit@gmail.com', area: '広島県' },
    { shop_name: '広島Vip Club Angelique', email: 'vip.angelique@docomo.ne.jp', area: '広島県' },
    { shop_name: '広島五十路マダム 福山店', email: 'madam.fu@icloud.com', area: '広島県' },
    { shop_name: '広島こあくまな人妻・熟女たち東広島店', email: 'recruit_girls_west@koakumagroup.com', area: '広島県' },
    { shop_name: '広島ラブマシーン東広島', email: 'lovemachine.recruit@gmail.com', area: '広島県' },
    { shop_name: '広島5letters', email: 'five-letters@docomo.ne.jp', area: '広島県' },
    { shop_name: '広島ぽっちゃりヴィーナス', email: 'yoyakudaiji@yahoo.co.jp', area: '広島県' },
    { shop_name: '広島こあくまな熟女たち福山店', email: 'recruit_girls_west@koakumagroup.com', area: '広島県' },
    { shop_name: '広島デリヘルコレクション', email: 'ate32879@gmail.com', area: '広島県' },
    { shop_name: '広島こあくまな人妻・熟女たち岡山店', email: 'recruit_girls_west@koakumagroup.com', area: '広島県' },
    { shop_name: '広島Puzzle', email: 'puzzle.f.staff@gmail.com', area: '広島県' },
    { shop_name: '広島奥様鉄道69 広島店', email: 'tcnm3523@gmail.com', area: '広島県' },
    { shop_name: '広島デリナビ', email: 'derinavi04@gmail.com', area: '広島県' },
    { shop_name: '広島cocoro', email: 'cocoro020929@gmail.com', area: '広島県' },
    { shop_name: '広島熟女デリバリーヘルスイマドキ50代', email: 'imadoki50@gmail.com', area: '広島県' },
    { shop_name: '広島とろける時間～脳バグ♡エステ～', email: 'roundg.hiro@gmail.com', area: '広島県' },
    { shop_name: '広島市ちゃんこ', email: 'chanko.hiroshima@gmail.com', area: '広島県' },
    { shop_name: '広島奥様鉄道69 広島店', email: 'tcnm3523@gmail.com', area: '広島県' },
    { shop_name: '広島とろける時間～脳バグ♡エステ～', email: 'roundg.hiro@gmail.com', area: '広島県' },
    { shop_name: '広島Puzzle', email: 'puzzle.f.staff@gmail.com', area: '広島県' },
    { shop_name: '広島神辺府中井原ちゃんこ', email: 'kannabechanko@gmail.com', area: '広島県' },
    { shop_name: '広島シャングリラ 東広島', email: 'shangrila_higashihiroshima@docomo.ne.jp', area: '広島県' },
    { shop_name: '広島ｶｻﾌﾞﾗﾝｶ 福山店', email: 'casa.fuku@au.com', area: '広島県' },
    { shop_name: '広島ぽっちゃりmateマシュマロ', email: 'pochamin@docomo.ne.jp', area: '広島県' },
    { shop_name: '広島シャングリラ 呉', email: 'shangrila_recruit@icloud.com', area: '広島県' },
    { shop_name: '広島縁結び学園', email: 'sin1128k@gmail.com', area: '広島県' },
    { shop_name: '広島官能クラブ SPA M性感', email: 'yoyakudaiji@yahoo.co.jp', area: '広島県' },
    { shop_name: '広島Melty Esthe', email: 'xinqui5369@icloud.com', area: '広島県' },
    { shop_name: '広島プロフィール倉敷', email: 'info@okayama.pro-file.jp', area: '広島県' },
    { shop_name: '広島－PTA－', email: 'pta1919@ymobile.ne.jp', area: '広島県' },
    { shop_name: '広島いちゃいちゃパラダイス 福山店', email: 'will.next.2016@gmail.com', area: '広島県' },
    { shop_name: '広島ベルベット広島', email: 'yoyakudaiji@yahoo.co.jp', area: '広島県' },
    { shop_name: '岡山プロフィール岡山', email: 'info@okayama.pro-file.jp', area: '岡山県' },
    { shop_name: '岡山さくらんぼ女学院', email: 'ranbo3388@gmail.com', area: '岡山県' },
    { shop_name: '岡山COCKTAIL 岡山店', email: 'mail@love-cocktail.com', area: '岡山県' },
    { shop_name: '岡山DRESS岡山', email: 'dress.oka0862062405@gmail.com', area: '岡山県' },
    { shop_name: '岡山萌えラブ', email: 'moeloveoka@gmail.com', area: '岡山県' },
    { shop_name: '岡山♂風俗の神様 岡山店', email: 'info@of-nightwork-qjin.com', area: '岡山県' },
    { shop_name: '岡山スマイリー', email: 'info@k-smily.com', area: '岡山県' },
    { shop_name: '岡山タレント倶楽部', email: 'girlswork.talent@gmail.com', area: '岡山県' },
    { shop_name: '岡山五十路マダム岡山店', email: 'madam-o@docomo.ne.jp', area: '岡山県' },
    { shop_name: '岡山プロフィール倉敷', email: 'info@okayama.pro-file.jp', area: '岡山県' },
    { shop_name: '岡山ミセスOLスタイル', email: 'm-o-s0024@ezweb.ne.jp', area: '岡山県' },
    { shop_name: '岡山倉敷人妻エピソード', email: '08029325050@docomo.ne.jp', area: '岡山県' },
    { shop_name: '岡山シュガー岡山', email: 'sugar70248686@gmail.com', area: '岡山県' },
    { shop_name: '岡山カサブランカ岡山店', email: 'casa-o@docomo.ne.jp', area: '岡山県' },
    { shop_name: '岡山熟女＆人妻＆ぽっちゃりクラブ', email: 'pottyariclub@ezweb.ne.jp', area: '岡山県' },
    { shop_name: '岡山近所妻', email: 'tomonori09087179911@icloud.com', area: '岡山県' },
    { shop_name: '岡山ACCENT', email: 'accent1187@gmail.com', area: '岡山県' },
    { shop_name: '岡山Club Dear', email: 'gproject9@gmail.com', area: '岡山県' },
    { shop_name: '岡山Vacation', email: 'vacation0052@gmail.com', area: '岡山県' },
    { shop_name: '岡山デリスタ倉敷', email: 'derisuta01@gmail.com', area: '岡山県' },
    { shop_name: '岡山倉敷ちゃんこ', email: 'kurasiki.chanko@gmail.com', area: '岡山県' },
    { shop_name: '岡山こあくまな人妻・熟女たち岡山店', email: 'recruit_girls_west@koakumagroup.com', area: '岡山県' },
    { shop_name: '岡山WhiteCLUB', email: 'Wg.kyujin2@docomo.ne.jp', area: '岡山県' },
    { shop_name: '岡山COCKTAIL津山店', email: 'cocktail.tsuyama7007@gmail.com', area: '岡山県' },
    { shop_name: '岡山マダムスタイル', email: 'm-d-m3131@ezweb.ne.jp', area: '岡山県' },
    { shop_name: '岡山ぽちゃLOVE', email: 'love0015love@gmail.com', area: '岡山県' },
    { shop_name: '岡山こあくまな熟女たち 倉敷店', email: 'recruit_girls_west@koakumagroup.com', area: '岡山県' },
    { shop_name: '岡山オーダーメイド岡山店', email: 'okayama.ordermade@gmail.com', area: '岡山県' },
    { shop_name: '岡山天使のゆびさき岡山店', email: 'aroma-o@docomo.ne.jp', area: '岡山県' },
    { shop_name: '岡山人妻の雫 岡山店', email: 'yebisu.recruit@gmail.com', area: '岡山県' },
    { shop_name: '岡山タレント倶楽部アダルト', email: 'girlswork.talent@gmail.com', area: '岡山県' },
    { shop_name: '岡山奥鉄オクテツ岡山', email: 'info-osaka@dh2020.jp', area: '岡山県' },
    { shop_name: '岡山素人清楚専門店 Ecstasy', email: 'mappi.33@i.softbank.jp', area: '岡山県' },
    { shop_name: '岡山初クンニ待ち女子 岡山駅前店', email: 'adhwd55@gmail.com', area: '岡山県' },
    { shop_name: '岡山奥様鉄道69 広島店', email: 'q-jin@okutetsu.co.jp', area: '岡山県' },
    { shop_name: '岡山市ちゃんこ', email: 'okayamashi.chanko@gmail.com', area: '岡山県' },
    { shop_name: '岡山高知ﾃﾞﾘﾍﾙ DIVA', email: 'diva.kochi@gmail.com', area: '岡山県' },
    { shop_name: '岡山タレント倶楽部プレミアム', email: 'girlswork.talent@gmail.com', area: '岡山県' },
    { shop_name: '岡山倉敷デリヘル', email: 'kurashikideri@gmail.com', area: '岡山県' },
    { shop_name: '岡山素人専門 GIFT', email: 'gift0505@icloud.com', area: '岡山県' },
    { shop_name: '岡山RANKAN Ma cherie', email: 'rankan.macherie@icloud.com', area: '岡山県' },
    { shop_name: '岡山RANKAN-ランカン-', email: 'rankan.okyama@icloud.com', area: '岡山県' },
    { shop_name: '岡山人妻の雫 倉敷店', email: 'yebisu.recruit@gmail.com', area: '岡山県' },
    { shop_name: '岡山シュガー岡山', email: 'sugar70248686@gmail.com', area: '岡山県' },
    { shop_name: '岡山M性感シンドローム', email: 'adhwd55@gmail.com', area: '岡山県' },
    { shop_name: '山口OL俱楽部', email: 'yamaguchi.olclub@gmail.com', area: '山口県' },
    { shop_name: '山口多恋人倶楽部', email: 'talentclub.yamaguchi@gmail.com', area: '山口県' },
    { shop_name: '山口プラウディア', email: 'clubproudia@gmail.com', area: '山口県' },
    { shop_name: '山口セレブスタイル', email: 'celeb.qjin@gmail.com', area: '山口県' },
    { shop_name: '山口OL倶楽部周南', email: 'olclub.shunan1919@gmail.com', area: '山口県' },
    { shop_name: '山口多恋人倶楽部周南', email: 'talentculb.shunan1919@gmail.com', area: '山口県' },
    { shop_name: '山口縁結び学園', email: 'sin1128k@gmail.com', area: '山口県' },
    { shop_name: '山口五十妻（イソップ）', email: 'cs.group.recruit.1414@gmail.com', area: '山口県' },
    { shop_name: '山口オフィスアロマ', email: 'ofiaro.ube1919@gmail.com', area: '山口県' },
    { shop_name: '山口周南ちゃんこ', email: 'tyankoyamaguchi@gmail.com', area: '山口県' },
    { shop_name: '山口下松にゃんこ', email: 'nyanko.kudamatu@gmail.com', area: '山口県' },
    { shop_name: '山口いちご倶楽部', email: 'ichigo.club.yamaguchi@gmail.com', area: '山口県' },
    { shop_name: '山口多恋人倶楽部 宇部店', email: 'talentclub.ube@gmail.com', area: '山口県' },
    { shop_name: '山口こあくまな熟女たち周南・徳山店', email: 'recruit_girls_west@koakumagroup.com', area: '山口県' },
    { shop_name: '山口LOVEろけっと', email: 'loverocket2025@icloud.com', area: '山口県' },
    { shop_name: '山口下関ちゃんこ', email: 's.c5237@outlook.com', area: '山口県' },
    { shop_name: '山口こあくまな熟女たち岩国店', email: 'koakuma-group@au.com', area: '山口県' },
    { shop_name: '山口ピーチハニー', email: 'peachhoney.yamaguchi@gmail.com', area: '山口県' },
    { shop_name: '山口Club ACE 山口店', email: 'clubace3111@gmail.com', area: '山口県' },
    { shop_name: '山口OL倶楽部宇部', email: 'caclub.ube19@gmail.com', area: '山口県' },
    { shop_name: '山口ぽっちゃりプリンセス', email: 'potyapuri@gmail.com', area: '山口県' },
    { shop_name: '山口リンカーン 宇部本店', email: 'lincoln@docomo.ne.jp', area: '山口県' },
    { shop_name: '山口S-Cawaii', email: 's_kawa_s@icloud.com', area: '山口県' },
    { shop_name: '山口こあくまな人妻・熟女たち山口店', email: 'recruit_girls_west@koakumagroup.com', area: '山口県' },
    { shop_name: '山口こあくまな熟女たち宇部店', email: 'recruit_girls_west@koakumagroup.com', area: '山口県' },
    { shop_name: '山口Naru', email: 'naru2025naru@icloud.com', area: '山口県' },
    { shop_name: '山口推しカノ', email: 'toshi.360s@gmail.com', area: '山口県' },
    { shop_name: '山口妻美喰い', email: 'lincoln@docomo.ne.jp', area: '山口県' },
    { shop_name: '山口Cos Cos', email: '3cos3cos3@gmail.com', area: '山口県' },
    { shop_name: '山口人妻デリヘルフルール', email: 'yyyfleur32@gmail.com', area: '山口県' },
    { shop_name: '山口リンカーン 山口支店', email: 'lincoln.qjin@gmail.com', area: '山口県' },
    { shop_name: '山口エルメス', email: 'hermes6875@icloud.com', area: '山口県' },
    { shop_name: '山口とんとん', email: 'tonton.2929@icloud.com', area: '山口県' },
    { shop_name: '山口ラブパコ LOVE PACO', email: 'love-9ball-pj@i.softbank.jp', area: '山口県' },
    { shop_name: '山口シャングリラ 周南', email: 'shangrila_recruit@icloud.com', area: '山口県' },
    { shop_name: '山口雫えっちなおくさん', email: 'h-okusan@ezweb.ne.jp', area: '山口県' },
    { shop_name: '山口SexyRose', email: 'sexyrose-.-enjoy.yamaguchi@docomo.ne.jp', area: '山口県' },
    { shop_name: '山口市湯田ちゃんこ', email: 'chankoshankou@gmail.com', area: '山口県' },
    { shop_name: '山口G-LOVE', email: 'toshi.360s@gmail.com', area: '山口県' },
    { shop_name: '鳥取orchis 米子店', email: 'orchis0812.y@gmail.com', area: '鳥取県' },
    { shop_name: '鳥取乱妻 米子店', email: 'yonagoranzuma5010@gmail.com', area: '鳥取県' },
    { shop_name: '鳥取淫乱秘書室米子店', email: 'yonago.hisyo.kyuzin@gmail.com', area: '鳥取県' },
    { shop_name: '鳥取PRODUCE 米子店', email: 'produce.yng@gmail.com', area: '鳥取県' },
    { shop_name: '鳥取淫乱秘書室鳥取店', email: 'olhisyoshitsukyuzin@gmail.com', area: '鳥取県' },
    { shop_name: '鳥取五十路マダム松江米子店', email: 'shimatori.isoji@gmail.com', area: '鳥取県' },
    { shop_name: '鳥取五十路マダム鳥取店', email: 'shimatori.isoji@gmail.com', area: '鳥取県' },
    { shop_name: '鳥取カサブランカ鳥取', email: 'shimatori.isoji@gmail.com', area: '鳥取県' },
    { shop_name: '鳥取カサブランカ松江米子店', email: 'shimatori.isoji@gmail.com', area: '鳥取県' },
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
