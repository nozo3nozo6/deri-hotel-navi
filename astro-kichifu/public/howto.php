<?php
$root = rtrim($_SERVER['DOCUMENT_ROOT'], '/');
require_once $root . '/_inc/shop.php';
require_once $root . '/_inc/head.php';
require_once $root . '/_inc/layout.php';

$title = 'ご利用方法｜' . SHOP_FULL_NAME;
$desc  = SHOP_NAME . 'のご利用方法。ご予約から当日の流れをわかりやすくご説明します。';
site_head($title, $desc, 'https://kichifu.com/howto');
site_header();
?>
<main>
  <section class="page-section">
    <div class="neon-room"></div>
    <div class="wrap-md" style="position:relative;z-index:1;">

      <nav class="breadcrumb">
        <a href="/top">トップ</a>
        <span class="breadcrumb-sep">›</span>
        <span>ご利用方法</span>
      </nav>

      <div class="section-head">
        <span class="section-eyebrow holo-text">HOW TO</span>
        <h1 class="section-title">ご利用方法</h1>
      </div>

      <div class="steps-list">
        <?php
        $steps = [
            [
                'num'   => '1',
                'icon'  => '📞',
                'title' => 'ご予約',
                'desc'  => 'お電話またはLINEにてご連絡ください。ご希望のコース・お時間・ご希望の女の子などお気軽にご相談いただけます。',
            ],
            [
                'num'   => '2',
                'icon'  => '🏨',
                'title' => '待ち合わせ',
                'desc'  => '吉祥寺エリアのご指定のホテルまたはご自宅へお伺いします。待ち合わせ方法はご予約の際にご確認ください。',
            ],
            [
                'num'   => '3',
                'icon'  => '💳',
                'title' => 'お支払い',
                'desc'  => '現金でのお支払いをお願いします。料金はコース開始前にお願いしております。',
            ],
            [
                'num'   => '4',
                'icon'  => '💞',
                'title' => 'お楽しみ',
                'desc'  => '素敵なひとときをお過ごしください。ご不明な点はスタッフまでお気軽にお申し付けください。',
            ],
        ];
        foreach ($steps as $s): ?>
        <div class="step-row">
          <div class="step-num"><?= h($s['num']) ?></div>
          <div class="step-body">
            <p class="step-title"><?= h($s['icon']) ?> <?= h($s['title']) ?></p>
            <p class="step-desc"><?= h($s['desc']) ?></p>
          </div>
        </div>
        <?php endforeach; ?>
      </div>

      <!-- CTA -->
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:48px;justify-content:center;">
        <a href="<?= h(SHOP_LINE_URL) ?>" target="_blank" rel="noopener"
           style="display:inline-flex;align-items:center;gap:8px;padding:12px 28px;border-radius:9999px;font-weight:700;color:#fff;background:#06c755;">
          💬 LINEで予約
        </a>
        <a href="tel:<?= h(SHOP_TEL_RAW) ?>"
           class="glossy-pill"
           style="display:inline-flex;align-items:center;gap:8px;padding:12px 28px;border-radius:9999px;font-weight:700;color:#fff;">
          📞 <?= h(SHOP_TEL) ?>
        </a>
      </div>

    </div>
  </section>
</main>
<?php site_footer(); ?>
