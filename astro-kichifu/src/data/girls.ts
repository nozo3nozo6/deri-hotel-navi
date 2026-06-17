// ==========================================================================
// girls.ts — 女の子データ（暫定: サンプル。将来は CMS + MySQL に置き換え）
//   photo 未設定は /img/placeholder.svg を表示
// ==========================================================================
export type Girl = {
  id: number;
  name: string;
  age: number;
  height: number; // T
  bust: number;   // B
  cup: string;    // カップ
  waist: number;  // W
  hip: number;    // H
  photo?: string;
  isNew?: boolean;
  tags?: string[]; // 待ち合わせ / インバウンド / ジェンダーレス / 電話 など
  catch?: string;
};

export const GIRLS: Girl[] = [
  { id: 257, name: 'ことね', age: 23, height: 163, bust: 87, cup: 'E', waist: 56, hip: 86, isNew: true, tags: ['待ち合わせ', 'インバウンド', 'ジェンダーレス', '電話'], catch: '清楚系スレンダー美少女' },
  { id: 256, name: 'なほ',   age: 28, height: 161, bust: 83, cup: 'B', waist: 57, hip: 86, isNew: true, tags: ['待ち合わせ', '電話'], catch: '癒やしの大人お姉さん' },
  { id: 255, name: 'まどか', age: 23, height: 164, bust: 84, cup: 'C', waist: 55, hip: 86, isNew: true, tags: ['待ち合わせ', 'インバウンド'], catch: 'モデル系スタイル抜群' },
  { id: 254, name: 'めい',   age: 18, height: 150, bust: 89, cup: 'F', waist: 62, hip: 90, isNew: true, tags: ['待ち合わせ', '電話'], catch: '小柄ロリ系の最新美少女' },
  { id: 252, name: 'ゆい',   age: 22, height: 152, bust: 87, cup: 'E', waist: 55, hip: 85, isNew: true, tags: ['待ち合わせ', 'ジェンダーレス'], catch: 'ピュア＆敏感体質' },
  { id: 251, name: 'あおい', age: 25, height: 160, bust: 85, cup: 'D', waist: 55, hip: 84, tags: ['待ち合わせ', '電話'], catch: '愛嬌たっぷり甘え上手' },
  { id: 249, name: 'ひなた', age: 28, height: 153, bust: 98, cup: 'H', waist: 57, hip: 85, tags: ['待ち合わせ', 'インバウンド'], catch: '圧巻のH美乳' },
  { id: 247, name: 'みなみ', age: 29, height: 157, bust: 83, cup: 'B', waist: 55, hip: 84, tags: ['待ち合わせ', '電話'], catch: 'スレンダー美脚お姉さん' },
];
