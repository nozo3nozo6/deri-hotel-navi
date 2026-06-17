<?php
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_upload.php';
require_login();
$shop = current_shop_id();
$id = (int)($_GET['id'] ?? 0);

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $cur = null;
    if ($id) { $s = db()->prepare('SELECT * FROM sliders WHERE id=? AND shop_id=?'); $s->execute([$id, $shop]); $cur = $s->fetch(); }
    $imgPc = $cur['image_pc'] ?? '';
    $imgSp = $cur['image_sp'] ?? '';
    if (!empty($_POST['remove_pc'])) { delete_upload($imgPc); $imgPc = ''; }
    if (!empty($_POST['remove_sp'])) { delete_upload($imgSp); $imgSp = ''; }
    if (($_FILES['image_pc']['error'] ?? 4) === UPLOAD_ERR_OK) { $n = save_upload($_FILES['image_pc'], 'sliders/' . $shop, 1600, 900); if ($n) { delete_upload($imgPc); $imgPc = $n; } }
    if (($_FILES['image_sp']['error'] ?? 4) === UPLOAD_ERR_OK) { $n = save_upload($_FILES['image_sp'], 'sliders/' . $shop, 1080, 1350); if ($n) { delete_upload($imgSp); $imgSp = $n; } }
    $data = [
        'shop_id' => $shop,
        'title' => trim((string)($_POST['title'] ?? '')),
        'url' => trim((string)($_POST['url'] ?? '')),
        'image_pc' => $imgPc, 'image_sp' => $imgSp,
        'is_display' => isset($_POST['is_display']) ? 1 : 0,
    ];
    try {
        if ($id && $cur) {
            $set = implode(',', array_map(fn($k) => "$k=:$k", array_keys($data)));
            db()->prepare("UPDATE sliders SET $set WHERE id=:id")->execute($data + ['id' => $id]);
        } else {
            $m = db()->prepare('SELECT COALESCE(MAX(sort),0)+1 FROM sliders WHERE shop_id=?'); $m->execute([$shop]);
            $data['sort'] = (int)$m->fetchColumn();
            $cols = implode(',', array_keys($data)); $ph = implode(',', array_map(fn($k) => ":$k", array_keys($data)));
            db()->prepare("INSERT INTO sliders ($cols) VALUES ($ph)")->execute($data);
        }
        flash('ok', '保存しました。');
        redirect('sliders.php');
    } catch (Throwable $e) { flash('err', '保存に失敗しました。'); }
}

$s = ['title' => '', 'url' => '', 'image_pc' => '', 'image_sp' => '', 'is_display' => 1];
if ($id) { $q = db()->prepare('SELECT * FROM sliders WHERE id=? AND shop_id=?'); $q->execute([$id, $shop]); $s = $q->fetch(); if (!$s) { flash('err', '対象が見つかりません。'); redirect('sliders.php'); } }

layout_header($id ? 'スライダーを編集' : 'スライダーを作成', 'sliders.php');
?>
<div class="page-head"><h1><?= $id ? 'スライダーを編集' : 'スライダーを作成' ?></h1><a class="btn" href="/admin/sliders.php">← 一覧へ</a></div>
<form method="post" enctype="multipart/form-data" class="form-grid" style="max-width:680px">
  <?= csrf_field() ?>
  <div class="card card-pad form-grid">
    <div class="field"><label>タイトル</label><input type="text" name="title" value="<?= h($s['title']) ?>"></div>
    <div class="field"><label>リンクURL</label><input type="text" name="url" value="<?= h($s['url']) ?>" placeholder="/girls/123 や https://..."></div>
    <div class="row2">
      <div class="field"><label>PC画像（横長）</label>
        <?php if ($s['image_pc']): ?><div style="margin-bottom:8px"><img src="<?= h($s['image_pc']) ?>" style="max-width:100%;border-radius:8px"><br><label class="check" style="margin-top:6px"><input type="checkbox" name="remove_pc"> 削除</label></div><?php endif; ?>
        <input type="file" name="image_pc" accept="image/*"></div>
      <div class="field"><label>スマホ画像（縦長）</label>
        <?php if ($s['image_sp']): ?><div style="margin-bottom:8px"><img src="<?= h($s['image_sp']) ?>" style="max-width:120px;border-radius:8px"><br><label class="check" style="margin-top:6px"><input type="checkbox" name="remove_sp"> 削除</label></div><?php endif; ?>
        <input type="file" name="image_sp" accept="image/*"></div>
    </div>
    <label class="check"><input type="checkbox" name="is_display" <?= (int)$s['is_display'] ? 'checked' : '' ?>> サイトに表示</label>
  </div>
  <div class="form-actions"><button class="btn btn-primary" type="submit">保存する</button><a class="btn" href="/admin/sliders.php">キャンセル</a></div>
</form>
<?php layout_footer(); ?>
