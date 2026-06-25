<?php
// ==========================================================================
// girl-actions.php — 女性まわりの非同期アクション（JSON）
//   POST: action=toggle|delete|reorder|delete-image （+ _csrf）
//   全て current_shop に属するレコードのみ操作可（越境防止）
// ==========================================================================
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_upload.php';
header('Content-Type: application/json; charset=utf-8');

$admin = current_admin();
if (!$admin) { http_response_code(401); echo json_encode(['ok' => false, 'error' => 'auth']); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); echo json_encode(['ok' => false]); exit; }
if (!hash_equals($_SESSION['_csrf'] ?? '', (string)($_POST['_csrf'] ?? ''))) { http_response_code(419); echo json_encode(['ok' => false, 'error' => 'csrf']); exit; }

$shop = current_shop_id();
$action = $_POST['action'] ?? '';

/** 指定IDの girl が存在するか（共有プールなので shop_id フィルタなし）*/
function own_girl(int $id): bool {
    $st = db()->prepare('SELECT 1 FROM girls WHERE id=?');
    $st->execute([$id]);
    return (bool)$st->fetchColumn();
}

try {
    switch ($action) {
        case 'toggle': {
            // is_display 廃止 → girl_shops の当該店舗行を追加/削除でトグル
            $id = (int)($_POST['id'] ?? 0);
            if (!own_girl($id)) throw new RuntimeException('not found');
            // 対象店舗: owner は POST shop で任意指定可、staff は自店固定（越境防止）
            $target = isset($_POST['shop']) && $_POST['shop'] !== '' ? (int)$_POST['shop'] : $shop;
            if ($admin['shop_id'] && $target !== (int)$admin['shop_id']) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'forbidden shop']);
                break;
            }
            // 指定店舗が実在するか（不正IDの行作成を防ぐ）
            $okShop = db()->prepare('SELECT 1 FROM shops WHERE id=?');
            $okShop->execute([$target]);
            if (!$okShop->fetchColumn()) throw new RuntimeException('bad shop');

            $exists = db()->prepare('SELECT 1 FROM girl_shops WHERE girl_id=? AND shop_id=?');
            $exists->execute([$id, $target]);
            if ($exists->fetchColumn()) {
                db()->prepare('DELETE FROM girl_shops WHERE girl_id=? AND shop_id=?')->execute([$id, $target]);
                $val = 0;
            } else {
                db()->prepare('INSERT IGNORE INTO girl_shops (girl_id, shop_id) VALUES (?,?)')->execute([$id, $target]);
                $val = 1;
            }
            echo json_encode(['ok' => true, 'value' => $val]);
            break;
        }
        case 'delete': {
            $id = (int)($_POST['id'] ?? 0);
            if (!own_girl($id)) throw new RuntimeException('not found');
            // 画像の物理削除
            $imgs = db()->prepare('SELECT path FROM girl_images WHERE girl_id=?');
            $imgs->execute([$id]);
            foreach ($imgs->fetchAll() as $r) delete_upload($r['path']);
            db()->prepare('DELETE FROM girl_shops WHERE girl_id=?')->execute([$id]);
            db()->prepare('DELETE FROM girls WHERE id=?')->execute([$id]); // FKカスケードで子も削除
            echo json_encode(['ok' => true]);
            break;
        }
        case 'reorder': {
            $ids = $_POST['ids'] ?? [];
            if (!is_array($ids)) throw new RuntimeException('bad');
            $upd = db()->prepare('UPDATE girls SET sort=? WHERE id=?');
            foreach (array_values($ids) as $i => $id) $upd->execute([$i, (int)$id]);
            echo json_encode(['ok' => true]);
            break;
        }
        case 'delete-image': {
            $imgId = (int)($_POST['image_id'] ?? 0);
            $st = db()->prepare('SELECT gi.path FROM girl_images gi JOIN girls g ON g.id=gi.girl_id WHERE gi.id=? AND g.shop_id=?');
            $st->execute([$imgId, $shop]);
            $path = $st->fetchColumn();
            if ($path === false) throw new RuntimeException('not found');
            db()->prepare('DELETE FROM girl_images WHERE id=?')->execute([$imgId]);
            delete_upload($path);
            echo json_encode(['ok' => true]);
            break;
        }
        default:
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'unknown action']);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'server']);
}
