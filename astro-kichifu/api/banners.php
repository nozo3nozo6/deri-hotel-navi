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
    // 表示先は banner_shops（表示店舗トグル）で判定。オーナー店(shop_id)ではなく
    // 「この店に出す」と設定された行だけ配信（立川だけ／吉祥寺だけ／両方 が可能）。
    $st = DB::conn()->prepare(
        "SELECT b.title, b.url, b.image FROM banners b
          WHERE b.type = ? AND b.is_display = 1
            AND EXISTS (SELECT 1 FROM banner_shops bs WHERE bs.banner_id = b.id AND bs.shop_id = ?)
          ORDER BY b.sort, b.id"
    );
    $st->execute([$type, $shop_id]);
    echo DB::jsonEncode(['banners' => $st->fetchAll(PDO::FETCH_ASSOC)]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
