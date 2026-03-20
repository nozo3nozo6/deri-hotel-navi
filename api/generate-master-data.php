<?php
/**
 * generate-master-data.php — マスタデータ静的JSON生成（MySQL版）
 * Usage: php generate-master-data.php
 * Output: ../master-data.json
 */
require_once __DIR__ . '/db.php';
$pdo = DB::conn();
$root = dirname(__DIR__);

$canCall = $pdo->query("SELECT label FROM can_call_reasons ORDER BY sort_order")->fetchAll(PDO::FETCH_COLUMN);
$cannotCall = $pdo->query("SELECT label FROM cannot_call_reasons ORDER BY sort_order")->fetchAll(PDO::FETCH_COLUMN);
$roomTypes = $pdo->query("SELECT label FROM room_types ORDER BY sort_order")->fetchAll(PDO::FETCH_COLUMN);
$atmospheres = $pdo->query("SELECT name FROM loveho_atmospheres ORDER BY sort_order")->fetchAll(PDO::FETCH_COLUMN);
$goodPoints = $pdo->query("SELECT label, category FROM loveho_good_points WHERE is_active = 1 ORDER BY sort_order")->fetchAll();
$lhRoomTypes = $pdo->query("SELECT name FROM loveho_room_types ORDER BY sort_order")->fetchAll(PDO::FETCH_COLUMN);
$facilities = $pdo->query("SELECT name FROM loveho_facilities ORDER BY sort_order")->fetchAll(PDO::FETCH_COLUMN);
$priceRanges = $pdo->query("SELECT name, type FROM loveho_price_ranges ORDER BY sort_order")->fetchAll();
$timeSlots = $pdo->query("SELECT name FROM loveho_time_slots ORDER BY sort_order")->fetchAll(PDO::FETCH_COLUMN);
$shopServiceOptions = $pdo->query("SELECT id, name FROM shop_service_options WHERE is_active = 1 ORDER BY sort_order")->fetchAll();

$masterData = [
    'can_call_reasons' => $canCall,
    'cannot_call_reasons' => $cannotCall,
    'room_types' => $roomTypes,
    'loveho' => [
        'atmospheres' => $atmospheres,
        'good_points' => $goodPoints,
        'room_types' => $lhRoomTypes,
        'facilities' => $facilities,
        'price_ranges_rest' => array_values(array_map(fn($r) => $r['name'], array_filter($priceRanges, fn($r) => $r['type'] === 'rest'))),
        'price_ranges_stay' => array_values(array_map(fn($r) => $r['name'], array_filter($priceRanges, fn($r) => $r['type'] === 'stay'))),
        'time_slots' => $timeSlots,
    ],
    'shop_service_options' => $shopServiceOptions,
    'generated_at' => gmdate('c'),
];

$json = json_encode($masterData, JSON_UNESCAPED_UNICODE);
file_put_contents($root . '/master-data.json', $json);
$size = round(strlen($json) / 1024, 1);
echo "master-data.json generated ({$size}KB)\n";
echo "  can_call_reasons: " . count($canCall) . "\n";
echo "  cannot_call_reasons: " . count($cannotCall) . "\n";
echo "  room_types: " . count($roomTypes) . "\n";
echo "  atmospheres: " . count($atmospheres) . "\n";
echo "  good_points: " . count($goodPoints) . "\n";
echo "  shop_service_options: " . count($shopServiceOptions) . "\n";
