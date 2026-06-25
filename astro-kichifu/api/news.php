<?php
// ==========================================================================
// api/news.php — お知らせ一覧・詳細 JSON API
//   GET ?action=list&shop_id=1[&limit=N]
//   GET ?action=detail&id=N
// ==========================================================================
require_once __DIR__ . '/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$action  = $_GET['action'] ?? 'list';
$shop_id = (int)($_GET['shop_id'] ?? 1);

try {
    if ($action === 'detail') {
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) { http_response_code(400); echo json_encode(['error' => 'id required']); exit; }

        $st = DB::conn()->prepare(
            'SELECT * FROM news WHERE id = ? AND shop_id = ? AND is_display = 1'
        );
        $st->execute([$id, $shop_id]);
        $item = $st->fetch(PDO::FETCH_ASSOC);
        if (!$item) { http_response_code(404); echo json_encode(['error' => 'not found']); exit; }

        echo DB::jsonEncode(['item' => $item]);

    } elseif ($action === 'diaries') {
        // 写メ日記（fujoho 取込）。最新情報に混ぜる用。girl_id があればフロントでプロフURL優先
        $limit = min((int)($_GET['limit'] ?? 20), 50);
        $st = DB::conn()->prepare(
            'SELECT id, source_id, girl_id, girl_name, title, body, image, link_url, posted_at
               FROM girl_diaries
              WHERE shop_id = ? AND is_display = 1
              ORDER BY posted_at DESC, id DESC
              LIMIT ' . $limit
        );
        $st->execute([$shop_id]);
        echo DB::jsonEncode(['diaries' => $st->fetchAll(PDO::FETCH_ASSOC)]);

    } else {
        $limit = min((int)($_GET['limit'] ?? 100), 100);
        $st = DB::conn()->prepare(
            'SELECT id, title, thumb, body, posted_at
               FROM news
              WHERE shop_id = ? AND is_display = 1
              ORDER BY posted_at DESC, id DESC
              LIMIT ' . $limit
        );
        $st->execute([$shop_id]);
        $items = $st->fetchAll(PDO::FETCH_ASSOC);

        echo DB::jsonEncode(['items' => $items]);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
