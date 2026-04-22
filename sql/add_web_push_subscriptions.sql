-- ==========================================================================
-- Day 9: web_push_subscriptions
--   Web Push 購読エンドポイント (RFC 8292 VAPID).
--   subject_type + subject_id で誰の通知先か識別する。
--     subject_type='shop'    ->  shop_id
--     subject_type='cast'    ->  shop_cast_id (casts.id)
--     subject_type='visitor' ->  chat_sessions.id
--   1デバイス=1レコード、endpoint ごとに UNIQUE（同一デバイス再購読は上書き）。
--   device_token は owner/cast 判別時の紐付け補助 (shop_chat_devices / cast_devices).
-- ==========================================================================

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    subject_type ENUM('shop','cast','visitor') NOT NULL,
    subject_id CHAR(36) NOT NULL,
    device_token VARCHAR(128) NULL,
    endpoint TEXT NOT NULL,
    endpoint_hash CHAR(64) NOT NULL,
    p256dh VARCHAR(128) NOT NULL,
    auth VARCHAR(32) NOT NULL,
    ua VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_success_at DATETIME NULL,
    failure_count INT UNSIGNED NOT NULL DEFAULT 0,
    UNIQUE KEY uq_endpoint_hash (endpoint_hash),
    KEY idx_subject (subject_type, subject_id),
    KEY idx_device (device_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
