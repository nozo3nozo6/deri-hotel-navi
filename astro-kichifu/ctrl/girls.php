<?php
require_once __DIR__ . '/_lib.php';
$admin = require_login();
$shop  = current_shop_id();

// カテゴリは共有マスタ（shop_id スコープなし）
$cats = db()->query('SELECT id, name FROM girl_categories ORDER BY sort, id')->fetchAll();

$cat  = (int)($_GET['cat'] ?? 0);
$q    = trim((string)($_GET['q'] ?? ''));
$page = max(1, (int)($_GET['page'] ?? 1));
$per  = 20;

// 並び替え: manual=ドラッグ順(g.sort) / freq=出勤頻度が高い順 / indate=入店が新しい順
$sort = $_GET['sort'] ?? 'manual';
if (!in_array($sort, ['manual', 'freq', 'indate'], true)) $sort = 'manual';
$orderSql = [
    'manual' => 'g.sort, g.id DESC',
    'freq'   => 'wc DESC, g.in_date DESC, g.id DESC', // 出勤頻度高い順 → 入店新しい順
    'indate' => 'g.in_date DESC, g.id DESC',
][$sort];
$canDrag = ($sort === 'manual'); // ドラッグ並べ替えは手動順モードのみ

// 全女性を対象（shop_id フィルタなし）
$where = ['1=1'];
$args  = [];
if ($cat)        { $where[] = 'g.girl_category_id = ?'; $args[] = $cat; }
if ($q !== '')   { $where[] = 'g.name LIKE ?';          $args[] = '%' . $q . '%'; }
$wsql = implode(' AND ', $where);

$cnt = db()->prepare("SELECT COUNT(*) FROM girls g WHERE $wsql");
$cnt->execute($args);
$total = (int)$cnt->fetchColumn();

// 全女性を取得（掲載状態は girl_shops から後で一括マップ化）
// wc=出勤頻度（当店の work 件数。news-edit と同じ集計）。並び替え freq で使用、列表示にも使う。
$sql = "SELECT g.*, gc.name AS cat_name,
          (SELECT COUNT(*) FROM schedules s WHERE s.girl_id=g.id AND s.shop_id=? AND s.status='work') AS wc,
          (SELECT path FROM girl_images gi WHERE gi.girl_id=g.id ORDER BY gi.sort, gi.id LIMIT 1) AS thumb
        FROM girls g
        LEFT JOIN girl_categories gc ON gc.id = g.girl_category_id
        WHERE $wsql ORDER BY $orderSql LIMIT $per OFFSET " . (($page - 1) * $per);
$st = db()->prepare($sql);
$st->execute(array_merge([$shop], $args)); // 先頭 ? = wc サブクエリの shop_id
$rows = $st->fetchAll();

// 掲載状態マップ [girl_id][shop_id]=1 を一括取得（owner=店舗別トグル / staff=自店のみ）
$shopsAll     = shops_list();          // id, slug, name, area（admi=1 / kichifu=2 …）
$canManageAll = !$admin['shop_id'];    // 全店 owner は店舗別トグル、staff は自店1トグル
$shopMap = [];
if ($rows) {
    $ids = array_column($rows, 'id');
    $ph  = implode(',', array_fill(0, count($ids), '?'));
    $gsq = db()->prepare("SELECT girl_id, shop_id FROM girl_shops WHERE girl_id IN ($ph)");
    $gsq->execute($ids);
    foreach ($gsq->fetchAll() as $r) $shopMap[(int)$r['girl_id']][(int)$r['shop_id']] = 1;
}

$baseQ = 'cat=' . $cat . '&q=' . urlencode($q) . '&sort=' . $sort . '&';
$flagMap = [['is_newgirl','新'],['is_trial','待'],['is_tel','電'],['is_inbound','訪'],['is_genderless','G']];

layout_header('女性一覧', 'girls.php');
?>
<div class="page-head">
  <h1>女性一覧 <span class="muted" style="font-size:14px">（<?= number_format($total) ?>名）</span></h1>
  <a class="btn btn-primary" href="/ctrl/girl-edit.php<?= $cat ? '?cat=' . $cat : '' ?>">＋ 新規登録</a>
  <a class="btn btn-outline" href="/ctrl/girls-import.php">📦 CSV一括インポート</a>
  <a class="btn btn-outline" href="/ctrl/girls-import-admi.php">📥 admi取込(入店日/表示)</a>
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
  <span class="muted" style="margin-left:auto;font-size:13px">並び替え</span>
  <select name="sort" onchange="this.form.submit()" style="width:auto;flex:none">
    <option value="manual" <?= $sort === 'manual' ? 'selected' : '' ?>>手動（ドラッグ順）</option>
    <option value="freq"   <?= $sort === 'freq'   ? 'selected' : '' ?>>出勤頻度が高い順</option>
    <option value="indate" <?= $sort === 'indate' ? 'selected' : '' ?>>入店が新しい順</option>
  </select>
</form>

<div class="table-wrap">
  <table class="tbl">
    <thead>
      <tr>
        <th style="width:42px"><?= $sort === 'freq' ? '出勤' : '' ?></th><th>画像</th><th>名前(年齢)</th><th>スリーサイズ</th>
        <th>カテゴリ</th><th>属性</th><th>入店日</th><th><?= $canManageAll ? '掲載（店舗別）' : '当店掲載' ?></th><th style="width:60px">操作</th>
      </tr>
    </thead>
    <tbody id="girlRows">
      <?php foreach ($rows as $g): ?>
        <tr<?= $canDrag ? ' draggable="true"' : '' ?> data-id="<?= (int)$g['id'] ?>">
          <?php if ($canDrag): ?>
            <td style="cursor:grab;color:#bbb">⠿</td>
          <?php else: ?>
            <td class="muted" style="text-align:center;font-size:12px" title="出勤回数"><?= (int)$g['wc'] ?>回</td>
          <?php endif; ?>
          <td><img class="thumb" src="<?= h(asset_url($g['thumb'] ?: '/img/placeholder.svg')) ?>" alt=""></td>
          <td><strong><?= h($g['name']) ?></strong> <span class="muted">(<?= (int)$g['age'] ?>)</span></td>
          <td class="muted">T<?= (int)$g['height'] ?> B<?= (int)$g['bust'] ?>(<?= h($g['cup']) ?>) W<?= (int)$g['waist'] ?> H<?= (int)$g['hip'] ?></td>
          <td><?= h($g['cat_name'] ?? '—') ?></td>
          <td>
            <?php foreach ($flagMap as [$f, $lbl]) if ((int)$g[$f]) echo '<span class="badge badge-new" style="margin:1px">' . $lbl . '</span>'; ?>
          </td>
          <td class="muted"><?= h($g['in_date'] ?? '—') ?></td>
          <td>
            <?php if ($canManageAll): // owner=店舗別トグル ?>
              <div class="shop-toggles">
                <?php foreach ($shopsAll as $s): $sid = (int)$s['id']; $on = !empty($shopMap[$g['id']][$sid]); ?>
                  <span class="shop-toggle">
                    <span class="shop-toggle-label"><?= h($s['area'] ?: $s['name']) ?></span>
                    <button type="button" class="toggle <?= $on ? 'on' : '' ?>" data-toggle-id="<?= (int)$g['id'] ?>" data-shop="<?= $sid ?>" aria-label="<?= h($s['area'] ?: $s['name']) ?>掲載切替"></button>
                  </span>
                <?php endforeach; ?>
              </div>
            <?php else: // staff=自店1トグル ?>
              <?php $on = !empty($shopMap[$g['id']][$shop]); ?>
              <button type="button" class="toggle <?= $on ? 'on' : '' ?>" data-toggle-id="<?= (int)$g['id'] ?>" data-shop="<?= $shop ?>" aria-label="当店掲載切替"></button>
            <?php endif; ?>
          </td>
          <td>
            <div class="rowmenu">
              <button class="rowmenu-btn" type="button">⋯</button>
              <div class="rowmenu-list">
                <a href="/ctrl/girl-edit.php?id=<?= (int)$g['id'] ?>">✏️ 編集</a>
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
  const r = await fetch('/ctrl/girl-actions.php', { method: 'POST', body: fd });
  return r.json();
}
// 掲載トグル（data-shop で店舗別に girl_shops 行を追加/削除）
document.querySelectorAll('[data-toggle-id]').forEach(b => b.addEventListener('click', async () => {
  const j = await act({ action: 'toggle', id: b.dataset.toggleId, shop: b.dataset.shop || '' });
  if (j.ok) b.classList.toggle('on', j.value === 1);
}));
// 削除
document.querySelectorAll('[data-del-id]').forEach(b => b.addEventListener('click', async () => {
  if (!confirm(b.dataset.name + ' を削除しますか？')) return;
  const j = await act({ action: 'delete', id: b.dataset.delId });
  if (j.ok) b.closest('tr').remove();
}));
// ドラッグ並べ替え（手動順モードのみ）
<?php if ($canDrag): ?>
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
<?php endif; ?>
</script>
<?php layout_footer(); ?>
