<?php
// ==========================================================================
// admin-api.php — 管理画面用 ホテル情報CRUD（要セッション認証）
//
// Actions:
//   GET  ?action=hotels&city=&keyword=&status=        管理用ホテル一覧
//   GET  ?action=stats                                統計（visited/inquiry/unavailable/unset）
//   GET  ?action=cities                               市区町村一覧+件数
//   POST ?action=update-info                          {hotel_id, status, entry_method, guide_note, internal_memo, room_type_recommended}
//   POST ?action=bulk-status                          {hotel_ids: [], status: 'visited'|'inquiry'|'unavailable'|null}
//
// Status:
//   visited      ご案内実績あり
//   inquiry      ホテルに問い合わせいたします
//   unavailable  ご案内不可
//   NULL         未設定
// ==========================================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/_ctrl-session.php';   // CTRL のログインを流用（ops 独自ログインは廃止）
require_once __DIR__ . '/_cast-sync.php';      // CTRL の girls → ops のキャスト行へ同期

setCorsHeaders();

if (!ops_current_user()) {
    errorResponse('unauthorized', 401);
}

function requireOwner(): void {
    if (($_SESSION['ylka_admin_role'] ?? '') !== 'owner') {
        errorResponse('owner role required', 403);
    }
}

function requireOwnerOrManager(): void {
    if (!in_array($_SESSION['ylka_admin_role'] ?? '', ['owner', 'manager'], true)) {
        errorResponse('owner or manager role required', 403);
    }
}

$pdo    = getPdo();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($action === 'hotels' && $method === 'GET') {
    $city    = trim($_GET['city'] ?? '');
    $keyword = trim($_GET['keyword'] ?? '');
    $status  = trim($_GET['status'] ?? '');  // ''=all, 'visited', 'inquiry', 'unavailable', 'unset'

    $where  = ['h.is_published = 1'];
    $params = [];
    if ($city !== '') {
        $where[]  = 'h.city = ?';
        $params[] = $city;
    }
    if ($keyword !== '') {
        $where[]  = '(h.name LIKE ? OR h.address LIKE ?)';
        $params[] = "%{$keyword}%";
        $params[] = "%{$keyword}%";
    }
    if (in_array($status, ['visited', 'inquiry', 'unavailable'], true)) {
        $where[]  = 'yhi.status = ?';
        $params[] = $status;
    } elseif ($status === 'unset') {
        $where[] = 'yhi.status IS NULL';
    }

    $sql = "SELECT
                h.id, h.name, h.address, h.city, h.major_area, h.detail_area,
                h.hotel_type, h.nearest_station, h.tel, h.latitude, h.longitude,
                yhi.status,
                yhi.entry_method,
                yhi.transport_fee,
                yhi.guide_note,
                yhi.internal_memo,
                yhi.room_type_recommended,
                COALESCE(yhi.visited_count, 0) AS visited_count,
                yhi.updated_at AS info_updated_at
            FROM ops_hotels h
            LEFT JOIN ops_ylka_hotel_info yhi ON yhi.hotel_id = h.id
            WHERE " . implode(' AND ', $where) . "
            ORDER BY FIELD(yhi.status, 'visited', 'inquiry', 'unavailable') ASC, h.city, h.name
            LIMIT 500";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    jsonResponse(['hotels' => $stmt->fetchAll()]);
}

if ($action === 'stats') {
    $row = $pdo->query("
        SELECT
            (SELECT COUNT(*) FROM ops_hotels WHERE is_published = 1) AS total,
            (SELECT COUNT(*) FROM ops_ylka_hotel_info WHERE status = 'visited') AS visited,
            (SELECT COUNT(*) FROM ops_ylka_hotel_info WHERE status = 'inquiry') AS inquiry,
            (SELECT COUNT(*) FROM ops_ylka_hotel_info WHERE status = 'unavailable') AS unavailable,
            (SELECT COUNT(*) FROM ops_hotels h LEFT JOIN ops_ylka_hotel_info yhi ON yhi.hotel_id = h.id
             WHERE h.is_published = 1 AND yhi.status IS NULL) AS unset
    ")->fetch();
    jsonResponse($row);
}

if ($action === 'cities') {
    try {
        $rows = $pdo->query("
            SELECT h.city,
                   COUNT(*) AS total,
                   SUM(CASE WHEN yhi.status IN ('visited','inquiry') THEN 1 ELSE 0 END) AS public_count,
                   SUM(CASE WHEN yhi.status = 'visited' THEN 1 ELSE 0 END) AS visited,
                   SUM(CASE WHEN yhi.status = 'inquiry' THEN 1 ELSE 0 END) AS inquiry,
                   SUM(CASE WHEN yhi.status = 'unavailable' THEN 1 ELSE 0 END) AS unavailable
            FROM ops_hotels h
            LEFT JOIN ops_ylka_hotel_info yhi ON yhi.hotel_id = h.id
            WHERE h.is_published = 1 AND h.city IS NOT NULL AND h.city != ''
            GROUP BY h.city
            ORDER BY public_count DESC, total DESC, h.city
        ")->fetchAll();
    } catch (Throwable $e) {
        errorResponse('cities query failed: ' . $e->getMessage(), 500);
    }
    jsonResponse(['cities' => $rows]);
}

if ($action === 'update-info' && $method === 'POST') {
    $body    = json_decode(file_get_contents('php://input'), true);
    $hotelId = (int)($body['hotel_id'] ?? 0);
    if ($hotelId <= 0) errorResponse('invalid hotel_id', 400);

    // status は文字列で受け取り、許可値以外は NULL に
    if (array_key_exists('status', $body)) {
        $s = $body['status'];
        if (!in_array($s, ['visited', 'inquiry', 'unavailable'], true)) $body['status'] = null;
    }

    $allowedKeys = ['status', 'entry_method', 'guide_note', 'internal_memo', 'room_type_recommended', 'transport_fee'];
    $cols        = [];
    $vals        = [];
    foreach ($allowedKeys as $k) {
        if (array_key_exists($k, $body)) {
            $cols[] = $k;
            $vals[] = $body[$k] === '' ? null : $body[$k];
        }
    }
    if (!$cols) errorResponse('nothing to update', 400);

    // UPSERT
    $insertCols   = array_merge(['hotel_id'], $cols);
    $placeholders = array_fill(0, count($insertCols), '?');
    $updateClauses = array_map(fn($c) => "{$c} = VALUES({$c})", $cols);

    $sql = "INSERT INTO ops_ylka_hotel_info (" . implode(', ', $insertCols) . ")
            VALUES (" . implode(', ', $placeholders) . ")
            ON DUPLICATE KEY UPDATE " . implode(', ', $updateClauses);
    $pdo->prepare($sql)->execute(array_merge([$hotelId], $vals));
    jsonResponse(['ok' => true]);
}

if ($action === 'bulk-status' && $method === 'POST') {
    $body   = json_decode(file_get_contents('php://input'), true);
    $ids    = $body['hotel_ids'] ?? [];
    $status = $body['status'] ?? null;
    if (!is_array($ids) || count($ids) === 0) errorResponse('hotel_ids required', 400);
    if ($status !== null && !in_array($status, ['visited', 'inquiry', 'unavailable'], true)) {
        errorResponse('invalid status', 400);
    }
    $ids = array_map('intval', $ids);

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("INSERT INTO ops_ylka_hotel_info (hotel_id, status) VALUES (?, ?)
                               ON DUPLICATE KEY UPDATE status = VALUES(status)");
        foreach ($ids as $hid) {
            $stmt->execute([$hid, $status]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        errorResponse('bulk update failed', 500);
    }
    jsonResponse(['ok' => true, 'updated' => count($ids)]);
}

// =================================================================
// スタッフ管理（owner 専用）
// =================================================================
if ($action === 'admin-users' && $method === 'GET') {
    requireOwner();
    ops_sync_casts_if_changed(current_shop_id());
    $rows = $pdo->query("SELECT id, username, display_name, role, can_drive, is_therapist, is_office, thumbnail_url, sort_order, commission_rate, girl_id, cast_notes, created_at FROM ops_admin_users ORDER BY sort_order, id")->fetchAll();
    jsonResponse(['users' => $rows]);
}

// CTRL のキャストを手動で取り込み直す（girls.php で登録した直後など）
if ($action === 'sync-casts' && $method === 'POST') {
    jsonResponse(['ok' => true] + ops_sync_casts(current_shop_id()));
}

// 全ロール (内勤スタッフ含む) 向け: タイムライン/予約モーダル等で使う最小スタッフリスト
// パスワード等のセンシティブ情報は含まない、編集も不可 (read-only)
if ($action === 'staff-list' && $method === 'GET') {
    // owner/manager のみ commission_rate を含める（タイムラインの報酬/入金算出用）。office/driver には返さない
    // 注: admin-api.php は auth-guard.php を読み込まないため currentUserRole() は未定義。
    //     セッションを直接参照する（requireOwnerOrManager と同じ方式）。これを関数化すると
    //     非owner（manager/office/driver）でこの行が Fatal になり JSON が壊れる原因になった。
    $withRate = in_array($_SESSION['ylka_admin_role'] ?? '', ['owner', 'manager'], true);
    ops_sync_casts_if_changed(current_shop_id());
    $rows = $pdo->query("SELECT id, username, display_name, role, can_drive, is_therapist, is_office, thumbnail_url, sort_order, girl_id, cast_notes" . ($withRate ? ", commission_rate" : "") . " FROM ops_admin_users ORDER BY sort_order, id")->fetchAll();
    jsonResponse(['users' => $rows]);
}

// キャストの注意事項（猫アレルギー等・予約を取る前に確認するもの）。
// 受付で気づいた点をその場で足せるよう、admin-update(owner限定)とは別に店長も許可する。
if ($action === 'cast-note-update' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $note = trim((string)($body['cast_notes'] ?? ''));
    $st = $pdo->prepare('UPDATE ops_admin_users SET cast_notes = ? WHERE id = ?');
    $st->execute([$note !== '' ? mb_substr($note, 0, 2000) : null, $id]);
    jsonResponse(['ok' => true]);
}

// ホテルそのもの（名前・住所・市区町村・TEL）の作成／更新。
//   ops_ylka_hotel_info（ステータスや交通費）は update-info が担当。ここは ops_hotels 側。
if (($action === 'hotel-save') && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    $name = trim((string)($body['name'] ?? ''));
    if ($name === '') errorResponse('name required', 400);
    $city = mb_substr(trim((string)($body['city'] ?? '')), 0, 50);
    $addr = mb_substr(trim((string)($body['address'] ?? '')), 0, 500);
    $tel  = mb_substr(preg_replace('/[^0-9\-]/', '', (string)($body['tel'] ?? '')) ?? '', 0, 30);
    // 都道府県は画面のセレクトから受け取る（住所欄は市区町村から番地まで）。
    // 住所側にも都道府県が付いていたら剥がして二重表記にしない。
    $prefList = ['東京都', '埼玉県', '神奈川県', '千葉県', '山梨県'];
    $pref = in_array((string)($body['prefecture'] ?? ''), $prefList, true) ? (string)$body['prefecture'] : '東京都';
    foreach ($prefList as $pfx) {
        if (str_starts_with($addr, $pfx)) { $pref = $pfx; $addr = trim(mb_substr($addr, mb_strlen($pfx))); break; }
    }

    if ($id > 0) {
        $st = $pdo->prepare('UPDATE ops_hotels SET name=?, city=?, address=?, prefecture=?, tel=?, is_edited=1, updated_at=NOW() WHERE id=?');
        $st->execute([mb_substr($name, 0, 255), $city, $addr, $pref, $tel ?: null, $id]);
        jsonResponse(['ok' => true, 'id' => $id]);
    }
    $st = $pdo->prepare("INSERT INTO ops_hotels (name, address, prefecture, city, hotel_type, source, tel, is_published, is_edited, created_at, updated_at)
                         VALUES (?,?,?,?,'love_hotel','manual',?,1,1,NOW(),NOW())");
    $st->execute([mb_substr($name, 0, 255), $addr, $pref, $city, $tel ?: null]);
    jsonResponse(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

// ホテルをリストから外す（YLKA由来の民宿など、アドミでは使わないものを消すため）。
//   予約で使われているホテルは【消さずに非表示】にする。履歴の hotel_id が迷子になるのを防ぐ。
//   使われていないものは実削除（ops_ylka_hotel_info も一緒に）。
if ($action === 'hotel-delete' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $ids  = array_values(array_filter(array_map('intval', (array)($body['hotel_ids'] ?? [])), fn($v) => $v > 0));
    if (!$ids) errorResponse('hotel_ids required', 400);

    $in = implode(',', array_fill(0, count($ids), '?'));
    // 予約から参照されている id
    $used = [];
    $st = $pdo->prepare("SELECT DISTINCT hotel_id FROM ops_bookings WHERE hotel_id IN ($in)");
    $st->execute($ids);
    foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $v) $used[(int)$v] = true;

    $deleted = 0; $hidden = 0;
    $pdo->beginTransaction();
    $hide = $pdo->prepare('UPDATE ops_hotels SET is_published = 0, updated_at = NOW() WHERE id = ?');
    $delI = $pdo->prepare('DELETE FROM ops_ylka_hotel_info WHERE hotel_id = ?');
    $delH = $pdo->prepare('DELETE FROM ops_hotels WHERE id = ?');
    foreach ($ids as $id) {
        if (isset($used[$id])) { $hide->execute([$id]); $hidden++; continue; }
        $delI->execute([$id]);
        $delH->execute([$id]);
        $deleted++;
    }
    $pdo->commit();
    jsonResponse(['ok' => true, 'deleted' => $deleted, 'hidden' => $hidden]);
}

if ($action === 'admin-create' && $method === 'POST') {
    requireOwner();
    $body         = json_decode(file_get_contents('php://input'), true);
    $email        = trim($body['email'] ?? '');
    $password     = $body['password'] ?? '';
    $displayName  = trim($body['display_name'] ?? '');
    $role         = $body['role'] ?? 'staff';
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) errorResponse('valid email required', 400);
    if (strlen($password) < 8) errorResponse('password must be at least 8 chars', 400);
    if (!in_array($role, ['owner', 'manager', 'staff', 'driver', 'office'], true)) errorResponse('invalid role', 400);
    if ($displayName === '') errorResponse('display_name required', 400);

    $exists = $pdo->prepare('SELECT 1 FROM ops_admin_users WHERE username = ?');
    $exists->execute([$email]);
    if ($exists->fetch()) errorResponse('email already exists', 409);

    $rate = isset($body['commission_rate']) && $body['commission_rate'] !== '' ? max(0, min(100, (float)$body['commission_rate'])) : 50.0;
    $canDrive = !empty($body['can_drive']) ? 1 : 0;
    $isTherapist = !empty($body['is_therapist']) ? 1 : 0;
    $isOffice = !empty($body['is_office']) ? 1 : 0;
    $hash = password_hash($password, PASSWORD_BCRYPT);
    $pdo->prepare('INSERT INTO ops_admin_users (username, password_hash, display_name, role, can_drive, is_therapist, is_office, commission_rate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())')
        ->execute([$email, $hash, $displayName, $role, $canDrive, $isTherapist, $isOffice, $rate]);
    jsonResponse(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

if ($action === 'admin-update' && $method === 'POST') {
    requireOwner();
    $body        = json_decode(file_get_contents('php://input'), true);
    $id          = (int)($body['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);

    $cols = [];
    $vals = [];
    if (array_key_exists('display_name', $body)) {
        $cols[] = 'display_name = ?';
        $vals[] = trim($body['display_name']) ?: null;
    }
    if (array_key_exists('thumbnail_url', $body)) {
        $thumb = $body['thumbnail_url'];
        $cols[] = 'thumbnail_url = ?';
        $vals[] = ($thumb === '' || $thumb === null) ? null : $thumb;
    }
    if (array_key_exists('role', $body) && $body['role'] !== null) {
        $role = $body['role'];
        if (!in_array($role, ['owner', 'manager', 'staff', 'driver', 'office'], true)) errorResponse('invalid role', 400);
        if ($id === (int)$_SESSION['ylka_admin_id']) errorResponse('cannot change your own role', 403);
        if ($role === 'staff') {
            $cur = $pdo->query("SELECT COUNT(*) FROM ops_admin_users WHERE role = 'owner'")->fetchColumn();
            if ((int)$cur <= 1) errorResponse('cannot demote the last owner', 403);
        }
        $cols[] = 'role = ?'; $vals[] = $role;
    }
    if (array_key_exists('commission_rate', $body) && $body['commission_rate'] !== null && $body['commission_rate'] !== '') {
        $cols[] = 'commission_rate = ?';
        $vals[] = max(0, min(100, (float)$body['commission_rate']));
    }
    if (array_key_exists('can_drive', $body)) {
        $cols[] = 'can_drive = ?';
        $vals[] = !empty($body['can_drive']) ? 1 : 0;
    }
    if (array_key_exists('is_therapist', $body)) {
        $cols[] = 'is_therapist = ?';
        $vals[] = !empty($body['is_therapist']) ? 1 : 0;
    }
    if (array_key_exists('is_office', $body)) {
        $cols[] = 'is_office = ?';
        $vals[] = !empty($body['is_office']) ? 1 : 0;
    }
    // メールアドレス(=ログインID username)の変更。送迎メール送信先も兼ねる
    if (array_key_exists('email', $body) && trim((string)$body['email']) !== '') {
        $newEmail = trim((string)$body['email']);
        if (!filter_var($newEmail, FILTER_VALIDATE_EMAIL)) errorResponse('valid email required', 400);
        $chk = $pdo->prepare('SELECT 1 FROM ops_admin_users WHERE username = ? AND id <> ?');
        $chk->execute([$newEmail, $id]);
        if ($chk->fetch()) errorResponse('email already exists', 409);
        $cols[] = 'username = ?'; $vals[] = $newEmail;
    }
    if (!$cols) errorResponse('nothing to update', 400);
    $vals[] = $id;
    $pdo->prepare("UPDATE ops_admin_users SET " . implode(', ', $cols) . " WHERE id = ?")->execute($vals);
    jsonResponse(['ok' => true]);
}

// =================================================================
// 報酬集計（owner / manager 専用）
// キャスト報酬 = コース(price−深夜)×歩合 + 深夜料金(全額) + 出張費のキャスト取り分
// 出張費: 自走分は全額キャスト。送迎(ドライバー割当)した片道ごとに max(出張費/2, 850円) を店が取得（上限=出張費総額）
// =================================================================
// 出張費のキャスト取り分（送迎=ドライバー割当した片道は店が max(出張費/2,850) を取得、残りがキャスト）
/**
 * 予約の menu_items（「ローター¥1,000 / バイブ¥1,000」形式のテキスト）から
 * オプションのキャスト報酬合計を出す。cast_reward 未設定のオプションは店の取り分＝0円。
 * マスタは一度だけ読んで使い回す（明細ループから毎行呼ばれるため）。
 */
function opsOptionReward(?string $menuItems): int {
    static $master = null;
    $txt = trim((string)$menuItems);
    if ($txt === '') return 0;
    if ($master === null) {
        $master = [];
        try {
            foreach (getPdo()->query('SELECT name, cast_reward FROM ops_options') as $o) {
                $name = trim((string)$o['name']);
                if ($name !== '' && $o['cast_reward'] !== null && $o['cast_reward'] !== '') {
                    $master[$name] = (int)$o['cast_reward'];
                }
            }
        } catch (Throwable $e) { $master = []; }
    }
    $sum = 0;
    foreach ($master as $name => $reward) {
        if (mb_strpos($txt, $name) !== false) $sum += $reward;
    }
    return $sum;
}

function ylkaTherapistTransport(int $transport, bool $goDriver, bool $backDriver): int {
    if ($transport <= 0) return 0;
    $perLeg = max((int)floor($transport / 2), 850);
    $shop = ($goDriver ? $perLeg : 0) + ($backDriver ? $perLeg : 0);
    if ($shop > $transport) $shop = $transport; // 出張費総額を超えない
    return $transport - $shop;
}
// キャスト報酬 = コース(price−深夜)×歩合 + 深夜全額 + 出張費のキャスト取り分
function ylkaReward(int $price, int $late, int $transport, float $rate, bool $goDriver, bool $backDriver): int {
    // 深夜料金: 帰りのお迎え(backDriver)があれば全額お店（深夜のドライバー手当のため）。なければ全額キャスト
    $lateTherapist = $backDriver ? 0 : $late;
    return (int)floor(($price - $late) * $rate / 100) + $lateTherapist + ylkaTherapistTransport($transport, $goDriver, $backDriver);
}
// クレジット決済のカード手数料のうち「キャスト負担分」= 売上全額 ×（手数料率 ÷ 2）%。
// カード手数料（平均3%）はお店とキャストで半分ずつ負担（各1.5%）。現金・振込は0。
function ylkaCardFeeTherapist(int $sales, ?string $pm, float $cardFeeRate): int {
    if ($pm !== 'credit' && $pm !== 'card') return 0;
    return (int)floor($sales * ($cardFeeRate / 2) / 100);
}
// 1予約の [売上, 報酬] を返す。お客様都合キャンセルは手入力のキャンセル料/報酬、それ以外は通常計算（予約時点で計上）。
// カード決済は $cardFeeRate>0 のとき、キャスト負担分のカード手数料を報酬から差し引く。
function ylkaRowSalesReward(array $r, float $cardFeeRate = 0.0): array {
    if (($r['status'] ?? '') === 'cancelled') {
        return [(int)($r['cancellation_fee'] ?? 0), (int)($r['cancellation_reward'] ?? 0)];
    }
    // 売上 = コース料金 + 出張費 + クレジットの手数料上乗せ分（お客様から受け取る総額）
    $sales = (int)($r['price'] ?? 0) + (int)($r['transport_fee'] ?? 0) + (int)($r['card_fee'] ?? 0);
    // 報酬の手入力オーバーライドがあればそちらを優先（微調整用。カード手数料差引は適用しない＝入力額そのまま）
    if (isset($r['reward_override']) && $r['reward_override'] !== null && $r['reward_override'] !== '') {
        return [$sales, (int)$r['reward_override']];
    }
    $reward = ylkaReward((int)($r['price'] ?? 0), (int)($r['late_fee'] ?? 0), (int)($r['transport_fee'] ?? 0), (float)($r['commission_rate'] ?? 0), !empty($r['driver_id']), !empty($r['back_driver_id']));
    $reward -= ylkaCardFeeTherapist($sales, $r['payment_method'] ?? null, $cardFeeRate);
    return [$sales, $reward];
}
// 経理の絞り込みキャストID（0=全体）
function ylkaReqTherapistId(): int {
    return isset($_GET['therapist_id']) && $_GET['therapist_id'] !== '' ? max(0, (int)$_GET['therapist_id']) : 0;
}
// 休憩は売上・件数・報酬の対象外。エイリアスに応じた「休憩を除外」SQL断片を返す（先頭に AND 付き）
function ylkaExcludeBreakSql(string $alias = ''): string {
    $p = $alias ? "$alias." : '';
    return " AND ({$p}course_name <> '休憩' OR {$p}course_name IS NULL) AND ({$p}customer_name_snapshot <> '【休憩】' OR {$p}customer_name_snapshot IS NULL)";
}
// 営業日(10:00〜翌10:00)基準の日付を返すSQL式。start_time が 10:00 未満なら前日扱い。
// 経理・集金は営業日で集計・絞り込みするため booking_date の代わりにこれを使う。
function ylkaBizDayExpr(string $alias = ''): string {
    $p = $alias ? "$alias." : '';
    return "DATE(CASE WHEN {$p}start_time < '10:00:00' THEN DATE_SUB({$p}booking_date, INTERVAL 1 DAY) ELSE {$p}booking_date END)";
}
if ($action === 'payroll' && $method === 'GET') {
    requireOwnerOrManager();
    $from = $_GET['from'] ?? date('Y-m-01');
    $to   = $_GET['to']   ?? date('Y-m-t');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) errorResponse('invalid from', 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $to))   errorResponse('invalid to', 400);

    $sql = "SELECT b.id, b.booking_date, b.start_time, b.assigned_admin_id,
                   b.customer_name_snapshot, b.course_name, b.menu_items, b.price, b.late_fee, b.transport_fee, b.card_fee, b.payment_method,
                   b.driver_id, b.back_driver_id, b.status, b.cancellation_fee, b.cancellation_reward, b.reward_override,
                   au.display_name, au.username, au.commission_rate, au.sort_order
            FROM ops_bookings b
            JOIN ops_admin_users au ON au.id = b.assigned_admin_id
            WHERE (b.status NOT IN ('cancelled','no_show','inquiry') OR (b.status = 'cancelled' AND b.cancellation_reason_type = 'customer'))
              AND b.assigned_admin_id IS NOT NULL
              AND " . ylkaBizDayExpr('b') . " BETWEEN ? AND ?" . ylkaExcludeBreakSql('b') . "
            ORDER BY au.sort_order, au.id, b.booking_date, b.start_time";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$from, $to]);
    $rows = $stmt->fetchAll();
    $cardRate = getCardFeeRate($pdo);

    $byT = [];
    $grand = ['count' => 0, 'base_total' => 0, 'reward_total' => 0];
    foreach ($rows as $r) {
        $aid  = (int)$r['assigned_admin_id'];
        $rate = (float)$r['commission_rate'];
        $isCancel = ($r['status'] ?? '') === 'cancelled';
        $cardFeeSelf = 0;
        if ($isCancel) {
            // お客様都合キャンセル: 手入力のキャンセル料/報酬で計上（内訳の按分はなし）
            $late = 0; $trans = 0;
            $base = (int)($r['cancellation_fee'] ?? 0);
            $reward = (int)($r['cancellation_reward'] ?? 0);
            $courseFee = $base; $courseReward = $reward; $tTherapist = 0; $lateTherapist = 0;
        } else {
        $late = (int)$r['late_fee'];
        $trans = (int)$r['transport_fee'];
        $base = (int)$r['price'] + $trans;  // お客様総額（対象売上）
        $hasGo = !empty($r['driver_id']); $hasBack = !empty($r['back_driver_id']);
        $courseFee = (int)$r['price'] - $late;
        // オプション（ローター等）のキャスト報酬。menu_items のテキストに残した名前で
        // ops_options を引き、cast_reward が設定されているものだけ加算する（未設定＝店の取り分）。
        $optionReward = opsOptionReward($r['menu_items'] ?? null);
        $courseReward = (int)floor($courseFee * $rate / 100) + $optionReward;
        $tTherapist = ylkaTherapistTransport($trans, $hasGo, $hasBack);
        $lateTherapist = $hasBack ? 0 : $late;   // 帰りお迎えあり→深夜料金は店
        $cardFeeSelf = ylkaCardFeeTherapist($base, $r['payment_method'] ?? null, $cardRate); // カード決済のキャスト負担
        $reward = $courseReward + $lateTherapist + $tTherapist - $cardFeeSelf;
        // 報酬の手入力オーバーライドがあれば置き換え（内訳(course_reward等)は参考値として自動計算のまま残す）
        if (isset($r['reward_override']) && $r['reward_override'] !== null && $r['reward_override'] !== '') {
            $reward = (int)$r['reward_override'];
        }
        }
        if (!isset($byT[$aid])) {
            $byT[$aid] = [
                'admin_id' => $aid,
                'name'     => $r['display_name'] ?: $r['username'],
                'rate'     => $rate,
                'count'    => 0,
                'base_total'   => 0,
                'reward_total' => 0,
                'details'  => [],
            ];
        }
        $byT[$aid]['count']++;
        $byT[$aid]['base_total']   += $base;
        $byT[$aid]['reward_total'] += $reward;
        $byT[$aid]['details'][] = [
            'date'      => $r['booking_date'],
            'time'      => substr((string)$r['start_time'], 0, 5),
            'customer'  => $r['customer_name_snapshot'],
            'course'    => $r['course_name'],
            'price'     => (int)$r['price'],
            'transport' => (int)$r['transport_fee'],
            'base'      => $base,
            'reward'    => $reward,
            'late'           => $late,
            'late_self'      => $lateTherapist,
            'late_shop'      => $late - $lateTherapist,
            'course_fee'     => $courseFee,
            'course_reward'  => $courseReward,
            'transport_self' => $tTherapist,
            'transport_shop' => $trans - $tTherapist,
            'card_fee_self'  => $cardFeeSelf,
            'payment_method' => $r['payment_method'] ?? null,
            'has_driver'     => ($hasGo || $hasBack),
            'has_back_driver'=> $hasBack,
        ];
        $grand['count']++;
        $grand['base_total']   += $base;
        $grand['reward_total'] += $reward;
    }
    jsonResponse(['from' => $from, 'to' => $to, 'therapists' => array_values($byT), 'grand' => $grand]);
}

// =================================================================
// 経理: カード手数料率の取得/保存
// =================================================================
function getCardFeeRate(PDO $pdo): float {
    $st = $pdo->prepare("SELECT setting_value FROM ops_admin_settings WHERE setting_key = 'card_fee_rate'");
    $st->execute();
    $v = $st->fetchColumn();
    return $v === false ? 3.0 : (float)$v;
}

/** クレジット決済でお客様の合計に上乗せする手数料率(%)。card_fee_rate（キャスト負担の計算用）とは別物 */
function getCardSurchargeRate(PDO $pdo): float {
    $st = $pdo->prepare("SELECT setting_value FROM ops_admin_settings WHERE setting_key = 'card_surcharge_rate'");
    $st->execute();
    $v = $st->fetchColumn();
    return $v === false ? 10.0 : (float)$v;
}

if ($action === 'card-fee-get' && $method === 'GET') {
    // 手数料率は機密ではなく、報酬計算のキャスト負担分表示に staff も参照するため全ログイン管理者に開放
    jsonResponse([
        'card_fee_rate' => getCardFeeRate($pdo),
        'card_surcharge_rate' => getCardSurchargeRate($pdo),
    ]);
}

if ($action === 'card-fee-set' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $rate = max(0, min(100, (float)($body['card_fee_rate'] ?? 3.5)));
    $pdo->prepare("INSERT INTO ops_admin_settings (setting_key, setting_value) VALUES ('card_fee_rate', ?)
                   ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)")->execute([(string)$rate]);
    jsonResponse(['ok' => true, 'card_fee_rate' => $rate]);
}

// =================================================================
// 指名料（初指名/本指名/フリー、固定額）の取得/保存。予約保存時の合計加算・フッターサマリー内訳表示に使用
// =================================================================
function getNominationFees(PDO $pdo): array {
    $out = ['first' => 0, 'regular' => 0, 'free' => 0];
    $st = $pdo->prepare("SELECT setting_key, setting_value FROM ops_admin_settings WHERE setting_key IN ('nomination_fee_first','nomination_fee_regular','nomination_fee_free')");
    $st->execute();
    foreach ($st->fetchAll() as $row) {
        $type = str_replace('nomination_fee_', '', $row['setting_key']);
        $out[$type] = (int)$row['setting_value'];
    }
    return $out;
}

if ($action === 'nomination-fees-get' && $method === 'GET') {
    jsonResponse(['nomination_fees' => getNominationFees($pdo)]);
}

if ($action === 'nomination-fees-set' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $fees = $body['nomination_fees'] ?? [];
    foreach (['first', 'regular', 'free'] as $type) {
        $v = max(0, (int)($fees[$type] ?? 0));
        $pdo->prepare("INSERT INTO ops_admin_settings (setting_key, setting_value) VALUES (?, ?)
                       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)")->execute(['nomination_fee_' . $type, (string)$v]);
    }
    jsonResponse(['ok' => true, 'nomination_fees' => getNominationFees($pdo)]);
}

// =================================================================
// ドライバー: その日の送迎・保有預り金・勤務実績（owner / manager が閲覧・入力）
// =================================================================
if ($action === 'driver-day' && $method === 'GET') {
    requireOwnerOrManager();
    $did  = (int)($_GET['driver_id'] ?? 0);
    $date = $_GET['date'] ?? date('Y-m-d');
    if ($did <= 0) errorResponse('invalid driver_id', 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) errorResponse('invalid date', 400);
    $bizDay = ylkaBizDayExpr('b');

    // 送迎（送り=driver_id / お迎え=back_driver_id）。1予約で両方担当もあり得る
    $st = $pdo->prepare(
        "SELECT b.id, b.customer_name_snapshot, b.hotel_name_snapshot, b.display_city, b.room_number,
                b.start_time, b.end_time, b.pickup_go_time, b.pickup_back_time, b.driver_id, b.back_driver_id,
                au.display_name AS therapist_name, au.username AS therapist_username,
                h.name AS hotel_name, h.city AS hotel_city
         FROM ops_bookings b
         LEFT JOIN ops_admin_users au ON au.id = b.assigned_admin_id
         LEFT JOIN ops_hotels h ON h.id = b.hotel_id
         WHERE (b.driver_id = ? OR b.back_driver_id = ?)
           AND (b.status NOT IN ('cancelled','no_show','inquiry') OR (b.status='cancelled' AND b.cancellation_reason_type='customer'))
           AND $bizDay = ?
         ORDER BY b.start_time"
    );
    $st->execute([$did, $did, $date]);
    $go = []; $back = [];
    foreach ($st->fetchAll() as $r) {
        $place = $r['hotel_name'] ?: ($r['hotel_name_snapshot'] ?: ($r['display_city'] ?: ($r['hotel_city'] ?: '')));
        $common = [
            'id'         => (int)$r['id'],
            'therapist'  => $r['therapist_name'] ?: ($r['therapist_username'] ?: '(未割当)'),
            'customer'   => $r['customer_name_snapshot'],
            'place'      => $place,
            'room'       => $r['room_number'],
            'start_time' => substr((string)$r['start_time'], 0, 5),
            'end_time'   => substr((string)$r['end_time'], 0, 5),
        ];
        if ((int)$r['driver_id'] === $did)      $go[]   = array_merge($common, ['pickup' => $r['pickup_go_time']   ? substr($r['pickup_go_time'], 0, 5)   : null]);
        if ((int)$r['back_driver_id'] === $did) $back[] = array_merge($common, ['pickup' => $r['pickup_back_time'] ? substr($r['pickup_back_time'], 0, 5) : null]);
    }

    // このドライバーが現在保有している預り金（未精算）
    $cardRate = getCardFeeRate($pdo);
    $cst = $pdo->prepare(
        "SELECT b.id, b.customer_name_snapshot, b.price, b.late_fee, b.transport_fee, b.card_fee, b.driver_id, b.back_driver_id,
                b.status, b.cancellation_fee, b.cancellation_reward, b.reward_override, b.payment_method, b.settle_kind,
                au.commission_rate, au.display_name AS therapist_name, au.username AS therapist_username
         FROM ops_bookings b
         LEFT JOIN ops_admin_users au ON au.id = b.assigned_admin_id
         WHERE b.held_by = ? AND (b.shop_settled IS NULL OR b.shop_settled = 0)
           AND (b.status NOT IN ('cancelled','no_show','inquiry') OR (b.status='cancelled' AND b.cancellation_reason_type='customer'))
           AND $bizDay = ?" . ylkaExcludeBreakSql('b') . "
         ORDER BY b.start_time"
    );
    $cst->execute([$did, $date]);
    $custody = []; $custodyTotal = 0;
    foreach ($cst->fetchAll() as $r) {
        list($sales, $reward) = ylkaRowSalesReward($r, $cardRate);
        // settle_kind: 'full'=預り金全額を保有 / それ以外=入金分（売上−報酬）のみ
        $amt = (($r['settle_kind'] ?? 'net') === 'full') ? $sales : ($sales - $reward);
        $custody[] = [
            'id'        => (int)$r['id'],
            'customer'  => $r['customer_name_snapshot'],
            'therapist' => $r['therapist_name'] ?: ($r['therapist_username'] ?: '(未割当)'),
            'amount'    => $amt,
            'kind'      => $r['settle_kind'] ?? 'net',
        ];
        $custodyTotal += $amt;
    }

    // 勤務実績ログ
    $lg = $pdo->prepare("SELECT clock_in, clock_out, distance_km, note FROM ops_driver_logs WHERE driver_id = ? AND work_date = ?");
    $lg->execute([$did, $date]);
    $log = $lg->fetch();

    jsonResponse([
        'driver_id' => $did, 'date' => $date,
        'go' => $go, 'back' => $back,
        'custody' => $custody, 'custody_total' => $custodyTotal,
        'log' => $log ? [
            'clock_in'    => $log['clock_in']  ? substr($log['clock_in'], 0, 5)  : null,
            'clock_out'   => $log['clock_out'] ? substr($log['clock_out'], 0, 5) : null,
            'distance_km' => $log['distance_km'] !== null ? (float)$log['distance_km'] : null,
            'note'        => $log['note'],
        ] : null,
    ]);
}

if ($action === 'driver-log-upsert' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $did  = (int)($body['driver_id'] ?? 0);
    $date = $body['work_date'] ?? '';
    if ($did <= 0) errorResponse('invalid driver_id', 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) errorResponse('invalid work_date', 400);
    $normTime = function ($t) {
        $t = trim((string)$t);
        if ($t === '') return null;
        if (!preg_match('/^(\d{1,2}):(\d{2})$/', $t)) return false;
        return $t;
    };
    $ci = $normTime($body['clock_in'] ?? '');
    $co = $normTime($body['clock_out'] ?? '');
    if ($ci === false || $co === false) errorResponse('invalid time', 400);
    $km = $body['distance_km'];
    $kmV = ($km === '' || $km === null) ? null : (float)$km;
    if ($kmV !== null && ($kmV < 0 || $kmV > 99999)) errorResponse('invalid distance', 400);
    $note = trim((string)($body['note'] ?? ''));
    $uid  = (int)($_SESSION['ylka_admin_id'] ?? 0);
    $pdo->prepare(
        "INSERT INTO ops_driver_logs (driver_id, work_date, clock_in, clock_out, distance_km, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE clock_in=VALUES(clock_in), clock_out=VALUES(clock_out),
             distance_km=VALUES(distance_km), note=VALUES(note)"
    )->execute([$did, $date, $ci, $co, $kmV, ($note === '' ? null : $note), $uid]);
    jsonResponse(['ok' => true]);
}

// =================================================================
// 経理: 損益サマリー（owner / manager）
// 売上 = 完了予約の price + transport_fee（支払方法別に集計）
// カード手数料 = カード売上 × 手数料率
// 報酬 = 完了予約 (price+transport) × 各キャスト歩合
// 経費 = expenses の合計
// 粗利 = 売上 − カード手数料 − 報酬 − 経費
// =================================================================
if ($action === 'accounting-summary' && $method === 'GET') {
    requireOwnerOrManager();
    $from = $_GET['from'] ?? date('Y-m-01');
    $to   = $_GET['to']   ?? date('Y-m-t');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) errorResponse('invalid from', 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $to))   errorResponse('invalid to', 400);

    $tid = ylkaReqTherapistId();
    $tCond  = $tid ? ' AND assigned_admin_id = ?' : '';     // bookings 無エイリアス用
    $tCondB = $tid ? ' AND b.assigned_admin_id = ?' : '';   // b. エイリアス用
    $tArg = $tid ? [$tid] : [];
    $noBreak  = ylkaExcludeBreakSql('');   // 休憩除外（無エイリアス）
    $noBreakB = ylkaExcludeBreakSql('b');  // 休憩除外（b. エイリアス）
    $bizDay   = ylkaBizDayExpr('');        // 営業日式（無エイリアス）
    $bizDayB  = ylkaBizDayExpr('b');       // 営業日式（b. エイリアス）

    // 売上（支払方法別）。card は旧データ互換でクレジット扱い
    $sales = ['cash' => 0, 'credit' => 0, 'bank' => 0, 'unset' => 0, 'total' => 0, 'count' => 0];
    $st = $pdo->prepare("SELECT payment_method, COUNT(*) AS cnt, COALESCE(SUM(CASE WHEN status='cancelled' THEN COALESCE(cancellation_fee,0) ELSE price + COALESCE(transport_fee,0) + COALESCE(card_fee,0) END),0) AS amt
                         FROM ops_bookings
                         WHERE (status NOT IN ('cancelled','no_show','inquiry') OR (status='cancelled' AND cancellation_reason_type='customer')) AND $bizDay BETWEEN ? AND ?$tCond$noBreak
                         GROUP BY payment_method");
    $st->execute(array_merge([$from, $to], $tArg));
    foreach ($st->fetchAll() as $r) {
        $amt = (int)$r['amt'];
        $pm = $r['payment_method'];
        if ($pm === 'cash') $sales['cash'] += $amt;
        elseif ($pm === 'credit' || $pm === 'card') $sales['credit'] += $amt;
        elseif ($pm === 'bank') $sales['bank'] += $amt;
        else $sales['unset'] += $amt;
        $sales['total'] += $amt;
        $sales['count'] += (int)$r['cnt'];
    }
    // 料金内訳（コース料金 / 深夜料金 / 出張費）— 売上と同じ絞り込み条件。price=コース+深夜が合算済みなので course=price−late
    $bt = $pdo->prepare("SELECT COALESCE(SUM(CASE WHEN status='cancelled' THEN COALESCE(cancellation_fee,0) ELSE price - COALESCE(late_fee,0) END),0) AS course,
                                COALESCE(SUM(CASE WHEN status='cancelled' THEN 0 ELSE COALESCE(late_fee,0) END),0) AS late,
                                COALESCE(SUM(CASE WHEN status='cancelled' THEN 0 ELSE COALESCE(transport_fee,0) END),0) AS transport,
                                COALESCE(SUM(CASE WHEN status='cancelled' THEN 0 ELSE COALESCE(card_fee,0) END),0) AS card
                         FROM ops_bookings
                         WHERE (status NOT IN ('cancelled','no_show','inquiry') OR (status='cancelled' AND cancellation_reason_type='customer')) AND $bizDay BETWEEN ? AND ?$tCond$noBreak");
    $bt->execute(array_merge([$from, $to], $tArg));
    $bd = $bt->fetch();
    $breakdown = ['course' => (int)$bd['course'], 'late' => (int)$bd['late'], 'transport' => (int)$bd['transport'], 'card' => (int)$bd['card']];

    $rate = getCardFeeRate($pdo);
    // 手数料はクレジットのみ
    $cardFee = (int)floor($sales['credit'] * $rate / 100);

    // 報酬合計
    $rwst = $pdo->prepare("SELECT b.price, b.late_fee, b.transport_fee, b.card_fee, b.driver_id, b.back_driver_id, b.status, b.cancellation_fee, b.cancellation_reward, b.reward_override, b.payment_method, au.commission_rate
                           FROM ops_bookings b JOIN ops_admin_users au ON au.id = b.assigned_admin_id
                           WHERE (b.status NOT IN ('cancelled','no_show','inquiry') OR (b.status = 'cancelled' AND b.cancellation_reason_type = 'customer')) AND b.assigned_admin_id IS NOT NULL
                             AND $bizDayB BETWEEN ? AND ?$tCondB$noBreakB");
    $rwst->execute(array_merge([$from, $to], $tArg));
    $rewardTotal = 0;
    foreach ($rwst->fetchAll() as $rw) {
        [, $rwReward] = ylkaRowSalesReward($rw, $rate);
        $rewardTotal += $rwReward;
    }

    // 経費合計 + カテゴリ別（経費は店全体の費用。キャスト絞り込み時は個人に紐付かないため0）
    $expenseByCat = [];
    $expenseTotal = 0;
    if (!$tid) {
        $et = $pdo->prepare("SELECT category, COALESCE(SUM(amount),0) AS amt FROM ops_expenses
                             WHERE expense_date BETWEEN ? AND ? GROUP BY category ORDER BY amt DESC");
        $et->execute([$from, $to]);
        foreach ($et->fetchAll() as $r) {
            $expenseByCat[] = ['category' => $r['category'], 'amount' => (int)$r['amt']];
            $expenseTotal += (int)$r['amt'];
        }
    }

    $grossProfit = $sales['total'] - $cardFee - $rewardTotal - $expenseTotal;

    jsonResponse([
        'from' => $from, 'to' => $to,
        'sales' => $sales,
        'breakdown' => $breakdown,
        'card_fee_rate' => $rate,
        'card_fee' => $cardFee,
        'reward_total' => $rewardTotal,
        'expense_total' => $expenseTotal,
        'expense_by_category' => $expenseByCat,
        'gross_profit' => $grossProfit,
    ]);
}

// =================================================================
// 経理: 売上分析（owner / manager）— コース別 / 日別 / 支払方法別
// =================================================================
if ($action === 'sales' && $method === 'GET') {
    requireOwnerOrManager();
    $from = $_GET['from'] ?? date('Y-m-01');
    $to   = $_GET['to']   ?? date('Y-m-t');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) errorResponse('invalid from', 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $to))   errorResponse('invalid to', 400);

    $tid = ylkaReqTherapistId();
    $tCond = $tid ? ' AND assigned_admin_id = ?' : '';
    $tArg = $tid ? [$tid] : [];
    $noBreak = ylkaExcludeBreakSql('');  // 休憩除外
    $bizDay  = ylkaBizDayExpr('');        // 営業日式

    // コース別
    $byCourse = $pdo->prepare("SELECT COALESCE(course_name,'(未設定)') AS course, COUNT(*) AS cnt,
                                      COALESCE(SUM(CASE WHEN status='cancelled' THEN COALESCE(cancellation_fee,0) ELSE price + COALESCE(transport_fee,0) + COALESCE(card_fee,0) END),0) AS amt
                               FROM ops_bookings WHERE (status NOT IN ('cancelled','no_show','inquiry') OR (status='cancelled' AND cancellation_reason_type='customer')) AND $bizDay BETWEEN ? AND ?$tCond$noBreak
                               GROUP BY course_name ORDER BY amt DESC");
    $byCourse->execute(array_merge([$from, $to], $tArg));

    // 日別（営業日基準）
    $byDay = $pdo->prepare("SELECT $bizDay AS d, COUNT(*) AS cnt, COALESCE(SUM(CASE WHEN status='cancelled' THEN COALESCE(cancellation_fee,0) ELSE price + COALESCE(transport_fee,0) + COALESCE(card_fee,0) END),0) AS amt
                            FROM ops_bookings WHERE (status NOT IN ('cancelled','no_show','inquiry') OR (status='cancelled' AND cancellation_reason_type='customer')) AND $bizDay BETWEEN ? AND ?$tCond$noBreak
                            GROUP BY d ORDER BY d");
    $byDay->execute(array_merge([$from, $to], $tArg));

    // 支払方法別
    $byPay = $pdo->prepare("SELECT payment_method AS pm, COUNT(*) AS cnt, COALESCE(SUM(CASE WHEN status='cancelled' THEN COALESCE(cancellation_fee,0) ELSE price + COALESCE(transport_fee,0) + COALESCE(card_fee,0) END),0) AS amt
                            FROM ops_bookings WHERE (status NOT IN ('cancelled','no_show','inquiry') OR (status='cancelled' AND cancellation_reason_type='customer')) AND $bizDay BETWEEN ? AND ?$tCond$noBreak
                            GROUP BY payment_method");
    $byPay->execute(array_merge([$from, $to], $tArg));

    jsonResponse([
        'from' => $from, 'to' => $to,
        'by_course' => $byCourse->fetchAll(),
        'by_day'    => $byDay->fetchAll(),
        'by_payment'=> $byPay->fetchAll(),
    ]);
}

// =================================================================
// 経理: 集金（入金チェック）（owner / manager）
// 各完了ジョブの 店入金額 = (price + transport_fee) − 報酬。入金確認フラグ shop_settled。
// =================================================================
if ($action === 'settlements' && $method === 'GET') {
    requireOwnerOrManager();
    $from = $_GET['from'] ?? date('Y-m-01');
    $to   = $_GET['to']   ?? date('Y-m-t');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) errorResponse('invalid from', 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $to))   errorResponse('invalid to', 400);

    $tid = ylkaReqTherapistId();
    $tCondB = $tid ? ' AND b.assigned_admin_id = ?' : '';
    $tArg = $tid ? [$tid] : [];
    $sql = "SELECT b.id, b.booking_date, b.start_time, b.customer_name_snapshot, b.course_name,
                   b.price, b.late_fee, b.transport_fee, b.card_fee, b.driver_id, b.back_driver_id, b.payment_method, b.shop_settled, b.shop_settled_at,
                   b.status, b.cancellation_fee, b.cancellation_reward, b.reward_override, b.assigned_admin_id, b.held_by,
                   au.display_name, au.username, au.commission_rate,
                   h.display_name AS holder_name, h.username AS holder_username
            FROM ops_bookings b
            LEFT JOIN ops_admin_users au ON au.id = b.assigned_admin_id
            LEFT JOIN ops_admin_users h ON h.id = b.held_by
            WHERE (b.status NOT IN ('cancelled','no_show','inquiry') OR (b.status = 'cancelled' AND b.cancellation_reason_type = 'customer')) AND " . ylkaBizDayExpr('b') . " BETWEEN ? AND ?$tCondB" . ylkaExcludeBreakSql('b') . "
            ORDER BY b.shop_settled ASC, b.booking_date DESC, b.start_time DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute(array_merge([$from, $to], $tArg));
    $rows = [];
    $sum = ['unsettled' => 0, 'settled' => 0, 'unsettled_count' => 0, 'settled_count' => 0];
    $cardRate = getCardFeeRate($pdo);
    foreach ($stmt->fetchAll() as $r) {
        [$sales, $reward] = ylkaRowSalesReward($r, $cardRate);
        $shop   = $sales - $reward;
        $settled = (int)$r['shop_settled'] === 1;
        $heldBy = ($r['held_by'] !== null && $r['held_by'] !== '') ? (int)$r['held_by'] : null;
        $rows[] = [
            'id'        => (int)$r['id'],
            'date'      => $r['booking_date'],
            'time'      => substr((string)$r['start_time'], 0, 5),
            'therapist' => $r['display_name'] ?: ($r['username'] ?: '(未割当)'),
            'customer'  => $r['customer_name_snapshot'],
            'course'    => $r['course_name'],
            'payment_method' => $r['payment_method'],
            'sales'     => $sales,
            'reward'    => $reward,
            'shop_amount' => $shop,
            'settled'   => $settled,
            'settled_at'=> $r['shop_settled_at'],
            'assigned_admin_id' => (int)$r['assigned_admin_id'],
            'held_by'   => $heldBy,
            'holder'    => $heldBy ? ($r['holder_name'] ?: $r['holder_username'] ?: ('#' . $heldBy)) : null,
        ];
        if ($settled) { $sum['settled'] += $shop; $sum['settled_count']++; }
        else { $sum['unsettled'] += $shop; $sum['unsettled_count']++; }
    }
    jsonResponse(['from' => $from, 'to' => $to, 'rows' => $rows, 'summary' => $sum]);
}

if ($action === 'booking-set-holder' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $id = (int)($body['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $held = (isset($body['held_by']) && $body['held_by'] !== '' && $body['held_by'] !== null) ? (int)$body['held_by'] : null;
    if ($held === null) {
        $pdo->prepare("UPDATE ops_bookings SET held_by = NULL WHERE id = ?")->execute([$id]);
    } else {
        $pdo->prepare("UPDATE ops_bookings SET held_by = ? WHERE id = ?")->execute([$held, $id]);
    }
    jsonResponse(['ok' => true]);
}

if ($action === 'booking-settle' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $id = (int)($body['id'] ?? 0);
    $settled = !empty($body['settled']) ? 1 : 0;
    if ($id <= 0) errorResponse('invalid id', 400);
    // 入金確定の種類: full=預り金全額(報酬は後で店→担当) / net=入金分のみ(報酬は担当が保持)
    $kind = in_array($body['kind'] ?? '', ['full', 'net'], true) ? $body['kind'] : 'full';
    $receiver = (int)($_SESSION['ylka_admin_id'] ?? 0) ?: null;  // 受領した人（=受領後の保有者）
    if ($settled) {
        $pdo->prepare("UPDATE ops_bookings SET shop_settled = 1, shop_settled_at = NOW(), shop_settled_by = ?, settle_kind = ? WHERE id = ?")
            ->execute([$receiver, $kind, $id]);
    } else {
        $pdo->prepare("UPDATE ops_bookings SET shop_settled = 0, shop_settled_at = NULL, shop_settled_by = NULL, settle_kind = NULL WHERE id = ?")
            ->execute([$id]);
    }
    jsonResponse(['ok' => true]);
}

// 締めのまとめ受領: 指定予約(複数)を一括で店受領。owner/manager のみ。
// お店が締めのときに、その人の本日分をまとめて受領する運用。report は full 固定想定だが kind も受ける。
if ($action === 'booking-settle-batch' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $ids  = array_values(array_filter(array_map('intval', (array)($body['ids'] ?? [])), fn($v) => $v > 0));
    $kind = in_array($body['kind'] ?? '', ['full', 'net'], true) ? $body['kind'] : 'full';
    if (!$ids) errorResponse('no ids', 400);
    $receiver = (int)($_SESSION['ylka_admin_id'] ?? 0) ?: null;  // 受領した人
    $place = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $pdo->prepare("UPDATE ops_bookings SET shop_settled = 1, shop_settled_at = COALESCE(shop_settled_at, NOW()), shop_settled_by = ?, settle_kind = ?
                           WHERE id IN ($place) AND shop_settled = 0");
    $stmt->execute(array_merge([$receiver, $kind], $ids));
    jsonResponse(['ok' => true, 'settled' => $stmt->rowCount()]);
}

// =================================================================
// 預り金の受け渡し履歴（予約1件ごと・多段の連鎖）。owner/manager のみ。
//   起点=担当本人(assigned_admin_id)。各ホップを booking_handoffs に記録し、
//   bookings.held_by を「現在の保有者(最新ホップの to)」として同期する。
// =================================================================
if ($action === 'booking-handoffs' && $method === 'GET') {
    requireOwnerOrManager();
    $ids = array_values(array_filter(array_map('intval', explode(',', (string)($_GET['ids'] ?? ''))), fn($v) => $v > 0));
    if (!$ids) { jsonResponse(['handoffs' => []]); }
    $place = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $pdo->prepare("SELECT id, booking_id, from_admin_id, to_admin_id, created_at
                           FROM ops_booking_handoffs WHERE booking_id IN ($place) ORDER BY booking_id, id");
    $stmt->execute($ids);
    jsonResponse(['handoffs' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
}

if ($action === 'booking-handoff-add' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $id = (int)($body['booking_id'] ?? 0);
    $to = (int)($body['to_admin_id'] ?? 0);
    if ($id <= 0 || $to <= 0) errorResponse('invalid params', 400);
    $st = $pdo->prepare("SELECT assigned_admin_id, held_by, shop_settled FROM ops_bookings WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) errorResponse('booking not found', 404);
    if ((int)$row['shop_settled'] === 1) errorResponse('already settled', 400);
    $from = ($row['held_by'] !== null && $row['held_by'] !== '') ? (int)$row['held_by'] : (int)$row['assigned_admin_id'];
    if ($from === $to) errorResponse('same holder', 400);
    $me = (int)($_SESSION['ylka_admin_id'] ?? 0);
    $pdo->prepare("INSERT INTO ops_booking_handoffs (booking_id, from_admin_id, to_admin_id, created_by) VALUES (?,?,?,?)")
        ->execute([$id, $from, $to, $me ?: null]);
    $pdo->prepare("UPDATE ops_bookings SET held_by = ? WHERE id = ?")->execute([$to, $id]);
    jsonResponse(['ok' => true]);
}

if ($action === 'booking-handoff-undo' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $id = (int)($body['booking_id'] ?? 0);
    if ($id <= 0) errorResponse('invalid params', 400);
    $last = $pdo->prepare("SELECT id FROM ops_booking_handoffs WHERE booking_id = ? ORDER BY id DESC LIMIT 1");
    $last->execute([$id]);
    $lr = $last->fetch(PDO::FETCH_ASSOC);
    if (!$lr) errorResponse('no handoff to undo', 400);
    $pdo->prepare("DELETE FROM ops_booking_handoffs WHERE id = ?")->execute([(int)$lr['id']]);
    // held_by を1つ前の保有者（残った最新ホップの to）に戻す。無ければ NULL（=担当本人保有）
    $prev = $pdo->prepare("SELECT to_admin_id FROM ops_booking_handoffs WHERE booking_id = ? ORDER BY id DESC LIMIT 1");
    $prev->execute([$id]);
    $pr = $prev->fetch(PDO::FETCH_ASSOC);
    if ($pr) {
        $pdo->prepare("UPDATE ops_bookings SET held_by = ? WHERE id = ?")->execute([(int)$pr['to_admin_id'], $id]);
    } else {
        $pdo->prepare("UPDATE ops_bookings SET held_by = NULL WHERE id = ?")->execute([$id]);
    }
    jsonResponse(['ok' => true]);
}

// =================================================================
// 報酬の受け渡し記録（店受領の有無に依存しない・誰が本人に渡したかだけ記録）。
// =================================================================
if ($action === 'booking-reward-pay' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    $paid = !empty($body['paid']);
    if ($id <= 0) errorResponse('invalid id', 400);
    $payer = (int)($_SESSION['ylka_admin_id'] ?? 0) ?: null;  // 渡した人=操作者
    if ($paid) {
        $pdo->prepare("UPDATE ops_bookings SET reward_paid_at = NOW(), reward_paid_by = ? WHERE id = ?")
            ->execute([$payer, $id]);
    } else {
        $pdo->prepare("UPDATE ops_bookings SET reward_paid_at = NULL, reward_paid_by = NULL WHERE id = ?")->execute([$id]);
    }
    jsonResponse(['ok' => true]);
}

// 報酬をまとめて渡す（複数予約を一括で reward_paid 記録）
if ($action === 'booking-reward-pay-batch' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $ids  = array_values(array_filter(array_map('intval', (array)($body['ids'] ?? [])), fn($v) => $v > 0));
    if (!$ids) errorResponse('no ids', 400);
    $payer = (int)($_SESSION['ylka_admin_id'] ?? 0) ?: null;
    $place = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $pdo->prepare("UPDATE ops_bookings SET reward_paid_at = NOW(), reward_paid_by = ? WHERE id IN ($place) AND reward_paid_at IS NULL");
    $stmt->execute(array_merge([$payer], $ids));
    jsonResponse(['ok' => true, 'paid' => $stmt->rowCount()]);
}

// 入金分のみの受け渡し（パターン2）: 預り金の保有を to へ移し、報酬は担当本人が確保した記録を同時に付ける。
// 例: 橘が全額¥15,400を保有 → 入金分¥5,390だけ糸井に渡す → 報酬¥10,010は橘の手元に残る
if ($action === 'booking-net-handoff' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $id = (int)($body['id'] ?? 0);
    $to = (int)($body['to_admin_id'] ?? 0);
    if ($id <= 0 || $to <= 0) errorResponse('invalid params', 400);
    $st = $pdo->prepare("SELECT assigned_admin_id, held_by FROM ops_bookings WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) errorResponse('booking not found', 404);
    $from = ($row['held_by'] !== null && $row['held_by'] !== '') ? (int)$row['held_by'] : (int)$row['assigned_admin_id'];
    if ($from === $to) errorResponse('same holder', 400);
    $me = (int)($_SESSION['ylka_admin_id'] ?? 0) ?: null;
    $pdo->beginTransaction();
    try {
        $pdo->prepare("INSERT INTO ops_booking_handoffs (booking_id, from_admin_id, to_admin_id, created_by) VALUES (?,?,?,?)")
            ->execute([$id, $from, $to, $me]);
        // 報酬は担当本人の手元に残る＝本人が確保（reward_paid_by=担当本人）
        $pdo->prepare("UPDATE ops_bookings SET held_by = ?, reward_paid_at = COALESCE(reward_paid_at, NOW()), reward_paid_by = COALESCE(reward_paid_by, assigned_admin_id) WHERE id = ?")
            ->execute([$to, $id]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        errorResponse('net handoff failed', 500);
    }
    jsonResponse(['ok' => true]);
}

// 預り金をまとめて渡す（複数予約を1人へ一括ハンドオフ）
if ($action === 'booking-handoff-batch' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $ids  = array_values(array_filter(array_map('intval', (array)($body['ids'] ?? [])), fn($v) => $v > 0));
    $to   = (int)($body['to_admin_id'] ?? 0);
    if (!$ids || $to <= 0) errorResponse('invalid params', 400);
    $me = (int)($_SESSION['ylka_admin_id'] ?? 0) ?: null;
    $sel = $pdo->prepare("SELECT id, assigned_admin_id, held_by FROM ops_bookings WHERE id = ?");
    $ins = $pdo->prepare("INSERT INTO ops_booking_handoffs (booking_id, from_admin_id, to_admin_id, created_by) VALUES (?,?,?,?)");
    $upd = $pdo->prepare("UPDATE ops_bookings SET held_by = ? WHERE id = ?");
    $n = 0;
    foreach ($ids as $id) {
        $sel->execute([$id]);
        $row = $sel->fetch(PDO::FETCH_ASSOC);
        if (!$row) continue;
        $from = ($row['held_by'] !== null && $row['held_by'] !== '') ? (int)$row['held_by'] : (int)$row['assigned_admin_id'];
        if ($from === $to) continue;  // すでにその人が保有
        $ins->execute([$id, $from, $to, $me]);
        $upd->execute([$to, $id]);
        $n++;
    }
    jsonResponse(['ok' => true, 'handed' => $n]);
}

// =================================================================
// 現金まとめサマリー
//   uncollected: completed & shop_settled=0 — 誰が預り金を持っているか
// =================================================================
if ($action === 'cash-summary' && $method === 'GET') {
    requireOwnerOrManager();
    // 出回っている現金（誰がいくら持っているか）: 現金決済のみ・休憩除外。報酬確定済みは残額をクライアントで計算
    $unc = $pdo->query("
        SELECT b.id, b.booking_date, b.start_time, b.price, b.late_fee, b.transport_fee,
               b.assigned_admin_id, b.held_by, b.driver_id, b.back_driver_id, b.reward_paid_at, b.payment_method,
               b.customer_name_snapshot,
               u.display_name  AS therapist_name,  u.username  AS therapist_username,  u.commission_rate,
               h.display_name  AS holder_name,     h.username  AS holder_username
        FROM ops_bookings b
        LEFT JOIN ops_admin_users u ON u.id = b.assigned_admin_id
        LEFT JOIN ops_admin_users h ON h.id = b.held_by
        WHERE b.status = 'completed' AND b.shop_settled = 0
          AND (b.payment_method IS NULL OR b.payment_method NOT IN ('credit','card','bank'))" . ylkaExcludeBreakSql('b') . "
        ORDER BY b.booking_date DESC, b.start_time DESC
    ")->fetchAll(PDO::FETCH_ASSOC);

    jsonResponse(['uncollected' => $unc]);
}

// =================================================================
// 集金（日×スタッフ単位の受け渡し・双方確認）
//   単位: (settle_date, therapist_id)。店入金額合計 = Σ(売上 − 報酬)（完了予約）
//   受領済 = スタッフ確認 または 店舗確認 のいずれか（どちらか一方でOK）
// =================================================================

// 指定期間の (日, キャスト) 別 店入金額合計を算出
function ylkaComputeShopAmounts(PDO $pdo, string $from, string $to): array {
    $stmt = $pdo->prepare(
        "SELECT b.booking_date, b.assigned_admin_id, b.price, b.late_fee, b.transport_fee, b.card_fee, b.driver_id, b.back_driver_id, b.status, b.cancellation_fee, b.cancellation_reward, b.reward_override, b.payment_method, au.commission_rate
         FROM ops_bookings b
         LEFT JOIN ops_admin_users au ON au.id = b.assigned_admin_id
         WHERE (b.status NOT IN ('cancelled','no_show','inquiry') OR (b.status = 'cancelled' AND b.cancellation_reason_type = 'customer')) AND b.booking_date BETWEEN ? AND ?
           AND b.assigned_admin_id IS NOT NULL"
    );
    $stmt->execute([$from, $to]);
    $cardRate = getCardFeeRate($pdo);
    $map = [];
    foreach ($stmt->fetchAll() as $r) {
        $tid   = (int)$r['assigned_admin_id'];
        $date  = $r['booking_date'];
        [$sales, $reward] = ylkaRowSalesReward($r, $cardRate);
        $shop  = $sales - $reward;
        $key   = $date . '|' . $tid;
        if (!isset($map[$key])) $map[$key] = ['shop' => 0, 'count' => 0];
        $map[$key]['shop']  += $shop;
        $map[$key]['count']++;
    }
    return $map;
}

function ylkaComputeShopAmountOne(PDO $pdo, string $date, int $tid): int {
    $m = ylkaComputeShopAmounts($pdo, $date, $date);
    return $m[$date . '|' . $tid]['shop'] ?? 0;
}

// 集金行を組み立て（$onlyTid 指定時はそのキャストのみ）
function ylkaSettlementRows(PDO $pdo, string $from, string $to, ?int $onlyTid): array {
    $map = ylkaComputeShopAmounts($pdo, $from, $to);

    $sql = "SELECT * FROM ops_settlement_days WHERE settle_date BETWEEN ? AND ?";
    $params = [$from, $to];
    if ($onlyTid !== null) { $sql .= " AND therapist_id = ?"; $params[] = $onlyTid; }
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $sd = [];
    foreach ($stmt->fetchAll() as $r) { $sd[$r['settle_date'] . '|' . (int)$r['therapist_id']] = $r; }

    $names = [];
    foreach ($pdo->query("SELECT id, display_name, username FROM ops_admin_users")->fetchAll() as $u) {
        $names[(int)$u['id']] = $u['display_name'] ?: ($u['username'] ?: ('#' . $u['id']));
    }

    $keys = array_keys($map);
    foreach (array_keys($sd) as $k) { if (!in_array($k, $keys, true)) $keys[] = $k; }

    $rows = [];
    foreach ($keys as $k) {
        [$date, $tidS] = explode('|', $k);
        $tid = (int)$tidS;
        if ($onlyTid !== null && $tid !== $onlyTid) continue;
        $rec   = $sd[$k] ?? null;
        $tConf = $rec['therapist_confirmed_at'] ?? null;
        $sConf = $rec['shop_confirmed_at'] ?? null;
        $rows[] = [
            'date'                   => $date,
            'therapist_id'           => $tid,
            'therapist'              => $names[$tid] ?? ('#' . $tid),
            'booking_count'          => $map[$k]['count'] ?? 0,
            'shop_amount'            => $map[$k]['shop'] ?? 0,
            'amount_snapshot'        => ($rec && $rec['amount_snapshot'] !== null) ? (int)$rec['amount_snapshot'] : null,
            'therapist_confirmed_at' => $tConf,
            'therapist_confirmed_by' => ($rec && $rec['therapist_confirmed_by']) ? ($names[(int)$rec['therapist_confirmed_by']] ?? null) : null,
            'shop_confirmed_at'      => $sConf,
            'shop_confirmed_by'      => ($rec && $rec['shop_confirmed_by']) ? ($names[(int)$rec['shop_confirmed_by']] ?? null) : null,
            'settled'                => ($tConf !== null) || ($sConf !== null),
            'both'                   => ($tConf !== null) && ($sConf !== null),
        ];
    }
    usort($rows, function ($a, $b) {
        if ($a['settled'] !== $b['settled']) return $a['settled'] ? 1 : -1;
        return strcmp($b['date'], $a['date']);
    });
    return $rows;
}

function ylkaSettlementSummary(array $rows): array {
    $sum = ['unsettled' => 0, 'settled' => 0, 'unsettled_count' => 0, 'settled_count' => 0];
    foreach ($rows as $r) {
        if ($r['settled']) { $sum['settled'] += $r['shop_amount']; $sum['settled_count']++; }
        else { $sum['unsettled'] += $r['shop_amount']; $sum['unsettled_count']++; }
    }
    return $sum;
}

// owner/manager: 全スタッフの集金一覧
if ($action === 'settlement-days' && $method === 'GET') {
    requireOwnerOrManager();
    $from = $_GET['from'] ?? date('Y-m-01');
    $to   = $_GET['to']   ?? date('Y-m-t');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) errorResponse('invalid from', 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $to))   errorResponse('invalid to', 400);
    $rows = ylkaSettlementRows($pdo, $from, $to, ylkaReqTherapistId() ?: null);
    jsonResponse(['from' => $from, 'to' => $to, 'rows' => $rows, 'summary' => ylkaSettlementSummary($rows)]);
}

// スタッフ本人: 自分の集金一覧
if ($action === 'my-settlements' && $method === 'GET') {
    $me = (int)($_SESSION['ylka_admin_id'] ?? 0);
    if ($me <= 0) errorResponse('unauthorized', 401);
    $from = $_GET['from'] ?? date('Y-m-01');
    $to   = $_GET['to']   ?? date('Y-m-t');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) errorResponse('invalid from', 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $to))   errorResponse('invalid to', 400);
    $rows = ylkaSettlementRows($pdo, $from, $to, $me);
    jsonResponse(['from' => $from, 'to' => $to, 'rows' => $rows, 'summary' => ylkaSettlementSummary($rows)]);
}

// スタッフ本人: 自分の予約1件ごとの店舗受領状況（閲覧のみ）
if ($action === 'my-settlement-bookings' && $method === 'GET') {
    $me = (int)($_SESSION['ylka_admin_id'] ?? 0);
    if ($me <= 0) errorResponse('unauthorized', 401);
    $from = $_GET['from'] ?? date('Y-m-01');
    $to   = $_GET['to']   ?? date('Y-m-t');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) errorResponse('invalid from', 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $to))   errorResponse('invalid to', 400);
    // 経理は予約時点で計上＝キャンセル/無連絡以外の全予約を集計（未/始/終は無関係, 2026-06-17）
    $statusWhere = "(b.status NOT IN ('cancelled','no_show','inquiry') OR (b.status = 'cancelled' AND b.cancellation_reason_type = 'customer'))";
    $stmt = $pdo->prepare("SELECT b.id, b.booking_date, b.start_time, b.customer_name_snapshot, b.course_name,
                   b.price, b.late_fee, b.transport_fee, b.card_fee, b.driver_id, b.back_driver_id, b.payment_method, b.shop_settled, b.shop_settled_at,
                   b.status, b.cancellation_fee, b.cancellation_reward, b.reward_override, b.assigned_admin_id, b.held_by, b.reward_paid_at, b.reward_paid_by,
                   au.commission_rate,
                   h.display_name AS holder_name, h.username AS holder_username
            FROM ops_bookings b LEFT JOIN ops_admin_users au ON au.id = b.assigned_admin_id
            LEFT JOIN ops_admin_users h ON h.id = b.held_by
            WHERE $statusWhere AND " . ylkaBizDayExpr('b') . " BETWEEN ? AND ? AND b.assigned_admin_id = ?" . ylkaExcludeBreakSql('b') . "
            ORDER BY b.shop_settled ASC, b.booking_date DESC, b.start_time DESC");
    $stmt->execute([$from, $to, $me]);
    $rows = [];
    $sum = ['unsettled' => 0, 'settled' => 0, 'unsettled_count' => 0, 'settled_count' => 0,
            'count' => 0, 'sales_total' => 0, 'reward_total' => 0];
    $cardRate = getCardFeeRate($pdo);
    foreach ($stmt->fetchAll() as $r) {
        [$sales, $reward] = ylkaRowSalesReward($r, $cardRate);
        $shop = $sales - $reward;
        $settled = (int)$r['shop_settled'] === 1;
        $heldBy = ($r['held_by'] !== null && $r['held_by'] !== '') ? (int)$r['held_by'] : null;
        $rows[] = ['id' => (int)$r['id'], 'date' => $r['booking_date'], 'time' => substr((string)$r['start_time'], 0, 5),
                   'customer' => $r['customer_name_snapshot'], 'course' => $r['course_name'],
                   'sales' => $sales, 'reward' => $reward, 'payment_method' => $r['payment_method'],
                   'shop_amount' => $shop, 'settled' => $settled, 'settled_at' => $r['shop_settled_at'],
                   'assigned_admin_id' => (int)$r['assigned_admin_id'],
                   'reward_paid_at' => $r['reward_paid_at'], 'reward_paid_by' => $r['reward_paid_by'] !== null ? (int)$r['reward_paid_by'] : null,
                   'held_by' => $heldBy,
                   'holder' => $heldBy ? ($r['holder_name'] ?: $r['holder_username'] ?: ('#' . $heldBy)) : null];
        if ($settled) { $sum['settled'] += $shop; $sum['settled_count']++; }
        else { $sum['unsettled'] += $shop; $sum['unsettled_count']++; }
        $sum['count']++; $sum['sales_total'] += $sales; $sum['reward_total'] += $reward;
    }
    jsonResponse(['from' => $from, 'to' => $to, 'rows' => $rows, 'summary' => $sum]);
}

// 受領確認トグル（side=therapist|shop）
// キャスト本人が担当したお客様一覧（自分の予約のみから集計）。電話・お店の顧客メモは含めない。お仕事メモ(bookings.notes)は本人のものなので含む
if ($action === 'my-customers' && $method === 'GET') {
    $me = (int)($_SESSION['ylka_admin_id'] ?? 0);
    if ($me <= 0) errorResponse('unauthorized', 401);
    $stmt = $pdo->prepare(
        "SELECT b.id, b.customer_id, b.booking_date, b.start_time, b.course_name, b.notes,
                COALESCE(NULLIF(c.name,''), b.customer_name_snapshot) AS name
         FROM ops_bookings b LEFT JOIN ops_customers c ON c.id = b.customer_id
         WHERE b.assigned_admin_id = ? AND b.status NOT IN ('cancelled','no_show','inquiry')
           AND (b.course_name <> '休憩' OR b.course_name IS NULL)
           AND (b.customer_name_snapshot <> '【休憩】' OR b.customer_name_snapshot IS NULL)
         ORDER BY b.booking_date DESC, b.start_time DESC");
    $stmt->execute([$me]);
    $groups = [];
    foreach ($stmt->fetchAll() as $r) {
        $name = $r['name'] ?: '(名称未設定)';
        $key  = $r['customer_id'] ? ('c' . (int)$r['customer_id']) : ('n' . $name);
        if (!isset($groups[$key])) {
            $groups[$key] = ['customer_id' => $r['customer_id'] ? (int)$r['customer_id'] : null,
                             'name' => $name, 'count' => 0, 'last_date' => $r['booking_date'], 'bookings' => []];
        }
        $groups[$key]['count']++;
        $groups[$key]['bookings'][] = ['id' => (int)$r['id'], 'date' => $r['booking_date'],
            'time' => substr((string)$r['start_time'], 0, 5), 'course' => $r['course_name'], 'notes' => $r['notes']];
    }
    $list = array_values($groups);
    usort($list, fn($a, $b) => strcmp((string)$b['last_date'], (string)$a['last_date']));
    jsonResponse(['customers' => $list]);
}

if ($action === 'settlement-confirm' && $method === 'POST') {
    $me   = (int)($_SESSION['ylka_admin_id'] ?? 0);
    $role = $_SESSION['ylka_admin_role'] ?? '';
    if ($me <= 0) errorResponse('unauthorized', 401);
    $body  = json_decode(file_get_contents('php://input'), true);
    $date  = $body['settle_date'] ?? '';
    $tid   = (int)($body['therapist_id'] ?? 0);
    $side  = $body['side'] ?? '';
    $value = !empty($body['value']) ? 1 : 0;
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) errorResponse('invalid date', 400);
    if ($tid <= 0) errorResponse('invalid therapist', 400);
    if (!in_array($side, ['therapist', 'shop'], true)) errorResponse('invalid side', 400);
    // 権限: 店舗側は owner/manager のみ。スタッフ側は本人(または owner/manager)のみ。
    if ($side === 'shop') {
        if (!in_array($role, ['owner', 'manager'], true)) errorResponse('owner or manager role required', 403);
    } else {
        if (!in_array($role, ['owner', 'manager'], true) && $tid !== $me) errorResponse('forbidden', 403);
    }
    $col   = $side === 'shop' ? 'shop' : 'therapist';
    $atCol = $col . '_confirmed_at';
    $byCol = $col . '_confirmed_by';

    $stmt = $pdo->prepare("SELECT * FROM ops_settlement_days WHERE settle_date=? AND therapist_id=?");
    $stmt->execute([$date, $tid]);
    $rec = $stmt->fetch();

    if (!$rec) {
        $snapshot = $value ? ylkaComputeShopAmountOne($pdo, $date, $tid) : null;
        $sql = "INSERT INTO ops_settlement_days (settle_date, therapist_id, amount_snapshot, $atCol, $byCol)
                VALUES (?, ?, ?, " . ($value ? 'NOW()' : 'NULL') . ", " . ($value ? '?' : 'NULL') . ")";
        $params = [$date, $tid, $snapshot];
        if ($value) $params[] = $me;
        $pdo->prepare($sql)->execute($params);
    } else {
        $setSnap = ($rec['amount_snapshot'] === null && $value) ? ', amount_snapshot=?' : '';
        $sql = "UPDATE ops_settlement_days SET $atCol=" . ($value ? 'NOW()' : 'NULL')
             . ", $byCol=" . ($value ? '?' : 'NULL') . "$setSnap WHERE id=?";
        $params = [];
        if ($value)   $params[] = $me;
        if ($setSnap) $params[] = ylkaComputeShopAmountOne($pdo, $date, $tid);
        $params[] = (int)$rec['id'];
        $pdo->prepare($sql)->execute($params);
    }
    jsonResponse(['ok' => true]);
}

// =================================================================
// 経理: 経費 CRUD（owner / manager）
// =================================================================
if ($action === 'expenses-list' && $method === 'GET') {
    requireOwnerOrManager();
    $from = $_GET['from'] ?? date('Y-m-01');
    $to   = $_GET['to']   ?? date('Y-m-t');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) errorResponse('invalid from', 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $to))   errorResponse('invalid to', 400);
    $st = $pdo->prepare("SELECT e.id, e.expense_date, e.category, e.amount, e.vendor, e.memo, e.created_at,
                                au.display_name AS created_by_name
                         FROM ops_expenses e LEFT JOIN ops_admin_users au ON au.id = e.created_by
                         WHERE e.expense_date BETWEEN ? AND ?
                         ORDER BY e.expense_date DESC, e.id DESC");
    $st->execute([$from, $to]);
    $rows = $st->fetchAll();
    $total = 0;
    foreach ($rows as $r) $total += (int)$r['amount'];
    jsonResponse(['expenses' => $rows, 'total' => $total, 'from' => $from, 'to' => $to]);
}

if ($action === 'expense-save' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $id       = (int)($body['id'] ?? 0);
    $date     = trim($body['expense_date'] ?? '');
    $category = trim($body['category'] ?? 'その他');
    $amount   = (int)($body['amount'] ?? 0);
    $vendor   = trim($body['vendor'] ?? '');
    $memo     = trim($body['memo'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) errorResponse('invalid expense_date', 400);
    if ($category === '') $category = 'その他';
    if (mb_strlen($category) > 50) $category = mb_substr($category, 0, 50);
    if ($amount < 0) errorResponse('invalid amount', 400);
    if ($id > 0) {
        $pdo->prepare("UPDATE ops_expenses SET expense_date=?, category=?, amount=?, vendor=?, memo=? WHERE id=?")
            ->execute([$date, $category, $amount, $vendor ?: null, $memo ?: null, $id]);
        jsonResponse(['ok' => true, 'id' => $id]);
    } else {
        $pdo->prepare("INSERT INTO ops_expenses (expense_date, category, amount, vendor, memo, created_by) VALUES (?, ?, ?, ?, ?, ?)")
            ->execute([$date, $category, $amount, $vendor ?: null, $memo ?: null, (int)$_SESSION['ylka_admin_id']]);
        jsonResponse(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
    }
}

if ($action === 'expense-delete' && $method === 'POST') {
    requireOwnerOrManager();
    $body = json_decode(file_get_contents('php://input'), true);
    $id = (int)($body['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $pdo->prepare("DELETE FROM ops_expenses WHERE id = ?")->execute([$id]);
    jsonResponse(['ok' => true]);
}

// =================================================================
// 権限管理（owner 専用）
// =================================================================
if ($action === 'permissions-get' && $method === 'GET') {
    $stmt = $pdo->prepare("SELECT setting_value FROM ops_admin_settings WHERE setting_key = 'tab_permissions'");
    $stmt->execute();
    $row = $stmt->fetch();
    $perms = $row ? json_decode($row['setting_value'], true) : null;
    jsonResponse(['permissions' => $perms ?: new stdClass()]);
}

if ($action === 'permissions-update' && $method === 'POST') {
    requireOwner();
    $body = json_decode(file_get_contents('php://input'), true);
    $perms = $body['permissions'] ?? null;
    if (!is_array($perms)) errorResponse('permissions must be object', 400);
    // バリデーション: 各タブの値は ['owner','manager','staff'] のサブセット
    $valid = ['owner', 'manager', 'staff', 'driver', 'office'];
    foreach ($perms as $tab => $roles) {
        if (!is_array($roles)) errorResponse("invalid roles for tab: $tab", 400);
        foreach ($roles as $r) {
            if (!in_array($r, $valid, true)) errorResponse("invalid role: $r", 400);
        }
    }
    // 安全装置: permissions と staff は必ず owner を含む
    if (!in_array('owner', $perms['permissions'] ?? [], true)) $perms['permissions'][] = 'owner';
    if (!in_array('owner', $perms['staff'] ?? [], true)) $perms['staff'][] = 'owner';

    $pdo->prepare("INSERT INTO ops_admin_settings (setting_key, setting_value) VALUES ('tab_permissions', ?)
                   ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)")
        ->execute([json_encode($perms)]);
    jsonResponse(['ok' => true]);
}

if ($action === 'admin-reorder' && $method === 'POST') {
    requireOwner();
    $body = json_decode(file_get_contents('php://input'), true);
    $ids = $body['ids'] ?? [];
    if (!is_array($ids) || count($ids) === 0) errorResponse('ids required', 400);
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("UPDATE ops_admin_users SET sort_order = ? WHERE id = ?");
        $i = 10;
        foreach ($ids as $id) {
            $stmt->execute([$i, (int)$id]);
            $i += 10;
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        errorResponse('reorder failed', 500);
    }
    jsonResponse(['ok' => true]);
}

if ($action === 'admin-delete' && $method === 'POST') {
    requireOwner();
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    if ($id === (int)$_SESSION['ylka_admin_id']) errorResponse('cannot delete yourself', 403);

    // 最後のownerは削除不可
    $target = $pdo->prepare('SELECT role FROM ops_admin_users WHERE id = ?');
    $target->execute([$id]);
    $row = $target->fetch();
    if (!$row) errorResponse('user not found', 404);
    if ($row['role'] === 'owner') {
        $cnt = $pdo->query("SELECT COUNT(*) FROM ops_admin_users WHERE role = 'owner'")->fetchColumn();
        if ((int)$cnt <= 1) errorResponse('cannot delete the last owner', 403);
    }
    $pdo->prepare('DELETE FROM ops_admin_users WHERE id = ?')->execute([$id]);
    jsonResponse(['ok' => true]);
}

if ($action === 'admin-reset-password' && $method === 'POST') {
    requireOwner();
    $body     = json_decode(file_get_contents('php://input'), true);
    $id       = (int)($body['id'] ?? 0);
    $password = $body['password'] ?? '';
    if ($id <= 0) errorResponse('invalid id', 400);
    if (strlen($password) < 8) errorResponse('password must be at least 8 chars', 400);
    $hash = password_hash($password, PASSWORD_BCRYPT);
    $pdo->prepare('UPDATE ops_admin_users SET password_hash = ? WHERE id = ?')->execute([$hash, $id]);
    jsonResponse(['ok' => true]);
}

errorResponse('invalid action', 400);
