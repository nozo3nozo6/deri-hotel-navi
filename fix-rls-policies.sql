-- ============================================
-- RLS ポリシー修正スクリプト
-- Supabase SQL Editor で実行してください
-- ============================================
-- 目的: public_write を制限し、必要最小限の書き込みのみ許可する

-- ============================================
-- 1. hotels テーブル: 読み取り専用（一般ユーザーは書き込み不可）
-- ============================================
DROP POLICY IF EXISTS "public_write" ON public.hotels;
-- hotelsは管理者のみ書き込み可能（import-rakuten.jsはservice_roleキーを使用）

-- ============================================
-- 2. reports テーブル: INSERT のみ許可、UPDATE/DELETE は不可
-- ============================================
DROP POLICY IF EXISTS "public_write" ON public.reports;

-- 投稿は許可するが、更新・削除は不可
CREATE POLICY "public_insert_only" ON public.reports
  FOR INSERT WITH CHECK (true);

-- ============================================
-- 3. shops テーブル: 認証済みユーザーのみ INSERT、UPDATE/DELETE は不可
-- ============================================
DROP POLICY IF EXISTS "public_write" ON public.shops;

-- 認証済みユーザー（OTP認証後）のみ店舗登録可能
CREATE POLICY "authenticated_insert" ON public.shops
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 認証済みユーザーは自分のメールの店舗のみ更新可能
CREATE POLICY "own_shop_update" ON public.shops
  FOR UPDATE USING (auth.jwt() ->> 'email' = email);

-- ============================================
-- 4. shop_placements テーブル: 読み取り専用
-- ============================================
DROP POLICY IF EXISTS "public_write" ON public.shop_placements;
-- 管理者のみ書き込み可能（admin.htmlはservice_roleキーを使用すべき）

-- ============================================
-- 5. マスタテーブル: 読み取り専用（変更不要）
-- ============================================
DROP POLICY IF EXISTS "public_write" ON public.can_call_reasons;
DROP POLICY IF EXISTS "public_write" ON public.cannot_call_reasons;
DROP POLICY IF EXISTS "public_write" ON public.room_types;

-- ============================================
-- 確認: public_read ポリシーはそのまま維持
-- ============================================
-- SELECT権限は全テーブルで public_read を維持します

-- ============================================
-- 実行後の確認クエリ
-- ============================================
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
