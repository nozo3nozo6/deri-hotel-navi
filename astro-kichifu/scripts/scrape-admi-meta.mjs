/**
 * scrape-admi-meta.mjs
 * admi2888.com/girls の全124人について「特徴タグ / 店舗コメント / 女の子に質問 /
 * 基本プレイ / オプションプレイ」を取得して JSON に出力する（画像は roster.mjs 管轄）。
 *
 * 取得元（写真と同じ2系統）:
 *   - 内部21人: admi公開ページ /girls/{id}
 *       girlsIcon(特徴タグ) / commentBase(店舗コメント) / girlsDtlQA(質問) /
 *       playBase×2(基本プレイ・オプションプレイ, li.ok のみ採用)
 *   - 外部103人: ranking-deli.jp/.../{rankingId}/
 *       girl-genre + girl-tag(特徴タグ) / shopmessage-body(店舗コメント) /
 *       qa(質問) / 可能オプション(→オプションプレイ)。基本プレイは標準8項目を付与。
 *
 * 出力: scripts/admi-roster-export/girls-meta.json
 *   [{ name, sort, isInternal, tags[], shop_comment, profiles[{q,a}], basic_play[], option_play[] }]
 *   sort は roster.mjs と同一採番（外部=100+出現index, 内部=出現index）。
 *   import 側は name で照合（同名 こはる/みやび は外部のみ→ sort で区別）。
 *
 * 使い方: node scripts/scrape-admi-meta.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = path.join(__dirname, 'admi-roster-export');
const OUT_PATH  = path.join(OUT_DIR, 'girls-meta.json');
const BASE_URL  = 'https://admi2888.com';

fs.mkdirSync(OUT_DIR, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- admi 女性イメージ 29種（これに一致するタグだけ採用） ----
const TAG_MASTER = new Set(['オススメ','素人','未経験','可愛い系','綺麗系','お嬢様','女子大生','OL系',
  'セクシー','清楚','癒し','ギャル系','モデル系','ロリ系','グラマー','スレンダー','美乳','美脚','巨乳',
  '色白','愛嬌抜群','イチャイチャ系','テクニシャン','痴女','サービス抜群','敏感','濃厚サービス','天然','おっとり']);
const TAG_ALIAS = { '癒し系': '癒し', '癒やし': '癒し', '癒やし系': '癒し' };

// ---- オプション名 ranking-deli → admiマスタ ----
const OPT_ALIAS = { 'SMプレイ': 'SMコース', 'SM': 'SMコース' };
// 外部(ranking-deli)に基本プレイ表記が無いため付与する標準サービス
const STANDARD_BASIC = ['シャワータイム','生キス','全身リップ','玉舐め','生フェラ','指入れ','素股(発射OK)','口内発射'];

async function fetchHtml(url) {
  const res = await fetch(url, { headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; AdmiMigration/1.0)',
    'Accept': 'text/html,application/xhtml+xml',
  }});
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

const nfkc      = s => (s ?? '').normalize('NFKC').replace(/ /g, ' ').trim();
const stripTags = s => (s ?? '').replace(/<[^>]+>/g, '').trim();
const decode    = s => (s ?? '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#x[0-9a-f]+;|&#\d+;/gi, '');

function normTags(arr) {
  const out = [];
  for (let t of arr) {
    t = nfkc(t);
    t = TAG_ALIAS[t] ?? t;
    if (TAG_MASTER.has(t) && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 8);
}

function normOption(name) {
  name = nfkc(name).replace(/\s+/g, '');
  return OPT_ALIAS[name] ?? name;
}

// <div class="X"> の対応する閉じ </div> までの中身を深さカウントで抽出（ネスト対応）
function extractDivContent(html, openTag) {
  const start = html.indexOf(openTag);
  if (start < 0) return null;
  let i = start + openTag.length;
  const contentStart = i;
  let depth = 1;
  while (i < html.length && depth > 0) {
    const o = html.indexOf('<div', i);
    const c = html.indexOf('</div>', i);
    if (c < 0) break;
    if (o >= 0 && o < c) { depth++; i = o + 4; }
    else { depth--; if (depth === 0) return html.slice(contentStart, c); i = c + 6; }
  }
  return html.slice(contentStart, i);
}

// 店舗/女の子コメントは HTMLウィジェット。原文HTMLを保持（ウィジェット本体だけ抽出、script除去）。
function extractCommentHtml(html) {
  if (!html) return '';
  // 1) 「ここからコピー」マーカーがあればウィジェット本体（admiのpremium-card等）
  const copy = html.match(/<!--\s*ここからコピー\s*-->([\s\S]*?)<!--\s*ここまでコピー\s*-->/);
  let h;
  if (copy) {
    h = copy[1];
  } else {
    // 2) ckeditor / commentBase の中身を深さカウントで抽出（後続のページ構造HTMLを巻き込まない）
    h = extractDivContent(html, '<div class="ckeditor">')
      ?? extractDivContent(html, '<div class="commentBase">')
      ?? html;
  }
  return h
    .replace(/<!--[\s\S]*?-->/g, '')                // HTMLコメント
    .replace(/<script[\s\S]*?<\/script>/gi, '')     // scriptは安全のため除去
    .trim();
}

// ---- 一覧パース（roster.mjs と同一ロジック）----
function parseList(html) {
  const ulStart = html.indexOf('<ul class="align-items-start');
  const ulEnd   = html.indexOf('</ul>', ulStart);
  const section = ulStart >= 0 ? html.slice(ulStart, ulEnd) : html;
  const cards = [];
  const liRe = /<li class="([^"]*)">([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(section)) !== null) {
    const cls = m[1], chunk = m[2];
    const href = chunk.match(/<a href="([^"]+)"/i)?.[1] ?? '';
    const name = chunk.match(/<p class="name">([^<]+)</i)?.[1]?.trim() ?? '';
    if (!name || !href) continue;
    const isInternal = /\/girls\/\d+/.test(href);
    const rankingId  = href.match(/ranking-deli\.jp\/\d+\/shop\/\d+\/(\d+)/)?.[1] ?? '';
    cards.push({ name, href, isInternal, rankingId });
  }
  return cards;
}

// ---- admi公開ページ詳細 ----
function parseAdmiDetail(html) {
  // 特徴タグ
  const iconBlock = html.match(/<div class="girlsIcon">([\s\S]*?)<\/div>/)?.[1] ?? '';
  const tags = normTags([...iconBlock.matchAll(/<span>([^<]+)<\/span>/g)].map(x => x[1]));

  // 店舗コメント（girlsCommentArea 〜 「女の子に質問」直前）。HTMLウィジェットを原文保持。
  const caBlock = html.match(/girlsCommentArea">([\s\S]*?)<h2 class="girlsDtlSub under">女の子に質問/)?.[1]
               ?? html.match(/girlsCommentArea">([\s\S]*?)女の子に質問/)?.[1] ?? '';
  const shop_comment = extractCommentHtml(caBlock);

  // 質問
  const qaBlock = html.match(/girlsDtlQA">([\s\S]*?)<\/ul>/)?.[1] ?? '';
  const profiles = [...qaBlock.matchAll(/<div class="question">\s*([^<]*?)\s*<\/div>\s*<div class="answer">\s*([^<]*?)\s*<\/div>/g)]
    .map(x => ({ q: nfkc(decode(x[1])), a: nfkc(decode(x[2])) }))
    .filter(p => p.q && p.a);

  // 基本プレイ / オプションプレイ（playBase ×2、li.ok のみ）
  const playBlocks = [...html.matchAll(/playBase">([\s\S]*?)<\/ul>/g)].map(x => x[1]);
  const okLis = b => b ? [...b.matchAll(/<li class="ok">([^<]+)<\/li>/g)].map(x => nfkc(decode(x[1]))) : [];
  const basic_play  = okLis(playBlocks[0]);
  const option_play = okLis(playBlocks[1]);

  return { tags, shop_comment, profiles, basic_play, option_play };
}

// ---- ranking-deli 詳細 ----
function parseRankingDeli(html) {
  // 特徴タグ（girl-genre の主要 + girl-tag の anti-base）
  const genreBlock = html.match(/<div class="girl-genre">([\s\S]*?)<div class="girl-icon"/)?.[1] ?? '';
  const genreTags  = [...genreBlock.matchAll(/girl-tag-genre">([^<]+)</g)].map(x => x[1]);
  const tagBlock   = html.match(/<div class="girl-tag">\s*<ul>([\s\S]*?)<\/ul>/)?.[1] ?? '';
  const moreTags   = [...tagBlock.matchAll(/anti-base">([^<]+)</g)].map(x => x[1]);
  const tags = normTags([...genreTags, ...moreTags]);

  // 店舗コメント（shopmessage-body の comment balloon）。HTMLウィジェットを原文保持（<br>等を残す）。
  const msg = html.match(/shopmessage-body[\s\S]*?<div class="comment balloon">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] ?? '';
  const shop_comment = extractCommentHtml(msg);

  // 質問（li.question / li.answer 交互の balloon > p）
  const qaSection = html.match(/<section class="qa[\s\S]*?<\/section>/)?.[0] ?? '';
  const qs = [...qaSection.matchAll(/<li class="question">[\s\S]*?<div class="balloon">\s*<p>([\s\S]*?)<\/p>/g)].map(x => nfkc(decode(stripTags(x[1]))));
  const as = [...qaSection.matchAll(/<li class="answer">[\s\S]*?<div class="balloon">\s*<p>([\s\S]*?)<\/p>/g)].map(x => nfkc(decode(stripTags(x[1]))));
  const profiles = qs.map((q, i) => ({ q, a: as[i] ?? '' })).filter(p => p.q && p.a);

  // 可能オプション → オプションプレイ（○ のみ）。基本プレイは標準8項目を付与。
  const optBlock = html.match(/r-option-body[\s\S]*?<ul class="basic-play[^"]*">([\s\S]*?)<\/ul>/)?.[1] ?? '';
  const optText  = decode(optBlock.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
  const option_play = optText.split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => { const mm = l.match(/^(.+?)[：:]\s*([○◯✕×△xX])/); return mm ? { name: mm[1], ok: /[○◯]/.test(mm[2]) } : null; })
    .filter(x => x && x.ok).map(x => normOption(x.name));

  return { tags, shop_comment, profiles, basic_play: [...STANDARD_BASIC], option_play };
}

async function main() {
  console.log('🚀 admi 全女の子のメタデータ（タグ/コメント/質問/プレイ）を取得\n');
  const listHtml = await fetchHtml(`${BASE_URL}/girls`);
  const cards = parseList(listHtml);
  const internal = cards.filter(c => c.isInternal);
  const external = cards.filter(c => !c.isInternal);
  console.log(`  一覧: ${cards.length}人（内部 ${internal.length} / 外部 ${external.length}）\n`);

  // sort 採番（roster.mjs 互換）
  let intIdx = 0, extIdx = 0;
  for (const c of cards) c.sort = c.isInternal ? intIdx++ : (100 + extIdx++);

  const out = [];
  let okTags = 0, okCmt = 0, okProf = 0, okOpt = 0, fail = 0;

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    try {
      const url  = c.isInternal ? (c.href.startsWith('http') ? c.href : BASE_URL + c.href) : c.href;
      const html = await fetchHtml(url);
      const meta = c.isInternal ? parseAdmiDetail(html) : parseRankingDeli(html);
      out.push({ name: c.name, sort: c.sort, isInternal: c.isInternal, ...meta });
      if (meta.tags.length) okTags++;
      if (meta.shop_comment) okCmt++;
      if (meta.profiles.length) okProf++;
      if (meta.option_play.length) okOpt++;
      console.log(`  [${i + 1}/${cards.length}] ${c.name}  タグ${meta.tags.length} 質問${meta.profiles.length} 基本${meta.basic_play.length} OP${meta.option_play.length} ${meta.shop_comment ? 'コメ有' : 'コメ無'}`);
    } catch (e) {
      fail++;
      out.push({ name: c.name, sort: c.sort, isInternal: c.isInternal, tags: [], shop_comment: '', profiles: [], basic_play: [], option_play: [], error: e.message });
      console.warn(`  [${i + 1}/${cards.length}] ⚠ ${c.name}: ${e.message}`);
    }
    await sleep(c.isInternal ? 150 : 250);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n✅ 完了 → ${OUT_PATH}`);
  console.log(`  ${out.length}人  タグ${okTags} / コメント${okCmt} / 質問${okProf} / オプション${okOpt}  失敗${fail}`);
}

main().catch(e => { console.error(e); process.exit(1); });
