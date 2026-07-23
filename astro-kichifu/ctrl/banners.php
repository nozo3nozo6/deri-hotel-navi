<?php
require_once __DIR__ . '/_lib.php';
require_login();
$shop = current_shop_id();
$type = ($_GET['type'] ?? 'top') === 'bottom' ? 'bottom' : 'top';

$st = db()->prepare('SELECT * FROM banners WHERE shop_id=? AND type=? ORDER BY sort, id');
$st->execute([$shop, $type]);
$rows = $st->fetchAll();

// 表示先店舗（banner_shops）を行ごとに集計
$shopCount = (int)db()->query('SELECT COUNT(*) FROM shops')->fetchColumn();
$dispMap = [];
$rowIds = array_map('intval', array_column($rows, 'id'));
if ($rowIds) {
    $in = implode(',', array_fill(0, count($rowIds), '?'));
    $ds = db()->prepare("SELECT bs.banner_id, sh.area FROM banner_shops bs JOIN shops sh ON sh.id=bs.shop_id WHERE bs.banner_id IN ($in) ORDER BY bs.shop_id");
    $ds->execute($rowIds);
    foreach ($ds->fetchAll() as $r) $dispMap[(int)$r['banner_id']][] = $r['area'];
}

layout_header('バナー', 'banners.php');
?>
<div class="page-head">
  <h1>バナー</h1>
  <a class="btn btn-primary" href="/ctrl/banner-edit.php?type=<?= $type ?>">＋ 新規作成</a>
</div>
<div class="tabs">
  <a class="tab <?= $type === 'top' ? 'active' : '' ?>" href="?type=top">上部</a>
  <a class="tab <?= $type === 'bottom' ? 'active' : '' ?>" href="?type=bottom">下部</a>
</div>
<p class="muted" style="margin:-6px 0 12px">行をドラッグで並べ替え</p>
<div class="table-wrap">
  <table class="tbl">
    <thead><tr><th style="width:34px"></th><th>画像</th><th>タイトル</th><th>表示先</th><th>リンク</th><th>表示</th><th style="width:60px">操作</th></tr></thead>
    <tbody data-sortable>
      <?php foreach ($rows as $b): $disp = $dispMap[(int)$b['id']] ?? []; ?>
        <tr draggable="true" data-id="<?= (int)$b['id'] ?>">
          <td style="cursor:grab;color:#bbb">⠿</td>
          <td><img class="thumb" src="<?= h(asset_url($b['image'] ?: '/img/placeholder.svg')) ?>" alt=""></td>
          <td><?= h($b['title'] ?: '（無題）') ?></td>
          <td><?php if (count($disp) >= $shopCount && $shopCount > 0): ?><span class="disp-badge disp-both">両店</span><?php elseif (count($disp) === 1): ?><span class="disp-badge disp-one"><?= h($disp[0]) ?>のみ</span><?php else: ?><span class="disp-badge disp-none">表示先なし</span><?php endif; ?></td>
          <td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis"><?= h($b['url']) ?></td>
          <td><button type="button" class="toggle <?= (int)$b['is_display'] ? 'on' : '' ?>" data-toggle-id="<?= (int)$b['id'] ?>"></button></td>
          <td><div class="rowmenu"><button class="rowmenu-btn" type="button">⋯</button>
            <div class="rowmenu-list">
              <a href="/ctrl/banner-edit.php?id=<?= (int)$b['id'] ?>">✏️ 編集</a>
              <button type="button" class="danger" data-del-id="<?= (int)$b['id'] ?>" data-name="バナー">🗑 削除</button>
            </div></div></td>
        </tr>
      <?php endforeach; ?>
      <?php if (!$rows): ?><tr><td colspan="7" class="muted" style="text-align:center;padding:30px">バナーがありません</td></tr><?php endif; ?>
    </tbody>
  </table>
</div>
<style>
.disp-badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}
.disp-both{background:#ecfdf5;color:#0d9488;border:1px solid #99f6e4}
.disp-one{background:#fdf2f8;color:#be185d;border:1px solid #fbcfe8}
.disp-none{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
</style>
<script>window.__CSRF='<?= h(csrf_token()) ?>';window.__TABLE='banners';</script>
<script src="/ctrl/list.js?v=1"></script>
<?php layout_footer(); ?>
