-- ==========================================================================
-- migration_image_tags.sql — 特徴タグ(女性イメージ) + 店舗コメント
--   schema.sql 実行済みのDBに追記で流す。冪等（IF NOT EXISTS / 存在チェック）。
--   admi管理画面(MINERVA)の「女性イメージ」29種 + shop_comment に対応。
-- ==========================================================================
SET NAMES utf8mb4;

-- ---------- 特徴タグ マスタ（可愛い系 / 清楚 / スレンダー / 愛嬌抜群 等） ----------
CREATE TABLE IF NOT EXISTS girl_image_tags (
  id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id   BIGINT UNSIGNED NOT NULL,
  name      VARCHAR(40) NOT NULL,
  sort      INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_gtag_shop (shop_id, sort),
  CONSTRAINT fk_gtag_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 女性 × 特徴タグ ----------
CREATE TABLE IF NOT EXISTS girl_image_tag_links (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  girl_id           BIGINT UNSIGNED NOT NULL,
  girl_image_tag_id BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uq_gtaglink (girl_id, girl_image_tag_id),
  CONSTRAINT fk_gtaglink_girl FOREIGN KEY (girl_id) REFERENCES girls(id) ON DELETE CASCADE,
  CONSTRAINT fk_gtaglink_tag  FOREIGN KEY (girl_image_tag_id) REFERENCES girl_image_tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 店舗コメント（女の子コメント comment とは別の店長/店舗紹介文） ----------
-- MariaDB 10.11 / MySQL 8 は ADD COLUMN IF NOT EXISTS 対応
ALTER TABLE girls ADD COLUMN IF NOT EXISTS shop_comment MEDIUMTEXT NULL AFTER comment;

-- ---------- 特徴タグ 初期マスタ（kichifu shop_id=1、admi女性イメージ29種に準拠） ----------
INSERT INTO girl_image_tags (shop_id, name, sort)
SELECT t.* FROM (
            SELECT 1 AS shop_id, 'オススメ'        AS name,  0 AS sort
  UNION ALL SELECT 1, '素人',           1
  UNION ALL SELECT 1, '未経験',         2
  UNION ALL SELECT 1, '可愛い系',       3
  UNION ALL SELECT 1, '綺麗系',         4
  UNION ALL SELECT 1, 'お嬢様',         5
  UNION ALL SELECT 1, '女子大生',       6
  UNION ALL SELECT 1, 'OL系',           7
  UNION ALL SELECT 1, 'セクシー',       8
  UNION ALL SELECT 1, '清楚',           9
  UNION ALL SELECT 1, '癒し',          10
  UNION ALL SELECT 1, 'ギャル系',      11
  UNION ALL SELECT 1, 'モデル系',      12
  UNION ALL SELECT 1, 'ロリ系',        13
  UNION ALL SELECT 1, 'グラマー',      14
  UNION ALL SELECT 1, 'スレンダー',    15
  UNION ALL SELECT 1, '美乳',          16
  UNION ALL SELECT 1, '美脚',          17
  UNION ALL SELECT 1, '巨乳',          18
  UNION ALL SELECT 1, '色白',          19
  UNION ALL SELECT 1, '愛嬌抜群',      20
  UNION ALL SELECT 1, 'イチャイチャ系',21
  UNION ALL SELECT 1, 'テクニシャン',  22
  UNION ALL SELECT 1, '痴女',          23
  UNION ALL SELECT 1, 'サービス抜群',  24
  UNION ALL SELECT 1, '敏感',          25
  UNION ALL SELECT 1, '濃厚サービス',  26
  UNION ALL SELECT 1, '天然',          27
  UNION ALL SELECT 1, 'おっとり',      28
) AS t
WHERE NOT EXISTS (SELECT 1 FROM girl_image_tags WHERE shop_id = 1);
