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
//   GET  ?action=find-by-phone&phone=  電話番号で1件特定（リピーター判定用・NG情報つき）
//
// NG登録（2026-08-03）:
//   ng_level 0=通常 / 1=要注意 / 2=出禁（お店として受けるか）
//   ops_customer_ng_casts = このお客様に出さないキャスト（予約のキャスト選択で警告）
//   これまで「お客様メモ」に文章で書いていたものを、予約を取る瞬間に機械的に出せるようにしたもの。
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
        // 住所は表記ゆれ（全角/ハイフン/空白）を吸収するため location_norm で突き合わせる。
        // 電話はハイフン付きで打たれても当たるよう数字のみでも比較。メモ（旧IDや媒体を保全）も対象。
        $kwAddr = opsNormAddress($kw);
        // 電話のゆれ吸収は「電話番号らしい入力」のときだけ。住所（例: 立川市錦町6-4-10）から
        // 数字を抜くと "6410" になり、無関係な番号に部分一致してしまう
        $kwPhone = preg_match('/^[0-9０-９\-\s()（）＋+]+$/u', $kw) ? opsNormPhone($kw) : '';
        $where[] = '(c.name LIKE ? OR c.name_kana LIKE ? OR c.phone LIKE ? OR c.phone2 LIKE ? OR c.email LIKE ?'
                 . ' OR c.default_location LIKE ? OR c.default_location2 LIKE ?'
                 . ($kwAddr  !== '' ? ' OR c.location_norm LIKE ? OR c.location_norm2 LIKE ?' : '')
                 . ($kwPhone !== '' ? ' OR c.phone LIKE ? OR c.phone2 LIKE ?' : '')
                 . ' OR c.notes LIKE ? OR c.ng_reason LIKE ?)';
        $params[] = "%{$kw}%"; $params[] = "%{$kw}%"; $params[] = "%{$kw}%"; $params[] = "%{$kw}%"; $params[] = "%{$kw}%";
        $params[] = "%{$kw}%"; $params[] = "%{$kw}%";
        if ($kwAddr  !== '') { $params[] = "%{$kwAddr}%";  $params[] = "%{$kwAddr}%"; }
        if ($kwPhone !== '') { $params[] = "%{$kwPhone}%"; $params[] = "%{$kwPhone}%"; }
        $params[] = "%{$kw}%";   // notes
        $params[] = "%{$kw}%";   // ng_reason
    }
    // 利用回数 = 旧システムの実績(visit_count) ＋ OPSの予約(キャンセル/無連絡を除く)。
    //   visit_count は import-ops-visits.php が ops_legacy_visits の完了実績から再計算した値。
    //   OPS分は customer_id 直接紐付け + 電話番号一致（レガシー未紐付け対策）の両方を数える。
    // 日付で絞る: visit_date=YYYY-MM-DD（その日に利用があったお客様）。
    // OPSの予約と旧システムの利用履歴の両方を見る（範囲は visit_date_to で指定可）。
    $vFrom = trim($_GET['visit_date'] ?? '');
    $vTo   = trim($_GET['visit_date_to'] ?? '') ?: $vFrom;
    if ($vFrom !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $vFrom) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $vTo)) {
        $where[] = '(EXISTS (SELECT 1 FROM ops_bookings bd
                              WHERE (bd.customer_id = c.id
                                     OR (c.phone IS NOT NULL AND c.phone <> \'\' AND bd.customer_phone_snapshot = c.phone))
                                AND bd.booking_date BETWEEN ? AND ?
                                AND bd.status NOT IN (\'cancelled\',\'no_show\'))
                    OR EXISTS (SELECT 1 FROM ops_legacy_visits lvd
                              WHERE lvd.customer_id = c.id
                                AND DATE(lvd.visit_at) BETWEEN ? AND ?
                                AND lvd.status = \'completed\'))';
        $params[] = $vFrom; $params[] = $vTo; $params[] = $vFrom; $params[] = $vTo;
    }
    // NG絞り込み: ng=ng → 出禁/要注意のみ（キャスト別NGだけの人も拾う）
    // ng=ng   … NG登録がある人（出禁/要注意 or キャスト別NG）
    // ng=memo … メモに「NG」「出禁」等が書かれている人。旧システムから移行した注意情報は
    //           NG欄ではなくメモの文章として入っているため、こちらでないと拾えない
    $ngMode = $_GET['ng'] ?? '';
    if ($ngMode === 'ng') {
        $where[] = '(c.ng_level > 0 OR EXISTS (SELECT 1 FROM ops_customer_ng_casts nc WHERE nc.customer_id = c.id))';
    } elseif ($ngMode === 'memo') {
        $where[] = "(c.ng_level > 0 OR EXISTS (SELECT 1 FROM ops_customer_ng_casts nc WHERE nc.customer_id = c.id)"
                 . " OR c.notes LIKE '%NG%' OR c.notes LIKE '%ng%' OR c.notes LIKE '%出禁%'"
                 . " OR c.notes LIKE '%要注意%' OR c.notes LIKE '%注意%' OR c.ng_reason <> '')";
    }
    // 並び順: recent=最近の利用（既定） / count=利用回数
    $sort = ($_GET['sort'] ?? 'recent') === 'count' ? 'count' : 'recent';
    $orderBy = $sort === 'count'
        ? 'total_visits DESC, c.last_visit_at DESC, c.id DESC'
        // last_visit_at が NULL（利用実績なし）は末尾へ
        : 'c.last_visit_at IS NULL, c.last_visit_at DESC, c.id DESC';
    $bookingCountSql = "(SELECT COUNT(DISTINCT b.id) FROM ops_bookings b
                           WHERE (b.customer_id = c.id
                                  OR (c.phone IS NOT NULL AND c.phone <> '' AND b.customer_phone_snapshot = c.phone))
                             AND b.status NOT IN ('cancelled','no_show'))";
    // 直近に使ったホテル。OPSの予約があればそちらが新しい（旧実績は2026-07まで）ので優先。
    // 自宅派遣のお客様は空になるので、画面側は住所→ホテルの順に出す。
    $lastHotelSql = "COALESCE(
        (SELECT COALESCE(NULLIF(h2.name, ''), b2.hotel_name_snapshot) FROM ops_bookings b2
           LEFT JOIN ops_hotels h2 ON h2.id = b2.hotel_id
          WHERE b2.customer_id = c.id AND (b2.hotel_id IS NOT NULL OR b2.hotel_name_snapshot <> '')
          ORDER BY b2.booking_date DESC, b2.start_time DESC LIMIT 1),
        (SELECT CONCAT_WS(' ', lv.hotel_city, lv.hotel_name) FROM ops_legacy_visits lv
          WHERE lv.customer_id = c.id AND lv.place_type = 'hotel' AND lv.hotel_name <> ''
          ORDER BY lv.visit_at DESC LIMIT 1))";
    $sql = "SELECT c.id, c.name, c.name_kana, c.phone, c.phone2, c.email, c.gender, c.default_hotel_id,
                   c.default_location, c.default_location2,
                   c.visit_count, c.last_visit_at, c.created_at,
                   c.ng_level, c.ng_reason,
                   (SELECT COUNT(*) FROM ops_customer_ng_casts nc WHERE nc.customer_id = c.id) AS ng_cast_count,
                   {$lastHotelSql} AS last_hotel,
                   {$bookingCountSql} AS actual_booking_count,
                   (COALESCE(c.visit_count, 0) + {$bookingCountSql}) AS total_visits
            FROM ops_customers c
            " . ($where ? 'WHERE ' . implode(' AND ', $where) : '') . "
            ORDER BY {$orderBy}
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

    // 旧システムの利用履歴（2017-10〜2026-07 取り込み分。import-ops-visits.php 参照）
    $legacyVisits = [];
    try {
        $lv = $pdo->prepare("SELECT visit_at, cast_name, course_name, course_minutes,
                                    total_price, hotel_name, hotel_city, place_type, room, memo, status,
                                    shop_name, nominate_name, transport_fee
                             FROM ops_legacy_visits WHERE customer_id = ?
                             ORDER BY visit_at DESC LIMIT 400");
        $lv->execute([$id]);
        $legacyVisits = $lv->fetchAll();
    } catch (Throwable $e) { /* テーブル無し */ }

    // このお客様に出さないキャスト（退職などで消えた分は JOIN で落ちる）
    $ng = $pdo->prepare("SELECT nc.cast_admin_id, nc.reason, au.display_name
                         FROM ops_customer_ng_casts nc
                         JOIN ops_admin_users au ON au.id = nc.cast_admin_id
                         WHERE nc.customer_id = ?
                         ORDER BY au.sort_order, au.id");
    $ng->execute([$id]);

    // ご利用回数は「実際のオーダー」から数える（保存カウンタは使わない）。
    // キャンセル・無連絡は利用に数えない＝そのキャストとは会っていない扱い（店長方針 2026-08-05）。
    // 一覧の LIMIT に左右されないよう、件数だけはSQLで数えて返す。
    $uq = $pdo->prepare("SELECT
        (SELECT COUNT(*) FROM ops_legacy_visits l
          WHERE l.customer_id = ? AND l.status NOT IN ('cancelled','no_show')) AS legacy_used,
        (SELECT COUNT(DISTINCT b.id) FROM ops_bookings b
          WHERE (b.customer_id = ? OR (? <> '' AND b.customer_phone_snapshot = ?))
            AND b.status NOT IN ('cancelled','no_show','inquiry')) AS ops_used");
    $uq->execute([$id, $id, $phone, $phone]);
    $usage = $uq->fetch() ?: ['legacy_used' => 0, 'ops_used' => 0];

    jsonResponse([
        'customer'      => $cust,
        'usage'         => ['legacy' => (int)$usage['legacy_used'], 'ops' => (int)$usage['ops_used']],
        'bookings'      => $bs->fetchAll(),
        'legacy_visits' => $legacyVisits,
        'chat_sessions' => $chatSessions,
        'ng_casts'      => $ng->fetchAll(),
    ]);
}

/**
 * NGキャストを丸ごと入れ替える。理由は既存分を引き継ぐ（画面から理由だけ消えないように）。
 * $ids は ops_admin_users.id の配列。実在しないIDは黙って捨てる。
 */
function opsSaveNgCasts(PDO $pdo, int $customerId, array $ids): void {
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
    $prev = [];
    $q = $pdo->prepare("SELECT cast_admin_id, reason FROM ops_customer_ng_casts WHERE customer_id = ?");
    $q->execute([$customerId]);
    foreach ($q->fetchAll() as $r) $prev[(int)$r['cast_admin_id']] = $r['reason'];

    $pdo->prepare("DELETE FROM ops_customer_ng_casts WHERE customer_id = ?")->execute([$customerId]);
    if (!$ids) return;
    $ok  = $pdo->prepare("SELECT 1 FROM ops_admin_users WHERE id = ?");
    $ins = $pdo->prepare("INSERT INTO ops_customer_ng_casts (customer_id, cast_admin_id, reason, created_at)
                          VALUES (?, ?, ?, NOW())");
    foreach ($ids as $cid) {
        $ok->execute([$cid]);
        if (!$ok->fetchColumn()) continue;
        $ins->execute([$customerId, $cid, $prev[$cid] ?? null]);
    }
}

if ($action === 'find-by-phone' && $method === 'GET') {
    $phone = trim($_GET['phone'] ?? '');
    if ($phone === '') errorResponse('phone required', 400);
    // 入力のハイフン・全角の有無に関わらず同じ顧客に当てる（opsNormPhone で数字のみに揃える）。
    // 保存済み側に区切りが混ざっていても拾えるよう、列側も除去して比較する。
    $digits = opsNormPhone($phone);
    if ($digits === '') { jsonResponse(['customer' => null]); }
    // 2台持ちのお客様がいるため phone / phone2 の両方で引き当てる
    $stmt = $pdo->prepare("SELECT * FROM ops_customers
                            WHERE " . opsPhoneMatchSql('phone') . " OR " . opsPhoneMatchSql('phone2') . "
                            ORDER BY visit_count DESC, id LIMIT 1");
    $stmt->execute([$digits, $digits]);
    $cust = $stmt->fetch() ?: null;
    // 予約を取る瞬間に警告を出すため、NGキャストのIDもここで返す（追加の往復をさせない）
    $ngCastIds = [];
    if ($cust) {
        $ng = $pdo->prepare("SELECT cast_admin_id FROM ops_customer_ng_casts WHERE customer_id = ?");
        $ng->execute([(int)$cust['id']]);
        $ngCastIds = array_map('intval', $ng->fetchAll(PDO::FETCH_COLUMN));
    }
    jsonResponse(['customer' => $cust, 'ng_cast_ids' => $ngCastIds]);
}

if ($action === 'create' && $method === 'POST') {
    $b = readJsonBody();
    $name = trim($b['name'] ?? '');
    if ($name === '') errorResponse('name required', 400);
    $loc  = trim($b['default_location'] ?? '');
    $loc2 = trim($b['default_location2'] ?? '');
    $ngLevel = max(0, min(2, (int)($b['ng_level'] ?? 0)));
    $stmt = $pdo->prepare("INSERT INTO ops_customers
        (name, name_kana, phone, phone2, email, gender, default_hotel_id,
         default_location, location_norm, default_location2, location_norm2, notes,
         ng_level, ng_reason, ng_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([
        $name,
        trim($b['name_kana'] ?? '') ?: null,
        opsNormPhone($b['phone'] ?? '') ?: null,    // 数字のみで保存（同一顧客判定のキー）
        opsNormPhone($b['phone2'] ?? '') ?: null,   // 2台持ち用。照合は phone / phone2 の両方で行う
        trim($b['email'] ?? '') ?: null,
        $b['gender'] ?? null,
        !empty($b['default_hotel_id']) ? (int)$b['default_hotel_id'] : null,
        $loc ?: null,
        opsNormAddress($loc) ?: null,   // 検索用（表記ゆれ吸収）。表示は default_location が正
        $loc2 ?: null,
        opsNormAddress($loc2) ?: null,
        trim($b['notes'] ?? '') ?: null,
        $ngLevel,
        $ngLevel > 0 ? (trim($b['ng_reason'] ?? '') ?: null) : null,
        $ngLevel > 0 ? date('Y-m-d H:i:s') : null,
    ]);
    $newId = (int)$pdo->lastInsertId();
    if (array_key_exists('ng_cast_ids', $b)) opsSaveNgCasts($pdo, $newId, (array)$b['ng_cast_ids']);
    jsonResponse(['ok' => true, 'id' => $newId]);
}

if ($action === 'update' && $method === 'POST') {
    $b  = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $allow = ['name','name_kana','phone','phone2','email','gender','default_hotel_id',
              'default_location','default_location2','notes','pledge_images','ng_reason'];
    $cols  = []; $vals = [];
    foreach ($allow as $k) {
        if (array_key_exists($k, $b)) {
            $cols[]  = "$k = ?";
            $v = $b[$k];
            if ($k === 'default_hotel_id') $v = $v ? (int)$v : null;
            elseif ($k === 'phone' || $k === 'phone2') { $v = opsNormPhone(is_string($v) ? $v : ''); if ($v === '') $v = null; }
            elseif (is_string($v)) { $v = trim($v); if ($v === '') $v = null; }
            $vals[] = $v;
        }
    }
    if (array_key_exists('default_location', $b)) {
        $cols[] = 'location_norm = ?';
        $vals[] = opsNormAddress(is_string($b['default_location']) ? $b['default_location'] : '') ?: null;
    }
    if (array_key_exists('default_location2', $b)) {
        $cols[] = 'location_norm2 = ?';
        $vals[] = opsNormAddress(is_string($b['default_location2']) ? $b['default_location2'] : '') ?: null;
    }
    // NG区分。0に戻したら理由と日時も消す。0→1/2 になったときだけ ng_at を打つ（登録日を保つ）
    if (array_key_exists('ng_level', $b)) {
        $lv = max(0, min(2, (int)$b['ng_level']));
        $cur = $pdo->prepare("SELECT ng_level FROM ops_customers WHERE id = ?");
        $cur->execute([$id]);
        $was = (int)$cur->fetchColumn();
        $cols[] = 'ng_level = ?'; $vals[] = $lv;
        if ($lv === 0) { $cols[] = 'ng_reason = NULL'; $cols[] = 'ng_at = NULL'; }
        elseif ($was === 0) { $cols[] = 'ng_at = ?'; $vals[] = date('Y-m-d H:i:s'); }
    }
    if (array_key_exists('ng_cast_ids', $b)) opsSaveNgCasts($pdo, $id, (array)$b['ng_cast_ids']);
    if (!$cols) { jsonResponse(['ok' => true]); }
    $vals[] = $id;
    $pdo->prepare("UPDATE ops_customers SET " . implode(', ', $cols) . " WHERE id = ?")->execute($vals);
    jsonResponse(['ok' => true]);
}

if ($action === 'delete' && $method === 'POST') {
    requireOwner();
    $b  = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $pdo->prepare("DELETE FROM ops_customer_ng_casts WHERE customer_id = ?")->execute([$id]);
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
