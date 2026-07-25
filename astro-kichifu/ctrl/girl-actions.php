<?php
// ==========================================================================
// girl-actions.php — 女性まわりの非同期アクション（JSON）
//   POST: action=toggle|delete|reorder|delete-image|reorder-images|girl-images （+ _csrf）
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
        case 'reorder-images': {
            // 女性編集の画像並べ替え。ids[] の順に girl_images.sort を更新（店舗所有のみ）
            $ids = $_POST['ids'] ?? [];
            if (!is_array($ids)) throw new RuntimeException('bad');
            // 自店舗の画像だけ更新（JOIN girls で shop_id スコープ）
            $upd = db()->prepare('UPDATE girl_images gi JOIN girls g ON g.id=gi.girl_id SET gi.sort=? WHERE gi.id=? AND g.shop_id=?');
            foreach (array_values($ids) as $i => $imgId) $upd->execute([$i, (int)$imgId, $shop]);
            echo json_encode(['ok' => true]);
            break;
        }
        case 'sync-media': {
            // 保存済み（DB上）の内容を媒体へ同期。フォーム保存とは独立したアクション
            // （bot は Official API 経由で現在の DB 値を読むため、未保存の編集は反映されない＝仕様どおり）。
            $gid = (int)($_POST['girl_id'] ?? 0);
            $mode = (string)($_POST['mode'] ?? '');
            if (!own_girl($gid)) throw new RuntimeException('not found');
            $nameSt = db()->prepare('SELECT name FROM girls WHERE id=?');
            $nameSt->execute([$gid]);
            $gname = (string)($nameSt->fetchColumn() ?: '');
            [$jobs, $changed] = match ($mode) {
                'profile' => [['profile_sync'], ['profile']],
                'photo'   => [['photo_sync'], ['photo']],
                'both'    => [['profile_sync', 'photo_sync'], ['profile', 'photo']],
                // 媒体へ新規登録（bot GirlCreate）: 未登録なら作成＋ID紐付け＋写真、登録済みならスキップ（冪等）。
                // 現状は情報局のみ対応。girl_shops の全店舗へ飛ぶので立川57・吉祥寺53179 とも登録される。
                'create'  => [['girl_create'], ['create']],
                default   => throw new RuntimeException('bad mode'),
            };
            // 媒体チェック（UI: モード選択→店舗別媒体チェック→確定）。
            // 値は "店舗ID:媒体キー"（例 "1:fujoho"=情報局立川 / "2:ekichika"=駅ちか吉祥寺）。
            // 同名媒体でも立川・吉祥寺は別アカウントのため店舗別に webhook の media を分けて送る。
            // ヘブンは単体（立川アカウントのみ）= "1:heaven"。allowlist 外は無視。
            // 全モード8媒体対応（2026-07-25）: フーコレ/マンゾク/メンズバも 両方/コメント/写真 の同期対象。
            // bot 側は既存5媒体=ProfileSync/PhotoSync、追加3媒体=ExtraMediaSync（未掲載→新規登録・掲載済→更新）。
            $MEDIA_ALL = ['fujoho', 'ekichika', 'heaven', 'fuzoku', 'deli', 'fucolle', 'manzoku', 'mensv'];
            $mediaAvail = $MEDIA_ALL;
            $mediaByShop = [];   // shop_id => [媒体キー...]
            foreach ((array)($_POST['media'] ?? []) as $mv) {
                if (!preg_match('/^([12]):([a-z]+)$/', (string)$mv, $mm)) continue;
                $msid = (int)$mm[1];
                $mkey = $mm[2];
                if (!in_array($mkey, $mediaAvail, true)) continue;
                $mediaByShop[$msid][] = $mkey;
            }
            $mediaByShop = array_map(static fn($a) => array_values(array_unique($a)), $mediaByShop);
            if ($mediaByShop === []) throw new RuntimeException('no media selected');
            require_once __DIR__ . '/../api/media-webhook.php';
            // 女性は共有プール。その子が在籍する店舗(girl_shops) ∩ チェックされた店舗 に webhook を送り、
            // 各通に「その店舗でチェックされた媒体」だけを明示する（bot 側 profile_sync/photo_sync/girl_create が絞る）。
            $shopSt = db()->prepare('SELECT shop_id FROM girl_shops WHERE girl_id=?');
            $shopSt->execute([$gid]);
            $girlShops = array_values(array_unique(array_map('intval', $shopSt->fetchAll(PDO::FETCH_COLUMN))));
            if (!$girlShops) $girlShops = [$shop];
            // 同期1回分の識別子。立川・吉祥寺の2通に同じIDを載せ、bot が結果POSTでそのまま返す。
            // 連続で別の子を同期できるUIなので、これが無いと別の子の結果を表示してしまう。
            $reqId = 'ctrl_' . bin2hex(random_bytes(9));
            $notifyShops = [];
            foreach ($girlShops as $sid) {
                if (empty($mediaByShop[$sid])) continue;   // その店舗の媒体が未チェック → 送らない
                media_webhook_notify($sid, $gid, $gname, $changed, 'ctrl', $jobs, $mediaByShop[$sid], $reqId);
                $notifyShops[] = $sid;
            }
            if ($notifyShops === []) throw new RuntimeException('no media selected');
            echo json_encode(['ok' => true, 'request_id' => $reqId, 'notified_shops' => $notifyShops, 'media' => $mediaByShop]);
            break;
        }
        case 'sync-status': {
            // 同期結果のポーリング。bot が media-profile-import.php?action=sync-result で書いた
            // media_sync_results を request_id で引く（他人のクリックの結果は返らない）。
            // テーブルが未作成（bot からの結果がまだ一度も来ていない）ケースは空配列で返す。
            $reqId = trim((string)($_POST['request_id'] ?? ''));
            $gid   = (int)($_POST['girl_id'] ?? 0);
            if ($reqId === '' || !own_girl($gid)) throw new RuntimeException('bad request');
            $rows = [];
            try {
                $st = db()->prepare(
                    'SELECT shop_id, media, status, media_id, detail
                       FROM media_sync_results
                      WHERE request_id = ? AND girl_id = ?
                      ORDER BY shop_id, media'
                );
                $st->execute([$reqId, $gid]);
                $rows = $st->fetchAll(PDO::FETCH_ASSOC);
            } catch (Throwable $e) {
                $rows = [];   // 未作成テーブル等は「まだ結果なし」と同義
            }
            echo json_encode(['ok' => true, 'results' => $rows]);
            break;
        }
        case 'girl-images': {
            // 女の子の登録画像一覧（お知らせのサムネ選択用）。sort 順で path を返す
            $gid = (int)($_POST['girl_id'] ?? 0);
            $imgs = [];
            if ($gid) {
                $st = db()->prepare('SELECT id, path FROM girl_images WHERE girl_id=? ORDER BY sort, id');
                $st->execute([$gid]);
                $imgs = $st->fetchAll(PDO::FETCH_ASSOC);
            }
            echo json_encode(['ok' => true, 'images' => $imgs]);
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
