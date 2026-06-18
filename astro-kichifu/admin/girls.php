<?php
require_once __DIR__ . '/_lib.php';
$admin = require_login();
$shop  = current_shop_id();

$cats = db()->prepare('SELECT id, name FROM girl_categories WHERE shop_id=? ORDER BY sort, id');
$cats->execute([$shop]);
$cats = $cats->fetchAll();

$cat  = (int)($_GET['cat'] ?? 0);
$q    = trim((string)($_GET['q'] ?? ''));
$page = max(1, (int)($_GET['page'] ?? 1));
$per  = 20;

$where = ['g.shop_id = ?'];
$args  = [$shop];
if ($cat)        { $where[] = 'g.girl_category_id = ?'; $args[] = $cat; }
if ($q !== '')   { $where[] = 'g.name LIKE ?';          $args[] = '%' . $q . '%'; }
$wsql = implode(' AND ', $where);

$cnt = db()->prepare("SELECT COUNT(*) FROM girls g WHERE $wsql");
$cnt->execute($args);
$total = (int)$cnt->fetchColumn();

$sql = "SELECT g.*, gc.name AS cat_name,
          (SELECT path FROM girl_images gi WHERE gi.girl_id=g.id ORDER BY gi.sort, gi.id LIMIT 1) AS thumb
        FROM girls g LEFT JOIN girl_categories gc ON gc.id = g.girl_category_id
        WHERE $wsql ORDER BY g.sort, g.id DESC LIMIT $per OFFSET " . (($page - 1) * $per);
$st = db()->prepare($sql);
$st->execute($args);
$rows = $st->fetchAll();

$baseQ = 'cat=' . $cat . '&q=' . urlencode($q) . '&';
$flagMap = [['is_newgirl','新'],['is_trial','待'],['is_tel','電'],['is_inbound','訪'],['is_genderless','G']];

layout_header('女性一覧', 'girls.php');
?>
<div class="page-head">
  <h1>女性一覧 <span class="muted" style="font-size:14px">（<?= number_format($total) ?>名）</span></h1>
  <a class="btn btn-primary" href="/admin/girl-edit.php<?= $cat ? '?cat=' . $cat : '' ?>">＋ 新規登録</a>
  <a class="btn btn-outline" href="/admin/girls-import.php">📦 CSV一括インポート</a>
</div>

<div class="tabs">
  <a class="tab <?= $cat === 0 ? 'active' : '' ?>" href="?cat=0">すべて</a>
  <?php foreach ($cats as $c): ?>
    <a class="tab <?= $cat === (int)$c['id'] ? 'active' : '' ?>" href="?cat=<?= (int)$c['id'] ?>"><?= h($c['name']) ?></a>
  <?php endforeach; ?>
</div>

<form class="toolbar" method="get">
  <input type="hidden" name="cat" value="<?= $cat ?>">
  <div class="search">
    <input type="text" name="q" value="<?= h($q) ?>" placeholder="名前で検索">
  </div>
  <button class="btn" type="submit">検索</button>
  <span class="muted" style="margin-left:auto">行をドラッグで並べ替え</span>
</form>

<div class="table-wrap">
  <table class="tbl">
    <thead>
      <tr>
        <th style="width:34px"></th><th>画像</th><th>名前(年齢)</th><th>スリーサイズ</th>
        <th>カテゴリ</th><th>属性</th><th>入店日</th><th>表示</th><th style="width:60px">操作</th>
      </tr>
    </thead>
    <tbody id="girlRows">
      <?php foreach ($rows as $g): ?>
        <tr draggable="true" data-id="<?= (int)$g['id'] ?>">
          <td style="cursor:grab;color:#bbb">⠿</td>
          <td><img class="thumb" src="<?= h($g['thumb'] ?: '/img/placeholder.svg') ?>" alt=""></td>
          <td><strong><?= h($g['name']) ?></strong> <span class="muted">(<?= (int)$g['age'] ?>)</span></td>
          <td class="muted">T<?= (int)$g['height'] ?> B<?= (int)$g['bust'] ?>(<?= h($g['cup']) ?>) W<?= (int)$g['waist'] ?> H<?= (int)$g['hip'] ?></td>
          <td><?= h($g['cat_name'] ?? '—') ?></td>
          <td>
            <?php foreach ($flagMap as [$f, $lbl]) if ((int)$g[$f]) echo '<span class="badge badge-new" style="margin:1px">' . $lbl . '</span>'; ?>
          </td>
          <td class="muted"><?= h($g['in_date'] ?? '—') ?></td>
          <td><button type="button" class="toggle <?= (int)$g['is_display'] ? 'on' : '' ?>" data-toggle-id="<?= (int)$g['id'] ?>" aria-label="表示切替"></button></td>
          <td>
            <div class="rowmenu">
              <button class="rowmenu-btn" type="button">⋯</button>
              <div class="rowmenu-list">
                <a href="/admin/girl-edit.php?id=<?= (int)$g['id'] ?>">✏️ 編集</a>
                <button type="button" class="danger" data-del-id="<?= (int)$g['id'] ?>" data-name="<?= h($g['name']) ?>">🗑 削除</button>
              </div>
            </div>
          </td>
        </tr>
      <?php endforeach; ?>
      <?php if (!$rows): ?><tr><td colspan="9" class="muted" style="text-align:center;padding:30px">該当する女性がいません</td></tr><?php endif; ?>
    </tbody>
  </table>
</div>
<?= pager($total, $page, $per, $baseQ) ?>

<script>
const CSRF = '<?= h(csrf_token()) ?>';
async function act(data) {
  const fd = new FormData(); fd.append('_csrf', CSRF);
  for (const k in data) fd.append(k, data[k]);
  const r = await fetch('/admin/girl-actions.php', { method: 'POST', body: fd });
  return r.json();
}
// 表示トグル
document.querySelectorAll('[data-toggle-id]').forEach(b => b.addEventListener('click', async () => {
  const j = await act({ action: 'toggle', id: b.dataset.toggleId });
  if (j.ok) b.classList.toggle('on', j.value === 1);
}));
// 削除
document.querySelectorAll('[data-del-id]').forEach(b => b.addEventListener('click', async () => {
  if (!confirm(b.dataset.name + ' を削除しますか？')) return;
  const j = await act({ action: 'delete', id: b.dataset.delId });
  if (j.ok) b.closest('tr').remove();
}));
// ドラッグ並べ替え
const tb = document.getElementById('girlRows');
let dragEl = null;
tb.addEventListener('dragstart', e => { dragEl = e.target.closest('tr'); e.dataTransfer.effectAllowed = 'move'; });
tb.addEventListener('dragover', e => {
  e.preventDefault();
  const t = e.target.closest('tr');
  if (!t || t === dragEl) return;
  const rect = t.getBoundingClientRect();
  tb.insertBefore(dragEl, (e.clientY - rect.top) / rect.height < 0.5 ? t : t.nextSibling);
});
tb.addEventListener('drop', async e => {
  e.preventDefault();
  const ids = [...tb.querySelectorAll('tr[data-id]')].map(r => r.dataset.id);
  await act({ action: 'reorder', ...Object.fromEntries(ids.map((id, i) => [`ids[${i}]`, id])) });
});
</script>
<?php layout_footer(); ?>
