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
//   POST ?action=bulk-transport-fee                    {hotel_ids: [], transport_fee: number|null}  ※null=未設定に戻す
//
// Status:
//   visited      ご案内実績あり
//   inquiry      ホテルに問い合わせいたします
//   unavailable  ご案内不可
//   NULL         未設定
// ==========================================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/_ctrl-session.php';   // CTRL のログインを流用（ops 独自ログインは廃止）

// 勤務実績の「お休み」印。ops_driver_logs.note に入れて空欄（未入力）と区別する（店長要望 2026-08-19）
const OPS_DRIVER_OFF = '休み';
require_once __DIR__ . '/reward-lib.php';       // 報酬計算（admin.js の calcReward と同式・biyobu.com とも共有）
require_once __DIR__ . '/_cast-sync.php';      // CTRL の girls → ops のキャスト行へ同期

setCorsHeaders();

if (!ops_current_user()) {
    errorResponse('unauthorized', 401);
}

/**
 * 預り金の既定の保有者 = 帰りのお迎え担当（ドライバー）。お迎えが無ければ担当キャスト本人。
 * キャストは接客後にお迎えのドライバーへ現金を渡す運用のため（店長指定 2026-08-07）。
 * held_by（受け渡しで明示的に記録された保有者）がある場合はそちらが優先。
 *
 * @param array<string,mixed> $row assigned_admin_id / back_driver_id を含む行
 */
function opsDefaultHolder(array $row): int {
    if (isset($row['back_driver_id']) && $row['back_driver_id'] !== null && $row['back_driver_id'] !== '') {
        return (int)$row['back_driver_id'];
    }
    return (int)($row['assigned_admin_id'] ?? 0);
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

function isOwnerSession(): bool {
    return ($_SESSION['ylka_admin_role'] ?? '') === 'owner';
}

/**
 * 制限は「上のメニュー（タブ）」だけで行う（店長指定 2026-08-14）。
 * そのタブを見られるロールなら、中の操作は全部できる。判定は権限管理（tab_permissions）に従う。
 * キャスト(staff)はマイページだけなので常に不可。
 */

/**
 * スタッフ管理の操作権限。owner は常に可。それ以外は権限管理（tab_permissions.staff）で
 * チェックの入ったロールに許可（店長要望 2026-08-14: 管理者にスタッフ管理を任せられるように）。
 * オーナーアカウントの作成・変更・削除・PW再発行は各アクション側で owner のみに制限する。
 */
function requireStaffManage(PDO $pdo): void {
    // スタッフ管理 か キャスト管理 のどちらかが見えていれば操作できる（制限はメニューだけ・店長指定 2026-08-15）
    requireAnyTabOps($pdo, ['staff', 'staffboard']);
}

/** ops の役割(owner/manager/staff/driver/office) → admins の役割(owner/staff)。owner だけ owner、他は staff。
 *  CTRL 内の細かい権限は ops_admin_users.role を見るので、admins 側は「入れるかどうか」の粗い区分でよい */
function opsRoleToAdmins(string $role): string {
    return $role === 'owner' ? 'owner' : 'staff';
}

/**
 * CTRL ログイン用 admins テーブルへ ops スタッフを反映する。
 *   ログインは admins（username＋password_hash）で行い、ops 側は _ctrl-session.php が
 *   username を照合キーにして紐付ける。両テーブルの username を必ず一致させること。
 *   $matchUsername=更新前のusername（照合用）／$newUsername=設定するusername。
 *   $passwordHash を渡した時だけパスワードを更新（新規時は必須、更新時は変更しないなら null）。
 */
function syncAdminRow(PDO $pdo, string $matchUsername, string $newUsername, ?string $email, string $displayName, string $opsRole, ?string $passwordHash = null): void {
    $adminsRole = opsRoleToAdmins($opsRole);
    $email = ($email === '' ? null : $email);
    $st = $pdo->prepare('SELECT id FROM admins WHERE username = ? LIMIT 1');
    $st->execute([$matchUsername]);
    $id = $st->fetchColumn();
    if ($id) {
        if ($passwordHash !== null) {
            $pdo->prepare('UPDATE admins SET username = ?, email = ?, display_name = ?, role = ?, password_hash = ?, modified = NOW() WHERE id = ?')
                ->execute([$newUsername, $email, $displayName, $adminsRole, $passwordHash, $id]);
        } else {
            $pdo->prepare('UPDATE admins SET username = ?, email = ?, display_name = ?, role = ?, modified = NOW() WHERE id = ?')
                ->execute([$newUsername, $email, $displayName, $adminsRole, $id]);
        }
    } else {
        $pdo->prepare('INSERT INTO admins (shop_id, username, password_hash, display_name, email, role, theme, created, modified) VALUES (NULL, ?, ?, ?, ?, ?, ?, NOW(), NOW())')
            ->execute([$newUsername, $passwordHash ?? '*', $displayName, $email, $adminsRole, 'grey-skin']);
    }
}

/** ログインIDの形式チェック（英数字と @ . _ - を許可、2〜190文字）。メールをそのままIDにもできる */
function isValidLoginId(string $s): bool {
    return (bool) preg_match('/^[A-Za-z0-9@._-]{2,190}$/', $s);
}

/**
 * POST の JSON 本文。auth-guard.php にも同名があるが、admin-api.php はそれを読み込まないので
 * ここで用意する（読み込まれている場合は二重定義にしない）。
 * 2026-08-11: これが無くて POST 系が「request failed」で落ちていた。
 */
if (!function_exists('readJsonBody')) {
    function readJsonBody(): array {
        $data = json_decode((string)file_get_contents('php://input'), true);
        return is_array($data) ? $data : [];
    }
}

$pdo    = getPdo();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($action === 'hotels' && $method === 'GET') {
    $city    = trim($_GET['city'] ?? '');
    $keyword = trim($_GET['keyword'] ?? '');
    $status  = trim($_GET['status'] ?? '');  // ''=all, 'visited', 'inquiry', 'unavailable', 'unset'
    $htype   = trim($_GET['hotel_type'] ?? '');  // ''=all, 'loveho', 'hotel'（店長要望 2026-08-08）
    $sort    = trim($_GET['sort'] ?? '');        // ''=既定(実績→市区町村→名前), 'name', 'city', 'visited'

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
    // hotel_type = 'love_hotel' がラブホ。それ以外(city/business/ryokan/minshuku/other)を「ホテル」として括る
    if ($htype === 'loveho') {
        $where[] = "h.hotel_type = 'love_hotel'";
    } elseif ($htype === 'hotel') {
        $where[] = "(h.hotel_type IS NULL OR h.hotel_type <> 'love_hotel')";
    }

    $orderBy = "FIELD(yhi.status, 'visited', 'inquiry', 'unavailable') ASC, h.city, h.name";
    if ($sort === 'name') {
        $orderBy = 'h.name';
    } elseif ($sort === 'city') {
        $orderBy = 'h.city, h.name';
    } elseif ($sort === 'visited') {
        $orderBy = 'COALESCE(yhi.visited_count, 0) DESC, h.name';
    } elseif ($sort === 'manual') {
        // 手で並べた順。未設定(NULL)は後ろにまとめて名前順（店長要望 2026-08-09）
        $orderBy = '(h.sort_order IS NULL) ASC, h.sort_order ASC, h.name';
    }

    $sql = "SELECT
                h.id, h.name, h.name_kana, h.address, h.city, h.major_area, h.detail_area,
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
            ORDER BY {$orderBy}
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
// 交通費 一括設定（マスタのホテル一覧で複数選択→まとめて設定・店長要望 2026-08-07）
// =================================================================
if ($action === 'bulk-transport-fee' && $method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    $ids  = $body['hotel_ids'] ?? [];
    $fee  = array_key_exists('transport_fee', $body) ? $body['transport_fee'] : null;
    if (!is_array($ids) || count($ids) === 0) errorResponse('hotel_ids required', 400);
    // null=未設定に戻す。数値は0円(無料)〜11,000円の550円刻みのみ許可（予約モーダルの選択肢と揃える）
    if ($fee !== null) {
        $fee = (int)$fee;
        if ($fee < 0 || $fee > 11000 || $fee % 550 !== 0) errorResponse('invalid transport_fee', 400);
    }
    $ids = array_map('intval', $ids);

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("INSERT INTO ops_ylka_hotel_info (hotel_id, transport_fee) VALUES (?, ?)
                               ON DUPLICATE KEY UPDATE transport_fee = VALUES(transport_fee)");
        foreach ($ids as $hid) {
            $stmt->execute([$hid, $fee]);
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
/** キャスト一覧の並び替え用カラム（入店日・出勤日数）。admin-users / staff-list で共用 */
function extra_sort_cols(): string {
    return ",
            (SELECT g.in_date FROM girls g WHERE g.id = au.girl_id) AS in_date,
            (SELECT COUNT(*) FROM ops_shifts sh
              WHERE sh.admin_user_id = au.id AND sh.status IN ('available','done')) AS work_days";
}

if ($action === 'admin-users' && $method === 'GET') {
    requireStaffManage($pdo);
    ops_sync_casts_if_changed(current_shop_id());
    // in_date（入店日）と work_days（出勤日数）は一覧の並び替え用（店長要望 2026-08-11）
    $rows = $pdo->query("SELECT au.id, au.username, au.email, au.display_name, au.role, au.can_drive, au.is_therapist,
                                au.is_office, au.thumbnail_url, au.sort_order, au.commission_rate, au.girl_id,
                                au.cast_notes, au.diary_url, au.diary_login, au.diary_pass, au.self_confirm_shift, au.staff_color, au.created_at" . extra_sort_cols() . "
                           FROM ops_admin_users au ORDER BY au.sort_order, au.id")->fetchAll();
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
    // 制限は上のメニュー（タブ）だけ。タイムラインを見られる人は預り金・報酬・入金分の詳細も扱う（店長指定 2026-08-14）。
    // 歩合率が無いとタイムラインの金額行そのものが出ないため、キャスト以外には返す
    $withRate = !in_array($_SESSION['ylka_admin_role'] ?? '', ['staff', ''], true);
    ops_sync_casts_if_changed(current_shop_id());
    $rows = $pdo->query("SELECT au.id, au.username, au.email, au.display_name, au.role, au.can_drive, au.is_therapist,
                                au.is_office, au.thumbnail_url, au.sort_order, au.girl_id, au.cast_notes, au.staff_color"
                        . ($withRate ? ", au.commission_rate" : "") . extra_sort_cols() . "
                           FROM ops_admin_users au ORDER BY au.sort_order, au.id")->fetchAll();
    jsonResponse(['users' => $rows]);
}

// ============ キャストからの報告（キャスト画面の「お店に報告」）============
// キャストは「気をつけてほしい/NGにしてほしい」と伝えるだけ。
// 出禁にするか・要注意にするか・その子だけ外すかの判断は店長が持つ（店長方針 2026-08-11）。
// 判断した結果は既存のお客様のNG設定（ops_customers.ng_level / ops_customer_ng_casts）に流し込むので、
// 予約を取るときの警告はそのまま効く。

if ($action === 'cast-reports' && $method === 'GET') {
    requireTabOps($pdo, 'timeline');
    $only = ($_GET['status'] ?? 'pending') === 'all' ? '' : " WHERE r.status = 'pending'";
    $st = $pdo->query(
        "SELECT r.id, r.cast_admin_id, r.customer_id, r.booking_id, r.level, r.reason,
                r.status, r.handled_at, r.created_at,
                au.display_name AS cast_name, au.username AS cast_username,
                c.name AS customer_name, c.ng_level,
                b.booking_date, b.start_time,
                hu.display_name AS handled_name,
                EXISTS (SELECT 1 FROM ops_customer_ng_casts nc
                         WHERE nc.customer_id = r.customer_id AND nc.cast_admin_id = r.cast_admin_id) AS cast_ng
           FROM ops_cast_reports r
           LEFT JOIN ops_admin_users au ON au.id = r.cast_admin_id
           LEFT JOIN ops_admin_users hu ON hu.id = r.handled_by
           LEFT JOIN ops_customers c    ON c.id  = r.customer_id
           LEFT JOIN ops_bookings b     ON b.id  = r.booking_id
          {$only}
          ORDER BY r.status = 'pending' DESC, r.created_at DESC
          LIMIT 200");
    $rows = $st->fetchAll();
    $pending = (int)$pdo->query("SELECT COUNT(*) FROM ops_cast_reports WHERE status = 'pending'")->fetchColumn();
    jsonResponse(['reports' => $rows, 'pending' => $pending]);
}

// 未対応の件数だけ（タイムライン上のバッジ用・軽い）
if ($action === 'cast-reports-count' && $method === 'GET') {
    requireTabOps($pdo, 'timeline');
    jsonResponse(['pending' => (int)$pdo->query("SELECT COUNT(*) FROM ops_cast_reports WHERE status = 'pending'")->fetchColumn()]);
}

// 報告を処理する。
//   cast_ng … そのキャストだけ外す（お店としては受ける）
//   caution … 要注意（受けるが気をつける・全体）
//   ng      … 出禁（お店として受けない・全体）
//   done    … 記録だけ残して対応済みにする
if ($action === 'cast-report-handle' && $method === 'POST') {
    requireTabOps($pdo, 'timeline');
    $b   = readJsonBody();
    $id  = (int)($b['id'] ?? 0);
    $act = (string)($b['act'] ?? '');
    if ($id <= 0 || !in_array($act, ['cast_ng', 'caution', 'ng', 'done'], true)) errorResponse('invalid params', 400);

    $st = $pdo->prepare("SELECT r.*, au.display_name AS cast_name FROM ops_cast_reports r
                           LEFT JOIN ops_admin_users au ON au.id = r.cast_admin_id
                          WHERE r.id = ? LIMIT 1");
    $st->execute([$id]);
    $r = $st->fetch();
    if (!$r) errorResponse('not found', 404);
    $cid = (int)$r['customer_id'];
    $me  = (int)($_SESSION['ylka_admin_id'] ?? 0);
    // 判断のもとになった報告文を、お客様側の理由にも残す（あとで「なぜNGか」が分かるように）
    $note = trim((string)$r['reason']);
    $stamp = date('n/j') . ' ' . trim((string)($r['cast_name'] ?? '')) . 'より' . ($note !== '' ? '「' . $note . '」' : '');

    if ($act === 'cast_ng' && $cid > 0) {
        $pdo->prepare("INSERT IGNORE INTO ops_customer_ng_casts (customer_id, cast_admin_id, reason, created_at)
                       VALUES (?, ?, ?, NOW())")->execute([$cid, (int)$r['cast_admin_id'], $stamp]);
    } elseif (($act === 'caution' || $act === 'ng') && $cid > 0) {
        $lv = $act === 'ng' ? 2 : 1;
        $cur = $pdo->prepare("SELECT ng_level, ng_reason FROM ops_customers WHERE id = ?");
        $cur->execute([$cid]);
        $c = $cur->fetch();
        // 今より軽い判断で上書きしない（出禁のお客様を要注意に落とさない）
        $newLv = max($lv, (int)($c['ng_level'] ?? 0));
        $reason = trim((string)($c['ng_reason'] ?? ''));
        $reason = $reason === '' ? $stamp : ($reason . "\n" . $stamp);
        $pdo->prepare("UPDATE ops_customers SET ng_level = ?, ng_reason = ?, ng_at = NOW() WHERE id = ?")
            ->execute([$newLv, $reason, $cid]);
    }

    $pdo->prepare("UPDATE ops_cast_reports SET status = 'done', handled_at = NOW(), handled_by = ? WHERE id = ?")
        ->execute([$me ?: null, $id]);
    jsonResponse(['ok' => true]);
}

// お客様1人ぶんの報告履歴（顧客カルテに出す）
if ($action === 'cast-reports-for-customer' && $method === 'GET') {
    requireTabOps($pdo, 'timeline');
    $cid = (int)($_GET['customer_id'] ?? 0);
    if ($cid <= 0) errorResponse('customer_id required', 400);
    $st = $pdo->prepare(
        "SELECT r.id, r.level, r.reason, r.status, r.created_at, r.handled_at,
                au.display_name AS cast_name, hu.display_name AS handled_name
           FROM ops_cast_reports r
           LEFT JOIN ops_admin_users au ON au.id = r.cast_admin_id
           LEFT JOIN ops_admin_users hu ON hu.id = r.handled_by
          WHERE r.customer_id = ? ORDER BY r.created_at DESC LIMIT 50");
    $st->execute([$cid]);
    jsonResponse(['reports' => $st->fetchAll()]);
}

// ============ キャスト管理画面（biyobu.com/cosmenote/）の専用URL ============
// キャストごとに 32桁のカギ(token)を1本発行し、URL に載せて本人に渡す。
// URL＋本人が決めた4桁の暗証番号の2段構え（ops_cast_access）。
// 暗証番号は取り出せない形（bcrypt）で保存しているので、忘れたときは
// リセットして本人に決め直してもらう。
const CAST_PORTAL_BASE = 'https://biyobu.com/cosmenote/';

if ($action === 'cast-access-list' && $method === 'GET') {
    requireTabOps($pdo, 'staffboard');
    $rows = $pdo->query("SELECT admin_user_id, token, pin_hash, pin_set_at, last_seen_at, revoked_at, locked_until
                           FROM ops_cast_access")->fetchAll();
    $out = [];
    foreach ($rows as $r) {
        $out[(string)(int)$r['admin_user_id']] = [
            'url'        => $r['revoked_at'] ? null : CAST_PORTAL_BASE . '?k=' . $r['token'],
            'pin_set'    => !empty($r['pin_hash']),
            'pin_set_at' => $r['pin_set_at'],
            'last_seen'  => $r['last_seen_at'],
            'revoked'    => !empty($r['revoked_at']),
            'locked'     => !empty($r['locked_until']) && strtotime((string)$r['locked_until']) > time(),
        ];
    }
    jsonResponse(['access' => $out, 'base' => CAST_PORTAL_BASE]);
}

// URL を発行（初回）／作り直し（前のURLは使えなくなる）
if ($action === 'cast-access-issue' && $method === 'POST') {
    requireTabOps($pdo, 'staffboard');
    $b = readJsonBody();
    $uid = (int)($b['admin_user_id'] ?? 0);
    $renew = !empty($b['renew']);
    if ($uid <= 0) errorResponse('admin_user_id required', 400);
    $st = $pdo->prepare("SELECT id, token, revoked_at FROM ops_cast_access WHERE admin_user_id = ? LIMIT 1");
    $st->execute([$uid]);
    $row = $st->fetch();
    if ($row && !$renew && empty($row['revoked_at'])) {
        jsonResponse(['url' => CAST_PORTAL_BASE . '?k=' . $row['token'], 'created' => false]);
    }
    $token = bin2hex(random_bytes(16));
    if ($row) {
        // 作り直し = 前のカギも暗証番号も無効。本人に新しいURLを渡し直す
        $pdo->prepare("UPDATE ops_cast_access
                          SET token = ?, pin_hash = NULL, pin_set_at = NULL, fail_count = 0,
                              locked_until = NULL, revoked_at = NULL
                        WHERE id = ?")->execute([$token, (int)$row['id']]);
    } else {
        $pdo->prepare("INSERT INTO ops_cast_access (admin_user_id, token, fail_count, created_at)
                       VALUES (?, ?, 0, NOW())")->execute([$uid, $token]);
    }
    jsonResponse(['url' => CAST_PORTAL_BASE . '?k=' . $token, 'created' => true]);
}

// 暗証番号だけリセット（URLはそのまま）。次に開いたとき本人が決め直す
if ($action === 'cast-access-reset-pin' && $method === 'POST') {
    requireTabOps($pdo, 'staffboard');
    $b = readJsonBody();
    $uid = (int)($b['admin_user_id'] ?? 0);
    if ($uid <= 0) errorResponse('admin_user_id required', 400);
    $pdo->prepare("UPDATE ops_cast_access
                      SET pin_hash = NULL, pin_set_at = NULL, fail_count = 0, locked_until = NULL
                    WHERE admin_user_id = ?")->execute([$uid]);
    jsonResponse(['ok' => true]);
}

// 店長が暗証番号を決める（店長指定 2026-08-11）。
// 保存は取り出せない形（bcrypt）のまま＝DBを見られても番号は分からない。
// 「店長が決めた番号だから店長は知っている」という運用で、画面に数字は出さない。
if ($action === 'cast-access-set-pin' && $method === 'POST') {
    requireTabOps($pdo, 'staffboard');
    $b = readJsonBody();
    $uid = (int)($b['admin_user_id'] ?? 0);
    $pin = preg_replace('/[^0-9]/', '', (string)($b['pin'] ?? ''));
    if ($uid <= 0) errorResponse('admin_user_id required', 400);
    if (strlen($pin) !== 4) errorResponse('暗証番号は4桁の数字で入れてください', 400);
    $st = $pdo->prepare("SELECT id FROM ops_cast_access WHERE admin_user_id = ? AND revoked_at IS NULL LIMIT 1");
    $st->execute([$uid]);
    $row = $st->fetch();
    if (!$row) errorResponse('先に専用URLを発行してください', 400);
    $pdo->prepare("UPDATE ops_cast_access
                      SET pin_hash = ?, pin_set_at = NOW(), fail_count = 0, locked_until = NULL
                    WHERE id = ?")->execute([password_hash($pin, PASSWORD_DEFAULT), (int)$row['id']]);
    jsonResponse(['ok' => true]);
}

// URLを止める（退店など）。同じ人に再発行するときは cast-access-issue の renew
if ($action === 'cast-access-revoke' && $method === 'POST') {
    requireTabOps($pdo, 'staffboard');
    $b = readJsonBody();
    $uid = (int)($b['admin_user_id'] ?? 0);
    if ($uid <= 0) errorResponse('admin_user_id required', 400);
    $pdo->prepare("UPDATE ops_cast_access SET revoked_at = NOW() WHERE admin_user_id = ?")->execute([$uid]);
    jsonResponse(['ok' => true]);
}

// キャストの注意事項（猫アレルギー等・予約を取る前に確認するもの）。
// 受付で気づいた点をその場で足せるよう、admin-update(owner限定)とは別に店長も許可する。
if ($action === 'cast-note-update' && $method === 'POST') {
    requireTabOps($pdo, 'timeline');
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
    requireTabOps($pdo, 'hotel');
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

    // タイプ（ラブホ / シティ / ビジネス / 旅館 / 民宿 / その他）。一覧の絞り込みは love_hotel かどうかで分けている
    $typeList = ['love_hotel', 'city', 'business', 'ryokan', 'minshuku', 'other'];
    $rawType  = (string)($body['hotel_type'] ?? '');
    $type     = in_array($rawType, $typeList, true) ? $rawType : null;

    // 読み仮名（あいうえお順の並び用）。カタカナ・ひらがなの名前は画面側で自動生成するので空でよい
    $kana = mb_substr(trim((string)($body['name_kana'] ?? '')), 0, 255);

    if ($id > 0) {
        if ($type !== null) {
            $st = $pdo->prepare('UPDATE ops_hotels SET name=?, name_kana=?, city=?, address=?, prefecture=?, tel=?, hotel_type=?, is_edited=1, updated_at=NOW() WHERE id=?');
            $st->execute([mb_substr($name, 0, 255), $kana ?: null, $city, $addr, $pref, $tel ?: null, $type, $id]);
        } else {
            // 未知の値が来たときは今の値を壊さない（画面が古い等）
            $st = $pdo->prepare('UPDATE ops_hotels SET name=?, name_kana=?, city=?, address=?, prefecture=?, tel=?, is_edited=1, updated_at=NOW() WHERE id=?');
            $st->execute([mb_substr($name, 0, 255), $kana ?: null, $city, $addr, $pref, $tel ?: null, $id]);
        }
        jsonResponse(['ok' => true, 'id' => $id]);
    }
    $st = $pdo->prepare("INSERT INTO ops_hotels (name, name_kana, address, prefecture, city, hotel_type, source, tel, is_published, is_edited, created_at, updated_at)
                         VALUES (?,?,?,?,?,?,'manual',?,1,1,NOW(),NOW())");
    $st->execute([mb_substr($name, 0, 255), $kana ?: null, $addr, $pref, $city, $type ?? 'love_hotel', $tel ?: null]);
    jsonResponse(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

// ホテル一覧の手動並べ替え（「並び順: 自分の順番」でドラッグしたときに保存）。
// 送られてきた id の並びをそのまま 1 から振り直す。送られていないホテルには触らない。
if ($action === 'hotel-reorder' && $method === 'POST') {
    requireTabOps($pdo, 'courses');
    $body = json_decode(file_get_contents('php://input'), true);
    $ids  = array_values(array_filter(array_map('intval', (array)($body['ids'] ?? [])), fn($v) => $v > 0));
    if (!$ids) errorResponse('ids required', 400);
    if (count($ids) > 2000) errorResponse('too many', 400);
    $st = $pdo->prepare('UPDATE ops_hotels SET sort_order = ? WHERE id = ?');
    $pdo->beginTransaction();
    foreach ($ids as $i => $hid) $st->execute([$i + 1, $hid]);
    $pdo->commit();
    jsonResponse(['ok' => true, 'count' => count($ids)]);
}

// ホテルをリストから外す（YLKA由来の民宿など、アドミでは使わないものを消すため）。
//   予約で使われているホテルは【消さずに非表示】にする。履歴の hotel_id が迷子になるのを防ぐ。
//   使われていないものは実削除（ops_ylka_hotel_info も一緒に）。
if ($action === 'hotel-delete' && $method === 'POST') {
    requireTabOps($pdo, 'courses');
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
    requireStaffManage($pdo);
    $body         = json_decode(file_get_contents('php://input'), true);
    // ログインID（CTRL ログインで打つID）とメールアドレス（送迎/認証コード送信先）は別物
    $loginId      = trim($body['login_id'] ?? '');
    $email        = trim($body['email'] ?? '');
    $password     = $body['password'] ?? '';
    $displayName  = trim($body['display_name'] ?? '');
    $role         = $body['role'] ?? 'staff';
    if ($loginId === '' || !isValidLoginId($loginId)) errorResponse('ログインIDは英数字・記号(@._-)で入力してください', 400);
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) errorResponse('メールアドレスの形式が正しくありません', 400);
    if (strlen($password) < 8) errorResponse('password must be at least 8 chars', 400);
    if (!in_array($role, ['owner', 'manager', 'staff', 'driver', 'office'], true)) errorResponse('invalid role', 400);
    if ($role === 'owner' && !isOwnerSession()) errorResponse('オーナー権限のアカウントはオーナーのみ作成できます', 403);
    if ($displayName === '') errorResponse('display_name required', 400);

    // ログインIDは ops_admin_users・admins の両方でユニークでなければならない
    $exists = $pdo->prepare('SELECT 1 FROM ops_admin_users WHERE username = ?');
    $exists->execute([$loginId]);
    if ($exists->fetch()) errorResponse('このログインIDは既に使われています', 409);
    $existsA = $pdo->prepare('SELECT 1 FROM admins WHERE username = ?');
    $existsA->execute([$loginId]);
    if ($existsA->fetch()) errorResponse('このログインIDは既に使われています', 409);

    $rate = isset($body['commission_rate']) && $body['commission_rate'] !== '' ? max(0, min(100, (float)$body['commission_rate'])) : 50.0;
    $canDrive = !empty($body['can_drive']) ? 1 : 0;
    $isTherapist = !empty($body['is_therapist']) ? 1 : 0;
    $isOffice = !empty($body['is_office']) ? 1 : 0;
    $hash = password_hash($password, PASSWORD_BCRYPT);

    $pdo->beginTransaction();
    // ① ログイン基盤（admins）に作る。ここに無いと CTRL ログインできない
    syncAdminRow($pdo, $loginId, $loginId, $email, $displayName, $role, $hash);
    // ② ops 側プロファイル（担当割当・歩合など）。username は admins と一致させる
    $pdo->prepare('INSERT INTO ops_admin_users (username, email, password_hash, display_name, role, can_drive, is_therapist, is_office, commission_rate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())')
        ->execute([$loginId, ($email === '' ? null : $email), $hash, $displayName, $role, $canDrive, $isTherapist, $isOffice, $rate]);
    $newId = (int)$pdo->lastInsertId();
    $pdo->commit();
    jsonResponse(['ok' => true, 'id' => $newId]);
}

if ($action === 'admin-update' && $method === 'POST') {
    requireStaffManage($pdo);
    $body        = json_decode(file_get_contents('php://input'), true);
    $id          = (int)($body['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    // オーナーアカウントの編集・オーナーへの昇格は owner のみ（権限管理でスタッフ管理を許可された管理者の権限昇格を防ぐ）
    if (!isOwnerSession()) {
        $tq = $pdo->prepare('SELECT role FROM ops_admin_users WHERE id = ?');
        $tq->execute([$id]);
        if ((string)$tq->fetchColumn() === 'owner') errorResponse('オーナーのアカウントはオーナーのみ編集できます', 403);
        if (($body['role'] ?? '') === 'owner') errorResponse('オーナー権限の付与はオーナーのみ行えます', 403);
    }

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
    // 兼任ルールの担保（店長指定 2026-08-07）: キャスト(staff)以外は「キャスト兼任」にしない。
    // 編集画面の該当チェックは hidden で画面から外せないため、保存のたびに既存値がそのまま
    // 書き戻され、一度立った is_therapist を消せなかった
    //（2026-08-08 オーナーの宮時がOPSのキャスト欄に出続けた）。ここで最終的な役割を見て落とす。
    $roleAfter = (array_key_exists('role', $body) && $body['role'] !== null)
        ? (string) $body['role']
        : (string) ($pdo->query('SELECT role FROM ops_admin_users WHERE id = ' . (int) $id)->fetchColumn() ?: '');
    if ($roleAfter !== 'staff') {
        $cols[] = 'is_therapist = ?';
        $vals[] = 0;
    } elseif (array_key_exists('is_therapist', $body)) {
        $cols[] = 'is_therapist = ?';
        $vals[] = !empty($body['is_therapist']) ? 1 : 0;
    }
    if (array_key_exists('is_office', $body)) {
        $cols[] = 'is_office = ?';
        $vals[] = !empty($body['is_office']) ? 1 : 0;
    }
    // ログインID（CTRL ログインで打つID = username）の変更
    if (array_key_exists('login_id', $body) && trim((string)$body['login_id']) !== '') {
        $newLoginId = trim((string)$body['login_id']);
        if (!isValidLoginId($newLoginId)) errorResponse('ログインIDは英数字・記号(@._-)で入力してください', 400);
        $chk = $pdo->prepare('SELECT 1 FROM ops_admin_users WHERE username = ? AND id <> ?');
        $chk->execute([$newLoginId, $id]);
        if ($chk->fetch()) errorResponse('このログインIDは既に使われています', 409);
        // admins 側でも、自分の現行username以外と衝突しないこと
        $curU = (string)$pdo->query('SELECT username FROM ops_admin_users WHERE id = ' . (int)$id)->fetchColumn();
        $chkA = $pdo->prepare('SELECT 1 FROM admins WHERE username = ? AND username <> ?');
        $chkA->execute([$newLoginId, $curU]);
        if ($chkA->fetch()) errorResponse('このログインIDは既に使われています', 409);
        $cols[] = 'username = ?'; $vals[] = $newLoginId;
    }
    // メールアドレス（送迎メール・認証コードの送信先）の変更。空文字なら未設定にする
    if (array_key_exists('email', $body)) {
        $newEmail = trim((string)$body['email']);
        if ($newEmail !== '' && !filter_var($newEmail, FILTER_VALIDATE_EMAIL)) errorResponse('メールアドレスの形式が正しくありません', 400);
        $cols[] = 'email = ?'; $vals[] = ($newEmail === '' ? null : $newEmail);
    }
    // 写メ日記のURL・ログインID・パスワード（キャスト本人がcosmenoteから使う。空にもできる）
    foreach (['diary_url', 'diary_login', 'diary_pass'] as $dk) {
        if (array_key_exists($dk, $body)) {
            $v = trim((string)$body[$dk]);
            $cols[] = "$dk = ?"; $vals[] = ($v === '' ? null : $v);
        }
    }
    // キャスト画面の「出勤確認」ボタンを出すか（既定は非表示）
    if (array_key_exists('self_confirm_shift', $body)) {
        $cols[] = 'self_confirm_shift = ?'; $vals[] = !empty($body['self_confirm_shift']) ? 1 : 0;
    }
    // 預り金カード色（内勤以上）。#rrggbb か空（未設定）。同じ色の二重登録は不可（誰の現金か見分けるための色のため）
    if (array_key_exists('staff_color', $body)) {
        $sc = trim((string)$body['staff_color']);
        if ($sc !== '' && !preg_match('/^#[0-9a-fA-F]{6}$/', $sc)) errorResponse('invalid staff_color', 400);
        if ($sc !== '') {
            $dq = $pdo->prepare('SELECT display_name FROM ops_admin_users WHERE staff_color = ? AND id <> ? LIMIT 1');
            $dq->execute([$sc, $id]);
            $dupe = $dq->fetchColumn();
            if ($dupe !== false) errorResponse('この色は ' . $dupe . ' さんが使用中です。別の色を選んでください', 409);
        }
        $cols[] = 'staff_color = ?'; $vals[] = $sc;
    }
    if (!$cols) errorResponse('nothing to update', 400);

    // admins の照合キーは更新前の username。先に控える
    $oldUsername = (string)$pdo->query('SELECT username FROM ops_admin_users WHERE id = ' . (int)$id)->fetchColumn();

    $pdo->beginTransaction();
    $vals[] = $id;
    $pdo->prepare("UPDATE ops_admin_users SET " . implode(', ', $cols) . " WHERE id = ?")->execute($vals);
    // ログイン基盤（admins）へ反映。最新の ops 値を読み直して同期（パスワードは触らない）
    $u = $pdo->prepare('SELECT username, email, display_name, role FROM ops_admin_users WHERE id = ?');
    $u->execute([$id]);
    $row = $u->fetch();
    if ($row) {
        syncAdminRow($pdo, $oldUsername, (string)$row['username'], (string)($row['email'] ?? ''), (string)($row['display_name'] ?: $row['username']), (string)$row['role']);
    }
    $pdo->commit();
    jsonResponse(['ok' => true]);
}

// 報酬計算はキャスト用画面（biyobu.com）とも共有するため reward-lib.php に集約（2026-08-10）
if ($action === 'payroll' && $method === 'GET') {
    requireTabOps($pdo, 'payroll');
    $from = $_GET['from'] ?? date('Y-m-01');
    $to   = $_GET['to']   ?? date('Y-m-t');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) errorResponse('invalid from', 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $to))   errorResponse('invalid to', 400);

    $sql = "SELECT b.id, b.booking_date, b.start_time, b.assigned_admin_id,
                   b.customer_name_snapshot, b.course_name, b.menu_items, b.nomination_type, b.extension_count, b.hotel_price_applied,
                   b.price, b.late_fee, b.transport_fee, b.card_fee, b.cash_amount, b.payment_method,
                   b.driver_id, b.go_self, b.back_driver_id, b.back_self, b.status, b.cancellation_fee, b.cancellation_reward, b.reward_override,
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
        // コース報酬はマスタの固定額（歩合率は使わない・店長方針 2026-08-05）＋ 指名料の報酬
        $courseReward = (int)(opsCourseCastReward($r['course_name'] ?? null, (int)($r['hotel_price_applied'] ?? 0) === 1) ?? 0)
                      + $optionReward + opsNominationReward($r["nomination_type"] ?? null) * opsCourseUnitCount($r["course_name"] ?? null)
                      + opsExtensionRewardUnit() * (int)($r["extension_count"] ?? 0);
        // 機動ボーナスは「キャスト（自走）」を選んだ片道だけ。「-（未定）」は送迎とみなす
        [$goSelf, $backSelf] = opsSelfLegs($r);
        $tTherapist = ylkaTherapistTransport($trans, !$goSelf, !$backSelf);
        $lateTherapist = $backSelf ? $late : 0;  // 帰りが自走のときだけ深夜料金はキャスト
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
            'cash_amount'    => isset($r['cash_amount']) ? (int)$r['cash_amount'] : null,
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
    requireTabOps($pdo, 'courses');
    $body = json_decode(file_get_contents('php://input'), true);
    $ins = $pdo->prepare("INSERT INTO ops_admin_settings (setting_key, setting_value) VALUES (?, ?)
                          ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)");
    $out = ['ok' => true];
    if (array_key_exists('card_fee_rate', $body)) {
        $rate = max(0, min(100, (float)$body['card_fee_rate']));
        $ins->execute(['card_fee_rate', (string)$rate]);
        $out['card_fee_rate'] = $rate;
    }
    // お客様の合計に上乗せする率（マスタタブで設定・店長要望 2026-08-07）
    if (array_key_exists('card_surcharge_rate', $body)) {
        $sur = max(0, min(100, (float)$body['card_surcharge_rate']));
        $ins->execute(['card_surcharge_rate', (string)$sur]);
        $out['card_surcharge_rate'] = $sur;
    }
    jsonResponse($out);
}

// =================================================================
// 指名料（初指名/本指名/フリー、固定額）の取得/保存。予約保存時の合計加算・フッターサマリー内訳表示に使用
// =================================================================

// 汎用の店舗設定（許可キーのみ）。いまは事務所の住所（ルート案内の既定の出発地）。
// chat_inbox_url: YobuChat の店舗受信箱を枠内に出すための URL（?owner_token= 付き）。
// 別ドメインなので Cookie も localStorage も共有されず、これが無いと訪問者画面しか出せない
const OPS_SETTING_KEYS = ['office_address', 'chat_inbox_url'];

if ($action === 'setting-get' && $method === 'GET') {
    $k = (string)($_GET['key'] ?? '');
    if (!in_array($k, OPS_SETTING_KEYS, true)) errorResponse('unknown key', 400);
    $q = $pdo->prepare("SELECT setting_value FROM ops_admin_settings WHERE setting_key = ?");
    $q->execute([$k]);
    jsonResponse(['key' => $k, 'value' => (string)($q->fetchColumn() ?: '')]);
}

if ($action === 'setting-set' && $method === 'POST') {
    requireTabOps($pdo, 'courses');
    $body = json_decode(file_get_contents('php://input'), true);
    $k = (string)($body['key'] ?? '');
    if (!in_array($k, OPS_SETTING_KEYS, true)) errorResponse('unknown key', 400);
    $v = mb_substr(trim((string)($body['value'] ?? '')), 0, 190);
    $pdo->prepare("INSERT INTO ops_admin_settings (setting_key, setting_value) VALUES (?, ?)
                   ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)")->execute([$k, $v]);
    jsonResponse(['ok' => true, 'key' => $k, 'value' => $v]);
}

if ($action === 'nomination-fees-get' && $method === 'GET') {
    jsonResponse([
        'nomination_fees'    => getNominationFees($pdo),
        'nomination_rewards' => getNominationRewards($pdo),
    ]);
}

if ($action === 'nomination-fees-set' && $method === 'POST') {
    requireTabOps($pdo, 'courses');
    $body = json_decode(file_get_contents('php://input'), true);
    $fees    = $body['nomination_fees'] ?? [];
    $rewards = $body['nomination_rewards'] ?? null;   // 送られてこなければ据え置き
    $save = $pdo->prepare("INSERT INTO ops_admin_settings (setting_key, setting_value) VALUES (?, ?)
                           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)");
    foreach (['first', 'regular', 'free'] as $type) {
        $save->execute(['nomination_fee_' . $type, (string)max(0, (int)($fees[$type] ?? 0))]);
        if (is_array($rewards)) {
            $save->execute(['nomination_reward_' . $type, (string)max(0, (int)($rewards[$type] ?? 0))]);
        }
    }
    jsonResponse([
        'ok'                 => true,
        'nomination_fees'    => getNominationFees($pdo),
        'nomination_rewards' => getNominationRewards($pdo),
    ]);
}

// =================================================================
// 自宅の交通費マスタ（市区町村ごと）— 店長要望 2026-08-08
//   ホテルは ops_ylka_hotel_info.transport_fee（ホテル1軒ごと）と連動。
//   自宅・オフィスはホテルが無いので、市区町村を選んだ時点でここの金額を入れる。
// =================================================================
if ($action === 'city-fees' && $method === 'GET') {
    // 登録済みの金額 + 選択肢に出す市区町村（ホテルの登録がある市区町村）をまとめて返す。
    // fees は { 市区町村: { "": 全域の額, 町名: その町の額, ... } }。town="" が市区町村全体。
    $fees = [];
    foreach ($pdo->query('SELECT city, town, transport_fee FROM ops_city_transport_fees ORDER BY city, town') as $r) {
        $fees[$r['city']][$r['town']] = (int)$r['transport_fee'];
    }
    $cities = [];
    foreach ($pdo->query("SELECT DISTINCT city FROM ops_hotels WHERE is_published = 1 AND city <> '' ORDER BY city") as $r) {
        $cities[] = $r['city'];
    }
    // マスタにだけあって、ホテルが無くなった市区町村も選択肢に残す（設定が迷子にならないように）
    foreach (array_keys($fees) as $c) {
        if (!in_array($c, $cities, true)) $cities[] = $c;
    }
    sort($cities);
    jsonResponse(['fees' => $fees, 'cities' => $cities]);
}

if ($action === 'city-fee-set' && $method === 'POST') {
    requireTabOps($pdo, 'courses');
    $body = json_decode(file_get_contents('php://input'), true);
    $city = trim((string)($body['city'] ?? ''));
    $town = trim((string)($body['town'] ?? ''));   // '' = 市区町村全体
    if ($city === '') errorResponse('city required', 400);
    // fee を空/null で送ると、その設定を消す（未設定に戻す）
    if (!array_key_exists('transport_fee', $body) || $body['transport_fee'] === '' || $body['transport_fee'] === null) {
        $pdo->prepare('DELETE FROM ops_city_transport_fees WHERE city = ? AND town = ?')->execute([$city, $town]);
        jsonResponse(['ok' => true, 'city' => $city, 'town' => $town, 'transport_fee' => null]);
    }
    $fee = max(0, (int)$body['transport_fee']);
    $pdo->prepare('INSERT INTO ops_city_transport_fees (city, town, transport_fee) VALUES (?, ?, ?)
                   ON DUPLICATE KEY UPDATE transport_fee = VALUES(transport_fee)')->execute([$city, $town, $fee]);
    jsonResponse(['ok' => true, 'city' => $city, 'town' => $town, 'transport_fee' => $fee]);
}

if ($action === 'city-towns' && $method === 'GET') {
    // 市区町村の町名一覧。初回は Geolonia 住所データ（国土交通省 位置参照情報ベースの公開データ）から
    // 取得して ops_city_towns にキャッシュし、以後はDBから返す（外部が落ちていても動く）。
    // 丁目は畳む（曙町一丁目/二丁目 → 曙町）。並びは元データの順＝あいうえお順をそのまま保つ。
    // 各町に立川駅からの直線距離 km を付けて返す（マスタの表示用。緯度経度は丁目の平均）。
    $city = trim($_GET['city'] ?? '');
    if ($city === '') errorResponse('city required', 400);

    // 立川駅からの直線距離（km・小数1桁）。lat/lng が無い行は null
    $kmFromTachikawa = static function ($lat, $lng): ?float {
        if ($lat === null || $lng === null) return null;
        $la1 = deg2rad(35.69794); $la2 = deg2rad((float)$lat);
        $dLa = deg2rad((float)$lat - 35.69794); $dLo = deg2rad((float)$lng - 139.41395);
        $a = sin($dLa / 2) ** 2 + cos($la1) * cos($la2) * sin($dLo / 2) ** 2;
        return round(6371.0 * 2 * atan2(sqrt($a), sqrt(1 - $a)), 1);
    };

    $st = $pdo->prepare('SELECT town, lat, lng FROM ops_city_towns WHERE city = ? ORDER BY sort_order, town');
    $st->execute([$city]);
    $cached = $st->fetchAll();
    // 緯度経度が1件も入っていないキャッシュは、距離が出せないので取り直す
    // （lat/lng を持つ前の古いキャッシュが残っていた: 杉並区・練馬区ほか・店長指摘 2026-08-11）
    $hasGeo = false;
    foreach ($cached as $r) { if ($r['lat'] !== null && $r['lng'] !== null) { $hasGeo = true; break; } }
    if ($cached !== [] && $hasGeo) {
        $towns = array_map(static fn ($r) => ['name' => $r['town'], 'km' => $kmFromTachikawa($r['lat'], $r['lng'])], $cached);
        jsonResponse(['city' => $city, 'towns' => $towns, 'cached' => true]);
    }

    $pf = $pdo->prepare("SELECT prefecture FROM ops_hotels WHERE city = ? AND prefecture <> '' LIMIT 1");
    $pf->execute([$city]);
    $pref = (string)($pf->fetchColumn() ?: '東京都');
    $url = 'https://geolonia.github.io/japanese-addresses/api/ja/'
         . rawurlencode($pref) . '/' . rawurlencode($city) . '.json';
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_FOLLOWLOCATION => true]);
    $bodyRaw = curl_exec($ch);
    curl_close($ch);
    $rows = json_decode((string)$bodyRaw, true);
    if (!is_array($rows)) jsonResponse(['city' => $city, 'towns' => [], 'error' => 'town list fetch failed']);
    // 丁目を畳みつつ緯度経度を平均して町の代表点にする
    $agg = [];   // name => [latSum, lngSum, n, order]
    $order = 0;
    foreach ($rows as $r) {
        $t = trim((string)preg_replace('/[一二三四五六七八九十〇]+丁目$/u', '', (string)($r['town'] ?? '')));
        $t = (string)preg_replace('/^大字/u', '', $t);   // 「大字箱根ケ崎」→「箱根ケ崎」。表記として不要（店長指定 2026-08-08）
        if ($t === '') continue;
        if (!isset($agg[$t])) $agg[$t] = [0.0, 0.0, 0, $order++];
        if (isset($r['lat'], $r['lng'])) {
            $agg[$t][0] += (float)$r['lat'];
            $agg[$t][1] += (float)$r['lng'];
            $agg[$t][2]++;
        }
    }
    // 取り直しのときは既存行の緯度経度も更新する（INSERT IGNORE だけだと NULL のまま残る）
    $ins = $pdo->prepare('INSERT INTO ops_city_towns (city, town, sort_order, lat, lng) VALUES (?, ?, ?, ?, ?)
                          ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), lat = VALUES(lat), lng = VALUES(lng)');
    $towns = [];
    foreach ($agg as $t => [$latSum, $lngSum, $n, $ord]) {
        $lat = $n ? $latSum / $n : null;
        $lng = $n ? $lngSum / $n : null;
        $ins->execute([$city, $t, $ord, $lat, $lng]);
        $towns[] = ['name' => $t, 'km' => $kmFromTachikawa($lat, $lng)];
    }
    jsonResponse(['city' => $city, 'towns' => $towns, 'cached' => false]);
}

// =================================================================
// ドライバー: その日の送迎・保有預り金・勤務実績（owner / manager が閲覧・入力）
// =================================================================
if ($action === 'driver-day' && $method === 'GET') {
    requireTabOps($pdo, 'staffboard');
    $did  = (int)($_GET['driver_id'] ?? 0);
    $date = $_GET['date'] ?? date('Y-m-d');
    if ($did <= 0) errorResponse('invalid driver_id', 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) errorResponse('invalid date', 400);
    $bizDay = ylkaBizDayExpr('b');

    // 送迎（送り=driver_id / お迎え=back_driver_id）。1予約で両方担当もあり得る
    $st = $pdo->prepare(
        "SELECT b.id, b.customer_name_snapshot, b.hotel_name_snapshot, b.display_city, b.room_number,
                b.start_time, b.end_time, b.pickup_go_time, b.pickup_back_time, b.driver_id, b.go_self, b.back_driver_id, b.back_self,
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
        "SELECT b.id, b.customer_name_snapshot, b.course_name, b.price, b.late_fee, b.transport_fee, b.card_fee, b.cash_amount, b.hotel_price_applied, b.menu_items, b.nomination_type, b.extension_count, b.driver_id, b.go_self, b.back_driver_id, b.back_self,
                b.status, b.cancellation_fee, b.cancellation_reward, b.reward_override, b.payment_method, b.settle_kind,
                au.commission_rate, au.display_name AS therapist_name, au.username AS therapist_username
         FROM ops_bookings b
         LEFT JOIN ops_admin_users au ON au.id = b.assigned_admin_id
         WHERE (b.held_by = ? OR (b.held_by IS NULL AND b.back_driver_id = ?))
           AND (b.shop_settled IS NULL OR b.shop_settled = 0)
           AND (b.status NOT IN ('cancelled','no_show','inquiry') OR (b.status='cancelled' AND b.cancellation_reason_type='customer'))
           AND $bizDay = ?" . ylkaExcludeBreakSql('b') . "
         ORDER BY b.start_time"
    );
    // held_by 未設定でも「帰りのお迎え担当」なら既定でその人が持っている扱い（opsDefaultHolder と同じ考え方）
    $cst->execute([$did, $did, $date]);
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

// その日「休み」にしたドライバー一覧（勤務実績のノート=OPS_DRIVER_OFF）。
//   タイムラインの送迎ドライバー選択で「休みにした人は出さない」ため（店長要望 2026-08-20）。
//   まとめの出勤ステータス(off)とは別管理なので、こちらも合わせて見る必要がある
if ($action === 'driver-off-list' && $method === 'GET') {
    requireTabOps($pdo, 'timeline');
    $date = (string)($_GET['date'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) errorResponse('invalid date', 400);
    $st = $pdo->prepare('SELECT driver_id FROM ops_driver_logs WHERE work_date = ? AND note = ?');
    $st->execute([$date, OPS_DRIVER_OFF]);
    jsonResponse(['date' => $date, 'driver_ids' => array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN))]);
}

if ($action === 'driver-log-upsert' && $method === 'POST') {
    requireTabOps($pdo, 'timeline');
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
    // お休み（シフトに入っていたが結局出ていない）。時刻・走行距離は消して note に印を付ける。
    // 空欄のままだと「まだ入力していない」のか「休んだ」のか分からなかった（店長要望 2026-08-19）
    if (!empty($body['off'])) {
        $ci = null; $co = null; $kmV = null; $note = OPS_DRIVER_OFF;
    } elseif ($note === OPS_DRIVER_OFF) {
        $note = '';   // 休み解除
    }
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
    requireTabOps($pdo, 'payroll');
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
    // 併用(split)は1件の中に現金とクレジットが混ざるので、合計ではなく1件ずつ振り分ける
    $st = $pdo->prepare("SELECT payment_method, cash_amount,
                                CASE WHEN status='cancelled' THEN COALESCE(cancellation_fee,0)
                                     ELSE price + COALESCE(transport_fee,0) + COALESCE(card_fee,0) END AS amt
                         FROM ops_bookings
                         WHERE (status NOT IN ('cancelled','no_show','inquiry') OR (status='cancelled' AND cancellation_reason_type='customer')) AND $bizDay BETWEEN ? AND ?$tCond$noBreak");
    $st->execute(array_merge([$from, $to], $tArg));
    foreach ($st->fetchAll() as $r) {
        $amt = (int)$r['amt'];
        $pm = $r['payment_method'];
        if ($pm === 'split') {
            // 現金で受け取った額と、残り（＝カードで切った額）に分ける
            $cash = min($amt, max(0, (int)$r['cash_amount']));
            $sales['cash']   += $cash;
            $sales['credit'] += $amt - $cash;
        }
        elseif ($pm === 'cash') $sales['cash'] += $amt;
        elseif ($pm === 'credit' || $pm === 'card') $sales['credit'] += $amt;
        elseif ($pm === 'bank') $sales['bank'] += $amt;
        else $sales['unset'] += $amt;
        $sales['total'] += $amt;
        $sales['count']++;
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
    // カード会社へ払う手数料は、お客様からいただいた上乗せ分と「同額」で計上して相殺する。
    // 実際の料率は約8%で、上乗せの10%とだいたい同じになるため（店長指定 2026-08-08）。
    // 厳密な経理は弥生会計側で行うので、OPSでは「カード決済でも店の取り分は変わらない」と見なす。
    // ※ 決済額×料率で出すと上乗せ分にも手数料がかかって数百円ズレ、日々の確認がしづらかった
    $cardFee = $breakdown['card'];

    // 報酬合計
    $rwst = $pdo->prepare("SELECT b.course_name, b.price, b.late_fee, b.transport_fee, b.card_fee, b.cash_amount, b.hotel_price_applied, b.menu_items, b.nomination_type, b.extension_count, b.driver_id, b.go_self, b.back_driver_id, b.back_self, b.status, b.cancellation_fee, b.cancellation_reward, b.reward_override, b.payment_method, au.commission_rate
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
    requireTabOps($pdo, 'payroll');
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
    requireTabOps($pdo, 'payroll');
    $from = $_GET['from'] ?? date('Y-m-01');
    $to   = $_GET['to']   ?? date('Y-m-t');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) errorResponse('invalid from', 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $to))   errorResponse('invalid to', 400);

    $tid = ylkaReqTherapistId();
    $tCondB = $tid ? ' AND b.assigned_admin_id = ?' : '';
    $tArg = $tid ? [$tid] : [];
    $sql = "SELECT b.id, b.booking_date, b.start_time, b.customer_name_snapshot, b.course_name,
                   b.price, b.late_fee, b.transport_fee, b.card_fee, b.cash_amount, b.hotel_price_applied, b.menu_items, b.nomination_type, b.extension_count, b.driver_id, b.go_self, b.back_driver_id, b.back_self, b.payment_method, b.shop_settled, b.shop_settled_at,
                   b.status, b.cancellation_fee, b.cancellation_reward, b.reward_override, b.assigned_admin_id, b.held_by,
                   au.display_name, au.username, au.commission_rate,
                   h.display_name AS holder_name, h.username AS holder_username,
                   bd.display_name AS back_drv_name, bd.username AS back_drv_username
            FROM ops_bookings b
            LEFT JOIN ops_admin_users au ON au.id = b.assigned_admin_id
            LEFT JOIN ops_admin_users h ON h.id = b.held_by
            LEFT JOIN ops_admin_users bd ON bd.id = b.back_driver_id
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
        // held_by が無ければ「帰りのお迎え担当」が既定の保有者（opsDefaultHolder と同じ考え方）
        $heldBy = ($r['held_by'] !== null && $r['held_by'] !== '') ? (int)$r['held_by']
                : (($r['back_driver_id'] !== null && $r['back_driver_id'] !== '') ? (int)$r['back_driver_id'] : null);
        $holderName = ($r['held_by'] !== null && $r['held_by'] !== '')
            ? ($r['holder_name'] ?: $r['holder_username'] ?: null)
            : ($r['back_drv_name'] ?: $r['back_drv_username'] ?: null);
        $rows[] = [
            'id'        => (int)$r['id'],
            'date'      => $r['booking_date'],
            'time'      => substr((string)$r['start_time'], 0, 5),
            'therapist' => $r['display_name'] ?: ($r['username'] ?: '(未割当)'),
            'customer'  => $r['customer_name_snapshot'],
            'course'    => $r['course_name'],
            'payment_method' => $r['payment_method'], 'cash_amount' => isset($r['cash_amount']) ? (int)$r['cash_amount'] : null,
            'sales'     => $sales,
            'reward'    => $reward,
            'shop_amount' => $shop,
            'settled'   => $settled,
            'settled_at'=> $r['shop_settled_at'],
            'assigned_admin_id' => (int)$r['assigned_admin_id'],
            'held_by'   => $heldBy,
            'holder'    => $heldBy ? ($holderName ?: ('#' . $heldBy)) : null,
        ];
        if ($settled) { $sum['settled'] += $shop; $sum['settled_count']++; }
        else { $sum['unsettled'] += $shop; $sum['unsettled_count']++; }
    }
    jsonResponse(['from' => $from, 'to' => $to, 'rows' => $rows, 'summary' => $sum]);
}

if ($action === 'booking-set-holder' && $method === 'POST') {
    requireTabOps($pdo, 'timeline');
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
    requireTabOps($pdo, 'timeline');
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
    requireTabOps($pdo, 'timeline');
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
    requireTabOps($pdo, 'timeline');
    $ids = array_values(array_filter(array_map('intval', explode(',', (string)($_GET['ids'] ?? ''))), fn($v) => $v > 0));
    if (!$ids) { jsonResponse(['handoffs' => []]); }
    $place = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $pdo->prepare("SELECT id, booking_id, from_admin_id, to_admin_id, created_at
                           FROM ops_booking_handoffs WHERE booking_id IN ($place) ORDER BY booking_id, created_at, id");
    $stmt->execute($ids);
    jsonResponse(['handoffs' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
}

if ($action === 'booking-handoff-add' && $method === 'POST') {
    requireTabOps($pdo, 'timeline');
    $body = json_decode(file_get_contents('php://input'), true);
    $id = (int)($body['booking_id'] ?? 0);
    $to = (int)($body['to_admin_id'] ?? 0);
    if ($id <= 0 || $to <= 0) errorResponse('invalid params', 400);
    $st = $pdo->prepare("SELECT assigned_admin_id, back_driver_id, held_by, shop_settled FROM ops_bookings WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) errorResponse('booking not found', 404);
    if ((int)$row['shop_settled'] === 1) errorResponse('already settled', 400);
    $from = ($row['held_by'] !== null && $row['held_by'] !== '') ? (int)$row['held_by'] : opsDefaultHolder($row);
    if ($from === $to) errorResponse('same holder', 400);
    $me = (int)($_SESSION['ylka_admin_id'] ?? 0);
    $pdo->prepare("INSERT INTO ops_booking_handoffs (booking_id, from_admin_id, to_admin_id, created_by) VALUES (?,?,?,?)")
        ->execute([$id, $from, $to, $me ?: null]);
    $pdo->prepare("UPDATE ops_bookings SET held_by = ? WHERE id = ?")->execute([$to, $id]);
    jsonResponse(['ok' => true]);
}

if ($action === 'booking-handoff-undo' && $method === 'POST') {
    requireTabOps($pdo, 'timeline');
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
    requireTabOps($pdo, 'timeline');
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    $paid = !empty($body['paid']);
    if ($id <= 0) errorResponse('invalid id', 400);
    // 渡す人＝UIで選んだ担当者(by)。未指定なら操作者
    $payer = (int)($body['by'] ?? 0) ?: ((int)($_SESSION['ylka_admin_id'] ?? 0) ?: null);
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
    requireTabOps($pdo, 'timeline');
    $body = json_decode(file_get_contents('php://input'), true);
    $ids  = array_values(array_filter(array_map('intval', (array)($body['ids'] ?? [])), fn($v) => $v > 0));
    if (!$ids) errorResponse('no ids', 400);
    $payer = (int)($body['by'] ?? 0) ?: ((int)($_SESSION['ylka_admin_id'] ?? 0) ?: null);  // 渡す人＝選んだ担当者
    $place = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $pdo->prepare("UPDATE ops_bookings SET reward_paid_at = NOW(), reward_paid_by = ? WHERE id IN ($place) AND reward_paid_at IS NULL");
    $stmt->execute(array_merge([$payer], $ids));
    jsonResponse(['ok' => true, 'paid' => $stmt->rowCount()]);
}

// 報酬の受け渡し詳細を「渡す人（選んだ担当者）」の登録メールへ送る（店長要望 2026-08-13）
if ($action === 'send-reward-mail' && $method === 'POST') {
    requireTabOps($pdo, 'timeline');
    $body = json_decode(file_get_contents('php://input'), true);
    $toId    = (int)($body['to_admin_id'] ?? 0);
    $subject = trim((string)($body['subject'] ?? ''));
    $bodyTxt = trim((string)($body['body'] ?? ''));
    if ($toId <= 0) errorResponse('to_admin_id required', 400);
    if ($bodyTxt === '') errorResponse('body required', 400);
    // 宛先はサーバー側で解決（任意アドレスへの送信を防止）。email 未設定なら旧データの username を試す
    $st = $pdo->prepare("SELECT username, email, display_name FROM ops_admin_users WHERE id = ? LIMIT 1");
    $st->execute([$toId]);
    $u = $st->fetch();
    if (!$u) errorResponse('staff not found', 404);
    $to = trim((string)($u['email'] ?? ''));
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) $to = trim((string)($u['username'] ?? ''));
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) errorResponse('渡す人のメールアドレスが未設定です', 422);
    if ($subject === '') $subject = '報酬の受け渡し';
    $subjEnc = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    // envelope sender（-f）を必ず渡す。省くと差出人がサーバー既定になり SPF が揃わず Gmail で拒否される
    $from = 'no-reply@admi2888.com';
    $headers = implode("\r\n", [
        'From: admi2888 <' . $from . '>',
        'Reply-To: ' . $from,
        'Content-Type: text/plain; charset=UTF-8',
        'X-Mailer: admi Dispatch',
    ]);
    $ok = @mail($to, $subjEnc, $bodyTxt, $headers, '-f' . $from);
    if (!$ok) errorResponse('mail send failed', 500);
    jsonResponse(['ok' => true, 'to' => $to]);
}

// 入金分のみの受け渡し（パターン2）: 預り金の保有を to へ移し、報酬は担当本人が確保した記録を同時に付ける。
// 例: 橘が全額¥15,400を保有 → 入金分¥5,390だけ糸井に渡す → 報酬¥10,010は橘の手元に残る
if ($action === 'booking-net-handoff' && $method === 'POST') {
    requireTabOps($pdo, 'timeline');
    $body = json_decode(file_get_contents('php://input'), true);
    $id = (int)($body['id'] ?? 0);
    $to = (int)($body['to_admin_id'] ?? 0);
    if ($id <= 0 || $to <= 0) errorResponse('invalid params', 400);
    $st = $pdo->prepare("SELECT assigned_admin_id, back_driver_id, held_by FROM ops_bookings WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) errorResponse('booking not found', 404);
    $from = ($row['held_by'] !== null && $row['held_by'] !== '') ? (int)$row['held_by'] : opsDefaultHolder($row);
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
    requireTabOps($pdo, 'timeline');
    $body = json_decode(file_get_contents('php://input'), true);
    $ids  = array_values(array_filter(array_map('intval', (array)($body['ids'] ?? [])), fn($v) => $v > 0));
    $to   = (int)($body['to_admin_id'] ?? 0);
    if (!$ids || $to <= 0) errorResponse('invalid params', 400);
    $me = (int)($_SESSION['ylka_admin_id'] ?? 0) ?: null;
    $sel = $pdo->prepare("SELECT id, assigned_admin_id, back_driver_id, held_by FROM ops_bookings WHERE id = ?");
    $ins = $pdo->prepare("INSERT INTO ops_booking_handoffs (booking_id, from_admin_id, to_admin_id, created_by) VALUES (?,?,?,?)");
    $upd = $pdo->prepare("UPDATE ops_bookings SET held_by = ? WHERE id = ?");
    $n = 0;
    foreach ($ids as $id) {
        $sel->execute([$id]);
        $row = $sel->fetch(PDO::FETCH_ASSOC);
        if (!$row) continue;
        $from = ($row['held_by'] !== null && $row['held_by'] !== '') ? (int)$row['held_by'] : opsDefaultHolder($row);
        if ($from === $to) continue;  // すでにその人が保有
        $ins->execute([$id, $from, $to, $me]);
        $upd->execute([$to, $id]);
        $n++;
    }
    jsonResponse(['ok' => true, 'handed' => $n]);
}

// =================================================================
// 現金まとめサマリー
//   uncollected: 予約として成立しているぶん（キャンセル/無連絡/問合せ以外）& shop_settled=0
//   — 誰が預り金を持っているか。売上・集金と同じ条件（店長指定 2026-08-06「予約で売上計上」）
//   現金は営業日ごとに締める。繰越は無い（店長指定 2026-08-08）ので、
//   画面は必ず date= を付けて呼び、その営業日ぶんだけを出す。
//   date= 無しは全期間（他の用途向け）。前の日ぶんはタイムラインでその日に戻れば見られる。
// =================================================================
if ($action === 'cash-summary' && $method === 'GET') {
    requireTabOps($pdo, 'timeline');
    $bizDate = (string)($_GET['date'] ?? '');
    $hasDate = (bool)preg_match('/^\d{4}-\d{2}-\d{2}$/', $bizDate);
    $bizDay = ylkaBizDayExpr('b');
    // 出回っている現金（誰がいくら持っているか）。休憩は除外。報酬確定済みは残額をクライアントで計算。
    // クレジット・振込の予約も返す: そのぶんの報酬も「当日預かった現金から立て替えて」キャストへ渡す
    // 運用のため（店長指定 2026-08-08）。現金の入りは0・報酬の出だけがあるので、手元がマイナスになりうる。
    // 決済方法で絞ると、立て替えたぶんが画面から消えて現金が合わなくなる。
    $st = $pdo->prepare("
        SELECT b.id, b.booking_date, b.start_time, b.price, b.late_fee, b.transport_fee, b.card_fee, b.cash_amount,
               b.course_name, b.hotel_price_applied, b.menu_items, b.nomination_type, b.extension_count, b.extension_count,
               b.assigned_admin_id, b.held_by, b.driver_id, b.go_self, b.back_driver_id, b.back_self, b.reward_paid_at, b.reward_paid_by, b.payment_method,
               b.customer_name_snapshot,
               u.display_name  AS therapist_name,  u.username  AS therapist_username,  u.commission_rate,
               h.display_name  AS holder_name,     h.username  AS holder_username,
               rp.display_name AS reward_paid_by_name
        FROM ops_bookings b
        LEFT JOIN ops_admin_users u ON u.id = b.assigned_admin_id
        LEFT JOIN ops_admin_users h ON h.id = b.held_by
        LEFT JOIN ops_admin_users rp ON rp.id = b.reward_paid_by
        WHERE (b.status NOT IN ('cancelled','no_show','inquiry')
               OR (b.status = 'cancelled' AND b.cancellation_reason_type = 'customer'))
          AND b.shop_settled = 0
          " . ($hasDate ? "AND $bizDay = ?" : '') . "
          " . ylkaExcludeBreakSql('b') . "
        ORDER BY b.booking_date DESC, b.start_time DESC
    ");
    $st->execute($hasDate ? [$bizDate] : []);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);

    // 受け渡しの履歴（誰から誰へ現金が動いたか）。保有者だけ見ても
    // 「自分は◯◯さんに渡した」が確かめられないため一緒に返す（店長要望 2026-08-08）
    $handoffs = [];
    $ids = array_values(array_filter(array_map(fn($r) => (int)$r['id'], $rows)));
    if ($ids) {
        $place = implode(',', array_fill(0, count($ids), '?'));
        $hst = $pdo->prepare("SELECT id, booking_id, from_admin_id, to_admin_id, created_at
                              FROM ops_booking_handoffs WHERE booking_id IN ($place) ORDER BY booking_id, created_at, id");
        $hst->execute($ids);
        $handoffs = $hst->fetchAll(PDO::FETCH_ASSOC);
    }

    // 内勤・ドライバーの勤務実績（日報の「増田22:00～1:00(3H30km)」用）。
    // 一日の締めをする画面で一緒に入れられるよう、現金まとめに同梱する（店長要望 2026-08-08）
    $logs = [];
    if ($hasDate) {
        $lg = $pdo->prepare("SELECT driver_id, clock_in, clock_out, distance_km, note FROM ops_driver_logs WHERE work_date = ?");
        $lg->execute([$bizDate]);
        foreach ($lg->fetchAll() as $r) {
            $logs[(int)$r['driver_id']] = [
                'clock_in'    => substr((string)$r['clock_in'], 0, 5),
                'clock_out'   => substr((string)$r['clock_out'], 0, 5),
                'distance_km' => ($r['distance_km'] === null) ? '' : opsKmText((float)$r['distance_km']),
                'off'         => ((string)($r['note'] ?? '') === OPS_DRIVER_OFF) ? 1 : 0,
            ];
        }
    }

    // 金額だけの現金受け渡し（つり銭など・予約単位ではないぶん。店長要望 2026-08-14）
    $transfers = [];
    if ($hasDate) {
        $tq = $pdo->prepare(
            "SELECT t.id, t.from_admin_id, t.to_admin_id, t.amount, t.note, t.created_at,
                    f.display_name AS from_name, o.display_name AS to_name
               FROM ops_cash_transfers t
               LEFT JOIN ops_admin_users f ON f.id = t.from_admin_id
               LEFT JOIN ops_admin_users o ON o.id = t.to_admin_id
              WHERE t.biz_date = ? ORDER BY t.created_at"
        );
        $tq->execute([$bizDate]);
        $transfers = $tq->fetchAll();
    }
    jsonResponse(['uncollected' => $rows, 'handoffs' => $handoffs, 'driver_logs' => $logs, 'transfers' => $transfers, 'biz_date' => $hasDate ? $bizDate : null]);
}

// 金額だけの現金受け渡しを記録する（例: 宮時 → 矢島 ¥3,000 つり銭）。店長要望 2026-08-14
if ($action === 'cash-transfer-add' && $method === 'POST') {
    requireTabOps($pdo, 'timeline');
    $b = json_decode(file_get_contents('php://input'), true);
    $date = (string)($b['date'] ?? '');
    $from = (int)($b['from_admin_id'] ?? 0);
    $to   = (int)($b['to_admin_id'] ?? 0);
    $amt  = (int)($b['amount'] ?? 0);
    $note = trim((string)($b['note'] ?? ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) errorResponse('invalid date', 400);
    if ($from <= 0 || $to <= 0 || $from === $to) errorResponse('渡す人と渡す先を選んでください', 400);
    if ($amt <= 0) errorResponse('金額を入れてください', 400);
    $pdo->prepare('INSERT INTO ops_cash_transfers (biz_date, from_admin_id, to_admin_id, amount, note, created_by) VALUES (?,?,?,?,?,?)')
        ->execute([$date, $from, $to, $amt, mb_substr($note, 0, 255), (int)($_SESSION['ylka_admin_id'] ?? 0) ?: null]);
    jsonResponse(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

// 記録した金額受け渡しの取り消し（打ち間違い用）
if ($action === 'cash-transfer-delete' && $method === 'POST') {
    requireTabOps($pdo, 'timeline');
    $b = json_decode(file_get_contents('php://input'), true);
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $pdo->prepare('DELETE FROM ops_cash_transfers WHERE id = ?')->execute([$id]);
    jsonResponse(['ok' => true]);
}

// =================================================================
// 日報（社内報告用）— 店長要望 2026-08-08
//   毎日 LINE 等に貼る定型文をそのまま作る。分かるところだけ埋めて返し、
//   当日欠勤・ドライバーの実働時間・メモは画面側で手直ししてもらう前提。
//   現金は「入った − 出た ＝ 手元」の3行。カード決済ぶんの報酬も現金から立て替えるので、
//   立て替え額を別に返して内訳が分かるようにする。
// =================================================================
if ($action === 'daily-report' && $method === 'GET') {
    requireTabOps($pdo, 'payroll');
    $date = (string)($_GET['date'] ?? date('Y-m-d'));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) errorResponse('invalid date', 400);
    $bizDay = ylkaBizDayExpr('b');
    $next   = date('Y-m-d', strtotime($date . ' +1 day'));

    // --- その日の予約（キャスト別の売上・本数、現金の出入り） ---
    $st = $pdo->prepare(
        "SELECT b.assigned_admin_id, b.course_name, b.menu_items, b.nomination_type, b.extension_count, b.hotel_price_applied,
                b.price, b.late_fee, b.transport_fee, b.card_fee, b.cash_amount, b.payment_method,
                b.driver_id, b.go_self, b.back_driver_id, b.back_self, b.reward_paid_at, b.reward_override,
                b.status, b.cancellation_fee, b.cancellation_reward,
                u.display_name, u.username
           FROM ops_bookings b
           LEFT JOIN ops_admin_users u ON u.id = b.assigned_admin_id
          WHERE (b.status NOT IN ('cancelled','no_show','inquiry') OR (b.status='cancelled' AND b.cancellation_reason_type='customer'))
            AND $bizDay = ?" . ylkaExcludeBreakSql('b')
    );
    $st->execute([$date]);
    // 日報に載せる金額は「入金分（お客様総額 − キャスト報酬）」＝店に入るぶん（店長指定 2026-08-08）。
    // お預り金総額（お客様からいただいた全額）は現金の欄で使うので別に持つ
    $byCast = []; $salesTotal = 0; $shopTotal = 0; $bookingCount = 0;
    $cashIn = 0; $rewardPaid = 0; $advanced = 0; $creditIn = 0; $bankIn = 0;
    foreach ($st->fetchAll() as $r) {
        [$sales, $reward] = ylkaRowSalesReward($r, 0.0);
        $shop = $sales - $reward;
        $aid = (int)$r['assigned_admin_id'];
        $nm  = $r['display_name'] ?: ($r['username'] ?: '(未割当)');
        if (!isset($byCast[$aid])) $byCast[$aid] = ['name' => $nm, 'sales' => 0, 'count' => 0];
        $byCast[$aid]['sales'] += $shop;
        $byCast[$aid]['count']++;
        $salesTotal += $sales;
        $shopTotal  += $shop;
        $bookingCount++;
        // 現金の出入り: カード・振込は入りなし。報酬は決済方法に関わらず現金から渡す
        $pm = (string)$r['payment_method'];
        $isCash = !in_array($pm, ['credit', 'card', 'bank'], true);
        $in = $isCash ? (($pm === 'split') ? min($sales, max(0, (int)$r['cash_amount'])) : $sales) : 0;
        $cashIn += $in;
        // 現金にならなかったぶん（併用の残りはカードで切った額）
        if ($pm === 'bank') $bankIn += $sales;
        else $creditIn += $sales - $in;
        if ($r['reward_paid_at']) {
            $rw = ylkaReward($r);
            $rewardPaid += $rw;
            if ($in === 0) $advanced += $rw;   // 現金の入りが無いのに渡した＝立て替え
        }
    }

    // --- 出勤（キャスト / 内勤・ドライバー）。その日と翌日 ---
    $shiftOf = function (string $d) use ($pdo) {
        // 休み(off)のキャストも返す。日報は「りお休み」のように休んだ人も載せるため
        //（当日欠勤という区分は設けず休みで表す・店長指定 2026-08-08）
        $q = $pdo->prepare(
            "SELECT s.status, s.start_time, s.end_time, s.end_open, s.shift_preset, u.id, u.display_name, u.username, u.role, u.is_therapist, u.is_office, u.can_drive, u.report_group
               FROM ops_shifts s JOIN ops_admin_users u ON u.id = s.admin_user_id
              WHERE s.shift_date = ?
              ORDER BY s.start_time, u.sort_order, u.id"
        );
        $q->execute([$d]);
        $casts = []; $staff = []; $hkStaff = [];
        foreach ($q->fetchAll() as $r) {
            $row = [
                'id'    => (int)$r['id'],
                'name'  => $r['display_name'] ?: $r['username'],
                'start' => substr((string)$r['start_time'], 0, 5),
                'end'   => substr((string)$r['end_time'], 0, 5),
                // 終わりが「ラスト」の人は日報にもラストと書く（店長要望 2026-08-25）
                'end_open' => (string)($r['end_open'] ?? ''),
                // 24H・早番・遅番は「選んだとき」だけ入る（時刻の偶然一致では入らない）
                'preset' => (string)($r['shift_preset'] ?? ''),
                'off'   => $r['status'] === 'off',
            ];
            if ($r['role'] === 'staff' || (int)$r['is_therapist'] === 1) { $casts[] = $row; continue; }
            if ($r['status'] === 'off') continue;              // 内勤・ドライバーの休みは日報に出さない
            // 秘密基地の日報に出すスタッフ（吉川・星野など）はアドミの日報からは外す（店長指定 2026-08-28）
            if ((string)($r['report_group'] ?? 'admi') === 'himitsu') $hkStaff[] = $row;
            else $staff[] = $row;
        }
        return ['casts' => $casts, 'staff' => $staff, 'himitsu_staff' => $hkStaff];
    };
    $today = $shiftOf($date);
    $tomo  = $shiftOf($next);

    // --- 月売上とペース（＝月売上 ÷ 経過日数 × その月の日数）---
    // こちらも入金分。報酬は1件ずつ計算するので、合計SQLではなく行を回す
    $mFrom = date('Y-m-01', strtotime($date));
    $ms = $pdo->prepare(
        "SELECT b.course_name, b.menu_items, b.nomination_type, b.extension_count, b.hotel_price_applied,
                b.price, b.late_fee, b.transport_fee, b.card_fee, b.payment_method,
                b.driver_id, b.go_self, b.back_driver_id, b.back_self, b.reward_override,
                b.status, b.cancellation_fee, b.cancellation_reward
           FROM ops_bookings b
          WHERE (b.status NOT IN ('cancelled','no_show','inquiry') OR (b.status='cancelled' AND b.cancellation_reason_type='customer'))
            AND $bizDay BETWEEN ? AND ?" . ylkaExcludeBreakSql('b')
    );
    $ms->execute([$mFrom, $date]);
    $monthSales = 0;
    foreach ($ms->fetchAll() as $r) {
        [$s, $rw] = ylkaRowSalesReward($r, 0.0);
        $monthSales += $s - $rw;
    }
    $elapsed    = (int)date('j', strtotime($date));
    $daysInMon  = (int)date('t', strtotime($date));
    $pace       = $elapsed > 0 ? (int)floor($monthSales / $elapsed * $daysInMon) : 0;

    // --- ドライバーの勤務実績（あれば「22:00～1:00(3H30km)」の形で添える） ---
    $logs = [];
    $lg = $pdo->prepare("SELECT driver_id, clock_in, clock_out, distance_km, note FROM ops_driver_logs WHERE work_date = ?");
    $lg->execute([$date]);
    foreach ($lg->fetchAll() as $r) {
        // お休みはキャストと同じ「休み」表記（日報で「増田休み」になる）
        if ((string)($r['note'] ?? '') === OPS_DRIVER_OFF) { $logs[(int)$r['driver_id']] = OPS_DRIVER_OFF; continue; }
        // 時刻は先頭の0なし（0:30）
        $ci = preg_replace('/^0(\d:)/', '$1', substr((string)$r['clock_in'], 0, 5));
        $co = preg_replace('/^0(\d:)/', '$1', substr((string)$r['clock_out'], 0, 5));
        if ($ci === '' && $co === '') continue;
        $h = '';
        $hasMin = false;
        if ($ci !== '' && $co !== '') {
            $mins = (int)round((strtotime($co) - strtotime($ci)) / 60);
            if ($mins <= 0) $mins += 24 * 60;
            // 15分＝0.25H 単位で出す（00:30～06:15＝5.75H）。ちょうどなら「3H」
            $hasMin = ($mins % 60) !== 0;
            $h = rtrim(rtrim(number_format(round($mins / 15) / 4, 2, '.', ''), '0'), '.') . 'H';
        }
        $km = ($r['distance_km'] !== null && (float)$r['distance_km'] > 0) ? opsKmText((float)$r['distance_km']) . 'km' : '';
        $sep = ($h !== '' && $km !== '' && $hasMin) ? '・' : '';
        $logs[(int)$r['driver_id']] = $ci . '～' . $co . (($h || $km) ? '(' . $h . $sep . $km . ')' : '');
    }

    usort($byCast, fn($a, $b) => $b['sales'] <=> $a['sales']);
    jsonResponse([
        'date' => $date, 'next_date' => $next,
        'casts' => array_values($byCast),
        'booking_count' => $bookingCount,
        'sales_total' => $shopTotal,   // 日報の「売上合計」＝入金分
        'avg_price' => $bookingCount > 0 ? (int)floor($shopTotal / $bookingCount) : 0,
        'month_sales' => $monthSales,
        'pace' => $pace,
        'today_shift' => $today,
        'tomorrow_shift' => $tomo,
        'driver_logs' => $logs,
        'cash' => [
            'total'       => $salesTotal,   // お預り金総額（お客様からいただいた全額）
            'credit'      => $creditIn,     // うちカードで切ったぶん（現金にならない）
            'bank'        => $bankIn,
            'received'    => $cashIn,       // 実際に現金で受け取った額
            'reward_paid' => $rewardPaid,
            'advanced'    => $advanced,     // カード決済ぶんの報酬を現金から立て替えた額
            'on_hand'     => $cashIn - $rewardPaid,
        ],
    ]);
}

// =================================================================
// 集金（日×スタッフ単位の受け渡し・双方確認）
//   単位: (settle_date, therapist_id)。店入金額合計 = Σ(売上 − 報酬)（完了予約）
//   受領済 = スタッフ確認 または 店舗確認 のいずれか（どちらか一方でOK）
// =================================================================

// 指定期間の (日, キャスト) 別 店入金額合計を算出
function ylkaComputeShopAmounts(PDO $pdo, string $from, string $to): array {
    $stmt = $pdo->prepare(
        "SELECT b.booking_date, b.assigned_admin_id, b.course_name, b.price, b.late_fee, b.transport_fee, b.card_fee, b.cash_amount, b.hotel_price_applied, b.menu_items, b.nomination_type, b.extension_count, b.driver_id, b.go_self, b.back_driver_id, b.back_self, b.status, b.cancellation_fee, b.cancellation_reward, b.reward_override, b.payment_method, au.commission_rate
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
    requireTabOps($pdo, 'payroll');
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
// キャスト本人のYobuChat受信箱URL（マイページの💬チャット用・店長要望 2026-09-02）。
// チャット側に未登録ならこの場で登録する（lazy provisioning）
if ($action === 'my-chat-inbox' && $method === 'GET') {
    $me = (int)($_SESSION['ylka_admin_id'] ?? 0);
    if ($me <= 0) errorResponse('unauthorized', 401);
    $st = $pdo->prepare('SELECT au.id, au.girl_id, au.display_name, g.name AS girl_name
                           FROM ops_admin_users au LEFT JOIN girls g ON g.id = au.girl_id WHERE au.id = ?');
    $st->execute([$me]);
    $u = $st->fetch();
    if (!$u || !$u['girl_id']) errorResponse('キャストのアカウントではありません', 400);
    require_once __DIR__ . '/yobuchat-link.php';
    try {
        $cast = ycEnsureCast((int)$u['id'], (string)($u['girl_name'] ?: $u['display_name']));
        jsonResponse(['ok' => true] + ycUrls($cast) + [
            'display_name' => $cast['display_name'],
            'visible'      => ycGetVisible($cast['shop_cast_id']),
        ]);
    } catch (Throwable $e) {
        error_log('[my-chat-inbox] ' . $e->getMessage());
        errorResponse('チャットとの連携に失敗しました', 502);
    }
}

// 指名ピッカーの表示ON/OFF（本人がマイページで切替・店長指定 2026-09-02）
if ($action === 'my-chat-visible' && $method === 'POST') {
    $me = (int)($_SESSION['ylka_admin_id'] ?? 0);
    if ($me <= 0) errorResponse('unauthorized', 401);
    $b = readJsonBody();
    $on = !empty($b['on']);
    $st = $pdo->prepare('SELECT au.id, au.display_name, g.name AS girl_name FROM ops_admin_users au LEFT JOIN girls g ON g.id = au.girl_id WHERE au.id = ? AND au.girl_id IS NOT NULL');
    $st->execute([$me]);
    $u = $st->fetch();
    if (!$u) errorResponse('キャストのアカウントではありません', 400);
    require_once __DIR__ . '/yobuchat-link.php';
    try {
        $cast = ycEnsureCast((int)$u['id'], (string)($u['girl_name'] ?: $u['display_name']));
        ycSetVisible($cast['shop_cast_id'], $on);
        jsonResponse(['ok' => true, 'visible' => $on]);
    } catch (Throwable $e) {
        error_log('[my-chat-visible] ' . $e->getMessage());
        errorResponse('切り替えに失敗しました', 502);
    }
}

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
                   b.price, b.late_fee, b.transport_fee, b.card_fee, b.cash_amount, b.hotel_price_applied, b.menu_items, b.nomination_type, b.extension_count, b.driver_id, b.go_self, b.back_driver_id, b.back_self, b.payment_method, b.shop_settled, b.shop_settled_at,
                   b.status, b.cancellation_fee, b.cancellation_reward, b.reward_override, b.assigned_admin_id, b.held_by, b.reward_paid_at, b.reward_paid_by,
                   au.commission_rate,
                   h.display_name AS holder_name, h.username AS holder_username,
                   bd.display_name AS back_drv_name, bd.username AS back_drv_username
            FROM ops_bookings b LEFT JOIN ops_admin_users au ON au.id = b.assigned_admin_id
            LEFT JOIN ops_admin_users h ON h.id = b.held_by
            LEFT JOIN ops_admin_users bd ON bd.id = b.back_driver_id
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
        // held_by が無ければ「帰りのお迎え担当」が既定の保有者（opsDefaultHolder と同じ考え方）
        $heldBy = ($r['held_by'] !== null && $r['held_by'] !== '') ? (int)$r['held_by']
                : (($r['back_driver_id'] !== null && $r['back_driver_id'] !== '') ? (int)$r['back_driver_id'] : null);
        $holderName = ($r['held_by'] !== null && $r['held_by'] !== '')
            ? ($r['holder_name'] ?: $r['holder_username'] ?: null)
            : ($r['back_drv_name'] ?: $r['back_drv_username'] ?: null);
        $rows[] = ['id' => (int)$r['id'], 'date' => $r['booking_date'], 'time' => substr((string)$r['start_time'], 0, 5),
                   'customer' => $r['customer_name_snapshot'], 'course' => $r['course_name'],
                   'sales' => $sales, 'reward' => $reward, 'payment_method' => $r['payment_method'], 'cash_amount' => isset($r['cash_amount']) ? (int)$r['cash_amount'] : null,
                   'shop_amount' => $shop, 'settled' => $settled, 'settled_at' => $r['shop_settled_at'],
                   'assigned_admin_id' => (int)$r['assigned_admin_id'],
                   'reward_paid_at' => $r['reward_paid_at'], 'reward_paid_by' => $r['reward_paid_by'] !== null ? (int)$r['reward_paid_by'] : null,
                   'held_by' => $heldBy,
                   'holder' => $heldBy ? ($holderName ?: ('#' . $heldBy)) : null];
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
    requireTabOps($pdo, 'payroll');
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
    requireTabOps($pdo, 'payroll');
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
    requireTabOps($pdo, 'payroll');
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
    requireTabOps($pdo, 'permissions');
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
    requireStaffManage($pdo);
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
    requireStaffManage($pdo);
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
        if (!isOwnerSession()) errorResponse('オーナーのアカウントはオーナーのみ削除できます', 403);
        $cnt = $pdo->query("SELECT COUNT(*) FROM ops_admin_users WHERE role = 'owner'")->fetchColumn();
        if ((int)$cnt <= 1) errorResponse('cannot delete the last owner', 403);
    }
    // ログイン基盤（admins）側も username で消す。キャスト等 admins に無い行は素通り
    $uname = (string)$pdo->query('SELECT username FROM ops_admin_users WHERE id = ' . (int)$id)->fetchColumn();
    $pdo->beginTransaction();
    $pdo->prepare('DELETE FROM ops_admin_users WHERE id = ?')->execute([$id]);
    if ($uname !== '') {
        $pdo->prepare('DELETE FROM admins WHERE username = ?')->execute([$uname]);
    }
    $pdo->commit();
    jsonResponse(['ok' => true]);
}

if ($action === 'admin-reset-password' && $method === 'POST') {
    requireStaffManage($pdo);
    $body     = json_decode(file_get_contents('php://input'), true);
    $id       = (int)($body['id'] ?? 0);
    $password = $body['password'] ?? '';
    if ($id <= 0) errorResponse('invalid id', 400);
    if (strlen($password) < 8) errorResponse('password must be at least 8 chars', 400);
    if (!isOwnerSession()) {
        $tq = $pdo->prepare('SELECT role FROM ops_admin_users WHERE id = ?');
        $tq->execute([$id]);
        if ((string)$tq->fetchColumn() === 'owner') errorResponse('オーナーのパスワードはオーナーのみ再発行できます', 403);
    }
    $hash = password_hash($password, PASSWORD_BCRYPT);
    // CTRL ログインは admins のパスワードで行う。ops 側にも同じものを控える（照合キーは username）
    $uname = (string)$pdo->query('SELECT username FROM ops_admin_users WHERE id = ' . (int)$id)->fetchColumn();
    $pdo->beginTransaction();
    $pdo->prepare('UPDATE ops_admin_users SET password_hash = ? WHERE id = ?')->execute([$hash, $id]);
    if ($uname !== '') {
        $pdo->prepare('UPDATE admins SET password_hash = ?, modified = NOW() WHERE username = ?')->execute([$hash, $uname]);
    }
    $pdo->commit();
    jsonResponse(['ok' => true]);
}

errorResponse('invalid action', 400);
