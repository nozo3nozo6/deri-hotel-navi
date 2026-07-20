<?php
// ==========================================================================
// girl-media-pack.php — 媒体登録用の写真セットを一括ダウンロード（zip）
//   構成: 01_main.jpg = 媒体用1枚目（media_top_image。未設定ならオフィシャル1枚目）
//         02.jpg〜    = オフィシャル2枚目以降（媒体もオフィシャルも共通、の運用ルール）
//   媒体の登録フォームはJPEG/PNGが安全なため、保存形式（WebP）からJPEGへ変換して格納。
//   使い方: girl-edit.php の「媒体用1枚目」カードのリンクから。
// ==========================================================================
require_once __DIR__ . '/_lib.php';
$admin = require_login();
$shop = current_shop_id();

$id = (int)($_GET['id'] ?? 0);
if (!$id) { flash('err', 'idがありません。'); redirect('girls.php'); }

$st = db()->prepare('SELECT g.name, g.media_top_image FROM girls g WHERE g.id=? AND g.shop_id=?');
$st->execute([$id, $shop]);
$g = $st->fetch();
if (!$g) { flash('err', '対象が見つかりません。'); redirect('girls.php'); }

$im = db()->prepare('SELECT path FROM girl_images WHERE girl_id=? ORDER BY sort, id');
$im->execute([$id]);
$official = array_column($im->fetchAll(PDO::FETCH_ASSOC), 'path');

// 01 = 媒体用1枚目（無ければオフィシャル1枚目） / 02〜 = オフィシャル2枚目以降
$mediaTop = trim((string)($g['media_top_image'] ?? ''));
$list = [];   // [zip内ファイル名 => uploadsパス]
if ($mediaTop !== '') {
    $list['01_main.jpg'] = $mediaTop;
} elseif ($official) {
    $list['01_main.jpg'] = $official[0];
}
$n = 2;
foreach (array_slice($official, 1) as $p) {
    $list[sprintf('%02d.jpg', $n++)] = $p;
}
if (!$list) { flash('err', '画像がありません。先に画像を登録してください。'); redirect('girl-edit.php?id=' . $id); }

// 画像 → JPEG バイト列（WebP/PNG/JPEG対応・失敗はスキップ）
function to_jpeg_bytes(string $absPath): ?string {
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

$tmp = tempnam(sys_get_temp_dir(), 'mpack');
$zip = new ZipArchive();
if ($zip->open($tmp, ZipArchive::OVERWRITE) !== true) {
    flash('err', 'zip作成に失敗しました。'); redirect('girl-edit.php?id=' . $id);
}
$added = 0;
foreach ($list as $zname => $upath) {
    $bytes = to_jpeg_bytes(UPLOADS_ROOT . $upath);
    if ($bytes !== null) { $zip->addFromString($zname, $bytes); $added++; }
}
$zip->close();
if (!$added) { @unlink($tmp); flash('err', '画像の変換に失敗しました。'); redirect('girl-edit.php?id=' . $id); }

$fname = $g['name'] . '_media_pack.zip';
header('Content-Type: application/zip');
header('Content-Length: ' . filesize($tmp));
header("Content-Disposition: attachment; filename=\"media_pack_{$id}.zip\"; filename*=UTF-8''" . rawurlencode($fname));
header('Cache-Control: no-store');
readfile($tmp);
@unlink($tmp);
exit;
