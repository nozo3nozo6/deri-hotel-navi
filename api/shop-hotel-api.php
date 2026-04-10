<?php
/**
 * shop-hotel-api.php — 店舗ホテル情報CRUD（MySQL版）
 * 全action: PHPセッション認証必須
 */
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/validation.php';

define('SHOP_SESSION_TIMEOUT', 86400);
session_set_cookie_params([
    'lifetime' => SHOP_SESSION_TIMEOUT,
    'path' => '/',
    'domain' => 'yobuho.com',
    'secure' => true,
    'httponly' => true,
    'samesite' => 'Strict'
]);
session_start();

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');
header('Access-Control-Allow-Origin: https://yobuho.com');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Credentials: true');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// セッション認証
function requireAuth(): array {
    if (empty($_SESSION['shop_id'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
    if (time() - ($_SESSION['last_activity'] ?? 0) > SHOP_SESSION_TIMEOUT) {
        session_destroy();
        http_response_code(401);
        echo json_encode(['error' => 'Session expired']);
        exit;
    }
    $_SESSION['last_activity'] = time();
    return ['shop_id' => $_SESSION['shop_id'], 'shop_email' => $_SESSION['shop_email'] ?? ''];
}

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'registered-ids':      handleRegisteredIds(); break;
    case 'registered-list':     handleRegisteredList(); break;
    case 'get-info':            handleGetInfo(); break;
    case 'get-transport-fee':   handleGetTransportFee(); break;
    case 'get-existing-loveho': handleGetExistingLoveho(); break;
    case 'save-hotel-info':     handleSaveHotelInfo(); break;
    case 'save-loveho-info':    handleSaveLovehoInfo(); break;
    case 'delete-info':         handleDeleteInfo(); break;
    case 'refresh-date':        handleRefreshDate(); break;
    default:
        http_response_code(400);
        echo json_encode(['error' => 'Invalid action']);
}

// ===== GET: 登録済みhotel_idリスト =====
function handleRegisteredIds() {
    $auth = requireAuth();
    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT hotel_id FROM shop_hotel_info WHERE shop_id = ?');
    $stmt->execute([$auth['shop_id']]);
    $ids = $stmt->fetchAll(PDO::FETCH_COLUMN);
    echo json_encode($ids);
}

// ===== GET: 登録済みホテル一覧（hotels JOIN） =====
function handleRegisteredList() {
    $auth = requireAuth();
    $pdo = DB::conn();
    $shopId = $auth['shop_id'];
    $stmt = $pdo->prepare('
        SELECT shi.*, h.name AS hotel_name, h.address AS hotel_address, h.hotel_type,
               rep.refreshed_at AS report_refreshed_at,
               lr.refreshed_at AS loveho_refreshed_at
        FROM shop_hotel_info shi
        LEFT JOIN hotels h ON h.id = shi.hotel_id
        LEFT JOIN reports rep ON rep.hotel_id = shi.hotel_id AND rep.shop_id = shi.shop_id AND rep.poster_type = ?
        LEFT JOIN loveho_reports lr ON lr.hotel_id = shi.hotel_id AND lr.shop_id = shi.shop_id
        WHERE shi.shop_id = ?
        ORDER BY shi.created_at DESC
    ');
    $stmt->execute(['shop', $shopId]);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['can_call'] = (bool)$r['can_call'];
        $r['hotels'] = [
            'name' => $r['hotel_name'],
            'address' => $r['hotel_address'],
            'hotel_type' => $r['hotel_type']
        ];
        // refreshed_at: 両テーブルの最新を使用
        $dates = array_filter([$r['report_refreshed_at'] ?? null, $r['loveho_refreshed_at'] ?? null]);
        $r['refreshed_at'] = $dates ? max($dates) : null;
        unset($r['hotel_name'], $r['hotel_address'], $r['report_refreshed_at'], $r['loveho_refreshed_at']);
    }
    echo json_encode($rows, JSON_UNESCAPED_UNICODE);
}

// ===== GET: 特定ホテルのshop_hotel_info + services =====
function handleGetInfo() {
    $auth = requireAuth();
    $hotelId = (int)($_GET['hotel_id'] ?? 0);
    if (!$hotelId) { echo json_encode(null); return; }

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT * FROM shop_hotel_info WHERE shop_id = ? AND hotel_id = ? LIMIT 1');
    $stmt->execute([$auth['shop_id'], $hotelId]);
    $info = $stmt->fetch();
    if (!$info) { echo json_encode(null); return; }
    $info['can_call'] = (bool)$info['can_call'];

    // サービスID取得
    $stmt = $pdo->prepare('SELECT service_option_id FROM shop_hotel_services WHERE shop_hotel_info_id = ?');
    $stmt->execute([$info['id']]);
    $info['service_ids'] = $stmt->fetchAll(PDO::FETCH_COLUMN);

    // reportsテーブルの口コミデータも取得
    $stmt = $pdo->prepare('SELECT can_call_reasons, cannot_call_reasons, time_slot, room_type, comment, multi_person, guest_male, guest_female, multi_fee FROM reports WHERE hotel_id = ? AND shop_id = ? AND poster_type = ? LIMIT 1');
    $stmt->execute([$hotelId, $auth['shop_id'], 'shop']);
    $report = $stmt->fetch();
    if ($report) {
        $info['can_call_reasons'] = json_decode($report['can_call_reasons'] ?: '[]', true);
        $info['cannot_call_reasons'] = json_decode($report['cannot_call_reasons'] ?: '[]', true);
        $info['time_slot'] = $report['time_slot'];
        $info['room_type'] = $report['room_type'];
        $info['report_comment'] = $report['comment'];
        $info['multi_person'] = (bool)$report['multi_person'];
        $info['guest_male'] = $report['guest_male'];
        $info['guest_female'] = $report['guest_female'];
        $info['multi_fee'] = (bool)$report['multi_fee'];
    }

    echo json_encode($info, JSON_UNESCAPED_UNICODE);
}

// ===== GET: transport_fee取得 =====
function handleGetTransportFee() {
    $auth = requireAuth();
    $hotelId = (int)($_GET['hotel_id'] ?? 0);
    if (!$hotelId) { echo json_encode(null); return; }

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT transport_fee FROM shop_hotel_info WHERE shop_id = ? AND hotel_id = ? LIMIT 1');
    $stmt->execute([$auth['shop_id'], $hotelId]);
    $row = $stmt->fetch();
    echo json_encode($row ?: null);
}

// ===== GET: 既存ラブホレポート確認（shop_idベース） =====
function handleGetExistingLoveho() {
    $auth = requireAuth();
    $hotelId = (int)($_GET['hotel_id'] ?? 0);
    if (!$hotelId) { echo json_encode(null); return; }

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT * FROM loveho_reports WHERE hotel_id = ? AND shop_id = ? LIMIT 1');
    $stmt->execute([$hotelId, $auth['shop_id']]);
    $row = $stmt->fetch();
    if ($row) {
        $row['multi_person'] = (bool)$row['multi_person'];
        $row['good_points'] = DB::jsonDecode($row['good_points']);
    }
    echo json_encode($row ?: null, JSON_UNESCAPED_UNICODE);
}

// ===== POST: レポート + info + services 一括保存 =====
function handleSaveHotelInfo() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $auth = requireAuth();
    $raw = file_get_contents('php://input');
    error_log('[save-hotel-info] raw input: ' . $raw);
    $input = json_decode($raw, true);
    if (!$input) { http_response_code(400); echo json_encode(['error' => 'Invalid input']); return; }

    $pdo = DB::conn();
    $shopId = $auth['shop_id'];
    $hotelId = (int)($input['hotel_id'] ?? 0);
    $editId = $input['edit_id'] ?? null;
    $report = $input['report'] ?? [];
    $info = $input['info'] ?? [];
    $serviceIds = $input['service_ids'] ?? [];

    if (!$hotelId) { http_response_code(400); echo json_encode(['error' => 'hotel_id required']); return; }

    // 店舗名取得
    $stmt = $pdo->prepare('SELECT shop_name, gender_mode FROM shops WHERE id = ? LIMIT 1');
    $stmt->execute([$shopId]);
    $shop = $stmt->fetch();
    if (!$shop) { http_response_code(400); echo json_encode(['error' => 'Shop not found']); return; }

    // コンテンツバリデーション
    $reportComment = $report['comment'] ?? null;
    $validation = validateComment($reportComment, $shop['shop_name']);
    if ($validation['errors']) { http_response_code(400); echo json_encode(['error' => $validation['errors'][0]]); return; }

    try {
        $pdo->beginTransaction();

        // 1. reportsテーブルにupsert
        $stmt = $pdo->prepare('SELECT id FROM reports WHERE hotel_id = ? AND shop_id = ? AND poster_type = ? LIMIT 1');
        $stmt->execute([$hotelId, $shopId, 'shop']);
        $existingRep = $stmt->fetch();

        $canCall = $report['can_call'] ?? false;
        $reportData = [
            $hotelId,
            (int)$canCall,
            'shop',
            $shop['shop_name'] ?: '店舗',
            $shopId,
            DB::jsonEncode($report['can_call_reasons'] ?? []),
            DB::jsonEncode($report['cannot_call_reasons'] ?? []),
            $report['time_slot'] ?? null,
            $report['room_type'] ?? null,
            $report['comment'] ?? null,
            $shop['gender_mode'] ?? 'men',
            (int)($report['multi_person'] ?? false),
            (int)($report['guest_male'] ?? 1),
            (int)($report['guest_female'] ?? 0),
            ($report['multi_person'] ?? false) ? (int)(bool)($report['multi_fee'] ?? false) : null,
        ];

        if ($existingRep && $editId) {
            // 編集モード: 既存レコードを更新
            $stmt = $pdo->prepare('UPDATE reports SET hotel_id=?, can_call=?, poster_type=?, poster_name=?, shop_id=?, can_call_reasons=?, cannot_call_reasons=?, time_slot=?, room_type=?, comment=?, gender_mode=?, multi_person=?, guest_male=?, guest_female=?, multi_fee=? WHERE id=?');
            $stmt->execute(array_merge($reportData, [$existingRep['id']]));
        } else if ($existingRep && !$editId) {
            // 新規モードだが既存がある → 拒否（削除してから再投稿してください）
            $pdo->rollBack();
            http_response_code(409);
            echo json_encode(['error' => 'このホテルには既に投稿があります。編集するか、削除してから再投稿してください。']);
            return;
        } else {
            $uuid = DB::uuid();
            $stmt = $pdo->prepare('INSERT INTO reports (id, hotel_id, can_call, poster_type, poster_name, shop_id, can_call_reasons, cannot_call_reasons, time_slot, room_type, comment, gender_mode, multi_person, guest_male, guest_female, multi_fee, refreshed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())');
            $stmt->execute(array_merge([$uuid], $reportData));
        }

        // 2. shop_hotel_info upsert
        $transportFee = $info['transport_fee'] ?? null;
        $memo = $info['memo'] ?? null;
        $infoId = null;

        if ($editId) {
            $stmt = $pdo->prepare('UPDATE shop_hotel_info SET can_call=?, transport_fee=?, memo=?, updated_at=NOW() WHERE id=? AND shop_id=?');
            $stmt->execute([(int)$canCall, $transportFee, $memo, $editId, $shopId]);
            $infoId = $editId;
        } else {
            $stmt = $pdo->prepare('INSERT INTO shop_hotel_info (shop_id, hotel_id, can_call, transport_fee, memo) VALUES (?,?,?,?,?)');
            $stmt->execute([$shopId, $hotelId, (int)$canCall, $transportFee, $memo]);
            $infoId = $pdo->lastInsertId();
        }

        // 3. shop_hotel_services 差し替え
        $stmt = $pdo->prepare('DELETE FROM shop_hotel_services WHERE shop_hotel_info_id = ?');
        $stmt->execute([$infoId]);
        if (!empty($serviceIds)) {
            $stmt = $pdo->prepare('INSERT INTO shop_hotel_services (shop_hotel_info_id, service_option_id) VALUES (?, ?)');
            foreach ($serviceIds as $sid) {
                $stmt->execute([$infoId, (int)$sid]);
            }
        }

        $pdo->commit();
        echo json_encode(['success' => true, 'info_id' => $infoId]);
    } catch (Exception $e) {
        $pdo->rollBack();
        error_log('[shop-hotel-api] save-hotel-info error: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['error' => 'サーバーエラーが発生しました']);
    }
}

// ===== POST: ラブホレポート + transport_fee 一括保存 =====
function handleSaveLovehoInfo() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $auth = requireAuth();
    $input = json_decode(file_get_contents('php://input'), true);
    if (!$input) { http_response_code(400); echo json_encode(['error' => 'Invalid input']); return; }

    $pdo = DB::conn();
    $shopId = $auth['shop_id'];
    $hotelId = (int)($input['hotel_id'] ?? 0);
    $report = $input['report'] ?? [];
    $transportFee = $input['transport_fee'] ?? null;

    if (!$hotelId) { http_response_code(400); echo json_encode(['error' => 'hotel_id required']); return; }

    $stmt = $pdo->prepare('SELECT shop_name, gender_mode FROM shops WHERE id = ? LIMIT 1');
    $stmt->execute([$shopId]);
    $shop = $stmt->fetch();
    if (!$shop) { http_response_code(400); echo json_encode(['error' => 'Shop not found']); return; }

    $posterName = $report['poster_name'] ?? $shop['shop_name'] ?? '店舗';

    // コンテンツバリデーション
    $lhComment = $report['comment'] ?? null;
    $validation = validateComment($lhComment, $posterName);
    if ($validation['errors']) { http_response_code(400); echo json_encode(['error' => $validation['errors'][0]]); return; }

    try {
        $pdo->beginTransaction();

        // 1. loveho_reports upsert（shop_idベース: 1店舗1ホテル1件）
        $stmt = $pdo->prepare('SELECT id FROM loveho_reports WHERE hotel_id = ? AND shop_id = ? LIMIT 1');
        $stmt->execute([$hotelId, $shopId]);
        $existing = $stmt->fetch();

        $cols = [
            'hotel_id' => $hotelId,
            'solo_entry' => $report['solo_entry'] ?? null,
            'entry_method' => $report['entry_method'] ?? null,
            'atmosphere' => $report['atmosphere'] ?? null,
            'good_points' => DB::jsonEncode($report['good_points'] ?? null),
            'time_slot' => $report['time_slot'] ?? null,
            'comment' => $report['comment'] ?? null,
            'poster_name' => $posterName,
            'poster_type' => 'shop',
            'shop_id' => $shopId,
            'multi_person' => (int)($report['multi_person'] ?? false),
            'guest_male' => $report['guest_male'] ?? null,
            'guest_female' => $report['guest_female'] ?? null,
            'multi_fee' => ($report['multi_person'] ?? false) ? (int)(bool)($report['multi_fee'] ?? false) : null,
            'gender_mode' => $shop['gender_mode'] ?? 'men',
        ];

        if ($existing) {
            $sets = implode(', ', array_map(fn($k) => "$k = ?", array_keys($cols)));
            $stmt = $pdo->prepare("UPDATE loveho_reports SET $sets, updated_at = NOW() WHERE id = ?");
            $stmt->execute(array_merge(array_values($cols), [$existing['id']]));
        } else {
            $uuid = DB::uuid();
            $cols['refreshed_at'] = date('Y-m-d H:i:s');
            $colNames = 'id, ' . implode(', ', array_keys($cols));
            $placeholders = implode(', ', array_fill(0, count($cols) + 1, '?'));
            $stmt = $pdo->prepare("INSERT INTO loveho_reports ($colNames) VALUES ($placeholders)");
            $stmt->execute(array_merge([$uuid], array_values($cols)));
            unset($cols['refreshed_at']);
        }

        // 2. shop_hotel_info transport_fee upsert
        $stmt = $pdo->prepare('SELECT id FROM shop_hotel_info WHERE shop_id = ? AND hotel_id = ? LIMIT 1');
        $stmt->execute([$shopId, $hotelId]);
        $existShi = $stmt->fetch();

        if ($existShi) {
            $stmt = $pdo->prepare('UPDATE shop_hotel_info SET transport_fee = ?, can_call = 1, updated_at = NOW() WHERE id = ?');
            $stmt->execute([$transportFee, $existShi['id']]);
        } else {
            $stmt = $pdo->prepare('INSERT INTO shop_hotel_info (shop_id, hotel_id, can_call, transport_fee) VALUES (?, ?, 1, ?)');
            $stmt->execute([$shopId, $hotelId, $transportFee]);
        }

        $pdo->commit();
        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        $pdo->rollBack();
        error_log('[shop-hotel-api] save-loveho-info error: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['error' => 'サーバーエラーが発生しました']);
    }
}

// ===== POST: services + info 削除 =====
function handleDeleteInfo() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $auth = requireAuth();
    $input = json_decode(file_get_contents('php://input'), true);
    $infoId = $input['info_id'] ?? null;
    if (!$infoId) { http_response_code(400); echo json_encode(['error' => 'info_id required']); return; }

    $pdo = DB::conn();
    try {
        $pdo->beginTransaction();

        // shop_hotel_info から hotel_id を取得（loveho_reports 連動削除用）
        $stmt = $pdo->prepare('SELECT hotel_id FROM shop_hotel_info WHERE id = ? AND shop_id = ?');
        $stmt->execute([$infoId, $auth['shop_id']]);
        $shiRow = $stmt->fetch();

        $stmt = $pdo->prepare('DELETE FROM shop_hotel_services WHERE shop_hotel_info_id = ?');
        $stmt->execute([$infoId]);
        $stmt = $pdo->prepare('DELETE FROM shop_hotel_info WHERE id = ? AND shop_id = ?');
        $stmt->execute([$infoId, $auth['shop_id']]);

        // reports（ホテル口コミ）も連動削除
        if ($shiRow) {
            $stmt = $pdo->prepare('DELETE FROM reports WHERE hotel_id = ? AND shop_id = ? AND poster_type = ?');
            $stmt->execute([$shiRow['hotel_id'], $auth['shop_id'], 'shop']);
            // loveho_reports（ラブホ口コミ）も連動削除
            $stmt = $pdo->prepare('DELETE FROM loveho_reports WHERE hotel_id = ? AND shop_id = ?');
            $stmt->execute([$shiRow['hotel_id'], $auth['shop_id']]);
        }

        $pdo->commit();
        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['error' => '削除エラー']);
    }
}

// ===== POST: 表示日更新（無料店舗のみ、月1回制限） =====
function handleRefreshDate() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $auth = requireAuth();
    $input = json_decode(file_get_contents('php://input'), true);
    $hotelId = (int)($input['hotel_id'] ?? 0);
    if (!$hotelId) { http_response_code(400); echo json_encode(['error' => 'hotel_id required']); return; }

    $pdo = DB::conn();
    $shopId = $auth['shop_id'];

    // 有料プランチェック（有料は自動更新なので手動不要）
    $stmt = $pdo->prepare('SELECT MAX(cp.price) AS max_price FROM shop_contracts sc JOIN contract_plans cp ON sc.plan_id = cp.id WHERE sc.shop_id = ? AND (sc.expires_at IS NULL OR sc.expires_at >= CURDATE())');
    $stmt->execute([$shopId]);
    $row = $stmt->fetch();
    if ($row && (int)($row['max_price'] ?? 0) > 0) {
        http_response_code(400);
        echo json_encode(['error' => '有料プランは自動更新されます']);
        return;
    }

    // 両テーブルの最新 refreshed_at を取得
    $stmt = $pdo->prepare('SELECT refreshed_at FROM reports WHERE hotel_id = ? AND shop_id = ? AND poster_type = ? LIMIT 1');
    $stmt->execute([$hotelId, $shopId, 'shop']);
    $repRow = $stmt->fetch();

    $stmt = $pdo->prepare('SELECT refreshed_at FROM loveho_reports WHERE hotel_id = ? AND shop_id = ? LIMIT 1');
    $stmt->execute([$hotelId, $shopId]);
    $lhRow = $stmt->fetch();

    $dates = array_filter([$repRow['refreshed_at'] ?? null, $lhRow['refreshed_at'] ?? null]);
    $latestRefresh = $dates ? max($dates) : null;

    // 1ヶ月クールダウン
    if ($latestRefresh && strtotime($latestRefresh) > strtotime('-1 month')) {
        $nextDate = date('Y-m-d', strtotime('+1 month', strtotime($latestRefresh)));
        http_response_code(429);
        echo json_encode(['error' => '更新は月1回まで', 'next_refresh' => $nextDate]);
        return;
    }

    // 両テーブルの refreshed_at を更新
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('UPDATE reports SET refreshed_at = NOW() WHERE hotel_id = ? AND shop_id = ? AND poster_type = ?');
        $stmt->execute([$hotelId, $shopId, 'shop']);
        $stmt = $pdo->prepare('UPDATE loveho_reports SET refreshed_at = NOW() WHERE hotel_id = ? AND shop_id = ?');
        $stmt->execute([$hotelId, $shopId]);
        $pdo->commit();
        echo json_encode(['success' => true, 'refreshed_at' => date('Y-m-d H:i:s')]);
    } catch (Exception $e) {
        $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['error' => 'サーバーエラー']);
    }
}
?>
