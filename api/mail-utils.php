<?php
// ==========================================================================
// mail-utils.php — 共通メール送信ヘルパー（multipart/alternative + Reply-To）
//
// Gmail等のスパム判定を下げるため、全トランザクショナルメールで
//   - multipart/alternative（text/plain + text/html 両パート）
//   - Reply-To: hotel@yobuho.com
//   - From: YobuHo <hotel@yobuho.com>
//   - envelope sender (-f hotel@yobuho.com) で SPF alignment
// を揃える。DMARC p=reject 下でもGmailのAIフィルタに「transactional」と認識させやすくする。
//
// 2026-08-01: 送信経路を SMTP AUTH 優先に変更。
//   mail() はローカル sendmail への直接注入のため Received に
//   "(Postfix, from userid 20014)" が残り、共有IPと相まって Apple/iCloud に
//   554 5.7.1 [HM08] で拒否される（または受理後サイレント破棄される）ことを実測。
//   同条件でも Web メール（SMTP AUTH）経由なら iCloud へ正常配信されたため、
//   同じ submission 経路を使う。SMTP 未設定・失敗時は従来の mail() に自動フォールバック。
// ==========================================================================

// SMTP 認証情報は db-config.php（deploy.yml が GitHub Secrets から生成）に定義される。
// ローカル開発環境等で存在しない場合は SMTP を使わず mail() にフォールバックする。
if (!defined('SMTP_HOST') && is_readable(__DIR__ . '/db-config.php')) {
    require_once __DIR__ . '/db-config.php';
}
require_once __DIR__ . '/smtp-send.php';

/**
 * HTMLメールを multipart/alternative で送信する。
 * 送信元は YobuHo <hotel@yobuho.com> 固定、Reply-To / envelope sender も同アドレス。
 * text/plain パートはHTMLから自動抽出する。
 */
function sendTransactionalMail(string $to, string $subject, string $htmlBody): bool {
    $plainBody = htmlToPlainText($htmlBody);

    $boundary = '=_yobuho_' . md5(uniqid('', true));

    $mimeBody  = "This is a multi-part message in MIME format.\r\n\r\n";
    $mimeBody .= "--{$boundary}\r\n";
    $mimeBody .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $mimeBody .= "Content-Transfer-Encoding: base64\r\n\r\n";
    $mimeBody .= chunk_split(base64_encode($plainBody)) . "\r\n";
    $mimeBody .= "--{$boundary}\r\n";
    $mimeBody .= "Content-Type: text/html; charset=UTF-8\r\n";
    $mimeBody .= "Content-Transfer-Encoding: base64\r\n\r\n";
    $mimeBody .= chunk_split(base64_encode($htmlBody)) . "\r\n";
    $mimeBody .= "--{$boundary}--\r\n";

    // Message-ID を yobuho.com ドメインで明示付与する。
    // 未指定だと MTA が送信サーバのホスト名（sv6051.wpx.ne.jp）で生成し、From ヘッダの
    // ドメインと不一致になる。iCloud/Apple は RFC5322 準拠とドメイン一貫性を要求するため
    // （Postmaster ガイドライン）、From と揃えて弱いマイナス signal を消す。
    // sendmail は Message-ID が既にある場合は上書きしないので重複しない。
    $messageId = '<' . bin2hex(random_bytes(16)) . '.' . time() . '@yobuho.com>';

    $headers  = "From: YobuHo <hotel@yobuho.com>\r\n";
    $headers .= "Reply-To: hotel@yobuho.com\r\n";
    $headers .= "Message-ID: {$messageId}\r\n";
    $headers .= "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n";

    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';

    // 経路1: SMTP AUTH（submission/587）。Web メールと同じ経路で、iCloud への配信実績あり。
    $smtpErr = null;
    if (smtpSendMail($to, $encodedSubject, $headers, $mimeBody, $smtpErr)) {
        return true;
    }
    // 経路2: フォールバック。SMTP 未設定・接続失敗時も配信を止めない。
    error_log('[mail-utils] SMTP send failed, falling back to mail(): ' . (string)$smtpErr);
    return @mail($to, $encodedSubject, $mimeBody, $headers, '-f hotel@yobuho.com');
}

/** HTML → text/plain へ最低限の変換（リンクはURL併記、改行を保つ） */
function htmlToPlainText(string $html): string {
    $text = $html;
    // <a href="URL">label</a> → label (URL)
    $text = preg_replace_callback(
        '/<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)<\/a>/is',
        function ($m) {
            $label = trim(strip_tags($m[2]));
            $url   = trim($m[1]);
            if ($label === '' || $label === $url) return $url;
            return "{$label} ({$url})";
        },
        $text
    );
    // ブロック要素を改行に
    $text = preg_replace('/<\s*(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\s*\/?>/i', "\n", $text);
    $text = preg_replace('/<\s*(hr|li)\s*\/?>/i', "\n- ", $text);
    // 残りのタグ除去
    $text = strip_tags($text);
    // HTMLエンティティデコード
    $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    // 連続改行を圧縮
    $text = preg_replace("/[ \t]+/", ' ', $text);
    $text = preg_replace("/\n[ \t]+/", "\n", $text);
    $text = preg_replace("/\n{3,}/", "\n\n", $text);
    return trim($text);
}
