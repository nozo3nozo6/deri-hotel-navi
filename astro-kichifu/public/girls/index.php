<?php
$root = rtrim($_SERVER['DOCUMENT_ROOT'], '/');
require_once $root . '/_inc/shop.php';
require_once $root . '/api/db.php';
require_once $root . '/_inc/head.php';
require_once $root . '/_inc/layout.php';

$pdo = DB::conn();

// 表示中の女の子一覧
$st = $pdo->prepare(
    'SELECT id, name, age, height, bust, cup, waist, hip,
            is_newgirl, is_trial, is_tel, is_inbound, is_genderless
     FROM girls WHERE shop_id=? AND is_display=1
     ORDER BY sort ASC, id ASC'
);
$st->execute([SHOP_ID_DB]);
$girls = $st->fetchAll();

// サムネイル（各女の子の先頭画像）
$imgMap = [];
$tagMap = [];
if ($girls) {
    $ids = array_column($girls, 'id');
    $ph  = implode(',', array_fill(0, count($ids), '?'));
    $im  = $pdo->prepare("SELECT girl_id, path FROM girl_images WHERE girl_id IN ($ph) ORDER BY sort ASC, id ASC");
    $im->execute($ids);
    foreach ($im->fetchAll() as $r) {
        if (!isset($imgMap[$r['girl_id']])) $imgMap[$r['girl_id']] = $r['path'];
    }
    // 特徴タグ（各カード最大3個表示用）
    $tg = $pdo->prepare(
        "SELECT gitl.girl_id, git.name FROM girl_image_tag_links gitl
         JOIN girl_image_tags git ON git.id = gitl.girl_image_tag_id
         WHERE gitl.girl_id IN ($ph) ORDER BY git.sort ASC, git.id ASC"
    );
    $tg->execute($ids);
    foreach ($tg->fetchAll() as $r) $tagMap[$r['girl_id']][] = $r['name'];
}

$title = '女の子一覧｜' . SHOP_FULL_NAME;
$desc  = SHOP_NAME . '（' . SHOP_CATCH . '）の在籍女の子一覧。厳選された女の子をご紹介します。';
site_head($title, $desc, 'https://kichifu.com/girls');
site_header();
?>
<main>
  <section class="page-section">
    <div class="neon-room"></div>
    <div class="wrap-lg" style="position:relative;z-index:1">

      <nav class="breadcrumb">
        <a href="/top">トップ</a>
        <span class="breadcrumb-sep">›</span>
        <span>女の子一覧</span>
      </nav>

      <div class="section-head">
        <span class="section-eyebrow holo-text">GIRLS</span>
        <h1 class="section-title">スケベGirls</h1>
      </div>

      <?php if ($girls): ?>
      <div class="girl-grid">
        <?php foreach ($girls as $g):
          $photo = $imgMap[$g['id']] ?? null;
          $age    = $g['age'] ? '(' . (int)$g['age'] . ')' : '';
          $sizes  = 'T' . ($g['height'] ?: '—') . ' B' . ($g['bust'] ?: '—') . '(' . ($g['cup'] ?: '—') . ') W' . ($g['waist'] ?: '—') . ' H' . ($g['hip'] ?: '—');
          $tags  = $tagMap[$g['id']] ?? [];
          if (!$tags) {
            if ($g['is_tel'])        $tags[] = '電話';
            if ($g['is_inbound'])    $tags[] = 'インバウンド';
            if ($g['is_genderless']) $tags[] = 'ジェンダーレス';
          }
        ?>
          <a href="/girls/<?= (int)$g['id'] ?>" class="girl-card">
            <div class="girl-card-img-wrap">
              <?php if ($photo): ?>
                <img src="<?= h($photo) ?>" alt="<?= h($g['name']) ?>"
                     width="300" height="400" loading="lazy" class="girl-card-img">
              <?php else: ?>
                <div class="girl-card-no-photo">👤</div>
              <?php endif; ?>
              <?php if ($g['is_newgirl']): ?><span class="girl-card-badge new">NEW</span><?php endif; ?>
              <?php if ($g['is_trial']):   ?><span class="girl-card-badge trial">体験</span><?php endif; ?>
              <div class="girl-card-info">
                <p class="girl-card-name"><?= h($g['name']) ?><span class="girl-card-age"><?= h($age) ?></span></p>
                <p class="girl-card-size"><?= h($sizes) ?></p>
              </div>
            </div>
            <?php if ($tags): ?>
              <div class="girl-card-tags">
                <?php foreach (array_slice($tags, 0, 4) as $tag): ?>
                  <span class="girl-card-tag-ico" title="<?= h($tag) ?>" aria-label="<?= h($tag) ?>"><?= tag_emoji($tag) ?></span>
                <?php endforeach; ?>
              </div>
            <?php endif; ?>
          </a>
        <?php endforeach; ?>
      </div>
      <?php else: ?>
        <p class="empty-state">現在在籍中の女の子はいません</p>
      <?php endif; ?>

    </div>
  </section>
</main>
<?php site_footer(); ?>
