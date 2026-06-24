<?php
$root = rtrim($_SERVER['DOCUMENT_ROOT'], '/');
require_once $root . '/_inc/shop.php';
require_once $root . '/api/db.php';
require_once $root . '/_inc/head.php';
require_once $root . '/_inc/layout.php';

$pdo = DB::conn();

$girlsSt = $pdo->prepare('SELECT id, name FROM girls WHERE shop_id=? AND is_display=1 ORDER BY sort ASC, id ASC');
$girlsSt->execute([SHOP_ID_DB]);
$girls = $girlsSt->fetchAll();

$newsSt = $pdo->prepare('SELECT id, title FROM news WHERE shop_id=? AND is_display=1 ORDER BY posted_at DESC, id DESC LIMIT 20');
$newsSt->execute([SHOP_ID_DB]);
$newsItems = $newsSt->fetchAll();

$title = 'サイトマップ｜' . SHOP_FULL_NAME;
$desc  = SHOP_NAME . ' サイトマップ。各ページへのリンク一覧です。';
site_head($title, $desc, 'https://kichifu.com/sitemap');
site_header();
?>
<main>
  <section class="page-section">
    <div class="neon-room"></div>
    <div class="wrap-md" style="position:relative;z-index:1;">

      <nav class="breadcrumb">
        <a href="/top">トップ</a>
        <span class="breadcrumb-sep">›</span>
        <span>サイトマップ</span>
      </nav>

      <div class="section-head">
        <span class="section-eyebrow holo-text">SITEMAP</span>
        <h1 class="section-title">サイトマップ</h1>
      </div>

      <div class="sitemap-grid">

        <div>
          <p class="sitemap-group-title">メインメニュー</p>
          <ul class="sitemap-links">
            <li><a href="/top">トップ</a></li>
            <li><a href="/girls">すけべな女の子達</a></li>
            <li><a href="/news">お知らせ</a></li>
            <li><a href="/system">料金システム</a></li>
            <li><a href="/howto">ご利用方法</a></li>
            <li><a href="/contacts">お問い合わせ</a></li>
          </ul>

          <?php if ($newsItems): ?>
          <p class="sitemap-group-title" style="margin-top:32px;">お知らせ</p>
          <ul class="sitemap-links">
            <?php foreach ($newsItems as $it): ?>
            <li><a href="/news/<?= (int)$it['id'] ?>"><?= h($it['title']) ?></a></li>
            <?php endforeach; ?>
          </ul>
          <?php endif; ?>
        </div>

        <div>
          <?php if ($girls): ?>
          <p class="sitemap-group-title">すけべな女の子達</p>
          <ul class="sitemap-links">
            <?php foreach ($girls as $g): ?>
            <li><a href="/girls/<?= (int)$g['id'] ?>"><?= h($g['name']) ?></a></li>
            <?php endforeach; ?>
          </ul>
          <?php endif; ?>
        </div>

      </div>
    </div>
  </section>
</main>
<?php site_footer(); ?>
