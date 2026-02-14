'use client';

import { useEffect, useState } from 'react';

export default function Home() {
  const [isAdult, setIsAdult] = useState<boolean | null>(null);

  useEffect(() => {
    // 初回アクセス時のみ確認（localStorageで記憶）
    const confirmed = localStorage.getItem('ageConfirmed');
    if (confirmed === 'true') {
      setIsAdult(true);
    } else {
      setIsAdult(false);
    }
  }, []);

  const confirmAge = () => {
    localStorage.setItem('ageConfirmed', 'true');
    setIsAdult(true);
  };

  const exitSite = () => {
    window.location.href = 'https://www.google.com'; // 退出先は任意で変更可能
  };

  // ローディング中は何も表示しない
  if (isAdult === null) {
    return null;
  }

  // 18歳未満確認画面
  if (!isAdult) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-red-50 to-white p-4">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow-2xl p-10 text-center border border-red-200">
          <h1 className="text-4xl font-bold text-red-600 mb-6">18歳未満の方は閲覧できません</h1>
          <p className="text-xl text-gray-700 mb-10 leading-relaxed">
            当サイトは18歳以上の方向けの情報を提供しています。<br />
            年齢をご確認の上、ご利用ください。
          </p>
          <div className="flex flex-col sm:flex-row gap-6 justify-center">
            <button
              onClick={confirmAge}
              className="px-10 py-5 bg-green-600 text-white text-xl font-bold rounded-xl hover:bg-green-700 transition shadow-lg"
            >
              はい、18歳以上です
            </button>
            <button
              onClick={exitSite}
              className="px-10 py-5 bg-gray-500 text-white text-xl font-bold rounded-xl hover:bg-gray-600 transition shadow-lg"
            >
              いいえ、退出する
            </button>
          </div>
          <p className="mt-10 text-sm text-gray-500">
            18歳未満の方のご利用は法律で禁止されています。
          </p>
        </div>
      </div>
    );
  }

  // 年齢確認済み：本編画面
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white dark:from-black dark:to-zinc-950">
      <main className="container mx-auto max-w-4xl px-6 py-16">
        {/* ヘッダー */}
        <header className="text-center mb-16">
          <h1 className="text-5xl font-extrabold text-zinc-900 dark:text-white mb-4">
            デリ呼ぶホテルナビ
          </h1>
          <p className="text-xl text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto">
            ビジネスホテルでデリヘル・女性用風俗が呼べる情報を、ユーザーと店舗の両方から集めています
          </p>
        </header>

        {/* 地域選択エリア */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-center mb-8">お近くのエリアを選択</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {['東京', '大阪', '名古屋', '福岡', '札幌', '仙台', '広島', '沖縄'].map((area) => (
              <button
                key={area}
                className="py-6 bg-white dark:bg-zinc-800 rounded-xl shadow hover:shadow-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition text-xl font-medium"
              >
                {area}
              </button>
            ))}
          </div>
        </section>

        {/* 案内文 */}
        <section className="text-center text-zinc-600 dark:text-zinc-400">
          <p className="text-lg mb-4">
            店舗の方は<span className="font-semibold">無料登録</span>すると、ホテル情報を公式投稿できます
          </p>
          <p>ユーザー投稿と店舗投稿を両方確認して、安心してご利用ください</p>
        </section>
      </main>
    </div>
  );
}