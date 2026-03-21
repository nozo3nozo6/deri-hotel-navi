<?php
/**
 * report-summaries.php — 複数ホテルの口コミサマリー一括取得（MySQL版）
 * POST: { "hotel_ids": [1, 2, 3, ...] }
 * Returns: summaries, latest_dates, loveho_summaries
 */

header('Content-Type: application/json; charset=UTF-8');

$allowed_origins = ['https://yobuho.com', 'https://deli.yobuho.com', 'https://jofu.yobuho.com', 'https://same.yobuho.com', 'https://loveho.yobuho.com'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed_origins)) {
    header('Access-Control-Allow-Origin: ' . $origin);
} else {
    header('Access-Control-Allow-Origin: https://yobuho.com');
}
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit; }

require_once __DIR__ . '/db.php';
$pdo = DB::conn();

$input = json_decode(file_get_contents('php://input'), true);
if (!$input || !isset($input['hotel_ids']) || !is_array($input['hotel_ids'])) {
    http_response_code(400);
    echo json_encode(['error' => 'hotel_ids 配列は必須です']);
    exit;
}

$hotelIds = array_filter($input['hotel_ids'], 'is_numeric');
if (empty($hotelIds)) {
    echo json_encode(['summaries' => [], 'latest_dates' => [], 'loveho_summaries' => []]);
    exit;
}

$hotelIds = array_slice(array_map('intval', $hotelIds), 0, 500);
$placeholders = implode(',', array_fill(0, count($hotelIds), '?'));

// ── サマリー（VIEW） ──
$stmt = $pdo->prepare("SELECT * FROM hotel_report_summary WHERE hotel_id IN ($placeholders)");
$stmt->execute($hotelIds);
$summaries = [];
foreach ($stmt->fetchAll() as $row) {
    $row['total_reports'] = (int)$row['total_reports'];
    $row['user_can_call'] = (int)$row['user_can_call'];
    $row['user_cannot_call'] = (int)$row['user_cannot_call'];
    $row['shop_can_call'] = (int)$row['shop_can_call'];
    $row['shop_cannot_call'] = (int)$row['shop_cannot_call'];
    $summaries[$row['hotel_id']] = $row;
}

// ── 最新投稿日 ──
$stmt = $pdo->prepare("SELECT hotel_id, MAX(created_at) AS latest FROM reports WHERE hotel_id IN ($placeholders) AND is_hidden = 0 GROUP BY hotel_id");
$stmt->execute($hotelIds);
$latestDates = [];
foreach ($stmt->fetchAll() as $row) {
    $latestDates[$row['hotel_id']] = $row['latest'];
}

// ── ラブホサマリー ──
$stmt = $pdo->prepare("SELECT hotel_id, created_at FROM loveho_reports WHERE hotel_id IN ($placeholders) AND is_hidden = 0 ORDER BY created_at DESC");
$stmt->execute($hotelIds);
$lovehoSummaries = [];
foreach ($stmt->fetchAll() as $row) {
    $hid = $row['hotel_id'];
    if (!isset($lovehoSummaries[$hid])) {
        $lovehoSummaries[$hid] = [
            'count' => 0,
            'latestAt' => $row['created_at'],
        ];
    }
    $lovehoSummaries[$hid]['count']++;
}

echo json_encode([
    'summaries'        => $summaries,
    'latest_dates'     => $latestDates,
    'loveho_summaries' => $lovehoSummaries,
], JSON_UNESCAPED_UNICODE);
?>
