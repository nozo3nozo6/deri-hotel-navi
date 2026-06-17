<?php
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_upload.php';
require_login();
$shop = current_shop_id();
$id = (int)($_GET['id'] ?? 0);

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $title = trim((string)($_POST['title'] ?? ''));
    if ($title === '') { flash('err', 'タイトルは必須です。'); }
    else {
        // 既存読み込み（画像差し替え判定用）
        $cur = null;
        if ($id) { $s = db()->prepare('SELECT * FROM news WHERE id=? AND shop_id=?'); $s->execute([$id, $shop]); $cur = $s->fetch(); }
        $thumb = $cur['thumb'] ?? '';
        if (!empty($_POST['remove_thumb'])) { delete_upload($thumb); $thumb = ''; }
        if (($_FILES['thumb']['error'] ?? 4) === UPLOAD_ERR_OK) {
            $new = save_upload($_FILES['thumb'], 'news/' . $shop);
            if ($new) { delete_upload($thumb); $thumb = $new; }
        }
        $data = [
            'shop_id' => $shop, 'title' => $title,
            'body' => (string)($_POST['body'] ?? ''),
            'thumb' => $thumb,
            'posted_at' => ($_POST['posted_at'] ?? '') ? str_replace('T', ' ', $_POST['posted_at']) . ':00' : null,
            'is_display' => isset($_POST['is_display']) ? 1 : 0,
        ];
        try {
            if ($id && $cur) {
                $set = implode(',', array_map(fn($k) => "$k=:$k", array_keys($data)));
                db()->prepare("UPDATE news SET $set WHERE id=:id")->execute($data + ['id' => $id]);
            } else {
                $cols = implode(',', array_keys($data)); $ph = implode(',', array_map(fn($k) => ":$k", array_keys($data)));
                db()->prepare("INSERT INTO news ($cols) VALUES ($ph)")->execute($data);
                $id = (int)db()->lastInsertId();
            }
            flash('ok', '保存しました。');
            redirect('news.php');
        } catch (Throwable $e) { flash('err', '保存に失敗しました。'); }
    }
}

$n = ['title' => '', 'body' => '', 'thumb' => '', 'posted_at' => date('Y-m-d\TH:i'), 'is_display' => 1];
if ($id) { $s = db()->prepare('SELECT * FROM news WHERE id=? AND shop_id=?'); $s->execute([$id, $shop]); $n = $s->fetch(); if (!$n) { flash('err', '対象が見つかりません。'); redirect('news.php'); } $n['posted_at'] = $n['posted_at'] ? str_replace(' ', 'T', substr($n['posted_at'], 0, 16)) : ''; }

layout_header($id ? 'お知らせを編集' : 'お知らせを作成', 'news.php');
?>
<div class="page-head"><h1><?= $id ? 'お知らせを編集' : 'お知らせを作成' ?></h1><a class="btn" href="/admin/news.php">← 一覧へ</a></div>
<form method="post" enctype="multipart/form-data" class="form-grid" style="max-width:760px">
  <?= csrf_field() ?>
  <div class="card card-pad form-grid">
    <div class="field"><label>タイトル *</label><input type="text" name="title" value="<?= h($n['title']) ?>" required></div>
    <div class="field"><label>日付</label><input type="datetime-local" name="posted_at" value="<?= h($n['posted_at']) ?>"></div>
    <div class="field"><label>本文</label><textarea name="body" rows="10"><?= h($n['body']) ?></textarea></div>
    <div class="field">
      <label>サムネイル画像</label>
      <?php if ($n['thumb']): ?>
        <div style="margin-bottom:8px"><img src="<?= h($n['thumb']) ?>" style="width:120px;border-radius:8px"><br>
          <label class="check" style="margin-top:6px"><input type="checkbox" name="remove_thumb"> 画像を削除</label></div>
      <?php endif; ?>
      <input type="file" name="thumb" accept="image/*">
    </div>
    <label class="check"><input type="checkbox" name="is_display" <?= (int)$n['is_display'] ? 'checked' : '' ?>> サイトに表示</label>
  </div>
  <div class="form-actions"><button class="btn btn-primary" type="submit">保存する</button><a class="btn" href="/admin/news.php">キャンセル</a></div>
</form>
<?php layout_footer(); ?>
