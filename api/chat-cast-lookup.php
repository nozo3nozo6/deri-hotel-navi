<?php
/**
 * chat-cast-lookup.php — YobuChat DO (Cloudflare Worker) 用キャスト指名 resolver
 *
 * ?cast=<shop_casts.id> で来た訪問者セッションを DO で開くとき、
 * cf-worker がこの PHP を叩いて shop_casts.id を実 cast_id + display_name に解決する.
 *
 * GET /api/chat-cast-lookup.php?shop_id=XXX&shop_cast_id=YYY
 * Auth: X-Sync-Secret = CHAT_SYNC_SECRET (DO と共有)
 *
 * Response:
 *   200: { ok: true, cast_id: "...", display_name: "...", shop_cast_id: "..." }
 *        (shop_casts.status = 'active' のときのみ。非 active は ok:false, reason:"inactive")
 *   404: { ok: false, error: "not_found" }
 *   403: { ok: false, error: "forbidden" }
 */

require_once __DIR__ . '/db-config.php';
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

$shopId = (string)($_GET['shop_id'] ?? '');
$shopCastId = (string)($_GET['shop_cast_id'] ?? '');
if ($shopId === '' || $shopCastId === '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'missing_fields']);
    exit;
}

try {
    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT sc.id AS shop_cast_id, sc.cast_id, sc.display_name, sc.status
         FROM shop_casts sc
         WHERE sc.id = ? AND sc.shop_id = ? LIMIT 1'
    );
    $stmt->execute([$shopCastId, $shopId]);
    $row = $stmt->fetch();

    if (!$row) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'not_found']);
        exit;
    }

    if ($row['status'] !== 'active') {
        // 承認待ち / 停止中 / 削除済み → 店舗直通にフォールバックさせる
        echo json_encode(['ok' => false, 'reason' => 'inactive', 'status' => $row['status']]);
        exit;
    }

    echo json_encode([
        'ok' => true,
        'shop_cast_id' => $row['shop_cast_id'],
        'cast_id' => $row['cast_id'],
        'display_name' => $row['display_name'],
    ]);
} catch (Throwable $e) {
    error_log('[chat-cast-lookup] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'server_error']);
}
