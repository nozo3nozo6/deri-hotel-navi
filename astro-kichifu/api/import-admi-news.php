<?php
// ==========================================================================
// import-admi-news.php — admi2888.com/news を kichifu の news テーブルに取込
//   admi(MINERVA) の公開お知らせ一覧（HTML）をパースして同期する。
//   - source_id（admi の news ID）で冪等化。既存は既定スキップ（再取得しない）。
//   - サムネ画像は S3 から取得 → /uploads/news/<shop>/ に WebP 保存（kichifu に再ホスト）。
//   - 本文はプレーンテキストで保存（フロントが \n\n で段落化するため加工しない）。
//   使い方（サーバー上 / cron。Web 直アクセスは禁止）:
//     php import-admi-news.php                … 本番反映（新規のみ取込）
//     php import-admi-news.php --dry-run      … DB変更/画像保存せず結果だけ表示
//     php import-admi-news.php --pages=3      … 取込ページ数（既定5、1ページ約20件）
//     php import-admi-news.php --update       … 既存 source_id の本文/タイトル/日付も更新
//     php import-admi-news.php --refresh-images … 既存の画像も S3 から取り直す
// ==========================================================================
require_once __DIR__ . '/db.php';

// Web からの直アクセス禁止（cron / CLI 専用）
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }

date_default_timezone_set('Asia/Tokyo');

$DRY     = in_array('--dry-run', $argv, true);
$UPDATE  = in_array('--update', $argv, true);
$REFRESH = in_array('--refresh-images', $argv, true);
$SHOP_ID = 1;
$PAGES   = 5;
foreach ($argv as $a) { if (preg_match('/^--pages=(\d+)$/', $a, $m)) $PAGES = max(1, (int)$m[1]); }

$ADMI_BASE = 'https://admi2888.com';
// CLI では $_SERVER['DOCUMENT_ROOT'] が空なので api/ の親 = public_html を実体パスにする
$DOCROOT = dirname(__DIR__);

function fetchHtml(string $url): ?string {
    $ctx = stream_context_create(['http' => ['timeout' => 25, 'user_agent' => 'kichifu-news-sync']]);
    $h = @file_get_contents($url, false, $ctx);
    return $h === false ? null : $h;
}

// admi の S3 サムネを取得 → 縮小 WebP で /uploads/news/<shop>/ に保存。戻り値は /uploads/... の相対パス
function download_news_image(string $url, string $docroot, int $shop, bool $dry): ?string {
    if ($url === '') return null;
    if ($dry) return '(画像DL省略:dry)';
    $ctx = stream_context_create(['http' => ['timeout' => 30, 'user_agent' => 'kichifu-news-sync']]);
    $bin = @file_get_contents($url, false, $ctx);
    if ($bin === false || strlen($bin) < 100) return null;
    $src = @imagecreatefromstring($bin);
    if (!$src) return null;
    $w = imagesx($src); $h = imagesy($src);
    $maxW = 1000; $maxH = 1400;
    $scale = min(1, $maxW / $w, $maxH / $h);
    $nw = max(1, (int)round($w * $scale));
    $nh = max(1, (int)round($h * $scale));
    $dst = imagecreatetruecolor($nw, $nh);
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
    $dir = $docroot . '/uploads/news/' . $shop;
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $useWebp = function_exists('imagewebp');
    $name = bin2hex(random_bytes(8)) . ($useWebp ? '.webp' : '.jpg');
    $abs  = $dir . '/' . $name;
    $ok = $useWebp ? imagewebp($dst, $abs, 82) : imagejpeg($dst, $abs, 85);
    imagedestroy($src); imagedestroy($dst);
    return $ok ? '/uploads/news/' . $shop . '/' . $name : null;
}

// /uploads 配下のみ物理削除（画像差し替え時の旧ファイル掃除）
function delete_upload_abs(string $docroot, ?string $rel): void {
    if (!$rel || !str_starts_with($rel, '/uploads/')) return;
    $abs = $docroot . $rel;
    if (is_file($abs)) @unlink($abs);
}

// 「2026.06.21（日）」→「2026-06-21」
function parse_jp_date(string $s): ?string {
    if (preg_match('/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/u', $s, $m)) {
        return sprintf('%04d-%02d-%02d', (int)$m[1], (int)$m[2], (int)$m[3]);
    }
    return null;
}

// ---- 一覧ページHTMLをパース（list-group の各 a[href^="/news/数字"]） ----
function parse_news_list(string $html): array {
    $items = [];
    $doc = new DOMDocument();
    @$doc->loadHTML('<?xml encoding="UTF-8">' . $html);
    $xp = new DOMXPath($doc);
    $anchors = $xp->query('//a[starts-with(@href, "/news/")]');
    foreach ($anchors as $a) {
        $href = $a->getAttribute('href');
        if (!preg_match('#^/news/(\d+)#', $href, $m)) continue; // /news?page=2 等は除外
        $sid = $m[1];

        $h4 = $xp->query('.//h4', $a)->item(0);
        $title = $h4 ? trim($h4->textContent) : '';
        if ($title === '') continue;

        $img = $xp->query('.//div[contains(@class,"thumb")]//img/@src', $a)->item(0)
            ?: $xp->query('.//img/@src', $a)->item(0);
        $imgUrl = $img ? trim($img->nodeValue) : '';

        $dn = $xp->query('.//p[contains(@class,"newsDate")]', $a)->item(0);
        $date = $dn ? parse_jp_date(trim($dn->textContent)) : null;

        $bn = $xp->query('.//p[contains(@class,"newsTxt")]', $a)->item(0);
        $body = $bn ? trim($bn->textContent) : '';

        $items[$sid] = [
            'source_id' => $sid,
            'title'     => $title,
            'image_url' => $imgUrl,
            'date'      => $date,
            'body'      => $body,
        ];
    }
    return $items;
}

// ---- 取込 ----
$pdo = DB::conn();

// 冪等化用カラムを自己マイグレーション（MariaDB 10.11 は IF NOT EXISTS 対応）
try { $pdo->exec('ALTER TABLE news ADD COLUMN IF NOT EXISTS source_id VARCHAR(64) NULL AFTER shop_id'); } catch (Throwable $e) {}
try { $pdo->exec('ALTER TABLE news ADD UNIQUE INDEX IF NOT EXISTS uniq_news_source (shop_id, source_id)'); } catch (Throwable $e) {}

// admi 一覧を複数ページ取得（source_id でユニーク化）
$all = [];
for ($p = 1; $p <= $PAGES; $p++) {
    $url = $p === 1 ? "$ADMI_BASE/news" : "$ADMI_BASE/news?page=$p";
    $html = fetchHtml($url);
    if ($html === null) { fwrite(STDERR, "fetch失敗: $url\n"); break; }
    $part = parse_news_list($html);
    if (!$part) break; // これ以上ページなし
    foreach ($part as $sid => $rec) $all[$sid] = $rec;
    echo "page $p: " . count($part) . "件\n";
    usleep(300000); // 0.3s 礼儀待ち
}

if (!$all) { echo "取込対象なし（パース0件）\n"; exit(1); }

// 古い source_id から処理 → 新しい admi 記事ほど kichifu id が大きくなり並びが安定
ksort($all, SORT_NUMERIC);

$selExist = $pdo->prepare('SELECT id, thumb FROM news WHERE shop_id = ? AND source_id = ?');
$ins = $pdo->prepare(
    'INSERT INTO news (shop_id, source_id, title, body, thumb, posted_at, is_display, sort)
     VALUES (:shop, :sid, :title, :body, :thumb, :posted, 1, 0)'
);
$updText = $pdo->prepare(
    'UPDATE news SET title = :title, body = :body, posted_at = :posted, modified = NOW()
      WHERE id = :id'
);
$updThumb = $pdo->prepare('UPDATE news SET thumb = :thumb, modified = NOW() WHERE id = :id');

$sum = ['parsed' => count($all), 'inserted' => 0, 'updated' => 0, 'img' => 0, 'skipped' => 0, 'noimg' => []];

foreach ($all as $sid => $rec) {
    // posted_at: admi は日付のみ → source_id を秒オフセットにして同日内の並びを保つ
    $base = $rec['date'] ? strtotime($rec['date']) : time();
    $posted = date('Y-m-d H:i:s', $base + ((int)$sid % 86400));

    $selExist->execute([$SHOP_ID, $sid]);
    $row = $selExist->fetch(PDO::FETCH_ASSOC);

    if ($row) {
        // 既存。--update で本文等を更新、--refresh-images で画像を取り直す
        $did = [];
        if ($UPDATE) {
            if (!$DRY) $updText->execute([
                'title' => $rec['title'], 'body' => $rec['body'], 'posted' => $posted, 'id' => $row['id'],
            ]);
            $sum['updated']++; $did[] = '本文更新';
        }
        if ($REFRESH && $rec['image_url']) {
            $new = download_news_image($rec['image_url'], $DOCROOT, $SHOP_ID, $DRY);
            if ($new) {
                if (!$DRY) { $updThumb->execute(['thumb' => $new, 'id' => $row['id']]); delete_upload_abs($DOCROOT, $row['thumb']); }
                $sum['img']++; $did[] = '画像差替';
            }
        }
        if (!$did) { $sum['skipped']++; continue; }
        echo sprintf("= %-5s %s  [%s]%s\n", $sid, mb_strimwidth($rec['title'], 0, 42, '…'), implode('+', $did), $DRY ? ' (dry)' : '');
        continue;
    }

    // 新規
    $thumb = '';
    if ($rec['image_url']) {
        $saved = download_news_image($rec['image_url'], $DOCROOT, $SHOP_ID, $DRY);
        if ($saved) { $thumb = $DRY ? '' : $saved; $sum['img']++; }
        else $sum['noimg'][] = $sid;
    }
    if (!$DRY) {
        try {
            $ins->execute([
                'shop' => $SHOP_ID, 'sid' => $sid, 'title' => $rec['title'],
                'body' => $rec['body'], 'thumb' => $thumb, 'posted' => $posted,
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') { $sum['skipped']++; continue; } // UNIQUE 競合（並行実行）
            throw $e;
        }
    }
    $sum['inserted']++;
    echo sprintf("+ %-5s %s%s  %s\n", $sid, mb_strimwidth($rec['title'], 0, 42, '…'),
        $thumb ? ' 🖼' : '', $DRY ? '(dry)' : '');
}

echo "\n--- 集計" . ($DRY ? "（DRY-RUN: DB/画像 未変更）" : "") . " ---\n";
echo "parse:{$sum['parsed']} / 新規:{$sum['inserted']} / 更新:{$sum['updated']} / 画像:{$sum['img']} / スキップ既存:{$sum['skipped']}\n";
if ($sum['noimg']) echo "画像取得失敗 source_id: " . implode(', ', $sum['noimg']) . "\n";

// CI 用の機械可読フラグ。新規/更新/画像のいずれかがあれば 1（= 再ビルド要）、無ければ 0。
// sync-kichifu-news.yml がこの行を grep して build/deploy をスキップ判定する。
$changed = ($sum['inserted'] + $sum['updated'] + $sum['img']) > 0 ? 1 : 0;
echo "SYNC_CHANGED={$changed}\n";
