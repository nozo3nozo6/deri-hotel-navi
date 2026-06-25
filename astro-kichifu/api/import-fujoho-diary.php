<?php
// ==========================================================================
// import-fujoho-diary.php — fujoho.jp 写メ日記(id=57=立川アドミ)を girl_diaries に取込
//   公開ページをスクレイプし、source='fujoho' / source_id=日記ID で冪等取込。
//   女の子名で girls にマッチ → girl_id（共有プールなので両店共通）。
//   両店(shop_id=1 立川 / 2 吉祥寺)に同内容で取込＝両サイトの「最新情報」に混ぜる。
//   画像は img.fujoho.jp を直リンク（再ホストしない＝軽量・自己責任）。
//   ⚠️ 非公式スクレイプ（規約リスク既知）。控えめアクセス: 既定1ページ・3h cron 運用。
//   使い方（CLI/cron 専用）:
//     php import-fujoho-diary.php             … 本番取込（1ページ=最新60件）
//     php import-fujoho-diary.php --dry-run   … DB変更せず結果表示
//     php import-fujoho-diary.php --pages=2   … 取込ページ数（既定1）
//     php import-fujoho-diary.php --keep=200  … girl_diaries(source=fujoho) を最新200件に剪定
// ==========================================================================
require_once __DIR__ . '/db.php';

if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }
date_default_timezone_set('Asia/Tokyo');

$DRY     = in_array('--dry-run', $argv, true);
$SHOP_IDS = [1, 2];                 // 両店に取込（共有）
$FUJOHO_SHOP = 57;                  // 立川アドミ
$PAGES   = 1;
$KEEP    = 0;
foreach ($argv as $a) {
    if (preg_match('/^--pages=(\d+)$/', $a, $m)) $PAGES = max(1, (int)$m[1]);
    if (preg_match('/^--keep=(\d+)$/', $a, $m))  $KEEP  = max(0, (int)$m[1]);
}

function fetchHtml(string $url): ?string {
    $ctx = stream_context_create(['http' => [
        'timeout' => 25,
        'user_agent' => 'Mozilla/5.0 (compatible; kichifu-diary-sync/1.0)',
    ]]);
    $h = @file_get_contents($url, false, $ctx);
    return $h === false ? null : $h;
}

// 「5時間前」「30分前」「2日前」「2026/06/25 20:30」→ Y-m-d H:i:s
function parse_diary_time(string $s): string {
    $s = trim($s);
    $now = time();
    if (preg_match('/(\d+)\s*分前/u', $s, $m))   return date('Y-m-d H:i:s', $now - (int)$m[1] * 60);
    if (preg_match('/(\d+)\s*時間前/u', $s, $m)) return date('Y-m-d H:i:s', $now - (int)$m[1] * 3600);
    if (preg_match('/(\d+)\s*日前/u', $s, $m))   return date('Y-m-d H:i:s', $now - (int)$m[1] * 86400);
    if (preg_match('#(\d{4})/(\d{1,2})/(\d{1,2})\s+(\d{1,2}):(\d{2})#', $s, $m))
        return sprintf('%04d-%02d-%02d %02d:%02d:00', $m[1], $m[2], $m[3], $m[4], $m[5]);
    if (preg_match('#(\d{4})/(\d{1,2})/(\d{1,2})#', $s, $m))
        return sprintf('%04d-%02d-%02d 12:00:00', $m[1], $m[2], $m[3]);
    return date('Y-m-d H:i:s', $now);
}

function cls_node(DOMXPath $xp, DOMNode $ctx, string $cls): ?DOMNode {
    return $xp->query('.//*[contains(concat(" ", normalize-space(@class), " "), " ' . $cls . ' ")]', $ctx)->item(0);
}

$pdo  = DB::conn();

// 女の子名 → id（共有プール全員。同名は最初の1人）
$nameToId = [];
foreach ($pdo->query('SELECT id, name FROM girls')->fetchAll(PDO::FETCH_ASSOC) as $r) {
    if (!isset($nameToId[$r['name']])) $nameToId[$r['name']] = (int)$r['id'];
}

// 既存の取込済み source_id（新規判定用）。新規のみ個別ページから正確な掲載時刻を取得する
$existingIds = [];
foreach ($pdo->query("SELECT DISTINCT source_id FROM girl_diaries WHERE source = 'fujoho'")->fetchAll(PDO::FETCH_COLUMN) as $sidv) {
    $existingIds[(string)$sidv] = 1;
}

$up = $pdo->prepare(
    'INSERT INTO girl_diaries (shop_id, source, source_id, girl_id, girl_name, title, body, image, link_url, posted_at, is_display)
     VALUES (:shop, \'fujoho\', :sid, :gid, :gname, :title, :body, :image, :link, :posted, 1)
     ON DUPLICATE KEY UPDATE girl_id=VALUES(girl_id), girl_name=VALUES(girl_name), title=VALUES(title),
       body=VALUES(body), image=VALUES(image), link_url=VALUES(link_url), modified=NOW()'
     /* posted_at は初回取込の掲載時刻(相対表記からの逆算)で固定。30分cronでの再計算による揺れを防ぐ */
);

$sum = ['parsed' => 0, 'upserted' => 0, 'matched' => 0, 'unmatched' => []];

for ($p = 1; $p <= $PAGES; $p++) {
    $url = "https://fujoho.jp/index.php?p=shop_girl_blog_list&id=$FUJOHO_SHOP" . ($p > 1 ? "&b=$p" : '');
    $html = fetchHtml($url);
    if ($html === null) { fwrite(STDERR, "fetch失敗: $url\n"); break; }

    $doc = new DOMDocument();
    @$doc->loadHTML('<?xml encoding="UTF-8">' . $html);
    $xp  = new DOMXPath($doc);
    $boxes = $xp->query('//*[contains(concat(" ", normalize-space(@class), " "), " shop_contents_main_blog_box ")]');

    foreach ($boxes as $box) {
        // 個別日記リンク（日記ID + girlId）
        $a = $xp->query('.//a[contains(@href, "shop_girl_blog&id=")]', $box)->item(0);
        if (!$a) continue;
        $href = $a->getAttribute('href');
        if (!preg_match('/id=(\d+).*?girlId=(\d+)/', $href, $m)) continue;
        $sid = $m[1]; $girlId = $m[2];

        $titleN = cls_node($xp, $box, 'shop_contents_main_blog_post_title');
        $title  = $titleN ? trim($titleN->textContent) : '';
        if ($title === '') continue;
        $sum['parsed']++;

        $bodyN = cls_node($xp, $box, 'shop_contents_main_blog_post_text');
        $body  = $bodyN ? trim(preg_replace('/\s+/u', ' ', $bodyN->textContent)) : '';

        $link = "https://fujoho.jp/index.php?p=shop_girl_blog&id=$sid&shopId=$FUJOHO_SHOP&girlId=$girlId";
        // 新規は個別ページから 絶対掲載時刻 + 本文フル を取得（オフィシャル日記ページ用）。既存は再取得しない
        $posted = null; $fullBody = '';
        if (!isset($existingIds[(string)$sid])) {
            $detail = fetchHtml($link);
            if ($detail !== null) {
                if (preg_match('#(20\d\d)/(\d{1,2})/(\d{1,2})\s+(\d{1,2}):(\d{2})#', $detail, $dm)) {
                    $posted = sprintf('%04d-%02d-%02d %02d:%02d:00', (int)$dm[1], (int)$dm[2], (int)$dm[3], (int)$dm[4], (int)$dm[5]);
                }
                // 本文フル（個別ページ本体 shop_contents_sub_blog_post_text）
                $ddoc = new DOMDocument(); @$ddoc->loadHTML('<?xml encoding="UTF-8">' . $detail);
                $dxp = new DOMXPath($ddoc);
                $bN = cls_node($dxp, $ddoc->documentElement, 'shop_contents_sub_blog_post_text');
                if ($bN) $fullBody = trim(preg_replace('/[ \t]+/u', ' ', $bN->textContent));
            }
            usleep(500000); // 個別ページアクセスの礼儀待ち
        }
        if (!$posted) {  // 既存 or 取得失敗 → 相対表記からの逆算でフォールバック
            $timeN = cls_node($xp, $box, 'shop_contents_main_blog_img_time');
            $posted = parse_diary_time($timeN ? $timeN->textContent : '');
        }
        if ($fullBody !== '') $body = $fullBody;  // 新規は個別ページのフル本文を採用（一覧抜粋を上書き）

        $nameN = cls_node($xp, $box, 'shop_contents_main_blog_profile_name');
        // _profile_name は名前＋年齢。最初のテキストノード＝名前
        $name = '';
        if ($nameN) {
            foreach ($nameN->childNodes as $c) {
                if ($c->nodeType === XML_TEXT_NODE && trim($c->nodeValue) !== '') { $name = trim($c->nodeValue); break; }
            }
            if ($name === '') $name = trim(preg_replace('/\s+/u', ' ', $nameN->textContent));
        }

        // サムネ画像（img_girl_blog の直リンク）
        $img = '';
        $imgNode = $xp->query('.//img[contains(@src, "img_girl_blog")]/@src', $box)->item(0);
        if ($imgNode) $img = trim($imgNode->nodeValue);

        $gid  = $nameToId[$name] ?? null;
        if ($gid) $sum['matched']++; else if ($name !== '') $sum['unmatched'][$name] = true;

        if (!$DRY) {
            foreach ($SHOP_IDS as $shop) {
                $up->execute([
                    'shop' => $shop, 'sid' => $sid, 'gid' => $gid, 'gname' => $name,
                    'title' => $title, 'body' => $body, 'image' => $img, 'link' => $link, 'posted' => $posted,
                ]);
            }
        }
        $sum['upserted']++;
        echo sprintf("%s %-8s %-10s %s\n", $posted, $sid, $name . ($gid ? "(#$gid)" : '(未照合)'), mb_strimwidth($title, 0, 40, '…'));
    }
    echo "--- page $p: " . $boxes->length . " box ---\n";
    usleep(400000); // 0.4s 礼儀待ち
}

// 剪定（任意）: source=fujoho を最新 KEEP 件に（各店）
if ($KEEP > 0 && !$DRY) {
    foreach ($SHOP_IDS as $shop) {
        $pdo->prepare(
            "DELETE FROM girl_diaries WHERE shop_id=? AND source='fujoho' AND id NOT IN (
                SELECT id FROM (SELECT id FROM girl_diaries WHERE shop_id=? AND source='fujoho' ORDER BY posted_at DESC, id DESC LIMIT $KEEP) t
             )"
        )->execute([$shop, $shop]);
    }
    echo "剪定: 各店 source=fujoho を最新 {$KEEP} 件に\n";
}

echo "\n--- 集計" . ($DRY ? "（DRY-RUN: DB未変更）" : "") . " ---\n";
echo "parse:{$sum['parsed']} / upsert(×2店):{$sum['upserted']} / girl照合:{$sum['matched']}\n";
if ($sum['unmatched']) echo "未照合(girls不在): " . implode(', ', array_keys($sum['unmatched'])) . "\n";
$changed = $sum['upserted'] > 0 ? 1 : 0;
echo "SYNC_CHANGED={$changed}\n";
