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

/** 媒体・予約経路の正規化（許可キーのみ・重複除去・順序固定） */
function ops_normalize_media($raw): string {
    $allow = ['fujoho', 'ekichika', 'heaven', 'fuzoku', 'deli', 'other', 'line'];
    $in = is_array($raw) ? $raw : explode(',', (string)$raw);
    $in = array_map(static fn($s) => trim((string)$s), $in);
    return implode(',', array_values(array_intersect($allow, array_unique($in))));
}

$pdo    = getPdo();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

function bookingSelectColumns(): string {
    return "
        b.id, b.customer_id, b.customer_name_snapshot, b.customer_phone_snapshot, b.customer_email_snapshot,
        b.assigned_admin_id, b.driver_id, b.back_driver_id, b.hotel_id, b.hotel_name_snapshot, b.display_city, b.room_number,
        b.booking_date, b.start_time, b.end_time, b.pickup_go_time, b.pickup_back_time, b.pickup_go_mailed_at, b.pickup_back_mailed_at,
        b.course_name, b.nomination_type, b.nomination_fee, b.menu_items, b.price, b.hotel_price_applied, b.late_fee, b.transport_fee, b.payment_method, b.card_fee, b.card_paid_at, b.counseling, b.media, b.extension_count,
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
    // 過去の営業日かどうか（5:00〜翌5:00）。当日の仕事はフル住所が必要、過ぎたら番地は見せない
    $curBiz = date('H:i') < '05:00' ? date('Y-m-d', strtotime('-1 day')) : date('Y-m-d');
    foreach (array_keys($rows) as $i) {
        unset($rows[$i]['customer_phone'], $rows[$i]['customer_phone_snapshot'], $rows[$i]['customer_email_snapshot'], $rows[$i]['customer_notes']);
        // 自宅・その他の訪問先住所は、翌営業日以降 ○○市○○町 まで（番地・建物・部屋は非表示）。
        // 画面で隠すだけだと通信に残るので、APIの時点で落とす（セキュリティ・店長指定 2026-08-07）
        $bd = (string)($rows[$i]['booking_date'] ?? '');
        $st = (string)($rows[$i]['start_time'] ?? '');
        if ($bd !== '') {
            $biz = (substr($st, 0, 5) !== '' && substr($st, 0, 5) < '05:00')
                ? date('Y-m-d', strtotime($bd . ' -1 day')) : $bd;
            if ($biz < $curBiz) {
                $hn = (string)($rows[$i]['hotel_name_snapshot'] ?? '');
                foreach (['【自宅】', '【その他】'] as $pfx) {
                    if (str_starts_with($hn, $pfx)) {
                        $addr = substr($hn, strlen($pfx));
                        // 最初の数字（番地）以降を落とす。住所は半角数字に正規化済み
                        $masked = preg_replace('/[0-9０-９].*$/u', '', $addr);
                        $rows[$i]['hotel_name_snapshot'] = $pfx . rtrim(trim((string)$masked), '-－ー');
                        break;
                    }
                }
                if (isset($rows[$i]['room_number'])) $rows[$i]['room_number'] = '';
            }
        }
    }
    return $rows;
}

/**
 * 追い越しチェック（楽観ロック）。開いた時点の updated_at を添えて保存し、
 * その間に別端末が保存していたら 409 で止める。expected が空なら何もしない
 * （新規作成・タイムラインの連続操作）。updated_at は ON UPDATE current_timestamp() で自動更新。
 */
function opsGuardNotOvertaken(PDO $pdo, int $id, string $expected): void {
    if ($expected === '' || $id <= 0) return;
    $q = $pdo->prepare("SELECT updated_at FROM ops_bookings WHERE id = ?");
    $q->execute([$id]);
    $cur = (string)$q->fetchColumn();
    if ($cur !== '' && $cur !== $expected) {
        errorResponse('他の端末で更新されています。開き直して最新の内容を確認してください。', 409);
    }
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
    $out = ['bookings' => stripContactForStaff($stmt->fetchAll())];

    // キャストのマイページ用: リピーター表示（お店として何回目か / 自分と会ったことがあるか）。
    // 回数は予約ステータス基準（キャンセル・無連絡・問合せは数えない）＋旧システム実績(visit_count)
    if (!empty($_GET['with_repeat']) && currentUserRole() === 'staff') {
        $meId = currentUserId();
        $cids = array_values(array_unique(array_filter(array_map(fn($bk) => (int)($bk['customer_id'] ?? 0), $out['bookings']))));
        if ($cids !== []) {
            $in = implode(',', array_fill(0, count($cids), '?'));
            $agg = [];
            $q = $pdo->prepare(
                "SELECT customer_id,
                        COUNT(*) AS ops_cnt,
                        SUM(CASE WHEN assigned_admin_id = ? THEN 1 ELSE 0 END) AS with_me
                   FROM ops_bookings
                  WHERE customer_id IN ($in)
                    AND status NOT IN ('cancelled','no_show','inquiry')
                  GROUP BY customer_id"
            );
            $q->execute(array_merge([$meId], $cids));
            foreach ($q->fetchAll() as $r) $agg[(int)$r['customer_id']] = $r;
            $lv = $pdo->prepare("SELECT id, visit_count FROM ops_customers WHERE id IN ($in)");
            $lv->execute($cids);
            $legacy = [];
            foreach ($lv->fetchAll() as $r) $legacy[(int)$r['id']] = (int)$r['visit_count'];
            foreach (array_keys($out['bookings']) as $i) {
                $cid = (int)($out['bookings'][$i]['customer_id'] ?? 0);
                if (!$cid) continue;
                $a = $agg[$cid] ?? ['ops_cnt' => 0, 'with_me' => 0];
                $out['bookings'][$i]['repeat_shop_count'] = (int)$a['ops_cnt'] + ($legacy[$cid] ?? 0);
                $out['bookings'][$i]['repeat_with_me'] = (int)$a['with_me'];
            }
        }
    }

    // 旧システムから取り込んだ利用履歴も同じ一覧に混ぜる（include_legacy=1）。
    // ドライバー／キャストは自分の担当ぶんだけを見る画面なので対象外（旧履歴に担当の紐付けが無い）。
    $role = currentUserRole();
    if (!empty($_GET['include_legacy']) && !in_array($role, ['driver', 'staff'], true)) {
        $lw = []; $lp = [];
        if ($kw !== '') {
            $lw[] = '(c.name LIKE ? OR v.cast_name LIKE ? OR v.hotel_name LIKE ?)';
            $lp[] = "%{$kw}%"; $lp[] = "%{$kw}%"; $lp[] = "%{$kw}%";
        }
        if ($status !== '') { $lw[] = 'v.status = ?'; $lp[] = $status; }
        if ($date !== '')   { $lw[] = 'DATE(v.visit_at) = ?'; $lp[] = $date; }
        $lsql = "SELECT v.id, v.customer_id, v.visit_at, v.cast_name, v.course_name, v.total_price,
                        v.hotel_name, v.hotel_city, v.place_type, v.room, v.memo, v.status,
                        v.nominate_name, v.transport_fee, v.shop_name, c.name AS customer_name, c.phone AS customer_phone
                   FROM ops_legacy_visits v
                   LEFT JOIN ops_customers c ON c.id = v.customer_id
                 " . ($lw ? 'WHERE ' . implode(' AND ', $lw) : '') . "
                 ORDER BY v.visit_at DESC
                 LIMIT 200";
        $ls = $pdo->prepare($lsql);
        $ls->execute($lp);
        $out['legacy_visits'] = $ls->fetchAll();
    }
    jsonResponse($out);
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
    $out = ['bookings' => stripContactForStaff($stmt->fetchAll())];

    // 旧システムから取り込んだ利用履歴も同じ一覧に混ぜる（include_legacy=1）。
    // ドライバー／キャストは自分の担当ぶんだけを見る画面なので対象外（旧履歴に担当の紐付けが無い）。
    $role = currentUserRole();
    if (!empty($_GET['include_legacy']) && !in_array($role, ['driver', 'staff'], true)) {
        $lw = []; $lp = [];
        if ($kw !== '') {
            $lw[] = '(c.name LIKE ? OR v.cast_name LIKE ? OR v.hotel_name LIKE ?)';
            $lp[] = "%{$kw}%"; $lp[] = "%{$kw}%"; $lp[] = "%{$kw}%";
        }
        if ($status !== '') { $lw[] = 'v.status = ?'; $lp[] = $status; }
        if ($date !== '')   { $lw[] = 'DATE(v.visit_at) = ?'; $lp[] = $date; }
        $lsql = "SELECT v.id, v.customer_id, v.visit_at, v.cast_name, v.course_name, v.total_price,
                        v.hotel_name, v.hotel_city, v.place_type, v.room, v.memo, v.status,
                        v.nominate_name, v.transport_fee, v.shop_name, c.name AS customer_name, c.phone AS customer_phone
                   FROM ops_legacy_visits v
                   LEFT JOIN ops_customers c ON c.id = v.customer_id
                 " . ($lw ? 'WHERE ' . implode(' AND ', $lw) : '') . "
                 ORDER BY v.visit_at DESC
                 LIMIT 200";
        $ls = $pdo->prepare($lsql);
        $ls->execute($lp);
        $out['legacy_visits'] = $ls->fetchAll();
    }
    jsonResponse($out);
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
    // キャストには顧客連絡先(電話/メール)を返さない・過去の住所は番地を落とす（stripContactForStaff と同条件）
    if (currentUserRole() === 'staff') {
        $row = stripContactForStaff([$row])[0];
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
        // ホテル料金を適用したか。開いたときの復元とキャスト報酬の判定に使う
        // （金額からの逆算は指名料・オプションが増えるたびに壊れるので、事実として持つ）
        'hotel_price_applied'     => !empty($b['hotel_price_applied']) ? 1 : 0,
        'late_fee'                => max(0, (int)($b['late_fee'] ?? 0)),
        'transport_fee'           => isset($b['transport_fee']) && $b['transport_fee'] !== '' ? (int)$b['transport_fee'] : null,
        'payment_method'          => in_array($b['payment_method'] ?? '', ['cash','credit','bank'], true) ? $b['payment_method'] : null,
        // クレジットのときお客様の合計に上乗せした手数料額。現金/振込は0
        'card_fee'                => (($b['payment_method'] ?? '') === 'credit') ? max(0, (int)($b['card_fee'] ?? 0)) : 0,
        // 媒体・予約経路（複数可・カンマ区切り）。LINE予約のときだけ +10分(無料)
        'media'                   => ops_normalize_media($b['media'] ?? ''),
        // counseling は「+10分が付いたか」を表す既存フラグ。根拠は LINE予約に変わったので
        // media から導出して入れる（集計や旧表示が壊れないように残置）
        'counseling'              => in_array('line', explode(',', ops_normalize_media($b['media'] ?? '')), true) ? 1 : 0,
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

    // 決済確認: クレジットのときだけ持つ。日時は最初に確認した時点を保つ（付け外しで上書きしない）
    if (($b['payment_method'] ?? '') !== 'credit') {
        $fields['card_paid_at'] = null;
        $fields['card_paid_by'] = null;
    } elseif (array_key_exists('card_paid', $b)) {
        if (!empty($b['card_paid'])) {
            $wasPaid = null;
            if ($isUpdate) {
                $q = $pdo->prepare("SELECT card_paid_at FROM ops_bookings WHERE id = ?");
                $q->execute([$id]);
                $wasPaid = $q->fetchColumn() ?: null;
            }
            $fields['card_paid_at'] = $wasPaid ?: date('Y-m-d H:i:s');
            $fields['card_paid_by'] = currentUserId();
        } else {
            $fields['card_paid_at'] = null;
            $fields['card_paid_by'] = null;
        }
    }

    if ($isUpdate) {
        opsGuardNotOvertaken($pdo, $id, trim((string)($b['expected_updated_at'] ?? '')));
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
            // visit_count は「旧システムの実績」専用。OPSの予約は customers.php 側で毎回数えるので、
            // ここで足すと二重に数えられる（未に戻して始め直すたびに増えていた）。時刻だけ更新する。
            $pdo->prepare("UPDATE ops_customers SET last_visit_at = NOW(),
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
    opsGuardNotOvertaken($pdo, $id, trim((string)($b['expected_updated_at'] ?? '')));
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
            // visit_count は「旧システムの実績」専用。OPSの予約は customers.php 側で毎回数えるので、
            // ここで足すと二重に数えられる（未に戻して始め直すたびに増えていた）。時刻だけ更新する。
            $pdo->prepare("UPDATE ops_customers SET last_visit_at = NOW(),
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
    opsGuardNotOvertaken($pdo, $id, trim((string)($b['expected_updated_at'] ?? '')));
    $state = $b['state'] ?? '';
    if ($id <= 0 || !in_array($state, ['pending', 'started', 'ended'], true)) {
        errorResponse('invalid params', 400);
    }
    $row = $pdo->prepare("SELECT status, customer_id, assigned_admin_id, service_ended_at,
                                 booking_date, start_time, end_time, course_name, customer_name_snapshot
                            FROM ops_bookings WHERE id = ?");
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
        // キャスト本人が「▶開始」を押したら、押した時刻を実際の開始時刻として書き換える（店長指定 2026-08-07）。
        // 22:00予定を22:05に押せば 22:05 開始になり、終了時刻も同じぶん後ろへずれる。
        // 元の予定時刻は planned_start_time に一度だけ残す（何分押しだったか後から追える）。
        // 管理者がタイムラインから押す場合は既存の時刻ポップアップ（この時刻で始）があるため書き換えない。
        // 休憩行は対象外。
        $isBreakRow = ($cur['course_name'] === '休憩') || ($cur['customer_name_snapshot'] === '【休憩】');
        if ($role === 'staff' && !$isBreakRow && !empty($cur['booking_date']) && !empty($cur['start_time'])) {
            $tz = new DateTimeZone('Asia/Tokyo');
            $now = new DateTimeImmutable('now', $tz);
            $plannedStart = new DateTimeImmutable($cur['booking_date'] . ' ' . $cur['start_time'], $tz);
            $deltaSec = $now->getTimestamp() - $plannedStart->getTimestamp();
            // 予定から3時間超ずれた打鍵は押し忘れ・誤操作とみなし、時刻は書き換えず開始だけ記録する
            if (abs($deltaSec) > 3 * 3600) {
                $pdo->prepare("UPDATE ops_bookings SET status = 'completed', service_ended_at = NULL WHERE id = ?")->execute([$id]);
                $deltaSec = null;
            }
            if ($deltaSec !== null) {
                // 終了時刻は開始より前なら翌日跨ぎとして扱う
                $newEnd = null;
                if (!empty($cur['end_time'])) {
                    $end = new DateTimeImmutable($cur['booking_date'] . ' ' . $cur['end_time'], $tz);
                    if ($end <= $plannedStart) $end = $end->modify('+1 day');
                    $newEnd = $end->modify(($deltaSec >= 0 ? '+' : '') . $deltaSec . ' seconds');
                }
                $pdo->prepare("UPDATE ops_bookings SET status = 'completed', service_ended_at = NULL,
                                 planned_start_time = COALESCE(planned_start_time, start_time),
                                 booking_date = ?, start_time = ?, end_time = ?
                               WHERE id = ?")->execute([
                    $now->format('Y-m-d'),
                    $now->format('H:i:00'),
                    $newEnd ? $newEnd->format('H:i:00') : $cur['end_time'],
                    $id,
                ]);
            }
        } else {
            $pdo->prepare("UPDATE ops_bookings SET status = 'completed', service_ended_at = NULL WHERE id = ?")->execute([$id]);
        }
    } else { // ended
        $pdo->prepare("UPDATE ops_bookings SET status = 'completed', service_ended_at = COALESCE(service_ended_at, NOW()) WHERE id = ?")->execute([$id]);
    }

    // 完了(=計上)へ初めて遷移したときだけ顧客利用履歴を更新（set-status と同条件）
    if (in_array($state, ['started', 'ended'], true) && !$wasCompleted) {
        $cid = (int)($cur['customer_id'] ?? 0);
        if ($cid > 0) {
            // visit_count は「旧システムの実績」専用。OPSの予約は customers.php 側で毎回数えるので、
            // ここで足すと二重に数えられる（未に戻して始め直すたびに増えていた）。時刻だけ更新する。
            $pdo->prepare("UPDATE ops_customers SET last_visit_at = NOW(),
                           first_visit_at = COALESCE(first_visit_at, NOW()) WHERE id = ?")->execute([$cid]);
        }
    }
    jsonResponse(['ok' => true, 'state' => $state]);
}

// =================================================================
// 編集ロック: 予約編集モーダルを開いている端末を記録し、別端末の同時編集を防ぐ。
// クライアントは開いている間 30秒ごとに lock を呼び直して延長し、
// 90秒延長が来なければ自動失効（ブラウザを閉じた・スリープ等でロックが残らないように）。
// すり抜けた場合の砦は opsGuardNotOvertaken（保存時の追い越しチェック）。
// =================================================================
if ($action === 'lock' && $method === 'POST') {
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    $token = substr(trim((string)($b['token'] ?? '')), 0, 64);
    if ($id <= 0 || $token === '') errorResponse('invalid params', 400);
    $pdo->prepare("DELETE FROM ops_booking_locks WHERE renewed_at < NOW() - INTERVAL 90 SECOND")->execute();
    $cur = $pdo->prepare("SELECT session_token, locked_by_name FROM ops_booking_locks WHERE booking_id = ?");
    $cur->execute([$id]);
    $row = $cur->fetch();
    if ($row && $row['session_token'] !== $token) {
        jsonResponse(['ok' => false, 'locked_by' => $row['locked_by_name'] ?: '別の端末']);
    }
    $uid = currentUserId();
    $name = '';
    if ($uid > 0) {
        $nq = $pdo->prepare("SELECT display_name FROM ops_admin_users WHERE id = ?");
        $nq->execute([$uid]);
        $name = (string)$nq->fetchColumn();
    }
    $pdo->prepare("INSERT INTO ops_booking_locks (booking_id, session_token, locked_by, locked_by_name, locked_at, renewed_at)
                   VALUES (?, ?, ?, ?, NOW(), NOW())
                   ON DUPLICATE KEY UPDATE session_token = VALUES(session_token), locked_by = VALUES(locked_by),
                                           locked_by_name = VALUES(locked_by_name), renewed_at = NOW()")
        ->execute([$id, $token, $uid ?: null, $name ?: null]);
    jsonResponse(['ok' => true]);
}

if ($action === 'unlock' && $method === 'POST') {
    // モーダルを閉じたとき・ページを離れるとき（sendBeacon）に呼ばれる
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    $token = substr(trim((string)($b['token'] ?? '')), 0, 64);
    if ($id > 0 && $token !== '') {
        $pdo->prepare("DELETE FROM ops_booking_locks WHERE booking_id = ? AND session_token = ?")->execute([$id, $token]);
    }
    jsonResponse(['ok' => true]);
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
