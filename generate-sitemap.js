#!/usr/bin/env node
/**
 * generate-sitemap.js
 * sitemap.xml を生成するスクリプト
 * 実行: node generate-sitemap.js
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://yobuho.com';
const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const MODES = ['men', 'women', 'men_same', 'women_same'];

const PREFECTURES = [
  '北海道',
  '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '富山県', '石川県', '福井県',
  '新潟県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県',
  '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県',
  '沖縄県'
];

// URL entry helper
function entry(loc, priority, changefreq) {
  return `  <url><loc>${loc}</loc><lastmod>${TODAY}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

const urls = [];

// トップページ
urls.push(entry(`${BASE_URL}/`, '1.0', 'daily'));

// モード別ポータル
urls.push(entry(`${BASE_URL}/portal.html?mode=men`, '0.9', 'daily'));
urls.push(entry(`${BASE_URL}/portal.html?mode=women`, '0.9', 'daily'));
urls.push(entry(`${BASE_URL}/portal.html?mode=women_same`, '0.7', 'weekly'));
urls.push(entry(`${BASE_URL}/portal.html?mode=men_same`, '0.7', 'weekly'));

// サブドメイン
urls.push(entry('https://deli.yobuho.com/', '0.8', 'weekly'));
urls.push(entry('https://jofu.yobuho.com/', '0.8', 'weekly'));
urls.push(entry('https://same.yobuho.com/', '0.8', 'weekly'));

// 固定ページ
urls.push(entry(`${BASE_URL}/terms.html`, '0.3', 'monthly'));
urls.push(entry(`${BASE_URL}/privacy.html`, '0.3', 'monthly'));
urls.push(entry(`${BASE_URL}/contact.html`, '0.3', 'monthly'));
urls.push(entry(`${BASE_URL}/shop-register.html`, '0.5', 'monthly'));

// 都道府県別URL（モードなし = デフォルトmen）
for (const pref of PREFECTURES) {
  urls.push(entry(`${BASE_URL}/portal.html?pref=${pref}`, '0.8', 'daily'));
}

// 都道府県 x モード別URL
for (const mode of MODES) {
  for (const pref of PREFECTURES) {
    urls.push(entry(`${BASE_URL}/portal.html?mode=${mode}&pref=${pref}`, '0.6', 'daily'));
  }
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;

const outPath = path.join(__dirname, 'sitemap.xml');
fs.writeFileSync(outPath, xml, 'utf-8');
console.log(`sitemap.xml generated: ${urls.length} URLs (${outPath})`);
