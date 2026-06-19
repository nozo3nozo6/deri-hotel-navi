<?php
require_once __DIR__ . '/_lib.php';
$admin = require_login();
$shop  = current_shop_id();
$id    = (int)($_GET['id'] ?? 0);

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $name    = trim((string)($_POST['name'] ?? ''));
    $isBasic = isset($_POST['is_basic']) ? 1 : 0;
    if ($name === '') {
        flash('err', '項目名は必須です。');
    } else {
        $dup = db()->prepare('SELECT id FROM girl_options WHERE shop_id=? AND name=? AND id!=?');
        $dup->execute([$shop, $name, $id]);
        if ($dup->fetchColumn()) {
            flash('err', '同じ名前の項目が既にあります。');
        } else {
            db()->prepare('UPDATE girl_options SET name=?, is_basic=? WHERE id=? AND shop_id=?')
                ->execute([$name, $isBasic, $id, $shop]);
            flash('ok', '保存しました。');
            redirect('girl-options.php');
        }
    }
}

$st = db()->prepare('SELECT * FROM girl_options WHERE id=? AND shop_id=?');
$st->execute([$id, $shop]);
$o = $st->fetch();
if (!$o) { flash('err', '対象が見つかりません。'); redirect('girl-options.php'); }

layout_header('オプション編集', 'girl-options.php');
?>
<div class="page-head"><h1>オプション編集</h1><a class="btn" href="/admin/girl-options.php">← 一覧へ</a></div>
<form method="post" class="card card-pad form-grid" style="max-width:520px">
  <?= csrf_field() ?>
  <div class="field"><label>項目名 *</label><input type="text" name="name" value="<?= h($o['name']) ?>" required maxlength="80"></div>
  <label class="check"><input type="checkbox" name="is_basic" <?= (int)$o['is_basic'] ? 'checked' : '' ?>> 基本プレイ（OFFでオプションプレイ）</label>
  <div class="form-actions"><button class="btn btn-primary" type="submit">保存する</button><a class="btn" href="/admin/girl-options.php">キャンセル</a></div>
</form>
<?php layout_footer(); ?>
