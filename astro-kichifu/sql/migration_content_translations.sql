-- 動的コンテンツ（お知らせ本文・女性コメント等）の機械翻訳キャッシュ。
--   api/translate.php が使用。yobuho.com の chat_translations と同型だが用途が異なるため別テーブル。
--   1行 = (原文言語, 訳先言語, 原文) の組み合わせにつき1訳文。src_text は長文なので UNIQUE 制約は
--   cache_key（md5ハッシュ）側に持たせる。
CREATE TABLE IF NOT EXISTS content_translations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cache_key CHAR(32) NOT NULL,
  src_lang VARCHAR(8) NOT NULL,
  dst_lang VARCHAR(8) NOT NULL,
  src_text TEXT NOT NULL,
  translated TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cache_key (cache_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
