<?php
// ==========================================================================
// db-config.sample.php — テンプレート（このファイルはコミットOK）
//
//   本番の db-config.php は GitHub Actions デプロイ時に Secrets から自動生成され、
//   .gitignore 済み（絶対にコミットしない）。
//
//   ローカルで PHP を動かす場合のみ、このファイルを db-config.php にコピーして
//   値を埋める:
//     cp api/db-config.sample.php api/db-config.php
// ==========================================================================
define('DB_HOST', 'localhost');
define('DB_NAME', 'yobuho_kichifu');   // シンレンで作成する kichifu 専用DB
define('DB_USER', 'your_db_user');
define('DB_PASS', 'your_db_password');

// 多言語対応（お知らせ本文・女性コメント等の動的翻訳、api/translate.php が使用）。
//   Google AI Studio (https://aistudio.google.com/apikey) で発行したキーを設定。
//   未設定でもサイトは正常動作（未翻訳＝原文表示にフォールバックするのみ）。
//   deri-hotel-navi(yobuho.com) の GEMINI_API_KEY とは別物（kichifu/admiは別サーバー資産）。
// define('GEMINI_API_KEY', 'your_gemini_api_key');
