<?php
/**
 * chat-flush-pending.php — 受付時間外で保留 (notify_pending=1) されたメール通知を
 * 受付時間内のショップに対してまとめて送信する.
 *
 * 認証: X-Sync-Secret ヘッダ (chat-sync.php と同じ secret).
 * 想定呼び出し元:
 *   - cf-worker scheduled trigger (10分ごとが推奨)
 *   - server cron (もし shin-rental 等で cron 設定するなら同等)
 *   - 外部監視 (UptimeRobot 等) からの定期 GET でも可
 *
 * 副作用:
 *   - 各 shop の保留中セッションについて maybeNotifyShop 経由でメール送信
 *   - 送信成功時 notify_pending=0 + notified_at=NOW() に更新 (二重送信防止)
 *
 * @return JSON {ok:true, shops_processed:N, sessions_flushed:M}
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/db.php';
// chat-api.php を library モードで include (session/CORS/routing をスキップ).
define('CHAT_API_LIBRARY_MODE', true);
require_once __DIR__ . '/chat-api.php';  // flushPendingNotifications, getShopById, etc.

// 認証
$provided = $_SERVER['HTTP_X_SYNC_SECRET'] ?? '';
$expected = defined('CHAT_SYNC_SECRET') ? CHAT_SYNC_SECRET : '';
if ($provided === '' || !hash_equals($expected, $provided)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'forbidden']);
    exit;
}

try {
    $pdo = DB::conn();
    // pending を持つ shop の一覧を取得 (DISTINCT で重複排除)
    $stmt = $pdo->query(
        'SELECT DISTINCT shop_id FROM chat_sessions WHERE notify_pending = 1'
    );
    $shopIds = $stmt->fetchAll(PDO::FETCH_COLUMN);

    $shopsProcessed = 0;
    $sessionsFlushedTotal = 0;
    foreach ($shopIds as $shopId) {
        // flushPendingNotifications 自体が isWithinReceptionHours で内部判定する.
        // 受付時間外ならその shop は今回 flush されず、次回 cron まで保留継続.

        // flush 前の保留数を取得 (ログ用)
        $countStmt = $pdo->prepare('SELECT COUNT(*) FROM chat_sessions WHERE shop_id = ? AND notify_pending = 1');
        $countStmt->execute([(string)$shopId]);
        $before = (int)$countStmt->fetchColumn();

        flushPendingNotifications((string)$shopId);

        // 残保留数
        $countStmt->execute([(string)$shopId]);
        $after = (int)$countStmt->fetchColumn();

        $sessionsFlushedTotal += max(0, $before - $after);
        $shopsProcessed++;
    }

    echo json_encode([
        'ok' => true,
        'shops_processed' => $shopsProcessed,
        'sessions_flushed' => $sessionsFlushedTotal,
        'at' => date('c'),
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    error_log('[chat-flush-pending] error: ' . $e->getMessage());
    echo json_encode(['ok' => false, 'error' => 'internal_error']);
}
