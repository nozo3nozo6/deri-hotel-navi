<?php
// ==========================================================================
// scripts/import-ops-hotels.php — 旧システムのホテル一覧を ops_hotels へ取り込む
//
//   使い方（CLI専用・サーバー上で実行）:
//     php import-ops-hotels.php --dir=/tmp/legacy-csv                  # dry-run
//     php import-ops-hotels.php --dir=/tmp/legacy-csv --execute        # 住所ありの区分1のみ
//     php import-ops-hotels.php --dir=/tmp/legacy-csv --execute --with-kubun2 --with-no-address
//
//   なぜ必要か:
//     ops_hotels の元データ（179件）はビジネス・シティホテル中心で、実際に案内している
//     ラブホ・レンタルルームがほぼ入っていなかった（CSV 397件のうち一致はわずか14件）。
//     利用履歴の上位（シティ1,626回・ニューポート864回…）が全部未登録の状態。
//
//   設計メモ:
//   - 名前末尾の「1100円」等は交通費の目安を名前に書き込んだもの。名前からは外し、
//     ops_ylka_hotel_info.transport_fee に入れる（ホテルを選んだ時の初期値に使える）。
//     ただし実績を見ると同じホテルでも回ごとに0円〜2,200円と揺れるので、あくまで目安。
//   - stat=99（45件）は旧システム上の削除済み。取り込まない。
//   - 既存との重複判定は「ホテル/空白/末尾の金額を落として小文字化」した名前で行う。
//   - source='legacy' を付けるので、取り消したい時は source で絞って消せる。
//   - 再実行しても既存分は触らない（名前一致でスキップ）。
// ==========================================================================
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { fwrite(STDERR, "CLI only\n"); exit(1); }

$opts = getopt('', ['dir:', 'execute', 'with-kubun2', 'with-no-address']);
$dir = rtrim((string)($opts['dir'] ?? ''), '/');
$execute       = array_key_exists('execute', $opts);
$withKubun2    = array_key_exists('with-kubun2', $opts);
$withNoAddress = array_key_exists('with-no-address', $opts);
if ($dir === '' || !is_dir($dir)) { fwrite(STDERR, "--dir=CSVディレクトリ を指定\n"); exit(1); }

foreach ([__DIR__ . '/../ctrl/ops/api/db.php', '/home/yobuho/admi2888.com/public_html/ctrl/ops/api/db.php'] as $c) {
    if (is_file($c)) { require_once $c; break; }
}
if (!function_exists('getPdo')) { fwrite(STDERR, "db.php が見つからない\n"); exit(1); }
$pdo = getPdo();

function csv_rows(string $path): array {
    $raw = file_get_contents($path);
    if ($raw === false) { fwrite(STDERR, "読めない: {$path}\n"); exit(1); }
    if (!mb_check_encoding($raw, 'UTF-8')) $raw = mb_convert_encoding($raw, 'UTF-8', 'CP932');
    $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw);
    $fh = fopen('php://memory', 'r+'); fwrite($fh, $raw); rewind($fh);
    $hdr = fgetcsv($fh);
    $rows = [];
    while (($r = fgetcsv($fh)) !== false) {
        if (count($r) < count($hdr)) continue;
        $rows[] = array_combine($hdr, array_slice($r, 0, count($hdr)));
    }
    fclose($fh);
    return $rows;
}

/** 重複判定用の名前正規化（ホテル/空白/末尾の金額を落として小文字化） */
function hnorm(string $s): string {
    $s = preg_replace('/[ 　]*[0-9]{3,5}円[ 　]*$/u', '', trim($s)) ?? '';
    $s = str_replace(['ホテル', ' ', '　'], '', $s);
    return mb_strtolower(mb_convert_kana($s, 'a'));
}

$hotels = csv_rows($dir . '/mst_hotel.csv');
echo '== CSV ' . count($hotels) . " 件 ==\n";

// 既存（名前正規化 → id）
$exists = [];
foreach ($pdo->query('SELECT id, name FROM ops_hotels') as $r) $exists[hnorm((string)$r['name'])] = (int)$r['id'];
echo '  既存 ops_hotels: ' . count($exists) . " 件\n";

$rows = []; $skip = ['deleted' => 0, 'dup' => 0, 'kubun2' => 0, 'noaddr' => 0, 'empty' => 0];
$seen = [];
foreach ($hotels as $h) {
    if ((string)$h['stat'] === '99') { $skip['deleted']++; continue; }

    $raw = trim((string)$h['name']);
    if ($raw === '') { $skip['empty']++; continue; }
    // 名前末尾の金額＝交通費。名前からは外して別に持つ
    $fee = preg_match('/[ 　]*([0-9]{3,5})円[ 　]*$/u', $raw, $m) ? (int)$m[1] : null;
    $name = trim((string)preg_replace('/[ 　]*[0-9]{3,5}円[ 　]*$/u', '', $raw));
    if ($name === '') { $skip['empty']++; continue; }

    $key = hnorm($raw);
    if (isset($exists[$key]) || isset($seen[$key])) { $skip['dup']++; continue; }

    $city = trim((string)($h['addr_1'] ?? ''));
    $kubun = (string)$h['kubun'];
    if ($kubun === '2' && !$withKubun2)   { $skip['kubun2']++; continue; }
    if ($city === '' && !$withNoAddress)  { $skip['noaddr']++; continue; }

    $seen[$key] = true;
    $addr = implode('', array_filter([
        trim((string)($h['addr_0'] ?? '')), $city,
        trim((string)($h['addr_2'] ?? '')), trim((string)($h['addr_3'] ?? '')),
    ]));
    $rows[] = [
        'name'    => mb_substr($name, 0, 255),
        'address' => mb_substr($addr, 0, 500),
        'pref'    => mb_substr(trim((string)($h['addr_0'] ?? '')) ?: '東京都', 0, 10),
        'city'    => mb_substr($city, 0, 50),
        'tel'     => mb_substr(preg_replace('/[^0-9\-]/', '', (string)($h['tel'] ?? '')) ?? '', 0, 30),
        'lat'     => ((float)($h['map_lat'] ?? 0)) ?: null,
        'lng'     => ((float)($h['map_lng'] ?? 0)) ?: null,
        'fee'     => $fee,
        'kubun'   => $kubun,
    ];
}

$withFee = count(array_filter($rows, fn($r) => $r['fee'] !== null));
printf("== 取り込み対象 %d 件（交通費あり %d 件）\n", count($rows), $withFee);
echo '   スキップ: 削除済' . $skip['deleted'] . ' / 既存重複' . $skip['dup']
   . ' / 区分2(吉祥寺方面)' . $skip['kubun2'] . ' / 住所なし' . $skip['noaddr'] . ' / 名前空' . $skip['empty'] . "\n";

if (!$execute) {
    echo "\n[dry-run] --execute で本実行。先頭5件:\n";
    foreach (array_slice($rows, 0, 5) as $r) {
        echo '  ' . $r['name'] . ' / ' . $r['city'] . ' / 交通費' . ($r['fee'] === null ? 'なし' : '¥' . number_format($r['fee'])) . "\n";
    }
    exit(0);
}

$ins = $pdo->prepare("INSERT INTO ops_hotels
    (name, address, prefecture, city, hotel_type, source, tel, latitude, longitude, is_published, created_at, updated_at)
    VALUES (?,?,?,?,'love_hotel','legacy',?,?,?,1,NOW(),NOW())");
$insInfo = $pdo->prepare('INSERT INTO ops_ylka_hotel_info (hotel_id, transport_fee, updated_at) VALUES (?,?,NOW())
                          ON DUPLICATE KEY UPDATE transport_fee = VALUES(transport_fee)');
$pdo->beginTransaction();
$n = 0; $f = 0;
foreach ($rows as $r) {
    $ins->execute([$r['name'], $r['address'], $r['pref'], $r['city'], $r['tel'] ?: null, $r['lat'], $r['lng']]);
    $id = (int)$pdo->lastInsertId();
    $n++;
    if ($r['fee'] !== null) { $insInfo->execute([$id, $r['fee']]); $f++; }
}
$pdo->commit();
echo "追加: {$n} 件（うち交通費を登録 {$f} 件）\n";
