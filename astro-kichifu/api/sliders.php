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
    // 表示先は slider_shops（表示店舗トグル）で判定。オーナー店(shop_id)ではなく
    // 「この店に出す」と設定された行だけ配信（立川だけ／吉祥寺だけ／両方 が可能）。
    // リンク先は店舗ごとに差し替え可（slider_shops.url）。空なら共通の sliders.url。
    $st = DB::conn()->prepare(
        "SELECT s.title, COALESCE(NULLIF(ss.url, ''), s.url) AS url, s.image_pc, s.image_sp
           FROM sliders s
           JOIN slider_shops ss ON ss.slider_id = s.id AND ss.shop_id = ?
          WHERE s.is_display = 1
          ORDER BY s.sort, s.id"
    );
    $st->execute([$shop_id]);
    echo DB::jsonEncode(['sliders' => $st->fetchAll(PDO::FETCH_ASSOC)]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
