<?php
/**
 * submit-shop.php — 店舗登録（MySQL版）
 */

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: https://yobuho.com');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit; }

require_once __DIR__ . '/db.php';
$pdo = DB::conn();

$input = json_decode(file_get_contents('php://input'), true);
if (!$input) { http_response_code(400); echo json_encode(['error' => '無効なリクエストです']); exit; }

$email      = trim($input['email'] ?? '');
$authUserId = trim($input['auth_user_id'] ?? '');
$shopName   = trim($input['shop_name'] ?? '');
$genderMode = $input['gender_mode'] ?? 'men';
$shopUrl    = trim($input['shop_url'] ?? '');
$shopTel    = trim($input['shop_tel'] ?? '');
$docUrl     = $input['document_url'] ?? null;
$pwHash     = $input['password_hash'] ?? null;

if (!$email || !$shopName) { http_response_code(400); echo json_encode(['error' => 'email と shop_name は必須です']); exit; }
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { http_response_code(400); echo json_encode(['error' => '無効なメールアドレスです']); exit; }

$allowedGenders = ['men', 'women', 'men_same', 'women_same', 'este'];
if (!in_array($genderMode, $allowedGenders)) { http_response_code(400); echo json_encode(['error' => '無効なジャンルです']); exit; }

$shopName = mb_substr($shopName, 0, 100);

// slug自動生成（ランダム8文字英小文字+数字）
function generateSlug(PDO $pdo): string {
    $chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for ($attempt = 0; $attempt < 10; $attempt++) {
        $slug = '';
        for ($i = 0; $i < 8; $i++) $slug .= $chars[random_int(0, strlen($chars) - 1)];
        $stmt = $pdo->prepare('SELECT id FROM shops WHERE slug = ? LIMIT 1');
        $stmt->execute([$slug]);
        if (!$stmt->fetch()) return $slug;
    }
    return bin2hex(random_bytes(4)); // フォールバック
}

// 既存チェック
$stmt = $pdo->prepare('SELECT id, status FROM shops WHERE email = ?');
$stmt->execute([$email]);
$existing = $stmt->fetch();

// パスワードリセットモード
if ($shopName === '_pw_reset_' && $pwHash && $existing) {
    $decodedPw = base64_decode($pwHash, true);
    if ($decodedPw === false) $decodedPw = $pwHash;
    $bcryptHash = password_hash($decodedPw, PASSWORD_BCRYPT);
    $stmt = $pdo->prepare('UPDATE shops SET password_hash = ?, updated_at = ? WHERE email = ?');
    $stmt->execute([$bcryptHash, gmdate('Y-m-d H:i:s'), $email]);
    $stmt = $pdo->prepare('SELECT * FROM shops WHERE email = ?');
    $stmt->execute([$email]);
    $shop = $stmt->fetch();
    unset($shop['password_hash']);
    echo json_encode(['success' => true, 'shop' => $shop]);
    exit;
}

// bcryptハッシュ化
$bcryptHash = null;
if ($pwHash) {
    $decodedPw = base64_decode($pwHash, true);
    if ($decodedPw === false) $decodedPw = $pwHash;
    $bcryptHash = password_hash($decodedPw, PASSWORD_BCRYPT);
}

$now = gmdate('Y-m-d H:i:s');

if ($existing) {
    // UPDATE
    $sql = 'UPDATE shops SET shop_name=?, gender_mode=?, shop_url=?, shop_tel=?, document_url=?, status=?, updated_at=?';
    $params = [$shopName, $genderMode, $shopUrl ?: null, $shopTel ?: null, $docUrl, 'registered', $now];
    if ($bcryptHash) { $sql .= ', password_hash=?'; $params[] = $bcryptHash; }
    if ($authUserId) { $sql .= ', auth_user_id=?'; $params[] = $authUserId; }
    $sql .= ' WHERE email = ?';
    $params[] = $email;
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
} else {
    // INSERT
    $id = DB::uuid();
    $slug = generateSlug($pdo);
    $stmt = $pdo->prepare('INSERT INTO shops (id, email, auth_user_id, shop_name, gender_mode, shop_url, shop_tel, document_url, password_hash, slug, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $stmt->execute([$id, $email, $authUserId ?: null, $shopName, $genderMode, $shopUrl ?: null, $shopTel ?: null, $docUrl, $bcryptHash, $slug, 'registered', $now, $now]);
}

$stmt = $pdo->prepare('SELECT * FROM shops WHERE email = ?');
$stmt->execute([$email]);
$shop = $stmt->fetch();
unset($shop['password_hash']);
echo json_encode(['success' => true, 'shop' => $shop]);
?>
