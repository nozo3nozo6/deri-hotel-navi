<?php
// ============================================================
// diary-ssr.php — Astro SSG に含まれない新規写メ日記の動的フォールバック
//   .htaccess: diary/[id].html が存在しない場合のみ到達する
//   shop_id はドメインで自動判定（admi系=1 / kichifu系=2）
// ============================================================
require_once __DIR__ . '/api/db.php';

$id      = (int)($_GET['id'] ?? 0);
$host    = $_SERVER['HTTP_HOST'] ?? '';
$shop_id = (str_contains($host, 'admi') || str_contains($host, 'biyobu')) ? 1 : 2;

if (!$id) { header('Location: /top'); exit; }

try {
    $st = DB::conn()->prepare('SELECT * FROM girl_diaries WHERE id = ? AND shop_id = ? AND is_display = 1');
    $st->execute([$id, $shop_id]);
    $d = $st->fetch(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
    $d = null;
}

if (!$d) { http_response_code(404); header('Location: /top'); exit; }

function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

$date = '';
if ($d['posted_at']) {
    $dp = explode('-', substr($d['posted_at'], 0, 10));
    $y = (int)$dp[0]; $mo = (int)($dp[1] ?? 0); $da = (int)($dp[2] ?? 0);
    $w = ['日', '月', '火', '水', '木', '金', '土'][(int)date('w', mktime(0, 0, 0, $mo, $da, $y))];
    $date = $y . '年' . $mo . '月' . $da . '日(' . $w . ')';
    if (strlen($d['posted_at']) > 10) $date .= ' ' . preg_replace('/^0/', '', substr($d['posted_at'], 11, 5));
}
$body    = (string)($d['body'] ?? '');
$bodyOut = nl2br(htmlspecialchars($body, ENT_QUOTES, 'UTF-8'));
$profUrl = $d['girl_id'] ? '/girls/' . (int)$d['girl_id'] : null;

header('Cache-Control: no-store');
?><!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title><?= h($d['title']) ?>｜<?= h($d['girl_name']) ?>の写メ日記</title>
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
        <span>写メ日記</span>
      </nav>

      <p class="news-detail-date"><?= h($date) ?><?php if ($d['girl_name']): ?><span style="margin-left:8px"><?= h($d['girl_name']) ?></span><?php endif; ?></p>
      <h1 class="news-detail-title"><?= h($d['title']) ?></h1>

      <?php if ($d['image']): ?>
        <?php if ($profUrl): ?><a href="<?= h($profUrl) ?>"><?php endif; ?>
        <img src="<?= h($d['image']) ?>" alt="<?= h($d['girl_name']) ?>"
             loading="lazy" class="news-detail-thumb" style="max-width:100%;height:auto;border-radius:12px;margin:20px 0" />
        <?php if ($profUrl): ?></a><?php endif; ?>
      <?php endif; ?>

      <?php if ($body): ?>
        <div class="prose-neon"><?= $bodyOut ?></div>
      <?php endif; ?>

      <p style="margin-top:40px;display:flex;gap:12px;flex-wrap:wrap">
        <?php if ($profUrl): ?><a href="<?= h($profUrl) ?>" class="section-more glossy-pill"><?= h($d['girl_name']) ?>のプロフィール</a><?php endif; ?>
        <a href="/top" class="back-link">← トップに戻る</a>
      </p>
    </div>
  </section>
</main>

<footer class="site-footer">
  <hr class="footer-top-divider" />
  <div class="footer-inner">
    <p><a href="/top" class="back-link">← トップ</a></p>
  </div>
</footer>
<script src="/site.js"></script>
</body>
</html>
