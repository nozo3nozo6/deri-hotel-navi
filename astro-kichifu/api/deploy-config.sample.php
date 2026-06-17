<?php
// =====================================================
// deploy-config.php — GitHub Actions トリガー設定
//   本ファイルはサンプル。deploy-config.php は
//   deploy-kichifu.yml が Secrets から自動生成する。
//   手動の場合: cp deploy-config.sample.php deploy-config.php
//   して値を埋める。コミット禁止（.gitignore 済み）。
// =====================================================
define('GITHUB_PAT',      '');   // repo + workflow scope の PAT
define('GITHUB_REPO',     'nozo3nozo6/deri-hotel-navi');
define('GITHUB_WORKFLOW', 'deploy-kichifu.yml');
define('GITHUB_BRANCH',   'main');
