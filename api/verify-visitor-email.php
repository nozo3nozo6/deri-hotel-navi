<?php
/**
 * verify-visitor-email.php — 訪問者メール Magic Link 確認ページ
 *
 * GET /api/verify-visitor-email.php?token=<64 hex>
 *
 * chat-api.php の visitor-notify-settings / resend-visitor-email-verify が発行した
 * トークンを受け取り、chat_sessions.visitor_email_verified=1 に更新する.
 *
 * 有効期限: 24時間 (visitor_email_verify_expires_at)
 * 応答は日本語HTML (訪問者が直接開く).
 *
 * セキュリティ:
 *   - トークンは 64文字 hex (256bit) → 総当たり不可
 *   - 有効期限ガード
 *   - 使用後にトークンは消去 (visitor_email_verify_token=NULL)
 */

require_once __DIR__ . '/db-config.php';
require_once __DIR__ . '/db.php';

header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-store');

$token = isset($_GET['token']) ? preg_replace('/[^a-f0-9]/', '', (string)$_GET['token']) : '';

function render_verify_page(string $title, string $message, bool $ok, string $chatUrl = ''): void {
    $color = $ok ? '#2a8a5e' : '#a44';
    $icon = $ok ? '✓' : '!';
    $t = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
    $m = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');

    $chatLink = '';
    if ($ok && $chatUrl !== '') {
        $escUrl = htmlspecialchars($chatUrl, ENT_QUOTES, 'UTF-8');
        $chatLink = <<<HTML
<p style="margin: 24px 0 12px;">
<a href="{$escUrl}" style="display: inline-block; background: #b5627a; color: #fff; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">チャットに戻る</a>
</p>
HTML;
    }

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
{$chatLink}
<p style="margin-top: 24px; font-size: 13px; color: #888;"><a href="https://yobuho.com/">YobuHo トップへ</a></p>
</div>
</body>
</html>
HTML;
}

if ($token === '' || strlen($token) !== 64) {
    http_response_code(400);
    render_verify_page('リンクが無効です', 'URLが正しくありません。メール本文のリンクをご確認ください。', false);
    exit;
}

try {
    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT cs.id, cs.session_token, cs.visitor_email_verified, cs.visitor_email_verify_expires_at, sh.slug
         FROM chat_sessions cs
         LEFT JOIN shops sh ON sh.id = cs.shop_id
         WHERE cs.visitor_email_verify_token = ? LIMIT 1'
    );
    $stmt->execute([$token]);
    $sess = $stmt->fetch();

    if (!$sess) {
        http_response_code(404);
        render_verify_page(
            'リンクが無効または期限切れです',
            'このリンクは既に使用済みか、期限が切れています。YobuChat を開いて通知設定から「確認メールを再送」してください。',
            false
        );
        exit;
    }

    // 有効期限チェック
    $expiresAt = (string)($sess['visitor_email_verify_expires_at'] ?? '');
    $expired = false;
    if ($expiresAt === '') {
        $expired = true;
    } else {
        $exp = strtotime($expiresAt);
        if (!$exp || $exp < time()) $expired = true;
    }
    if ($expired) {
        // 期限切れトークンは消去 (再利用不可にする)
        $cleanup = $pdo->prepare(
            'UPDATE chat_sessions
             SET visitor_email_verify_token = NULL,
                 visitor_email_verify_expires_at = NULL
             WHERE id = ?'
        );
        $cleanup->execute([$sess['id']]);

        http_response_code(410);
        render_verify_page(
            'リンクの有効期限が切れています',
            'この確認リンクは24時間の有効期限を過ぎました。YobuChat を開いて通知設定から「確認メールを再送」してください。',
            false
        );
        exit;
    }

    // 確認実行: verified=1 にしてトークン消去
    $upd = $pdo->prepare(
        'UPDATE chat_sessions
         SET visitor_email_verified = 1,
             visitor_email_verify_token = NULL,
             visitor_email_verify_expires_at = NULL
         WHERE id = ?'
    );
    $upd->execute([$sess['id']]);

    $chatUrl = '';
    $slug = (string)($sess['slug'] ?? '');
    $sessionToken = (string)($sess['session_token'] ?? '');
    if ($slug !== '' && $sessionToken !== '') {
        $chatUrl = 'https://yobuho.com/chat/' . rawurlencode($slug) . '/?resume=' . rawurlencode($sessionToken);
    }

    $alreadyVerified = (int)($sess['visitor_email_verified'] ?? 0) === 1;
    if ($alreadyVerified) {
        render_verify_page(
            'すでに確認済みです',
            'このメールアドレスは既に確認済みです。新着メッセージが届くと通知メールが送信されます。',
            true,
            $chatUrl
        );
    } else {
        render_verify_page(
            'メールアドレスを確認しました',
            '通知設定が有効になりました。新着メッセージが届くと、このメールアドレスに通知をお送りします。',
            true,
            $chatUrl
        );
    }
} catch (Throwable $e) {
    error_log('[verify-visitor-email] ' . $e->getMessage());
    http_response_code(500);
    render_verify_page('エラーが発生しました', '処理中にエラーが発生しました。時間をおいて再度お試しください。', false);
}
