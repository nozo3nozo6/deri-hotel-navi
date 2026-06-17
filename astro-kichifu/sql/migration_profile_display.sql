-- プロフィール回答に表示/非表示フラグを追加
ALTER TABLE girl_profile_values
  ADD COLUMN is_display TINYINT(1) NOT NULL DEFAULT 1
  AFTER value;

-- 既存データは全て表示ON
UPDATE girl_profile_values SET is_display = 1;
