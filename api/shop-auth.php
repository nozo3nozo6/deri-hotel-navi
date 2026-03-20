<?php
/**
 * shop-auth.php — 店舗セッション管理（MySQL版）
 * Actions: login, check, profile, update-thumbnail, update-email, lookup-email
 */
require_once __DIR__ . '/db.php';

define('SHOP_SESSION_TIMEOUT', 86400); // 24時間

session_set_cookie_params([
    'lifetime' => SHOP_SESSION_TIMEOUT,
    'path' => '/',
    'domain' => 'yobuho.com',
    'secure' => true,
    'httponly' => true,
    'samesite' => 'Strict'
]);
session_start();

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: https://yobuho.com');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Credentials: true');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'login':            handleLogin(); break;
    case 'check':            handleCheck(); break;
    case 'profile':          handleProfile(); break;
    case 'update-thumbnail': handleUpdateThumbnail(); break;
    case 'update-email':     handleUpdateEmail(); break;
    case 'lookup-email':     handleLookupEmail(); break;
    default:
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid action']);
}

/** セッション認証チェック — 他APIから require + requireShopAuth() で利用可 */
function requireShopAuth(): ?array {
    if (empty($_SESSION['shop_id'])) return null;
    if (time() - ($_SESSION['last_activity'] ?? 0) > SHOP_SESSION_TIMEOUT) {
        session_destroy();
        return null;
    }
    $_SESSION['last_activity'] = time();
    return ['shop_id' => $_SESSION['shop_id'], 'shop_email' => $_SESSION['shop_email']];
}

function handleLogin() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $input = json_decode(file_get_contents('php://input'), true);
    $email = trim($input['email'] ?? '');
    $password = $input['password'] ?? '';
    if (!$email || !$password) { echo json_encode(['success' => false, 'error' => 'メールとパスワードを入力してください']); return; }

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT * FROM shops WHERE email = ? LIMIT 1');
    $stmt->execute([$email]);
    $shop = $stmt->fetch();
    if (!$shop) { echo json_encode(['success' => false, 'error' => 'メールアドレスが見つかりません']); return; }

    $hash = $shop['password_hash'] ?? '';
    if (!$hash) { echo json_encode(['success' => false, 'error' => 'パスワードが設定されていません']); return; }

    $verified = false;
    $needsMigration = false;
    if (str_starts_with($hash, '$2')) {
        $verified = password_verify($password, $hash);
    } else {
        $decoded = base64_decode($hash, true);
        if ($decoded !== false && $decoded === $password) {
            $verified = true;
            $needsMigration = true;
        }
    }
    if (!$verified) { echo json_encode(['success' => false, 'error' => 'パスワードが正しくありません']); return; }

    // bcrypt移行
    if ($needsMigration) {
        $bcrypt = password_hash($password, PASSWORD_BCRYPT);
        $stmt = $pdo->prepare('UPDATE shops SET password_hash = ?, updated_at = NOW() WHERE id = ?');
        $stmt->execute([$bcrypt, $shop['id']]);
    }

    // セッション開始
    $_SESSION['shop_id'] = $shop['id'];
    $_SESSION['shop_email'] = $shop['email'];
    $_SESSION['last_activity'] = time();

    unset($shop['password_hash']);
    echo json_encode(['success' => true, 'shop' => $shop]);
}

function handleCheck() {
    $auth = requireShopAuth();
    if (!$auth) { echo json_encode(['authenticated' => false]); return; }

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT * FROM shops WHERE id = ? LIMIT 1');
    $stmt->execute([$auth['shop_id']]);
    $shop = $stmt->fetch();
    if (!$shop || $shop['status'] === 'suspended') {
        session_destroy();
        echo json_encode(['authenticated' => false]);
        return;
    }
    unset($shop['password_hash']);
    echo json_encode(['authenticated' => true, 'shop' => $shop]);
}

function handleProfile() {
    $auth = requireShopAuth();
    if (!$auth) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); return; }

    $pdo = DB::conn();
    // Shop + contracts + plans
    $stmt = $pdo->prepare('SELECT * FROM shops WHERE id = ? LIMIT 1');
    $stmt->execute([$auth['shop_id']]);
    $shop = $stmt->fetch();
    if (!$shop) { http_response_code(404); echo json_encode(['error' => 'Shop not found']); return; }
    unset($shop['password_hash']);

    // shop_contracts JOIN contract_plans
    $stmt = $pdo->prepare('SELECT sc.plan_id, cp.name, cp.price FROM shop_contracts sc JOIN contract_plans cp ON sc.plan_id = cp.id WHERE sc.shop_id = ?');
    $stmt->execute([$auth['shop_id']]);
    $contracts = $stmt->fetchAll();
    $shop['shop_contracts'] = array_map(fn($c) => [
        'plan_id' => (int)$c['plan_id'],
        'contract_plans' => ['name' => $c['name'], 'price' => (int)$c['price']]
    ], $contracts);

    echo json_encode($shop, JSON_UNESCAPED_UNICODE);
}

function handleUpdateThumbnail() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $auth = requireShopAuth();
    if (!$auth) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); return; }

    $input = json_decode(file_get_contents('php://input'), true);
    $thumbnailUrl = $input['thumbnail_url'] ?? null; // null = 削除

    $pdo = DB::conn();
    $stmt = $pdo->prepare('UPDATE shops SET thumbnail_url = ?, updated_at = NOW() WHERE id = ?');
    $stmt->execute([$thumbnailUrl, $auth['shop_id']]);

    echo json_encode(['success' => true]);
}

function handleUpdateEmail() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $auth = requireShopAuth();
    if (!$auth) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); return; }

    $input = json_decode(file_get_contents('php://input'), true);
    $newEmail = trim($input['new_email'] ?? '');
    if (!$newEmail || !filter_var($newEmail, FILTER_VALIDATE_EMAIL)) {
        echo json_encode(['success' => false, 'error' => '有効なメールアドレスを入力してください']);
        return;
    }

    $pdo = DB::conn();
    $stmt = $pdo->prepare('UPDATE shops SET email = ?, updated_at = NOW() WHERE id = ?');
    $stmt->execute([$newEmail, $auth['shop_id']]);

    $_SESSION['shop_email'] = $newEmail;
    echo json_encode(['success' => true]);
}

function handleLookupEmail() {
    $email = trim($_GET['email'] ?? '');
    if (!$email) { echo json_encode(['exists' => false]); return; }

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id, email FROM shops WHERE email = ? LIMIT 1');
    $stmt->execute([$email]);
    $shop = $stmt->fetch();
    echo json_encode(['exists' => !!$shop, 'id' => $shop['id'] ?? null, 'email' => $shop['email'] ?? null]);
}
?>
