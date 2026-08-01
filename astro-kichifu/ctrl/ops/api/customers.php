<?php
// ==========================================================================
// customers.php — 顧客管理API（要認証）
//
// Actions:
//   GET  ?action=list&keyword=         一覧（電話/名前/メール部分一致）
//   GET  ?action=get&id=               詳細 + 過去予約
//   POST ?action=create                {name, name_kana, phone, email, gender, default_hotel_id, default_location, notes}
//   POST ?action=update                {id, ...}
//   POST ?action=delete                {id}
//   GET  ?action=find-by-phone&phone=  電話番号で1件特定（リピーター判定用）
// ==========================================================================
require_once __DIR__ . '/auth-guard.php';

$pdo    = getPdo();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($action === 'list' && $method === 'GET') {
    $kw = trim($_GET['keyword'] ?? '');
    $where = [];
    $params = [];
    if ($kw !== '') {
        $where[] = '(c.name LIKE ? OR c.name_kana LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)';
        $params[] = "%{$kw}%"; $params[] = "%{$kw}%"; $params[] = "%{$kw}%"; $params[] = "%{$kw}%";
    }
    // visit_count はレガシー値. 実際の予約件数 (キャンセル/無連絡を除く) を集計して返す
    // customer_id 直接紐付け + 電話番号一致 (レガシー未紐付け対策) の両方をカウント
    $sql = "SELECT c.id, c.name, c.name_kana, c.phone, c.email, c.gender, c.default_hotel_id, c.default_location,
                   c.visit_count, c.last_visit_at, c.created_at,
                   (SELECT COUNT(DISTINCT b.id) FROM ops_bookings b
                      WHERE (b.customer_id = c.id
                             OR (c.phone IS NOT NULL AND c.phone <> '' AND b.customer_phone_snapshot = c.phone))
                        AND b.status NOT IN ('cancelled','no_show')) AS actual_booking_count
            FROM ops_customers c
            " . ($where ? 'WHERE ' . implode(' AND ', $where) : '') . "
            ORDER BY c.last_visit_at DESC, c.id DESC
            LIMIT 500";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    jsonResponse(['customers' => $stmt->fetchAll()]);
}

if ($action === 'get' && $method === 'GET') {
    $id = (int)($_GET['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $stmt = $pdo->prepare("SELECT c.*, h.name AS default_hotel_name
                           FROM ops_customers c
                           LEFT JOIN ops_hotels h ON h.id = c.default_hotel_id
                           WHERE c.id = ?");
    $stmt->execute([$id]);
    $cust = $stmt->fetch();
    if (!$cust) errorResponse('not found', 404);

    // 過去予約: customer_id 直接紐付け + 電話一致でも拾う (レガシー対策)
    $phone = (string)($cust['phone'] ?? '');
    $bs = $pdo->prepare("SELECT b.id, b.booking_date, b.start_time, b.end_time, b.course_name,
                                b.nomination_type, b.price, b.transport_fee, b.notes,
                                b.status, b.hotel_name_snapshot, h.name AS hotel_name,
                                au.display_name AS staff_name, b.customer_id
                         FROM ops_bookings b
                         LEFT JOIN ops_hotels h ON h.id = b.hotel_id
                         LEFT JOIN ops_admin_users au ON au.id = b.assigned_admin_id
                         WHERE b.customer_id = ?
                            OR (? <> '' AND b.customer_phone_snapshot = ?)
                         ORDER BY b.booking_date DESC, b.start_time DESC LIMIT 50");
    $bs->execute([$id, $phone, $phone]);

    // 自動修復: 電話一致だが customer_id 未設定の bookings を当該顧客に紐付け
    if ($phone !== '') {
        $pdo->prepare("UPDATE ops_bookings SET customer_id = ?
                       WHERE customer_id IS NULL
                         AND customer_phone_snapshot = ?")->execute([$id, $phone]);
    }

    // チャット履歴: この顧客に紐付く予約経由 (booking.customer_id = ?) で chat_sessions を抽出
    // + 電話番号一致の booking_id 経由でも検索 (legacy で customer_id 未設定の booking がある場合)
    // admi 移植: chat_sessions テーブルは admi 共有DBに無い（YobuChat未連携）→ 空で返す
    $chatSessions = [];
    try {
        $cs = $pdo->prepare("SELECT s.id, s.session_token, s.visitor_name, s.status, s.created_at, s.updated_at,
                                    s.booking_id,
                                    (SELECT body FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) AS last_message
                             FROM chat_sessions s
                             INNER JOIN ops_bookings b ON b.id = s.booking_id
                             WHERE b.customer_id = ?
                                OR (b.customer_phone_snapshot IS NOT NULL AND b.customer_phone_snapshot = ?)
                             GROUP BY s.id
                             ORDER BY s.updated_at DESC LIMIT 30");
        $cs->execute([$id, (string)($cust['phone'] ?? '')]);
        $chatSessions = $cs->fetchAll();
    } catch (Throwable $e) { /* テーブル無し */ }

    jsonResponse([
        'customer'      => $cust,
        'bookings'      => $bs->fetchAll(),
        'chat_sessions' => $chatSessions,
    ]);
}

if ($action === 'find-by-phone' && $method === 'GET') {
    $phone = trim($_GET['phone'] ?? '');
    if ($phone === '') errorResponse('phone required', 400);
    // 入力のハイフン・全角の有無に関わらず同じ顧客に当てる（opsNormPhone で数字のみに揃える）。
    // 保存済み側に区切りが混ざっていても拾えるよう、列側も除去して比較する。
    $digits = opsNormPhone($phone);
    if ($digits === '') { jsonResponse(['customer' => null]); }
    $stmt = $pdo->prepare("SELECT * FROM ops_customers WHERE " . opsPhoneMatchSql('phone') . " ORDER BY visit_count DESC, id LIMIT 1");
    $stmt->execute([$digits]);
    jsonResponse(['customer' => $stmt->fetch() ?: null]);
}

if ($action === 'create' && $method === 'POST') {
    $b = readJsonBody();
    $name = trim($b['name'] ?? '');
    if ($name === '') errorResponse('name required', 400);
    $stmt = $pdo->prepare("INSERT INTO ops_customers
        (name, name_kana, phone, email, gender, default_hotel_id, default_location, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([
        $name,
        trim($b['name_kana'] ?? '') ?: null,
        opsNormPhone($b['phone'] ?? '') ?: null,   // 数字のみで保存（同一顧客判定のキー）
        trim($b['email'] ?? '') ?: null,
        $b['gender'] ?? null,
        !empty($b['default_hotel_id']) ? (int)$b['default_hotel_id'] : null,
        trim($b['default_location'] ?? '') ?: null,
        trim($b['notes'] ?? '') ?: null,
    ]);
    jsonResponse(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

if ($action === 'update' && $method === 'POST') {
    $b  = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $allow = ['name','name_kana','phone','email','gender','default_hotel_id','default_location','notes','pledge_images'];
    $cols  = []; $vals = [];
    foreach ($allow as $k) {
        if (array_key_exists($k, $b)) {
            $cols[]  = "$k = ?";
            $v = $b[$k];
            if ($k === 'default_hotel_id') $v = $v ? (int)$v : null;
            elseif ($k === 'phone') { $v = opsNormPhone(is_string($v) ? $v : ''); if ($v === '') $v = null; }
            elseif (is_string($v)) { $v = trim($v); if ($v === '') $v = null; }
            $vals[] = $v;
        }
    }
    if (!$cols) errorResponse('nothing to update', 400);
    $vals[] = $id;
    $pdo->prepare("UPDATE ops_customers SET " . implode(', ', $cols) . " WHERE id = ?")->execute($vals);
    jsonResponse(['ok' => true]);
}

if ($action === 'delete' && $method === 'POST') {
    requireOwner();
    $b  = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $pdo->prepare("DELETE FROM ops_customers WHERE id = ?")->execute([$id]);
    jsonResponse(['ok' => true]);
}

// 会員証リンク発行（未発行ならトークン生成）
if ($action === 'member-link' && $method === 'POST') {
    $b  = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $st = $pdo->prepare("SELECT member_token FROM ops_customers WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) errorResponse('not found', 404);
    $token = $row['member_token'];
    if (empty($token)) {
        $token = bin2hex(random_bytes(10));  // 20文字
        $pdo->prepare("UPDATE ops_customers SET member_token = ? WHERE id = ?")->execute([$token, $id]);
    }
    jsonResponse(['ok' => true, 'token' => $token, 'url' => 'https://ylka.jp/member.html?t=' . $token]);
}

errorResponse('invalid action', 400);
