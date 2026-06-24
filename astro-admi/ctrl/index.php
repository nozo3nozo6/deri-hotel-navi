<?php
require_once __DIR__ . '/_lib.php';
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
$stats = [
    ['👩', '在籍女性',       dash_count('SELECT COUNT(*) FROM girls WHERE shop_id=? AND is_display=1', $shop), 'girls.php'],
    ['📅', '本日の出勤',     dash_count('SELECT COUNT(*) FROM schedules WHERE shop_id=? AND work_date=CURDATE() AND status="work"', $shop), 'schedules.php'],
    ['📰', 'お知らせ',       dash_count('SELECT COUNT(*) FROM news WHERE shop_id=?', $shop), 'news.php'],
    ['📨', '未読の問合せ',   dash_count('SELECT COUNT(*) FROM contacts WHERE shop_id=? AND is_read=0', $shop), 'contacts.php'],
];
?>
<div class="page-head"><h1>ダッシュボード</h1></div>

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
