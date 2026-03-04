-- 店舗ホテル情報テーブル（店舗がホテルごとに登録する呼べる/呼べない情報）
CREATE TABLE IF NOT EXISTS shop_hotel_info (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  hotel_id text NOT NULL,
  can_call boolean NOT NULL DEFAULT true,
  transport_fee integer DEFAULT 0,
  memo text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(shop_id, hotel_id)
);

ALTER TABLE shop_hotel_info ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shop_hotel_info_select" ON shop_hotel_info FOR SELECT USING (true);
CREATE POLICY "shop_hotel_info_insert" ON shop_hotel_info FOR INSERT WITH CHECK (true);
CREATE POLICY "shop_hotel_info_update" ON shop_hotel_info FOR UPDATE USING (true);
CREATE POLICY "shop_hotel_info_delete" ON shop_hotel_info FOR DELETE USING (true);

-- 店舗ホテルサービス中間テーブル
CREATE TABLE IF NOT EXISTS shop_hotel_services (
  id serial PRIMARY KEY,
  shop_hotel_info_id uuid NOT NULL REFERENCES shop_hotel_info(id) ON DELETE CASCADE,
  service_option_id integer NOT NULL REFERENCES shop_service_options(id) ON DELETE CASCADE,
  UNIQUE(shop_hotel_info_id, service_option_id)
);

ALTER TABLE shop_hotel_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shop_hotel_services_select" ON shop_hotel_services FOR SELECT USING (true);
CREATE POLICY "shop_hotel_services_insert" ON shop_hotel_services FOR INSERT WITH CHECK (true);
CREATE POLICY "shop_hotel_services_update" ON shop_hotel_services FOR UPDATE USING (true);
CREATE POLICY "shop_hotel_services_delete" ON shop_hotel_services FOR DELETE USING (true);
