-- ==========================================================================
-- migration_slider_banner_shops.sql
--   スライダー / バナーに「表示店舗」トグル（立川・吉祥寺）を追加。
--   キャスト(girl_shops)と同じ多対多 junction 方式。
--
--   ・sliders.shop_id / banners.shop_id … オーナー店（CTRL一覧の所属・ドロップダウンで決定）は据え置き
--   ・slider_shops / banner_shops        … 表示先店舗（チェックボックス、デフォ両店ON）
--   ・表示API(sliders.php/banners.php) は junction 参照で「この店に出す行」を絞る
--   ・既存行は「自店のみ表示」でバックフィル＝現状の挙動を完全維持（無回帰）
--
--   FK ON DELETE CASCADE：親(slider/banner)削除時に junction 行も自動削除。
--   両サイト共有DB（yobuho_kichifu）で1回だけ実行。
-- ==========================================================================

CREATE TABLE IF NOT EXISTS slider_shops (
  slider_id BIGINT(20) UNSIGNED NOT NULL,
  shop_id   BIGINT(20) UNSIGNED NOT NULL,
  PRIMARY KEY (slider_id, shop_id),
  KEY idx_slider_shops_shop (shop_id),
  CONSTRAINT fk_slider_shops_slider FOREIGN KEY (slider_id) REFERENCES sliders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS banner_shops (
  banner_id BIGINT(20) UNSIGNED NOT NULL,
  shop_id   BIGINT(20) UNSIGNED NOT NULL,
  PRIMARY KEY (banner_id, shop_id),
  KEY idx_banner_shops_shop (shop_id),
  CONSTRAINT fk_banner_shops_banner FOREIGN KEY (banner_id) REFERENCES banners (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- バックフィル：既存行は自分のオーナー店だけに表示（現状維持）。
-- INSERT IGNORE で再実行しても重複しない（冪等）。
INSERT IGNORE INTO slider_shops (slider_id, shop_id)
  SELECT id, shop_id FROM sliders;

INSERT IGNORE INTO banner_shops (banner_id, shop_id)
  SELECT id, shop_id FROM banners;
