-- 2026-05-19: 受信箱から不要チャットを削除する機能 (案A: 一覧の ✕ アイコン).
-- 論理削除: deleted_at セット → 全 inbox/messages クエリで WHERE deleted_at IS NULL.
-- 30日後にバッチで物理削除する運用ルール推奨.

ALTER TABLE chat_sessions
  ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL AFTER status,
  ADD INDEX idx_chat_sessions_deleted_at (deleted_at);
