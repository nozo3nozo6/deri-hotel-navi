-- =============================================
-- YobuChat 訪問者ウェルカムメッセージ カラム追加
-- shop_chat_status.welcome_message: チャット画面で訪問者に表示するノート文
-- NULL/空 の場合はクライアント側でデフォルト文を表示
-- =============================================

ALTER TABLE shop_chat_status
    ADD COLUMN welcome_message VARCHAR(200) NULL
        COMMENT '訪問者向けウェルカムメッセージ (未設定時はクライアント側デフォルト)'
        AFTER reception_end;
