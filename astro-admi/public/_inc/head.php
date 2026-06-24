<?php
// head($title, $description, $canonical)
function site_head(string $title, string $desc, string $canonical = ''): void {
    $canon = $canonical ?: 'https://kichifu.com' . ($_SERVER['REQUEST_URI'] ?? '/');
    $canon = strtok($canon, '?'); // クエリ除去
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= h($title) ?></title>
<meta name="description" content="<?= h($desc) ?>">
<link rel="canonical" href="<?= h($canon) ?>">
<meta name="robots" content="index, follow">
<!-- OGP -->
<meta property="og:type" content="website">
<meta property="og:title" content="<?= h($title) ?>">
<meta property="og:description" content="<?= h($desc) ?>">
<meta property="og:url" content="<?= h($canon) ?>">
<meta property="og:image" content="https://kichifu.com/img/og-image.jpg">
<meta property="og:site_name" content="<?= h(SHOP_FULL_NAME) ?>">
<meta name="twitter:card" content="summary_large_image">
<!-- Fonts -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Pacifico&family=M+PLUS+Rounded+1c:wght@400;700;800&display=swap" rel="stylesheet">
<!-- Styles -->
<link rel="stylesheet" href="/site.css?v=<?= @filemtime($_SERVER['DOCUMENT_ROOT'] . '/site.css') ?: '1' ?>">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<!-- GA4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-50Q48YG34Z"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-50Q48YG34Z');</script>
</head>
<?php } ?>
