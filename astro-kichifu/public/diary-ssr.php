<?php
// ============================================================
// diary-ssr.php — Astro SSG に含まれない新規写メ日記の動的フォールバック
//   .htaccess: diary/[id].html が存在しない場合のみ到達する
//   shop_id はドメインで自動判定（admi系=1 / kichifu系=2）
//   head/header/footer は _ssr-shell.php（Site.astro と同一）に集約
// ============================================================
require_once __DIR__ . '/api/db.php';

$id      = (int)($_GET['id'] ?? 0);
$host    = $_SERVER['HTTP_HOST'] ?? '';
$shop_id = (str_contains($host, 'admi') || str_contains($host, 'biyobu')) ? 1 : 2;

if (!$id) { header('Location: /top'); exit; }

try {
    $st = DB::conn()->prepare('SELECT * FROM girl_diaries WHERE id = ? AND shop_id = ? AND is_display = 1 AND posted_at <= NOW()');
    $st->execute([$id, $shop_id]);
    $d = $st->fetch(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
    $d = null;
}

if (!$d) { http_response_code(404); header('Location: /top'); exit; }

require __DIR__ . '/_ssr-shell.php';   // $SSR（店舗設定）＋ ssr_head/ssr_header/ssr_footer/ssr_h を定義

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
$desc    = mb_strimwidth(strip_tags($body), 0, 120, '…');
$title   = $d['title'] . '｜' . $d['girl_name'] . 'の写メ日記';

header('Cache-Control: no-store');
ssr_head($SSR, $title, $desc);
ssr_header($SSR);
?>
<main>
  <section class="page-section">
    <div class="neon-room"></div>
    <div class="wrap-md" style="position:relative;z-index:1">
      <nav class="breadcrumb">
        <a href="/top">トップ</a>
        <span class="breadcrumb-sep">›</span>
        <span>写メ日記</span>
      </nav>

      <p class="news-detail-date"><?= ssr_h($date) ?><?php if ($d['girl_name']): ?><span style="margin-left:8px"><?= ssr_h($d['girl_name']) ?></span><?php endif; ?></p>
      <h1 class="news-detail-title"><?= ssr_h($d['title']) ?></h1>

      <?php if ($d['image']): ?>
        <?php if ($profUrl): ?><a href="<?= ssr_h($profUrl) ?>"><?php endif; ?>
        <img src="<?= ssr_h($d['image']) ?>" alt="<?= ssr_h($d['girl_name']) ?>"
             loading="lazy" class="news-detail-thumb" style="max-width:100%;height:auto;border-radius:12px;margin:20px 0" />
        <?php if ($profUrl): ?></a><?php endif; ?>
      <?php endif; ?>

      <?php if ($body): ?>
        <div class="prose-neon"><?= $bodyOut ?></div>
      <?php endif; ?>

      <?php if ($profUrl): ?><p style="margin-top:32px"><a href="<?= ssr_h($profUrl) ?>" class="section-more glossy-pill"><?= ssr_h($d['girl_name']) ?>のプロフィール</a></p><?php endif; ?>
    </div>
  </section>
</main>
<?php
ssr_footer($SSR);
