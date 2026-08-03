-- ==========================================================================
-- migration_slider_shop_url.sql
--   スライダーのリンク先を店舗ごとに差し替えられるようにする。
--   例：同じ「ランキング」バナーでも、立川は admi2888 の女性へ、吉祥寺は kichifu の女性へ。
--
--   ・slider_shops.url … その店だけのリンク。NULL/空なら共通の sliders.url を使う
--   ・配信API(api/sliders.php) は COALESCE(NULLIF(ss.url,''), s.url) で解決
--   ・既存行は NULL＝これまで通り共通リンク（無回帰）
--   両サイト共有DB（yobuho_kichifu）で1回だけ実行。適用済み: 2026-08-03
-- ==========================================================================

ALTER TABLE slider_shops ADD COLUMN url VARCHAR(500) NULL AFTER shop_id;
