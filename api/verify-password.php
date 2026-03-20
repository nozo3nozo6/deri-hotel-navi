<?php
/**
 * verify-password.php — パスワード検証（MySQL版）
 */

header('Content-Type: application/json; charset=UTF-8');

$allowed_origins = ['https://yobuho.com', 'https://deli.yobuho.com', 'https://jofu.yobuho.com', 'https://same.yobuho.com', 'https://loveho.yobuho.com'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed_origins)) {
    header('Access-Control-Allow-Origin: ' . $origin);
} else {
    header('Access-Control-Allow-Origin: https://yobuho.com');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit; }

require_once __DIR__ . '/db.php';
$pdo = DB::conn();

$input = json_decode(file_get_contents('php://input'), true);
if (!$input) { http_response_code(400); echo json_encode(['error' => '無効なリクエストです']); exit; }

$email    = trim($input['email'] ?? '');
$password = $input['password'] ?? '';

if (!$email || !$password) { http_response_code(400); echo json_encode(['error' => 'email と password は必須です']); exit; }

$stmt = $pdo->prepare('SELECT * FROM shops WHERE email = ?');
$stmt->execute([$email]);
$shop = $stmt->fetch();

if (!$shop) { http_response_code(401); echo json_encode(['error' => 'メールアドレスが見つかりません']); exit; }

$storedHash = $shop['password_hash'] ?? '';
if (!$storedHash) { http_response_code(401); echo json_encode(['error' => 'パスワードが設定されていません。管理者にお問い合わせください。']); exit; }

$verified = false;
$needsMigration = false;

if (str_starts_with($storedHash, '$2')) {
    $verified = password_verify($password, $storedHash);
} else {
    try {
        $decoded = base64_decode($storedHash, true);
        if ($decoded !== false && $decoded === $password) {
            $verified = true;
            $needsMigration = true;
        }
    } catch (Exception $e) {}
}

if (!$verified) { http_response_code(401); echo json_encode(['error' => 'パスワードが正しくありません']); exit; }

// レガシー→bcrypt移行
if ($needsMigration) {
    $bcryptHash = password_hash($password, PASSWORD_BCRYPT);
    $stmt = $pdo->prepare('UPDATE shops SET password_hash = ?, updated_at = ? WHERE email = ?');
    $stmt->execute([$bcryptHash, gmdate('Y-m-d H:i:s'), $email]);
    error_log('[verify-password] migrated Base64 to bcrypt for: ' . $email);
}

unset($shop['password_hash']);
echo json_encode(['success' => true, 'shop' => $shop]);
?>
