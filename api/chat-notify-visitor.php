<?php
/**
 * chat-notify-visitor.php — DO がオーナー(店舗/キャスト)返信時に呼び出す訪問者宛メール通知
 *
 * POST body: {
 *   secret: "CHAT_NOTIFY_SECRET",
 *   session_token: "...",
 *   shop_name: "...",
 *   shop_slug: "...",
 *   cast_name: "..." | null,
 *   shop_cast_id: "..." | null,   // shop_casts.id (chat.js の ?cast= が期待)
 *   message: "返信本文",
 *   sent_at: "ISO8601"
 * }
 *
 * 訪問者が visitor-notify-settings で email opt-in している場合のみメール送信.
 * 5分のクールダウンで連続送信を抑制.
 * メールには解除リンク(/api/chat-unsubscribe.php?t=<token>&k=<hmac>)を含む.
 */

require_once __DIR__ . '/db-config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mail-utils.php';

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

$expected = defined('CHAT_NOTIFY_SECRET') ? CHAT_NOTIFY_SECRET : '';
$provided = $body['secret'] ?? '';
if (!$expected || !hash_equals($expected, $provided)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'forbidden']);
    exit;
}

$sessionToken = preg_replace('/[^a-zA-Z0-9\-]/', '', (string)($body['session_token'] ?? ''));
$shopName = mb_substr((string)($body['shop_name'] ?? ''), 0, 80);
$shopSlug = preg_replace('/[^a-z0-9\-]/', '', (string)($body['shop_slug'] ?? ''));
$castName = mb_substr((string)($body['cast_name'] ?? ''), 0, 40);
$shopCastId = preg_replace('/[^a-zA-Z0-9\-]/', '', (string)($body['shop_cast_id'] ?? ''));
$message = mb_substr((string)($body['message'] ?? ''), 0, 500);
$sentAt = (string)($body['sent_at'] ?? '');

if ($sessionToken === '' || $message === '') {
    echo json_encode(['ok' => true, 'skipped' => 'empty']);
    exit;
}

try {
    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT id, visitor_email, visitor_notify_enabled, visitor_last_notified_at
         FROM chat_sessions WHERE session_token = ? LIMIT 1'
    );
    $stmt->execute([$sessionToken]);
    $sess = $stmt->fetch();
    if (!$sess) {
        echo json_encode(['ok' => true, 'skipped' => 'session_not_found']);
        exit;
    }
    if ((int)$sess['visitor_notify_enabled'] !== 1) {
        echo json_encode(['ok' => true, 'skipped' => 'notify_disabled']);
        exit;
    }
    $email = trim((string)($sess['visitor_email'] ?? ''));
    if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        echo json_encode(['ok' => true, 'skipped' => 'no_email']);
        exit;
    }

    // 5分クールダウン: 連続返信で訪問者のメールを溢れさせない
    if (!empty($sess['visitor_last_notified_at'])) {
        $last = strtotime((string)$sess['visitor_last_notified_at']);
        if ($last && (time() - $last) < 300) {
            echo json_encode(['ok' => true, 'skipped' => 'cooldown']);
            exit;
        }
    }

    // 解除リンク (HMAC)
    $sig = substr(hash_hmac('sha256', $sessionToken, CHAT_NOTIFY_SECRET), 0, 24);
    $unsubUrl = 'https://yobuho.com/api/chat-unsubscribe.php?t=' . rawurlencode($sessionToken) . '&k=' . rawurlencode($sig);

    // チャット復帰URL (?resume= で chat.js が既存セッションを復元)
    $resumeQuery = 'resume=' . rawurlencode($sessionToken);
    if ($shopCastId !== '') {
        $resumeQuery = 'cast=' . rawurlencode($shopCastId) . '&' . $resumeQuery;
    }
    $chatUrl = $shopSlug
        ? 'https://yobuho.com/chat/' . $shopSlug . '/?' . $resumeQuery
        : 'https://yobuho.com/';

    $fromLabel = $castName !== '' ? "{$castName}（{$shopName}）" : $shopName;
    $subject = "[YobuChat] {$fromLabel} から返信が届きました";

    $escFrom = htmlspecialchars($fromLabel, ENT_QUOTES, 'UTF-8');
    $escMsg = nl2br(htmlspecialchars($message, ENT_QUOTES, 'UTF-8'));
    $escSent = htmlspecialchars($sentAt, ENT_QUOTES, 'UTF-8');

    $htmlBody = <<<HTML
<!DOCTYPE html>
<html lang="ja"><body style="font-family: sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
<p style="font-size: 15px;"><strong>{$escFrom}</strong> から返信が届きました。</p>
<p style="font-size: 13px; color: #888;">送信時刻: {$escSent}</p>
<div style="border-left: 3px solid #b5627a; padding: 12px 16px; background: #faf3f5; margin: 16px 0; font-size: 14px;">
{$escMsg}
</div>
<p style="margin: 24px 0;">
<a href="{$chatUrl}" style="display: inline-block; background: #b5627a; color: #fff; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">チャットを開いて返信</a>
</p>
<hr style="border: none; border-top: 1px solid #ddd; margin: 32px 0;">
<p style="font-size: 12px; color: #888;">
このメールは YobuChat の返信通知です。<br>
通知を停止する場合は <a href="{$unsubUrl}">こちら</a> をクリックしてください。
</p>
</body></html>
HTML;

    $sent = sendTransactionalMail($email, $subject, $htmlBody);
    if (!$sent) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'mail_failed']);
        exit;
    }

    $upd = $pdo->prepare('UPDATE chat_sessions SET visitor_last_notified_at = NOW() WHERE id = ?');
    $upd->execute([$sess['id']]);

    echo json_encode(['ok' => true]);
} catch (Throwable $e) {
    error_log('[chat-notify-visitor] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'internal']);
}
