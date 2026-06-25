<?php
// ==========================================================================
// upload-image.php — 本文中に挿入する画像のアップロード（JSON）
//   お知らせ/コメントのプレビュー編集からカーソル位置に画像を入れる用途。
//   保存先: /uploads/news/<shop>/（_upload.php で GD→WebP 縮小）
//   返り値: { ok, path } path は /uploads/... 相対（表示は ASSET_ORIGIN 前置）
// ==========================================================================
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_upload.php';
header('Content-Type: application/json; charset=utf-8');

$admin = current_admin();
if (!$admin) { http_response_code(401); echo json_encode(['ok' => false, 'error' => 'auth']); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); echo json_encode(['ok' => false]); exit; }
if (!hash_equals($_SESSION['_csrf'] ?? '', (string)($_POST['_csrf'] ?? ''))) { http_response_code(419); echo json_encode(['ok' => false, 'error' => 'csrf']); exit; }

$shop = current_shop_id();
if (($_FILES['image']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
    $path = save_upload($_FILES['image'], 'news/' . $shop, 1200, 1600);  // 本文画像はやや大きめ許容
    if ($path) { echo json_encode(['ok' => true, 'path' => $path]); exit; }
}
http_response_code(400);
echo json_encode(['ok' => false, 'error' => 'upload failed']);
