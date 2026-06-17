<?php
$root = rtrim($_SERVER['DOCUMENT_ROOT'], '/');
require_once $root . '/_inc/shop.php';
require_once $root . '/_inc/head.php';
require_once $root . '/_inc/layout.php';

$title = '料金システム｜' . SHOP_FULL_NAME;
$desc  = SHOP_NAME . 'の料金システム。60分〜180分コース、各種オプション料金をご確認ください。';
site_head($title, $desc, 'https://kichifu.com/system');
site_header();
?>
<main>
  <section class="page-section">
    <div class="neon-room"></div>
    <div class="wrap-md" style="position:relative;z-index:1;">

      <nav class="breadcrumb">
        <a href="/top">トップ</a>
        <span class="breadcrumb-sep">›</span>
        <span>料金システム</span>
      </nav>

      <div class="section-head">
        <span class="section-eyebrow holo-text">SYSTEM</span>
        <h1 class="section-title">料金システム</h1>
      </div>

      <!-- コース料金 -->
      <p class="section-label" style="margin-bottom:16px;">コース料金</p>
      <div class="course-list" style="margin-bottom:40px;">
        <?php
        $courses = [
            ['time' => '60分',  'price' => '¥11,000'],
            ['time' => '90分',  'price' => '¥16,500'],
            ['time' => '120分', 'price' => '¥22,000'],
            ['time' => '150分', 'price' => '¥27,500'],
            ['time' => '180分', 'price' => '¥33,000'],
        ];
        foreach ($courses as $c): ?>
        <div class="course-row">
          <span class="course-time"><?= h($c['time']) ?></span>
          <span class="course-price"><?= h($c['price']) ?></span>
        </div>
        <?php endforeach; ?>
      </div>

      <!-- オプション -->
      <p class="section-label" style="margin-bottom:16px;">オプション・その他</p>
      <ul class="extras-list" style="margin-bottom:40px;">
        <li><span style="flex:1;">延長30分</span><span style="color:var(--neon-pink);font-weight:700;">¥5,500</span></li>
        <li><span style="flex:1;">指名料</span><span style="color:var(--text-mute);">要確認</span></li>
        <li><span style="flex:1;">交通費</span><span style="color:var(--text-mute);">エリアにより変動</span></li>
      </ul>

      <div class="system-note">
        ※ 料金はすべて税込です。<br>
        ※ 詳細はお電話またはLINEにてお気軽にお問い合わせください。<br>
        ※ 料金は予告なく変更となる場合がございます。
      </div>

      <!-- CTA -->
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:40px;justify-content:center;">
        <a href="<?= h(SHOP_LINE_URL) ?>" target="_blank" rel="noopener"
           style="display:inline-flex;align-items:center;gap:8px;padding:12px 28px;border-radius:9999px;font-weight:700;color:#fff;background:#06c755;">
          💬 LINEで予約
        </a>
        <a href="tel:<?= h(SHOP_TEL_RAW) ?>"
           class="glossy-pill"
           style="display:inline-flex;align-items:center;gap:8px;padding:12px 28px;border-radius:9999px;font-weight:700;color:#fff;">
          📞 電話で予約
        </a>
      </div>

    </div>
  </section>
</main>
<?php site_footer(); ?>
