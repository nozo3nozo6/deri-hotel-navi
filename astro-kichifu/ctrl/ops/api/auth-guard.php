<?php
// ==========================================================================
// auth-guard.php — セッションスタート + 認証チェックを共通化
// 各 API ファイルの先頭でinclude するだけで認証必須化される
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

if (empty($_SESSION['ylka_admin_id']) || time() - ($_SESSION['last_activity'] ?? 0) > 30 * 86400) {
    $_SESSION = [];
    session_destroy();
    errorResponse('unauthorized', 401);
}
$_SESSION['last_activity'] = time();

function currentUserId(): int { return (int)($_SESSION['ylka_admin_id'] ?? 0); }
function currentUserRole(): string { return $_SESSION['ylka_admin_role'] ?? 'staff'; }
function isOwner(): bool { return currentUserRole() === 'owner'; }
function requireOwner(): void {
    if (!isOwner()) errorResponse('owner role required', 403);
}

function readJsonBody(): array {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}
