<?php
/**
 * chat-notify.php — YobuChat DO (Cloudflare Worker) からのメール通知エントリポイント
 *
 * DO が新規チャットメッセージ受信時にこの PHP を叩く → サーバーの mail() でオーナーに通知.
 *
 * POST body: {
 *   secret: "CHAT_NOTIFY_SECRET",
 *   to: "owner@example.com",   // 店舗既定 (fallback)
 *   shop_name: "...",
 *   shop_slug: "...",
 *   session_token: "...",
 *   nickname: "...",
 *   message: "本文",
 *   sent_at: "ISO8601",
 *   cast_id: "..." | null,     // キャスト指名セッションなら casts.id
 *   cast_name: "..." | null
 * }
 *
 * cast_id が指定されていて casts.email が取得できれば、送信先を
 * キャスト本人のメールへ差し替える（承認済み active のみ）.
 */

require_once __DIR__ . '/db-config.php';
require_once __DIR__ . '/db.php';

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
$castId = trim((string)($body['cast_id'] ?? ''));
$castName = trim((string)($body['cast_name'] ?? ''));
$firstInSession = !empty($body['first_in_session']);

// キャスト指名: casts.email へ宛先差し替え + shop_casts.chat_notify_mode を適用.
// （active 以外 / mode='off' / mode='first' で既送信のときは店舗既定に落とさず明示的にスキップ）
if ($castId !== '') {
    try {
        $pdo = DB::conn();
        // cast_id は実 casts.id. shop_casts を casts.id で引いてキャスト個別モードを取得.
        // （同じ cast が複数店舗に所属しうるが, shop_slug で店舗を特定して絞る）
        $stmt = $pdo->prepare(
            'SELECT c.email, c.status AS cast_status,
                    sc.chat_notify_mode, sc.status AS sc_status
             FROM casts c
             JOIN shop_casts sc ON sc.cast_id = c.id
             JOIN shops s ON s.id = sc.shop_id
             WHERE c.id = ? AND s.slug = ? LIMIT 1'
        );
        $stmt->execute([$castId, $shopSlug]);
        $castRow = $stmt->fetch();

        if (!$castRow || $castRow['cast_status'] !== 'active' || $castRow['sc_status'] !== 'active' || empty($castRow['email'])) {
            // キャスト無効 → 送信しない (店舗既定にフォールバックすると意図しない宛先に行くため)
            echo json_encode(['ok' => true, 'skipped' => 'cast_inactive']);
            exit;
        }

        $castMode = $castRow['chat_notify_mode'] ?? 'off';
        if ($castMode === 'off') {
            echo json_encode(['ok' => true, 'skipped' => 'cast_notify_off']);
            exit;
        }
        if ($castMode === 'first' && !$firstInSession) {
            echo json_encode(['ok' => true, 'skipped' => 'cast_notify_first_already_sent']);
            exit;
        }
        // mode === 'every' は throttle なしで都度送信 (キャスト側で 'first' に絞れる)

        $to = $castRow['email'];
    } catch (Throwable $e) {
        error_log('[chat-notify] cast lookup failed: ' . $e->getMessage());
        // DB エラー時は店舗宛てにフォールバックせずスキップ (キャスト指名で店舗に漏れるのを防ぐ)
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'cast_lookup_failed']);
        exit;
    }
}

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
$castName = mb_substr($castName, 0, 40);

// チャット画面URL (slug があればチャット直リンク、無ければ管理画面フォールバック)
// キャスト指名はキャスト本人がログインするので、キャスト管理画面に誘導
$chatUrl = $castId
    ? 'https://yobuho.com/cast-admin.html#chat'
    : ($shopSlug
        ? 'https://yobuho.com/chat/' . $shopSlug . '/?owner=1'
        : 'https://yobuho.com/shop-admin.html#chat');

$recipientLabel = $castName !== '' ? "{$castName}（{$shopName}）" : $shopName;
$subject = "[YobuChat] {$recipientLabel} に新しいチャットが届きました";
$textBody = <<<TXT
{$nickname} さんからチャットメッセージが届きました。

宛先: {$recipientLabel}
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
