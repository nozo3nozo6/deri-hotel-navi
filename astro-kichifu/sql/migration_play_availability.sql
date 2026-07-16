-- ==========================================================================
-- 最速で遊べる時間（play_availability）+ キャスト媒体IDマスタ（girl_media_ids）
--   CTRL /ctrl/play-availability.php が正データ（Single Source of Truth）。
--   各媒体bot（情報局/駅ちか/ヘブン/風じゃ/デリじゃ）は api/play-availability.php を
--   updated_at ポーリングで読んで媒体へ反映する（オフィシャルは媒体へ直接POSTしない）。
--   1キャスト（shop_id×girl_id）につき有効1行＝UNIQUEでupsert。
--   即姫(play_at) と ヒメ割(shift_end_at/himewari_*) は同一行の別ファセット。play_atはNULL可
--   （ヒメ割だけ設定・即姫だけ設定・両方、が独立にありうる）。
-- ==========================================================================

CREATE TABLE IF NOT EXISTS play_availability (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id    INT NOT NULL,
  girl_id    INT NOT NULL,
  shift_business_date DATE NOT NULL,                          -- 営業日（朝5時区切り＝schedules.work_date と同じ粒度）
  play_at          DATETIME NULL,                             -- 最速で遊べる時刻（即姫・JST・5分刻み）。NULL=即姫未設定
  reception_closed TINYINT(1) NOT NULL DEFAULT 0,             -- 受付終了（出勤中のまま即ヒメ系だけ止める。出勤解除とは別）
  shift_start_at   DATETIME NULL,                             -- 本日出勤の開始（出勤表の写し・情報局出勤表bot用）
  shift_end_at     DATETIME NULL,                             -- ヒメ割期限（出勤終了時刻・までに遊ぶ）→ 情報局 gidi_dlt
  himewari_enabled TINYINT(1) NOT NULL DEFAULT 0,             -- ヒメ割を出すか
  himewari_minutes INT NULL,                                  -- ヒメ割 分数（NULL=bot店舗デフォルト70）
  himewari_price   INT NULL,                                  -- ヒメ割 価格（NULL=bot店舗デフォルト11000）
  status     ENUM('active','cleared') NOT NULL DEFAULT 'active',
  list_flag  TINYINT(1) NOT NULL DEFAULT 1,                 -- 情報局「新着に掲載」相当
  note       VARCHAR(255) DEFAULT NULL,                     -- 社内メモ
  updated_by VARCHAR(64) DEFAULT NULL,                      -- 操作者（admins.username）
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,  -- bot変更検知用
  UNIQUE KEY uq_shop_girl_date (shop_id, girl_id, shift_business_date),   -- 1キャスト×1営業日=最大1行
  KEY idx_poll (shop_id, status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS girl_media_ids (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id          INT NOT NULL,                            -- 媒体アカウントは店舗ごとに別＝shop_id×girl_id
  girl_id          INT NOT NULL,
  fujoho_girl_id   VARCHAR(32) DEFAULT NULL,                -- 口コミ風俗情報局
  ekichika_girl_id VARCHAR(32) DEFAULT NULL,                -- 駅ちか
  heaven_member_id VARCHAR(32) DEFAULT NULL,                -- シティヘブン c_member_id
  fuzoku_girl_no   VARCHAR(32) DEFAULT NULL,                -- 風俗じゃぱん girl_no
  deli_girl_no     VARCHAR(32) DEFAULT NULL,                -- デリヘルじゃぱん girl_no（風じゃと別番号）
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shop_girl (shop_id, girl_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 既存テーブルへの後付け（2026-07-13・P1ヒメ割 + P2 fuzoku/deli 追加。MariaDB 10.11）
ALTER TABLE play_availability MODIFY play_at DATETIME NULL;
-- P5 出勤帯API（2026-07-13後半）: 本日出勤の開始を保持（出勤表の写し。GETは schedules から直接導出するので監査/変更検知用）
ALTER TABLE play_availability ADD COLUMN IF NOT EXISTS shift_start_at DATETIME NULL AFTER play_at;
ALTER TABLE play_availability
  ADD COLUMN IF NOT EXISTS shift_end_at DATETIME NULL AFTER play_at,
  ADD COLUMN IF NOT EXISTS himewari_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER shift_end_at,
  ADD COLUMN IF NOT EXISTS himewari_minutes INT NULL AFTER himewari_enabled,
  ADD COLUMN IF NOT EXISTS himewari_price INT NULL AFTER himewari_minutes;
ALTER TABLE girl_media_ids
  ADD COLUMN IF NOT EXISTS fuzoku_girl_no VARCHAR(32) NULL AFTER heaven_member_id,
  ADD COLUMN IF NOT EXISTS deli_girl_no VARCHAR(32) NULL AFTER fuzoku_girl_no;

-- 受付終了（2026-07-16・CLAUDE-UKETSUKE-SHURYO.md）: 出勤表は残したまま即ヒメ/接客/待機だけ止める。
--   ★ status ENUM に足さず独立カラムにした理由: status=cleared は「出勤取消/クリア」で使用済みかつ
--     API GET の既定フィルタが status=active のため、受付終了を status に混ぜると一覧から落ち、
--     bot がヒメ割・出勤表を維持すべき対象を見失う。「出勤の有無」と「受付の可否」は直交する概念。
--   受付終了 = reception_closed=1 AND play_at IS NULL AND status='active'（shift_* は残す）
--   出勤解除 = shift_* なし（schedules に work 行なし）→ 別機能
ALTER TABLE play_availability ADD COLUMN IF NOT EXISTS reception_closed TINYINT(1) NOT NULL DEFAULT 0 AFTER play_at;

-- 本日/明日の仕込み対応（2026-07-16・CLAUDE-NEXT-DAY-PREP.md 案A）: 営業日ごとに1行持つ。
--   これで「明日の即姫/受付終了」を今夜のうちに保存できる。bot は shift_business_date が現在営業日(D)の
--   行だけを媒体へ適用し、D+1 の行は無視する（朝5:01の business-day-rollover.php で force 同期）。
--   ※ schedules.work_date 自体が営業日（朝5時区切り）なので、営業日の粒度は完全に一致する。
ALTER TABLE play_availability ADD COLUMN IF NOT EXISTS shift_business_date DATE NULL AFTER girl_id;
UPDATE play_availability SET shift_business_date = DATE(NOW() - INTERVAL 5 HOUR) WHERE shift_business_date IS NULL;  -- 既存行=現在営業日へ寄せる
ALTER TABLE play_availability MODIFY shift_business_date DATE NOT NULL;
ALTER TABLE play_availability DROP INDEX uq_shop_girl;                                    -- (shop,girl) → (shop,girl,営業日)
ALTER TABLE play_availability ADD UNIQUE KEY uq_shop_girl_date (shop_id, girl_id, shift_business_date);
