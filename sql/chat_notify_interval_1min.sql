-- 2026-05-20: 最小通知間隔を全店舗 1 分固定に統一 (ユーザー要望).
-- shop-admin UI から「最小通知間隔」入力フィールドは隠蔽し、PHP/JS デフォルトも 1 に変更.
-- 既存値 (3 分等) を 1 に正規化し、DEFAULT 値も 1 に変更.
-- 本ファイルは production DB で既に適用済み (2026-05-20).

UPDATE shop_chat_status SET notify_min_interval_minutes = 1 WHERE notify_min_interval_minutes <> 1;

ALTER TABLE shop_chat_status
  MODIFY COLUMN notify_min_interval_minutes INT UNSIGNED NOT NULL DEFAULT 1
  COMMENT '最小通知間隔 (分). 2026-05-20 から 1 分固定';
