-- Visitor email notification opt-in columns
ALTER TABLE chat_sessions
  ADD COLUMN visitor_email VARCHAR(255) DEFAULT NULL,
  ADD COLUMN visitor_notify_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN visitor_last_notified_at DATETIME DEFAULT NULL;

CREATE INDEX idx_chat_sessions_notify
  ON chat_sessions (visitor_notify_enabled, visitor_last_notified_at);
