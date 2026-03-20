// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://yobuho.com',
  output: 'static',
  build: {
    format: 'file',
    inlineStylesheets: 'always',
  },
});
