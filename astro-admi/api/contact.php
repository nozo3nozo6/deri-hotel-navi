<?php
// ==========================================================================
// contact.php — お問い合わせ受付（/api/contact.php）
//   フロント(/contacts)から JSON POST を受け取り、メール送信して JSON を返す。
//   ※ TODO: 送受信アドレスは kichifu のメール基盤に合わせて差し替える
// ==========================================================================
mb_internal_encoding('UTF-8');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method']);
    exit;
}

$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) { $data = $_POST; }

$hp    = trim((string)($data['_hp'] ?? ''));      // ハニーポット
$name  = trim((string)($data['name'] ?? ''));
$email = trim((string)($data['email'] ?? ''));
$tel   = trim((string)($data['tel'] ?? ''));
$msg   = trim((string)($data['message'] ?? ''));

if ($hp !== '') { echo json_encode(['ok' => true]); exit; }           // bot は黙って成功扱い
if ($name === '' || $msg === '') {
    http_response_code(422);
    echo json_encode(['ok' => false, 'error' => 'required']);
    exit;
}
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(422);
    echo json_encode(['ok' => false, 'error' => 'email']);
    exit;
}

// TODO: kichifu の受信/送信アドレスに差し替え（メール基盤の用意が必要）
$TO   = 'info@kichifu.com';
$FROM = 'no-reply@kichifu.com';

$clean = static fn(string $s): string => str_replace(["\r", "\n"], ' ', $s);

$subject    = '【kichifu.com】お問い合わせ';
$encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
$body  = "お名前: {$name}\n電話: {$tel}\nメール: {$email}\n\n--- お問い合わせ内容 ---\n{$msg}\n";

$headers  = "From: {$FROM}\r\n";
if ($email !== '') { $headers .= 'Reply-To: ' . $clean($email) . "\r\n"; }
$headers .= "Content-Type: text/plain; charset=UTF-8\r\n";

$sent = @mail($TO, $encSubject, $body, $headers);
if ($sent) {
    echo json_encode(['ok' => true]);
} else {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'send']);
}
