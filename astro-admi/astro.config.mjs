// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// ── sitemap の <lastmod> 用: 実データ（DB）の更新日時をページ別に取得 ──────────
// girls/{id}=in_date（入店日）, news/{id}=posted_at（投稿日時）を lastmod に。
// 一覧/トップ系は最新コンテンツ日を使用。全ページ同一のビルド時刻より、
// ページ別の安定した実日付の方が Google のクロール優先度に効く。
// 取得失敗時は lastmod 無し（従来どおり）でビルド継続＝ビルドを止めない。
const SITEMAP_API = 'https://admi2888.com/api';
const SITEMAP_SHOP = 1;   // 立川（admi）

function toW3C(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                          // 日付のみ（in_date）
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}+09:00` : String(s).slice(0, 10);          // 日時→JST ISO
}

const lastmodMap = new Map();
try {
  const [gRes, nRes] = await Promise.all([
    fetch(`${SITEMAP_API}/girls.php?action=list&shop_id=${SITEMAP_SHOP}`).then((r) => r.json()),
    fetch(`${SITEMAP_API}/news.php?action=list&shop_id=${SITEMAP_SHOP}`).then((r) => r.json()),
  ]);
  let newest = '';
  for (const g of gRes.girls ?? []) {
    const lm = toW3C(g.in_date);
    if (lm) { lastmodMap.set(`/girls/${g.id}`, lm); if (lm.slice(0, 10) > newest) newest = lm.slice(0, 10); }
  }
  for (const n of nRes.items ?? []) {
    const lm = toW3C(n.posted_at);
    if (lm) { lastmodMap.set(`/news/${n.id}`, lm); if (lm.slice(0, 10) > newest) newest = lm.slice(0, 10); }
  }
  if (newest) for (const p of ['/', '/top', '/girls', '/news', '/schedule']) lastmodMap.set(p, newest);
  console.log(`[sitemap] lastmod: ${lastmodMap.size} ページに実データ更新日を付与`);
} catch (e) {
  console.warn('[sitemap] lastmod 取得スキップ（lastmod 無しで継続）:', e?.message || e);
}

export default defineConfig({
  // 本番 admi2888.com（NS切替で本番化、2026-06-26）。site は canonical/サイトマップの基準。
  // ※ 旧ステージング biyobu.com は別サイトへ転用済み（deploy-staging.sh は無効化）。
  site: 'https://admi2888.com',
  output: 'static',
  build: {
    format: 'file',
    inlineStylesheets: 'auto',
  },
  integrations: [
    // 全ページ（静的 + girls/news/diary 全件）を自動でサイトマップ化 → dist/sitemap-index.xml(+sitemap-0.xml)
    sitemap({
      // index対象のみ。人間用HTMLサイトマップ(/sitemap)と noindex の写メ日記(/diary/)は除外。
      filter: (page) => !page.includes('/sitemap') && !page.includes('/diary/'),
      // ページ別 <lastmod>（実データの更新日）を付与。マップに無いページは lastmod 無し。
      serialize(item) {
        const path = new URL(item.url).pathname.replace(/\/+$/, '') || '/';
        const lm = lastmodMap.get(path);
        if (lm) item.lastmod = lm;
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
