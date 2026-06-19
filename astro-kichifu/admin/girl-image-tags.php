<?php
require_once __DIR__ . '/_lib.php';
$admin = require_login();
$shop  = current_shop_id();

// ---- 追加 ----
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $name = trim((string)($_POST['name'] ?? ''));
    if ($name === '') {
        flash('err', 'タグ名を入力してください。');
    } else {
        $dup = db()->prepare('SELECT id FROM girl_image_tags WHERE shop_id=? AND name=?');
        $dup->execute([$shop, $name]);
        if ($dup->fetchColumn()) {
            flash('err', '同じ名前のタグが既にあります。');
        } else {
            $ms = db()->prepare('SELECT COALESCE(MAX(sort),-1)+1 FROM girl_image_tags WHERE shop_id=?');
            $ms->execute([$shop]);
            db()->prepare('INSERT INTO girl_image_tags (shop_id,name,sort) VALUES (?,?,?)')
                ->execute([$shop, $name, (int)$ms->fetchColumn()]);
            flash('ok', '「' . $name . '」を追加しました。');
        }
    }
    redirect('girl-image-tags.php');
}

$rows = db()->prepare('SELECT id, name, is_active FROM girl_image_tags WHERE shop_id=? ORDER BY sort, id');
$rows->execute([$shop]);
$rows = $rows->fetchAll();

layout_header('特徴タグ', 'girl-image-tags.php');
?>
<div class="page-head">
  <h1>特徴タグ <span class="muted" style="font-size:14px">（<?= count($rows) ?>件）</span></h1>
</div>
<p class="muted" style="margin-top:-8px">女の子に付ける特徴タグ（可愛い系・清楚・スレンダー・愛嬌抜群 など）。女性の編集画面で選択でき、サイトの名前下に表示されます。「表示」OFFのタグは選択肢に出ません。</p>

<form method="post" class="toolbar" style="margin-bottom:18px">
  <?= csrf_field() ?>
  <div class="search"><input type="text" name="name" placeholder="タグ名（例: 清楚）" required maxlength="40"></div>
  <button class="btn btn-primary" type="submit">＋ 追加</button>
  <span class="muted" style="margin-left:auto">行をドラッグで並べ替え</span>
</form>

<div class="table-wrap">
  <table class="tbl">
    <thead><tr><th style="width:34px"></th><th>タグ名</th><th style="width:80px">表示</th><th style="width:90px">操作</th></tr></thead>
    <tbody data-sortable id="rows">
      <?php foreach ($rows as $r): ?>
        <tr draggable="true" data-id="<?= (int)$r['id'] ?>">
          <td style="cursor:grab;color:#bbb">⠿</td>
          <td><strong><?= h($r['name']) ?></strong></td>
          <td><button type="button" class="toggle <?= (int)$r['is_active'] ? 'on' : '' ?>" data-toggle-id="<?= (int)$r['id'] ?>" aria-label="表示切替"></button></td>
          <td>
            <a class="btn btn-sm" href="/admin/girl-image-tag-edit.php?id=<?= (int)$r['id'] ?>">✏️</a>
            <button type="button" class="btn btn-sm btn-danger" data-del-id="<?= (int)$r['id'] ?>" data-name="<?= h($r['name']) ?>">🗑</button>
          </td>
        </tr>
      <?php endforeach; ?>
      <?php if (!$rows): ?><tr><td colspan="4" class="muted" style="text-align:center;padding:30px">タグがありません。上のフォームから追加してください。</td></tr><?php endif; ?>
    </tbody>
  </table>
</div>

<script>window.__CSRF = '<?= h(csrf_token()) ?>'; window.__TABLE = 'girl_image_tags';</script>
<script src="/admin/list.js?v=1"></script>
<?php layout_footer(); ?>
