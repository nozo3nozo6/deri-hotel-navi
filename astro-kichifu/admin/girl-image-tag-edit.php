<?php
require_once __DIR__ . '/_lib.php';
$admin = require_login();
$shop  = current_shop_id();
$id    = (int)($_GET['id'] ?? 0);

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $name     = trim((string)($_POST['name'] ?? ''));
    $isActive = isset($_POST['is_active']) ? 1 : 0;
    if ($name === '') {
        flash('err', 'タグ名は必須です。');
    } else {
        $dup = db()->prepare('SELECT id FROM girl_image_tags WHERE shop_id=? AND name=? AND id!=?');
        $dup->execute([$shop, $name, $id]);
        if ($dup->fetchColumn()) {
            flash('err', '同じ名前のタグが既にあります。');
        } else {
            db()->prepare('UPDATE girl_image_tags SET name=?, is_active=? WHERE id=? AND shop_id=?')
                ->execute([$name, $isActive, $id, $shop]);
            flash('ok', '保存しました。');
            redirect('girl-image-tags.php');
        }
    }
}

$st = db()->prepare('SELECT * FROM girl_image_tags WHERE id=? AND shop_id=?');
$st->execute([$id, $shop]);
$t = $st->fetch();
if (!$t) { flash('err', '対象が見つかりません。'); redirect('girl-image-tags.php'); }

layout_header('特徴タグ編集', 'girl-image-tags.php');
?>
<div class="page-head"><h1>特徴タグ編集</h1><a class="btn" href="/admin/girl-image-tags.php">← 一覧へ</a></div>
<form method="post" class="card card-pad form-grid" style="max-width:520px">
  <?= csrf_field() ?>
  <div class="field"><label>タグ名 *</label><input type="text" name="name" value="<?= h($t['name']) ?>" required maxlength="40"></div>
  <label class="check"><input type="checkbox" name="is_active" <?= (int)$t['is_active'] ? 'checked' : '' ?>> サイトに表示（OFFで選択肢に出ません）</label>
  <div class="form-actions"><button class="btn btn-primary" type="submit">保存する</button><a class="btn" href="/admin/girl-image-tags.php">キャンセル</a></div>
</form>
<?php layout_footer(); ?>
