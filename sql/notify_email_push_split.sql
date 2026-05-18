-- =========================================================================
-- 2026-05-19: メール通知とアプリ(push)通知の設定を完全分離
-- =========================================================================
-- 旧: chat_notify_mode (off/first/every) 1カラムで両方を制御
-- 新: notify_email_mode (off/first/every) + notify_push_mode (off/on) の2カラム
--
-- 旧カラム (chat_notify_mode / notify_mode) は当面残す (後方互換 / 移行確認用).
-- データ移行後にコード側を新カラム参照に切り替え、確認後に旧カラム削除.
-- =========================================================================

-- shop_casts: キャスト個別の通知設定
ALTER TABLE shop_casts
  ADD COLUMN notify_email_mode ENUM('off','first','every') NOT NULL DEFAULT 'off' AFTER chat_notify_mode,
  ADD COLUMN notify_push_mode  ENUM('off','on')           NOT NULL DEFAULT 'on'  AFTER notify_email_mode;

-- shop_chat_status: 店舗オーナーの通知設定
ALTER TABLE shop_chat_status
  ADD COLUMN notify_email_mode ENUM('off','first','every') NOT NULL DEFAULT 'off' AFTER notify_mode,
  ADD COLUMN notify_push_mode  ENUM('off','on')           NOT NULL DEFAULT 'on'  AFTER notify_email_mode;

-- 既存値マイグレーション
UPDATE shop_casts        SET notify_email_mode = chat_notify_mode;
UPDATE shop_chat_status  SET notify_email_mode = notify_mode;

-- 検証: 件数確認
SELECT 'shop_casts' AS t, notify_email_mode, notify_push_mode, COUNT(*) AS n
FROM shop_casts GROUP BY notify_email_mode, notify_push_mode
UNION ALL
SELECT 'shop_chat_status' AS t, notify_email_mode, notify_push_mode, COUNT(*) AS n
FROM shop_chat_status GROUP BY notify_email_mode, notify_push_mode;
