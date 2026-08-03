<?php
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_upload.php';
require_login();
$shop = current_shop_id();
$id = (int)($_GET['id'] ?? 0);

// スライダーは全店共通の一覧。どの行もどちらの店からも編集できる（出し先は表示店舗トグルで決まる）
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $cur = null;
    if ($id) { $s = db()->prepare('SELECT * FROM sliders WHERE id=?'); $s->execute([$id]); $cur = $s->fetch(); }
    $imgPc = $cur['image_pc'] ?? '';
    $imgSp = $cur['image_sp'] ?? '';
    // 同じ画像を他の行も指している場合があるので実体削除は delete_upload_safe 経由
    if (!empty($_POST['remove_pc'])) { delete_upload_safe($imgPc, 'sliders', $id); $imgPc = ''; }
    if (!empty($_POST['remove_sp'])) { delete_upload_safe($imgSp, 'sliders', $id); $imgSp = ''; }
    if (($_FILES['image_pc']['error'] ?? 4) === UPLOAD_ERR_OK) { $n = save_upload($_FILES['image_pc'], 'sliders/' . $shop, 1600, 900); if ($n) { delete_upload_safe($imgPc, 'sliders', $id); $imgPc = $n; } }
    if (($_FILES['image_sp']['error'] ?? 4) === UPLOAD_ERR_OK) { $n = save_upload($_FILES['image_sp'], 'sliders/' . $shop, 1080, 1350); if ($n) { delete_upload_safe($imgSp, 'sliders', $id); $imgSp = $n; } }
    $data = [
        // shop_id は「作った店」の記録。表示先は slider_shops で決まるので、他店が作った行を
        // 編集しても owner は移さない（新規作成時のみ自店になる）。
        'shop_id' => $cur ? (int)$cur['shop_id'] : $shop,
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
            // sort は全店共通の並び（各サイトはこの順のまま自店ぶんを拾う）。owner 別に採番すると
            // 番号が衝突して並べ替えが効かなくなるため、全体の最大値+1 を使う。
            $data['sort'] = (int)db()->query('SELECT COALESCE(MAX(sort),0)+1 FROM sliders')->fetchColumn();
            $cols = implode(',', array_keys($data)); $ph = implode(',', array_map(fn($k) => ":$k", array_keys($data)));
            db()->prepare("INSERT INTO sliders ($cols) VALUES ($ph)")->execute($data);
            $id = (int)db()->lastInsertId();
        }
        // 表示店舗（slider_shops）。チェックされた実在店舗のみ（girl_shops と同作法）
        // あわせて店舗別リンクURL（shop_url[店舗ID]）を保存。空なら共通の url を使う。
        $shopIds = array_values(array_unique(array_map('intval', (array)($_POST['shops'] ?? []))));
        $shopUrls = (array)($_POST['shop_url'] ?? []);
        db()->prepare('DELETE FROM slider_shops WHERE slider_id=?')->execute([$id]);
        if ($shopIds) {
            $okShop = db()->prepare('SELECT 1 FROM shops WHERE id=?');
            $insSS  = db()->prepare('INSERT IGNORE INTO slider_shops (slider_id, shop_id, url) VALUES (?,?,?)');
            foreach ($shopIds as $sid) {
                $okShop->execute([$sid]);
                if (!$okShop->fetchColumn()) continue;
                $u = trim((string)($shopUrls[$sid] ?? ''));
                $insSS->execute([$id, $sid, $u === '' ? null : $u]);
            }
        }
        flash('ok', '保存しました。');
        redirect('sliders.php');
    } catch (Throwable $e) { flash('err', '保存に失敗しました。'); }
}

$s = ['title' => '', 'url' => '', 'image_pc' => '', 'image_sp' => '', 'is_display' => 1];
if ($id) { $q = db()->prepare('SELECT * FROM sliders WHERE id=?'); $q->execute([$id]); $s = $q->fetch(); if (!$s) { flash('err', '対象が見つかりません。'); redirect('sliders.php'); } }

// 表示店舗（新規＝両店デフォルトON / 編集＝現在の slider_shops）と店舗別リンクURL
$allShops = shops_list();
$linkedShops = array_map('intval', array_column($allShops, 'id'));
$shopUrls = [];
if ($id) {
    $ls = db()->prepare('SELECT shop_id, url FROM slider_shops WHERE slider_id=?');
    $ls->execute([$id]);
    $linkedShops = [];
    foreach ($ls->fetchAll() as $r) {
        $linkedShops[] = (int)$r['shop_id'];
        $shopUrls[(int)$r['shop_id']] = (string)($r['url'] ?? '');
    }
}

layout_header($id ? 'スライダーを編集' : 'スライダーを作成', 'sliders.php');
?>
<div class="page-head"><h1><?= $id ? 'スライダーを編集' : 'スライダーを作成' ?></h1><a class="btn" href="/ctrl/sliders.php">← 一覧へ</a></div>
<form method="post" enctype="multipart/form-data" class="form-grid" style="max-width:680px">
  <?= csrf_field() ?>
  <div class="card card-pad form-grid">
    <div class="field"><label>タイトル</label><input type="text" name="title" value="<?= h($s['title']) ?>"></div>
    <div class="field"><label>リンクURL（共通）</label><input type="text" name="url" value="<?= h($s['url']) ?>" placeholder="/girls/123 や https://...">
      <span class="muted" style="font-size:12px">店舗ごとに変えたいときは、下の「表示店舗」でその店だけのリンクを入れてください。</span></div>
    <div class="row2">
      <div class="field"><label>PC画像（横長）</label>
        <?php if ($s['image_pc']): ?><div style="margin-bottom:8px"><img src="<?= h(asset_url($s['image_pc'])) ?>" style="max-width:100%;border-radius:8px"><br><label class="check" style="margin-top:6px"><input type="checkbox" name="remove_pc"> 削除</label></div><?php endif; ?>
        <input type="file" name="image_pc" accept="image/*"></div>
      <div class="field"><label>スマホ画像（縦長）</label>
        <?php if ($s['image_sp']): ?><div style="margin-bottom:8px"><img src="<?= h(asset_url($s['image_sp'])) ?>" style="max-width:120px;border-radius:8px"><br><label class="check" style="margin-top:6px"><input type="checkbox" name="remove_sp"> 削除</label></div><?php endif; ?>
        <input type="file" name="image_sp" accept="image/*"></div>
    </div>
    <label class="check"><input type="checkbox" name="is_display" <?= (int)$s['is_display'] ? 'checked' : '' ?>> サイトに表示</label>
  </div>
  <div class="card card-pad">
    <strong>表示店舗</strong>
    <span class="muted" style="font-weight:400;font-size:12px;margin-left:8px">ONにした店舗のサイトに表示されます（立川だけ／吉祥寺だけ も可）</span>
    <div class="shop-rows">
      <?php foreach ($allShops as $sh): $sid = (int)$sh['id']; ?>
        <div class="shop-row">
          <label class="shop-toggle" style="gap:10px;cursor:pointer">
            <input type="checkbox" class="shop-toggle-cb" name="shops[]" value="<?= $sid ?>" <?= in_array($sid, $linkedShops, true) ? 'checked' : '' ?>>
            <span class="toggle" aria-hidden="true"></span>
            <span style="font-size:14px;font-weight:600;color:var(--text)"><?= h($sh['area']) ?><span class="muted" style="font-weight:400">（<?= h($sh['name']) ?>）</span></span>
          </label>
          <input type="text" name="shop_url[<?= $sid ?>]" value="<?= h($shopUrls[$sid] ?? '') ?>"
                 placeholder="この店だけのリンク（空欄なら共通のリンク）">
        </div>
      <?php endforeach; ?>
    </div>
  </div>
  <style>
  .shop-rows{display:flex;flex-direction:column;gap:12px;margin-top:14px}
  .shop-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .shop-row > label{min-width:190px}
  .shop-row > input{flex:1;min-width:240px}
  .shop-row > input::placeholder{color:#9aa3af;font-weight:400}
  </style>
  <div class="form-actions"><button class="btn btn-primary" type="submit">保存する</button><a class="btn" href="/ctrl/sliders.php">キャンセル</a></div>
</form>
<?php layout_footer(); ?>
