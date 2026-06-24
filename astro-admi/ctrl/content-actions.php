<?php
// ==========================================================================
// content-actions.php — 汎用 非同期アクション（JSON）
//   ホワイトリストのテーブルに対し toggle / delete / reorder
//   table名は必ずホワイトリストのキー経由でのみSQLに渡す（注入防止）
//   全て shop_id スコープ
// ==========================================================================
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_upload.php';
header('Content-Type: application/json; charset=utf-8');

if (!current_admin()) { http_response_code(401); echo json_encode(['ok' => false]); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); echo json_encode(['ok' => false]); exit; }
if (!hash_equals($_SESSION['_csrf'] ?? '', (string)($_POST['_csrf'] ?? ''))) { http_response_code(419); echo json_encode(['ok' => false]); exit; }

// テーブル => [画像カラム配列, toggle対象カラム名|null]
$TABLES = [
    'news'            => [['thumb'], 'is_display'],
    'events'          => [['thumb'], 'is_display'],
    'banners'         => [['image'], 'is_display'],
    'sliders'         => [['image_pc', 'image_sp'], 'is_display'],
    'hotels'          => [['image'], 'is_display'],
    'hotel_areas'     => [[], null],
    'girl_diaries'    => [['image'], 'is_display'],
    'courses'         => [[], 'is_display'],
    'girl_categories' => [[], null],
    'girl_options'    => [[], 'is_basic'],
    'girl_profiles'   => [[], null],
    'girl_image_tags' => [[], 'is_active'],
];

$table = (string)($_POST['table'] ?? '');
if (!isset($TABLES[$table])) { http_response_code(400); echo json_encode(['ok' => false, 'error' => 'table']); exit; }
[$imgCols, $toggleCol] = $TABLES[$table];
$shop = current_shop_id();
$action = $_POST['action'] ?? '';

try {
    switch ($action) {
        case 'toggle':
            if (!$toggleCol) throw new RuntimeException('no toggle');
            $id = (int)($_POST['id'] ?? 0);
            // $toggleCol はホワイトリストの固定値（is_display/is_basic/is_active）のみ
            db()->prepare("UPDATE `$table` SET `$toggleCol` = 1 - `$toggleCol` WHERE id=? AND shop_id=?")->execute([$id, $shop]);
            $v = db()->prepare("SELECT `$toggleCol` FROM `$table` WHERE id=? AND shop_id=?");
            $v->execute([$id, $shop]);
            echo json_encode(['ok' => true, 'value' => (int)$v->fetchColumn()]);
            break;

        case 'delete':
            $id = (int)($_POST['id'] ?? 0);
            if ($imgCols) {
                $sel = db()->prepare('SELECT ' . implode(',', $imgCols) . " FROM `$table` WHERE id=? AND shop_id=?");
                $sel->execute([$id, $shop]);
                if ($row = $sel->fetch()) foreach ($imgCols as $c) delete_upload($row[$c] ?? null);
            }
            db()->prepare("DELETE FROM `$table` WHERE id=? AND shop_id=?")->execute([$id, $shop]);
            echo json_encode(['ok' => true]);
            break;

        case 'reorder':
            $ids = (array)($_POST['ids'] ?? []);
            $upd = db()->prepare("UPDATE `$table` SET sort=? WHERE id=? AND shop_id=?");
            foreach (array_values($ids) as $i => $id) $upd->execute([$i, (int)$id, $shop]);
            echo json_encode(['ok' => true]);
            break;

        default:
            http_response_code(400);
            echo json_encode(['ok' => false]);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'server']);
}
