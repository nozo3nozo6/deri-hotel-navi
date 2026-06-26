// ==========================================================================
// config.ts — admi2888.com（立川本店）Astro版の店舗定数・APIベース・絵文字マップ
//   ※ astro-kichifu からの複製。店舗定数(SHOP)を admi に差し替え済み。
//   ※ 本番(admi2888.com)＝画像/uploads・API・DB の正。画像実体は admi2888 に物理集約
//     （kichifu側は symlink で同一実体を共有）。ASSET_ORIGIN=admi2888 で全画像を admi2888 主体に。
//   ※ API は自サイト admi2888.com（同一オリジン）。SHOP_ID=1（立川・共有ロスター）。
// ==========================================================================

export const ASSET_ORIGIN = 'https://admi2888.com';    // 画像/uploads の配信元（admi2888が正）
export const API_BASE = 'https://admi2888.com/api';     // データ取得元＝admi2888自身（同一オリジン）
export const SHOP_ID = 1;

export const SHOP = {
  name: 'アドミ',
  nameEn: 'Admi',
  since: 2002,
  area: '立川',
  catch: '立川デリヘル',
  fullName: 'アドミ since2002 立川デリヘル & Go To FANTASY 東京本店',
  tel: '042-528-2888',
  telRaw: '0425282888',
  reception: '10:00〜翌5:00',
  lineUrl: 'https://line.me/ti/p/L4-1uY6q2e',
  recruitUrl: 'https://kanto.qzin.jp/admi2888/?v=official',
  fujohoId: '57',
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
