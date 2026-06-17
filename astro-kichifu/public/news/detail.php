<?php
$root = rtrim($_SERVER['DOCUMENT_ROOT'], '/');
require_once $root . '/_inc/shop.php';
require_once $root . '/api/db.php';
require_once $root . '/_inc/head.php';
require_once $root . '/_inc/layout.php';

$id  = (int)($_GET['id'] ?? 0);
$pdo = DB::conn();

$st = $pdo->prepare('SELECT * FROM news WHERE id=? AND shop_id=? AND is_display=1');
$st->execute([$id, SHOP_ID_DB]);
$it = $st->fetch();

if (!$it) {
    http_response_code(404);
    $title = 'ページが見つかりません｜' . SHOP_FULL_NAME;
    site_head($title, '');
    site_header();
    echo '<main><div class="wrap-md" style="padding:80px 24px;text-align:center"><p class="empty-state">ページが見つかりません</p><p style="margin-top:24px"><a href="/news" class="back-link">← お知らせ一覧に戻る</a></p></div></main>';
    site_footer();
    exit;
}

$date      = $it['posted_at'] ? substr(str_replace('-', '.', $it['posted_at']), 0, 10) : '';
$excerpt   = $it['body'] ? mb_strimwidth(strip_tags($it['body']), 0, 120, '…') : '';
$title     = h($it['title']) . '｜' . SHOP_FULL_NAME;
$desc      = $excerpt ?: SHOP_NAME . 'からのお知らせです。';
$canonical = 'https://kichifu.com/news/' . $id;

site_head($title, $desc, $canonical);
site_header();
?>
<main>
  <section class="page-section">
    <div class="neon-room"></div>
    <div class="wrap-md" style="position:relative;z-index:1">

      <nav class="breadcrumb">
        <a href="/top">トップ</a>
        <span class="breadcrumb-sep">›</span>
        <a href="/news">お知らせ</a>
        <span class="breadcrumb-sep">›</span>
        <span><?= h($it['title']) ?></span>
      </nav>

      <p class="news-detail-date"><?= h($date) ?></p>
      <h1 class="news-detail-title"><?= h($it['title']) ?></h1>

      <?php if ($it['thumb']): ?>
        <img src="<?= h($it['thumb']) ?>" alt=""
             width="860" height="400" loading="lazy" class="news-detail-thumb">
      <?php endif; ?>

      <?php if ($it['body']): ?>
        <div class="prose-neon">
          <?php
          // 本文: 改行→<p>タグ、URLをリンク化
          $paras = array_filter(array_map('trim', explode("\n\n", trim($it['body']))));
          foreach ($paras as $p):
          ?>
            <p><?= nl2br(h($p)) ?></p>
          <?php endforeach; ?>
        </div>
      <?php endif; ?>

      <p style="margin-top:40px">
        <a href="/news" class="back-link">← お知らせ一覧に戻る</a>
      </p>

    </div>
  </section>
</main>
<?php site_footer(); ?>
