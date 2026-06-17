<?php
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_upload.php';
require_login();
$shop = current_shop_id();
$id = (int)($_GET['id'] ?? 0);

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $cur = null;
    if ($id) { $s = db()->prepare('SELECT * FROM banners WHERE id=? AND shop_id=?'); $s->execute([$id, $shop]); $cur = $s->fetch(); }
    $image = $cur['image'] ?? '';
    if (!empty($_POST['remove_image'])) { delete_upload($image); $image = ''; }
    if (($_FILES['image']['error'] ?? 4) === UPLOAD_ERR_OK) { $new = save_upload($_FILES['image'], 'banners/' . $shop, 1200, 1200); if ($new) { delete_upload($image); $image = $new; } }
    $data = [
        'shop_id' => $shop,
        'type' => ($_POST['type'] ?? 'top') === 'bottom' ? 'bottom' : 'top',
        'title' => trim((string)($_POST['title'] ?? '')),
        'url' => trim((string)($_POST['url'] ?? '')),
        'image' => $image,
        'is_display' => isset($_POST['is_display']) ? 1 : 0,
    ];
    try {
        if ($id && $cur) {
            $set = implode(',', array_map(fn($k) => "$k=:$k", array_keys($data)));
            db()->prepare("UPDATE banners SET $set WHERE id=:id")->execute($data + ['id' => $id]);
        } else {
            $m = db()->prepare('SELECT COALESCE(MAX(sort),0)+1 FROM banners WHERE shop_id=? AND type=?'); $m->execute([$shop, $data['type']]);
            $data['sort'] = (int)$m->fetchColumn();
            $cols = implode(',', array_keys($data)); $ph = implode(',', array_map(fn($k) => ":$k", array_keys($data)));
            db()->prepare("INSERT INTO banners ($cols) VALUES ($ph)")->execute($data);
        }
        flash('ok', '保存しました。');
        redirect('banners.php?type=' . $data['type']);
    } catch (Throwable $e) { flash('err', '保存に失敗しました。'); }
}

$b = ['type' => ($_GET['type'] ?? 'top'), 'title' => '', 'url' => '', 'image' => '', 'is_display' => 1];
if ($id) { $s = db()->prepare('SELECT * FROM banners WHERE id=? AND shop_id=?'); $s->execute([$id, $shop]); $b = $s->fetch(); if (!$b) { flash('err', '対象が見つかりません。'); redirect('banners.php'); } }

layout_header($id ? 'バナーを編集' : 'バナーを作成', 'banners.php');
?>
<div class="page-head"><h1><?= $id ? 'バナーを編集' : 'バナーを作成' ?></h1><a class="btn" href="/admin/banners.php">← 一覧へ</a></div>
<form method="post" enctype="multipart/form-data" class="form-grid" style="max-width:680px">
  <?= csrf_field() ?>
  <div class="card card-pad form-grid">
    <div class="field"><label>表示位置</label>
      <select name="type"><option value="top" <?= $b['type'] === 'top' ? 'selected' : '' ?>>上部</option><option value="bottom" <?= $b['type'] === 'bottom' ? 'selected' : '' ?>>下部</option></select>
    </div>
    <div class="field"><label>タイトル</label><input type="text" name="title" value="<?= h($b['title']) ?>"></div>
    <div class="field"><label>リンクURL</label><input type="text" name="url" value="<?= h($b['url']) ?>" placeholder="/system や https://..."></div>
    <div class="field"><label>画像</label>
      <?php if ($b['image']): ?><div style="margin-bottom:8px"><img src="<?= h($b['image']) ?>" style="max-width:240px;border-radius:8px"><br><label class="check" style="margin-top:6px"><input type="checkbox" name="remove_image"> 画像を削除</label></div><?php endif; ?>
      <input type="file" name="image" accept="image/*">
    </div>
    <label class="check"><input type="checkbox" name="is_display" <?= (int)$b['is_display'] ? 'checked' : '' ?>> サイトに表示</label>
  </div>
  <div class="form-actions"><button class="btn btn-primary" type="submit">保存する</button><a class="btn" href="/admin/banners.php">キャンセル</a></div>
</form>
<?php layout_footer(); ?>
