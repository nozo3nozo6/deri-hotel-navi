-- Cast機能 Phase 1: DB整備
-- 実行日: 2026-04-21
-- 目的: 契約プランに Cast定員 + Cast本人アカウント + 店舗紐付け + Magic Link招待

-- 1. cast_limit カラム追加（プラン付帯の Cast 登録可能人数）
ALTER TABLE contract_plans ADD COLUMN cast_limit INT NOT NULL DEFAULT 0;

UPDATE contract_plans SET cast_limit = 0   WHERE id = 1;   -- 無料
UPDATE contract_plans SET cast_limit = 5   WHERE id = 9;   -- 投稿リンク
UPDATE contract_plans SET cast_limit = 10  WHERE id = 2;   -- 市区町村
UPDATE contract_plans SET cast_limit = 30  WHERE id = 8;   -- エリア
UPDATE contract_plans SET cast_limit = 50  WHERE id = 3;   -- ブロック
UPDATE contract_plans SET cast_limit = 70  WHERE id = 4;   -- 都道府県
UPDATE contract_plans SET cast_limit = 100 WHERE id = 13;  -- 地方
UPDATE contract_plans SET cast_limit = 150 WHERE id = 10;  -- 全国

-- 2. casts: Cast 本人のアカウント（email単位、複数店舗所属可能）
CREATE TABLE IF NOT EXISTS casts (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) DEFAULT NULL,
  status ENUM('invited','active','suspended') NOT NULL DEFAULT 'invited',
  last_login_at DATETIME DEFAULT NULL,
  last_login_ip_hash VARCHAR(64) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_casts_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. shop_casts: 店舗ごとの源氏名・プロフィール・在籍状態（中間テーブル）
-- 注: shops.id との collation 不一致で FK エラーが出るため utf8mb4_unicode_ci で揃える
CREATE TABLE IF NOT EXISTS shop_casts (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  cast_id CHAR(36) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  profile_image_url TEXT DEFAULT NULL,
  bio TEXT DEFAULT NULL,
  status ENUM('active','suspended','removed') NOT NULL DEFAULT 'active',
  sort_order INT NOT NULL DEFAULT 100,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shop_cast (shop_id, cast_id),
  INDEX idx_shop_casts_shop (shop_id, status),
  INDEX idx_shop_casts_cast (cast_id, status),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (cast_id) REFERENCES casts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. cast_invites: Magic Link 招待トークン
CREATE TABLE IF NOT EXISTS cast_invites (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cast_invites_email (email),
  INDEX idx_cast_invites_shop (shop_id, consumed_at),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 注: casts テーブルも FK 参照先なので collation を合わせる（既に作成済みの場合は後述 ALTER で変換）
-- ALTER TABLE casts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 5. shops.cast_enabled: Cast機能を有効化するフラグ（テスト段階は立川秘密基地のみ1）
-- 全店舗解放時: UPDATE shops SET cast_enabled = 1 WHERE status = 'active';
ALTER TABLE shops ADD COLUMN cast_enabled TINYINT(1) NOT NULL DEFAULT 0;
UPDATE shops SET cast_enabled = 1 WHERE id = '6dd730ec-fdd3-4415-b4a0-c8ec15add11c'; -- 立川秘密基地
