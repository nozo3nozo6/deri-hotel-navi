-- =============================================
-- YobuChat: chat_sessions に nickname / lang カラム追加
-- DO 版でセッション作成時に送られる nickname/lang を
-- MySQL mirror 側でも保持する (owner-inbox の表示に使用).
-- 2026-04-20
-- =============================================

ALTER TABLE chat_sessions
    ADD COLUMN nickname VARCHAR(20) NULL AFTER visitor_hash,
    ADD COLUMN lang VARCHAR(5) NULL AFTER nickname;
