<?php
/**
 * submit-hotel-request.php — 未掲載ホテル情報提供（MySQL版）
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

define('IP_HASH_SALT', getenv('IP_HASH_SALT') ?: 'deri_hotel_navi_2026_salt_xK9m');
define('MAX_REQUESTS_PER_IP_24H', 5);

$input = json_decode(file_get_contents('php://input'), true);
if (!$input) { http_response_code(400); echo json_encode(['error' => 'Invalid request']); exit; }

$hotelName = trim($input['hotel_name'] ?? '');
$address   = trim($input['address'] ?? '');
$tel       = trim($input['tel'] ?? '') ?: null;
$hotelType = $input['hotel_type'] ?? 'business';

if (!$hotelName || !$address) { http_response_code(400); echo json_encode(['error' => 'hotel_name and address are required']); exit; }

$hotelName = mb_substr($hotelName, 0, 200);
$address = mb_substr($address, 0, 500);
if ($tel) $tel = mb_substr($tel, 0, 30);

$allowedTypes = ['business', 'city', 'resort', 'ryokan', 'pension', 'minshuku', 'love_hotel', 'rental_room', 'other'];
if (!in_array($hotelType, $allowedTypes)) $hotelType = 'other';

// Rate limit (file-based)
$clientIP = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$ipHash = hash('sha256', IP_HASH_SALT . $clientIP);
$limitFile = sys_get_temp_dir() . '/hotel_req_' . $ipHash . '.json';
$now = time();
$requests = [];
if (file_exists($limitFile)) {
    $requests = json_decode(file_get_contents($limitFile), true) ?: [];
    $requests = array_filter($requests, fn($t) => ($now - $t) < 86400);
}
if (count($requests) >= MAX_REQUESTS_PER_IP_24H) {
    http_response_code(429);
    echo json_encode(['error' => '申請数が上限に達しました。24時間後に再度お試しください。']);
    exit;
}

$pdo = DB::conn();
$stmt = $pdo->prepare('INSERT INTO hotel_requests (hotel_name, address, tel, hotel_type, status) VALUES (?, ?, ?, ?, ?)');
$stmt->execute([$hotelName, $address, $tel, $hotelType, 'pending']);
$id = $pdo->lastInsertId();

$requests[] = $now;
file_put_contents($limitFile, json_encode(array_values($requests)));

echo json_encode(['success' => true, 'id' => (int)$id]);
?>
