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
  photo: string | null; tags?: string[];
};

export type NewsItem = {
  id: number; title: string; thumb: string | null; body: string; posted_at: string;
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
  const d = await getJson(`${API_BASE}/girls.php?action=detail&id=${id}&shop_id=${SHOP_ID}`);
  return d.girl ?? null;
}

export async function getNews(): Promise<NewsItem[]> {
  const d = await getJson(`${API_BASE}/news.php?action=list&shop_id=${SHOP_ID}`);
  return d.items ?? [];
}
