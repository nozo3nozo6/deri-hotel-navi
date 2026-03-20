<?php
/**
 * area-shops.php — エリア別の掲載店舗取得（MySQL版）
 * GET: ?pref=東京都&city=渋谷区&mode=men
 * Returns: 有料プラン店舗一覧
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

$pref = $_GET['pref'] ?? null;
$city = $_GET['city'] ?? null;
$mode = $_GET['mode'] ?? null;

if (!$pref) { http_response_code(400); echo json_encode(['error' => 'pref は必須です']); exit; }
if (!$mode || !in_array($mode, ['men', 'women', 'men_same', 'women_same'])) {
    http_response_code(400); echo json_encode(['error' => 'mode は必須です']); exit;
}

// Step 1: エリア内ホテルID取得
$hotelWhere = 'is_published = 1 AND prefecture = ?';
$hotelParams = [$pref];
if ($city) { $hotelWhere .= ' AND city = ?'; $hotelParams[] = $city; }
$stmt = $pdo->prepare("SELECT id FROM hotels WHERE $hotelWhere LIMIT 5000");
$stmt->execute($hotelParams);
$hotelIds = $stmt->fetchAll(PDO::FETCH_COLUMN);

if (empty($hotelIds)) { echo json_encode([]); exit; }

// Step 2: shop_hotel_info（can_call=1）→ shop_idごとのホテル数
$placeholders = implode(',', array_fill(0, count($hotelIds), '?'));
$stmt = $pdo->prepare("SELECT shop_id, COUNT(*) AS cnt FROM shop_hotel_info WHERE hotel_id IN ($placeholders) AND can_call = 1 GROUP BY shop_id");
$stmt->execute($hotelIds);
$shopCounts = [];
foreach ($stmt->fetchAll() as $row) {
    $shopCounts[$row['shop_id']] = (int)$row['cnt'];
}

if (empty($shopCounts)) { echo json_encode([]); exit; }

// Step 3: 店舗情報（active + gender_mode一致 + 有料プラン）
$shopIds = array_keys($shopCounts);
$spH = implode(',', array_fill(0, count($shopIds), '?'));
$stmt = $pdo->prepare("
    SELECT s.id, s.shop_name, s.shop_url, s.thumbnail_url, s.gender_mode,
           sc.plan_id, cp.price
    FROM shops s
    LEFT JOIN shop_contracts sc ON s.id = sc.shop_id
    LEFT JOIN contract_plans cp ON sc.plan_id = cp.id
    WHERE s.id IN ($spH) AND s.status = 'active' AND s.gender_mode = ?
");
$stmt->execute(array_merge($shopIds, [$mode]));
$shopRows = $stmt->fetchAll();

// 整形: shop_idごとに最大価格を計算
$shopMap = [];
foreach ($shopRows as $row) {
    $sid = $row['id'];
    if (!isset($shopMap[$sid])) {
        $shopMap[$sid] = [
            'shop_name' => $row['shop_name'],
            'shop_url' => $row['shop_url'],
            'thumbnail_url' => $row['thumbnail_url'],
            'plan_price' => 0,
            'hotel_count' => $shopCounts[$sid] ?? 0,
        ];
    }
    $price = (int)($row['price'] ?? 0);
    if ($price > $shopMap[$sid]['plan_price']) {
        $shopMap[$sid]['plan_price'] = $price;
    }
}

// 有料プランのみ + 価格順
$result = array_filter(array_values($shopMap), fn($s) => $s['plan_price'] > 0);
usort($result, fn($a, $b) => $b['plan_price'] - $a['plan_price']);

echo json_encode(array_values($result), JSON_UNESCAPED_UNICODE);
?>
