<?php
/**
 * shop-plan-api.php — 店舗プラン申込API
 * Actions: plans, my-requests, submit-request, cancel-request
 */
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mail-utils.php';

define('SHOP_SESSION_TIMEOUT', 86400);
session_set_cookie_params([
    'lifetime' => SHOP_SESSION_TIMEOUT, 'path' => '/', 'domain' => 'yobuho.com',
    'secure' => true, 'httponly' => true, 'samesite' => 'Strict'
]);
session_start();

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: https://yobuho.com');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Credentials: true');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

function requireAuth() {
    if (empty($_SESSION['shop_id'])) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); exit; }
    if (time() - ($_SESSION['last_activity'] ?? 0) > SHOP_SESSION_TIMEOUT) { session_destroy(); http_response_code(401); echo json_encode(['error' => 'Session expired']); exit; }
    $_SESSION['last_activity'] = time();
    return $_SESSION['shop_id'];
}

$pdo = DB::conn();
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'plans':          handlePlans(); break;
    case 'my-requests':    handleMyRequests(); break;
    case 'submit-request': handleSubmitRequest(); break;
    case 'cancel-request': handleCancelRequest(); break;
    default: http_response_code(400); echo json_encode(['error' => 'Unknown action']);
}

// プラン一覧
function handlePlans() {
    global $pdo;
    $stmt = $pdo->query('SELECT id, name, price, description, sort_order FROM contract_plans ORDER BY sort_order, price');
    echo json_encode($stmt->fetchAll(), JSON_UNESCAPED_UNICODE);
}

// 自店の申込履歴
function handleMyRequests() {
    global $pdo;
    $shopId = requireAuth();
    $stmt = $pdo->prepare('
        SELECT r.*, cp.name AS plan_name, cp.price AS plan_price
        FROM shop_plan_requests r
        JOIN contract_plans cp ON r.plan_id = cp.id
        WHERE r.shop_id = ?
        ORDER BY r.created_at DESC
    ');
    $stmt->execute([$shopId]);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$row) {
        if ($row['requested_areas']) $row['requested_areas'] = json_decode($row['requested_areas'], true);
    }
    echo json_encode($rows, JSON_UNESCAPED_UNICODE);
}

// プラン申込
function handleSubmitRequest() {
    global $pdo;
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $shopId = requireAuth();
    $input = json_decode(file_get_contents('php://input'), true);
    $planId = (int)($input['plan_id'] ?? 0);
    $areas = $input['requested_areas'] ?? [];
    $message = trim($input['message'] ?? '');
    $agreed = $input['agreed'] ?? false;

    if (!$planId || !$agreed) { http_response_code(400); echo json_encode(['error' => '必須項目が不足しています']); return; }
    if (!is_array($areas)) $areas = [];

    // プラン存在確認（有料のみ）
    $stmt = $pdo->prepare('SELECT id, name, price FROM contract_plans WHERE id = ? AND price > 0');
    $stmt->execute([$planId]);
    $plan = $stmt->fetch();
    if (!$plan) { http_response_code(400); echo json_encode(['error' => '無効なプランです']); return; }

    // 同一プランの重複pending確認
    $stmt = $pdo->prepare('SELECT id FROM shop_plan_requests WHERE shop_id = ? AND plan_id = ? AND status = ?');
    $stmt->execute([$shopId, $planId, 'pending']);
    if ($stmt->fetch()) { http_response_code(409); echo json_encode(['error' => 'このプランは申込中です']); return; }

    // 店舗情報取得
    $stmt = $pdo->prepare('SELECT shop_name, email, gender_mode FROM shops WHERE id = ?');
    $stmt->execute([$shopId]);
    $shop = $stmt->fetch();
    if (!$shop) { http_response_code(400); echo json_encode(['error' => '店舗情報が取得できません']); return; }

    // 保存
    $now = date('Y-m-d H:i:s');
    $stmt = $pdo->prepare('INSERT INTO shop_plan_requests (shop_id, plan_id, requested_areas, message, agreed_at) VALUES (?, ?, ?, ?, ?)');
    $stmt->execute([$shopId, $planId, json_encode($areas, JSON_UNESCAPED_UNICODE), $message ?: null, $now]);
    $requestId = $pdo->lastInsertId();

    // 店舗向け確認メール
    $areasText = count($areas) ? implode('、', $areas) : '未選択';
    $shopBody = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">'
        . '<h2 style="color:#b5627a;">YobuHo</h2>'
        . '<p>' . htmlspecialchars($shop['shop_name']) . ' 様</p>'
        . '<p>プラン申込を受け付けました。管理者が確認後、ご連絡いたします。</p>'
        . '<table style="border-collapse:collapse;width:100%;font-size:14px;margin:16px 0;">'
        . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;width:120px;">プラン</td><td style="padding:8px;border-bottom:1px solid #eee;">' . htmlspecialchars($plan['name']) . '</td></tr>'
        . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">月額料金</td><td style="padding:8px;border-bottom:1px solid #eee;">¥' . number_format($plan['price']) . '/月(税込)</td></tr>'
        . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">希望エリア</td><td style="padding:8px;border-bottom:1px solid #eee;">' . htmlspecialchars($areasText) . '</td></tr>'
        . '<tr><td style="padding:8px;color:#888;">申込日時</td><td style="padding:8px;">' . $now . '</td></tr>'
        . '</table>'
        . '<p style="font-size:12px;color:#888;">※通常1〜2営業日以内にご連絡いたします。</p>'
        . '<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">'
        . '<p style="font-size:11px;color:#999;">このメールはYobuHoから自動送信されています。</p>'
        . '</div>';
    sendMailInternal($shop['email'], '【YobuHo】プラン申込を受け付けました', $shopBody);

    // admin向け通知メール
    $genreLabels = ['men' => 'デリヘル', 'women' => '女風', 'men_same' => '男性同士', 'women_same' => '女性同士', 'este' => 'デリエステ'];
    $genreLabel = $genreLabels[$shop['gender_mode']] ?? $shop['gender_mode'];
    $adminBody = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">'
        . '<h2 style="color:#333;">📋 新規プラン申込</h2>'
        . '<table style="border-collapse:collapse;width:100%;font-size:14px;">'
        . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;width:120px;">店舗名</td><td style="padding:8px;border-bottom:1px solid #eee;">' . htmlspecialchars($shop['shop_name']) . '</td></tr>'
        . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">ジャンル</td><td style="padding:8px;border-bottom:1px solid #eee;">' . htmlspecialchars($genreLabel) . '</td></tr>'
        . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">メール</td><td style="padding:8px;border-bottom:1px solid #eee;">' . htmlspecialchars($shop['email']) . '</td></tr>'
        . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">プラン</td><td style="padding:8px;border-bottom:1px solid #eee;">' . htmlspecialchars($plan['name']) . ' (¥' . number_format($plan['price']) . '/月)</td></tr>'
        . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">希望エリア</td><td style="padding:8px;border-bottom:1px solid #eee;">' . htmlspecialchars($areasText) . '</td></tr>'
        . ($message ? '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">メッセージ</td><td style="padding:8px;border-bottom:1px solid #eee;">' . nl2br(htmlspecialchars($message)) . '</td></tr>' : '')
        . '<tr><td style="padding:8px;color:#888;">申込日時</td><td style="padding:8px;">' . $now . '</td></tr>'
        . '</table>'
        . '<div style="margin-top:20px;text-align:center;">'
        . '<a href="https://yobuho.com/admin.html" style="display:inline-block;padding:12px 30px;background:#e67e22;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">管理画面で確認する</a>'
        . '</div></div>';
    sendMailInternal('hotel@yobuho.com', '【YobuHo】新規プラン申込: ' . $shop['shop_name'] . ' → ' . $plan['name'], $adminBody);

    echo json_encode(['ok' => true, 'id' => (int)$requestId]);
}

// 申込キャンセル
function handleCancelRequest() {
    global $pdo;
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); return; }
    $shopId = requireAuth();
    $input = json_decode(file_get_contents('php://input'), true);
    $requestId = (int)($input['request_id'] ?? 0);
    if (!$requestId) { http_response_code(400); echo json_encode(['error' => 'Invalid request_id']); return; }

    $stmt = $pdo->prepare('UPDATE shop_plan_requests SET status = ? WHERE id = ? AND shop_id = ? AND status = ?');
    $stmt->execute(['cancelled', $requestId, $shopId, 'pending']);
    if ($stmt->rowCount() === 0) { http_response_code(404); echo json_encode(['error' => '対象の申込が見つかりません']); return; }
    echo json_encode(['ok' => true]);
}

// メール送信ヘルパー（mail-utils.php の sendTransactionalMail を利用）
function sendMailInternal($to, $subject, $htmlBody) {
    sendTransactionalMail($to, $subject, $htmlBody);
}
?>
