-- =============================================
-- YobuChat 訪問者向け予約注意ヒント カラム追加
-- shop_chat_status.reservation_hint: 訪問者UIに薄ピンク枠で常時表示される注意文
-- NULL/空 の場合はクライアント側デフォルト (chat-i18n.json "note.reservation") を表示
-- =============================================

ALTER TABLE shop_chat_status
    ADD COLUMN reservation_hint VARCHAR(200) NULL
        COMMENT '訪問者向け予約注意ヒント (未設定時はクライアント側デフォルト)'
        AFTER welcome_message;
