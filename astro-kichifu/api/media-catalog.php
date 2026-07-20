<?php
// ==========================================================================
// api/media-catalog.php — bot の媒体在籍カタログ受け口（/ctrl/media-sync.php 用）
//   bot(VPS) の bin/collect-girl-ids.php が6時間毎に収集する data/girl_id_catalog.json
//   （媒体別 名前→ID）を bin/upload-catalog.php が本APIへPOST。CTRLの媒体同期ステータス
//   画面がこのデータで「CTRL在籍 × 媒体在籍」の突き合わせを表示する。
//
//   認証: X-Api-Key = PLAY_API_KEY（他のOfficial APIと同一）。
//   保存先: DOCUMENT_ROOT の1つ上（Web非公開）/media_catalog.json
//           形式 {uploaded_at: ISO8601, catalog: {fujoho:{名前:ID,...}, ekichika:..., heaven:..., fuzoku:..., deli:...}}
//   POST body: カタログJSONそのもの（{fujoho:{...},...}）
//   GET: 保存済みデータを返す（デバッグ用・認証必須）
// ==========================================================================
require_once __DIR__ . '/db-config.php';   // PLAY_API_KEY（DB接続は不要）

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
date_default_timezone_set('Asia/Tokyo');

if (!defined('PLAY_API_KEY') || PLAY_API_KEY === '') {
    http_response_code(503); echo json_encode(['error' => 'api not configured']); exit;
}
$key = $_SERVER['HTTP_X_API_KEY'] ?? ($_GET['key'] ?? '');
if (!is_string($key) || !hash_equals(PLAY_API_KEY, $key)) {
    http_response_code(401); echo json_encode(['error' => 'unauthorized']); exit;
}

$path = dirname($_SERVER['DOCUMENT_ROOT']) . '/media_catalog.json';   // Web非公開（public_htmlの外）

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $body = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($body) || $body === []) {
        http_response_code(400); echo json_encode(['error' => 'json catalog body required']); exit;
    }
    // 期待形: {fujoho:{名前:ID,...},...}。知らないキーはそのまま保存（前方互換）
    $data = ['uploaded_at' => date('Y-m-d\TH:i:sP'), 'catalog' => $body];
    if (file_put_contents($path, json_encode($data, JSON_UNESCAPED_UNICODE)) === false) {
        http_response_code(500); echo json_encode(['error' => 'write failed']); exit;
    }
    $counts = [];
    foreach ($body as $m => $v) { $counts[$m] = is_array($v) ? count($v) : 0; }
    echo json_encode(['ok' => true, 'uploaded_at' => $data['uploaded_at'], 'counts' => $counts]);
    exit;
}

// GET（デバッグ）
if (!is_file($path)) { http_response_code(404); echo json_encode(['error' => 'no catalog yet']); exit; }
readfile($path);
