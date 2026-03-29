<?php
/**
 * ads.php — 広告配置データ取得（MySQL版）
 * GET: ?type=placement_type&target=placement_target&mode=men
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
if ($_SERVER['REQUEST_METHOD'] !== 'GET') { http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit; }

require_once __DIR__ . '/db.php';
$pdo = DB::conn();

$type = $_GET['type'] ?? null;
$target = $_GET['target'] ?? null;
$mode = $_GET['mode'] ?? null;

if (!$type) { http_response_code(400); echo json_encode(['error' => 'type は必須です']); exit; }
if (!$mode) { http_response_code(400); echo json_encode(['error' => 'mode は必須です']); exit; }

$where = ['a.placement_type = ?', 'a.status = ?'];
$params = [$type, 'active'];

if ($target) {
    $where[] = 'a.placement_target = ?';
    $params[] = $target;
}

// mode フィルタ: mode一致 or mode='all' or mode IS NULL
$where[] = '(a.mode = ? OR a.mode = ? OR a.mode IS NULL)';
$params[] = $mode;
$params[] = 'all';

$whereStr = implode(' AND ', $where);
$stmt = $pdo->prepare("
    SELECT a.*, s.shop_name, s.shop_url, s.status AS shop_status, s.thumbnail_url AS shop_thumbnail,
           s.catchphrase, s.business_hours, s.min_price
    FROM ad_placements a
    LEFT JOIN shops s ON a.shop_id = s.id
    WHERE $whereStr
");
$stmt->execute($params);
$rows = $stmt->fetchAll();

// shops.status != 'active' を除外 + Supabase形式にreshape
$filtered = [];
foreach ($rows as $row) {
    if ($row['shop_status'] !== 'active') continue;
    $ad = [
        'id' => (int)$row['id'],
        'placement_type' => $row['placement_type'],
        'placement_target' => $row['placement_target'],
        'status' => $row['status'],
        'mode' => $row['mode'],
        'shop_id' => $row['shop_id'],
        'banner_image_url' => $row['banner_image_url'],
        'banner_link_url' => $row['banner_link_url'],
        'banner_size' => $row['banner_size'],
        'banner_alt' => $row['banner_alt'],
        'shops' => [
            'shop_name' => $row['shop_name'],
            'shop_url' => $row['shop_url'],
            'status' => $row['shop_status'],
            'thumbnail_url' => $row['shop_thumbnail'],
            'catchphrase' => $row['catchphrase'],
            'business_hours' => $row['business_hours'],
            'min_price' => $row['min_price'],
        ],
    ];
    $filtered[] = $ad;
}

echo json_encode($filtered, JSON_UNESCAPED_UNICODE);
?>
