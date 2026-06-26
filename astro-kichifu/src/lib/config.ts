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
  fullName: 'アドミ since2009 吉祥寺デリヘル & Go To FANTASY',
  tel: '090-1045-9155',
  telRaw: '09010459155',
  reception: '10:00〜翌5:00',
  lineUrl: 'https://line.me/ti/p/L4-1uY6q2e',
  recruitUrl: 'https://kanto.qzin.jp/admi2888/?v=official',
  fujohoId: '53179',
};

const FID = SHOP.fujohoId;
export const FUJOHO = {
  shop: `https://fujoho.jp/index.php?p=shop&id=${FID}`,
  schedule: `https://fujoho.jp/index.php?p=shop_info&id=${FID}&h=ON`,
  diary: `https://fujoho.jp/index.php?p=shop_girl_blog_list&id=${FID}`,
};

// 画像パス（/uploads/...）をシンレン配信のフルURLにする
export function asset(path: string | null | undefined): string {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return ASSET_ORIGIN + (path.startsWith('/') ? path : '/' + path);
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
