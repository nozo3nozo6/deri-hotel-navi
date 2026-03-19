<?php
/**
 * admin-api.php — 管理画面用APIプロキシ
 * RLSで制限されたテーブルへのupdate/deleteをservice keyで実行
 * PHP認証セッションが有効な場合のみ動作
 */
require_once __DIR__ . '/auth-config.php';

session_set_cookie_params([
    'lifetime' => SESSION_TIMEOUT,
    'path' => '/',
    'domain' => 'yobuho.com',
    'secure' => true,
    'httponly' => true,
    'samesite' => 'Strict'
]);
session_start();

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: https://yobuho.com');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Credentials: true');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// 認証チェック（auth.phpと同じセッション変数を使用）
if (empty($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}
// セッションタイムアウトチェック
$lastActivity = $_SESSION['last_activity'] ?? 0;
if (time() - $lastActivity > SESSION_TIMEOUT) {
    $_SESSION = [];
    session_destroy();
    http_response_code(401);
    echo json_encode(['error' => 'Session expired']);
    exit;
}
$_SESSION['last_activity'] = time();

$SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
$SUPABASE_SERVICE_KEY = 'sb_secret_YTSjsm66P67WKiuXEEVIig_3NyBMHTl';

$action = $_GET['action'] ?? '';
$input = json_decode(file_get_contents('php://input'), true) ?? [];

// 許可するテーブルとアクション
$ALLOWED_TABLES = ['hotel_requests', 'shops', 'shop_placements', 'reports'];

function supabaseRequest($method, $url, $data = null) {
    global $SUPABASE_URL, $SUPABASE_SERVICE_KEY;

    $ch = curl_init($SUPABASE_URL . '/rest/v1/' . $url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . $SUPABASE_SERVICE_KEY,
            'Authorization: Bearer ' . $SUPABASE_SERVICE_KEY,
            'Content-Type: application/json',
            'Prefer: return=representation',
        ],
    ]);
    if ($data !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    }
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return ['code' => $httpCode, 'body' => json_decode($response, true)];
}

switch ($action) {
    case 'update':
        $table = $input['table'] ?? '';
        $id = $input['id'] ?? '';
        $data = $input['data'] ?? [];
        if (!in_array($table, $ALLOWED_TABLES) || !$id || empty($data)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid parameters']);
            exit;
        }
        $result = supabaseRequest('PATCH', $table . '?id=eq.' . urlencode($id), $data);
        http_response_code($result['code'] >= 200 && $result['code'] < 300 ? 200 : $result['code']);
        echo json_encode($result['body']);
        break;

    case 'delete':
        $table = $input['table'] ?? '';
        $id = $input['id'] ?? '';
        if (!in_array($table, $ALLOWED_TABLES) || !$id) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid parameters']);
            exit;
        }
        $result = supabaseRequest('DELETE', $table . '?id=eq.' . urlencode($id));
        http_response_code($result['code'] >= 200 && $result['code'] < 300 ? 200 : $result['code']);
        echo json_encode($result['body'] ?? ['ok' => true]);
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Unknown action']);
        break;
}
