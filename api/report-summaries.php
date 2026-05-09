<?php
/**
 * report-summaries.php — 複数ホテルの口コミサマリー一括取得（MySQL版）
 * GET:  ?hotel_ids=1,2,3&gender_mode=men  (Cloudflare Edge Cache 対応)
 * POST: { "hotel_ids": [1,2,3], "gender_mode": "men" }  (互換性のため残置)
 * Returns: summaries, latest_dates, loveho_summaries
 */

header('Content-Type: application/json; charset=UTF-8');

$allowed_origins = ['https://yobuho.com', 'https://deli.yobuho.com', 'https://jofu.yobuho.com', 'https://same.yobuho.com', 'https://loveho.yobuho.com', 'https://este.yobuho.com'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed_origins)) {
    header('Access-Control-Allow-Origin: ' . $origin);
} else {
    header('Access-Control-Allow-Origin: https://yobuho.com');
}
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');
// Cloudflare Edge Cache（GET時のみ有効）+ ブラウザキャッシュ60秒
// Origin ごとにキャッシュキーを分離するため Vary: Origin
header('Vary: Origin');
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    header('Cache-Control: public, max-age=60');
} else {
    header('Cache-Control: no-store');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST'], true)) { http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit; }

require_once __DIR__ . '/db.php';
$pdo = DB::conn();

// GET: ?hotel_ids=1,2,3&gender_mode=men
// POST: { hotel_ids: [...], gender_mode: ... }
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $hotelIdsRaw = $_GET['hotel_ids'] ?? '';
    $hotelIdsArr = array_filter(array_map('trim', explode(',', (string)$hotelIdsRaw)), 'strlen');
    $input = ['hotel_ids' => $hotelIdsArr];
    if (!empty($_GET['gender_mode'])) $input['gender_mode'] = $_GET['gender_mode'];
} else {
    $input = json_decode(file_get_contents('php://input'), true);
}

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

// ── gender_modeフィルタ（ジャンル別カウント用） ──
$gender = isset($input['gender_mode']) ? (string)$input['gender_mode'] : '';
$allowedGenders = ['men', 'women', 'men_same', 'women_same', 'este'];
$useGenderFilter = in_array($gender, $allowedGenders, true);

// ── サマリー ──
// ルール: ユーザー口コミは全ジャンル統一、店舗口コミはジャンル別
$summaries = [];
if ($useGenderFilter) {
    // ユーザー口コミ: 全ジャンル、店舗口コミ: 該当ジャンルのみ
    $sql = "SELECT hotel_id,
                   SUM(CASE WHEN (poster_type='user' OR poster_type IS NULL) AND can_call=1 THEN 1 ELSE 0 END) AS user_can_call,
                   SUM(CASE WHEN (poster_type='user' OR poster_type IS NULL) AND can_call=0 THEN 1 ELSE 0 END) AS user_cannot_call,
                   SUM(CASE WHEN poster_type='shop' AND can_call=1 AND gender_mode=? THEN 1 ELSE 0 END) AS shop_can_call,
                   SUM(CASE WHEN poster_type='shop' AND can_call=0 AND gender_mode=? THEN 1 ELSE 0 END) AS shop_cannot_call,
                   SUM(CASE WHEN (poster_type='user' OR poster_type IS NULL) OR (poster_type='shop' AND gender_mode=?) THEN 1 ELSE 0 END) AS total_reports
            FROM reports
            WHERE hotel_id IN ($placeholders) AND is_hidden = 0
            GROUP BY hotel_id";
    $stmt = $pdo->prepare($sql);
    $stmt->execute(array_merge([$gender, $gender, $gender], $hotelIds));
} else {
    // 全ジャンル集計: VIEW使用
    $stmt = $pdo->prepare("SELECT * FROM hotel_report_summary WHERE hotel_id IN ($placeholders)");
    $stmt->execute($hotelIds);
}
foreach ($stmt->fetchAll() as $row) {
    $row['total_reports'] = (int)$row['total_reports'];
    $row['user_can_call'] = (int)$row['user_can_call'];
    $row['user_cannot_call'] = (int)$row['user_cannot_call'];
    $row['shop_can_call'] = (int)$row['shop_can_call'];
    $row['shop_cannot_call'] = (int)$row['shop_cannot_call'];
    $summaries[$row['hotel_id']] = $row;
}

// ── 最新投稿日（ユーザー全ジャンル or 店舗該当ジャンル） ──
if ($useGenderFilter) {
    $stmt = $pdo->prepare("SELECT hotel_id, MAX(created_at) AS latest FROM reports WHERE hotel_id IN ($placeholders) AND is_hidden = 0 AND ((poster_type='user' OR poster_type IS NULL) OR (poster_type='shop' AND gender_mode = ?)) GROUP BY hotel_id");
    $stmt->execute(array_merge($hotelIds, [$gender]));
} else {
    $stmt = $pdo->prepare("SELECT hotel_id, MAX(created_at) AS latest FROM reports WHERE hotel_id IN ($placeholders) AND is_hidden = 0 GROUP BY hotel_id");
    $stmt->execute($hotelIds);
}
$latestDates = [];
foreach ($stmt->fetchAll() as $row) {
    $latestDates[$row['hotel_id']] = $row['latest'];
}

// ── ラブホサマリー（ユーザー全ジャンル or 店舗該当ジャンル） ──
if ($useGenderFilter) {
    $stmt = $pdo->prepare("SELECT hotel_id, created_at FROM loveho_reports WHERE hotel_id IN ($placeholders) AND is_hidden = 0 AND ((poster_type='user' OR poster_type IS NULL) OR (poster_type='shop' AND gender_mode = ?)) ORDER BY created_at DESC");
    $stmt->execute(array_merge($hotelIds, [$gender]));
} else {
    $stmt = $pdo->prepare("SELECT hotel_id, created_at FROM loveho_reports WHERE hotel_id IN ($placeholders) AND is_hidden = 0 ORDER BY created_at DESC");
    $stmt->execute($hotelIds);
}
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
