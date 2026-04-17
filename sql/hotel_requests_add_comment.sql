-- hotel_requests テーブルに comment カラムを追加
-- 投稿者が補足情報（営業中/閉業/移転など）を任意で送れるように

ALTER TABLE hotel_requests
  ADD COLUMN comment TEXT NULL AFTER hotel_type;
