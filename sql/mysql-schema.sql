-- ==========================================================================
-- mysql-schema.sql — YobuHo MariaDB 10.5 スキーマ（Supabase PostgreSQLから移行）
-- Usage: mysql -u yobuho_user -p yobuho_db < sql/mysql-schema.sql
-- ==========================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ホテル（43,580件）
CREATE TABLE IF NOT EXISTS hotels (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address VARCHAR(500),
    prefecture VARCHAR(10),
    city VARCHAR(50),
    major_area VARCHAR(50),
    detail_area VARCHAR(100),
    hotel_type VARCHAR(30) DEFAULT 'other',
    source VARCHAR(20) DEFAULT 'manual',
    review_average FLOAT,
    min_charge INT,
    nearest_station VARCHAR(100),
    postal_code VARCHAR(20),
    tel VARCHAR(30),
    latitude DOUBLE,
    longitude DOUBLE,
    is_published TINYINT(1) DEFAULT 1,
    is_edited TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_pref_published (prefecture, is_published),
    INDEX idx_pref_area (prefecture, major_area, detail_area),
    INDEX idx_pref_city (prefecture, city),
    INDEX idx_type (hotel_type),
    INDEX idx_name (name(100)),
    INDEX idx_station (nearest_station(50))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 口コミ（ホテル）
CREATE TABLE IF NOT EXISTS reports (
    id CHAR(36) PRIMARY KEY,
    hotel_id INT NOT NULL,
    can_call TINYINT(1),
    poster_type VARCHAR(10) DEFAULT 'user',
    poster_name VARCHAR(100),
    shop_id CHAR(36),
    can_call_reasons JSON,
    cannot_call_reasons JSON,
    time_slot VARCHAR(20),
    room_type VARCHAR(50),
    comment TEXT,
    multi_person TINYINT(1) DEFAULT 0,
    guest_male INT DEFAULT 0,
    guest_female INT DEFAULT 0,
    gender_mode VARCHAR(15),
    fingerprint VARCHAR(64),
    ip_hash VARCHAR(64),
    is_hidden TINYINT(1) DEFAULT 0,
    flagged_at DATETIME,
    flag_reason VARCHAR(100),
    flag_comment TEXT,
    flag_resolved DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_hotel (hotel_id, created_at DESC),
    INDEX idx_ip (ip_hash, created_at),
    INDEX idx_fp_hotel (fingerprint, hotel_id),
    INDEX idx_shop (shop_id, hotel_id),
    INDEX idx_hidden (is_hidden),
    FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 口コミ（ラブホ）
CREATE TABLE IF NOT EXISTS loveho_reports (
    id CHAR(36) PRIMARY KEY,
    hotel_id INT NOT NULL,
    solo_entry VARCHAR(20),
    atmosphere VARCHAR(50),
    recommendation INT,
    cleanliness INT,
    cost_performance INT,
    good_points JSON,
    time_slot VARCHAR(20),
    comment TEXT,
    poster_name VARCHAR(100),
    poster_type VARCHAR(10) DEFAULT 'user',
    shop_id CHAR(36),
    entry_method VARCHAR(20),
    multi_person TINYINT(1) DEFAULT 0,
    guest_male INT,
    guest_female INT,
    gender_mode VARCHAR(15),
    ip_hash VARCHAR(64),
    is_hidden TINYINT(1) DEFAULT 0,
    flagged_at DATETIME,
    flag_reason VARCHAR(100),
    flag_comment TEXT,
    flag_resolved DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_hotel (hotel_id, created_at DESC),
    INDEX idx_ip (ip_hash, created_at),
    INDEX idx_hidden (is_hidden),
    FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 店舗
CREATE TABLE IF NOT EXISTS shops (
    id CHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    auth_user_id VARCHAR(100),
    shop_name VARCHAR(100),
    gender_mode VARCHAR(15),
    shop_url VARCHAR(500),
    shop_tel VARCHAR(30),
    phone VARCHAR(30),
    website_url VARCHAR(500),
    document_url LONGTEXT,
    thumbnail_url LONGTEXT,
    area VARCHAR(100),
    prefecture VARCHAR(10),
    status VARCHAR(30) DEFAULT 'email_pending',
    plan_id INT,
    contract_status VARCHAR(30),
    password_hash VARCHAR(255),
    slug VARCHAR(100),
    denial_reason TEXT,
    approved_at DATETIME,
    deleted_at DATETIME,
    last_login_ip_hash VARCHAR(64),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_status (status),
    INDEX idx_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 店舗ホテル情報
CREATE TABLE IF NOT EXISTS shop_hotel_info (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shop_id CHAR(36) NOT NULL,
    hotel_id INT NOT NULL,
    can_call TINYINT(1),
    transport_fee VARCHAR(50),
    memo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_shop_hotel (shop_id, hotel_id),
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 店舗ホテルサービス（junction）
CREATE TABLE IF NOT EXISTS shop_hotel_services (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shop_hotel_info_id INT NOT NULL,
    service_option_id INT NOT NULL,
    FOREIGN KEY (shop_hotel_info_id) REFERENCES shop_hotel_info(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 店舗契約
CREATE TABLE IF NOT EXISTS shop_contracts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shop_id CHAR(36) NOT NULL,
    plan_id INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 掲載リクエスト
CREATE TABLE IF NOT EXISTS hotel_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hotel_name VARCHAR(200),
    address VARCHAR(500),
    tel VARCHAR(30),
    hotel_type VARCHAR(30) DEFAULT 'business',
    status VARCHAR(20) DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 広告配置
CREATE TABLE IF NOT EXISTS ad_placements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    placement_type VARCHAR(50),
    placement_target VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active',
    mode VARCHAR(15),
    shop_id CHAR(36),
    banner_image_url TEXT,
    banner_link_url TEXT,
    banner_size VARCHAR(20),
    banner_alt VARCHAR(200),
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 店舗掲載エリア
CREATE TABLE IF NOT EXISTS shop_placements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shop_id CHAR(36) NOT NULL,
    level VARCHAR(30),
    target_name VARCHAR(100),
    is_active TINYINT(1) DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_shop_area (level, target_name),
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 口コミ投票
CREATE TABLE IF NOT EXISTS report_votes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    report_id CHAR(36) NOT NULL,
    voter_fingerprint VARCHAR(64),
    vote_type VARCHAR(10),
    UNIQUE KEY uq_vote (report_id, voter_fingerprint)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 管理者
CREATE TABLE IF NOT EXISTS admin_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 営業メール
CREATE TABLE IF NOT EXISTS outreach_emails (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shop_name VARCHAR(200),
    email VARCHAR(255),
    genre VARCHAR(15),
    area VARCHAR(100),
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'sent',
    notes TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 店舗メール認証トークン（Magic Link代替）
CREATE TABLE IF NOT EXISTS shop_email_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    token CHAR(64) NOT NULL,
    genre VARCHAR(15),
    expires_at DATETIME NOT NULL,
    used TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_token (token),
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================================================
-- マスタデータテーブル
-- ==========================================================================

CREATE TABLE IF NOT EXISTS can_call_reasons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    label VARCHAR(100) NOT NULL,
    sort_order INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cannot_call_reasons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    label VARCHAR(100) NOT NULL,
    sort_order INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS room_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    label VARCHAR(100) NOT NULL,
    sort_order INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contract_plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price INT DEFAULT 0,
    description TEXT,
    sort_order INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shop_service_options (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    sort_order INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loveho_good_points (
    id INT AUTO_INCREMENT PRIMARY KEY,
    label VARCHAR(100) NOT NULL,
    category VARCHAR(50),
    sort_order INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loveho_atmospheres (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    sort_order INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loveho_time_slots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    sort_order INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loveho_room_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    sort_order INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loveho_facilities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    sort_order INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loveho_price_ranges (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    type VARCHAR(10),
    sort_order INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================================================
-- VIEW
-- ==========================================================================

CREATE OR REPLACE VIEW hotel_report_summary AS
SELECT
    hotel_id,
    COUNT(*) AS total_reports,
    SUM(CASE WHEN poster_type = 'user' AND can_call = 1 THEN 1 ELSE 0 END) AS user_can_call,
    SUM(CASE WHEN poster_type = 'user' AND can_call = 0 THEN 1 ELSE 0 END) AS user_cannot_call,
    SUM(CASE WHEN poster_type = 'shop' AND can_call = 1 THEN 1 ELSE 0 END) AS shop_can_call,
    SUM(CASE WHEN poster_type = 'shop' AND can_call = 0 THEN 1 ELSE 0 END) AS shop_cannot_call
FROM reports
WHERE is_hidden = 0
GROUP BY hotel_id;

SET FOREIGN_KEY_CHECKS = 1;
