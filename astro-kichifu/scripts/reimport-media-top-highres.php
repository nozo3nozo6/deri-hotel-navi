<?php
// 媒体用1枚目を高解像度で再取り込み（デリじゃ 480×640 を正のソースに）。
//   既存の media_top_image（情報局240×320）と「同一画像」かを照合し、一致かつ高解像度のときだけ差し替える。
//   別写真（デリじゃの並び順が違う等）は差し替えずログに残す＝店長がレビュー用に。
//   admi2888 サーバー上で CLI 実行（DB + 外向きHTTP + GD 使用）。
//   Usage: php reimport-media-top-highres.php [--dry-run] [--limit=N] [--girl-id=N]
declare(strict_types=1);

// CLI 専用（web からの実行を禁止＝データ変更スクリプトのため）。サーバーで `php scripts/reimport-media-top-highres.php`。
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

require '/home/yobuho/admi2888.com/public_html/api/db.php';

$DRY = in_array('--dry-run', $argv, true);
$LIMIT = 0; $ONLY = 0;
foreach ($argv as $a) {
    if (str_starts_with($a, '--limit=')) $LIMIT = (int)substr($a, 8);
    if (str_starts_with($a, '--girl-id=')) $ONLY = (int)substr($a, 10);
}
$UPLOADS = '/home/yobuho/admi2888.com/public_html';
$SHOP = 1;

$ctx = stream_context_create(['http' => ['timeout' => 20, 'user_agent' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)']]);

/** 画像バイト → 16x16 RGB 指紋（同一画像判定用） */
function fingerprint(string $bytes): ?array {
    $s = @imagecreatefromstring($bytes);
    if (!$s) return null;
    $d = imagecreatetruecolor(16, 16);
    imagecopyresampled($d, $s, 0, 0, 0, 0, 16, 16, imagesx($s), imagesy($s));
    $px = [];
    for ($y = 0; $y < 16; $y++) for ($x = 0; $x < 16; $x++) {
        $c = imagecolorat($d, $x, $y);
        $px[] = ($c >> 16 & 255); $px[] = ($c >> 8 & 255); $px[] = ($c & 255);
    }
    imagedestroy($s); imagedestroy($d);
    return $px;
}
function fpDiff(array $a, array $b): float {
    $n = min(count($a), count($b)); if (!$n) return 999;
    $d = 0; for ($i = 0; $i < $n; $i++) $d += abs($a[$i] - $b[$i]);
    return $d / $n;
}

$pdo = DB::conn();
$sql = "SELECT g.id, g.name, g.media_top_image, mi.deli_girl_no
          FROM girls g JOIN girl_media_ids mi ON mi.girl_id = g.id AND mi.shop_id = ?
         WHERE g.shop_id = ? AND g.media_top_image IS NOT NULL AND g.media_top_image <> ''
           AND mi.deli_girl_no IS NOT NULL AND mi.deli_girl_no <> ''";
if ($ONLY) $sql .= " AND g.id = " . $ONLY;
$sql .= " ORDER BY g.id";
if ($LIMIT) $sql .= " LIMIT " . $LIMIT;
$st = $pdo->prepare($sql);
$st->execute([$SHOP, $SHOP]);
$rows = $st->fetchAll(PDO::FETCH_ASSOC);
echo "対象: " . count($rows) . "名" . ($DRY ? "（dry-run）" : "") . "\n";

$upd = $pdo->prepare('UPDATE girls SET media_top_image = ? WHERE id = ?');
$up = $skipSame = $skipMismatch = $skipSmaller = $fail = 0;

foreach ($rows as $r) {
    $gid = (int)$r['id']; $name = $r['name']; $no = $r['deli_girl_no'];
    $curAbs = $UPLOADS . $r['media_top_image'];
    $curBytes = @file_get_contents($curAbs);
    $curInfo = $curBytes ? @getimagesizefromstring($curBytes) : null;
    $curW = $curInfo ? (int)$curInfo[0] : 0;
    $curFp = $curBytes ? fingerprint($curBytes) : null;

    // デリじゃ公開ページ → girlMainImg-list の1枚目 img.g-detail
    $page = @file_get_contents("https://deli-fuzoku.jp/admi2888/girllist/girl/{$no}/", false, $ctx);
    if ($page === false) { echo "  {$name}({$gid}): デリじゃページ取得失敗 — skip\n"; $fail++; continue; }
    // girlMainImg-list スコープ内の最初の g-detail src
    $listPos = strpos($page, 'girlMainImg-list');
    $scope = $listPos !== false ? substr($page, $listPos, 4000) : $page;
    if (!preg_match('#<img[^>]*class="g-detail"[^>]*src="([^"]+gimg/[0-9]+\.jpe?g)[^"]*"#i', $scope, $m)
        && !preg_match('#src="([^"]+gimg/[0-9]+\.jpe?g)[^"]*"[^>]*class="g-detail"#i', $scope, $m)) {
        echo "  {$name}({$gid}): デリじゃ1枚目URL抽出失敗 — skip\n"; $fail++; continue;
    }
    $baseUrl = html_entity_decode($m[1], ENT_QUOTES); // クエリ除去済み（正規表現が ? 前まで）
    // 名前照合（data-selectgirlname が近くにあれば）
    if (preg_match('#data-selectgirlname="([^"]+)"#', $scope, $nm)) {
        $pageName = preg_replace('/[（(]\d+[)）].*$/u', '', trim($nm[1]));
        $norm = fn($s) => preg_replace('/\s+/u', '', trim($s));
        if ($norm($pageName) !== $norm($name)) {
            echo "  {$name}({$gid}): ⚠ デリじゃ名不一致（{$pageName}）— skip\n"; $fail++; continue;
        }
    }

    $newBytes = @file_get_contents($baseUrl, false, $ctx);
    if ($newBytes === false || strlen($newBytes) < 1000) { echo "  {$name}({$gid}): 画像DL失敗 — skip\n"; $fail++; continue; }
    $newInfo = @getimagesizefromstring($newBytes);
    $newW = $newInfo ? (int)$newInfo[0] : 0;
    if (!$newW) { echo "  {$name}({$gid}): 画像非対応 — skip\n"; $fail++; continue; }

    if ($newW <= $curW) { echo "  {$name}({$gid}): デリじゃ {$newW}px ≤ 現在 {$curW}px — skip（既に高解像度/デリじゃ側も低解像度）\n"; $skipSmaller++; continue; }

    // 同一画像照合
    $newFp = fingerprint($newBytes);
    $diff = ($curFp && $newFp) ? fpDiff($curFp, $newFp) : 999;
    if ($diff > 15) { echo "  {$name}({$gid}): ⚠ 別画像の可能性（差{$diff}）現在{$curW}px→デリじゃ{$newW}px — skip（要手動確認）\n"; $skipMismatch++; continue; }

    echo "  {$name}({$gid}): 現在{$curW}px → デリじゃ{$newW}px（同一画像 差" . round($diff, 1) . "）" . ($DRY ? " [dry]" : "") . "\n";
    if ($DRY) { $up++; continue; }

    // WebP 保存（最大1000x1400、save_upload と同流儀）
    $src = @imagecreatefromstring($newBytes);
    if (!$src) { echo "    保存失敗（decode）\n"; $fail++; continue; }
    $w = imagesx($src); $h = imagesy($src);
    $scale = min(1, 1000 / $w, 1400 / $h);
    $nw = max(1, (int)round($w * $scale)); $nh = max(1, (int)round($h * $scale));
    $dst = imagecreatetruecolor($nw, $nh);
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
    $dir = $UPLOADS . '/uploads/girls/' . $SHOP;
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $useWebp = function_exists('imagewebp');
    $fname = bin2hex(random_bytes(8)) . ($useWebp ? '.webp' : '.jpg');
    $abs = $dir . '/' . $fname;
    $ok = $useWebp ? imagewebp($dst, $abs, 85) : imagejpeg($dst, $abs, 90);
    imagedestroy($src); imagedestroy($dst);
    if (!$ok) { echo "    保存失敗（encode）\n"; $fail++; continue; }
    $rel = '/uploads/girls/' . $SHOP . '/' . $fname;
    $upd->execute([$rel, $gid]);
    // 旧ファイル削除
    if (str_starts_with((string)$r['media_top_image'], '/uploads/') && is_file($curAbs)) @unlink($curAbs);
    $up++;
    usleep(200000);
}

echo "\n=== 結果 ===\n";
echo "高解像度化: {$up} / 同一低解像度でskip: {$skipSmaller} / 別画像疑いskip: {$skipMismatch} / 失敗: {$fail}\n";
