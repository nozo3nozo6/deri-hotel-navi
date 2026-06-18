<?php
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_upload.php';
$admin = require_login();
$shop  = current_shop_id();

/* =========================================================
   CSV+ZIP一括インポート
   ZIP構成:
     girls.csv                  ← データ
     {名前}_1.jpg/png/webp      ← 画像（最大3枚）
     {名前}_2.jpg  ...
   ========================================================= */

$results = [];
$errors  = [];

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();

    $zf = $_FILES['zipfile'] ?? null;
    if (!$zf || ($zf['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        flash('err', 'ZIPファイルを選択してください。');
        redirect('girls-import.php');
    }

    // ZIPを一時ディレクトリに展開
    $tmpDir = sys_get_temp_dir() . '/girlsimport_' . bin2hex(random_bytes(6));
    @mkdir($tmpDir, 0700, true);

    $zip = new ZipArchive();
    if ($zip->open($zf['tmp_name']) !== true) {
        flash('err', 'ZIPファイルを開けませんでした。');
        redirect('girls-import.php');
    }
    $zip->extractTo($tmpDir);
    $zip->close();

    // girls.csv を探す（サブディレクトリも検索）
    $csvPath = null;
    $iter = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($tmpDir));
    foreach ($iter as $f) {
        if ($f->isFile() && strtolower($f->getFilename()) === 'girls.csv') {
            $csvPath = $f->getPathname();
            break;
        }
    }
    if (!$csvPath) {
        flash('err', 'ZIPの中に girls.csv が見つかりませんでした。');
        @array_map('unlink', glob("$tmpDir/*"));
        @rmdir($tmpDir);
        redirect('girls-import.php');
    }

    // 画像ファイルをインデックス化（名前 → [1=>path, 2=>path, 3=>path]）
    $imageIndex = [];
    $imgExts    = ['jpg','jpeg','png','webp','gif'];
    foreach ($iter as $f) {
        if (!$f->isFile()) continue;
        $ext = strtolower(pathinfo($f->getFilename(), PATHINFO_EXTENSION));
        if (!in_array($ext, $imgExts, true)) continue;
        // ファイル名から {名前}_{番号} を抽出
        $base = pathinfo($f->getFilename(), PATHINFO_FILENAME);
        if (preg_match('/^(.+)_([123])$/', $base, $m)) {
            $imgName = $m[1];
            $imgNum  = (int)$m[2];
            $imageIndex[$imgName][$imgNum] = $f->getPathname();
        }
    }

    // CSV パース
    $handle = fopen($csvPath, 'r');
    $header = null;
    $rowNum = 0;
    $ok     = 0;
    $skip   = 0;

    while (($row = fgetcsv($handle)) !== false) {
        $rowNum++;
        // BOM除去
        if ($rowNum === 1) $row[0] = ltrim($row[0], "\xEF\xBB\xBF");

        // ヘッダー行
        if ($rowNum === 1) {
            $header = array_map('trim', $row);
            continue;
        }
        if (!$header) continue;

        $data = [];
        foreach ($header as $i => $col) {
            $data[$col] = isset($row[$i]) ? trim($row[$i]) : '';
        }

        $name = $data['name'] ?? '';
        if ($name === '') {
            $errors[] = "行{$rowNum}: name が空のためスキップ";
            $skip++;
            continue;
        }

        // girl カラムマッピング
        $ni = fn($k) => ($data[$k] ?? '') === '' ? null : (int)$data[$k];
        $fields = [
            'shop_id'          => $shop,
            'girl_category_id' => $ni('girl_category_id'),
            'name'             => $name,
            'age'              => $ni('age'),
            'height'           => $ni('height'),
            'bust'             => $ni('bust'),
            'cup'              => $data['cup']   ?? '',
            'waist'            => $ni('waist'),
            'hip'              => $ni('hip'),
            'in_date'          => ($data['in_date'] ?? '') ?: null,
            'catch_copy'       => $data['catch_copy'] ?? $data['catch'] ?? '',
            'comment'          => $data['comment'] ?? '',
            'is_display'       => isset($data['is_display']) && $data['is_display'] !== ''
                                     ? (int)$data['is_display'] : 1,
            'is_newgirl'       => (int)($data['is_newgirl'] ?? 0),
            'is_trial'         => (int)($data['is_trial']   ?? 0),
            'is_tel'           => (int)($data['is_tel']     ?? 0),
            'is_inbound'       => (int)($data['is_inbound'] ?? 0),
            'is_genderless'    => (int)($data['is_genderless'] ?? 0),
            'sort'             => $ni('sort') ?? 0,
        ];

        db()->beginTransaction();
        try {
            $cols = implode(', ', array_keys($fields));
            $ph   = implode(', ', array_map(fn($k) => ":$k", array_keys($fields)));
            db()->prepare("INSERT INTO girls ($cols) VALUES ($ph)")->execute($fields);
            $girlId = (int)db()->lastInsertId();

            // 画像（最大3枚）
            $imgCount = 0;
            $imgs     = $imageIndex[$name] ?? [];
            ksort($imgs); // 1,2,3 順
            foreach ($imgs as $num => $imgPath) {
                if ($imgCount >= 3) break;
                // save_upload 互換の疑似 $_FILES エントリを作る
                $fakeFile = [
                    'tmp_name' => $imgPath,
                    'name'     => basename($imgPath),
                    'size'     => filesize($imgPath),
                    'error'    => UPLOAD_ERR_OK,
                ];
                $path = save_upload_from_path($imgPath, 'girls/' . $shop);
                if ($path) {
                    db()->prepare('INSERT INTO girl_images (girl_id, path, sort) VALUES (?,?,?)')
                         ->execute([$girlId, $path, $imgCount]);
                    $imgCount++;
                }
            }

            db()->commit();
            $results[] = ['name' => $name, 'id' => $girlId, 'imgs' => $imgCount];
            $ok++;
        } catch (Throwable $e) {
            db()->rollBack();
            $errors[] = "行{$rowNum} ({$name}): " . $e->getMessage();
            $skip++;
        }
    }
    fclose($handle);

    // 一時ディレクトリ削除
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($tmpDir, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($files as $f) $f->isDir() ? @rmdir($f) : @unlink($f);
    @rmdir($tmpDir);

    flash('ok', "{$ok}件を登録しました。" . ($skip ? " {$skip}件をスキップ。" : ''));
}

/* =========================================================
   save_upload_from_path — ファイルパスから直接変換保存
   ========================================================= */
function save_upload_from_path(string $srcPath, string $subdir, int $maxW = 960, int $maxH = 1280): ?string {
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

    $root = rtrim($_SERVER['DOCUMENT_ROOT'], '/') . '/uploads/' . trim($subdir, '/');
    if (!is_dir($root)) @mkdir($root, 0755, true);

    $useWebp = function_exists('imagewebp');
    $name = bin2hex(random_bytes(8)) . ($useWebp ? '.webp' : '.jpg');
    $abs  = $root . '/' . $name;
    $ok = $useWebp ? imagewebp($dst, $abs, 82) : imagejpeg($dst, $abs, 85);

    imagedestroy($src);
    imagedestroy($dst);
    return $ok ? '/uploads/' . trim($subdir, '/') . '/' . $name : null;
}

// CSVテンプレートダウンロード
if (($_GET['dl'] ?? '') === 'csv') {
    header('Content-Type: text/csv; charset=UTF-8');
    header('Content-Disposition: attachment; filename="girls_template.csv"');
    echo "\xEF\xBB\xBF"; // BOM
    $fp = fopen('php://output', 'w');
    fputcsv($fp, ['name','age','height','bust','cup','waist','hip','catch_copy','comment','is_display','is_newgirl','sort','in_date','girl_category_id']);
    fputcsv($fp, ['橘','25','158','88','F','58','88','笑顔が可愛い素人系♡','自己PR文章','1','0','0','','']);
    fputcsv($fp, ['さくら','22','162','90','G','60','90','清楚系人気嬢','','1','1','0','','']);
    fclose($fp);
    exit;
}

admin_head('女の子 一括インポート');
?>
<div class="toolbar">
  <a href="girls.php" class="btn btn-sm">← 女の子一覧</a>
  <a href="?dl=csv" class="btn btn-sm btn-outline">CSVテンプレートDL</a>
</div>

<div class="card" style="max-width:680px">
  <h2 style="margin:0 0 16px;font-size:1rem;font-weight:700;">CSV + 画像 ZIP 一括インポート</h2>

  <div class="notice info" style="margin-bottom:20px;padding:12px 16px;background:var(--bg2);border-left:3px solid var(--accent);border-radius:4px;font-size:.85rem;line-height:1.7;">
    <strong>ZIPの作り方</strong><br>
    ① 「CSVテンプレートDL」でサンプルCSVをダウンロード<br>
    ② CSV（girls.csv）と画像を同じフォルダに入れてZIP圧縮<br>
    ③ 画像ファイル名は <code>名前_1.jpg</code>（_2, _3 まで対応）<br>
    &nbsp;&nbsp;&nbsp;例: <code>橘_1.jpg</code> <code>橘_2.jpg</code> <code>橘_3.jpg</code><br>
    ④ 対応形式: jpg / png / webp（最大3枚 / 1人）<br>
    ⑤ ZIPサイズ上限: 200MB
  </div>

  <form method="post" enctype="multipart/form-data">
    <?= csrf_field() ?>
    <div class="field">
      <label>ZIPファイル</label>
      <input type="file" name="zipfile" accept=".zip" required>
    </div>
    <button type="submit" class="btn btn-primary" onclick="return confirm('インポートを実行しますか？\n（重複チェックなし・取消不可）')">
      インポート実行
    </button>
  </form>
</div>

<?php if ($results): ?>
<div class="card" style="max-width:680px;margin-top:24px;">
  <h3 style="margin:0 0 12px;font-size:.95rem;font-weight:700;">✅ 登録完了 <?= count($results) ?>件</h3>
  <table class="tbl">
    <thead><tr><th>ID</th><th>名前</th><th>画像</th><th></th></tr></thead>
    <tbody>
    <?php foreach ($results as $r): ?>
      <tr>
        <td><?= $r['id'] ?></td>
        <td><?= h($r['name']) ?></td>
        <td><?= $r['imgs'] ?>枚</td>
        <td><a href="girl-edit.php?id=<?= $r['id'] ?>" class="btn btn-sm">編集</a></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table>
</div>
<?php endif; ?>

<?php if ($errors): ?>
<div class="card" style="max-width:680px;margin-top:16px;border-left:3px solid var(--err);">
  <h3 style="margin:0 0 8px;font-size:.875rem;font-weight:700;color:var(--err);">⚠ スキップ <?= count($errors) ?>件</h3>
  <ul style="margin:0;padding-left:20px;font-size:.8rem;line-height:1.8;">
    <?php foreach ($errors as $e): ?><li><?= h($e) ?></li><?php endforeach; ?>
  </ul>
</div>
<?php endif; ?>

<?php admin_foot(); ?>
