<?php
/**
 * submit-report.php — レポート投稿（MySQL版）
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
require_once __DIR__ . '/validation.php';
$pdo = DB::conn();

define('IP_HASH_SALT', getenv('IP_HASH_SALT') ?: 'deri_hotel_navi_2026_salt_xK9m');
define('MAX_REPORTS_PER_IP_24H', 10);
define('MAX_REPORTS_PER_FP_PER_HOTEL', 3);

$input = json_decode(file_get_contents('php://input'), true);
if (!$input) { http_response_code(400); echo json_encode(['error' => '無効なリクエストです']); exit; }

$hotelId     = $input['hotel_id'] ?? null;
$canCall     = $input['can_call'] ?? null;
$fingerprint = $input['fingerprint'] ?? '';

if (!$hotelId || $canCall === null) {
    http_response_code(400);
    echo json_encode(['error' => 'hotel_id と can_call は必須です']);
    exit;
}

$fingerprint = preg_replace('/[^a-zA-Z0-9+\/=]/', '', $fingerprint);
if (strlen($fingerprint) > 64) $fingerprint = substr($fingerprint, 0, 64);

$clientIP = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$ipHash   = hash('sha256', IP_HASH_SALT . $clientIP);

// ── レート制限: IP 10件/24h ──
$since24h = date('Y-m-d H:i:s', time() - 86400);
$stmt = $pdo->prepare('SELECT COUNT(*) FROM reports WHERE ip_hash = ? AND created_at >= ?');
$stmt->execute([$ipHash, $since24h]);
if ($stmt->fetchColumn() >= MAX_REPORTS_PER_IP_24H) {
    http_response_code(429);
    echo json_encode(['error' => '投稿制限中です。24時間以内の投稿数が上限に達しました。しばらく時間をおいてから再度お試しください。']);
    exit;
}

// ── レート制限: フィンガープリント×ホテル ──
if ($fingerprint) {
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM reports WHERE fingerprint = ? AND hotel_id = ?');
    $stmt->execute([$fingerprint, $hotelId]);
    if ($stmt->fetchColumn() >= MAX_REPORTS_PER_FP_PER_HOTEL) {
        http_response_code(429);
        echo json_encode(['error' => 'このホテルへの投稿数が上限に達しました。']);
        exit;
    }
}

// ── 不審パターン検知（店舗IPとの一致） ──
$comment = $input['comment'] ?? null;
if ($comment) $comment = mb_substr(trim($comment), 0, 500);

$stmt = $pdo->prepare('SELECT id, shop_name FROM shops WHERE last_login_ip_hash = ?');
$stmt->execute([$ipHash]);
$suspiciousShops = $stmt->fetchAll();
if ($suspiciousShops) {
    $shopNames = array_map(fn($s) => $s['shop_name'] ?? $s['id'], $suspiciousShops);
    $note = '[要確認] 店舗ログインIPと一致: ' . implode(', ', $shopNames);
    $comment = $comment ? ($note . ' | ' . $comment) : $note;
    error_log('[anti-gaming] suspicious report from IP matching shop(s): ' . implode(', ', $shopNames) . ' hotel_id=' . $hotelId);
}

// ── コンテンツバリデーション ──
$posterName = $input['poster_name'] ?? null;
$validation = validateComment($comment, $posterName);
if ($validation['errors']) {
    http_response_code(400);
    echo json_encode(['error' => $validation['errors'][0]]);
    exit;
}
// NGワードフラグをコメントに付与
if ($validation['flags']) {
    $flagNote = implode(' | ', $validation['flags']);
    $comment = $comment ? ($flagNote . ' | ' . $comment) : $flagNote;
}

// ── INSERT ──
$id = DB::uuid();
$stmt = $pdo->prepare('INSERT INTO reports (id, hotel_id, can_call, poster_type, poster_name, can_call_reasons, cannot_call_reasons, time_slot, room_type, comment, multi_person, guest_male, guest_female, multi_fee, gender_mode, fingerprint, ip_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
$stmt->execute([
    $id,
    $hotelId,
    (int)(bool)$canCall,
    $input['poster_type'] ?? 'user',
    $input['poster_name'] ?? '無記名',
    DB::jsonEncode($input['can_call_reasons'] ?? []),
    DB::jsonEncode($input['cannot_call_reasons'] ?? []),
    $input['time_slot'] ?? null,
    $input['room_type'] ?? null,
    $comment,
    (int)(bool)($input['multi_person'] ?? false),
    (int)($input['guest_male'] ?? 0),
    (int)($input['guest_female'] ?? 0),
    ($input['multi_person'] ?? false) ? (int)(bool)($input['multi_fee'] ?? false) : null,
    $input['gender_mode'] ?? 'men',
    $fingerprint,
    $ipHash,
]);

echo json_encode(['success' => true, 'id' => $id]);
?>
