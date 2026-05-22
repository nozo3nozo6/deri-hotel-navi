-- 2026-05-21: 店舗専用ページに表示する「対応エリア」を店舗オーナーが自由に登録するテーブル.
-- 契約プラン (shop_placements, 料金連動) とは独立. 表示用途のみ.
--
-- is_primary=1 の行が「メインエリア」. 店舗専用 URL (/deli/shop/{slug}/) を開いた時に
-- URL パラメータ無し & is_primary 行ありなら自動でそのエリアにリダイレクト.
-- 1 店舗 1 メイン. UNIQUE 制約は使わず application layer で「set-primary 時に他の is_primary=0 に UPDATE」で保証.

CREATE TABLE IF NOT EXISTS shop_service_areas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shop_id CHAR(36) NOT NULL,
    pref VARCHAR(20) NULL COMMENT '都道府県名 (例: 東京都). クリック時のナビ用',
    area VARCHAR(80) NULL COMMENT '主要エリア (例: 東京２３区内, 西東京・三多摩)',
    detail VARCHAR(80) NULL COMMENT '詳細エリア (例: 上野・浅草・錦糸町・新小岩・北千住)',
    city VARCHAR(80) NULL COMMENT '市区町村 (例: 練馬区)',
    label VARCHAR(80) NOT NULL COMMENT '表示用テキスト. pref/area/city のいずれかから自動生成',
    is_primary TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=メインエリア (店舗 URL 着地点). 1 店舗 1 行のみ',
    sort_order INT NOT NULL DEFAULT 0 COMMENT '表示順 (小さい順)',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_shop_sort (shop_id, sort_order),
    KEY idx_shop_primary (shop_id, is_primary)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='店舗専用ページ表示用の対応エリア (契約プランとは独立)';
