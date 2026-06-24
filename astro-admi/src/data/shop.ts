// ==========================================================================
// shop.ts — 店舗固有設定（TEL/LINE/受付時間/予約URL等を一元管理）
//   ※ TODO の値は kichifu 公式のものに差し替える
// ==========================================================================
export const SHOP = {
  brand: 'アドミ',
  brandEn: 'Admi',
  area: '吉祥寺',
  since: 2009,
  catch: '吉祥寺デリヘル',
  fullName: 'アドミ since2009 吉祥寺デリヘル & Go To FANTASY',
  tel: '090-1045-9155',
  telRaw: '09010459155',
  reception: '10:00〜翌5:00',                     // TODO: 要確認
  lineUrl: 'https://line.me/ti/p/L4-1uY6q2e',     // TODO: kichifu公式LINEに差し替え
  reserveWebUrl: '#',                              // TODO: eネット予約URL等に差し替え
  fujohoId: '53179',
};

const FID = SHOP.fujohoId;
export const FUJOHO = {
  shop:     `https://fujoho.jp/index.php?p=shop&id=${FID}`,
  schedule: `https://fujoho.jp/index.php?p=shop_info&id=${FID}&h=ON`,
  diary:    `https://fujoho.jp/index.php?p=shop_girl_blog_list&id=${FID}`,
  good:     `https://fujoho.jp/index.php?p=shop_girl_good_list&id=${FID}&od=1`,
  notime:   `https://fujoho.jp/index.php?p=shop_info_notime_girl&id=${FID}`,
};

export type NavItem = { label: string; ruby: string; href: string; external?: boolean };

export const NAV: NavItem[] = [
  { label: 'トップ',       ruby: 'top',      href: '/top' },
  { label: '女の子一覧',   ruby: 'girls',    href: '/girls' },
  { label: 'スケジュール', ruby: 'schedule', href: FUJOHO.schedule, external: true },
  { label: '料金システム', ruby: 'system',   href: '/system' },
  { label: 'ご利用ガイド', ruby: 'guide',    href: '/howto' },
  { label: 'お知らせ',     ruby: 'news',     href: '/news' },
  { label: '写メ日記',     ruby: 'diary',    href: FUJOHO.diary, external: true },
  { label: 'お問合せ',     ruby: 'contact',  href: '/contacts' },
];

// 予約手段（予約モーダル用）
export const RESERVE = [
  { kind: 'line', label: 'LINEで予約', href: SHOP.lineUrl,
    note: 'LINEでかんたん予約♪ 当日予約はLINEがおすすめ！' },
  { kind: 'tel',  label: 'TELで予約',  href: `tel:${SHOP.telRaw}`,
    note: '明るく優しいスタッフが対応！ お気軽にどうぞ。' },
  { kind: 'web',  label: 'WEBで予約',  href: SHOP.reserveWebUrl,
    note: 'オンラインでかんたん予約♪ ネット予約が開きます。' },
];
