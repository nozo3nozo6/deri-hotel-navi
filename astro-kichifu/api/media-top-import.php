<?php
// ==========================================================================
// api/media-top-import.php — 媒体の現行1枚目写真を CTRL の媒体用1枚目(girls.media_top_image)へ取り込む
//   POST body {items:[{girl_id, image_url, name?}], overwrite?:0|1}
//   - image_url は img.fujoho.jp のみ許可（bot が情報局の編集フォームから収集した現行1枚目）
//   - 既定は media_top_image が空の子だけ保存（店長が手動設定した分を上書きしない）。overwrite=1 で上書き
//   - 保存は ctrl/_upload.php と同じ流儀: GD→WebP、/uploads/girls/{shop}/、パス文字列を girls に UPDATE
//   認証: X-Api-Key = PLAY_API_KEY（play-availability 系と同じ）
// ==========================================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/db-config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (!defined('PLAY_API_KEY') || PLAY_API_KEY === '') {
    http_response_code(503); echo json_encode(['error' => 'api not configured']); exit;
}
$key = $_SERVER['HTTP_X_API_KEY'] ?? ($_GET['key'] ?? '');
if (!is_string($key) || !hash_equals(PLAY_API_KEY, $key)) {
    http_response_code(401); echo json_encode(['error' => 'unauthorized']); exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'POST only']); exit;
}

$shopId = (int)($_GET['shop_id'] ?? 1);
// 画像実体は admi2888 に集約（ctrl/_lib.php UPLOADS_ROOT と同じ。無ければ自ドキュメントルート）
$uploadsBase = is_dir('/home/yobuho/admi2888.com/public_html/uploads')
    ? '/home/yobuho/admi2888.com/public_html'
    : rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? __DIR__ . '/..'), '/');

$body = json_decode((string)file_get_contents('php://input'), true);
$items = is_array($body['items'] ?? null) ? $body['items'] : [];
$overwrite = (int)($body['overwrite'] ?? 0) === 1;
if (!$items) { http_response_code(400); echo json_encode(['error' => 'items required']); exit; }

$saved = 0; $skippedExisting = 0; $failed = 0; $results = [];
try {
    $pdo = DB::conn();
    $sel = $pdo->prepare(
        'SELECT g.id, g.name, g.media_top_image FROM girls g
          WHERE g.id = ? AND EXISTS (SELECT 1 FROM girl_shops gs WHERE gs.girl_id = g.id AND gs.shop_id = ?)'
    );
    $upd = $pdo->prepare('UPDATE girls SET media_top_image = ? WHERE id = ?');

    $dir = $uploadsBase . '/uploads/girls/' . $shopId;
    if (!is_dir($dir)) @mkdir($dir, 0755, true);

    foreach ($items as $it) {
        $gid = (int)($it['girl_id'] ?? 0);
        $url = (string)($it['image_url'] ?? '');
        $label = (string)($it['name'] ?? $gid);
        if (!$gid || !preg_match('#^https://img\.fujoho\.jp/public/img_girl/[A-Za-z0-9_.]+\.(jpe?g|png|webp)$#', $url)) {
            $failed++; $results[] = "{$label}: bad input"; continue;
        }
        $sel->execute([$gid, $shopId]);
        $g = $sel->fetch(PDO::FETCH_ASSOC);
        if (!$g) { $failed++; $results[] = "{$label}: girl not found"; continue; }
        if (!$overwrite && (string)$g['media_top_image'] !== '') { $skippedExisting++; continue; }

        $bin = @file_get_contents($url, false, stream_context_create([
            'http' => ['timeout' => 20, 'user_agent' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'],
        ]));
        if ($bin === false || strlen($bin) < 1000) { $failed++; $results[] = "{$label}: download failed"; continue; }
        $src = @imagecreatefromstring($bin);
        if (!$src) { $failed++; $results[] = "{$label}: decode failed"; continue; }

        $useWebp = function_exists('imagewebp');
        $name = bin2hex(random_bytes(8)) . ($useWebp ? '.webp' : '.jpg');
        $abs = $dir . '/' . $name;
        $ok = $useWebp ? imagewebp($src, $abs, 82) : imagejpeg($src, $abs, 85);
        imagedestroy($src);
        if (!$ok) { $failed++; $results[] = "{$label}: save failed"; continue; }

        $rel = '/uploads/girls/' . $shopId . '/' . $name;
        if ($overwrite && (string)$g['media_top_image'] !== '') {
            $old = $uploadsBase . $g['media_top_image'];
            if (str_starts_with((string)$g['media_top_image'], '/uploads/') && is_file($old)) @unlink($old);
        }
        $upd->execute([$rel, $gid]);
        $saved++;
    }
    echo DB::jsonEncode(['ok' => true, 'saved' => $saved, 'skipped_existing' => $skippedExisting, 'failed' => $failed, 'detail' => $results]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'server error']);
}
