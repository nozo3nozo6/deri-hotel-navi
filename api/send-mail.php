<?php
header('Content-Type: application/json; charset=UTF-8');
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

// 日本語メール設定
mb_language('Japanese');
mb_internal_encoding('UTF-8');

$input = json_decode(file_get_contents('php://input'), true);

$to = $input['to'] ?? '';
$subject = $input['subject'] ?? '';
$body = $input['body'] ?? '';

if (empty($to) || empty($subject) || empty($body)) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing required fields']);
    exit;
}

// 改行を \r\n に正規化
$body = str_replace(["\r\n", "\r", "\n"], "\r\n", $body);

// メールヘッダー（mb_send_mailが件名・本文のエンコードを自動処理）
$headers  = "From: YobuHo <hotel@yobuho.com>\r\n";
$headers .= "Reply-To: hotel@yobuho.com\r\n";
$headers .= "MIME-Version: 1.0\r\n";

// mb_send_mailで送信（件名・本文のISO-2022-JPエンコードを自動処理）
$result = mb_send_mail($to, $subject, $body, $headers);

if ($result) {
    echo json_encode(['success' => true, 'message' => 'メール送信完了']);
} else {
    http_response_code(500);
    echo json_encode(['error' => 'メール送信失敗']);
}
?>
