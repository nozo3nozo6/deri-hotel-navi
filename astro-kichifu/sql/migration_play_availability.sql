-- ==========================================================================
-- 最速で遊べる時間（play_availability）+ キャスト媒体IDマスタ（girl_media_ids）
--   CTRL /ctrl/play-availability.php が正データ（Single Source of Truth）。
--   各媒体bot（情報局/駅ちか/ヘブン）は api/play-availability.php を
--   updated_at ポーリングで読んで媒体へ反映する（オフィシャルは媒体へ直接POSTしない）。
--   1キャスト（shop_id×girl_id）につき有効1行＝UNIQUEでupsert。
-- ==========================================================================

CREATE TABLE IF NOT EXISTS play_availability (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id    INT NOT NULL,
  girl_id    INT NOT NULL,
  play_at    DATETIME NOT NULL,                             -- 最速で遊べる時刻（JST・5分刻み）
  status     ENUM('active','cleared') NOT NULL DEFAULT 'active',
  list_flag  TINYINT(1) NOT NULL DEFAULT 1,                 -- 情報局「新着に掲載」相当
  note       VARCHAR(255) DEFAULT NULL,                     -- 社内メモ
  updated_by VARCHAR(64) DEFAULT NULL,                      -- 操作者（admins.username）
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,  -- bot変更検知用
  UNIQUE KEY uq_shop_girl (shop_id, girl_id),
  KEY idx_poll (shop_id, status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS girl_media_ids (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id          INT NOT NULL,                            -- 媒体アカウントは店舗ごとに別＝shop_id×girl_id
  girl_id          INT NOT NULL,
  fujoho_girl_id   VARCHAR(32) DEFAULT NULL,                -- 口コミ風俗情報局
  ekichika_girl_id VARCHAR(32) DEFAULT NULL,                -- 駅ちか
  heaven_member_id VARCHAR(32) DEFAULT NULL,                -- シティヘブン c_member_id
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shop_girl (shop_id, girl_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
