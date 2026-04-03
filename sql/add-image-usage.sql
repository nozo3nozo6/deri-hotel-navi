-- shop_images に usage カラム追加（リッチ広告/スタンダード広告の画像を分離）
ALTER TABLE shop_images ADD COLUMN `usage` VARCHAR(10) DEFAULT 'rich' AFTER sort_order;
