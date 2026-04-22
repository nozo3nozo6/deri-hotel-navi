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
    { shop_name: '神奈川丸妻 厚木店', email: 'g4-kyuzin@more-g.jp', area: '神奈川県' },
    { shop_name: '神奈川OLIVE SPA 横浜店', email: 'olive.job12@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川人妻熟女の秘密の関係 新横浜店', email: 'sinyokohama.himitunokankei@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川AROMA PHIL', email: 'aroma.phil86@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川ちゃんこ本厚木店', email: 'atugichanko@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川小田原ちゃんこ', email: 'hiroki.baba17@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川五反田人妻城', email: 'gtdjooo@more-g.jp', area: '神奈川県' },
    { shop_name: '神奈川アロマ新横浜', email: 'job.massage.yokohama@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川こあくまな熟女たち 相模原・橋本店', email: 'recruit_girls_kg@koakumagroup.com', area: '神奈川県' },
    { shop_name: '神奈川Lovely', email: 'fujisawadokidoki@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川虹色メロンパイ 横浜店', email: 'melon-banira@yokohama.pie-gr.com', area: '神奈川県' },
    { shop_name: '神奈川私立にじいろ女学園 横浜校', email: 'nijiirojo@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川横浜プラチナ', email: 'job-yk@pln.jp', area: '神奈川県' },
    { shop_name: '神奈川人妻小旅行 アバンチュール', email: 'info@hs-aventure.com', area: '神奈川県' },
    { shop_name: '神奈川横浜泡洗体デラックスエステ', email: 'recruit@yokohama-deluxe.com', area: '神奈川県' },
    { shop_name: '神奈川ぷよラブ れぼりゅーしょん', email: 'info@winning-group.jp', area: '神奈川県' },
    { shop_name: '神奈川厚木OL委員会', email: 'atsugi-ol@venus-atsugi.com', area: '神奈川県' },
    { shop_name: '神奈川ザ・シークレット', email: 'info@secret-sm.com', area: '神奈川県' },
    { shop_name: '神奈川大人めシンデレラ新横浜', email: 'rct@y-cin.jp', area: '神奈川県' },
    { shop_name: '神奈川タイタニック', email: 'taitanic@taitanic.net', area: '神奈川県' },
    { shop_name: '神奈川川崎人妻城', email: 'shiro-kawasaki@e4u.co.jp', area: '神奈川県' },
    { shop_name: '神奈川Lovely', email: 'fujisawadokidoki@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川虹色メロンパイ 横浜店', email: 'melon-banira@yokohama.pie-gr.com', area: '神奈川県' },
    { shop_name: '神奈川横浜プラチナ', email: 'job-yk@pln.jp', area: '神奈川県' },
    { shop_name: '神奈川人妻小旅行', email: 'info@hs-aventure.com', area: '神奈川県' },
    { shop_name: '神奈川横浜泡洗体デラックスエステ', email: 'recruit@yokohama-deluxe.com', area: '神奈川県' },
    { shop_name: '神奈川奥様はエンジェル相模原', email: 'sagamihara@okusama-angel.net', area: '神奈川県' },
    { shop_name: '神奈川小田原人妻城', email: 'g4-kyuzin@more-g.jp', area: '神奈川県' },
    { shop_name: '神奈川しろわい 厚木店', email: 'kyuuzin.atsugi@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川La Pace', email: 'ylfnjz8310@yahoo.co.jp', area: '神奈川県' },
    { shop_name: '神奈川BBW 横浜店', email: 'bbw.yokohama@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川タイタニック', email: 'taitanic@taitanic.net', area: '神奈川県' },
    { shop_name: '神奈川川崎人妻城', email: 'shiro-kawasaki@e4u.co.jp', area: '神奈川県' },
    { shop_name: '神奈川藤沢人妻城', email: 'leakyujin@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川熟女の風俗最終章 横浜本店', email: 'kyujin.yokohama045@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川Via横浜', email: 'viayokohama@yahoo.co.jp', area: '神奈川県' },
    { shop_name: '神奈川横浜コスプレデビュー', email: 'rct@mm21-cin.jp', area: '神奈川県' },
    { shop_name: '神奈川シンデレラグループ', email: 'rct@cin-gr.com', area: '神奈川県' },
    { shop_name: '神奈川横浜モンデミーテ', email: 'rct@hama-boin.com', area: '神奈川県' },
    { shop_name: '神奈川横浜夢見る乙女', email: 'job@yumemiruotome.com', area: '神奈川県' },
    { shop_name: '神奈川五十路マダムエクスプレス厚木店', email: 'isoji.atsugi@au.com', area: '神奈川県' },
    { shop_name: '神奈川Delice横浜店', email: 'delice.kyujin@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川横浜シンデレラ', email: 'rct@y-cin.jp', area: '神奈川県' },
    { shop_name: '神奈川ごほうびSPA横浜店', email: 'gohoubi_yokohama_job@star-group.co.jp', area: '神奈川県' },
    { shop_name: '神奈川熟女の風俗最終章 新横浜店', email: 'shinyoko.kyujin@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川丸妻 新横浜店', email: 'info@4c-group.net', area: '神奈川県' },
    { shop_name: '神奈川横浜駅前M性感rooM', email: 'yokohama-room@ezweb.ne.jp', area: '神奈川県' },
    { shop_name: '神奈川with SPA', email: 'withspa045@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川ナイショのARIEL', email: 'shinyoko.kyujin@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川ちぇっくいん横浜女学園', email: 'recruit@yokohama-j.com', area: '神奈川県' },
    { shop_name: '神奈川それいけヤリスギ学園 横浜校', email: 'yarisugi363@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川メンヘラ専門デリヘルゼロワン横浜本店', email: 'kyujin.yokohama045@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川LOVE横浜店', email: 'yokohama.love@yahoo.ne.jp', area: '神奈川県' },
    { shop_name: '神奈川横浜デリヘルLaRouge', email: 'job@larouge.jp', area: '神奈川県' },
    { shop_name: '神奈川横浜回春性感マッサージ倶楽部', email: 'k_yokohama_job@star-group.co.jp', area: '神奈川県' },
    { shop_name: '神奈川熟女の風俗最終章 本厚木店', email: 'kyuuzin.atsugi@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川奥鉄オクテツ神奈川店', email: 'derikyu-kanagawa@dh2020.jp', area: '神奈川県' },
    { shop_name: '神奈川One More 奥様 横浜関内店', email: 'info1oku@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川フィーリングin横浜', email: 'info.feeling2008@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川女々艶 厚木店', email: 'jojokyujin@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川熟女10000円デリヘル', email: 'info@j1g-045.com', area: '神奈川県' },
    { shop_name: '神奈川4Cグループ横浜', email: 'info@4c-group.net', area: '神奈川県' },
    { shop_name: '神奈川シンデレラグループ', email: 'rct@cin-gr.com', area: '神奈川県' },
    { shop_name: '神奈川One More 奥様 厚木店', email: 'atsugi.office@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川恋する人妻', email: 'realg9009@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川横浜関内人妻城', email: 'kyujin-kannai@more-g.jp', area: '神奈川県' },
    { shop_name: '神奈川川崎・東横人妻城', email: 'g4-kyuzin@more-g.jp', area: '神奈川県' },
    { shop_name: '神奈川Aromaスク水女学院', email: 'aromasukumizu@icloud.com', area: '神奈川県' },
    { shop_name: '神奈川性の極み技の伝道師Ver.新横浜店', email: 'k.yokohama8.27@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川厚木人妻城', email: 'g4-kyuzin@more-g.jp', area: '神奈川県' },
    { shop_name: '神奈川川崎ウルトラギャラクシー', email: 'ug.work.apply@gmail.com', area: '神奈川県' },
    { shop_name: '神奈川横浜人妻ヒットパレード', email: 'rct@tsuma-parade.jp', area: '神奈川県' },
    { shop_name: '東京いちゃいちゃ素人パパ活女子', email: 'popantingu1031@outlook.com', area: '東京都' },
    { shop_name: '東京六本木ルミエール', email: 'ike.nyandafull@gmail.com', area: '東京都' },
    { shop_name: '東京池袋にゃんだFULL', email: 'ike.nyandafull@gmail.com', area: '東京都' },
    { shop_name: '東京ぱいおつレンジャー', email: 'ike.nyandafull@gmail.com', area: '東京都' },
    { shop_name: '東京池袋Lumiere', email: 'ikenyandafull@gmail.com', area: '東京都' },
    { shop_name: '東京渋谷Lumiere', email: 'ike.nyandafull@gmail.com', area: '東京都' },
    { shop_name: '神奈川フィーリングループ（厚木エリア）', email: 'info@feeling-atsugi.com', area: '神奈川県' },
    { shop_name: '神奈川グランドオペラ横浜', email: 'recruit@y-opera.com', area: '神奈川県' },
    { shop_name: '神奈川横浜人妻セレブリティ', email: 'job@yk-celeb.com', area: '神奈川県' },
    { shop_name: '神奈川abc+', email: 'abcatsugi@gmail.com', area: '神奈川県' },
    { shop_name: '東京町田ラ・ムーン', email: 'info@club-lamoon.com', area: '東京都' },
    { shop_name: '東京C級グル女 鶯谷店', email: 'oubo_work@cgourmet.biz', area: '東京都' },
    { shop_name: '東京アバンチュール', email: 'aventure.job@docomo.ne.jp', area: '東京都' },
    { shop_name: '東京熟女紹介センター', email: 'exlsp2009@gmail.com', area: '東京都' },
    { shop_name: '東京おいしい人妻熟女', email: 'info@okusama.jp', area: '東京都' },
    { shop_name: '東京おいしい人妻熟女', email: 'info@okusama.jp', area: '東京都' },
    { shop_name: '東京Themis', email: 'themisginza@icloud.com', area: '東京都' },
    { shop_name: '東京熟女道楽 小岩店', email: 'info@jukujodoraku.com', area: '東京都' },
    { shop_name: '東京ウルトラセレブリティ', email: 'ug.work.apply@gmail.com', area: '東京都' },
    { shop_name: '東京性の極み 技の伝道師 五反田店', email: 'seiden.kiwami.gotanda@gmail.com', area: '東京都' },
    { shop_name: '東京僕のぽっちゃり伝説', email: 'info@bokupocha.com', area: '東京都' },
    { shop_name: '東京月の真珠-五反田-', email: 'job@tsukinoshinju-gotanda.jp', area: '東京都' },
    { shop_name: '東京池袋おかあさん', email: 'madre3@chorus.ocn.ne.jp', area: '東京都' },
    { shop_name: '東京町田相模原ちゃんこ', email: 'machida.chanko@gmail.com', area: '東京都' },
    { shop_name: '東京e-body', email: 'info@menseste-gotanda.com', area: '東京都' },
    { shop_name: '東京ハーモニー', email: 'mail@club-harmony.com', area: '東京都' },
    { shop_name: '東京池袋ギャルデリ', email: 'ecg9004@yahoo.co.jp', area: '東京都' },
    { shop_name: '東京エピソード', email: 'episodejob@docomo.ne.jp', area: '東京都' },
    { shop_name: '東京ぽっちゃり巨乳素人専門店ぷにめろ渋谷', email: 'punimelo.shibuya@gmail.com', area: '東京都' },
    { shop_name: '東京Unmoral', email: 'recruit@unmoral.jp', area: '東京都' },
    { shop_name: '東京ファーストクラス', email: 'info@sm-first-class.com', area: '東京都' },
    { shop_name: '東京渋谷ラブストーリー', email: 'job@sb.lv-story.com', area: '東京都' },
    { shop_name: '東京白いぽっちゃりさん 五反田店', email: 'rct@gotanda-siropocha.jp', area: '東京都' },
    { shop_name: '東京ピュアセレクラブ錦糸町', email: 'pureselection0420@yahoo.co.jp', area: '東京都' },
    { shop_name: '東京MSC妄想紳士倶楽部 鶯谷店', email: 'rct@msc-ugu.jp', area: '東京都' },
    { shop_name: '東京やりすぎさーくる新宿大久保店', email: 'genba.4035@gmail.com', area: '東京都' },
    { shop_name: '東京E+アイドルスクール', email: 'eplus.idol.school@gmail.com', area: '東京都' },
    { shop_name: '東京錦糸町 夜這右衛門娼店', email: 'kinshicho.481@gmail.com', area: '東京都' },
    { shop_name: '東京E+アイドルスクール品川店', email: 'edol.gotanda@gmail.com', area: '東京都' },
    { shop_name: '東京99 Memories', email: '99memories802@gmail.com', area: '東京都' },
    { shop_name: '東京上野M性感フェチ倶楽部 インサニティ東京', email: 'info@insanity-tokyo.com', area: '東京都' },
    { shop_name: '東京今夜、美人エステ嬢と', email: 'info@bijin-esthe.net', area: '東京都' },
    { shop_name: '東京妊婦母乳風俗専門店ミルクランド', email: 'milkland2@yahoo.co.jp', area: '東京都' },
    { shop_name: '東京新宿ハニープラザ', email: 'job-shinjuku@honeyplaza.biz', area: '東京都' },
    { shop_name: '東京しろうと娘in秋葉原', email: 'akiba-shirouto@docomo.ne.jp', area: '東京都' },
    { shop_name: '東京恋するセレブ 立川店', email: 'dh.celeb@gmail.com', area: '東京都' },
    { shop_name: '東京BBW 五反田店', email: 'info@gotanda-bbw.net', area: '東京都' },
    { shop_name: '東京逢Tokyo', email: 'info@ai-tokyo.com', area: '東京都' },
    { shop_name: '東京パールドロップ銀座', email: 'staff@gotanda.me', area: '東京都' },
    { shop_name: '東京ウルトラハピネス', email: 'ug.work.apply@gmail.com', area: '東京都' },
    { shop_name: '東京ヴィクトリアクラブ東京', email: 'info@victoria-tokyo.com', area: '東京都' },
    { shop_name: '東京CLUB 虎の穴 青山店', email: 'girls_reruit@tora-ana.jp', area: '東京都' },
    { shop_name: '東京AROMA TIGER 恵比寿店', email: 'girls_reruit@tora-ana.jp', area: '東京都' },
    { shop_name: '東京ニューミラージュ', email: 'taki.401crk@docomo.ne.jp', area: '東京都' },
    { shop_name: '東京風神会館', email: 'girls_reruit@tora-ana.jp', area: '東京都' },
    { shop_name: '東京TOKYO IDOL ACADEMY', email: 'girls_reruit@tora-ana.jp', area: '東京都' },
    { shop_name: '東京サンキュー町田・相模原店', email: '39machidasagami@gmail.com', area: '東京都' },
    { shop_name: '東京東京不倫 渋谷店', email: 'tokyooffice.shibuya@gmail.com', area: '東京都' },
    { shop_name: '東京MIRAI TOKYO 新宿店', email: 'info@mirai-shinjuku.tokyo', area: '東京都' },
    { shop_name: '東京池袋東口添い寝女子', email: 'rct@ikesoine.com', area: '東京都' },
    { shop_name: '東京TOKYO PRINCESS', email: 'akasaka2gro@gmail.com', area: '東京都' },
    { shop_name: '東京錦糸町ちゃんこ', email: 'kinshichochankolove@gmail.com', area: '東京都' },
    { shop_name: '東京シンデレラグループ', email: 'rct@cin-gr.com', area: '東京都' },
    { shop_name: '東京ぽっちゃり巨乳素人専門店ぷにめろ池袋', email: 'punimelo.ikebukuro@gmail.com', area: '東京都' },
    { shop_name: '東京フロンティアグループ', email: 'info@frontier-group.info', area: '東京都' },
    { shop_name: '東京バタフライ立川', email: 'butterflytachikawa0601@gmail.com', area: '東京都' },
    { shop_name: '東京メリッサ東京 品川店', email: 'recruit@melissa-shinagawa.net', area: '東京都' },
    { shop_name: '東京ELEGANCE', email: 'ec3@elegance2025.jp', area: '東京都' },
    { shop_name: '東京Delice錦糸町店', email: 'shiryu20004645@gmail.com', area: '東京都' },
    { shop_name: '東京Claris Tokyo', email: 'koubo314@gmail.com', area: '東京都' },
    { shop_name: '東京アナラードライ五反田店', email: 'koubo314@gmail.com', area: '東京都' },
    { shop_name: '東京新宿 秘書課女子', email: 'recruit@love-hips.com', area: '東京都' },
    { shop_name: '東京松戸人妻花壇', email: 'kyuzin@ls-group.jp', area: '東京都' },
    { shop_name: '東京ファンタジアルージュ五反田', email: 'recruit@fantasiarouge-gotanda.com', area: '東京都' },
    { shop_name: '東京THC SHINJUKU', email: 'thc.shinjuku@gmail.com', area: '東京都' },
    { shop_name: '東京銀座セレブ', email: 'recruit@ginza-celeb.com', area: '東京都' },
    { shop_name: '東京五反田M性感フェチ倶楽部マスカレード', email: '3pl.saiyou@gmail.com', area: '東京都' },
    { shop_name: '東京大塚 虹いろ回春', email: 'otsuka_nijiirokaishun@yahoo.co.jp', area: '東京都' },
    { shop_name: '東京ららら', email: 'support@t-lalala.net', area: '東京都' },
    { shop_name: '東京マダムアシュレイ麻布', email: 'madameashleymail@gmail.com', area: '東京都' },
    { shop_name: '東京ラブセレクション', email: 'shinkoiwa01@gmail.com', area: '東京都' },
    { shop_name: '東京Eureka!EGOIST', email: 'egoist.group.hachiouji88@gmail.com', area: '東京都' },
    { shop_name: '東京丸妻池袋店', email: 'g4-kyuzin@more-g.jp', area: '東京都' },
    { shop_name: '東京裸でマッサージTOKYO VIP', email: 'tokyovip@ymail.ne.jp', area: '東京都' },
    { shop_name: '東京立川人妻研究会', email: 'info@hitoduma-tachikawa.com', area: '東京都' },
    { shop_name: '東京ベリー', email: 'info@tokyo-berry.com', area: '東京都' },
    { shop_name: '東京クンニ専門店おクンニ学園池袋・大宮校', email: 'rec.okuni@gmail.com', area: '東京都' },
    { shop_name: '東京白いぽっちゃりさん 錦糸町店', email: 'rct@kinshicho-siropocha.jp', area: '東京都' },
    { shop_name: '東京tryst', email: 't_gyo_mu@icloud.com', area: '東京都' },
    { shop_name: '東京隙のあるエステ', email: 'sukinoaru.esthe@gmail.com', area: '東京都' },
    { shop_name: '東京麗奈TOKYO', email: 'reserve@madam-rena.com', area: '東京都' },
    { shop_name: '東京錦糸町人妻花壇', email: 'ju-recruit@more-g.jp', area: '東京都' },
    { shop_name: '東京君とふわふわプリンセス立川店', email: 'fuwa.tachikawa@gmail.com', area: '東京都' },
    { shop_name: '東京月経仮面', email: 'wgoodjob@dune.ocn.ne.jp', area: '東京都' },
    { shop_name: '東京トムソーヤ 町田店', email: 'machidahitoduma@gmail.com', area: '東京都' },
    { shop_name: '東京ぽっちゃり巨乳素人専門店ぷにめろ蒲田', email: 'punimelo.kamata@gmail.com', area: '東京都' },
    { shop_name: '東京プリコレ', email: 'info@pricolle.jp', area: '東京都' },
    { shop_name: '東京熟女の風俗最終章 池袋店', email: 'info@saisyuusyou-ikebukuro.com', area: '東京都' },
    { shop_name: '東京池袋マル秘エステ', email: 'maruhiesthe@gmail.com', area: '東京都' },
    { shop_name: '東京マネLOVE', email: 'recruit@fuzoku-lovegrp.net', area: '東京都' },
    { shop_name: '東京クラブアイリス東京', email: 'iris-tokyo@vipclub-iris.com', area: '東京都' },
    { shop_name: '東京オトナのマル秘最前線', email: 'info.otona.szs@gmail.com', area: '東京都' },
    { shop_name: '東京櫻女学院', email: 'machidakaisya@gmail.com', area: '東京都' },
    { shop_name: '東京八王子ペロンチョ学園', email: 'hachiouji.pero@gmail.com', area: '東京都' },
    { shop_name: '東京鶯谷デリヘル倶楽部', email: 'udc.recruit@gmail.com', area: '東京都' },
    { shop_name: '東京蒲田ちゃんこ', email: 'kamata.chanko.2nd@gmail.com', area: '東京都' },
    { shop_name: '東京ピュアエンジェル', email: 'info@pureangel.jp', area: '東京都' },
    { shop_name: '東京素人妻達☆マイふぇらレディー', email: 'feralady.03@gmail.com', area: '東京都' },
    { shop_name: '東京性春放課後スクワット五反田編', email: 'cast@peroncho92gotanda.com', area: '東京都' },
    { shop_name: '東京A Beauty', email: 'a.beauty0402@gmail.com', area: '東京都' },
    { shop_name: '東京CCキャッツ', email: 'c.c.cats1981@gmail.com', area: '東京都' },
    { shop_name: '東京奥様はエンジェル立川', email: 'info@okusama-angel.jp', area: '東京都' },
    { shop_name: '東京赤坂プリンセス', email: 'akasaka2gro@gmail.com', area: '東京都' },
    { shop_name: '東京女神の極み', email: 'tachikawa@megami-kiwami.jp', area: '東京都' },
    { shop_name: '東京こあくまな熟女たち 池袋店', email: 'recruit_girls_east@koakumagroup.com', area: '東京都' },
    { shop_name: '東京OTONA JOSHI 錦糸町', email: 'job@kinshicho.o-joshi.tokyo', area: '東京都' },
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
