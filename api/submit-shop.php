<?php
/**
 * submit-shop.php — 店舗登録エンドポイント
 * - Supabase service_role 経由で shops テーブルに UPSERT
 * - anon key の RLS 制限を回避
 */

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: https://yobuho.com');
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

$email      = trim($input['email'] ?? '');
$authUserId = trim($input['auth_user_id'] ?? '');
$shopName   = trim($input['shop_name'] ?? '');
$genderMode = $input['gender_mode'] ?? 'men';
$shopUrl    = trim($input['shop_url'] ?? '');
$shopTel    = trim($input['shop_tel'] ?? '');
$docUrl     = $input['document_url'] ?? null;
$pwHash     = $input['password_hash'] ?? null;

// バリデーション
if (!$email || !$shopName) {
    http_response_code(400);
    echo json_encode(['error' => 'email と shop_name は必須です']);
    exit;
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['error' => '無効なメールアドレスです']);
    exit;
}

$allowedGenders = ['men', 'women', 'men_same', 'women_same'];
if (!in_array($genderMode, $allowedGenders)) {
    http_response_code(400);
    echo json_encode(['error' => '無効なジャンルです']);
    exit;
}

// shop_name サニタイズ（100文字制限）
$shopName = mb_substr($shopName, 0, 100);

// ── 既存レコード確認 ──
$checkQuery = 'select=id,status&email=eq.' . urlencode($email);
$check = supabaseReq('GET', 'shops', null, $checkQuery);
$existing = null;
if ($check['code'] === 200) {
    $rows = json_decode($check['body'], true);
    if (is_array($rows) && count($rows) > 0) {
        $existing = $rows[0];
    }
}

// ── パスワードリセットモード ──
$isPasswordReset = ($shopName === '_pw_reset_' && $pwHash && $existing);
if ($isPasswordReset) {
    // クライアントからBase64で送られたパスワードをデコードしてbcryptハッシュ化
    $decodedPw = base64_decode($pwHash, true);
    if ($decodedPw === false) $decodedPw = $pwHash;
    $bcryptHash = password_hash($decodedPw, PASSWORD_BCRYPT);
    $payload = [
        'password_hash' => $bcryptHash,
        'updated_at'    => gmdate('Y-m-d\TH:i:s\Z'),
    ];
    $updateQuery = 'email=eq.' . urlencode($email);
    $result = supabaseReq('PATCH', 'shops', $payload, $updateQuery);
    if ($result['code'] >= 200 && $result['code'] < 300) {
        $data = json_decode($result['body'], true);
        echo json_encode(['success' => true, 'shop' => $data[0] ?? null]);
    } else {
        error_log('[submit-shop] pw reset error: ' . $result['body']);
        http_response_code(500);
        echo json_encode(['error' => '更新に失敗しました']);
    }
    exit;
}

// ── ペイロード構築 ──
$payload = [
    'email'         => $email,
    'auth_user_id'  => $authUserId ?: null,
    'shop_name'     => $shopName,
    'gender_mode'   => $genderMode,
    'shop_url'      => $shopUrl ?: null,
    'shop_tel'      => $shopTel ?: null,
    'document_url'  => $docUrl,
    'status'        => 'registered',
    'updated_at'    => gmdate('Y-m-d\TH:i:s\Z'),
];
if ($pwHash) {
    // クライアントからBase64で送られたパスワードをデコードしてbcryptハッシュ化
    $decodedPw = base64_decode($pwHash, true);
    if ($decodedPw === false) $decodedPw = $pwHash;
    $payload['password_hash'] = password_hash($decodedPw, PASSWORD_BCRYPT);
}

// ── UPSERT or UPDATE ──
if ($existing) {
    // 既存レコードを更新（PATCH）
    $updateQuery = 'email=eq.' . urlencode($email);
    $result = supabaseReq('PATCH', 'shops', $payload, $updateQuery);
} else {
    // 新規挿入（POST）
    $payload['created_at'] = gmdate('Y-m-d\TH:i:s\Z');
    $result = supabaseReq('POST', 'shops', $payload);
}

if ($result['code'] >= 200 && $result['code'] < 300) {
    $data = json_decode($result['body'], true);
    echo json_encode(['success' => true, 'shop' => $data[0] ?? null]);
} else {
    error_log('[submit-shop] Supabase error: ' . $result['body']);
    $errBody = json_decode($result['body'], true);
    http_response_code(500);
    echo json_encode(['error' => $errBody['message'] ?? '登録に失敗しました']);
}
?>
