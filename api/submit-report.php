<?php
/**
 * submit-report.php — レポート投稿エンドポイント（ステマ対策 Phase A）
 * - サーバーサイド レート制限（IP / フィンガープリント）
 * - 不審パターン検知（店舗IPとの一致）
 * - Supabase service_role 経由で reports テーブルに INSERT
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

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// ── 設定読み込み ──
require_once __DIR__ . '/auth-config.php';

// IPハッシュ用ソルト（環境変数、なければ固定フォールバック）
define('IP_HASH_SALT', getenv('IP_HASH_SALT') ?: 'deri_hotel_navi_2026_salt_xK9m');

// レート制限定数
define('MAX_REPORTS_PER_IP_24H', 10);
define('MAX_REPORTS_PER_FP_PER_HOTEL', 3);

// ── ユーティリティ ──
function supabaseRequest($method, $path, $body = null, $queryParams = '') {
    $url = SUPABASE_URL . '/rest/v1/' . $path;
    if ($queryParams) $url .= '?' . $queryParams;

    $headers = [
        'apikey: ' . SUPABASE_SERVICE_KEY,
        'Authorization: Bearer ' . SUPABASE_SERVICE_KEY,
        'Content-Type: application/json',
        'Prefer: return=representation',
    ];

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);

    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    } elseif ($method === 'GET') {
        // default
    }

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    return ['body' => $response, 'code' => $httpCode, 'error' => $curlErr];
}

function getClientIP() {
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

function hashIP($ip) {
    return hash('sha256', IP_HASH_SALT . $ip);
}

// ── 入力パース ──
$input = json_decode(file_get_contents('php://input'), true);
if (!$input) {
    http_response_code(400);
    echo json_encode(['error' => '無効なリクエストです']);
    exit;
}

$hotelId     = $input['hotel_id'] ?? null;
$canCall     = $input['can_call'] ?? null;
$fingerprint = $input['fingerprint'] ?? '';

if (!$hotelId || $canCall === null) {
    http_response_code(400);
    echo json_encode(['error' => 'hotel_id と can_call は必須です']);
    exit;
}

// フィンガープリントのサニタイズ（hex 64文字 or fallback 32文字）
$fingerprint = preg_replace('/[^a-zA-Z0-9+\/=]/', '', $fingerprint);
if (strlen($fingerprint) > 64) $fingerprint = substr($fingerprint, 0, 64);

$clientIP  = getClientIP();
$ipHash    = hashIP($clientIP);

// ── レート制限チェック ──
// 1) IP: 24時間で MAX_REPORTS_PER_IP_24H 件まで
$since24h = gmdate('Y-m-d\TH:i:s\Z', time() - 86400);
$ipCheckQuery = 'select=id&ip_hash=eq.' . urlencode($ipHash)
              . '&created_at=gte.' . urlencode($since24h);
$ipCheck = supabaseRequest('GET', 'reports', null, $ipCheckQuery);
if ($ipCheck['code'] === 200) {
    $rows = json_decode($ipCheck['body'], true);
    if (is_array($rows) && count($rows) >= MAX_REPORTS_PER_IP_24H) {
        http_response_code(429);
        echo json_encode(['error' => '投稿制限中です。24時間以内の投稿数が上限に達しました。しばらく時間をおいてから再度お試しください。']);
        exit;
    }
}

// 2) フィンガープリント × ホテル: MAX_REPORTS_PER_FP_PER_HOTEL 件まで
if ($fingerprint) {
    $fpCheckQuery = 'select=id&fingerprint=eq.' . urlencode($fingerprint)
                  . '&hotel_id=eq.' . urlencode($hotelId);
    $fpCheck = supabaseRequest('GET', 'reports', null, $fpCheckQuery);
    if ($fpCheck['code'] === 200) {
        $fpRows = json_decode($fpCheck['body'], true);
        if (is_array($fpRows) && count($fpRows) >= MAX_REPORTS_PER_FP_PER_HOTEL) {
            http_response_code(429);
            echo json_encode(['error' => 'このホテルへの投稿数が上限に達しました。']);
            exit;
        }
    }
}

// ── 不審パターン検知（店舗IPとの一致） ──
$suspicious = false;
$suspiciousNote = '';

// ip_hash が shops テーブルの last_login_ip_hash と一致するか確認
$shopIpQuery = 'select=id,shop_name&last_login_ip_hash=eq.' . urlencode($ipHash);
$shopIpCheck = supabaseRequest('GET', 'shops', null, $shopIpQuery);
if ($shopIpCheck['code'] === 200) {
    $shopRows = json_decode($shopIpCheck['body'], true);
    if (is_array($shopRows) && count($shopRows) > 0) {
        $suspicious = true;
        $shopNames = array_map(function($s) { return $s['shop_name'] ?? $s['id']; }, $shopRows);
        $suspiciousNote = '[要確認] 店舗ログインIPと一致: ' . implode(', ', $shopNames);
        // ログに記録
        error_log('[anti-gaming] suspicious report from IP matching shop(s): ' . implode(', ', $shopNames) . ' hotel_id=' . $hotelId);
    }
}

// ── ペイロード構築 ──
$comment = $input['comment'] ?? null;
if ($comment) $comment = mb_substr(trim($comment), 0, 500);

// 不審フラグ: コメントに注記を追加
if ($suspicious && $suspiciousNote) {
    $comment = $comment ? ($suspiciousNote . ' | ' . $comment) : $suspiciousNote;
}

$payload = [
    'hotel_id'             => $hotelId,
    'can_call'             => (bool) $canCall,
    'poster_type'          => $input['poster_type'] ?? 'user',
    'can_call_reasons'     => $input['can_call_reasons'] ?? [],
    'cannot_call_reasons'  => $input['cannot_call_reasons'] ?? [],
    'time_slot'            => $input['time_slot'] ?? null,
    'comment'              => $comment,
    'poster_name'          => $input['poster_name'] ?? '無記名',
    'room_type'            => $input['room_type'] ?? null,
    'multi_person'         => (bool) ($input['multi_person'] ?? false),
    'guest_male'           => (int) ($input['guest_male'] ?? 0),
    'guest_female'         => (int) ($input['guest_female'] ?? 0),
    'gender_mode'          => $input['gender_mode'] ?? 'men',
    'fingerprint'          => $fingerprint,
    'ip_hash'              => $ipHash,
];

// ── Supabase INSERT ──
$result = supabaseRequest('POST', 'reports', $payload);

if ($result['code'] >= 200 && $result['code'] < 300) {
    $inserted = json_decode($result['body'], true);
    echo json_encode(['success' => true, 'id' => $inserted[0]['id'] ?? null]);
} else {
    // 重複エラーのハンドリング
    $errBody = json_decode($result['body'], true);
    $errCode = $errBody['code'] ?? '';
    $errMsg  = $errBody['message'] ?? '投稿に失敗しました';

    if ($errCode === '23505') {
        http_response_code(409);
        echo json_encode(['error' => 'このホテルへは既に投稿済みです']);
    } else {
        error_log('[submit-report] Supabase error: ' . $result['body']);
        http_response_code(500);
        echo json_encode(['error' => $errMsg]);
    }
}
?>
