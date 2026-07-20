<?php
// ==========================================================================
// api/media-photos.php — 媒体への写真自動同期用のデータ源（bot が読む）
//   写真パック（ctrl/girl-media-pack.php）と同じ並び順ルールを1箇所に集約し、
//   bot が「どのキャストに、どの順で、どの画像を」アップすべきかを確定できるようにする。
//
//   並び順（写真パックと同一）:
//     slot 1 = 媒体用1枚目(media_top_image)。未設定ならオフィシャル①
//     slot 2〜 = オフィシャル②以降（media_top があるときオフィシャル①は媒体に出さない＝除外）
//   媒体フォームは JPEG が安全なため、保存形式(WebP)から JPEG 変換して配る。
//
//   認証: X-Api-Key = PLAY_API_KEY。
//   GET ?action=targets&media=fuzoku&shop_id=1
//       → {items:{media_id:{girl_id,name,edit_id?,set_hash,photos:[{slot,filename,jpeg_url}]}}}
//         set_hash = 並び順込みのファイル名列 sha1（差し替え/並べ替え/増減を検知＝bot は前回値と比較して
//         変化時だけアップ→媒体の写真審査を無駄に再発火させない）。girl_media_ids 紐付け分のみ。
//   GET ?action=jpeg&girl_id=N&slot=K&shop_id=1
//       → その slot の画像を JPEG バイトで返す（bot はこれを CURLFile で媒体へ載せる）。
// ==========================================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/db-config.php';

if (!defined('PLAY_API_KEY') || PLAY_API_KEY === '') {
    http_response_code(503); header('Content-Type: application/json'); echo json_encode(['error' => 'api not configured']); exit;
}
$key = $_SERVER['HTTP_X_API_KEY'] ?? ($_GET['key'] ?? '');
if (!is_string($key) || !hash_equals(PLAY_API_KEY, $key)) {
    http_response_code(401); header('Content-Type: application/json'); echo json_encode(['error' => 'unauthorized']); exit;
}

$MEDIA_COL = [
    'fujoho'   => 'fujoho_girl_id',
    'ekichika' => 'ekichika_girl_id',
    'heaven'   => 'heaven_member_id',
    'fuzoku'   => 'fuzoku_girl_no',
    'deli'     => 'deli_girl_no',
];
$shopId = (int)($_GET['shop_id'] ?? 1);
$uploadsBase = is_dir('/home/yobuho/admi2888.com/public_html/uploads')
    ? '/home/yobuho/admi2888.com/public_html'
    : rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? __DIR__ . '/..'), '/');

/**
 * media_top + official からアップ順の path 配列を作る（girl-media-pack.php と同一ルール）。
 * ただし写真「同期(push)」用途では、情報局から取り込んだ低解像度プレビュー(240x320)を
 * 媒体へ押し戻すと画質が劣化するため、media_top は幅400px以上（＝店長が手動アップした
 * 高解像度の媒体用1枚目）のときだけ slot1 に採用する。低解像度なら公式①から通常配列。
 */
function ordered_photo_paths(string $mediaTop, array $official, string $uploadsBase): array
{
    $mediaTop = trim($mediaTop);
    if ($mediaTop !== '') {
        $info = @getimagesize($uploadsBase . $mediaTop);
        if (!$info || (int)$info[0] < 400) {
            $mediaTop = ''; // 取り込みプレビュー等の低解像度は push しない
        }
    }
    $paths = [];
    if ($mediaTop !== '') {
        $paths[] = $mediaTop;                     // slot1 = 媒体用1枚目（高解像度のみ）
        foreach (array_slice($official, 1) as $p) $paths[] = $p; // slot2〜 = 公式②以降（公式①は除外）
    } else {
        foreach ($official as $p) $paths[] = $p;  // media_top 無し/低解像度 = 公式①から全部
    }
    return array_values(array_filter($paths, static fn ($p) => trim((string)$p) !== ''));
}

/** 画像ファイル → JPEG バイト（WebP/PNG/JPEG対応、q90。girl-media-pack.php と同一） */
function to_jpeg_bytes(string $absPath): ?string
{
    if (!is_file($absPath)) return null;
    $info = @getimagesize($absPath);
    if (!$info) return null;
    $src = match ($info['mime']) {
        'image/webp' => @imagecreatefromwebp($absPath),
        'image/jpeg' => @imagecreatefromjpeg($absPath),
        'image/png'  => @imagecreatefrompng($absPath),
        default      => null,
    };
    if (!$src) return null;
    ob_start();
    imagejpeg($src, null, 90);
    imagedestroy($src);
    $bytes = ob_get_clean();
    return $bytes !== false && $bytes !== '' ? $bytes : null;
}

$action = $_GET['action'] ?? 'targets';

try {
    if ($action === 'jpeg') {
        $girlId = (int)($_GET['girl_id'] ?? 0);
        $slot = (int)($_GET['slot'] ?? 0);
        if (!$girlId || $slot < 1) { http_response_code(400); echo 'bad params'; exit; }
        $g = DB::conn()->prepare('SELECT media_top_image FROM girls WHERE id = ? AND shop_id = ?');
        $g->execute([$girlId, $shopId]);
        $row = $g->fetch(PDO::FETCH_ASSOC);
        if (!$row) { http_response_code(404); echo 'not found'; exit; }
        $im = DB::conn()->prepare('SELECT path FROM girl_images WHERE girl_id = ? ORDER BY sort, id');
        $im->execute([$girlId]);
        $paths = ordered_photo_paths((string)$row["media_top_image"], array_column($im->fetchAll(PDO::FETCH_ASSOC), "path"), $uploadsBase);
        if (!isset($paths[$slot - 1])) { http_response_code(404); echo 'no such slot'; exit; }
        $bytes = to_jpeg_bytes($uploadsBase . $paths[$slot - 1]);
        if ($bytes === null) { http_response_code(500); echo 'convert failed'; exit; }
        header('Content-Type: image/jpeg');
        header('Content-Length: ' . strlen($bytes));
        header('Cache-Control: no-store');
        echo $bytes;
        exit;
    }

    // action=targets
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    $media = (string)($_GET['media'] ?? '');
    if (!isset($MEDIA_COL[$media])) { http_response_code(400); echo json_encode(['error' => 'bad media']); exit; }
    $col = $MEDIA_COL[$media];
    $editCol = ($media === 'fuzoku' || $media === 'deli') ? "{$media}_edit_id" : null;
    $editSel = $editCol ? ", mi.{$editCol} AS edit_id" : '';

    // webhook 1人分を軽くするため girl_id フィルタ対応（省略時=紐付け全件）
    $onlyGirl = (int)($_GET['girl_id'] ?? 0);
    $girlCond = $onlyGirl > 0 ? ' AND mi.girl_id = ?' : '';
    $st = DB::conn()->prepare(
        "SELECT mi.girl_id, mi.{$col} AS media_id, g.name, g.media_top_image{$editSel}
           FROM girl_media_ids mi
           JOIN girls g ON g.id = mi.girl_id AND g.is_display = 1
          WHERE mi.shop_id = ? AND mi.{$col} IS NOT NULL AND mi.{$col} <> ''{$girlCond}"
    );
    $st->execute($onlyGirl > 0 ? [$shopId, $onlyGirl] : [$shopId]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);

    $imStmt = DB::conn()->prepare('SELECT path FROM girl_images WHERE girl_id = ? ORDER BY sort, id');
    $selfBase = 'media-photos.php';
    $items = [];
    foreach ($rows as $r) {
        $imStmt->execute([(int)$r['girl_id']]);
        $paths = ordered_photo_paths((string)$r["media_top_image"], array_column($imStmt->fetchAll(PDO::FETCH_ASSOC), "path"), $uploadsBase);
        $photos = [];
        $names = [];
        foreach ($paths as $i => $p) {
            $slot = $i + 1;
            $fn = basename($p);
            $names[] = $slot . ':' . $fn;
            $photos[] = [
                'slot' => $slot,
                'filename' => $fn,
                'jpeg_url' => $selfBase . '?action=jpeg&shop_id=' . $shopId . '&girl_id=' . (int)$r['girl_id'] . '&slot=' . $slot,
            ];
        }
        $item = [
            'girl_id' => (int)$r['girl_id'],
            'name' => $r['name'],
            'set_hash' => $photos ? sha1(implode('|', $names)) : '',
            'photos' => $photos,
        ];
        if ($editCol) $item['edit_id'] = (string)($r['edit_id'] ?? '');
        $items[(string)$r['media_id']] = $item;
    }
    echo DB::jsonEncode(['ok' => true, 'media' => $media, 'count' => count($items), 'items' => $items]);
} catch (Throwable $e) {
    http_response_code(500);
    if ($action !== 'jpeg') echo json_encode(['error' => 'server error']);
}
