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

// テーブル => [画像カラム配列, is_display有無]
$TABLES = [
    'news'         => [['thumb'], true],
    'events'       => [['thumb'], true],
    'banners'      => [['image'], true],
    'sliders'      => [['image_pc', 'image_sp'], true],
    'hotels'       => [['image'], true],
    'hotel_areas'  => [[], false],
    'girl_diaries' => [['image'], true],
    'courses'      => [[], true],
    'girl_categories' => [[], false],
    'girl_options' => [[], false],
    'girl_profiles' => [[], false],
    'girl_image_tags' => [[], false],
];

$table = (string)($_POST['table'] ?? '');
if (!isset($TABLES[$table])) { http_response_code(400); echo json_encode(['ok' => false, 'error' => 'table']); exit; }
[$imgCols, $hasDisplay] = $TABLES[$table];
$shop = current_shop_id();
$action = $_POST['action'] ?? '';

try {
    switch ($action) {
        case 'toggle':
            if (!$hasDisplay) throw new RuntimeException('no display');
            $id = (int)($_POST['id'] ?? 0);
            db()->prepare("UPDATE `$table` SET is_display = 1 - is_display WHERE id=? AND shop_id=?")->execute([$id, $shop]);
            $v = db()->prepare("SELECT is_display FROM `$table` WHERE id=? AND shop_id=?");
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
