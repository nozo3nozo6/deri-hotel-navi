<?php
/**
 * shop-auth.php — 店舗セッション管理（MySQL版）
 * Actions: login, check, profile, update-thumbnail, update-email, update-slug, lookup-email
 */
require_once __DIR__ . '/db.php';

define('SHOP_SESSION_TIMEOUT', 86400); // 24時間
define('SHOP_MAX_LOGIN_ATTEMPTS', 5);
define('SHOP_LOCKOUT_TIME', 900); // 15分

session_set_cookie_params([
    'lifetime' => SHOP_SESSION_TIMEOUT,
    'path' => '/',
    'domain' => 'yobuho.com',
    'secure' => true,
    'httponly' => true,
    'samesite' => 'Strict'
]);
session_start();

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: https://yobuho.com');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Credentials: true');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'login':            handleLogin(); break;
    case 'logout':           handleLogout(); break;
    case 'check':            handleCheck(); break;
    case 'profile':          handleProfile(); break;
    case 'update-thumbnail': handleUpdateThumbnail(); break;
    case 'update-catchphrase': handleUpdateCatchphrase(); break;
    case 'update-ad-info':   handleUpdateAdInfo(); break;
    case 'get-images':       handleGetImages(); break;
    case 'add-image':        handleAddImage(); break;
    case 'delete-image':     handleDeleteImage(); break;
    case 'switch-banner-mode': handleSwitchBannerMode(); break;
    case 'update-email':     handleUpdateEmail(); break;
    case 'update-slug':      handleUpdateSlug(); break;
    case 'lookup-email':     handleLookupEmail(); break;
    case 'get-fav-areas':    handleGetFavAreas(); break;
    case 'save-fav-areas':   handleSaveFavAreas(); break;
    default:
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid action']);
}

/** セッション認証チェック — 他APIから require + requireShopAuth() で利用可 */
function requireShopAuth(): ?array {
    if (empty($_SESSION['shop_id'])) return null;
    if (time() - ($_SESSION['last_activity'] ?? 0) > SHOP_SESSION_TIMEOUT) {
        session_destroy();
        return null;
    }
    $_SESSION['last_activity'] = time();
    return ['shop_id' => $_SESSION['shop_id'], 'shop_email' => $_SESSION['shop_email']];
}

function shopCheckRateLimit($ip) {
    $lockFile = sys_get_temp_dir() . '/shop_auth_lock_' . md5($ip) . '.json';
    if (!file_exists($lockFile)) return ['locked' => false, 'attempts' => 0];
    $data = json_decode(file_get_contents($lockFile), true);
    if (!$data) return ['locked' => false, 'attempts' => 0];
    if (isset($data['locked_until']) && time() < $data['locked_until']) {
        return ['locked' => true, 'remaining' => $data['locked_until'] - time()];
    }
    if (isset($data['locked_until']) && time() >= $data['locked_until']) { unlink($lockFile); return ['locked' => false, 'attempts' => 0]; }
    return ['locked' => false, 'attempts' => $data['attempts'] ?? 0];
}

function shopRecordFailedAttempt($ip) {
    $lockFile = sys_get_temp_dir() . '/shop_auth_lock_' . md5($ip) . '.json';
    $data = ['attempts' => 1, 'last_attempt' => time()];
    if (file_exists($lockFile)) {
        $existing = json_decode(file_get_contents($lockFile), true);
        if ($existing) $data['attempts'] = ($existing['attempts'] ?? 0) + 1;
    }
    if ($data['attempts'] >= SHOP_MAX_LOGIN_ATTEMPTS) $data['locked_until'] = time() + SHOP_LOCKOUT_TIME;
    file_put_contents($lockFile, json_encode($data), LOCK_EX);
}

function shopClearRateLimit($ip) {
    $lockFile = sys_get_temp_dir() . '/shop_auth_lock_' . md5($ip) . '.json';
    if (file_exists($lockFile)) unlink($lockFile);
}

function handleLogin() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }

    // レート制限チェック
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $rateCheck = shopCheckRateLimit($ip);
    if ($rateCheck['locked']) {
        $remaining = ceil(($rateCheck['remaining'] ?? SHOP_LOCKOUT_TIME) / 60);
        http_response_code(429);
        echo json_encode(['success' => false, 'error' => "ログイン試行回数が上限に達しました。{$remaining}分後に再試行してください"]);
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $email = trim($input['email'] ?? '');
    $password = $input['password'] ?? '';
    if (!$email || !$password) { echo json_encode(['success' => false, 'error' => 'メールとパスワードを入力してください']); return; }

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT * FROM shops WHERE email = ? LIMIT 1');
    $stmt->execute([$email]);
    $shop = $stmt->fetch();
    if (!$shop) { shopRecordFailedAttempt($ip); echo json_encode(['success' => false, 'error' => 'メールアドレスまたはパスワードが正しくありません']); return; }

    $hash = $shop['password_hash'] ?? '';
    if (!$hash) { shopRecordFailedAttempt($ip); echo json_encode(['success' => false, 'error' => 'メールアドレスまたはパスワードが正しくありません']); return; }

    $verified = false;
    $needsMigration = false;
    if (str_starts_with($hash, '$2')) {
        $verified = password_verify($password, $hash);
    } else {
        $decoded = base64_decode($hash, true);
        if ($decoded !== false && $decoded === $password) {
            $verified = true;
            $needsMigration = true;
        }
    }
    if (!$verified) { shopRecordFailedAttempt($ip); echo json_encode(['success' => false, 'error' => 'メールアドレスまたはパスワードが正しくありません']); return; }

    // bcrypt移行
    if ($needsMigration) {
        $bcrypt = password_hash($password, PASSWORD_BCRYPT);
        $stmt = $pdo->prepare('UPDATE shops SET password_hash = ?, updated_at = NOW() WHERE id = ?');
        $stmt->execute([$bcrypt, $shop['id']]);
    }

    // ログイン成功: レート制限クリア
    shopClearRateLimit($ip);

    // セッション開始
    $_SESSION['shop_id'] = $shop['id'];
    $_SESSION['shop_email'] = $shop['email'];
    $_SESSION['last_activity'] = time();

    unset($shop['password_hash']);
    echo json_encode(['success' => true, 'shop' => $shop]);
}

function handleLogout() {
    $_SESSION = [];
    session_destroy();
    echo json_encode(['success' => true]);
}

function handleCheck() {
    $auth = requireShopAuth();
    if (!$auth) { echo json_encode(['authenticated' => false]); return; }

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT * FROM shops WHERE id = ? LIMIT 1');
    $stmt->execute([$auth['shop_id']]);
    $shop = $stmt->fetch();
    if (!$shop || $shop['status'] === 'suspended') {
        session_destroy();
        echo json_encode(['authenticated' => false]);
        return;
    }
    unset($shop['password_hash']);
    echo json_encode(['authenticated' => true, 'shop' => $shop]);
}

function handleProfile() {
    $auth = requireShopAuth();
    if (!$auth) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); return; }

    $pdo = DB::conn();
    // Shop + contracts + plans
    $stmt = $pdo->prepare('SELECT * FROM shops WHERE id = ? LIMIT 1');
    $stmt->execute([$auth['shop_id']]);
    $shop = $stmt->fetch();
    if (!$shop) { http_response_code(404); echo json_encode(['error' => 'Shop not found']); return; }
    unset($shop['password_hash']);

    // shop_contracts JOIN contract_plans
    $stmt = $pdo->prepare('SELECT sc.plan_id, sc.expires_at, sc.created_at AS contract_created, cp.name, cp.price FROM shop_contracts sc JOIN contract_plans cp ON sc.plan_id = cp.id WHERE sc.shop_id = ?');
    $stmt->execute([$auth['shop_id']]);
    $contracts = $stmt->fetchAll();
    $shop['shop_contracts'] = array_map(fn($c) => [
        'plan_id' => (int)$c['plan_id'],
        'expires_at' => $c['expires_at'],
        'contract_created' => $c['contract_created'],
        'contract_plans' => ['name' => $c['name'], 'price' => (int)$c['price']]
    ], $contracts);

    echo json_encode($shop, JSON_UNESCAPED_UNICODE);
}

function handleUpdateThumbnail() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $auth = requireShopAuth();
    if (!$auth) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); return; }

    $input = json_decode(file_get_contents('php://input'), true);
    $thumbnailUrl = $input['thumbnail_url'] ?? null; // null = 削除

    $pdo = DB::conn();
    $stmt = $pdo->prepare('UPDATE shops SET thumbnail_url = ?, updated_at = NOW() WHERE id = ?');
    $stmt->execute([$thumbnailUrl, $auth['shop_id']]);

    echo json_encode(['success' => true]);
}

function handleUpdateCatchphrase() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $auth = requireShopAuth();
    if (!$auth) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); return; }

    $input = json_decode(file_get_contents('php://input'), true);
    $catchphrase = $input['catchphrase'] ?? null;
    if ($catchphrase !== null) $catchphrase = mb_substr(trim($catchphrase), 0, 20);

    $pdo = DB::conn();
    $stmt = $pdo->prepare('UPDATE shops SET catchphrase = ?, updated_at = NOW() WHERE id = ?');
    $stmt->execute([$catchphrase, $auth['shop_id']]);

    echo json_encode(['success' => true]);
}

function handleUpdateAdInfo() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $auth = requireShopAuth();
    if (!$auth) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); return; }
    $input = json_decode(file_get_contents('php://input'), true);
    $catchphrase = isset($input['catchphrase']) ? mb_substr(trim($input['catchphrase']), 0, 20) : null;
    $businessHours = isset($input['business_hours']) ? mb_substr(trim($input['business_hours']), 0, 50) : null;
    $minPrice = isset($input['min_price']) ? mb_substr(trim($input['min_price']), 0, 30) : null;
    $displayTel = isset($input['display_tel']) ? mb_substr(trim($input['display_tel']), 0, 20) : null;
    $pdo = DB::conn();
    $stmt = $pdo->prepare('UPDATE shops SET catchphrase=?, business_hours=?, min_price=?, display_tel=?, updated_at=NOW() WHERE id=?');
    $stmt->execute([$catchphrase ?: null, $businessHours ?: null, $minPrice ?: null, $displayTel ?: null, $auth['shop_id']]);
    echo json_encode(['success' => true]);
}

function handleGetImages() {
    $auth = requireShopAuth();
    if (!$auth) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); return; }
    $usage = $_GET['usage'] ?? null;
    $pdo = DB::conn();
    if ($usage && in_array($usage, ['rich', 'standard'])) {
        $stmt = $pdo->prepare("SELECT id, image_url, sort_order, `usage` FROM shop_images WHERE shop_id = ? AND `usage` = ? ORDER BY sort_order, id");
        $stmt->execute([$auth['shop_id'], $usage]);
    } else {
        $stmt = $pdo->prepare("SELECT id, image_url, sort_order, `usage` FROM shop_images WHERE shop_id = ? ORDER BY sort_order, id");
        $stmt->execute([$auth['shop_id']]);
    }
    echo json_encode($stmt->fetchAll(), JSON_UNESCAPED_UNICODE);
}

function handleAddImage() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $auth = requireShopAuth();
    if (!$auth) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); return; }
    $input = json_decode(file_get_contents('php://input'), true);
    $imageUrl = $input['image_url'] ?? null;
    $usage = $input['usage'] ?? 'rich';
    if (!in_array($usage, ['rich', 'standard'])) $usage = 'rich';
    if (!$imageUrl) { http_response_code(400); echo json_encode(['error' => 'image_url required']); return; }
    $pdo = DB::conn();
    // usage別の枚数制限（banner_typeと連動）
    if ($usage === 'standard') {
        $limit = 1;
    } else {
        $stmt = $pdo->prepare('SELECT banner_type FROM shops WHERE id = ?');
        $stmt->execute([$auth['shop_id']]);
        $bt = $stmt->fetchColumn();
        $limit = ($bt === 'banner') ? 1 : 4;
    }
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM shop_images WHERE shop_id = ? AND `usage` = ?");
    $stmt->execute([$auth['shop_id'], $usage]);
    if ($stmt->fetchColumn() >= $limit) { http_response_code(400); echo json_encode(['error' => "画像は{$limit}枚までです"]); return; }
    $stmt = $pdo->prepare("SELECT COALESCE(MAX(sort_order),0)+1 FROM shop_images WHERE shop_id = ? AND `usage` = ?");
    $stmt->execute([$auth['shop_id'], $usage]);
    $nextOrder = $stmt->fetchColumn();
    $stmt = $pdo->prepare("INSERT INTO shop_images (shop_id, image_url, sort_order, `usage`) VALUES (?, ?, ?, ?)");
    $stmt->execute([$auth['shop_id'], $imageUrl, $nextOrder, $usage]);
    // thumbnail_urlをstandard画像の1枚目に同期（なければrich[0]にフォールバック）
    $stmt = $pdo->prepare("SELECT image_url FROM shop_images WHERE shop_id = ? AND `usage` = 'standard' ORDER BY sort_order, id LIMIT 1");
    $stmt->execute([$auth['shop_id']]);
    $first = $stmt->fetchColumn();
    if (!$first) {
        $stmt = $pdo->prepare("SELECT image_url FROM shop_images WHERE shop_id = ? AND `usage` = 'rich' ORDER BY sort_order, id LIMIT 1");
        $stmt->execute([$auth['shop_id']]);
        $first = $stmt->fetchColumn();
    }
    $pdo->prepare('UPDATE shops SET thumbnail_url = ? WHERE id = ?')->execute([$first ?: null, $auth['shop_id']]);
    echo json_encode(['success' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function handleDeleteImage() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $auth = requireShopAuth();
    if (!$auth) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); return; }
    $input = json_decode(file_get_contents('php://input'), true);
    $imageId = (int)($input['image_id'] ?? 0);
    if (!$imageId) { http_response_code(400); echo json_encode(['error' => 'image_id required']); return; }
    $pdo = DB::conn();
    $stmt = $pdo->prepare('DELETE FROM shop_images WHERE id = ? AND shop_id = ?');
    $stmt->execute([$imageId, $auth['shop_id']]);
    // thumbnail_urlをstandard→richの順でフォールバック同期
    $stmt = $pdo->prepare("SELECT image_url FROM shop_images WHERE shop_id = ? AND `usage` = 'standard' ORDER BY sort_order, id LIMIT 1");
    $stmt->execute([$auth['shop_id']]);
    $first = $stmt->fetchColumn();
    if (!$first) {
        $stmt = $pdo->prepare("SELECT image_url FROM shop_images WHERE shop_id = ? AND `usage` = 'rich' ORDER BY sort_order, id LIMIT 1");
        $stmt->execute([$auth['shop_id']]);
        $first = $stmt->fetchColumn();
    }
    $pdo->prepare('UPDATE shops SET thumbnail_url = ? WHERE id = ?')->execute([$first ?: null, $auth['shop_id']]);
    echo json_encode(['success' => true]);
}

function handleSwitchBannerMode() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $auth = requireShopAuth();
    if (!$auth) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); return; }
    $input = json_decode(file_get_contents('php://input'), true);
    $mode = $input['mode'] ?? '';
    if (!in_array($mode, ['banner', 'photos'])) { http_response_code(400); echo json_encode(['error' => 'Invalid mode']); return; }
    $pdo = DB::conn();
    $pdo->beginTransaction();
    try {
        // 旧rich画像を全削除
        $pdo->prepare("DELETE FROM shop_images WHERE shop_id = ? AND `usage` = 'rich'")->execute([$auth['shop_id']]);
        // banner_type更新
        $pdo->prepare('UPDATE shops SET banner_type = ?, updated_at = NOW() WHERE id = ?')->execute([$mode, $auth['shop_id']]);
        // thumbnail_urlをstandard画像にフォールバック
        $stmt = $pdo->prepare("SELECT image_url FROM shop_images WHERE shop_id = ? AND `usage` = 'standard' ORDER BY sort_order, id LIMIT 1");
        $stmt->execute([$auth['shop_id']]);
        $thumb = $stmt->fetchColumn() ?: null;
        $pdo->prepare('UPDATE shops SET thumbnail_url = ? WHERE id = ?')->execute([$thumb, $auth['shop_id']]);
        $pdo->commit();
        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['error' => 'Server error']);
    }
}

function handleUpdateEmail() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $auth = requireShopAuth();
    if (!$auth) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); return; }

    $input = json_decode(file_get_contents('php://input'), true);
    $newEmail = trim($input['new_email'] ?? '');
    if (!$newEmail || !filter_var($newEmail, FILTER_VALIDATE_EMAIL)) {
        echo json_encode(['success' => false, 'error' => '有効なメールアドレスを入力してください']);
        return;
    }

    $pdo = DB::conn();
    $stmt = $pdo->prepare('UPDATE shops SET email = ?, updated_at = NOW() WHERE id = ?');
    $stmt->execute([$newEmail, $auth['shop_id']]);

    $_SESSION['shop_email'] = $newEmail;
    echo json_encode(['success' => true]);
}

function handleUpdateSlug() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $auth = requireShopAuth();
    if (!$auth) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); return; }

    $input = json_decode(file_get_contents('php://input'), true);
    $slug = trim($input['slug'] ?? '');

    // バリデーション: 英小文字・数字・ハイフン、3〜30文字
    if (!preg_match('/^[a-z0-9][a-z0-9\-]{1,28}[a-z0-9]$/', $slug)) {
        echo json_encode(['success' => false, 'error' => 'slugは英小文字・数字・ハイフンで3〜30文字にしてください（先頭・末尾にハイフン不可）']);
        return;
    }

    $pdo = DB::conn();
    // 重複チェック（自分以外）
    $stmt = $pdo->prepare('SELECT id FROM shops WHERE slug = ? AND id != ? LIMIT 1');
    $stmt->execute([$slug, $auth['shop_id']]);
    if ($stmt->fetch()) {
        echo json_encode(['success' => false, 'error' => 'このslugは既に使用されています']);
        return;
    }

    $stmt = $pdo->prepare('UPDATE shops SET slug = ?, updated_at = NOW() WHERE id = ?');
    $stmt->execute([$slug, $auth['shop_id']]);
    echo json_encode(['success' => true, 'slug' => $slug]);
}

function handleLookupEmail() {
    $email = trim($_GET['email'] ?? '');
    if (!$email) { echo json_encode(['exists' => false]); return; }

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id FROM shops WHERE email = ? LIMIT 1');
    $stmt->execute([$email]);
    $shop = $stmt->fetch();
    echo json_encode(['exists' => !!$shop]);
}

// ===== GET: お気に入りエリア取得 =====
function handleGetFavAreas() {
    $auth = requireShopAuth();
    if (!$auth) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); return; }
    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT fav_areas FROM shops WHERE id = ?');
    $stmt->execute([$auth['shop_id']]);
    $row = $stmt->fetch();
    $favs = $row && $row['fav_areas'] ? json_decode($row['fav_areas'], true) : [];
    echo json_encode($favs ?: []);
}

// ===== POST: お気に入りエリア保存 =====
function handleSaveFavAreas() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $auth = requireShopAuth();
    if (!$auth) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); return; }
    $input = json_decode(file_get_contents('php://input'), true);
    $favs = $input['fav_areas'] ?? [];
    if (!is_array($favs)) $favs = [];
    // 最大20件に制限
    $favs = array_slice($favs, 0, 20);
    $pdo = DB::conn();
    $stmt = $pdo->prepare('UPDATE shops SET fav_areas = ? WHERE id = ?');
    $stmt->execute([json_encode($favs, JSON_UNESCAPED_UNICODE), $auth['shop_id']]);
    echo json_encode(['ok' => true]);
}
?>
