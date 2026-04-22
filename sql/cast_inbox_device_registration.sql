-- キャスト受信箱 端末認証 — 2026-04-22
-- ?cast_inbox=<uuid> URL だけで受信箱が開けるのはセキュリティ甘いため、
-- URL + 端末登録(device_token) の2要素に強化する。
-- 初回: キャスト登録メール宛に6桁コードを送信 → 検証 → device_token 発行。

CREATE TABLE IF NOT EXISTS cast_inbox_devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_cast_id CHAR(36) NOT NULL,
  device_token VARCHAR(64) NOT NULL UNIQUE,
  device_name VARCHAR(100) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at DATETIME DEFAULT NULL,
  INDEX idx_cast_inbox_devices_sc (shop_cast_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cast_inbox_codes (
  shop_cast_id CHAR(36) NOT NULL PRIMARY KEY,
  code VARCHAR(6) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
