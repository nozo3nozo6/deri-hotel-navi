<?php
$root = rtrim($_SERVER['DOCUMENT_ROOT'], '/');
require_once $root . '/_inc/shop.php';
require_once $root . '/api/db.php';
require_once $root . '/_inc/head.php';
require_once $root . '/_inc/layout.php';

$id  = (int)($_GET['id'] ?? 0);
$pdo = DB::conn();

// 女の子情報
$st = $pdo->prepare('SELECT * FROM girls WHERE id=? AND shop_id=? AND is_display=1');
$st->execute([$id, SHOP_ID_DB]);
$g = $st->fetch();
if (!$g) {
    http_response_code(404);
    $title = 'ページが見つかりません｜' . SHOP_FULL_NAME;
    $desc  = '';
    site_head($title, $desc);
    site_header();
    echo '<main><div class="wrap-md" style="padding:80px 24px;text-align:center"><p class="empty-state">ページが見つかりません</p><p style="margin-top:24px"><a href="/girls" class="back-link">← すけべな女の子達に戻る</a></p></div></main>';
    site_footer();
    exit;
}

// 画像
$im = $pdo->prepare('SELECT id, path FROM girl_images WHERE girl_id=? ORDER BY sort ASC, id ASC');
$im->execute([$id]);
$images = $im->fetchAll();
$mainPhoto = $images[0]['path'] ?? null;

// 特徴タグ
$tg = $pdo->prepare(
    'SELECT git.name FROM girl_image_tag_links gitl
     JOIN girl_image_tags git ON git.id = gitl.girl_image_tag_id
     WHERE gitl.girl_id=? ORDER BY git.sort ASC, git.id ASC'
);
$tg->execute([$id]);
$imageTags = array_column($tg->fetchAll(), 'name');

// オプション（基本プレイ / オプションプレイに分割）
$oo = $pdo->prepare(
    'SELECT go.name, go.is_basic FROM girl_option_links gol
     JOIN girl_options go ON go.id = gol.girl_option_id
     WHERE gol.girl_id=? ORDER BY go.is_basic DESC, go.sort ASC, go.id ASC'
);
$oo->execute([$id]);
$options    = $oo->fetchAll();
$basicPlay  = array_values(array_filter($options, fn($o) => (int)$o['is_basic'] === 1));
$optionPlay = array_values(array_filter($options, fn($o) => (int)$o['is_basic'] === 0));

// プロフィール
$pp = $pdo->prepare(
    'SELECT gp.name, gpv.value FROM girl_profile_values gpv
     JOIN girl_profiles gp ON gp.id = gpv.girl_profile_id AND gp.shop_id=?
     WHERE gpv.girl_id=? AND gpv.is_display=1 AND gpv.value != ""
     ORDER BY gp.sort ASC, gp.id ASC'
);
$pp->execute([SHOP_ID_DB, $id]);
$profiles = $pp->fetchAll();

// SEO（特徴タグがあれば description に活用）
$nameAge = $g['name'] . (($g['age']) ? '（' . (int)$g['age'] . '歳）' : '');
$title   = $nameAge . '｜' . SHOP_FULL_NAME;
$tagPhrase = $imageTags ? implode('・', array_slice($imageTags, 0, 4)) : '';
if ($g['catch_copy']) {
    $desc = h($g['name']) . ' — ' . h($g['catch_copy']) . '。' . SHOP_CATCH . 'のアドミで活躍中。';
} elseif ($tagPhrase) {
    $desc = h($g['name']) . '（' . $tagPhrase . '）。' . SHOP_CATCH . 'のアドミ所属。プロフィール・スリーサイズをご覧ください。';
} else {
    $desc = $g['name'] . '｜' . SHOP_CATCH . 'のアドミ所属。プロフィール・スリーサイズをご覧ください。';
}
$canonical = 'https://kichifu.com/girls/' . $id;

site_head($title, $desc, $canonical);
site_header();
?>
<main>
  <section class="page-section">
    <div class="neon-room"></div>
    <div class="wrap-lg" style="position:relative;z-index:1">

      <nav class="breadcrumb">
        <a href="/top">トップ</a>
        <span class="breadcrumb-sep">›</span>
        <a href="/girls">すけべな女の子達</a>
        <span class="breadcrumb-sep">›</span>
        <span><?= h($g['name']) ?></span>
      </nav>

      <div class="girl-detail-wrap">

        <!-- 左: 写真 -->
        <div>
          <?php if ($mainPhoto): ?>
            <div class="girl-main-wrap" data-lightbox-open>
              <img src="<?= h($mainPhoto) ?>" alt="<?= h($g['name']) ?>"
                   width="640" height="853" class="girl-main-photo" id="girlMainPhoto">
            </div>
          <?php else: ?>
            <div class="girl-main-photo" style="display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,var(--bg-2),var(--bg-1));font-size:4rem;color:rgba(255,79,216,.2)">👤</div>
          <?php endif; ?>

          <?php if (count($images) > 1): ?>
            <div class="girl-sub-photos">
              <?php foreach ($images as $idx => $img): ?>
                <button type="button"
                        class="girl-thumb<?= $idx === 0 ? ' is-active' : '' ?>"
                        data-girl-thumb data-full="<?= h($img['path']) ?>"
                        aria-label="<?= h($g['name']) ?> 写真<?= $idx + 1 ?>">
                  <img src="<?= h($img['path']) ?>" alt="<?= h($g['name']) ?> 写真<?= $idx + 1 ?>"
                       width="200" height="267" loading="lazy">
                </button>
              <?php endforeach; ?>
            </div>
          <?php endif; ?>
        </div>

        <!-- 右: 詳細 -->
        <div>
          <!-- 名前・バッジ -->
          <div class="girl-flags">
            <?php if ($g['is_newgirl']): ?><span class="girl-flag-chip is-new">NEW</span><?php endif; ?>
            <?php if ($g['is_trial']):   ?><span class="girl-flag-chip is-trial">体験入店</span><?php endif; ?>
            <?php if ($g['is_tel']):     ?><span class="girl-flag-chip">電話</span><?php endif; ?>
            <?php if ($g['is_inbound']): ?><span class="girl-flag-chip">インバウンド</span><?php endif; ?>
            <?php if ($g['is_genderless']): ?><span class="girl-flag-chip">ジェンダーレス</span><?php endif; ?>
          </div>
          <h1 class="girl-detail-name"><?= h($g['name']) ?><?php if ($g['age']): ?><span class="girl-detail-age"><?= (int)$g['age'] ?>歳</span><?php endif; ?></h1>

          <?php if ($g['catch_copy']): ?>
            <p class="girl-catch">「<?= h($g['catch_copy']) ?>」</p>
          <?php endif; ?>

          <!-- 特徴タグ -->
          <?php if ($imageTags): ?>
          <div class="girl-tags">
            <?php foreach ($imageTags as $t): ?>
              <span class="girl-tag-chip"><?= h($t) ?></span>
            <?php endforeach; ?>
          </div>
          <?php endif; ?>

          <!-- スリーサイズ -->
          <?php if ($g['height'] || $g['bust'] || $g['cup'] || $g['waist'] || $g['hip']): ?>
          <p class="section-label">スリーサイズ</p>
          <div class="girl-size-grid">
            <div class="girl-size-item">
              <span class="girl-size-label">T</span>
              <span class="girl-size-val"><?= $g['height'] ? (int)$g['height'] : '—' ?></span>
            </div>
            <div class="girl-size-item">
              <span class="girl-size-label">B</span>
              <span class="girl-size-val"><?= $g['bust'] ? (int)$g['bust'] : '—' ?></span>
            </div>
            <div class="girl-size-item">
              <span class="girl-size-label">CUP</span>
              <span class="girl-size-val"><?= $g['cup'] ? h($g['cup']) : '—' ?></span>
            </div>
            <div class="girl-size-item">
              <span class="girl-size-label">W</span>
              <span class="girl-size-val"><?= $g['waist'] ? (int)$g['waist'] : '—' ?></span>
            </div>
          </div>
          <?php endif; ?>

          <!-- お店からのメッセージ（HTMLウィジェット可・そのまま描画） -->
          <?php if (!empty($g['shop_comment'])): ?>
          <p class="section-label">お店からのメッセージ</p>
          <div class="girl-shop-comment"><?= $g['shop_comment'] ?></div>
          <?php endif; ?>

          <!-- プロフィール（女の子に質問） -->
          <?php if ($profiles): ?>
          <p class="section-label">女の子に質問</p>
          <table class="girl-profile-table">
            <?php foreach ($profiles as $pf): ?>
              <tr>
                <th><?= h($pf['name']) ?></th>
                <td><?= h($pf['value']) ?></td>
              </tr>
            <?php endforeach; ?>
          </table>
          <?php endif; ?>

          <!-- 基本プレイ -->
          <?php if ($basicPlay): ?>
          <p class="section-label">基本プレイ</p>
          <div class="girl-options">
            <?php foreach ($basicPlay as $o): ?>
              <span class="neon-chip"><?= h($o['name']) ?></span>
            <?php endforeach; ?>
          </div>
          <?php endif; ?>

          <!-- オプションプレイ -->
          <?php if ($optionPlay): ?>
          <p class="section-label">オプションプレイ</p>
          <div class="girl-options">
            <?php foreach ($optionPlay as $o): ?>
              <span class="neon-chip is-option"><?= h($o['name']) ?></span>
            <?php endforeach; ?>
          </div>
          <?php endif; ?>

          <!-- 本人からの一言（HTMLウィジェット可・そのまま描画） -->
          <?php if (!empty($g['comment'])): ?>
          <p class="section-label"><?= h($g['name']) ?>からの一言</p>
          <div class="comment-box"><?= $g['comment'] ?></div>
          <?php endif; ?>

          <!-- 予約 CTA -->
          <div style="margin-top:32px;display:flex;flex-wrap:wrap;gap:12px">
            <a href="<?= h(SHOP_LINE_URL) ?>" target="_blank" rel="noopener"
               class="footer-cta-line" style="flex:1;min-width:180px;justify-content:center">
              💬 <?= h($g['name']) ?>に会いたい
            </a>
            <a href="tel:<?= h(SHOP_TEL_RAW) ?>"
               class="glossy-pill footer-cta-tel" style="flex:1;min-width:180px;justify-content:center">
              📞 電話で予約
            </a>
          </div>
        </div>

      </div><!-- /.girl-detail-wrap -->
    </div>
  </section>
</main>

<!-- ネオン・ライトボックス -->
<div class="lightbox" id="lightbox" data-lightbox aria-hidden="true" role="dialog" aria-label="<?= h($g['name']) ?> 写真ビューア">
  <button class="lightbox-close" data-lightbox-close aria-label="閉じる">✕</button>
  <button class="lightbox-nav lightbox-prev" data-lightbox-prev aria-label="前の写真">‹</button>
  <div class="lightbox-stage">
    <img class="lightbox-img" id="lightboxImg" src="" alt="<?= h($g['name']) ?>">
    <span class="lightbox-sparkles" id="lightboxSparkles" aria-hidden="true"></span>
  </div>
  <button class="lightbox-nav lightbox-next" data-lightbox-next aria-label="次の写真">›</button>
  <div class="lightbox-dots" id="lightboxDots" aria-hidden="true"></div>
  <div class="lightbox-counter" id="lightboxCounter"></div>
</div>
<?php site_footer(); ?>
