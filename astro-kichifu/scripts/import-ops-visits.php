<?php
// ==========================================================================
// scripts/import-ops-visits.php — 旧システムの利用履歴を ops_legacy_visits へ取り込む
//
//   使い方（CLI専用・サーバー上で実行）:
//     php import-ops-visits.php --dir=/tmp/legacy-csv            # dry-run（既定）
//     php import-ops-visits.php --dir=/tmp/legacy-csv --execute  # 本実行
//
//   必要CSV（--dir 内）:
//     trn_reserve.csv   予約本体（日時・キャスト・コース・金額・ホテル）
//     trn_income.csv    受注（income_id → customer_id の繋ぎ + 予約メモ）
//     mst_course.csv    コース名
//     mst_hotel.csv     ホテル名
//     mst_cast.csv      キャストID→名前（予約行の cast_name が空の時の補完のみ）
//
//   設計メモ:
//   - 顧客の紐付けは「trn_income.customer_id → ops_customers.notes の『旧ID:』」で行う。
//     2026-08-02 検証で 37,883件全件が紐付くことを確認済み。
//   - キャスト名は【予約行の cast_name（当時の源氏名）を優先】。マスタは改名後の
//     名前に管理メモが混ざる（例: 「ちとせ（ちなみ）NGありメモ確認」だが予約当時は「かすみ」）。
//     マスタで補完する時は先頭の名前部分だけ使う（（や空白で切る）。
//   - 金額は cash + card（実際の回収額）。コース料金の内訳合算より確実。
//   - stat: 9=completed(35,625) / 0=cancelled(1,789) / その他=other(469)
//   - 場所は hotel_id → mst_hotel（名前＋市区町村）。ホテル以外は place_id=1 が自宅。
//   - legacy_income_id UNIQUE + upsert なので、ルールを直して何度でも流し直せる。
//   - 実行後、ops_customers の visit_count / first_visit_at / last_visit_at を
//     completed 実績から再計算して上書きする。
// ==========================================================================
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { fwrite(STDERR, "CLI only\n"); exit(1); }

$opts = getopt('', ['dir:', 'execute']);
$dir = rtrim((string)($opts['dir'] ?? ''), '/');
$execute = array_key_exists('execute', $opts);
if ($dir === '' || !is_dir($dir)) { fwrite(STDERR, "--dir=CSVディレクトリ を指定\n"); exit(1); }

// scripts/ から実行しても /tmp から実行してもいいように、本番配置の db.php を直接見る
$dbCandidates = [
    __DIR__ . '/../ctrl/ops/api/db.php',
    '/home/yobuho/admi2888.com/public_html/ctrl/ops/api/db.php',
];
foreach ($dbCandidates as $c) if (is_file($c)) { require_once $c; break; }
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

echo "== CSV読み込み ==\n";
$reserve = csv_rows($dir . '/trn_reserve.csv');
$income  = csv_rows($dir . '/trn_income.csv');
$courses = csv_rows($dir . '/mst_course.csv');
$hotels  = csv_rows($dir . '/mst_hotel.csv');
$casts   = csv_rows($dir . '/mst_cast.csv');
printf("  reserve=%d income=%d course=%d hotel=%d cast=%d\n",
    count($reserve), count($income), count($courses), count($hotels), count($casts));

// ---- マップ構築
$incMap = [];   // income_id => [customer_id, memo, shop_id]
foreach ($income as $r) {
    $incMap[(int)$r['id']] = [(string)$r['customer_id'], trim((string)$r['memo']), (int)$r['shop_id']];
}

$courseMap = []; $courseMin = [];
foreach ($courses as $r) { $courseMap[(string)$r['id']] = trim((string)$r['name']); $courseMin[(string)$r['id']] = (int)$r['time']; }

$hotelMap = [];   // id => [name, city]
foreach ($hotels as $r) {
    $hotelMap[(string)$r['id']] = [trim((string)$r['name']), trim((string)($r['addr_1'] ?? ''))];
}

// キャスト: 先頭の名前部分のみ（（/空白/管理メモを除去）
$castMap = [];
foreach ($casts as $r) {
    $n = trim((string)$r['name']);
    if ($n === '') continue;
    $n = preg_split('/[（(\s　]/u', $n)[0];
    if ($n !== '') $castMap[(string)$r['id']] = $n;
}

// 旧顧客ID → ops_customers.id（notes の「旧ID:」から）
$legacyMap = [];
foreach ($pdo->query("SELECT id, notes FROM ops_customers WHERE notes LIKE '%旧ID:%'") as $r) {
    if (preg_match_all('/旧ID:(\d+)/u', (string)$r['notes'], $m)) {
        foreach ($m[1] as $lid) $legacyMap[$lid] = (int)$r['id'];
    }
}
echo '  旧ID→ops顧客: ' . count($legacyMap) . " 件\n";

// ---- 行構築
$rows = []; $skip = ['income' => 0, 'cust' => 0, 'date' => 0];
$statLabel = fn(string $s): string => $s === '9' ? 'completed' : ($s === '0' ? 'cancelled' : 'other');
foreach ($reserve as $r) {
    $iid = (int)$r['income_id'];
    if (!isset($incMap[$iid])) { $skip['income']++; continue; }
    [$cid, $memo, $shopId] = $incMap[$iid];
    if (!isset($legacyMap[$cid])) { $skip['cust']++; continue; }
    $d = (string)$r['playDate'];
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) || str_starts_with($d, '0000')) { $skip['date']++; continue; }
    $t = preg_match('/^\d{2}:\d{2}/', (string)$r['playTime']) ? substr((string)$r['playTime'], 0, 8) : '00:00:00';

    $castName = trim((string)$r['cast_name']);
    if ($castName === '' && isset($castMap[(string)$r['cast_id']])) $castName = $castMap[(string)$r['cast_id']];

    $courseName = $courseMap[(string)$r['course_id']] ?? '';
    if ((string)$r['courseEx_id'] !== '0' && (string)$r['courseEx_id'] !== '' && (int)$r['courseEx_cnt'] > 0) {
        $exName = $courseMap[(string)$r['courseEx_id']] ?? '延長';
        $courseName .= ($courseName !== '' ? ' + ' : '') . $exName . ((int)$r['courseEx_cnt'] > 1 ? '×' . (int)$r['courseEx_cnt'] : '');
    }

    $total = (int)$r['cash'] + (int)$r['card'];

    // 場所: hotel_id があればホテル。無ければ place_id で判定。
    //   place_id=1 は【自宅】。2026-08-02 検証: place_id=1 の 12,832件は 99% が顧客住所を
    //   持つ一方、ホテル利用 23,259件では 7% しか持たない＝自宅派遣で確定。
    //   place_id=2/3（38件）は用途不明なので「その他」。どちらも無い 1,754件は不明のまま。
    [$hotelName, $hotelCity] = $hotelMap[(string)$r['hotel_id']] ?? ['', ''];
    $pid = (string)$r['place_id'];
    if ($hotelName !== '') {
        $placeType = 'hotel';
    } elseif ($pid === '1') {
        $placeType = 'home';
    } elseif ($pid !== '' && $pid !== '0') {
        $placeType = 'other';
    } else {
        $placeType = 'unknown';
    }
    $memoParts = [];
    if ($memo !== '') $memoParts[] = $memo;
    if (trim((string)$r['adjust_memo']) !== '') $memoParts[] = '調整: ' . trim((string)$r['adjust_memo']);

    $rows[] = [
        'customer_id'      => $legacyMap[$cid],
        'visit_at'         => $d . ' ' . $t,
        'cast_name'        => mb_substr($castName, 0, 50),
        'course_name'      => mb_substr($courseName, 0, 100),
        'course_minutes'   => $courseMin[(string)$r['course_id']] ?? null,
        'total_price'      => $total,
        'hotel_name'       => mb_substr($hotelName, 0, 100),
        'hotel_city'       => mb_substr($hotelCity, 0, 40),
        'place_type'       => $placeType,
        'room'             => mb_substr(trim((string)$r['hotel_room']), 0, 20),
        'memo'             => implode("\n", $memoParts),
        'status'           => $statLabel((string)$r['stat']),
        // 店舗・指名は名称マスタ（mst_shop / mst_nominate）が未入手。IDだけ保全しておき、
        // マスタが届いたら表示名を付けるだけで済むようにする。
        'legacy_shop_id'     => $shopId,
        'legacy_nominate_id' => (int)$r['nominate_id'],
        'nominate_price'     => (int)$r['nominate_price'],
        'legacy_income_id' => $iid,
    ];
}
$byStatus = array_count_values(array_column($rows, 'status'));
printf("== 取り込み対象 %d 件（スキップ: income欠落=%d 顧客不明=%d 日付不正=%d）\n",
    count($rows), $skip['income'], $skip['cust'], $skip['date']);
print('   状態: ' . json_encode($byStatus, JSON_UNESCAPED_UNICODE) . "\n");
$byPlace = array_count_values(array_column($rows, 'place_type'));
echo '   場所: ' . json_encode($byPlace, JSON_UNESCAPED_UNICODE) . "\n";
$named = count(array_filter($rows, fn($x) => $x['cast_name'] !== ''));
printf("   キャスト名あり: %d / コース名あり: %d / メモあり: %d\n",
    $named,
    count(array_filter($rows, fn($x) => $x['course_name'] !== '')),
    count(array_filter($rows, fn($x) => $x['memo'] !== '')));

if (!$execute) {
    echo "\n[dry-run] --execute で本実行。サンプル3件:\n";
    foreach (array_slice($rows, 0, 3) as $x) echo '  ' . json_encode($x, JSON_UNESCAPED_UNICODE) . "\n";
    exit(0);
}

// ---- 本実行
$pdo->exec("CREATE TABLE IF NOT EXISTS ops_legacy_visits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    visit_at DATETIME NOT NULL,
    cast_name VARCHAR(50) NOT NULL DEFAULT '',
    course_name VARCHAR(100) NOT NULL DEFAULT '',
    course_minutes INT NULL,
    total_price INT NOT NULL DEFAULT 0,
    hotel_name VARCHAR(100) NOT NULL DEFAULT '',
    hotel_city VARCHAR(40) NOT NULL DEFAULT '',
    place_type VARCHAR(10) NOT NULL DEFAULT 'unknown',
    legacy_shop_id INT NOT NULL DEFAULT 0,
    legacy_nominate_id INT NOT NULL DEFAULT 0,
    nominate_price INT NOT NULL DEFAULT 0,
    room VARCHAR(20) NOT NULL DEFAULT '',
    memo TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    legacy_income_id INT NOT NULL,
    UNIQUE KEY uq_income (legacy_income_id),
    KEY idx_cust (customer_id, visit_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

// 既存テーブルに後から足した列を補う
$cols = $pdo->query('SHOW COLUMNS FROM ops_legacy_visits')->fetchAll(PDO::FETCH_COLUMN);
if (!in_array('hotel_city', $cols, true)) $pdo->exec("ALTER TABLE ops_legacy_visits ADD COLUMN hotel_city VARCHAR(40) NOT NULL DEFAULT '' AFTER hotel_name");
if (!in_array('place_type', $cols, true)) $pdo->exec("ALTER TABLE ops_legacy_visits ADD COLUMN place_type VARCHAR(10) NOT NULL DEFAULT 'unknown' AFTER hotel_city");
if (!in_array('legacy_shop_id', $cols, true)) $pdo->exec("ALTER TABLE ops_legacy_visits ADD COLUMN legacy_shop_id INT NOT NULL DEFAULT 0");
if (!in_array('legacy_nominate_id', $cols, true)) $pdo->exec("ALTER TABLE ops_legacy_visits ADD COLUMN legacy_nominate_id INT NOT NULL DEFAULT 0");
if (!in_array('nominate_price', $cols, true)) $pdo->exec("ALTER TABLE ops_legacy_visits ADD COLUMN nominate_price INT NOT NULL DEFAULT 0");

// 再実行で内容を更新できるよう upsert（取り込みルールを直したら流し直せる）
$ins = $pdo->prepare("INSERT INTO ops_legacy_visits
    (customer_id, visit_at, cast_name, course_name, course_minutes, total_price, hotel_name, hotel_city, place_type, room, memo, status,
     legacy_shop_id, legacy_nominate_id, nominate_price, legacy_income_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      customer_id=VALUES(customer_id), visit_at=VALUES(visit_at), cast_name=VALUES(cast_name),
      course_name=VALUES(course_name), course_minutes=VALUES(course_minutes), total_price=VALUES(total_price),
      hotel_name=VALUES(hotel_name), hotel_city=VALUES(hotel_city), place_type=VALUES(place_type),
      room=VALUES(room), memo=VALUES(memo), status=VALUES(status),
      legacy_shop_id=VALUES(legacy_shop_id), legacy_nominate_id=VALUES(legacy_nominate_id),
      nominate_price=VALUES(nominate_price)");
$pdo->beginTransaction();
$n = 0;
foreach ($rows as $x) {
    $ins->execute([
        $x['customer_id'], $x['visit_at'], $x['cast_name'], $x['course_name'], $x['course_minutes'],
        $x['total_price'], $x['hotel_name'], $x['hotel_city'], $x['place_type'], $x['room'],
        $x['memo'], $x['status'], $x['legacy_shop_id'], $x['legacy_nominate_id'], $x['nominate_price'],
        $x['legacy_income_id'],
    ]);
    $n += $ins->rowCount();
}
$pdo->commit();
// rowCount: 新規=1 / 更新=2 / 同値=0 なので件数そのものではなく処理数を出す
echo '処理: ' . count($rows) . " 件（DB反映 {$n}）\n";

// ---- 顧客の visit_count / first / last を completed 実績で再計算
echo "== 顧客統計を再計算 ==\n";
$pdo->exec("UPDATE ops_customers c
    JOIN (SELECT customer_id, COUNT(*) cnt, MIN(visit_at) f, MAX(visit_at) l
            FROM ops_legacy_visits WHERE status='completed' GROUP BY customer_id) v
      ON v.customer_id = c.id
     SET c.visit_count = v.cnt,
         c.first_visit_at = LEAST(COALESCE(c.first_visit_at, v.f), v.f),
         c.last_visit_at  = GREATEST(COALESCE(c.last_visit_at, v.l), v.l)");
echo "完了\n";
