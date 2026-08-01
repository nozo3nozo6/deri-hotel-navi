<?php
// db-bridge.php — admi 共有DB設定(定数)を ylka 形式(連想配列)へ橋渡し
//   ops/api の db.php が読む。秘密は public_html/api/db-config.php にのみ存在。
require_once __DIR__ . '/../../../api/db-config.php';
return ['host' => DB_HOST, 'database' => DB_NAME, 'user' => DB_USER, 'password' => DB_PASS];
