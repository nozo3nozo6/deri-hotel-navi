<?php
$root = rtrim($_SERVER['DOCUMENT_ROOT'], '/');
require_once $root . '/_inc/shop.php';
require_once $root . '/api/db.php';
require_once $root . '/_inc/head.php';
require_once $root . '/_inc/layout.php';

$pdo = DB::conn();

$st = $pdo->prepare(
    'SELECT id, title, thumb, body, published_at
     FROM news WHERE shop_id=? AND is_display=1
     ORDER BY published_at DESC, id DESC'
);
$st->execute([SHOP_ID_DB]);
$items = $st->fetchAll();

$title = 'お知らせ｜' . SHOP_FULL_NAME;
$desc  = SHOP_NAME . 'の最新情報、キャンペーン、新人入店情報などをお届けします。';
site_head($title, $desc, 'https://kichifu.com/news');
site_header();
?>
<main>
  <section class="page-section">
    <div class="neon-room"></div>
    <div class="wrap-md" style="position:relative;z-index:1">

      <nav class="breadcrumb">
        <a href="/top">トップ</a>
        <span class="breadcrumb-sep">›</span>
        <span>お知らせ</span>
      </nav>

      <div class="section-head">
        <span class="section-eyebrow holo-text">NEWS</span>
        <h1 class="section-title">お知らせ</h1>
      </div>

      <?php if ($items): ?>
        <div class="news-list">
          <?php foreach ($items as $it):
            $date = $it['published_at'] ? substr(str_replace('-', '.', $it['published_at']), 0, 10) : '';
            $excerpt = $it['body'] ? mb_strimwidth(strip_tags($it['body']), 0, 80, '…') : '';
          ?>
            <a href="/news/<?= (int)$it['id'] ?>" class="news-item">
              <?php if ($it['thumb']): ?>
                <img src="<?= h($it['thumb']) ?>" alt="" width="112" height="112" loading="lazy" class="news-thumb">
              <?php else: ?>
                <div class="news-no-thumb">📢</div>
              <?php endif; ?>
              <div class="news-meta">
                <p class="news-date"><?= h($date) ?></p>
                <h2 class="news-title"><?= h($it['title']) ?></h2>
                <?php if ($excerpt): ?>
                  <p class="news-excerpt"><?= h($excerpt) ?></p>
                <?php endif; ?>
              </div>
            </a>
          <?php endforeach; ?>
        </div>
      <?php else: ?>
        <p class="empty-state">お知らせはまだありません</p>
      <?php endif; ?>

    </div>
  </section>
</main>
<?php site_footer(); ?>
