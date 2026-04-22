-- キャスト削除を soft-delete に変更 — 2026-04-23
-- 削除済みキャスト+そのチャットデータは60日間保持後、chat-retention.php で物理削除。
-- 非削除のキャスト/店舗アカウントは一切触らない。
--
-- 運用:
--   - shop-cast-api.php handleRemove が UPDATE shop_casts SET status='removed', deleted_at=NOW()
--   - chat-retention.php の日次cron が deleted_at < NOW() - 60 DAY の行を DELETE
--   - 他の shop_casts 参照が無くなった casts 本体も同cronで孤児削除
--
-- 既存読取パスは全て `status != 'removed'` / `status = 'active'` でフィルタ済みのため
-- カラム追加だけで即座に論理削除扱いになる。

ALTER TABLE shop_casts
  ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL;

CREATE INDEX idx_shop_casts_deleted_at ON shop_casts(deleted_at);
