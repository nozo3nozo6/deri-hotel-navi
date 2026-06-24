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

    // ranking-deli プロフィールID（外部リンクの場合）
    const rankingId = href.match(/ranking-deli\.jp\/\d+\/shop\/\d+\/(\d+)/)?.[1] ?? '';

    cards.push({ name, age, height, bust, cup, waist, hip, img, href, isInternal, rankingId,
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

  // 画像ダウンロード（外部=ranking-deliプロフィールから最大3枚 / 内部=一覧サムネ1枚）
  let imgTotal = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    let urls = [];

    if (c.rankingId) {
      try {
        const phtml = await fetchHtml(c.href);
        // 本人IDのフル画像だけ（img{N}s_ の小サムネは除外）
        const re = new RegExp(`https?://fuzoku-images\\.ranking-deli\\.jp/\\d+/${c.rankingId}/img(\\d+)_\\d+\\.(jpg|jpeg|png)`, 'gi');
        const found = {};
        let mm;
        while ((mm = re.exec(phtml)) !== null) {
          const n = parseInt(mm[1], 10);
          if (!found[n]) found[n] = mm[0];
        }
        urls = Object.keys(found).map(Number).sort((a, b) => a - b).slice(0, 3).map(n => found[n]);
      } catch (e) { /* プロフィール取得失敗→サムネにフォールバック */ }
    }
    if (!urls.length && c.img) urls = [c.img]; // フォールバック（一覧サムネ1枚）

    let saved = 0;
    for (let n = 0; n < urls.length; n++) {
      const ext = (urls[n].match(/\.(jpg|jpeg|png|webp)(?:\?|$)/i)?.[1] ?? 'jpg').toLowerCase();
      const dest = path.join(IMG_DIR, `${c.img_key}_${n + 1}.${ext}`);
      if (await downloadImage(urls[n], dest)) { saved++; imgTotal++; }
      await sleep(80);
    }
    c.imgSaved = saved;
    console.log(`  [${i + 1}/${cards.length}] ${c.name}（${c.age}）${saved}枚 ${c.img_key}`);
    await sleep(150);
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

  const got3 = cards.filter(c => c.imgSaved >= 3).length;
  console.log(`\n✅ 完了`);
  console.log(`  CSV: ${CSV_PATH} (${cards.length}人)`);
  console.log(`  画像: 合計${imgTotal}枚（3枚取得できた子: ${got3}/${cards.length}）`);
  if (dups.length) console.log(`  ⚠ 同名（img_keyで区別済み）: ${dups.map(([n, x]) => `${n}×${x}`).join(', ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
