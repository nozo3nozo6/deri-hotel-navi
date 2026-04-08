<?php
/**
 * recent-shops.php — 新着登録店舗取得
 * GET: ?mode=men (gender_mode)
 * Returns: show_announcement=1 AND status='active' の店舗一覧（approved_at DESC）
 */

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

require_once __DIR__ . '/db.php';

$mode = $_GET['mode'] ?? '';
$allowedModes = ['men', 'women', 'men_same', 'women_same', 'este'];
if (!in_array($mode, $allowedModes, true)) {
    echo json_encode([]);
    exit;
}

try {
    $pdo = DB::conn();
    $stmt = $pdo->prepare("
        SELECT shop_name, gender_mode, approved_at
        FROM shops
        WHERE show_announcement = 1
          AND status = 'active'
          AND gender_mode = ?
        ORDER BY approved_at DESC
        LIMIT 10
    ");
    $stmt->execute([$mode]);
    $shops = $stmt->fetchAll();

    echo json_encode($shops);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Server error']);
}
