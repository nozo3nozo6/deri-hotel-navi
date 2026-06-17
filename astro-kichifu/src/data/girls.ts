// ==========================================================================
// girls.ts — 女の子型定義 + API フェッチヘルパー
// ==========================================================================
export type Girl = {
  id: number;
  name: string;
  age: number;
  height: number;
  bust: number;
  cup: string;
  waist: number;
  hip: number;
  catch_copy?: string;
  photo?: string;         // 一覧APIが返すサムネイル
  images?: { path: string; alt: string }[];
  is_newgirl?: number | boolean;
  is_trial?: number | boolean;
  is_tel?: number | boolean;
  is_inbound?: number | boolean;
  is_genderless?: number | boolean;
  options?: string[];
  profiles?: { name: string; type: string; value: string }[];
  category_name?: string;
};

const API_BASE = 'https://kichifu.com/api';
const SHOP_ID  = 1;
const FALLBACK: Girl[] = [];

export async function fetchGirls(opts: { limit?: number; isNew?: boolean } = {}): Promise<Girl[]> {
  try {
    const params = new URLSearchParams({ action: 'list', shop_id: String(SHOP_ID) });
    if (opts.limit)  params.set('limit',  String(opts.limit));
    if (opts.isNew)  params.set('is_new', '1');
    const res  = await fetch(`${API_BASE}/girls.php?${params}`);
    const json = await res.json();
    return (json.girls ?? []) as Girl[];
  } catch {
    return FALLBACK;
  }
}

export async function fetchGirlDetail(id: number): Promise<Girl | null> {
  try {
    const res  = await fetch(`${API_BASE}/girls.php?action=detail&shop_id=${SHOP_ID}&id=${id}`);
    if (!res.ok) return null;
    const json = await res.json();
    return (json.girl ?? null) as Girl | null;
  } catch {
    return null;
  }
}

// top.astro 等のビルド時フォールバック用サンプル（DB が空の間だけ使用）
export const GIRLS: Girl[] = [];
