<?php
// ==========================================================================
// api/schedule-range.php — 出勤表(schedules)の複数日ぶんをbotへ配信（週間出勤の媒体同期用）。
//   CTRL /ctrl/schedules.php が正（最大28日先まで登録）。bot は本APIで指定範囲の各キャストの
//   日別出勤を取得し、媒体の週間出勤フォーム（情報局=28日/駅ちか=7日/ヘブン=14日/風じゃ・デリじゃ=14日）
//   へ、各媒体の最大日数ぶん反映する。play-availability.php は当日D/翌日D+1の即姫・出勤用、
//   本APIは D 以降の任意範囲の「出勤表」専用（役割分担）。
//
//   認証: X-Api-Key（または ?key=）= db-config.php の PLAY_API_KEY（play-availability と同一）。
//
//   GET /api/schedule-range.php?shop_id=1[&from=YYYY-MM-DD][&days=28][&cast_id=N]
//     from 省略時 = 現在営業日 D（time()-5h）。days 省略時 = 28（1〜60でクランプ）。
//     → {ok, shop_id, from, to, days, server_time,
//         items:[{cast_id, name, media_ids:{fujoho,ekichika,heaven,fuzoku,deli},
//                 days:{ "YYYY-MM-DD": {status:"work|off|undecided", start_at:ISO|null, end_at:ISO|null} }}]}
//     ・work_date が範囲内の schedules 行があるキャストのみ返す（未登録日は days に含めない＝媒体側は現状維持）。
//     ・status=work は start_at/end_at をISO8601(+09:00)で返す（深夜0〜9時台=翌暦日＝start<end 成立）。
//       off/undecided は start_at/end_at=null（媒体では休みに相当）。
//     ・日付キーは work_date（営業日）そのもの。媒体フォームの日付列と突き合わせる。
// ==========================================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/db-config.php';   // PLAY_API_KEY を認証前に読む（db.php は遅延接続）

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
date_default_timezone_set('Asia/Tokyo');

if (!defined('PLAY_API_KEY') || PLAY_API_KEY === '') {
    http_response_code(503); echo json_encode(['error' => 'schedule api not configured']); exit;
}
$key = $_SERVER['HTTP_X_API_KEY'] ?? ($_GET['key'] ?? '');
if (!is_string($key) || !hash_equals(PLAY_API_KEY, $key)) {
    http_response_code(401); echo json_encode(['error' => 'unauthorized']); exit;
}

$shopId = (int)($_GET['shop_id'] ?? 1);
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405); echo json_encode(['error' => 'GET only']); exit;
}

// work TIME → 実datetime（0〜9時台=翌暦日の深夜側。start<end が常に成立）— play-availability と同一
$shiftDt = static function (?string $wDate, ?string $t): ?string {
    if (!$wDate || !$t) return null;
    $h = (int)substr($t, 0, 2);
    $d = ($h >= 10) ? $wDate : date('Y-m-d', strtotime($wDate . ' +1 day'));
    return $d . ' ' . substr($t, 0, 5) . ':00';
};
$iso = static function (?string $dt): ?string {
    if (!$dt) return null;
    $t = strtotime($dt);
    return $t ? date('Y-m-d\TH:i:sP', $t) : null;
};

try {
    $bizToday = date('Y-m-d', time() - 5 * 3600);                  // 現在営業日 D
    $from = (string)($_GET['from'] ?? $bizToday);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) { http_response_code(400); echo json_encode(['error' => 'bad from']); exit; }
    $days = (int)($_GET['days'] ?? 28);
    $days = max(1, min(60, $days));
    $to = date('Y-m-d', strtotime($from . ' +' . ($days - 1) . ' day'));
    $castId = isset($_GET['cast_id']) ? (int)$_GET['cast_id'] : 0;

    $sql =
        'SELECT s.girl_id, g.name, s.work_date, s.start_time, s.end_time, s.status,
                mi.fujoho_girl_id, mi.ekichika_girl_id, mi.heaven_member_id, mi.fuzoku_girl_no, mi.deli_girl_no
           FROM schedules s
           JOIN girls g            ON g.id = s.girl_id
           LEFT JOIN girl_media_ids mi ON mi.girl_id = s.girl_id AND mi.shop_id = :shop
          WHERE s.shop_id = :shop2 AND s.work_date BETWEEN :from AND :to';
    $params = ['shop' => $shopId, 'shop2' => $shopId, 'from' => $from, 'to' => $to];
    if ($castId > 0) { $sql .= ' AND s.girl_id = :cast'; $params['cast'] = $castId; }
    $sql .= ' ORDER BY s.girl_id, s.work_date';

    $st = DB::conn()->prepare($sql);
    $st->execute($params);

    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $gid = (int)$r['girl_id'];
        if (!isset($items[$gid])) {
            $items[$gid] = [
                'cast_id'   => $gid,
                'name'      => $r['name'],
                'media_ids' => [
                    'fujoho'   => $r['fujoho_girl_id'],
                    'ekichika' => $r['ekichika_girl_id'],
                    'heaven'   => $r['heaven_member_id'],
                    'fuzoku'   => $r['fuzoku_girl_no'],
                    'deli'     => $r['deli_girl_no'],
                ],
                'days'      => [],
            ];
        }
        $work = $r['status'] === 'work';
        $items[$gid]['days'][$r['work_date']] = [
            'status'   => $r['status'],
            'start_at' => $work ? $iso($shiftDt($r['work_date'], $r['start_time'])) : null,
            'end_at'   => $work ? $iso($shiftDt($r['work_date'], $r['end_time'])) : null,
        ];
    }

    echo DB::jsonEncode([
        'ok'          => true,
        'shop_id'     => $shopId,
        'from'        => $from,
        'to'          => $to,
        'days'        => $days,
        'server_time' => date('Y-m-d\TH:i:sP'),
        'items'       => array_values($items),
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'server error']);
}
