<?php
// ============================================================
// news-ssr.php — Astro SSG に含まれない新規ニュースの動的フォールバック
//   .htaccess: news/[id].html が存在しない場合のみ到達する
//   shop_id はドメインで自動判定（admi系=1 / kichifu系=2）
//   head/header/footer は _ssr-shell.php（Site.astro と同一）に集約
// ============================================================
require_once __DIR__ . '/api/db.php';

$id      = (int)($_GET['id'] ?? 0);
$host    = $_SERVER['HTTP_HOST'] ?? '';
$shop_id = (str_contains($host, 'admi') || str_contains($host, 'biyobu')) ? 1 : 2;

if (!$id) { header('Location: /news'); exit; }

try {
    $st = DB::conn()->prepare(
        'SELECT * FROM news WHERE id = ? AND shop_id = ? AND is_display = 1 AND posted_at <= NOW()'
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

require __DIR__ . '/_ssr-shell.php';   // $SSR（店舗設定）＋ ssr_head/ssr_header/ssr_footer/asset_url/ssr_h を定義

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
// 本文HTML内の画像パスを admi2888 絶対URLに正規化（旧kichifu絶対 + 相対 両対応）
$bodyOut = preg_replace('#https?://kichifu\.com(/uploads/)#', 'https://admi2888.com$1', $bodyOut);   // 旧kichifu絶対→admi2888
$bodyOut = preg_replace('#(?<=["\'])(/uploads/)#', 'https://admi2888.com$1', $bodyOut);              // 相対→admi2888
$bodyOut = ssr_localize_body($bodyOut, $SSR);   // 本文の電話を当店番号に統一（他店登録の2店舗掲載対策）

$desc = mb_strimwidth(strip_tags($body), 0, 120, '…');

header('Cache-Control: no-store');
ssr_head($SSR, $it['title'], $desc);
ssr_header($SSR);
?>
<main>
  <section class="page-section">
    <div class="neon-room"></div>
    <div class="wrap-md" style="position:relative;z-index:1">
      <nav class="breadcrumb">
        <a href="/top">トップ</a>
        <span class="breadcrumb-sep">›</span>
        <a href="/news">お知らせ</a>
        <span class="breadcrumb-sep">›</span>
        <span><?= ssr_h($it['title']) ?></span>
      </nav>

      <p class="news-detail-date"><?= ssr_h($date) ?></p>
      <h1 class="news-detail-title"><?= ssr_h($it['title']) ?></h1>

      <?php if ($it['thumb']): ?>
        <img src="<?= ssr_h(asset_url($it['thumb'])) ?>" alt=""
             loading="lazy" class="news-detail-thumb" />
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
<?php
ssr_footer($SSR);
