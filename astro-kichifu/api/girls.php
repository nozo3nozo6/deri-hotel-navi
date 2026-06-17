<?php
// ==========================================================================
// api/girls.php — 女の子一覧・詳細 JSON API
//   GET ?action=list&shop_id=1[&limit=N][&is_new=1][&category_id=N]
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
            'SELECT g.*, gc.name AS category_name
               FROM girls g
               LEFT JOIN girl_categories gc ON gc.id = g.girl_category_id AND gc.shop_id = g.shop_id
              WHERE g.id = ? AND g.shop_id = ? AND g.is_display = 1'
        );
        $st->execute([$id, $shop_id]);
        $girl = $st->fetch(PDO::FETCH_ASSOC);
        if (!$girl) { http_response_code(404); echo json_encode(['error' => 'not found']); exit; }

        // 画像
        $imgs = DB::conn()->prepare('SELECT path, alt FROM girl_images WHERE girl_id = ? ORDER BY sort, id');
        $imgs->execute([$id]);
        $girl['images'] = $imgs->fetchAll(PDO::FETCH_ASSOC);

        // オプション
        $opts = DB::conn()->prepare(
            'SELECT go.name FROM girl_option_links gol
               JOIN girl_options go ON go.id = gol.option_id AND go.shop_id = gol.shop_id
              WHERE gol.girl_id = ? AND gol.shop_id = ?
              ORDER BY go.sort, go.id'
        );
        $opts->execute([$id, $shop_id]);
        $girl['options'] = array_column($opts->fetchAll(PDO::FETCH_ASSOC), 'name');

        // プロフィール
        $profs = DB::conn()->prepare(
            'SELECT gp.name, gp.type, gpv.value
               FROM girl_profile_values gpv
               JOIN girl_profiles gp ON gp.id = gpv.profile_id AND gp.shop_id = gpv.shop_id
              WHERE gpv.girl_id = ? AND gpv.shop_id = ?
              ORDER BY gp.sort, gp.id'
        );
        $profs->execute([$id, $shop_id]);
        $girl['profiles'] = $profs->fetchAll(PDO::FETCH_ASSOC);

        echo DB::jsonEncode(['girl' => $girl]);

    } else {
        // list
        $where  = ['g.shop_id = ?', 'g.is_display = 1'];
        $params = [$shop_id];

        if (!empty($_GET['category_id'])) {
            $where[]  = 'g.girl_category_id = ?';
            $params[] = (int)$_GET['category_id'];
        }
        if (!empty($_GET['is_new'])) {
            $where[]  = 'g.is_newgirl = 1';
        }

        $limit = min((int)($_GET['limit'] ?? 200), 200);
        $sql = 'SELECT g.id, g.name, g.age, g.height, g.bust, g.cup, g.waist, g.hip,
                       g.catch_copy, g.is_newgirl, g.is_trial, g.is_tel, g.is_inbound, g.is_genderless,
                       g.girl_category_id, g.sort,
                       gc.name AS category_name,
                       (SELECT path FROM girl_images WHERE girl_id = g.id ORDER BY sort, id LIMIT 1) AS photo
                  FROM girls g
                  LEFT JOIN girl_categories gc ON gc.id = g.girl_category_id AND gc.shop_id = g.shop_id
                 WHERE ' . implode(' AND ', $where) . '
                 ORDER BY g.sort, g.id
                 LIMIT ' . $limit;
        $st = DB::conn()->prepare($sql);
        $st->execute($params);
        $girls = $st->fetchAll(PDO::FETCH_ASSOC);

        echo DB::jsonEncode(['girls' => $girls]);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
