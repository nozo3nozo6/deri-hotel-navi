-- 店舗投稿の表示日制御用カラム追加（ON UPDATE なし、明示的にのみ更新）
ALTER TABLE reports ADD COLUMN refreshed_at DATETIME DEFAULT NULL;
ALTER TABLE loveho_reports ADD COLUMN refreshed_at DATETIME DEFAULT NULL;

-- 既存店舗投稿のバックフィル（created_at を初期値に）
UPDATE reports SET refreshed_at = created_at WHERE poster_type = 'shop' AND refreshed_at IS NULL;
UPDATE loveho_reports SET refreshed_at = created_at WHERE poster_type = 'shop' AND refreshed_at IS NULL;
