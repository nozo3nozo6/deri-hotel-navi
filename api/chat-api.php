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
require_once __DIR__ . '/mail-utils.php';
if (file_exists(__DIR__ . '/vapid-config.php')) {
    require_once __DIR__ . '/vapid-config.php';
}

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
$visitor_actions = ['start-session', 'send-message', 'poll-messages', 'shop-status', 'translate', 'can-connect', 'cast-url-reply', 'cast-url-toggle-notify', 'cast-inbox', 'cast-inbox-reply', 'cast-inbox-close', 'cast-inbox-toggle-notify', 'cast-inbox-request-code', 'cast-inbox-verify-code', 'send', 'set-typing', 'push-config', 'push-subscribe', 'push-unsubscribe', 'fetch-push-subscribers', 'push-unsubscribe-by-endpoint', 'visitor-notify-settings', 'my-notify-settings', 'fetch-visitor-notify', 'resend-visitor-email-verify'];
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

    $pdo = DB::conn();

    // セッション取得（cast_id も拾う → キャスト担当ならキャスト宛に通知ルーティング）
    $stmt = $pdo->prepare('SELECT notified_at, visitor_hash, cast_id FROM chat_sessions WHERE id = ? LIMIT 1');
    $stmt->execute([$sessionId]);
    $session = $stmt->fetch();
    if (!$session) return;

    // 通知先決定: キャスト担当セッションはキャスト本人宛、それ以外は店舗オーナー宛
    $notifyTo = '';
    $mode = 'off';
    $recipientLabel = $shop['shop_name']; // メール件名や文面で使う
    $destUrl = !empty($shop['slug'])
        ? 'https://yobuho.com/chat/' . $shop['slug'] . '/?owner=1'
        : 'https://yobuho.com/shop-admin.html#chat';

    if (!empty($session['cast_id'])) {
        // キャスト担当: shop_casts JOIN casts で email + notify_mode を引く
        $stmt = $pdo->prepare(
            'SELECT c.email, sc.chat_notify_mode, sc.display_name
             FROM shop_casts sc
             JOIN casts c ON c.id = sc.cast_id
             WHERE sc.shop_id = ? AND sc.cast_id = ? AND sc.status = "active" LIMIT 1'
        );
        $stmt->execute([$shopId, $session['cast_id']]);
        $castRow = $stmt->fetch();
        if (!$castRow) return; // 承認待ち/停止中/削除済みには通知しない
        $notifyTo = (string)$castRow['email'];
        $mode = $castRow['chat_notify_mode'] ?? 'off';
        $recipientLabel = $castRow['display_name'] . '（' . $shop['shop_name'] . '）';
        $destUrl = 'https://yobuho.com/cast-admin.html#chat';
    } else {
        $notifyTo = !empty($shop['notify_email']) ? $shop['notify_email'] : ($shop['email'] ?? '');
        $mode = $shop['notify_mode'] ?? 'first';
    }

    if (empty($notifyTo)) return;
    if ($mode === 'off') return;

    // 受付時間外はメール送信しない（時間帯制御は受付時間に委ねるルール）
    if (!isWithinReceptionHours($shop)) return;

    // A案 (厳格2値ルール): トグル ON の間は画面を見ていてもメール送信する。

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
    $subject = '【YobuChat】新着メッセージ: ' . $recipientLabel;
    $chatUrl = $destUrl;
    $openLabel = !empty($session['cast_id']) ? 'キャスト管理画面のチャットタブが開きます' : 'チャット画面が開きます';
    $html = '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body style="margin:0;padding:16px;background:#fff;font-family:sans-serif;">';
    $html .= '<div style="max-width:520px;margin:0 auto;">';
    $html .= '<h2 style="color:#9b2d35;margin:0 0 16px;">YobuChat 新着メッセージ</h2>';
    $html .= '<p style="font-size:14px;line-height:1.8;color:#333;">「' . htmlspecialchars($recipientLabel, ENT_QUOTES, 'UTF-8') . '」宛に、お客様からメッセージが届いています。</p>';
    $html .= '<div style="background:#f5f5f5;padding:12px;border-radius:6px;margin:16px 0;font-size:13px;line-height:1.6;color:#555;border-left:3px solid #9b2d35;">';
    $html .= nl2br(htmlspecialchars(mb_substr($preview, 0, 200), ENT_QUOTES, 'UTF-8'));
    $html .= '</div>';
    $html .= '<p style="margin:24px 0;"><a href="' . htmlspecialchars($chatUrl, ENT_QUOTES, 'UTF-8') . '" style="display:inline-block;padding:12px 24px;background:#9b2d35;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">チャットを開いて返信する</a></p><p style="font-size:12px;color:#666;margin:8px 0;">※ ' . $openLabel . '（未ログインの場合はログイン画面へ）</p>';
    $html .= '<p style="font-size:12px;color:#888;margin-top:24px;">通知設定は 管理画面 &gt; YobuChat から変更できます。</p>';
    $html .= '</div></body></html>';

    $plain = "「{$recipientLabel}」宛に新着チャットが届きました。\n\n";
    $plain .= "内容: " . mb_substr($preview, 0, 200) . "\n\n";
    $plain .= "チャットを開いて返信: " . $chatUrl . "\n";
    $plain .= "※ {$openLabel}（未ログインの場合はログイン画面へ）。\n";

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
        case 'mark-read':       handleMarkRead(); break;
        case 'shop-status':     handleShopStatus(); break;
        case 'can-connect':     handleCanConnect(); break;
        case 'translate':       handleTranslate(); break;
        case 'send':            handleUnifiedSend(); break;
        case 'set-typing':      handleSetTyping(); break;
        case 'push-config':     handlePushConfig(); break;
        case 'push-subscribe':  handlePushSubscribe(); break;
        case 'push-unsubscribe': handlePushUnsubscribe(); break;

        // DO→PHP (X-Sync-Secret 認証) — Web Push 送信時の購読者取得 / 失効削除
        case 'fetch-push-subscribers':     handleFetchPushSubscribers(); break;
        case 'push-unsubscribe-by-endpoint': handlePushUnsubscribeByEndpoint(); break;

        // Visitor email notify (訪問者が返信メール通知を opt-in / opt-out)
        case 'visitor-notify-settings':    handleVisitorNotifySettings(); break;
        case 'my-notify-settings':         handleMyNotifySettings(); break;
        case 'fetch-visitor-notify':       handleFetchVisitorNotify(); break;
        case 'resend-visitor-email-verify': handleResendVisitorEmailVerify(); break;

        // Owner (device_token auth)
        case 'verify-device':   handleVerifyDevice(); break;
        case 'owner-inbox':     handleOwnerInbox(); break;
        case 'owner-reply':     handleOwnerReply(); break;
        case 'cast-url-reply':  handleCastUrlReply(); break;
        case 'cast-url-toggle-notify': handleCastUrlToggleNotify(); break;
        case 'cast-mark-read':          handleCastMarkRead(); break;
        case 'cast-inbox':              handleCastInbox(); break;
        case 'cast-inbox-reply':        handleCastInboxReply(); break;
        case 'cast-inbox-close':        handleCastInboxClose(); break;
        case 'cast-inbox-toggle-notify': handleCastInboxToggleNotify(); break;
        case 'cast-inbox-request-code': handleCastInboxRequestCode(); break;
        case 'cast-inbox-verify-code':  handleCastInboxVerifyCode(); break;
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
    $shopCastId = trim((string)inp('cast', '')); // shop_casts.id (not casts.id) — キャスト指名
    $adoptToken = trim((string)inp('session_token', '')); // DO adopt / リロード時の既存セッション復元
    if (!in_array($source, ['portal', 'widget', 'standalone'], true)) $source = 'standalone';
    if ($slug === '') err('shop_slug required');

    $shop = getShopBySlug($slug);
    if (!$shop) err('YobuChatは利用できません', 404);

    $pdo = DB::conn();

    // createIfMissing セマンティクス: 既存の session_token が有効なら、そのセッションを再利用して返す
    // (リロード時に無駄な新規セッションを作らず、同じ cast_id / cast_name を保つ).
    if ($adoptToken !== '') {
        $stmt = $pdo->prepare(
            'SELECT cs.id, cs.cast_id, cs.visitor_email, cs.visitor_notify_enabled,
                    sc.id AS shop_cast_id, sc.display_name AS cast_name, sc.chat_notify_mode
             FROM chat_sessions cs
             LEFT JOIN shop_casts sc ON sc.cast_id = cs.cast_id AND sc.shop_id = cs.shop_id
             WHERE cs.session_token = ? AND cs.shop_id = ? LIMIT 1'
        );
        $stmt->execute([$adoptToken, $shop['id']]);
        $existing = $stmt->fetch();
        if ($existing) {
            ok([
                'session_token'    => $adoptToken,
                'session_id'       => (int)$existing['id'],
                'shop_name'        => $shop['shop_name'],
                'cast_name'        => $existing['cast_name'],
                'shop_cast_id'     => $existing['shop_cast_id'],
                'cast_notify_mode' => $existing['chat_notify_mode'] ?? null,
                'is_online'        => effectiveOnline($shop),
                'gender_mode'      => $shop['gender_mode'] ?? 'men',
                'visitor_email'    => (string)($existing['visitor_email'] ?? ''),
                'visitor_notify_enabled' => (int)$existing['visitor_notify_enabled'] === 1,
            ]);
        }
        // 存在しなければ下の新規作成パスにフォールスルー
    }

    $vh = visitorHash();
    if (isBlocked($shop['id'], $vh)) err('この店舗への連絡は停止されています', 403);

    $limitErr = checkDailySessionLimit($shop['id'], $vh);
    if ($limitErr) err($limitErr, 429);

    // キャスト指名: shop_casts.id → cast_id を resolve. 承認済み(active)のみ有効.
    $castId = null;
    $castName = null;
    if ($shopCastId !== '') {
        $stmt = $pdo->prepare(
            'SELECT sc.cast_id, sc.display_name, sc.status
             FROM shop_casts sc
             WHERE sc.id = ? AND sc.shop_id = ? LIMIT 1'
        );
        $stmt->execute([$shopCastId, $shop['id']]);
        $row = $stmt->fetch();
        if ($row && $row['status'] === 'active') {
            $castId = $row['cast_id'];
            $castName = $row['display_name'];
        }
        // 非active (pending_approval/suspended/removed) の場合は cast_id 未設定で続行 (店舗直通に fallback)
    }

    $token = bin2hex(random_bytes(24));
    $stmt = $pdo->prepare(
        'INSERT INTO chat_sessions (shop_id, cast_id, session_token, visitor_hash, source) VALUES (?, ?, ?, ?, ?)'
    );
    $stmt->execute([$shop['id'], $castId, $token, $vh, $source]);
    $sessionId = (int)$pdo->lastInsertId();

    ok([
        'session_token' => $token,
        'session_id'    => $sessionId,
        'shop_name'     => $shop['shop_name'],
        'cast_name'     => $castName,
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
function respondSessionBatch(PDO $pdo, int $sessionId, string $shopId, int $sinceId, string $status, array $extra = [], string $readerRole = 'visitor'): void {
    $stmt = $pdo->prepare(
        'SELECT id, sender_type, message, source_lang, sent_at, client_msg_id
         FROM chat_messages
         WHERE session_id = ? AND id > ?
         ORDER BY id ASC'
    );
    $stmt->execute([$sessionId, $sinceId]);
    $messages = $stmt->fetchAll();

    // 既読ルール (2026-04-23 ゼロ設計): 暗黙既読を全廃.
    // poll/send 経路で read_at を自動更新しない.
    // 既読は「受信者が実際にウィンドウを見ている」状態でのみ付与 (chat.js isWindowActive + DO fresh view signal).

    // オンライン状態
    $stmt = $pdo->prepare('SELECT is_online, last_online_at, auto_off_minutes FROM shop_chat_status WHERE shop_id = ?');
    $stmt->execute([$shopId]);
    $shopRow = $stmt->fetch();
    $shopOnline = effectiveOnline($shopRow ?: null);

    // 自分の送信側が既読された最大ID
    $ownSide = $readerRole === 'shop' ? 'shop' : 'visitor';
    $stmt = $pdo->prepare("SELECT COALESCE(MAX(id),0) FROM chat_messages
                           WHERE session_id = ? AND sender_type = ? AND read_at IS NOT NULL");
    $stmt->execute([$sessionId, $ownSide]);
    $lastReadOwnId = (int)$stmt->fetchColumn();

    // Day 8: 相手の typing 状態 (reader の逆側の typing_until > NOW())
    $otherTypingCol = $readerRole === 'shop' ? 'visitor_typing_until' : 'shop_typing_until';
    $stmt = $pdo->prepare("SELECT $otherTypingCol FROM chat_sessions WHERE id = ? LIMIT 1");
    $stmt->execute([$sessionId]);
    $otherTypingUntil = $stmt->fetchColumn();
    $otherTyping = $otherTypingUntil && strtotime((string)$otherTypingUntil) > time();

    // DO broadcast: INSERT直後のみ（send/reply path）。poll path・duplicate pathはスキップ.
    if (!empty($extra['message_id']) && empty($extra['duplicate'])) {
        $newId = (int)$extra['message_id'];
        foreach ($messages as $m) {
            if ((int)$m['id'] === $newId) {
                broadcastMessageToDO((string)$shopId, (int)$sessionId, $m);
                break;
            }
        }
        // Day 8: 送信した側の typing を即時クリア + #3: 相手側にも stop を push
        $selfCol = $readerRole === 'shop' ? 'shop_typing_until' : 'visitor_typing_until';
        $pdo->prepare("UPDATE chat_sessions SET $selfCol = NULL WHERE id = ?")->execute([$sessionId]);
        broadcastTypingToDO((int)$sessionId, $readerRole, false);
    }

    okBatch(array_merge($extra, [
        'messages' => $messages,
        'shop_online' => $shopOnline,
        'status' => $status,
        'last_read_own_id' => $lastReadOwnId,
        'other_typing' => (bool)$otherTyping,
    ]));
}

function handlePollMessages() {
    $token = (string)inp('session_token', '');
    $sinceId = (int)inp('since_id', 0);
    $asCast = (int)inp('as_cast', 0) === 1;
    if ($token === '') err('session_token required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id, shop_id, status, cast_id FROM chat_sessions WHERE session_token = ? LIMIT 1');
    $stmt->execute([$token]);
    $session = $stmt->fetch();
    if (!$session) err('Session not found', 404);

    // キャスト視点で閲覧している場合 (cast-view URL): セッションに cast_id があることを前提に
    // 既読化ロジックを shop 側ロールに切り替える. 権限は URL-only auth (session_token 知る者=本人向けメール受信者)
    $readerRole = 'visitor';
    if ($asCast && !empty($session['cast_id'])) {
        $readerRole = 'shop';
        // presence heartbeat: cast(shop側)側のハートビート
        $pdo->prepare('UPDATE chat_sessions SET last_owner_heartbeat_at = NOW() WHERE id = ?')
            ->execute([$session['id']]);
    } else {
        // presence heartbeat: visitorが生きていることを記録
        $pdo->prepare('UPDATE chat_sessions SET last_visitor_heartbeat_at = NOW() WHERE id = ?')
            ->execute([$session['id']]);
    }

    respondSessionBatch($pdo, (int)$session['id'], $session['shop_id'], $sinceId, $session['status'], [], $readerRole);
}

/**
 * 2026-04-23 ゼロ設計: 明示的 mark-read エンドポイント.
 * chat.js が isWindowActive() 時のみ叩く. PHP 暗黙既読を全廃したのでこれが唯一の MySQL 既読経路 (DO 経由除く).
 *   - reader='visitor': session_token 認証 → sender_type='shop' を既読化 + DO broadcast (owner UI 反映)
 *   - reader='shop':    device_token 認証 → sender_type='visitor' を既読化 + DO broadcast (visitor UI 反映)
 */
function handleMarkRead(): void {
    $reader = (string)inp('reader', '');
    $upTo = (int)inp('up_to_id', 0);
    if ($reader !== 'visitor' && $reader !== 'shop') err('invalid reader');
    $pdo = DB::conn();

    if ($reader === 'visitor') {
        $token = (string)inp('session_token', '');
        if ($token === '') err('session_token required');
        $stmt = $pdo->prepare('SELECT id, shop_id FROM chat_sessions WHERE session_token = ? LIMIT 1');
        $stmt->execute([$token]);
        $session = $stmt->fetch();
        if (!$session) err('Session not found', 404);
        $sessionId = (int)$session['id'];
        $targetSender = 'shop';
    } else {
        $device = requireDevice();
        $sessionId = (int)inp('session_id', 0);
        if ($sessionId <= 0) err('session_id required');
        $stmt = $pdo->prepare('SELECT id FROM chat_sessions WHERE id = ? AND shop_id = ? LIMIT 1');
        $stmt->execute([$sessionId, $device['shop_id']]);
        if (!$stmt->fetch()) err('Session not found', 404);
        $targetSender = 'visitor';
    }

    // 既読化対象の MAX(id) を先取り → UPDATE → DO broadcast
    if ($upTo > 0) {
        $stmt = $pdo->prepare("SELECT COALESCE(MAX(id),0) FROM chat_messages
                               WHERE session_id = ? AND sender_type = ? AND read_at IS NULL AND id <= ?");
        $stmt->execute([$sessionId, $targetSender, $upTo]);
        $maxUnread = (int)$stmt->fetchColumn();
        $pdo->prepare("UPDATE chat_messages SET read_at = NOW()
                       WHERE session_id = ? AND sender_type = ? AND read_at IS NULL AND id <= ?")
            ->execute([$sessionId, $targetSender, $upTo]);
    } else {
        $stmt = $pdo->prepare("SELECT COALESCE(MAX(id),0) FROM chat_messages
                               WHERE session_id = ? AND sender_type = ? AND read_at IS NULL");
        $stmt->execute([$sessionId, $targetSender]);
        $maxUnread = (int)$stmt->fetchColumn();
        $pdo->prepare("UPDATE chat_messages SET read_at = NOW()
                       WHERE session_id = ? AND sender_type = ? AND read_at IS NULL")
            ->execute([$sessionId, $targetSender]);
    }
    if ($maxUnread > 0) {
        broadcastReadToDO($sessionId, $reader, $maxUnread);
    }
    ok(['last_read_id' => $maxUnread]);
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
    // キャスト指名セッションは受信トレイから除外（shop-admin のキャスト管理タブから閲覧する）
    $stmt = $pdo->prepare(
        'SELECT s.id, s.session_token, s.status, s.blocked, s.started_at, s.last_activity_at, s.visitor_hash, s.nickname, s.cast_id,
                (SELECT message FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) AS last_message,
                (SELECT sender_type FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) AS last_sender,
                (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id AND sender_type = "visitor" AND read_at IS NULL) AS unread_count
         FROM chat_sessions s
         WHERE s.shop_id = ? AND s.cast_id IS NULL
         ORDER BY s.last_activity_at DESC
         LIMIT 30'
    );
    $stmt->execute([$device['shop_id']]);
    $sessions = $stmt->fetchAll();

    $extra = ['sessions' => $sessions];
    $messages = [];
    $lastReadOwnId = 0;
    $status = null;
    $otherTyping = false;

    // 特定セッションのメッセージも返す（指定時）
    if ($sessionId > 0) {
        $stmt = $pdo->prepare('SELECT id, status, visitor_hash, visitor_typing_until FROM chat_sessions WHERE id = ? AND shop_id = ? LIMIT 1');
        $stmt->execute([$sessionId, $device['shop_id']]);
        $sessRow = $stmt->fetch();
        if ($sessRow) {
            $status = $sessRow['status'];
            $otherTyping = !empty($sessRow['visitor_typing_until']) && strtotime((string)$sessRow['visitor_typing_until']) > time();

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

            // 既読ルール (2026-04-23 ゼロ設計): inbox poll では visitor msg を自動既読しない.
            // 既読は「オーナーが該当スレッドを実際に開いて見ている」時のみ (chat.js mark-read 経由).
        }
    }

    okBatch(array_merge($extra, [
        'messages' => $messages,
        'last_read_own_id' => $lastReadOwnId,
        'status' => $status,
        // shop_online は常に自分=ON扱い (オーナー画面を見ている前提)
        'shop_online' => true,
        'other_typing' => (bool)$otherTyping,
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
    $stmt = $pdo->prepare('SELECT id, shop_id, status, cast_id FROM chat_sessions WHERE id = ? AND shop_id = ? LIMIT 1');
    $stmt->execute([$sessionId, $device['shop_id']]);
    $session = $stmt->fetch();
    if (!$session) err('Session not found', 404);
    if ($session['status'] === 'closed') err('Session closed', 410);
    // キャスト担当セッションへの店舗返信はブロック（閲覧のみ、不正監視用）
    if (!empty($session['cast_id'])) err('キャスト担当セッションのため、店舗からの返信はできません（閲覧のみ）', 403);

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
 * キャストがメール通知URL(?cast=<shop_cast_id>&view=<session_token>)から返信する.
 * device_token も cast PHPセッションも要求せず、URLパラメータの組み合わせで認証する.
 *
 * 脅威モデル:
 * - session_token (UUID 128bit+) はメールでしか配布されない => 予測不能
 * - shop_cast_id が URLに含まれる => shop_casts.cast_id と session.cast_id が一致するか検証
 * - 一致しない場合は 403 (他キャストへの成りすまし防止)
 * - 承認済み(active) の shop_cast のみ受付
 */
function handleCastUrlReply() {
    $sessionToken = trim((string)inp('session_token', ''));
    $shopCastId   = trim((string)inp('shop_cast_id', ''));
    $msg          = trim((string)inp('message', ''));
    $clientMsgId  = (string)inp('client_msg_id', '');
    $sinceId      = (int)inp('since_id', 0);

    if ($sessionToken === '' || !preg_match('/^[a-zA-Z0-9\-]{32,64}$/', $sessionToken)) err('session_token required');
    if ($shopCastId === '')  err('shop_cast_id required');
    if ($msg === '') err('message required');
    if (mb_strlen($msg) > 1000) err('メッセージが長すぎます');
    if ($clientMsgId !== '' && !isValidClientMsgId($clientMsgId)) err('invalid client_msg_id');

    $pdo = DB::conn();

    // shop_cast と cast_id 解決 (active のみ)
    $stmt = $pdo->prepare(
        'SELECT sc.id AS shop_cast_id, sc.shop_id, sc.cast_id, sc.status AS sc_status, c.status AS cast_status
         FROM shop_casts sc
         JOIN casts c ON c.id = sc.cast_id
         WHERE sc.id = ? LIMIT 1'
    );
    $stmt->execute([$shopCastId]);
    $sc = $stmt->fetch();
    if (!$sc || $sc['sc_status'] !== 'active' || $sc['cast_status'] !== 'active') {
        err('キャストが無効です', 403);
    }

    // セッション検証: session_token 一致 + cast_id が shop_cast.cast_id と一致
    $stmt = $pdo->prepare(
        'SELECT id, shop_id, cast_id, status FROM chat_sessions WHERE session_token = ? LIMIT 1'
    );
    $stmt->execute([$sessionToken]);
    $session = $stmt->fetch();
    if (!$session) err('Session not found', 404);
    if ((string)$session['shop_id'] !== (string)$sc['shop_id']) err('shop mismatch', 403);
    if ((string)$session['cast_id'] !== (string)$sc['cast_id']) err('cast mismatch', 403);
    if ($session['status'] === 'closed') err('Session closed', 410);

    $sessionId = (int)$session['id'];

    // 冪等送信
    if ($clientMsgId !== '') {
        $stmt = $pdo->prepare(
            "SELECT id FROM chat_messages
             WHERE client_msg_id = ? AND session_id = ? AND sender_type = 'shop' LIMIT 1"
        );
        $stmt->execute([$clientMsgId, $sessionId]);
        $existingId = $stmt->fetchColumn();
        if ($existingId) {
            respondOwnerBatch($pdo, $sessionId, (string)$sc['shop_id'], $sinceId, ['message_id' => (int)$existingId, 'client_msg_id' => $clientMsgId, 'duplicate' => true]);
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

    respondOwnerBatch($pdo, $sessionId, (string)$sc['shop_id'], $sinceId, ['message_id' => $messageId, 'client_msg_id' => $clientMsgId ?: null]);
}

/**
 * キャスト通知トグル (URL-only auth: session_token + shop_cast_id).
 * キャストがメールURLから開いた画面で、自分の chat_notify_mode を ON/OFF する.
 * ON: 'first' (既存値が 'every' ならそのまま) / OFF: 'off'
 */
function handleCastUrlToggleNotify() {
    $sessionToken = trim((string)inp('session_token', ''));
    $shopCastId   = trim((string)inp('shop_cast_id', ''));
    $enabled      = (int)inp('enabled', 0);

    if ($sessionToken === '' || !preg_match('/^[a-zA-Z0-9\-]{32,64}$/', $sessionToken)) err('session_token required');
    if ($shopCastId === '') err('shop_cast_id required');

    $pdo = DB::conn();

    // shop_cast 検証 (active)
    $stmt = $pdo->prepare(
        'SELECT sc.id, sc.shop_id, sc.cast_id, sc.chat_notify_mode, sc.status AS sc_status, c.status AS cast_status
         FROM shop_casts sc JOIN casts c ON c.id = sc.cast_id
         WHERE sc.id = ? LIMIT 1'
    );
    $stmt->execute([$shopCastId]);
    $sc = $stmt->fetch();
    if (!$sc || $sc['sc_status'] !== 'active' || $sc['cast_status'] !== 'active') err('キャストが無効です', 403);

    // session_token が当該 shop_cast の cast_id / shop_id と一致するか検証 (URL-only auth)
    $stmt = $pdo->prepare('SELECT shop_id, cast_id FROM chat_sessions WHERE session_token = ? LIMIT 1');
    $stmt->execute([$sessionToken]);
    $session = $stmt->fetch();
    if (!$session) err('Session not found', 404);
    if ((string)$session['shop_id'] !== (string)$sc['shop_id']) err('shop mismatch', 403);
    if ((string)$session['cast_id'] !== (string)$sc['cast_id']) err('cast mismatch', 403);

    // ON→'first' (既存が 'every' なら維持) / OFF→'off'
    $currentMode = (string)($sc['chat_notify_mode'] ?? 'off');
    if ($enabled === 1) {
        $newMode = $currentMode === 'off' ? 'first' : $currentMode;
    } else {
        $newMode = 'off';
    }

    $stmt = $pdo->prepare('UPDATE shop_casts SET chat_notify_mode = ? WHERE id = ?');
    $stmt->execute([$newMode, $shopCastId]);

    ok([
        'cast_notify_mode' => $newMode,
        'notify_enabled'   => $newMode !== 'off',
    ]);
}

/**
 * =========================================================
 * Cast inbox (URL-token auth).
 * キャスト本人が ?cast_inbox=<uuid> でブックマークする「自分用URL」経由で、
 * 自分宛全セッションの受信箱・返信・終了・通知トグルを行う.
 *
 * 認証: shop_casts.inbox_token (UUID) を唯一の bearer とする.
 *   - status='active' + casts.status='active' でなければ拒否.
 *   - URL流出時の対策: cast-admin 側で再発行 (inbox_token を UUID() で更新) すると
 *     旧URLが失効する.
 *
 * session_token を受け取らない点が cast-url-* と異なる (inbox_token だけで認証が完結).
 * =========================================================
 */
function resolveCastInboxToken(string $token): ?array {
    if ($token === '' || !preg_match('/^[a-f0-9\-]{32,36}$/i', $token)) return null;
    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT sc.id AS shop_cast_id, sc.shop_id, sc.cast_id, sc.display_name,
                sc.chat_notify_mode, sc.status AS sc_status, c.status AS cast_status,
                s.slug, s.shop_name, s.gender_mode
         FROM shop_casts sc
         JOIN casts c ON c.id = sc.cast_id
         JOIN shops s ON s.id = sc.shop_id
         WHERE sc.inbox_token = ? LIMIT 1'
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch();
    if (!$row) return null;
    if ($row['sc_status'] !== 'active' || $row['cast_status'] !== 'active') return null;
    return $row;
}

/**
 * cast-inbox: 自分宛セッション一覧 + 指定セッションのメッセージ取得 (URL-token auth).
 */
function handleCastInbox(): void {
    $token = trim((string)inp('inbox_token', ''));
    $sc = resolveCastInboxToken($token);
    if (!$sc) err('invalid or revoked inbox_token', 403);

    // 端末登録チェック: device_token 未登録なら登録フローへ誘導
    $deviceToken = trim((string)inp('device_token', ''));
    if (!verifyCastInboxDevice($sc['shop_cast_id'], $deviceToken)) {
        $pdoMeta = DB::conn();
        $emailStmt = $pdoMeta->prepare('SELECT email FROM casts WHERE id = ? LIMIT 1');
        $emailStmt->execute([$sc['cast_id']]);
        $castEmail = (string)$emailStmt->fetchColumn();
        ok([
            'registration_required' => true,
            'cast_name'    => $sc['display_name'],
            'shop_name'    => $sc['shop_name'],
            'masked_email' => maskCastEmail($castEmail),
            'shop_cast_id' => $sc['shop_cast_id'],
        ]);
        return;
    }

    $sessionId = (int)inp('session_id', 0);
    $sinceId   = (int)inp('since_id', 0);
    $pdo = DB::conn();

    // presence
    $pdo->prepare('UPDATE shop_casts SET chat_last_online_at = NOW() WHERE id = ?')
        ->execute([$sc['shop_cast_id']]);

    // 担当セッション一覧 (cast_id 一致のみ)
    $stmt = $pdo->prepare(
        'SELECT s.id, s.session_token, s.status, s.blocked, s.started_at, s.last_activity_at,
                s.nickname, s.cast_id,
                (SELECT message FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) AS last_message,
                (SELECT sender_type FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) AS last_sender,
                (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id AND sender_type = "visitor" AND read_at IS NULL) AS unread_count
         FROM chat_sessions s
         WHERE s.shop_id = ? AND s.cast_id = ?
         ORDER BY s.last_activity_at DESC LIMIT 30'
    );
    $stmt->execute([$sc['shop_id'], $sc['cast_id']]);
    $sessions = $stmt->fetchAll();

    $messages = [];
    $status = null;
    $lastReadOwnId = 0;
    $otherTyping = false;

    if ($sessionId > 0) {
        // 指定セッションが自分宛か検証
        $stmt = $pdo->prepare(
            'SELECT id, status, visitor_typing_until FROM chat_sessions
             WHERE id = ? AND shop_id = ? AND cast_id = ? LIMIT 1'
        );
        $stmt->execute([$sessionId, $sc['shop_id'], $sc['cast_id']]);
        $sessRow = $stmt->fetch();
        if ($sessRow) {
            $status = $sessRow['status'];
            $otherTyping = !empty($sessRow['visitor_typing_until']) && strtotime((string)$sessRow['visitor_typing_until']) > time();

            $stmt = $pdo->prepare(
                'SELECT id, sender_type, message, source_lang, sent_at, client_msg_id
                 FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC'
            );
            $stmt->execute([$sessionId, $sinceId]);
            $messages = $stmt->fetchAll();

            $stmt = $pdo->prepare(
                "SELECT COALESCE(MAX(id),0) FROM chat_messages
                 WHERE session_id = ? AND sender_type = 'shop' AND read_at IS NOT NULL"
            );
            $stmt->execute([$sessionId]);
            $lastReadOwnId = (int)$stmt->fetchColumn();

            // 既読ルール (2026-04-23 ゼロ設計): cast-inbox poll では visitor msg を自動既読しない.
            // 既読は「キャストが該当スレッドを実際に開いて見ている」時のみ (chat.js cast-mark-read 経由).
            $pdo->prepare('UPDATE chat_sessions SET last_owner_heartbeat_at = NOW() WHERE id = ?')
                ->execute([$sessionId]);
        }
    }

    ok([
        'sessions'         => $sessions,
        'messages'         => $messages,
        'status'           => $status,
        'last_read_own_id' => $lastReadOwnId,
        'other_typing'     => (bool)$otherTyping,
        'cast_name'        => $sc['display_name'],
        'shop_name'        => $sc['shop_name'],
        'shop_slug'        => $sc['slug'],
        'shop_cast_id'     => $sc['shop_cast_id'],
        'gender_mode'      => $sc['gender_mode'] ?? 'men',
        'notify_mode'      => $sc['chat_notify_mode'],
        'notify_enabled'   => $sc['chat_notify_mode'] !== 'off',
        'server_time'      => date('c'),
    ]);
}

/**
 * cast-mark-read: キャストによる明示的 mark-read (2026-04-23 ゼロ設計).
 *
 * 2系統の auth を受け付ける (いずれも visitor msg を既読化 + DO broadcast):
 *   A. inbox_token + session_id   — キャスト自分用受信箱 (?cast_inbox=<uuid>) からの mark-read
 *   B. session_token + shop_cast_id — キャストメール通知URL (?cast=&view=) からの mark-read
 *
 * どちらも sender_type='visitor' を id<=up_to_id で read_at=NOW() + broadcastReadToDO(reader='shop').
 * 店舗 device_token を持たないキャスト経路の唯一の既読口.
 */
function handleCastMarkRead(): void {
    $upTo = (int)inp('up_to_id', 0);
    $pdo = DB::conn();
    $sessionId = 0;

    $inboxToken = trim((string)inp('inbox_token', ''));
    if ($inboxToken !== '') {
        // Auth A: cast 受信箱 (inbox_token)
        $sc = resolveCastInboxToken($inboxToken);
        if (!$sc) err('invalid or revoked inbox_token', 403);
        $deviceToken = trim((string)inp('device_token', ''));
        if (!verifyCastInboxDevice($sc['shop_cast_id'], $deviceToken)) err('端末が登録されていません', 403);

        $sessionId = (int)inp('session_id', 0);
        if ($sessionId <= 0) err('session_id required');
        $stmt = $pdo->prepare(
            'SELECT id FROM chat_sessions WHERE id = ? AND shop_id = ? AND cast_id = ? LIMIT 1'
        );
        $stmt->execute([$sessionId, $sc['shop_id'], $sc['cast_id']]);
        if (!$stmt->fetch()) err('Session not found', 404);
    } else {
        // Auth B: cast メール返信URL (session_token + shop_cast_id)
        $sessionToken = trim((string)inp('session_token', ''));
        $shopCastId   = trim((string)inp('shop_cast_id', ''));
        if ($sessionToken === '' || !preg_match('/^[a-zA-Z0-9\-]{32,64}$/', $sessionToken)) err('session_token required');
        if ($shopCastId === '') err('shop_cast_id required');

        $stmt = $pdo->prepare(
            'SELECT sc.id AS shop_cast_id, sc.shop_id, sc.cast_id, sc.status AS sc_status, c.status AS cast_status
             FROM shop_casts sc JOIN casts c ON c.id = sc.cast_id
             WHERE sc.id = ? LIMIT 1'
        );
        $stmt->execute([$shopCastId]);
        $sc = $stmt->fetch();
        if (!$sc || $sc['sc_status'] !== 'active' || $sc['cast_status'] !== 'active') {
            err('キャストが無効です', 403);
        }

        $stmt = $pdo->prepare(
            'SELECT id, shop_id, cast_id FROM chat_sessions WHERE session_token = ? LIMIT 1'
        );
        $stmt->execute([$sessionToken]);
        $session = $stmt->fetch();
        if (!$session) err('Session not found', 404);
        if ((string)$session['shop_id'] !== (string)$sc['shop_id']) err('shop mismatch', 403);
        if ((string)$session['cast_id'] !== (string)$sc['cast_id']) err('cast mismatch', 403);
        $sessionId = (int)$session['id'];
    }

    // 既読化対象の MAX(id) を先取り → UPDATE → DO broadcast (visitor WS に既読通知)
    if ($upTo > 0) {
        $stmt = $pdo->prepare("SELECT COALESCE(MAX(id),0) FROM chat_messages
                               WHERE session_id = ? AND sender_type = 'visitor' AND read_at IS NULL AND id <= ?");
        $stmt->execute([$sessionId, $upTo]);
        $maxUnread = (int)$stmt->fetchColumn();
        $pdo->prepare("UPDATE chat_messages SET read_at = NOW()
                       WHERE session_id = ? AND sender_type = 'visitor' AND read_at IS NULL AND id <= ?")
            ->execute([$sessionId, $upTo]);
    } else {
        $stmt = $pdo->prepare("SELECT COALESCE(MAX(id),0) FROM chat_messages
                               WHERE session_id = ? AND sender_type = 'visitor' AND read_at IS NULL");
        $stmt->execute([$sessionId]);
        $maxUnread = (int)$stmt->fetchColumn();
        $pdo->prepare("UPDATE chat_messages SET read_at = NOW()
                       WHERE session_id = ? AND sender_type = 'visitor' AND read_at IS NULL")
            ->execute([$sessionId]);
    }
    if ($maxUnread > 0) {
        broadcastReadToDO($sessionId, 'shop', $maxUnread);
    }
    ok(['last_read_id' => $maxUnread]);
}

/**
 * cast-inbox-reply: 自分宛セッションに返信 (URL-token auth).
 */
function handleCastInboxReply(): void {
    $token = trim((string)inp('inbox_token', ''));
    $sc = resolveCastInboxToken($token);
    if (!$sc) err('invalid or revoked inbox_token', 403);

    $deviceToken = trim((string)inp('device_token', ''));
    if (!verifyCastInboxDevice($sc['shop_cast_id'], $deviceToken)) err('端末が登録されていません', 403);

    $sessionId   = (int)inp('session_id', 0);
    $msg         = trim((string)inp('message', ''));
    $clientMsgId = (string)inp('client_msg_id', '');
    $sinceId     = (int)inp('since_id', 0);

    if ($sessionId <= 0) err('session_id required');
    if ($msg === '') err('message required');
    if (mb_strlen($msg) > 1000) err('メッセージが長すぎます');
    if ($clientMsgId !== '' && !isValidClientMsgId($clientMsgId)) err('invalid client_msg_id');

    $pdo = DB::conn();

    // セッション検証 (自分宛であること)
    $stmt = $pdo->prepare(
        'SELECT id, shop_id, cast_id, status FROM chat_sessions
         WHERE id = ? AND shop_id = ? AND cast_id = ? LIMIT 1'
    );
    $stmt->execute([$sessionId, $sc['shop_id'], $sc['cast_id']]);
    $session = $stmt->fetch();
    if (!$session) err('担当セッションではありません', 404);
    if ($session['status'] === 'closed') err('セッションは終了しています', 410);

    // 冪等
    if ($clientMsgId !== '') {
        $stmt = $pdo->prepare(
            "SELECT id FROM chat_messages
             WHERE client_msg_id = ? AND session_id = ? AND sender_type = 'shop' LIMIT 1"
        );
        $stmt->execute([$clientMsgId, $sessionId]);
        $existingId = (int)$stmt->fetchColumn();
        if ($existingId) {
            respondOwnerBatch($pdo, $sessionId, (string)$sc['shop_id'], $sinceId, ['message_id' => $existingId, 'client_msg_id' => $clientMsgId, 'duplicate' => true]);
            return;
        }
    }

    try {
        $stmt = $pdo->prepare(
            "INSERT INTO chat_messages (session_id, sender_type, message, source_lang, client_msg_id)
             VALUES (?, 'shop', ?, 'ja', ?)"
        );
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

    respondOwnerBatch($pdo, $sessionId, (string)$sc['shop_id'], $sinceId, ['message_id' => $messageId, 'client_msg_id' => $clientMsgId ?: null]);
}

/**
 * cast-inbox-close: 自分宛セッションを終了 (URL-token auth).
 */
function handleCastInboxClose(): void {
    $token = trim((string)inp('inbox_token', ''));
    $sc = resolveCastInboxToken($token);
    if (!$sc) err('invalid or revoked inbox_token', 403);

    $deviceToken = trim((string)inp('device_token', ''));
    if (!verifyCastInboxDevice($sc['shop_cast_id'], $deviceToken)) err('端末が登録されていません', 403);

    $sessionId = (int)inp('session_id', 0);
    if ($sessionId <= 0) err('session_id required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT id FROM chat_sessions WHERE id = ? AND shop_id = ? AND cast_id = ? LIMIT 1'
    );
    $stmt->execute([$sessionId, $sc['shop_id'], $sc['cast_id']]);
    if (!$stmt->fetchColumn()) err('Session not found', 404);

    $pdo->prepare("UPDATE chat_sessions SET status = 'closed', closed_at = NOW() WHERE id = ?")
        ->execute([$sessionId]);

    ok(['closed' => true]);
}

/**
 * cast-inbox-toggle-notify: 通知ON/OFF (URL-token auth).
 */
function handleCastInboxToggleNotify(): void {
    $token = trim((string)inp('inbox_token', ''));
    $sc = resolveCastInboxToken($token);
    if (!$sc) err('invalid or revoked inbox_token', 403);

    $deviceToken = trim((string)inp('device_token', ''));
    if (!verifyCastInboxDevice($sc['shop_cast_id'], $deviceToken)) err('端末が登録されていません', 403);

    $enabled = (int)inp('enabled', 0);
    $currentMode = (string)($sc['chat_notify_mode'] ?? 'off');
    if ($enabled === 1) {
        $newMode = $currentMode === 'off' ? 'first' : $currentMode;
    } else {
        $newMode = 'off';
    }

    $pdo = DB::conn();
    $pdo->prepare('UPDATE shop_casts SET chat_notify_mode = ? WHERE id = ?')
        ->execute([$newMode, $sc['shop_cast_id']]);

    ok([
        'cast_notify_mode' => $newMode,
        'notify_enabled'   => $newMode !== 'off',
    ]);
}

/* =========================================================
 * キャスト受信箱 端末登録 (cast_inbox_devices)
 * ---------------------------------------------------------
 * ?cast_inbox=<uuid> URL だけで開けるのはセキュリティ甘いため、URL + device_token の2要素認証化.
 * 初回: キャスト登録メール宛に6桁コード → 検証 → device_token 発行 → localStorage 保存.
 * 2回目以降: URL + localStorage の device_token で受信箱直行.
 * =========================================================
 */
function verifyCastInboxDevice(string $shopCastId, string $deviceToken): bool {
    if ($deviceToken === '' || !preg_match('/^[a-f0-9]{32,64}$/i', $deviceToken)) return false;
    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT id FROM cast_inbox_devices WHERE shop_cast_id = ? AND device_token = ? LIMIT 1');
    $stmt->execute([$shopCastId, $deviceToken]);
    if (!$stmt->fetch()) return false;
    $pdo->prepare('UPDATE cast_inbox_devices SET last_accessed_at = NOW() WHERE device_token = ?')
        ->execute([$deviceToken]);
    return true;
}

function maskCastEmail(string $email): string {
    if (!preg_match('/^(.+)@(.+)$/', $email, $m)) return '***';
    $local = $m[1]; $domain = $m[2];
    $len = mb_strlen($local);
    if ($len <= 2) $maskedLocal = mb_substr($local, 0, 1) . '*';
    else $maskedLocal = mb_substr($local, 0, 1) . str_repeat('*', $len - 2) . mb_substr($local, -1);
    return $maskedLocal . '@' . $domain;
}

function sendCastInboxAuthMail(string $to, string $displayName, string $code): void {
    $subject = '[YobuHo] 受信箱 端末認証コード';
    $body  = "キャスト: {$displayName}\n";
    $body .= "\n受信箱を開く端末の認証コードです:\n\n";
    $body .= "    {$code}\n\n";
    $body .= "（15分間有効 / 5回間違えると再送信が必要）\n\n";
    $body .= "心当たりがない場合、URLが流出している可能性があります。\n";
    $body .= "所属店舗のオーナーに連絡し、受信箱URLを再発行してもらってください。\n\n";
    $body .= "YobuHo Cast\nhttps://yobuho.com/cast-admin.html\n";

    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $headers = [
        'From: YobuHo <hotel@yobuho.com>',
        'Reply-To: hotel@yobuho.com',
        'Content-Type: text/plain; charset=UTF-8',
        'MIME-Version: 1.0',
    ];
    @mail($to, $encodedSubject, $body, implode("\r\n", $headers), '-f hotel@yobuho.com');
}

/**
 * cast-inbox-request-code: 認証コード発行 + キャストの登録メール宛に送信.
 * レート制限: 60秒以内の連続リクエスト不可.
 */
function handleCastInboxRequestCode(): void {
    $token = trim((string)inp('inbox_token', ''));
    $sc = resolveCastInboxToken($token);
    if (!$sc) err('invalid or revoked inbox_token', 403);

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT email FROM casts WHERE id = ? LIMIT 1');
    $stmt->execute([$sc['cast_id']]);
    $email = (string)$stmt->fetchColumn();
    if ($email === '') err('cast email not found', 500);

    // レート制限: 既存コードが60秒以内に発行されていたら拒否
    $stmt = $pdo->prepare('SELECT created_at FROM cast_inbox_codes WHERE shop_cast_id = ? LIMIT 1');
    $stmt->execute([$sc['shop_cast_id']]);
    $existing = $stmt->fetch();
    if ($existing && strtotime($existing['created_at']) > (time() - 60)) {
        err('連続リクエストは60秒後にお試しください', 429);
    }

    $code = sprintf('%06d', random_int(0, 999999));
    $expiresAt = date('Y-m-d H:i:s', time() + 15 * 60);

    $pdo->prepare(
        'INSERT INTO cast_inbox_codes (shop_cast_id, code, expires_at, attempts, created_at)
         VALUES (?, ?, ?, 0, NOW())
         ON DUPLICATE KEY UPDATE code = VALUES(code), expires_at = VALUES(expires_at), attempts = 0, created_at = NOW()'
    )->execute([$sc['shop_cast_id'], $code, $expiresAt]);

    sendCastInboxAuthMail($email, $sc['display_name'], $code);

    ok([
        'sent' => true,
        'masked_email' => maskCastEmail($email),
        'expires_in_sec' => 900,
    ]);
}

/**
 * cast-inbox-verify-code: コード検証 + device_token 発行.
 */
function handleCastInboxVerifyCode(): void {
    $token = trim((string)inp('inbox_token', ''));
    $sc = resolveCastInboxToken($token);
    if (!$sc) err('invalid or revoked inbox_token', 403);

    $code = trim((string)inp('code', ''));
    $deviceName = trim((string)inp('device_name', 'ブラウザ'));
    if (!preg_match('/^\d{6}$/', $code)) err('コードは6桁の数字です');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT code, expires_at, attempts FROM cast_inbox_codes WHERE shop_cast_id = ? LIMIT 1');
    $stmt->execute([$sc['shop_cast_id']]);
    $row = $stmt->fetch();
    if (!$row) err('認証コードが発行されていません。再送信してください', 400);
    if (strtotime($row['expires_at']) < time()) err('コードの有効期限が切れています。再送信してください', 400);
    if ((int)$row['attempts'] >= 5) err('試行回数の上限です。コードを再送信してください', 400);

    if (!hash_equals((string)$row['code'], $code)) {
        $pdo->prepare('UPDATE cast_inbox_codes SET attempts = attempts + 1 WHERE shop_cast_id = ?')
            ->execute([$sc['shop_cast_id']]);
        err('コードが違います', 400);
    }

    $deviceToken = bin2hex(random_bytes(24));
    $pdo->prepare(
        'INSERT INTO cast_inbox_devices (shop_cast_id, device_token, device_name, last_accessed_at)
         VALUES (?, ?, ?, NOW())'
    )->execute([$sc['shop_cast_id'], $deviceToken, mb_substr($deviceName, 0, 100)]);

    $pdo->prepare('DELETE FROM cast_inbox_codes WHERE shop_cast_id = ?')->execute([$sc['shop_cast_id']]);

    ok(['device_token' => $deviceToken]);
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

    // 既読ルール (2026-04-23 ゼロ設計): owner-reply 経路で visitor msg を自動既読しない.
    // 返信=既読とは限らない (通知だけ見て返信するケース). 既読は view signal 経由のみ.

    $stmt = $pdo->prepare("SELECT COALESCE(MAX(id),0) FROM chat_messages
                           WHERE session_id = ? AND sender_type = 'shop' AND read_at IS NOT NULL");
    $stmt->execute([$sessionId]);
    $lastReadOwnId = (int)$stmt->fetchColumn();

    $stmt = $pdo->prepare('SELECT status, visitor_typing_until FROM chat_sessions WHERE id = ? LIMIT 1');
    $stmt->execute([$sessionId]);
    $sessRow = $stmt->fetch();
    $status = ($sessRow['status'] ?? null) ?: 'open';
    $otherTyping = !empty($sessRow['visitor_typing_until']) && strtotime((string)$sessRow['visitor_typing_until']) > time();

    // DO broadcast: INSERT直後のみ（owner/cast_view/cast_inbox reply path）。duplicate pathはスキップ.
    if (!empty($extra['message_id']) && empty($extra['duplicate'])) {
        $newId = (int)$extra['message_id'];
        foreach ($messages as $m) {
            if ((int)$m['id'] === $newId) {
                broadcastMessageToDO((string)$shopId, (int)$sessionId, $m);
                // HTTP owner-reply 経路は DO driven の visitor メール通知が発火しない.
                // ここで直接 chat-notify-visitor.php を叩く (verified/cooldown/opt-in は PHP 側が判定).
                if (($m['sender_type'] ?? '') === 'shop') {
                    sendVisitorEmailNotificationFromPhp((int)$sessionId, $m);
                }
                break;
            }
        }
        // Day 8: 返信した shop 側の typing を即時クリア + #3: 相手側にも stop を push
        $pdo->prepare('UPDATE chat_sessions SET shop_typing_until = NULL WHERE id = ?')->execute([$sessionId]);
        broadcastTypingToDO((int)$sessionId, 'shop', false);
    }

    okBatch(array_merge($extra, [
        'messages' => $messages,
        'last_read_own_id' => $lastReadOwnId,
        'status' => $status,
        'shop_online' => true,
        'other_typing' => (bool)$otherTyping,
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
 * オーナー画面を閉じた時などに呼ばれる。
 * A案ルール: 🟢 表示は notify_mode（受付トグル）のみで決まる。
 * notify_mode='off' の時だけ is_online=0 に揃える（不整合の補正目的）。
 * notify_mode != 'off' ならオーナー不在でも is_online=1 を維持する。
 */
function handleOwnerGoOffline() {
    $device = requireDevice();
    DB::conn()->prepare(
        "UPDATE shop_chat_status SET is_online = IF(notify_mode = 'off', 0, 1) WHERE shop_id = ?"
    )->execute([$device['shop_id']]);
    $stmt = DB::conn()->prepare('SELECT is_online FROM shop_chat_status WHERE shop_id = ?');
    $stmt->execute([$device['shop_id']]);
    ok(['is_online' => ((int)$stmt->fetchColumn()) === 1]);
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

// =========================================================
// 統一送信エンドポイント (/api/chat-send.php → action=send)
// ---------------------------------------------------------
// 4種の認証 (visitor / owner / cast_view / cast_inbox) を auth.kind で束ね、
// 既存の 4 ハンドラへルーティングする. PHPが MySQL への書き込みを完結させ、
// その後 DO /broadcast へリレーして、接続中の他クライアントへ WS push させる.
//
// 既存4エンドポイント (send-message / owner-reply / cast-url-reply / cast-inbox-reply) も
// そのまま動く ── 本エンドポイントは「単一入口」オプションを提供する.
// =========================================================
/**
 * Day 8: typing indicator. #3: 信頼性強化 (DO push + stop signal).
 * 全4 auth (visitor/owner/cast_view/cast_inbox) を統一受付.
 *
 * stop=false (default): 6秒後に自然減衰する typing_until 列を NOW()+6s にセット + DO push(typing=true).
 * stop=true:            typing_until を NULL に + DO push(typing=false) で相手側に即時停止を通知.
 *
 * クライアントは ~3秒間隔で再送、打ち終わり/送信/blur/unload 時に stop=true を送る.
 */
function handleSetTyping(): void {
    global $body;
    $auth = inp('auth', []);
    if (!is_array($auth)) err('auth required');
    $kind = (string)($auth['kind'] ?? '');
    $stop = !!inp('stop', false);
    $pdo = DB::conn();

    // typing 列を SET 用の SQL 断片 (stop=true なら NULL, false なら NOW()+6s)
    $sqlVal = $stop ? 'NULL' : 'DATE_ADD(NOW(), INTERVAL 6 SECOND)';
    // broadcast する typing フラグ
    $broadcastTyping = !$stop;

    switch ($kind) {
        case 'visitor': {
            $token = trim((string)($auth['session_token'] ?? ''));
            if ($token === '') err('session_token required');
            $stmt = $pdo->prepare('SELECT id FROM chat_sessions WHERE session_token = ? LIMIT 1');
            $stmt->execute([$token]);
            $id = (int)$stmt->fetchColumn();
            if (!$id) err('Session not found', 404);
            $pdo->prepare("UPDATE chat_sessions SET visitor_typing_until = $sqlVal WHERE id = ?")
                ->execute([$id]);
            broadcastTypingToDO($id, 'visitor', $broadcastTyping);
            ok([]);
            return;
        }
        case 'cast_view': {
            $token = trim((string)($auth['session_token'] ?? ''));
            $shopCastId = trim((string)($auth['shop_cast_id'] ?? ''));
            if ($token === '' || $shopCastId === '') err('auth fields missing');
            $stmt = $pdo->prepare(
                'SELECT s.id FROM chat_sessions s
                 JOIN shop_casts sc ON sc.cast_id = s.cast_id AND sc.shop_id = s.shop_id
                 WHERE s.session_token = ? AND sc.id = ? AND sc.status = "active" LIMIT 1'
            );
            $stmt->execute([$token, $shopCastId]);
            $id = (int)$stmt->fetchColumn();
            if (!$id) err('auth failed', 403);
            $pdo->prepare("UPDATE chat_sessions SET shop_typing_until = $sqlVal WHERE id = ?")
                ->execute([$id]);
            broadcastTypingToDO($id, 'shop', $broadcastTyping);
            ok([]);
            return;
        }
        case 'owner': {
            if (!empty($auth['device_token'])) $body['device_token'] = $auth['device_token'];
            $device = requireDevice();
            $sessionId = (int)($auth['session_id'] ?? inp('session_id', 0));
            if ($sessionId <= 0) err('session_id required');
            $stmt = $pdo->prepare('SELECT 1 FROM chat_sessions WHERE id = ? AND shop_id = ? LIMIT 1');
            $stmt->execute([$sessionId, $device['shop_id']]);
            if (!$stmt->fetchColumn()) err('auth failed', 403);
            $pdo->prepare("UPDATE chat_sessions SET shop_typing_until = $sqlVal WHERE id = ?")
                ->execute([$sessionId]);
            broadcastTypingToDO($sessionId, 'shop', $broadcastTyping);
            ok([]);
            return;
        }
        case 'cast_inbox': {
            $inbox = trim((string)($auth['inbox_token'] ?? ''));
            $deviceToken = trim((string)($auth['device_token'] ?? ''));
            $sessionId = (int)($auth['session_id'] ?? 0);
            if ($sessionId <= 0) err('session_id required');
            $sc = resolveCastInboxToken($inbox);
            if (!$sc) err('invalid inbox_token', 403);
            if (!verifyCastInboxDevice($sc['shop_cast_id'], $deviceToken)) err('device not registered', 403);
            $stmt = $pdo->prepare('SELECT 1 FROM chat_sessions WHERE id = ? AND shop_id = ? AND cast_id = ? LIMIT 1');
            $stmt->execute([$sessionId, $sc['shop_id'], $sc['cast_id']]);
            if (!$stmt->fetchColumn()) err('auth failed', 403);
            $pdo->prepare("UPDATE chat_sessions SET shop_typing_until = $sqlVal WHERE id = ?")
                ->execute([$sessionId]);
            broadcastTypingToDO($sessionId, 'shop', $broadcastTyping);
            ok([]);
            return;
        }
    }
    err('invalid auth.kind');
}

// =========================================================
// Web Push (Day 9): VAPID公開鍵配布 + 購読登録 / 解除
// ---------------------------------------------------------
// subject_type + subject_id で通知先を識別:
//   shop    -> shop_id
//   cast    -> shop_cast_id  (casts.id は内部キーなので使わない)
//   visitor -> session_token (chat_sessions.session_token, UUID36)
// endpoint_hash (sha256 hex) で UNIQUE, 再購読は UPSERT.
// =========================================================
function handlePushConfig(): void {
    $key = defined('VAPID_PUBLIC_KEY') ? (string)VAPID_PUBLIC_KEY : '';
    if ($key === '') { ok(['enabled' => false]); return; }
    ok(['enabled' => true, 'public_key' => $key]);
}

function resolvePushSubject(array $auth): ?array {
    global $body;
    $kind = (string)($auth['kind'] ?? '');
    $pdo = DB::conn();

    switch ($kind) {
        case 'visitor': {
            $token = trim((string)($auth['session_token'] ?? ''));
            if ($token === '') return null;
            $stmt = $pdo->prepare('SELECT session_token FROM chat_sessions WHERE session_token = ? LIMIT 1');
            $stmt->execute([$token]);
            $t = (string)($stmt->fetchColumn() ?: '');
            if ($t === '') return null;
            return ['type' => 'visitor', 'id' => $t, 'device_token' => null];
        }
        case 'cast_view': {
            $token = trim((string)($auth['session_token'] ?? ''));
            $shopCastId = trim((string)($auth['shop_cast_id'] ?? ''));
            if ($token === '' || $shopCastId === '') return null;
            $stmt = $pdo->prepare(
                'SELECT sc.id FROM chat_sessions s
                 JOIN shop_casts sc ON sc.cast_id = s.cast_id AND sc.shop_id = s.shop_id
                 WHERE s.session_token = ? AND sc.id = ? AND sc.status = "active" LIMIT 1'
            );
            $stmt->execute([$token, $shopCastId]);
            $id = (string)($stmt->fetchColumn() ?: '');
            if ($id === '') return null;
            return ['type' => 'cast', 'id' => $id, 'device_token' => null];
        }
        case 'owner': {
            if (!empty($auth['device_token'])) $body['device_token'] = $auth['device_token'];
            $device = verifyDevice((string)inp('device_token', ''));
            if (!$device) return null;
            return ['type' => 'shop', 'id' => (string)$device['shop_id'], 'device_token' => (string)inp('device_token', '')];
        }
        case 'cast_inbox': {
            $inbox = trim((string)($auth['inbox_token'] ?? ''));
            $deviceToken = trim((string)($auth['device_token'] ?? ''));
            $sc = resolveCastInboxToken($inbox);
            if (!$sc) return null;
            if (!verifyCastInboxDevice($sc['shop_cast_id'], $deviceToken)) return null;
            return ['type' => 'cast', 'id' => (string)$sc['shop_cast_id'], 'device_token' => $deviceToken];
        }
    }
    return null;
}

function handlePushSubscribe(): void {
    $auth = inp('auth', []);
    if (!is_array($auth)) err('auth required');

    $sub = inp('subscription', []);
    if (!is_array($sub)) err('subscription required');
    $endpoint = trim((string)($sub['endpoint'] ?? ''));
    $keys = (array)($sub['keys'] ?? []);
    $p256dh = trim((string)($keys['p256dh'] ?? ''));
    $authKey = trim((string)($keys['auth'] ?? ''));
    if ($endpoint === '' || $p256dh === '' || $authKey === '') err('invalid subscription');
    if (!preg_match('#^https?://#', $endpoint)) err('invalid endpoint');
    if (strlen($endpoint) > 2000) err('endpoint too long');

    $subject = resolvePushSubject($auth);
    if (!$subject) err('auth failed', 403);

    $hash = hash('sha256', $endpoint);
    $ua = substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);

    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'INSERT INTO web_push_subscriptions
            (subject_type, subject_id, device_token, endpoint, endpoint_hash, p256dh, auth, ua, last_success_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE
            subject_type = VALUES(subject_type),
            subject_id   = VALUES(subject_id),
            device_token = VALUES(device_token),
            p256dh       = VALUES(p256dh),
            auth         = VALUES(auth),
            ua           = VALUES(ua),
            failure_count = 0,
            updated_at   = CURRENT_TIMESTAMP'
    );
    $stmt->execute([
        $subject['type'],
        $subject['id'],
        $subject['device_token'],
        $endpoint,
        $hash,
        $p256dh,
        $authKey,
        $ua,
    ]);

    ok(['endpoint_hash' => $hash]);
}

function handlePushUnsubscribe(): void {
    $auth = inp('auth', []);
    if (!is_array($auth)) err('auth required');

    $endpoint = trim((string)inp('endpoint', ''));
    $endpointHash = trim((string)inp('endpoint_hash', ''));
    if ($endpoint === '' && $endpointHash === '') err('endpoint or endpoint_hash required');

    $subject = resolvePushSubject($auth);
    if (!$subject) err('auth failed', 403);

    $hash = $endpointHash !== '' ? $endpointHash : hash('sha256', $endpoint);

    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'DELETE FROM web_push_subscriptions
         WHERE endpoint_hash = ? AND subject_type = ? AND subject_id = ?'
    );
    $stmt->execute([$hash, $subject['type'], $subject['id']]);
    ok(['deleted' => $stmt->rowCount()]);
}

// ----- DO→PHP: Web Push 送信時に購読者を返す / 失効エンドポイントを削除 -----
// 認証: X-Sync-Secret (wrangler secret CHAT_SYNC_SECRET と共有)

function assertSyncSecret(): void {
    $expected = defined('CHAT_SYNC_SECRET') ? CHAT_SYNC_SECRET : '';
    $provided = $_SERVER['HTTP_X_SYNC_SECRET'] ?? '';
    if (!$expected || !hash_equals($expected, $provided)) {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'forbidden']);
        exit;
    }
}

function handleFetchPushSubscribers(): void {
    assertSyncSecret();

    $subjectType = trim((string)inp('subject_type', ''));
    $subjectId = trim((string)inp('subject_id', ''));
    if (!in_array($subjectType, ['shop', 'cast', 'visitor'], true)) err('invalid subject_type');
    if ($subjectId === '') err('subject_id required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT endpoint, endpoint_hash, p256dh, auth
         FROM web_push_subscriptions
         WHERE subject_type = ? AND subject_id = ?
         LIMIT 200'
    );
    $stmt->execute([$subjectType, $subjectId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    ok(['subscribers' => $rows]);
}

function handlePushUnsubscribeByEndpoint(): void {
    assertSyncSecret();

    $hash = trim((string)inp('endpoint_hash', ''));
    if ($hash === '') err('endpoint_hash required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare('DELETE FROM web_push_subscriptions WHERE endpoint_hash = ?');
    $stmt->execute([$hash]);
    ok(['deleted' => $stmt->rowCount()]);
}

// ----- Visitor email notify -----
// visitor_notify_enabled=1 の chat_sessions に対し、オーナー返信時に DO が chat-notify-visitor.php を呼ぶ

function handleVisitorNotifySettings(): void {
    $token = trim((string)inp('session_token', ''));
    $email = trim((string)inp('email', ''));
    $enabled = inp('enabled', null);
    if ($token === '') err('session_token required');
    if ($enabled === null) err('enabled required');
    $enabledInt = (int)(bool)$enabled;

    if ($enabledInt === 1) {
        if ($email === '') err('メールアドレスを入力してください');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) err('メールアドレスの形式が正しくありません');
        if (strlen($email) > 255) err('メールアドレスが長すぎます');
    }

    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT id, visitor_email, visitor_email_verified
         FROM chat_sessions WHERE session_token = ? LIMIT 1'
    );
    $stmt->execute([$token]);
    $session = $stmt->fetch();
    if (!$session) err('Session not found', 404);

    if ($enabledInt === 0) {
        // OFF: メール/verified は保持 (再度ON時に再入力 or 再verify不要)
        $upd = $pdo->prepare(
            'UPDATE chat_sessions SET visitor_notify_enabled = 0 WHERE id = ?'
        );
        $upd->execute([$session['id']]);
        ok(['enabled' => false, 'email' => (string)($session['visitor_email'] ?? ''), 'verified' => (int)($session['visitor_email_verified'] ?? 0) === 1]);
        return;
    }

    // ON
    $oldEmail = trim((string)($session['visitor_email'] ?? ''));
    $oldVerified = (int)($session['visitor_email_verified'] ?? 0) === 1;
    $emailUnchanged = ($email !== '' && strcasecmp($email, $oldEmail) === 0);

    if ($emailUnchanged && $oldVerified) {
        // 同一メール＋確認済み: enable=1 にするだけ. 確認メールは送らない.
        $upd = $pdo->prepare(
            'UPDATE chat_sessions
             SET visitor_email = ?, visitor_notify_enabled = 1
             WHERE id = ?'
        );
        $upd->execute([$email, $session['id']]);
        ok([
            'enabled' => true,
            'email' => $email,
            'verified' => true,
            'verification_sent' => false,
        ]);
        return;
    }

    // 新規 or メール変更 or 未確認 → トークン発行＋確認メール送信
    $verifyToken = bin2hex(random_bytes(32));
    $expiresAt = date('Y-m-d H:i:s', time() + 24 * 3600);

    $upd = $pdo->prepare(
        'UPDATE chat_sessions
         SET visitor_email = ?,
             visitor_notify_enabled = 1,
             visitor_email_verified = 0,
             visitor_email_verify_token = ?,
             visitor_email_verify_expires_at = ?
         WHERE id = ?'
    );
    $upd->execute([$email, $verifyToken, $expiresAt, $session['id']]);

    // 店舗 slug を取得してメールに含める (チャット復帰URLの為)
    $shopSlug = fetchSessionShopSlug((int)$session['id']);

    $mailOk = sendVisitorEmailVerification($email, $verifyToken, $shopSlug, $token);
    if (!$mailOk) {
        // メール送信失敗: トークンはロールバックせず残す (resend で再送可能) が verified=0
        err('確認メールの送信に失敗しました。しばらく経ってから再度お試しください', 500);
    }

    ok([
        'enabled' => true,
        'email' => $email,
        'verified' => false,
        'verification_sent' => true,
    ]);
}

// Resend: 既に保存済みの email を再確認する (UIの「確認メールを再送」ボタン).
// Session に紐付くメールが既にある場合のみ、新トークン発行＋再送信.
function handleResendVisitorEmailVerify(): void {
    $token = trim((string)inp('session_token', ''));
    if ($token === '') err('session_token required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT id, visitor_email, visitor_email_verified
         FROM chat_sessions WHERE session_token = ? LIMIT 1'
    );
    $stmt->execute([$token]);
    $session = $stmt->fetch();
    if (!$session) err('Session not found', 404);

    $email = trim((string)($session['visitor_email'] ?? ''));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        err('メールアドレスが未登録です');
    }
    if ((int)($session['visitor_email_verified'] ?? 0) === 1) {
        // 既に確認済み: 何もせず ok
        ok(['verified' => true, 'verification_sent' => false]);
        return;
    }

    $verifyToken = bin2hex(random_bytes(32));
    $expiresAt = date('Y-m-d H:i:s', time() + 24 * 3600);

    $upd = $pdo->prepare(
        'UPDATE chat_sessions
         SET visitor_email_verify_token = ?,
             visitor_email_verify_expires_at = ?
         WHERE id = ?'
    );
    $upd->execute([$verifyToken, $expiresAt, $session['id']]);

    $shopSlug = fetchSessionShopSlug((int)$session['id']);
    $mailOk = sendVisitorEmailVerification($email, $verifyToken, $shopSlug, $token);
    if (!$mailOk) err('確認メールの送信に失敗しました。しばらく経ってから再度お試しください', 500);

    ok(['verified' => false, 'verification_sent' => true]);
}

// session_id から店舗 slug を取得 (確認メール本文のチャットURL生成用).
function fetchSessionShopSlug(int $sessionId): string {
    try {
        $pdo = DB::conn();
        $stmt = $pdo->prepare(
            'SELECT sh.slug
             FROM chat_sessions cs
             JOIN shops sh ON sh.id = cs.shop_id
             WHERE cs.id = ? LIMIT 1'
        );
        $stmt->execute([$sessionId]);
        return (string)($stmt->fetchColumn() ?: '');
    } catch (Throwable $_) {
        return '';
    }
}

// 訪問者に対し「このメールアドレスの確認」Magic Link を送信する.
// 目的: 他人のメール入力によるハラスメント通知の防止 (Apple/Slack/Notion 方式).
function sendVisitorEmailVerification(string $email, string $verifyToken, string $shopSlug, string $sessionToken): bool {
    $baseUrl = 'https://yobuho.com';
    $verifyUrl = $baseUrl . '/api/verify-visitor-email.php?token=' . rawurlencode($verifyToken);

    // 万が一確認完了後に自分のチャットに戻りやすいよう resume 用URLも添える.
    $resumeUrl = '';
    if ($shopSlug !== '') {
        $resumeUrl = $baseUrl . '/chat/' . rawurlencode($shopSlug) . '/?resume=' . rawurlencode($sessionToken);
    }

    $subject = '[YobuChat] メールアドレスの確認';

    $escVerify = htmlspecialchars($verifyUrl, ENT_QUOTES, 'UTF-8');
    $escResume = htmlspecialchars($resumeUrl, ENT_QUOTES, 'UTF-8');

    $resumeBlock = '';
    if ($resumeUrl !== '') {
        $resumeBlock = <<<HTML
<p style="margin-top: 20px; font-size: 13px; color: #888;">
確認後、元のチャットに戻る: <a href="{$escResume}">YobuChat を開く</a>
</p>
HTML;
    }

    $htmlBody = <<<HTML
<!DOCTYPE html>
<html lang="ja"><body style="font-family: sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
<p style="font-size: 15px;">YobuChat でこのメールアドレスを通知先に登録する手続きです。</p>
<p style="font-size: 14px;">下記のボタンをクリックして確認を完了してください。確認が完了するまで通知メールは送信されません。</p>
<p style="margin: 28px 0; text-align: center;">
<a href="{$escVerify}" style="display: inline-block; background: #b5627a; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 15px;">メールアドレスを確認する</a>
</p>
<p style="font-size: 13px; color: #666;">ボタンが押せない場合はこちらのURLをブラウザで開いてください:<br>
<a href="{$escVerify}" style="word-break: break-all;">{$escVerify}</a></p>
<p style="font-size: 13px; color: #888; margin-top: 20px;">このリンクは <strong>24時間</strong> 有効です。期限が切れた場合は YobuChat の通知設定から再度保存してください。</p>
<hr style="border: none; border-top: 1px solid #ddd; margin: 32px 0;">
<p style="font-size: 12px; color: #888;">
このメールに心当たりがない場合は破棄してください。確認されない限り通知メールは送信されません。
</p>
{$resumeBlock}
</body></html>
HTML;

    return sendTransactionalMail($email, $subject, $htmlBody);
}

// 訪問者 → 自分の通知設定を取得 (chat.js UI 初期化用).
// 認証: session_token のみ (visitor のみ所持).
function handleMyNotifySettings(): void {
    $token = trim((string)inp('session_token', ''));
    if ($token === '') err('session_token required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT visitor_email, visitor_notify_enabled,
                visitor_email_verified, visitor_email_verify_expires_at
         FROM chat_sessions WHERE session_token = ? LIMIT 1'
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch();
    if (!$row) err('Session not found', 404);

    $email = (string)($row['visitor_email'] ?? '');
    $enabled = (int)$row['visitor_notify_enabled'] === 1;
    $verified = (int)($row['visitor_email_verified'] ?? 0) === 1;
    // メール登録済みで未確認なら pending (確認メール送信済みの状態).
    $pending = ($email !== '' && !$verified);

    ok([
        'email' => $email,
        'enabled' => $enabled,
        'verified' => $verified,
        'pending' => $pending,
    ]);
}

// DO → PHP: セッションの visitor_email / 通知設定を返す (オーナー返信時のメール送信判定用)
// 認証: X-Sync-Secret
function handleFetchVisitorNotify(): void {
    assertSyncSecret();

    $token = trim((string)inp('session_token', ''));
    if ($token === '') err('session_token required');

    $pdo = DB::conn();
    $stmt = $pdo->prepare(
        'SELECT visitor_email, visitor_notify_enabled, visitor_last_notified_at, visitor_email_verified
         FROM chat_sessions WHERE session_token = ? LIMIT 1'
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch();
    if (!$row) err('Session not found', 404);

    ok([
        'email' => (string)($row['visitor_email'] ?? ''),
        'enabled' => (int)$row['visitor_notify_enabled'] === 1,
        'verified' => (int)($row['visitor_email_verified'] ?? 0) === 1,
        'last_notified_at' => $row['visitor_last_notified_at'] ?? null,
    ]);
}

function handleUnifiedSend(): void {
    global $body;
    $auth = inp('auth', []);
    if (!is_array($auth)) err('auth required');
    $kind = (string)($auth['kind'] ?? '');

    // auth 内フィールドを $body に昇格させ、既存ハンドラが inp() で拾えるようにする
    switch ($kind) {
        case 'visitor':
            // 必要フィールド: session_token (auth or top-level), message, client_msg_id, since_id, nickname?, lang?
            if (!empty($auth['session_token'])) $body['session_token'] = $auth['session_token'];
            handleSendMessage();
            return;

        case 'owner':
            // 必要フィールド: device_token (auth or top-level), session_id, message, client_msg_id, since_id
            if (!empty($auth['device_token'])) $body['device_token'] = $auth['device_token'];
            handleOwnerReply();
            return;

        case 'cast_view':
            // 必要フィールド: session_token + shop_cast_id (auth), message, client_msg_id, since_id
            if (!empty($auth['session_token']))  $body['session_token']  = $auth['session_token'];
            if (!empty($auth['shop_cast_id']))   $body['shop_cast_id']   = $auth['shop_cast_id'];
            handleCastUrlReply();
            return;

        case 'cast_inbox':
            // 必要フィールド: inbox_token + device_token (auth), session_id, message, client_msg_id, since_id
            if (!empty($auth['inbox_token']))  $body['inbox_token']  = $auth['inbox_token'];
            if (!empty($auth['device_token'])) $body['device_token'] = $auth['device_token'];
            handleCastInboxReply();
            return;

        default:
            err('invalid auth.kind');
    }
}

// =========================================================
// DO broadcast relay
// ---------------------------------------------------------
// PHPのINSERT直後に respondSessionBatch / respondOwnerBatch から呼ばれる.
// chat.yobuho.com/broadcast に {session_token, message_row} を POST.
// DO 側が接続中の WebSocket に対して role/session_token ごとに絞って push する.
//
// fire-and-forget: 失敗しても PHP 応答は遅延させない (最大 2s タイムアウト).
// X-Sync-Secret で認証 (wrangler secret CHAT_SYNC_SECRET と共有).
// =========================================================
function broadcastMessageToDO(string $shopId, int $sessionId, array $messageRow): void {
    // session_token 解決 (DO側がWS attachmentと照合するのに必須)
    static $tokenCache = [];
    if (!isset($tokenCache[$sessionId])) {
        $pdo = DB::conn();
        $stmt = $pdo->prepare('SELECT session_token FROM chat_sessions WHERE id = ? LIMIT 1');
        $stmt->execute([$sessionId]);
        $tokenCache[$sessionId] = (string)($stmt->fetchColumn() ?: '');
    }
    $token = $tokenCache[$sessionId];
    if ($token === '' || $shopId === '') return;

    broadcastToDO($shopId, $token, $messageRow);
}

function broadcastToDO(string $shopId, string $sessionToken, array $messageRow): void {
    $secret = defined('CHAT_SYNC_SECRET') ? CHAT_SYNC_SECRET : '';
    if (!$secret) return;

    $doBase = defined('CHAT_DO_BASE_URL') ? CHAT_DO_BASE_URL : 'https://chat.yobuho.com';
    $url = $doBase . '/broadcast?shop_id=' . urlencode($shopId);
    $payload = [
        'session_token' => $sessionToken,
        'message_row'   => $messageRow,
    ];
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'X-Sync-Secret: ' . $secret,
        ],
        CURLOPT_CONNECTTIMEOUT => 1,
        CURLOPT_TIMEOUT        => 2,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_NOSIGNAL       => true,
    ]);
    @curl_exec($ch);
    $errno = curl_errno($ch);
    if ($errno) {
        error_log('[chat-api] DO broadcast failed: ' . curl_error($ch));
    }
    curl_close($ch);
}

/**
 * HTTP owner-reply 経路から訪問者宛メール通知を発火する.
 * DO WebSocket 経路 (cf-worker/src/ChatRoom.ts:1131) と等価の PHP 版.
 * chat-notify-visitor.php が verified / cooldown / opt-in を判定するため,
 * ここは payload 組み立てと HTTP POST のみ行う.
 */
function sendVisitorEmailNotificationFromPhp(int $sessionId, array $newMessage): void {
    $secret = defined('CHAT_NOTIFY_SECRET') ? CHAT_NOTIFY_SECRET : '';
    if (!$secret) return;
    $notifyBase = defined('CHAT_NOTIFY_BASE_URL') ? CHAT_NOTIFY_BASE_URL : 'https://yobuho.com';

    try {
        $pdo = DB::conn();
        $stmt = $pdo->prepare(
            'SELECT cs.session_token, cs.shop_id, cs.cast_id, s.shop_name, s.slug
             FROM chat_sessions cs
             JOIN shops s ON s.id = cs.shop_id
             WHERE cs.id = ? LIMIT 1'
        );
        $stmt->execute([$sessionId]);
        $row = $stmt->fetch();
        if (!$row) return;

        $castName = null;
        $shopCastId = null;
        if (!empty($row['cast_id'])) {
            // chat_sessions.cast_id は casts.id を保持. ?cast= URL が期待する shop_casts.id を解決.
            $stmt = $pdo->prepare(
                'SELECT id, display_name FROM shop_casts
                 WHERE shop_id = ? AND cast_id = ? AND deleted_at IS NULL
                 LIMIT 1'
            );
            $stmt->execute([$row['shop_id'], $row['cast_id']]);
            $cast = $stmt->fetch();
            if ($cast) {
                $shopCastId = (string)$cast['id'];
                $castName = (string)$cast['display_name'];
            }
        }

        $payload = json_encode([
            'secret'        => $secret,
            'session_token' => (string)$row['session_token'],
            'shop_name'     => (string)$row['shop_name'],
            'shop_slug'     => (string)($row['slug'] ?? ''),
            'cast_name'     => $castName,
            'shop_cast_id'  => $shopCastId,
            'message'       => (string)($newMessage['message'] ?? ''),
            'sent_at'       => (string)($newMessage['sent_at'] ?? ''),
        ], JSON_UNESCAPED_UNICODE);

        $ch = curl_init($notifyBase . '/api/chat-notify-visitor.php');
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT        => 6,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_NOSIGNAL       => true,
        ]);
        @curl_exec($ch);
        if (curl_errno($ch)) {
            error_log('[chat-api] visitor-notify failed: ' . curl_error($ch));
        }
        curl_close($ch);
    } catch (Throwable $e) {
        error_log('[chat-api] visitor-notify exception: ' . $e->getMessage());
    }
}

/**
 * DO へ既読イベントをリレー.
 * PHP が chat_messages.read_at を UPDATE した直後に呼ぶ.
 * reader = 'shop' なら visitor WS に type:'read' 配信 (visitor に既読マーク表示)
 * reader = 'visitor' なら owner WS に type:'read' 配信 (owner に既読マーク表示)
 *
 * @param int $sessionId MySQL chat_sessions.id — session_token 解決に使用.
 * @param string $reader 'shop' | 'visitor' — 既読化を行った側.
 * @param int $upToId MySQL 側の最大既読 ID.
 */
function broadcastReadToDO(int $sessionId, string $reader, int $upToId): void {
    $secret = defined('CHAT_SYNC_SECRET') ? CHAT_SYNC_SECRET : '';
    if (!$secret) return;
    if ($reader !== 'shop' && $reader !== 'visitor') return;

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT shop_id, session_token FROM chat_sessions WHERE id = ? LIMIT 1');
    $stmt->execute([$sessionId]);
    $row = $stmt->fetch();
    if (!$row) return;
    $shopId = (string)$row['shop_id'];
    $sessionToken = (string)$row['session_token'];
    if ($shopId === '' || $sessionToken === '') return;

    $doBase = defined('CHAT_DO_BASE_URL') ? CHAT_DO_BASE_URL : 'https://chat.yobuho.com';
    $url = $doBase . '/broadcast-read?shop_id=' . urlencode($shopId);
    $payload = [
        'session_token' => $sessionToken,
        'reader'        => $reader,
        'up_to_id'      => $upToId,
    ];
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'X-Sync-Secret: ' . $secret,
        ],
        CURLOPT_CONNECTTIMEOUT => 1,
        CURLOPT_TIMEOUT        => 2,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_NOSIGNAL       => true,
    ]);
    @curl_exec($ch);
    $errno = curl_errno($ch);
    if ($errno) {
        error_log('[chat-api] DO broadcast-read failed: ' . curl_error($ch));
    }
    curl_close($ch);
}

/**
 * DO へ入力中(typing) イベントをリレー (#3).
 *
 * @param int $sessionId MySQL chat_sessions.id
 * @param string $role 'visitor'|'shop' — 打っている側 (cast_view/cast_inbox/owner は 'shop')
 * @param bool $typing true=入力中開始, false=停止
 */
function broadcastTypingToDO(int $sessionId, string $role, bool $typing): void {
    $secret = defined('CHAT_SYNC_SECRET') ? CHAT_SYNC_SECRET : '';
    if (!$secret) return;
    if ($role !== 'shop' && $role !== 'visitor') return;

    $pdo = DB::conn();
    $stmt = $pdo->prepare('SELECT shop_id, session_token FROM chat_sessions WHERE id = ? LIMIT 1');
    $stmt->execute([$sessionId]);
    $row = $stmt->fetch();
    if (!$row) return;
    $shopId = (string)$row['shop_id'];
    $sessionToken = (string)$row['session_token'];
    if ($shopId === '' || $sessionToken === '') return;

    $doBase = defined('CHAT_DO_BASE_URL') ? CHAT_DO_BASE_URL : 'https://chat.yobuho.com';
    $url = $doBase . '/broadcast-typing?shop_id=' . urlencode($shopId);
    $payload = [
        'session_token' => $sessionToken,
        'role'          => $role,
        'typing'        => $typing,
    ];
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'X-Sync-Secret: ' . $secret,
        ],
        CURLOPT_CONNECTTIMEOUT => 1,
        CURLOPT_TIMEOUT        => 2,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_NOSIGNAL       => true,
    ]);
    @curl_exec($ch);
    $errno = curl_errno($ch);
    if ($errno) {
        error_log('[chat-api] DO broadcast-typing failed: ' . curl_error($ch));
    }
    curl_close($ch);
}
