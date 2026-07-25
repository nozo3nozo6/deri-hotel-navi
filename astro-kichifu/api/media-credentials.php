<?php
// ==========================================================================
// api/media-credentials.php — bot が媒体ログイン情報を取得する受け口
//   CTRL ctrl/media-accounts.php（owner専用）で保存した media_credentials を返す。
//   bot は起動時にこれを取得し config.php の username/password/shop_id を上書きする
//   （＝パスワード変更が CTRL 保存だけで反映・ターミナル不要）。
//   認証: X-Api-Key = PLAY_API_KEY（他の bot 向け API と同じ流儀）。
//   GET ?shop_id=1 → {ok, items:{media:{username,password,shop_key}}}（空欄の値は返さない）
// ==========================================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/db-config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (!defined('PLAY_API_KEY') || PLAY_API_KEY === '') {
    http_response_code(503); echo json_encode(['error' => 'api not configured']); exit;
}
$key = $_SERVER['HTTP_X_API_KEY'] ?? '';
if (!is_string($key) || !hash_equals(PLAY_API_KEY, $key)) {
    http_response_code(401); echo json_encode(['error' => 'unauthorized']); exit;
}

$shopId = (int)($_GET['shop_id'] ?? 1);
try {
    $st = DB::conn()->prepare('SELECT media, username, password, shop_key FROM media_credentials WHERE shop_id = ?');
    $st->execute([$shopId]);
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $e = [];
        if ($r['username'] !== '') $e['username'] = $r['username'];
        if ($r['password'] !== '') $e['password'] = $r['password'];
        if ($r['shop_key'] !== '') $e['shop_key'] = $r['shop_key'];
        if ($e !== []) $items[$r['media']] = $e;
    }
    echo DB::jsonEncode(['ok' => true, 'shop_id' => $shopId, 'items' => $items]);
} catch (Throwable $e) {
    // テーブル未作成（CTRL初回保存前）は空を返す
    echo json_encode(['ok' => true, 'shop_id' => $shopId, 'items' => []]);
}
