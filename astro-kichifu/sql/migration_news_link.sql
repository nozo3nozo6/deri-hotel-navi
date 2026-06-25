-- news サムネのリンク先（ガールズ優先→URL→無し）。MariaDB 10.11: ADD COLUMN IF NOT EXISTS 対応
ALTER TABLE news
  ADD COLUMN IF NOT EXISTS link_girl_id BIGINT UNSIGNED NULL AFTER posted_at,
  ADD COLUMN IF NOT EXISTS link_url VARCHAR(500) NULL AFTER link_girl_id;
