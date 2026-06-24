-- ==========================================================================
-- seed.sql — 初期データ（kichifu / admi 店舗 + 既知マスタ）
--   schema.sql 実行後に流す。masters は kichifu(shop_id=1)向け。
-- ==========================================================================
SET NAMES utf8mb4;

-- ---------- 店舗 ----------
INSERT INTO shops (id, slug, name, full_name, area, since_year, tel, line_url, reception, fujoho_id, ga_id, is_active) VALUES
  (1, 'kichifu', 'アドミ', 'アドミ since2009 吉祥寺デリヘル & Go To FANTASY', '吉祥寺', 2009, '090-1045-9155', '', '10:00〜翌5:00', '53179', 'G-50Q48YG34Z', 1),
  (2, 'admi',    'アドミ', 'アドミ since2002 立川デリヘル & Go To FANTASY 東京本店', '立川', 2002, '042-528-2888', 'https://line.me/ti/p/L4-1uY6q2e', '10:00〜翌5:00', '57', 'G-50Q48YG34Z', 0);

-- ---------- 女性カテゴリー（アドミ / GTF） ----------
INSERT INTO girl_categories (shop_id, name, sort) VALUES
  (1, 'アドミ', 0),
  (1, 'GTF',   1);

-- ---------- 女性オプション（プレイ項目） ----------
INSERT INTO girl_options (shop_id, name, is_basic, sort) VALUES
  (1, 'シャワータイム',  1, 0),
  (1, '生キス',          1, 1),
  (1, '全身リップ',      1, 2),
  (1, '玉舐め',          1, 3),
  (1, '生フェラ',        1, 4),
  (1, '指入れ',          1, 5),
  (1, '素股(発射OK)',    1, 6),
  (1, '口内発射',        1, 7),
  (1, 'コスチューム',    0, 8),
  (1, 'ローター',        0, 9),
  (1, 'バイブ',          0, 10),
  (1, '電マ',            0, 11),
  (1, 'ソフトSM',        0, 12),
  (1, 'SMコース',        0, 13),
  (1, '撮影',            0, 14);

-- ---------- 女性プロフィール（質問テンプレ） ----------
INSERT INTO girl_profiles (shop_id, name, type, lang, sort) VALUES
  (1, '血液型は？',                 'list', 'ja', 0),
  (1, '出身地は？',                 'list', 'ja', 1),
  (1, '前職/現職は？',              'text', 'ja', 2),
  (1, '性感帯？',                   'text', 'ja', 3),
  (1, '好きな体位？',               'text', 'ja', 4),
  (1, 'Hな気分になる時は？',        'text', 'ja', 5),
  (1, 'タバコは？',                 'text', 'ja', 6),
  (1, '得意料理は？',               'text', 'ja', 7),
  (1, 'チャームポイントは？',       'text', 'ja', 8),
  (1, 'お客様に何と呼ばれたい？',   'text', 'ja', 9),
  (1, '異性に言われて嬉しい言葉は？', 'text', 'ja', 10);

-- 血液型の選択肢（list型）
INSERT INTO girl_profile_options (girl_profile_id, label, sort)
SELECT id, 'A型', 0 FROM girl_profiles WHERE shop_id=1 AND name='血液型は？'
UNION ALL SELECT id, 'B型', 1 FROM girl_profiles WHERE shop_id=1 AND name='血液型は？'
UNION ALL SELECT id, 'O型', 2 FROM girl_profiles WHERE shop_id=1 AND name='血液型は？'
UNION ALL SELECT id, 'AB型', 3 FROM girl_profiles WHERE shop_id=1 AND name='血液型は？'
UNION ALL SELECT id, '秘密', 4 FROM girl_profiles WHERE shop_id=1 AND name='血液型は？';

-- ---------- 料金コース ----------
INSERT INTO courses (shop_id, name, minutes, price, is_initial, sort) VALUES
  (1, '60分',  60,  11000, 0, 0),
  (1, '90分',  90,  16500, 0, 1),
  (1, '120分', 120, 22000, 0, 2),
  (1, '150分', 150, 27500, 0, 3),
  (1, '180分', 180, 33000, 0, 4);

-- ---------- 設定（key-value 例） ----------
INSERT INTO configs (shop_id, config_key, config_value) VALUES
  (1, 'site_title', 'アドミ since2009 吉祥寺デリヘル'),
  (1, 'contact_to_email', 'info@kichifu.com'),
  (1, 'contact_from_email', 'no-reply@kichifu.com');

-- ---------- 管理者（初期アカウント） ----------
-- パスワードハッシュは bcrypt で生成してから INSERT すること（平文を置かない）:
--   php -r "echo password_hash('ここにパスワード', PASSWORD_BCRYPT), PHP_EOL;"
-- 生成した $2y$... を下記の '<BCRYPT_HASH>' に貼って実行:
-- INSERT INTO admins (shop_id, username, password_hash, display_name, role)
--   VALUES (NULL, 'admin', '<BCRYPT_HASH>', '運営', 'owner');
