<?php
/**
 * chat-notify.php — YobuChat DO (Cloudflare Worker) からのメール通知エントリポイント
 *
 * DO が新規チャットメッセージ受信時にこの PHP を叩く → サーバーの mail() でオーナーに通知.
 *
 * POST body: {
 *   secret: "CHAT_NOTIFY_SECRET",
 *   to: "owner@example.com",
 *   shop_name: "...",
 *   shop_slug: "...",
 *   session_token: "...",
 *   nickname: "...",
 *   message: "本文",
 *   sent_at: "ISO8601"
 * }
 */

require_once __DIR__ . '/db-config.php';

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method_not_allowed']);
    exit;
}

$raw = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'invalid_json']);
    exit;
}

// ---- 認証: secret ----
$expected = defined('CHAT_NOTIFY_SECRET') ? CHAT_NOTIFY_SECRET : '';
$provided = $body['secret'] ?? '';
if (!$expected || !hash_equals($expected, $provided)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'forbidden']);
    exit;
}

// ---- 入力検証 ----
$to = trim((string)($body['to'] ?? ''));
$shopName = (string)($body['shop_name'] ?? '');
$shopSlug = preg_replace('/[^a-z0-9\-]/', '', (string)($body['shop_slug'] ?? ''));
$sessionToken = preg_replace('/[^a-zA-Z0-9\-]/', '', (string)($body['session_token'] ?? ''));
$nickname = (string)($body['nickname'] ?? 'ゲスト');
$message = (string)($body['message'] ?? '');
$sentAt = (string)($body['sent_at'] ?? '');

if (!$to || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'invalid_to']);
    exit;
}
if (!$message) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'empty_message']);
    exit;
}

// 本文整形 (500文字制限)
$message = mb_substr($message, 0, 500);
$nickname = mb_substr($nickname, 0, 40);
$shopName = mb_substr($shopName, 0, 80);

// チャット画面URL (slug があればチャット直リンク、無ければ管理画面フォールバック)
$chatUrl = $shopSlug
    ? 'https://yobuho.com/chat/' . $shopSlug . '/?owner=1'
    : 'https://yobuho.com/shop-admin.html#chat';

$subject = "[YobuChat] {$shopName} に新しいチャットが届きました";
$textBody = <<<TXT
{$nickname} さんからチャットメッセージが届きました。

店舗: {$shopName}
送信時刻: {$sentAt}

-----
{$message}
-----

チャット画面から返信できます:
{$chatUrl}

※このメールは自動送信です。返信しないでください。
TXT;

// mail() で送信 (UTF-8 Base64 件名)
$encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
$headers = [
    'From: YobuChat <hotel@yobuho.com>',
    'Reply-To: hotel@yobuho.com',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'X-Mailer: YobuChat-DO',
];

$ok = @mail($to, $encodedSubject, $textBody, implode("\r\n", $headers), '-f hotel@yobuho.com');

if (!$ok) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'mail_failed']);
    exit;
}

echo json_encode(['ok' => true]);
