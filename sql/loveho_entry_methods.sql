-- ラブホ口コミ「入室方法」マスタテーブル
-- 2026-05-18: 駐車場待ち合わせ / 待ち合わせ の追加に伴い、ハードコード→マスタ管理化
-- code 列を保持: loveho_reports.entry_method には英語コード (front/direct/...) が既存データとして残っているため

CREATE TABLE IF NOT EXISTS loveho_entry_methods (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE COMMENT 'loveho_reports.entry_method に保存する値',
    label VARCHAR(100) NOT NULL COMMENT '画面表示用ラベル (日本語)',
    sort_order INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 初期シード (旧ハードコード4種 + 新規2種)
INSERT IGNORE INTO loveho_entry_methods (code, label, sort_order) VALUES
    ('front',   'フロント経由(部屋番号を伝えて入室)', 1),
    ('direct',  '直接入室(お部屋に直行)',            2),
    ('lobby',   'ロビー待ち合わせ',                  3),
    ('waiting', '待合室で待ち合わせ',                4),
    ('parking', '駐車場待ち合わせ',                  5),
    ('meet',    '待ち合わせ',                        6);
