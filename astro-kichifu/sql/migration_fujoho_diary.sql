-- ==========================================================================
-- fujoho.jp 写メ日記の取込用に girl_diaries を拡張
--   source='fujoho' / source_id=fujoho日記ID で冪等。girl_name はマッチ失敗時の表示用。
--   link_url は fujoho 日記ページ（girl_id でマッチできた場合はフロント側でプロフURLを優先）。
-- ==========================================================================
ALTER TABLE girl_diaries
  ADD COLUMN IF NOT EXISTS source    VARCHAR(20)  NULL AFTER shop_id,
  ADD COLUMN IF NOT EXISTS source_id VARCHAR(64)  NULL AFTER source,
  ADD COLUMN IF NOT EXISTS girl_name VARCHAR(100) NULL AFTER girl_id,
  ADD COLUMN IF NOT EXISTS link_url  VARCHAR(500) NULL AFTER image;

ALTER TABLE girl_diaries
  ADD UNIQUE INDEX IF NOT EXISTS uniq_gdiary_source (shop_id, source, source_id);
