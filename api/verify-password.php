<?php
/**
 * verify-password.php — パスワード検証エンドポイント
 * - bcrypt対応（レガシーBase64からの自動移行）
 */

header('Content-Type: application/json; charset=UTF-8');

$allowed_origins = ['https://yobuho.com', 'https://deli.yobuho.com', 'https://jofu.yobuho.com', 'https://same.yobuho.com', 'https://loveho.yobuho.com'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed_origins)) {
    header('Access-Control-Allow-Origin: ' . $origin);
} else {
    header('Access-Control-Allow-Origin: https://yobuho.com');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
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

require_once __DIR__ . '/auth-config.php';

function supabaseReq($method, $path, $body = null, $queryParams = '', $extraHeaders = []) {
    $url = SUPABASE_URL . '/rest/v1/' . $path;
    if ($queryParams) $url .= '?' . $queryParams;

    $headers = array_merge([
        'apikey: ' . SUPABASE_SERVICE_KEY,
        'Authorization: Bearer ' . SUPABASE_SERVICE_KEY,
        'Content-Type: application/json',
        'Prefer: return=representation',
    ], $extraHeaders);

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);

    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    } elseif ($method === 'PATCH') {
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
        if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    return ['body' => $response, 'code' => $httpCode, 'error' => $curlErr];
}

// ── 入力パース ──
$input = json_decode(file_get_contents('php://input'), true);
if (!$input) {
    http_response_code(400);
    echo json_encode(['error' => '無効なリクエストです']);
    exit;
}

$email    = trim($input['email'] ?? '');
$password = $input['password'] ?? '';

if (!$email || !$password) {
    http_response_code(400);
    echo json_encode(['error' => 'email と password は必須です']);
    exit;
}

// ── 店舗検索 ──
$checkQuery = 'select=*&email=eq.' . urlencode($email);
$check = supabaseReq('GET', 'shops', null, $checkQuery);

if ($check['code'] !== 200) {
    http_response_code(500);
    echo json_encode(['error' => 'データベースエラー']);
    exit;
}

$rows = json_decode($check['body'], true);
if (!is_array($rows) || count($rows) === 0) {
    http_response_code(401);
    echo json_encode(['error' => 'メールアドレスが見つかりません']);
    exit;
}

$shop = $rows[0];
$storedHash = $shop['password_hash'] ?? '';

if (!$storedHash) {
    http_response_code(401);
    echo json_encode(['error' => 'パスワードが設定されていません。管理者にお問い合わせください。']);
    exit;
}

// ── パスワード検証 ──
$verified = false;
$needsMigration = false;

if (str_starts_with($storedHash, '$2')) {
    // bcryptハッシュ
    $verified = password_verify($password, $storedHash);
} else {
    // レガシーBase64
    try {
        $decoded = base64_decode($storedHash, true);
        if ($decoded !== false && $decoded === $password) {
            $verified = true;
            $needsMigration = true;
        }
    } catch (Exception $e) {
        // デコード失敗
    }
}

if (!$verified) {
    http_response_code(401);
    echo json_encode(['error' => 'パスワードが正しくありません']);
    exit;
}

// ── レガシーBase64→bcrypt移行 ──
if ($needsMigration) {
    $bcryptHash = password_hash($password, PASSWORD_BCRYPT);
    $updateQuery = 'email=eq.' . urlencode($email);
    supabaseReq('PATCH', 'shops', [
        'password_hash' => $bcryptHash,
        'updated_at'    => gmdate('Y-m-d\TH:i:s\Z'),
    ], $updateQuery);
    // 移行後のハッシュをレスポンスに反映
    $shop['password_hash'] = $bcryptHash;
    error_log('[verify-password] migrated Base64 to bcrypt for: ' . $email);
}

// password_hash をレスポンスから除外（セキュリティ）
unset($shop['password_hash']);

echo json_encode(['success' => true, 'shop' => $shop]);
?>
