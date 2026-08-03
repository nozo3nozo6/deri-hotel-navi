<?php
// ==========================================================================
// content-actions.php — 汎用 非同期アクション（JSON）
//   ホワイトリストのテーブルに対し toggle / delete / reorder
//   table名は必ずホワイトリストのキー経由でのみSQLに渡す（注入防止）
//   スコープは $TABLES の第3要素で決める（自店のみ / 共有 / 表示先基準）
// ==========================================================================
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_upload.php';
header('Content-Type: application/json; charset=utf-8');

if (!current_admin()) { http_response_code(401); echo json_encode(['ok' => false]); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); echo json_encode(['ok' => false]); exit; }
if (!hash_equals($_SESSION['_csrf'] ?? '', (string)($_POST['_csrf'] ?? ''))) { http_response_code(419); echo json_encode(['ok' => false]); exit; }

// テーブル => [画像カラム配列, toggle対象カラム名|null, スコープ]
//   true  … shop_id で自店のみ
//   false … 共有マスタ（girl_categories/options/profiles/image_tags）でスコープなし
//   [中間テーブル, 外部キー] … 表示店舗トグルを持つもの。「自店のサイトに出る行」を対象にする
//     （owner で絞ると他店が作った行を消せず、サイトに残り続ける — display_scope_sql 参照）
$TABLES = [
    'news'            => [['thumb'], 'is_display', true],
    'events'          => [['thumb'], 'is_display', true],
    'banners'         => [['image'], 'is_display', ['banner_shops', 'banner_id']],
    'sliders'         => [['image_pc', 'image_sp'], 'is_display', false],   // 全店共通の1本（出し先は表示店舗トグル）
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
[$imgCols, $toggleCol, $scopeDef] = $TABLES[$table];
$shop = current_shop_id();
$action = $_POST['action'] ?? '';

// スコープ定義から WHERE 断片とバインドを組み立てる（テーブル名は全てホワイトリスト由来）
$whereShop = ''; $scopeBind = [];
if ($scopeDef === true) {
    $whereShop = ' AND shop_id=?'; $scopeBind = [$shop];
} elseif (is_array($scopeDef)) {
    [$linkTbl, $linkFk] = $scopeDef;
    [$sql, $scopeBind] = display_scope_sql("`$table`", $linkTbl, $linkFk, $shop);
    $whereShop = ' AND ' . $sql;
}
$bindShop = fn(int $id) => array_merge([$id], $scopeBind);

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
                // 同じ画像を他の行が指していることがある（例: 高収入求人の立川/吉祥寺）。
                // 実体を消すと残った行が画像404になるため delete_upload_safe で判定する。
                if ($row = $sel->fetch()) foreach ($imgCols as $c) delete_upload_safe($row[$c] ?? null, $table, $id);
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
