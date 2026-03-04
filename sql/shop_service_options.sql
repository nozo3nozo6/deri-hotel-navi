-- 店舗サービスオプションテーブル
CREATE TABLE IF NOT EXISTS shop_service_options (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE shop_service_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shop_service_options_select" ON shop_service_options FOR SELECT USING (true);
CREATE POLICY "shop_service_options_insert" ON shop_service_options FOR INSERT WITH CHECK (true);
CREATE POLICY "shop_service_options_update" ON shop_service_options FOR UPDATE USING (true);
CREATE POLICY "shop_service_options_delete" ON shop_service_options FOR DELETE USING (true);
