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
    { shop_name: '埼玉TIANA', email: 'tiana.boygroup@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉ミセスファースト 熊谷店', email: 'mrsfirst.kumagaya.smile@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉熊谷人妻花壇(モア)', email: 'recruit@riri-group.net', area: '埼玉県' },
    { shop_name: '埼玉所沢人妻城(モア)', email: 'recruit@riri-group.net', area: '埼玉県' },
    { shop_name: '埼玉大宮人妻セレブリティ', email: 'job@st-celeb.com', area: '埼玉県' },
    { shop_name: '埼玉シンデレラグループ', email: 'rct@cin-gr.com', area: '埼玉県' },
    { shop_name: '埼玉君とふわふわプリンセスin熊谷', email: 'fuwapri@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉セレブクエスト-koshigaya-', email: 'kosigaya.kyujin@y-dgroup.com', area: '埼玉県' },
    { shop_name: '埼玉バニラシュガー 久喜店', email: 'vanillasugar.jp@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉紳士の嗜み 大宮', email: 'recruit.tashinami.omiya@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉西川口ショートケーキ', email: 'rct@s-cin.jp', area: '埼玉県' },
    { shop_name: '埼玉M&m Maidとm男の夢物語', email: 'mandom@softbank.ne.jp', area: '埼玉県' },
    { shop_name: '埼玉人妻倶楽部 内緒の関係 大宮店', email: 'pfgomiya.rec@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉メイドリーム', email: 'job@st-maid.com', area: '埼玉県' },
    { shop_name: '埼玉脱がされたい人妻 越谷店', email: 'koshigaya@saretuma.com', area: '埼玉県' },
    { shop_name: '埼玉西川口ぷよステーション', email: 'puyo.station2025@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉プラチナスタイル', email: 'job@st-pltn.com', area: '埼玉県' },
    { shop_name: '埼玉クンニ学園池袋・大宮校', email: 'okunnioomiya@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉イキなり生彼女from大宮', email: 'o9o93677891@yahoo.co.jp', area: '埼玉県' },
    { shop_name: '埼玉越谷発デリヘル 生イキッ娘', email: '0xk32202388222s@au.com', area: '埼玉県' },
    { shop_name: '埼玉西川口人妻城', email: 'nishikawajooo@more-g.jp', area: '埼玉県' },
    { shop_name: '埼玉全力妻大宮店', email: 'kdgroupworks1300@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉美熟女倶楽部Hips春日部店', email: 'info@hips-jk.com', area: '埼玉県' },
    { shop_name: '埼玉Hips越谷店', email: 'info@hips.jp', area: '埼玉県' },
    { shop_name: '埼玉ぼくらのデリヘルランドin春日部・久喜店', email: 'info@bokuderi-kuki.com', area: '埼玉県' },
    { shop_name: '埼玉美熟女倶楽部Hips西川口店', email: 'info@hips-nishikawa.jp', area: '埼玉県' },
    { shop_name: '埼玉FAIRY大宮', email: 'fairygruop@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉ラブライフ', email: 'saitama@love-life.jp', area: '埼玉県' },
    { shop_name: '埼玉君とふわふわプリンセスin西川口', email: 'fuwa.nishikawa@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉Honey Bee', email: 'honeybee@room.ocn.ne.jp', area: '埼玉県' },
    { shop_name: '埼玉One More 奥様 西川口店', email: 'nishikawa1more@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉マリアージュ熊谷(KD)', email: 'kumagayaseita1130@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉僕らのぽっちゃリーノin春日部', email: 'potyakawastyle@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉若妻淫乱倶楽部 久喜店', email: 'womansstyle.kuki@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉川越人妻花壇', email: 'kyuzin-kawagoe@h-kadan.com', area: '埼玉県' },
    { shop_name: '埼玉大人の遊園地 大宮店', email: 'yuuenchiotona@yahoo.co.jp', area: '埼玉県' },
    { shop_name: '千葉ベストマダム', email: 'bestmadam2022@gmail.com', area: '千葉県' },
    { shop_name: '千葉北インターちゃんこ', email: 'chanko.chibakita@gmail.com', area: '千葉県' },
    { shop_name: '埼玉人妻ネットワーク さいたま 大宮編', email: 'saitama@deai-tuma.net', area: '埼玉県' },
    { shop_name: '埼玉若妻淫乱倶楽部', email: 'womansstyle.k@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉ミセス ファースト', email: 'mrsfirst.koshigaya.smile@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉One More 奥様 大宮店', email: 'omiya1more@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉セレブクエスト-omiya-', email: 'omiya.kyujin@y-dgroup.com', area: '埼玉県' },
    { shop_name: '埼玉大宮人妻花壇', email: 'recruit@riri-group.net', area: '埼玉県' },
    { shop_name: '埼玉南越谷人妻花壇', email: 'recruit@riri-group.net', area: '埼玉県' },
    { shop_name: '埼玉マリアージュ大宮(KD)', email: 'kdgroupworks1300@gmail.com', area: '埼玉県' },
    { shop_name: '埼玉ラブリップ 川越店', email: 'kawagoe.lovelip@gmail.com', area: '埼玉県' },
    { shop_name: '千葉松戸デリヘル 熟女ヘブン', email: 'm1914heaven@outlook.jp', area: '千葉県' },
    { shop_name: '千葉成田富里インターちゃんこ', email: 'naritatomisato.chanko@gmail.com', area: '千葉県' },
    { shop_name: '千葉人妻快速', email: 'kaisokuhitozuma@gmail.com', area: '千葉県' },
    { shop_name: '千葉人妻最高級倶楽部', email: 'cb_recruit@vip-madame.com', area: '千葉県' },
    { shop_name: '千葉SMクラブ女王様とM男', email: 'info@chiba-smclub.com', area: '千葉県' },
    { shop_name: '千葉素人巨乳ちゃんこ東千葉店', email: 'chiba.chanko@gmail.com', area: '千葉県' },
    { shop_name: '千葉松戸ちゃんこ', email: 'chanko.matsudo@gmail.com', area: '千葉県' },
    { shop_name: '千葉癒したくて千葉店', email: 'i.cont.joboffer@gmail.com', area: '千葉県' },
    { shop_name: '千葉天使のゆびさき船橋店', email: 'tenyubifuna@au.com', area: '千葉県' },
    { shop_name: '千葉セクハラ商事 成田店', email: 'sekuhara.narita@gmail.com', area: '千葉県' },
    { shop_name: '千葉恋せよ乙女', email: 'otomekashiwa@gmail.com', area: '千葉県' },
    { shop_name: '千葉セクハラ商事 柏店', email: 'sekuhara.kashiwa@gmail.com', area: '千葉県' },
    { shop_name: '千葉BBW 西船橋店', email: 'info@nishifunabashi-bbw.net', area: '千葉県' },
    { shop_name: '千葉船橋・西船橋ちゃんこ', email: 'hunabashi.chanko@gmail.com', area: '千葉県' },
    { shop_name: '千葉人妻の出会い', email: 'info@hitozuma-deai.net', area: '千葉県' },
    { shop_name: '千葉成田人妻最高級倶楽部', email: 'nr@vip-madame.com', area: '千葉県' },
    { shop_name: '千葉中央人妻援護会', email: 'chibachuo.he@gmail.com', area: '千葉県' },
    { shop_name: '千葉セクハラ商事 柏店', email: 'sekuhara.kashiwa@gmail.com', area: '千葉県' },
    { shop_name: '千葉BBW 西船橋店', email: 'info@nishifunabashi-bbw.net', area: '千葉県' },
    { shop_name: '千葉船橋・西船橋ちゃんこ', email: 'hunabashi.chanko@gmail.com', area: '千葉県' },
    { shop_name: '千葉人妻の出会い', email: 'info@hitozuma-deai.net', area: '千葉県' },
    { shop_name: '千葉成田人妻最高級倶楽部', email: 'nr@vip-madame.com', area: '千葉県' },
    { shop_name: '千葉中央人妻援護会', email: 'chibachuo.he@gmail.com', area: '千葉県' },
    { shop_name: '千葉柏OL委員会', email: 'venuskashiwa@icloud.com', area: '千葉県' },
    { shop_name: '千葉もも尻 本店', email: 'naritabbg@gmail.com', area: '千葉県' },
    { shop_name: '千葉五十路マダムEX船橋店', email: 'funaiso@docomo.ne.jp', area: '千葉県' },
    { shop_name: '千葉セカンドハウス', email: 'nmisesu3@yahoo.co.jp', area: '千葉県' },
    { shop_name: '千葉ぽっちゃりきぶん', email: 'rouge123kibun@gmail.com', area: '千葉県' },
    { shop_name: '千葉成田 快楽M性感倶楽部', email: 'k.cont.joboffer@gmail.com', area: '千葉県' },
    { shop_name: '千葉即イキ淫乱倶楽部 木更津店', email: 'kisarazu.active0055@gmail.com', area: '千葉県' },
    { shop_name: '千葉船橋ぽちゃドル学園', email: 'info@funabashi-pochadol.com', area: '千葉県' },
    { shop_name: '千葉癒したくて成田店', email: 'i.cont.joboffer@gmail.com', area: '千葉県' },
    { shop_name: '千葉船橋SMクラブ女王様の館', email: 'info@chiba-smclub.com', area: '千葉県' },
    { shop_name: '千葉ラブセレクション', email: 'info@love-sele.com', area: '千葉県' },
    { shop_name: '千葉幕張・船橋競馬場ちゃんこ', email: 'makuhari.chanko@gmail.com', area: '千葉県' },
    { shop_name: '千葉脱がされたい人妻 成田店', email: 'narita@saretuma.com', area: '千葉県' },
    { shop_name: '千葉船橋ぽちゃドル学園', email: 'info@funabashi-pochadol.com', area: '千葉県' },
    { shop_name: '千葉船橋SMクラブ女王様の館', email: 'info@chiba-smclub.com', area: '千葉県' },
    { shop_name: '千葉巨乳専門 木更津君津ちゃんこin千葉', email: 'kisarazu.chanko@gmail.com', area: '千葉県' },
    { shop_name: '千葉西船巨乳ぽっちゃり 乳神さま', email: 'job@nf.kitty-s.net', area: '千葉県' },
    { shop_name: '千葉こあくまな熟女たち千葉店', email: 'recruit_girls_kg@koakumagroup.com', area: '千葉県' },
    { shop_name: '千葉西船橋 ムンムン熟女妻', email: 'info@million-job.net', area: '千葉県' },
    { shop_name: '千葉ぽっちゃり巨乳素人専門ぷにめろ西船橋', email: 'punimelo.nishihunabashi@gmail.com', area: '千葉県' },
    { shop_name: '千葉西船橋 快楽M性感倶楽部', email: 'k.cont.joboffer@gmail.com', area: '千葉県' },
    { shop_name: '千葉ミニスカM性感学園', email: 'info@sm-japan.com', area: '千葉県' },
    { shop_name: '千葉アロマヴィーナスグループ', email: 'job-funabashi@aroma-v.com', area: '千葉県' },
    { shop_name: '千葉栄町ムンムン熟女妻', email: 'sakae@munmunjyukujyo.net', area: '千葉県' },
    { shop_name: '千葉巨乳専門 木更津君津ちゃんこin千葉', email: 'kisarazu.chanko@gmail.com', area: '千葉県' },
    { shop_name: '千葉即イキ淫乱倶楽部 木更津店', email: 'kisarazu.active0055@gmail.com', area: '千葉県' },
    { shop_name: '千葉アロマヴィーナス 柏店', email: 'aroma.kashiwa@i.softbank.jp', area: '千葉県' },
    { shop_name: '千葉人妻楼 木更津店', email: 'kisarazu-star@ezweb.ne.jp', area: '千葉県' },
    { shop_name: '千葉One More 奥様 千葉店', email: 'chiba1more@gmail.com', area: '千葉県' },
    { shop_name: '千葉E+アイドルスクール船橋店', email: 'edol.funabashi@gmail.com', area: '千葉県' },
    { shop_name: '千葉どMばすたーず 群馬 高崎店', email: 'dmkyujin@gmail.com', area: '千葉県' },
    { shop_name: '千葉オズ 千葉栄町店', email: 'ozsakae01@gmail.com', area: '千葉県' },
    { shop_name: '千葉奥様プリモ', email: 'matsudo-primo@outlook.jp', area: '千葉県' },
    { shop_name: '千葉泡洗体デラックスエステ', email: 'recruit@chiba-deluxe.com', area: '千葉県' },
    { shop_name: '千葉成田人妻花壇', email: 'mirise-recruit@more-g.jp', area: '千葉県' },
    { shop_name: '千葉シルキーグループ', email: 'hitodumanohimitu.narita@gmail.com', area: '千葉県' },
    { shop_name: '千葉ちょい！ぽちゃロリ倶楽部Hips馬橋店', email: 'info@hips-pm.com', area: '千葉県' },
    { shop_name: '千葉 快楽M性感倶楽部', email: 'k.cont.joboffer@gmail.com', area: '千葉県' },
    { shop_name: '千葉素人妻御奉仕倶楽部Hips松戸店', email: 'info@hips-matsudo.jp', area: '千葉県' },
    { shop_name: '千葉boobs', email: 'tfs.sakae@gmail.com', area: '千葉県' },
    { shop_name: '千葉エスッテ×エスッテ', email: 'recruit@neros-gr.com', area: '千葉県' },
    { shop_name: '千葉究極の素人専門店Alice', email: 'alice-funabashi@inertennis.co.jp', area: '千葉県' },
    { shop_name: '千葉船橋ガマン汁天国手コキ百華店', email: 'info@tekoki100.tokyo', area: '千葉県' },
    { shop_name: '千葉姉新地 船橋本店', email: 'info@anesinchi.email', area: '千葉県' },
    { shop_name: '千葉合同会社e-ascent', email: 'cansamichiba2021@gmail.com', area: '千葉県' },
    { shop_name: '千葉夢幻', email: 'info@kashiwa-mugen.com', area: '千葉県' },
    { shop_name: '千葉レッドダイヤ', email: 'info@kamisu-deli.com', area: '千葉県' },
    { shop_name: '千葉OTONA JOSHI', email: 'job@chiba.o-joshi.tokyo', area: '千葉県' },
    { shop_name: '千葉コスプレ戦隊ヌケルンジャー', email: 'asatoihigami@gmail.com', area: '千葉県' },
    { shop_name: '神奈川Flower', email: 'flowerdelivery.yokosuka@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川ほんつま 横浜本店', email: 'info.hontsuma2008@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川五十路マダムEX横浜店', email: 'yokoisojiex@docomo.ne.jp', area: '神奈川県' },
    { shop_name: '神奈川横浜痴女性感フェチ倶楽部', email: 'c_yokohama_job@star-group.co.jp', area: '神奈川県' },
    { shop_name: '神奈川Mrs.Revoir', email: 'information@mrs-revoir.com', area: '神奈川県' },
    { shop_name: '千葉フィーリングループ（柏エリア）', email: 'info@hontsuma-kashiwa.com', area: '千葉県' },
    { shop_name: '千葉西船人妻花壇', email: 'ju-recruit@more-g.jp', area: '千葉県' },
    { shop_name: '千葉わちゃわちゃ密着リアルフルーちゅ西船橋', email: 'job@nf.kitty-s.net', area: '千葉県' },
    { shop_name: '千葉One More 奥様 西船橋店', email: 'nishifuna1more@gmail.com', area: '千葉県' },
    { shop_name: '千葉人妻セレブリティ', email: 'job@cb-celeb.com', area: '千葉県' },
    { shop_name: '千葉T-BACKS てぃばっくす栄町店', email: 'goldharlem@yahoo.co.jp', area: '千葉県' },
    { shop_name: '千葉人妻花壇', email: 'mirise-recruit@more-g.jp', area: '千葉県' },
    { shop_name: '千葉ラブセレクション 新小岩', email: 'shinkoiwa01@gmail.com', area: '千葉県' },
    { shop_name: '千葉ステラグループ千葉', email: 'job@nf.kitty-s.net', area: '千葉県' },
    { shop_name: '千葉キャンパスサミットグループ', email: 'cansami3366@yahoo.co.jp', area: '千葉県' },
    { shop_name: '千葉まつど女学園', email: 'job@image-club.jp', area: '千葉県' },
    { shop_name: '千葉メイドリーム', email: 'job@cb-maid.com', area: '千葉県' },
    { shop_name: '千葉One More 奥様 松戸店', email: 'matsudo1more@gmail.com', area: '千葉県' },
    { shop_name: '千葉やみつきエステ千葉栄町店', email: 'yamitsukio41@gmail.com', area: '千葉県' },
    { shop_name: '千葉ワンダーホール24', email: 'wonderholerecruit@ezweb.ne.jp', area: '千葉県' },
    { shop_name: '千葉プラチナ', email: 'job@pln.jp', area: '千葉県' },
    { shop_name: '千葉松戸人妻花壇', email: 'kyuzin@ls-group.jp', area: '千葉県' },
    { shop_name: '千葉即イキ淫乱倶楽部 松戸店', email: 'active.group0055.com@gmail.com', area: '千葉県' },
    { shop_name: '千葉サンキュー', email: 'happy.camper@live.jp', area: '千葉県' },
    { shop_name: '千葉柏人妻花壇', email: 'kyuzin@ls-group.jp', area: '千葉県' },
    { shop_name: '神奈川Spicyな女たち', email: 'spicy045@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川ちゃんこ藤沢茅ヶ崎店', email: 'chanko.fujisawa@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川脱がされたい人妻 厚木店', email: 'atg@saretuma.com', area: '神奈川県' },
    { shop_name: '神奈川完熟ばなな横浜', email: 'info@yokohama-banana.com', area: '神奈川県' },
    { shop_name: '神奈川横浜魅惑の人妻', email: 'info@yokohama-j-mrs.jp', area: '神奈川県' },
    { shop_name: '神奈川ぽちゃカワ女子専門店 藤沢湘南店', email: 'potyakawafujisawa@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川五反田人妻城', email: 'gtdjooo@more-g.jp', area: '神奈川県' },
    { shop_name: '神奈川ちゃんこ藤沢茅ヶ崎店', email: 'chanko.fujisawa@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川Spicyな女たち', email: 'spicy045@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川脱がされたい人妻 厚木店', email: 'atg@saretuma.com', area: '神奈川県' },
    { shop_name: '神奈川ぽちゃカワ女子専門店 藤沢湘南店', email: 'potyakawafujisawa@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川完熟ばなな横浜', email: 'info@yokohama-banana.com', area: '神奈川県' },
    { shop_name: '神奈川横浜魅惑の人妻', email: 'info@yokohama-j-mrs.jp', area: '神奈川県' },
    { shop_name: '神奈川おクンニ学園横浜関内校', email: 'okunnikannai@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川熟女待機所 厚木店', email: 'info@j-taikijyo.com', area: '神奈川県' },
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
