-- 2026-05-16: メール通知キュー (受付時間外の通知保留).
-- 受付時間外に到着したメッセージを後で受付時間内になったタイミングでまとめてメール送信する.
-- 値 1 = 通知保留中. 0 = 通知済み or 不要.

ALTER TABLE chat_sessions
  ADD COLUMN notify_pending TINYINT(1) NOT NULL DEFAULT 0
  COMMENT '1=受付時間外で保留中のメッセージがあるセッション';

-- 走査用インデックス (cron flush で WHERE notify_pending=1 を頻繁に叩くため)
CREATE INDEX idx_chat_sessions_notify_pending ON chat_sessions (notify_pending);
