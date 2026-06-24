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
        $imgs = DB::conn()->prepare('SELECT path FROM girl_images WHERE girl_id = ? ORDER BY sort, id');
        $imgs->execute([$id]);
        $girl['images'] = $imgs->fetchAll(PDO::FETCH_ASSOC);

        // 特徴タグ
        $tg = DB::conn()->prepare(
            'SELECT git.name FROM girl_image_tag_links gitl
               JOIN girl_image_tags git ON git.id = gitl.girl_image_tag_id
              WHERE gitl.girl_id = ? ORDER BY git.sort, git.id'
        );
        $tg->execute([$id]);
        $girl['tags'] = array_column($tg->fetchAll(PDO::FETCH_ASSOC), 'name');

        // オプション（基本プレイ / オプションプレイに分割）
        $opts = DB::conn()->prepare(
            'SELECT go.name, go.is_basic FROM girl_option_links gol
               JOIN girl_options go ON go.id = gol.girl_option_id AND go.shop_id = ?
              WHERE gol.girl_id = ?
              ORDER BY go.is_basic DESC, go.sort, go.id'
        );
        $opts->execute([$shop_id, $id]);
        $allOpts = $opts->fetchAll(PDO::FETCH_ASSOC);
        $girl['options']     = array_column($allOpts, 'name');
        $girl['basic_play']  = array_values(array_map(fn($o) => $o['name'], array_filter($allOpts, fn($o) => (int)$o['is_basic'] === 1)));
        $girl['option_play'] = array_values(array_map(fn($o) => $o['name'], array_filter($allOpts, fn($o) => (int)$o['is_basic'] === 0)));

        // プロフィール（is_display=1 のみ）
        $profs = DB::conn()->prepare(
            'SELECT gp.name, gp.type, gpv.value
               FROM girl_profile_values gpv
               JOIN girl_profiles gp ON gp.id = gpv.girl_profile_id AND gp.shop_id = ?
              WHERE gpv.girl_id = ? AND gpv.is_display = 1 AND gpv.value != ""
              ORDER BY gp.sort, gp.id'
        );
        $profs->execute([$shop_id, $id]);
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
            $where[] = 'g.is_newgirl = 1';
        }

        $limit = min((int)($_GET['limit'] ?? 200), 200);
        $sql = 'SELECT g.id, g.name, g.age, g.height, g.bust, g.cup, g.waist, g.hip,
                       g.catch_copy, g.is_newgirl, g.is_trial, g.is_tel, g.is_inbound, g.is_genderless,
                       g.girl_category_id, g.sort, g.in_date,
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

        // 特徴タグ（各カードの絵文字アイコン用）を一括取得して紐付け
        if ($girls) {
            $ids = array_column($girls, 'id');
            $ph  = implode(',', array_fill(0, count($ids), '?'));
            $tg  = DB::conn()->prepare(
                "SELECT gitl.girl_id, git.name
                   FROM girl_image_tag_links gitl
                   JOIN girl_image_tags git ON git.id = gitl.girl_image_tag_id
                  WHERE gitl.girl_id IN ($ph)
                  ORDER BY git.sort, git.id"
            );
            $tg->execute($ids);
            $byGirl = [];
            foreach ($tg->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $byGirl[$r['girl_id']][] = $r['name'];
            }
            foreach ($girls as &$g) { $g['tags'] = $byGirl[$g['id']] ?? []; }
            unset($g);
        }

        echo DB::jsonEncode(['girls' => $girls]);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
