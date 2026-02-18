'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Register() {
  const [storeName, setStoreName] = useState('');
  const [url, setUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false); // パスワード表示用
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    setLoading(true);
    setError(null);

    console.log('【登録開始】 入力値:', {
      storeName,
      url,
      email,
      passwordLength: password.length, // パスワードは長さだけログ
    });

    try {
      console.log('【Supabase Auth signUp開始】 email =', email);
      const { data: { user }, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        console.error('【Auth登録エラー】', signUpError.message);
        throw signUpError;
      }

      if (user) {
        console.log('【Authユーザー作成成功】 UID =', user.id);

        console.log('【storesテーブルへINSERT開始】');
        const { error: insertError } = await supabase
          .from('stores')
          .insert({
            store_name: storeName,
            url,
            email,
            is_paid: false,
            user_id_auth: user.id,
          });

        if (insertError) {
          console.error('【stores INSERTエラー】', insertError.message);
          throw insertError;
        }

        console.log('【stores登録成功】');
        setSuccess(true);
      } else {
        console.warn('【userオブジェクトなし】');
      }
    } catch (err: any) {
      console.error('【全体エラー】', err.message, err);
      setError(err.message || '登録に失敗しました');
    } finally {
      setLoading(false);
      console.log('【登録処理終了】');
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-10 rounded-xl shadow-xl text-center">
          <h1 className="text-3xl font-bold text-green-600 mb-6">登録完了！</h1>
          <p className="text-lg mb-8">店舗情報が登録されました。</p>
          <a href="/" className="text-blue-600 hover:underline">トップページに戻る</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-10 rounded-xl shadow-xl w-full max-w-md">
        <h1 className="text-3xl font-bold text-center mb-8">店舗無料登録</h1>
        {error && <p className="text-red-600 mb-4 text-center">{error}</p>}
        <div className="space-y-6">
          <input
            type="text"
            placeholder="店舗名"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            className="w-full p-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <input
            type="url"
            placeholder="店舗URL (任意)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full p-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="email"
            placeholder="メールアドレス（本物のアドレスを推奨）"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="パスワード（8文字以上）"
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
            onClick={handleRegister}
            disabled={loading}
            className={`w-full py-4 text-white font-bold rounded-lg transition ${loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {loading ? '登録中...' : '無料登録する'}
          </button>
        </div>
        <p className="text-center mt-6 text-sm text-gray-500">
          登録後、確認メールが届きます。リンクをクリックして認証してください。
        </p>
      </div>
    </div>
  );
}