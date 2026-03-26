<?php
/**
 * submit-hotel-correction.php — ホテル情報修正リクエスト
 */

header('Content-Type: application/json; charset=UTF-8');

$allowed_origins = ['https://yobuho.com', 'https://deli.yobuho.com', 'https://jofu.yobuho.com', 'https://same.yobuho.com', 'https://loveho.yobuho.com', 'https://este.yobuho.com'];
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

define('IP_HASH_SALT', getenv('IP_HASH_SALT') ?: 'deri_hotel_navi_2026_salt_xK9m');
define('MAX_REQUESTS_PER_IP_24H', 10);

$input = json_decode(file_get_contents('php://input'), true);
if (!$input) { http_response_code(400); echo json_encode(['error' => 'Invalid request']); exit; }

$hotelId  = (int)($input['hotel_id'] ?? 0);
$category = trim($input['category'] ?? '');
$detail   = trim($input['detail'] ?? '');

if (!$hotelId || !$category || !$detail) {
    http_response_code(400);
    echo json_encode(['error' => 'hotel_id, category, detail are required']);
    exit;
}

$allowedCategories = ['address', 'area', 'tel', 'hotel_name', 'closed', 'other'];
if (!in_array($category, $allowedCategories)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid category']);
    exit;
}

$detail = mb_substr($detail, 0, 500);

// Rate limit (file-based)
$clientIP = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$ipHash = hash('sha256', IP_HASH_SALT . $clientIP);
$limitFile = sys_get_temp_dir() . '/hotel_corr_' . $ipHash . '.json';
$now = time();
$requests = [];
if (file_exists($limitFile)) {
    $requests = json_decode(file_get_contents($limitFile), true) ?: [];
    $requests = array_filter($requests, fn($t) => ($now - $t) < 86400);
}
if (count($requests) >= MAX_REQUESTS_PER_IP_24H) {
    http_response_code(429);
    echo json_encode(['error' => '送信数が上限に達しました。24時間後に再度お試しください。']);
    exit;
}

$pdo = DB::conn();

// Get hotel name from DB
$stmtH = $pdo->prepare('SELECT name FROM hotels WHERE id = ?');
$stmtH->execute([$hotelId]);
$hotelName = $stmtH->fetchColumn();
if (!$hotelName) {
    http_response_code(404);
    echo json_encode(['error' => 'Hotel not found']);
    exit;
}

$stmt = $pdo->prepare('INSERT INTO hotel_corrections (hotel_id, hotel_name, category, detail, ip_hash) VALUES (?, ?, ?, ?, ?)');
$stmt->execute([$hotelId, $hotelName, $category, $detail, $ipHash]);
$id = $pdo->lastInsertId();

$requests[] = $now;
file_put_contents($limitFile, json_encode(array_values($requests)));

echo json_encode(['success' => true, 'id' => (int)$id, 'hotel_name' => $hotelName]);
?>
