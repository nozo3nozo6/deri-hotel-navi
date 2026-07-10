// ==========================================================================
// config.ts — Astro版の店舗定数・APIベース・絵文字マップ（_inc/shop.php と同期）
//   ※ 画像(/uploads)は admi2888.com が物理的に正（kichifu側はsymlinkで同一実体）。
//     ASSET_ORIGIN=admi2888.com で全画像を admi2888 主体に統一（CTRL更新が両サイト即反映）。
//   ※ API は各サイト自身（同一オリジン＝CORS不要・ビルド独立）。
// ==========================================================================

export const ASSET_ORIGIN = 'https://admi2888.com';   // 画像/uploads の配信元（admi2888が正）
export const API_BASE = 'https://kichifu.com/api';     // データ取得元＝kichifu自身（同一オリジン）
export const SHOP_ID: number = Number(import.meta.env.PUBLIC_SHOP_ID ?? 2);

export const SHOP = {
  name: 'アドミ',
  nameEn: 'Admi',
  since: 2009,
  catch: '吉祥寺デリヘル',
  fullName: 'アドミsince2009吉祥寺デリヘル&Go To FANTASY東京吉祥寺店',  // 正式店名（広告媒体と完全一致）
  tel: '090-1045-9155',
  telRaw: '09010459155',
  reception: '10:00〜翌5:00',
  lineUrl: 'https://line.me/ti/p/L4-1uY6q2e',
  recruitUrl: 'https://kanto.qzin.jp/admi2888/?v=official',
  fujohoId: '53179',
  yobuhoUrl: '', // 吉祥寺の YobuHo 店舗URL（後日設定。空の間はホテル検索ボタン非表示）
};

const FID = SHOP.fujohoId;
export const FUJOHO = {
  shop: `https://fujoho.jp/index.php?p=shop&id=${FID}`,
  schedule: `https://fujoho.jp/index.php?p=shop_info&id=${FID}&h=ON`,
  diary: `https://fujoho.jp/index.php?p=shop_girl_blog_list&id=${FID}`,
};

// お知らせ本文の電話番号を「閲覧店舗の番号」に統一する。
//   立川(admi)と吉祥寺(kichifu)は別店舗だが、CTRLの2店舗掲載で一方が登録した本文が
//   もう一方にも反映される。本文CTAに登録店の電話が直書きされているため、表示する店舗の
//   番号へ置換しないと他店番号が出てしまう（例: 吉祥寺の記事に立川の042が残る）。
//   全店の電話(整形/raw)を当店番号に寄せる＝どちらが登録しても当店表示は当店番号になる。
const ALL_TELS = ['042-528-2888', '090-1045-9155'];      // 立川 / 吉祥寺（整形）
const ALL_TELS_RAW = ['0425282888', '09010459155'];     // 立川 / 吉祥寺（tel:用raw）
export function localizeBody(html: string): string {
  if (!html) return html;
  let s = html;
  for (const t of ALL_TELS) s = s.split(t).join(SHOP.tel);
  for (const t of ALL_TELS_RAW) s = s.split(t).join(SHOP.telRaw);
  return s;
}

// 画像パス（/uploads/...）をシンレン配信のフルURLにする
export function asset(path: string | null | undefined): string {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return ASSET_ORIGIN + (path.startsWith('/') ? path : '/' + path);
}

// リンクURLの正規化: 自サイト(admi2888.com / kichifu.com)への絶対URLは相対パス化し、
//   常に「閲覧中のサイト内」に留める。CTRLで別ドメインの絶対URLが入っても、2店舗共有データでも、
//   admi→kichifu / kichifu→admi のクロスサイト遷移を防ぐ。外部URL(ranking-deli等)はそのまま。
export function localUrl(u: string | null | undefined): string {
  if (!u) return '';
  const rel = u.replace(/^https?:\/\/(www\.)?(admi2888\.com|kichifu\.com)(?=\/|$)/i, '');
  return rel === '' ? '/' : rel;
}

// 特徴タグ名 → 絵文字アイコン（_inc/shop.php tag_emoji と同期）
const TAG_EMOJI: Record<string, string> = {
  'オススメ': '⭐', '素人': '🔰', '未経験': '🌱', '可愛い系': '🎀',
  '綺麗系': '💎', 'お嬢様': '👑', '女子大生': '🎓', 'OL系': '🏢',
  'セクシー': '💋', '清楚': '🪷', '癒し': '🍵', 'ギャル系': '💄',
  'モデル系': '💃', 'ロリ系': '🍭', 'グラマー': '🍑', 'スレンダー': '🦩',
  '美乳': '🍒', '美脚': '👠', '巨乳': '🍈', '色白': '🌙',
  '愛嬌抜群': '😊', 'イチャイチャ系': '💕', 'テクニシャン': '✨', '痴女': '😈',
  'サービス抜群': '🎁', '敏感': '⚡', '濃厚サービス': '🍯', '天然': '🍀',
  'おっとり': '🌷',
};
export function tagEmoji(name: string): string {
  return TAG_EMOJI[name] ?? '♡';
}

// 「新人」判定: 入店日(in_date)が3ヶ月未満なら新人（ビルド時基準）。
// is_newgirl 手動フラグではなく入店日で全ページ統一する。
export function isNewcomer(inDate?: string | null): boolean {
  if (!inDate) return false;
  const cut = new Date();
  cut.setMonth(cut.getMonth() - 3);
  const cutStr = cut.toISOString().slice(0, 10); // 3ヶ月前 YYYY-MM-DD
  return inDate.slice(0, 10) >= cutStr;          // YYYY-MM-DD は辞書順=日付順
}
