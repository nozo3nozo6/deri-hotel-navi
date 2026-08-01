<?php
// ==========================================================================
// auth.php — 管理者認証API
//
// Actions:
//   GET  ?action=check               ログイン状態確認
//   POST ?action=login               {email, password}
//   POST ?action=logout
//   POST ?action=change-password     {old_password, new_password}
// ==========================================================================
require_once __DIR__ . '/db.php';

// 30日継続ログイン
@ini_set('session.gc_maxlifetime', 30 * 86400);
@ini_set('session.cookie_lifetime', 30 * 86400);
session_set_cookie_params([
    'lifetime' => 30 * 86400,
    'path'     => '/',
    'secure'   => true,
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_name('ADMI_OPS_SID');
session_start();

setCorsHeaders();

const SESSION_TIMEOUT = 30 * 86400;   // 30 days
const LOCKOUT_AFTER   = 5;             // 5 failed attempts
const LOCKOUT_SECONDS = 900;           // 15 minutes

function isLoggedIn(): bool {
    if (empty($_SESSION['ylka_admin_id'])) return false;
    if (time() - ($_SESSION['last_activity'] ?? 0) > SESSION_TIMEOUT) {
        $_SESSION = [];
        session_destroy();
        return false;
    }
    $_SESSION['last_activity'] = time();
    return true;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($action === 'check') {
    jsonResponse([
        'logged_in'    => isLoggedIn(),
        'id'           => $_SESSION['ylka_admin_id']    ?? null,
        'email'        => $_SESSION['ylka_admin_email'] ?? null,
        'display_name' => $_SESSION['ylka_admin_name']  ?? null,
        'role'         => $_SESSION['ylka_admin_role']  ?? null,
    ]);
}

if ($action === 'login' && $method === 'POST') {
    $body     = json_decode(file_get_contents('php://input'), true);
    $email    = trim($body['email'] ?? '');
    $password = $body['password'] ?? '';
    if ($email === '' || $password === '') errorResponse('email and password required', 400);

    // レート制限（IP単位、ファイルベース）
    $ip       = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $lockFile = sys_get_temp_dir() . '/ylka_login_' . md5($ip);
    if (file_exists($lockFile)) {
        $data = json_decode(file_get_contents($lockFile), true) ?: [];
        if (($data['count'] ?? 0) >= LOCKOUT_AFTER && time() - ($data['last'] ?? 0) < LOCKOUT_SECONDS) {
            errorResponse('too many failed attempts. try again in 15 minutes', 429);
        }
    }

    try {
        $pdo  = getPdo();
        $stmt = $pdo->prepare('SELECT id, username, password_hash, display_name, role FROM ops_admin_users WHERE username = ? LIMIT 1');
        $stmt->execute([$email]);
        $user = $stmt->fetch();
    } catch (Throwable $e) {
        errorResponse('database error', 500);
    }

    if (!$user || !password_verify($password, $user['password_hash'])) {
        $data          = file_exists($lockFile) ? (json_decode(file_get_contents($lockFile), true) ?: []) : [];
        $data['count'] = ($data['count'] ?? 0) + 1;
        $data['last']  = time();
        file_put_contents($lockFile, json_encode($data));
        errorResponse('invalid credentials', 401);
    }
    @unlink($lockFile);

    session_regenerate_id(true);
    $_SESSION['ylka_admin_id']    = (int)$user['id'];
    $_SESSION['ylka_admin_email'] = $user['username'];
    $_SESSION['ylka_admin_name']  = $user['display_name'];
    $_SESSION['ylka_admin_role']  = $user['role'] ?? 'staff';
    $_SESSION['last_activity']    = time();
    jsonResponse([
        'logged_in'    => true,
        'email'        => $user['username'],
        'display_name' => $user['display_name'],
        'role'         => $user['role'] ?? 'staff',
    ]);
}

if ($action === 'logout' && $method === 'POST') {
    $_SESSION = [];
    session_destroy();
    jsonResponse(['logged_in' => false]);
}

if ($action === 'change-password' && $method === 'POST') {
    if (!isLoggedIn()) errorResponse('unauthorized', 401);
    $body    = json_decode(file_get_contents('php://input'), true);
    $oldPass = $body['old_password'] ?? '';
    $newPass = $body['new_password'] ?? '';
    if (strlen($newPass) < 8) errorResponse('new password must be at least 8 chars', 400);

    $pdo  = getPdo();
    $stmt = $pdo->prepare('SELECT password_hash FROM ops_admin_users WHERE id = ?');
    $stmt->execute([$_SESSION['ylka_admin_id']]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($oldPass, $row['password_hash'])) errorResponse('invalid current password', 401);

    $newHash = password_hash($newPass, PASSWORD_BCRYPT);
    $pdo->prepare('UPDATE ops_admin_users SET password_hash = ? WHERE id = ?')->execute([$newHash, $_SESSION['ylka_admin_id']]);
    jsonResponse(['ok' => true]);
}

errorResponse('invalid action', 400);
