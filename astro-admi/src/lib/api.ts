// ==========================================================================
// api.ts — ビルド時(SSG)にシンレンPHPのJSON APIから取得するヘルパー
// ==========================================================================
import { API_BASE, SHOP_ID } from './config';

export type Girl = {
  id: number; name: string; age: number | null;
  height: number | null; bust: number | null; cup: string | null;
  waist: number | null; hip: number | null; catch_copy: string | null;
  is_newgirl: number; is_trial: number; is_tel: number;
  is_inbound: number; is_genderless: number;
  girl_category_id: number | null; category_name: string | null;
  in_date?: string | null;
  photo: string | null; tags?: string[];
};

export type NewsItem = {
  id: number; title: string; thumb: string | null; body: string; posted_at: string;
  link_girl_id?: number | null; link_url?: string | null;   // サムネのリンク先（detailで使用、girl優先→url→無し）
};

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${url}`);
  return res.json();
}

export async function getGirls(): Promise<Girl[]> {
  const d = await getJson(`${API_BASE}/girls.php?action=list&shop_id=${SHOP_ID}`);
  return d.girls ?? [];
}

export async function getGirl(id: number): Promise<any> {
  // detail が 404/500（列不在等）でも throw でビルド全体を巻き込まず null を返す。
  // 呼び出し側（girls/[id].astro）が null を見て一覧へ退避する。
  try {
    const d = await getJson(`${API_BASE}/girls.php?action=detail&id=${id}&shop_id=${SHOP_ID}`);
    return d.girl ?? null;
  } catch (e) {
    console.warn(`[api.getGirl] detail取得失敗 id=${id}: ${(e as Error).message}`);
    return null;
  }
}

export async function getNews(): Promise<NewsItem[]> {
  const d = await getJson(`${API_BASE}/news.php?action=list&shop_id=${SHOP_ID}`);
  return d.items ?? [];
}

export async function getNewsItem(id: number): Promise<NewsItem | null> {
  const d = await getJson(`${API_BASE}/news.php?action=detail&id=${id}&shop_id=${SHOP_ID}`);
  return d.item ?? null;
}

export type Banner = { title: string; url: string; image: string };

export async function getBanners(type: 'top' | 'bottom' = 'top'): Promise<Banner[]> {
  try {
    const d = await getJson(`${API_BASE}/banners.php?type=${type}&shop_id=${SHOP_ID}`);
    return d.banners ?? [];
  } catch { return []; } // API未配信/失敗時は空でビルドを止めない
}

export type Slider = { title: string; url: string; image_pc: string; image_sp: string };

export async function getSliders(): Promise<Slider[]> {
  try {
    const d = await getJson(`${API_BASE}/sliders.php?shop_id=${SHOP_ID}`);
    return d.sliders ?? [];
  } catch { return []; } // API未配信/失敗時は空でビルドを止めない
}
