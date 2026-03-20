<?php
/**
 * generate-search-index.php — Fuse.js用検索インデックス生成（MySQL版）
 * Usage: php generate-search-index.php
 * Output: ../search-index.json
 */
require_once __DIR__ . '/db.php';
$pdo = DB::conn();
$root = dirname(__DIR__);

$stmt = $pdo->query("SELECT id, name, address, city, nearest_station, hotel_type FROM hotels WHERE is_published = 1");
$records = [];
while ($h = $stmt->fetch()) {
    $records[] = [
        'i' => (int)$h['id'],
        'n' => $h['name'],
        'a' => $h['address'] ?: '',
        'c' => $h['city'] ?: '',
        's' => $h['nearest_station'] ?: '',
        't' => $h['hotel_type'] ?: '',
    ];
}

$json = json_encode($records, JSON_UNESCAPED_UNICODE);
file_put_contents($root . '/search-index.json', $json);
$sizeMB = round(strlen($json) / 1024 / 1024, 2);
echo "Generated search-index.json: " . count($records) . " hotels, {$sizeMB} MB\n";
