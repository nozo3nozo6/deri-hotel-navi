-- =============================================
-- YobuChat DO-Ready 仕様化マイグレーション (2026-04-18)
-- 目的: Cloudflare Durable Objects (WebSocket Hibernation) への将来移行を
--       launch前に痛くなく行うためのスキーマ準備.
--
-- 変更:
--   1. chat_messages.client_msg_id VARCHAR(36) UNIQUE
--      - 送信側が生成したUUID. WS再接続中の重複送信を冪等化.
--   2. chat_sessions.last_visitor_heartbeat_at / last_owner_heartbeat_at
--      - presence追跡用. poll tick毎に更新. WS版でも同カラムをそのまま使える.
--   3. chat_messages にINDEX idx_session_id_desc 追加
--      - since_id での取得を高速化 (WS reconnect リプレイ性能)
-- =============================================

-- 1. chat_messages に client_msg_id を追加
ALTER TABLE chat_messages
    ADD COLUMN client_msg_id VARCHAR(36) NULL
        COMMENT 'クライアント生成UUID. 重複送信の冪等化に使用' AFTER id,
    ADD UNIQUE KEY uq_client_msg_id (client_msg_id);

-- 2. chat_sessions に presence heartbeat カラム追加
ALTER TABLE chat_sessions
    ADD COLUMN last_visitor_heartbeat_at DATETIME NULL
        COMMENT 'visitor側が最後にsubscribe tickした時刻 (presence判定用)',
    ADD COLUMN last_owner_heartbeat_at DATETIME NULL
        COMMENT 'owner側が最後にsubscribe tickした時刻 (presence判定用)';

-- 3. since_id リプレイ高速化用インデックス
-- (既存 idx_session_time(session_id, sent_at) があるが、
--  id基準の取得 WHERE session_id=? AND id>? ORDER BY id ASC にはid軸のindexが有効)
ALTER TABLE chat_messages
    ADD INDEX idx_session_id (session_id, id);
