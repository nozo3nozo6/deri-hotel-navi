<?php
// ============================================================
// _ssr-shell.php — news-ssr.php / diary-ssr.php 共通の head/header/footer/offcanvas/予約モーダル
//   Site.astro と同じ見た目・動作にするための単一ソース（news/diary SSR間のドリフト防止）。
//   呼び出し側で $shop_id を確定してから require する。直アクセスは関数定義のみで無害。
//   画像実体は admi2888.com に物理集約（kichifu はsymlink）→ asset_url() は admi2888 絶対URL化。
// ============================================================

if (!isset($shop_id)) { $shop_id = 2; }

// 店舗別設定（admi=1 / kichifu=2）。Site.astro / lib/config.ts と同期。
$SSR_SHOPS = [
    1 => [
        'tel' => '042-528-2888', 'telRaw' => '0425282888', 'reception' => '10:00〜翌5:00',
        'since' => 2002, 'catch' => '立川デリヘル', 'genre' => 'すけべな素人専門店',
        'brandCatch' => 'アドミ since2002',
        'fullName' => 'アドミsince2002立川デリヘル&Go To FANTASY東京本店',
        'line' => 'https://line.me/ti/p/L4-1uY6q2e',
        'recruit' => 'https://kanto.qzin.jp/admi2888/?v=official',
        'fid' => '57', 'ga' => 'G-50Q48YG34Z',
        'news_url' => 'https://ranking-deli.jp/tokyo/area39/style2/4517/news/', 'show_contact' => false,
    ],
    2 => [
        'tel' => '090-1045-9155', 'telRaw' => '09010459155', 'reception' => '10:00〜翌5:00',
        'since' => 2009, 'catch' => '吉祥寺デリヘル', 'genre' => 'すけべな素人専門店',
        'brandCatch' => 'アドミ since2009',
        'fullName' => 'アドミsince2009吉祥寺デリヘル&Go To FANTASY東京吉祥寺店',
        'line' => 'https://line.me/ti/p/L4-1uY6q2e',
        'recruit' => 'https://kanto.qzin.jp/admi2888/?v=official',
        'fid' => '53179', 'ga' => 'G-VJ1TW4WBYN',
        'news_url' => '/news', 'show_contact' => true,
    ],
];
$SSR = $SSR_SHOPS[$shop_id] ?? $SSR_SHOPS[2];
$SSR['_id']        = $shop_id;
$SSR['nameEn']     = 'Admi';
$SSR['fjSchedule'] = "https://fujoho.jp/index.php?p=shop_info&id={$SSR['fid']}&h=ON";
$SSR['fjDiary']    = "https://fujoho.jp/index.php?p=shop_girl_blog_list&id={$SSR['fid']}";

if (!function_exists('ssr_h')) {
    function ssr_h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
}
if (!function_exists('ssr_localize_body')) {
    // お知らせ本文の電話番号を「閲覧店舗の番号」に統一する。
    //   立川/吉祥寺は別店舗だが CTRL の2店舗掲載で一方の本文がもう一方にも反映され、本文CTAに
    //   登録店の電話が直書きされている。表示店の番号へ置換しないと他店番号が出る（吉祥寺記事に立川042）。
    //   Astro 側 localizeBody() と同ロジック（SSGとSSRで挙動を一致させる）。
    function ssr_localize_body(string $html, array $S): string {
        if ($html === '') return $html;
        $html = str_replace(['042-528-2888', '090-1045-9155'], $S['tel'], $html);   // 整形
        $html = str_replace(['0425282888', '09010459155'], $S['telRaw'], $html);    // tel:用raw
        return $html;
    }
}
if (!function_exists('asset_url')) {
    // 画像の正は admi2888.com（_lib.php / news-latest.js と同方針）。旧 kichifu 絶対URL・相対 /uploads/ を admi2888 に正規化。
    function asset_url(?string $p): string {
        if (!$p) return '';
        if (str_starts_with($p, 'http')) {
            return preg_replace('#https?://kichifu\.com(/uploads/)#', 'https://admi2888.com$1', $p);
        }
        if (str_starts_with($p, '/uploads/')) return 'https://admi2888.com' . $p;
        return $p;
    }
}

// 正規URL: 店舗ドメイン + パス（www無し・https）。shop_id で確定＝Host偽装耐性。
if (!function_exists('ssr_canonical')) {
    function ssr_canonical(array $S, string $path): string {
        $host = ((int)($S['_id'] ?? 2) === 1) ? 'admi2888.com' : 'kichifu.com';
        return 'https://' . $host . $path;
    }
}

// <head> ～ <body> 開始まで出力
//   $noindex=true でこのページのみ noindex,follow（写メ日記=fujoho転載でindex対象外）。既定=index,follow。
//   $canonical を渡すと canonical/og:url を出力（未指定＝出さない）。
//   ⚠️ news は index、diary のみ noindex。以前 robots を noindex 固定にしていたため
//      常時SSR配信の /news/* が全て noindex になり GSC 除外された（2026-07-05 修正）。
function ssr_head(array $S, string $title, string $desc, bool $noindex = false, string $canonical = ''): void {
    $cssV = @filemtime(__DIR__ . '/site.css') ?: '1';
    $i18nV = @filemtime(__DIR__ . '/i18n.js') ?: '1';
    $contentI18nV = @filemtime(__DIR__ . '/content-i18n.js') ?: '1';
    ?><!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title><?= ssr_h($title) ?></title>
<meta name="description" content="<?= ssr_h($desc) ?>" />
<meta name="robots" content="<?= $noindex ? 'noindex, follow' : 'index, follow' ?>" />
<?php if ($canonical !== '') : ?>
<link rel="canonical" href="<?= ssr_h($canonical) ?>" />
<meta property="og:url" content="<?= ssr_h($canonical) ?>" />
<?php endif; ?>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Pacifico&family=M+PLUS+Rounded+1c:wght@400;700;800&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/site.css?v=<?= $cssV ?>" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<script async src="https://www.googletagmanager.com/gtag/js?id=<?= ssr_h($S['ga']) ?>"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','<?= ssr_h($S['ga']) ?>');</script>
<script>window.__SHOP_ID=<?= (int)$S['_id'] ?>;</script>
<!-- 多言語対応: i18n.js(静的UIラベル・言語切替の中枢) → content-i18n.js(動的コンテンツの機械翻訳)。Site.astroと同期 -->
<script src="/i18n.js?v=<?= $i18nV ?>"></script>
<script src="/content-i18n.js?v=<?= $contentI18nV ?>"></script>
</head>
<body>
<?php
}

// ヘッダー（Site.astro と同一構造: ロゴ＋キャッチ＋ナビ＋電話＋予約＋ハンバーガー）
function ssr_header(array $S): void {
    ?>
<header class="site-header">
  <div class="site-header-inner">
    <a href="/top" class="brand" aria-label="<?= ssr_h($S['fullName']) ?> トップ">
      <span class="brand-script flicker"><?= ssr_h($S['nameEn']) ?></span>
      <span class="brand-sub">
        <span class="brand-since"><?= ssr_h($S['catch']) ?></span>
        <span class="brand-genre"><?= ssr_h($S['genre']) ?></span>
        <span class="brand-catch"><?= ssr_h($S['brandCatch']) ?></span>
      </span>
    </a>
    <nav class="site-nav">
      <a href="/top" data-i18n="nav_top">トップ</a>
      <a href="/girls" data-i18n="nav_girls">すけべな女の子達</a>
      <a href="<?= ssr_h($S['fjSchedule']) ?>" target="_self" rel="noopener" data-i18n="nav_schedule">スケジュール</a>
      <a href="/system" data-i18n="nav_system">料金システム</a>
      <a href="<?= ssr_h($S['news_url'] ?? '/news') ?>" target="_self" rel="noopener" data-i18n="nav_news">お知らせ</a>
    </nav>
    <div class="header-tel">
      <div class="header-reception"><span data-i18n="header_reception_label">受付</span> <?= ssr_h($S['reception']) ?></div>
      <a href="tel:<?= ssr_h($S['telRaw']) ?>" class="header-tel-num">📞 <?= ssr_h($S['tel']) ?></a>
    </div>
    <div class="reserve-stack">
      <span class="reserve-hours" data-i18n="reserve_hours_label">営業時間</span>
      <span class="reserve-time"><?= ssr_h($S['reception']) ?></span>
      <button type="button" class="glossy-pill reserve-btn" data-reserve-open data-i18n="btn_reserve">ご予約</button>
    </div>
    <button type="button" class="burger" data-menu-open aria-label="メニューを開く" data-i18n-attr="aria-label=menu_open_label">
      <span></span><span></span><span></span>
    </button>
  </div>
</header>
<div class="header-spacer" aria-hidden="true"></div>
<?php
}

// 戻るバー＋フッター＋オフキャンバス＋予約モーダル＋site.js（Site.astro と同一）
function ssr_footer(array $S): void {
    $jsV  = @filemtime(__DIR__ . '/site.js') ?: '1';
    $year = date('Y');
    ?>
<div class="back-bar">
  <button type="button" class="back-bar-btn" onclick="history.back()" data-i18n="btn_back">← 前へ戻る</button>
</div>
<footer class="site-footer">
  <hr class="footer-top-divider" />
  <div class="footer-inner">
    <p class="footer-brand font-script neon-pink-glow flicker"><?= ssr_h($S['nameEn']) ?></p>
    <p class="footer-sub">since <?= ssr_h($S['since']) ?> ・ <?= ssr_h($S['catch']) ?> &amp; Go To FANTASY</p>
    <div class="footer-cta">
      <a href="tel:<?= ssr_h($S['telRaw']) ?>" class="footer-cta-tel glossy-pill" data-i18n="footer_cta_tel">📞 電話で予約</a>
      <a href="<?= ssr_h($S['line']) ?>" target="_self" rel="noopener" class="footer-cta-line" data-i18n="footer_cta_line">💬 LINEで予約</a>
      <p class="footer-cta-note" data-i18n-html="footer_cta_note_html">💝 LINEのご予約で<span class="footer-cta-note-em">プレイ時間＋10分無料</span>！</p>
    </div>
    <p class="footer-reception"><span data-i18n="footer_reception_label">受付時間</span> <?= ssr_h($S['reception']) ?></p>
    <nav class="footer-links">
      <a href="/top" data-i18n="nav_top">トップ</a>
      <a href="/girls" data-i18n="nav_girls">すけべな女の子達</a>
      <a href="/schedule" target="_self" data-i18n="nav_schedule">スケジュール</a>
      <a href="/system" data-i18n="nav_system">料金システム</a>
      <a href="/howto" data-i18n="nav_howto">ご利用ガイド</a>
      <?php if (($S['_id'] ?? 2) === 1): ?><a href="/guide">立川デリヘルガイド</a><?php endif; ?>
      <a href="<?= ssr_h($S['news_url'] ?? '/news') ?>" target="_self" rel="noopener" data-i18n="nav_news">お知らせ</a>
      <a href="<?= ssr_h($S['fjDiary']) ?>" target="_self" rel="noopener" data-i18n="nav_diary">写メ日記</a>
      <a href="<?= ssr_h($S['recruit']) ?>" target="_self" data-i18n="nav_recruit">求人情報</a>
      <?php if ($S['show_contact'] ?? true): ?><a href="/contacts" data-i18n="nav_contacts">お問合せ</a><?php endif; ?>
    </nav>
    <p class="footer-copy">&copy; <?= ssr_h($S['since']) ?>-<?= $year ?> <?= ssr_h($S['fullName']) ?> All Rights Reserved.</p>
  </div>
</footer>

<div class="offcanvas-overlay" data-menu-close></div>
<div class="offcanvas" id="offcanvas" role="navigation" aria-label="メニュー">
  <div class="offcanvas-head">
    <a href="/top" class="brand" aria-label="<?= ssr_h($S['fullName']) ?> トップ">
      <span class="brand-script flicker"><?= ssr_h($S['nameEn']) ?></span>
      <span class="brand-sub">
        <span class="brand-since"><?= ssr_h($S['catch']) ?></span>
        <span class="brand-genre"><?= ssr_h($S['genre']) ?></span>
        <span class="brand-catch"><?= ssr_h($S['brandCatch']) ?></span>
      </span>
    </a>
    <button type="button" class="offcanvas-close" data-menu-close aria-label="閉じる" data-i18n-attr="aria-label=menu_close_label">✕</button>
  </div>
  <nav class="offcanvas-nav">
    <a href="/top" data-i18n="nav_top">トップ</a>
    <a href="/girls" data-i18n="nav_girls">すけべな女の子達</a>
    <a href="<?= ssr_h($S['fjSchedule']) ?>" target="_self" rel="noopener" data-i18n="nav_schedule">スケジュール</a>
    <a href="/system" data-i18n="nav_system">料金システム</a>
    <a href="/howto" data-i18n="nav_howto">ご利用ガイド</a>
    <a href="<?= ssr_h($S['news_url'] ?? '/news') ?>" target="_self" rel="noopener" data-i18n="nav_news">お知らせ</a>
    <a href="<?= ssr_h($S['fjDiary']) ?>" target="_self" rel="noopener" data-i18n="nav_diary">写メ日記</a>
    <a href="<?= ssr_h($S['recruit']) ?>" target="_self" data-i18n="nav_recruit">求人情報</a>
    <?php if ($S['show_contact'] ?? true): ?><a href="/contacts" data-i18n="nav_contacts">お問合せ</a><?php endif; ?>
  </nav>
  <div class="offcanvas-foot">
    <button type="button" class="glossy-pill offcanvas-reserve-btn" data-reserve-open data-i18n="offcanvas_reserve_btn">ご予約はこちら</button>
    <a href="tel:<?= ssr_h($S['telRaw']) ?>" class="offcanvas-tel-link">📞 <?= ssr_h($S['tel']) ?><br /><span class="text-mute">(<span data-i18n="header_reception_label">受付</span> <?= ssr_h($S['reception']) ?>)</span></a>
  </div>
</div>

<div class="modal-overlay" id="reserve-modal" role="dialog" aria-modal="true" aria-label="ご予約" aria-hidden="true">
  <div class="modal-box">
    <div class="modal-head">
      <p class="modal-title holo-text" data-i18n="modal_reserve_title">ご予約方法をお選びください</p>
      <button type="button" class="modal-close" data-reserve-close aria-label="閉じる" data-i18n-attr="aria-label=menu_close_label">✕</button>
    </div>
    <p class="modal-sub" data-i18n="modal_reserve_sub">お問い合わせだけでもお気軽にどうぞ♡</p>
    <div class="reserve-cards">
      <a href="tel:<?= ssr_h($S['telRaw']) ?>" class="reserve-card">
        <span class="reserve-icon">📞</span>
        <span>
          <span class="reserve-label" data-i18n="modal_tel_label">TELで予約</span>
          <span class="reserve-note" data-i18n="modal_tel_note">明るく優しいスタッフが対応！</span>
        </span>
      </a>
      <a href="<?= ssr_h($S['line']) ?>" target="_self" rel="noopener" class="reserve-card">
        <span class="reserve-icon">💬</span>
        <span>
          <span class="reserve-label" data-i18n="modal_line_label">LINEで予約</span>
          <span class="reserve-note" data-i18n="modal_line_note">ご予約でプレイ時間＋10分無料！</span>
        </span>
      </a>
    </div>
  </div>
</div>
<script src="/site.js?v=<?= $jsV ?>"></script>
</body>
</html>
<?php
}
