<?php
// ==========================================================================
// shifts.php — スタッフシフト管理API（要認証）
//
// Actions:
//   GET  ?action=range&from=YYYY-MM-DD&to=YYYY-MM-DD&admin_id=&exclude_casts=1  期間取得
//   POST ?action=upsert                {id?, shift_date, start_time, end_time, status, note, admin_user_id?}
//   POST ?action=delete                {id}
//
// 権限:
//   staff/driver: 自分のシフトのみ編集可（admin_user_id 指定不可）
//   office/manager/owner: 全スタッフのシフト編集可（admin_user_id 指定可）
//   ※ キャスト(girl_id持ち)の出勤は CTRL の出勤管理が正なので、ここでは受け付けない
// ==========================================================================
require_once __DIR__ . '/auth-guard.php';
require_once __DIR__ . '/_cast-sync.php';    // 出勤の紐付け先（キャスト行）を先に揃える
require_once __DIR__ . '/_shift-sync.php';   // CTRL の schedules → ops_shifts

$pdo    = getPdo();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/**
 * 他のスタッフの出勤を登録・編集できるか（店長指定 2026-08-07）。
 * 内勤スタッフ以上（内勤・管理者・オーナー）は事務所として全員ぶんを組む。
 * キャストは自分ぶんのみ、ドライバーは自分ぶんのみ。
 */
function opsCanManageShifts(): bool {
    // 制限はメニュー（シフトタブ）のチェックだけ（店長指定 2026-08-15）。キャストは自分ぶんのみ
    if (currentUserRole() === 'staff') return false;
    return opsRoleCanSeeTab(getPdo(), 'shifts');
}

if ($action === 'range' && $method === 'GET') {
    $from = $_GET['from'] ?? date('Y-m-d');
    $to   = $_GET['to']   ?? date('Y-m-d', strtotime('+10 days'));
    $adminId = isset($_GET['admin_id']) ? (int)$_GET['admin_id'] : 0;

    // 出勤の入力は CTRL(/ctrl/schedules.php) が正。表示前に差分だけ取り込む
    $shopId = current_shop_id();
    ops_sync_casts_if_changed($shopId);
    ops_sync_shifts_if_changed($shopId, $from, $to);

    $where = ['s.shift_date BETWEEN ? AND ?'];
    $params = [$from, $to];
    if ($adminId > 0) {
        $where[] = 's.admin_user_id = ?';
        $params[] = $adminId;
    }
    // キャスト(staff)は自分のシフトのみ（admin_id 指定があっても本人に固定）。owner/manager/office は全員閲覧可
    if (currentUserRole() === 'staff') {
        $where[] = 's.admin_user_id = ?';
        $params[] = currentUserId();
    }
    // 内勤・送迎シフトの一覧はキャストを出さない（キャストの出勤は CTRL の出勤管理が正・店長指定 2026-08-07）
    if (!empty($_GET['exclude_casts'])) {
        $where[] = "(au.role <> 'staff' AND au.girl_id IS NULL)";
    }

    // 差分同期がスキップされた時でも is_private を参照できるようにしておく
    ops_shifts_ensure_private_column($pdo);
    $sql = "SELECT s.id, s.admin_user_id, s.shift_date, s.start_time, s.end_time, s.end_open, s.end_type, s.status, s.note, s.is_private, s.shift_preset,
                   au.display_name AS staff_name, au.role AS staff_role, au.staff_color AS staff_color
            FROM ops_shifts s
            LEFT JOIN ops_admin_users au ON au.id = s.admin_user_id
            WHERE " . implode(' AND ', $where) . "
            ORDER BY s.shift_date, s.start_time, s.admin_user_id";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    // その日の「貴重品お預かり」「釣銭お渡し」（タイムラインの件数行のトグル・店長要望 2026-08-16）
    $fq = $pdo->prepare("SELECT admin_user_id, biz_date,
                                valuables_by, valuables_at, valuables_off_by, valuables_off_at,
                                change_given_by, change_given_at, change_given_off_by, change_given_off_at
                           FROM ops_cast_day_flags WHERE biz_date BETWEEN ? AND ?");
    $fq->execute([$from, $to]);
    $flags = [];
    foreach ($fq->fetchAll() as $f) {
        $flags[$f['admin_user_id'] . '|' . substr((string)$f['biz_date'], 0, 10)] = [
            // 貴重品: 預かった人 / 返した人（釣銭: 渡した人 / 回収した人）と、その時刻
            'valuables_by'        => $f['valuables_by'] !== null ? (int)$f['valuables_by'] : null,
            'valuables_at'        => $f['valuables_at'],
            'valuables_off_by'    => $f['valuables_off_by'] !== null ? (int)$f['valuables_off_by'] : null,
            'valuables_off_at'    => $f['valuables_off_at'],
            'change_given_by'     => $f['change_given_by'] !== null ? (int)$f['change_given_by'] : null,
            'change_given_at'     => $f['change_given_at'],
            'change_given_off_by' => $f['change_given_off_by'] !== null ? (int)$f['change_given_off_by'] : null,
            'change_given_off_at' => $f['change_given_off_at'],
        ];
    }
    jsonResponse(['shifts' => $stmt->fetchAll(), 'day_flags' => $flags]);
}

/**
 * 貴重品お預かり / 釣銭お渡し の記録（その日・そのキャストぶん・店長要望 2026-08-16）。
 *   貴重品: 誰が預かった(by) / 誰が返した(off_by)
 *   釣銭  : 誰が渡した(by)   / 誰が回収した(off_by)
 * 大事なお金・持ち物なので「誰が」を必ず残す。時刻は担当を入れ替えたときだけ打ち直す
 */
if ($action === 'set-day-flag' && $method === 'POST') {
    $b = readJsonBody();
    $adminId = (int)($b['admin_user_id'] ?? 0);
    $date    = (string)($b['biz_date'] ?? '');
    $key     = (string)($b['key'] ?? '');
    if ($adminId <= 0) errorResponse('invalid admin_user_id', 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) errorResponse('invalid biz_date', 400);
    if (!in_array($key, ['valuables', 'change_given'], true)) errorResponse('invalid key', 400);
    if (currentUserRole() === 'staff') errorResponse('forbidden', 403);
    $by    = (isset($b['by'])     && $b['by']     !== '' && $b['by']     !== null) ? (int)$b['by']     : null;
    $offBy = (isset($b['off_by']) && $b['off_by'] !== '' && $b['off_by'] !== null) ? (int)$b['off_by'] : null;

    $cur = $pdo->prepare("SELECT {$key}_by AS b, {$key}_off_by AS ob, {$key}_at AS a, {$key}_off_at AS oa
                            FROM ops_cast_day_flags WHERE admin_user_id = ? AND biz_date = ?");
    $cur->execute([$adminId, $date]);
    $old = $cur->fetch() ?: ['b' => null, 'ob' => null, 'a' => null, 'oa' => null];
    // 担当が変わった（または新しく入った）ときだけ時刻を打ち直す。消したら時刻も消す
    $at    = $by    === null ? null : (((int)($old['b']  ?? 0) === $by    && $old['a'])  ? $old['a']  : date('Y-m-d H:i:s'));
    $offAt = $offBy === null ? null : (((int)($old['ob'] ?? 0) === $offBy && $old['oa']) ? $old['oa'] : date('Y-m-d H:i:s'));
    // 旧来の 0/1 も残しておく（預かり中＝渡した人がいて、まだ戻っていない）
    $onFlag = ($by !== null && $offBy === null) ? 1 : 0;

    $pdo->prepare("INSERT INTO ops_cast_day_flags
                     (admin_user_id, biz_date, {$key}, {$key}_by, {$key}_at, {$key}_off_by, {$key}_off_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                   ON DUPLICATE KEY UPDATE
                     {$key} = VALUES({$key}),
                     {$key}_by = VALUES({$key}_by), {$key}_at = VALUES({$key}_at),
                     {$key}_off_by = VALUES({$key}_off_by), {$key}_off_at = VALUES({$key}_off_at),
                     updated_at = NOW()")
        ->execute([$adminId, $date, $onFlag, $by, $at, $offBy, $offAt]);
    jsonResponse(['ok' => true, 'by' => $by, 'at' => $at, 'off_by' => $offBy, 'off_at' => $offAt]);
}

if ($action === 'upsert' && $method === 'POST') {
    $b = readJsonBody();
    $id = isset($b['id']) ? (int)$b['id'] : 0;
    $shiftDate = $b['shift_date'] ?? '';
    $startTime = $b['start_time'] ?? '';
    $endTime   = $b['end_time']   ?? '';
    $status    = in_array($b['status'] ?? '', ['available','off','tentative'], true) ? $b['status'] : 'available';
    $note      = trim($b['note'] ?? '') ?: null;
    // 24H・早番・遅番は「チェックを選んだとき」だけ区分として残す。
    // 時刻が偶然一致しただけの人（10:00〜19:00のドライバー等）を早番扱いにしないため（店長指摘 2026-08-29）
    $preset    = in_array($b['preset'] ?? '', ['24h','early','late'], true) ? $b['preset'] : null;

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $shiftDate)) errorResponse('invalid shift_date', 400);
    // 休みは時刻なしで登録できる（画面側も休みだけ開始未入力を許している。店長指摘 2026-09-02）。
    // start_time カラムは NOT NULL なので 00:00 を置く（休みの表示は時刻を使わないため無害）
    if ($status === 'off' && trim((string)$startTime) === '') $startTime = '00:00';
    if (!preg_match('/^\d{2}:\d{2}/', $startTime)) errorResponse('invalid start_time', 400);
    // 終了は「時刻」または「未定 / ラスト」を許可。未定・ラストは end_time=NULL + end_open で区別
    $endTime = trim((string)$endTime);
    $endOpen = in_array($b['end_open'] ?? '', ['undecided', 'last'], true) ? $b['end_open'] : '';
    if ($endTime === '') { $endTime = null; }
    elseif (!preg_match('/^\d{2}:\d{2}/', $endTime)) errorResponse('invalid end_time', 400);
    if ($endTime !== null) $endOpen = '';   // 時刻があるときは open ではない

    // admin_user_id: ownerなら指定可、staffは自分のみ
    $adminId = isset($b['admin_user_id']) ? (int)$b['admin_user_id'] : currentUserId();
    if (!opsCanManageShifts() && $adminId !== currentUserId()) errorResponse('他のスタッフの出勤は内勤スタッフ以上が登録します', 403);

    // キャスト(CTRLで同期されるgirl_id持ち)の出勤は /ctrl/schedules.php が正。
    // ここでの手入力を許すと二重の入力元ができてしまうため、内勤/ドライバーのみ受け付ける
    $gid = $pdo->prepare("SELECT girl_id FROM ops_admin_users WHERE id = ?");
    $gid->execute([$adminId]);
    if ($gid->fetchColumn()) errorResponse('キャストの出勤は CTRL の出勤管理（/ctrl/schedules.php）で登録してください', 400);

    if ($id > 0) {
        // 既存編集時、所有者チェック
        $own = $pdo->prepare('SELECT admin_user_id FROM ops_shifts WHERE id = ?');
        $own->execute([$id]);
        $row = $own->fetch();
        if (!$row) errorResponse('shift not found', 404);
        if (!opsCanManageShifts() && (int)$row['admin_user_id'] !== currentUserId()) errorResponse('forbidden', 403);
        $pdo->prepare("UPDATE ops_shifts SET shift_date=?, start_time=?, end_time=?, end_open=?, status=?, note=?, shift_preset=? WHERE id=?")
            ->execute([$shiftDate, $startTime, $endTime, $endOpen, $status, $note, $preset, $id]);
        jsonResponse(['ok' => true, 'id' => $id]);
    } else {
        $pdo->prepare("INSERT INTO ops_shifts (admin_user_id, shift_date, start_time, end_time, end_open, status, note, shift_preset) VALUES (?,?,?,?,?,?,?,?)")
            ->execute([$adminId, $shiftDate, $startTime, $endTime, $endOpen, $status, $note, $preset]);
        jsonResponse(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
    }
}

if ($action === 'delete' && $method === 'POST') {
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $own = $pdo->prepare('SELECT admin_user_id FROM ops_shifts WHERE id = ?');
    $own->execute([$id]);
    $row = $own->fetch();
    if (!$row) errorResponse('not found', 404);
    if (!opsCanManageShifts() && (int)$row['admin_user_id'] !== currentUserId()) errorResponse('forbidden', 403);
    $pdo->prepare("DELETE FROM ops_shifts WHERE id = ?")->execute([$id]);
    jsonResponse(['ok' => true]);
}

// 出勤/休み トグル（タイムラインのスタッフ列から）。既存シフトの status を切替、無ければ受付時間で作成
if ($action === 'set-attendance' && $method === 'POST') {
    $b = readJsonBody();
    $adminId   = isset($b['admin_user_id']) ? (int)$b['admin_user_id'] : currentUserId();
    $shiftDate = $b['shift_date'] ?? '';
    $status    = in_array($b['status'] ?? '', ['available', 'off', 'tentative', 'done'], true) ? $b['status'] : 'available';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $shiftDate)) errorResponse('invalid shift_date', 400);
    // タイムラインの出勤トグルは、その画面を見られる人なら誰でも切り替えられる（制限はメニューのみ・店長指定 2026-08-14）。
    // キャスト(staff)はタイムラインを持たないので、自分ぶんだけ
    if (currentUserRole() === 'staff' && $adminId !== currentUserId()) errorResponse('forbidden', 403);
    $st = $pdo->prepare("SELECT id FROM ops_shifts WHERE admin_user_id=? AND shift_date=? ORDER BY id LIMIT 1");
    $st->execute([$adminId, $shiftDate]);
    $row = $st->fetch();
    if ($row) {
        $pdo->prepare("UPDATE ops_shifts SET status=? WHERE id=?")->execute([$status, (int)$row['id']]);
        jsonResponse(['ok' => true, 'id' => (int)$row['id']]);
    } else {
        // シフト未登録 → 受付時間（10:00〜翌4:00）で作成
        $pdo->prepare("INSERT INTO ops_shifts (admin_user_id, shift_date, start_time, end_time, status) VALUES (?,?,?,?,?)")
            ->execute([$adminId, $shiftDate, '10:00:00', '04:00:00', $status]);
        jsonResponse(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
    }
}

errorResponse('invalid action', 400);
