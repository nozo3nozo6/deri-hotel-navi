-- shop_contracts に更新期限カラム追加
ALTER TABLE shop_contracts ADD COLUMN expires_at DATE DEFAULT NULL;

-- 既存有料契約にデフォルト期限設定（created_at + 1ヶ月）
UPDATE shop_contracts SET expires_at = DATE_ADD(DATE(created_at), INTERVAL 1 MONTH) WHERE plan_id > 1;
