<?php
/**
 * recent-shops.php — 新着登録店舗取得
 * GET: ?mode=men (gender_mode)
 * Returns: show_announcement=1 AND status='active' の店舗一覧（approved_at DESC）
 */

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

$allowed_origins = ['https://yobuho.com', 'https://deli.yobuho.com', 'https://jofu.yobuho.com', 'https://same.yobuho.com', 'https://loveho.yobuho.com', 'https://este.yobuho.com'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed_origins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
} else {
    header('Access-Control-Allow-Origin: https://yobuho.com');
}
header('Access-Control-Allow-Methods: GET');
header('Access-Control-Allow-Headers: Content-Type');
header('Vary: Origin');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . '/db.php';

$mode = $_GET['mode'] ?? '';
$allowedModes = ['men', 'women', 'men_same', 'women_same', 'este', 'all'];
if (!in_array($mode, $allowedModes, true)) {
    echo json_encode([]);
    exit;
}

try {
    $pdo = DB::conn();
    if ($mode === 'all') {
        $stmt = $pdo->prepare("
            SELECT shop_name, gender_mode, approved_at, slug, shop_url
            FROM shops
            WHERE show_announcement = 1
              AND status = 'active'
            ORDER BY approved_at DESC
            LIMIT 30
        ");
        $stmt->execute();
    } else {
        $stmt = $pdo->prepare("
            SELECT shop_name, gender_mode, approved_at, slug, shop_url
            FROM shops
            WHERE show_announcement = 1
              AND status = 'active'
              AND gender_mode = ?
            ORDER BY approved_at DESC
            LIMIT 30
        ");
        $stmt->execute([$mode]);
    }
    $shops = $stmt->fetchAll();

    echo json_encode($shops);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Server error']);
}
