<?php
/**
 * submit-loveho-report.php — ラブホ口コミ投稿（MySQL版）
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

define('IP_HASH_SALT', getenv('IP_HASH_SALT') ?: 'deri_hotel_navi_2026_salt_xK9m');
define('MAX_LOVEHO_REPORTS_PER_IP_24H', 10);

$input = json_decode(file_get_contents('php://input'), true);
if (!$input) { http_response_code(400); echo json_encode(['error' => 'Invalid request']); exit; }

$hotelId = $input['hotel_id'] ?? null;
if (!$hotelId) { http_response_code(400); echo json_encode(['error' => 'hotel_id is required']); exit; }

$clientIP = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$ipHash = hash('sha256', IP_HASH_SALT . $clientIP);

// Rate limit: IP 10/24h
$since24h = gmdate('Y-m-d H:i:s', time() - 86400);
$stmt = $pdo->prepare('SELECT COUNT(*) FROM loveho_reports WHERE ip_hash = ? AND created_at >= ?');
$stmt->execute([$ipHash, $since24h]);
if ($stmt->fetchColumn() >= MAX_LOVEHO_REPORTS_PER_IP_24H) {
    http_response_code(429);
    echo json_encode(['error' => '投稿制限中です。24時間以内の投稿数が上限に達しました。']);
    exit;
}

$comment = $input['comment'] ?? null;
if ($comment) $comment = mb_substr(trim($comment), 0, 500);

$id = DB::uuid();
$stmt = $pdo->prepare('INSERT INTO loveho_reports (id, hotel_id, solo_entry, atmosphere, good_points, time_slot, comment, poster_name, poster_type, shop_id, entry_method, multi_person, guest_male, guest_female, gender_mode, ip_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
$stmt->execute([
    $id,
    $hotelId,
    $input['solo_entry'] ?? null,
    $input['atmosphere'] ?? null,
    DB::jsonEncode($input['good_points'] ?? null),
    $input['time_slot'] ?? null,
    $comment,
    $input['poster_name'] ?? null,
    $input['poster_type'] ?? 'user',
    $input['shop_id'] ?? null,
    $input['entry_method'] ?? null,
    (int)(bool)($input['multi_person'] ?? false),
    isset($input['guest_male']) ? (int)$input['guest_male'] : null,
    isset($input['guest_female']) ? (int)$input['guest_female'] : null,
    $input['gender_mode'] ?? null,
    $ipHash,
]);

echo json_encode(['success' => true, 'id' => $id]);
?>
