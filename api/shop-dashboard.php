<?php
/**
 * shop-dashboard.php — 店舗ダッシュボード統計
 * GET: (セッション認証必須)
 * Returns: 登録ホテル数、口コミ統計
 */

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

session_start();
if (empty($_SESSION['shop_id'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

require_once __DIR__ . '/db.php';

$shopId = $_SESSION['shop_id'];

try {
    $pdo = DB::conn();

    // 登録ホテル数
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM shop_hotel_info WHERE shop_id = ?');
    $stmt->execute([$shopId]);
    $hotelCount = (int)$stmt->fetchColumn();

    // ホテル口コミ数（自店舗投稿）
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM reports WHERE shop_id = ? AND is_hidden = 0');
    $stmt->execute([$shopId]);
    $hotelReviewCount = (int)$stmt->fetchColumn();

    // ラブホ口コミ数（自店舗投稿）
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM loveho_reports WHERE shop_id = ? AND is_hidden = 0');
    $stmt->execute([$shopId]);
    $lovehoReviewCount = (int)$stmt->fetchColumn();

    // 呼べた率（自店舗ホテル口コミ）
    $stmt = $pdo->prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN can_call = 1 THEN 1 ELSE 0 END) AS can_count FROM reports WHERE shop_id = ? AND is_hidden = 0');
    $stmt->execute([$shopId]);
    $callStats = $stmt->fetch();

    // 最新口コミ日時
    $stmt = $pdo->prepare('
        SELECT MAX(latest) AS latest FROM (
            SELECT MAX(created_at) AS latest FROM reports WHERE shop_id = ? AND is_hidden = 0
            UNION ALL
            SELECT MAX(created_at) AS latest FROM loveho_reports WHERE shop_id = ? AND is_hidden = 0
        ) t
    ');
    $stmt->execute([$shopId, $shopId]);
    $latestReview = $stmt->fetchColumn();

    echo json_encode([
        'hotel_count' => $hotelCount,
        'hotel_review_count' => $hotelReviewCount,
        'loveho_review_count' => $lovehoReviewCount,
        'total_review_count' => $hotelReviewCount + $lovehoReviewCount,
        'can_call_rate' => $callStats['total'] > 0 ? round($callStats['can_count'] / $callStats['total'] * 100) : null,
        'latest_review' => $latestReview,
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Server error']);
}
