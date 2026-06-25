<?php
require_once __DIR__ . '/_lib.php';
if (current_admin()) redirect('index.php');

$err = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $until = $_SESSION['login_until'] ?? 0;
    if ($until > time()) {
        $err = '試行回数が多すぎます。しばらくしてからお試しください。';
    } else {
        $u = trim((string)($_POST['username'] ?? ''));
        $p = (string)($_POST['password'] ?? '');
        $st = db()->prepare('SELECT * FROM admins WHERE username = ?');
        $st->execute([$u]);
        $a = $st->fetch();
        if ($a && password_verify($p, $a['password_hash'])) {
            $_SESSION['login_fails'] = 0;
            login_session($a);
            try { db()->prepare('UPDATE admins SET last_login_at = NOW() WHERE id = ?')->execute([$a['id']]); } catch (Throwable $e) {}
            redirect('index.php');
        }
        $_SESSION['login_fails'] = ($_SESSION['login_fails'] ?? 0) + 1;
        if ($_SESSION['login_fails'] >= 5) { $_SESSION['login_until'] = time() + 900; $_SESSION['login_fails'] = 0; }
        $err = 'ユーザー名またはパスワードが違います。';
    }
}
?><!doctype html>
<html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ログイン | <?= ADMIN_NAME ?></title>
<link rel="stylesheet" href="/ctrl/admin.css?v=<?= @filemtime(__DIR__ . '/admin.css') ?: '1' ?>">
</head><body>
<div class="login-wrap">
  <div class="login-card">
    <h1><?= ADMIN_NAME ?></h1>
    <p class="sub">管理画面にログイン</p>
    <?php if ($err): ?><div class="flash flash-err"><?= h($err) ?></div><?php endif; ?>
    <form method="post" class="form-grid">
      <?= csrf_field() ?>
      <div class="field">
        <label for="u">ユーザー名</label>
        <input id="u" name="username" type="text" autocomplete="username" required autofocus>
        <p class="field-hint">半角英数字で入力してください</p>
      </div>
      <div class="field">
        <label for="p">パスワード</label>
        <input id="p" name="password" type="password" autocomplete="current-password" required>
        <p class="field-hint">半角英数字・記号（8文字以上）</p>
      </div>
      <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">ログイン</button>
    </form>
  </div>
</div>
</body></html>
