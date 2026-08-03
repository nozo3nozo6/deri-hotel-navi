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

    // 画像は admi2888.com の /uploads に集約保存（UPLOADS_ROOT=admi2888。kichifu側はsymlinkで同一実体）。
    // どちらのドメインの /ctrl からアップしても admi2888 の実体に保存＝両サイト即反映・実体分裂を防ぐ。
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

// 同じ画像ファイルを複数のレコードが指していることがある。
//   例1: スライダーの「高収入求人」は立川・吉祥寺の2行が同一ファイルを参照
//   例2: お知らせ(news)のサムネは速報の自動投稿がキャスト写真(girl_images)を直接参照する
//        → お知らせ削除でキャスト本体の写真が消える事故（2026-08-04 ゆあで発生）
// 片方を削除したときに実体まで消すと、残った参照が画像404になる。
// 画像を参照しうる全テーブルをここに列挙し、削除前に必ず突合する。
const UPLOAD_IMAGE_REFS = [
    'sliders'      => ['image_pc', 'image_sp'],
    'banners'      => ['image'],
    'girl_images'  => ['path'],
    'girls'        => ['media_top_image'],
    'news'         => ['thumb'],
    'events'       => ['thumb'],
    'girl_diaries' => ['image'],
    'hotels'       => ['image'],
];

/** その画像を（自分以外の）レコードがまだ使っているか。テーブル/カラム名は上の定数のみ */
function upload_in_use(?string $rel, string $selfTable = '', int $selfId = 0): bool {
    if (!$rel || !str_starts_with($rel, '/uploads/')) return false;
    foreach (UPLOAD_IMAGE_REFS as $table => $cols) {
        foreach ($cols as $col) {
            $sql = "SELECT COUNT(*) FROM `$table` WHERE `$col` = ?";
            $bind = [$rel];
            if ($table === $selfTable && $selfId > 0) { $sql .= ' AND id <> ?'; $bind[] = $selfId; }
            $st = db()->prepare($sql);
            $st->execute($bind);
            if ((int)$st->fetchColumn() > 0) return true;
        }
    }
    return false;
}

/** 他が使っていないときだけ実体を消す。行の削除・画像の差し替え/削除は必ずこちらを使う */
function delete_upload_safe(?string $rel, string $selfTable = '', int $selfId = 0): void {
    if (!$rel) return;
    if (upload_in_use($rel, $selfTable, $selfId)) return;
    delete_upload($rel);
}
