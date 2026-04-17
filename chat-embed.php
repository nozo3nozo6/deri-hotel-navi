<?php
// chat-embed.php — 外部iframe埋め込み許可用のPHPラッパー
// /chat/{slug}/ のリライト先として chat.html の内容を配信し、
// X-Frame-Options を除去して CSP frame-ancestors を * にする。

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
readfile($path);
