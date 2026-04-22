-- Day 8: typing indicator
-- 入力中を双方向で伝えるための ephemeral フラグ.
-- PHPが DATE_ADD(NOW(), INTERVAL 6 SECOND) で更新, poll側は > NOW() で判定.
-- 自然減衰するのでクリーンアップ不要.

ALTER TABLE chat_sessions
  ADD COLUMN visitor_typing_until DATETIME NULL AFTER last_owner_heartbeat_at,
  ADD COLUMN shop_typing_until DATETIME NULL AFTER visitor_typing_until;
