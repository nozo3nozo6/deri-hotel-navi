<?php
// ==========================================================================
// process-bounces.php — バウンスメール自動処理スクリプト
//
// 動作:
//  1. ~/Maildir/new/ と ~/Maildir/cur/ からバウンスメールを読み取る
//  2. Final-Recipient と Status をパース
//  3. outreach_emails テーブルの該当レコードを bounced に更新
//  4. 処理済みメールを ~/Maildir/.Processed/ に移動
//
// セットアップ:
//  1. Shinレンタルサーバーのコントロールパネルで hotel@yobuho.com から
//     yobuho@sv6051.wpx.ne.jp へメール転送設定
//  2. cron設定: */30 * * * * php /path/to/api/process-bounces.php
// ==========================================================================

// CLI または HTTP からの呼び出しに対応
$is_cli = (php_sapi_name() === 'cli');

// HTTPからの場合は秘密トークンチェック（admin手動実行用）
if (!$is_cli) {
    $token = $_GET['token'] ?? '';
    if ($token !== 'manual_bounce_process_2026') {
        http_response_code(403);
        exit('Forbidden');
    }
    header('Content-Type: text/plain; charset=UTF-8');
}

require_once __DIR__ . '/db.php';

$home = getenv('HOME') ?: '/home/yobuho';
$maildir_new = $home . '/Maildir/new';
$maildir_cur = $home . '/Maildir/cur';
$processed_dir = $home . '/Maildir/.Processed/cur';

// 処理済み保管ディレクトリ作成
if (!is_dir($processed_dir)) {
    mkdir($processed_dir, 0700, true);
    mkdir($home . '/Maildir/.Processed/new', 0700, true);
    mkdir($home . '/Maildir/.Processed/tmp', 0700, true);
}

$pdo = DB::conn();
$total = 0;
$bounced = 0;
$skipped = 0;
$logs = [];

// バウンスメール検出と処理
foreach ([$maildir_new, $maildir_cur] as $dir) {
    if (!is_dir($dir)) continue;
    $files = glob($dir . '/*');
    foreach ($files as $file) {
        if (!is_file($file)) continue;
        $total++;

        $content = file_get_contents($file);
        if ($content === false) {
            $skipped++;
            continue;
        }

        // バウンスメール判定
        $is_bounce = false;
        if (preg_match('/^From:.*MAILER-DAEMON/im', $content) ||
            preg_match('/^From:.*postmaster/im', $content) ||
            preg_match('/^Subject:.*(Undelivered|Delivery Status|Mail delivery failed|failure notice|Returned mail)/im', $content) ||
            preg_match('/Content-Type:\s*multipart\/report/i', $content)) {
            $is_bounce = true;
        }

        if (!$is_bounce) {
            $skipped++;
            continue;
        }

        // Final-Recipient 抽出
        $email = null;
        if (preg_match('/^Final-Recipient:\s*rfc822\s*;\s*(.+?)$/im', $content, $m)) {
            $email = trim($m[1]);
        } elseif (preg_match('/^(?:Original-Recipient|To):\s*<?([^\s<>]+@[^\s<>]+)>?/im', $content, $m)) {
            $email = trim($m[1]);
        } elseif (preg_match('/<([^\s<>]+@[^\s<>]+)>:/m', $content, $m)) {
            $email = trim($m[1]);
        }

        if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $logs[] = "[skip] no email found in: " . basename($file);
            $skipped++;
            continue;
        }

        // ステータスコード抽出
        $status_code = '';
        $reason = '';
        if (preg_match('/^Status:\s*(\d+\.\d+\.\d+)/im', $content, $m)) {
            $status_code = $m[1];
        }
        if (preg_match('/^Diagnostic-Code:\s*smtp;\s*(.+?)$/im', $content, $m)) {
            $reason = trim($m[1]);
        } elseif (preg_match('/(550[- ][^\n]+|554[- ][^\n]+|5\.\d\.\d[^\n]+)/m', $content, $m)) {
            $reason = trim($m[1]);
        }

        // バウンス種別判定（hard / soft）
        $bounce_type = 'soft';
        $is_hard = false;
        if (
            preg_match('/5\.1\.[12]/i', $status_code) || // No such user
            preg_match('/5\.4\.4/i', $status_code) ||    // DNS not found
            preg_match('/5\.7\./i', $status_code) ||     // Policy
            preg_match('/no such user|user unknown|does not exist|invalid recipient|Host not found/i', $reason)
        ) {
            $bounce_type = 'hard';
            $is_hard = true;
        } elseif (preg_match('/5\.2\.2|mailbox full|over quota/i', $status_code . ' ' . $reason)) {
            $bounce_type = 'soft_full'; // メールボックス満杯（一時的だが繰り返す可能性）
        }

        $note = "[bounced: " . ($status_code ?: '?') . " " . substr($reason, 0, 100) . " " . date('Y-m-d') . "]";

        // outreach_emails 更新
        $stmt = $pdo->prepare(
            "UPDATE outreach_emails
             SET status = ?,
                 notes = CONCAT(IFNULL(notes,''), ?)
             WHERE email = ? AND status != 'bounced'
             ORDER BY sent_at DESC LIMIT 1"
        );
        $stmt->execute(['bounced', ' ' . $note, $email]);
        $rowCount = $stmt->rowCount();

        if ($rowCount > 0) {
            $bounced++;
            $logs[] = "[bounced] {$email} ({$bounce_type}) — {$status_code}";
        } else {
            $logs[] = "[no-match] {$email} — outreach record not found";
        }

        // 処理済みディレクトリへ移動
        $new_path = $processed_dir . '/' . basename($file);
        rename($file, $new_path);
    }
}

// 結果出力
$result = [
    'total_scanned' => $total,
    'bounces_processed' => $bounced,
    'skipped' => $skipped,
    'timestamp' => date('Y-m-d H:i:s'),
];

if ($is_cli) {
    echo "=== Bounce Processor ===\n";
    echo "Scanned: {$total}\n";
    echo "Bounces: {$bounced}\n";
    echo "Skipped: {$skipped}\n";
    if ($logs) {
        echo "\n--- Details ---\n";
        echo implode("\n", $logs) . "\n";
    }
} else {
    echo "Bounce Processor Result:\n";
    echo json_encode($result, JSON_PRETTY_PRINT) . "\n\n";
    echo "Logs:\n" . implode("\n", $logs) . "\n";
}
