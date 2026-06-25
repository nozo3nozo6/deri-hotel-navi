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

// FPM が一時枯渇すると空レスポンス(200+0byte)を返すことがある→リトライで吸収
// （CIビルドは girls/[id] を全件並列fetchするため FPM が瞬間的に枯渇しやすい）
async function getJson(url: string, retries = 4): Promise<any> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`API ${res.status}: ${url}`);
      const text = await res.text();
      if (!text) throw new Error(`empty response: ${url}`);
      return JSON.parse(text);
    } catch (e) {
      if (i >= retries) throw e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));   // 0.6/1.2/1.8/2.4s バックオフ
    }
  }
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

export type Diary = {
  id: number; girl_id: number | null; girl_name: string | null;
  title: string; body: string; image: string; link_url: string | null; posted_at: string;
};

// 写メ日記（fujoho 取込）。最新情報に混ぜる用。失敗時は空でビルド継続
export async function getDiaries(limit = 20): Promise<Diary[]> {
  try {
    const d = await getJson(`${API_BASE}/news.php?action=diaries&shop_id=${SHOP_ID}&limit=${limit}`);
    return d.diaries ?? [];
  } catch { return []; }
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
