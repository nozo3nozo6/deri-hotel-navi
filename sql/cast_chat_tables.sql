-- Cast機能 Phase 4: キャスト ↔ 訪問者チャット連携
-- 実行日: 2026-04-21
-- 目的: 既存 YobuChat (訪問者 ↔ 店舗) にキャスト担当セッションの概念を追加
--       店舗側は全セッションを閲覧できるが、キャスト担当セッションには返信不可（不正監視用）

-- 1. chat_sessions にキャスト担当カラム追加
--    NULL = 店舗オーナー担当（既存動作）
--    cast_id (UUID) = キャスト本人が担当（店舗は閲覧のみ）
ALTER TABLE chat_sessions
    ADD COLUMN cast_id CHAR(36) NULL DEFAULT NULL
    COMMENT 'NULL=店舗オーナー担当 / UUID=キャスト担当（店舗は閲覧のみ）' AFTER shop_id;

-- cast_id → casts.id の FK（キャスト削除時はセッションを残し担当だけ NULL に戻す）
ALTER TABLE chat_sessions
    ADD CONSTRAINT fk_chat_sessions_cast
    FOREIGN KEY (cast_id) REFERENCES casts(id) ON DELETE SET NULL;

-- 店舗の全セッション表示＋キャスト別フィルタ用 index
CREATE INDEX idx_chat_sessions_shop_cast ON chat_sessions(shop_id, cast_id, status, last_activity_at);
CREATE INDEX idx_chat_sessions_cast_active ON chat_sessions(cast_id, status, last_activity_at);

-- 2. shop_casts にチャット関連の在線情報追加
--    キャスト本人がチャット機能を使うためのオンライン/通知フラグ
ALTER TABLE shop_casts
    ADD COLUMN chat_is_online TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'キャストがチャット受付中かどうか',
    ADD COLUMN chat_last_online_at DATETIME NULL DEFAULT NULL COMMENT 'キャスト最終オンライン日時',
    ADD COLUMN chat_notify_mode ENUM('first','every','off') NOT NULL DEFAULT 'off'
        COMMENT 'キャスト向けメール通知: first=セッション初回のみ / every=都度 / off=通知なし。デフォルトOFF';

-- 3. chat_messages に client_msg_id 冪等UNIQUEがキャストにも効くよう既存（shop_id共通）
--    → 変更不要（session_id経由でchat_sessionsに紐付く）
