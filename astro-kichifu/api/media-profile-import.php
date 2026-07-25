<?php
// ==========================================================================
// api/media-profile-import.php — 媒体の現行プロフィール（キャッチ/コメント）をCTRLへ取り込む受け口
//   bot bin/import-girl-profiles.php が各媒体の編集フォームから現行値を読み取り、本APIへPOST。
//   girl_media_profiles に upsert（既定は「空のときだけ埋める」＝CTRLで入力済みの専用文は守る。
//   overwrite=1 で媒体値を正として上書き）。同期テスト前の初期取り込み用（2026-07-20 店長指示）。
//
//   認証: X-Api-Key = PLAY_API_KEY。
//   GET  ?action=targets&media=fuzoku → {items:{media_id: girl_id,...}}  ※girl_media_ids のDB紐付け分
//        fuzoku/deli は edit_id（girledit 内部ID）も返す。管理no(girl_no)とは別体系（278=ことね誤爆の教訓）
//   POST body {media, overwrite?:0|1, items:[{media_id, name?, catch?, comment?}]}
//        → media_id を girl_media_ids で girl_id に解決し upsert。結果集計を返す。
//   POST ?action=save-edit-ids body {media:fuzoku|deli, items:[{girl_id, edit_id}]}
//        → bot が名前解決した girledit 内部IDを girl_media_ids へ永続化（次回から解決不要）
// ==========================================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/db-config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
date_default_timezone_set('Asia/Tokyo');

if (!defined('PLAY_API_KEY') || PLAY_API_KEY === '') {
    http_response_code(503); echo json_encode(['error' => 'api not configured']); exit;
}
$key = $_SERVER['HTTP_X_API_KEY'] ?? ($_GET['key'] ?? '');
if (!is_string($key) || !hash_equals(PLAY_API_KEY, $key)) {
    http_response_code(401); echo json_encode(['error' => 'unauthorized']); exit;
}

$MEDIA_COL = [
    'fujoho'   => 'fujoho_girl_id',
    'ekichika' => 'ekichika_girl_id',
    'heaven'   => 'heaven_member_id',
    'fuzoku'   => 'fuzoku_girl_no',
    'deli'     => 'deli_girl_no',
    'fucolle'  => 'fucolle_girl_id',
    'manzoku'  => 'manzoku_girl_id',
    'mensv'    => 'mensv_girl_id',
];
$shopId = (int)($_GET['shop_id'] ?? 1);

try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
        if (($_GET['action'] ?? '') !== 'targets') { http_response_code(400); echo json_encode(['error' => 'action=targets']); exit; }
        $media = (string)($_GET['media'] ?? '');
        if (!isset($MEDIA_COL[$media])) { http_response_code(400); echo json_encode(['error' => 'bad media']); exit; }
        $col = $MEDIA_COL[$media];
        $editCol = ($media === 'fuzoku' || $media === 'deli') ? "{$media}_edit_id" : null;
        $editSel = $editCol ? ", mi.{$editCol} AS edit_id" : '';
        $st = DB::conn()->prepare(
            "SELECT mi.girl_id, mi.{$col} AS media_id, g.name{$editSel}
               FROM girl_media_ids mi
               JOIN girls g ON g.id = mi.girl_id AND g.is_display = 1
              WHERE mi.shop_id = ? AND mi.{$col} IS NOT NULL AND mi.{$col} <> ''"
        );
        $st->execute([$shopId]);
        $items = [];
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $item = ['girl_id' => (int)$r['girl_id'], 'name' => $r['name']];
            if ($editCol) $item['edit_id'] = (string)($r['edit_id'] ?? '');
            $items[(string)$r['media_id']] = $item;
        }
        echo DB::jsonEncode(['ok' => true, 'media' => $media, 'count' => count($items), 'items' => $items]);
        exit;
    }

    // POST ?action=save-edit-ids: bot が解決した girledit 内部IDの書き戻し（fuzoku/deli のみ）
    if (($_GET['action'] ?? '') === 'save-edit-ids') {
        $body = json_decode(file_get_contents('php://input') ?: '', true);
        $media = (string)($body['media'] ?? '');
        if ($media !== 'fuzoku' && $media !== 'deli') { http_response_code(400); echo json_encode(['error' => 'media must be fuzoku|deli']); exit; }
        $editCol = "{$media}_edit_id";
        $up = DB::conn()->prepare("UPDATE girl_media_ids SET {$editCol} = ? WHERE shop_id = ? AND girl_id = ?");
        $saved = 0;
        foreach ((array)($body['items'] ?? []) as $it) {
            $gid = (int)($it['girl_id'] ?? 0);
            $eid = preg_replace('/\D+/', '', (string)($it['edit_id'] ?? ''));
            if (!$gid || $eid === '') continue;
            $up->execute([$eid, $shopId, $gid]);
            $saved += $up->rowCount() > 0 ? 1 : 0;
        }
        echo DB::jsonEncode(['ok' => true, 'saved' => $saved]);
        exit;
    }

    // POST ?action=sync-result: bot(Orchestrator) が同期1回分の媒体別結果を返す受け口。
    //   契約: official-media-update/references/GROK-TO-CLAUDE-sync-result-contract-2026-07-25.md
    //   body {request_id, mode:create|profile|photo, shop_id, girl_id, finished_at, results:[{media,status,media_id,detail}]}
    //   status は必ず小文字 created|skipped|failed。request_id は CTRL の同期ボタン1クリック＝1個で、
    //   これが無いと「どのクリックの結果か」を特定できない（別の子の結果を出す事故になる）。
    //   girl-edit.php が action=sync-status でポーリングし、🆕/🔄 の下に媒体別チップを出す。
    if (($_GET['action'] ?? '') === 'sync-result') {
        $body = json_decode(file_get_contents('php://input') ?: '', true);
        $reqId = trim((string)($body['request_id'] ?? ''));
        $gid   = (int)($body['girl_id'] ?? 0);
        $mode  = (string)($body['mode'] ?? '');
        if ($reqId === '' || !$gid) { http_response_code(400); echo json_encode(['error' => 'request_id and girl_id required']); exit; }
        if (!in_array($mode, ['create', 'profile', 'photo', 'both'], true)) $mode = 'create';
        // 遅延作成（他テーブル同様、マイグレーション不要にしておく）
        DB::conn()->exec(
            'CREATE TABLE IF NOT EXISTS media_sync_results (
               request_id  VARCHAR(64)  NOT NULL,
               shop_id     TINYINT      NOT NULL,
               media       VARCHAR(20)  NOT NULL,
               girl_id     INT          NOT NULL,
               mode        VARCHAR(10)  NOT NULL,
               status      VARCHAR(10)  NOT NULL,
               media_id    VARCHAR(64)  NULL,
               detail      TEXT         NULL,
               finished_at DATETIME     NULL,
               created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (request_id, shop_id, media),
               KEY idx_girl (girl_id, created_at)
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
        );
        $fin = null;
        $rawFin = trim((string)($body['finished_at'] ?? ''));
        if ($rawFin !== '' && ($ts = strtotime($rawFin)) !== false) $fin = date('Y-m-d H:i:s', $ts);
        $up = DB::conn()->prepare(
            'INSERT INTO media_sync_results (request_id, shop_id, media, girl_id, mode, status, media_id, detail, finished_at)
             VALUES (?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE status=VALUES(status), media_id=VALUES(media_id),
                                     detail=VALUES(detail), finished_at=VALUES(finished_at)'
        );
        $saved = 0;
        foreach ((array)($body['results'] ?? []) as $r) {
            $mk = (string)($r['media'] ?? '');
            if (!isset($MEDIA_COL[$mk])) continue;                        // 未知の媒体キーは無視
            $stt = strtolower(trim((string)($r['status'] ?? '')));
            if (!in_array($stt, ['created', 'skipped', 'failed'], true)) $stt = 'failed';
            $mid = trim((string)($r['media_id'] ?? ''));
            $up->execute([
                $reqId, $shopId, $mk, $gid, $mode, $stt,
                $mid !== '' ? $mid : null,
                mb_substr(trim((string)($r['detail'] ?? '')), 0, 500) ?: null,
                $fin,
            ]);
            $saved++;
        }
        // 古い結果は溜め続けない（UIは直近の1クリック分しか見ない）
        DB::conn()->exec('DELETE FROM media_sync_results WHERE created_at < (NOW() - INTERVAL 7 DAY)');
        echo DB::jsonEncode(['ok' => true, 'saved' => $saved]);
        exit;
    }

    // POST ?action=save-media-id: bot が名前解決した媒体ID（fujoho_girl_id 等）を girl_media_ids へ upsert。
    //   (shop_id, girl_id) 一意。行が無ければ作成、あれば当該媒体列のみ更新（他媒体列は保持）。
    //   吉祥寺(shop_id=2)情報局の初期ひも付け・新規キャストの自動解決で使用（2026-07-22）。
    if (($_GET['action'] ?? '') === 'save-media-id') {
        $body = json_decode(file_get_contents('php://input') ?: '', true);
        $media = (string)($body['media'] ?? '');
        if (!isset($MEDIA_COL[$media])) { http_response_code(400); echo json_encode(['error' => 'bad media']); exit; }
        $col = $MEDIA_COL[$media];
        $up = DB::conn()->prepare(
            "INSERT INTO girl_media_ids (shop_id, girl_id, {$col}) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE {$col} = VALUES({$col})"
        );
        // media_id 空 = リンク解除（NULLクリア）。誤リンク修正用（2026-07-23 れん⊂かれん誤爆対応）
        $clr = DB::conn()->prepare("UPDATE girl_media_ids SET {$col} = NULL WHERE shop_id = ? AND girl_id = ?");
        $saved = 0;
        foreach ((array)($body['items'] ?? []) as $it) {
            $gid = (int)($it['girl_id'] ?? 0);
            $mid = trim((string)($it['media_id'] ?? ''));
            if (!$gid) continue;
            if ($mid === '') { $clr->execute([$shopId, $gid]); $saved++; continue; }
            $up->execute([$shopId, $gid, $mid]);
            $saved++;
        }
        echo DB::jsonEncode(['ok' => true, 'saved' => $saved]);
        exit;
    }

    // POST: 取り込み
    $body = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($body)) { http_response_code(400); echo json_encode(['error' => 'json body required']); exit; }
    $media = (string)($body['media'] ?? '');
    if (!isset($MEDIA_COL[$media])) { http_response_code(400); echo json_encode(['error' => 'bad media']); exit; }
    $overwrite = !empty($body['overwrite']);
    $col = $MEDIA_COL[$media];

    $find = DB::conn()->prepare("SELECT girl_id FROM girl_media_ids WHERE shop_id = ? AND {$col} = ?");
    // 既定=空のときだけ埋める / overwrite=1 で媒体値を正に上書き
    $up = $overwrite
        ? DB::conn()->prepare('INSERT INTO girl_media_profiles (girl_id, media, field, value) VALUES (?,?,?,?)
                               ON DUPLICATE KEY UPDATE value = VALUES(value)')
        : DB::conn()->prepare('INSERT INTO girl_media_profiles (girl_id, media, field, value) VALUES (?,?,?,?)
                               ON DUPLICATE KEY UPDATE value = IF(value IS NULL OR value = "", VALUES(value), value)');

    $done = 0; $skippedNoGirl = 0; $wrote = [];
    foreach ((array)($body['items'] ?? []) as $it) {
        $mid = trim((string)($it['media_id'] ?? ''));
        if ($mid === '') continue;
        $find->execute([$shopId, $mid]);
        $gid = (int)$find->fetchColumn();
        if (!$gid) { $skippedNoGirl++; continue; }
        $n = 0;
        foreach (['catch', 'comment'] as $f) {
            $v = trim((string)($it[$f] ?? ''));
            if ($v === '') continue;
            $up->execute([$gid, $media, $f, $v]);
            $n++;
        }
        if ($n > 0) { $done++; $wrote[] = ['girl_id' => $gid, 'media_id' => $mid, 'fields' => $n]; }
    }
    echo DB::jsonEncode([
        'ok' => true, 'media' => $media, 'overwrite' => $overwrite ? 1 : 0,
        'imported_girls' => $done, 'skipped_no_girl' => $skippedNoGirl,
        'sample' => array_slice($wrote, 0, 5),
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'server error']);
}
