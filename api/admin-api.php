<?php
/**
 * admin-api.php — 管理画面統合API（MySQL版）
 * 全action: admin PHPセッション認証必須
 */
require_once __DIR__ . '/db.php';

if (!defined('SESSION_TIMEOUT')) define('SESSION_TIMEOUT', 1800);
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
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Credentials: true');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// 認証チェック
if (empty($_SESSION['user_id'])) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); exit; }
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
    'hotels', 'reports', 'loveho_reports', 'shops',
    'shop_placements', 'shop_contracts', 'ad_placements', 'ad_contracts',
    'hotel_requests', 'hotel_corrections', 'outreach_emails',
    'can_call_reasons', 'cannot_call_reasons', 'room_types',
    'shop_service_options', 'loveho_good_points', 'loveho_atmospheres',
    'contract_plans', 'ad_plans', 'shop_plan_requests',
];

// ===== マスタデータテーブル（変更時にmaster-data.json再生成） =====
$MASTER_TABLES = [
    'can_call_reasons', 'cannot_call_reasons', 'room_types',
    'loveho_good_points', 'loveho_atmospheres',
    'shop_service_options', 'contract_plans',
];

/**
 * マスタデータテーブル変更時にmaster-data.jsonを再生成
 */
function regenerateMasterDataIfNeeded(string $table): void {
    global $MASTER_TABLES;
    if (!in_array($table, $MASTER_TABLES)) return;
    try {
        ob_start();
        include __DIR__ . '/generate-master-data.php';
        ob_end_clean();
    } catch (Exception $e) {
        ob_end_clean();
        error_log('[admin-api] master-data.json regeneration failed: ' . $e->getMessage());
    }
}

// ===== 値が配列なら自動的にJSON化（カラム名ハードコード不要） =====

try {
    switch ($action) {
        // ===== ダッシュボード =====
        case 'dashboard': handleDashboard(); break;

        // ===== 汎用CRUD =====
        case 'list':   handleList(); break;
        case 'insert': handleInsert(); break;
        case 'update': handleUpdate(); break;
        case 'delete': handleDelete(); break;

        // ===== ad_placementsモード同期 =====
        case 'update-ad-mode': handleUpdateAdMode(); break;

        // ===== 一括並べ替え =====
        case 'reorder': handleReorder(); break;

        // ===== 特殊クエリ =====
        case 'reports-all':    handleReportsAll(); break;
        case 'hotels-search':  handleHotelsSearch(); break;
        case 'hotel-cascades': handleHotelCascades(); break;
        case 'shop-contracts': handleShopContracts(); break;
        case 'renew-contract': handleRenewContract(); break;
        case 'set-contract-expiry': handleSetContractExpiry(); break;
        case 'ad-contracts-list': handleAdContractsList(); break;
        case 'ad-slot-count':  handleAdSlotCount(); break;
        case 'ad-toggle-contract': handleAdToggleContract(); break;
        case 'ad-delete-contract': handleAdDeleteContract(); break;
        case 'ng-words-list': handleNgWordsList(); break;
        case 'ng-words-save': handleNgWordsSave(); break;
        case 'plan-requests': handlePlanRequests(); break;
        case 'review-plan-request': handleReviewPlanRequest(); break;

        default:
            http_response_code(400);
            echo json_encode(['error' => 'Unknown action: ' . $action]);
    }
} catch (Exception $e) {
    error_log('[admin-api] ' . $action . ' error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'サーバーエラーが発生しました']);
}

// ===================================================================
// ダッシュボード
// ===================================================================
function handleDashboard() {
    global $pdo;
    $hotelCount = $pdo->query("SELECT COUNT(*) FROM hotels")->fetchColumn();
    $reportCount = $pdo->query("SELECT COUNT(*) FROM reports")->fetchColumn();
    $shopCount = $pdo->query("SELECT COUNT(*) FROM shops")->fetchColumn();
    $canCount = $pdo->query("SELECT COUNT(*) FROM reports WHERE can_call = 1")->fetchColumn();
    $flagCount = $pdo->query("SELECT COUNT(*) FROM reports WHERE flagged_at IS NOT NULL AND flag_resolved IS NULL")->fetchColumn();
    $lhFlagCount = $pdo->query("SELECT COUNT(*) FROM loveho_reports WHERE flagged_at IS NOT NULL AND flag_resolved IS NULL")->fetchColumn();
    $flagCount = (int)$flagCount + (int)$lhFlagCount;
    $shopPendCount = $pdo->query("SELECT COUNT(*) FROM shops WHERE status = 'registered'")->fetchColumn();
    $hreqPendCount = $pdo->query("SELECT COUNT(*) FROM hotel_requests WHERE status = 'pending'")->fetchColumn();
    try { $corrPendCount = $pdo->query("SELECT COUNT(*) FROM hotel_corrections WHERE status = 'pending'")->fetchColumn(); } catch (Exception $e) { $corrPendCount = 0; }
    try { $planReqPendCount = $pdo->query("SELECT COUNT(*) FROM shop_plan_requests WHERE status = 'pending'")->fetchColumn(); } catch (Exception $e) { $planReqPendCount = 0; }

    // 最新10件のレポート（ホテル）
    $stmt = $pdo->query("SELECT r.*, h.name AS hotel_name FROM reports r LEFT JOIN hotels h ON h.id = r.hotel_id ORDER BY r.created_at DESC LIMIT 10");
    $recent = $stmt->fetchAll();
    foreach ($recent as &$r) {
        $r['can_call'] = (bool)$r['can_call'];
        $r['can_call_reasons'] = DB::jsonDecode($r['can_call_reasons'] ?? null);
        $r['cannot_call_reasons'] = DB::jsonDecode($r['cannot_call_reasons'] ?? null);
    }
    unset($r);

    // 最新10件のラブホ口コミ
    $stmt = $pdo->query("SELECT lr.*, h.name AS hotel_name FROM loveho_reports lr LEFT JOIN hotels h ON h.id = lr.hotel_id ORDER BY lr.created_at DESC LIMIT 10");
    $recentLoveho = $stmt->fetchAll();
    foreach ($recentLoveho as &$r) {
        $r['good_points'] = DB::jsonDecode($r['good_points'] ?? null);
    }
    unset($r);

    // 最新10件の店舗登録
    $stmt = $pdo->query("SELECT id, shop_name, gender_mode, email, status, created_at FROM shops ORDER BY created_at DESC LIMIT 10");
    $recentShops = $stmt->fetchAll();

    // 最新10件のホテル追加・編集（updated_atまたはcreated_at順）
    $stmt = $pdo->query("SELECT id, name, prefecture, city, hotel_type, source, is_edited, created_at, updated_at, GREATEST(COALESCE(updated_at, created_at), created_at) AS last_changed FROM hotels ORDER BY last_changed DESC LIMIT 10");
    $recentHotelEdits = $stmt->fetchAll();

    // 最新10件の掲載リクエスト
    $stmt = $pdo->query("SELECT * FROM hotel_requests ORDER BY created_at DESC LIMIT 10");
    $recentRequests = $stmt->fetchAll();

    echo json_encode([
        'hotel_count' => (int)$hotelCount,
        'report_count' => (int)$reportCount,
        'shop_count' => (int)$shopCount,
        'can_count' => (int)$canCount,
        'flag_count' => (int)$flagCount,
        'shop_pend_count' => (int)$shopPendCount,
        'hreq_pend_count' => (int)$hreqPendCount,
        'corr_pend_count' => (int)$corrPendCount,
        'plan_req_pend_count' => (int)$planReqPendCount,
        'recent' => $recent,
        'recent_loveho' => $recentLoveho,
        'recent_shops' => $recentShops,
        'recent_hotel_edits' => $recentHotelEdits,
        'recent_requests' => $recentRequests,
    ], JSON_UNESCAPED_UNICODE);
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

    // JSON配列カラムのデコード
    foreach ($rows as &$r) {
        foreach (['can_call_reasons', 'cannot_call_reasons', 'good_points', 'conditions'] as $jc) {
            if (isset($r[$jc])) $r[$jc] = DB::jsonDecode($r[$jc]);
        }
        if (isset($r['can_call'])) $r['can_call'] = (bool)$r['can_call'];
        if (isset($r['is_published'])) $r['is_published'] = (bool)$r['is_published'];
        if (isset($r['is_edited'])) $r['is_edited'] = (bool)$r['is_edited'];
        if (isset($r['is_hidden'])) $r['is_hidden'] = (bool)$r['is_hidden'];
        if (isset($r['is_active'])) $r['is_active'] = (bool)$r['is_active'];
        if (isset($r['is_bonus'])) $r['is_bonus'] = (bool)$r['is_bonus'];
        if (isset($r['multi_person'])) $r['multi_person'] = (bool)$r['multi_person'];
    }
    echo json_encode($rows, JSON_UNESCAPED_UNICODE);
}

// ===================================================================
// 汎用INSERT（挿入後のレコードを返す）
// ===================================================================
function handleInsert() {
    global $pdo, $ALLOWED_TABLES;
    $table = $input['table'] ?? ($GLOBALS['input']['table'] ?? '');
    $data = $input['data'] ?? ($GLOBALS['input']['data'] ?? []);
    // Re-read from global
    $input = $GLOBALS['input'];
    $table = $input['table'] ?? '';
    $data = $input['data'] ?? [];

    if (!in_array($table, $ALLOWED_TABLES) || empty($data)) {
        http_response_code(400); echo json_encode(['error' => 'Invalid parameters']); return;
    }

    // UUID for UUID-based tables
    $uuidTables = ['reports', 'loveho_reports', 'shops'];
    if (in_array($table, $uuidTables) && !isset($data['id'])) {
        $data['id'] = DB::uuid();
    }

    $cols = [];
    $placeholders = [];
    $params = [];
    foreach ($data as $col => $val) {
        $col = preg_replace('/[^a-zA-Z0-9_]/', '', $col);
        $cols[] = "`$col`";
        $placeholders[] = '?';
        if (is_array($val)) {
            $params[] = DB::jsonEncode($val);
        } elseif (is_bool($val)) {
            $params[] = (int)$val;
        } else {
            $params[] = $val;
        }
    }

    // shop_contracts: 有料プラン（plan_id > 1）に自動で expires_at を付与
    if ($table === 'shop_contracts' && !isset($data['expires_at'])) {
        $planId = (int)($data['plan_id'] ?? 0);
        if ($planId > 1) {
            $cols[] = '`expires_at`';
            $placeholders[] = 'DATE_ADD(CURDATE(), INTERVAL 1 MONTH)';
            // placeholderが式なのでparamsには追加しない→prepare文を直接組み立て
        }
    }

    // DATE_ADD等のSQL式を含むplaceholderに対応
    $sql = "INSERT INTO `$table` (" . implode(',', $cols) . ") VALUES (" . implode(',', $placeholders) . ")";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    $id = isset($data['id']) ? $data['id'] : $pdo->lastInsertId();
    // Return inserted row
    $stmt = $pdo->prepare("SELECT * FROM `$table` WHERE id = ?");
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if ($row) {
        foreach (['can_call_reasons', 'cannot_call_reasons', 'good_points', 'conditions'] as $jc) {
            if (isset($row[$jc])) $row[$jc] = DB::jsonDecode($row[$jc]);
        }
        if (isset($row['is_active'])) $row['is_active'] = (bool)$row['is_active'];
    }
    echo json_encode(['ok' => true, 'data' => $row], JSON_UNESCAPED_UNICODE);
    regenerateMasterDataIfNeeded($table);
}

// ===================================================================
// 汎用UPDATE
// ===================================================================
function handleUpdate() {
    global $pdo, $ALLOWED_TABLES;
    $input = $GLOBALS['input'];
    $table = $input['table'] ?? '';
    $id = $input['id'] ?? '';
    $data = $input['data'] ?? [];
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

    // 旧店名を取得（UPDATE前に取得する必要がある）
    $oldShopName = null;
    if ($table === 'shops' && isset($data['shop_name'])) {
        $sOld = $pdo->prepare('SELECT shop_name FROM shops WHERE id = ?');
        $sOld->execute([$id]);
        $oldShopName = $sOld->fetchColumn();
    }

    $sql = "UPDATE `$table` SET " . implode(', ', $sets) . " WHERE id = ?";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    // 店舗のshop_name変更時、reports/loveho_reportsのposter_nameを連動更新
    if ($table === 'shops' && isset($data['shop_name'])) {
        $newName = $data['shop_name'];
        $oldName = $oldShopName;
        // shop_idベースで確実に更新
        $sn1 = $pdo->prepare('UPDATE reports SET poster_name = ? WHERE shop_id = ? AND poster_type = ?');
        $sn1->execute([$newName, $id, 'shop']);
        $sn2 = $pdo->prepare('UPDATE loveho_reports SET poster_name = ? WHERE shop_id = ? AND poster_type = ?');
        $sn2->execute([$newName, $id, 'shop']);
        // レガシー: shop_idがないがposter_nameが旧店名のレコードも更新
        if ($oldName && $oldName !== $newName) {
            $sn3 = $pdo->prepare('UPDATE reports SET poster_name = ?, shop_id = ? WHERE poster_name = ? AND poster_type = ? AND shop_id IS NULL');
            $sn3->execute([$newName, $id, $oldName, 'shop']);
            $sn4 = $pdo->prepare('UPDATE loveho_reports SET poster_name = ?, shop_id = ? WHERE poster_name = ? AND poster_type = ? AND shop_id IS NULL');
            $sn4->execute([$newName, $id, $oldName, 'shop']);
        }
    }

    // 店舗のgender_mode変更時、関連テーブルを全て連動更新
    if ($table === 'shops' && isset($data['gender_mode'])) {
        $newMode = $data['gender_mode'];
        // reports: shop_id で紐付け
        $s = $pdo->prepare('UPDATE reports SET gender_mode = ? WHERE shop_id = ? AND poster_type = ?');
        $s->execute([$newMode, $id, 'shop']);
        // loveho_reports: shop_id で紐付け
        $s2 = $pdo->prepare('UPDATE loveho_reports SET gender_mode = ? WHERE shop_id = ? AND poster_type = ?');
        $s2->execute([$newMode, $id, 'shop']);
        // 後方互換: shop_idがないレガシーレコードもposter_nameで更新
        $s3 = $pdo->prepare('SELECT shop_name FROM shops WHERE id = ?');
        $s3->execute([$id]);
        $shopName = $s3->fetchColumn();
        if ($shopName) {
            $s4 = $pdo->prepare('UPDATE loveho_reports SET gender_mode = ? WHERE poster_name = ? AND (poster_type IS NULL OR poster_type = ?) AND shop_id IS NULL');
            $s4->execute([$newMode, $shopName, 'user']);
        }
        // ad_placements: shop_id で紐付け
        $s5 = $pdo->prepare('UPDATE ad_placements SET mode = ? WHERE shop_id = ?');
        $s5->execute([$newMode, $id]);
    }

    echo json_encode(['ok' => true, 'affected' => $stmt->rowCount()]);
    regenerateMasterDataIfNeeded($table);
}

// ===================================================================
// 汎用DELETE
// ===================================================================
function handleDelete() {
    global $pdo, $ALLOWED_TABLES;
    $input = $GLOBALS['input'];
    $table = $input['table'] ?? '';
    $id = $input['id'] ?? '';
    // 追加フィルタ（shop_contracts用: shop_id + plan_id）
    $filters = $input['filters'] ?? null;

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
    regenerateMasterDataIfNeeded($table);
}

// ===================================================================
// ad_placementsのmodeを店舗のgender_modeに同期
// ===================================================================
function handleUpdateAdMode() {
    $input = json_decode(file_get_contents('php://input'), true);
    $shopId = $input['shop_id'] ?? null;
    $mode = $input['mode'] ?? null;
    if (!$shopId || !$mode) { echo json_encode(['ok' => false, 'error' => 'shop_id and mode required']); return; }
    $pdo = DB::conn();
    $stmt = $pdo->prepare('UPDATE ad_placements SET mode = ? WHERE shop_id = ?');
    $stmt->execute([$mode, $shopId]);
    echo json_encode(['ok' => true, 'updated' => $stmt->rowCount()]);
}

// 一括並べ替え
// ===================================================================
function handleReorder() {
    global $pdo, $ALLOWED_TABLES;
    $input = $GLOBALS['input'];
    $table = $input['table'] ?? '';
    $items = $input['items'] ?? []; // [{id, sort_order}, ...]
    if (!in_array($table, $ALLOWED_TABLES) || empty($items)) {
        http_response_code(400); echo json_encode(['error' => 'Invalid parameters']); return;
    }
    $stmt = $pdo->prepare("UPDATE `$table` SET sort_order = ? WHERE id = ?");
    foreach ($items as $item) {
        $stmt->execute([(int)$item['sort_order'], $item['id']]);
    }
    echo json_encode(['ok' => true]);
    regenerateMasterDataIfNeeded($table);
}

// ===================================================================
// 投稿一括取得（reports + loveho_reports + hotels JOIN）
// ===================================================================
function handleReportsAll() {
    global $pdo;
    $stmt = $pdo->query("SELECT r.*, h.name AS hotel_name FROM reports r LEFT JOIN hotels h ON h.id = r.hotel_id ORDER BY r.created_at DESC LIMIT 2000");
    $reports = $stmt->fetchAll();
    foreach ($reports as &$r) {
        $r['can_call'] = (bool)$r['can_call'];
        $r['is_hidden'] = (bool)$r['is_hidden'];
        $r['multi_person'] = (bool)($r['multi_person'] ?? false);
        $r['can_call_reasons'] = DB::jsonDecode($r['can_call_reasons'] ?? null);
        $r['cannot_call_reasons'] = DB::jsonDecode($r['cannot_call_reasons'] ?? null);
        $r['conditions'] = DB::jsonDecode($r['conditions'] ?? null);
    }

    // Flagged reports (ensure all flagged are included even if beyond 2000 limit)
    $stmt = $pdo->query("SELECT r.*, h.name AS hotel_name FROM reports r LEFT JOIN hotels h ON h.id = r.hotel_id WHERE r.flagged_at IS NOT NULL ORDER BY r.created_at DESC");
    $flagged = $stmt->fetchAll();
    foreach ($flagged as &$r) {
        $r['can_call'] = (bool)$r['can_call'];
        $r['is_hidden'] = (bool)$r['is_hidden'];
        $r['multi_person'] = (bool)($r['multi_person'] ?? false);
        $r['can_call_reasons'] = DB::jsonDecode($r['can_call_reasons'] ?? null);
        $r['cannot_call_reasons'] = DB::jsonDecode($r['cannot_call_reasons'] ?? null);
        $r['conditions'] = DB::jsonDecode($r['conditions'] ?? null);
    }

    $stmt = $pdo->query("SELECT r.*, h.name AS hotel_name FROM loveho_reports r LEFT JOIN hotels h ON h.id = r.hotel_id ORDER BY r.created_at DESC LIMIT 2000");
    $loveho = $stmt->fetchAll();
    foreach ($loveho as &$r) {
        $r['is_hidden'] = (bool)($r['is_hidden'] ?? false);
        $r['multi_person'] = (bool)($r['multi_person'] ?? false);
        $r['good_points'] = DB::jsonDecode($r['good_points'] ?? null);
    }

    echo json_encode([
        'reports' => $reports,
        'flagged' => $flagged,
        'loveho' => $loveho,
    ], JSON_UNESCAPED_UNICODE);
}

// ===================================================================
// ホテル検索（フィルタ付き）
// ===================================================================
function handleHotelsSearch() {
    global $pdo;
    $q = $_GET['q'] ?? '';
    $pref = $_GET['pref'] ?? '';
    $city = $_GET['city'] ?? '';
    $source = $_GET['source'] ?? '';
    $pub = $_GET['pub'] ?? '';
    $region_prefs = $_GET['region_prefs'] ?? ''; // comma-separated

    $where = [];
    $params = [];

    if ($q) {
        $kw = '%' . $q . '%';
        $where[] = '(h.name LIKE ? OR h.address LIKE ?)';
        $params[] = $kw;
        $params[] = $kw;
    }
    if ($pref) { $where[] = 'h.prefecture = ?'; $params[] = $pref; }
    elseif ($region_prefs) {
        $prefs = explode(',', $region_prefs);
        $placeholders = implode(',', array_fill(0, count($prefs), '?'));
        $where[] = "h.prefecture IN ($placeholders)";
        $params = array_merge($params, $prefs);
    }
    if ($city) { $where[] = 'h.city = ?'; $params[] = $city; }
    if ($source) { $where[] = 'h.source = ?'; $params[] = $source; }
    if ($pub === 'true') { $where[] = 'h.is_published = 1'; }
    if ($pub === 'false') { $where[] = 'h.is_published = 0'; }

    $whereStr = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $sql = "SELECT h.* FROM hotels h $whereStr ORDER BY h.name LIMIT 200";
    $params[] = null; // dummy to avoid empty params issue
    array_pop($params);

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['is_published'] = (bool)$r['is_published'];
        $r['is_edited'] = (bool)$r['is_edited'];
    }
    echo json_encode($rows, JSON_UNESCAPED_UNICODE);
}

// ===================================================================
// ホテルカスケード（major_area / detail_area / city）
// ===================================================================
function handleHotelCascades() {
    global $pdo;
    $field = $_GET['field'] ?? ''; // major_area, detail_area, city, prefecture
    $pref = $_GET['pref'] ?? '';
    $major_area = $_GET['major_area'] ?? '';
    $detail_area = $_GET['detail_area'] ?? '';

    $allowed_fields = ['major_area', 'detail_area', 'city', 'prefecture'];
    if (!in_array($field, $allowed_fields)) {
        http_response_code(400); echo json_encode(['error' => 'Invalid field']); return;
    }

    $where = ["h.is_published = 1", "h.`$field` IS NOT NULL"];
    $params = [];
    if ($pref) { $where[] = 'h.prefecture = ?'; $params[] = $pref; }
    if ($major_area) { $where[] = 'h.major_area = ?'; $params[] = $major_area; }
    if ($detail_area) { $where[] = 'h.detail_area = ?'; $params[] = $detail_area; }

    $whereStr = implode(' AND ', $where);
    $sql = "SELECT DISTINCT h.`$field` AS val FROM hotels h WHERE $whereStr ORDER BY h.`$field`";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $values = $stmt->fetchAll(PDO::FETCH_COLUMN);
    echo json_encode($values, JSON_UNESCAPED_UNICODE);
}

// ===================================================================
// 店舗契約プラン取得
// ===================================================================
function handleShopContracts() {
    global $pdo;
    $shopId = $_GET['shop_id'] ?? '';
    if (!$shopId) { echo json_encode([]); return; }
    $stmt = $pdo->prepare('SELECT sc.id, sc.plan_id, sc.expires_at, sc.created_at FROM shop_contracts sc WHERE sc.shop_id = ?');
    $stmt->execute([$shopId]);
    $rows = $stmt->fetchAll();
    echo json_encode(array_map(fn($r) => [
        'id' => (int)$r['id'],
        'plan_id' => (int)$r['plan_id'],
        'expires_at' => $r['expires_at'],
        'created_at' => $r['created_at'],
    ], $rows));
}

// 契約更新（月+1）
function handleRenewContract() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    global $pdo;
    $input = json_decode(file_get_contents('php://input'), true);
    $contractId = (int)($input['contract_id'] ?? 0);
    if (!$contractId) { http_response_code(400); echo json_encode(['error' => 'contract_id required']); return; }

    $stmt = $pdo->prepare('SELECT expires_at FROM shop_contracts WHERE id = ?');
    $stmt->execute([$contractId]);
    $row = $stmt->fetch();
    if (!$row) { http_response_code(404); echo json_encode(['error' => 'Contract not found']); return; }

    // 基準日: expires_atが過去なら今日から、未来ならexpires_atから +1ヶ月
    $base = $row['expires_at'] && $row['expires_at'] >= date('Y-m-d') ? $row['expires_at'] : date('Y-m-d');
    $newExpires = date('Y-m-d', strtotime($base . ' +1 month'));

    $stmt = $pdo->prepare('UPDATE shop_contracts SET expires_at = ? WHERE id = ?');
    $stmt->execute([$newExpires, $contractId]);
    echo json_encode(['success' => true, 'expires_at' => $newExpires]);
}

// 契約期限を直接設定
function handleSetContractExpiry() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    global $pdo;
    $input = json_decode(file_get_contents('php://input'), true);
    $contractId = (int)($input['contract_id'] ?? 0);
    $expiresAt = $input['expires_at'] ?? '';
    if (!$contractId || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $expiresAt)) {
        http_response_code(400); echo json_encode(['error' => 'Invalid parameters']); return;
    }
    $stmt = $pdo->prepare('UPDATE shop_contracts SET expires_at = ? WHERE id = ?');
    $stmt->execute([$expiresAt, $contractId]);
    echo json_encode(['success' => true, 'expires_at' => $expiresAt]);
}

// ===================================================================
// 広告契約一覧（JOIN shops + ad_plans + placements）
// ===================================================================
function handleAdContractsList() {
    global $pdo;
    $status = $_GET['status'] ?? '';
    $where = '';
    $params = [];
    if ($status) { $where = 'WHERE ac.status = ?'; $params[] = $status; }

    $sql = "SELECT ac.*, s.shop_name, ap.name AS plan_name, ap.level AS plan_level
            FROM ad_contracts ac
            LEFT JOIN shops s ON s.id = ac.shop_id
            LEFT JOIN ad_plans ap ON ap.id = ac.ad_plan_id
            $where ORDER BY ac.created_at DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $contracts = $stmt->fetchAll();

    // Get active placements for these shops
    if ($contracts) {
        $shopIds = array_unique(array_column($contracts, 'shop_id'));
        $placeholders = implode(',', array_fill(0, count($shopIds), '?'));
        $stmt = $pdo->prepare("SELECT p.*, ap.name AS plan_name, ap.level AS plan_level FROM ad_placements p LEFT JOIN ad_plans ap ON ap.id = p.ad_plan_id WHERE p.shop_id IN ($placeholders) AND p.status = 'active'");
        $stmt->execute($shopIds);
        $placements = $stmt->fetchAll();
    } else {
        $placements = [];
    }

    foreach ($placements as &$p) {
        $p['is_bonus'] = (bool)$p['is_bonus'];
    }

    echo json_encode(['contracts' => $contracts, 'placements' => $placements], JSON_UNESCAPED_UNICODE);
}

// ===================================================================
// 広告枠の使用数カウント
// ===================================================================
function handleAdSlotCount() {
    global $pdo;
    $level = $_GET['level'] ?? '';
    $target = $_GET['target'] ?? '';
    if (!$level || !$target) { echo json_encode(['count' => 0]); return; }

    $stmt = $pdo->prepare("SELECT COUNT(*) FROM ad_placements WHERE placement_type = ? AND placement_target = ? AND status = 'active'");
    $stmt->execute([$level, $target]);
    $count = (int)$stmt->fetchColumn();

    // Optional: include details
    $details = [];
    if (isset($_GET['details']) && $_GET['details'] === '1') {
        $stmt = $pdo->prepare("SELECT p.*, s.shop_name FROM ad_placements p LEFT JOIN shops s ON s.id = p.shop_id WHERE p.placement_type = ? AND p.placement_target = ? AND p.status = 'active'");
        $stmt->execute([$level, $target]);
        $details = $stmt->fetchAll();
        foreach ($details as &$d) { $d['is_bonus'] = (bool)$d['is_bonus']; }
    }

    echo json_encode(['count' => $count, 'details' => $details], JSON_UNESCAPED_UNICODE);
}

// ===================================================================
// 広告契約ステータス切替（placements連動）
// ===================================================================
function handleAdToggleContract() {
    global $pdo;
    $input = $GLOBALS['input'];
    $contractId = $input['contract_id'] ?? '';
    $newStatus = $input['status'] ?? '';
    if (!$contractId || !$newStatus) { http_response_code(400); echo json_encode(['error' => 'Missing params']); return; }

    $pdo->beginTransaction();
    $stmt = $pdo->prepare("UPDATE ad_contracts SET status = ? WHERE id = ?");
    $stmt->execute([$newStatus, $contractId]);

    if ($newStatus === 'paused') {
        $stmt = $pdo->prepare("SELECT shop_id FROM ad_contracts WHERE id = ?");
        $stmt->execute([$contractId]);
        $shopId = $stmt->fetchColumn();
        if ($shopId) {
            $stmt = $pdo->prepare("UPDATE ad_placements SET status = 'paused' WHERE shop_id = ?");
            $stmt->execute([$shopId]);
        }
    }
    $pdo->commit();
    echo json_encode(['ok' => true]);
}

// ===================================================================
// 広告契約削除（placements連動）
// ===================================================================
function handleAdDeleteContract() {
    global $pdo;
    $input = $GLOBALS['input'];
    $contractId = $input['contract_id'] ?? '';
    $shopId = $input['shop_id'] ?? '';
    if (!$contractId) { http_response_code(400); echo json_encode(['error' => 'Missing contract_id']); return; }

    $pdo->beginTransaction();
    if ($shopId) {
        $stmt = $pdo->prepare("DELETE FROM ad_placements WHERE shop_id = ?");
        $stmt->execute([$shopId]);
    }
    $stmt = $pdo->prepare("DELETE FROM ad_contracts WHERE id = ?");
    $stmt->execute([$contractId]);
    $pdo->commit();
    echo json_encode(['ok' => true]);
}

// NGワード一覧取得
function handleNgWordsList() {
    require_once __DIR__ . '/validation.php';
    echo json_encode(loadNgWords(), JSON_UNESCAPED_UNICODE);
}

// NGワード保存
function handleNgWordsSave() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    require_once __DIR__ . '/validation.php';
    $input = json_decode(file_get_contents('php://input'), true);
    $words = $input['words'] ?? [];
    if (!is_array($words)) { http_response_code(400); echo json_encode(['error' => 'Invalid data']); return; }
    if (saveNgWords($words)) {
        echo json_encode(['success' => true, 'count' => count($words)]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => '保存に失敗しました']);
    }
}

// プラン申込一覧
function handlePlanRequests() {
    global $pdo;
    $stmt = $pdo->query('
        SELECT r.*, s.shop_name, s.email, s.gender_mode, cp.name AS plan_name, cp.price AS plan_price
        FROM shop_plan_requests r
        JOIN shops s ON r.shop_id = s.id
        JOIN contract_plans cp ON r.plan_id = cp.id
        ORDER BY FIELD(r.status, "pending", "approved", "rejected", "cancelled"), r.created_at DESC
    ');
    $rows = $stmt->fetchAll();
    foreach ($rows as &$row) {
        if ($row['requested_areas']) $row['requested_areas'] = json_decode($row['requested_areas'], true);
    }
    echo json_encode($rows, JSON_UNESCAPED_UNICODE);
}

// プラン申込 承認/却下
function handleReviewPlanRequest() {
    global $pdo;
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $input = json_decode(file_get_contents('php://input'), true);
    $requestId = (int)($input['request_id'] ?? 0);
    $action = $input['action'] ?? '';
    $adminNote = trim($input['admin_note'] ?? '');

    if (!$requestId || !in_array($action, ['approve', 'reject'])) {
        http_response_code(400); echo json_encode(['error' => 'Invalid parameters']); return;
    }

    // 現在のリクエスト取得（pending確認）
    $stmt = $pdo->prepare('SELECT r.*, s.shop_name, s.email, cp.name AS plan_name, cp.price AS plan_price FROM shop_plan_requests r JOIN shops s ON r.shop_id = s.id JOIN contract_plans cp ON r.plan_id = cp.id WHERE r.id = ? AND r.status = ?');
    $stmt->execute([$requestId, 'pending']);
    $req = $stmt->fetch();
    if (!$req) { http_response_code(404); echo json_encode(['error' => '対象の申込が見つかりません']); return; }

    $now = date('Y-m-d H:i:s');
    $pdo->beginTransaction();
    try {
        if ($action === 'approve') {
            // shop_contracts作成
            $expiresAt = date('Y-m-d', strtotime('+1 month'));
            $stmt = $pdo->prepare('INSERT INTO shop_contracts (shop_id, plan_id, created_at, expires_at) VALUES (?, ?, ?, ?)');
            $stmt->execute([$req['shop_id'], $req['plan_id'], $now, $expiresAt]);
            $contractId = $pdo->lastInsertId();

            // shop_plan_requests更新
            $stmt = $pdo->prepare('UPDATE shop_plan_requests SET status = ?, contract_id = ?, admin_note = ?, reviewed_at = ? WHERE id = ?');
            $stmt->execute(['approved', $contractId, $adminNote ?: null, $now, $requestId]);

            // 掲載エリア作成（requested_areasがあれば）
            $areas = $req['requested_areas'] ? json_decode($req['requested_areas'], true) : [];
            if (is_array($areas)) {
                foreach ($areas as $area) {
                    $stmt = $pdo->prepare('INSERT INTO shop_placements (shop_id, level, target_name, is_active) VALUES (?, ?, ?, 1)');
                    $stmt->execute([$req['shop_id'], 'city', $area]);
                }
            }

            $pdo->commit();

            // 承認メール
            $contractUrl = 'https://yobuho.com/api/contract.php?id=' . $requestId;
            $body = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">'
                . '<h2 style="color:#b5627a;">YobuHo</h2>'
                . '<p>' . htmlspecialchars($req['shop_name']) . ' 様</p>'
                . '<p>プラン申込が承認されました。</p>'
                . '<table style="border-collapse:collapse;width:100%;font-size:14px;margin:16px 0;">'
                . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;width:120px;">プラン</td><td style="padding:8px;border-bottom:1px solid #eee;">' . htmlspecialchars($req['plan_name']) . '</td></tr>'
                . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">月額料金</td><td style="padding:8px;border-bottom:1px solid #eee;">&yen;' . number_format($req['plan_price']) . '/月(税込)</td></tr>'
                . '<tr><td style="padding:8px;color:#888;">契約期間</td><td style="padding:8px;">' . date('Y/m/d') . ' 〜 ' . date('Y/m/d', strtotime('+1 month')) . '</td></tr>'
                . '</table>'
                . '<div style="text-align:center;margin:24px 0;">'
                . '<a href="' . $contractUrl . '" style="display:inline-block;padding:14px 36px;background:#b5627a;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:14px;">契約書を確認する</a>'
                . '</div>'
                . '<p style="font-size:12px;color:#888;">契約書ページからPDFとして保存できます（ブラウザの印刷機能をご利用ください）。</p>'
                . '<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">'
                . '<p style="font-size:11px;color:#999;">このメールはYobuHoから自動送信されています。</p>'
                . '</div>';
            sendPlanMail($req['email'], '【YobuHo】プラン申込が承認されました', $body);

            echo json_encode(['ok' => true, 'contract_id' => (int)$contractId]);

        } else {
            // 却下
            $stmt = $pdo->prepare('UPDATE shop_plan_requests SET status = ?, admin_note = ?, reviewed_at = ? WHERE id = ?');
            $stmt->execute(['rejected', $adminNote ?: null, $now, $requestId]);
            $pdo->commit();

            // 却下メール
            $body = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">'
                . '<h2 style="color:#b5627a;">YobuHo</h2>'
                . '<p>' . htmlspecialchars($req['shop_name']) . ' 様</p>'
                . '<p>プラン申込について、確認の結果、今回は見送りとなりました。</p>'
                . '<table style="border-collapse:collapse;width:100%;font-size:14px;margin:16px 0;">'
                . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;width:120px;">プラン</td><td style="padding:8px;border-bottom:1px solid #eee;">' . htmlspecialchars($req['plan_name']) . '</td></tr>'
                . ($adminNote ? '<tr><td style="padding:8px;color:#888;">理由</td><td style="padding:8px;">' . nl2br(htmlspecialchars($adminNote)) . '</td></tr>' : '')
                . '</table>'
                . '<p>ご不明な点がございましたら、お気軽にお問い合わせください。</p>'
                . '<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">'
                . '<p style="font-size:11px;color:#999;">このメールはYobuHoから自動送信されています。</p>'
                . '</div>';
            sendPlanMail($req['email'], '【YobuHo】プラン申込について', $body);

            echo json_encode(['ok' => true]);
        }
    } catch (Exception $e) {
        $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

function sendPlanMail($to, $subject, $htmlBody) {
    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        'From: =?UTF-8?B?' . base64_encode('YobuHo') . '?= <hotel@yobuho.com>',
    ];
    @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', base64_encode($htmlBody), implode("\r\n", $headers));
}
?>
