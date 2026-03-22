<?php
/**
 * hotels.php — ホテル検索統一エンドポイント（MySQL版）
 * GET params:
 *   pref, city, major_area, detail_area — フィルタ
 *   keyword — 名前/住所検索 (LIKE)
 *   station — 最寄駅検索 (完全一致)
 *   suggest_station — 駅名サジェスト (LIKE, DISTINCT駅名+件数)
 *   city_like — 市区町村あいまい検索 (LIKE, GPS用)
 *   type — hotel / loveho (default: hotel)
 *   hotel_id — 単一ホテル取得
 *   ids — カンマ区切りID
 *   has_coords — true の場合 latitude/longitude NOT NULL
 *   limit — 結果件数 (default: 50, max: 5000)
 *   no_major_area — true の場合 major_area IS NULL
 */

header('Content-Type: application/json; charset=UTF-8');

$allowed_origins = ['https://yobuho.com', 'https://deli.yobuho.com', 'https://jofu.yobuho.com', 'https://same.yobuho.com', 'https://loveho.yobuho.com'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed_origins)) {
    header('Access-Control-Allow-Origin: ' . $origin);
} else {
    header('Access-Control-Allow-Origin: https://yobuho.com');
}
header('Access-Control-Allow-Methods: GET');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . '/db.php';

$pdo = DB::conn();

// 駅名サジェスト: ?suggest_station=中野 → DISTINCT駅名+件数リスト
if (isset($_GET['suggest_station']) && $_GET['suggest_station'] !== '') {
    $q = preg_replace('/[駅站]$|Station$/i', '', trim($_GET['suggest_station']));
    if ($q === '') { echo '[]'; exit; }
    $stmt = $pdo->prepare(
        "SELECT nearest_station AS name, COUNT(*) AS cnt
         FROM hotels
         WHERE nearest_station LIKE ? AND nearest_station IS NOT NULL AND nearest_station != '' AND is_published = 1
         GROUP BY nearest_station
         ORDER BY
           CASE WHEN nearest_station = ? THEN 0 WHEN nearest_station LIKE ? THEN 1 ELSE 2 END,
           cnt DESC
         LIMIT 20"
    );
    $stmt->execute(['%' . $q . '%', $q, $q . '%']);
    echo json_encode($stmt->fetchAll(), JSON_UNESCAPED_UNICODE);
    exit;
}

$limit = min((int)($_GET['limit'] ?? 50), 5000);
$type  = $_GET['type'] ?? 'hotel';

$where = ['h.is_published = 1'];
$params = [];

// Hotel type filter
if ($type === 'loveho') {
    $where[] = "h.hotel_type IN ('love_hotel','rental_room')";
} elseif ($type !== 'all') {
    $where[] = "h.hotel_type NOT IN ('love_hotel','rental_room')";
}

// Exact filters
foreach (['pref' => 'prefecture', 'city' => 'city', 'major_area' => 'major_area', 'detail_area' => 'detail_area'] as $param => $col) {
    $val = $_GET[$param] ?? null;
    if ($val !== null && $val !== '') {
        $where[] = "h.`$col` = ?";
        $params[] = $val;
    }
}

// major_area IS NULL
if (isset($_GET['no_major_area']) && $_GET['no_major_area'] === 'true') {
    $where[] = 'h.major_area IS NULL';
}

// Single hotel by ID
if (isset($_GET['hotel_id'])) {
    $where = ['h.id = ?', 'h.is_published = 1'];
    $params = [(int)$_GET['hotel_id']];
}

// Multiple IDs
if (isset($_GET['ids'])) {
    $ids = array_filter(array_map('intval', explode(',', $_GET['ids'])));
    if ($ids) {
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $where[] = "h.id IN ($placeholders)";
        $params = array_merge($params, $ids);
    }
}

// Keyword search (name or address)
if (isset($_GET['keyword']) && $_GET['keyword'] !== '') {
    $kw = '%' . $_GET['keyword'] . '%';
    $where[] = '(h.name LIKE ? OR h.address LIKE ?)';
    $params[] = $kw;
    $params[] = $kw;
}

// Station search — 駅名完全一致（サジェストで選ばれた駅名で検索）
if (isset($_GET['station']) && $_GET['station'] !== '') {
    $where[] = 'h.nearest_station = ?';
    $params[] = trim($_GET['station']);
}

// City fuzzy search (GPS)
if (isset($_GET['city_like']) && $_GET['city_like'] !== '') {
    $where[] = 'h.city LIKE ?';
    $params[] = '%' . $_GET['city_like'] . '%';
}

// Has coordinates
if (isset($_GET['has_coords']) && $_GET['has_coords'] === 'true') {
    $where[] = 'h.latitude IS NOT NULL';
    $where[] = 'h.longitude IS NOT NULL';
}

$includeSummary = isset($_GET['include_summary']) && $_GET['include_summary'] === '1';

$whereStr = implode(' AND ', $where);
$select = $includeSummary
    ? "h.id, h.name, h.address, h.nearest_station, h.hotel_type, h.prefecture, h.city, h.major_area, h.detail_area, s.total_reports"
    : "h.*";
$join = $includeSummary
    ? " LEFT JOIN hotel_report_summary s ON s.hotel_id = h.id"
    : "";
$sql = "SELECT $select FROM hotels h$join WHERE $whereStr ORDER BY h.review_average IS NULL, h.review_average DESC LIMIT ?";
$params[] = $limit;

try {
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    if (!$includeSummary) {
        foreach ($rows as &$r) {
            $r['is_published'] = (bool)$r['is_published'];
            $r['is_edited'] = (bool)$r['is_edited'];
        }
    } else {
        foreach ($rows as &$r) {
            $r['total_reports'] = (int)($r['total_reports'] ?? 0);
        }
    }
    echo json_encode($rows, JSON_UNESCAPED_UNICODE);
} catch (Exception $e) {
    error_log('[hotels.php] MySQL error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Hotel query failed']);
}
?>
