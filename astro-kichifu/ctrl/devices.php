<?php
// ==========================================================================
// devices.php — 端末とログイン
//   ・認証コードの送り先メールアドレスを設定
//   ・信頼済み端末の一覧／名前の変更／解除（紛失時の遠隔ログアウト）
//   信頼済み端末はログイン操作なしで入れるため、退職・紛失時はここで必ず解除する。
// ==========================================================================
require_once __DIR__ . '/_lib.php';
$admin = require_login();

$msg = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $act = (string)($_POST['act'] ?? '');

    if ($act === 'email') {
        $email = trim((string)($_POST['email'] ?? ''));
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            flash('err', 'メールアドレスの形式が正しくありません。');
        } else {
            db()->prepare('UPDATE admins SET email = ? WHERE id = ?')->execute([$email ?: null, $admin['id']]);
            flash('ok', $email === '' ? 'メールアドレスを削除しました。' : 'メールアドレスを保存しました。');
        }
    } elseif ($act === 'rename') {
        $id   = (int)($_POST['id'] ?? 0);
        $name = mb_substr(trim((string)($_POST['device_name'] ?? '')), 0, 60);
        if ($id > 0 && $name !== '') {
            db()->prepare('UPDATE admin_trusted_devices SET device_name = ? WHERE id = ? AND admin_id = ?')
                ->execute([$name, $id, $admin['id']]);
            flash('ok', '端末の名前を変更しました。');
        }
    } elseif ($act === 'revoke') {
        $id = (int)($_POST['id'] ?? 0);
        $cur = current_device((int)$admin['id']);
        db()->prepare('DELETE FROM admin_trusted_devices WHERE id = ? AND admin_id = ?')->execute([$id, $admin['id']]);
        // いま使っている端末を解除したら、この端末のCookieも消す（次回は認証コードから）
        if ($cur && (int)$cur['id'] === $id) device_cookie_clear();
        flash('ok', 'この端末の登録を解除しました。次回のログインでは認証コードが必要になります。');
    } elseif ($act === 'revoke_others') {
        $cur = current_device((int)$admin['id']);
        if ($cur) {
            db()->prepare('DELETE FROM admin_trusted_devices WHERE admin_id = ? AND id <> ?')
                ->execute([$admin['id'], $cur['id']]);
            flash('ok', 'この端末以外の登録をすべて解除しました。');
        }
    }
    redirect('devices.php');
}

$cur = current_device((int)$admin['id']);
$dq = db()->prepare('SELECT * FROM admin_trusted_devices WHERE admin_id = ? ORDER BY last_used_at DESC, id DESC');
$dq->execute([$admin['id']]);
$devices = $dq->fetchAll();

$emailRow = db()->prepare('SELECT email FROM admins WHERE id = ?');
$emailRow->execute([$admin['id']]);
$myEmail = (string)($emailRow->fetchColumn() ?: '');

/** ざっくり端末種別（一覧の目印。厳密な判定はしない） */
function device_kind(string $ua): string {
    if (preg_match('/iPhone|iPad|iPod/i', $ua)) return '📱 iOS';
    if (preg_match('/Android/i', $ua))          return '📱 Android';
    if (preg_match('/Macintosh|Mac OS X/i', $ua)) return '💻 Mac';
    if (preg_match('/Windows/i', $ua))          return '💻 Windows';
    return '🖥 その他';
}
function device_when(?string $dt): string {
    if (!$dt) return '—';
    $t = strtotime($dt);
    return date('n/j', $t) . '（' . ['日','月','火','水','木','金','土'][(int)date('w', $t)] . '）' . date(' H:i', $t);
}

layout_header('端末とログイン', 'devices.php');
?>
<style>
  .dv-note{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 16px;margin-bottom:16px;
           font-size:.86rem;line-height:1.75;color:#166534}
  .dv-note b{color:#14532d}
  .dv-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;
          padding:12px 0;border-bottom:1px solid var(--border)}
  .dv-row:last-child{border-bottom:none}
  .dv-name{font-weight:700;font-size:.98rem;color:var(--text)}
  .dv-meta{font-size:.78rem;color:var(--muted);margin-top:3px;line-height:1.6}
  .dv-cur{display:inline-block;font-size:.7rem;font-weight:700;color:#166534;background:#dcfce7;
          border-radius:20px;padding:1px 9px;margin-left:6px}
  .dv-acts{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .dv-acts input[type=text]{width:150px;padding:6px 9px;border:1px solid var(--border);border-radius:8px;font-size:.85rem}
  .dv-mini{padding:6px 12px;font-size:.8rem;border:1px solid var(--border);background:#fff;border-radius:8px;cursor:pointer;font-weight:600}
  .dv-mini.danger{border-color:var(--danger);color:var(--danger)}
  .dv-mini.danger:hover{background:var(--danger);color:#fff}
</style>

<div class="page-head"><h1>端末とログイン</h1></div>
<?= render_flash() ?>

<div class="dv-note">
  <b>登録した端末は、次に開いたときログイン操作なしで入れます。</b><br>
  初めての端末だけ、パスワードに加えてメールに届く6桁コードの入力が必要です。
  パスワードが漏れても、登録されていない端末からは入れません。<br>
  端末の有効期限は90日で、使うたびに自動で延長されます。<strong>紛失・退職のときは下の一覧から解除</strong>してください。
</div>

<div class="card card-pad" style="margin-bottom:18px">
  <h2 style="font-size:1rem;margin:0 0 10px">認証コードの送り先</h2>
  <form method="post" style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">
    <?= csrf_field() ?>
    <input type="hidden" name="act" value="email">
    <div style="flex:1;min-width:240px">
      <input type="email" name="email" value="<?= h($myEmail) ?>" placeholder="tokuyasu@example.com"
             style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px">
      <p class="field-hint" style="margin-top:6px">
        新しい端末を登録するときの6桁コードはここへ届きます。未設定だと新しい端末から入れません。
      </p>
    </div>
    <button class="btn btn-primary" type="submit">保存</button>
  </form>
</div>

<div class="card card-pad">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px">
    <h2 style="font-size:1rem;margin:0">登録済みの端末（<?= count($devices) ?>）</h2>
    <?php if (count($devices) > 1): ?>
      <form method="post" onsubmit="return confirm('この端末以外の登録をすべて解除します。よろしいですか？')">
        <?= csrf_field() ?>
        <input type="hidden" name="act" value="revoke_others">
        <button class="dv-mini danger" type="submit">この端末以外をすべて解除</button>
      </form>
    <?php endif; ?>
  </div>

  <?php if (!$devices): ?>
    <p class="muted" style="padding:18px 0">登録された端末はありません。</p>
  <?php else: ?>
    <?php foreach ($devices as $d): $isCur = $cur && (int)$cur['id'] === (int)$d['id']; ?>
      <div class="dv-row">
        <div>
          <div class="dv-name">
            <?= h($d['device_name']) ?>
            <?php if ($isCur): ?><span class="dv-cur">この端末</span><?php endif; ?>
          </div>
          <div class="dv-meta">
            <?= h(device_kind((string)$d['user_agent'])) ?>　最終利用 <?= h(device_when($d['last_used_at'])) ?>
            登録 <?= h(device_when($d['created_at'])) ?>　IP <?= h($d['last_ip'] ?: '—') ?>
            期限 <?= h(device_when($d['expires_at'])) ?>
          </div>
        </div>
        <div class="dv-acts">
          <form method="post" style="display:flex;gap:6px">
            <?= csrf_field() ?>
            <input type="hidden" name="act" value="rename">
            <input type="hidden" name="id" value="<?= (int)$d['id'] ?>">
            <input type="text" name="device_name" value="<?= h($d['device_name']) ?>" maxlength="60">
            <button class="dv-mini" type="submit">名前を変更</button>
          </form>
          <form method="post" onsubmit="return confirm('<?= h($d['device_name']) ?> の登録を解除します。よろしいですか？')">
            <?= csrf_field() ?>
            <input type="hidden" name="act" value="revoke">
            <input type="hidden" name="id" value="<?= (int)$d['id'] ?>">
            <button class="dv-mini danger" type="submit">解除</button>
          </form>
        </div>
      </div>
    <?php endforeach; ?>
  <?php endif; ?>
</div>

<?php layout_footer(); ?>
