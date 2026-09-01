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
                // ops_only（サイトに載せない出勤）は【未定】に丸め、時刻も返さない。
                // ここは認証なしで誰でも叩ける公開APIなので、生の状態を返すと
                // 画面に出していなくても出勤日と時間が丸見えになる（身内バレ・ストーカー対策）。
                if ($r['status'] === 'ops_only') {
                    $sch[$r['work_date']] = ['status' => 'undecided', 'start' => null, 'end' => null];
                    continue;
                }
                $sch[$r['work_date']] = ['status' => $r['status'], 'start' => $r['start'], 'end' => $r['end']];
            }

            // 予約が入っている時間帯を「ご予約済」として重ねる（店長要望 2026-08-14）。
            // OPS(予約管理)は admi(shop_id=1) のみが持つため、そのショップの公開ページだけで集計する
            // （他ショップの girl_id に共有ロスターで誤ヒットして予約が漏れるのを防ぐ）。
            // 公開APIなので客名は返さず、時間帯だけ。載せるのは公開中(work)の出勤日に限る（隠し出勤の露出防止）。
            if ($gid && $shop_id === 1) {
                $booked = [];
                $bq = $pdo->prepare(
                    "SELECT b.booking_date, TIME_FORMAT(b.start_time,'%H:%i') AS s, TIME_FORMAT(b.end_time,'%H:%i') AS e
                       FROM ops_bookings b
                       JOIN ops_admin_users au ON au.id = b.assigned_admin_id
                      WHERE au.girl_id = ? AND b.status NOT IN ('cancelled','no_show','inquiry')
                        AND b.booking_date BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)"
                );
                $bq->execute([$gid, $from, $to]);
                foreach ($bq->fetchAll(PDO::FETCH_ASSOC) as $b) {
                    // 10時前開始は前営業日ぶん（夜シフトの深夜予約を前日の出勤に寄せる）
                    $h  = (int)substr((string)$b['s'], 0, 2);
                    $wd = $h < 10 ? date('Y-m-d', strtotime($b['booking_date'] . ' -1 day')) : (string)$b['booking_date'];
                    $booked[$wd][] = ['start' => $b['s'], 'end' => $b['e']];
                }
                foreach ($sch as $d => &$info) {
                    if (($info['status'] ?? '') === 'work' && !empty($booked[$d])) {
                        usort($booked[$d], fn($a, $bb) => strcmp($a['start'], $bb['start']));
                        $info['booked'] = array_values($booked[$d]);
                    }
                }
                unset($info);
            }
        }
        echo json_encode(['from' => $from, 'days' => $days, 'schedule' => $sch], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'recent-reservations') {
        // トップの流れるご案内用。事前予約(reserved/pre_reserved)の「ご予約頂きました」を新着順で。
        // OPS(予約)を持つ admi(shop_id=1) のみ。公開APIなので客情報は返さず、キャスト名/コース/日付だけ。
        $out = [];
        if ($shop_id === 1) {
            // 営業日は 10:00〜翌10:00。当日10時を過ぎたら「その日の予約」は前日予約でなくなるので出さない。
            // ＝予約の営業日が「現在の営業日」より先のものだけ流す（店長要望 2026-08-14）。
            $bizToday = ((int)date('H') < 10) ? date('Y-m-d', strtotime('-1 day')) : date('Y-m-d');
            $st = $pdo->prepare(
                "SELECT b.booking_date, TIME_FORMAT(b.start_time,'%H:%i') AS start, b.course_name, au.girl_id, g.name AS girl_name
                   FROM ops_bookings b
                   JOIN ops_admin_users au ON au.id = b.assigned_admin_id
                   JOIN girls g ON g.id = au.girl_id AND g.shop_id = ?
                  WHERE b.status IN ('reserved','pre_reserved')
                    AND (CASE WHEN b.start_time < '10:00:00' THEN DATE_SUB(b.booking_date, INTERVAL 1 DAY) ELSE b.booking_date END) > ?
                  ORDER BY b.created_at DESC
                  LIMIT 10"
            );
            $st->execute([$shop_id, $bizToday]);
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
                // 深夜(10時前開始)は前営業日ぶんに寄せて、リンク先の出勤タイムライン行(work_date)に合わせる
                $h = (int)substr((string)$r['start'], 0, 2);
                $d = $h < 10 ? date('Y-m-d', strtotime($r['booking_date'] . ' -1 day')) : (string)$r['booking_date'];
                $out[] = [
                    'girl_id' => (int)$r['girl_id'],
                    'name'    => (string)$r['girl_name'],
                    'course'  => (string)($r['course_name'] ?? ''),
                    'date'    => $d,
                ];
            }
        }
        echo json_encode(['reservations' => $out], JSON_UNESCAPED_UNICODE);
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
