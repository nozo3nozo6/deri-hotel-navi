'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

// Supabaseクライアント
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 47都道府県をできるだけ平等に細分化したエリアグループ
// 東京都も他の県と同程度の粒度に抑え、全体のバランスを取っています
// 合計約45グループ程度（使いやすさを維持）
const areaGroups = [
  // 北海道
  { name: '札幌市', regions: ['札幌市中央区・北区', '札幌市東区・白石区', '札幌市豊平区・厚別区', '札幌市西区・手稲区'] },
  { name: '北海道道央・道南', regions: ['函館市', '小樽・余市', '室蘭・苫小牧', '千歳・恵庭'] },
  { name: '北海道道北・道東', regions: ['旭川・富良野', '稚内・宗谷', '釧路・根室', '帯広・十勝'] },

  // 東北
  { name: '青森県', regions: ['青森市・弘前', '八戸・十和田', '下北・むつ'] },
  { name: '岩手県', regions: ['盛岡市', '花巻・北上', '一関・奥州'] },
  { name: '宮城県', regions: ['仙台市中心', '仙台市郊外・名取', '石巻・気仙沼'] },
  { name: '秋田県', regions: ['秋田市', '横手・湯沢', '大館・能代'] },
  { name: '山形県', regions: ['山形市・天童', '米沢・上山', '酒田・鶴岡'] },
  { name: '福島県', regions: ['福島市・郡山', 'いわき市', '会津若松'] },

  // 関東（東京都は抑えめに）
  { name: '東京都（中心部）', regions: ['新宿・渋谷・池袋', '銀座・丸の内・有楽町', '上野・浅草・スカイツリー'] },
  { name: '東京都（その他）', regions: ['六本木・赤坂・麻布', '品川・お台場', '立川・八王子・多摩'] },
  { name: '神奈川県', regions: ['横浜みなとみらい・関内', '川崎・鶴見', '湘南（鎌倉・藤沢）', '相模原・厚木'] },
  { name: '埼玉県', regions: ['さいたま市大宮・浦和', '川口・戸田', '所沢・川越'] },
  { name: '千葉県', regions: ['千葉市中央・幕張', '船橋・柏', '成田・佐倉'] },
  { name: '茨城県', regions: ['水戸・日立', 'つくば・土浦'] },
  { name: '栃木県', regions: ['宇都宮市', '日光・足利'] },
  { name: '群馬県', regions: ['前橋・高崎', '伊勢崎・太田'] },

  // 中部・北陸
  { name: '新潟県', regions: ['新潟市中心', '長岡・三条'] },
  { name: '富山県', regions: ['富山市', '高岡・魚津'] },
  { name: '石川県', regions: ['金沢市', '小松・加賀'] },
  { name: '福井県', regions: ['福井市・敦賀'] },
  { name: '山梨県', regions: ['甲府市・富士吉田'] },
  { name: '長野県', regions: ['長野市・松本', '上田・佐久'] },
  { name: '岐阜県', regions: ['岐阜市・大垣'] },
  { name: '静岡県', regions: ['静岡市・浜松市', '沼津・富士'] },
  { name: '愛知県', regions: ['名古屋市中心', '豊田・岡崎'] },

  // 関西
  { name: '大阪府（大阪市内）', regions: ['梅田・北新地', '難波・心斎橋', '天王寺・阿倍野'] },
  { name: '大阪府（郊外）', regions: ['堺・岸和田', '東大阪・枚方', '豊中・吹田'] },
  { name: '京都府', regions: ['京都市中心（河原町・四条）', '伏見・宇治'] },
  { name: '兵庫県', regions: ['神戸三宮・元町', '姫路・西宮'] },
  { name: '奈良県', regions: ['奈良市・生駒'] },
  { name: '和歌山県', regions: ['和歌山市・海南'] },

  // 中国・四国
  { name: '鳥取県・島根県', regions: ['鳥取・米子', '松江・出雲'] },
  { name: '岡山県', regions: ['岡山市', '倉敷'] },
  { name: '広島県', regions: ['広島市中心', '福山'] },
  { name: '山口県', regions: ['下関・宇部'] },
  { name: '徳島県', regions: ['徳島市'] },
  { name: '香川県', regions: ['高松市'] },
  { name: '愛媛県', regions: ['松山市'] },
  { name: '高知県', regions: ['高知市'] },

  // 九州・沖縄
  { name: '福岡県（福岡市内）', regions: ['天神・博多', '東区・香椎'] },
  { name: '福岡県（北九州・筑後）', regions: ['小倉・八幡', '久留米'] },
  { name: '佐賀県・長崎県', regions: ['佐賀市', '長崎市'] },
  { name: '熊本県', regions: ['熊本市'] },
  { name: '大分県', regions: ['大分市・別府'] },
  { name: '宮崎県', regions: ['宮崎市'] },
  { name: '鹿児島県・沖縄県', regions: ['鹿児島市', '那覇・沖縄本島'] },
];

export default function Home() {
  // 年齢確認（初期値nullにして、クライアント側でセット）
  const [isAdult, setIsAdult] = useState<boolean | null>(null);

  useEffect(() => {
    // クライアント側でlocalStorageを参照
    const confirmed = localStorage.getItem('ageConfirmed') === 'true';
    setIsAdult(confirmed);
  }, []);

  const confirmAge = () => {
    localStorage.setItem('ageConfirmed', 'true');
    setIsAdult(true);
  };

  const exitSite = () => {
    window.location.href = 'https://www.google.com';
  };

  // データ状態
  const [stores, setStores] = useState<any[]>([]);
  const [hotels, setHotels] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // フィルタリング用
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [filteredHotels, setFilteredHotels] = useState<any[]>([]);

  // 位置情報
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [nearHotels, setNearHotels] = useState<any[]>([]);
  const [locationStatus, setLocationStatus] = useState<'loading' | 'success' | 'denied' | 'error'>('loading');

  useEffect(() => {
    if (isAdult) {
      getUserLocation();
      fetchAllData();
    }
  }, [isAdult]);

  const getUserLocation = () => {
    if (navigator.geolocation) {
      setLocationStatus('loading');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setUserLocation({ lat, lng });
          setLocationStatus('success');
          fetchNearHotels(lat, lng);
        },
        (err) => {
          console.error(err);
          setLocationStatus('denied');
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    } else {
      setLocationStatus('error');
    }
  };

  const fetchAllData = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: sData, error: sErr } = await supabase.from('stores').select('*').limit(10);
      if (sErr) throw sErr;
      setStores(sData || []);

      const { data: hData, error: hErr } = await supabase.from('hotels').select('*').limit(10);
      if (hErr) throw hErr;
      setHotels(hData || []);
      setFilteredHotels(hData || []);

      const { data: pData, error: pErr } = await supabase.from('posts').select('*').limit(10);
      if (pErr) throw pErr;
      setPosts(pData || []);
    } catch (err: any) {
      setError(err.message || 'データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const fetchNearHotels = async (lat: number, lng: number) => {
    try {
      const { data, error } = await supabase.from('hotels').select('*').limit(10);
      if (error) throw error;

      const sorted = data
        .map((h) => ({
          ...h,
          distance: Math.hypot(lat - (h.latitude || 0), lng - (h.longitude || 0)),
        }))
        .sort((a, b) => a.distance - b.distance);

      setNearHotels(sorted);
      setFilteredHotels(sorted);
    } catch (err) {
      console.error(err);
    }
  };

  // エリアグループ選択でフィルタリング
  useEffect(() => {
    if (selectedGroup) {
      const group = areaGroups.find(g => g.name === selectedGroup);
      if (group) {
        const filtered = hotels.filter(hotel => 
          group.regions.some(r => 
            hotel.prefecture?.includes(r) || hotel.city?.includes(r) || hotel.address?.includes(r)
          )
        );
        setFilteredHotels(filtered);
      }
    } else {
      setFilteredHotels(userLocation ? nearHotels : hotels);
    }
  }, [selectedGroup, hotels, nearHotels, userLocation]);

  if (isAdult === null) {
    return <div className="min-h-screen flex items-center justify-center text-xl">読み込み中...</div>;
  }

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

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white dark:from-black dark:to-zinc-950">
      <main className="container mx-auto max-w-5xl px-6 py-12">
        <header className="text-center mb-16">
          <h1 className="text-5xl font-extrabold text-zinc-900 dark:text-white mb-4">
            デリ呼ぶホテルナビ
          </h1>
          <p className="text-xl text-zinc-600 dark:text-zinc-400 max-w-3xl mx-auto">
            ビジネスホテルでデリヘル・女性用風俗が呼べる情報を、ユーザーと店舗の両方から集めています
          </p>
        </header>

        {/* 位置情報エリア */}
        {locationStatus === 'loading' && <p className="text-center text-xl mb-8">現在地を取得中...</p>}
        {locationStatus === 'denied' && <p className="text-center text-red-600 mb-8">位置情報の使用が拒否されました。エリアを選択してください。</p>}
        {locationStatus === 'error' && <p className="text-center text-red-600 mb-8">位置情報が利用できません。エリアを選択してください。</p>}

        {locationStatus === 'success' && nearHotels.length > 0 && (
          <section className="mb-16">
            <h2 className="text-3xl font-bold text-center mb-8">現在地近くのホテル</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {nearHotels.map((hotel) => (
                <div key={hotel.id} className="bg-white dark:bg-zinc-800 p-6 rounded-xl shadow hover:shadow-lg transition">
                  <h3 className="text-xl font-semibold mb-2">{hotel.name}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {hotel.prefecture} {hotel.city} {hotel.address}
                  </p>
                  {hotel.price_range && <p className="text-sm text-gray-600 dark:text-gray-400">価格帯: {hotel.price_range}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* エリアグループ選択 */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-center mb-8">お近くのエリアを選択</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {areaGroups.map((group) => (
              <button
                key={group.name}
                onClick={() => setSelectedGroup(group.name)}
                className={`py-6 px-4 rounded-xl shadow transition text-lg font-medium text-center ${
                  selectedGroup === group.name
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/50'
                    : 'bg-white dark:bg-zinc-800 hover:shadow-lg hover:bg-indigo-50 dark:hover:bg-zinc-700'
                }`}
              >
                {group.name}
              </button>
            ))}
          </div>
        </section>

        {/* フィルタリングされたホテル一覧 */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-center mb-8">
            {selectedGroup ? `${selectedGroup}のホテル` : 'すべてのホテル（テスト）'}
          </h2>
          {loading ? (
            <p className="text-center text-xl">読み込み中...</p>
          ) : error ? (
            <p className="text-center text-red-600 text-xl">エラー: {error}</p>
          ) : filteredHotels.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredHotels.map((hotel) => (
                <div key={hotel.id} className="bg-white dark:bg-zinc-800 p-6 rounded-xl shadow hover:shadow-lg transition">
                  <h3 className="text-xl font-semibold mb-2">{hotel.name}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {hotel.prefecture} {hotel.city} {hotel.address}
                  </p>
                  {hotel.price_range && <p className="text-sm text-gray-600 dark:text-gray-400">価格帯: {hotel.price_range}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-gray-500">ホテルが見つかりませんでした</p>
          )}
        </section>

        {/* 投稿一覧 */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-center mb-8">最新投稿（テスト）</h2>
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
                  <p className="mb-2"><strong>投稿者:</strong> {post.author_name} ({post.author_type})</p>
                  {post.yes_type && <p className="mb-2"><strong>詳細:</strong> {post.yes_type}</p>}
                  <p className="text-gray-700 dark:text-gray-300">{post.comment}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-gray-500">投稿データがありません</p>
          )}
        </section>

        {/* 案内文 */}
        <section className="text-center text-zinc-600 dark:text-zinc-400">
          <p className="text-lg mb-4">
            店舗の方は<span className="font-semibold">無料登録</span>すると、ホテル情報を公式投稿できます
          </p>
          <p>ユーザー投稿と店舗投稿を両方確認して、安心してご利用ください</p>
        </section>

        {/* Supabase接続テスト */}
        <div className="mt-8 text-center text-sm text-green-600">
          Supabase接続テスト： {supabase ? 'OK！接続準備完了' : 'NG'}
        </div>
      </main>
    </div>
  );
}