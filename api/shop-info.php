<?php
/**
 * shop-info.php — 店舗情報取得（MySQL版）
 * GET: ?shop_id=uuid
 */

header('Content-Type: application/json; charset=UTF-8');
// 2026-05-23: service_areas を含むため CF/ブラウザキャッシュを無効化 (店舗が更新した瞬間に反映).
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');

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

$shopId = $_GET['shop_id'] ?? null;
$slug = $_GET['slug'] ?? null;
if (!$shopId && !$slug) { http_response_code(400); echo json_encode(['error' => 'shop_id または slug は必須です']); exit; }

// サニタイズ
if ($shopId) $shopId = preg_replace('/[^a-zA-Z0-9\-]/', '', $shopId);
if ($slug) $slug = preg_replace('/[^a-z0-9\-]/', '', $slug);

// slug優先、なければshop_id
$where = $slug ? 's.slug = ?' : 's.id = ?';
$param = $slug ?: $shopId;

$stmt = $pdo->prepare("
    SELECT s.id, s.shop_name, s.gender_mode, s.shop_url, s.plan_id, s.status, s.slug,
           sc.plan_id AS sc_plan_id, cp.price
    FROM shops s
    LEFT JOIN shop_contracts sc ON s.id = sc.shop_id
    LEFT JOIN contract_plans cp ON sc.plan_id = cp.id
    WHERE {$where} AND s.status = 'active'
");
$stmt->execute([$param]);
$rows = $stmt->fetchAll();

if (empty($rows)) {
    http_response_code(404);
    echo json_encode(['error' => '店舗が見つかりません']);
    exit;
}

$shop = [
    'id' => $rows[0]['id'],
    'shop_name' => $rows[0]['shop_name'],
    'gender_mode' => $rows[0]['gender_mode'],
    'shop_url' => $rows[0]['shop_url'],
    'plan_id' => $rows[0]['plan_id'],
    'status' => $rows[0]['status'],
    'slug' => $rows[0]['slug'],
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

// 2026-05-21: 対応エリア (店舗専用ページのタグ表示 + メインエリア自動遷移用) を同梱.
$saStmt = $pdo->prepare(
    // 表示順は店舗が並べ替えた sort_order を最優先（メインエリアの並びを店舗管理から制御可能に）
    'SELECT id, pref, area, detail, city, label, is_primary, sort_order
     FROM shop_service_areas
     WHERE shop_id = ?
     ORDER BY sort_order ASC, id ASC'
);
$saStmt->execute([$shop['id']]);
$shop['service_areas'] = array_map(function($r) {
    return [
        'id'         => (int)$r['id'],
        'pref'       => $r['pref'],
        'area'       => $r['area'],
        'detail'     => $r['detail'],
        'city'       => $r['city'],
        'label'      => $r['label'],
        'is_primary' => (int)$r['is_primary'] === 1,
    ];
}, $saStmt->fetchAll(PDO::FETCH_ASSOC));

echo json_encode($shop, JSON_UNESCAPED_UNICODE);
?>
