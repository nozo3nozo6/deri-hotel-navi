<?php
/**
 * cast-chat-api.php — キャスト本人のチャット操作
 *
 * 認証: cast-auth.php のセッション共有（$_SESSION['cast_id']）
 *
 * Actions:
 *   - inbox         : 担当セッション一覧 + 指定セッションのメッセージ取得（owner-inbox の cast 版）
 *   - reply         : 担当セッションに sender_type='shop' としてメッセージ送信（訪問者視点は店舗返信）
 *   - toggle-online : shop_casts.chat_is_online の ON/OFF
 *   - toggle-notify : shop_casts.chat_notify_mode の first/every/off
 *
 * 権限:
 *   - 自分の cast_id に紐づく shop_casts のみ操作可能（shop_casts.status='active' でなければ拒否）
 *   - session の cast_id が自分でなければ拒否（別キャストのセッションには触れない）
 *   - sender_type='shop' で insert するため、訪問者側の UI・DB スキーマは既存のままで済む
 *     （誰が返信したかは chat_sessions.cast_id で判別可能）
 */
require_once __DIR__ . '/db.php';

define('CAST_CHAT_SESSION_TIMEOUT', 86400);

session_set_cookie_params([
    'lifetime' => CAST_CHAT_SESSION_TIMEOUT,
    'path' => '/',
    'domain' => 'yobuho.com',
    'secure' => true,
    'httponly' => true,
    'samesite' => 'Strict'
]);
session_start();

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');
header('Access-Control-Allow-Origin: https://yobuho.com');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Credentials: true');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

function cc_inp(string $key, $default = null) {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    return $body[$key] ?? $_GET[$key] ?? $_POST[$key] ?? $default;
}
function cc_ok($data = []) { echo json_encode(['ok' => true] + $data, JSON_UNESCAPED_UNICODE); exit; }
function cc_err(string $msg, int $code = 400) { http_response_code($code); echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE); exit; }

function cc_requireAuth(): array {
    if (empty($_SESSION['cast_id'])) cc_err('未ログインです', 401);
    if (time() - ($_SESSION['cast_last_activity'] ?? 0) > CAST_CHAT_SESSION_TIMEOUT) {
        unset($_SESSION['cast_id'], $_SESSION['cast_email'], $_SESSION['cast_last_activity']);
        cc_err('セッションがタイムアウトしました', 401);
    }
    $_SESSION['cast_last_activity'] = time();
    return ['cast_id' => $_SESSION['cast_id']];
}

function cc_isValidClientMsgId($id): bool {
    if (!is_string($id) || strlen($id) < 8 || strlen($id) > 36) return false;
    return (bool)preg_match('/^[A-Za-z0-9_\-]+$/', $id);
}

/**
 * shop_cast_id が自分（cast）の所有か検証し、(shop_id, cast_id, status) を返す.
 * status='active' 以外は null を返す.
 */
function cc_resolveShopCast(string $shopCastId, string $castId): ?array {
    if ($shopCastId === '') return null;
    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT id, shop_id, cast_id, status, chat_is_online, chat_notify_mode, display_name
         FROM shop_casts WHERE id = ? AND cast_id = ? LIMIT 1'
    );
    $stmt->execute([$shopCastId, $castId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || $row['status'] !== 'active') return null;
    return $row;
}

$action = $_GET['action'] ?? '';

try {
    switch ($action) {
        case 'inbox':         handleInbox(); break;
        case 'reply':         handleReply(); break;
        case 'toggle-online': handleToggleOnline(); break;
        case 'toggle-notify': handleToggleNotify(); break;
        default:
            cc_err('Invalid action');
    }
} catch (Throwable $e) {
    cc_err('Server error: ' . $e->getMessage(), 500);
}

/**
 * inbox: 担当セッション一覧 + 指定セッションのメッセージ
 * 入力: shop_cast_id (required), session_id (optional), since_id (optional)
 */
function handleInbox(): void {
    $auth = cc_requireAuth();
    $shopCastId = (string)cc_inp('shop_cast_id', '');
    $sessionId = (int)cc_inp('session_id', 0);
    $sinceId = (int)cc_inp('since_id', 0);

    $sc = cc_resolveShopCast($shopCastId, $auth['cast_id']);
    if (!$sc) cc_err('この店舗での操作権限がありません（未承認または停止中）', 403);

    $pdo = DB::conn();

    // heartbeat: キャストがこの shop を見ていることを記録
    $pdo->prepare('UPDATE shop_casts SET chat_last_online_at = NOW() WHERE id = ?')
        ->execute([$sc['id']]);

    // 担当セッション一覧 (shop_id + cast_id が一致するものだけ)
    $stmt = $pdo->prepare(
        'SELECT s.id, s.session_token, s.status, s.blocked, s.started_at, s.last_activity_at, s.nickname, s.cast_id,
                (SELECT message FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) AS last_message,
                (SELECT sender_type FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) AS last_sender,
                (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id AND sender_type = "visitor" AND read_at IS NULL) AS unread_count
         FROM chat_sessions s
         WHERE s.shop_id = ? AND s.cast_id = ?
         ORDER BY s.last_activity_at DESC
         LIMIT 30'
    );
    $stmt->execute([$sc['shop_id'], $sc['cast_id']]);
    $sessions = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $messages = [];
    $status = null;
    $lastReadOwnId = 0;

    if ($sessionId > 0) {
        // 指定セッションが自分の担当か検証
        $stmt = $pdo->prepare(
            'SELECT id, status, visitor_hash, cast_id FROM chat_sessions
             WHERE id = ? AND shop_id = ? AND cast_id = ? LIMIT 1'
        );
        $stmt->execute([$sessionId, $sc['shop_id'], $sc['cast_id']]);
        $sessRow = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($sessRow) {
            $status = $sessRow['status'];

            // since_id 以降のメッセージ
            $stmt = $pdo->prepare(
                'SELECT id, sender_type, message, source_lang, sent_at, client_msg_id
                 FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC'
            );
            $stmt->execute([$sessionId, $sinceId]);
            $messages = $stmt->fetchAll(PDO::FETCH_ASSOC);

            // shop (= キャスト自身の返信) が visitor に既読された最大 ID
            $stmt = $pdo->prepare(
                "SELECT COALESCE(MAX(id),0) FROM chat_messages
                 WHERE session_id = ? AND sender_type = 'shop' AND read_at IS NOT NULL"
            );
            $stmt->execute([$sessionId]);
            $lastReadOwnId = (int)$stmt->fetchColumn();

            // visitor側メッセージを既読に
            $pdo->prepare(
                "UPDATE chat_messages SET read_at = NOW()
                 WHERE session_id = ? AND sender_type = 'visitor' AND read_at IS NULL"
            )->execute([$sessionId]);

            // presence heartbeat (owner 側 heartbeat カラムを流用、閲覧検知はキャストでも同じ意味)
            $pdo->prepare('UPDATE chat_sessions SET last_owner_heartbeat_at = NOW() WHERE id = ?')
                ->execute([$sessionId]);
        }
    }

    cc_ok([
        'sessions'         => $sessions,
        'messages'         => $messages,
        'status'           => $status,
        'last_read_own_id' => $lastReadOwnId,
        'shop_online'      => (int)$sc['chat_is_online'] === 1,
        'notify_mode'      => $sc['chat_notify_mode'],
        'server_time'      => date('c'),
    ]);
}

/**
 * reply: 担当セッションにキャストとして返信（sender_type='shop'）
 * 入力: session_id, message, client_msg_id (optional), since_id (optional)
 */
function handleReply(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') cc_err('POST only', 405);
    $auth = cc_requireAuth();
    $sessionId = (int)cc_inp('session_id', 0);
    $msg = trim((string)cc_inp('message', ''));
    $clientMsgId = (string)cc_inp('client_msg_id', '');
    $sinceId = (int)cc_inp('since_id', 0);

    if ($sessionId <= 0) cc_err('session_id required');
    if ($msg === '') cc_err('message required');
    if (mb_strlen($msg) > 1000) cc_err('メッセージが長すぎます');
    if ($clientMsgId !== '' && !cc_isValidClientMsgId($clientMsgId)) cc_err('invalid client_msg_id');

    $pdo = DB::conn();

    // 担当セッション確認（このキャストの cast_id と一致必須）
    $stmt = $pdo->prepare(
        'SELECT s.id, s.shop_id, s.cast_id, s.status
         FROM chat_sessions s WHERE s.id = ? AND s.cast_id = ? LIMIT 1'
    );
    $stmt->execute([$sessionId, $auth['cast_id']]);
    $session = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$session) cc_err('担当セッションではありません', 404);
    if ($session['status'] === 'closed') cc_err('セッションは終了しています', 410);

    // shop_casts.status=active 確認（停止中/承認待ちは送信不可）
    $stmt = $pdo->prepare(
        'SELECT id FROM shop_casts
         WHERE shop_id = ? AND cast_id = ? AND status = "active" LIMIT 1'
    );
    $stmt->execute([$session['shop_id'], $auth['cast_id']]);
    $scId = $stmt->fetchColumn();
    if (!$scId) cc_err('この店舗での送信権限がありません', 403);

    // 冪等送信
    if ($clientMsgId !== '') {
        $stmt = $pdo->prepare(
            "SELECT id FROM chat_messages
             WHERE client_msg_id = ? AND session_id = ? AND sender_type = 'shop' LIMIT 1"
        );
        $stmt->execute([$clientMsgId, $sessionId]);
        $existingId = (int)$stmt->fetchColumn();
        if ($existingId) {
            cc_respondReplyBatch($pdo, $sessionId, $sinceId, ['message_id' => $existingId, 'client_msg_id' => $clientMsgId, 'duplicate' => true]);
            return;
        }
    }

    try {
        $stmt = $pdo->prepare(
            "INSERT INTO chat_messages (session_id, sender_type, message, source_lang, client_msg_id)
             VALUES (?, 'shop', ?, 'ja', ?)"
        );
        $stmt->execute([$sessionId, $msg, $clientMsgId ?: null]);
        $messageId = (int)$pdo->lastInsertId();
    } catch (PDOException $e) {
        if ($clientMsgId !== '' && strpos($e->getMessage(), '1062') !== false) {
            $stmt = $pdo->prepare('SELECT id FROM chat_messages WHERE client_msg_id = ? LIMIT 1');
            $stmt->execute([$clientMsgId]);
            $messageId = (int)$stmt->fetchColumn();
            if (!$messageId) throw $e;
        } else {
            throw $e;
        }
    }

    $pdo->prepare(
        'UPDATE chat_sessions SET last_activity_at = NOW(), last_owner_heartbeat_at = NOW() WHERE id = ?'
    )->execute([$sessionId]);

    cc_respondReplyBatch($pdo, $sessionId, $sinceId, ['message_id' => $messageId, 'client_msg_id' => $clientMsgId ?: null]);
}

function cc_respondReplyBatch(PDO $pdo, int $sessionId, int $sinceId, array $extra = []): void {
    $stmt = $pdo->prepare(
        'SELECT id, sender_type, message, source_lang, sent_at, client_msg_id
         FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC'
    );
    $stmt->execute([$sessionId, $sinceId]);
    $messages = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $stmt = $pdo->prepare(
        "SELECT COALESCE(MAX(id),0) FROM chat_messages
         WHERE session_id = ? AND sender_type = 'shop' AND read_at IS NOT NULL"
    );
    $stmt->execute([$sessionId]);
    $lastReadOwnId = (int)$stmt->fetchColumn();

    $stmt = $pdo->prepare('SELECT status FROM chat_sessions WHERE id = ? LIMIT 1');
    $stmt->execute([$sessionId]);
    $status = (string)$stmt->fetchColumn();

    cc_ok(array_merge($extra, [
        'messages'         => $messages,
        'status'           => $status,
        'last_read_own_id' => $lastReadOwnId,
        'shop_online'      => true,
        'server_time'      => date('c'),
    ]));
}

/**
 * toggle-online: 自分の shop_casts.chat_is_online を ON/OFF
 * 入力: shop_cast_id, on (bool)
 */
function handleToggleOnline(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') cc_err('POST only', 405);
    $auth = cc_requireAuth();
    $shopCastId = (string)cc_inp('shop_cast_id', '');
    $on = (bool)cc_inp('on', false);

    $sc = cc_resolveShopCast($shopCastId, $auth['cast_id']);
    if (!$sc) cc_err('この店舗での操作権限がありません（未承認または停止中）', 403);

    $pdo = DB::conn();
    $pdo->prepare(
        'UPDATE shop_casts SET chat_is_online = ?, chat_last_online_at = NOW() WHERE id = ?'
    )->execute([$on ? 1 : 0, $sc['id']]);

    cc_ok(['chat_is_online' => $on]);
}

/**
 * toggle-notify: 自分の shop_casts.chat_notify_mode を first/every/off に切替
 * 入力: shop_cast_id, mode
 */
function handleToggleNotify(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') cc_err('POST only', 405);
    $auth = cc_requireAuth();
    $shopCastId = (string)cc_inp('shop_cast_id', '');
    $mode = (string)cc_inp('mode', 'off');
    if (!in_array($mode, ['first', 'every', 'off'], true)) cc_err('invalid mode');

    $sc = cc_resolveShopCast($shopCastId, $auth['cast_id']);
    if (!$sc) cc_err('この店舗での操作権限がありません（未承認または停止中）', 403);

    $pdo = DB::conn();
    $pdo->prepare('UPDATE shop_casts SET chat_notify_mode = ? WHERE id = ?')
        ->execute([$mode, $sc['id']]);

    cc_ok(['notify_mode' => $mode]);
}
