<?php
// =============================================================================
// chat-retention.php — YobuChat データ保持ポリシー適用
//
// ポリシー:
//   1) openセッション: 48時間 last_activity_at 無更新なら status='closed', closed_at=NOW()
//   2) closedセッション: closed_at から60日経過で DELETE（FK CASCADE で messages も削除）
//
// 呼び出し方法（どちらか）:
//   - 外部cron / UptimeRobot から GET https://yobuho.com/api/chat-retention.php?key=<SECRET>
//   - シンレン cPanel cron: curl -s "https://yobuho.com/api/chat-retention.php?key=<SECRET>"
//
// 推奨頻度: 1日1回。秒単位の正確さは不要。
//
// 認証: ?key= クエリが CHAT_RETENTION_SECRET と一致する必要がある。
//       db-config.php に CHAT_RETENTION_SECRET 定数を追加してください。
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/db-config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (!defined('CHAT_RETENTION_SECRET') || CHAT_RETENTION_SECRET === '') {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'CHAT_RETENTION_SECRET not configured']);
    exit;
}

$provided = (string)($_GET['key'] ?? '');
if (!hash_equals(CHAT_RETENTION_SECRET, $provided)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Forbidden']);
    exit;
}

try {
    $pdo = DB::conn();

    // 1) 48時間無応答のopenセッションをcloseに
    //    （訪問者/店舗どちらの最終活動からも計算できるよう last_activity_at を使う）
    $stmt = $pdo->prepare("
        UPDATE chat_sessions
           SET status = 'closed', closed_at = NOW()
         WHERE status = 'open'
           AND last_activity_at < DATE_SUB(NOW(), INTERVAL 48 HOUR)
    ");
    $stmt->execute();
    $closed = $stmt->rowCount();

    // 2) closedから60日経過したセッションを削除
    //    FK ON DELETE CASCADE で chat_messages も自動削除される
    $stmt = $pdo->prepare("
        DELETE FROM chat_sessions
         WHERE status = 'closed'
           AND closed_at IS NOT NULL
           AND closed_at < DATE_SUB(NOW(), INTERVAL 60 DAY)
    ");
    $stmt->execute();
    $deleted = $stmt->rowCount();

    // 3) 孤立した chat_messages が残っていないか念のため削除（通常は CASCADE で消える）
    $stmt = $pdo->prepare("
        DELETE m FROM chat_messages m
        LEFT JOIN chat_sessions s ON m.session_id = s.id
        WHERE s.id IS NULL
    ");
    $stmt->execute();
    $orphanedMessages = $stmt->rowCount();

    echo json_encode([
        'ok' => true,
        'at' => date('c'),
        'auto_closed_sessions' => $closed,
        'deleted_sessions'     => $deleted,
        'deleted_orphan_messages' => $orphanedMessages,
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
