<?php
require_once __DIR__ . '/_lib.php';
require_login();
$shop = current_shop_id();
$type = ($_GET['type'] ?? 'top') === 'bottom' ? 'bottom' : 'top';

$st = db()->prepare('SELECT * FROM banners WHERE shop_id=? AND type=? ORDER BY sort, id');
$st->execute([$shop, $type]);
$rows = $st->fetchAll();

layout_header('バナー', 'banners.php');
?>
<div class="page-head">
  <h1>バナー</h1>
  <a class="btn btn-primary" href="/admin/banner-edit.php?type=<?= $type ?>">＋ 新規作成</a>
</div>
<div class="tabs">
  <a class="tab <?= $type === 'top' ? 'active' : '' ?>" href="?type=top">上部</a>
  <a class="tab <?= $type === 'bottom' ? 'active' : '' ?>" href="?type=bottom">下部</a>
</div>
<p class="muted" style="margin:-6px 0 12px">行をドラッグで並べ替え</p>
<div class="table-wrap">
  <table class="tbl">
    <thead><tr><th style="width:34px"></th><th>画像</th><th>タイトル</th><th>リンク</th><th>表示</th><th style="width:60px">操作</th></tr></thead>
    <tbody data-sortable>
      <?php foreach ($rows as $b): ?>
        <tr draggable="true" data-id="<?= (int)$b['id'] ?>">
          <td style="cursor:grab;color:#bbb">⠿</td>
          <td><img class="thumb" src="<?= h($b['image'] ?: '/img/placeholder.svg') ?>" alt=""></td>
          <td><?= h($b['title'] ?: '（無題）') ?></td>
          <td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis"><?= h($b['url']) ?></td>
          <td><button type="button" class="toggle <?= (int)$b['is_display'] ? 'on' : '' ?>" data-toggle-id="<?= (int)$b['id'] ?>"></button></td>
          <td><div class="rowmenu"><button class="rowmenu-btn" type="button">⋯</button>
            <div class="rowmenu-list">
              <a href="/admin/banner-edit.php?id=<?= (int)$b['id'] ?>">✏️ 編集</a>
              <button type="button" class="danger" data-del-id="<?= (int)$b['id'] ?>" data-name="バナー">🗑 削除</button>
            </div></div></td>
        </tr>
      <?php endforeach; ?>
      <?php if (!$rows): ?><tr><td colspan="6" class="muted" style="text-align:center;padding:30px">バナーがありません</td></tr><?php endif; ?>
    </tbody>
  </table>
</div>
<script>window.__CSRF='<?= h(csrf_token()) ?>';window.__TABLE='banners';</script>
<script src="/admin/list.js?v=1"></script>
<?php layout_footer(); ?>
