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
// ==========================================================================

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

    $headers  = "From: YobuHo <hotel@yobuho.com>\r\n";
    $headers .= "Reply-To: hotel@yobuho.com\r\n";
    $headers .= "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n";

    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
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
