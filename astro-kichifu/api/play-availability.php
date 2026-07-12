<?php
// ==========================================================================
// api/play-availability.php — 「最速で遊べる時間」bot連携API（正データ配信）
//   CTRL /ctrl/play-availability.php が正。各媒体bot（情報局/駅ちか/ヘブン）は
//   本APIを updated_at ポーリング（1〜3分間隔、updated_since で差分）して媒体へ反映する。
//   オフィシャル側は媒体へ直接POSTしない（媒体操作は別bot＝スコープ外）。
//
//   認証: HTTPヘッダー X-Api-Key（または ?key=）が db-config.php の PLAY_API_KEY と一致。
//         PLAY_API_KEY 未定義/空 → 503（未設定=機能OFF、GEMINI_API_KEYと同じ流儀）。
//
//   GET  /api/play-availability.php?shop_id=1[&status=active|cleared|all][&updated_since=ISO8601][&cast_id=N]
//        → {items:[{cast_id,name,play_at,status,list_flag,note,updated_at,media_ids:{fujoho,ekichika,heaven}}],server_time}
//        play_at/updated_at は ISO8601 +09:00。status 既定=active。updated_since は「その時刻以降(含む)」。
//   PUT/POST /api/play-availability.php?shop_id=1&cast_id=N  body(JSON): {play_at?,status?,list_flag?,note?}
//        → upsert。play_at は ISO8601（+09:00推奨）。status=cleared のみでクリア可。
//   ※ パスパラメータ形式（/{cast_id}）はシンレンApacheのリライト都合でクエリ形式に統一。
// ==========================================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/db-config.php';   // PLAY_API_KEY を認証チェック前に読む（db.php は DB::conn() 内で遅延読込のため）

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
date_default_timezone_set('Asia/Tokyo');

// ---- 認証 -----------------------------------------------------------------
if (!defined('PLAY_API_KEY') || PLAY_API_KEY === '') {
    http_response_code(503);
    echo json_encode(['error' => 'play api not configured']);
    exit;
}
$key = $_SERVER['HTTP_X_API_KEY'] ?? ($_GET['key'] ?? '');
if (!is_string($key) || !hash_equals(PLAY_API_KEY, $key)) {
    http_response_code(401);
    echo json_encode(['error' => 'unauthorized']);
    exit;
}

$shopId = (int)($_GET['shop_id'] ?? 1);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function iso(?string $dt): ?string {
    if (!$dt) return null;
    $t = strtotime($dt);
    return $t ? date('Y-m-d\TH:i:sP', $t) : null;
}

try {
    if ($method === 'GET') {
        $castId = (int)($_GET['cast_id'] ?? 0);
        $status = $_GET['status'] ?? 'active';
        if (!in_array($status, ['active', 'cleared', 'all'], true)) $status = 'active';

        $where  = ['pa.shop_id = ?'];
        $params = [$shopId];
        if ($castId)              { $where[] = 'pa.girl_id = ?';     $params[] = $castId; }
        if ($status !== 'all')    { $where[] = 'pa.status = ?';      $params[] = $status; }
        if (!empty($_GET['updated_since'])) {
            $ts = strtotime((string)$_GET['updated_since']);
            if ($ts === false) { http_response_code(400); echo json_encode(['error' => 'bad updated_since']); exit; }
            $where[] = 'pa.updated_at >= ?';
            $params[] = date('Y-m-d H:i:s', $ts);
        }

        $st = DB::conn()->prepare(
            'SELECT pa.girl_id, g.name, pa.play_at, pa.status, pa.list_flag, pa.note, pa.updated_at, pa.updated_by,
                    mi.fujoho_girl_id, mi.ekichika_girl_id, mi.heaven_member_id
               FROM play_availability pa
               JOIN girls g ON g.id = pa.girl_id
               LEFT JOIN girl_media_ids mi ON mi.shop_id = pa.shop_id AND mi.girl_id = pa.girl_id
              WHERE ' . implode(' AND ', $where) . '
              ORDER BY pa.play_at, pa.girl_id'
        );
        $st->execute($params);
        $items = [];
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = [
                'cast_id'    => (int)$r['girl_id'],
                'name'       => $r['name'],
                'play_at'    => iso($r['play_at']),
                'status'     => $r['status'],
                'list_flag'  => (bool)$r['list_flag'],
                'note'       => $r['note'],
                'updated_at' => iso($r['updated_at']),
                'updated_by' => $r['updated_by'],
                'media_ids'  => [
                    'fujoho'   => $r['fujoho_girl_id'],
                    'ekichika' => $r['ekichika_girl_id'],
                    'heaven'   => $r['heaven_member_id'],
                ],
            ];
        }
        echo DB::jsonEncode(['items' => $items, 'server_time' => date('Y-m-d\TH:i:sP')]);
        exit;
    }

    if ($method === 'PUT' || $method === 'POST') {
        $castId = (int)($_GET['cast_id'] ?? 0);
        if (!$castId) { http_response_code(400); echo json_encode(['error' => 'cast_id required']); exit; }

        // girl が当店に掲載中か（girl_shops 多対多で越境防止）
        $own = DB::conn()->prepare('SELECT 1 FROM girl_shops WHERE girl_id = ? AND shop_id = ?');
        $own->execute([$castId, $shopId]);
        if (!$own->fetchColumn()) { http_response_code(404); echo json_encode(['error' => 'cast not found in shop']); exit; }

        $body = json_decode(file_get_contents('php://input') ?: '', true);
        if (!is_array($body)) { http_response_code(400); echo json_encode(['error' => 'json body required']); exit; }

        $status = $body['status'] ?? 'active';
        if (!in_array($status, ['active', 'cleared'], true)) { http_response_code(400); echo json_encode(['error' => 'bad status']); exit; }

        $playAt = null;
        if (isset($body['play_at']) && $body['play_at'] !== '') {
            $ts = strtotime((string)$body['play_at']);
            if ($ts === false) { http_response_code(400); echo json_encode(['error' => 'bad play_at']); exit; }
            $ts = intdiv($ts, 300) * 300;                    // 5分刻みに切り下げ（情報局スロット準拠）
            $playAt = date('Y-m-d H:i:00', $ts);
        }

        if ($status === 'active' && $playAt === null) {
            // active なのに play_at 無し → 既存行の再activeのみ許可
            $cur = DB::conn()->prepare('SELECT play_at FROM play_availability WHERE shop_id=? AND girl_id=?');
            $cur->execute([$shopId, $castId]);
            $playAt = $cur->fetchColumn();
            if (!$playAt) { http_response_code(400); echo json_encode(['error' => 'play_at required']); exit; }
        }

        $listFlag = isset($body['list_flag']) ? (int)(bool)$body['list_flag'] : 1;
        $note     = isset($body['note']) ? mb_substr((string)$body['note'], 0, 255) : null;
        $by       = isset($body['updated_by']) ? mb_substr((string)$body['updated_by'], 0, 64) : 'api';

        if ($status === 'cleared' && $playAt === null) {
            // クリアのみ: 既存行の status を cleared に（行が無ければ何もせず ok）
            $st = DB::conn()->prepare('UPDATE play_availability SET status="cleared", updated_by=? WHERE shop_id=? AND girl_id=?');
            $st->execute([$by, $shopId, $castId]);
        } else {
            $st = DB::conn()->prepare(
                'INSERT INTO play_availability (shop_id, girl_id, play_at, status, list_flag, note, updated_by)
                 VALUES (?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE play_at=VALUES(play_at), status=VALUES(status),
                     list_flag=VALUES(list_flag), note=COALESCE(VALUES(note), note), updated_by=VALUES(updated_by)'
            );
            $st->execute([$shopId, $castId, $playAt, $status, $listFlag, $note, $by]);
        }

        // 保存後の最新を返す
        $st = DB::conn()->prepare('SELECT girl_id, play_at, status, list_flag, note, updated_at FROM play_availability WHERE shop_id=? AND girl_id=?');
        $st->execute([$shopId, $castId]);
        $r = $st->fetch(PDO::FETCH_ASSOC);
        echo DB::jsonEncode([
            'ok'   => true,
            'item' => $r ? [
                'cast_id' => (int)$r['girl_id'], 'play_at' => iso($r['play_at']), 'status' => $r['status'],
                'list_flag' => (bool)$r['list_flag'], 'note' => $r['note'], 'updated_at' => iso($r['updated_at']),
            ] : null,
        ]);
        exit;
    }

    http_response_code(405);
    echo json_encode(['error' => 'method not allowed']);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
