<?php
/**
 * import-cli.php — コマンドライン専用 女の子一括インポート
 *
 * girls-import.php と同じ登録ロジック（CSV + 画像 → girls / girl_images、
 * GDで960x1280 webp化）を、管理画面ログイン不要で実行する CLI 版。
 *
 * 使い方（サーバー上で）:
 *   php admin/import-cli.php <インポートディレクトリ> --yes
 *     <ディレクトリ> に girls.csv と {img_key}_1.jpg 等を置く
 *
 * 安全策:
 *   - CLI 以外からのアクセスは拒否
 *   - --yes が無ければ件数の事前表示のみで終了（ドライラン）
 *   - 既存と重複させないため、呼ぶ側で「未登録分のCSV」を渡すこと（重複チェックなし）
 */

if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }

$dir = $argv[1] ?? '';
$go  = in_array('--yes', $argv, true);
if ($dir === '' || !is_dir($dir)) { fwrite(STDERR, "usage: php import-cli.php <dir> [--yes]\n"); exit(1); }

require_once __DIR__ . '/../api/db.php';
require_once __DIR__ . '/../_inc/shop.php';   // SHOP_ID_DB

$DOCROOT = dirname(__DIR__);                   // public_html（uploads の親）
$shop    = defined('SHOP_ID_DB') ? SHOP_ID_DB : 1;

$csvPath = rtrim($dir, '/') . '/girls.csv';
if (!is_file($csvPath)) { fwrite(STDERR, "girls.csv not found in $dir\n"); exit(1); }

/* 画像インデックス（{img_key|名前}_{1,2,3} → path） */
$imageIndex = [];
$imgExts = ['jpg','jpeg','png','webp','gif'];
foreach (scandir($dir) as $f) {
    $abs = rtrim($dir, '/') . '/' . $f;
    if (!is_file($abs)) continue;
    $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
    if (!in_array($ext, $imgExts, true)) continue;
    $base = pathinfo($f, PATHINFO_FILENAME);
    if (preg_match('/^(.+?)_?([123])$/', $base, $m)) {
        $imageIndex[$m[1]][(int)$m[2]] = $abs;
    }
}

/* CSV パース */
$handle = fopen($csvPath, 'r');
$header = null; $rows = [];
$rowNum = 0;
while (($row = fgetcsv($handle)) !== false) {
    $rowNum++;
    if ($rowNum === 1) {
        $header = array_map(fn($c) => trim($c, " \t\n\r\0\x0B\"'\xEF\xBB\xBF"), $row);
        continue;
    }
    if (!$header) continue;
    $data = [];
    foreach ($header as $i => $col) $data[$col] = isset($row[$i]) ? trim($row[$i]) : '';
    if (($data['name'] ?? '') === '') continue;
    $rows[] = $data;
}
fclose($handle);

$pdo = DB::conn();
$cur = (int)$pdo->query("SELECT COUNT(*) c FROM girls WHERE shop_id = " . (int)$shop)->fetch()['c'];

echo "インポート対象: " . count($rows) . "人 / 既存: {$cur}人 (shop_id={$shop})\n";
if (!$go) { echo "※ ドライラン（--yes で実行）。\n"; exit(0); }

$ok = 0; $skip = 0; $imgTotal = 0;
foreach ($rows as $data) {
    $name = $data['name'];
    $ni = fn($k) => ($data[$k] ?? '') === '' ? null : (int)$data[$k];
    $fields = [
        'shop_id'          => $shop,
        'girl_category_id' => $ni('girl_category_id'),
        'name'             => $name,
        'age'              => $ni('age'),
        'height'           => $ni('height'),
        'bust'             => $ni('bust'),
        'cup'              => $data['cup'] ?? '',
        'waist'            => $ni('waist'),
        'hip'              => $ni('hip'),
        'in_date'          => ($data['in_date'] ?? '') ?: null,
        'catch_copy'       => $data['catch_copy'] ?? '',
        'comment'          => $data['comment'] ?? '',
        'is_display'       => isset($data['is_display']) && $data['is_display'] !== '' ? (int)$data['is_display'] : 1,
        'is_newgirl'       => (int)($data['is_newgirl'] ?? 0),
        'is_trial'         => (int)($data['is_trial'] ?? 0),
        'is_tel'           => (int)($data['is_tel'] ?? 0),
        'is_inbound'       => (int)($data['is_inbound'] ?? 0),
        'is_genderless'    => (int)($data['is_genderless'] ?? 0),
        'sort'             => $ni('sort') ?? 0,
    ];

    $pdo->beginTransaction();
    try {
        $cols = implode(', ', array_keys($fields));
        $ph   = implode(', ', array_map(fn($k) => ":$k", array_keys($fields)));
        $pdo->prepare("INSERT INTO girls ($cols) VALUES ($ph)")->execute($fields);
        $girlId = (int)$pdo->lastInsertId();

        $imgKey = ($data['img_key'] ?? '') !== '' ? $data['img_key'] : $name;
        $imgs = $imageIndex[$imgKey] ?? [];
        ksort($imgs);
        $cnt = 0;
        foreach ($imgs as $imgPath) {
            if ($cnt >= 3) break;
            $path = save_upload_from_path($imgPath, 'girls/' . $shop, $DOCROOT);
            if ($path) {
                $pdo->prepare('INSERT INTO girl_images (girl_id, path, sort) VALUES (?,?,?)')
                    ->execute([$girlId, $path, $cnt]);
                $cnt++; $imgTotal++;
            }
        }
        $pdo->commit();
        $ok++;
        echo "  ✓ {$name} (id={$girlId}, {$cnt}枚)\n";
    } catch (Throwable $e) {
        $pdo->rollBack();
        $skip++;
        fwrite(STDERR, "  ✗ {$name}: " . $e->getMessage() . "\n");
    }
}

$after = (int)$pdo->query("SELECT COUNT(*) c FROM girls WHERE shop_id = " . (int)$shop)->fetch()['c'];
echo "\n完了: 登録 {$ok}人 / 画像 {$imgTotal}枚 / スキップ {$skip} / 合計 {$after}人\n";

/* girls-import.php と同じリサイズ保存（DOCROOT を明示指定できるCLI版） */
function save_upload_from_path(string $srcPath, string $subdir, string $docroot, int $maxW = 960, int $maxH = 1280): ?string {
    $info = @getimagesize($srcPath);
    if (!$info) return null;
    [$w, $h] = $info;
    $src = match ($info['mime']) {
        'image/jpeg' => @imagecreatefromjpeg($srcPath),
        'image/png'  => @imagecreatefrompng($srcPath),
        'image/webp' => @imagecreatefromwebp($srcPath),
        'image/gif'  => @imagecreatefromgif($srcPath),
        default      => null,
    };
    if (!$src) return null;
    $scale = min(1, $maxW / $w, $maxH / $h);
    $nw = max(1, (int)round($w * $scale));
    $nh = max(1, (int)round($h * $scale));
    $dst = imagecreatetruecolor($nw, $nh);
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);

    $root = rtrim($docroot, '/') . '/uploads/' . trim($subdir, '/');
    if (!is_dir($root)) @mkdir($root, 0755, true);
    $useWebp = function_exists('imagewebp');
    $fname = bin2hex(random_bytes(8)) . ($useWebp ? '.webp' : '.jpg');
    $abs = $root . '/' . $fname;
    $okSave = $useWebp ? imagewebp($dst, $abs, 82) : imagejpeg($dst, $abs, 85);
    imagedestroy($src); imagedestroy($dst);
    return $okSave ? '/uploads/' . trim($subdir, '/') . '/' . $fname : null;
}
