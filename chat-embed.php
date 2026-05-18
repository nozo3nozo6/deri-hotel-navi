<?php
// chat-embed.php — 外部iframe埋め込み許可用のPHPラッパー
// /chat/{slug}/ のリライト先として chat.html の内容を配信し、
// X-Frame-Options を除去して CSP frame-ancestors を * にする。
// 2026-05-19: PWA manifest link を slug 付き動的 URL に置換してから配信.
//   Safari がページロード時に拾う manifest が即 slug 付き → PWA Add to Home Screen で
//   正しい start_url が記録される (JS による後差し替えは Safari がキャッシュ済みで効かないため).

header_remove('X-Frame-Options');
header('Content-Security-Policy: frame-ancestors *');
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');

$path = __DIR__ . '/chat.html';
if (!is_readable($path)) {
    http_response_code(404);
    echo 'Not found';
    exit;
}

$slug = isset($_GET['slug']) ? preg_replace('/[^a-z0-9\-]/', '', (string)$_GET['slug']) : '';
$inbox = isset($_GET['cast_inbox']) ? preg_replace('/[^a-zA-Z0-9\-]/', '', (string)$_GET['cast_inbox']) : '';

$html = file_get_contents($path);
if ($slug !== '') {
    $manifestUrl = '/api/chat-manifest.php?slug=' . rawurlencode($slug);
    if ($inbox !== '') $manifestUrl .= '&inbox=' . rawurlencode($inbox);
    // 静的 manifest link を slug 付き動的 URL に置換 (JS 差替より早い).
    $html = preg_replace(
        '#<link\s+rel="manifest"[^>]*>#i',
        '<link rel="manifest" href="' . htmlspecialchars($manifestUrl, ENT_QUOTES, 'UTF-8') . '">',
        $html,
        1
    );
}
echo $html;
