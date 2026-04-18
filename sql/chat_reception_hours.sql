-- =============================================
-- YobuChat 受付時間機能 追加マイグレーション
-- shop_chat_status に reception_start / reception_end 追加
-- NULL = 24時間受付, start > end = 日跨ぎ営業 (例 18:00 - 05:00)
-- =============================================

ALTER TABLE shop_chat_status
    ADD COLUMN reception_start TIME NULL COMMENT '受付開始時刻 (Asia/Tokyo). NULL=24時間受付' AFTER notify_min_interval_minutes,
    ADD COLUMN reception_end TIME NULL COMMENT '受付終了時刻 (Asia/Tokyo). NULL=24時間受付. start>endは日跨ぎ営業' AFTER reception_start;
