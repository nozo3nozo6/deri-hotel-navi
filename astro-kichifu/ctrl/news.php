<?php
require_once __DIR__ . '/_lib.php';
require_login();
$shop = current_shop_id();

$q = trim((string)($_GET['q'] ?? ''));
$page = max(1, (int)($_GET['page'] ?? 1));
$per = 20;
$where = 'shop_id = ?'; $args = [$shop];
if ($q !== '') { $where .= ' AND title LIKE ?'; $args[] = '%' . $q . '%'; }

$cnt = db()->prepare("SELECT COUNT(*) FROM news WHERE $where"); $cnt->execute($args);
$total = (int)$cnt->fetchColumn();
$st = db()->prepare("SELECT * FROM news WHERE $where ORDER BY COALESCE(posted_at, created) DESC, id DESC LIMIT $per OFFSET " . (($page - 1) * $per));
$st->execute($args);
$rows = $st->fetchAll();

layout_header('お知らせ', 'news.php');
?>
<div class="page-head">
  <h1>お知らせ <span class="muted" style="font-size:14px">（<?= number_format($total) ?>件）</span></h1>
  <a class="btn btn-primary" href="/ctrl/news-edit.php">＋ 新規作成</a>
</div>
<form class="toolbar" method="get">
  <div class="search"><input type="text" name="q" value="<?= h($q) ?>" placeholder="タイトルで検索"></div>
  <button class="btn" type="submit">検索</button>
</form>
<div class="table-wrap">
  <table class="tbl">
    <thead><tr><th>画像</th><th>タイトル</th><th>日付</th><th>表示</th><th style="width:60px">操作</th></tr></thead>
    <tbody>
      <?php foreach ($rows as $n): ?>
        <tr>
          <td><img class="thumb" src="<?= h(asset_url($n['thumb'] ?: '/img/placeholder.svg')) ?>" alt=""></td>
          <td><?= h($n['title']) ?></td>
          <td class="muted"><?= h($n['posted_at'] ?: $n['created']) ?></td>
          <td><button type="button" class="toggle <?= (int)$n['is_display'] ? 'on' : '' ?>" data-toggle-id="<?= (int)$n['id'] ?>"></button></td>
          <td>
            <div class="rowmenu"><button class="rowmenu-btn" type="button">⋯</button>
              <div class="rowmenu-list">
                <a href="/ctrl/news-edit.php?id=<?= (int)$n['id'] ?>">✏️ 編集</a>
                <button type="button" class="danger" data-del-id="<?= (int)$n['id'] ?>" data-name="<?= h($n['title']) ?>">🗑 削除</button>
              </div>
            </div>
          </td>
        </tr>
      <?php endforeach; ?>
      <?php if (!$rows): ?><tr><td colspan="5" class="muted" style="text-align:center;padding:30px">お知らせがありません</td></tr><?php endif; ?>
    </tbody>
  </table>
</div>
<?= pager($total, $page, $per, 'q=' . urlencode($q) . '&') ?>
<script>window.__CSRF='<?= h(csrf_token()) ?>';window.__TABLE='news';</script>
<script src="/ctrl/list.js?v=1"></script>
<?php layout_footer(); ?>
