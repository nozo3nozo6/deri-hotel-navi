-- =============================================
-- YobuChat 通知先メール（任意） カラム追加
-- shop_chat_status.notify_email:
--   NULL/空 → shops.email を通知先として使用（デフォルト）
--   値あり → notify_email のみに送信（登録メールには送らない）
-- =============================================

ALTER TABLE shop_chat_status
    ADD COLUMN notify_email VARCHAR(255) NULL
        COMMENT '通知専用メール (未設定時は shops.email を使用)'
        AFTER welcome_message;
