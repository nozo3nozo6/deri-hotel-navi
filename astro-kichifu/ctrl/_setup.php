<?php
// ==========================================================================
// _setup.php — 初回だけ動く管理者作成（admins が空の時のみ）
//   1人でも管理者がいれば自動的に無効化される（安全）。
//   利用後は削除しても良い。
// ==========================================================================
require_once __DIR__ . '/_lib.php';

try {
    $count = (int)db()->query('SELECT COUNT(*) FROM admins')->fetchColumn();
} catch (Throwable $e) {
    exit('DB に接続できません。先に DB 作成・schema.sql のインポート・db-config.php の生成（デプロイ）を完了してください。');
}
if ($count > 0) {
    exit('セットアップ済みです。/ctrl/login.php からログインしてください。');
}

$err = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $u  = trim((string)($_POST['username'] ?? ''));
    $dn = trim((string)($_POST['display_name'] ?? ''));
    $p  = (string)($_POST['password'] ?? '');
    if (mb_strlen($u) < 3)  $err = 'ユーザー名は3文字以上にしてください。';
    elseif (strlen($p) < 8) $err = 'パスワードは8文字以上にしてください。';
    else {
        db()->prepare('INSERT INTO admins (shop_id, username, password_hash, display_name, role) VALUES (NULL, ?, ?, ?, "owner")')
            ->execute([$u, password_hash($p, PASSWORD_BCRYPT), $dn ?: $u]);
        flash('ok', '管理者を作成しました。ログインしてください。');
        redirect('login.php');
    }
}
?><!doctype html>
<html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>初回セットアップ | <?= ADMIN_NAME ?></title>
<link rel="stylesheet" href="/ctrl/admin.css?v=1">
</head><body>
<div class="login-wrap">
  <div class="login-card">
    <h1>初回セットアップ</h1>
    <p class="sub">最初の管理者（オーナー）を作成します</p>
    <?php if ($err): ?><div class="flash flash-err"><?= h($err) ?></div><?php endif; ?>
    <form method="post" class="form-grid">
      <?= csrf_field() ?>
      <div class="field"><label>ユーザー名</label><input name="username" type="text" required autofocus></div>
      <div class="field"><label>表示名</label><input name="display_name" type="text" placeholder="運営"></div>
      <div class="field"><label>パスワード（8文字以上）</label><input name="password" type="password" required></div>
      <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">作成する</button>
    </form>
  </div>
</div>
</body></html>
