<?php
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_upload.php';
require_login();
$shop = current_shop_id();
$id = (int)($_GET['id'] ?? 0);

// 編集できるのは「自店のサイトに出る行」＋「自店が作った表示先なしの行」（一覧と同じスコープ）
[$scope, $scopeBind] = display_scope_sql('b', 'banner_shops', 'banner_id', $shop);

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $cur = null;
    if ($id) { $s = db()->prepare("SELECT b.* FROM banners b WHERE b.id=? AND $scope"); $s->execute(array_merge([$id], $scopeBind)); $cur = $s->fetch(); }
    $image = $cur['image'] ?? '';
    if (!empty($_POST['remove_image'])) { delete_upload($image); $image = ''; }
    if (($_FILES['image']['error'] ?? 4) === UPLOAD_ERR_OK) { $new = save_upload($_FILES['image'], 'banners/' . $shop, 1200, 1200); if ($new) { delete_upload($image); $image = $new; } }
    $data = [
        // shop_id は「作った店」の記録。表示先は banner_shops で決まるので owner は移さない
        'shop_id' => $cur ? (int)$cur['shop_id'] : $shop,
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
            $id = (int)db()->lastInsertId();
        }
        // 表示店舗（banner_shops）。チェックされた実在店舗のみ（girl_shops と同作法）
        $shopIds = array_values(array_unique(array_map('intval', (array)($_POST['shops'] ?? []))));
        db()->prepare('DELETE FROM banner_shops WHERE banner_id=?')->execute([$id]);
        if ($shopIds) {
            $okShop = db()->prepare('SELECT 1 FROM shops WHERE id=?');
            $insBS  = db()->prepare('INSERT IGNORE INTO banner_shops (banner_id, shop_id) VALUES (?,?)');
            foreach ($shopIds as $sid) { $okShop->execute([$sid]); if ($okShop->fetchColumn()) $insBS->execute([$id, $sid]); }
        }
        flash('ok', '保存しました。');
        redirect('banners.php?type=' . $data['type']);
    } catch (Throwable $e) { flash('err', '保存に失敗しました。'); }
}

$b = ['type' => ($_GET['type'] ?? 'top'), 'title' => '', 'url' => '', 'image' => '', 'is_display' => 1];
if ($id) { $s = db()->prepare("SELECT b.* FROM banners b WHERE b.id=? AND $scope"); $s->execute(array_merge([$id], $scopeBind)); $b = $s->fetch(); if (!$b) { flash('err', '対象が見つかりません。'); redirect('banners.php'); } }

// 表示店舗（新規＝両店デフォルトON / 編集＝現在の banner_shops）
$allShops = shops_list();
$linkedShops = array_map('intval', array_column($allShops, 'id'));
if ($id) {
    $ls = db()->prepare('SELECT shop_id FROM banner_shops WHERE banner_id=?');
    $ls->execute([$id]);
    $linkedShops = array_map('intval', array_column($ls->fetchAll(), 'shop_id'));
}

layout_header($id ? 'バナーを編集' : 'バナーを作成', 'banners.php');
?>
<div class="page-head"><h1><?= $id ? 'バナーを編集' : 'バナーを作成' ?></h1><a class="btn" href="/ctrl/banners.php">← 一覧へ</a></div>
<form method="post" enctype="multipart/form-data" class="form-grid" style="max-width:680px">
  <?= csrf_field() ?>
  <div class="card card-pad form-grid">
    <div class="field"><label>表示位置</label>
      <select name="type"><option value="top" <?= $b['type'] === 'top' ? 'selected' : '' ?>>上部</option><option value="bottom" <?= $b['type'] === 'bottom' ? 'selected' : '' ?>>下部</option></select>
    </div>
    <div class="field"><label>タイトル</label><input type="text" name="title" value="<?= h($b['title']) ?>"></div>
    <div class="field"><label>リンクURL</label><input type="text" name="url" value="<?= h($b['url']) ?>" placeholder="/system や https://..."></div>
    <div class="field"><label>画像</label>
      <?php if ($b['image']): ?><div style="margin-bottom:8px"><img src="<?= h(asset_url($b['image'])) ?>" style="max-width:240px;border-radius:8px"><br><label class="check" style="margin-top:6px"><input type="checkbox" name="remove_image"> 画像を削除</label></div><?php endif; ?>
      <input type="file" name="image" accept="image/*">
    </div>
    <label class="check"><input type="checkbox" name="is_display" <?= (int)$b['is_display'] ? 'checked' : '' ?>> サイトに表示</label>
  </div>
  <div class="card card-pad">
    <strong>表示店舗</strong>
    <span class="muted" style="font-weight:400;font-size:12px;margin-left:8px">ONにした店舗のサイトに表示されます（立川だけ／吉祥寺だけ も可）</span>
    <div style="display:flex;flex-wrap:wrap;gap:14px 32px;margin-top:14px">
      <?php foreach ($allShops as $sh): ?>
        <label class="shop-toggle" style="gap:10px;cursor:pointer">
          <input type="checkbox" class="shop-toggle-cb" name="shops[]" value="<?= (int)$sh['id'] ?>" <?= in_array((int)$sh['id'], $linkedShops, true) ? 'checked' : '' ?>>
          <span class="toggle" aria-hidden="true"></span>
          <span style="font-size:14px;font-weight:600;color:var(--text)"><?= h($sh['area']) ?><span class="muted" style="font-weight:400">（<?= h($sh['name']) ?>）</span></span>
        </label>
      <?php endforeach; ?>
    </div>
  </div>
  <div class="form-actions"><button class="btn btn-primary" type="submit">保存する</button><a class="btn" href="/ctrl/banners.php">キャンセル</a></div>
</form>
<?php layout_footer(); ?>
