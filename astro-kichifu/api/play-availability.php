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
//        [&business_date=YYYY-MM-DD]  ※省略時は現在営業日 D と翌営業日 D+1 の両方を返す（明日の仕込み）
//        → {items:[{cast_id,name,play_at,reception_closed,shift_start_at,shift_end_at,shift_business_date,
//                    himewari_*,status,list_flag,note,updated_at,media_ids:{fujoho,ekichika,heaven,fuzoku,deli}}],server_time}
//        日時は ISO8601 +09:00。status 既定=active。updated_since は「その時刻以降(含む)」。
//        ★ shift_start_at/shift_end_at は各営業日の出勤表(schedules)から直接導出＝出勤表が正。
//          休み/出勤なし→null。その営業日に出勤があるキャストは play_availability 行が無くても items に
//          出る（その場合 play_at=null, status=active, updated_at=null）。
//          深夜跨ぎは実datetime（0〜9時台=翌暦日）で start < end が常に成立。
//   ★ 本日/明日（CLAUDE-NEXT-DAY-PREP.md 案A）: play_availability は (shop,girl,shift_business_date) で1行。
//        bot の本適用ルール = shift_business_date === 現在営業日 D。D+1 の item は無視すること
//        （明日の仕込み。朝5:01 の business-day-rollover.php が D 昇格後に force 同期して媒体へ載せる）。
//   PUT/POST /api/play-availability.php?shop_id=1&cast_id=N[&business_date=YYYY-MM-DD]
//        body(JSON): {play_at?,reception_closed?,status?,list_flag?,note?,himewari_minutes?,himewari_price?,
//        business_date?}（部分更新）→ upsert。play_at は ISO8601（+09:00推奨）。business_date 省略時は D。
//        status=cleared のみでクリア可。ヒメ割の分・円は null 可＝bot既定70分/11000円。
//        ※ shift_* は出勤表が正なので PUT では受けても GET には反映されない（出勤表を編集すること）。
//   ★ 受付終了（CLAUDE-UKETSUKE-SHURYO.md）= {"status":"active","play_at":null,"reception_closed":true}
//        出勤(shift_*)は残る＝媒体の出勤表・ヒメ割は維持し、即ヒメ/接客/待機だけ止める（出勤解除とは別物）。
//        連動: reception_closed=true → play_at は必ず null / play_at に時刻を入れる → reception_closed=false（再開）。
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

        // 対象営業日（CLAUDE-NEXT-DAY-PREP.md 案A）: 既定は D と D+1 の両方を返す。
        //   bot の本適用ルールは「shift_business_date === 現在営業日 D」で、D+1（明日の仕込み）は無視する
        //   → 朝5:01 の business-day-rollover.php が D になった行を force 同期する。
        //   business_date=YYYY-MM-DD で単一営業日に絞り込み可。
        $bdFilter = $_GET['business_date'] ?? '';
        if ($bdFilter !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $bdFilter)) {
            http_response_code(400); echo json_encode(['error' => 'bad business_date']); exit;
        }

        // 出勤帯（shift_start_at/shift_end_at）は各営業日の出勤表(schedules)から**直接導出**する
        // （CLAUDE-SCHEDULE-API.md）。schedules.work_date 自体が営業日（朝5時区切り）＝粒度は完全一致。
        //   - 事前登録された出勤・削除・休みが常に正確に反映される（保存フック漏れが構造的に起きない）
        //   - その営業日に出勤があるキャストは play_availability 行が無くても items に出る
        //   - 休み/出勤なし → 両方 null
        $bizDate = date('Y-m-d', time() - 5 * 3600);                      // 現在営業日 D
        $nextDate = date('Y-m-d', strtotime($bizDate . ' +1 day'));       // 翌営業日 D+1（明日の仕込み）
        $dates = $bdFilter !== '' ? [$bdFilter] : [$bizDate, $nextDate];

        $sql =
            'SELECT g.id AS girl_id, g.name,
                    pa.id AS pa_id, pa.play_at, pa.reception_closed, pa.himewari_enabled, pa.himewari_minutes, pa.himewari_price,
                    pa.status, pa.list_flag, pa.note, pa.updated_at, pa.updated_by,
                    s.work_date AS w_date, s.start_time AS w_start, s.end_time AS w_end,
                    mi.fujoho_girl_id, mi.ekichika_girl_id, mi.heaven_member_id, mi.fuzoku_girl_no, mi.deli_girl_no
               FROM girls g
               JOIN girl_shops gs ON gs.girl_id = g.id
               LEFT JOIN play_availability pa ON pa.girl_id = g.id AND pa.shop_id = ? AND pa.shift_business_date = ?
               LEFT JOIN girl_media_ids mi   ON mi.girl_id = g.id AND mi.shop_id = ?
               LEFT JOIN schedules s ON s.girl_id = g.id AND s.shop_id = ? AND s.work_date = ? AND s.status = "work"
              WHERE %WHERE%
              ORDER BY pa.play_at IS NULL, pa.play_at, g.id';

        $rows = [];
        foreach ($dates as $bd) {
            $where  = ['gs.shop_id = ?'];
            $joinParams  = [$shopId, $bd, $shopId, $shopId, $bd];   // pa.shop / pa.営業日 / mi.shop / s.shop / s.date
            $whereParams = [$shopId];                                // WHERE句の先頭= gs.shop_id
            if ($castId) { $where[] = 'g.id = ?'; $whereParams[] = $castId; }
            if ($status === 'all') {
                $where[] = '(pa.id IS NOT NULL OR s.girl_id IS NOT NULL)';
            } elseif ($status === 'cleared') {
                $where[] = 'pa.status = ?';
                $whereParams[] = 'cleared';
            } else { // active: pa行がactive、または pa行なしでもその営業日に出勤あり（仮想active）
                $where[] = '(pa.status = ? OR (pa.id IS NULL AND s.girl_id IS NOT NULL))';
                $whereParams[] = 'active';
            }
            if (!empty($_GET['updated_since'])) {
                $ts = strtotime((string)$_GET['updated_since']);
                if ($ts === false) { http_response_code(400); echo json_encode(['error' => 'bad updated_since']); exit; }
                $where[] = 'pa.updated_at >= ?';
                $whereParams[] = date('Y-m-d H:i:s', $ts);
            }
            $st = DB::conn()->prepare(str_replace('%WHERE%', implode(' AND ', $where), $sql));
            $st->execute(array_merge($joinParams, $whereParams));
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) { $r['bd'] = $bd; $rows[] = $r; }
        }

        // 出勤 TIME → 実datetime（0〜9時台=翌暦日の深夜側。start<end が常に成立）
        $shiftDt = function (?string $wDate, ?string $t): ?string {
            if (!$wDate || !$t) return null;
            $h = (int)substr($t, 0, 2);
            $d = ($h >= 10) ? $wDate : date('Y-m-d', strtotime($wDate . ' +1 day'));
            return $d . ' ' . substr($t, 0, 5) . ':00';
        };

        $items = [];
        foreach ($rows as $r) {
            $hasPa = $r['pa_id'] !== null;
            $bd    = $r['bd'];                       // この item の営業日（D or D+1）
            // 陳腐化ガード: play_at がその営業日の窓（当日5:00〜翌5:00）の外＝別営業日の残骸なら null 扱い
            //   （botが古い即姫を「今すぐ」として媒体に出さないようにする二重防御。DB側は出勤保存時の
            //   ルールAが正す）。★ 出勤開始との比較で判定しないこと: 出勤前に「今すぐ」で先に宣伝する
            //   運用が正当にあり（21:00出勤に20:45の即姫）、開始比較だとそれを消してしまう（2026-07-16 事故）。
            $winFrom = strtotime($bd . ' 05:00:00');
            $winTo   = strtotime($bd . ' 05:00:00 +1 day');
            $playAtRaw = ($hasPa && $r['play_at'] !== null
                && strtotime($r['play_at']) >= $winFrom && strtotime($r['play_at']) < $winTo)
                ? $r['play_at'] : null;
            $items[] = [
                'cast_id'             => (int)$r['girl_id'],
                'name'                => $r['name'],
                'play_at'             => iso($playAtRaw),
                // 受付終了（CLAUDE-UKETSUKE-SHURYO.md）: 出勤(shift_*)は残したまま即ヒメ/接客/待機だけ止める。
                //   true のとき bot は sugu_hime取消 / ekichika(sokuiku解除+playing OFF) / heaven(ensureStandbyOffのみ)
                //   / fuzoku・deli(NOTAVAILABLE) を実行し、schedule(出勤表)・himewari(ヒメ割)は触らない。
                'reception_closed'    => $hasPa ? (bool)$r['reception_closed'] : false,
                'shift_start_at'      => iso($shiftDt($r['w_date'], $r['w_start'])),
                'shift_end_at'        => iso($shiftDt($r['w_date'], $r['w_end'])),
                // ★ bot の本適用ルール: shift_business_date === 現在営業日 D の item だけ媒体へ反映し、
                //   D+1（明日の仕込み）は無視する（朝5:01の business-day-rollover.php が D 昇格後に force 同期）。
                'shift_business_date' => $bd,
                'himewari_enabled'    => $hasPa ? (bool)$r['himewari_enabled'] : false,   // 廃止方針・bot非参照（互換のため残置）
                'himewari_minutes'    => ($hasPa && $r['himewari_minutes'] !== null) ? (int)$r['himewari_minutes'] : null,
                'himewari_price'      => ($hasPa && $r['himewari_price']   !== null) ? (int)$r['himewari_price']   : null,
                'status'              => $hasPa ? $r['status'] : 'active',
                'list_flag'           => $hasPa ? (bool)$r['list_flag'] : true,
                'note'                => $hasPa ? $r['note'] : null,
                'updated_at'          => $hasPa ? iso($r['updated_at']) : null,
                'updated_by'          => $hasPa ? $r['updated_by'] : null,
                'media_ids'           => [
                    'fujoho'   => $r['fujoho_girl_id'],
                    'ekichika' => $r['ekichika_girl_id'],
                    'heaven'   => $r['heaven_member_id'],
                    'fuzoku'   => $r['fuzoku_girl_no'],
                    'deli'     => $r['deli_girl_no'],
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

        // 対象営業日（CLAUDE-NEXT-DAY-PREP.md §6.2）: business_date 指定で D / D+1 を書き分け。省略時は現在営業日 D。
        //   D+1 に保存した行は bot が無視する（明日の仕込み）→ 朝5:00に D 昇格後 force 同期で媒体へ載る。
        $putBd = $body['business_date'] ?? ($_GET['business_date'] ?? '');
        if ($putBd === '') $putBd = date('Y-m-d', time() - 5 * 3600);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$putBd) || date('Y-m-d', strtotime((string)$putBd)) !== $putBd) {
            http_response_code(400); echo json_encode(['error' => 'bad business_date']); exit;
        }

        $status = $body['status'] ?? 'active';
        if (!in_array($status, ['active', 'cleared'], true)) { http_response_code(400); echo json_encode(['error' => 'bad status']); exit; }

        // 5分刻み丸めヘルパー（情報局スロット準拠）。空/未指定は null。不正は false。
        $floor5 = function ($v) {
            if ($v === null || $v === '') return null;
            $ts = strtotime((string)$v);
            if ($ts === false) return false;
            return date('Y-m-d H:i:00', intdiv($ts, 300) * 300);
        };

        // play_at: 指定あり→丸め / 未指定→既存維持（NULL可＝ヒメ割のみのキャストもある）
        $playAtProvided = array_key_exists('play_at', $body);
        $playAt = null;
        if ($playAtProvided) {
            $playAt = $floor5($body['play_at']);
            if ($playAt === false) { http_response_code(400); echo json_encode(['error' => 'bad play_at']); exit; }
        }

        $by = isset($body['updated_by']) ? mb_substr((string)$body['updated_by'], 0, 64) : 'api';

        // 既存行（partial更新のため）
        $cur = DB::conn()->prepare('SELECT * FROM play_availability WHERE shop_id=? AND girl_id=? AND shift_business_date=?');
        $cur->execute([$shopId, $castId, $putBd]);
        $existing = $cur->fetch(PDO::FETCH_ASSOC) ?: null;

        // 受付終了フラグ（CLAUDE-UKETSUKE-SHURYO.md）。status には混ぜない（GET既定 status=active から
        //   落ちると bot がヒメ割・出勤表の対象を見失うため）。指定なし→既存維持。
        //   連動: reception_closed=true → play_at は必ず null（受付終了＝即姫なし）
        //         play_at に非nullを設定 → reception_closed=false（＝再開。§2.4「今すぐ/play_at再設定で復帰」）
        $rcProvided = array_key_exists('reception_closed', $body);
        $rcClosed   = $rcProvided ? (int)(bool)$body['reception_closed'] : (int)($existing['reception_closed'] ?? 0);
        if ($rcProvided && $rcClosed) { $playAtProvided = true; $playAt = null; }
        if ($playAtProvided && $playAt !== null) $rcClosed = 0;

        // クリアのみ（play_at/himewari等を触らずステータスだけ）
        if ($status === 'cleared' && !$playAtProvided && !$rcProvided && !array_key_exists('himewari_enabled', $body)
            && !array_key_exists('shift_end_at', $body)) {
            if ($existing) {
                $st = DB::conn()->prepare('UPDATE play_availability SET status="cleared", updated_by=? WHERE shop_id=? AND girl_id=? AND shift_business_date=?');
                $st->execute([$by, $shopId, $castId, $putBd]);
            }
        } else {
            // マージ: 指定フィールドは body、未指定は既存（無ければデフォルト）
            $finalPlayAt = $playAtProvided ? $playAt : ($existing['play_at'] ?? null);
            $listFlag = array_key_exists('list_flag', $body) ? (int)(bool)$body['list_flag'] : (int)($existing['list_flag'] ?? 1);
            $note     = array_key_exists('note', $body) ? mb_substr((string)$body['note'], 0, 255) : ($existing['note'] ?? null);

            // ヒメ割フィールド
            $shiftEnd = $existing['shift_end_at'] ?? null;
            if (array_key_exists('shift_end_at', $body)) {
                $shiftEnd = $floor5($body['shift_end_at']);
                if ($shiftEnd === false) { http_response_code(400); echo json_encode(['error' => 'bad shift_end_at']); exit; }
            }
            $hwEnabled = array_key_exists('himewari_enabled', $body) ? (int)(bool)$body['himewari_enabled'] : (int)($existing['himewari_enabled'] ?? 0);
            $hwMin = $existing['himewari_minutes'] ?? null;
            if (array_key_exists('himewari_minutes', $body)) $hwMin = ($body['himewari_minutes'] === null || $body['himewari_minutes'] === '') ? null : (int)$body['himewari_minutes'];
            $hwPrice = $existing['himewari_price'] ?? null;
            if (array_key_exists('himewari_price', $body)) $hwPrice = ($body['himewari_price'] === null || $body['himewari_price'] === '') ? null : (int)$body['himewari_price'];

            $st = DB::conn()->prepare(
                'INSERT INTO play_availability
                   (shop_id, girl_id, shift_business_date, play_at, reception_closed, shift_end_at, himewari_enabled, himewari_minutes, himewari_price, status, list_flag, note, updated_by)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE play_at=VALUES(play_at), reception_closed=VALUES(reception_closed),
                     shift_end_at=VALUES(shift_end_at),
                     himewari_enabled=VALUES(himewari_enabled), himewari_minutes=VALUES(himewari_minutes),
                     himewari_price=VALUES(himewari_price), status=VALUES(status),
                     list_flag=VALUES(list_flag), note=VALUES(note), updated_by=VALUES(updated_by)'
            );
            $st->execute([$shopId, $castId, $putBd, $finalPlayAt, $rcClosed, $shiftEnd, $hwEnabled, $hwMin, $hwPrice, $status, $listFlag, $note, $by]);
        }

        // 保存後の最新を返す
        $st = DB::conn()->prepare('SELECT girl_id, shift_business_date, play_at, reception_closed, shift_end_at, himewari_enabled, himewari_minutes, himewari_price, status, list_flag, note, updated_at FROM play_availability WHERE shop_id=? AND girl_id=? AND shift_business_date=?');
        $st->execute([$shopId, $castId, $putBd]);
        $r = $st->fetch(PDO::FETCH_ASSOC);
        echo DB::jsonEncode([
            'ok'   => true,
            'item' => $r ? [
                'cast_id' => (int)$r['girl_id'], 'shift_business_date' => $r['shift_business_date'],
                'play_at' => iso($r['play_at']),
                'reception_closed' => (bool)$r['reception_closed'],
                'shift_end_at' => iso($r['shift_end_at']), 'himewari_enabled' => (bool)$r['himewari_enabled'],
                'himewari_minutes' => $r['himewari_minutes'] !== null ? (int)$r['himewari_minutes'] : null,
                'himewari_price' => $r['himewari_price'] !== null ? (int)$r['himewari_price'] : null,
                'status' => $r['status'], 'list_flag' => (bool)$r['list_flag'], 'note' => $r['note'], 'updated_at' => iso($r['updated_at']),
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
