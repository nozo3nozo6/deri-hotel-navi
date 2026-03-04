-- reportsテーブルにshop_idカラムを追加（店舗投稿の紐付け用）
ALTER TABLE reports ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES shops(id);
