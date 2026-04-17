<?php
/**
 * chat-api.php — チャット機能 Phase 1 統合API
 *
 * Visitor actions (匿名ユーザー):
 *   start-session / send-message / poll-messages / shop-status
 *
 * Owner actions (店舗オーナー端末、device_token認証):
 *   verify-device / owner-inbox / owner-reply / toggle-online
 *   update-settings / get-templates / save-template / delete-template / block-visitor
 *
 * Owner bootstrap (shop-admin PHPセッション必須):
 *   register-device
 *
 * 有効化ゲート: shop_chat_status レコードが存在する shop のみ全機能有効
 */

require_once __DIR__ . '/db.php';

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

// ---- 入力取得 ----
$action = $_GET['action'] ?? $_POST['action'] ?? '';
$raw = file_get_contents('php://input');
$body = [];
if (!empty($raw)) {
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) $body = $decoded;
}

// ---- CORS ----
// 訪問者アクションはクロスオリジン埋め込み対応（外部CMS埋め込みウィジェット用）
// オーナー/管理アクションは yobuho.com + サブドメインのみ許可
$visitor_actions = ['start-session', 'send-message', 'poll-messages', 'shop-status', 'translate'];
$allowed_origins = [
    'https://yobuho.com',
    'https://deli.yobuho.com',
    'https://jofu.yobuho.com',
    'https://same.yobuho.com',
    'https://loveho.yobuho.com',
    'https://este.yobuho.com',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';

if (in_array($action, $visitor_actions, true)) {
    // 訪問者アクション: 任意のオリジン許可（credentials無しのため安全）
    if ($origin !== '') {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    } else {
        header('Access-Control-Allow-Origin: *');
    }
    // credentialsなしのため Allow-Credentials は送らない
} else {
    // オーナー/管理アクション: yobuho.com + サブドメインのみ、credentials必須
    if (in_array($origin, $allowed_origins, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
    } else {
        header('Access-Control-Allow-Origin: https://yobuho.com');
    }
    header('Access-Control-Allow-Credentials: true');
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
function inp(string $key, $default = null) {
    global $body;
    return $body[$key] ?? $_POST[$key] ?? $_GET[$key] ?? $default;
}
function ok($data = []) { echo json_encode(['ok' => true] + $data, JSON_UNESCAPED_UNICODE); exit; }
function err(string $msg, int $code = 400) {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

// =========================================================
// 共通ヘルパー
// =========================================================

function clientIp(): string {
    return $_SERVER['REMOTE_ADDR'] ?? '';
}

function visitorHash(): string {
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
    return hash('sha256', clientIp() . '|' . $ua);
}

function getShopBySlug(string $slug): ?array {
    $stmt = DB::conn()->prepare(
        'SELECT s.id, s.shop_name, s.slug, s.email, s.status, s.gender_mode,
                st.is_online, st.notify_mode, st.notify_min_interval_minutes, st.auto_off_minutes
         FROM shops s
         INNER JOIN shop_chat_status st ON st.shop_id = s.id
         WHERE s.slug = ? AND s.status = ? LIMIT 1'
    );
    $stmt->execute([$slug, 'active']);
    $row = $stmt->fetch();
    return $row ?: null;
}

function getShopById(string $shopId): ?array {
    $stmt = DB::conn()->prepare(
        'SELECT s.id, s.shop_name, s.slug, s.email,
                st.is_online, st.notify_mode, st.notify_min_interval_minutes
         FROM shops s
         INNER JOIN shop_chat_status st ON st.shop_id = s.id
         WHERE s.id = ? LIMIT 1'
    );
    $stmt->execute([$shopId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function verifyDevice(string $token): ?array {
    if ($token === '' || strlen($token) < 32) return null;
    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT d.shop_id, s.shop_name, s.slug, s.gender_mode
         FROM shop_chat_devices d
         INNER JOIN shops s ON s.id = d.shop_id
         INNER JOIN shop_chat_status st ON st.shop_id = d.shop_id
         WHERE d.device_token = ? LIMIT 1'
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch();
    if (!$row) return null;
    $pdo->prepare('UPDATE shop_chat_devices SET last_accessed_at = NOW() WHERE device_token = ?')
        ->execute([$token]);
    return $row;
}

function requireDevice(): array {
    $token = inp('device_token', '');
    $device = verifyDevice((string)$token);
    if (!$device) err('Invalid device token', 401);
    return $device;
}

function requireShopSession(): array {
    if (empty($_SESSION['shop_id'])) err('Unauthorized', 401);
    if (time() - ($_SESSION['last_activity'] ?? 0) > SHOP_SESSION_TIMEOUT) {
        session_destroy();
        err('Session expired', 401);
    }
    $_SESSION['last_activity'] = time();
    return ['shop_id' => $_SESSION['shop_id']];
}

// =========================================================
// 荒らし対策
// =========================================================

/**
 * メッセージの異常パターン検知
 * @return string|null エラー理由（正常ならnull）
 */
function detectSpam(string $msg, array $recentMessages): ?string {
    $trimmed = trim($msg);
    $len = mb_strlen($trimmed);

    if ($len === 0) return 'メッセージが空です';
    if ($len > 500) return 'メッセージが長すぎます（500文字以内）';

    // 1文字のみのメッセージ拒否（記号・絵文字のみも含む）
    if ($len < 2) return '2文字以上入力してください';

    // 同一文字の連続（「あああああ」「wwwww」などを弾く）
    // 4文字以上の同一文字連続があればスパム
    if (preg_match('/(.)\1{3,}/u', $trimmed)) {
        return '同じ文字の連続は送信できません';
    }

    // 直近メッセージとの類似判定（小変更連投対策）
    $normalized = preg_replace('/[\s、。,.!?！？]/u', '', $trimmed);
    $normalized = mb_strtolower($normalized);
    foreach ($recentMessages as $prev) {
        $prevNorm = preg_replace('/[\s、。,.!?！？]/u', '', (string)$prev);
        $prevNorm = mb_strtolower($prevNorm);
        if ($prevNorm === '' || $normalized === '') continue;
        // 完全一致 or 一方が他方に含まれる短文連投
        if ($prevNorm === $normalized) return '同じ内容の連投は送信できません';
        if (mb_strlen($normalized) <= 10 && mb_strlen($prevNorm) <= 10) {
            if (mb_strpos($normalized, $prevNorm) !== false || mb_strpos($prevNorm, $normalized) !== false) {
                return '似た内容の連投は送信できません';
            }
        }
    }

    return null;
}

/**
 * 送信レート制限（visitor側）
 * - 最小送信間隔: 3秒
 * - 1分あたり最大10メッセージ
 */
function checkVisitorRate(int $sessionId): ?string {
    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        "SELECT COUNT(*) AS recent_count,
                MAX(sent_at) AS last_sent
         FROM chat_messages
         WHERE session_id = ? AND sender_type = 'visitor'
           AND sent_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)"
    );
    $stmt->execute([$sessionId]);
    $row = $stmt->fetch();
    if ((int)$row['recent_count'] >= 10) return '送信頻度が速すぎます。少し時間を空けてから再度お試しください';
    if ($row['last_sent']) {
        $diff = time() - strtotime($row['last_sent']);
        if ($diff < 3) return '連続送信はできません（3秒以上お待ちください）';
    }
    return null;
}

/**
 * 日次セッション制限（visitor_hash単位）
 * 同一端末から24時間以内 5セッションまで
 */
function checkDailySessionLimit(string $shopId, string $visitorHash): ?string {
    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM chat_sessions
         WHERE shop_id = ? AND visitor_hash = ?
           AND started_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)'
    );
    $stmt->execute([$shopId, $visitorHash]);
    if ((int)$stmt->fetchColumn() >= 5) return '本日の相談回数上限に達しました';
    return null;
}

function isBlocked(string $shopId, string $visitorHash): bool {
    $stmt = DB::conn()->prepare('SELECT 1 FROM chat_blocks WHERE shop_id = ? AND visitor_hash = ? LIMIT 1');
    $stmt->execute([$shopId, $visitorHash]);
    return (bool)$stmt->fetchColumn();
}

// =========================================================
// メール通知（スロットリング内蔵）
// =========================================================

function sendChatNotification(string $shopId, int $sessionId, string $preview): void {
    $shop = getShopById($shopId);
    if (!$shop) return;
    if (empty($shop['email'])) return;
    $mode = $shop['notify_mode'] ?? 'first';
    if ($mode === 'off') return;

    $pdo = DB::conn();

    // オーナーがオンライン中ならメール通知スキップ（画面で見ている前提）
    if ((int)$shop['is_online'] === 1) return;

    // セッション取得
    $stmt = $pdo->prepare('SELECT notified_at, visitor_hash FROM chat_sessions WHERE id = ? LIMIT 1');
    $stmt->execute([$sessionId]);
    $session = $stmt->fetch();
    if (!$session) return;

    if ($mode === 'first') {
        // 初回のみ: このセッションで既に通知済みならスキップ
        if ($session['notified_at']) return;
    } elseif ($mode === 'every') {
        // 都度モード: 同セッションに対する前回通知から min_interval 分未経過ならスキップ
        if ($session['notified_at']) {
            $minInterval = max(1, (int)($shop['notify_min_interval_minutes'] ?? 3));
            $elapsed = time() - strtotime($session['notified_at']);
            if ($elapsed < $minInterval * 60) return;
        }
    }

    // メール送信
    $subject = '【YobuHo】新着チャット: ' . $shop['shop_name'];
    $chatUrl = 'https://yobuho.com/chat/' . rawurlencode((string)$shop['slug']) . '/?owner=1';
    $html = '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body style="margin:0;padding:16px;background:#fff;font-family:sans-serif;">';
    $html .= '<div style="max-width:520px;margin:0 auto;">';
    $html .= '<h2 style="color:#9b2d35;margin:0 0 16px;">新着チャットが届きました</h2>';
    $html .= '<p style="font-size:14px;line-height:1.8;color:#333;">店舗「' . htmlspecialchars($shop['shop_name'], ENT_QUOTES, 'UTF-8') . '」宛に、お客様からメッセージが届いています。</p>';
    $html .= '<div style="background:#f5f5f5;padding:12px;border-radius:6px;margin:16px 0;font-size:13px;line-height:1.6;color:#555;border-left:3px solid #9b2d35;">';
    $html .= nl2br(htmlspecialchars(mb_substr($preview, 0, 200), ENT_QUOTES, 'UTF-8'));
    $html .= '</div>';
    $html .= '<p style="margin:24px 0;"><a href="' . htmlspecialchars($chatUrl, ENT_QUOTES, 'UTF-8') . '" style="display:inline-block;padding:12px 24px;background:#9b2d35;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">ログインして返信する</a></p><p style="font-size:12px;color:#666;margin:8px 0;">※ リンクをクリックするとオーナーログイン画面が開きます</p>';
    $html .= '<p style="font-size:12px;color:#888;margin-top:24px;">通知設定は shop-admin &gt; チャット管理 から変更できます。</p>';
    $html .= '</div></body></html>';

    $plain = "店舗「{$shop['shop_name']}」宛に新着チャットが届きました。\n\n";
    $plain .= "内容: " . mb_substr($preview, 0, 200) . "\n\n";
    $plain .= "ログインして返信: " . $chatUrl . "\n";
    $plain .= "※ リンクをクリックするとオーナーログイン画面が開きます。\n";

    $boundary = '=_yobuho_' . md5(uniqid('', true));
    $mimeBody  = "This is a multi-part message in MIME format.\r\n\r\n";
    $mimeBody .= "--{$boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n";
    $mimeBody .= chunk_split(base64_encode($plain)) . "\r\n";
    $mimeBody .= "--{$boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n";
    $mimeBody .= chunk_split(base64_encode($html)) . "\r\n";
    $mimeBody .= "--{$boundary}--\r\n";

    $headers  = "From: YobuHo <hotel@yobuho.com>\r\n";
    $headers .= "Reply-To: hotel@yobuho.com\r\n";
    $headers .= "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n";

    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    @mail($shop['email'], $encodedSubject, $mimeBody, $headers, '-f hotel@yobuho.com');

    // 通知済みフラグ更新
    $pdo->prepare('UPDATE chat_sessions SET notified_at = NOW() WHERE id = ?')
        ->execute([$sessionId]);
}

// =========================================================
// ルーティング
// =========================================================

try {
    switch ($action) {
        // Visitor
        case 'start-session':   handleStartSession(); break;
        case 'send-message':    handleSendMessage(); break;
        case 'poll-messages':   handlePollMessages(); break;
        case 'shop-status':     handleShopStatus(); break;
        case 'translate':       handleTranslate(); break;

        // Owner (device_token auth)
        case 'verify-device':   handleVerifyDevice(); break;
        case 'owner-inbox':     handleOwnerInbox(); break;
        case 'owner-reply':     handleOwnerReply(); break;
        case 'toggle-online':   handleToggleOnline(); break;
        case 'update-settings': handleUpdateSettings(); break;
        case 'get-templates':   handleGetTemplates(); break;
        case 'save-template':   handleSaveTemplate(); break;
        case 'delete-template': handleDeleteTemplate(); break;
        case 'block-visitor':   handleBlockVisitor(); break;
        case 'unblock-visitor': handleUnblockVisitor(); break;

        // Owner bootstrap (PHPセッション認証)
        case 'register-device': handleRegisterDevice(); break;

        // Shop-admin actions (PHPセッション認証)
        case 'admin-overview':         handleAdminOverview(); break;
        case 'admin-toggle-online':    handleAdminToggleOnline(); break;
        case 'admin-save-settings':    handleAdminSaveSettings(); break;
        case 'admin-save-template':    handleAdminSaveTemplate(); break;
        case 'admin-delete-template':  handleAdminDeleteTemplate(); break;
        case 'admin-revoke-device':    handleAdminRevokeDevice(); break;
        case 'admin-unblock':          handleAdminUnblock(); break;

        default: err('Invalid action');
    }
} catch (Throwable $e) {
    error_log('[chat-api] ' . $e->getMessage());
    err('Internal error: ' . $e->getMessage(), 500);
}

// =========================================================
// Action handlers — Visitor
// =========================================================

function handleStartSession() {
    $slug = trim((string)inp('shop_slug', ''));
    $source = inp('source', 'standalone');
    if (!in_array($source, ['portal', 'widget', 'standalone'], true)) $source = 'standalone';
    if ($slug === '') err('shop_slug required');

    $shop = getShopBySlug($slug);
    if (!$shop) err('チャット機能は利用できません', 404);

    $vh = visitorHash();
    if (isBlocked($shop['id'], $vh)) err('この店舗への連絡は停止されています', 403);

    $limitErr = checkDailySessionLimit($shop['id'], $vh);
    if ($limitErr) err($limitErr, 429);

    $token = bin2hex(random_bytes(24));
    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'INSERT INTO chat_sessions (shop_id, session_token, visitor_hash, source) VALUES (?, ?, ?, ?)'
    );
    $stmt->execute([$shop['id'], $token, $vh, $source]);
    $sessionId = (int)$pdo->lastInsertId();

    ok([
        'session_token' => $token,
        'session_id'    => $sessionId,
        'shop_name'     => $shop['shop_name'],
        'is_online'     => (int)$shop['is_online'] === 1,
        'gender_mode'   => $shop['gender_mode'] ?? 'men',
    ]);
}

function handleSendMessage() {
    $token = (string)inp('session_token', '');
    $msg = (string)inp('message', '');
    $nick = trim((string)inp('nickname', ''));
    $lang = strtolower(substr((string)inp('lang', ''), 0, 5));
    $allowedLangs = ['ja','en','zh','ko'];
    if (!in_array($lang, $allowedLangs, true)) $lang = null;
    if (mb_strlen($nick) > 20) $nick = mb_substr($nick, 0, 20);
    if ($token === '') err('session_token required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id, shop_id, status, blocked, visitor_hash FROM chat_sessions WHERE session_token = ? LIMIT 1');
    $stmt->execute([$token]);
    $session = $stmt->fetch();
    if (!$session) err('Session not found', 404);
    if ($session['status'] === 'closed') err('このチャットは終了しています', 410);
    if ((int)$session['blocked'] === 1) err('この店舗への連絡は停止されています', 403);

    // 荒らし防止: 直近メッセージ取得
    $stmt = $pdo->prepare(
        "SELECT message FROM chat_messages
         WHERE session_id = ? AND sender_type = 'visitor'
         ORDER BY id DESC LIMIT 3"
    );
    $stmt->execute([$session['id']]);
    $recent = $stmt->fetchAll(PDO::FETCH_COLUMN);

    $spam = detectSpam($msg, $recent);
    if ($spam) err($spam);

    $rateErr = checkVisitorRate((int)$session['id']);
    if ($rateErr) err($rateErr, 429);

    $stmt = $pdo->prepare("INSERT INTO chat_messages (session_id, sender_type, message, source_lang) VALUES (?, 'visitor', ?, ?)");
    $stmt->execute([$session['id'], trim($msg), $lang]);
    $messageId = (int)$pdo->lastInsertId();

    if ($nick !== '') {
        $pdo->prepare('UPDATE chat_sessions SET last_activity_at = NOW(), nickname = ? WHERE id = ?')
            ->execute([$nick, $session['id']]);
    } else {
        $pdo->prepare('UPDATE chat_sessions SET last_activity_at = NOW() WHERE id = ?')
            ->execute([$session['id']]);
    }

    // メール通知（スロットリング内蔵）
    sendChatNotification($session['shop_id'], (int)$session['id'], trim($msg));

    ok(['message_id' => $messageId]);
}

function handlePollMessages() {
    $token = (string)inp('session_token', '');
    $sinceId = (int)inp('since_id', 0);
    if ($token === '') err('session_token required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id, shop_id, status FROM chat_sessions WHERE session_token = ? LIMIT 1');
    $stmt->execute([$token]);
    $session = $stmt->fetch();
    if (!$session) err('Session not found', 404);

    $stmt = $pdo->prepare(
        'SELECT id, sender_type, message, source_lang, sent_at
         FROM chat_messages
         WHERE session_id = ? AND id > ?
         ORDER BY id ASC'
    );
    $stmt->execute([$session['id'], $sinceId]);
    $messages = $stmt->fetchAll();

    // shop側メッセージを既読に
    if (count($messages) > 0) {
        $pdo->prepare("UPDATE chat_messages SET read_at = NOW()
                       WHERE session_id = ? AND sender_type = 'shop' AND read_at IS NULL AND id > ?")
            ->execute([$session['id'], $sinceId]);
    }

    // ショップのオンライン状態
    $stmt = $pdo->prepare('SELECT is_online FROM shop_chat_status WHERE shop_id = ?');
    $stmt->execute([$session['shop_id']]);
    $shopOnline = (int)$stmt->fetchColumn() === 1;

    // 訪問者の自メッセージのうち shop が既読した最大ID
    $stmt = $pdo->prepare("SELECT COALESCE(MAX(id),0) FROM chat_messages
                           WHERE session_id = ? AND sender_type = 'visitor' AND read_at IS NOT NULL");
    $stmt->execute([$session['id']]);
    $lastReadOwnId = (int)$stmt->fetchColumn();

    ok([
        'messages' => $messages,
        'shop_online' => $shopOnline,
        'status' => $session['status'],
        'last_read_own_id' => $lastReadOwnId,
    ]);
}

function handleShopStatus() {
    $slug = trim((string)inp('shop_slug', ''));
    if ($slug === '') err('shop_slug required');
    $shop = getShopBySlug($slug);
    if (!$shop) {
        ok(['chat_enabled' => false]);
    }
    ok([
        'chat_enabled' => true,
        'is_online'    => (int)$shop['is_online'] === 1,
        'shop_name'    => $shop['shop_name'],
        'gender_mode'  => $shop['gender_mode'] ?? 'men',
    ]);
}

// =========================================================
// Action handlers — Owner
// =========================================================

function handleRegisterDevice() {
    $auth = requireShopSession();
    // 有効化ゲート: shop_chat_status レコードあるか確認
    $stmt = DB::conn()->prepare('SELECT 1 FROM shop_chat_status WHERE shop_id = ?');
    $stmt->execute([$auth['shop_id']]);
    if (!$stmt->fetchColumn()) err('チャット機能が有効化されていません', 403);

    $deviceName = trim((string)inp('device_name', ''));
    if (mb_strlen($deviceName) > 100) $deviceName = mb_substr($deviceName, 0, 100);

    $token = bin2hex(random_bytes(48));
    $stmt = DB::conn()->prepare(
        'INSERT INTO shop_chat_devices (shop_id, device_token, device_name) VALUES (?, ?, ?)'
    );
    $stmt->execute([$auth['shop_id'], $token, $deviceName ?: null]);

    ok(['device_token' => $token]);
}

function handleVerifyDevice() {
    $token = (string)inp('device_token', '');
    $device = verifyDevice($token);
    if (!$device) err('Invalid device token', 401);
    ok([
        'shop_id'     => $device['shop_id'],
        'shop_name'   => $device['shop_name'],
        'slug'        => $device['slug'],
        'gender_mode' => $device['gender_mode'] ?? 'men',
    ]);
}

function handleOwnerInbox() {
    $device = requireDevice();
    $sessionId = (int)inp('session_id', 0);
    $pdo = DB::conn();

    // セッション一覧（直近30件、クローズ含む）
    $stmt = $pdo->prepare(
        'SELECT s.id, s.session_token, s.status, s.blocked, s.started_at, s.last_activity_at, s.visitor_hash, s.nickname,
                (SELECT message FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) AS last_message,
                (SELECT sender_type FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) AS last_sender,
                (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id AND sender_type = "visitor" AND read_at IS NULL) AS unread_count
         FROM chat_sessions s
         WHERE s.shop_id = ?
         ORDER BY s.last_activity_at DESC
         LIMIT 30'
    );
    $stmt->execute([$device['shop_id']]);
    $sessions = $stmt->fetchAll();

    $response = ['sessions' => $sessions];

    // 特定セッションのメッセージも返す（指定時）
    if ($sessionId > 0) {
        $stmt = $pdo->prepare('SELECT id, visitor_hash FROM chat_sessions WHERE id = ? AND shop_id = ? LIMIT 1');
        $stmt->execute([$sessionId, $device['shop_id']]);
        $sessRow = $stmt->fetch();
        if ($sessRow) {
            $stmt = $pdo->prepare(
                'SELECT id, sender_type, message, source_lang, sent_at
                 FROM chat_messages WHERE session_id = ? ORDER BY id ASC'
            );
            $stmt->execute([$sessionId]);
            $response['messages'] = $stmt->fetchAll();

            // この visitor がブロック中かどうか
            $stmt = $pdo->prepare('SELECT 1 FROM chat_blocks WHERE shop_id = ? AND visitor_hash = ? LIMIT 1');
            $stmt->execute([$device['shop_id'], $sessRow['visitor_hash']]);
            $response['is_blocked'] = (bool)$stmt->fetchColumn();

            // ショップ自メッセージのうち visitor が既読した最大ID（オーナー表示用）
            $stmt = $pdo->prepare("SELECT COALESCE(MAX(id),0) FROM chat_messages
                                   WHERE session_id = ? AND sender_type = 'shop' AND read_at IS NOT NULL");
            $stmt->execute([$sessionId]);
            $response['last_read_own_id'] = (int)$stmt->fetchColumn();

            // visitor側メッセージを既読に
            $pdo->prepare("UPDATE chat_messages SET read_at = NOW()
                           WHERE session_id = ? AND sender_type = 'visitor' AND read_at IS NULL")
                ->execute([$sessionId]);
        }
    }

    ok($response);
}

function handleOwnerReply() {
    $device = requireDevice();
    $sessionId = (int)inp('session_id', 0);
    $msg = trim((string)inp('message', ''));
    if ($sessionId <= 0) err('session_id required');
    if ($msg === '') err('message required');
    if (mb_strlen($msg) > 1000) err('メッセージが長すぎます');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id, status FROM chat_sessions WHERE id = ? AND shop_id = ? LIMIT 1');
    $stmt->execute([$sessionId, $device['shop_id']]);
    $session = $stmt->fetch();
    if (!$session) err('Session not found', 404);
    if ($session['status'] === 'closed') err('Session closed', 410);

    $stmt = $pdo->prepare("INSERT INTO chat_messages (session_id, sender_type, message, source_lang) VALUES (?, 'shop', ?, 'ja')");
    $stmt->execute([$sessionId, $msg]);
    $messageId = (int)$pdo->lastInsertId();

    $pdo->prepare('UPDATE chat_sessions SET last_activity_at = NOW() WHERE id = ?')
        ->execute([$sessionId]);

    ok(['message_id' => $messageId]);
}

function handleTranslate() {
    $text = trim((string)inp('text', ''));
    $from = strtolower(substr((string)inp('from', ''), 0, 5));
    $to   = strtolower(substr((string)inp('to', 'ja'), 0, 5));
    $allowed = ['ja','en','zh','ko'];
    if ($text === '') err('text required');
    if (mb_strlen($text) > 500) $text = mb_substr($text, 0, 500);
    if (!in_array($from, $allowed, true) || !in_array($to, $allowed, true)) err('invalid lang');
    if ($from === $to) { ok(['translated' => $text, 'cached' => false]); return; }

    $pdo = DB::conn();
    $cacheKey = md5($from . '|' . $to . '|' . $text);
    $stmt = $pdo->prepare('SELECT translated FROM chat_translations WHERE cache_key = ? LIMIT 1');
    $stmt->execute([$cacheKey]);
    $cached = $stmt->fetchColumn();
    if ($cached !== false && $cached !== null) {
        ok(['translated' => $cached, 'cached' => true]);
        return;
    }

    // MyMemory API (free tier: 5000 chars/day anonymous)
    // Map zh → zh-CN for MyMemory
    $fromMm = $from === 'zh' ? 'zh-CN' : $from;
    $toMm   = $to   === 'zh' ? 'zh-CN' : $to;
    $url = 'https://api.mymemory.translated.net/get?q=' . urlencode($text)
         . '&langpair=' . urlencode($fromMm . '|' . $toMm);

    $ctx = stream_context_create([
        'http' => ['timeout' => 6, 'ignore_errors' => true, 'user_agent' => 'yobuho-chat/1.0'],
        'https' => ['timeout' => 6, 'ignore_errors' => true, 'user_agent' => 'yobuho-chat/1.0']
    ]);
    $resp = @file_get_contents($url, false, $ctx);
    if ($resp === false) err('Translation service unreachable', 502);
    $data = json_decode($resp, true);
    $translated = isset($data['responseData']['translatedText']) ? (string)$data['responseData']['translatedText'] : '';
    if ($translated === '' || $translated === $text) err('Translation failed', 502);

    $pdo->prepare('INSERT IGNORE INTO chat_translations (cache_key, src_lang, dst_lang, src_text, translated) VALUES (?, ?, ?, ?, ?)')
        ->execute([$cacheKey, $from, $to, $text, $translated]);

    ok(['translated' => $translated, 'cached' => false]);
}

function handleToggleOnline() {
    $device = requireDevice();
    $isOnline = (int)inp('is_online', 0) === 1 ? 1 : 0;
    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'UPDATE shop_chat_status SET is_online = ?, last_online_at = IF(? = 1, NOW(), last_online_at) WHERE shop_id = ?'
    );
    $stmt->execute([$isOnline, $isOnline, $device['shop_id']]);
    ok(['is_online' => $isOnline === 1]);
}

function handleUpdateSettings() {
    $device = requireDevice();
    $mode = (string)inp('notify_mode', 'first');
    if (!in_array($mode, ['first', 'every', 'off'], true)) err('invalid notify_mode');
    $interval = max(1, min(60, (int)inp('notify_min_interval_minutes', 3)));
    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'UPDATE shop_chat_status SET notify_mode = ?, notify_min_interval_minutes = ? WHERE shop_id = ?'
    );
    $stmt->execute([$mode, $interval, $device['shop_id']]);
    ok(['notify_mode' => $mode, 'notify_min_interval_minutes' => $interval]);
}

function handleGetTemplates() {
    $device = requireDevice();
    $stmt = DB::conn()->prepare(
        'SELECT id, title, content, sort_order FROM shop_chat_templates
         WHERE shop_id = ? ORDER BY sort_order ASC, id ASC'
    );
    $stmt->execute([$device['shop_id']]);
    ok(['templates' => $stmt->fetchAll()]);
}

function handleSaveTemplate() {
    $device = requireDevice();
    $id = (int)inp('id', 0);
    $title = trim((string)inp('title', ''));
    $content = trim((string)inp('content', ''));
    $sortOrder = max(0, min(9999, (int)inp('sort_order', 100)));
    if ($title === '' || $content === '') err('title and content required');
    if (mb_strlen($title) > 100 || mb_strlen($content) > 500) err('長すぎます');

    $pdo = DB::conn();
    if ($id > 0) {
        $stmt = $pdo->prepare('SELECT id FROM shop_chat_templates WHERE id = ? AND shop_id = ?');
        $stmt->execute([$id, $device['shop_id']]);
        if (!$stmt->fetchColumn()) err('Template not found', 404);
        $pdo->prepare('UPDATE shop_chat_templates SET title = ?, content = ?, sort_order = ? WHERE id = ?')
            ->execute([$title, $content, $sortOrder, $id]);
        ok(['id' => $id]);
    } else {
        $pdo->prepare('INSERT INTO shop_chat_templates (shop_id, title, content, sort_order) VALUES (?, ?, ?, ?)')
            ->execute([$device['shop_id'], $title, $content, $sortOrder]);
        ok(['id' => (int)$pdo->lastInsertId()]);
    }
}

function handleDeleteTemplate() {
    $device = requireDevice();
    $id = (int)inp('id', 0);
    if ($id <= 0) err('id required');
    $pdo = DB::conn();
    $stmt = $pdo->prepare('DELETE FROM shop_chat_templates WHERE id = ? AND shop_id = ?');
    $stmt->execute([$id, $device['shop_id']]);
    ok(['deleted' => $stmt->rowCount()]);
}

function handleBlockVisitor() {
    $device = requireDevice();
    $sessionId = (int)inp('session_id', 0);
    $reason = trim((string)inp('reason', ''));
    if (mb_strlen($reason) > 255) $reason = mb_substr($reason, 0, 255);
    if ($sessionId <= 0) err('session_id required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT visitor_hash FROM chat_sessions WHERE id = ? AND shop_id = ? LIMIT 1');
    $stmt->execute([$sessionId, $device['shop_id']]);
    $vh = $stmt->fetchColumn();
    if (!$vh) err('Session not found', 404);

    $pdo->prepare(
        'INSERT IGNORE INTO chat_blocks (shop_id, visitor_hash, reason) VALUES (?, ?, ?)'
    )->execute([$device['shop_id'], $vh, $reason ?: null]);

    // このセッションを closed + blocked に
    $pdo->prepare("UPDATE chat_sessions SET blocked = 1, status = 'closed', closed_at = NOW()
                   WHERE id = ? AND shop_id = ?")
        ->execute([$sessionId, $device['shop_id']]);

    ok(['blocked' => true]);
}

function handleUnblockVisitor() {
    $device = requireDevice();
    $sessionId = (int)inp('session_id', 0);
    if ($sessionId <= 0) err('session_id required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT visitor_hash FROM chat_sessions WHERE id = ? AND shop_id = ? LIMIT 1');
    $stmt->execute([$sessionId, $device['shop_id']]);
    $vh = $stmt->fetchColumn();
    if (!$vh) err('Session not found', 404);

    $pdo->prepare('DELETE FROM chat_blocks WHERE shop_id = ? AND visitor_hash = ?')
        ->execute([$device['shop_id'], $vh]);

    $pdo->prepare("UPDATE chat_sessions SET blocked = 0, status = 'active', closed_at = NULL
                   WHERE shop_id = ? AND visitor_hash = ?")
        ->execute([$device['shop_id'], $vh]);

    ok(['blocked' => false]);
}

// =========================================================
// Action handlers — Shop-admin (PHPセッション認証)
// =========================================================

function handleAdminOverview() {
    $auth = requireShopSession();
    $shopId = $auth['shop_id'];
    $pdo = DB::conn();

    // 有効化状態取得
    $stmt = $pdo->prepare(
        'SELECT s.slug, s.shop_name,
                st.is_online, st.notify_mode, st.notify_min_interval_minutes, st.last_online_at
         FROM shops s
         LEFT JOIN shop_chat_status st ON st.shop_id = s.id
         WHERE s.id = ? LIMIT 1'
    );
    $stmt->execute([$shopId]);
    $row = $stmt->fetch();
    $enabled = !empty($row['notify_mode']);

    $templates = [];
    $devices = [];
    $blocks = [];

    if ($enabled) {
        $stmt = $pdo->prepare(
            'SELECT id, title, content, sort_order FROM shop_chat_templates
             WHERE shop_id = ? ORDER BY sort_order ASC, id ASC'
        );
        $stmt->execute([$shopId]);
        $templates = $stmt->fetchAll();

        $stmt = $pdo->prepare(
            'SELECT id, device_name, last_accessed_at, created_at
             FROM shop_chat_devices WHERE shop_id = ? ORDER BY id DESC'
        );
        $stmt->execute([$shopId]);
        $devices = $stmt->fetchAll();

        $stmt = $pdo->prepare(
            'SELECT b.id, b.visitor_hash, b.reason, b.created_at,
                    (SELECT cs.id FROM chat_sessions cs WHERE cs.shop_id = b.shop_id AND cs.visitor_hash = b.visitor_hash ORDER BY cs.id DESC LIMIT 1) AS session_id,
                    (SELECT cs.nickname FROM chat_sessions cs WHERE cs.shop_id = b.shop_id AND cs.visitor_hash = b.visitor_hash ORDER BY cs.id DESC LIMIT 1) AS nickname,
                    (SELECT cm.message FROM chat_messages cm
                       WHERE cm.session_id = (SELECT cs2.id FROM chat_sessions cs2 WHERE cs2.shop_id = b.shop_id AND cs2.visitor_hash = b.visitor_hash ORDER BY cs2.id DESC LIMIT 1)
                         AND cm.sender_type = "visitor" ORDER BY cm.id DESC LIMIT 1) AS last_message
             FROM chat_blocks b
             WHERE b.shop_id = ? ORDER BY b.id DESC LIMIT 200'
        );
        $stmt->execute([$shopId]);
        $blocks = $stmt->fetchAll();
    }

    ok([
        'enabled'    => $enabled,
        'slug'       => $row['slug'] ?? '',
        'shop_name'  => $row['shop_name'] ?? '',
        'is_online'  => $enabled ? ((int)$row['is_online'] === 1) : false,
        'notify_mode'=> $row['notify_mode'] ?? 'first',
        'notify_min_interval_minutes' => (int)($row['notify_min_interval_minutes'] ?? 3),
        'last_online_at' => $row['last_online_at'] ?? null,
        'templates'  => $templates,
        'devices'    => $devices,
        'blocks'     => $blocks,
    ]);
}

function handleAdminToggleOnline() {
    $auth = requireShopSession();
    $isOnline = (int)inp('is_online', 0) === 1 ? 1 : 0;
    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT 1 FROM shop_chat_status WHERE shop_id = ?'
    );
    $stmt->execute([$auth['shop_id']]);
    if (!$stmt->fetchColumn()) err('チャット機能が有効化されていません', 403);

    $pdo->prepare(
        'UPDATE shop_chat_status SET is_online = ?, last_online_at = IF(? = 1, NOW(), last_online_at) WHERE shop_id = ?'
    )->execute([$isOnline, $isOnline, $auth['shop_id']]);
    ok(['is_online' => $isOnline === 1]);
}

function handleAdminSaveSettings() {
    $auth = requireShopSession();
    $mode = (string)inp('notify_mode', 'first');
    if (!in_array($mode, ['first', 'every', 'off'], true)) err('invalid notify_mode');
    $interval = max(1, min(60, (int)inp('notify_min_interval_minutes', 3)));
    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'UPDATE shop_chat_status SET notify_mode = ?, notify_min_interval_minutes = ? WHERE shop_id = ?'
    );
    $stmt->execute([$mode, $interval, $auth['shop_id']]);
    ok(['notify_mode' => $mode, 'notify_min_interval_minutes' => $interval]);
}

function handleAdminSaveTemplate() {
    $auth = requireShopSession();
    $id = (int)inp('id', 0);
    $title = trim((string)inp('title', ''));
    $content = trim((string)inp('content', ''));
    $sortOrder = max(0, min(9999, (int)inp('sort_order', 100)));
    if ($title === '' || $content === '') err('title and content required');
    if (mb_strlen($title) > 100 || mb_strlen($content) > 500) err('長すぎます');

    $pdo = DB::conn();
    if ($id > 0) {
        $stmt = $pdo->prepare('SELECT id FROM shop_chat_templates WHERE id = ? AND shop_id = ?');
        $stmt->execute([$id, $auth['shop_id']]);
        if (!$stmt->fetchColumn()) err('Template not found', 404);
        $pdo->prepare('UPDATE shop_chat_templates SET title = ?, content = ?, sort_order = ? WHERE id = ?')
            ->execute([$title, $content, $sortOrder, $id]);
        ok(['id' => $id]);
    } else {
        $pdo->prepare('INSERT INTO shop_chat_templates (shop_id, title, content, sort_order) VALUES (?, ?, ?, ?)')
            ->execute([$auth['shop_id'], $title, $content, $sortOrder]);
        ok(['id' => (int)$pdo->lastInsertId()]);
    }
}

function handleAdminDeleteTemplate() {
    $auth = requireShopSession();
    $id = (int)inp('id', 0);
    if ($id <= 0) err('id required');
    $pdo = DB::conn();
    $stmt = $pdo->prepare('DELETE FROM shop_chat_templates WHERE id = ? AND shop_id = ?');
    $stmt->execute([$id, $auth['shop_id']]);
    ok(['deleted' => $stmt->rowCount()]);
}

function handleAdminRevokeDevice() {
    $auth = requireShopSession();
    $id = (int)inp('id', 0);
    if ($id <= 0) err('id required');
    $pdo = DB::conn();
    $stmt = $pdo->prepare('DELETE FROM shop_chat_devices WHERE id = ? AND shop_id = ?');
    $stmt->execute([$id, $auth['shop_id']]);
    ok(['deleted' => $stmt->rowCount()]);
}

function handleAdminUnblock() {
    $auth = requireShopSession();
    $id = (int)inp('id', 0);
    if ($id <= 0) err('id required');
    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT visitor_hash FROM chat_blocks WHERE id = ? AND shop_id = ?');
    $stmt->execute([$id, $auth['shop_id']]);
    $vh = $stmt->fetchColumn();
    $stmt = $pdo->prepare('DELETE FROM chat_blocks WHERE id = ? AND shop_id = ?');
    $stmt->execute([$id, $auth['shop_id']]);
    if ($vh) {
        $pdo->prepare("UPDATE chat_sessions SET blocked = 0, status = 'active', closed_at = NULL
                       WHERE shop_id = ? AND visitor_hash = ?")
            ->execute([$auth['shop_id'], $vh]);
    }
    ok(['deleted' => $stmt->rowCount()]);
}
