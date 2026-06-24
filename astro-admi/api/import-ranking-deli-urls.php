<?php
// ==========================================================================
// import-ranking-deli-urls.php — ranking-deli の admi 店舗ページから
//   各女性のプロフィールURLを取得し girls.external_url に取り込む。
//   admi2888 の MINERVA admin はログイン必須で直接取れないため、
//   公開の ranking-deli 店舗ページ(4517=アドミ立川)を名前照合で取り込む。
//   ※ girls は両店共有プールなので external_url も共有（shop_id問わず1人1URL）。
//   使い方（サーバー上 / cron。Web 直アクセスは禁止）:
//     php import-ranking-deli-urls.php            … 本番反映（name一致のみ上書き）
//     php import-ranking-deli-urls.php --dry-run  … DB変更せず対応表だけ表示
// ==========================================================================
require_once __DIR__ . '/db.php';

if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }
date_default_timezone_set('Asia/Tokyo');

$DRY  = in_array('--dry-run', $argv, true);
$BASE = 'https://ranking-deli.jp/tokyo/area39/style2/4517/girlslist/'; // アドミ立川の女性一覧（全員）

function fetchHtml(string $url): ?string {
    $ctx = stream_context_create(['http' => ['timeout' => 25, 'user_agent' => 'Mozilla/5.0 (compatible; kichifu-sync)']]);
    $h = @file_get_contents($url, false, $ctx);
    return $h === false ? null : $h;
}

// alt 優先 → 先頭のひらがな/カタカナ列を名前として抽出（年齢/記号/ランク番号などを除去）
function leadName(string $s): string {
    $s = trim($s);
    return preg_match('/^[ぁ-んァ-ヶー]+/u', $s, $m) ? $m[0] : '';
}

// /4517/<girl_id>/ への全リンクから name→プロフィールURL を構築（ページ送り対応）
$map  = []; // name => url（'__DUP__' は同名複数で要手動）
$seen = []; // rid 重複排除
for ($p = 1; $p <= 10; $p++) {
    $url = $p === 1 ? $BASE : $BASE . '?page=' . $p;
    $html = fetchHtml($url);
    if ($html === null) { if ($p === 1) { fwrite(STDERR, "fetch失敗: $url\n"); exit(1); } break; }
    $doc = new DOMDocument();
    @$doc->loadHTML('<?xml encoding="UTF-8">' . $html);
    $xp = new DOMXPath($doc);
    $newCount = 0;
    foreach ($xp->query('//a[contains(@href, "/4517/")]') as $a) {
        $href = $a->getAttribute('href');
        if (!preg_match('#/4517/(\d+)/#', $href, $m)) continue;
        $rid = $m[1];
        if (isset($seen[$rid])) continue;
        $seen[$rid] = true;
        $newCount++;

        $altNode = $xp->query('.//img/@alt', $a)->item(0);
        $alt = $altNode ? trim($altNode->nodeValue) : '';
        $txt = trim(preg_replace('/\s+/u', ' ', $a->textContent));
        $name = leadName($alt !== '' ? $alt : $txt);
        if ($name === '') continue;

        // id から正規プロフィールURLを再構築（/report/#... 等の付随リンクを除去）
        $u = 'https://ranking-deli.jp/tokyo/area39/style2/4517/' . $rid . '/';
        if (!isset($map[$name])) $map[$name] = $u;
        else $map[$name] = '__DUP__'; // 同名複数は要手動
    }
    if ($newCount === 0) break; // これ以上ページなし
    usleep(300000);
}

$pdo = DB::conn();
// 列の自己マイグレーション（girl-edit.php も使用。MariaDB 10.11 は IF NOT EXISTS 対応）
try { $pdo->exec('ALTER TABLE girls ADD COLUMN IF NOT EXISTS external_url VARCHAR(500) NULL AFTER catch_copy'); } catch (Throwable $e) {}
$sel = $pdo->prepare('SELECT id FROM girls WHERE name = ?');
$upd = $pdo->prepare('UPDATE girls SET external_url = ? WHERE id = ?');

$sum = ['found' => count($map), 'updated' => 0, 'dup_site' => [], 'no_girl' => [], 'dup_girl' => []];
foreach ($map as $name => $url) {
    if ($url === '__DUP__') { $sum['dup_site'][] = $name; continue; } // ranking-deli側で同名複数
    $sel->execute([$name]);
    $ids = array_column($sel->fetchAll(PDO::FETCH_ASSOC), 'id');
    if (count($ids) === 0) { $sum['no_girl'][] = $name; continue; }
    if (count($ids) > 1)  { $sum['dup_girl'][] = $name; continue; } // DB側で同名複数→手動
    $gid = (int)$ids[0];
    if (!$DRY) $upd->execute([$url, $gid]);
    $sum['updated']++;
    echo sprintf("%s %-8s id=%-4d %s\n", $DRY ? '[dry]' : '✓', $name, $gid, $url);
}

echo "\n--- 集計" . ($DRY ? "（DRY-RUN: DB未変更）" : "") . " ---\n";
echo "ranking-deli検出: {$sum['found']} / 更新: {$sum['updated']}\n";
if ($sum['no_girl'])  echo "DB未登録(名前一致せず): " . implode(', ', $sum['no_girl']) . "\n";
if ($sum['dup_girl']) echo "DB同名複数で要手動: "     . implode(', ', $sum['dup_girl']) . "\n";
if ($sum['dup_site']) echo "ranking-deli同名複数: "   . implode(', ', $sum['dup_site']) . "\n";
