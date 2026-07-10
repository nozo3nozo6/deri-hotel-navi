<?php
// ==========================================================================
// api/translate.php — 動的コンテンツ（お知らせ本文・女性コメント等）の機械翻訳API
//   GET/POST: text, from(既定ja), to(ja/en/zh/zh-tw/ko)
//   DBキャッシュ(content_translations) → ミス時のみ Gemini 2.5 Flash を呼ぶ。
//   deri-hotel-navi(yobuho.com) の api/chat-api.php handleTranslate() と同型ロジック。
//   GEMINI_API_KEY 未設定時は 503（フロント側 content-i18n.js は原文表示にフォールバック）。
// ==========================================================================
require_once __DIR__ . '/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *'); // 同一オリジンの訪問者ブラウザから呼ばれる想定

$text = trim((string)($_GET['text'] ?? $_POST['text'] ?? ''));
$from = strtolower(substr((string)($_GET['from'] ?? $_POST['from'] ?? 'ja'), 0, 5));
$to   = strtolower(substr((string)($_GET['to']   ?? $_POST['to']   ?? ''), 0, 5));
$allowed = ['ja', 'en', 'zh', 'zh-tw', 'ko'];

if ($text === '') { http_response_code(400); echo json_encode(['error' => 'text required']); exit; }
if (mb_strlen($text) > 2000) $text = mb_substr($text, 0, 2000); // お知らせ本文等の長文を想定（チャットの500より緩め）
if (!in_array($from, $allowed, true) || !in_array($to, $allowed, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid lang']);
    exit;
}
if ($from === $to) { echo json_encode(['translated' => $text, 'cached' => false]); exit; }

try {
    $pdo = DB::conn();
    $cacheKey = md5($from . '|' . $to . '|' . $text);
    $stmt = $pdo->prepare('SELECT translated FROM content_translations WHERE cache_key = ? LIMIT 1');
    $stmt->execute([$cacheKey]);
    $cached = $stmt->fetchColumn();
    if ($cached !== false && $cached !== null) {
        echo json_encode(['translated' => $cached, 'cached' => true]);
        exit;
    }

    if (!defined('GEMINI_API_KEY') || GEMINI_API_KEY === '') {
        http_response_code(503);
        echo json_encode(['error' => 'translation not configured']);
        exit;
    }

    $langNames = ['ja' => 'Japanese', 'en' => 'English', 'zh' => 'Simplified Chinese', 'zh-tw' => 'Traditional Chinese', 'ko' => 'Korean'];
    $fromName = $langNames[$from] ?? $from;
    $toName   = $langNames[$to]   ?? $to;
    $prompt = "Translate the following text from {$fromName} to {$toName}. "
        . "This is marketing/informational content on a legal adult entertainment delivery service website in Japan. "
        . "Keep the tone natural, warm and professional. Preserve line breaks. "
        . "Do NOT translate or alter personal names (e.g. a woman's stage name) — keep them exactly as written in the original. "
        . "Return ONLY the translated text, with no explanation, no quotes, and no prefix.\n\nText:\n{$text}";

    $body = json_encode([
        'contents' => [['parts' => [['text' => $prompt]]]],
        'generationConfig' => ['temperature' => 0.2, 'maxOutputTokens' => 2000],
    ], JSON_UNESCAPED_UNICODE);

    $url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' . urlencode(GEMINI_API_KEY);
    $opts = [
        'method' => 'POST',
        'header' => "Content-Type: application/json\r\n",
        'content' => $body,
        'timeout' => 15,
        'ignore_errors' => true,
    ];
    $ctx = stream_context_create(['http' => $opts, 'https' => $opts]);
    $resp = @file_get_contents($url, false, $ctx);
    if ($resp === false) { http_response_code(502); echo json_encode(['error' => 'translation service unreachable']); exit; }

    $data = json_decode($resp, true);
    $translated = isset($data['candidates'][0]['content']['parts'][0]['text'])
        ? trim((string)$data['candidates'][0]['content']['parts'][0]['text'])
        : '';
    $translated = trim($translated, " \t\n\r\0\x0B\"'「」『』");
    if ($translated === '' || $translated === $text) { http_response_code(502); echo json_encode(['error' => 'translation failed']); exit; }

    $pdo->prepare('INSERT IGNORE INTO content_translations (cache_key, src_lang, dst_lang, src_text, translated) VALUES (?, ?, ?, ?, ?)')
        ->execute([$cacheKey, $from, $to, $text, $translated]);

    echo json_encode(['translated' => $translated, 'cached' => false]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
