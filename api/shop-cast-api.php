<?php
/**
 * shop-cast-api.php — 店舗側 Cast 管理 API
 *
 * 全action: PHPセッション認証必須（shop-auth.php のセッション共有）
 * 前提: 投稿リンクプラン以上 (contract_plans.cast_limit > 0) に契約中の店舗のみ利用可
 *       （旧 shops.cast_enabled 手動フラグはプラン連動ゲートに置換、テスト段階終了）
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
require_once __DIR__ . '/mail-utils.php';

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
    $stmt = $pdo->prepare('SELECT id, shop_name FROM shops WHERE id = ?');
    $stmt->execute([$shopId]);
    $shop = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$shop) {
        http_response_code(404);
        echo json_encode(['error' => 'Shop not found']);
        exit;
    }
    // プラン連動ゲート: cast_limit > 0 のプランに「契約中」(expires_at NULL or 未来) ならOK.
    // 旧 shops.cast_enabled 手動フラグの判定は廃止 (テスト段階を脱したため).
    if (getCurrentPlanLimit($shopId) <= 0) {
        http_response_code(403);
        echo json_encode(['error' => 'キャスト機能は投稿リンクプラン以上でご利用いただけます']);
        exit;
    }
    return $shop;
}

function getCurrentPlanLimit(string $shopId): int {
    $info = getCurrentPlanInfo($shopId);
    return $info['limit'];
}

// 複数契約がある場合は cast_limit が最も大きい（同値なら price が高い）プランを「キャスト枠の根拠」として返す.
function getCurrentPlanInfo(string $shopId): array {
    $pdo = DB::conn();
    // expires_at NULL または将来日のみ「契約中」とみなす (admin.js の syncBestPlan と同一判定).
    $sql = 'SELECT cp.name, cp.cast_limit
            FROM shop_contracts sc
            JOIN contract_plans cp ON cp.id = sc.plan_id
            WHERE sc.shop_id = ?
              AND (sc.expires_at IS NULL OR sc.expires_at > NOW())
            ORDER BY cp.cast_limit DESC, cp.price DESC
            LIMIT 1';
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$shopId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return [
        'limit' => $row ? (int)$row['cast_limit'] : 0,
        'name'  => $row ? (string)$row['name'] : '',
    ];
}

function countActiveCasts(string $shopId): int {
    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM shop_casts WHERE shop_id = ? AND status != "removed"');
    $stmt->execute([$shopId]);
    return (int)$stmt->fetchColumn();
}

// 招待上限 = 表示上限 × INVITE_LIMIT_MULTIPLIER（ロスター用バッファ）
const INVITE_LIMIT_MULTIPLIER = 2;

// 公開表示中のキャスト数（is_visible=1 かつ active かつ未削除）
function countVisibleCasts(string $shopId): int {
    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM shop_casts WHERE shop_id = ? AND status = "active" AND deleted_at IS NULL AND is_visible = 1');
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
    case 'toggle-visible':  handleToggleVisible(); break;
    case 'remove':          handleRemove(); break;
    case 'resend-invite':   handleResendInvite(); break;
    case 'cancel-invite':   handleCancelInvite(); break;
    case 'chat-sessions':   handleChatSessions(); break;
    case 'chat-messages':   handleChatMessages(); break;
    default:
        http_response_code(400);
        echo json_encode(['error' => 'Invalid action']);
}

function handleList() {
    $auth = requireAuth();
    requireCastEnabled($auth['shop_id']);
    $pdo = DB::conn();

    $sql = 'SELECT sc.id, sc.cast_id, sc.display_name, sc.profile_image_url, sc.bio,
                   sc.status, sc.sort_order, sc.joined_at, sc.approved_at, sc.is_visible,
                   sc.chat_notify_mode, sc.chat_notify_email,
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

    $planInfo = getCurrentPlanInfo($auth['shop_id']);
    $limit = $planInfo['limit'];
    $used = countActiveCasts($auth['shop_id']);
    $inviteLimit = $limit * INVITE_LIMIT_MULTIPLIER;
    $visibleUsed = countVisibleCasts($auth['shop_id']);

    // 店舗 slug: shop-admin の埋込コード生成 (openCastEmbedCode) で使用. chat タブ未訪問でも
    // cast タブ単体で埋込コードが取得できるよう list 応答に同梱.
    $stmtSlug = $pdo->prepare('SELECT slug FROM shops WHERE id = ? LIMIT 1');
    $stmtSlug->execute([$auth['shop_id']]);
    $shopSlug = (string)($stmtSlug->fetchColumn() ?: '');

    ok([
        'casts' => $casts,
        'pending_invites' => $pendingInvites,
        // 表示上限（プラン由来）と現在表示中の人数
        'cast_limit'      => $limit,           // 表示上限（互換維持）
        'visible_limit'   => $limit,
        'visible_used'    => $visibleUsed,
        'visible_remaining' => max(0, $limit - $visibleUsed),
        // 招待・登録上限（表示上限 × 倍率）と現在の登録数（active+pending+suspended）
        'invite_limit'    => $inviteLimit,
        'cast_used'       => $used,
        'cast_remaining'  => max(0, $inviteLimit - $used),
        'cast_plan_name'  => $planInfo['name'],
        'shop_slug'       => $shopSlug,
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

    // 招待上限 = 表示上限 × INVITE_LIMIT_MULTIPLIER（ロスター用バッファ）
    $limit = getCurrentPlanLimit($auth['shop_id']);
    $inviteLimit = $limit * INVITE_LIMIT_MULTIPLIER;
    $used = countActiveCasts($auth['shop_id']);
    if ($used >= $inviteLimit) {
        err("登録できるキャスト数の上限に達しました（招待上限 {$inviteLimit}名 / 表示上限 {$limit}名×" . INVITE_LIMIT_MULTIPLIER . "）", 400);
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

            // 他店舗含めて1つも現役link がなければ、前回のpassword/ログイン履歴をリセット
            // （削除後の再招待で承認ステップを事実上スキップしてしまう事故を防ぐ）
            $stmt = $pdo->prepare('SELECT COUNT(*) FROM shop_casts WHERE cast_id = ?');
            $stmt->execute([$castId]);
            if ((int)$stmt->fetchColumn() === 0) {
                $pdo->prepare('UPDATE casts SET password_hash = NULL, last_login_at = NULL, status = "invited" WHERE id = ?')
                    ->execute([$castId]);
            }

            if ($existingLink && $existingLink['status'] === 'removed') {
                // 再招待: pending_approval に戻して承認日時もクリア. inbox_token は再発行.
                // deleted_at もクリア (cast-list-public が deleted_at IS NULL でフィルタするため、
                // 残ったままだと再承認後も公開API/指名プルダウンに表示されない).
                $pdo->prepare('UPDATE shop_casts SET display_name = ?, status = "pending_approval", approved_at = NULL, deleted_at = NULL, inbox_token = ?, updated_at = NOW() WHERE id = ?')
                    ->execute([$displayName, genUuid(), $existingLink['id']]);
            } else {
                $pdo->prepare('INSERT INTO shop_casts (id, shop_id, cast_id, display_name, inbox_token, status) VALUES (?, ?, ?, ?, ?, "pending_approval")')
                    ->execute([genUuid(), $auth['shop_id'], $castId, $displayName, genUuid()]);
            }
        } else {
            $castId = genUuid();
            $pdo->prepare('INSERT INTO casts (id, email, status) VALUES (?, ?, "invited")')
                ->execute([$castId, $email]);
            $pdo->prepare('INSERT INTO shop_casts (id, shop_id, cast_id, display_name, inbox_token, status) VALUES (?, ?, ?, ?, ?, "pending_approval")')
                ->execute([genUuid(), $auth['shop_id'], $castId, $displayName, genUuid()]);
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
    $shop = requireCastEnabled($auth['shop_id']);

    $id = (string)inp('id', '');
    if ($id === '') err('id required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT sc.id, sc.status, sc.display_name, c.password_hash, c.email
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

    sendApprovalMail($row['email'], $row['display_name'], $shop['shop_name']);
    ok(['message' => 'キャストを承認しました']);
}

// 表示・非表示の切替.
//   - active キャストのみ操作可能（pending_approval / suspended は不可）
//   - is_visible=1 にする時は表示上限（cast_limit）を超えないかチェック
//   - 同じ値に切り替えても 200 で返す（idempotent）
function handleToggleVisible() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') err('POST only', 405);
    $auth = requireAuth();
    requireCastEnabled($auth['shop_id']);

    $id = (string)inp('id', '');
    $visibleRaw = inp('is_visible', null);
    if ($id === '') err('id required');
    if ($visibleRaw === null) err('is_visible required');
    $visible = (int)!!$visibleRaw;

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT status, is_visible, deleted_at FROM shop_casts WHERE id = ? AND shop_id = ?');
    $stmt->execute([$id, $auth['shop_id']]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) err('Cast not found', 404);
    if ($row['deleted_at'] !== null) err('削除済みのキャストです', 400);
    if ($row['status'] !== 'active') err('承認済みキャストのみ表示切替できます', 400);

    // 表示ON にする時のみ上限チェック（OFF は常に許可）
    if ($visible === 1 && (int)$row['is_visible'] === 0) {
        $limit = getCurrentPlanLimit($auth['shop_id']);
        $current = countVisibleCasts($auth['shop_id']);
        if ($current >= $limit) {
            err("表示できるキャスト数の上限に達しています（{$limit}名）。他のキャストを非表示にしてから切り替えてください", 400);
        }
    }

    $pdo->prepare('UPDATE shop_casts SET is_visible = ?, updated_at = NOW() WHERE id = ?')
        ->execute([$visible, $id]);

    ok([
        'is_visible'        => $visible,
        'visible_used'      => countVisibleCasts($auth['shop_id']),
        'visible_limit'     => getCurrentPlanLimit($auth['shop_id']),
    ]);
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
        if ($imgUrl !== '') {
            // data URL のみ許可（XSS/外部参照防止）。96x96 JPEG quality 0.82 なら ~10KB, base64で ~14KB
            if (!preg_match('#^data:image/(jpeg|png);base64,#', $imgUrl)) {
                err('画像形式が正しくありません');
            }
            // 上限 90KB (base64 data URL 全体で): 96x96 JPEG想定で十分な余裕
            if (strlen($imgUrl) > 92160) err('画像サイズが大きすぎます (最大 ~65KB)');
        }
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
    $notifyMode = inp('chat_notify_mode', null);
    if ($notifyMode !== null) {
        if (!in_array($notifyMode, ['off', 'first', 'every'], true)) err('invalid chat_notify_mode');
        $fields[] = 'chat_notify_mode = ?';
        $values[] = $notifyMode;
    }
    $notifyEmail = inp('chat_notify_email', null);
    if ($notifyEmail !== null) {
        $notifyEmail = trim((string)$notifyEmail);
        if ($notifyEmail === '') {
            $fields[] = 'chat_notify_email = NULL';
        } else {
            if (!filter_var($notifyEmail, FILTER_VALIDATE_EMAIL)) err('メールアドレスの形式が正しくありません');
            if (mb_strlen($notifyEmail) > 255) err('メールアドレスが長すぎます');
            $fields[] = 'chat_notify_email = ?';
            $values[] = $notifyEmail;
        }
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

    // Soft-delete: status='removed' + deleted_at=NOW() + inbox_token再発行（旧URL即時無効化）.
    // 60日後に chat-retention.php が物理削除。
    // 再招待時の承認迂回事故防止のため、cast本体の password_hash / last_login_at もこの場でクリア
    // （削除したキャストが他店舗に active で残っていたら触らない）.
    $stmt = $pdo->prepare(
        'SELECT sc.status, c.id AS cast_id, c.email FROM shop_casts sc
         JOIN casts c ON c.id = sc.cast_id
         WHERE sc.id = ? AND sc.shop_id = ?'
    );
    $stmt->execute([$id, $auth['shop_id']]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) err('Cast not found', 404);
    if ($row['status'] === 'removed') err('このキャストは既に削除済みです');

    $castId = $row['cast_id'];
    $email  = (string)($row['email'] ?? '');

    $pdo->beginTransaction();
    try {
        // 1. shop_casts soft-delete + inbox_token 再発行
        $pdo->prepare(
            'UPDATE shop_casts
                SET status = "removed",
                    deleted_at = NOW(),
                    inbox_token = ?,
                    updated_at = NOW()
              WHERE id = ? AND shop_id = ?'
        )->execute([genUuid(), $id, $auth['shop_id']]);

        // 2. セキュリティ即時パージ: 端末登録 + 登録用コード
        $pdo->prepare('DELETE FROM cast_inbox_devices WHERE shop_cast_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM cast_inbox_codes WHERE shop_cast_id = ?')->execute([$id]);

        // 3. 未消費の招待を破棄（このキャスト宛の未使用Magic Link）
        if ($email !== '') {
            $pdo->prepare('DELETE FROM cast_invites WHERE shop_id = ? AND email = ? AND consumed_at IS NULL')
                ->execute([$auth['shop_id'], $email]);
        }

        // 4. オープン中の該当チャットセッションを close（訪問者が返信待ちにならないように）
        $pdo->prepare(
            'UPDATE chat_sessions
                SET status = "closed", closed_at = NOW()
              WHERE shop_id = ? AND cast_id = ? AND status = "open"'
        )->execute([$auth['shop_id'], $castId]);

        // 5. このcastに active shop_casts が他に残っていなければ、cast本体もリセット
        //    (password_hash/last_login_at を消しておかないと再招待時に承認ステップがスキップされる)
        $stmt3 = $pdo->prepare('SELECT COUNT(*) FROM shop_casts WHERE cast_id = ? AND status != "removed"');
        $stmt3->execute([$castId]);
        if ((int)$stmt3->fetchColumn() === 0) {
            $pdo->prepare('UPDATE casts SET password_hash = NULL, last_login_at = NULL, status = "invited", updated_at = NOW() WHERE id = ?')
                ->execute([$castId]);
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        error_log('[shop-cast-api:remove] ' . $e->getMessage());
        err('削除処理中にエラーが発生しました: ' . $e->getMessage(), 500);
    }

    ok();
}

function handleCancelInvite() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') err('POST only', 405);
    $auth = requireAuth();
    requireCastEnabled($auth['shop_id']);
    $inviteId = (string)inp('invite_id', '');
    if ($inviteId === '') err('invite_id required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('DELETE FROM cast_invites WHERE id = ? AND shop_id = ? AND consumed_at IS NULL');
    $stmt->execute([$inviteId, $auth['shop_id']]);
    if (!$stmt->rowCount()) err('招待が見つからないか既に受諾されています', 404);
    ok(['message' => '招待を取り消しました']);
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
          . '<p>YobuChat by YobuHo の Cast 管理に招待されました。以下のボタンからパスワードを設定し、登録申請を行ってください。店舗オーナーの承認後、チャット機能がご利用いただけます。</p>'
          . '<div style="text-align:center;margin:30px 0;">'
          . '<a href="' . htmlspecialchars($url) . '" style="display:inline-block;padding:14px 36px;background:#b5627a;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:bold;">申請する</a>'
          . '</div>'
          . '<p style="font-size:12px;color:#888;">このリンクは3日間有効です。</p>'
          . '<p style="font-size:12px;color:#888;">心当たりがない場合はこのメールを無視してください。招待は自動で無効になります。</p>'
          . '<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">'
          . '<p style="font-size:12px;color:#888;">YobuChat by YobuHo — <a href="https://yobuho.com" style="color:#b5627a;text-decoration:none;">https://yobuho.com</a></p>'
          . '</div>';

    sendTransactionalMail($email, $subject, $body);
}

function sendApprovalMail(string $email, string $displayName, string $shopName): void {
    $loginUrl = 'https://yobuho.com/cast-admin.html';
    $subject = '【YobuChat】' . $shopName . ' のキャスト登録が承認されました';

    $body = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">'
          . '<h2 style="color:#b5627a;">登録が承認されました 🎉</h2>'
          . '<p>' . htmlspecialchars($displayName) . ' 様</p>'
          . '<p>' . htmlspecialchars($shopName) . ' からのキャスト登録申請が承認されました。</p>'
          . '<p>キャスト管理画面にログインして、プロフィール編集・チャット応答・オンライン/オフライン切替などをご利用いただけます。</p>'
          . '<div style="text-align:center;margin:30px 0;">'
          . '<a href="' . htmlspecialchars($loginUrl) . '" style="display:inline-block;padding:14px 36px;background:#b5627a;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:bold;">キャスト管理画面にログイン</a>'
          . '</div>'
          . '<p style="font-size:12px;color:#888;">ログインには、申請時にご登録いただいたメールアドレスとパスワードをご利用ください。</p>'
          . '<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">'
          . '<p style="font-size:12px;color:#888;">YobuChat by YobuHo — <a href="https://yobuho.com" style="color:#b5627a;text-decoration:none;">https://yobuho.com</a></p>'
          . '</div>';

    sendTransactionalMail($email, $subject, $body);
}

// ==================================================
// Cast chat viewer (店舗オーナーがキャスト指名チャットを閲覧)
// ==================================================

// GET: shop_cast_id=<shop_casts.id> → そのキャストに紐づく直近30セッション
function handleChatSessions() {
    $auth = requireAuth();
    requireCastEnabled($auth['shop_id']);
    $shopCastId = trim((string)inp('shop_cast_id', ''));
    if ($shopCastId === '') err('shop_cast_id required');

    $pdo = DB::conn();
    // このキャストが自店舗のものか確認
    $stmt = $pdo->prepare('SELECT id, cast_id, display_name FROM shop_casts WHERE id = ? AND shop_id = ? LIMIT 1');
    $stmt->execute([$shopCastId, $auth['shop_id']]);
    $sc = $stmt->fetch();
    if (!$sc) err('cast not found', 404);

    // 訪問者発言1件以上のセッションのみ表示（owner-inbox と同じ仕様、空セッションを除外）
    $stmt = $pdo->prepare(
        'SELECT s.id, s.session_token, s.status, s.blocked, s.started_at, s.last_activity_at, s.nickname,
                (SELECT message FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) AS last_message,
                (SELECT sender_type FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) AS last_sender,
                (SELECT sent_at FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) AS last_sent_at,
                (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) AS msg_count
         FROM chat_sessions s
         WHERE s.shop_id = ? AND s.cast_id = ?
           AND EXISTS (SELECT 1 FROM chat_messages WHERE session_id = s.id AND sender_type = "visitor")
         ORDER BY s.last_activity_at DESC
         LIMIT 30'
    );
    $stmt->execute([$auth['shop_id'], $sc['cast_id']]);
    $sessions = $stmt->fetchAll();

    ok([
        'cast' => ['id' => $sc['id'], 'display_name' => $sc['display_name']],
        'sessions' => $sessions,
    ]);
}

// GET: session_id=<chat_sessions.id> → そのセッションの全メッセージ (read-only)
function handleChatMessages() {
    $auth = requireAuth();
    requireCastEnabled($auth['shop_id']);
    $sessionId = (int)inp('session_id', 0);
    if ($sessionId <= 0) err('session_id required');

    $pdo = DB::conn();
    // セッションが自店舗 AND キャスト指名であることを確認 (店舗直通セッションは受信トレイ側で閲覧する)
    $stmt = $pdo->prepare(
        'SELECT s.id, s.nickname, s.status, s.started_at, s.last_activity_at,
                sc.display_name AS cast_name
         FROM chat_sessions s
         LEFT JOIN shop_casts sc ON sc.cast_id = s.cast_id AND sc.shop_id = s.shop_id
         WHERE s.id = ? AND s.shop_id = ? AND s.cast_id IS NOT NULL LIMIT 1'
    );
    $stmt->execute([$sessionId, $auth['shop_id']]);
    $sess = $stmt->fetch();
    if (!$sess) err('session not found', 404);

    $stmt = $pdo->prepare(
        'SELECT id, sender_type, message, source_lang, sent_at, read_at
         FROM chat_messages WHERE session_id = ? ORDER BY id ASC'
    );
    $stmt->execute([$sessionId]);
    $messages = $stmt->fetchAll();

    ok(['session' => $sess, 'messages' => $messages]);
}
