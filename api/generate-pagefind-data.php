<?php
/**
 * generate-pagefind-data.php — Pagefindインデックス用データ生成
 * Usage: php api/generate-pagefind-data.php
 * Output: ../pagefind-data.json
 *
 * 各ホテルの基本情報 + gender_mode別レポート統計を出力
 * generate-pagefind-index.mjs がこのJSONからPagefindインデックスを生成
 */
require_once __DIR__ . '/db.php';
$pdo = DB::conn();
$root = dirname(__DIR__);

// 全ホテル基本情報
$stmt = $pdo->query("
    SELECT id, name, address, prefecture, city, major_area, detail_area,
           hotel_type, nearest_station
    FROM hotels
    WHERE is_published = 1
    ORDER BY id
");
$hotels = [];
while ($h = $stmt->fetch()) {
    $hotels[(int)$h['id']] = [
        'id'        => (int)$h['id'],
        'name'      => $h['name'],
        'address'   => $h['address'] ?: '',
        'pref'      => $h['prefecture'] ?: '',
        'city'      => $h['city'] ?: '',
        'area'      => $h['major_area'] ?: '',
        'detail'    => $h['detail_area'] ?: '',
        'type'      => $h['hotel_type'] ?: '',
        'station'   => $h['nearest_station'] ?: '',
        'modes'     => [],
    ];
}

// gender_mode別 can_call 集計（reportsテーブル）
$stmt = $pdo->query("
    SELECT hotel_id, gender_mode,
           SUM(CASE WHEN can_call = 1 THEN 1 ELSE 0 END) AS can_call_count,
           SUM(CASE WHEN can_call = 0 THEN 1 ELSE 0 END) AS cannot_call_count,
           COUNT(*) AS total
    FROM reports
    WHERE is_hidden = 0 AND gender_mode IS NOT NULL
    GROUP BY hotel_id, gender_mode
");
while ($r = $stmt->fetch()) {
    $hid = (int)$r['hotel_id'];
    if (!isset($hotels[$hid])) continue;
    $hotels[$hid]['modes'][$r['gender_mode']] = [
        'ok'    => (int)$r['can_call_count'],
        'ng'    => (int)$r['cannot_call_count'],
        'total' => (int)$r['total'],
    ];
}

// loveho_reports 件数集計（gender_mode別）
$stmt = $pdo->query("
    SELECT hotel_id, gender_mode, COUNT(*) AS cnt
    FROM loveho_reports
    WHERE is_hidden = 0 AND gender_mode IS NOT NULL
    GROUP BY hotel_id, gender_mode
");
while ($r = $stmt->fetch()) {
    $hid = (int)$r['hotel_id'];
    if (!isset($hotels[$hid])) continue;
    $mode = $r['gender_mode'];
    if (!isset($hotels[$hid]['modes'][$mode])) {
        $hotels[$hid]['modes'][$mode] = ['ok' => 0, 'ng' => 0, 'total' => 0];
    }
    $hotels[$hid]['modes'][$mode]['loveho'] = (int)$r['cnt'];
}

$result = [
    'generated' => gmdate('c'),
    'count'     => count($hotels),
    'hotels'    => array_values($hotels),
];

$json = json_encode($result, JSON_UNESCAPED_UNICODE);
$outPath = $root . '/pagefind-data.json';
file_put_contents($outPath, $json);
$sizeMB = round(strlen($json) / 1024 / 1024, 2);
echo "Generated pagefind-data.json: {$result['count']} hotels, {$sizeMB} MB\n";
