<?php
// =============================================================================
// chat-manifest.php — 店舗 slug に応じた PWA manifest を動的生成
//
// 使い方: <link rel="manifest" href="/api/chat-manifest.php?slug=<slug>">
//   cast_inbox トークン経由の場合は &inbox=<token> を付けると start_url に反映される.
//
// 動的にする理由: 静的 chat-manifest.webmanifest は start_url='/chat/' だが
// /chat/ 単独は 404 になる. 店舗 slug ごとに start_url を切り替えてホーム画面起動を成功させる.
// =============================================================================

declare(strict_types=1);

header('Content-Type: application/manifest+json; charset=utf-8');
header('Cache-Control: no-store');

$slug = isset($_GET['slug']) ? preg_replace('/[^a-zA-Z0-9_\-]/', '', (string)$_GET['slug']) : '';
$inboxToken = isset($_GET['inbox']) ? preg_replace('/[^a-zA-Z0-9_\-]/', '', (string)$_GET['inbox']) : '';

if ($slug === '') {
    // slug 無し → 静的 manifest フォールバック (404 を避けてホームに戻す)
    $startUrl = '/';
    $scope = '/';
} else {
    if ($inboxToken !== '') {
        $startUrl = '/chat/' . rawurlencode($slug) . '/?cast_inbox=' . rawurlencode($inboxToken);
    } else {
        $startUrl = '/chat/' . rawurlencode($slug) . '/';
    }
    $scope = '/chat/' . rawurlencode($slug) . '/';
}

$manifest = [
    'name' => 'YobuChat',
    'short_name' => 'YobuChat',
    'description' => 'YobuHo のお問い合わせチャット',
    'start_url' => $startUrl,
    'scope' => $scope,
    'display' => 'standalone',
    'orientation' => 'portrait',
    'background_color' => '#ffffff',
    'theme_color' => '#b5627a',
    'icons' => [
        ['src' => '/chat-icon-192.png', 'sizes' => '192x192', 'type' => 'image/png'],
        ['src' => '/chat-icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any'],
        ['src' => '/chat-icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
    ],
];

echo json_encode($manifest, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
