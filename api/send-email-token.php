<?php
/**
 * send-email-token.php — 店舗登録用メール認証トークン送信
 * POST: { "email": "shop@example.com", "genre": "men" }
 * トークン生成 → DB保存 → メール送信
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
if (!$input) { http_response_code(400); echo json_encode(['error' => 'Invalid request']); exit; }

$email = trim($input['email'] ?? '');
$genre = $input['genre'] ?? 'men';

if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['error' => '有効なメールアドレスを入力してください']);
    exit;
}

// レート制限: 同じメールへのトークン送信は5分に1回
$stmt = $pdo->prepare('SELECT COUNT(*) FROM shop_email_tokens WHERE email = ? AND created_at >= ? AND used = 0');
$stmt->execute([$email, gmdate('Y-m-d H:i:s', time() - 300)]);
if ($stmt->fetchColumn() > 0) {
    http_response_code(429);
    echo json_encode(['error' => '認証メールは5分に1回のみ送信できます。しばらくお待ちください。']);
    exit;
}

// トークン生成
$token = bin2hex(random_bytes(32)); // 64文字
$expiresAt = gmdate('Y-m-d H:i:s', time() + 3600); // 1時間有効

// DB保存
$stmt = $pdo->prepare('INSERT INTO shop_email_tokens (email, token, genre, expires_at) VALUES (?, ?, ?, ?)');
$stmt->execute([$email, $token, $genre, $expiresAt]);

// メール送信
$verifyUrl = "https://yobuho.com/shop-register.html?step=profile&token={$token}&genre={$genre}";

$mailBody = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#b5627a;">YobuHo - 店舗登録認証</h2>
<p>以下のリンクをクリックして、店舗登録を続けてください。</p>
<div style="text-align:center;margin:30px 0;">
<a href="' . htmlspecialchars($verifyUrl) . '" style="display:inline-block;padding:14px 36px;background:#b5627a;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:bold;">登録を続ける</a>
</div>
<p style="font-size:12px;color:#888;">このリンクは1時間有効です。</p>
<p style="font-size:12px;color:#888;">このメールに心当たりがない場合は無視してください。</p>
<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
<p style="font-size:12px;color:#888;">このメールは YobuHo (yobuho.com) から自動送信されています。</p>
</div>';

// send-mail.phpと同じ方式でメール送信
$subject = '【YobuHo】店舗登録認証メール';
$headers = [
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'From: YobuHo <hotel@yobuho.com>',
];
$encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
$encodedBody = base64_encode($mailBody);

$sent = mail($email, $encodedSubject, $encodedBody, implode("\r\n", $headers));

if ($sent) {
    echo json_encode(['success' => true]);
} else {
    error_log('[send-email-token] Failed to send email to: ' . $email);
    http_response_code(500);
    echo json_encode(['error' => 'メール送信に失敗しました。しばらく時間をおいて再度お試しください。']);
}
