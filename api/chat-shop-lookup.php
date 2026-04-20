<?php
/**
 * chat-shop-lookup.php — YobuChat DO (Cloudflare Worker) 専用の shop メタ取得API
 *
 * DO の Router が shop_slug / shop_id から shop メタを取得するための内部API.
 * X-Sync-Secret ヘッダーで認証. 一般公開しない.
 *
 * GET: ?slug=xxx or ?shop_id=uuid
 * Response: {shop_id, slug, shop_name, email, notify_email, is_online,
 *            last_online_at, notify_mode, notify_min_interval_minutes,
 *            auto_off_minutes, reception_start, reception_end, welcome_message}
 */

require_once __DIR__ . '/db.php';

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

// ---- 認証: X-Sync-Secret ----
// wrangler secret put MYSQL_SYNC_SECRET と同じ値を api/db-config.php などから読む
$expected = getenv('CHAT_SYNC_SECRET') ?: (defined('CHAT_SYNC_SECRET') ? CHAT_SYNC_SECRET : '');
// db-config.php で define('CHAT_SYNC_SECRET', '...') 想定
if (!$expected) {
    http_response_code(500);
    echo json_encode(['error' => 'server_not_configured']);
    exit;
}

$provided = $_SERVER['HTTP_X_SYNC_SECRET'] ?? '';
if (!hash_equals($expected, $provided)) {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'method_not_allowed']);
    exit;
}

$slug = isset($_GET['slug']) ? preg_replace('/[^a-z0-9\-]/', '', $_GET['slug']) : '';
$shopId = isset($_GET['shop_id']) ? preg_replace('/[^a-zA-Z0-9\-]/', '', $_GET['shop_id']) : '';

if (!$slug && !$shopId) {
    http_response_code(400);
    echo json_encode(['error' => 'missing_key']);
    exit;
}

$where = $slug ? 's.slug = ?' : 's.id = ?';
$param = $slug ?: $shopId;

$pdo = DB::conn();
$stmt = $pdo->prepare("
    SELECT s.id AS shop_id, s.slug, s.shop_name, s.email,
           st.is_online, st.last_online_at,
           st.notify_mode, st.notify_min_interval_minutes, st.auto_off_minutes,
           st.reception_start, st.reception_end, st.welcome_message,
           st.notify_email
    FROM shops s
    INNER JOIN shop_chat_status st ON st.shop_id = s.id
    WHERE {$where} AND s.status = 'active'
    LIMIT 1
");
$stmt->execute([$param]);
$row = $stmt->fetch();

if (!$row) {
    http_response_code(404);
    echo json_encode(['error' => 'not_found']);
    exit;
}

// 正規化 (ChatRoom の ShopStatus 型に合わせる)
$out = [
    'shop_id' => $row['shop_id'],
    'slug' => $row['slug'],
    'shop_name' => $row['shop_name'],
    'email' => $row['email'],
    'notify_email' => $row['notify_email'],
    'is_online' => (bool)$row['is_online'],
    'last_online_at' => $row['last_online_at'],
    'notify_mode' => $row['notify_mode'] ?: 'first',
    'notify_min_interval_minutes' => (int)($row['notify_min_interval_minutes'] ?? 0),
    'auto_off_minutes' => (int)($row['auto_off_minutes'] ?? 10),
    'reception_start' => $row['reception_start'],
    'reception_end' => $row['reception_end'],
    'welcome_message' => $row['welcome_message'],
];

echo json_encode($out, JSON_UNESCAPED_UNICODE);
