<?php
$root = rtrim($_SERVER['DOCUMENT_ROOT'], '/');
require_once $root . '/_inc/shop.php';
require_once $root . '/api/db.php';
require_once $root . '/_inc/head.php';
require_once $root . '/_inc/layout.php';
require_once $root . '/_inc/fujoho.php';

$pdo = DB::conn();

// 最新お知らせ 4件
$st = $pdo->prepare(
    'SELECT id, title, thumb, body, posted_at
     FROM news WHERE shop_id=? AND is_display=1
     ORDER BY posted_at DESC, id DESC LIMIT 4'
);
$st->execute([SHOP_ID_DB]);
$latestNews = $st->fetchAll();

// 新人の女の子 8件
$st = $pdo->prepare(
    'SELECT id, name, age FROM girls
     WHERE shop_id=? AND is_display=1 AND is_newgirl=1
     ORDER BY sort ASC, id ASC LIMIT 8'
);
$st->execute([SHOP_ID_DB]);
$newFaces = $st->fetchAll();

// 新人サムネイル
$newFaceIds = array_column($newFaces, 'id');
$thumbMap   = [];
if ($newFaceIds) {
    $ph = implode(',', array_fill(0, count($newFaceIds), '?'));
    $im = $pdo->prepare("SELECT girl_id, path FROM girl_images WHERE girl_id IN ($ph) ORDER BY sort ASC, id ASC");
    $im->execute($newFaceIds);
    foreach ($im->fetchAll() as $r) {
        if (!isset($thumbMap[$r['girl_id']])) $thumbMap[$r['girl_id']] = $r['path'];
    }
}

$title = SHOP_FULL_NAME . ' | トップ';
$desc  = SHOP_CATCH . 'の老舗「' . SHOP_NAME . '」（since' . SHOP_SINCE . '）。厳選された素人の女の子をラブホテル・ご自宅までデリバリー。最新情報・新人の女の子・本日の出勤はこちら。';
site_head($title, $desc, 'https://kichifu.com/top');
site_header();
?>
<main>

  <!-- ヒーローバンド ======================================================== -->
  <section class="hero-bg" style="position:relative;min-height:58vh;display:flex;align-items:center;justify-content:center;overflow:hidden;">
    <div class="hero-scrim" style="position:absolute;inset:0;pointer-events:none;"></div>
    <span class="sparkle" style="top:18%;left:12%;font-size:1.25rem;animation-delay:0s"    aria-hidden="true">✦</span>
    <span class="sparkle" style="top:26%;left:84%;font-size:1rem;animation-delay:.7s"      aria-hidden="true">✧</span>
    <span class="sparkle" style="top:70%;left:88%;font-size:1.125rem;animation-delay:1.3s" aria-hidden="true">❤</span>

    <div style="position:relative;z-index:1;text-align:center;padding:64px 24px;max-width:760px;margin:0 auto;">
      <p class="neon-lav-glow" style="font-size:.75rem;letter-spacing:.35em;margin-bottom:16px;">
        ✦ <?= h(SHOP_CATCH) ?> ・ SINCE <?= SHOP_SINCE ?> ✦
      </p>
      <p class="font-script neon-pink-glow" style="font-size:clamp(3.5rem,11vw,5.5rem);line-height:1;margin-bottom:12px;">
        <?= h(SHOP_NAME_EN) ?>
      </p>
      <h1 class="holo-text" style="font-size:1.75rem;font-weight:800;margin-bottom:20px;">
        ハズレなしの素人娘を、あなたのもとへ ♡
      </h1>
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px;">
        <button type="button" data-reserve-open
                class="glossy-pill"
                style="padding:12px 32px;border-radius:9999px;font-size:1.0625rem;font-weight:700;color:#fff;border:none;">
          ご予約はこちら
        </button>
        <a href="tel:<?= h(SHOP_TEL_RAW) ?>"
           style="font-size:.875rem;color:var(--text-soft);text-decoration:underline;text-underline-offset:4px;">
          📞 <?= h(SHOP_TEL) ?>（受付 <?= h(SHOP_RECEPTION) ?>）
        </a>
      </div>
    </div>
  </section>

  <!-- お知らせ ============================================================== -->
  <section class="top-news-section">
    <div class="wrap-md">
      <div class="section-head">
        <span class="section-eyebrow holo-text">NEWS</span>
        <h2 class="section-title">最新情報</h2>
      </div>
      <?php if ($latestNews): ?>
      <div class="news-list">
        <?php foreach ($latestNews as $it):
          $date    = $it['posted_at'] ? substr(str_replace('-', '.', $it['posted_at']), 0, 10) : '';
          $excerpt = $it['body'] ? mb_strimwidth(strip_tags($it['body']), 0, 80, '…') : '';
        ?>
        <a href="/news/<?= (int)$it['id'] ?>" class="news-item">
          <?php if ($it['thumb']): ?>
            <img src="<?= h($it['thumb']) ?>" alt="" width="80" height="80" loading="lazy" class="news-thumb">
          <?php else: ?>
            <div class="news-no-thumb">📢</div>
          <?php endif; ?>
          <div class="news-meta">
            <p class="news-date"><?= h($date) ?></p>
            <h3 class="news-title"><?= h($it['title']) ?></h3>
            <?php if ($excerpt): ?><p class="news-excerpt"><?= h($excerpt) ?></p><?php endif; ?>
          </div>
        </a>
        <?php endforeach; ?>
      </div>
      <?php else: ?>
        <p class="empty-state">お知らせはまだありません</p>
      <?php endif; ?>
      <div class="section-more-wrap">
        <a href="/news" class="section-more glossy-pill">お知らせをもっと見る</a>
      </div>
    </div>
  </section>

  <!-- 新人の女の子 =========================================================== -->
  <section class="top-girls-section">
    <div class="wrap-lg">
      <div class="section-head">
        <span class="section-eyebrow holo-text">NEW FACE</span>
        <h2 class="section-title">新人の女の子</h2>
      </div>
      <?php if ($newFaces): ?>
      <div class="girl-grid">
        <?php foreach ($newFaces as $g):
          $photo = $thumbMap[$g['id']] ?? null;
          $age   = $g['age'] ? '（' . (int)$g['age'] . '）' : '';
        ?>
        <a href="/girls/<?= (int)$g['id'] ?>" class="girl-card">
          <div class="girl-card-img-wrap">
            <?php if ($photo): ?>
              <img src="<?= h($photo) ?>" alt="<?= h($g['name']) ?>"
                   width="300" height="400" loading="lazy" class="girl-card-img">
            <?php else: ?>
              <div class="girl-card-no-photo">👤</div>
            <?php endif; ?>
            <span class="girl-card-badge new">NEW</span>
            <div class="girl-card-info">
              <p class="girl-card-name"><?= h($g['name']) ?><span class="girl-card-age"><?= h($age) ?></span></p>
            </div>
          </div>
        </a>
        <?php endforeach; ?>
      </div>
      <?php else: ?>
        <p class="empty-state">現在新人情報はありません</p>
      <?php endif; ?>
      <div class="section-more-wrap">
        <a href="/girls" class="section-more glossy-pill">すけべな女の子を見る</a>
      </div>
    </div>
  </section>

  <!-- 口コミ風俗情報局 広告バナー =========================================== -->
  <?php fujoho_banners(); ?>

  <!-- 出勤リンク -->
  <div style="background:var(--bg-0);padding:0 0 48px;text-align:center;">
    <a href="<?= h(FUJOHO_SCHEDULE) ?>" target="_blank" rel="noopener"
       class="section-more glossy-pill">
      本日の出勤を見る
    </a>
  </div>

  <!-- バナーカード =========================================================== -->
  <section class="top-banner-section">
    <div class="top-banner-grid">
      <a href="/system" class="top-banner-card glass-card">
        <p class="holo-text top-banner-card-title">料金システム</p>
        <p class="text-mute top-banner-card-sub">時代に合わせた納得プライス</p>
      </a>
      <a href="<?= h(SHOP_LINE_URL) ?>" target="_blank" rel="noopener"
         class="top-banner-card" style="background:#06c755;">
        <p class="top-banner-card-title" style="color:#fff;">LINEで予約</p>
        <p class="top-banner-card-sub" style="color:rgba(255,255,255,.85);">当日予約はLINEがかんたん♪</p>
      </a>
    </div>
  </section>

</main>
<?php site_footer(); ?>
