import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 現在のユーザー取得
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ログイン状態チェック（サーバーサイド用）
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    return null; // 未ログイン
  }
  return user;
}