<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

$to = $input['to'] ?? '';
$subject = $input['subject'] ?? '';
$body = $input['body'] ?? '';

if (empty($to) || empty($subject) || empty($body)) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing required fields']);
    exit;
}

$headers = [
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'From: YobuHo <hotel@yobuho.com>',
    'Reply-To: hotel@yobuho.com',
    'X-Mailer: PHP/' . phpversion()
];

$result = mb_send_mail($to, $subject, $body, implode("\r\n", $headers));

if ($result) {
    echo json_encode(['success' => true, 'message' => 'メール送信完了']);
} else {
    http_response_code(500);
    echo json_encode(['error' => 'メール送信失敗']);
}
?>
