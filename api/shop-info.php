<?php
/**
 * shop-info.php — 店舗情報取得（MySQL版）
 * GET: ?shop_id=uuid
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

$shopId = $_GET['shop_id'] ?? null;
if (!$shopId) { http_response_code(400); echo json_encode(['error' => 'shop_id は必須です']); exit; }

// UUID形式サニタイズ
$shopId = preg_replace('/[^a-zA-Z0-9\-]/', '', $shopId);

$stmt = $pdo->prepare("
    SELECT s.shop_name, s.gender_mode, s.shop_url, s.plan_id, s.status,
           sc.plan_id AS sc_plan_id, cp.price
    FROM shops s
    LEFT JOIN shop_contracts sc ON s.id = sc.shop_id
    LEFT JOIN contract_plans cp ON sc.plan_id = cp.id
    WHERE s.id = ? AND s.status = 'active'
");
$stmt->execute([$shopId]);
$rows = $stmt->fetchAll();

if (empty($rows)) {
    http_response_code(404);
    echo json_encode(['error' => '店舗が見つかりません']);
    exit;
}

// Supabase形式にreshape
$shop = [
    'shop_name' => $rows[0]['shop_name'],
    'gender_mode' => $rows[0]['gender_mode'],
    'shop_url' => $rows[0]['shop_url'],
    'plan_id' => $rows[0]['plan_id'],
    'status' => $rows[0]['status'],
    'shop_contracts' => [],
];
foreach ($rows as $row) {
    if ($row['sc_plan_id'] !== null) {
        $shop['shop_contracts'][] = [
            'plan_id' => (int)$row['sc_plan_id'],
            'contract_plans' => ['price' => (int)($row['price'] ?? 0)],
        ];
    }
}

echo json_encode($shop, JSON_UNESCAPED_UNICODE);
?>
