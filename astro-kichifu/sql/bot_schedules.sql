-- ==========================================================================
-- bot_schedules — bot 自動実行スケジュール（CLAUDE-EKICHIKA-BULKTOP.md・2026-07-18）
--   job=ekichika_bulktop: 駅ちか「上位表示（掲載順位アップ）」を指定時刻に自動実行。
--   CTRL /ctrl/bot-schedule.php で編集・API /api/bot-schedule.php で bot が毎分GET。
--   未設定(行なし)なら API は 404 → bot は config 既定で継続（後方互換）。
--   ※ サーバーで直接 CREATE 済み（2026-07-18）。
-- ==========================================================================
CREATE TABLE IF NOT EXISTS bot_schedules (
  shop_id          INT NOT NULL,
  job              VARCHAR(64) NOT NULL,                 -- ekichika_bulktop 等
  enabled          TINYINT(1) NOT NULL DEFAULT 1,
  daily_limit      INT NOT NULL DEFAULT 35,              -- 1日の最大実行数（媒体上限38・運用既定35）
  min_interval_sec INT NOT NULL DEFAULT 60,              -- 最短間隔（媒体注意・60以上）
  schedule_json    TEXT NOT NULL,                        -- ["00:15","10:00",...] 昇順・重複なし
  updated_by       VARCHAR(64) DEFAULT NULL,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (shop_id, job)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
