-- =============================================
-- YobuChat Phase 1 用DBスキーマ
-- MySQL 8.0 / InnoDB / utf8mb4
-- shops.id は CHAR(36) (UUID) に合わせて shop_id も CHAR(36)
-- =============================================

-- 1. チャットセッション（匿名ユーザーごとの会話スレッド）
CREATE TABLE IF NOT EXISTS chat_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    shop_id CHAR(36) NOT NULL,
    session_token VARCHAR(64) NOT NULL UNIQUE COMMENT 'localStorageに保存するUUID（匿名ユーザー識別）',
    visitor_hash VARCHAR(64) NULL COMMENT 'IP+UAハッシュ（レート制限・荒らし対策）',
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'ON UPDATE無し。明示的なUPDATEでのみ更新（heartbeatで勝手に進まないため）',
    closed_at DATETIME NULL,
    status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
    source ENUM('portal', 'widget', 'standalone') NOT NULL DEFAULT 'standalone',
    notified_at DATETIME NULL COMMENT '初回メール通知済みフラグ（firstモード用）',
    blocked TINYINT(1) NOT NULL DEFAULT 0 COMMENT '店舗側がこのセッションをブロック済み',
    INDEX idx_shop_active (shop_id, status, last_activity_at),
    INDEX idx_session_token (session_token),
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. チャットメッセージ
CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    sender_type ENUM('visitor', 'shop') NOT NULL,
    message TEXT NOT NULL,
    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at DATETIME NULL COMMENT '相手側が既読にした時間',
    INDEX idx_session_time (session_id, sent_at),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. 店舗チャット定型文テンプレート
CREATE TABLE IF NOT EXISTS shop_chat_templates (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    shop_id CHAR(36) NOT NULL,
    title VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    sort_order INT UNSIGNED NOT NULL DEFAULT 100,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_shop (shop_id),
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. 店舗チャット状態（ON/OFF + 通知設定 + 有効化フラグ兼用）
--    Phase 1 ではこのテーブルにレコードがあれば「チャット機能有効」として扱う
CREATE TABLE IF NOT EXISTS shop_chat_status (
    shop_id CHAR(36) PRIMARY KEY,
    is_online TINYINT(1) NOT NULL DEFAULT 0,
    last_online_at DATETIME NULL,
    auto_off_minutes INT UNSIGNED NOT NULL DEFAULT 10 COMMENT '無応答で自動OFFになる分数（Phase 2で使用）',
    notify_mode ENUM('first', 'every', 'off') NOT NULL DEFAULT 'first' COMMENT 'メール通知モード: first=セッション初回のみ, every=都度, off=無効',
    notify_min_interval_minutes INT UNSIGNED NOT NULL DEFAULT 3 COMMENT 'everyモード時の最小通知間隔（分）',
    reception_start TIME NULL COMMENT '受付開始時刻 (Asia/Tokyo). NULL=24時間受付',
    reception_end TIME NULL COMMENT '受付終了時刻 (Asia/Tokyo). NULL=24時間受付. start>endは日跨ぎ営業',
    welcome_message VARCHAR(200) NULL COMMENT '訪問者向けウェルカムメッセージ (未設定時はクライアント側デフォルト)',
    notify_email VARCHAR(255) NULL COMMENT '通知専用メール (未設定時は shops.email を使用)',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. オーナー端末登録（ウィジェット/スタンドアロンで管理モード表示用）
CREATE TABLE IF NOT EXISTS shop_chat_devices (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    shop_id CHAR(36) NOT NULL,
    device_token VARCHAR(128) NOT NULL UNIQUE COMMENT 'localStorage + DBで照合',
    device_name VARCHAR(100) NULL COMMENT '「スマホ1」「PC」など任意名称',
    registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_shop_device (shop_id, device_token),
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. ブロックリスト（店舗ごとに荒らしユーザーを遮断）
--    visitor_hash = IP+UAハッシュ。ブロック済みハッシュからは新規セッション作成不可
CREATE TABLE IF NOT EXISTS chat_blocks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    shop_id CHAR(36) NOT NULL,
    visitor_hash VARCHAR(64) NOT NULL,
    reason VARCHAR(255) NULL,
    blocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_shop_visitor (shop_id, visitor_hash),
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
