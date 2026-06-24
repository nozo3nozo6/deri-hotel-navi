<?php
// ==========================================================================
// import-admi-schedules.php — admi2888.com の週間出勤を kichifu schedules に取込
//   admi の各日(?date=YYYY-MM-DD)の出勤リストを「正」として同期する。
//   女性は name で kichifu girls にマッチング（同名複数は安全側でスキップ）。
//   使い方（サーバー上 / cron）:
//     php import-admi-schedules.php            … 本番反映
//     php import-admi-schedules.php --dry-run  … DB変更せず結果だけ表示
//     php import-admi-schedules.php --days=7   … 取込日数（既定7、今日から）
// ==========================================================================
require_once __DIR__ . '/db.php';

// Web からの直アクセス禁止（cron / CLI 専用）
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }

date_default_timezone_set('Asia/Tokyo');

$DRY     = in_array('--dry-run', $argv, true);
$SHOP_IDS = [1, 2]; // 両店(1=立川/2=吉祥寺)へ同内容で書込＝出勤を両フロント同期
$DAYS    = 7;
foreach ($argv as $a) { if (preg_match('/^--days=(\d+)$/', $a, $m)) $DAYS = max(1, (int)$m[1]); }

$ADMI = 'https://admi2888.com/schedules';

function fetchHtml(string $url): ?string {
    $ctx = stream_context_create(['http' => ['timeout' => 20, 'user_agent' => 'kichifu-schedule-sync']]);
    $h = @file_get_contents($url, false, $ctx);
    return $h === false ? null : $h;
}

// 在籍 girls の name → id（共有プール全員。同名は除外フラグ）
$pdo  = DB::conn();
$rows = $pdo->query('SELECT id, name FROM girls');
$nameToId = [];
$dupNames = [];
foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $n = $r['name'];
    if (isset($nameToId[$n])) { $dupNames[$n] = true; }
    else { $nameToId[$n] = (int)$r['id']; }
}

$up = $pdo->prepare(
    'INSERT INTO schedules (shop_id, girl_id, work_date, start_time, end_time, status)
     VALUES (:shop, :girl, :date, :start, :end, \'work\')
     ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), end_time = VALUES(end_time),
                             status = \'work\', modified = NOW()'
);

$sum = ['days' => 0, 'parsed' => 0, 'matched' => 0, 'upserted' => 0, 'removed' => 0, 'unmatched' => [], 'dup' => []];

$baseTs = time() - 5 * 3600; // 営業日は朝5時区切り（5時前は前日を当日扱い）
for ($i = 0; $i < $DAYS; $i++) {
    $date = date('Y-m-d', $baseTs + $i * 86400);
    $html = fetchHtml("$ADMI?date=$date");
    if ($html === null) { fwrite(STDERR, "fetch失敗: $date\n"); continue; }
    $sum['days']++;

    $doc = new DOMDocument();
    @$doc->loadHTML('<?xml encoding="UTF-8">' . $html);
    $xp  = new DOMXPath($doc);
    $lis = $xp->query('//li[p[@class="name"]]'); // p.name を直接子に持つ li = 出勤女性

    $admiIds = []; // この日 admi に出ている girl_id（同期削除の除外リスト）
    foreach ($lis as $li) {
        $nameNode = $xp->query('.//p[@class="name"]/text()[1]', $li)->item(0);
        if (!$nameNode) continue;
        $name = trim($nameNode->nodeValue);
        if ($name === '') continue;
        $sum['parsed']++;

        $timeNode = $xp->query('.//p[@class="time"]', $li)->item(0);
        $timeStr  = $timeNode ? trim($timeNode->textContent) : '';
        $start = $end = null;
        // 「19:00～翌4:00」「10:00～19:00」(～は全角/半角/〜を許容、翌は除去)
        if (preg_match('/(\d{1,2}:\d{2})\s*[～〜~\-]\s*(?:翌)?\s*(\d{1,2}:\d{2})/u', $timeStr, $m)) {
            $start = $m[1]; $end = $m[2];
        }

        if (!isset($nameToId[$name])) { $sum['unmatched'][$name] = true; continue; }
        if (isset($dupNames[$name]))  { $sum['dup'][$name] = true; continue; }
        $gid = $nameToId[$name];
        $admiIds[] = $gid;
        $sum['matched']++;

        if (!$DRY) {
            foreach ($SHOP_IDS as $sid) {
                $up->execute([
                    'shop'  => $sid, 'girl' => $gid, 'date' => $date,
                    'start' => $start ? $start . ':00' : null,
                    'end'   => $end   ? $end   . ':00' : null,
                ]);
            }
        }
        $sum['upserted']++;
        echo sprintf("%s  %-10s id=%-4d %s-%s%s\n", $date, $name, $gid, $start ?? '?', $end ?? '?', $DRY ? ' [dry]' : '');
    }

    // この日 admi に居ない既存出勤を削除（admi を正として同期）
    if ($admiIds) {
        $ph  = implode(',', array_fill(0, count($admiIds), '?'));
        $sql = "DELETE FROM schedules WHERE shop_id = ? AND work_date = ? AND girl_id NOT IN ($ph)";
        if (!$DRY) {
            $del = $pdo->prepare($sql);
            foreach ($SHOP_IDS as $sid) {
                $del->execute(array_merge([$sid, $date], $admiIds));
                $sum['removed'] += $del->rowCount();
            }
        }
    }
}

echo "\n--- 集計" . ($DRY ? "（DRY-RUN: DB未変更）" : "") . " ---\n";
echo "取得日数: {$sum['days']} / parse: {$sum['parsed']} / match: {$sum['matched']} / upsert: {$sum['upserted']} / 同期削除: {$sum['removed']}\n";
if ($sum['unmatched']) echo "未マッチ(kichifu不在): " . implode(', ', array_keys($sum['unmatched'])) . "\n";
if ($sum['dup'])       echo "同名複数で要手動: "       . implode(', ', array_keys($sum['dup'])) . "\n";
