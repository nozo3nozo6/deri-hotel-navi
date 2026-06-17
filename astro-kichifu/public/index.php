<?php
$root = rtrim($_SERVER['DOCUMENT_ROOT'], '/');
require_once $root . '/_inc/shop.php';
require_once $root . '/_inc/head.php';
require_once $root . '/_inc/layout.php';
require_once $root . '/_inc/fujoho.php';

$title = SHOP_NAME . ' since' . SHOP_SINCE . ' | ' . SHOP_CATCH . ' & Go To FANTASY';
$desc  = SHOP_CATCH . 'の老舗「' . SHOP_NAME . '」。since2009、ハズレなしの素人娘をあなたのもとへ。';
site_head($title, $desc, 'https://kichifu.com/');
site_header();
?>
<main>

  <!-- 年齢確認ゲート ===================================================== -->
  <section class="hero-bg" style="position:relative;min-height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden;padding-top:var(--header-h);">
    <div class="hero-scrim" style="position:absolute;inset:0;pointer-events:none;"></div>

    <span class="sparkle" style="top:14%;left:12%;font-size:1.5rem;animation-delay:0s"    aria-hidden="true">✦</span>
    <span class="sparkle" style="top:22%;left:80%;font-size:1rem;animation-delay:.6s"     aria-hidden="true">✧</span>
    <span class="sparkle" style="top:62%;left:8%;font-size:1.25rem;animation-delay:1.1s"  aria-hidden="true">✦</span>
    <span class="sparkle" style="top:72%;left:86%;font-size:1.125rem;animation-delay:1.6s"aria-hidden="true">❤</span>
    <span class="sparkle" style="top:40%;left:90%;font-size:.875rem;animation-delay:.9s"  aria-hidden="true">✧</span>
    <span class="sparkle" style="top:18%;left:46%;font-size:1rem;animation-delay:2.1s"    aria-hidden="true">✦</span>

    <div style="position:relative;z-index:1;text-align:center;padding:48px 24px 64px;max-width:900px;margin:0 auto;">

      <p class="reveal reveal-1 neon-lav-glow"
         style="font-size:.875rem;letter-spacing:.35em;margin-bottom:24px;font-weight:500;">
        ✦ 吉祥寺 ・ SINCE 2009 ✦
      </p>

      <h1 style="margin-bottom:12px;line-height:1;">
        <span class="reveal reveal-1 font-script flicker neon-pink-glow"
              style="display:block;font-size:clamp(4.5rem,14vw,7rem);line-height:1;">Admi</span>
        <span class="reveal reveal-2"
              style="display:block;font-size:1.25rem;font-weight:600;letter-spacing:.4em;margin-top:16px;
                     color:var(--lav-soft);text-shadow:0 2px 6px rgba(0,0,0,.95),0 0 16px rgba(183,143,255,.9);">
          ア ド ミ
        </span>
        <span class="reveal reveal-2"
              style="display:block;font-size:clamp(1.75rem,6vw,2.75rem);font-weight:800;color:#fff;
                     margin-top:20px;text-shadow:0 0 18px rgba(183,143,255,.5);">
          吉祥寺デリヘル
        </span>
      </h1>

      <p class="reveal reveal-3 holo-text"
         style="font-size:1.125rem;font-weight:700;margin-top:16px;margin-bottom:48px;">
        &amp; Go To FANTASY ♡
      </p>

      <div class="reveal reveal-3 glass-card"
           style="border-radius:28px;padding:24px 20px;max-width:460px;margin:0 auto;">
        <p class="text-mute" style="font-size:.875rem;margin-bottom:20px;letter-spacing:.04em;">
          ハズレなしの素人娘をあなたのもとへ
        </p>
        <a href="<?= h(FUJOHO_SHOP) ?>" rel="noopener"
           class="cta-enter"
           style="display:block;max-width:360px;margin:0 auto;"
           aria-label="18歳以上の方はこちらから入場する">
          <img src="/img/enter.png" alt="18歳以上の方はこちらから入場" width="813" height="312">
        </a>
      </div>

      <div class="reveal reveal-4" style="margin-top:32px;">
        <a href="https://www.yahoo.co.jp/" rel="noopener"
           style="font-size:.8125rem;color:var(--text-mute);text-decoration:underline;text-underline-offset:4px;">
          18歳未満の方はこちらよりご退出ください
        </a>
      </div>
    </div>
  </section>

  <!-- 口コミ風俗情報局 広告バナー =========================================== -->
  <?php fujoho_banners(); ?>

</main>
<?php site_footer(); ?>
