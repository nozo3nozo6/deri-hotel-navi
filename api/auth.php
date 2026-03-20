<?php
/**
 * auth.php — 管理者認証（MySQL版）
 */
require_once __DIR__ . '/db.php';

if (!defined('SESSION_TIMEOUT')) define('SESSION_TIMEOUT', 1800);
if (!defined('MAX_LOGIN_ATTEMPTS')) define('MAX_LOGIN_ATTEMPTS', 5);
if (!defined('LOCKOUT_TIME')) define('LOCKOUT_TIME', 900);

session_set_cookie_params([
    'lifetime' => SESSION_TIMEOUT,
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
    case 'login':  handleLogin(); break;
    case 'logout': handleLogout(); break;
    case 'check':  handleCheck(); break;
    case 'change-password': handleChangePassword(); break;
    default: http_response_code(400); echo json_encode(['success' => false, 'message' => '不正なアクションです']);
}

function checkRateLimit($ip) {
    $lockFile = sys_get_temp_dir() . '/auth_lock_' . md5($ip) . '.json';
    if (!file_exists($lockFile)) return ['locked' => false, 'attempts' => 0];
    $data = json_decode(file_get_contents($lockFile), true);
    if (!$data) return ['locked' => false, 'attempts' => 0];
    if (isset($data['locked_until']) && time() < $data['locked_until']) {
        return ['locked' => true, 'remaining' => $data['locked_until'] - time()];
    }
    if (isset($data['locked_until']) && time() >= $data['locked_until']) { unlink($lockFile); return ['locked' => false, 'attempts' => 0]; }
    return ['locked' => false, 'attempts' => $data['attempts'] ?? 0];
}

function recordFailedAttempt($ip) {
    $lockFile = sys_get_temp_dir() . '/auth_lock_' . md5($ip) . '.json';
    $data = ['attempts' => 1, 'last_attempt' => time()];
    if (file_exists($lockFile)) {
        $existing = json_decode(file_get_contents($lockFile), true);
        if ($existing) $data['attempts'] = ($existing['attempts'] ?? 0) + 1;
    }
    if ($data['attempts'] >= MAX_LOGIN_ATTEMPTS) $data['locked_until'] = time() + LOCKOUT_TIME;
    file_put_contents($lockFile, json_encode($data), LOCK_EX);
    return $data['attempts'];
}

function clearRateLimit($ip) {
    $lockFile = sys_get_temp_dir() . '/auth_lock_' . md5($ip) . '.json';
    if (file_exists($lockFile)) unlink($lockFile);
}

function handleLogin() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['success' => false, 'message' => 'POSTのみ']); return; }
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $rateLimit = checkRateLimit($ip);
    if ($rateLimit['locked']) {
        $min = ceil($rateLimit['remaining'] / 60);
        echo json_encode(['success' => false, 'message' => "ログイン試行回数が上限に達しました。{$min}分後に再試行してください。"]);
        return;
    }
    $input = json_decode(file_get_contents('php://input'), true);
    $username = trim($input['username'] ?? '');
    $password = $input['password'] ?? '';
    if (empty($username) || empty($password)) { echo json_encode(['success' => false, 'message' => 'IDとパスワードを入力してください']); return; }

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT * FROM admin_users WHERE username = ? LIMIT 1');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user) {
        $attempts = recordFailedAttempt($ip);
        echo json_encode(['success' => false, 'message' => 'IDまたはパスワードが正しくありません']);
        return;
    }
    if (!password_verify($password, $user['password_hash'])) {
        $attempts = recordFailedAttempt($ip);
        $remaining = MAX_LOGIN_ATTEMPTS - $attempts;
        $msg = $remaining <= 0 ? 'ログイン試行回数が上限に達しました。15分後に再試行してください。' : 'IDまたはパスワードが正しくありません';
        echo json_encode(['success' => false, 'message' => $msg]);
        return;
    }

    clearRateLimit($ip);
    $_SESSION['user_id'] = $user['id'];
    $_SESSION['username'] = $user['username'];
    $_SESSION['login_at'] = time();
    $_SESSION['last_activity'] = time();
    echo json_encode(['success' => true, 'user' => ['id' => $user['id'], 'username' => $user['username']]]);
}

function handleLogout() {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
    }
    session_destroy();
    echo json_encode(['success' => true]);
}

function handleCheck() {
    if (empty($_SESSION['user_id'])) { echo json_encode(['authenticated' => false]); return; }
    $lastActivity = $_SESSION['last_activity'] ?? 0;
    if (time() - $lastActivity > SESSION_TIMEOUT) { session_destroy(); echo json_encode(['authenticated' => false, 'reason' => 'timeout']); return; }
    $_SESSION['last_activity'] = time();
    echo json_encode(['authenticated' => true, 'user' => ['id' => $_SESSION['user_id'], 'username' => $_SESSION['username']]]);
}

function handleChangePassword() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['success' => false, 'message' => 'POSTのみ']); return; }
    if (empty($_SESSION['user_id'])) { http_response_code(401); echo json_encode(['success' => false, 'message' => '認証が必要です']); return; }
    $input = json_decode(file_get_contents('php://input'), true);
    $currentPassword = $input['current_password'] ?? '';
    $newPassword = $input['new_password'] ?? '';
    if (empty($currentPassword) || empty($newPassword)) { echo json_encode(['success' => false, 'message' => 'すべての項目を入力してください']); return; }
    if (strlen($newPassword) < 4) { echo json_encode(['success' => false, 'message' => 'パスワードは4文字以上にしてください']); return; }

    $pdo = DB::conn();
    $userId = $_SESSION['user_id'];
    $stmt = $pdo->prepare('SELECT * FROM admin_users WHERE id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    if (!$user) { echo json_encode(['success' => false, 'message' => 'ユーザーが見つかりません']); return; }
    if (!password_verify($currentPassword, $user['password_hash'])) { echo json_encode(['success' => false, 'message' => '現在のパスワードが正しくありません']); return; }

    $newHash = password_hash($newPassword, PASSWORD_BCRYPT);
    $stmt = $pdo->prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?');
    $stmt->execute([$newHash, $userId]);
    echo json_encode(['success' => true, 'message' => 'パスワードを変更しました']);
}
