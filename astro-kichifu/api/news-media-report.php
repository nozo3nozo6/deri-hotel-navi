<?php
// ==========================================================================
// news-media-report.php — お知らせの媒体反映結果を受け取る（bot → CTRL）
//   bot(official-media-update) が各媒体へ投稿するたびに1件ずつ送る。
//   CTRL の「お知らせ」画面（ctrl/news.php）で反映状況を出すための記録。
//   認証: X-Api-Key / Authorization: Bearer ＝ PLAY_API_KEY（他APIと同一）
//
//   POST {shop_id, media, news_id, status:"ok"|"ng", message?, biz_date?}
//     同じ (shop_id, media, news_id) は上書き（再試行で行が増えない）
//   GET ?shop_id=1&biz_date=2026-08-06 → その営業日ぶんの記録（確認用）
// ==========================================================================
declare(strict_types=1);
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/db-config.php';

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

$ALLOWED_MEDIA = ['manzoku', 'mensv', 'fucolle', 'fujoho', 'ekichika', 'fuzoku', 'deli', 'heaven'];

try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
        $shopId = (int)($_GET['shop_id'] ?? 0);
        if (!$shopId) { http_response_code(400); echo json_encode(['error' => 'shop_id required']); exit; }
        $bizDate = (string)($_GET['biz_date'] ?? date('Y-m-d'));
        $st = DB::conn()->prepare(
            'SELECT media, news_id, status, message, created FROM news_media_posts
              WHERE shop_id = ? AND biz_date = ? ORDER BY created ASC'
        );
        $st->execute([$shopId, $bizDate]);
        echo DB::jsonEncode(['rows' => $st->fetchAll(PDO::FETCH_ASSOC), 'biz_date' => $bizDate]);
        exit;
    }

    $raw = file_get_contents('php://input') ?: '';
    $b = json_decode($raw, true);
    if (!is_array($b)) { http_response_code(400); echo json_encode(['error' => 'invalid json']); exit; }

    $shopId = (int)($b['shop_id'] ?? 0);
    $media = (string)($b['media'] ?? '');
    $newsId = (int)($b['news_id'] ?? 0);
    $status = (string)($b['status'] ?? '');
    if (!$shopId || $newsId <= 0 || !in_array($media, $ALLOWED_MEDIA, true) || !in_array($status, ['ok', 'ng'], true)) {
        http_response_code(400); echo json_encode(['error' => 'bad params']); exit;
    }
    $bizDate = (string)($b['biz_date'] ?? '');
    if ($bizDate === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $bizDate)) {
        // 未指定なら営業日（5:00〜翌5:00）で判定
        $bizDate = date('H:i') < '05:00' ? date('Y-m-d', strtotime('-1 day')) : date('Y-m-d');
    }
    $message = mb_substr(trim((string)($b['message'] ?? '')), 0, 250);

    DB::conn()->prepare(
        'INSERT INTO news_media_posts (shop_id, media, news_id, biz_date, status, message)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE biz_date = VALUES(biz_date), status = VALUES(status),
                                 message = VALUES(message), created = NOW()'
    )->execute([$shopId, $media, $newsId, $bizDate, $status, $message !== '' ? $message : null]);

    echo json_encode(['ok' => true]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'server error']);
}
