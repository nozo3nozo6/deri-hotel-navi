<?php
require_once __DIR__ . '/_lib.php';
$admin = require_login();
$shop  = current_shop_id();
$id    = (int)($_GET['id'] ?? 0);

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $name = trim((string)($_POST['name'] ?? ''));
    if ($name === '') {
        flash('err', 'カテゴリー名は必須です。');
    } else {
        $dup = db()->prepare('SELECT id FROM girl_categories WHERE shop_id=? AND name=? AND id!=?');
        $dup->execute([$shop, $name, $id]);
        if ($dup->fetchColumn()) {
            flash('err', '同じ名前のカテゴリーが既にあります。');
        } else {
            db()->prepare('UPDATE girl_categories SET name=? WHERE id=? AND shop_id=?')->execute([$name, $id, $shop]);
            flash('ok', '保存しました。');
            redirect('girl-categories.php');
        }
    }
}

$st = db()->prepare('SELECT * FROM girl_categories WHERE id=? AND shop_id=?');
$st->execute([$id, $shop]);
$c = $st->fetch();
if (!$c) { flash('err', '対象が見つかりません。'); redirect('girl-categories.php'); }

layout_header('カテゴリー編集', 'girl-categories.php');
?>
<div class="page-head"><h1>カテゴリー編集</h1><a class="btn" href="/ctrl/girl-categories.php">← 一覧へ</a></div>
<form method="post" class="card card-pad form-grid" style="max-width:520px">
  <?= csrf_field() ?>
  <div class="field"><label>カテゴリー名 *</label><input type="text" name="name" value="<?= h($c['name']) ?>" required maxlength="80"></div>
  <div class="form-actions"><button class="btn btn-primary" type="submit">保存する</button><a class="btn" href="/ctrl/girl-categories.php">キャンセル</a></div>
</form>
<?php layout_footer(); ?>
