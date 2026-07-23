<?php
require_once __DIR__ . '/_lib.php';
require_login();
$shop = current_shop_id();

$st = db()->prepare('SELECT * FROM sliders WHERE shop_id=? ORDER BY sort, id');
$st->execute([$shop]);
$rows = $st->fetchAll();

// 表示先店舗（slider_shops）を行ごとに集計
$shopCount = (int)db()->query('SELECT COUNT(*) FROM shops')->fetchColumn();
$dispMap = [];
$rowIds = array_map('intval', array_column($rows, 'id'));
if ($rowIds) {
    $in = implode(',', array_fill(0, count($rowIds), '?'));
    $ds = db()->prepare("SELECT ss.slider_id, sh.area FROM slider_shops ss JOIN shops sh ON sh.id=ss.shop_id WHERE ss.slider_id IN ($in) ORDER BY ss.shop_id");
    $ds->execute($rowIds);
    foreach ($ds->fetchAll() as $r) $dispMap[(int)$r['slider_id']][] = $r['area'];
}

layout_header('スライダー', 'sliders.php');
?>
<div class="page-head"><h1>スライダー</h1><a class="btn btn-primary" href="/ctrl/slider-edit.php">＋ 新規作成</a></div>
<p class="muted" style="margin:-6px 0 12px">行をドラッグで並べ替え</p>
<div class="table-wrap">
  <table class="tbl">
    <thead><tr><th style="width:34px"></th><th>PC画像</th><th>タイトル</th><th>表示先</th><th>リンク</th><th>表示</th><th style="width:60px">操作</th></tr></thead>
    <tbody data-sortable>
      <?php foreach ($rows as $s): $disp = $dispMap[(int)$s['id']] ?? []; ?>
        <tr draggable="true" data-id="<?= (int)$s['id'] ?>">
          <td style="cursor:grab;color:#bbb">⠿</td>
          <td><img class="thumb" style="width:72px;height:40px" src="<?= h(asset_url($s['image_pc'] ?: '/img/placeholder.svg')) ?>" alt=""></td>
          <td><?= h($s['title'] ?: '（無題）') ?></td>
          <td><?php if (count($disp) >= $shopCount && $shopCount > 0): ?><span class="disp-badge disp-both">両店</span><?php elseif (count($disp) === 1): ?><span class="disp-badge disp-one"><?= h($disp[0]) ?>のみ</span><?php else: ?><span class="disp-badge disp-none">表示先なし</span><?php endif; ?></td>
          <td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis"><?= h($s['url']) ?></td>
          <td><button type="button" class="toggle <?= (int)$s['is_display'] ? 'on' : '' ?>" data-toggle-id="<?= (int)$s['id'] ?>"></button></td>
          <td><div class="rowmenu"><button class="rowmenu-btn" type="button">⋯</button>
            <div class="rowmenu-list">
              <a href="/ctrl/slider-edit.php?id=<?= (int)$s['id'] ?>">✏️ 編集</a>
              <button type="button" class="danger" data-del-id="<?= (int)$s['id'] ?>" data-name="スライダー">🗑 削除</button>
            </div></div></td>
        </tr>
      <?php endforeach; ?>
      <?php if (!$rows): ?><tr><td colspan="7" class="muted" style="text-align:center;padding:30px">スライダーがありません</td></tr><?php endif; ?>
    </tbody>
  </table>
</div>
<style>
.disp-badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}
.disp-both{background:#ecfdf5;color:#0d9488;border:1px solid #99f6e4}
.disp-one{background:#fdf2f8;color:#be185d;border:1px solid #fbcfe8}
.disp-none{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
</style>
<script>window.__CSRF='<?= h(csrf_token()) ?>';window.__TABLE='sliders';</script>
<script src="/ctrl/list.js?v=1"></script>
<?php layout_footer(); ?>
