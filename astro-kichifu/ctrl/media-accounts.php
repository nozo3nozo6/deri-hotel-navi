<?php
// ==========================================================================
// media-accounts.php — 媒体ログインID/パスワード管理（owner専用）
//   各媒体（情報局/駅ちか/ヘブン/風じゃ/デリじゃ/フーコレ/マンゾク/メンズバ）×店舗（立川/吉祥寺）の
//   ログイン情報を DB(media_credentials) で管理。bot は api/media-credentials.php 経由で取得し、
//   config.php の値を上書きする（＝パスワード変更はこの画面だけで完結・ターミナル不要）。
//   空欄 = bot は config.php の既存値を使う（削除ではない）。
// ==========================================================================
require_once __DIR__ . '/_lib.php';
$admin = require_login();
if (!empty($admin['shop_id'])) {   // staff(自店舗固定)は不可。owner(全店)のみ
    http_response_code(403);
    layout_header('媒体アカウント', 'media-accounts.php');
    echo '<div class="card card-pad">この画面はオーナーのみ利用できます。</div>';
    layout_footer();
    exit;
}

// テーブル自動作成（初回）
db()->exec('CREATE TABLE IF NOT EXISTS media_credentials (
    shop_id INT NOT NULL,
    media VARCHAR(32) NOT NULL,
    username VARCHAR(190) NOT NULL DEFAULT "",
    password VARCHAR(190) NOT NULL DEFAULT "",
    shop_key VARCHAR(190) NOT NULL DEFAULT "",
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (shop_id, media)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');

$MEDIA = [
    'fujoho'   => '情報局',
    'ekichika' => '駅ちか',
    'heaven'   => 'ヘブン',
    'fuzoku'   => '風じゃ',
    'deli'     => 'デリじゃ',
    'fucolle'  => 'フーコレ',
    'manzoku'  => 'マンゾク',
    'mensv'    => 'メンズバ',
];
$SHOPS = [1 => '立川', 2 => '吉祥寺'];

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $up = db()->prepare('INSERT INTO media_credentials (shop_id, media, username, password, shop_key) VALUES (?,?,?,?,?)
                         ON DUPLICATE KEY UPDATE username=VALUES(username), password=VALUES(password), shop_key=VALUES(shop_key)');
    $n = 0;
    foreach ((array)($_POST['cred'] ?? []) as $sid => $medias) {
        $sid = (int)$sid;
        if (!isset($SHOPS[$sid])) continue;
        foreach ((array)$medias as $mkey => $v) {
            if (!isset($MEDIA[$mkey])) continue;
            $u = trim((string)($v['username'] ?? ''));
            $p = trim((string)($v['password'] ?? ''));
            $k = trim((string)($v['shop_key'] ?? ''));
            $up->execute([$sid, $mkey, $u, $p, $k]);
            $n++;
        }
    }
    flash('ok', "媒体アカウントを保存しました（{$n}件）。botは数分以内の次回実行から新しい認証情報を使います。");
    redirect('media-accounts.php');
}

$rows = db()->query('SELECT shop_id, media, username, password, shop_key FROM media_credentials')->fetchAll();
$cred = [];
foreach ($rows as $r) $cred[(int)$r['shop_id']][$r['media']] = $r;

layout_header('媒体アカウント', 'media-accounts.php');
?>
<h1>🔐 媒体アカウント（ログインID / パスワード）</h1>
<p class="muted" style="margin-top:-6px">
  各媒体の管理画面ログイン情報です。<strong>パスワードを変更したらここを更新するだけ</strong>で、botが自動で新しい認証情報を使います（ターミナル作業は不要）。<br>
  空欄の媒体は bot 内の既存設定を使います。<strong>店舗ID</strong>は媒体側の店舗識別子（例: 風じゃ立川=admi2888 / 吉祥寺=kitijyoujicrystal、情報局立川=57 / 吉祥寺=53179）。分からなければ空欄のままでOKです。
</p>
<form method="post">
  <?= csrf_field() ?>
  <?php foreach ($SHOPS as $sid => $sname): ?>
    <div class="card card-pad" style="margin-top:14px">
      <h2 style="margin:0 0 10px"><?= h($sname) ?></h2>
      <div style="overflow-x:auto">
      <table class="table" style="min-width:680px">
        <thead><tr><th style="width:110px">媒体</th><th>ログインID</th><th>パスワード</th><th style="width:180px">店舗ID（任意）</th></tr></thead>
        <tbody>
        <?php foreach ($MEDIA as $mkey => $mlabel): $c = $cred[$sid][$mkey] ?? []; ?>
          <tr>
            <td><?= h($mlabel) ?></td>
            <td><input type="text" name="cred[<?= $sid ?>][<?= $mkey ?>][username]" value="<?= h($c['username'] ?? '') ?>" autocomplete="off" style="width:100%"></td>
            <td>
              <input type="password" name="cred[<?= $sid ?>][<?= $mkey ?>][password]" value="<?= h($c['password'] ?? '') ?>" autocomplete="new-password" style="width:calc(100% - 34px)">
              <button type="button" class="pw-toggle" style="width:28px;padding:4px 2px" title="表示">👁</button>
            </td>
            <td><input type="text" name="cred[<?= $sid ?>][<?= $mkey ?>][shop_key]" value="<?= h($c['shop_key'] ?? '') ?>" autocomplete="off" style="width:100%" placeholder="空欄=既存設定"></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
      </div>
    </div>
  <?php endforeach; ?>
  <div style="margin-top:14px">
    <button type="submit" class="btn btn-primary" onclick="return confirm('媒体アカウント情報を保存します。よろしいですか？')">保存する</button>
  </div>
</form>
<script>
document.querySelectorAll('.pw-toggle').forEach(b => b.addEventListener('click', () => {
  const i = b.previousElementSibling;
  i.type = i.type === 'password' ? 'text' : 'password';
}));
</script>
<?php layout_footer(); ?>
