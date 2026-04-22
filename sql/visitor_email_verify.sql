-- Visitor email Magic Link verification (2026-04-23)
-- 訪問者が入力したメールアドレスが本人のものか確認してから通知を送る(いたずら防止).
-- visitor_email_verified=1 でなければ chat-notify-visitor.php は送信スキップする.
ALTER TABLE chat_sessions
  ADD COLUMN visitor_email_verified TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN visitor_email_verify_token VARCHAR(64) DEFAULT NULL,
  ADD COLUMN visitor_email_verify_expires_at DATETIME DEFAULT NULL;

-- トークン → セッション逆引き用.
CREATE INDEX idx_chat_sessions_verify_token
  ON chat_sessions (visitor_email_verify_token);
