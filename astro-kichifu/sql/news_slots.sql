-- ==========================================================================
-- news_slots — 媒体固定枠（CLAUDE-NEWS-SLOTS-ROTATION.md・2026-07-17）
--   駅ちか5カテゴリ + 情報局速報(日100回)の5枠ローテのうち、CTRLで事前登録する固定3枠:
--     shinjin=新人速報 / event=イベント速報 / waribiki=激アツ割引情報
--   残り2枠（sokuho=速報NEWS / kinkyu=緊急出勤速報）は最新お知らせ（api/news-current.php）が正。
--   編集UI: /ctrl/news-slots.php ／ 配信API: /api/news-slots.php（認証=PLAY_API_KEY）
--   body_text はカラム化せず GET 時に news_html_to_text()（コピペ用と同一）で生成。
--   ※ サーバーで直接 CREATE 済み（2026-07-17）。
-- ==========================================================================
CREATE TABLE IF NOT EXISTS news_slots (
  shop_id    INT NOT NULL,
  slot_key   ENUM('shinjin','event','waribiki') NOT NULL,
  title      VARCHAR(255) NOT NULL DEFAULT '',
  body_html  MEDIUMTEXT NULL,
  image      VARCHAR(255) NOT NULL DEFAULT '',              -- /uploads/news-slots/{shop}/…（APIで絶対URL化）
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_by VARCHAR(64) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,   -- bot変更検知用
  PRIMARY KEY (shop_id, slot_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
