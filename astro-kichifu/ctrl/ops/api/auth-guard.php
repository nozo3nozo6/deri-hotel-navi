<?php
// ==========================================================================
// auth-guard.php — セッションスタート + 認証チェックを共通化
// 各 API ファイルの先頭でinclude するだけで認証必須化される
// ==========================================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/_ctrl-session.php';   // CTRL のログインを流用（ops 独自ログインは廃止）

setCorsHeaders();

if (!ops_current_user()) {
    // CTRL 未ログイン。フロント（admin.js）はこの 401 を見て /ctrl/ops/ へ戻し、
    // そこから CTRL のログイン画面へ送る。
    errorResponse('unauthorized', 401);
}

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
