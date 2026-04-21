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
$raw = file_get_contents('php://input');
$body = [];
if (!empty($raw)) {
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) $body = $decoded;
}
$action = $_GET['action'] ?? $_POST['action'] ?? ($body['action'] ?? '');

// ---- CORS ----
// 訪問者アクションはクロスオリジン埋め込み対応（外部CMS埋め込みウィジェット用）
// オーナー/管理アクションは yobuho.com + サブドメインのみ許可
$visitor_actions = ['start-session', 'send-message', 'poll-messages', 'shop-status', 'translate', 'can-connect'];
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

/**
 * DO-Ready 統一バッチレスポンス.
 * WebSocket push時も同じ形状をサーバーがブロードキャストできるよう、全エンドポイントが
 * この形状 (messages[], status, shop_online, last_read_own_id, server_time) を返す.
 * 余剰フィールド (sessions, is_blocked 等) は merge して返す.
 */
function okBatch(array $extra = []): void {
    $payload = [
        'ok' => true,
        'messages' => $extra['messages'] ?? [],
        'status' => $extra['status'] ?? null,
        'shop_online' => $extra['shop_online'] ?? null,
        'last_read_own_id' => $extra['last_read_own_id'] ?? 0,
        'server_time' => gmdate('c'),
    ];
    foreach ($extra as $k => $v) {
        if (!array_key_exists($k, $payload)) $payload[$k] = $v;
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * UUID v4 形式を緩く検証 (36文字 hex/hyphen). クライアント生成のclient_msg_id用.
 */
function isValidClientMsgId($id): bool {
    if (!is_string($id) || strlen($id) !== 36) return false;
    return (bool)preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $id);
}
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
                st.is_online, st.last_online_at, st.notify_mode, st.notify_min_interval_minutes, st.auto_off_minutes,
                st.reception_start, st.reception_end, st.welcome_message, st.reservation_hint, st.notify_email
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
                st.is_online, st.last_online_at, st.notify_mode, st.notify_min_interval_minutes, st.auto_off_minutes,
                st.reception_start, st.reception_end, st.welcome_message, st.reservation_hint, st.notify_email
         FROM shops s
         INNER JOIN shop_chat_status st ON st.shop_id = s.id
         WHERE s.id = ? LIMIT 1'
    );
    $stmt->execute([$shopId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * 実効オンライン判定: is_online=1 のみで判定 (A案/厳格2値ルール)
 * 時間帯制御は受付時間 (reception_start/end) 側で行う。
 * last_online_at は診断用のまま残すが 🟢 表示/メール通知の判定には使わない。
 */
function effectiveOnline(?array $shop): bool {
    if (!$shop) return false;
    return (int)($shop['is_online'] ?? 0) === 1;
}

/**
 * 受付時間内判定. start/end が両方 NULL なら 24時間受付 (true).
 * start == end も 24時間扱い. start > end は日跨ぎ営業 (例 18:00-05:00).
 */
function isWithinReceptionHours(?array $shop, ?int $nowTs = null): bool {
    if (!$shop) return true;
    $start = $shop['reception_start'] ?? null;
    $end   = $shop['reception_end']   ?? null;
    if (empty($start) || empty($end) || $start === $end) return true;

    $tz = new DateTimeZone('Asia/Tokyo');
    $now = new DateTimeImmutable('@' . ($nowTs ?? time()));
    $now = $now->setTimezone($tz);
    $hm = (int)$now->format('H') * 60 + (int)$now->format('i');

    $toMin = function (string $t): int {
        $p = explode(':', $t);
        return ((int)$p[0]) * 60 + ((int)($p[1] ?? 0));
    };
    $s = $toMin((string)$start);
    $e = $toMin((string)$end);

    if ($s < $e) {
        return $hm >= $s && $hm < $e;
    }
    // 日跨ぎ (例 18:00 - 05:00)
    return $hm >= $s || $hm < $e;
}

/**
 * 次回受付開始時刻を ISO8601 (Asia/Tokyo) で返す. 24時間受付 or 現在受付中なら null.
 */
function nextReceptionStart(?array $shop, ?int $nowTs = null): ?string {
    if (!$shop) return null;
    $start = $shop['reception_start'] ?? null;
    $end   = $shop['reception_end']   ?? null;
    if (empty($start) || empty($end) || $start === $end) return null;
    if (isWithinReceptionHours($shop, $nowTs)) return null;

    $tz = new DateTimeZone('Asia/Tokyo');
    $now = new DateTimeImmutable('@' . ($nowTs ?? time()));
    $now = $now->setTimezone($tz);
    $today = $now->setTime((int)substr($start, 0, 2), (int)substr($start, 3, 2), 0);
    if ($today > $now) return $today->format(DateTimeInterface::ATOM);
    return $today->modify('+1 day')->format(DateTimeInterface::ATOM);
}

/**
 * オーナーheartbeat: 操作毎に is_online=1, last_online_at=NOW() に更新
 */
function ownerHeartbeat(string $shopId): void {
    // notify_mode='off' (オーナーが受付OFFにした) の時は自動で is_online=1 に戻さない
    DB::conn()->prepare(
        "UPDATE shop_chat_status
         SET is_online = IF(notify_mode = 'off', 0, 1),
             last_online_at = IF(notify_mode = 'off', last_online_at, NOW())
         WHERE shop_id = ?"
    )->execute([$shopId]);
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
    $notifyTo = !empty($shop['notify_email']) ? $shop['notify_email'] : ($shop['email'] ?? '');
    if (empty($notifyTo)) return;
    $mode = $shop['notify_mode'] ?? 'first';
    if ($mode === 'off') return;

    // 受付時間外はメール送信しない（時間帯制御は受付時間に委ねるルール）
    if (!isWithinReceptionHours($shop)) return;

    $pdo = DB::conn();

    // A案 (厳格2値ルール): トグル ON の間はオーナーが画面を見ていてもメール送信する。

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
    $subject = '【YobuChat】新着メッセージ: ' . $shop['shop_name'];
    // 店舗管理画面のチャットタブへ直接誘導（shop-admin にログイン済みならそのまま返信可能）
    $chatUrl = 'https://yobuho.com/shop-admin.html#chat';
    $html = '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body style="margin:0;padding:16px;background:#fff;font-family:sans-serif;">';
    $html .= '<div style="max-width:520px;margin:0 auto;">';
    $html .= '<h2 style="color:#9b2d35;margin:0 0 16px;">YobuChat 新着メッセージ</h2>';
    $html .= '<p style="font-size:14px;line-height:1.8;color:#333;">店舗「' . htmlspecialchars($shop['shop_name'], ENT_QUOTES, 'UTF-8') . '」宛に、お客様からメッセージが届いています。</p>';
    $html .= '<div style="background:#f5f5f5;padding:12px;border-radius:6px;margin:16px 0;font-size:13px;line-height:1.6;color:#555;border-left:3px solid #9b2d35;">';
    $html .= nl2br(htmlspecialchars(mb_substr($preview, 0, 200), ENT_QUOTES, 'UTF-8'));
    $html .= '</div>';
    $html .= '<p style="margin:24px 0;"><a href="' . htmlspecialchars($chatUrl, ENT_QUOTES, 'UTF-8') . '" style="display:inline-block;padding:12px 24px;background:#9b2d35;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">チャットを開いて返信する</a></p><p style="font-size:12px;color:#666;margin:8px 0;">※ 店舗管理画面のチャットタブが開きます（未ログインの場合はログイン画面へ）</p>';
    $html .= '<p style="font-size:12px;color:#888;margin-top:24px;">通知設定は 店舗管理画面 &gt; YobuChat から変更できます。</p>';
    $html .= '</div></body></html>';

    $plain = "店舗「{$shop['shop_name']}」宛に新着チャットが届きました。\n\n";
    $plain .= "内容: " . mb_substr($preview, 0, 200) . "\n\n";
    $plain .= "チャットを開いて返信: " . $chatUrl . "\n";
    $plain .= "※ 店舗管理画面のチャットタブが開きます（未ログインの場合はログイン画面へ）。\n";

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
    @mail($notifyTo, $encodedSubject, $mimeBody, $headers, '-f hotel@yobuho.com');

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
        case 'can-connect':     handleCanConnect(); break;
        case 'translate':       handleTranslate(); break;

        // Owner (device_token auth)
        case 'verify-device':   handleVerifyDevice(); break;
        case 'owner-inbox':     handleOwnerInbox(); break;
        case 'owner-reply':     handleOwnerReply(); break;
        case 'toggle-online':   handleToggleOnline(); break;
        case 'toggle-notify':   handleToggleNotify(); break;
        case 'owner-go-offline': handleOwnerGoOffline(); break;
        case 'update-settings': handleUpdateSettings(); break;
        case 'get-templates':   handleGetTemplates(); break;
        case 'save-template':   handleSaveTemplate(); break;
        case 'delete-template': handleDeleteTemplate(); break;
        case 'block-visitor':   handleBlockVisitor(); break;
        case 'unblock-visitor': handleUnblockVisitor(); break;
        case 'close-session':   handleCloseSession(); break;
        case 'owner-logout':    handleOwnerLogout(); break;

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
    if (!$shop) err('YobuChatは利用できません', 404);

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
        'is_online'     => effectiveOnline($shop),
        'gender_mode'   => $shop['gender_mode'] ?? 'men',
    ]);
}

function handleSendMessage() {
    $token = (string)inp('session_token', '');
    $msg = (string)inp('message', '');
    $nick = trim((string)inp('nickname', ''));
    $lang = strtolower(substr((string)inp('lang', ''), 0, 5));
    $clientMsgId = (string)inp('client_msg_id', '');
    $sinceId = (int)inp('since_id', 0);
    $allowedLangs = ['ja','en','zh','ko'];
    if (!in_array($lang, $allowedLangs, true)) $lang = null;
    if (mb_strlen($nick) > 20) $nick = mb_substr($nick, 0, 20);
    if ($token === '') err('session_token required');
    if ($clientMsgId !== '' && !isValidClientMsgId($clientMsgId)) err('invalid client_msg_id');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id, shop_id, status, blocked, visitor_hash FROM chat_sessions WHERE session_token = ? LIMIT 1');
    $stmt->execute([$token]);
    $session = $stmt->fetch();
    if (!$session) err('Session not found', 404);
    if ($session['status'] === 'closed') err('このチャットは終了しています', 410);
    if ((int)$session['blocked'] === 1) err('この店舗への連絡は停止されています', 403);

    // 冪等送信: 同じ client_msg_id で過去に送信済みなら、再挿入せず既存を返す.
    // WS再接続中のネットワーク再送でも重複行が作られない.
    if ($clientMsgId !== '') {
        $stmt = $pdo->prepare(
            'SELECT id FROM chat_messages
             WHERE client_msg_id = ? AND session_id = ? AND sender_type = ? LIMIT 1'
        );
        $stmt->execute([$clientMsgId, $session['id'], 'visitor']);
        $existingId = $stmt->fetchColumn();
        if ($existingId) {
            // 既存行. unified batch でクライアント側に反映.
            respondSessionBatch($pdo, (int)$session['id'], $session['shop_id'], $sinceId, (int)$session['status'] === 'closed' ? 'closed' : 'open', ['message_id' => (int)$existingId, 'client_msg_id' => $clientMsgId, 'duplicate' => true]);
            return;
        }
    }

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

    // client_msg_id を同時INSERT. UNIQUE制約違反 = 並行リクエストでの重複送信.
    try {
        $stmt = $pdo->prepare("INSERT INTO chat_messages (session_id, sender_type, message, source_lang, client_msg_id) VALUES (?, 'visitor', ?, ?, ?)");
        $stmt->execute([$session['id'], trim($msg), $lang, $clientMsgId ?: null]);
        $messageId = (int)$pdo->lastInsertId();
    } catch (PDOException $e) {
        // UNIQUE違反 (1062) = 並行重複送信 → 既存を返す
        if ($clientMsgId !== '' && strpos($e->getMessage(), '1062') !== false) {
            $stmt = $pdo->prepare('SELECT id FROM chat_messages WHERE client_msg_id = ? LIMIT 1');
            $stmt->execute([$clientMsgId]);
            $messageId = (int)$stmt->fetchColumn();
            if (!$messageId) throw $e;
        } else {
            throw $e;
        }
    }

    if ($nick !== '') {
        $pdo->prepare('UPDATE chat_sessions SET last_activity_at = NOW(), last_visitor_heartbeat_at = NOW(), nickname = ? WHERE id = ?')
            ->execute([$nick, $session['id']]);
    } else {
        $pdo->prepare('UPDATE chat_sessions SET last_activity_at = NOW(), last_visitor_heartbeat_at = NOW() WHERE id = ?')
            ->execute([$session['id']]);
    }

    // メール通知（スロットリング内蔵）
    sendChatNotification($session['shop_id'], (int)$session['id'], trim($msg));

    respondSessionBatch($pdo, (int)$session['id'], $session['shop_id'], $sinceId, 'open', ['message_id' => $messageId, 'client_msg_id' => $clientMsgId ?: null]);
}

/**
 * 訪問者セッションの統一バッチ応答を返す (send/poll共通).
 * since_id 以降の全メッセージ + shop_online + status + last_read_own_id を含む.
 */
function respondSessionBatch(PDO $pdo, int $sessionId, string $shopId, int $sinceId, string $status, array $extra = []): void {
    $stmt = $pdo->prepare(
        'SELECT id, sender_type, message, source_lang, sent_at, client_msg_id
         FROM chat_messages
         WHERE session_id = ? AND id > ?
         ORDER BY id ASC'
    );
    $stmt->execute([$sessionId, $sinceId]);
    $messages = $stmt->fetchAll();

    // shop側メッセージの既読化
    if (count($messages) > 0) {
        $pdo->prepare("UPDATE chat_messages SET read_at = NOW()
                       WHERE session_id = ? AND sender_type = 'shop' AND read_at IS NULL AND id > ?")
            ->execute([$sessionId, $sinceId]);
    }

    // オンライン状態
    $stmt = $pdo->prepare('SELECT is_online, last_online_at, auto_off_minutes FROM shop_chat_status WHERE shop_id = ?');
    $stmt->execute([$shopId]);
    $shopRow = $stmt->fetch();
    $shopOnline = effectiveOnline($shopRow ?: null);

    // visitor自身の送信メッセージが既読された最大ID
    $stmt = $pdo->prepare("SELECT COALESCE(MAX(id),0) FROM chat_messages
                           WHERE session_id = ? AND sender_type = 'visitor' AND read_at IS NOT NULL");
    $stmt->execute([$sessionId]);
    $lastReadOwnId = (int)$stmt->fetchColumn();

    okBatch(array_merge($extra, [
        'messages' => $messages,
        'shop_online' => $shopOnline,
        'status' => $status,
        'last_read_own_id' => $lastReadOwnId,
    ]));
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

    // presence heartbeat: visitorが生きていることを記録
    $pdo->prepare('UPDATE chat_sessions SET last_visitor_heartbeat_at = NOW() WHERE id = ?')
        ->execute([$session['id']]);

    respondSessionBatch($pdo, (int)$session['id'], $session['shop_id'], $sinceId, $session['status']);
}

/**
 * DO-Ready: subscribe前に一括判定するプリゲート.
 * WebSocket版ではper-requestハンドラがなく、upgrade時点で許可/拒否を返す必要がある.
 * ポーリング版でも購読開始前にこれを叩いて同じ挙動にすることで移行時の差異を最小化.
 *
 * 判定: not_found / closed / blocked / outside_hours / ok
 */
function handleCanConnect() {
    $token = (string)inp('session_token', '');
    $slug = trim((string)inp('shop_slug', ''));

    // session_token 指定: 既存セッションの継続可否
    if ($token !== '') {
        $pdo = DB::conn();
        $stmt = $pdo->prepare(
            'SELECT cs.id, cs.shop_id, cs.status, cs.blocked, cs.visitor_hash,
                    s.slug, s.shop_name, s.gender_mode,
                    st.is_online, st.last_online_at, st.auto_off_minutes,
                    st.reception_start, st.reception_end, st.welcome_message, st.reservation_hint
             FROM chat_sessions cs
             INNER JOIN shops s ON s.id = cs.shop_id
             INNER JOIN shop_chat_status st ON st.shop_id = cs.shop_id
             WHERE cs.session_token = ? LIMIT 1'
        );
        $stmt->execute([$token]);
        $row = $stmt->fetch();
        if (!$row) {
            okBatch(['can_subscribe' => false, 'reason' => 'not_found']);
            return;
        }
        if ($row['status'] === 'closed') {
            okBatch(['can_subscribe' => false, 'reason' => 'closed', 'status' => 'closed']);
            return;
        }
        if ((int)$row['blocked'] === 1 || isBlocked($row['shop_id'], $row['visitor_hash'])) {
            okBatch(['can_subscribe' => false, 'reason' => 'blocked']);
            return;
        }
        $inHours = isWithinReceptionHours($row);
        $online = effectiveOnline($row);
        okBatch([
            'can_subscribe' => $inHours,
            'reason' => $inHours ? 'ok' : 'outside_hours',
            'status' => 'open',
            'shop_online' => $online,
            'is_reception_hours' => $inHours,
            'next_reception_start' => $inHours ? null : nextReceptionStart($row),
            'reception_start' => $row['reception_start'] ?? null,
            'reception_end' => $row['reception_end'] ?? null,
            'welcome_message' => $row['welcome_message'] ?? null,
            'reservation_hint' => $row['reservation_hint'] ?? null,
            'shop' => [
                'slug' => $row['slug'],
                'shop_name' => $row['shop_name'],
                'gender_mode' => $row['gender_mode'] ?? 'men',
            ],
        ]);
        return;
    }

    // shop_slug 指定: 新規セッション開始可否 (まだsession_tokenがない段階)
    if ($slug === '') err('session_token or shop_slug required');
    $shop = getShopBySlug($slug);
    if (!$shop) {
        okBatch(['can_subscribe' => false, 'reason' => 'not_found']);
        return;
    }
    $vh = visitorHash();
    if (isBlocked($shop['id'], $vh)) {
        okBatch(['can_subscribe' => false, 'reason' => 'blocked']);
        return;
    }
    $inHours = isWithinReceptionHours($shop);
    $online = effectiveOnline($shop);
    okBatch([
        'can_subscribe' => $inHours,
        'reason' => $inHours ? 'ok' : 'outside_hours',
        'shop_online' => $online,
        'is_reception_hours' => $inHours,
        'next_reception_start' => $inHours ? null : nextReceptionStart($shop),
        'reception_start' => $shop['reception_start'] ?? null,
        'reception_end' => $shop['reception_end'] ?? null,
        'welcome_message' => $shop['welcome_message'] ?? null,
        'reservation_hint' => $shop['reservation_hint'] ?? null,
        'shop' => [
            'slug' => $shop['slug'],
            'shop_name' => $shop['shop_name'],
            'gender_mode' => $shop['gender_mode'] ?? 'men',
        ],
    ]);
}

function handleShopStatus() {
    $slug = trim((string)inp('shop_slug', ''));
    if ($slug === '') err('shop_slug required');
    $shop = getShopBySlug($slug);
    if (!$shop) {
        ok(['chat_enabled' => false]);
    }
    $inHours = isWithinReceptionHours($shop);
    $notifyMode = (string)($shop['notify_mode'] ?? 'off');
    ok([
        'chat_enabled'      => true,
        'is_online'         => effectiveOnline($shop),
        'shop_name'         => $shop['shop_name'],
        'gender_mode'       => $shop['gender_mode'] ?? 'men',
        'reception_start'   => $shop['reception_start'] ?? null,
        'reception_end'     => $shop['reception_end'] ?? null,
        'is_reception_hours' => $inHours,
        'next_reception_start' => $inHours ? null : nextReceptionStart($shop),
        'welcome_message'   => $shop['welcome_message'] ?? null,
        'reservation_hint'  => $shop['reservation_hint'] ?? null,
        'notify_mode'       => $notifyMode,
        'notify_enabled'    => $notifyMode !== 'off',
    ]);
}

// =========================================================
// Action handlers — Owner
// =========================================================

function handleRegisterDevice() {
    $auth = requireShopSession();
    $pdo = DB::conn();
    // 有効化ゲート: shop_chat_status レコードあるか確認
    $stmt = $pdo->prepare('SELECT 1 FROM shop_chat_status WHERE shop_id = ?');
    $stmt->execute([$auth['shop_id']]);
    if (!$stmt->fetchColumn()) err('YobuChatが有効化されていません', 403);

    $deviceName = trim((string)inp('device_name', ''));
    if (mb_strlen($deviceName) > 100) $deviceName = mb_substr($deviceName, 0, 100);

    // スパイラル防止: 同一shop+同一device_nameの直近120秒内のデバイスがあれば再利用
    // （verify-device失敗 → register-device のループでデバイス大量発行を防ぐ）
    if ($deviceName !== '') {
        $stmt = $pdo->prepare(
            'SELECT device_token FROM shop_chat_devices
             WHERE shop_id = ? AND device_name = ?
               AND (registered_at > NOW() - INTERVAL 120 SECOND
                    OR last_accessed_at > NOW() - INTERVAL 120 SECOND)
             ORDER BY id DESC LIMIT 1'
        );
        $stmt->execute([$auth['shop_id'], $deviceName]);
        $existing = $stmt->fetchColumn();
        if ($existing) {
            // 再利用時 last_accessed_at を更新しておく
            $pdo->prepare('UPDATE shop_chat_devices SET last_accessed_at = NOW() WHERE device_token = ?')
                ->execute([$existing]);
            ok(['device_token' => $existing, 'reused' => true]);
            return;
        }
    }

    $token = bin2hex(random_bytes(48));
    $stmt = $pdo->prepare(
        'INSERT INTO shop_chat_devices (shop_id, device_token, device_name) VALUES (?, ?, ?)'
    );
    $stmt->execute([$auth['shop_id'], $token, $deviceName ?: null]);

    ok(['device_token' => $token]);
}

function handleOwnerLogout() {
    // device_token だけで削除可能。自分のトークンを明示的に無効化する用途
    $token = (string)inp('device_token', '');
    if ($token === '') err('device_token required');
    $stmt = DB::conn()->prepare('DELETE FROM shop_chat_devices WHERE device_token = ?');
    $stmt->execute([$token]);
    ok(['revoked' => $stmt->rowCount()]);
}

function handleVerifyDevice() {
    $token = (string)inp('device_token', '');
    $device = verifyDevice($token);
    if (!$device) err('Invalid device token', 401);
    // 通知モード取得
    $stmt = DB::conn()->prepare('SELECT notify_mode FROM shop_chat_status WHERE shop_id = ?');
    $stmt->execute([$device['shop_id']]);
    $notifyMode = $stmt->fetchColumn() ?: 'off';
    ok([
        'shop_id'     => $device['shop_id'],
        'shop_name'   => $device['shop_name'],
        'slug'        => $device['slug'],
        'gender_mode' => $device['gender_mode'] ?? 'men',
        'notify_mode' => $notifyMode,
        'notify_enabled' => $notifyMode !== 'off',
    ]);
}

function handleOwnerInbox() {
    $device = requireDevice();
    ownerHeartbeat($device['shop_id']);
    $sessionId = (int)inp('session_id', 0);
    $sinceId = (int)inp('since_id', 0);
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

    $extra = ['sessions' => $sessions];
    $messages = [];
    $lastReadOwnId = 0;
    $status = null;

    // 特定セッションのメッセージも返す（指定時）
    if ($sessionId > 0) {
        $stmt = $pdo->prepare('SELECT id, status, visitor_hash FROM chat_sessions WHERE id = ? AND shop_id = ? LIMIT 1');
        $stmt->execute([$sessionId, $device['shop_id']]);
        $sessRow = $stmt->fetch();
        if ($sessRow) {
            $status = $sessRow['status'];

            // presence heartbeat: オーナーがこのセッションを見ていることを記録
            $pdo->prepare('UPDATE chat_sessions SET last_owner_heartbeat_at = NOW() WHERE id = ?')
                ->execute([$sessionId]);

            // since_id 以降のメッセージのみ返す (DO版のWS reconnect リプレイと同じ挙動)
            $stmt = $pdo->prepare(
                'SELECT id, sender_type, message, source_lang, sent_at, client_msg_id
                 FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC'
            );
            $stmt->execute([$sessionId, $sinceId]);
            $messages = $stmt->fetchAll();

            // この visitor がブロック中かどうか
            $stmt = $pdo->prepare('SELECT 1 FROM chat_blocks WHERE shop_id = ? AND visitor_hash = ? LIMIT 1');
            $stmt->execute([$device['shop_id'], $sessRow['visitor_hash']]);
            $extra['is_blocked'] = (bool)$stmt->fetchColumn();

            // ショップ自メッセージのうち visitor が既読した最大ID（オーナー表示用）
            $stmt = $pdo->prepare("SELECT COALESCE(MAX(id),0) FROM chat_messages
                                   WHERE session_id = ? AND sender_type = 'shop' AND read_at IS NOT NULL");
            $stmt->execute([$sessionId]);
            $lastReadOwnId = (int)$stmt->fetchColumn();

            // visitor側メッセージを既読に
            $pdo->prepare("UPDATE chat_messages SET read_at = NOW()
                           WHERE session_id = ? AND sender_type = 'visitor' AND read_at IS NULL")
                ->execute([$sessionId]);
        }
    }

    okBatch(array_merge($extra, [
        'messages' => $messages,
        'last_read_own_id' => $lastReadOwnId,
        'status' => $status,
        // shop_online は常に自分=ON扱い (オーナー画面を見ている前提)
        'shop_online' => true,
    ]));
}

function handleOwnerReply() {
    $device = requireDevice();
    ownerHeartbeat($device['shop_id']);
    $sessionId = (int)inp('session_id', 0);
    $msg = trim((string)inp('message', ''));
    $clientMsgId = (string)inp('client_msg_id', '');
    $sinceId = (int)inp('since_id', 0);
    if ($sessionId <= 0) err('session_id required');
    if ($msg === '') err('message required');
    if (mb_strlen($msg) > 1000) err('メッセージが長すぎます');
    if ($clientMsgId !== '' && !isValidClientMsgId($clientMsgId)) err('invalid client_msg_id');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id, shop_id, status FROM chat_sessions WHERE id = ? AND shop_id = ? LIMIT 1');
    $stmt->execute([$sessionId, $device['shop_id']]);
    $session = $stmt->fetch();
    if (!$session) err('Session not found', 404);
    if ($session['status'] === 'closed') err('Session closed', 410);

    // 冪等送信: 同じ client_msg_id で過去に送信済みなら再挿入しない
    if ($clientMsgId !== '') {
        $stmt = $pdo->prepare(
            "SELECT id FROM chat_messages
             WHERE client_msg_id = ? AND session_id = ? AND sender_type = 'shop' LIMIT 1"
        );
        $stmt->execute([$clientMsgId, $sessionId]);
        $existingId = $stmt->fetchColumn();
        if ($existingId) {
            respondOwnerBatch($pdo, $sessionId, $device['shop_id'], $sinceId, ['message_id' => (int)$existingId, 'client_msg_id' => $clientMsgId, 'duplicate' => true]);
            return;
        }
    }

    try {
        $stmt = $pdo->prepare("INSERT INTO chat_messages (session_id, sender_type, message, source_lang, client_msg_id) VALUES (?, 'shop', ?, 'ja', ?)");
        $stmt->execute([$sessionId, $msg, $clientMsgId ?: null]);
        $messageId = (int)$pdo->lastInsertId();
    } catch (PDOException $e) {
        if ($clientMsgId !== '' && strpos($e->getMessage(), '1062') !== false) {
            $stmt = $pdo->prepare('SELECT id FROM chat_messages WHERE client_msg_id = ? LIMIT 1');
            $stmt->execute([$clientMsgId]);
            $messageId = (int)$stmt->fetchColumn();
            if (!$messageId) throw $e;
        } else {
            throw $e;
        }
    }

    $pdo->prepare('UPDATE chat_sessions SET last_activity_at = NOW(), last_owner_heartbeat_at = NOW() WHERE id = ?')
        ->execute([$sessionId]);

    respondOwnerBatch($pdo, $sessionId, $device['shop_id'], $sinceId, ['message_id' => $messageId, 'client_msg_id' => $clientMsgId ?: null]);
}

/**
 * オーナー側の統一バッチ応答 (owner-reply 後の送信直後応答用).
 * 選択中セッションの since_id 以降のメッセージ + last_read_own_id を含む.
 */
function respondOwnerBatch(PDO $pdo, int $sessionId, string $shopId, int $sinceId, array $extra = []): void {
    $stmt = $pdo->prepare(
        'SELECT id, sender_type, message, source_lang, sent_at, client_msg_id
         FROM chat_messages
         WHERE session_id = ? AND id > ?
         ORDER BY id ASC'
    );
    $stmt->execute([$sessionId, $sinceId]);
    $messages = $stmt->fetchAll();

    $stmt = $pdo->prepare("SELECT COALESCE(MAX(id),0) FROM chat_messages
                           WHERE session_id = ? AND sender_type = 'shop' AND read_at IS NOT NULL");
    $stmt->execute([$sessionId]);
    $lastReadOwnId = (int)$stmt->fetchColumn();

    $stmt = $pdo->prepare('SELECT status FROM chat_sessions WHERE id = ? LIMIT 1');
    $stmt->execute([$sessionId]);
    $status = $stmt->fetchColumn() ?: 'open';

    okBatch(array_merge($extra, [
        'messages' => $messages,
        'last_read_own_id' => $lastReadOwnId,
        'status' => $status,
        'shop_online' => true,
    ]));
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

/**
 * オーナー画面を閉じた時などに呼ばれる: is_online=0 に落とす（通知モードは維持）
 */
function handleOwnerGoOffline() {
    $device = requireDevice();
    DB::conn()->prepare('UPDATE shop_chat_status SET is_online = 0 WHERE shop_id = ?')
        ->execute([$device['shop_id']]);
    ok(['is_online' => false]);
}

/**
 * 通知ON/OFFトグル: ON=first, OFF=off。既存 notify_mode を単純化して使う。
 */
function handleToggleNotify() {
    $device = requireDevice();
    $enabled = (int)inp('enabled', 0) === 1;
    $mode = $enabled ? 'first' : 'off';
    // 受付トグルは notify_mode と is_online を同時に切り替える（ユーザーには緑丸=受付中として見える）
    DB::conn()->prepare(
        "UPDATE shop_chat_status
         SET notify_mode = ?,
             is_online = ?,
             last_online_at = IF(? = 1, NOW(), last_online_at)
         WHERE shop_id = ?"
    )->execute([$mode, $enabled ? 1 : 0, $enabled ? 1 : 0, $device['shop_id']]);
    ok(['notify_enabled' => $enabled, 'notify_mode' => $mode, 'is_online' => $enabled]);
}

function handleUpdateSettings() {
    $device = requireDevice();
    $mode = (string)inp('notify_mode', 'first');
    if (!in_array($mode, ['first', 'every', 'off'], true)) err('invalid notify_mode');
    $interval = max(1, min(60, (int)inp('notify_min_interval_minutes', 3)));
    $pdo = DB::conn();
    // notify_mode と is_online は連動（通知トグル連動ルール）
    $stmt = $pdo->prepare(
        "UPDATE shop_chat_status
         SET notify_mode = ?, notify_min_interval_minutes = ?,
             is_online = IF(? = 'off', 0, 1),
             last_online_at = IF(? = 'off', last_online_at, NOW())
         WHERE shop_id = ?"
    );
    $stmt->execute([$mode, $interval, $mode, $mode, $device['shop_id']]);
    ok(['notify_mode' => $mode, 'notify_min_interval_minutes' => $interval, 'is_online' => $mode !== 'off']);
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

/**
 * オーナーがチャットを手動終了: status='closed' + closed_at=NOW()
 * 訪問者側は次回ポーリングで status='closed' を受け取り、入力欄が非表示になる。
 */
function handleCloseSession() {
    $device = requireDevice();
    $sessionId = (int)inp('session_id', 0);
    if ($sessionId <= 0) err('session_id required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id FROM chat_sessions WHERE id = ? AND shop_id = ? LIMIT 1');
    $stmt->execute([$sessionId, $device['shop_id']]);
    if (!$stmt->fetchColumn()) err('Session not found', 404);

    $pdo->prepare("UPDATE chat_sessions SET status = 'closed', closed_at = NOW()
                   WHERE id = ? AND shop_id = ?")
        ->execute([$sessionId, $device['shop_id']]);

    ok(['closed' => true]);
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
        'SELECT s.slug, s.shop_name, s.email AS shop_email,
                st.is_online, st.notify_mode, st.notify_min_interval_minutes, st.last_online_at, st.auto_off_minutes,
                st.reception_start, st.reception_end, st.welcome_message, st.reservation_hint, st.notify_email
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
            'SELECT id, device_name, last_accessed_at, registered_at AS created_at
             FROM shop_chat_devices WHERE shop_id = ? ORDER BY id DESC'
        );
        $stmt->execute([$shopId]);
        $devices = $stmt->fetchAll();

        $stmt = $pdo->prepare(
            'SELECT b.id, b.visitor_hash, b.reason, b.blocked_at AS created_at,
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
        'is_online'  => $enabled ? effectiveOnline($row) : false,
        'notify_mode'=> $row['notify_mode'] ?? 'off',
        'notify_min_interval_minutes' => (int)($row['notify_min_interval_minutes'] ?? 3),
        'reception_start' => $row['reception_start'] ?? null,
        'reception_end'   => $row['reception_end'] ?? null,
        'welcome_message' => $row['welcome_message'] ?? null,
        'reservation_hint' => $row['reservation_hint'] ?? null,
        'notify_email'    => $row['notify_email'] ?? null,
        'shop_email'      => $row['shop_email'] ?? '',
        'is_reception_hours' => $enabled ? isWithinReceptionHours($row) : true,
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
    if (!$stmt->fetchColumn()) err('YobuChatが有効化されていません', 403);

    // 通知設定トグル: is_online と notify_mode を同時に切り替える
    // - ON : notify_mode が 'off' なら 'first' に復帰、その他は維持 / is_online=1 / last_online_at=NOW()
    // - OFF: notify_mode='off' / is_online=0 (メール通知もされなくなる)
    $pdo->prepare(
        "UPDATE shop_chat_status
         SET notify_mode = IF(? = 1, IF(notify_mode = 'off', 'first', notify_mode), 'off'),
             is_online = ?,
             last_online_at = IF(? = 1, NOW(), last_online_at)
         WHERE shop_id = ?"
    )->execute([$isOnline, $isOnline, $isOnline, $auth['shop_id']]);

    // 切替後の最新 notify_mode を返す (shop-admin のラジオ同期用)
    $row = $pdo->prepare('SELECT notify_mode FROM shop_chat_status WHERE shop_id = ?');
    $row->execute([$auth['shop_id']]);
    $mode = $row->fetchColumn() ?: 'off';
    ok(['is_online' => $isOnline === 1, 'notify_mode' => $mode]);
}

function handleAdminSaveSettings() {
    $auth = requireShopSession();
    $mode = (string)inp('notify_mode', 'first');
    if (!in_array($mode, ['first', 'every', 'off'], true)) err('invalid notify_mode');
    $interval = max(1, min(60, (int)inp('notify_min_interval_minutes', 3)));

    $rStart = inp('reception_start', null);
    $rEnd   = inp('reception_end', null);
    $rStart = normalizeReceptionTime($rStart);
    $rEnd   = normalizeReceptionTime($rEnd);
    // 片方だけ NULL は不整合 → 両方 NULL に寄せる（24時間受付扱い）
    if ($rStart === null || $rEnd === null) { $rStart = null; $rEnd = null; }

    $welcome = inp('welcome_message', null);
    if ($welcome !== null) {
        $welcome = trim((string)$welcome);
        if ($welcome === '') {
            $welcome = null;
        } elseif (mb_strlen($welcome) > 80) {
            $welcome = mb_substr($welcome, 0, 80);
        }
    }

    $reservationHint = inp('reservation_hint', null);
    if ($reservationHint !== null) {
        $reservationHint = trim((string)$reservationHint);
        if ($reservationHint === '') {
            $reservationHint = null;
        } elseif (mb_strlen($reservationHint) > 80) {
            $reservationHint = mb_substr($reservationHint, 0, 80);
        }
    }

    $notifyEmail = inp('notify_email', null);
    if ($notifyEmail !== null) {
        $notifyEmail = trim((string)$notifyEmail);
        if ($notifyEmail === '') {
            $notifyEmail = null;
        } elseif (mb_strlen($notifyEmail) > 255 || !filter_var($notifyEmail, FILTER_VALIDATE_EMAIL)) {
            err('通知先メールアドレスの形式が正しくありません');
        }
    }

    $pdo = DB::conn();
    // notify_mode と is_online は常に連動させる（通知トグル連動ルール）:
    // notify_mode='off' → is_online=0 / それ以外 → is_online=1, last_online_at=NOW()
    $stmt = $pdo->prepare(
        "UPDATE shop_chat_status
         SET notify_mode = ?, notify_min_interval_minutes = ?, reception_start = ?, reception_end = ?, welcome_message = ?, reservation_hint = ?, notify_email = ?,
             is_online = IF(? = 'off', 0, 1),
             last_online_at = IF(? = 'off', last_online_at, NOW())
         WHERE shop_id = ?"
    );
    $stmt->execute([$mode, $interval, $rStart, $rEnd, $welcome, $reservationHint, $notifyEmail, $mode, $mode, $auth['shop_id']]);
    ok([
        'notify_mode' => $mode,
        'notify_min_interval_minutes' => $interval,
        'reception_start' => $rStart,
        'reception_end' => $rEnd,
        'welcome_message' => $welcome,
        'reservation_hint' => $reservationHint,
        'notify_email' => $notifyEmail,
        'is_online' => $mode !== 'off',
    ]);
}

function normalizeReceptionTime($t): ?string {
    if ($t === null || $t === '' || $t === 'null') return null;
    if (!is_string($t)) return null;
    if (!preg_match('/^([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?$/', $t, $m)) return null;
    return sprintf('%02d:%02d:00', (int)$m[1], (int)$m[2]);
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
