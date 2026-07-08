<?php
// ============================================================
// girls-ssr.php — Astro SSG に含まれない新規女性の詳細ページ動的フォールバック
//   .htaccess: girls/[id].html が存在しない場合のみ到達する
//   （既存女性=SSG+girl-detail-refresh.jsで即時補正 / 新規女性=本SSR＝登録直後から404にならない）
//   shop_id はドメインで自動判定（admi系=1 / kichifu系=2）
//   head/header/footer は _ssr-shell.php（Site.astro と同一）に集約
//   マークアップは src/pages/girls/[id].astro と同一クラス構成（site.css/site.jsがそのまま効く）
//   ⚠️ [id].astro を変えたら本ファイルも合わせる（news/[id].astro ⇄ news-ssr.php と同じ二重管理）
// ============================================================
require_once __DIR__ . '/api/db.php';

$id      = (int)($_GET['id'] ?? 0);
$host    = $_SERVER['HTTP_HOST'] ?? '';
$shop_id = (str_contains($host, 'admi') || str_contains($host, 'biyobu')) ? 1 : 2;

if (!$id) { header('Location: /girls'); exit; }

try {
    $st = DB::conn()->prepare(
        'SELECT g.* FROM girls g
          WHERE g.id = ? AND EXISTS (SELECT 1 FROM girl_shops gs WHERE gs.girl_id = g.id AND gs.shop_id = ?)'
    );
    $st->execute([$id, $shop_id]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
    $g = null;
}

if (!$g) {
    http_response_code(404);
    header('Location: /girls');
    exit;
}

// 画像（sort順）
$images = [];
try {
    $st = DB::conn()->prepare('SELECT path FROM girl_images WHERE girl_id = ? ORDER BY sort, id');
    $st->execute([$id]);
    $images = array_column($st->fetchAll(PDO::FETCH_ASSOC), 'path');
} catch (Throwable $e) {}

// 特徴タグ
$tags = [];
try {
    $st = DB::conn()->prepare(
        'SELECT git.name FROM girl_image_tag_links gitl
           JOIN girl_image_tags git ON git.id = gitl.girl_image_tag_id
          WHERE gitl.girl_id = ? ORDER BY git.sort, git.id'
    );
    $st->execute([$id]);
    $tags = array_column($st->fetchAll(PDO::FETCH_ASSOC), 'name');
} catch (Throwable $e) {}

// プレイ（基本/オプション）
$basicPlay = $optionPlay = [];
try {
    $st = DB::conn()->prepare(
        'SELECT go.name, go.is_basic FROM girl_option_links gol
           JOIN girl_options go ON go.id = gol.girl_option_id
          WHERE gol.girl_id = ? ORDER BY go.is_basic DESC, go.sort, go.id'
    );
    $st->execute([$id]);
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $o) {
        if ((int)$o['is_basic'] === 1) $basicPlay[] = $o['name']; else $optionPlay[] = $o['name'];
    }
} catch (Throwable $e) {}

// プロフィール（女の子に質問、is_display=1のみ）
$profiles = [];
try {
    $st = DB::conn()->prepare(
        'SELECT gp.name, gpv.value
           FROM girl_profile_values gpv
           JOIN girl_profiles gp ON gp.id = gpv.girl_profile_id
          WHERE gpv.girl_id = ? AND gpv.is_display = 1 AND gpv.value != ""
          ORDER BY gp.sort, gp.id'
    );
    $st->execute([$id]);
    $profiles = $st->fetchAll(PDO::FETCH_ASSOC);
} catch (Throwable $e) {}

require __DIR__ . '/_ssr-shell.php';   // $SSR / ssr_head / ssr_header / ssr_footer / asset_url / ssr_h / ssr_localize_body

// 新人判定: 入店3ヶ月未満（config.ts isNewcomer と同ロジック）
$isNew = false;
if (!empty($g['in_date'])) {
    $isNew = substr($g['in_date'], 0, 10) >= date('Y-m-d', strtotime('-3 months'));
}

// HTML許可フィールド（お店からのメッセージ/本人一言）: 画像パス正規化＋電話の当店統一（news-ssrと同処理）
$richHtml = function (?string $html) use ($SSR): string {
    $s = (string)$html;
    if ($s === '') return '';
    $s = preg_replace('#https?://kichifu\.com(/uploads/)#', 'https://admi2888.com$1', $s);
    $s = preg_replace('#(?<=["\'])(/uploads/)#', 'https://admi2888.com$1', $s);
    return ssr_localize_body($s, $SSR);
};
$shopComment = $richHtml($g['shop_comment'] ?? '');
$ownComment  = $richHtml($g['comment'] ?? '');

$nameAge = $g['name'] . ($g['age'] ? '（' . (int)$g['age'] . '歳）' : '');
$title   = $nameAge . '｜' . $SSR['fullName'];
$tagPhrase = $tags ? implode('・', array_slice($tags, 0, 4)) : '';
if (!empty($g['catch_copy'])) {
    $desc = $g['name'] . ' — ' . $g['catch_copy'] . '。' . $SSR['catch'] . 'のアドミで活躍中。';
} elseif ($tagPhrase !== '') {
    $desc = $g['name'] . '（' . $tagPhrase . '）。' . $SSR['catch'] . 'のアドミ所属。プロフィール・スリーサイズをご覧ください。';
} else {
    $desc = $g['name'] . '｜' . $SSR['catch'] . 'のアドミ所属。プロフィール・スリーサイズをご覧ください。';
}

$schedWeekV = @filemtime(__DIR__ . '/schedule-week.js') ?: '1';

ssr_head($SSR, $title, $desc, false, ssr_canonical($SSR, '/girls/' . $id));
ssr_header($SSR);
?>
<main>
  <section class="page-section girl-detail-section">
    <div class="neon-room"></div>
    <div class="wrap-lg" style="position:relative;z-index:1">

      <nav class="breadcrumb">
        <a href="/top">トップ</a>
        <span class="breadcrumb-sep">›</span>
        <a href="/girls">すけべな女の子達</a>
        <span class="breadcrumb-sep">›</span>
      </nav>

      <h1 class="girl-detail-name" style="text-align:center;margin:4px 0 20px" aria-current="page"><?= ssr_h($g['name']) ?><?php if ($g['age']): ?><span class="girl-detail-age"><?= (int)$g['age'] ?>歳</span><?php endif; ?></h1>

      <div class="girl-detail-wrap" data-girl-id="<?= (int)$g['id'] ?>">

        <!-- 左: 写真 -->
        <div>
          <?php if ($images): ?>
          <div class="girl-main-wrap" data-lightbox-open>
            <img src="<?= ssr_h(asset_url($images[0])) ?>" alt="<?= ssr_h($g['name']) ?>"
                 width="640" height="853" class="girl-main-photo" id="girlMainPhoto" />
          </div>
          <?php else: ?>
          <div class="girl-main-photo" style="display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,var(--bg-2),var(--bg-1));font-size:4rem;color:rgba(255,79,216,.2)">👤</div>
          <?php endif; ?>

          <?php if (count($images) > 1): ?>
          <div class="girl-sub-photos">
            <?php foreach ($images as $i => $p): $u = asset_url($p); ?>
            <button type="button" class="girl-thumb<?= $i === 0 ? ' is-active' : '' ?>"
                    data-girl-thumb data-full="<?= ssr_h($u) ?>"
                    aria-label="<?= ssr_h($g['name']) ?> 写真<?= $i + 1 ?>">
              <img src="<?= ssr_h($u) ?>" alt="<?= ssr_h($g['name']) ?> 写真<?= $i + 1 ?>" width="200" height="267" loading="lazy" />
            </button>
            <?php endforeach; ?>
          </div>
          <?php endif; ?>
        </div>

        <!-- 右: 詳細 -->
        <div>
          <div class="girl-flags">
            <?php if ($isNew): ?><img src="/img/flag-newgirl.png" class="girl-flag-icon" width="128" height="128" alt="新人" title="新人" /><?php endif; ?>
            <?php if (!empty($g['is_trial'])): ?><img src="/img/flag-machiawase.png" class="girl-flag-icon" width="128" height="128" alt="待ち合わせ" title="待ち合わせ" /><?php endif; ?>
            <?php if (!empty($g['is_inbound'])): ?><img src="/img/flag-inbound.png" class="girl-flag-icon" width="128" height="128" alt="インバウンド" title="インバウンド" /><?php endif; ?>
            <?php if (!empty($g['is_genderless'])): ?><img src="/img/flag-genderless.png" class="girl-flag-icon" width="128" height="128" alt="ジェンダーレス" title="ジェンダーレス" /><?php endif; ?>
            <?php if (!empty($g['is_tel'])): ?><img src="/img/flag-tel.png" class="girl-flag-icon" width="128" height="128" alt="電話" title="電話" /><?php endif; ?>
          </div>

          <?php if (!empty($g['catch_copy'])): ?>
          <p class="girl-catch">「<?= ssr_h($g['catch_copy']) ?>」</p>
          <?php endif; ?>

          <?php if ($tags): ?>
          <div class="girl-tags">
            <?php foreach ($tags as $t): ?><span class="girl-tag-chip"><?= ssr_h($t) ?></span><?php endforeach; ?>
          </div>
          <?php endif; ?>

          <?php if ($g['height'] || $g['bust'] || $g['cup'] || $g['waist'] || $g['hip']): ?>
          <p class="section-label">身長・スリーサイズ</p>
          <div class="girl-size-grid">
            <div class="girl-size-item"><span class="girl-size-label">T</span><span class="girl-size-val"><?= $g['height'] ? (int)$g['height'] : '—' ?></span></div>
            <div class="girl-size-item"><span class="girl-size-label">B</span><span class="girl-size-val"><?= $g['bust'] ? (int)$g['bust'] : '—' ?></span></div>
            <div class="girl-size-item"><span class="girl-size-label">CUP</span><span class="girl-size-val"><?= $g['cup'] ? ssr_h($g['cup']) : '—' ?></span></div>
            <div class="girl-size-item"><span class="girl-size-label">W</span><span class="girl-size-val"><?= $g['waist'] ? (int)$g['waist'] : '—' ?></span></div>
            <div class="girl-size-item"><span class="girl-size-label">H</span><span class="girl-size-val"><?= $g['hip'] ? (int)$g['hip'] : '—' ?></span></div>
          </div>
          <?php endif; ?>

          <?php if ($shopComment !== ''): ?>
          <p class="section-label" style="font-size:.95rem;margin-top:32px">お店からのメッセージ</p>
          <div class="girl-shop-comment"><?= $shopComment ?></div>
          <?php endif; ?>

          <?php if ($profiles): ?>
          <p class="section-label" style="font-size:.95rem;margin-top:32px"><?= ssr_h($g['name']) ?>さんに質問</p>
          <table class="girl-profile-table">
            <?php foreach ($profiles as $pf): ?>
            <tr><th><?= ssr_h($pf['name']) ?></th><td><?= ssr_h($pf['value']) ?></td></tr>
            <?php endforeach; ?>
          </table>
          <?php endif; ?>

          <?php if ($basicPlay): ?>
          <p class="section-label play-label">基本プレイ</p>
          <div class="girl-options">
            <?php foreach ($basicPlay as $o): ?><span class="play-chip"><?= ssr_h($o) ?></span><?php endforeach; ?>
          </div>
          <?php endif; ?>

          <?php if ($optionPlay): ?>
          <p class="section-label play-label play-label-option">オプションプレイ</p>
          <div class="girl-options">
            <?php foreach ($optionPlay as $o): ?><span class="play-chip is-option"><?= ssr_h($o) ?></span><?php endforeach; ?>
          </div>
          <?php endif; ?>

          <!-- 週間出勤予定（schedule-week.js がAPIから取得して描画。出勤無し/失敗時は非表示） -->
          <div id="girl-week" class="girl-week" data-girl-id="<?= (int)$g['id'] ?>" style="display:none">
            <p class="section-label">📅 週間出勤予定</p>
            <div class="gw-body"></div>
          </div>

          <?php if ($ownComment !== ''): ?>
          <p class="section-label"><?= ssr_h($g['name']) ?>からの一言</p>
          <div class="comment-box"><?= $ownComment ?></div>
          <?php endif; ?>

        </div>
      </div><!-- /.girl-detail-wrap -->
    </div>
  </section>
</main>

<!-- ネオン・ライトボックス（site.js がイベント委譲で駆動） -->
<div class="lightbox" id="lightbox" data-lightbox aria-hidden="true" role="dialog" aria-label="<?= ssr_h($g['name']) ?> 写真ビューア">
  <button class="lightbox-close" data-lightbox-close aria-label="閉じる">✕</button>
  <button class="lightbox-nav lightbox-prev" data-lightbox-prev aria-label="前の写真">‹</button>
  <div class="lightbox-stage">
    <img class="lightbox-img" id="lightboxImg" src="" alt="<?= ssr_h($g['name']) ?>" />
    <span class="lightbox-sparkles" id="lightboxSparkles" aria-hidden="true"></span>
  </div>
  <button class="lightbox-nav lightbox-next" data-lightbox-next aria-label="次の写真">›</button>
  <div class="lightbox-dots" id="lightboxDots" aria-hidden="true"></div>
  <div class="lightbox-counter" id="lightboxCounter"></div>
</div>

<!-- 週間出勤予定（同一オリジンAPIから取得して #girl-week に描画） -->
<script src="/schedule-week.js?v=<?= $schedWeekV ?>"></script>
<?php ssr_footer($SSR); ?>
