-- ホテル検索パフォーマンス向上のためのインデックス
-- Supabase SQL Editor で実行

-- 都道府県 + エリア検索用
CREATE INDEX IF NOT EXISTS idx_hotels_pref_area
ON hotels(prefecture, major_area, detail_area);

-- 都道府県 + 市区町村検索用
CREATE INDEX IF NOT EXISTS idx_hotels_pref_city
ON hotels(prefecture, city);

-- ホテルタイプ検索用
CREATE INDEX IF NOT EXISTS idx_hotels_type
ON hotels(hotel_type);

-- レポートのhotel_id検索用
CREATE INDEX IF NOT EXISTS idx_reports_hotel_id
ON reports(hotel_id, created_at DESC);

-- 店舗のemail検索用（ログイン時）
CREATE INDEX IF NOT EXISTS idx_shops_email
ON shops(email);

-- 広告配置のエリア検索用
CREATE INDEX IF NOT EXISTS idx_shop_placements_area
ON shop_placements(level, target_name);

-- 広告配置の type+status+mode 検索用（ads.php高速化）
CREATE INDEX IF NOT EXISTS idx_ad_placements_type_status_mode
ON ad_placements(placement_type, status, mode);

-- 店舗ホテル情報の hotel_id+can_call 検索用（area-shops.php高速化）
CREATE INDEX IF NOT EXISTS idx_shop_hotel_info_hotel_can_call
ON shop_hotel_info(hotel_id, can_call);

-- 店舗画像の shop_id 検索用（ads.php/area-shops.php高速化）
CREATE INDEX IF NOT EXISTS idx_shop_images_shop_id
ON shop_images(shop_id, sort_order);
