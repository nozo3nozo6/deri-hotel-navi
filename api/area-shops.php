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
if (!$mode || !in_array($mode, ['men', 'women', 'men_same', 'women_same', 'este'])) {
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
    SELECT s.id, s.shop_name, s.shop_url, s.thumbnail_url, s.catchphrase,
           s.business_hours, s.pr_text, s.min_price, s.display_tel, s.gender_mode,
           s.approved_at, sc.plan_id, cp.price
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
            'catchphrase' => $row['catchphrase'],
            'business_hours' => $row['business_hours'],
            'pr_text' => $row['pr_text'],
            'min_price' => $row['min_price'],
            'display_tel' => $row['display_tel'],
            'approved_at' => $row['approved_at'],
            'plan_price' => 0,
            'hotel_count' => $shopCounts[$sid] ?? 0,
        ];
    }
    $price = (int)($row['price'] ?? 0);
    if ($price > $shopMap[$sid]['plan_price']) {
        $shopMap[$sid]['plan_price'] = $price;
    }
}

// 有料プランのみ + 掲載日順（早い方が上位）+ 3件制限
$result = array_filter(array_values($shopMap), fn($s) => $s['plan_price'] > 0);
usort($result, fn($a, $b) => strcmp($a['approved_at'] ?? '9999', $b['approved_at'] ?? '9999'));

// 画像3枚を取得
$allShopIds = array_column(array_values($result), null); // reset keys
$resultArr = array_values($result);
if (!empty($resultArr)) {
    $sids = array_map(fn($s) => $s['id'] ?? '', $resultArr);
    // shop_idはshopMap構築時にkeyとして使ったが、resultにidがない→shopMapから取得
}
// shopMapのキー(shop_id)を結果に付与
$finalResult = [];
foreach ($shopMap as $sid => $s) {
    if ($s['plan_price'] <= 0) continue;
    $s['id'] = $sid;
    $finalResult[] = $s;
}
usort($finalResult, fn($a, $b) => strcmp($a['approved_at'] ?? '9999', $b['approved_at'] ?? '9999'));

// 3件制限（各エリア先着3店）
$finalResult = array_slice($finalResult, 0, 3);

// shop_imagesを一括取得
$fIds = array_column($finalResult, 'id');
if (!empty($fIds)) {
    $ph = implode(',', array_fill(0, count($fIds), '?'));
    $stmt = $pdo->prepare("SELECT shop_id, image_url FROM shop_images WHERE shop_id IN ($ph) ORDER BY sort_order, id");
    $stmt->execute($fIds);
    $imgMap = [];
    foreach ($stmt->fetchAll() as $row) {
        $imgMap[$row['shop_id']][] = $row['image_url'];
    }
    foreach ($finalResult as &$s) {
        $s['images'] = $imgMap[$s['id']] ?? [];
    }
}

echo json_encode(array_values($finalResult), JSON_UNESCAPED_UNICODE);
?>
