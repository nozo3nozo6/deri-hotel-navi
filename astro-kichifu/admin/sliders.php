<?php
require_once __DIR__ . '/_lib.php';
require_login();
$shop = current_shop_id();

$st = db()->prepare('SELECT * FROM sliders WHERE shop_id=? ORDER BY sort, id');
$st->execute([$shop]);
$rows = $st->fetchAll();

layout_header('スライダー', 'sliders.php');
?>
<div class="page-head"><h1>スライダー</h1><a class="btn btn-primary" href="/admin/slider-edit.php">＋ 新規作成</a></div>
<p class="muted" style="margin:-6px 0 12px">行をドラッグで並べ替え</p>
<div class="table-wrap">
  <table class="tbl">
    <thead><tr><th style="width:34px"></th><th>PC画像</th><th>タイトル</th><th>リンク</th><th>表示</th><th style="width:60px">操作</th></tr></thead>
    <tbody data-sortable>
      <?php foreach ($rows as $s): ?>
        <tr draggable="true" data-id="<?= (int)$s['id'] ?>">
          <td style="cursor:grab;color:#bbb">⠿</td>
          <td><img class="thumb" style="width:72px;height:40px" src="<?= h($s['image_pc'] ?: '/img/placeholder.svg') ?>" alt=""></td>
          <td><?= h($s['title'] ?: '（無題）') ?></td>
          <td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis"><?= h($s['url']) ?></td>
          <td><button type="button" class="toggle <?= (int)$s['is_display'] ? 'on' : '' ?>" data-toggle-id="<?= (int)$s['id'] ?>"></button></td>
          <td><div class="rowmenu"><button class="rowmenu-btn" type="button">⋯</button>
            <div class="rowmenu-list">
              <a href="/admin/slider-edit.php?id=<?= (int)$s['id'] ?>">✏️ 編集</a>
              <button type="button" class="danger" data-del-id="<?= (int)$s['id'] ?>" data-name="スライダー">🗑 削除</button>
            </div></div></td>
        </tr>
      <?php endforeach; ?>
      <?php if (!$rows): ?><tr><td colspan="6" class="muted" style="text-align:center;padding:30px">スライダーがありません</td></tr><?php endif; ?>
    </tbody>
  </table>
</div>
<script>window.__CSRF='<?= h(csrf_token()) ?>';window.__TABLE='sliders';</script>
<script src="/admin/list.js?v=1"></script>
<?php layout_footer(); ?>
