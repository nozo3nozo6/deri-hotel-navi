<?php
/**
 * recent-reviews.php — 最新24時間の口コミ取得
 * GET: ?mode=men&limit=5
 * Returns: 最新口コミ（ホテル名付き）
 */

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

require_once __DIR__ . '/db.php';

$mode = $_GET['mode'] ?? '';
$limit = min((int)($_GET['limit'] ?? 5), 50);
$allowedModes = ['men', 'women', 'men_same', 'women_same', 'este'];
if (!in_array($mode, $allowedModes, true)) {
    echo json_encode([]);
    exit;
}

try {
    $pdo = DB::conn();

    // ホテル口コミ（全期間、最新順）
    $stmt = $pdo->prepare("
        SELECT r.id, r.hotel_id, r.can_call, r.poster_name, r.created_at, r.poster_type,
               h.name AS hotel_name, h.prefecture, h.city
        FROM reports r
        JOIN hotels h ON r.hotel_id = h.id
        WHERE r.is_hidden = 0
          AND (r.poster_type = 'user' OR r.gender_mode = ?)
        ORDER BY r.created_at DESC
        LIMIT ?
    ");
    $stmt->execute([$mode, $limit]);
    $hotelReviews = $stmt->fetchAll();

    // ラブホ口コミ（全期間、最新順）
    $stmt2 = $pdo->prepare("
        SELECT lr.id, lr.hotel_id, lr.solo_entry, lr.poster_name, lr.created_at, lr.poster_type,
               h.name AS hotel_name, h.prefecture, h.city
        FROM loveho_reports lr
        JOIN hotels h ON lr.hotel_id = h.id
        WHERE lr.is_hidden = 0
          AND (lr.poster_type = 'user' OR lr.gender_mode = ?)
        ORDER BY lr.created_at DESC
        LIMIT ?
    ");
    $stmt2->execute([$mode, $limit]);
    $lovehoReviews = $stmt2->fetchAll();

    // マージして時間順ソート
    $all = [];
    foreach ($hotelReviews as $r) {
        $all[] = [
            'type' => 'hotel',
            'hotel_id' => (int)$r['hotel_id'],
            'hotel_name' => $r['hotel_name'],
            'prefecture' => $r['prefecture'],
            'city' => $r['city'],
            'can_call' => (bool)$r['can_call'],
            'poster_name' => $r['poster_name'],
            'poster_type' => $r['poster_type'],
            'created_at' => $r['created_at'],
        ];
    }
    foreach ($lovehoReviews as $r) {
        $all[] = [
            'type' => 'loveho',
            'hotel_id' => (int)$r['hotel_id'],
            'hotel_name' => $r['hotel_name'],
            'prefecture' => $r['prefecture'],
            'city' => $r['city'],
            'solo_entry' => $r['solo_entry'],
            'poster_name' => $r['poster_name'],
            'poster_type' => $r['poster_type'],
            'created_at' => $r['created_at'],
        ];
    }
    usort($all, function($a, $b) {
        return strcmp($b['created_at'], $a['created_at']);
    });
    $all = array_slice($all, 0, $limit);

    echo json_encode($all);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Server error']);
}
