<?php
/**
 * chat-unsubscribe.php — 訪問者がメール内リンクからアクセスする通知解除エンドポイント
 *
 * GET /api/chat-unsubscribe.php?t=<session_token>&k=<hmac24>
 *
 * HMAC 検証後 chat_sessions.visitor_notify_enabled=0 に更新.
 * 応答は日本語HTML (訪問者が直接開く).
 */

require_once __DIR__ . '/db-config.php';
require_once __DIR__ . '/db.php';

header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-store');

$token = isset($_GET['t']) ? preg_replace('/[^a-zA-Z0-9\-]/', '', (string)$_GET['t']) : '';
$sig = isset($_GET['k']) ? preg_replace('/[^a-zA-Z0-9]/', '', (string)$_GET['k']) : '';

function render_page(string $title, string $message, bool $ok): void {
    $color = $ok ? '#2a8a5e' : '#a44';
    $icon = $ok ? '✓' : '!';
    $t = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
    $m = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');
    echo <<<HTML
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{$t} — YobuChat</title>
<style>
body { font-family: system-ui, sans-serif; background: #faf3f5; margin: 0; padding: 40px 20px; min-height: 100vh; box-sizing: border-box; }
.card { max-width: 480px; margin: 40px auto; background: #fff; border-radius: 12px; padding: 32px 28px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); text-align: center; }
.icon { width: 64px; height: 64px; line-height: 64px; border-radius: 50%; background: {$color}; color: #fff; font-size: 32px; font-weight: bold; margin: 0 auto 16px; display: block; }
h1 { font-size: 20px; color: #333; margin: 0 0 12px; }
p { color: #555; line-height: 1.7; font-size: 15px; margin: 8px 0; }
a { color: #b5627a; text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="card">
<div class="icon">{$icon}</div>
<h1>{$t}</h1>
<p>{$m}</p>
<p style="margin-top: 24px; font-size: 13px; color: #888;"><a href="https://yobuho.com/">YobuHo トップへ</a></p>
</div>
</body>
</html>
HTML;
}

if ($token === '' || $sig === '') {
    http_response_code(400);
    render_page('リンクが無効です', 'URLが正しくありません。メール本文のリンクをご確認ください。', false);
    exit;
}

$expected = defined('CHAT_NOTIFY_SECRET') ? CHAT_NOTIFY_SECRET : '';
if (!$expected) {
    http_response_code(500);
    render_page('設定エラー', 'サーバー設定が不完全です。お手数ですが管理者にお問い合わせください。', false);
    exit;
}

$expectedSig = substr(hash_hmac('sha256', $token, $expected), 0, 24);
if (!hash_equals($expectedSig, $sig)) {
    http_response_code(403);
    render_page('リンクが無効です', '署名が一致しません。最新のメール本文のリンクをお試しください。', false);
    exit;
}

try {
    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id, visitor_notify_enabled FROM chat_sessions WHERE session_token = ? LIMIT 1');
    $stmt->execute([$token]);
    $sess = $stmt->fetch();
    if (!$sess) {
        http_response_code(404);
        render_page('セッションが見つかりません', '該当するチャットセッションが見つかりませんでした（既に削除されている可能性があります）。', false);
        exit;
    }

    if ((int)$sess['visitor_notify_enabled'] === 0) {
        render_page('すでに解除済みです', '返信通知メールはすでに停止されています。', true);
        exit;
    }

    $upd = $pdo->prepare('UPDATE chat_sessions SET visitor_notify_enabled = 0 WHERE id = ?');
    $upd->execute([$sess['id']]);

    render_page('通知を解除しました', 'このチャットへの返信通知メールを停止しました。ご利用ありがとうございました。', true);
} catch (Throwable $e) {
    error_log('[chat-unsubscribe] ' . $e->getMessage());
    http_response_code(500);
    render_page('エラーが発生しました', '処理中にエラーが発生しました。時間をおいて再度お試しください。', false);
}
