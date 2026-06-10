<?php
/**
 * list-hotels-for-sitemap.php — sitemap.xml 生成用に口コミ実績のある公開ホテルの id + 最終投稿日を返す
 * generate-sitemap.js (CI) からのみ呼ばれる前提だが認証不要 (公開情報のみ)。
 * 43,580件の一括登録は薄いページの大量インデックスになるため、
 * 表示可能な口コミ (reports / loveho_reports) が1件以上あるホテルに限定する（段階投入の第1弾）。
 */
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache');

require_once __DIR__ . '/db.php';

try {
    $pdo = DB::conn();
    $sql = '
        SELECT h.id, DATE(MAX(t.d)) AS lastmod
        FROM hotels h
        JOIN (
            SELECT hotel_id, MAX(created_at) AS d FROM reports WHERE is_hidden = 0 GROUP BY hotel_id
            UNION ALL
            SELECT hotel_id, MAX(created_at) AS d FROM loveho_reports WHERE is_hidden = 0 GROUP BY hotel_id
        ) t ON t.hotel_id = h.id
        WHERE h.is_published = 1
        GROUP BY h.id
        ORDER BY h.id
    ';
    $stmt = $pdo->query($sql);
    echo json_encode($stmt->fetchAll(), JSON_UNESCAPED_UNICODE);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'DB error']);
}
