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

const MODES = ['men', 'women', 'men_same', 'women_same', 'este'];
const MODE_PATH = { men: 'deli', women: 'jofu', men_same: 'same-m', women_same: 'same-f', este: 'este' };

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

// 主要都市（検索ボリュームが高い市区町村）
const MAJOR_CITIES = {
  '北海道': ['札幌市中央区', '札幌市北区', '旭川市', '函館市', '帯広市'],
  '宮城県': ['仙台市青葉区', '仙台市宮城野区'],
  '埼玉県': ['さいたま市大宮区', '川越市', '越谷市'],
  '千葉県': ['千葉市中央区', '船橋市', '柏市', '市川市'],
  '東京都': ['新宿区', '渋谷区', '豊島区', '台東区', '港区', '中央区', '千代田区', '品川区', '大田区', '世田谷区', '中野区', '杉並区', '墨田区', '江東区', '足立区', '北区', '板橋区', '練馬区', '葛飾区', '江戸川区', '八王子市', '町田市', '立川市'],
  '神奈川県': ['横浜市中区', '横浜市西区', '横浜市港北区', '川崎市川崎区', '川崎市中原区', '相模原市', '藤沢市'],
  '新潟県': ['新潟市中央区'],
  '静岡県': ['静岡市葵区', '浜松市中央区'],
  '愛知県': ['名古屋市中区', '名古屋市中村区', '名古屋市東区', '名古屋市千種区'],
  '京都府': ['京都市下京区', '京都市中京区', '京都市東山区'],
  '大阪府': ['大阪市北区', '大阪市中央区', '大阪市浪速区', '大阪市天王寺区', '大阪市西区', '堺市堺区'],
  '兵庫県': ['神戸市中央区', '神戸市兵庫区', '姫路市', '尼崎市', '西宮市'],
  '広島県': ['広島市中区', '広島市南区', '福山市'],
  '福岡県': ['福岡市博多区', '福岡市中央区', '北九州市小倉北区'],
  '沖縄県': ['那覇市', '宜野湾市', '沖縄市']
};

// URL entry helper
function entry(loc, priority, changefreq) {
  const safeLoc = loc.replace(/&/g, '&amp;');
  return `  <url>\n    <loc>${safeLoc}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

const urls = [];

// トップページ
urls.push(entry(`${BASE_URL}/`, '1.0', 'daily'));

// モード別ポータル（サブディレクトリ方式）
urls.push(entry(`${BASE_URL}/deli/`, '0.9', 'daily'));
urls.push(entry(`${BASE_URL}/jofu/`, '0.9', 'daily'));
urls.push(entry(`${BASE_URL}/same-m/`, '0.7', 'weekly'));
urls.push(entry(`${BASE_URL}/same-f/`, '0.7', 'weekly'));

// サブドメイン（loveho追加）
urls.push(entry('https://deli.yobuho.com/', '0.8', 'weekly'));
urls.push(entry('https://jofu.yobuho.com/', '0.8', 'weekly'));
urls.push(entry('https://same.yobuho.com/', '0.8', 'weekly'));
urls.push(entry('https://loveho.yobuho.com/', '0.8', 'weekly'));

// ガイドページ
urls.push(entry(`${BASE_URL}/guide/deli-hotel.html`, '0.8', 'weekly'));
urls.push(entry(`${BASE_URL}/guide/jofu-hotel.html`, '0.8', 'weekly'));
urls.push(entry(`${BASE_URL}/guide/lgbt-hotel.html`, '0.8', 'weekly'));

// 固定ページ
urls.push(entry(`${BASE_URL}/terms.html`, '0.3', 'monthly'));
urls.push(entry(`${BASE_URL}/privacy.html`, '0.3', 'monthly'));
urls.push(entry(`${BASE_URL}/contact.html`, '0.3', 'monthly'));
urls.push(entry(`${BASE_URL}/shop-register.html`, '0.5', 'monthly'));

// 都道府県 x モード別URL（サブディレクトリ方式）
for (const mode of MODES) {
  const mp = MODE_PATH[mode];
  for (const pref of PREFECTURES) {
    urls.push(entry(`${BASE_URL}/${mp}/${encodeURIComponent(pref)}`, '0.6', 'daily'));
  }
}

// 主要都市 x モード別URL（高検索ボリューム）
for (const mode of ['men', 'women']) {
  const mp = MODE_PATH[mode];
  for (const [pref, cities] of Object.entries(MAJOR_CITIES)) {
    for (const city of cities) {
      urls.push(entry(
        `${BASE_URL}/${mp}/${encodeURIComponent(pref)}/${encodeURIComponent(city)}`,
        '0.5', 'daily'
      ));
    }
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
