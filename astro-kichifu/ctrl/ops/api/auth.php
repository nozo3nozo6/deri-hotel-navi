<?php
// ==========================================================================
// auth.php — ops の認証状態を返すだけの薄いAPI
//
//   ops は CTRL のログインをそのまま使う（独自ログイン廃止・2026-08-01）。
//   ログイン/パスワード変更は CTRL 側（/ctrl/login.php, /ctrl/admins.php）が担当する。
//
// Actions:
//   GET  ?action=check    ログイン状態（CTRL セッションを見る）
//   POST ?action=logout   CTRL からログアウト（/ctrl/logout.php へ誘導するURLを返す）
// ==========================================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/_ctrl-session.php';

setCorsHeaders();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($action === 'check') {
    $u = ops_current_user();
    jsonResponse([
        'logged_in'    => (bool)$u,
        'id'           => $u['id']           ?? null,
        'email'        => $u['username']     ?? null,
        'display_name' => $u['display_name'] ?? null,
        'role'         => $u['role']         ?? null,
    ]);
}

if ($action === 'logout' && $method === 'POST') {
    // セッションは CTRL のものなので、ここでは壊さず CTRL のログアウトへ送る
    jsonResponse(['logged_in' => false, 'redirect' => '/ctrl/logout.php']);
}

// login / change-password は CTRL 側に一本化した
if ($action === 'login' || $action === 'change-password') {
    errorResponse('CTRL のログインを使用します（/ctrl/login.php）', 410);
}

errorResponse('invalid action', 400);
