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

/** 指定IDの girl が現在の店舗のものか */
function own_girl(int $id, int $shop): bool {
    $st = db()->prepare('SELECT 1 FROM girls WHERE id=? AND shop_id=?');
    $st->execute([$id, $shop]);
    return (bool)$st->fetchColumn();
}

try {
    switch ($action) {
        case 'toggle': {
            $id = (int)($_POST['id'] ?? 0);
            if (!own_girl($id, $shop)) throw new RuntimeException('not found');
            db()->prepare('UPDATE girls SET is_display = 1 - is_display WHERE id=?')->execute([$id]);
            $v = db()->prepare('SELECT is_display FROM girls WHERE id=?');
            $v->execute([$id]);
            echo json_encode(['ok' => true, 'value' => (int)$v->fetchColumn()]);
            break;
        }
        case 'delete': {
            $id = (int)($_POST['id'] ?? 0);
            if (!own_girl($id, $shop)) throw new RuntimeException('not found');
            // 画像の物理削除
            $imgs = db()->prepare('SELECT path FROM girl_images WHERE girl_id=?');
            $imgs->execute([$id]);
            foreach ($imgs->fetchAll() as $r) delete_upload($r['path']);
            db()->prepare('DELETE FROM girls WHERE id=?')->execute([$id]); // FKカスケードで子も削除
            echo json_encode(['ok' => true]);
            break;
        }
        case 'reorder': {
            $ids = $_POST['ids'] ?? [];
            if (!is_array($ids)) throw new RuntimeException('bad');
            $upd = db()->prepare('UPDATE girls SET sort=? WHERE id=? AND shop_id=?');
            foreach (array_values($ids) as $i => $id) $upd->execute([$i, (int)$id, $shop]);
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
