<?php
/**
 * chat-sync.php — YobuChat DO (Cloudflare Worker) → MySQL ミラーレシーバー
 *
 * DO が主データとして SQLite storage に書き込むが、admin画面/分析向けに
 * yobuho.com の MySQL (chat_sessions, chat_messages) にも同期書き込みする.
 *
 * 認証: X-Sync-Secret = CHAT_SYNC_SECRET (DO側 wrangler secret と共有)
 *
 * Actions:
 *   POST /api/chat-sync.php?action=upsert-session
 *     body: {shop_id, session_token, visitor_hash?, started_at, last_activity_at,
 *            last_visitor_heartbeat_at?, last_owner_heartbeat_at?,
 *            closed_at?, status, source, notified_at?, blocked}
 *
 *   POST /api/chat-sync.php?action=upsert-message
 *     body: {session_token, client_msg_id, sender_type, message, sent_at, read_at?}
 *
 *   POST /api/chat-sync.php?action=mark-read
 *     body: {session_token, reader:"visitor"|"shop", up_to_sent_at}
 */

require_once __DIR__ . '/db-config.php'; // define(CHAT_SYNC_SECRET) を先に読み込む
require_once __DIR__ . '/db.php';

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

// ---- 認証 ----
$expected = defined('CHAT_SYNC_SECRET') ? CHAT_SYNC_SECRET : '';
$provided = $_SERVER['HTTP_X_SYNC_SECRET'] ?? '';
if (!$expected || !hash_equals($expected, $provided)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'forbidden']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method_not_allowed']);
    exit;
}

$action = $_GET['action'] ?? '';
$raw = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'invalid_json']);
    exit;
}

$pdo = DB::conn();

try {
    switch ($action) {
        case 'upsert-session':
            handleUpsertSession($pdo, $body);
            break;
        case 'upsert-message':
            handleUpsertMessage($pdo, $body);
            break;
        case 'mark-read':
            handleMarkRead($pdo, $body);
            break;
        default:
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'unknown_action']);
            exit;
    }
} catch (Throwable $e) {
    error_log('[chat-sync] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'server_error']);
    exit;
}

echo json_encode(['ok' => true]);

// =========================================================

function handleUpsertSession(PDO $pdo, array $body): void {
    $token = (string)($body['session_token'] ?? '');
    $shopId = (string)($body['shop_id'] ?? '');
    if (!$token || !$shopId) throw new RuntimeException('missing_fields');

    $stmt = $pdo->prepare("
        INSERT INTO chat_sessions
            (shop_id, session_token, visitor_hash, started_at, last_activity_at,
             last_visitor_heartbeat_at, last_owner_heartbeat_at,
             closed_at, status, source, notified_at, blocked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            last_activity_at = VALUES(last_activity_at),
            last_visitor_heartbeat_at = VALUES(last_visitor_heartbeat_at),
            last_owner_heartbeat_at = VALUES(last_owner_heartbeat_at),
            closed_at = VALUES(closed_at),
            status = VALUES(status),
            notified_at = VALUES(notified_at),
            blocked = VALUES(blocked)
    ");
    $stmt->execute([
        $shopId,
        $token,
        $body['visitor_hash'] ?? null,
        mysqlDatetime($body['started_at'] ?? null),
        mysqlDatetime($body['last_activity_at'] ?? null) ?: mysqlDatetime('now'),
        mysqlDatetime($body['last_visitor_heartbeat_at'] ?? null),
        mysqlDatetime($body['last_owner_heartbeat_at'] ?? null),
        mysqlDatetime($body['closed_at'] ?? null),
        $body['status'] ?? 'open',
        $body['source'] ?? 'standalone',
        mysqlDatetime($body['notified_at'] ?? null),
        (int)($body['blocked'] ?? 0),
    ]);
}

function handleUpsertMessage(PDO $pdo, array $body): void {
    $token = (string)($body['session_token'] ?? '');
    $cmid  = (string)($body['client_msg_id'] ?? '');
    if (!$token || !$cmid) throw new RuntimeException('missing_fields');

    // session_id を解決
    $s = $pdo->prepare('SELECT id FROM chat_sessions WHERE session_token = ? LIMIT 1');
    $s->execute([$token]);
    $sid = $s->fetchColumn();
    if (!$sid) {
        // session 側がまだ未同期なら session レコードを先行作成できないので 202 で受け流す.
        // DO 側は次回 saveSession で再送される流れ.
        http_response_code(202);
        echo json_encode(['ok' => false, 'error' => 'session_not_synced_yet']);
        exit;
    }

    $stmt = $pdo->prepare("
        INSERT INTO chat_messages
            (session_id, client_msg_id, sender_type, message, sent_at, read_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            read_at = VALUES(read_at)
    ");
    $stmt->execute([
        (int)$sid,
        $cmid,
        $body['sender_type'] ?? 'visitor',
        mb_substr((string)($body['message'] ?? ''), 0, 500),
        mysqlDatetime($body['sent_at'] ?? null) ?: mysqlDatetime('now'),
        mysqlDatetime($body['read_at'] ?? null),
    ]);
}

function handleMarkRead(PDO $pdo, array $body): void {
    $token = (string)($body['session_token'] ?? '');
    $reader = $body['reader'] ?? '';
    $upTo = mysqlDatetime($body['up_to_sent_at'] ?? null);
    if (!$token || !$upTo || !in_array($reader, ['visitor', 'shop'], true)) {
        throw new RuntimeException('missing_fields');
    }

    // reader='visitor' なら自分が店舗msgを既読化 → sender_type='shop' を対象に read_at セット
    // reader='shop' ならその逆
    $target = $reader === 'visitor' ? 'shop' : 'visitor';

    $stmt = $pdo->prepare("
        UPDATE chat_messages cm
        INNER JOIN chat_sessions cs ON cs.id = cm.session_id
        SET cm.read_at = ?
        WHERE cs.session_token = ?
          AND cm.sender_type = ?
          AND cm.read_at IS NULL
          AND cm.sent_at <= ?
    ");
    $nowStr = mysqlDatetime('now');
    $stmt->execute([$nowStr, $token, $target, $upTo]);
}

/** ISO8601 / relative を MySQL DATETIME に変換 */
function mysqlDatetime($v): ?string {
    if ($v === null || $v === '') return null;
    if ($v === 'now') return gmdate('Y-m-d H:i:s');
    $ts = is_numeric($v) ? (int)$v : strtotime((string)$v);
    if ($ts === false) return null;
    return gmdate('Y-m-d H:i:s', $ts);
}
