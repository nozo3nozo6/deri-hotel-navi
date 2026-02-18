'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        throw signInError;
      }

      if (data.user) {
        // 変更点: ログイン成功後はダッシュボードへ（店舗ユーザー向け）
        router.push('/dashboard');
      }
    } catch (err: any) {
      // エラーメッセージをわかりやすく（日本語）
      const message = err.message.includes('Invalid login credentials')
        ? 'メールアドレスまたはパスワードが正しくありません'
        : err.message || 'ログインに失敗しました。もう一度お試しください。';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-10 rounded-xl shadow-xl w-full max-w-md">
        <h1 className="text-3xl font-bold text-center mb-8">店舗ログイン</h1>
        {error && <p className="text-red-600 mb-4 text-center">{error}</p>}
        <div className="space-y-6">
          <input
            type="email"
            placeholder="メールアドレス"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="パスワード"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <label className="absolute right-4 top-1/2 transform -translate-y-1/2 flex items-center cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
                className="mr-2"
              />
              表示
            </label>
          </div>
          <button
            onClick={handleLogin}
            disabled={loading}
            className={`w-full py-4 text-white font-bold rounded-lg transition ${loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </div>
        <p className="text-center mt-6 text-sm text-gray-500">
          アカウントがない方は <a href="/register" className="text-blue-600 hover:underline">無料登録</a> してください
        </p>
      </div>
    </div>
  );
}