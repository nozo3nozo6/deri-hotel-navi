<?php
// ==========================================================================
// smtp-send.php — SMTP AUTH (submission/587 + STARTTLS) による送信
//
// 背景 (2026-08-01):
//   PHP の mail() はローカルの sendmail にメッセージを直接注入するため、
//   Received ヘッダに "(Postfix, from userid 20014)" が残り、受信側から
//   「認証を伴わないスクリプト送信」であることが露見する。共有ホスティングの
//   IP と組み合わさると Apple/iCloud に 554 5.7.1 [HM08] で拒否される
//   （もしくは受理後にサイレント破棄される）ことを実測で確認した。
//
//   同一サーバ・同一 IP・同一 From でも、Web メール（SMTP AUTH 経由）で
//   送ったメールは iCloud に正常配信された。差は「送信経路」のみ。
//   そこで submission ポートに SMTP AUTH で接続して送る経路を用意する。
//
// 依存ライブラリ無しの自己完結実装（composer 不使用のため）。
// 認証情報は db-config.php に定義（deploy.yml が GitHub Secrets から生成）。
// ==========================================================================

/**
 * SMTP AUTH でメールを送信する。
 *
 * @param string $to             宛先アドレス（1件）
 * @param string $encodedSubject RFC2047 エンコード済みの件名
 * @param string $headersBlock   CRLF 区切りのヘッダ群（From/Message-ID/MIME 等）。末尾の CRLF は任意。
 * @param string $mimeBody       本文（MIME 済み）
 * @param string|null $error     失敗理由を受け取る（呼び出し側のログ用）
 * @return bool 送信できたら true。設定が無い/失敗したら false（呼び出し側で mail() にフォールバック）
 */
function smtpSendMail(string $to, string $encodedSubject, string $headersBlock, string $mimeBody, ?string &$error = null): bool {
    $error = null;

    if (!defined('SMTP_HOST') || !defined('SMTP_USER') || !defined('SMTP_PASS')
        || SMTP_HOST === '' || SMTP_USER === '' || SMTP_PASS === '') {
        $error = 'smtp not configured';
        return false;
    }
    $host = SMTP_HOST;
    $port = defined('SMTP_PORT') && SMTP_PORT ? (int)SMTP_PORT : 587;
    $user = SMTP_USER;
    $pass = SMTP_PASS;

    // ヘッダ/宛先へのインジェクション防止（CR/LF を含む値は拒否）
    if (preg_match('/[\r\n]/', $to)) { $error = 'invalid recipient'; return false; }

    $timeout = 20;
    $conn = @stream_socket_client(
        "tcp://{$host}:{$port}", $errno, $errstr, $timeout,
        STREAM_CLIENT_CONNECT
    );
    if (!$conn) {
        $error = "connect failed: {$errstr} ({$errno})";
        return false;
    }
    stream_set_timeout($conn, $timeout);

    // --- 応答読み取り（複数行応答 "250-..." に対応） ---
    $read = function () use ($conn, &$error): array {
        $lines = [];
        while (($line = fgets($conn, 8192)) !== false) {
            $lines[] = rtrim($line, "\r\n");
            // "250 xxx" のようにコード直後が空白なら最終行
            if (strlen($line) >= 4 && $line[3] === ' ') break;
        }
        if (!$lines) return [0, ''];
        $last = end($lines);
        return [(int)substr($last, 0, 3), implode(' | ', $lines)];
    };
    $write = function (string $cmd) use ($conn) {
        fwrite($conn, $cmd . "\r\n");
    };
    // コマンド送出 → 期待コード確認
    $cmd = function (string $line, array $expect) use ($write, $read, &$error): bool {
        $write($line);
        [$code, $msg] = $read();
        if (!in_array($code, $expect, true)) {
            // AUTH のやり取りは資格情報が乗るのでコマンド全文はログに残さない
            $safe = preg_match('/^AUTH|^[A-Za-z0-9+\/=]{8,}$/', $line) ? '(auth data)' : $line;
            $error = "unexpected reply to {$safe}: {$code} {$msg}";
            return false;
        }
        return true;
    };

    $fail = function (string $why) use ($conn, &$error): bool {
        if ($error === null) $error = $why;
        @fwrite($conn, "QUIT\r\n");
        @fclose($conn);
        return false;
    };

    // --- 挨拶 ---
    [$code] = $read();
    if ($code !== 220) return $fail("bad greeting: {$code}");

    $ehloName = defined('SMTP_HELO') && SMTP_HELO ? SMTP_HELO : 'yobuho.com';
    if (!$cmd("EHLO {$ehloName}", [250])) return $fail('ehlo failed');

    // --- STARTTLS（submission ポートでは必須運用） ---
    if (!$cmd('STARTTLS', [220])) return $fail('starttls rejected');
    $cryptoOk = @stream_socket_enable_crypto(
        $conn, true,
        STREAM_CRYPTO_METHOD_TLS_CLIENT
        | STREAM_CRYPTO_METHOD_TLSv1_1_CLIENT
        | STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT
    );
    if ($cryptoOk !== true) return $fail('tls handshake failed');
    // TLS 確立後は EHLO をやり直す（RFC3207）
    if (!$cmd("EHLO {$ehloName}", [250])) return $fail('ehlo after tls failed');

    // --- 認証（AUTH LOGIN） ---
    if (!$cmd('AUTH LOGIN', [334])) return $fail('auth login not accepted');
    if (!$cmd(base64_encode($user), [334])) return $fail('username rejected');
    if (!$cmd(base64_encode($pass), [235])) return $fail('password rejected');

    // --- エンベロープ ---
    $envelopeFrom = defined('SMTP_ENVELOPE_FROM') && SMTP_ENVELOPE_FROM ? SMTP_ENVELOPE_FROM : $user;
    if (!$cmd("MAIL FROM:<{$envelopeFrom}>", [250])) return $fail('mail from rejected');
    if (!$cmd("RCPT TO:<{$to}>", [250, 251]))        return $fail('rcpt to rejected');
    if (!$cmd('DATA', [354]))                         return $fail('data rejected');

    // --- 本体 ---
    $headers = rtrim($headersBlock, "\r\n");
    $message = "To: {$to}\r\n"
             . "Subject: {$encodedSubject}\r\n"
             . "Date: " . date('r') . "\r\n"
             . $headers . "\r\n"
             . "\r\n"
             . $mimeBody;

    // 改行を CRLF に正規化し、行頭のドットをエスケープ（RFC5321 4.5.2）
    $message = preg_replace("/\r\n|\r|\n/", "\r\n", $message);
    $message = preg_replace("/^\./m", '..', $message);

    fwrite($conn, $message . "\r\n.\r\n");
    [$code, $msg] = $read();
    if ($code !== 250) return $fail("message rejected: {$code} {$msg}");

    $write('QUIT');
    @fclose($conn);
    return true;
}
