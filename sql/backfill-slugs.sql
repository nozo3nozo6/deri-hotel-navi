-- 既存店舗にランダムslugを一括付与（slug未設定のもののみ）
-- SSHトンネル経由またはサーバー上で実行

-- 確認: slug未設定の店舗数
SELECT COUNT(*) AS shops_without_slug FROM shops WHERE slug IS NULL OR slug = '';

-- ランダム8文字slug付与（MySQL/MariaDB）
UPDATE shops
SET slug = LOWER(CONCAT(
    SUBSTRING(MD5(RAND()), 1, 4),
    SUBSTRING(MD5(RAND()), 1, 4)
)),
    updated_at = NOW()
WHERE slug IS NULL OR slug = '';

-- 重複チェック（0件であること）
SELECT slug, COUNT(*) AS cnt FROM shops GROUP BY slug HAVING cnt > 1;
