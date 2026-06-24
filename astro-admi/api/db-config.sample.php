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
