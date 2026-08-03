-- ==========================================================================
-- migration_ops_customer_ng.sql — OPS 顧客の NG 登録
--
--   性質の違う2種類を別々に持つ:
--     ① 出禁 / 要注意 … お店として受けるかどうか（ops_customers.ng_level）
--     ② キャスト別NG  … このお客様にこの女性を出さない（ops_customer_ng_casts）
--
--   ng_level: 0=通常 / 1=要注意 / 2=出禁
--   これまでは「お客様メモ」に文章で書いていた（出禁 25件・NG 440件）。
--   文章のままでは予約を取る瞬間に気づけないため、機械的に判定できる列に分ける。
--   移行はしない（メモの文言は人が読んで判断する必要があるため）。メモはそのまま残す。
-- ==========================================================================

ALTER TABLE ops_customers
  ADD COLUMN ng_level  TINYINT      NOT NULL DEFAULT 0 AFTER notes,
  ADD COLUMN ng_reason VARCHAR(255) NULL     AFTER ng_level,
  ADD COLUMN ng_at     DATETIME     NULL     AFTER ng_reason;

-- 一覧の「出禁だけ表示」用
CREATE INDEX idx_ops_customers_ng ON ops_customers (ng_level);

-- キャスト別NG。cast_admin_id は ops_admin_users.id（予約の assigned_admin_id と同じ軸）
CREATE TABLE IF NOT EXISTS ops_customer_ng_casts (
  customer_id   INT          NOT NULL,
  cast_admin_id INT          NOT NULL,
  reason        VARCHAR(255) NULL,
  created_at    DATETIME     NOT NULL,
  PRIMARY KEY (customer_id, cast_admin_id),
  KEY idx_ops_ng_cast (cast_admin_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
