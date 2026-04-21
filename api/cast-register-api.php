<?php
/**
 * cast-register-api.php — キャスト招待受諾（Magic Link）
 *
 * PUBLIC ENDPOINT（トークン検証が認証代わり、セッション不要）
 *
 * Actions:
 *   - verify    : トークン検証 → 招待情報を返す（email/display_name/shop_name）
 *   - activate  : パスワード設定＋招待消費（casts.password_hash + status='active'、consumed_at=NOW）
 */
require_once __DIR__ . '/db.php';

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Access-Control-Allow-Origin: https://yobuho.com');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Credentials: true');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

function err(string $msg, int $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}
function ok(array $data = []) {
    echo json_encode(['success' => true] + $data);
    exit;
}
function inp(string $key, $default = null) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        static $body = null;
        if ($body === null) {
            $raw = file_get_contents('php://input');
            $body = $raw ? (json_decode($raw, true) ?? []) : [];
        }
        return $body[$key] ?? ($_POST[$key] ?? $default);
    }
    return $_GET[$key] ?? $default;
}

function fetchInvite(PDO $pdo, string $token): ?array {
    $stmt = $pdo->prepare(
        'SELECT ci.id, ci.shop_id, ci.email, ci.display_name, ci.expires_at, ci.consumed_at,
                s.shop_name
         FROM cast_invites ci
         JOIN shops s ON s.id = ci.shop_id
         WHERE ci.token = ?'
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

$action = $_GET['action'] ?? '';
switch ($action) {
    case 'verify':   handleVerify(); break;
    case 'activate': handleActivate(); break;
    default:
        err('Invalid action');
}

function handleVerify() {
    $token = (string)inp('token', '');
    if ($token === '' || !preg_match('/^[a-f0-9]{64}$/', $token)) err('トークンが不正です');
    $pdo = DB::conn();
    $inv = fetchInvite($pdo, $token);
    if (!$inv) err('招待が見つかりません。URLが正しいかご確認ください', 404);
    if ($inv['consumed_at']) err('この招待は既に使用されています', 410);
    if (strtotime($inv['expires_at']) < time()) err('招待の有効期限が切れています。店舗に再発行を依頼してください', 410);
    ok([
        'email' => $inv['email'],
        'display_name' => $inv['display_name'],
        'shop_name' => $inv['shop_name'],
    ]);
}

function handleActivate() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') err('POST only', 405);
    $token = (string)inp('token', '');
    $password = (string)inp('password', '');
    if ($token === '' || !preg_match('/^[a-f0-9]{64}$/', $token)) err('トークンが不正です');
    if (mb_strlen($password) < 8) err('パスワードは8文字以上で設定してください');
    if (mb_strlen($password) > 200) err('パスワードが長すぎます');

    $pdo = DB::conn();
    $inv = fetchInvite($pdo, $token);
    if (!$inv) err('招待が見つかりません', 404);
    if ($inv['consumed_at']) err('この招待は既に使用されています', 410);
    if (strtotime($inv['expires_at']) < time()) err('招待の有効期限が切れています', 410);

    $stmt = $pdo->prepare('SELECT id, password_hash FROM casts WHERE email = ?');
    $stmt->execute([$inv['email']]);
    $cast = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$cast) err('キャストアカウントが見つかりません', 404);

    $hash = password_hash($password, PASSWORD_BCRYPT);

    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE casts SET password_hash = ?, status = "active", updated_at = NOW() WHERE id = ?')
            ->execute([$hash, $cast['id']]);
        $pdo->prepare('UPDATE cast_invites SET consumed_at = NOW() WHERE id = ?')
            ->execute([$inv['id']]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        error_log('[cast-register-api:activate] ' . $e->getMessage());
        err('登録処理中にエラーが発生しました', 500);
    }

    ok([
        'email' => $inv['email'],
        'message' => 'キャスト登録が完了しました',
    ]);
}
