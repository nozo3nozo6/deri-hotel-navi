<?php
/**
 * shop-cast-api.php — 店舗側 Cast 管理 API
 *
 * 全action: PHPセッション認証必須（shop-auth.php のセッション共有）
 * 前提: shops.cast_enabled = 1 (テスト段階は立川秘密基地のみ)
 *
 * Actions:
 *   - list          : 自店舗の Cast 一覧 + 定員情報
 *   - invite        : 新規 Cast を招待（Magic Link メール送信）→ status='pending_approval'
 *   - approve       : 承認待ちキャストを承認（2段階承認の2段目）→ status='active'
 *   - update        : Cast プロフィール更新
 *   - remove        : Cast を店舗から外す（shop_casts のみ削除、casts本体は他店舗所属あれば残る）
 *   - resend-invite : Magic Link 再送
 *
 * 2段階承認フロー:
 *   1. 店舗が invite → shop_casts.status = 'pending_approval'
 *   2. キャスト本人が Magic Link からパスワード設定 → casts.status = 'active' (shop_casts は承認待ちのまま)
 *   3. 店舗オーナーが approve → shop_casts.status = 'active', approved_at = NOW()
 *   4. 承認後のみチャット・プロフィール表示・定員カウント等の全機能が発動
 */
require_once __DIR__ . '/db.php';

define('CAST_SESSION_TIMEOUT', 86400);
session_set_cookie_params([
    'lifetime' => CAST_SESSION_TIMEOUT,
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

function requireAuth(): array {
    if (empty($_SESSION['shop_id'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
    if (time() - ($_SESSION['last_activity'] ?? 0) > CAST_SESSION_TIMEOUT) {
        session_destroy();
        http_response_code(401);
        echo json_encode(['error' => 'Session expired']);
        exit;
    }
    $_SESSION['last_activity'] = time();
    return ['shop_id' => $_SESSION['shop_id']];
}

function requireCastEnabled(string $shopId): array {
    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id, shop_name, cast_enabled FROM shops WHERE id = ?');
    $stmt->execute([$shopId]);
    $shop = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$shop) {
        http_response_code(404);
        echo json_encode(['error' => 'Shop not found']);
        exit;
    }
    if (!(int)$shop['cast_enabled']) {
        http_response_code(403);
        echo json_encode(['error' => 'Cast feature not enabled for this shop']);
        exit;
    }
    return $shop;
}

function getCurrentPlanLimit(string $shopId): int {
    $pdo = DB::conn();
    $sql = 'SELECT MAX(cp.cast_limit) AS lim
            FROM shop_contracts sc
            JOIN contract_plans cp ON cp.id = sc.plan_id
            WHERE sc.shop_id = ?';
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$shopId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row && $row['lim'] !== null ? (int)$row['lim'] : 0;
}

function countActiveCasts(string $shopId): int {
    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM shop_casts WHERE shop_id = ? AND status != "removed"');
    $stmt->execute([$shopId]);
    return (int)$stmt->fetchColumn();
}

function genUuid(): string {
    $d = random_bytes(16);
    $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
    $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);
    $h = bin2hex($d);
    return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4) . '-' . substr($h, 16, 4) . '-' . substr($h, 20, 12);
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

function err(string $msg, int $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

function ok(array $data = []) {
    echo json_encode(['success' => true] + $data);
    exit;
}

$action = $_GET['action'] ?? '';
switch ($action) {
    case 'list':            handleList(); break;
    case 'invite':          handleInvite(); break;
    case 'approve':         handleApprove(); break;
    case 'update':          handleUpdate(); break;
    case 'remove':          handleRemove(); break;
    case 'resend-invite':   handleResendInvite(); break;
    default:
        http_response_code(400);
        echo json_encode(['error' => 'Invalid action']);
}

function handleList() {
    $auth = requireAuth();
    requireCastEnabled($auth['shop_id']);
    $pdo = DB::conn();

    $sql = 'SELECT sc.id, sc.cast_id, sc.display_name, sc.profile_image_url, sc.bio,
                   sc.status, sc.sort_order, sc.joined_at, sc.approved_at,
                   c.email, c.status AS cast_status, c.last_login_at,
                   (c.password_hash IS NOT NULL) AS has_password
            FROM shop_casts sc
            JOIN casts c ON c.id = sc.cast_id
            WHERE sc.shop_id = ? AND sc.status != "removed"
            ORDER BY FIELD(sc.status, "pending_approval", "active", "suspended"), sc.sort_order, sc.joined_at';
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$auth['shop_id']]);
    $casts = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $sql2 = 'SELECT id, email, display_name, expires_at, created_at
             FROM cast_invites
             WHERE shop_id = ? AND consumed_at IS NULL AND expires_at > NOW()
             ORDER BY created_at DESC';
    $stmt2 = $pdo->prepare($sql2);
    $stmt2->execute([$auth['shop_id']]);
    $pendingInvites = $stmt2->fetchAll(PDO::FETCH_ASSOC);

    $limit = getCurrentPlanLimit($auth['shop_id']);
    $used = countActiveCasts($auth['shop_id']);

    ok([
        'casts' => $casts,
        'pending_invites' => $pendingInvites,
        'cast_limit' => $limit,
        'cast_used' => $used,
        'cast_remaining' => max(0, $limit - $used),
    ]);
}

function handleInvite() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') err('POST only', 405);
    $auth = requireAuth();
    $shop = requireCastEnabled($auth['shop_id']);

    $email = trim((string)inp('email', ''));
    $displayName = trim((string)inp('display_name', ''));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) err('メールアドレスが正しくありません');
    if ($displayName === '') err('源氏名を入力してください');
    if (mb_strlen($displayName) > 100) err('源氏名は100文字以内で入力してください');

    $limit = getCurrentPlanLimit($auth['shop_id']);
    $used = countActiveCasts($auth['shop_id']);
    if ($used >= $limit) {
        err("現在のプランではこれ以上 Cast を追加できません（上限 {$limit}名）", 400);
    }

    $pdo = DB::conn();
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT id, status FROM casts WHERE email = ?');
        $stmt->execute([$email]);
        $existing = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($existing) {
            $castId = $existing['id'];
            $stmt = $pdo->prepare('SELECT id, status FROM shop_casts WHERE shop_id = ? AND cast_id = ?');
            $stmt->execute([$auth['shop_id'], $castId]);
            $existingLink = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($existingLink && $existingLink['status'] !== 'removed') {
                $pdo->rollBack();
                err('このメールアドレスは既に招待済みです');
            }
            if ($existingLink && $existingLink['status'] === 'removed') {
                // 再招待: pending_approval に戻して承認日時もクリア
                $pdo->prepare('UPDATE shop_casts SET display_name = ?, status = "pending_approval", approved_at = NULL, updated_at = NOW() WHERE id = ?')
                    ->execute([$displayName, $existingLink['id']]);
            } else {
                $pdo->prepare('INSERT INTO shop_casts (id, shop_id, cast_id, display_name, status) VALUES (?, ?, ?, ?, "pending_approval")')
                    ->execute([genUuid(), $auth['shop_id'], $castId, $displayName]);
            }
        } else {
            $castId = genUuid();
            $pdo->prepare('INSERT INTO casts (id, email, status) VALUES (?, ?, "invited")')
                ->execute([$castId, $email]);
            $pdo->prepare('INSERT INTO shop_casts (id, shop_id, cast_id, display_name, status) VALUES (?, ?, ?, ?, "pending_approval")')
                ->execute([genUuid(), $auth['shop_id'], $castId, $displayName]);
        }

        $token = bin2hex(random_bytes(32));
        $expiresAt = date('Y-m-d H:i:s', time() + 86400 * 3); // 3日有効
        $pdo->prepare('INSERT INTO cast_invites (id, shop_id, email, display_name, token, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([genUuid(), $auth['shop_id'], $email, $displayName, $token, $expiresAt]);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        error_log('[shop-cast-api:invite] ' . $e->getMessage());
        err('招待処理中にエラーが発生しました: ' . $e->getMessage(), 500);
    }

    sendInviteMail($email, $displayName, $shop['shop_name'], $token);
    ok(['message' => '招待メールを送信しました']);
}

function handleApprove() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') err('POST only', 405);
    $auth = requireAuth();
    requireCastEnabled($auth['shop_id']);

    $id = (string)inp('id', '');
    if ($id === '') err('id required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT sc.id, sc.status, c.password_hash
         FROM shop_casts sc
         JOIN casts c ON c.id = sc.cast_id
         WHERE sc.id = ? AND sc.shop_id = ?'
    );
    $stmt->execute([$id, $auth['shop_id']]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) err('Cast not found', 404);
    if ($row['status'] !== 'pending_approval') err('このキャストは既に承認済みか別の状態です');
    if (empty($row['password_hash'])) err('キャストがメールリンクからパスワード設定を完了するまで承認できません');

    $pdo->prepare('UPDATE shop_casts SET status = "active", approved_at = NOW(), updated_at = NOW() WHERE id = ?')
        ->execute([$id]);
    ok(['message' => 'キャストを承認しました']);
}

function handleUpdate() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') err('POST only', 405);
    $auth = requireAuth();
    requireCastEnabled($auth['shop_id']);

    $id = (string)inp('id', '');
    if ($id === '') err('id required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id FROM shop_casts WHERE id = ? AND shop_id = ?');
    $stmt->execute([$id, $auth['shop_id']]);
    if (!$stmt->fetchColumn()) err('Cast not found', 404);

    $fields = [];
    $values = [];
    $displayName = inp('display_name', null);
    if ($displayName !== null) {
        $displayName = trim((string)$displayName);
        if ($displayName === '') err('源氏名を入力してください');
        if (mb_strlen($displayName) > 100) err('源氏名は100文字以内で入力してください');
        $fields[] = 'display_name = ?';
        $values[] = $displayName;
    }
    $bio = inp('bio', null);
    if ($bio !== null) {
        $bio = trim((string)$bio);
        if (mb_strlen($bio) > 500) err('自己紹介は500文字以内で入力してください');
        $fields[] = 'bio = ?';
        $values[] = $bio;
    }
    $imgUrl = inp('profile_image_url', null);
    if ($imgUrl !== null) {
        $imgUrl = trim((string)$imgUrl);
        $fields[] = 'profile_image_url = ?';
        $values[] = $imgUrl === '' ? null : $imgUrl;
    }
    $sortOrder = inp('sort_order', null);
    if ($sortOrder !== null) {
        $fields[] = 'sort_order = ?';
        $values[] = max(0, min(9999, (int)$sortOrder));
    }
    $status = inp('status', null);
    if ($status !== null) {
        if (!in_array($status, ['active', 'suspended'], true)) err('invalid status');
        $fields[] = 'status = ?';
        $values[] = $status;
    }

    if (!$fields) err('変更内容がありません');
    $values[] = $id;
    $sql = 'UPDATE shop_casts SET ' . implode(', ', $fields) . ', updated_at = NOW() WHERE id = ?';
    $pdo->prepare($sql)->execute($values);
    ok();
}

function handleRemove() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') err('POST only', 405);
    $auth = requireAuth();
    requireCastEnabled($auth['shop_id']);
    $id = (string)inp('id', '');
    if ($id === '') err('id required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('DELETE FROM shop_casts WHERE id = ? AND shop_id = ?');
    $stmt->execute([$id, $auth['shop_id']]);
    if (!$stmt->rowCount()) err('Cast not found', 404);
    ok();
}

function handleResendInvite() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') err('POST only', 405);
    $auth = requireAuth();
    $shop = requireCastEnabled($auth['shop_id']);
    $inviteId = (string)inp('invite_id', '');
    if ($inviteId === '') err('invite_id required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id, email, display_name, token, expires_at, consumed_at FROM cast_invites WHERE id = ? AND shop_id = ?');
    $stmt->execute([$inviteId, $auth['shop_id']]);
    $invite = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$invite) err('Invite not found', 404);
    if ($invite['consumed_at']) err('この招待は既に受諾済みです');

    $newToken = bin2hex(random_bytes(32));
    $newExpires = date('Y-m-d H:i:s', time() + 86400 * 3);
    $pdo->prepare('UPDATE cast_invites SET token = ?, expires_at = ? WHERE id = ?')
        ->execute([$newToken, $newExpires, $invite['id']]);

    sendInviteMail($invite['email'], $invite['display_name'], $shop['shop_name'], $newToken);
    ok(['message' => '招待メールを再送しました']);
}

function sendInviteMail(string $email, string $displayName, string $shopName, string $token): void {
    $url = 'https://yobuho.com/cast-register.html?token=' . urlencode($token);
    $subject = '【YobuChat】' . $shopName . ' からキャスト登録の招待が届いています';

    $body = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">'
          . '<h2 style="color:#b5627a;">' . htmlspecialchars($shopName) . ' から招待が届いています</h2>'
          . '<p>' . htmlspecialchars($displayName) . ' 様</p>'
          . '<p>YobuChat by YobuHo の Cast 管理に招待されました。以下のボタンからパスワードを設定してアカウントを有効化してください。</p>'
          . '<div style="text-align:center;margin:30px 0;">'
          . '<a href="' . htmlspecialchars($url) . '" style="display:inline-block;padding:14px 36px;background:#b5627a;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:bold;">登録を完了する</a>'
          . '</div>'
          . '<p style="font-size:12px;color:#888;">このリンクは3日間有効です。</p>'
          . '<p style="font-size:12px;color:#888;">心当たりがない場合はこのメールを無視してください。招待は自動で無効になります。</p>'
          . '<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">'
          . '<p style="font-size:12px;color:#888;">YobuChat by YobuHo — <a href="https://yobuho.com" style="color:#b5627a;text-decoration:none;">https://yobuho.com</a></p>'
          . '</div>';

    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        'From: YobuHo <hotel@yobuho.com>',
    ];
    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $encodedBody = base64_encode($body);
    mail($email, $encodedSubject, $encodedBody, implode("\r\n", $headers), '-f hotel@yobuho.com');
}
