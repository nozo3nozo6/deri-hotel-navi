<?php
// ==========================================================================
// api/sliders.php — トップ ヒーロースライダー配信API
//   GET ?shop_id=1 → {sliders:[{title,url,image_pc,image_sp}]}（is_display=1, sort順）
//   管理画面 /ctrl のスライダーで登録。フロント(top.astro)が getSliders() で取得。
// ==========================================================================
require_once __DIR__ . '/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$shop_id = (int)($_GET['shop_id'] ?? 1);

try {
    $st = DB::conn()->prepare(
        "SELECT title, url, image_pc, image_sp FROM sliders
          WHERE shop_id = ? AND is_display = 1
          ORDER BY sort, id"
    );
    $st->execute([$shop_id]);
    echo DB::jsonEncode(['sliders' => $st->fetchAll(PDO::FETCH_ASSOC)]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
