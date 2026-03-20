<?php
/**
 * verify-email-token.php — メール認証トークン検証
 * GET: ?token=xxx
 * Returns: { "valid": true, "email": "shop@example.com", "genre": "men" }
 */

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: https://yobuho.com');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') { http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit; }

require_once __DIR__ . '/db.php';
$pdo = DB::conn();

$token = $_GET['token'] ?? '';
if (!$token || strlen($token) !== 64 || !ctype_xdigit($token)) {
    http_response_code(400);
    echo json_encode(['valid' => false, 'error' => '無効なトークンです']);
    exit;
}

$stmt = $pdo->prepare('SELECT email, genre, expires_at, used FROM shop_email_tokens WHERE token = ?');
$stmt->execute([$token]);
$row = $stmt->fetch();

if (!$row) {
    http_response_code(404);
    echo json_encode(['valid' => false, 'error' => 'トークンが見つかりません']);
    exit;
}

if ($row['used']) {
    echo json_encode(['valid' => false, 'error' => 'このトークンは既に使用されています']);
    exit;
}

if (strtotime($row['expires_at']) < time()) {
    echo json_encode(['valid' => false, 'error' => 'トークンの有効期限が切れています。再度認証メールを送信してください。']);
    exit;
}

// トークンを使用済みにマーク
$stmt = $pdo->prepare('UPDATE shop_email_tokens SET used = 1 WHERE token = ?');
$stmt->execute([$token]);

// 再提出チェック
$stmt = $pdo->prepare('SELECT id, status, shop_name, gender_mode, shop_url, shop_tel FROM shops WHERE email = ?');
$stmt->execute([$row['email']]);
$existingShop = $stmt->fetch();

echo json_encode([
    'valid' => true,
    'email' => $row['email'],
    'genre' => $row['genre'],
    'existing_shop' => $existingShop ?: null,
]);
