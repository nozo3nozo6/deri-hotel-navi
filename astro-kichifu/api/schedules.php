<?php
// ==========================================================================
// api/schedules.php — 出勤データ配信API（SSGフロントがクライアントJSで取得）
//   GET ?action=today[&shop_id=1]   … 本日の出勤 {girl_id: {start,end}}
//   GET ?action=range&from=YYYY-MM-DD&days=7  … 期間（将来の出勤ページ用）
// ==========================================================================
require_once __DIR__ . '/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

date_default_timezone_set('Asia/Tokyo');
$shop_id = (int)($_GET['shop_id'] ?? 1);
$action  = $_GET['action'] ?? 'today';

try {
    $pdo = DB::conn();

    if ($action === 'range') {
        $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['from'] ?? '') ? $_GET['from'] : date('Y-m-d');
        $days = min(max((int)($_GET['days'] ?? 7), 1), 31);
        $to   = date('Y-m-d', strtotime("$from +" . ($days - 1) . " day"));
        $st = $pdo->prepare(
            "SELECT work_date, girl_id, TIME_FORMAT(start_time,'%H:%i') AS start, TIME_FORMAT(end_time,'%H:%i') AS end
               FROM schedules
              WHERE shop_id = ? AND status = 'work' AND work_date BETWEEN ? AND ?
              ORDER BY work_date, start_time"
        );
        $st->execute([$shop_id, $from, $to]);
        $out = [];
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $out[$r['work_date']][(int)$r['girl_id']] = ['start' => $r['start'], 'end' => $r['end']];
        }
        echo json_encode(['from' => $from, 'days' => $days, 'days_work' => $out], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'girl-week') {
        // 1女性の週間出勤（プロフィールページ用）。営業日5時基準の「今日」から N 日。
        //   出勤/休み/未定 を区別して返す（status ＋ start/end）。
        $gid  = (int)($_GET['girl_id'] ?? 0);
        $days = min(max((int)($_GET['days'] ?? 7), 1), 14);
        $from = date('Y-m-d', time() - 5 * 3600);
        $to   = date('Y-m-d', strtotime("$from +" . ($days - 1) . " day"));
        $sch  = [];
        if ($gid) {
            $st = $pdo->prepare(
                "SELECT work_date, status, TIME_FORMAT(start_time,'%H:%i') AS start, TIME_FORMAT(end_time,'%H:%i') AS end
                   FROM schedules
                  WHERE shop_id = ? AND girl_id = ? AND work_date BETWEEN ? AND ?"
            );
            $st->execute([$shop_id, $gid, $from, $to]);
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $sch[$r['work_date']] = ['status' => $r['status'], 'start' => $r['start'], 'end' => $r['end']];
            }
        }
        echo json_encode(['from' => $from, 'days' => $days, 'schedule' => $sch], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // 既定: today（営業日は朝5時区切り。5時前は前日を当日扱い）
    $date = date('Y-m-d', time() - 5 * 3600);
    $st = $pdo->prepare(
        "SELECT girl_id, TIME_FORMAT(start_time,'%H:%i') AS start, TIME_FORMAT(end_time,'%H:%i') AS end
           FROM schedules
          WHERE shop_id = ? AND work_date = ? AND status = 'work'"
    );
    $st->execute([$shop_id, $date]);
    $work = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $work[(int)$r['girl_id']] = ['start' => $r['start'], 'end' => $r['end']];
    }
    echo json_encode(['date' => $date, 'work' => $work], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
