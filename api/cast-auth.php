<?php
/**
 * cast-auth.php — キャスト本人のセッション管理
 * Actions: login, logout, check, profile, update-shop-profile, update-password, update-email
 *
 * 本API + shop-cast-api.php + cast-register-api.php の3本でキャスト機能が完結する
 */
require_once __DIR__ . '/db.php';

define('CAST_SESSION_TIMEOUT', 86400); // 24時間
define('CAST_MAX_LOGIN_ATTEMPTS', 5);
define('CAST_LOCKOUT_TIME', 900); // 15分

session_set_cookie_params([
    'lifetime' => CAST_SESSION_TIMEOUT,
    'path' => '/',
    'domain' => 'yobuho.com',
    'secure' => true,
    'httponly' => true,
    'samesite' => 'Strict'
]);
session_start();

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');
header('Access-Control-Allow-Origin: https://yobuho.com');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Credentials: true');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'login':                handleLogin(); break;
    case 'logout':               handleLogout(); break;
    case 'check':                handleCheck(); break;
    case 'profile':              handleProfile(); break;
    case 'update-shop-profile':  handleUpdateShopProfile(); break;
    case 'update-password':      handleUpdatePassword(); break;
    case 'update-email':         handleUpdateEmail(); break;
    case 'regenerate-inbox-token': handleRegenerateInboxToken(); break;
    default:
        http_response_code(400);
        echo json_encode(['error' => 'Invalid action']);
}

function requireCastAuth(): ?array {
    if (empty($_SESSION['cast_id'])) return null;
    if (time() - ($_SESSION['cast_last_activity'] ?? 0) > CAST_SESSION_TIMEOUT) {
        unset($_SESSION['cast_id'], $_SESSION['cast_email'], $_SESSION['cast_last_activity']);
        return null;
    }
    $_SESSION['cast_last_activity'] = time();
    return ['cast_id' => $_SESSION['cast_id'], 'cast_email' => $_SESSION['cast_email']];
}

function castCheckRateLimit(string $ip): array {
    $lockFile = sys_get_temp_dir() . '/cast_auth_lock_' . md5($ip) . '.json';
    if (!file_exists($lockFile)) return ['locked' => false, 'attempts' => 0];
    $data = json_decode(file_get_contents($lockFile), true);
    if (!$data) return ['locked' => false, 'attempts' => 0];
    if (!empty($data['locked_until']) && time() < $data['locked_until']) {
        return ['locked' => true, 'remaining' => $data['locked_until'] - time()];
    }
    if (!empty($data['locked_until']) && time() >= $data['locked_until']) { @unlink($lockFile); return ['locked' => false, 'attempts' => 0]; }
    return ['locked' => false, 'attempts' => $data['attempts'] ?? 0];
}

function castRecordFailedAttempt(string $ip): void {
    $lockFile = sys_get_temp_dir() . '/cast_auth_lock_' . md5($ip) . '.json';
    $data = ['attempts' => 1, 'last_attempt' => time()];
    if (file_exists($lockFile)) {
        $existing = json_decode(file_get_contents($lockFile), true);
        if ($existing) $data['attempts'] = ($existing['attempts'] ?? 0) + 1;
    }
    if ($data['attempts'] >= CAST_MAX_LOGIN_ATTEMPTS) $data['locked_until'] = time() + CAST_LOCKOUT_TIME;
    file_put_contents($lockFile, json_encode($data), LOCK_EX);
}

function castClearRateLimit(string $ip): void {
    $lockFile = sys_get_temp_dir() . '/cast_auth_lock_' . md5($ip) . '.json';
    if (file_exists($lockFile)) @unlink($lockFile);
}

function inp(string $key, $default = null) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        static $body = null;
        if ($body === null) {
            $raw = file_get_contents('php://input');
            $body = $raw ? (json_decode($raw, true) ?? []) : [];
        }
        return $body[$key] ?? ($_POST[$key] ?? $default);
    }
    return $_GET[$key] ?? $default;
}

function err(string $msg, int $code = 400): void {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}
function ok(array $data = []): void {
    echo json_encode(['success' => true] + $data);
    exit;
}

function handleLogin(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') err('POST only', 405);
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $rate = castCheckRateLimit($ip);
    if ($rate['locked']) {
        $remaining = (int)ceil(($rate['remaining'] ?? CAST_LOCKOUT_TIME) / 60);
        err("ログイン試行回数が上限に達しました。{$remaining}分後に再試行してください", 429);
    }

    $email = trim((string)inp('email', ''));
    $password = (string)inp('password', '');
    if ($email === '' || $password === '') err('メールとパスワードを入力してください');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id, email, password_hash, status FROM casts WHERE email = ? LIMIT 1');
    $stmt->execute([$email]);
    $cast = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$cast || !$cast['password_hash']) { castRecordFailedAttempt($ip); err('メールアドレスまたはパスワードが正しくありません'); }

    if ($cast['status'] === 'suspended') err('このアカウントは利用停止されています。運営にお問い合わせください', 403);

    if (!password_verify($password, $cast['password_hash'])) {
        castRecordFailedAttempt($ip);
        err('メールアドレスまたはパスワードが正しくありません');
    }
    castClearRateLimit($ip);

    $hashIp = hash('sha256', $ip . '|yobuho-cast-salt-2026');
    $pdo->prepare('UPDATE casts SET last_login_at = NOW(), last_login_ip_hash = ?, status = "active", updated_at = NOW() WHERE id = ?')
        ->execute([$hashIp, $cast['id']]);

    $_SESSION['cast_id'] = $cast['id'];
    $_SESSION['cast_email'] = $cast['email'];
    $_SESSION['cast_last_activity'] = time();

    ok(['cast' => ['id' => $cast['id'], 'email' => $cast['email']]]);
}

function handleLogout(): void {
    unset($_SESSION['cast_id'], $_SESSION['cast_email'], $_SESSION['cast_last_activity']);
    ok();
}

function handleCheck(): void {
    $auth = requireCastAuth();
    if (!$auth) { echo json_encode(['authenticated' => false]); return; }
    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id, email, status FROM casts WHERE id = ? LIMIT 1');
    $stmt->execute([$auth['cast_id']]);
    $cast = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$cast || $cast['status'] === 'suspended') {
        unset($_SESSION['cast_id'], $_SESSION['cast_email'], $_SESSION['cast_last_activity']);
        echo json_encode(['authenticated' => false]);
        return;
    }
    echo json_encode(['authenticated' => true, 'cast' => $cast]);
}

function handleProfile(): void {
    $auth = requireCastAuth();
    if (!$auth) err('Unauthorized', 401);

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id, email, status, last_login_at, created_at FROM casts WHERE id = ? LIMIT 1');
    $stmt->execute([$auth['cast_id']]);
    $cast = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$cast) err('Cast not found', 404);

    // 所属店舗一覧（status != removed のみ）+ shop info
    // pending_approval = 店舗承認待ち / active = 承認済み / suspended = 一時停止
    $sql = 'SELECT sc.id AS shop_cast_id, sc.shop_id, sc.display_name, sc.profile_image_url, sc.bio,
                   sc.status, sc.sort_order, sc.joined_at, sc.approved_at,
                   sc.chat_notify_mode, sc.chat_is_online, sc.inbox_token,
                   s.shop_name, s.slug, s.gender_mode, s.cast_enabled
            FROM shop_casts sc
            JOIN shops s ON s.id = sc.shop_id
            WHERE sc.cast_id = ? AND sc.status != "removed"
            ORDER BY FIELD(sc.status, "pending_approval", "active", "suspended"), sc.joined_at DESC';
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$auth['cast_id']]);
    $shops = $stmt->fetchAll(PDO::FETCH_ASSOC);

    ok(['cast' => $cast, 'shops' => $shops]);
}

function handleUpdateShopProfile(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') err('POST only', 405);
    $auth = requireCastAuth();
    if (!$auth) err('Unauthorized', 401);

    $shopCastId = (string)inp('shop_cast_id', '');
    if ($shopCastId === '') err('shop_cast_id required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id FROM shop_casts WHERE id = ? AND cast_id = ? AND status != "removed"');
    $stmt->execute([$shopCastId, $auth['cast_id']]);
    if (!$stmt->fetchColumn()) err('所属店舗が見つかりません', 404);

    $fields = [];
    $values = [];
    $displayName = inp('display_name', null);
    if ($displayName !== null) {
        $displayName = trim((string)$displayName);
        if ($displayName === '') err('源氏名を入力してください');
        if (mb_strlen($displayName) > 100) err('源氏名は100文字以内で入力してください');
        $fields[] = 'display_name = ?';
        $values[] = $displayName;
    }
    $bio = inp('bio', null);
    if ($bio !== null) {
        $bio = trim((string)$bio);
        if (mb_strlen($bio) > 500) err('自己紹介は500文字以内で入力してください');
        $fields[] = 'bio = ?';
        $values[] = $bio === '' ? null : $bio;
    }
    $imgUrl = inp('profile_image_url', null);
    if ($imgUrl !== null) {
        $imgUrl = trim((string)$imgUrl);
        // Base64 data URL or https URL を許可
        if ($imgUrl !== '' && !preg_match('#^(data:image/|https://)#', $imgUrl)) {
            err('画像URLの形式が正しくありません');
        }
        if (mb_strlen($imgUrl) > 500000) err('画像が大きすぎます（500KB以下にしてください）');
        $fields[] = 'profile_image_url = ?';
        $values[] = $imgUrl === '' ? null : $imgUrl;
    }

    if (!$fields) err('変更内容がありません');
    $values[] = $shopCastId;
    $sql = 'UPDATE shop_casts SET ' . implode(', ', $fields) . ', updated_at = NOW() WHERE id = ?';
    $pdo->prepare($sql)->execute($values);
    ok();
}

function handleUpdatePassword(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') err('POST only', 405);
    $auth = requireCastAuth();
    if (!$auth) err('Unauthorized', 401);

    $oldPw = (string)inp('old_password', '');
    $newPw = (string)inp('new_password', '');
    if ($oldPw === '' || $newPw === '') err('パスワードを入力してください');
    if (mb_strlen($newPw) < 8) err('新しいパスワードは8文字以上で設定してください');
    if (mb_strlen($newPw) > 200) err('パスワードが長すぎます');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT password_hash FROM casts WHERE id = ?');
    $stmt->execute([$auth['cast_id']]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || !password_verify($oldPw, $row['password_hash'] ?? '')) err('現在のパスワードが正しくありません');

    $newHash = password_hash($newPw, PASSWORD_BCRYPT);
    $pdo->prepare('UPDATE casts SET password_hash = ?, updated_at = NOW() WHERE id = ?')
        ->execute([$newHash, $auth['cast_id']]);
    ok();
}

function handleUpdateEmail(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') err('POST only', 405);
    $auth = requireCastAuth();
    if (!$auth) err('Unauthorized', 401);

    $newEmail = trim((string)inp('new_email', ''));
    $password = (string)inp('password', '');
    if ($newEmail === '' || !filter_var($newEmail, FILTER_VALIDATE_EMAIL)) err('メールアドレスが正しくありません');
    if ($password === '') err('パスワードを入力してください');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT password_hash FROM casts WHERE id = ?');
    $stmt->execute([$auth['cast_id']]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || !password_verify($password, $row['password_hash'] ?? '')) err('パスワードが正しくありません');

    $stmt = $pdo->prepare('SELECT id FROM casts WHERE email = ? AND id != ?');
    $stmt->execute([$newEmail, $auth['cast_id']]);
    if ($stmt->fetchColumn()) err('このメールアドレスは既に使用されています');

    $pdo->prepare('UPDATE casts SET email = ?, updated_at = NOW() WHERE id = ?')
        ->execute([$newEmail, $auth['cast_id']]);
    $_SESSION['cast_email'] = $newEmail;
    ok();
}

function handleRegenerateInboxToken(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') err('POST only', 405);
    $auth = requireCastAuth();
    if (!$auth) err('Unauthorized', 401);

    $shopCastId = (string)inp('shop_cast_id', '');
    if ($shopCastId === '') err('shop_cast_id required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id FROM shop_casts WHERE id = ? AND cast_id = ? AND status != "removed"');
    $stmt->execute([$shopCastId, $auth['cast_id']]);
    if (!$stmt->fetchColumn()) err('所属店舗が見つかりません', 404);

    $newToken = DB::uuid();
    $pdo->prepare('UPDATE shop_casts SET inbox_token = ?, updated_at = NOW() WHERE id = ?')
        ->execute([$newToken, $shopCastId]);
    ok(['inbox_token' => $newToken]);
}
