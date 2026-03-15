<?php
require_once __DIR__ . '/auth-config.php';

// セッション設定
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

// CORSヘッダー（同一ドメインだが念のため）
header('Access-Control-Allow-Origin: https://yobuho.com');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Credentials: true');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'login':
        handleLogin();
        break;
    case 'logout':
        handleLogout();
        break;
    case 'check':
        handleCheck();
        break;
    case 'change-password':
        handleChangePassword();
        break;
    default:
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => '不正なアクションです']);
}

/**
 * Supabase REST APIにリクエストを送信
 */
function supabaseRequest($method, $table, $query = '', $body = null) {
    $url = SUPABASE_URL . '/rest/v1/' . $table;
    if ($query) {
        $url .= '?' . $query;
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . SUPABASE_SERVICE_KEY,
            'Authorization: Bearer ' . SUPABASE_SERVICE_KEY,
            'Content-Type: application/json',
            'Prefer: return=representation'
        ],
        CURLOPT_TIMEOUT => 10,
    ]);

    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($body) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }
    } elseif ($method === 'PATCH') {
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
        if ($body) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }
    }

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($error) {
        return ['error' => $error, 'status' => 500];
    }

    return ['data' => json_decode($response, true), 'status' => $httpCode];
}

/**
 * レート制限チェック（ファイルベース）
 */
function checkRateLimit($ip) {
    $lockFile = sys_get_temp_dir() . '/auth_lock_' . md5($ip) . '.json';

    if (!file_exists($lockFile)) {
        return ['locked' => false, 'attempts' => 0];
    }

    $data = json_decode(file_get_contents($lockFile), true);
    if (!$data) {
        return ['locked' => false, 'attempts' => 0];
    }

    // ロック期限チェック
    if (isset($data['locked_until']) && time() < $data['locked_until']) {
        $remaining = $data['locked_until'] - time();
        return ['locked' => true, 'remaining' => $remaining];
    }

    // ロック期限切れならリセット
    if (isset($data['locked_until']) && time() >= $data['locked_until']) {
        unlink($lockFile);
        return ['locked' => false, 'attempts' => 0];
    }

    return ['locked' => false, 'attempts' => $data['attempts'] ?? 0];
}

/**
 * ログイン失敗記録
 */
function recordFailedAttempt($ip) {
    $lockFile = sys_get_temp_dir() . '/auth_lock_' . md5($ip) . '.json';

    $data = ['attempts' => 1, 'last_attempt' => time()];
    if (file_exists($lockFile)) {
        $existing = json_decode(file_get_contents($lockFile), true);
        if ($existing) {
            $data['attempts'] = ($existing['attempts'] ?? 0) + 1;
        }
    }

    // MAX_LOGIN_ATTEMPTS回失敗したらロック
    if ($data['attempts'] >= MAX_LOGIN_ATTEMPTS) {
        $data['locked_until'] = time() + LOCKOUT_TIME;
    }

    file_put_contents($lockFile, json_encode($data), LOCK_EX);

    return $data['attempts'];
}

/**
 * ログイン成功時にレート制限リセット
 */
function clearRateLimit($ip) {
    $lockFile = sys_get_temp_dir() . '/auth_lock_' . md5($ip) . '.json';
    if (file_exists($lockFile)) {
        unlink($lockFile);
    }
}

/**
 * ログイン処理
 */
function handleLogin() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'POSTメソッドのみ許可されています']);
        return;
    }

    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';

    // レート制限チェック
    $rateLimit = checkRateLimit($ip);
    if ($rateLimit['locked']) {
        $min = ceil($rateLimit['remaining'] / 60);
        echo json_encode(['success' => false, 'message' => "ログイン試行回数が上限に達しました。{$min}分後に再試行してください。"]);
        return;
    }

    // リクエストボディ取得
    $input = json_decode(file_get_contents('php://input'), true);
    $username = trim($input['username'] ?? '');
    $password = $input['password'] ?? '';

    if (empty($username) || empty($password)) {
        echo json_encode(['success' => false, 'message' => 'IDとパスワードを入力してください']);
        return;
    }

    // Supabaseからユーザー取得
    $result = supabaseRequest('GET', 'admin_users', 'username=eq.' . urlencode($username) . '&limit=1');

    if ($result['status'] !== 200 || empty($result['data'])) {
        $attempts = recordFailedAttempt($ip);
        $remaining = MAX_LOGIN_ATTEMPTS - $attempts;
        if ($remaining <= 0) {
            echo json_encode(['success' => false, 'message' => 'ログイン試行回数が上限に達しました。15分後に再試行してください。']);
        } else {
            echo json_encode(['success' => false, 'message' => 'IDまたはパスワードが正しくありません']);
        }
        return;
    }

    $user = $result['data'][0];

    // bcryptハッシュ検証
    if (!password_verify($password, $user['password_hash'])) {
        $attempts = recordFailedAttempt($ip);
        $remaining = MAX_LOGIN_ATTEMPTS - $attempts;
        if ($remaining <= 0) {
            echo json_encode(['success' => false, 'message' => 'ログイン試行回数が上限に達しました。15分後に再試行してください。']);
        } else {
            echo json_encode(['success' => false, 'message' => 'IDまたはパスワードが正しくありません']);
        }
        return;
    }

    // ログイン成功
    clearRateLimit($ip);

    // セッションに保存
    $_SESSION['user_id'] = $user['id'];
    $_SESSION['username'] = $user['username'];
    $_SESSION['login_at'] = time();
    $_SESSION['last_activity'] = time();

    echo json_encode([
        'success' => true,
        'user' => [
            'id' => $user['id'],
            'username' => $user['username']
        ]
    ]);
}

/**
 * ログアウト処理
 */
function handleLogout() {
    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params['path'], $params['domain'],
            $params['secure'], $params['httponly']
        );
    }

    session_destroy();

    echo json_encode(['success' => true]);
}

/**
 * セッション確認
 */
function handleCheck() {
    if (empty($_SESSION['user_id'])) {
        echo json_encode(['authenticated' => false]);
        return;
    }

    // セッションタイムアウトチェック（30分無操作）
    $lastActivity = $_SESSION['last_activity'] ?? 0;
    if (time() - $lastActivity > SESSION_TIMEOUT) {
        // セッション期限切れ
        session_destroy();
        echo json_encode(['authenticated' => false, 'reason' => 'timeout']);
        return;
    }

    // アクティビティ更新
    $_SESSION['last_activity'] = time();

    echo json_encode([
        'authenticated' => true,
        'user' => [
            'id' => $_SESSION['user_id'],
            'username' => $_SESSION['username']
        ]
    ]);
}

/**
 * パスワード変更処理
 */
function handleChangePassword() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'POSTメソッドのみ許可されています']);
        return;
    }

    // セッション認証チェック
    if (empty($_SESSION['user_id'])) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => '認証が必要です']);
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $currentPassword = $input['current_password'] ?? '';
    $newPassword = $input['new_password'] ?? '';

    if (empty($currentPassword) || empty($newPassword)) {
        echo json_encode(['success' => false, 'message' => 'すべての項目を入力してください']);
        return;
    }

    if (strlen($newPassword) < 4) {
        echo json_encode(['success' => false, 'message' => 'パスワードは4文字以上にしてください']);
        return;
    }

    // 現在のパスワード確認
    $userId = $_SESSION['user_id'];
    $result = supabaseRequest('GET', 'admin_users', 'id=eq.' . urlencode($userId) . '&limit=1');

    if ($result['status'] !== 200 || empty($result['data'])) {
        echo json_encode(['success' => false, 'message' => 'ユーザーが見つかりません']);
        return;
    }

    $user = $result['data'][0];

    if (!password_verify($currentPassword, $user['password_hash'])) {
        echo json_encode(['success' => false, 'message' => '現在のパスワードが正しくありません']);
        return;
    }

    // 新しいパスワードをbcryptでハッシュ化
    $newHash = password_hash($newPassword, PASSWORD_BCRYPT);

    // Supabaseで更新
    $updateResult = supabaseRequest('PATCH', 'admin_users', 'id=eq.' . urlencode($userId), [
        'password_hash' => $newHash
    ]);

    if ($updateResult['status'] >= 200 && $updateResult['status'] < 300) {
        echo json_encode(['success' => true, 'message' => 'パスワードを変更しました']);
    } else {
        echo json_encode(['success' => false, 'message' => '更新エラーが発生しました']);
    }
}
