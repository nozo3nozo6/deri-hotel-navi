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

// テーブル => [画像カラム配列, toggle対象カラム名|null, shop_scopedか]
// マスタ系（girl_categories/options/profiles/image_tags）は共有プールのため shop_scoped=false
$TABLES = [
    'news'            => [['thumb'], 'is_display', true],
    'events'          => [['thumb'], 'is_display', true],
    'banners'         => [['image'], 'is_display', true],
    'sliders'         => [['image_pc', 'image_sp'], 'is_display', true],
    'hotels'          => [['image'], 'is_display', true],
    'hotel_areas'     => [[], null, true],
    'girl_diaries'    => [['image'], 'is_display', true],
    'courses'         => [[], 'is_display', true],
    'girl_categories' => [[], null, false],
    'girl_options'    => [[], 'is_basic', false],
    'girl_profiles'   => [[], null, false],
    'girl_image_tags' => [[], 'is_active', false],
];

$table = (string)($_POST['table'] ?? '');
if (!isset($TABLES[$table])) { http_response_code(400); echo json_encode(['ok' => false, 'error' => 'table']); exit; }
[$imgCols, $toggleCol, $shopScoped] = $TABLES[$table];
$shop = current_shop_id();
$action = $_POST['action'] ?? '';

// shop_scoped テーブルは WHERE id=? AND shop_id=?、共有マスタは WHERE id=? のみ
$whereShop = $shopScoped ? ' AND shop_id=?' : '';
$bindShop  = fn(int $id) => $shopScoped ? [$id, $shop] : [$id];

try {
    switch ($action) {
        case 'toggle':
            if (!$toggleCol) throw new RuntimeException('no toggle');
            $id = (int)($_POST['id'] ?? 0);
            // $toggleCol はホワイトリストの固定値（is_display/is_basic/is_active）のみ
            db()->prepare("UPDATE `$table` SET `$toggleCol` = 1 - `$toggleCol` WHERE id=?$whereShop")->execute($bindShop($id));
            $v = db()->prepare("SELECT `$toggleCol` FROM `$table` WHERE id=?$whereShop");
            $v->execute($bindShop($id));
            echo json_encode(['ok' => true, 'value' => (int)$v->fetchColumn()]);
            break;

        case 'delete':
            $id = (int)($_POST['id'] ?? 0);
            if ($imgCols) {
                $sel = db()->prepare('SELECT ' . implode(',', $imgCols) . " FROM `$table` WHERE id=?$whereShop");
                $sel->execute($bindShop($id));
                if ($row = $sel->fetch()) foreach ($imgCols as $c) delete_upload($row[$c] ?? null);
            }
            db()->prepare("DELETE FROM `$table` WHERE id=?$whereShop")->execute($bindShop($id));
            echo json_encode(['ok' => true]);
            break;

        case 'reorder':
            $ids = (array)($_POST['ids'] ?? []);
            $upd = db()->prepare("UPDATE `$table` SET sort=? WHERE id=?$whereShop");
            foreach (array_values($ids) as $i => $id) $upd->execute(array_merge([$i], $bindShop((int)$id)));
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
