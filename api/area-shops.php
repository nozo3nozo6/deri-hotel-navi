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

// 1クエリで hotels→shop_hotel_info→shops→contracts を結合
$cityWhere = '';
$queryParams = [$pref];
if ($city) { $cityWhere = 'AND h.city = ?'; $queryParams[] = $city; }
$queryParams[] = $mode;

$stmt = $pdo->prepare("
    SELECT s.id, s.shop_name, s.slug, s.shop_url, s.thumbnail_url, s.banner_type, s.catchphrase,
           s.business_hours, s.pr_text, s.min_price, s.display_tel, s.approved_at,
           COUNT(DISTINCT shi.hotel_id) AS hotel_count,
           MAX(cp.price) AS plan_price,
           MAX(st.shop_id IS NOT NULL) AS chat_enabled,
           MAX(st.is_online) AS chat_online
    FROM shop_hotel_info shi
    JOIN hotels h ON shi.hotel_id = h.id AND h.is_published = 1 AND h.prefecture = ? $cityWhere
    JOIN shops s ON shi.shop_id = s.id AND s.status = 'active' AND s.gender_mode = ?
    LEFT JOIN shop_contracts sc ON s.id = sc.shop_id AND (sc.expires_at IS NULL OR sc.expires_at >= CURDATE())
    LEFT JOIN contract_plans cp ON sc.plan_id = cp.id
    LEFT JOIN shop_chat_status st ON st.shop_id = s.id
    WHERE shi.can_call = 1
    GROUP BY s.id
    HAVING plan_price > 0
    ORDER BY s.approved_at ASC
    LIMIT 3
");
$stmt->execute($queryParams);
$shopRows = $stmt->fetchAll();

if (empty($shopRows)) { echo json_encode([]); exit; }

$finalResult = [];
foreach ($shopRows as $row) {
    $finalResult[] = [
        'id' => $row['id'],
        'shop_name' => $row['shop_name'],
        'slug' => $row['slug'] ?? null,
        'shop_url' => $row['shop_url'],
        'thumbnail_url' => $row['thumbnail_url'],
        'banner_type' => $row['banner_type'],
        'catchphrase' => $row['catchphrase'],
        'business_hours' => $row['business_hours'],
        'pr_text' => $row['pr_text'],
        'min_price' => $row['min_price'],
        'display_tel' => $row['display_tel'],
        'approved_at' => $row['approved_at'],
        'hotel_count' => (int)$row['hotel_count'],
        'plan_price' => (int)$row['plan_price'],
        'chat_enabled' => (int)$row['chat_enabled'] === 1,
        'chat_online' => (int)$row['chat_online'] === 1,
    ];
}

// 3件制限（各エリア先着3店）
$finalResult = array_slice($finalResult, 0, 3);

// shop_imagesをusage別に一括取得
$fIds = array_column($finalResult, 'id');
if (!empty($fIds)) {
    $ph = implode(',', array_fill(0, count($fIds), '?'));
    $stmt = $pdo->prepare("SELECT shop_id, image_url, `usage` FROM shop_images WHERE shop_id IN ($ph) ORDER BY sort_order, id");
    $stmt->execute($fIds);
    $richMap = [];
    $stdMap = [];
    foreach ($stmt->fetchAll() as $row) {
        if ($row['usage'] === 'standard') {
            $stdMap[$row['shop_id']][] = $row['image_url'];
        } else {
            $richMap[$row['shop_id']][] = $row['image_url'];
        }
    }
    foreach ($finalResult as &$s) {
        $richImages = $richMap[$s['id']] ?? [];
        $s['images'] = ($s['banner_type'] === 'banner') ? array_slice($richImages, 0, 1) : $richImages;
        $s['standard_image'] = ($stdMap[$s['id']] ?? [null])[0] ?? null;
    }
}

echo json_encode(array_values($finalResult), JSON_UNESCAPED_UNICODE);
?>
