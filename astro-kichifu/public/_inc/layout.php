<?php
function site_header(): void { ?>
<body>
<header class="site-header">
  <div class="site-header-inner">
    <a href="/top" class="brand" aria-label="<?= h(SHOP_FULL_NAME) ?> トップ">
      <span class="brand-script flicker"><?= h(SHOP_NAME_EN) ?></span>
      <span class="brand-sub">
        <span class="brand-since">SINCE <?= SHOP_SINCE ?></span>
        <span class="brand-catch"><?= h(SHOP_CATCH) ?></span>
      </span>
    </a>
    <nav class="site-nav">
      <a href="/top">トップ</a>
      <a href="/girls">すけべな女の子</a>
      <a href="<?= h(FUJOHO_SCHEDULE) ?>" target="_blank" rel="noopener">スケジュール</a>
      <a href="/system">料金システム</a>
      <a href="/news">お知らせ</a>
    </nav>
    <div class="header-tel">
      <div class="header-reception">受付 <?= h(SHOP_RECEPTION) ?></div>
      <a href="tel:<?= h(SHOP_TEL_RAW) ?>" class="header-tel-num">📞 <?= h(SHOP_TEL) ?></a>
    </div>
    <button type="button" class="glossy-pill reserve-btn" data-reserve-open>ご予約</button>
    <button type="button" class="burger" data-menu-open aria-label="メニューを開く">
      <span></span><span></span><span></span>
    </button>
  </div>
</header>
<div class="header-spacer" aria-hidden="true"></div>
<?php }

function site_footer(): void { ?>
<footer class="site-footer">
  <div class="footer-inner">
    <hr class="holo-divider">
    <p class="footer-brand font-script neon-pink-glow flicker"><?= h(SHOP_NAME_EN) ?></p>
    <p class="footer-sub">since <?= SHOP_SINCE ?> ・ <?= h(SHOP_CATCH) ?> &amp; Go To FANTASY</p>
    <div class="footer-cta">
      <a href="tel:<?= h(SHOP_TEL_RAW) ?>" class="footer-cta-tel glossy-pill">📞 <?= h(SHOP_TEL) ?></a>
      <a href="<?= h(SHOP_LINE_URL) ?>" target="_blank" rel="noopener" class="footer-cta-line">💬 LINEで予約</a>
    </div>
    <p class="footer-reception">受付時間 <?= h(SHOP_RECEPTION) ?></p>
    <nav class="footer-links">
      <a href="/top">トップ</a>
      <a href="/girls">すけべな女の子</a>
      <a href="<?= h(FUJOHO_SCHEDULE) ?>" target="_blank" rel="noopener">スケジュール</a>
      <a href="/system">料金システム</a>
      <a href="/howto">ご利用ガイド</a>
      <a href="/news">お知らせ</a>
      <a href="<?= h(FUJOHO_DIARY) ?>" target="_blank" rel="noopener">写メ日記</a>
      <a href="<?= h(SHOP_RECRUIT_URL) ?>" target="_self">求人情報</a>
      <a href="/contacts">お問合せ</a>
    </nav>
    <p class="footer-copy">&copy; <?= SHOP_SINCE ?>-<?= date('Y') ?> <?= h(SHOP_FULL_NAME) ?> All Rights Reserved.</p>
  </div>
</footer>
<!-- オフキャンバスメニュー -->
<div class="offcanvas-overlay" data-menu-close></div>
<div class="offcanvas" id="offcanvas" role="navigation" aria-label="メニュー">
  <div class="offcanvas-head">
    <span class="font-script neon-pink-glow offcanvas-brand flicker"><?= h(SHOP_NAME_EN) ?></span>
    <button type="button" class="offcanvas-close" data-menu-close aria-label="閉じる">✕</button>
  </div>
  <nav class="offcanvas-nav">
    <a href="/top">トップ</a>
    <a href="/girls">すけべな女の子</a>
    <a href="<?= h(FUJOHO_SCHEDULE) ?>" target="_blank" rel="noopener">スケジュール</a>
    <a href="/system">料金システム</a>
    <a href="/howto">ご利用ガイド</a>
    <a href="/news">お知らせ</a>
    <a href="<?= h(FUJOHO_DIARY) ?>" target="_blank" rel="noopener">写メ日記</a>
    <a href="<?= h(SHOP_RECRUIT_URL) ?>" target="_self">求人情報</a>
    <a href="/contacts">お問合せ</a>
  </nav>
  <div class="offcanvas-foot">
    <button type="button" class="glossy-pill offcanvas-reserve-btn" data-reserve-open>ご予約はこちら</button>
    <a href="tel:<?= h(SHOP_TEL_RAW) ?>" class="offcanvas-tel-link">📞 <?= h(SHOP_TEL) ?><span class="text-mute">（受付 <?= h(SHOP_RECEPTION) ?>）</span></a>
  </div>
</div>
<!-- 予約モーダル -->
<div class="modal-overlay" id="reserve-modal" role="dialog" aria-modal="true" aria-label="ご予約" aria-hidden="true">
  <div class="modal-box">
    <div class="modal-head">
      <p class="modal-title holo-text">ご予約方法をお選びください</p>
      <button type="button" class="modal-close" data-reserve-close aria-label="閉じる">✕</button>
    </div>
    <div class="reserve-cards">
      <a href="<?= h(SHOP_LINE_URL) ?>" target="_blank" rel="noopener" class="reserve-card">
        <span class="reserve-icon">💬</span>
        <span>
          <span class="reserve-label">LINEで予約</span>
          <span class="reserve-note">当日予約はLINEがおすすめ！</span>
        </span>
      </a>
      <a href="tel:<?= h(SHOP_TEL_RAW) ?>" class="reserve-card">
        <span class="reserve-icon">📞</span>
        <span>
          <span class="reserve-label">TELで予約</span>
          <span class="reserve-note">明るく優しいスタッフが対応！</span>
        </span>
      </a>
    </div>
  </div>
</div>
<script src="/site.js?v=<?= @filemtime($_SERVER['DOCUMENT_ROOT'] . '/site.js') ?: '1' ?>"></script>
</body>
</html>
<?php } ?>
