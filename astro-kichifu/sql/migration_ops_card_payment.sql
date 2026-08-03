-- ==========================================================================
-- migration_ops_card_payment.sql — OPS クレジット決済の手数料計上と決済確認
--
--   アドミではクレジット決済のとき、合計金額に手数料10%を上乗せしてお客様に請求する。
--   これまで OPS には上乗せ分を持つ場所が無く、合計＝コース料金のままだった。
--
--   card_fee        … 上乗せした手数料額（円）。現金/振込は 0
--   card_paid_at    … 決済が通ったことを確認した日時。稀に決済失敗があるため、
--                     「クレジット指定だが未確認」を画面で拾えるようにする
--   card_paid_by    … 確認した担当者（ops_admin_users.id）
--
--   既存の card_fee_rate 設定（3%・キャスト負担の計算に使用）とは別物。
--   お客様への上乗せ率は card_surcharge_rate（既定10）で持つ。
-- ==========================================================================

ALTER TABLE ops_bookings
  ADD COLUMN card_fee     INT      NOT NULL DEFAULT 0 AFTER payment_method,
  ADD COLUMN card_paid_at DATETIME NULL               AFTER card_fee,
  ADD COLUMN card_paid_by INT      NULL               AFTER card_paid_at;

-- 「クレジット指定だが未確認」の抽出用
CREATE INDEX idx_ops_bookings_card ON ops_bookings (payment_method, card_paid_at);

-- お客様への上乗せ率（%）。無ければ 10 として扱う
INSERT INTO ops_admin_settings (setting_key, setting_value, updated_at)
VALUES ('card_surcharge_rate', '10', NOW())
ON DUPLICATE KEY UPDATE setting_key = setting_key;
