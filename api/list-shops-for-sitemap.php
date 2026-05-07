<?php
/**
 * list-shops-for-sitemap.php — sitemap.xml 生成用に active shops の slug + gender_mode を返す
 * generate-sitemap.js (CI) からのみ呼ばれる前提だが認証不要 (slug は元々公開情報)。
 */
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache');

require_once __DIR__ . '/db.php';

try {
    $pdo = DB::conn();
    $stmt = $pdo->query(
        'SELECT slug, gender_mode FROM shops '
        . 'WHERE status = "active" AND slug IS NOT NULL AND slug != "" '
        . 'ORDER BY slug'
    );
    echo json_encode($stmt->fetchAll(), JSON_UNESCAPED_UNICODE);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'DB error']);
}
