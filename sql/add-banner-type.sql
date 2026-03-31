-- shops テーブルに banner_type カラム追加
-- banner: 1枚バナー(1309×500), photos: 写真3枚(435×500×3), NULL: 未設定
ALTER TABLE shops ADD COLUMN banner_type VARCHAR(10) DEFAULT NULL AFTER thumbnail_url;
