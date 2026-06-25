<?php
// ============================================================
// news-ssr.php — Astro SSG に含まれない新規ニュースの動的フォールバック
//   .htaccess: news/[id].html が存在しない場合のみ到達する
//   shop_id はドメインで自動判定（admi系=1 / kichifu系=2）
// ============================================================
require_once __DIR__ . '/api/db.php';

$id      = (int)($_GET['id'] ?? 0);
$host    = $_SERVER['HTTP_HOST'] ?? '';
$shop_id = (str_contains($host, 'admi') || str_contains($host, 'biyobu')) ? 1 : 2;

if (!$id) { header('Location: /news'); exit; }

try {
    $st = DB::conn()->prepare(
        'SELECT * FROM news WHERE id = ? AND shop_id = ? AND is_display = 1'
    );
    $st->execute([$id, $shop_id]);
    $it = $st->fetch(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
    $it = null;
}

if (!$it) {
    http_response_code(404);
    header('Location: /news');
    exit;
}

function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

$date = '';
if ($it['posted_at']) {
    $dp = explode('-', substr($it['posted_at'], 0, 10));   // [2026,06,25]
    $y = (int)$dp[0]; $mo = (int)($dp[1] ?? 0); $da = (int)($dp[2] ?? 0);
    $w = ['日', '月', '火', '水', '木', '金', '土'][(int)date('w', mktime(0, 0, 0, $mo, $da, $y))];
    $date = $y . '年' . $mo . '月' . $da . '日(' . $w . ')';   // 2026年6月25日(木)
    if (strlen($it['posted_at']) > 10) $date .= ' ' . preg_replace('/^0/', '', substr($it['posted_at'], 11, 5)); // 20:30
}
$body      = (string)($it['body'] ?? '');
$bodyIsHtml = (bool)preg_match('/<[a-z!\/][^>]*>/i', $body);
$bodyOut   = $bodyIsHtml
    ? $body
    : nl2br(htmlspecialchars($body, ENT_QUOTES, 'UTF-8'));

// キャノニカルは自分自身
header('Cache-Control: no-store');
?><!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title><?= h($it['title']) ?></title>
<meta name="description" content="<?= h(mb_strimwidth(strip_tags($body), 0, 120, '…')) ?>" />
<meta name="robots" content="noindex" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Pacifico&family=M+PLUS+Rounded+1c:wght@400;700;800&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/site.css" />
</head>
<body>
<header class="site-header">
  <div class="site-header-inner">
    <a href="/top" class="brand" style="text-decoration:none">
      <span class="brand-script flicker">Admi</span>
    </a>
    <div class="header-tel"></div>
  </div>
</header>
<div class="header-spacer" aria-hidden="true"></div>

<main>
  <section class="page-section">
    <div class="neon-room"></div>
    <div class="wrap-md" style="position:relative;z-index:1">
      <nav class="breadcrumb">
        <a href="/top">トップ</a>
        <span class="breadcrumb-sep">›</span>
        <a href="/news">お知らせ</a>
        <span class="breadcrumb-sep">›</span>
        <span><?= h($it['title']) ?></span>
      </nav>

      <p class="news-detail-date"><?= h($date) ?></p>
      <h1 class="news-detail-title"><?= h($it['title']) ?></h1>

      <?php if ($it['thumb']): ?>
        <img src="<?= h($it['thumb']) ?>" alt=""
             loading="lazy" class="news-detail-thumb" style="max-width:100%;height:auto;border-radius:12px;margin:20px 0" />
      <?php endif; ?>

      <?php if ($body): ?>
        <div class="prose-neon"><?= $bodyOut ?></div>
      <?php endif; ?>

      <p style="margin-top:40px">
        <a href="/news" class="back-link">← お知らせ一覧に戻る</a>
      </p>
    </div>
  </section>
</main>

<footer class="site-footer">
  <hr class="footer-top-divider" />
  <div class="footer-inner">
    <p><a href="/news" class="back-link">← お知らせ一覧</a></p>
  </div>
</footer>
<script src="/site.js"></script>
</body>
</html>
