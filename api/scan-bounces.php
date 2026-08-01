<?php
// =============================================================================
// scan-bounces.php — バウンス（配信失敗）メールを解析して mail_bounces に記録
//
// 背景 (2026-08-01):
//   hotel@yobuho.com のメールボックスに溜まるバウンス通知を誰も見ておらず、
//   iCloud への配信が 6/8 から約2ヶ月間止まっていたことに気づけなかった。
//   （キャストは認証コードが届かずログイン不能、運営側は無自覚）
//   定期実行でメールボックスを走査し、失敗を管理画面に可視化する。
//
// 呼び出し方法（chat-retention.php と同じ方式）:
//   - cron: curl -s "https://yobuho.com/api/scan-bounces.php?key=<SECRET>"
//   推奨頻度: 15〜30分に1回（バウンスは送信の数秒〜数分後に返ってくる）
//
// 認証: ?key= が BOUNCE_SCAN_SECRET と一致すること。
//       未設定時は CHAT_RETENTION_SECRET を代替に使う（Secret 追加を必須にしない）。
//
// 安全性: メールボックスのファイルは読むだけで、削除も移動もしない。
//         二重登録は mail_bounces.source_file の UNIQUE 制約で防ぐ。
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/db-config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// --- 認証 ---
$secret = defined('BOUNCE_SCAN_SECRET') && BOUNCE_SCAN_SECRET !== ''
    ? BOUNCE_SCAN_SECRET
    : (defined('CHAT_RETENTION_SECRET') ? CHAT_RETENTION_SECRET : '');

if ($secret === '') {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'scan secret not configured']);
    exit;
}
if (!hash_equals($secret, (string)($_GET['key'] ?? ''))) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Forbidden']);
    exit;
}

// --- メールボックスの場所 ---
// public_html/api から見て ../../mail/yobuho.com/hotel@yobuho.com/new
$maildir = defined('BOUNCE_MAILDIR') && BOUNCE_MAILDIR !== ''
    ? BOUNCE_MAILDIR
    : __DIR__ . '/../../mail/yobuho.com/hotel@yobuho.com/new';

if (!is_dir($maildir) || !is_readable($maildir)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'maildir not readable', 'path' => $maildir]);
    exit;
}

/**
 * バウンス通知メールから配信失敗の情報を抽出する。
 * Postfix の multipart/report (message/delivery-status) 形式を想定。
 * バウンスでなければ null を返す。
 */
function parseBounce(string $raw): ?array {
    // MAILER-DAEMON からの配信失敗通知のみを対象にする
    if (stripos($raw, 'MAILER-DAEMON') === false
        && stripos($raw, 'Undelivered Mail Returned to Sender') === false) {
        return null;
    }

    // message/delivery-status パート由来の宛先。これが無いものはバウンスとみなさない
    if (!preg_match('/^Final-Recipient:\s*rfc822;\s*(\S+)/mi', $raw, $m)) {
        return null;
    }
    $recipient = trim($m[1]);

    $status = null;
    if (preg_match('/^Status:\s*([0-9]\.[0-9]+\.[0-9]+)/mi', $raw, $m)) {
        $status = trim($m[1]);
    }

    // Diagnostic-Code は折り返されるので後続のインデント行も拾う
    $diagnostic = null;
    if (preg_match('/^Diagnostic-Code:\s*(.+(?:\r?\n[ \t]+.+)*)/mi', $raw, $m)) {
        $diagnostic = trim(preg_replace('/\s+/', ' ', $m[1]));
    }

    // 元メールの件名（バウンス自体の Subject ではなく、添付された元メッセージのもの）
    $origSubject = null;
    if (preg_match_all('/^Subject:\s*(.+)$/mi', $raw, $mm) && !empty($mm[1])) {
        foreach ($mm[1] as $s) {
            $s = trim($s);
            if (stripos($s, 'Undelivered Mail Returned to Sender') !== false) continue;
            $origSubject = $s;
            break;
        }
        // RFC2047 エンコードされていればデコードして読めるようにする
        if ($origSubject !== null && strpos($origSubject, '=?') !== false) {
            $decoded = @iconv_mime_decode($origSubject, ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8');
            if (is_string($decoded) && $decoded !== '') $origSubject = $decoded;
        }
    }

    // DB接続は db.php が time_zone='+09:00' を設定しているため、格納する日時も JST に揃える。
    // date() は PHP の既定タイムゾーン依存でUTCになり得るので、明示的に JST へ変換する。
    $bouncedAt = null;
    if (preg_match('/^Date:\s*(.+)$/mi', $raw, $m)) {
        try {
            $dt = new DateTime(trim($m[1]));
            $dt->setTimezone(new DateTimeZone('Asia/Tokyo'));
            $bouncedAt = $dt->format('Y-m-d H:i:s');
        } catch (Throwable $e) {
            $bouncedAt = null; // 解析できない Date ヘッダは日時なしで記録する
        }
    }

    return [
        'recipient'    => mb_substr($recipient, 0, 255),
        'status_code'  => $status !== null ? mb_substr($status, 0, 16) : null,
        'diagnostic'   => $diagnostic,
        'orig_subject' => $origSubject !== null ? mb_substr($origSubject, 0, 512) : null,
        'bounced_at'   => $bouncedAt,
    ];
}

try {
    $pdo = DB::conn();

    $ins = $pdo->prepare(
        'INSERT IGNORE INTO mail_bounces
            (recipient, status_code, diagnostic, orig_subject, bounced_at, source_file)
         VALUES (?, ?, ?, ?, ?, ?)'
    );

    $scanned = 0; $inserted = 0; $skipped = 0;

    $files = scandir($maildir) ?: [];
    // 新しい順に見る（大量に溜まっていても直近から処理できる）
    rsort($files);

    foreach ($files as $file) {
        if ($file === '.' || $file === '..') continue;
        $path = $maildir . '/' . $file;
        if (!is_file($path) || !is_readable($path)) continue;

        $scanned++;

        // バウンス通知は数KB程度。巨大ファイルは通常メールなので先頭のみ読む
        $raw = @file_get_contents($path, false, null, 0, 64 * 1024);
        if ($raw === false) { $skipped++; continue; }

        $b = parseBounce($raw);
        if ($b === null) { $skipped++; continue; }

        $ins->execute([
            $b['recipient'], $b['status_code'], $b['diagnostic'],
            $b['orig_subject'], $b['bounced_at'], mb_substr($file, 0, 255),
        ]);
        if ($ins->rowCount() > 0) $inserted++;
    }

    // 未確認の恒久的失敗（5.x.x）件数 — 監視に使う
    $unresolved = (int)$pdo->query(
        "SELECT COUNT(*) FROM mail_bounces WHERE resolved = 0 AND status_code LIKE '5%'"
    )->fetchColumn();

    echo json_encode([
        'ok'         => true,
        'scanned'    => $scanned,
        'inserted'   => $inserted,
        'skipped'    => $skipped,
        'unresolved' => $unresolved,
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[scan-bounces] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'scan failed']);
}
