<?php
// ==========================================================================
// news-slots.php — 媒体固定枠API（bot連携・CLAUDE-NEWS-SLOTS-ROTATION.md）
//   駅ちか5カテゴリ + 情報局速報の5枠ローテのうち、固定3枠(shinjin/event/waribiki)を配信。
//   残り2枠（sokuho/kinkyu）は最新お知らせ＝api/news-current.php（既存・変更なし）。
//   認証: X-Api-Key または Authorization: Bearer ＝ PLAY_API_KEY（news-current と同一）。
//
//   GET ?shop_id=1              → 3キーすべて返す（未登録でも enabled:false + 空で返す・仕様§3.2ルール1）
//   媒体別自動整形: body_html=駅ちか用(CSS可・URL除去) / body_text=情報局用(CSS不可・URL併記) /
//                   body_html_raw=元HTML（2026-07-17 店長指示）
//   GET ?shop_id=1&key=shinjin  → 1枠のみ（デバッグ用・仕様§3.3）
//   GET ...&urls=0              → body_text からURL全削除（既定はリンクURL併記）
//
//   body_text は GET 時生成（news_html_to_text()＝CTRLコピペ用タブと同一アルゴリズム）。
// ==========================================================================
declare(strict_types=1);
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/db-config.php';   // PLAY_API_KEY を認証チェック前に読む（db.php は遅延読込）
require_once __DIR__ . '/_html-text.php';

date_default_timezone_set('Asia/Tokyo');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (!defined('PLAY_API_KEY') || PLAY_API_KEY === '') {
    http_response_code(503); echo json_encode(['error' => 'api disabled']); exit;
}
$key = $_SERVER['HTTP_X_API_KEY'] ?? '';
if ($key === '' && preg_match('/^Bearer\s+(.+)$/i', $_SERVER['HTTP_AUTHORIZATION'] ?? '', $m)) $key = trim($m[1]);
if ($key === '' && isset($_GET['key_auth'])) $key = (string)$_GET['key_auth'];
if (!is_string($key) || $key === '' || !hash_equals(PLAY_API_KEY, $key)) {
    http_response_code(401); echo json_encode(['error' => 'unauthorized']); exit;
}

$shopId = (int)($_GET['shop_id'] ?? 0);
if (!$shopId) { http_response_code(400); echo json_encode(['error' => 'shop_id required']); exit; }
$withUrls = !isset($_GET['urls']) || $_GET['urls'] !== '0';

const SLOT_LABELS = ['shinjin' => '新人速報', 'event' => 'イベント速報', 'waribiki' => '激アツ割引情報'];

$filterKey = (string)($_GET['key'] ?? '');
if ($filterKey !== '' && !isset(SLOT_LABELS[$filterKey])) {
    http_response_code(400); echo json_encode(['error' => 'bad key']); exit;
}

function slot_image_url(?string $path): ?string {
    if ($path === null || $path === '') return null;
    if (preg_match('#^https?://#i', $path)) {
        return preg_replace('#^https?://kichifu\.com(/uploads/)#i', 'https://admi2888.com$1', $path);
    }
    return 'https://admi2888.com' . (str_starts_with($path, '/') ? '' : '/') . $path;   // 画像の正は admi2888
}

try {
    $st = DB::conn()->prepare('SELECT * FROM news_slots WHERE shop_id = ?');
    $st->execute([$shopId]);
    $rows = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $rows[$r['slot_key']] = $r;

    $slots = [];
    foreach (SLOT_LABELS as $k => $label) {
        if ($filterKey !== '' && $k !== $filterKey) continue;
        $r = $rows[$k] ?? null;
        $slots[$k] = [
            'key'        => $k,
            'label'      => $label,
            'title'      => (string)($r['title'] ?? ''),
            // 媒体別の自動整形（news-current と同じ・2026-07-17 店長指示）:
            //   body_html = 駅ちか用（CSS可・URL除去）/ body_text = 情報局用（CSS不可・URL併記）
            'body_html'  => $r ? news_html_strip_urls((string)($r['body_html'] ?? '')) : '',
            'body_html_raw' => (string)($r['body_html'] ?? ''),
            'body_text'  => $r ? news_html_to_text((string)($r['body_html'] ?? ''), $withUrls) : '',
            'image_url'  => slot_image_url($r['image'] ?? null),
            'enabled'    => $r ? (bool)$r['is_enabled'] : false,   // 未登録=enabled:false（仕様§3.2ルール1）
            'updated_at' => $r ? date('Y-m-d\TH:i:sP', strtotime($r['updated_at'])) : null,
            'updated_by' => $r['updated_by'] ?? null,
        ];
    }

    echo DB::jsonEncode([
        'shop_id'     => $shopId,
        'server_time' => date('Y-m-d\TH:i:sP'),
        'slots'       => $slots,
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'server error']);
}
