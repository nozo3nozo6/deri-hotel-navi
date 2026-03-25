<?php
/**
 * generate-area-data.php — エリアナビ用静的JSON生成（MySQL版）
 * Usage: php generate-area-data.php
 * Output: ../area-data.json
 *
 * 全件数はホテル+ラブホの合計、市区町村件数はスコープ（major_area/detail_area）固有
 */
require_once __DIR__ . '/db.php';
$pdo = DB::conn();
$root = dirname(__DIR__);

$PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','富山県','石川県','福井県','新潟県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];

function extractCity($address) {
    global $PREFS;
    if (!$address) return null;
    $addr = $address;
    foreach ($PREFS as $p) {
        if (str_starts_with($addr, $p)) { $addr = mb_substr($addr, mb_strlen($p)); break; }
    }
    if (preg_match('/^(.+?[市区町村郡])/u', $addr, $m)) return $m[1];
    return null;
}

function isLoveho($h) {
    return in_array($h['hotel_type'], ['love_hotel', 'rental_room']);
}

echo "Fetching hotels...\n";
$stmt = $pdo->query("SELECT prefecture, major_area, detail_area, city, address, hotel_type FROM hotels WHERE is_published = 1");
$hotels = $stmt->fetchAll();
echo "Fetched " . count($hotels) . " hotels\n";

// city正規化
foreach ($hotels as &$h) { if (!$h['city']) $h['city'] = extractCity($h['address']); }
unset($h);

// prefCounts（全タイプ合計）
$prefCounts = [];
foreach ($hotels as $h) {
    if ($h['prefecture']) $prefCounts[$h['prefecture']] = ($prefCounts[$h['prefecture']] ?? 0) + 1;
}

// pref -> areas + noArea（全タイプ合計）
$prefInfo = [];
foreach ($hotels as $h) {
    if (!$h['prefecture']) continue;
    if (!isset($prefInfo[$h['prefecture']])) $prefInfo[$h['prefecture']] = ['_areas' => [], '_noArea' => 0];
    if ($h['major_area']) {
        $prefInfo[$h['prefecture']]['_areas'][$h['major_area']] = ($prefInfo[$h['prefecture']]['_areas'][$h['major_area']] ?? 0) + 1;
    } else {
        $prefInfo[$h['prefecture']]['_noArea']++;
    }
}
$prefData = [];
foreach ($prefInfo as $p => $d) {
    $areas = [];
    foreach ($d['_areas'] as $a => $c) $areas[] = [$a, $c];
    usort($areas, fn($a, $b) => $b[1] - $a[1]);
    $prefData[$p] = ['areas' => $areas, 'hasNoArea' => $d['_noArea'] > 0];
}

// cityAreaCountMap: どのmajor_areaにその市が最も多いか判定用（全タイプ）
$cityAreaCountMap = [];
foreach ($hotels as $h) {
    if (!$h['prefecture'] || !$h['city'] || !$h['major_area']) continue;
    $cityAreaCountMap[$h['prefecture']][$h['city']][$h['major_area']] = ($cityAreaCountMap[$h['prefecture']][$h['city']][$h['major_area']] ?? 0) + 1;
}

// area data（全タイプでカウント）
$areaHotels = [];
foreach ($hotels as $h) {
    if (!$h['prefecture'] || !$h['major_area']) continue;
    $key = $h['prefecture'] . "\t" . $h['major_area'];
    $areaHotels[$key][] = $h;
}

$areaData = [];
foreach ($areaHotels as $key => $hotelList) {
    [$p, $ma] = explode("\t", $key);

    // detail_area件数（全タイプ合計）
    $daCounts = [];
    foreach ($hotelList as $h) {
        if ($h['detail_area'] && $h['detail_area'] !== $ma) {
            $daCounts[$h['detail_area']] = ($daCounts[$h['detail_area']] ?? 0) + 1;
        }
    }
    $detailAreas = [];
    foreach ($daCounts as $da => $c) $detailAreas[] = [$da, $c];
    usort($detailAreas, fn($a, $b) => $b[1] - $a[1]);

    // 市区町村件数（このmajor_area内でのカウント）
    $cityRegular = [];
    $cityLoveho = [];
    foreach ($hotelList as $h) {
        if (!$h['city']) continue;
        if (isLoveho($h)) {
            $cityLoveho[$h['city']] = ($cityLoveho[$h['city']] ?? 0) + 1;
        } else {
            $cityRegular[$h['city']] = ($cityRegular[$h['city']] ?? 0) + 1;
        }
    }

    // 表示フィルタ: このmajor_areaが最多のcityのみ表示
    $allCities = array_unique(array_merge(array_keys($cityRegular), array_keys($cityLoveho)));
    $displayCities = [];
    foreach ($allCities as $city) {
        $ac = $cityAreaCountMap[$p][$city] ?? null;
        if (!$ac) { $displayCities[] = $city; continue; }
        $maxCount = max($ac);
        $currentCount = $ac[$ma] ?? 0;
        if ($currentCount >= $maxCount) $displayCities[] = $city;
    }
    usort($displayCities, fn($a, $b) => (($cityRegular[$b] ?? 0) + ($cityLoveho[$b] ?? 0)) - (($cityRegular[$a] ?? 0) + ($cityLoveho[$a] ?? 0)));
    $cities = array_map(fn($city) => [$city, $cityRegular[$city] ?? 0, $cityLoveho[$city] ?? 0], $displayCities);

    $areaData[$key] = ['da' => $detailAreas, 'ct' => $cities];
}

// detail area data（全タイプ、スコープ固有カウント）
$daHotels = [];
foreach ($hotels as $h) {
    if (!$h['prefecture'] || !$h['major_area'] || !$h['detail_area']) continue;
    if ($h['detail_area'] === $h['major_area']) continue;
    $key = $h['prefecture'] . "\t" . $h['major_area'] . "\t" . $h['detail_area'];
    $daHotels[$key][] = $h;
}
$detailAreaData = [];
foreach ($daHotels as $key => $hotelList) {
    $cityRegular = [];
    $cityLoveho = [];
    foreach ($hotelList as $h) {
        if (!$h['city']) continue;
        if (isLoveho($h)) {
            $cityLoveho[$h['city']] = ($cityLoveho[$h['city']] ?? 0) + 1;
        } else {
            $cityRegular[$h['city']] = ($cityRegular[$h['city']] ?? 0) + 1;
        }
    }
    $allCities = array_unique(array_merge(array_keys($cityRegular), array_keys($cityLoveho)));
    usort($allCities, fn($a, $b) => (($cityRegular[$b] ?? 0) + ($cityLoveho[$b] ?? 0)) - (($cityRegular[$a] ?? 0) + ($cityLoveho[$a] ?? 0)));
    $cities = array_map(fn($city) => [$city, $cityRegular[$city] ?? 0, $cityLoveho[$city] ?? 0], $allCities);
    $detailAreaData[$key] = ['ct' => $cities];
}

// noArea（全タイプ）
$noAreaHotels = [];
$noAreaLoveho = [];
foreach ($hotels as $h) {
    if ($h['major_area'] || !$h['prefecture']) continue;
    $city = $h['city'] ?: 'unknown';
    if (isLoveho($h)) {
        $noAreaLoveho[$h['prefecture']][$city] = ($noAreaLoveho[$h['prefecture']][$city] ?? 0) + 1;
    } else {
        $noAreaHotels[$h['prefecture']][$city] = ($noAreaHotels[$h['prefecture']][$city] ?? 0) + 1;
    }
}
$noAreaData = [];
$allNoAreaPrefs = array_unique(array_merge(array_keys($noAreaHotels), array_keys($noAreaLoveho)));
foreach ($allNoAreaPrefs as $p) {
    $regCounts = $noAreaHotels[$p] ?? [];
    $lhCounts = $noAreaLoveho[$p] ?? [];
    $allCities = array_unique(array_merge(array_keys($regCounts), array_keys($lhCounts)));
    $cities = [];
    foreach ($allCities as $city) {
        $cities[] = [$city, $regCounts[$city] ?? 0, $lhCounts[$city] ?? 0];
    }
    usort($cities, fn($a, $b) => ($b[1] + $b[2]) - ($a[1] + $a[2]));
    $noAreaData[$p] = $cities;
}

$result = [
    'generated' => gmdate('c'),
    'prefCounts' => $prefCounts,
    'pref' => $prefData,
    'area' => $areaData,
    'da' => $detailAreaData,
    'noArea' => $noAreaData,
];

$json = json_encode($result, JSON_UNESCAPED_UNICODE);
file_put_contents($root . '/area-data.json', $json);
echo "Generated area-data.json (" . round(strlen($json) / 1024, 1) . " KB)\n";
