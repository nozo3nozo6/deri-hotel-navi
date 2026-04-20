<?php
/**
 * hotel-detail.php — ホテル詳細データ取得（MySQL版）
 * GET: ?hotel_id=123&type=hotel|loveho
 * Returns: hotel, reports, shop_info, summary, poster_shops
 */

header('Content-Type: application/json; charset=UTF-8');
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

$hotelId = $_GET['hotel_id'] ?? null;
$type = $_GET['type'] ?? 'hotel';

if (!$hotelId || !is_numeric($hotelId)) {
    http_response_code(400);
    echo json_encode(['error' => 'hotel_id は必須です（数値）']);
    exit;
}
$hotelId = (int)$hotelId;
if (!in_array($type, ['hotel', 'loveho'])) $type = 'hotel';

// ── ホテル情報 ──
$stmt = $pdo->prepare('SELECT * FROM hotels WHERE id = ? AND is_published = 1');
$stmt->execute([$hotelId]);
$hotelData = $stmt->fetch();

if (!$hotelData) {
    http_response_code(404);
    echo json_encode(['error' => 'ホテルが見つかりません']);
    exit;
}
$hotelData['is_published'] = (bool)$hotelData['is_published'];
$hotelData['is_edited'] = (bool)$hotelData['is_edited'];

// ── 口コミ取得 ──
$reportsTable = ($type === 'loveho') ? 'loveho_reports' : 'reports';
$stmt = $pdo->prepare("SELECT * FROM `$reportsTable` WHERE hotel_id = ? AND is_hidden = 0 ORDER BY created_at DESC LIMIT 50");
$stmt->execute([$hotelId]);
$reports = $stmt->fetchAll();

// JSON配列カラムをデコード
foreach ($reports as &$r) {
    if ($type === 'hotel') {
        if (isset($r['can_call_reasons'])) $r['can_call_reasons'] = DB::jsonDecode($r['can_call_reasons']);
        if (isset($r['cannot_call_reasons'])) $r['cannot_call_reasons'] = DB::jsonDecode($r['cannot_call_reasons']);
        $r['can_call'] = $r['can_call'] !== null ? (bool)$r['can_call'] : null;
        $r['multi_person'] = (bool)($r['multi_person'] ?? false);
    } else {
        if (isset($r['good_points'])) $r['good_points'] = DB::jsonDecode($r['good_points']);
        $r['multi_person'] = (bool)($r['multi_person'] ?? false);
    }
    $r['is_hidden'] = (bool)$r['is_hidden'];
}
unset($r);

// ── 店舗情報（shop_hotel_info + shops + shop_contracts + contract_plans） ──
$stmt = $pdo->prepare("
    SELECT shi.shop_id, shi.transport_fee, shi.can_call, shi.memo,
           s.id AS s_id, s.shop_name, s.shop_url, s.status,
           sc.plan_id, cp.price
    FROM shop_hotel_info shi
    JOIN shops s ON shi.shop_id = s.id
    LEFT JOIN shop_contracts sc ON s.id = sc.shop_id
    LEFT JOIN contract_plans cp ON sc.plan_id = cp.id
    WHERE shi.hotel_id = ?
");
$stmt->execute([$hotelId]);
$shopRows = $stmt->fetchAll();

// Supabase形式にreshape（shop_contracts→contract_plans ネスト）
$shopInfoMap = [];
foreach ($shopRows as $row) {
    $sid = $row['shop_id'];
    if (!isset($shopInfoMap[$sid])) {
        $shopInfoMap[$sid] = [
            'shop_id' => $sid,
            'transport_fee' => $row['transport_fee'],
            'can_call' => $row['can_call'] !== null ? (bool)$row['can_call'] : null,
            'memo' => $row['memo'],
            'shops' => [
                'id' => $row['s_id'],
                'shop_name' => $row['shop_name'],
                'shop_url' => $row['shop_url'],
                'status' => $row['status'],
                'shop_contracts' => [],
            ],
        ];
    }
    if ($row['plan_id'] !== null) {
        $shopInfoMap[$sid]['shops']['shop_contracts'][] = [
            'plan_id' => (int)$row['plan_id'],
            'contract_plans' => ['price' => (int)($row['price'] ?? 0)],
        ];
    }
}
$shopInfo = array_values($shopInfoMap);

// ── サマリー（ホテルタイプのみ） ──
$summary = null;
if ($type === 'hotel') {
    $stmt = $pdo->prepare('SELECT * FROM hotel_report_summary WHERE hotel_id = ?');
    $stmt->execute([$hotelId]);
    $summary = $stmt->fetch() ?: null;
    if ($summary) {
        $summary['total_reports'] = (int)$summary['total_reports'];
        $summary['user_can_call'] = (int)$summary['user_can_call'];
        $summary['user_cannot_call'] = (int)$summary['user_cannot_call'];
        $summary['shop_can_call'] = (int)$summary['shop_can_call'];
        $summary['shop_cannot_call'] = (int)$summary['shop_cannot_call'];
    }
}

// ── 投稿者店舗情報 ──
$posterShops = [];
if ($reports) {
    // shop_idで店舗を特定（shop_idのみ使用）
    $shopIds = [];
    foreach ($reports as $r) {
        if (($r['poster_type'] ?? '') === 'shop' || !empty($r['shop_id'])) {
            $shopIds[] = $r['shop_id'];
        }
    }
    $shopIds = array_unique($shopIds);

    if ($shopIds) {
        $ph1 = implode(',', array_fill(0, count($shopIds), '?'));
        $where = "s.id IN ($ph1)";
        $params = array_values($shopIds);
        $stmt = $pdo->prepare("
            SELECT s.id, s.shop_name, s.status, s.shop_url, s.plan_id,
                   sc.plan_id AS sc_plan_id, cp.price
            FROM shops s
            LEFT JOIN shop_contracts sc ON s.id = sc.shop_id
            LEFT JOIN contract_plans cp ON sc.plan_id = cp.id
            WHERE $where
        ");
        $stmt->execute($params);
        $psRows = $stmt->fetchAll();

        $psMap = [];
        foreach ($psRows as $row) {
            $sid = $row['id'];
            if (!isset($psMap[$sid])) {
                $psMap[$sid] = [
                    'id' => $row['id'],
                    'shop_name' => $row['shop_name'],
                    'status' => $row['status'],
                    'shop_url' => $row['shop_url'],
                    'plan_id' => $row['plan_id'],
                    'shop_contracts' => [],
                ];
            }
            if ($row['sc_plan_id'] !== null) {
                $psMap[$sid]['shop_contracts'][] = [
                    'plan_id' => (int)$row['sc_plan_id'],
                    'contract_plans' => ['price' => (int)($row['price'] ?? 0)],
                ];
            }
        }
        $posterShops = array_values($psMap);
    }
}

echo json_encode([
    'hotel'        => $hotelData,
    'reports'      => $reports,
    'shop_info'    => $shopInfo,
    'summary'      => $summary,
    'poster_shops' => $posterShops,
], JSON_UNESCAPED_UNICODE);
?>
