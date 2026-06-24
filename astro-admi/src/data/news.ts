// ==========================================================================
// news.ts — お知らせ型定義 + API フェッチヘルパー
// ==========================================================================
export type News = {
  id: number;
  title: string;
  thumb?: string;
  body: string;
  published_at: string;
  created_at?: string;
};

const API_BASE = 'https://kichifu.com/api';
const SHOP_ID  = 1;

export async function fetchNews(opts: { limit?: number } = {}): Promise<News[]> {
  try {
    const params = new URLSearchParams({ action: 'list', shop_id: String(SHOP_ID) });
    if (opts.limit) params.set('limit', String(opts.limit));
    const res  = await fetch(`${API_BASE}/news.php?${params}`);
    const json = await res.json();
    return (json.items ?? []) as News[];
  } catch {
    return [];
  }
}

export async function fetchNewsDetail(id: number): Promise<News | null> {
  try {
    const res  = await fetch(`${API_BASE}/news.php?action=detail&shop_id=${SHOP_ID}&id=${id}`);
    if (!res.ok) return null;
    const json = await res.json();
    return (json.item ?? null) as News | null;
  } catch {
    return null;
  }
}

export const NEWS: News[] = [];
