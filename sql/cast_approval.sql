-- Cast機能: 2段階承認フロー追加
-- 実行日: 2026-04-21
-- 目的: キャスト招待フローに店舗オーナーによる最終承認ステップを追加
--       (1) 店舗が招待 → shop_casts.status = 'pending_approval'
--       (2) キャストがメールリンクからパスワード設定 → casts.status = 'active' (shop_casts は pending_approval のまま)
--       (3) 店舗オーナーが shop-admin で [承認] ボタン押下 → shop_casts.status = 'active'
--       (4) 承認後のみチャット受付・プロフィール表示などの全機能が有効に

-- 1. shop_casts.status ENUM に 'pending_approval' を追加
ALTER TABLE shop_casts
    MODIFY COLUMN status ENUM('pending_approval','active','suspended','removed') NOT NULL DEFAULT 'pending_approval'
    COMMENT 'pending_approval=店舗オーナー承認待ち / active=有効 / suspended=一時停止 / removed=削除済み';

-- 2. 既存データの扱い:
--    既に動作中のキャスト（現 status='active'）は承認済みとみなしそのまま active を維持
--    新規招待からは DEFAULT 'pending_approval' が効く
--    (UPDATE不要 - 既存の active レコードは変更しない)

-- 3. 承認日時カラム追加（監査ログ用、誰がいつ承認したかの証跡）
ALTER TABLE shop_casts
    ADD COLUMN approved_at DATETIME NULL DEFAULT NULL COMMENT '店舗オーナー承認日時 (NULL=未承認)';

-- 既存 active データは過去に「実質承認済み」とみなし joined_at を approved_at として流用
UPDATE shop_casts SET approved_at = joined_at WHERE status = 'active' AND approved_at IS NULL;
