<?php
// ==========================================================================
// login.php — 2段階ログイン
//   ① ユーザー名＋パスワード
//   ② この端末が未登録なら、メールに届く6桁コード＋端末の名前で「信頼済み端末」に登録
//   登録済みの端末は _lib.php の try_device_login() が黙って復帰させるので、
//   そもそもこの画面が出ない（面倒な操作は新しい端末の初回だけ）。
// ==========================================================================
require_once __DIR__ . '/_lib.php';
if (current_admin()) redirect('index.php');

const LOGIN_CODE_TTL = 600;   // 認証コードの有効期間（10分）

if (isset($_GET['reset'])) { unset($_SESSION['login_pending']); redirect('login.php'); }

$err  = '';
$step = 'password';           // password | code

// 直前にパスワードを通っていれば、コード入力の段階を表示し続ける
$pending = $_SESSION['login_pending'] ?? null;
if ($pending && (time() - ($pending['at'] ?? 0)) < LOGIN_CODE_TTL) {
    $step = 'code';
} else {
    unset($_SESSION['login_pending']);
    $pending = null;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $mode  = (string)($_POST['mode'] ?? 'password');
    $until = $_SESSION['login_until'] ?? 0;

    if ($until > time()) {
        $err = '試行回数が多すぎます。しばらくしてからお試しください。';
    } elseif ($mode === 'password') {
        $u = trim((string)($_POST['username'] ?? ''));
        $p = (string)($_POST['password'] ?? '');
        $st = db()->prepare('SELECT * FROM admins WHERE username = ?');
        $st->execute([$u]);
        $a = $st->fetch();
        if ($a && password_verify($p, $a['password_hash'])) {
            $_SESSION['login_fails'] = 0;
            // すでに信頼済みの端末なら、コードは省いてそのまま入れる
            $d = current_device((int)$a['id']);
            if ($d) {
                login_session($a);
                device_touch((int)$d['id']);
                try { db()->prepare('UPDATE admins SET last_login_at = NOW() WHERE id = ?')->execute([$a['id']]); } catch (Throwable $e) {}
                redirect('index.php');
            }
            // 未登録の端末 → 認証コードを発行してメール送信
            $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            $sent = device_send_code($a, $code);
            $_SESSION['login_pending'] = [
                'admin_id' => (int)$a['id'],
                'code'     => $code,
                'at'       => time(),
                'tries'    => 0,
                'sent'     => $sent,
                'to'       => (string)($a['email'] ?? ''),
            ];
            $step    = 'code';
            $pending = $_SESSION['login_pending'];
        } else {
            $_SESSION['login_fails'] = ($_SESSION['login_fails'] ?? 0) + 1;
            if ($_SESSION['login_fails'] >= 5) { $_SESSION['login_until'] = time() + 900; $_SESSION['login_fails'] = 0; }
            $err = 'ユーザー名またはパスワードが違います。';
        }
    } elseif ($mode === 'code' && $pending) {
        $input = preg_replace('/\D/', '', (string)($_POST['code'] ?? ''));
        $name  = (string)($_POST['device_name'] ?? '');
        $_SESSION['login_pending']['tries'] = ($pending['tries'] ?? 0) + 1;
        if ($_SESSION['login_pending']['tries'] > 5) {
            unset($_SESSION['login_pending']);
            $err  = '認証コードの入力回数が上限に達しました。最初からやり直してください。';
            $step = 'password';
        } elseif ($input !== '' && hash_equals((string)$pending['code'], $input)) {
            $st = db()->prepare('SELECT * FROM admins WHERE id = ?');
            $st->execute([(int)$pending['admin_id']]);
            $a = $st->fetch();
            if ($a) {
                unset($_SESSION['login_pending']);
                login_session($a);
                device_register((int)$a['id'], $name);
                try { db()->prepare('UPDATE admins SET last_login_at = NOW() WHERE id = ?')->execute([$a['id']]); } catch (Throwable $e) {}
                flash('ok', 'この端末を登録しました。次回からはログイン操作なしで開けます。');
                redirect('index.php');
            }
            $err  = '管理者が見つかりません。';
            $step = 'password';
        } else {
            $err = '認証コードが違います。';
        }
    }
}
?><!doctype html>
<html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ログイン | <?= ADMIN_NAME ?></title>
<link rel="icon" href="/ctrl/favicon.svg?v=<?= @filemtime(__DIR__ . '/favicon.svg') ?: '1' ?>" type="image/svg+xml">
<link rel="stylesheet" href="/ctrl/admin.css?v=<?= @filemtime(__DIR__ . '/admin.css') ?: '1' ?>">
</head><body>
<div class="login-wrap">
  <div class="login-card">
    <h1><?= ADMIN_NAME ?></h1>
    <p class="sub"><?= $step === 'code' ? 'この端末を登録します' : '管理画面にログイン' ?></p>
    <?php if ($err): ?><div class="flash flash-err"><?= h($err) ?></div><?php endif; ?>

    <?php if ($step === 'code'): ?>
      <?php if (!empty($pending['sent'])): ?>
        <div class="flash flash-ok">認証コードを <?= h($pending['to']) ?> に送りました（10分間有効）。</div>
      <?php else: ?>
        <div class="flash flash-err">
          メールを送れませんでした。管理者のメールアドレスが未登録の可能性があります。<br>
          登録済みの端末から「端末とログイン」でメールアドレスを設定してください。
        </div>
      <?php endif; ?>
      <form method="post" class="form-grid">
        <?= csrf_field() ?>
        <input type="hidden" name="mode" value="code">
        <div class="field">
          <label for="c">認証コード（6桁）</label>
          <input id="c" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"
                 maxlength="6" pattern="[0-9]*" required autofocus>
          <p class="field-hint">メールに届いた6桁の数字</p>
        </div>
        <div class="field">
          <label for="dn">この端末の名前</label>
          <input id="dn" name="device_name" type="text" maxlength="60" required
                 placeholder="例: 店舗PC / 徳安 iPhone">
          <p class="field-hint">あとで一覧に出ます。紛失時はここから解除します</p>
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">登録してログイン</button>
      </form>
      <p style="margin-top:1rem;text-align:center">
        <a href="login.php?reset=1" style="font-size:.85rem">最初からやり直す</a>
      </p>
    <?php else: ?>
      <form method="post" class="form-grid">
        <?= csrf_field() ?>
        <input type="hidden" name="mode" value="password">
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
      <p class="field-hint" style="margin-top:1rem;text-align:center;line-height:1.6">
        初めての端末では、メールに届く認証コードの入力が必要です。<br>
        一度登録した端末は、次回からログイン操作なしで開けます。
      </p>
    <?php endif; ?>
  </div>
</div>
</body></html>
