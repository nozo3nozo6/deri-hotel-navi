<?php
// ==========================================================================
// bot-schedule.php — bot 自動実行スケジュールAPI（CLAUDE-EKICHIKA-BULKTOP.md / -NEWS.md）
//   媒体自動更新の時刻表を配信。bot(Grok)が毎分 GET し enabled/daily_limit/schedule を読む。
//   対応 job: ekichika_bulktop(駅ちか上位表示・1〜38) / fuzoku_news, deli_news(速報・各1〜10)＝固定時刻(mode=schedule)。
//            fujoho_sokuho(情報局速報) / ekichika_news(駅ちかニュース)＝周期(mode=interval・interval_min分・上限0=無制限)。
//   mode=interval は interval_min(1〜120分)で5枠ローテ、mode=schedule は schedule の HH:MM で実行。
//   認証: X-Api-Key または Authorization: Bearer ＝ PLAY_API_KEY（他のOfficial APIと同一）。
//   ★ ファイル名 bot-schedule.php 固定（bot が sibling 解決で GET する）。
//
//   GET ?shop_id=1&job={job}              → 設定1件。未設定は 404（bot は config 既定で継続）
//   GET ?shop_id=1&jobs=a,b,c             → 一括（items:{job:設定 or null}）。未知jobは除外
//   PUT ?shop_id=1&job={job}  body(JSON): {enabled?,daily_limit?,schedule?}
//        → 部分更新・検証/正規化/clamp して保存し、最新状態(GETと同形)を返す。未知jobは404。
//   ※ min_interval_sec: deprecated 2026-07-18 — bot は schedule の HH:MM ちょうどに1回POSTし、
//     過ぎた枠はスキップ（60秒連打はしない）。GET/PUT では後方互換で残るが bot は無視する。
// ==========================================================================
declare(strict_types=1);
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/db-config.php';   // PLAY_API_KEY を認証チェック前に読む（db.php は遅延読込）
require_once __DIR__ . '/_bot-schedule.php';

date_default_timezone_set('Asia/Tokyo');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (!defined('PLAY_API_KEY') || PLAY_API_KEY === '') {
    http_response_code(503); echo json_encode(['error' => 'api disabled']); exit;
}
$key = $_SERVER['HTTP_X_API_KEY'] ?? '';
if ($key === '' && preg_match('/^Bearer\s+(.+)$/i', $_SERVER['HTTP_AUTHORIZATION'] ?? '', $m)) $key = trim($m[1]);
if ($key === '' && isset($_GET['key'])) $key = (string)$_GET['key'];
if (!is_string($key) || $key === '' || !hash_equals(PLAY_API_KEY, $key)) {
    http_response_code(401); echo json_encode(['error' => 'unauthorized']); exit;
}

$shopId = (int)($_GET['shop_id'] ?? 0);
$job    = (string)($_GET['job'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// 一括GET（任意・CTRL 1画面用）: ?shop_id=1&jobs=ekichika_bulktop,fuzoku_news,deli_news
if ($method === 'GET' && $shopId && ($_GET['jobs'] ?? '') !== '') {
    try {
        $items = [];
        foreach (array_filter(array_map('trim', explode(',', (string)$_GET['jobs']))) as $j) {
            if (!bot_schedule_job_meta($j)) continue;                // 未知jobは黙って除外
            $row = bot_schedule_fetch(DB::conn(), $shopId, $j);
            $items[$j] = $row ? bot_schedule_to_json($row) : null;   // 未設定は null（bot は config 既定）
        }
        echo DB::jsonEncode(['ok' => true, 'shop_id' => $shopId, 'items' => $items]);
    } catch (Throwable $e) {
        http_response_code(500); echo json_encode(['error' => 'server error']);
    }
    exit;
}

if (!$shopId || $job === '') { http_response_code(400); echo json_encode(['error' => 'shop_id and job required']); exit; }

try {
    if ($method === 'PUT' || $method === 'POST') {
        $body = json_decode(file_get_contents('php://input') ?: '', true);
        if (!is_array($body)) { http_response_code(400); echo json_encode(['error' => 'json body required']); exit; }
        $by = isset($body['updated_by']) ? mb_substr((string)$body['updated_by'], 0, 64) : 'api';
        $res = bot_schedule_save(DB::conn(), $shopId, $job, $body, $by);
        if (isset($res['error'])) { http_response_code($res['code'] ?? 400); echo json_encode(['error' => $res['error']]); exit; }
        unset($res['_trimmed']);
        echo DB::jsonEncode($res);
        exit;
    }

    // GET
    $row = bot_schedule_fetch(DB::conn(), $shopId, $job);
    if (!$row) { http_response_code(404); echo json_encode(['error' => 'not configured', 'job' => $job, 'shop_id' => $shopId]); exit; }
    echo DB::jsonEncode(bot_schedule_to_json($row));
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'server error']);
}
