-- 契約プランテーブル
CREATE TABLE IF NOT EXISTS contract_plans (
  id serial PRIMARY KEY,
  name text NOT NULL,
  price integer NOT NULL DEFAULT 0,
  description text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE contract_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contract_plans_select" ON contract_plans FOR SELECT USING (true);
CREATE POLICY "contract_plans_insert" ON contract_plans FOR INSERT WITH CHECK (true);
CREATE POLICY "contract_plans_update" ON contract_plans FOR UPDATE USING (true);
CREATE POLICY "contract_plans_delete" ON contract_plans FOR DELETE USING (true);

-- 初期データ
INSERT INTO contract_plans (name, price, description, sort_order) VALUES
('無料プラン', 0, '基本掲載のみ', 1),
('Aプラン', 5000, 'スタンダード掲載', 2),
('Bプラン', 10000, 'プレミアム掲載', 3);

-- shopsテーブルに契約プラン関連カラム追加
ALTER TABLE shops ADD COLUMN IF NOT EXISTS plan_id integer REFERENCES contract_plans(id);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS contract_status text DEFAULT 'active';
