<?php
// ==========================================================================
// bookings.php — 予約管理API（要認証）
//
// Actions:
//   GET  ?action=range&from=&to=&admin_id=&status=     期間内予約（タイムライン用）
//   GET  ?action=list&keyword=&status=&date=           リスト形式
//   GET  ?action=get&id=                               詳細
//   POST ?action=create                                予約作成
//   POST ?action=update                                {id, ...}
//   POST ?action=delete                                {id}
//   POST ?action=set-status                            {id, status, cancellation_reason?}
// ==========================================================================
require_once __DIR__ . '/auth-guard.php';

$pdo    = getPdo();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

function bookingSelectColumns(): string {
    return "
        b.id, b.customer_id, b.customer_name_snapshot, b.customer_phone_snapshot, b.customer_email_snapshot,
        b.assigned_admin_id, b.driver_id, b.back_driver_id, b.hotel_id, b.hotel_name_snapshot, b.display_city, b.room_number,
        b.booking_date, b.start_time, b.end_time, b.pickup_go_time, b.pickup_back_time, b.pickup_go_mailed_at, b.pickup_back_mailed_at,
        b.course_name, b.nomination_type, b.nomination_fee, b.menu_items, b.price, b.late_fee, b.transport_fee, b.payment_method, b.counseling, b.extension_count,
        b.status, b.service_ended_at, b.source, b.notes, b.cancellation_reason, b.cancellation_reason_type, b.cancellation_fee, b.cancellation_reward, b.reward_override, b.shop_settled, b.shop_settled_by, b.settle_kind, b.reward_paid_at, b.reward_paid_by, b.counseling_sheet_url, b.held_by, b.created_at, b.updated_at,
        c.name AS customer_name, c.phone AS customer_phone, c.notes AS customer_notes,
        h.name AS hotel_name, h.city AS hotel_city, h.address AS hotel_address,
        au.display_name AS staff_name,
        dr.display_name AS driver_name,
        dr2.display_name AS back_driver_name
    ";
}

// ドライバー権限の場合、自分が担当する予約のみに絞り込むフィルタ
function driverScopeWhere(): array {
    $role = $_SESSION['ylka_admin_role'] ?? '';
    $myId = (int)($_SESSION['ylka_admin_id'] ?? 0);
    if ($role === 'driver' && $myId > 0) {
        return ['(b.driver_id = ? OR b.back_driver_id = ?)', [$myId, $myId]];
    }
    return ['', []];
}

// キャスト(staff)権限の場合、自分が担当する予約のみに絞り込むフィルタ（他キャストの予約閲覧を防止）
function staffScopeWhere(): array {
    if (currentUserRole() === 'staff' && currentUserId() > 0) {
        return ['b.assigned_admin_id = ?', [currentUserId()]];
    }
    return ['', []];
}

// キャスト(staff)には顧客連絡先(電話/メール)を返さない（個人情報保護）。owner/manager/office は従来どおり
function stripContactForStaff(array $rows): array {
    if (currentUserRole() !== 'staff') return $rows;
    foreach (array_keys($rows) as $i) {
        unset($rows[$i]['customer_phone'], $rows[$i]['customer_phone_snapshot'], $rows[$i]['customer_email_snapshot'], $rows[$i]['customer_notes']);
    }
    return $rows;
}

if ($action === 'range' && $method === 'GET') {
    $from = $_GET['from'] ?? date('Y-m-d');
    $to   = $_GET['to']   ?? date('Y-m-d', strtotime('+10 days'));
    $adminId = isset($_GET['admin_id']) ? (int)$_GET['admin_id'] : 0;
    $status  = $_GET['status'] ?? '';

    $where = ['b.booking_date BETWEEN ? AND ?'];
    $params = [$from, $to];
    if ($adminId > 0) { $where[] = 'b.assigned_admin_id = ?'; $params[] = $adminId; }
    if ($status !== '') { $where[] = 'b.status = ?'; $params[] = $status; }
    [$drvWhere, $drvParams] = driverScopeWhere();
    if ($drvWhere) { $where[] = $drvWhere; $params = array_merge($params, $drvParams); }
    [$stfWhere, $stfParams] = staffScopeWhere();
    if ($stfWhere) { $where[] = $stfWhere; $params = array_merge($params, $stfParams); }

    $sql = "SELECT " . bookingSelectColumns() . "
            FROM ops_bookings b
            LEFT JOIN ops_customers c ON c.id = b.customer_id
            LEFT JOIN ops_hotels h ON h.id = b.hotel_id
            LEFT JOIN ops_admin_users au ON au.id = b.assigned_admin_id
            LEFT JOIN ops_admin_users dr ON dr.id = b.driver_id
            LEFT JOIN ops_admin_users dr2 ON dr2.id = b.back_driver_id
            WHERE " . implode(' AND ', $where) . "
            ORDER BY b.booking_date, b.start_time";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    jsonResponse(['bookings' => stripContactForStaff($stmt->fetchAll())]);
}

if ($action === 'list' && $method === 'GET') {
    $kw = trim($_GET['keyword'] ?? '');
    $status = $_GET['status'] ?? '';
    $date = $_GET['date'] ?? '';

    $where = []; $params = [];
    if ($kw !== '') {
        $where[] = '(c.name LIKE ? OR b.customer_name_snapshot LIKE ? OR h.name LIKE ? OR b.hotel_name_snapshot LIKE ?)';
        $params[] = "%{$kw}%"; $params[] = "%{$kw}%"; $params[] = "%{$kw}%"; $params[] = "%{$kw}%";
    }
    if ($status !== '') { $where[] = 'b.status = ?'; $params[] = $status; }
    if ($date !== '') { $where[] = 'b.booking_date = ?'; $params[] = $date; }
    [$drvWhere, $drvParams] = driverScopeWhere();
    if ($drvWhere) { $where[] = $drvWhere; $params = array_merge($params, $drvParams); }
    [$stfWhere, $stfParams] = staffScopeWhere();
    if ($stfWhere) { $where[] = $stfWhere; $params = array_merge($params, $stfParams); }

    $sql = "SELECT " . bookingSelectColumns() . "
            FROM ops_bookings b
            LEFT JOIN ops_customers c ON c.id = b.customer_id
            LEFT JOIN ops_hotels h ON h.id = b.hotel_id
            LEFT JOIN ops_admin_users au ON au.id = b.assigned_admin_id
            LEFT JOIN ops_admin_users dr ON dr.id = b.driver_id
            LEFT JOIN ops_admin_users dr2 ON dr2.id = b.back_driver_id
            " . ($where ? 'WHERE ' . implode(' AND ', $where) : '') . "
            ORDER BY b.booking_date DESC, b.start_time DESC
            LIMIT 200";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    jsonResponse(['bookings' => stripContactForStaff($stmt->fetchAll())]);
}

if ($action === 'get' && $method === 'GET') {
    $id = (int)($_GET['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $stmt = $pdo->prepare("SELECT " . bookingSelectColumns() . "
                           FROM ops_bookings b
                           LEFT JOIN ops_customers c ON c.id = b.customer_id
                           LEFT JOIN ops_hotels h ON h.id = b.hotel_id
                           LEFT JOIN ops_admin_users au ON au.id = b.assigned_admin_id
                           LEFT JOIN ops_admin_users dr ON dr.id = b.driver_id
            LEFT JOIN ops_admin_users dr2 ON dr2.id = b.back_driver_id
                           WHERE b.id = ?");
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) errorResponse('not found', 404);
    // ドライバー権限の場合、自分担当の予約のみ閲覧可
    [$drvW, $drvP] = driverScopeWhere();
    $myDrvId = (int)$_SESSION['ylka_admin_id'];
    if ($drvW && (int)($row['driver_id'] ?? 0) !== $myDrvId && (int)($row['back_driver_id'] ?? 0) !== $myDrvId) {
        errorResponse('forbidden', 403);
    }
    // キャスト(staff)は自分担当の予約のみ閲覧可
    if (currentUserRole() === 'staff' && (int)($row['assigned_admin_id'] ?? 0) !== currentUserId()) {
        errorResponse('forbidden', 403);
    }
    // キャストには顧客連絡先(電話/メール)を返さない（個人情報保護）
    if (currentUserRole() === 'staff') {
        unset($row['customer_phone'], $row['customer_phone_snapshot'], $row['customer_email_snapshot'], $row['customer_notes']);
    }
    jsonResponse(['booking' => $row]);
}

if (($action === 'create' || $action === 'update') && $method === 'POST') {
    // ドライバーは予約の作成・編集不可
    if (($_SESSION['ylka_admin_role'] ?? '') === 'driver') errorResponse('forbidden', 403);
    $b = readJsonBody();
    $isUpdate = $action === 'update';
    $id = $isUpdate ? (int)($b['id'] ?? 0) : 0;
    if ($isUpdate && $id <= 0) errorResponse('invalid id', 400);

    $bookingDate = $b['booking_date'] ?? '';
    $startTime   = $b['start_time'] ?? '';
    $endTime     = $b['end_time']   ?? '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $bookingDate)) errorResponse('invalid booking_date', 400);
    if (!preg_match('/^\d{2}:\d{2}/', $startTime)) errorResponse('invalid start_time', 400);
    if (!preg_match('/^\d{2}:\d{2}/', $endTime)) errorResponse('invalid end_time', 400);

    // ============ 電話番号で顧客自動UPSERT ============
    $customerId = !empty($b['customer_id']) ? (int)$b['customer_id'] : null;
    // 電話番号は数字のみに正規化して扱う。ハイフン付きのまま保存・検索すると、
    // 旧オペレーションから移行した顧客（数字のみで保存）と突き合わず、
    // 同じ人が新規顧客として二重登録される（2026-08-02 統一）
    $phone = opsNormPhone($b['customer_phone_snapshot'] ?? '');
    $name  = trim($b['customer_name_snapshot'] ?? '');
    $email = trim($b['customer_email_snapshot'] ?? '');

    if (!$customerId && $phone !== '') {
        // 電話番号で既存検索（保存側に区切りが混ざっていても拾う。実績のある方を優先）
        // 2台持ちのお客様がいるため、2件目(phone2)からの着信でも同じ顧客に当てる
        $cs = $pdo->prepare("SELECT id, name FROM ops_customers
                              WHERE " . opsPhoneMatchSql('phone') . " OR " . opsPhoneMatchSql('phone2') . "
                              ORDER BY visit_count DESC, id LIMIT 1");
        $cs->execute([$phone, $phone]);
        $existing = $cs->fetch();
        if ($existing) {
            $customerId = (int)$existing['id'];
            // 既存顧客の名前が空で、今回名前があれば更新
            if ($name !== '' && (empty($existing['name']) || $existing['name'] === '名称未設定')) {
                $pdo->prepare("UPDATE ops_customers SET name = ? WHERE id = ?")->execute([$name, $customerId]);
            }
            // メアド未登録なら追記
            if ($email !== '') {
                $pdo->prepare("UPDATE ops_customers SET email = ? WHERE id = ? AND (email IS NULL OR email = '')")->execute([$email, $customerId]);
            }
        } else {
            // 新規顧客作成
            $newName = $name !== '' ? $name : '名称未設定';
            $pdo->prepare("INSERT INTO ops_customers (name, phone, email, first_visit_at) VALUES (?, ?, ?, NOW())")
                ->execute([$newName, $phone, $email ?: null]);
            $customerId = (int)$pdo->lastInsertId();
        }
    }

    $fields = [
        'customer_id'             => $customerId,
        'customer_name_snapshot'  => $name ?: null,
        'customer_phone_snapshot' => $phone ?: null,
        'customer_email_snapshot' => $email ?: null,
        'assigned_admin_id'       => !empty($b['assigned_admin_id']) ? (int)$b['assigned_admin_id'] : null,
        'hotel_id'                => !empty($b['hotel_id']) ? (int)$b['hotel_id'] : null,
        'hotel_name_snapshot'     => trim($b['hotel_name_snapshot'] ?? '') ?: null,
        'display_city'            => trim($b['display_city'] ?? '') ?: null,
        'room_number'             => trim($b['room_number'] ?? '') ?: null,
        'booking_date'            => $bookingDate,
        'start_time'              => $startTime,
        'end_time'                => $endTime,
        'course_name'             => trim($b['course_name'] ?? '') ?: null,
        'nomination_type'         => in_array($b['nomination_type'] ?? '', ['first','regular','free'], true) ? $b['nomination_type'] : null,
        'nomination_fee'          => max(0, (int)($b['nomination_fee'] ?? 0)),
        'menu_items'              => trim($b['menu_items'] ?? '') ?: null,
        'price'                   => isset($b['price']) && $b['price'] !== '' ? (int)$b['price'] : null,
        'late_fee'                => max(0, (int)($b['late_fee'] ?? 0)),
        'transport_fee'           => isset($b['transport_fee']) && $b['transport_fee'] !== '' ? (int)$b['transport_fee'] : null,
        'payment_method'          => in_array($b['payment_method'] ?? '', ['cash','credit','bank'], true) ? $b['payment_method'] : null,
        'counseling'              => !empty($b['counseling']) ? 1 : 0,
        'extension_count'         => max(0, (int)($b['extension_count'] ?? 0)),
        'status'                  => in_array($b['status'] ?? '', ['inquiry','reserved','pre_reserved','on_hold','completed','cancelled','no_show'], true) ? $b['status'] : 'reserved',
        'shop_settled'            => !empty($b['shop_settled']) ? 1 : 0,
        'settle_kind'             => in_array($b['settle_kind'] ?? '', ['full','net'], true) ? $b['settle_kind'] : null,
        'held_by'                 => isset($b['held_by']) && $b['held_by'] !== '' && $b['held_by'] !== null ? (int)$b['held_by'] : null,
        'source'                  => in_array($b['source'] ?? '', ['manual','phone','line','web_form','email'], true) ? $b['source'] : 'manual',
        'notes'                   => trim($b['notes'] ?? '') ?: null,
        'cancellation_reason'     => trim($b['cancellation_reason'] ?? '') ?: null,
        'cancellation_reason_type' => in_array($b['cancellation_reason_type'] ?? '', ['shop','therapist','customer','other'], true) ? $b['cancellation_reason_type'] : null,
        // お客様都合キャンセルのみキャンセル料・報酬を保存（他理由/非キャンセルは null＝計上対象外）
        'cancellation_fee'        => (($b['status'] ?? '') === 'cancelled' && ($b['cancellation_reason_type'] ?? '') === 'customer' && isset($b['cancellation_fee']) && $b['cancellation_fee'] !== '') ? max(0, (int)$b['cancellation_fee']) : null,
        'cancellation_reward'     => (($b['status'] ?? '') === 'cancelled' && ($b['cancellation_reason_type'] ?? '') === 'customer' && isset($b['cancellation_reward']) && $b['cancellation_reward'] !== '') ? max(0, (int)$b['cancellation_reward']) : null,
        // 報酬の手入力オーバーライド（微調整用）。空欄ならNULL＝従来通り自動計算
        'reward_override'         => isset($b['reward_override']) && $b['reward_override'] !== '' && $b['reward_override'] !== null ? (int)$b['reward_override'] : null,
    ];

    if ($isUpdate) {
        $cols = []; $vals = [];
        foreach ($fields as $k => $v) { $cols[] = "$k = ?"; $vals[] = $v; }
        $vals[] = $id;
        $pdo->prepare("UPDATE ops_bookings SET " . implode(', ', $cols) . " WHERE id = ?")->execute($vals);
        jsonResponse(['ok' => true, 'id' => $id]);
    } else {
        $cols = implode(', ', array_keys($fields));
        $placeholders = implode(', ', array_fill(0, count($fields), '?'));
        $pdo->prepare("INSERT INTO ops_bookings ({$cols}) VALUES ({$placeholders})")->execute(array_values($fields));
        $newId = (int)$pdo->lastInsertId();
        // 顧客の利用履歴も更新
        if ($fields['customer_id'] && $fields['status'] === 'completed') {
            $pdo->prepare("UPDATE ops_customers SET visit_count = visit_count + 1, last_visit_at = NOW(),
                           first_visit_at = COALESCE(first_visit_at, NOW()) WHERE id = ?")
                ->execute([$fields['customer_id']]);
        }
        jsonResponse(['ok' => true, 'id' => $newId]);
    }
}

if ($action === 'set-driver' && $method === 'POST') {
    // タイムラインから送迎ドライバーを指定（leg=go/back）。送迎時刻も自動セット
    if (($_SESSION['ylka_admin_role'] ?? '') === 'driver') errorResponse('forbidden', 403);
    $b = readJsonBody();
    $id  = (int)($b['id'] ?? 0);
    $leg = $b['leg'] ?? '';
    $driverId = !empty($b['driver_id']) ? (int)$b['driver_id'] : null;
    if ($id <= 0 || !in_array($leg, ['go', 'back'], true)) errorResponse('invalid params', 400);
    $st = $pdo->prepare("SELECT start_time, end_time FROM ops_bookings WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) errorResponse('not found', 404);
    $toMin = function($t) { if (!$t) return 0; $p = explode(':', $t); return (int)$p[0] * 60 + (int)$p[1]; };
    $fmt = function($m) { $m = max(0, $m); return sprintf('%02d:%02d:00', intdiv($m, 60), $m % 60); };
    if ($leg === 'go') {
        // 行き = 施術開始の30分前。ドライバー変更につきメール送信済みフラグをリセット
        $t = $fmt($toMin($row['start_time']) - 30);
        $pdo->prepare("UPDATE ops_bookings SET driver_id = ?, pickup_go_time = ?, pickup_go_mailed_at = NULL WHERE id = ?")->execute([$driverId, $t, $id]);
    } else {
        // 帰り = 施術終了時刻。ドライバー変更につきメール送信済みフラグをリセット
        $t = $fmt($toMin($row['end_time']));
        $pdo->prepare("UPDATE ops_bookings SET back_driver_id = ?, pickup_back_time = ?, pickup_back_mailed_at = NULL WHERE id = ?")->execute([$driverId, $t, $id]);
    }
    jsonResponse(['ok' => true, 'pickup_time' => $t]);
}

if ($action === 'send-pickup-mail' && $method === 'POST') {
    // 送迎情報をドライバーの登録メール(username)へ relux@ylka.jp から送信
    if (($_SESSION['ylka_admin_role'] ?? '') === 'driver') errorResponse('forbidden', 403);
    $b = readJsonBody();
    $bkId     = (int)($b['id'] ?? 0);
    $leg      = $b['leg'] ?? '';
    $driverId = (int)($b['driver_id'] ?? 0);
    $subject  = trim($b['subject'] ?? '');
    $bodyTxt  = trim($b['body'] ?? '');
    if ($driverId <= 0) errorResponse('driver_id required', 400);
    if ($bodyTxt === '') errorResponse('body required', 400);
    if (!in_array($leg, ['go', 'back'], true)) errorResponse('invalid leg', 400);
    // 送信先はサーバー側で admin_users から解決（任意アドレスへの送信を防止）
    $st = $pdo->prepare("SELECT username, display_name FROM ops_admin_users WHERE id = ? LIMIT 1");
    $st->execute([$driverId]);
    $drv = $st->fetch();
    if (!$drv) errorResponse('driver not found', 404);
    $to = trim($drv['username'] ?? '');
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) errorResponse('driver email not set', 422);
    if ($subject === '') $subject = 'YLKA 送迎情報';
    $subjEnc = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $headers = implode("\r\n", [
        'From: YLKA <relux@ylka.jp>',
        'Reply-To: relux@ylka.jp',
        'Content-Type: text/plain; charset=UTF-8',
        'X-Mailer: YLKA Dispatch',
    ]);
    $ok = @mail($to, $subjEnc, $bodyTxt, $headers, '-frelux@ylka.jp');
    if (!$ok) errorResponse('mail send failed', 500);
    // 送信済みを記録（タイムラインの色表示用）。leg に応じた列を更新
    if ($bkId > 0) {
        $col = $leg === 'go' ? 'pickup_go_mailed_at' : 'pickup_back_mailed_at';
        $pdo->prepare("UPDATE ops_bookings SET {$col} = NOW() WHERE id = ?")->execute([$bkId]);
    }
    jsonResponse(['ok' => true, 'to' => $to]);
}

if ($action === 'shift-time' && $method === 'POST') {
    // 開始・終了時刻を delta 分だけスライド（タイムラインの時間微調整）
    if (($_SESSION['ylka_admin_role'] ?? '') === 'driver') errorResponse('forbidden', 403);
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    $delta = (int)($b['delta'] ?? 0);
    if ($id <= 0 || $delta === 0 || abs($delta) > 240) errorResponse('invalid params', 400);
    $st = $pdo->prepare("SELECT start_time, end_time, pickup_go_time, pickup_back_time FROM ops_bookings WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) errorResponse('not found', 404);
    $toMin = function($t) { if (!$t) return null; $p = explode(':', $t); return (int)$p[0] * 60 + (int)$p[1]; };
    $fmt = function($m) { if ($m === null) return null; $m = max(0, $m); return sprintf('%02d:%02d:00', intdiv($m, 60), $m % 60); };
    $ns = $toMin($row['start_time']) + $delta;
    $ne = $toMin($row['end_time']) + $delta;
    if ($ns < 0) errorResponse('時刻が範囲外です', 400);
    // 送迎時刻も追従（設定がある場合のみ）
    $ngo = $row['pickup_go_time'] !== null ? $fmt($toMin($row['pickup_go_time']) + $delta) : null;
    $nback = $row['pickup_back_time'] !== null ? $fmt($toMin($row['pickup_back_time']) + $delta) : null;
    $pdo->prepare("UPDATE ops_bookings SET start_time = ?, end_time = ?, pickup_go_time = ?, pickup_back_time = ? WHERE id = ?")
        ->execute([$fmt($ns), $fmt($ne), $ngo, $nback, $id]);
    jsonResponse(['ok' => true, 'start_time' => $fmt($ns), 'end_time' => $fmt($ne)]);
}

if ($action === 'set-status' && $method === 'POST') {
    if (($_SESSION['ylka_admin_role'] ?? '') === 'driver') errorResponse('forbidden', 403);
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    $status = $b['status'] ?? '';
    if ($id <= 0 || !in_array($status, ['inquiry','reserved','pre_reserved','on_hold','completed','cancelled','no_show'], true)) {
        errorResponse('invalid params', 400);
    }
    $reason = $status === 'cancelled' ? trim($b['cancellation_reason'] ?? '') : null;
    $reasonType = $status === 'cancelled' && in_array($b['cancellation_reason_type'] ?? '', ['shop','therapist','customer','other'], true) ? $b['cancellation_reason_type'] : null;
    // お客様都合キャンセルのみキャンセル料・報酬を保存（他理由/非キャンセルは null＝計上対象外）
    $cancFee    = ($status === 'cancelled' && $reasonType === 'customer' && isset($b['cancellation_fee']) && $b['cancellation_fee'] !== '') ? max(0, (int)$b['cancellation_fee']) : null;
    $cancReward = ($status === 'cancelled' && $reasonType === 'customer' && isset($b['cancellation_reward']) && $b['cancellation_reward'] !== '') ? max(0, (int)$b['cancellation_reward']) : null;
    // 遷移前のステータスを取得（合流トグルでの二重カウント防止）
    $prev = $pdo->prepare("SELECT status, customer_id FROM ops_bookings WHERE id = ?");
    $prev->execute([$id]);
    $prevRow = $prev->fetch() ?: [];
    $wasCompleted = ($prevRow['status'] ?? '') === 'completed';
    $pdo->prepare("UPDATE ops_bookings SET status = ?, cancellation_reason = ?, cancellation_reason_type = ?, cancellation_fee = ?, cancellation_reward = ? WHERE id = ?")
        ->execute([$status, $reason ?: null, $reasonType, $cancFee, $cancReward, $id]);

    // 完了へ「初めて」遷移したときだけ顧客利用履歴を更新
    if ($status === 'completed' && !$wasCompleted) {
        $cid = (int)($prevRow['customer_id'] ?? 0);
        if ($cid > 0) {
            $pdo->prepare("UPDATE ops_customers SET visit_count = visit_count + 1, last_visit_at = NOW(),
                           first_visit_at = COALESCE(first_visit_at, NOW()) WHERE id = ?")->execute([$cid]);
        }
    }
    jsonResponse(['ok' => true]);
}

// 接客ライフサイクル: 未(pending) → 開始 → 始(started) → 終了 → 確(ended)
//   started = status 'completed'（経理計上は従来どおりこの時点）+ service_ended_at NULL
//   ended   = status 'completed' + service_ended_at に終了時刻
//   pending = status 'reserved' + service_ended_at NULL（巻き戻し）
// 権限: driver 不可。staff は「自分の予約のみ」かつ started/ended のみ（巻き戻し不可・一方通行）。
//        owner/manager/office は全 state 可（CTRL タイムライン権限）。
if ($action === 'set-note' && $method === 'POST') {
    $b  = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $note = trim($b['notes'] ?? '');
    $row = $pdo->prepare("SELECT assigned_admin_id, customer_id FROM ops_bookings WHERE id = ?");
    $row->execute([$id]);
    $cur = $row->fetch();
    if (!$cur) errorResponse('not found', 404);
    $role = $_SESSION['ylka_admin_role'] ?? '';
    // driver はメモ編集不可。staff は自分の担当予約のみ。owner/manager/office は全件可
    if ($role === 'driver') errorResponse('forbidden', 403);
    if ($role === 'staff' && (int)$cur['assigned_admin_id'] !== (int)($_SESSION['ylka_admin_id'] ?? 0)) errorResponse('forbidden', 403);
    // キャストの「お仕事メモ」は予約単位(bookings.notes)に保存。顧客紐づけメモ(customers.notes)はお店の顧客管理でのみ編集
    $pdo->prepare("UPDATE ops_bookings SET notes = ?, updated_at = NOW() WHERE id = ?")->execute([$note !== '' ? $note : null, $id]);
    jsonResponse(['ok' => true]);
}

if ($action === 'set-service' && $method === 'POST') {
    $role = $_SESSION['ylka_admin_role'] ?? '';
    $me   = (int)($_SESSION['ylka_admin_id'] ?? 0);
    if ($role === 'driver') errorResponse('forbidden', 403);
    $b  = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    $state = $b['state'] ?? '';
    if ($id <= 0 || !in_array($state, ['pending', 'started', 'ended'], true)) {
        errorResponse('invalid params', 400);
    }
    $row = $pdo->prepare("SELECT status, customer_id, assigned_admin_id, service_ended_at FROM ops_bookings WHERE id = ?");
    $row->execute([$id]);
    $cur = $row->fetch();
    if (!$cur) errorResponse('not found', 404);
    if (in_array($cur['status'], ['cancelled', 'no_show', 'inquiry'], true)) errorResponse('invalid status', 400);

    if ($role === 'staff') {
        if ((int)$cur['assigned_admin_id'] !== $me) errorResponse('forbidden', 403);
        if (!in_array($state, ['started', 'ended'], true)) errorResponse('forbidden', 403);
        // 一方通行: 始→確 のみ。巻き戻し（確→始, 始→未）は不可
        $isStarted = ($cur['status'] === 'completed');
        $isEnded   = $isStarted && !empty($cur['service_ended_at']);
        if ($state === 'started' && $isStarted) errorResponse('already started', 400);
        if ($state === 'ended' && !$isStarted) errorResponse('not started', 400);
        if ($state === 'ended' && $isEnded) errorResponse('already ended', 400);
    }

    $wasCompleted = ($cur['status'] === 'completed');
    if ($state === 'pending') {
        $pdo->prepare("UPDATE ops_bookings SET status = 'reserved', service_ended_at = NULL WHERE id = ?")->execute([$id]);
    } elseif ($state === 'started') {
        $pdo->prepare("UPDATE ops_bookings SET status = 'completed', service_ended_at = NULL WHERE id = ?")->execute([$id]);
    } else { // ended
        $pdo->prepare("UPDATE ops_bookings SET status = 'completed', service_ended_at = COALESCE(service_ended_at, NOW()) WHERE id = ?")->execute([$id]);
    }

    // 完了(=計上)へ初めて遷移したときだけ顧客利用履歴を更新（set-status と同条件）
    if (in_array($state, ['started', 'ended'], true) && !$wasCompleted) {
        $cid = (int)($cur['customer_id'] ?? 0);
        if ($cid > 0) {
            $pdo->prepare("UPDATE ops_customers SET visit_count = visit_count + 1, last_visit_at = NOW(),
                           first_visit_at = COALESCE(first_visit_at, NOW()) WHERE id = ?")->execute([$cid]);
        }
    }
    jsonResponse(['ok' => true, 'state' => $state]);
}

if ($action === 'delete' && $method === 'POST') {
    if (($_SESSION['ylka_admin_role'] ?? '') === 'driver') errorResponse('forbidden', 403);
    requireOwner();
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $pdo->prepare("DELETE FROM ops_bookings WHERE id = ?")->execute([$id]);
    jsonResponse(['ok' => true]);
}

errorResponse('invalid action', 400);
