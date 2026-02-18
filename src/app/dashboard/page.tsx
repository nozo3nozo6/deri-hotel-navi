'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, getCurrentUser } from '@/lib/auth';

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const [store, setStore] = useState<any>(null);
  const [myHotels, setMyHotels] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // 新規投稿フォーム用
  const [selectedHotelId, setSelectedHotelId] = useState('');
  const [isYes, setIsYes] = useState(true);
  const [yesType, setYesType] = useState('');
  const [comment, setComment] = useState('');

  useEffect(() => {
    const checkAuth = async () => {
      console.log('【ダッシュボード】認証チェック開始');

      const currentUser = await getCurrentUser();
      if (!currentUser) {
        console.log('【未ログイン】 → /loginへリダイレクト');
        router.push('/login');
        return;
      }
      console.log('【現在のユーザーID】', currentUser.id);
      setUser(currentUser);

      // 自分の店舗情報取得
      const { data: storeData, error: storeErr } = await supabase
        .from('stores')
        .select('*')
        .eq('user_id_auth', currentUser.id)
        .single();

      if (storeErr) {
        console.error('【店舗取得エラー】', storeErr.message);
        setError('店舗情報の取得に失敗しました: ' + storeErr.message);
      } else if (storeData) {
        console.log('【店舗取得成功】', storeData);
        setStore(storeData);

        // 自分の店舗のホテル取得
        console.log('【ホテル検索開始】 owner_id =', storeData.id);
        const { data: hotelsData, error: hotelsErr } = await supabase
          .from('hotels')
          .select('*')
          .eq('owner_id', storeData.id)
          .order('created_at', { ascending: false });

        if (hotelsErr) {
          console.error('【ホテル取得エラー】', hotelsErr.message);
          setError('ホテルの取得に失敗しました: ' + hotelsErr.message);
        } else {
          console.log('【取得したホテル一覧】', hotelsData);
          setMyHotels(hotelsData || []);
        }
      } else {
        console.log('【店舗データなし】');
        setError('あなたの店舗情報が見つかりません。登録してください。');
      }

      // 自分の投稿一覧取得（エラー耐性強化版）
      console.log('【投稿検索開始】 author_id =', currentUser.id);
      let postsData = [];
      let postsErr = null;

      try {
        const result = await supabase
          .from('posts')
          .select('*')
          .eq('author_id', currentUser.id)
          .order('created_at', { ascending: false });
        postsData = result.data || [];
        postsErr = result.error;
      } catch (err) {
        console.error('postsテーブル取得例外:', err);
        postsErr = err;
      }

      if (postsErr) {
        if (postsErr.message?.includes('Could not find the table') || postsErr.code === 'PGRST116') {
          console.log('postsテーブルが存在しないため、空として扱います');
          setPosts([]);
        } else {
          console.error('【投稿取得エラー】', postsErr.message);
          setError('投稿の取得に失敗しました: ' + postsErr.message);
        }
      } else {
        console.log('【自分の投稿一覧】', postsData);
        setPosts(postsData);
      }

      setLoading(false);
      console.log('【ダッシュボード読み込み完了】');
    };

    checkAuth();
  }, [router]);

  const handlePostSubmit = async () => {
    if (!user || !store || !selectedHotelId) {
      alert('ホテルを選択してください');
      return;
    }

    try {
      console.log('【投稿開始】 hotel_id =', selectedHotelId);
      const { error: insertError } = await supabase
        .from('posts')
        .insert({
          hotel_id: selectedHotelId,
          author_type: 'store',
          author_id: user.id,
          author_name: store.store_name,
          author_url: store.url,
          is_yes: isYes,
          yes_type: isYes ? yesType : null,
          comment,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (insertError) {
        console.error('【投稿エラー】', insertError.message);
        throw insertError;
      }

      alert('投稿しました！');
      console.log('【投稿成功】');

      // 投稿一覧を再取得（エラー耐性付き）
      let newPosts = [];
      try {
        const { data } = await supabase
          .from('posts')
          .select('*')
          .eq('author_id', user.id)
          .order('created_at', { ascending: false });
        newPosts = data || [];
      } catch (err) {
        console.error('投稿再取得エラー:', err);
        newPosts = [];
      }
      setPosts(newPosts);
    } catch (err: any) {
      alert('投稿に失敗しました: ' + err.message);
      console.error('【投稿失敗】', err.message);
    }
  };

  if (loading) return <div className="text-center p-10 text-xl">読み込み中...</div>;
  if (error) return <div className="text-center p-10 text-red-600 text-xl">{error}</div>;

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white dark:from-black dark:to-zinc-950">
      <main className="container mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-4xl font-bold text-center mb-12">店舗ダッシュボード</h1>

        {/* 店舗情報 */}
        {store ? (
          <section className="mb-16 bg-white dark:bg-zinc-800 p-8 rounded-2xl shadow-xl">
            <h2 className="text-2xl font-bold mb-6">あなたの店舗情報</h2>
            <p className="text-lg mb-2"><strong>店舗名:</strong> {store.store_name}</p>
            <p className="text-lg mb-2">
              <strong>URL:</strong>{' '}
              <a href={store.url} target="_blank" className="text-blue-600 hover:underline">
                {store.url || '未設定'}
              </a>
            </p>
            <p className="text-lg mb-2"><strong>Email:</strong> {store.email}</p>
            <p className="text-lg"><strong>有料店舗:</strong> {store.is_paid ? 'はい' : 'いいえ'}</p>
          </section>
        ) : (
          <p className="text-center text-red-600 mb-8">店舗情報が見つかりません。登録してください。</p>
        )}

        {/* 新規投稿フォーム */}
        <section className="mb-16 bg-white dark:bg-zinc-800 p-8 rounded-2xl shadow-xl">
          <h2 className="text-2xl font-bold mb-6">新規投稿</h2>
          <div className="space-y-6">
            <div>
              <label className="block text-lg mb-2">ホテルを選択</label>
              <select
                value={selectedHotelId}
                onChange={(e) => setSelectedHotelId(e.target.value)}
                className="w-full p-4 border rounded-lg dark:bg-zinc-700 dark:text-white"
              >
                <option value="">-- ホテルを選択 --</option>
                {myHotels.length > 0 ? (
                  myHotels.map((hotel) => (
                    <option key={hotel.id} value={hotel.id}>
                      {hotel.name} ({hotel.city || '不明'})
                    </option>
                  ))
                ) : (
                  <option disabled>ホテルがありません（店舗にホテルを登録してください）</option>
                )}
              </select>
            </div>

            <div>
              <label className="block text-lg mb-2">呼べるか</label>
              <div className="flex gap-6">
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="is_yes"
                    checked={isYes}
                    onChange={() => setIsYes(true)}
                    className="mr-2"
                  />
                  呼べる
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="is_yes"
                    checked={!isYes}
                    onChange={() => setIsYes(false)}
                    className="mr-2"
                  />
                  呼べない
                </label>
              </div>
            </div>

            {isYes && (
              <div>
                <label className="block text-lg mb-2">詳細（YES時）</label>
                <select
                  value={yesType}
                  onChange={(e) => setYesType(e.target.value)}
                  className="w-full p-4 border rounded-lg dark:bg-zinc-700 dark:text-white"
                >
                  <option value="">-- 選択 --</option>
                  <option value="ストレート">ストレート</option>
                  <option value="玄関待">玄関待</option>
                  <option value="深夜玄関待">深夜玄関待</option>
                  <option value="EV待">EV待</option>
                  <option value="ダブル必須">ダブル必須</option>
                  <option value="フロント相談">フロント相談</option>
                  <option value="お店相談">お店相談</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-lg mb-2">コメント</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="詳細な状況や注意点を入力"
                className="w-full p-4 border rounded-lg h-32 dark:bg-zinc-700 dark:text-white"
              />
            </div>

            <button
              onClick={handlePostSubmit}
              className="w-full py-4 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition"
            >
              投稿する
            </button>
          </div>
        </section>

        {/* 自分の投稿一覧 */}
        <section>
          <h2 className="text-3xl font-bold text-center mb-8">あなたの投稿一覧</h2>
          {posts.length > 0 ? (
            <div className="space-y-6">
              {posts.map((post) => (
                <div key={post.id} className="bg-white dark:bg-zinc-800 p-6 rounded-xl shadow hover:shadow-lg transition">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-xl font-semibold">
                      {post.is_yes ? '呼べる' : '呼べない'}
                    </h3>
                    <span className="text-sm text-gray-500">
                      {new Date(post.created_at).toLocaleString('ja-JP')}
                    </span>
                  </div>
                  <p className="mb-2"><strong>投稿者:</strong> {post.author_name}</p>
                  {post.yes_type && <p className="mb-2"><strong>詳細:</strong> {post.yes_type}</p>}
                  <p className="text-gray-700 dark:text-gray-300">{post.comment}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-gray-500">まだ投稿がありません</p>
          )}
        </section>
      </main>
    </div>
  );
}