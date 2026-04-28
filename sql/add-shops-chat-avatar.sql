-- shops.chat_avatar_url: チャット表示専用のプロフィール画像 (data URL JPEG, 96x96)
-- thumbnail_url (リッチ/スタンダード広告由来) と独立管理し、YobuChatのアバターは
-- chat_avatar_url を優先, NULL なら thumbnail_url にフォールバック.
ALTER TABLE shops
  ADD COLUMN chat_avatar_url MEDIUMTEXT NULL AFTER thumbnail_url;
