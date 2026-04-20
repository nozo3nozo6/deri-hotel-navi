<?php
/**
 * submit-vote.php — 口コミ評価（MySQL版）
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
$pdo = DB::conn();

$input = json_decode(file_get_contents('php://input'), true);
if (!$input) { http_response_code(400); echo json_encode(['error' => 'Invalid request']); exit; }

$reportId    = $input['report_id'] ?? null;
$fingerprint = $input['fingerprint'] ?? '';
$vote        = $input['vote'] ?? '';

if (!$reportId || !$vote || !in_array($vote, ['helpful', 'unhelpful'])) {
    http_response_code(400);
    echo json_encode(['error' => 'report_id and vote (helpful/unhelpful) are required']);
    exit;
}

$fingerprint = preg_replace('/[^a-zA-Z0-9+\/=]/', '', $fingerprint);
if (strlen($fingerprint) > 64) $fingerprint = substr($fingerprint, 0, 64);

try {
    $stmt = $pdo->prepare('INSERT INTO report_votes (report_id, voter_fingerprint, vote_type) VALUES (?, ?, ?)');
    $stmt->execute([$reportId, $fingerprint, $vote]);
    echo json_encode(['success' => true]);
} catch (PDOException $e) {
    if ($e->getCode() == 23000) { // Duplicate entry
        http_response_code(409);
        echo json_encode(['error' => 'already_voted']);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Vote failed']);
    }
}
?>
