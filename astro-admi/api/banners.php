<?php
// ==========================================================================
// api/banners.php — バナー配信API（top: 上部 / bottom: 下部）
//   GET ?type=top[&shop_id=1] → {banners:[{title,url,image}]}（is_display=1, sort順）
// ==========================================================================
require_once __DIR__ . '/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$shop_id = (int)($_GET['shop_id'] ?? 1);
$type    = ($_GET['type'] ?? 'top') === 'bottom' ? 'bottom' : 'top';

try {
    $st = DB::conn()->prepare(
        "SELECT title, url, image FROM banners
          WHERE shop_id = ? AND type = ? AND is_display = 1
          ORDER BY sort, id"
    );
    $st->execute([$shop_id, $type]);
    echo DB::jsonEncode(['banners' => $st->fetchAll(PDO::FETCH_ASSOC)]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
