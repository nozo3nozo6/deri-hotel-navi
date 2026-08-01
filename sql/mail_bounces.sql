-- ============================================================================
-- mail_bounces — メール配信失敗（バウンス）の記録
--
-- 背景 (2026-08-01):
--   hotel@yobuho.com 宛に届くバウンス通知を誰も見ておらず、iCloud への配信が
--   6/8 から約2ヶ月間止まっていたことに気づけなかった。
--   api/scan-bounces.php が定期的にメールボックスを解析してここに記録し、
--   admin.html の「📥 未対応」タブに未確認バウンスとして表示する。
--
-- 注意: source_file に UNIQUE を張って同じバウンスメールの二重登録を防ぐ。
--       （scan-bounces.php はメールボックスのファイルを削除も移動もしないため、
--         毎回同じファイルを読むことになる。冪等性はこの制約で担保する）
-- ============================================================================

CREATE TABLE IF NOT EXISTS mail_bounces (
    id              INT AUTO_INCREMENT PRIMARY KEY,

    -- 配信できなかった宛先
    recipient       VARCHAR(255)  NOT NULL,

    -- 5.7.1 / 5.1.1 など。先頭が 5 = 恒久的失敗、4 = 一時的失敗
    status_code     VARCHAR(16)   DEFAULT NULL,

    -- 受信側MTAが返した診断メッセージ全文（例: 554 5.7.1 [HM08] ...）
    diagnostic      TEXT          DEFAULT NULL,

    -- 元メールの件名（どの機能のメールが失敗したか判別するため）
    orig_subject    VARCHAR(512)  DEFAULT NULL,

    -- バウンス通知メールの発生日時（メールの Date ヘッダ由来）
    bounced_at      DATETIME      DEFAULT NULL,

    -- 二重登録防止キー（maildir のファイル名）
    source_file     VARCHAR(255)  NOT NULL,

    -- 管理者が確認済みにしたら 1
    resolved        TINYINT(1)    NOT NULL DEFAULT 0,
    resolved_at     DATETIME      DEFAULT NULL,

    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uk_source_file (source_file),
    KEY idx_resolved_bounced (resolved, bounced_at),
    KEY idx_recipient (recipient)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
