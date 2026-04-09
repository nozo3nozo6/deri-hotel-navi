<?php
/**
 * agent-api.php — 営業担当者API（MySQL版）
 * 全action: agent PHPセッション認証必須
 * 許可テーブル・アクションを制限
 */
require_once __DIR__ . '/db.php';

if (!defined('SESSION_TIMEOUT')) define('SESSION_TIMEOUT', 1800);
session_name('AGENT_SID');
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
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: https://yobuho.com');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Credentials: true');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// 認証チェック
if (empty($_SESSION['agent_id'])) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); exit; }
if (time() - ($_SESSION['last_activity'] ?? 0) > SESSION_TIMEOUT) {
    $_SESSION = []; session_destroy();
    http_response_code(401); echo json_encode(['error' => 'Session expired']); exit;
}
$_SESSION['last_activity'] = time();

$pdo = DB::conn();
$action = $_GET['action'] ?? '';
$input = ($_SERVER['REQUEST_METHOD'] === 'POST') ? (json_decode(file_get_contents('php://input'), true) ?? []) : [];

// ===== 許可テーブル =====
$ALLOWED_TABLES = [
    'shops', 'shop_contracts', 'contract_plans', 'shop_placements', 'ad_placements',
];

try {
    switch ($action) {
        case 'list':            handleList(); break;
        case 'update':          handleUpdate(); break;
        case 'insert':          handleInsert(); break;
        case 'delete':          handleDelete(); break;
        case 'shop-contracts':  handleShopContracts(); break;
        case 'register-shop':   handleRegisterShop(); break;
        case 'update-ad-mode':  handleUpdateAdMode(); break;

        default:
            http_response_code(400);
            echo json_encode(['error' => 'Unknown action: ' . $action]);
    }
} catch (Exception $e) {
    error_log('[agent-api] ' . $action . ' error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'サーバーエラーが発生しました']);
}

// ===================================================================
// 汎用リスト
// ===================================================================
function handleList() {
    global $pdo, $ALLOWED_TABLES;
    $table = $_GET['table'] ?? '';
    if (!in_array($table, $ALLOWED_TABLES)) { http_response_code(400); echo json_encode(['error' => 'Invalid table']); return; }

    $orderBy = $_GET['order'] ?? 'created_at';
    $orderDir = ($_GET['dir'] ?? 'desc') === 'asc' ? 'ASC' : 'DESC';
    $limit = min((int)($_GET['limit'] ?? 5000), 10000);
    $orderBy = preg_replace('/[^a-zA-Z0-9_]/', '', $orderBy);

    // Optional WHERE filters
    $where = [];
    $params = [];
    foreach (['status', 'shop_id', 'is_active', 'email', 'level', 'placement_type', 'placement_target', 'target_name'] as $col) {
        if (isset($_GET[$col]) && $_GET[$col] !== '') {
            $where[] = "`$col` = ?";
            $params[] = $_GET[$col];
        }
    }

    $whereStr = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
    $sql = "SELECT * FROM `$table` $whereStr ORDER BY `$orderBy` $orderDir LIMIT ?";
    $params[] = $limit;

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    // JSON配列カラムのデコード・型変換
    foreach ($rows as &$r) {
        if (isset($r['can_call'])) $r['can_call'] = (bool)$r['can_call'];
        if (isset($r['is_published'])) $r['is_published'] = (bool)$r['is_published'];
        if (isset($r['is_active'])) $r['is_active'] = (bool)$r['is_active'];
        if (isset($r['is_bonus'])) $r['is_bonus'] = (bool)$r['is_bonus'];
    }
    echo json_encode($rows, JSON_UNESCAPED_UNICODE);
}

// ===================================================================
// UPDATE（shopsテーブルのみ）
// ===================================================================
function handleUpdate() {
    global $pdo, $ALLOWED_TABLES;
    $input = $GLOBALS['input'];
    $table = $input['table'] ?? '';
    $id = $input['id'] ?? '';
    $data = $input['data'] ?? [];

    if ($table !== 'shops') {
        http_response_code(403); echo json_encode(['error' => 'Update only allowed on shops']); return;
    }
    if (!in_array($table, $ALLOWED_TABLES) || !$id || empty($data)) {
        http_response_code(400); echo json_encode(['error' => 'Invalid parameters']); return;
    }

    $sets = [];
    $params = [];
    foreach ($data as $col => $val) {
        $col = preg_replace('/[^a-zA-Z0-9_]/', '', $col);
        $sets[] = "`$col` = ?";
        if (is_array($val)) {
            $params[] = DB::jsonEncode($val);
        } elseif (is_bool($val)) {
            $params[] = (int)$val;
        } else {
            $params[] = $val;
        }
    }
    $params[] = $id;
    $sql = "UPDATE `$table` SET " . implode(', ', $sets) . " WHERE id = ?";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    // 店舗のgender_mode変更時、関連テーブルを全て連動更新
    if (isset($data['gender_mode'])) {
        $newMode = $data['gender_mode'];
        // reports: shop_id で紐付け
        $s = $pdo->prepare('UPDATE reports SET gender_mode = ? WHERE shop_id = ? AND poster_type = ?');
        $s->execute([$newMode, $id, 'shop']);
        // loveho_reports: shop_id + poster_type で紐付け（後方互換: poster_nameでも更新）
        $s2 = $pdo->prepare('UPDATE loveho_reports SET gender_mode = ? WHERE shop_id = ? AND poster_type = ?');
        $s2->execute([$newMode, $id, 'shop']);
        $s3 = $pdo->prepare('SELECT shop_name FROM shops WHERE id = ?');
        $s3->execute([$id]);
        $shopName = $s3->fetchColumn();
        if ($shopName) {
            $s4 = $pdo->prepare('UPDATE loveho_reports SET gender_mode = ? WHERE poster_name = ? AND (poster_type IS NULL OR poster_type = ?) AND shop_id IS NULL');
            $s4->execute([$newMode, $shopName, 'user']);
        }
        // ad_placements: shop_id で紐付け
        $s4 = $pdo->prepare('UPDATE ad_placements SET mode = ? WHERE shop_id = ?');
        $s4->execute([$newMode, $id]);
    }

    echo json_encode(['ok' => true, 'affected' => $stmt->rowCount()]);
}

// ===================================================================
// INSERT（shop_contractsテーブルのみ）
// ===================================================================
function handleInsert() {
    global $pdo, $ALLOWED_TABLES;
    $input = $GLOBALS['input'];
    $table = $input['table'] ?? '';
    $data = $input['data'] ?? [];

    if ($table !== 'shop_contracts') {
        http_response_code(403); echo json_encode(['error' => 'Insert only allowed on shop_contracts']); return;
    }
    if (!in_array($table, $ALLOWED_TABLES) || empty($data)) {
        http_response_code(400); echo json_encode(['error' => 'Invalid parameters']); return;
    }

    $cols = [];
    $placeholders = [];
    $params = [];
    foreach ($data as $col => $val) {
        $col = preg_replace('/[^a-zA-Z0-9_]/', '', $col);
        $cols[] = "`$col`";
        $placeholders[] = '?';
        if (is_bool($val)) {
            $params[] = (int)$val;
        } else {
            $params[] = $val;
        }
    }

    $sql = "INSERT INTO `$table` (" . implode(',', $cols) . ") VALUES (" . implode(',', $placeholders) . ")";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    $id = $pdo->lastInsertId();
    $stmt = $pdo->prepare("SELECT * FROM `$table` WHERE id = ?");
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    echo json_encode(['ok' => true, 'data' => $row], JSON_UNESCAPED_UNICODE);
}

// ===================================================================
// DELETE（shop_contractsテーブルのみ）
// ===================================================================
function handleDelete() {
    global $pdo, $ALLOWED_TABLES;
    $input = $GLOBALS['input'];
    $table = $input['table'] ?? '';
    $id = $input['id'] ?? '';
    $filters = $input['filters'] ?? null;

    if ($table !== 'shop_contracts') {
        http_response_code(403); echo json_encode(['error' => 'Delete only allowed on shop_contracts']); return;
    }
    if (!in_array($table, $ALLOWED_TABLES)) {
        http_response_code(400); echo json_encode(['error' => 'Invalid table']); return;
    }

    if ($filters && is_array($filters)) {
        $where = [];
        $params = [];
        foreach ($filters as $col => $val) {
            $col = preg_replace('/[^a-zA-Z0-9_]/', '', $col);
            $where[] = "`$col` = ?";
            $params[] = $val;
        }
        $sql = "DELETE FROM `$table` WHERE " . implode(' AND ', $where);
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
    } elseif ($id) {
        $stmt = $pdo->prepare("DELETE FROM `$table` WHERE id = ?");
        $stmt->execute([$id]);
    } else {
        http_response_code(400); echo json_encode(['error' => 'id or filters required']); return;
    }
    echo json_encode(['ok' => true]);
}

// ===================================================================
// 店舗契約プラン取得
// ===================================================================
function handleShopContracts() {
    global $pdo;
    $shopId = $_GET['shop_id'] ?? '';
    if (!$shopId) { echo json_encode([]); return; }
    $stmt = $pdo->prepare('SELECT sc.id, sc.plan_id FROM shop_contracts sc WHERE sc.shop_id = ?');
    $stmt->execute([$shopId]);
    $rows = $stmt->fetchAll();
    echo json_encode(array_map(fn($r) => ['id' => (int)$r['id'], 'plan_id' => (int)$r['plan_id']], $rows));
}

// ===================================================================
// 店舗登録（営業担当者用: メール認証スキップ）
// ===================================================================
function handleRegisterShop() {
    global $pdo;
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POSTのみ']); return; }

    $input = $GLOBALS['input'];
    $email      = trim($input['email'] ?? '');
    $shopName   = trim($input['shop_name'] ?? '');
    $genderMode = $input['gender_mode'] ?? 'men';
    $shopUrl    = trim($input['shop_url'] ?? '');
    $shopTel    = trim($input['shop_tel'] ?? '');
    $password   = $input['password'] ?? '';

    if (!$email || !$shopName) { http_response_code(400); echo json_encode(['error' => 'email と shop_name は必須です']); return; }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { http_response_code(400); echo json_encode(['error' => '無効なメールアドレスです']); return; }

    $allowedGenders = ['men', 'women', 'men_same', 'women_same', 'este'];
    if (!in_array($genderMode, $allowedGenders)) { http_response_code(400); echo json_encode(['error' => '無効なジャンルです']); return; }

    $shopName = mb_substr($shopName, 0, 100);

    // 既存チェック
    $stmt = $pdo->prepare('SELECT id, status FROM shops WHERE email = ?');
    $stmt->execute([$email]);
    $existing = $stmt->fetch();
    if ($existing) { http_response_code(409); echo json_encode(['error' => 'このメールアドレスは既に登録されています']); return; }

    // bcryptハッシュ化
    $bcryptHash = null;
    if ($password) {
        $bcryptHash = password_hash($password, PASSWORD_BCRYPT);
    }

    // slug自動生成
    $slug = generateSlug($pdo);

    $now = date('Y-m-d H:i:s');
    $id = DB::uuid();
    $registeredBy = $_SESSION['agent_username'] ?? 'agent';

    $stmt = $pdo->prepare('INSERT INTO shops (id, email, shop_name, gender_mode, shop_url, shop_tel, password_hash, slug, status, registered_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    $stmt->execute([$id, $email, $shopName, $genderMode, $shopUrl ?: null, $shopTel ?: null, $bcryptHash, $slug, 'registered', $registeredBy, $now, $now]);

    $stmt = $pdo->prepare('SELECT * FROM shops WHERE id = ?');
    $stmt->execute([$id]);
    $shop = $stmt->fetch();
    unset($shop['password_hash']);

    echo json_encode(['success' => true, 'shop' => $shop], JSON_UNESCAPED_UNICODE);
}

/**
 * slug自動生成（ランダム8文字英小文字+数字）
 */
function generateSlug(PDO $pdo): string {
    $chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for ($attempt = 0; $attempt < 10; $attempt++) {
        $slug = '';
        for ($i = 0; $i < 8; $i++) $slug .= $chars[random_int(0, strlen($chars) - 1)];
        $stmt = $pdo->prepare('SELECT id FROM shops WHERE slug = ? LIMIT 1');
        $stmt->execute([$slug]);
        if (!$stmt->fetch()) return $slug;
    }
    return bin2hex(random_bytes(4));
}

// ===================================================================
// ad_placementsのmodeを店舗のgender_modeに同期
// ===================================================================
function handleUpdateAdMode() {
    global $pdo;
    $input = $GLOBALS['input'];
    $shopId = $input['shop_id'] ?? null;
    $mode = $input['mode'] ?? null;
    if (!$shopId || !$mode) { echo json_encode(['ok' => false, 'error' => 'shop_id and mode required']); return; }
    $stmt = $pdo->prepare('UPDATE ad_placements SET mode = ? WHERE shop_id = ?');
    $stmt->execute([$mode, $shopId]);
    echo json_encode(['ok' => true, 'updated' => $stmt->rowCount()]);
}
