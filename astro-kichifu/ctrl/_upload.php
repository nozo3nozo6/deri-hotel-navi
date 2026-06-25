<?php
// ==========================================================================
// _upload.php — 画像アップロード（GD で縮小 → WebP 保存）
//   保存先: public_html/uploads/<subdir>/xxxx.webp（/uploads/... で配信）
//   20MB まで受付、最大辺を縮小、WebP不可環境は JPEG フォールバック
// ==========================================================================

function save_upload(array $file, string $subdir, int $maxW = 1000, int $maxH = 1400): ?string {
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) return null;
    if (($file['size'] ?? 0) > 20 * 1024 * 1024) return null;

    $info = @getimagesize($file['tmp_name']);
    if (!$info) return null;
    [$w, $h] = $info;
    $src = match ($info['mime']) {
        'image/jpeg' => @imagecreatefromjpeg($file['tmp_name']),
        'image/png'  => @imagecreatefrompng($file['tmp_name']),
        'image/webp' => @imagecreatefromwebp($file['tmp_name']),
        'image/gif'  => @imagecreatefromgif($file['tmp_name']),
        default      => null,
    };
    if (!$src) return null;

    $scale = min(1, $maxW / $w, $maxH / $h);
    $nw = max(1, (int)round($w * $scale));
    $nh = max(1, (int)round($h * $scale));
    $dst = imagecreatetruecolor($nw, $nh);
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);

    // 画像は kichifu.com の /uploads に集約保存（admi2888.com/ctrl からのアップも此処へ＝実体分裂を防ぐ）。
    // UPLOADS_ROOT が無い/未定義のローカル開発時は DOCUMENT_ROOT にフォールバック。
    $base = (defined('UPLOADS_ROOT') && is_dir(UPLOADS_ROOT)) ? UPLOADS_ROOT : rtrim($_SERVER['DOCUMENT_ROOT'], '/');
    $root = $base . '/uploads/' . trim($subdir, '/');
    if (!is_dir($root)) @mkdir($root, 0755, true);

    $useWebp = function_exists('imagewebp');
    $name = bin2hex(random_bytes(8)) . ($useWebp ? '.webp' : '.jpg');
    $abs  = $root . '/' . $name;
    $ok = $useWebp ? imagewebp($dst, $abs, 82) : imagejpeg($dst, $abs, 85);

    imagedestroy($src);
    imagedestroy($dst);
    if (!$ok) return null;

    return '/uploads/' . trim($subdir, '/') . '/' . $name;
}

/** 物理ファイル削除（/uploads 配下のみ許可）。保存先と同じ UPLOADS_ROOT 基準で削除する */
function delete_upload(?string $rel): void {
    if (!$rel || !str_starts_with($rel, '/uploads/')) return;
    $base = (defined('UPLOADS_ROOT') && is_dir(UPLOADS_ROOT)) ? UPLOADS_ROOT : rtrim($_SERVER['DOCUMENT_ROOT'], '/');
    $abs = $base . $rel;
    if (is_file($abs)) @unlink($abs);
}
