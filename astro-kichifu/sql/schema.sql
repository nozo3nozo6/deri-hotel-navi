-- ==========================================================================
-- kichifu / admi 自前CMS スキーマ（MINERVA相当の内製化）
--   MySQL 8 / MariaDB 10.11 想定・InnoDB・utf8mb4
--   全テーブル shop_id を持つマルチ店舗設計（店舗追加=1レコード）
--   時刻は db.php が接続時に SET time_zone='+09:00' する前提で CURRENT_TIMESTAMP=JST
-- ==========================================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------- 店舗 ----------
CREATE TABLE IF NOT EXISTS shops (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug          VARCHAR(40)  NOT NULL UNIQUE,        -- kichifu / admi
  name          VARCHAR(120) NOT NULL,               -- アドミ
  full_name     VARCHAR(200) NOT NULL DEFAULT '',
  area          VARCHAR(60)  NOT NULL DEFAULT '',     -- 吉祥寺 / 立川
  since_year    SMALLINT     NULL,
  tel           VARCHAR(20)  NOT NULL DEFAULT '',
  line_url      VARCHAR(255) NOT NULL DEFAULT '',
  reserve_web_url VARCHAR(255) NOT NULL DEFAULT '',
  reception     VARCHAR(60)  NOT NULL DEFAULT '',
  fujoho_id     VARCHAR(20)  NOT NULL DEFAULT '',
  ga_id         VARCHAR(20)  NOT NULL DEFAULT '',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 管理者（認証） ----------
CREATE TABLE IF NOT EXISTS admins (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id       BIGINT UNSIGNED NULL,                -- NULL = 全店管理（運営）
  username      VARCHAR(60)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,               -- bcrypt
  display_name  VARCHAR(80)  NOT NULL DEFAULT '',
  role          ENUM('owner','staff') NOT NULL DEFAULT 'staff',
  theme         VARCHAR(30)  NOT NULL DEFAULT 'grey-skin',
  last_login_at DATETIME     NULL,
  created       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_admins_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 女性カテゴリー（アドミ / GTF 等） ----------
CREATE TABLE IF NOT EXISTS girl_categories (
  id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id   BIGINT UNSIGNED NOT NULL,
  name      VARCHAR(80) NOT NULL,
  sort      INT NOT NULL DEFAULT 0,
  created   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_gcat_shop (shop_id, sort),
  CONSTRAINT fk_gcat_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 女性 ----------
CREATE TABLE IF NOT EXISTS girls (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id          BIGINT UNSIGNED NOT NULL,
  girl_category_id BIGINT UNSIGNED NULL,
  name             VARCHAR(60)  NOT NULL,
  age              TINYINT UNSIGNED NULL,
  height           SMALLINT UNSIGNED NULL,           -- T
  bust             SMALLINT UNSIGNED NULL,           -- B
  cup              VARCHAR(4)   NOT NULL DEFAULT '',  -- E 等
  waist            SMALLINT UNSIGNED NULL,           -- W
  hip              SMALLINT UNSIGNED NULL,           -- H
  in_date          DATE         NULL,                -- 入店日
  is_newgirl       TINYINT(1) NOT NULL DEFAULT 0,    -- 新人
  is_trial         TINYINT(1) NOT NULL DEFAULT 0,    -- 待ち合わせ
  is_tel           TINYINT(1) NOT NULL DEFAULT 0,    -- 電話
  is_inbound       TINYINT(1) NOT NULL DEFAULT 0,    -- インバウンド
  is_genderless    TINYINT(1) NOT NULL DEFAULT 0,    -- ジェンダーレス
  catch            VARCHAR(160) NOT NULL DEFAULT '',
  comment          TEXT         NULL,
  is_display       TINYINT(1) NOT NULL DEFAULT 1,
  sort             INT NOT NULL DEFAULT 0,
  created          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_girls_shop (shop_id, is_display, sort),
  KEY idx_girls_cat (girl_category_id),
  CONSTRAINT fk_girls_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  CONSTRAINT fk_girls_cat  FOREIGN KEY (girl_category_id) REFERENCES girl_categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 女性 画像（複数枚, sort=0 がメイン） ----------
CREATE TABLE IF NOT EXISTS girl_images (
  id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  girl_id  BIGINT UNSIGNED NOT NULL,
  path     VARCHAR(255) NOT NULL,
  sort     INT NOT NULL DEFAULT 0,
  created  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_gimg_girl (girl_id, sort),
  CONSTRAINT fk_gimg_girl FOREIGN KEY (girl_id) REFERENCES girls(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 女性プロフィール（質問テンプレ） ----------
CREATE TABLE IF NOT EXISTS girl_profiles (
  id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id  BIGINT UNSIGNED NOT NULL,
  name     VARCHAR(160) NOT NULL,                    -- 質問文
  type     ENUM('list','text') NOT NULL DEFAULT 'text',
  lang     VARCHAR(5) NOT NULL DEFAULT 'ja',
  sort     INT NOT NULL DEFAULT 0,
  created  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_gprof_shop (shop_id, sort),
  CONSTRAINT fk_gprof_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- type=list の選択肢
CREATE TABLE IF NOT EXISTS girl_profile_options (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  girl_profile_id BIGINT UNSIGNED NOT NULL,
  label           VARCHAR(120) NOT NULL,
  sort            INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_gpopt_prof FOREIGN KEY (girl_profile_id) REFERENCES girl_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 各女性の回答
CREATE TABLE IF NOT EXISTS girl_profile_values (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  girl_id         BIGINT UNSIGNED NOT NULL,
  girl_profile_id BIGINT UNSIGNED NOT NULL,
  value           VARCHAR(255) NOT NULL DEFAULT '',
  UNIQUE KEY uq_gpval (girl_id, girl_profile_id),
  CONSTRAINT fk_gpval_girl FOREIGN KEY (girl_id) REFERENCES girls(id) ON DELETE CASCADE,
  CONSTRAINT fk_gpval_prof FOREIGN KEY (girl_profile_id) REFERENCES girl_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 女性オプション（プレイ項目） ----------
CREATE TABLE IF NOT EXISTS girl_options (
  id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id  BIGINT UNSIGNED NOT NULL,
  name     VARCHAR(80) NOT NULL,
  is_basic TINYINT(1) NOT NULL DEFAULT 0,            -- 基本プレイ
  sort     INT NOT NULL DEFAULT 0,
  created  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_gopt_shop (shop_id, sort),
  CONSTRAINT fk_gopt_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 女性 × オプション
CREATE TABLE IF NOT EXISTS girl_option_links (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  girl_id        BIGINT UNSIGNED NOT NULL,
  girl_option_id BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uq_golink (girl_id, girl_option_id),
  CONSTRAINT fk_golink_girl FOREIGN KEY (girl_id) REFERENCES girls(id) ON DELETE CASCADE,
  CONSTRAINT fk_golink_opt  FOREIGN KEY (girl_option_id) REFERENCES girl_options(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 女性日記（写メ日記） ----------
CREATE TABLE IF NOT EXISTS girl_diaries (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id    BIGINT UNSIGNED NOT NULL,
  girl_id    BIGINT UNSIGNED NULL,
  title      VARCHAR(200) NOT NULL DEFAULT '',
  body       TEXT NULL,
  image      VARCHAR(255) NOT NULL DEFAULT '',
  posted_at  DATETIME NULL,
  is_display TINYINT(1) NOT NULL DEFAULT 1,
  created    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_gdiary_shop (shop_id, is_display, posted_at),
  CONSTRAINT fk_gdiary_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  CONSTRAINT fk_gdiary_girl FOREIGN KEY (girl_id) REFERENCES girls(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- お知らせ ----------
CREATE TABLE IF NOT EXISTS news (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id    BIGINT UNSIGNED NOT NULL,
  title      VARCHAR(255) NOT NULL,
  body       MEDIUMTEXT NULL,
  thumb      VARCHAR(255) NOT NULL DEFAULT '',
  posted_at  DATETIME NULL,
  is_display TINYINT(1) NOT NULL DEFAULT 1,
  sort       INT NOT NULL DEFAULT 0,
  created    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_news_shop (shop_id, is_display, posted_at),
  CONSTRAINT fk_news_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- イベント ----------
CREATE TABLE IF NOT EXISTS events (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id    BIGINT UNSIGNED NOT NULL,
  title      VARCHAR(255) NOT NULL,
  body       MEDIUMTEXT NULL,
  thumb      VARCHAR(255) NOT NULL DEFAULT '',
  start_at   DATETIME NULL,
  end_at     DATETIME NULL,
  is_display TINYINT(1) NOT NULL DEFAULT 1,
  sort       INT NOT NULL DEFAULT 0,
  created    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_events_shop (shop_id, is_display),
  CONSTRAINT fk_events_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- バナー（上部/下部） ----------
CREATE TABLE IF NOT EXISTS banners (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id    BIGINT UNSIGNED NOT NULL,
  type       ENUM('top','bottom') NOT NULL DEFAULT 'top',
  title      VARCHAR(160) NOT NULL DEFAULT '',
  url        VARCHAR(255) NOT NULL DEFAULT '',
  image      VARCHAR(255) NOT NULL DEFAULT '',
  is_display TINYINT(1) NOT NULL DEFAULT 1,
  sort       INT NOT NULL DEFAULT 0,
  created    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_banners_shop (shop_id, type, is_display, sort),
  CONSTRAINT fk_banners_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- スライダー（PC画像/スマホ画像） ----------
CREATE TABLE IF NOT EXISTS sliders (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id    BIGINT UNSIGNED NOT NULL,
  title      VARCHAR(160) NOT NULL DEFAULT '',
  url        VARCHAR(255) NOT NULL DEFAULT '',
  image_pc   VARCHAR(255) NOT NULL DEFAULT '',
  image_sp   VARCHAR(255) NOT NULL DEFAULT '',
  is_display TINYINT(1) NOT NULL DEFAULT 1,
  sort       INT NOT NULL DEFAULT 0,
  created    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_sliders_shop (shop_id, is_display, sort),
  CONSTRAINT fk_sliders_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- ホテルエリア / ホテル ----------
CREATE TABLE IF NOT EXISTS hotel_areas (
  id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id  BIGINT UNSIGNED NOT NULL,
  name     VARCHAR(120) NOT NULL,
  sort     INT NOT NULL DEFAULT 0,
  created  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_harea_shop (shop_id, sort),
  CONSTRAINT fk_harea_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hotels (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id       BIGINT UNSIGNED NOT NULL,
  hotel_area_id BIGINT UNSIGNED NULL,
  name          VARCHAR(160) NOT NULL,
  address       VARCHAR(255) NOT NULL DEFAULT '',
  tel           VARCHAR(20)  NOT NULL DEFAULT '',
  access        VARCHAR(255) NOT NULL DEFAULT '',
  map_url       VARCHAR(255) NOT NULL DEFAULT '',
  image         VARCHAR(255) NOT NULL DEFAULT '',
  is_display    TINYINT(1) NOT NULL DEFAULT 1,
  sort          INT NOT NULL DEFAULT 0,
  created       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_hotels_shop (shop_id, is_display, sort),
  CONSTRAINT fk_hotels_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  CONSTRAINT fk_hotels_area FOREIGN KEY (hotel_area_id) REFERENCES hotel_areas(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- スケジュール（出勤） ----------
CREATE TABLE IF NOT EXISTS schedules (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id    BIGINT UNSIGNED NOT NULL,
  girl_id    BIGINT UNSIGNED NOT NULL,
  work_date  DATE NOT NULL,
  start_time TIME NULL,
  end_time   TIME NULL,
  status     ENUM('work','off','undecided') NOT NULL DEFAULT 'work',
  note       VARCHAR(160) NOT NULL DEFAULT '',
  created    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sched (girl_id, work_date),
  KEY idx_sched_shop (shop_id, work_date),
  CONSTRAINT fk_sched_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  CONSTRAINT fk_sched_girl FOREIGN KEY (girl_id) REFERENCES girls(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 料金コース ----------
CREATE TABLE IF NOT EXISTS courses (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id    BIGINT UNSIGNED NOT NULL,
  name       VARCHAR(80) NOT NULL,
  minutes    SMALLINT UNSIGNED NULL,
  price      INT UNSIGNED NULL,
  is_initial TINYINT(1) NOT NULL DEFAULT 0,          -- 初回限定
  is_display TINYINT(1) NOT NULL DEFAULT 1,
  sort       INT NOT NULL DEFAULT 0,
  created    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_courses_shop (shop_id, is_display, sort),
  CONSTRAINT fk_courses_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- メルマガ会員 / 配信 ----------
CREATE TABLE IF NOT EXISTS mail_users (
  id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id   BIGINT UNSIGNED NOT NULL,
  email     VARCHAR(190) NOT NULL,
  name      VARCHAR(80) NOT NULL DEFAULT '',
  status    ENUM('subscribed','unsubscribed') NOT NULL DEFAULT 'subscribed',
  token     VARCHAR(64) NOT NULL DEFAULT '',
  created   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mailuser (shop_id, email),
  CONSTRAINT fk_mailuser_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mail_magazines (
  id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id   BIGINT UNSIGNED NOT NULL,
  subject   VARCHAR(200) NOT NULL,
  body      MEDIUMTEXT NULL,
  status    ENUM('draft','sent') NOT NULL DEFAULT 'draft',
  sent_at   DATETIME NULL,
  created   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_mailmag_shop (shop_id, status),
  CONSTRAINT fk_mailmag_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- お問い合わせ（フォーム受信） ----------
CREATE TABLE IF NOT EXISTS contacts (
  id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id   BIGINT UNSIGNED NOT NULL,
  name      VARCHAR(120) NOT NULL DEFAULT '',
  email     VARCHAR(190) NOT NULL DEFAULT '',
  tel       VARCHAR(20)  NOT NULL DEFAULT '',
  message   TEXT NULL,
  ip_hash   VARCHAR(64)  NOT NULL DEFAULT '',
  is_read   TINYINT(1) NOT NULL DEFAULT 0,
  created   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_contacts_shop (shop_id, is_read, created),
  CONSTRAINT fk_contacts_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 設定（key-value） ----------
CREATE TABLE IF NOT EXISTS configs (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id     BIGINT UNSIGNED NOT NULL,
  config_key  VARCHAR(80) NOT NULL,
  config_value TEXT NULL,
  created     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_config (shop_id, config_key),
  CONSTRAINT fk_config_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
