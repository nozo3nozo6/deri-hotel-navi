/**
 * scrape-admi-girls.mjs
 * admi2888.com/girls から女の子データをスクレイピングして
 * girls.csv + 画像ファイル（名前_1.jpg 形式）を出力する
 *
 * 使い方:
 *   node scripts/scrape-admi-girls.mjs
 *
 * 出力先: scripts/admi-export/
 *   girls.csv
 *   画像/  さくら_1.jpg  さくら_2.jpg  さくら_3.jpg  ...
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = path.join(__dirname, 'admi-export');
const IMG_DIR   = path.join(OUT_DIR, '画像');
const CSV_PATH  = path.join(OUT_DIR, 'girls.csv');
const BASE_URL  = 'https://admi2888.com';

// 並列数（サーバー負荷を避けるため控えめに）
const CONCURRENCY = 3;
// 1リクエスト間隔（ms）
const DELAY_MS    = 400;

fs.mkdirSync(IMG_DIR, { recursive: true });

// ============================================================
// ユーティリティ
// ============================================================
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AdmiMigration/1.0)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

// _w80_h80 等のサイズサフィックスを除去してオリジナルURLを返す
function toOriginalUrl(url) {
  return url.replace(/_w\d+_h\d+\.jpg$/i, '.jpg');
}

async function downloadImage(url, destPath) {
  // オリジナル（サフィックスなし）を優先、失敗時はサイズ付きにフォールバック
  const origUrl = toOriginalUrl(url);
  const candidates = origUrl !== url ? [origUrl, url] : [url];
  for (const u of candidates) {
    const res = await fetch(u);
    if (res.ok) {
      const buf = await res.arrayBuffer();
      fs.writeFileSync(destPath, Buffer.from(buf));
      return true;
    }
  }
  return false;
}

// 簡易HTML属性パーサー（正規表現ベース、外部ライブラリなし）
function extractAttr(html, attr) {
  const re = new RegExp(`${attr}=["']([^"']+)["']`, 'i');
  return html.match(re)?.[1] ?? null;
}

function extractText(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  return html.match(re)?.[1]?.trim() ?? null;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// ============================================================
// Step 1: 一覧ページから girl ID + 名前 を収集
// ============================================================
async function fetchGirlList() {
  console.log('📋 一覧ページを取得中...');
  const html = await fetchHtml(`${BASE_URL}/girls`);

  // /girls/{id} へのリンクを抽出
  const linkRe = /href="\/girls\/(\d+)"/g;
  const ids = new Set();
  let m;
  while ((m = linkRe.exec(html)) !== null) ids.add(m[1]);

  console.log(`  → ${ids.size}件 の女の子ページを検出`);
  return [...ids].sort((a, b) => parseInt(a) - parseInt(b));
}

// ============================================================
// Step 2: 詳細ページから各自データを取得
// ============================================================
async function fetchGirlDetail(id) {
  const html = await fetchHtml(`${BASE_URL}/girls/${id}`);

  // --- 名前 ---
  // <h1 class="...">名前</h1> or title タグ
  let name = html.match(/<h1[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)</i)?.[1]?.trim()
          ?? html.match(/<title>([^<（]+)/i)?.[1]?.replace(/admi.*/i,'').trim()
          ?? `ID${id}`;
  name = name.replace(/[|｜].*$/, '').replace(/（.*）.*$/, '').replace(/\s+/g, '').trim();

  // --- スペック ---
  const age    = html.match(/(\d+)歳/)?.[1] ?? html.match(/age[^\d]*(\d+)/i)?.[1] ?? '';
  const height = html.match(/T\s*(\d{2,3})/)?.[1] ?? html.match(/身長[^\d]*(\d{2,3})/)?.[1] ?? '';
  const bust   = html.match(/B\s*(\d{2,3})/)?.[1] ?? '';
  const cup    = html.match(/\(([A-Z]{1,2})\)/)?.[1] ?? html.match(/カップ[^\w]*([A-Z]{1,2})/)?.[1] ?? '';
  const waist  = html.match(/W\s*(\d{2,3})/)?.[1] ?? '';
  const hip    = html.match(/H\s*(\d{2,3})/)?.[1] ?? '';

  // --- 新人フラグ ---
  const is_newgirl = /NEW|新人|体験入店/i.test(html) ? 1 : 0;

  // --- キャッチコピー ---
  let catch_copy = html.match(/<p[^>]*class="[^"]*catch[^"]*"[^>]*>([^<]+)</i)?.[1]?.trim()
                ?? html.match(/class="catch"[^>]*>([^<]+)/i)?.[1]?.trim()
                ?? '';
  catch_copy = stripTags(catch_copy).slice(0, 160);

  // --- S3画像URL ---
  const s3Re = /https:\/\/s3[^"'\s]+\.jpg/gi;
  const imgs = [...new Set(html.match(s3Re) ?? [])].slice(0, 3);

  return { id, name, age, height, bust, cup, waist, hip, is_newgirl, catch_copy, imgs };
}

// ============================================================
// Step 3: 画像をダウンロードして {名前}_{n}.jpg に保存
// ============================================================
async function downloadGirlImages(girl) {
  const saved = [];
  for (let i = 0; i < girl.imgs.length; i++) {
    const url  = girl.imgs[i];
    const dest = path.join(IMG_DIR, `${girl.name}_${i + 1}.jpg`);
    const ok   = await downloadImage(url, dest);
    if (ok) saved.push(dest);
    await sleep(100);
  }
  return saved.length;
}

// ============================================================
// CSV 出力
// ============================================================
function writeCsv(girls) {
  const headers = ['name','age','height','bust','cup','waist','hip','catch_copy','is_display','is_newgirl','sort'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    '﻿' + headers.join(','),
    ...girls.map((g, i) =>
      [g.name, g.age, g.height, g.bust, g.cup, g.waist, g.hip,
       g.catch_copy, 1, g.is_newgirl, i].map(esc).join(',')
    )
  ];
  fs.writeFileSync(CSV_PATH, lines.join('\r\n'), 'utf8');
  console.log(`\n📄 CSV出力: ${CSV_PATH} (${girls.length}行)`);
}

// ============================================================
// メイン
// ============================================================
async function main() {
  console.log('🚀 admi2888.com スクレイパー 開始\n');

  const ids = await fetchGirlList();

  const girls = [];
  let done = 0;

  // 並列処理（CONCURRENCY件ずつ）
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(id => fetchGirlDetail(id).then(async g => {
        const imgCount = await downloadGirlImages(g);
        return { ...g, imgCount };
      }))
    );

    for (const r of results) {
      done++;
      if (r.status === 'fulfilled') {
        const g = r.value;
        girls.push(g);
        console.log(`  [${done}/${ids.length}] ${g.name}（${g.age}歳）画像${g.imgCount}枚`);
      } else {
        console.warn(`  [${done}/${ids.length}] ⚠ エラー: ${r.reason?.message}`);
      }
    }
    await sleep(DELAY_MS);
  }

  writeCsv(girls);

  console.log('\n✅ 完了');
  console.log(`  出力ディレクトリ: ${OUT_DIR}`);
  console.log(`  CSV: ${girls.length}件`);
  console.log(`  画像: ${fs.readdirSync(IMG_DIR).length}枚`);
  console.log('\n次のステップ:');
  console.log('  1. scripts/admi-export/girls.csv を確認・編集');
  console.log('  2. scripts/admi-export/画像/ フォルダと girls.csv を ZIP圧縮');
  console.log('  3. kichifu.com/admin/girls-import.php からアップロード');
}

main().catch(e => { console.error(e); process.exit(1); });
