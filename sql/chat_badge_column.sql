-- YobuHo掲載店バッジ（埋込チャット下のSEO被リンクバッジ）表示フラグ
-- chat-embed.js が badge-info API で参照。デフォルトON、shop-admin の YobuChat タブからOFF可
-- 2026-06-11 適用済み
ALTER TABLE shop_chat_status ADD COLUMN show_badge TINYINT(1) NOT NULL DEFAULT 1;
