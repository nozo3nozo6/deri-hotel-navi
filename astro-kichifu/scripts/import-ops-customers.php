<?php
// ==========================================================================
// import-ops-customers.php — 旧オペレーション(mst_customer.csv) → ops_customers 取込
//
//   使い方（サーバーCLI・web非公開の場所から実行）:
//     php import-ops-customers.php /path/to/mst_customer.csv           # dry-run
//     php import-ops-customers.php /path/to/mst_customer.csv --commit  # 本実行
//
//   マッピング:
//     name→name（空は「（名前未登録）」）/ tel→phone(数字のみ) / mail→email
//     use_cnt→visit_count / firstReserveDate→first_visit_at / lastReserveDate→last_visit_at
//     addr_0..3→default_location / memo→notes
//   旧システム固有の値（旧ID・媒体・旧ポイント・stat・member・第2住所）は
//   意味の判断をせず notes 末尾に「旧システム移行」ブロックとして保全する。
//   （stat=99 はNGではない: メモ内容は通常客。意味不明なフラグで挙動を変えない）
//
//   電話番号重複（1,069組）は同一人物とみなし1件に統合:
//     代表 = use_cnt最大 → lastReserveDate最新 → id最大
//     visit_count は合算、first/last は群全体の min/max、他行の名前・メモは notes へ
//   phone は予約モーダルの顧客照合キーなので、重複したまま入れると照合が曖昧になる。
// ==========================================================================
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

$csvPath = $argv[1] ?? '';
$commit  = in_array('--commit', $argv, true);
if ($csvPath === '' || !is_file($csvPath)) { fwrite(STDERR, "CSVが見つかりません: {$csvPath}\n"); exit(1); }

require __DIR__ . '/api/db.php';   // scp時に api/db.php と同階層構成にするか、下のフォールバックで解決
if (!function_exists('getPdo')) { fwrite(STDERR, "db.php が読めていません\n"); exit(1); }

$fh = fopen($csvPath, 'r');
$header = fgetcsv($fh);
$idx = array_flip($header);
$col = fn(array $row, string $k): string => trim((string)($row[$idx[$k]] ?? ''));

$normPhone = fn(string $t): string => preg_replace('/\D+/', '', $t) ?? '';
$normDate  = function (string $d): ?string {
    if ($d === '' || str_starts_with($d, '0000')) return null;
    $ts = strtotime($d);
    return $ts ? date('Y-m-d 00:00:00', $ts) : null;
};

// ---- 全行読み込み → 電話番号でグループ化 ----
$all = [];
while (($row = fgetcsv($fh)) !== false) {
    if (count($row) < count($header)) continue;
    $all[] = $row;
}
fclose($fh);

$byPhone = [];   // phone => rows / 電話なしは単独扱い（キー: "noph:{旧id}"）
foreach ($all as $row) {
    $p = $normPhone($col($row, 'tel'));
    $key = $p !== '' ? $p : 'noph:' . $col($row, 'id');
    $byPhone[$key][] = $row;
}

$legacyLine = function (array $row) use ($col): string {
    $parts = ['旧ID:' . $col($row, 'id')];
    if ($col($row, 'media1_str') !== '') $parts[] = '媒体:' . $col($row, 'media1_str');
    if ((int)$col($row, 'point') > 0)    $parts[] = '旧ポイント:' . number_format((int)$col($row, 'point'));
    if ($col($row, 'stat') !== '1')      $parts[] = 'stat:' . $col($row, 'stat');
    if ($col($row, 'member') !== '')     $parts[] = 'member:' . $col($row, 'member');
    $addr2 = implode('', array_filter([$col($row, 'addr2_0'), $col($row, 'addr2_1'), $col($row, 'addr2_2'), $col($row, 'addr2_3')]));
    if ($addr2 !== '') $parts[] = '第2住所:' . $addr2;
    if ($col($row, 'mail') !== '') $parts[] = 'メール:' . $col($row, 'mail');
    return implode(' / ', $parts);
};

$records = [];
foreach ($byPhone as $key => $rows) {
    $key = (string)$key;   // 数字のみのキーはPHPが整数化するため戻す
    // 代表行: use_cnt最大 → lastReserveDate最新 → 旧id最大
    usort($rows, function ($a, $b) use ($col) {
        $d = (int)$col($b, 'use_cnt') <=> (int)$col($a, 'use_cnt');
        if ($d !== 0) return $d;
        $d = strcmp($col($b, 'lastReserveDate'), $col($a, 'lastReserveDate'));
        if ($d !== 0) return $d;
        return (int)$col($b, 'id') <=> (int)$col($a, 'id');
    });
    $main = $rows[0];

    $name = $col($main, 'name');
    if ($name === '') {
        foreach ($rows as $r) { if ($col($r, 'name') !== '') { $name = $col($r, 'name'); break; } }
    }
    if ($name === '') $name = '（名前未登録）';

    $visit = 0; $first = null; $last = null;
    foreach ($rows as $r) {
        $visit += (int)$col($r, 'use_cnt');
        foreach ([['firstReserveDate', &$first, 'min'], ['lastReserveDate', &$last, 'max']] as [$k, &$ref, $mode]) {
            $d = $r[$idx[$k]] ?? '';
            if ($d === '' || str_starts_with($d, '0000')) continue;
            if ($ref === null || ($mode === 'min' ? $d < $ref : $d > $ref)) $ref = $d;
        }
        unset($ref);
    }

    $addr = implode('', array_filter([$col($main, 'addr_0'), $col($main, 'addr_1'), $col($main, 'addr_2'), $col($main, 'addr_3')]));

    // notes: 代表メモ → 統合された別行 → 旧システム行
    $notesParts = [];
    if ($col($main, 'memo') !== '') $notesParts[] = $col($main, 'memo');
    foreach (array_slice($rows, 1) as $r) {
        $sub = array_filter([
            $col($r, 'name') !== '' && $col($r, 'name') !== $name ? '名義:' . $col($r, 'name') : '',
            $col($r, 'memo'),
            $legacyLine($r),
        ]);
        $notesParts[] = '【同番号の別登録を統合】' . implode(' / ', $sub);
    }
    $notesParts[] = '─ 旧システム移行 ' . date('Y-m-d') . ' ─ ' . $legacyLine($main);

    $records[] = [
        'name'            => mb_substr($name, 0, 100),
        'phone'           => str_starts_with($key, 'noph:') ? null : $key,
        'email'           => $col($main, 'mail') ?: null,
        'default_location'=> $addr !== '' ? mb_substr($addr, 0, 200) : null,
        'notes'           => implode("\n", $notesParts),
        'first_visit_at'  => $first ? $first . ' 00:00:00' : null,
        'last_visit_at'   => $last ? $last . ' 00:00:00' : null,
        'visit_count'     => $visit,
    ];
}

printf("CSV %d行 → 統合後 %d件（電話重複の統合 %d件）\n", count($all), count($records), count($all) - count($records));
$withVisit = count(array_filter($records, fn($r) => $r['visit_count'] > 0));
printf("利用実績あり: %d件 / 電話なし: %d件\n", $withVisit, count(array_filter($records, fn($r) => $r['phone'] === null)));

if (!$commit) { echo "dry-run（--commit で書き込み）\n"; exit; }

$pdo = getPdo();
$dup = (int)$pdo->query('SELECT COUNT(*) FROM ops_customers')->fetchColumn();
if ($dup > 0) { fwrite(STDERR, "ops_customers が空ではありません（{$dup}件）。二重取込を避けるため中止します。\n"); exit(1); }

$pdo->beginTransaction();
$st = $pdo->prepare('INSERT INTO ops_customers
    (name, phone, email, default_location, notes, first_visit_at, last_visit_at, visit_count)
    VALUES (?,?,?,?,?,?,?,?)');
$n = 0;
foreach ($records as $r) {
    $st->execute([$r['name'], $r['phone'], $r['email'], $r['default_location'], $r['notes'],
                  $r['first_visit_at'], $r['last_visit_at'], $r['visit_count']]);
    if ((++$n % 5000) === 0) echo "  {$n}件…\n";
}
$pdo->commit();
echo "完了: {$n}件を取込\n";
