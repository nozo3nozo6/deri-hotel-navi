<?php
/**
 * submit-flag.php — 投稿報告フラグ（MySQL版）
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
if (!$input) { http_response_code(400); echo json_encode(['error' => 'Invalid request']); exit; }

$targetId = $input['id'] ?? null;
$table    = $input['table'] ?? 'reports';
$reason   = $input['flag_reason'] ?? null;
$comment  = $input['flag_comment'] ?? null;

if (!$targetId || !$reason) { http_response_code(400); echo json_encode(['error' => 'id and flag_reason are required']); exit; }
if (!in_array($table, ['reports', 'loveho_reports'])) { http_response_code(400); echo json_encode(['error' => 'Invalid table']); exit; }

if ($comment) $comment = mb_substr(trim($comment), 0, 500);

$stmt = $pdo->prepare("UPDATE `$table` SET flagged_at = ?, flag_reason = ?, flag_comment = ? WHERE id = ?");
$stmt->execute([gmdate('Y-m-d H:i:s'), $reason, $comment, $targetId]);

echo json_encode(['success' => true]);
?>
