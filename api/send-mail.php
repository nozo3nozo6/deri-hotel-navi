<?php
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

// 件名をBase64エンコード（UTF-8対応）
$encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';

// プレーンテキスト版とHTML本体を準備
$isHtml = strpos($body, '<') !== false;

if ($isHtml) {
    // HTML入力: タグ除去でプレーン版を生成
    $plainBody = trim(html_entity_decode(strip_tags($body), ENT_QUOTES, 'UTF-8'));
    $plainBody = preg_replace('/\n{3,}/', "\n\n", $plainBody);
    $htmlInner = $body;
} else {
    // プレーンテキスト入力: 改行整理 + HTML版を生成
    $plainBody = preg_replace('/\n{3,}/', "\n\n", $body);
    $htmlInner = '<div style="font-family:sans-serif;font-size:14px;line-height:1.8;color:#333;">' . nl2br(htmlspecialchars($plainBody, ENT_QUOTES, 'UTF-8')) . '</div>';
}

// HTML5構造で包む（SpamAssassinのHTML_MIME_NO_HTML_TAG対策）
$htmlBody  = "<!DOCTYPE html>\r\n";
$htmlBody .= "<html lang=\"ja\">\r\n";
$htmlBody .= "<head>\r\n";
$htmlBody .= "<meta charset=\"UTF-8\">\r\n";
$htmlBody .= "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\r\n";
$htmlBody .= "<title>" . htmlspecialchars($subject, ENT_QUOTES, 'UTF-8') . "</title>\r\n";
$htmlBody .= "</head>\r\n";
$htmlBody .= "<body style=\"margin:0;padding:16px;background:#fff;\">\r\n";
$htmlBody .= $htmlInner . "\r\n";
$htmlBody .= "</body>\r\n";
$htmlBody .= "</html>\r\n";

// multipart/alternative ボディ構築（text/plain + text/html）
$boundary = '=_yobuho_' . md5(uniqid('', true));

$mimeBody  = "This is a multi-part message in MIME format.\r\n\r\n";

// text/plain パート
$mimeBody .= "--" . $boundary . "\r\n";
$mimeBody .= "Content-Type: text/plain; charset=UTF-8\r\n";
$mimeBody .= "Content-Transfer-Encoding: base64\r\n\r\n";
$mimeBody .= chunk_split(base64_encode($plainBody)) . "\r\n";

// text/html パート
$mimeBody .= "--" . $boundary . "\r\n";
$mimeBody .= "Content-Type: text/html; charset=UTF-8\r\n";
$mimeBody .= "Content-Transfer-Encoding: base64\r\n\r\n";
$mimeBody .= chunk_split(base64_encode($htmlBody)) . "\r\n";

$mimeBody .= "--" . $boundary . "--\r\n";

// メールヘッダー（FROMをBase64エンコードしないことでFROM_EXCESS_BASE64対策）
$headers  = "From: YobuHo <hotel@yobuho.com>\r\n";
$headers .= "Reply-To: hotel@yobuho.com\r\n";
$headers .= "MIME-Version: 1.0\r\n";
$headers .= "Content-Type: multipart/alternative; boundary=\"" . $boundary . "\"\r\n";

// Envelope-From（Return-Path）を yobuho.com に設定（SPF alignment対策）
$result = mail($to, $encodedSubject, $mimeBody, $headers, '-f hotel@yobuho.com');

if ($result) {
    echo json_encode(['success' => true, 'message' => 'メール送信完了']);
} else {
    http_response_code(500);
    echo json_encode(['error' => 'メール送信失敗']);
}
?>
