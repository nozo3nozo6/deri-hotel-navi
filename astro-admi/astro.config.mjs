// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // ステージング=biyobu.com / 本番化時に 'https://admi2888.com' へ
  site: 'https://biyobu.com',
  output: 'static',
  build: {
    format: 'file',
    inlineStylesheets: 'auto',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
