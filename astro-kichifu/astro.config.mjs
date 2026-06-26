// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://kichifu.com',
  output: 'static',
  build: {
    format: 'file',
    inlineStylesheets: 'auto',
  },
  integrations: [
    // 全ページ（静的 + girls/news/diary 全件）を自動でサイトマップ化 → dist/sitemap-index.xml(+sitemap-0.xml)
    sitemap({
      filter: (page) => !page.includes('/sitemap'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
