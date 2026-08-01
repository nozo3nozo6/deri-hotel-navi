<?php
// ==========================================================================
// shifts.php — スタッフシフト管理API（要認証）
//
// Actions:
//   GET  ?action=range&from=YYYY-MM-DD&to=YYYY-MM-DD&admin_id=  期間取得
//   POST ?action=upsert                {id?, shift_date, start_time, end_time, status, note, admin_user_id?}
//   POST ?action=delete                {id}
//
// 権限:
//   staff: 自分のシフトのみ編集可（admin_user_id 指定不可）
//   owner: 全員のシフト編集可（admin_user_id 指定可）
// ==========================================================================
require_once __DIR__ . '/auth-guard.php';
require_once __DIR__ . '/_cast-sync.php';    // 出勤の紐付け先（キャスト行）を先に揃える
require_once __DIR__ . '/_shift-sync.php';   // CTRL の schedules → ops_shifts

$pdo    = getPdo();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

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

    $sql = "SELECT s.id, s.admin_user_id, s.shift_date, s.start_time, s.end_time, s.status, s.note,
                   au.display_name AS staff_name, au.role AS staff_role
            FROM ops_shifts s
            LEFT JOIN ops_admin_users au ON au.id = s.admin_user_id
            WHERE " . implode(' AND ', $where) . "
            ORDER BY s.shift_date, s.start_time, s.admin_user_id";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    jsonResponse(['shifts' => $stmt->fetchAll()]);
}

if ($action === 'upsert' && $method === 'POST') {
    $b = readJsonBody();
    $id = isset($b['id']) ? (int)$b['id'] : 0;
    $shiftDate = $b['shift_date'] ?? '';
    $startTime = $b['start_time'] ?? '';
    $endTime   = $b['end_time']   ?? '';
    $status    = in_array($b['status'] ?? '', ['available','off','tentative'], true) ? $b['status'] : 'available';
    $note      = trim($b['note'] ?? '') ?: null;

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $shiftDate)) errorResponse('invalid shift_date', 400);
    if (!preg_match('/^\d{2}:\d{2}/', $startTime)) errorResponse('invalid start_time', 400);
    if (!preg_match('/^\d{2}:\d{2}/', $endTime)) errorResponse('invalid end_time', 400);

    // admin_user_id: ownerなら指定可、staffは自分のみ
    $adminId = isset($b['admin_user_id']) ? (int)$b['admin_user_id'] : currentUserId();
    if (!isOwner() && $adminId !== currentUserId()) errorResponse('staff can only edit own shifts', 403);

    if ($id > 0) {
        // 既存編集時、所有者チェック
        $own = $pdo->prepare('SELECT admin_user_id FROM ops_shifts WHERE id = ?');
        $own->execute([$id]);
        $row = $own->fetch();
        if (!$row) errorResponse('shift not found', 404);
        if (!isOwner() && (int)$row['admin_user_id'] !== currentUserId()) errorResponse('forbidden', 403);
        $pdo->prepare("UPDATE ops_shifts SET shift_date=?, start_time=?, end_time=?, status=?, note=? WHERE id=?")
            ->execute([$shiftDate, $startTime, $endTime, $status, $note, $id]);
        jsonResponse(['ok' => true, 'id' => $id]);
    } else {
        $pdo->prepare("INSERT INTO ops_shifts (admin_user_id, shift_date, start_time, end_time, status, note) VALUES (?,?,?,?,?,?)")
            ->execute([$adminId, $shiftDate, $startTime, $endTime, $status, $note]);
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
    if (!isOwner() && (int)$row['admin_user_id'] !== currentUserId()) errorResponse('forbidden', 403);
    $pdo->prepare("DELETE FROM ops_shifts WHERE id = ?")->execute([$id]);
    jsonResponse(['ok' => true]);
}

// 出勤/休み トグル（タイムラインのスタッフ列から）。既存シフトの status を切替、無ければ受付時間で作成
if ($action === 'set-attendance' && $method === 'POST') {
    $b = readJsonBody();
    $adminId   = isset($b['admin_user_id']) ? (int)$b['admin_user_id'] : currentUserId();
    $shiftDate = $b['shift_date'] ?? '';
    $status    = in_array($b['status'] ?? '', ['available', 'off', 'tentative'], true) ? $b['status'] : 'available';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $shiftDate)) errorResponse('invalid shift_date', 400);
    if (!isOwner() && $adminId !== currentUserId()) errorResponse('forbidden', 403);
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
