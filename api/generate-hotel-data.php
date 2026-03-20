<?php
/**
 * generate-hotel-data.php — 都道府県別ホテルデータ静的JSON生成（MySQL版）
 * Usage: php generate-hotel-data.php
 * Output: ../hotel-data/{prefecture}.json + ../hotel-data/index.json
 */
require_once __DIR__ . '/db.php';
$pdo = DB::conn();
$root = dirname(__DIR__);
$outDir = $root . '/hotel-data';

if (!is_dir($outDir)) mkdir($outDir, 0755, true);

$cols = 'id, name, address, prefecture, city, major_area, detail_area, hotel_type, source, review_average, min_charge, nearest_station, postal_code, tel, latitude, longitude';
$stmt = $pdo->query("SELECT $cols FROM hotels WHERE is_published = 1 ORDER BY prefecture, id");
$allHotels = $stmt->fetchAll();

echo "Total: " . count($allHotels) . " hotels\n";

// Group by prefecture
$byPref = [];
foreach ($allHotels as $h) {
    $pref = $h['prefecture'] ?: 'unknown';
    $byPref[$pref][] = $h;
}

ksort($byPref);
$index = [];
$totalSize = 0;

foreach ($byPref as $pref => $hotels) {
    $hotelCount = 0;
    $lovehoCount = 0;
    $records = [];
    foreach ($hotels as $h) {
        $isLoveho = in_array($h['hotel_type'], ['love_hotel', 'rental_room']);
        if ($isLoveho) $lovehoCount++; else $hotelCount++;
        // Remove prefecture from each record
        unset($h['prefecture']);
        // Cast numeric types
        $h['id'] = (int)$h['id'];
        if ($h['review_average'] !== null) $h['review_average'] = (float)$h['review_average'];
        if ($h['min_charge'] !== null) $h['min_charge'] = (int)$h['min_charge'];
        if ($h['latitude'] !== null) $h['latitude'] = (float)$h['latitude'];
        if ($h['longitude'] !== null) $h['longitude'] = (float)$h['longitude'];
        $records[] = $h;
    }

    $json = json_encode($records, JSON_UNESCAPED_UNICODE);
    file_put_contents($outDir . '/' . $pref . '.json', $json);
    $sizeKB = round(strlen($json) / 1024, 1);
    $totalSize += strlen($json);
    echo "  {$pref}: " . count($hotels) . " ({$hotelCount} + {$lovehoCount} loveho) — {$sizeKB} KB\n";

    $index[] = [
        'prefecture' => $pref,
        'total' => count($hotels),
        'hotel_count' => $hotelCount,
        'loveho_count' => $lovehoCount,
    ];
}

$totalRegular = array_sum(array_column($index, 'hotel_count'));
$totalLoveho = array_sum(array_column($index, 'loveho_count'));
$indexJson = json_encode([
    'generated' => gmdate('c'),
    'total_hotels' => count($allHotels),
    'total_regular' => $totalRegular,
    'total_loveho' => $totalLoveho,
    'prefectures' => $index,
], JSON_UNESCAPED_UNICODE);
file_put_contents($outDir . '/index.json', $indexJson);
$totalSize += strlen($indexJson);

echo "\n=== Summary ===\n";
echo "Total: " . count($allHotels) . " (Regular: {$totalRegular}, Loveho: {$totalLoveho})\n";
echo "Files: " . count($byPref) . " prefectures\n";
echo "Size: " . round($totalSize / 1024 / 1024, 2) . " MB\n";
