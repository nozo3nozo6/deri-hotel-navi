<?php
/**
 * ads.php — 広告配置データ取得（MySQL版）
 * GET: ?type=placement_type&target=placement_target&mode=men
 */

header('Content-Type: application/json; charset=UTF-8');

$allowed_origins = ['https://yobuho.com', 'https://deli.yobuho.com', 'https://jofu.yobuho.com', 'https://same.yobuho.com', 'https://loveho.yobuho.com', 'https://este.yobuho.com'];
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
           s.catchphrase, s.description, s.pr_text, s.business_hours, s.min_price, s.approved_at, s.banner_type,
           COALESCE(rc.cnt, 0) + COALESCE(lrc.cnt, 0) AS report_count
    FROM ad_placements a
    LEFT JOIN shops s ON a.shop_id = s.id
    LEFT JOIN (
        SELECT shop_id, COUNT(*) AS cnt FROM reports WHERE poster_type = 'shop' GROUP BY shop_id
    ) rc ON rc.shop_id = a.shop_id
    LEFT JOIN (
        SELECT shop_id, COUNT(*) AS cnt
        FROM loveho_reports
        WHERE poster_type = 'shop' AND shop_id IS NOT NULL
        GROUP BY shop_id
    ) lrc ON lrc.shop_id = a.shop_id
    WHERE $whereStr
");
$stmt->execute($params);
$rows = $stmt->fetchAll();

// 有効な契約がある店舗IDを取得（期限内のみ）
$validShopIds = [];
if (!empty($rows)) {
    $allShopIds = array_unique(array_filter(array_column($rows, 'shop_id')));
    if (!empty($allShopIds)) {
        $ph = implode(',', array_fill(0, count($allShopIds), '?'));
        $scStmt = $pdo->prepare("SELECT DISTINCT shop_id FROM shop_contracts WHERE shop_id IN ($ph) AND plan_id > 1 AND (expires_at IS NULL OR expires_at >= CURDATE())");
        $scStmt->execute(array_values($allShopIds));
        $validShopIds = $scStmt->fetchAll(PDO::FETCH_COLUMN);
    }
}

// shops.status != 'active' または契約期限切れ を除外 + reshape
$filtered = [];
foreach ($rows as $row) {
    if ($row['shop_status'] !== 'active') continue;
    if (!in_array($row['shop_id'], $validShopIds)) continue;
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
            'description' => $row['description'],
            'pr_text' => $row['pr_text'],
            'business_hours' => $row['business_hours'],
            'min_price' => $row['min_price'],
            'banner_type' => $row['banner_type'],
        ],
    ];
    $ad['report_count'] = (int)($row['report_count'] ?? 0);
    $ad['approved_at'] = $row['approved_at'];
    $filtered[] = $ad;
}

// ソート: 口コミ投稿数多い順 → 同数なら掲載日早い順
usort($filtered, function($a, $b) {
    if ($b['report_count'] !== $a['report_count']) return $b['report_count'] - $a['report_count'];
    return strcmp($a['approved_at'] ?? '9999', $b['approved_at'] ?? '9999');
});

// 3件制限 + ランク付与（金銀銅）
$filtered = array_slice($filtered, 0, 3);
foreach ($filtered as $i => &$ad) {
    $ad['rank'] = $i + 1; // 1=金, 2=銀, 3=銅
}

// shop_imagesをusage別に一括取得
$shopIds = array_filter(array_column($filtered, 'shop_id'));
if (!empty($shopIds)) {
    $ph = implode(',', array_fill(0, count($shopIds), '?'));
    $stmt = $pdo->prepare("SELECT shop_id, image_url, `usage` FROM shop_images WHERE shop_id IN ($ph) ORDER BY sort_order, id");
    $stmt->execute(array_values($shopIds));
    $richMap = [];
    $stdMap = [];
    foreach ($stmt->fetchAll() as $row) {
        if ($row['usage'] === 'standard') {
            $stdMap[$row['shop_id']][] = $row['image_url'];
        } else {
            $richMap[$row['shop_id']][] = $row['image_url'];
        }
    }
    foreach ($filtered as &$ad) {
        $richImages = $richMap[$ad['shop_id']] ?? [];
        $ad['shops']['images'] = ($ad['shops']['banner_type'] === 'banner') ? array_slice($richImages, 0, 1) : $richImages;
        $ad['shops']['standard_image'] = ($stdMap[$ad['shop_id']] ?? [null])[0] ?? null;
    }
}

echo json_encode(array_values($filtered), JSON_UNESCAPED_UNICODE);
?>
