<?php
// ==========================================================================
// db.php — PDO接続ヘルパー + CORS + JSONレスポンス
// ==========================================================================

date_default_timezone_set('Asia/Tokyo');  // date() の営業日計算をJSTに固定（サーバ設定に依存しない）

function getPdo() {
    static $pdo = null;
    if ($pdo) return $pdo;
    $config = require __DIR__ . '/db-bridge.php';
    $port = $config['port'] ?? 3306;
    $dsn = "mysql:host={$config['host']};port={$port};dbname={$config['database']};charset=utf8mb4";
    $pdo = new PDO($dsn, $config['user'], $config['password'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    $pdo->exec("SET time_zone = '+09:00'");
    return $pdo;
}

function setCorsHeaders() {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = [
        'https://admi2888.com', 'https://kichifu.com',
        'http://localhost:8000', 'http://127.0.0.1:8000',
    ];
    if (in_array($origin, $allowed, true)) {
        header("Access-Control-Allow-Origin: $origin");
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization');
        header('Vary: Origin');
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function jsonResponse($data, $code = 200) {
    $GLOBALS['__ylka_json_sent'] = true;
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        // 不正UTF-8 などで失敗した場合でも空ボディを返さない（フロントの "Unexpected end of JSON input" 回避）
        $json = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
    }
    if ($json === false) {
        $json = '{"error":"json encode failed: ' . addslashes(json_last_error_msg()) . '"}';
    }
    echo $json;
    exit;
}

function errorResponse(string $message, int $code = 400) {
    jsonResponse(['error' => $message], $code);
}

// 致命的エラー(parse以外の実行時 fatal)で空の 200/500 ボディが返るのを防ぐ。
// JSON でエラーを返しつつ、原因を公開ディレクトリ外のログに残して後から特定できるようにする。
$GLOBALS['__ylka_json_sent'] = $GLOBALS['__ylka_json_sent'] ?? false;
register_shutdown_function(function () {
    if (!empty($GLOBALS['__ylka_json_sent'])) return;
    $e = error_get_last();
    if (!$e || !in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) return;
    @error_log(sprintf("[%s] %s in %s:%d\n", date('Y-m-d H:i:s'), $e['message'], $e['file'], $e['line']),
               3, __DIR__ . '/../../ylka_api_fatal.log');
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo json_encode(['error' => 'server error', 'detail' => $e['message']]);
});
