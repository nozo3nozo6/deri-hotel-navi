-- ============================================================================
-- shop_casts に表示・非表示フラグ追加
-- ============================================================================
-- 仕様:
--   - 表示中のキャスト数 ≤ contract_plans.cast_limit （プラン依存）
--   - 招待・登録できるキャスト数 ≤ cast_limit × 2 （ロスター用バッファ）
--   - 新規招待は is_visible=0 デフォルト（オーナーが明示ONに切り替えるまで非公開）
--   - 既存データは status='active' AND deleted_at IS NULL のみ is_visible=1 に
--     設定（マイグレーション時のみ、現状の表示を壊さない）
--   - is_visible=0 のキャスト:
--     - cast-list-public から除外（ポータル指名プルダウンに出ない）
--     - ?cast=<shop_cast_id> 指名URLでもブロック → 店舗直通 fallback
--     - inbox_token bearer (キャスト本人の管理URL) は引き続き有効
--
-- 適用方法:
--   ssh -p 10022 -i ~/.ssh/yobuho_deploy yobuho@sv6051.wpx.ne.jp \
--     'mysql -u <user> -p<pass> <db> < cast_visibility.sql'
-- ============================================================================

ALTER TABLE shop_casts
    ADD COLUMN is_visible TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '公開表示フラグ (1=ポータル/指名URL有効, 0=非表示)';

-- 既存の active キャストは現状維持のため可視に設定
UPDATE shop_casts
   SET is_visible = 1
 WHERE status = 'active'
   AND deleted_at IS NULL;

-- ポータル絞り込み高速化用インデックス
CREATE INDEX idx_shop_casts_visible
    ON shop_casts(shop_id, is_visible, status, deleted_at);
