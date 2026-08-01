<?php
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_orders-lib.php';
layout_header('ダッシュボード', 'index.php');
$shop = current_shop_id();

function dash_count(string $sql, int $shop): string {
    try {
        $st = db()->prepare($sql);
        $st->execute([$shop]);
        return number_format((int)$st->fetchColumn());
    } catch (Throwable $e) {
        return '—';
    }
}

// ---- 本日の営業サマリ（営業日=朝5時区切り）----
$biz = orders_biz_date();
$ord = ['done' => 0, 'sum' => 0, 'active' => 0, 'reserved' => 0];
try {
    orders_ensure_tables();
    $st = db()->prepare('SELECT status, COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE shop_id=? AND biz_date=? GROUP BY status');
    $st->execute([$shop, $biz]);
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        if ($r['status'] === 'done')     { $ord['done'] = (int)$r['c']; $ord['sum'] = (int)$r['s']; }
        if ($r['status'] === 'active')   $ord['active'] = (int)$r['c'];
        if ($r['status'] === 'reserved') $ord['reserved'] = (int)$r['c'];
    }
} catch (Throwable $e) { /* テーブル未作成でもダッシュボードは落とさない */ }

$stats = [
    ['👩', '在籍女性',       dash_count('SELECT COUNT(*) FROM girls WHERE shop_id=? AND is_display=1', $shop), 'girls.php'],
    ['📅', '本日の出勤',     dash_count('SELECT COUNT(*) FROM schedules WHERE shop_id=? AND work_date=CURDATE() AND status="work"', $shop), 'schedules.php'],
    ['📰', 'お知らせ',       dash_count('SELECT COUNT(*) FROM news WHERE shop_id=?', $shop), 'news.php'],
    ['📨', '未読の問合せ',   dash_count('SELECT COUNT(*) FROM contacts WHERE shop_id=? AND is_read=0', $shop), 'contacts.php'],
];
?>
<div class="page-head" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
  <h1>ダッシュボード</h1>
  <a class="btn btn-primary" style="margin-left:auto" href="/ctrl/orders.php">📞 新規オーダー</a>
</div>

<div class="card card-pad" style="margin-bottom:16px">
  <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">
    <h2 style="margin:0;font-size:15px">📋 本日の営業（<?= h($biz) ?>・朝5時区切り）</h2>
    <a class="muted" style="font-size:12px" href="/ctrl/orders.php">オーダー表へ →</a>
  </div>
  <div class="stat-grid">
    <a class="stat" href="/ctrl/orders.php" style="text-decoration:none;color:inherit"><div class="l">✅ 完了</div><div class="n"><?= $ord['done'] ?>本</div></a>
    <a class="stat" href="/ctrl/orders.php" style="text-decoration:none;color:inherit"><div class="l">💰 売上</div><div class="n">¥<?= number_format($ord['sum']) ?></div></a>
    <a class="stat" href="/ctrl/orders.php" style="text-decoration:none;color:inherit"><div class="l">🏃 案内中</div><div class="n"><?= $ord['active'] ?></div></a>
    <a class="stat" href="/ctrl/orders.php" style="text-decoration:none;color:inherit"><div class="l">🕐 予約</div><div class="n"><?= $ord['reserved'] ?></div></a>
  </div>
</div>

<div class="stat-grid">
  <?php foreach ($stats as [$ic, $label, $n, $href]): ?>
    <a class="stat" href="/ctrl/<?= $href ?>" style="text-decoration:none;color:inherit">
      <div class="l"><?= $ic ?> <?= h($label) ?></div>
      <div class="n"><?= $n ?></div>
    </a>
  <?php endforeach; ?>
</div>

<div class="card card-pad" style="margin-top:24px">
  <h2 style="margin-top:0;font-size:16px">クイック操作</h2>
  <div style="display:flex;gap:10px;flex-wrap:wrap">
    <a class="btn btn-primary" href="/ctrl/girls.php">＋ 女性を登録</a>
    <a class="btn" href="/ctrl/schedules.php">出勤を編集</a>
    <a class="btn" href="/ctrl/news.php">お知らせを書く</a>
    <a class="btn" href="/ctrl/girl-diaries.php">写メ日記</a>
  </div>
</div>
<?php layout_footer(); ?>
