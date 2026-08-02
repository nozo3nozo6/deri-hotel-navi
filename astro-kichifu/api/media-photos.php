<?php
// ==========================================================================
// api/media-photos.php — 媒体への写真自動同期用のデータ源（bot が読む）
//   写真パック（ctrl/girl-media-pack.php）と同じ並び順ルールを1箇所に集約し、
//   bot が「どのキャストに、どの順で、どの画像を」アップすべきかを確定できるようにする。
//
//   並び順（写真パックと同一）:
//     slot 1 = 媒体用1枚目(media_top_image。設定されていれば解像度不問で採用)。未設定ならオフィシャル①
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
 * 媒体用1枚目(media_top_image)は店長が「媒体のメイン写真」として明示的に設定した画像なので、
 * 設定されていれば解像度に関わらず slot1 に採用する（画質は店長の責任＝CTRLで実寸を表示して判断）。
 * 実ファイルが無い/画像として読めない場合のみ除外して公式①にフォールバック。
 */
function ordered_photo_paths(string $mediaTop, array $official, string $uploadsBase): array
{
    $mediaTop = trim($mediaTop);
    if ($mediaTop !== '' && !@getimagesize($uploadsBase . $mediaTop)) {
        $mediaTop = ''; // ファイル欠損/非画像のみ除外
    }
    $paths = [];
    if ($mediaTop !== '') {
        $paths[] = $mediaTop;                     // slot1 = 媒体用1枚目（レインボー枠版）
        foreach (array_slice($official, 1) as $p) $paths[] = $p; // slot2〜 = 公式②以降（公式①は媒体に出さない）
    } else {
        foreach ($official as $p) $paths[] = $p;  // media_top 無し = 公式①から全部
    }
    return array_values(array_filter($paths, static fn ($p) => trim((string)$p) !== ''));
}

/**
 * 店舗ごとの JPEG 品質（+ 作り直し版 v=N）。
 *
 * 情報局は「同じ画像の再登録」を『重複画像になっています』で拒否する。判定は
 * ファイルのバイト列ではなく展開後の画素で行われ（末尾へのバイト追加や COM 挿入では
 * 回避できない）、**店舗をまたいで**効く。立川と吉祥寺は同じキャスト＝同じ写真を
 * 共有しているため、両店に同一バイトを配ると先に上げた店が勝ち、後の店は弾かれる。
 *
 * 【証拠】情報局の保存ファイル名に入っている時刻を復元すると、吉祥寺の直後に走った
 * 立川のアップは軒並み保存されていなかった（ここあ: 吉祥寺 7/27 19:37 に対し立川は
 * 7/15 のまま／はな: 同 7/27 19:38 に対し立川は 7/12 のまま）。bot のログは旧実装の
 * 誤判定で「成功」と出ていたため、長らく気づけなかった。唯一通ったいちかは両店が
 * 同じ秒に上げており、競合をすり抜けただけ。
 *
 * → 店舗ごとに品質を1段ずらし、見た目は同じで画素が違う画像を配る。
 *   吉祥寺(2)=90 は既にアップ済みの分と揃えるため据え置き、立川(1)をずらす。
 * v=1,2… は「同じ絵をさらに作り直した版」。bot が万一それでも拒否されたとき用の逃げ道。
 * 2段ずつ下げるのは、作り直し版が【他店の既定品質と同じ値】に着地して
 * 新たな衝突を生むのを防ぐため（1段ずつだと 吉祥寺v=1=89 が 立川の既定と一致してしまう）。
 */
function media_jpeg_quality(int $shopId, int $variant = 0): int
{
    $base = [1 => 89, 2 => 90][$shopId] ?? max(80, 91 - $shopId);
    return max(75, $base - 2 * max(0, $variant));
}

/** 画像ファイル → JPEG バイト（WebP/PNG/JPEG対応。girl-media-pack.php と同一の並び・変換） */
function to_jpeg_bytes(string $absPath, int $quality = 90): ?string
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
    imagejpeg($src, null, $quality);
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
        // 女性は共有プール（girls.shop_id は主店舗のみ）。掲載店判定は girl_shops 多対多で行う
        // （旧: girls.shop_id=? だと吉祥寺(shop_id=2)の共有キャストが404になり写真同期不能だった 2026-07-23）
        $g = DB::conn()->prepare('SELECT g.media_top_image FROM girls g JOIN girl_shops gs ON gs.girl_id = g.id AND gs.shop_id = ? WHERE g.id = ?');
        $g->execute([$shopId, $girlId]);
        $row = $g->fetch(PDO::FETCH_ASSOC);
        if (!$row) { http_response_code(404); echo 'not found'; exit; }
        $im = DB::conn()->prepare('SELECT path FROM girl_images WHERE girl_id = ? ORDER BY sort, id');
        $im->execute([$girlId]);
        $paths = ordered_photo_paths((string)$row["media_top_image"], array_column($im->fetchAll(PDO::FETCH_ASSOC), "path"), $uploadsBase);
        if (!isset($paths[$slot - 1])) { http_response_code(404); echo 'no such slot'; exit; }
        $bytes = to_jpeg_bytes($uploadsBase . $paths[$slot - 1], media_jpeg_quality($shopId, (int)($_GET['v'] ?? 0)));
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
