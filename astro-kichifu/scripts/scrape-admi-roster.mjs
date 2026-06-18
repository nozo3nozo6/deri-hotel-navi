/**
 * scrape-admi-roster.mjs
 * admi2888.com/girls の一覧ページから「全女の子」を抽出する。
 *
 * 旧 scrape-admi-girls.mjs は /girls/{id} 内部詳細リンクの子（21人）だけを辿っていたため、
 * ranking-deli.jp へ外部リンクしている子（103人）を取りこぼしていた。
 * このスクリプトは一覧ページの <li> カードを直接パースして全員を拾う。
 *
 * デフォルトでは「外部リンク組（内部詳細ページを持たない子）」のみ出力する
 *   = 既にインポート済みの21人を二重登録しないため。
 * 全員出したい場合は MODE='all'。
 *
 * 出力: scripts/admi-roster-export/
 *   girls.csv                 ← name, age, ... , img_key 列つき
 *   {img_key}_1.jpg/png       ← サムネ1枚（img_keyで一意化、同名衝突を回避）
 *
 * 使い方: node scripts/scrape-admi-roster.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = path.join(__dirname, 'admi-roster-export');
const IMG_DIR   = OUT_DIR; // 画像とCSVを同じ階層に置く（ZIP化しやすい）
const CSV_PATH  = path.join(OUT_DIR, 'girls.csv');
const BASE_URL  = 'https://admi2888.com';

// 'external' = 外部リンク組のみ（既存21人を除外）/ 'all' = 全員
const MODE = process.env.MODE || 'external';

fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AdmiMigration/1.0)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function toOriginalUrl(url) {
  return url.replace(/_w\d+_h\d+(\.\w+)$/i, '$1');
}

async function downloadImage(url, destPath) {
  const origUrl = toOriginalUrl(url);
  const candidates = origUrl !== url ? [origUrl, url] : [url];
  for (const u of candidates) {
    const res = await fetch(u);
    if (res.ok) {
      fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
      return true;
    }
  }
  return false;
}

// 一覧ページの <li> カードを全部パース
function parseList(html) {
  // 女の子一覧の <ul> セクションだけを切り出す
  const ulStart = html.indexOf('<ul class="align-items-start');
  const ulEnd   = html.indexOf('</ul>', ulStart);
  const section = ulStart >= 0 ? html.slice(ulStart, ulEnd) : html;

  const cards = [];
  const liRe = /<li class="([^"]*)">([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(section)) !== null) {
    const cls   = m[1];
    const chunk = m[2];

    const href = chunk.match(/<a href="([^"]+)"/i)?.[1] ?? '';
    const img  = chunk.match(/<img src="(https:\/\/s3[^"]+)"/i)?.[1] ?? '';
    const name = chunk.match(/<p class="name">([^<]+)</i)?.[1]?.trim() ?? '';
    const age  = chunk.match(/<span>（([^）]+)）/)?.[1]?.trim() ?? '';
    const size = chunk.match(/<p class="threeSize">([^<]+)</i)?.[1]?.trim() ?? '';

    if (!name || !img) continue;

    const isInternal = /\/girls\/\d+/.test(href);

    // スリーサイズ "T155 B83(B) W56 H84"
    const height = size.match(/T\s*(\d+)/i)?.[1] ?? '';
    const bust   = size.match(/B\s*(\d+)/i)?.[1] ?? '';
    let   cup    = size.match(/B\s*\d+\s*\(([^)]*)\)/i)?.[1] ?? '';
    const waist  = size.match(/W\s*(\d+)/i)?.[1] ?? '';
    const hip    = size.match(/H\s*(\d+)/i)?.[1] ?? '';
    if (!/^[A-Za-z]{1,3}$/.test(cup)) cup = ''; // "--" 等は空に

    // フラグ（li class: new ex tel inb jend）
    const flags = cls.split(/\s+/).filter(Boolean);
    const is_newgirl    = flags.includes('new')  ? 1 : 0;
    const is_tel        = flags.includes('tel')  ? 1 : 0;
    const is_inbound    = flags.includes('inb')  ? 1 : 0;
    const is_genderless = flags.includes('jend') ? 1 : 0;
    // ex = 待ち合わせ（kichifuに対応カラム無し→無視）

    cards.push({ name, age, height, bust, cup, waist, hip, img, isInternal,
                 is_newgirl, is_tel, is_inbound, is_genderless });
  }
  return cards;
}

function csvEscape(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }

async function main() {
  console.log('🚀 admi2888 一覧ページから全女の子を抽出\n');
  const html = await fetchHtml(`${BASE_URL}/girls`);
  let cards = parseList(html);
  console.log(`  一覧カード総数: ${cards.length}人（内部 ${cards.filter(c=>c.isInternal).length} / 外部 ${cards.filter(c=>!c.isInternal).length}）`);

  if (MODE === 'external') cards = cards.filter(c => !c.isInternal);
  console.log(`  出力対象（MODE=${MODE}）: ${cards.length}人\n`);

  // img_key を一意採番（同名衝突回避）
  cards.forEach((c, i) => { c.img_key = 'g' + String(i + 1).padStart(3, '0'); });

  // 画像ダウンロード
  let imgOk = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const ext = (c.img.match(/\.(jpg|jpeg|png|webp)(?:\?|$)/i)?.[1] ?? 'jpg').toLowerCase();
    const dest = path.join(IMG_DIR, `${c.img_key}_1.${ext}`);
    const ok = await downloadImage(c.img, dest);
    if (ok) imgOk++;
    c.imgSaved = ok;
    console.log(`  [${i + 1}/${cards.length}] ${c.name}（${c.age}）${ok ? '✓' : '✗画像失敗'} ${c.img_key}_1.${ext}`);
    await sleep(120);
  }

  // CSV出力
  const headers = ['name','age','height','bust','cup','waist','hip','catch_copy','comment',
                   'is_display','is_newgirl','is_trial','is_tel','is_inbound','is_genderless',
                   'sort','girl_category_id','img_key'];
  const lines = ['﻿' + headers.join(',')];
  cards.forEach((c, i) => {
    lines.push([
      c.name, c.age, c.height, c.bust, c.cup, c.waist, c.hip, '', '',
      1, c.is_newgirl, 0, c.is_tel, c.is_inbound, c.is_genderless,
      100 + i, 1, c.img_key,
    ].map(csvEscape).join(','));
  });
  fs.writeFileSync(CSV_PATH, lines.join('\r\n'), 'utf8');

  // 同名チェック（参考表示）
  const nameCount = {};
  cards.forEach(c => { nameCount[c.name] = (nameCount[c.name] || 0) + 1; });
  const dups = Object.entries(nameCount).filter(([, n]) => n > 1);

  console.log(`\n✅ 完了`);
  console.log(`  CSV: ${CSV_PATH} (${cards.length}人)`);
  console.log(`  画像: ${imgOk}/${cards.length} 枚 取得`);
  if (dups.length) console.log(`  ⚠ 同名（img_keyで区別済み）: ${dups.map(([n, x]) => `${n}×${x}`).join(', ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
