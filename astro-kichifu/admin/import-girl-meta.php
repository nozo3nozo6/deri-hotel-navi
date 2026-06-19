<?php
// ==========================================================================
// import-girl-meta.php — admi メタデータ取り込み（CLI専用）
//   scrape-admi-meta.mjs が出力した girls-meta.json を kichifu DB に反映する。
//   反映項目: 特徴タグ / 店舗コメント / 女の子に質問(プロフィール) / 基本・オプションプレイ
//   既存の girls 行（id/画像/名前）は変更しない。name で照合（同名は sort で区別）。
//
//   使い方:
//     php import-girl-meta.php girls-meta.json          # ドライラン（変更なし）
//     php import-girl-meta.php girls-meta.json --yes     # 実反映
// ==========================================================================
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }
require_once __DIR__ . '/../api/db.php';

$jsonPath = $argv[1] ?? '';
$apply    = in_array('--yes', $argv, true);
$SHOP     = 1;

if (!is_file($jsonPath)) { fwrite(STDERR, "JSON が見つかりません: $jsonPath\n"); exit(1); }
$meta = json_decode((string)file_get_contents($jsonPath), true);
if (!is_array($meta)) { fwrite(STDERR, "JSON の解析に失敗しました\n"); exit(1); }

$pdo = DB::conn();

// 質問名の正規化キー（表記揺れ吸収: 全角半角 / 末尾「は？」「？」 / 区切り）
function normQ(string $s): string {
    $s = trim($s);
    if (function_exists('mb_convert_kana')) $s = mb_convert_kana($s, 'as'); // 全角英数→半角, 全角空白→半角
    $s = preg_replace('/[\sは]*[?？]+\s*$/u', '', $s);  // 末尾「は？」「？」除去
    $s = preg_replace('/[\/／・\s　]/u', '', $s);        // 区切り・空白除去
    return mb_strtolower((string)$s);
}

// ---- マスタ取得 ----
$st = $pdo->prepare('SELECT id, name, sort FROM girls WHERE shop_id=?');
$st->execute([$SHOP]);
$byName = [];
foreach ($st->fetchAll() as $g) $byName[$g['name']][] = $g;

$tagMaster = [];
$st = $pdo->prepare('SELECT id, name FROM girl_image_tags WHERE shop_id=?'); $st->execute([$SHOP]);
foreach ($st->fetchAll() as $x) $tagMaster[$x['name']] = (int)$x['id'];

$optMaster = [];
$st = $pdo->prepare('SELECT id, name FROM girl_options WHERE shop_id=?'); $st->execute([$SHOP]);
foreach ($st->fetchAll() as $x) $optMaster[$x['name']] = (int)$x['id'];

$profMaster = []; $profMax = 0;
$st = $pdo->prepare('SELECT id, name, sort FROM girl_profiles WHERE shop_id=?'); $st->execute([$SHOP]);
foreach ($st->fetchAll() as $x) { $profMaster[normQ($x['name'])] = (int)$x['id']; $profMax = max($profMax, (int)$x['sort']); }

$stat = ['matched'=>0,'noGirl'=>0,'tags'=>0,'comment'=>0,'prof'=>0,'opt'=>0,'newProf'=>0,'newOpt'=>0,'newTag'=>0];
$unmatched = [];

if ($apply) $pdo->beginTransaction();

foreach ($meta as $m) {
    $name  = (string)($m['name'] ?? '');
    $cands = $byName[$name] ?? [];
    $gid   = null;
    if (count($cands) === 1) {
        $gid = (int)$cands[0]['id'];
    } elseif (count($cands) > 1) {
        foreach ($cands as $c) if ((int)$c['sort'] === (int)($m['sort'] ?? -1)) { $gid = (int)$c['id']; break; }
        if (!$gid) $gid = (int)$cands[0]['id'];   // sort不一致でも先頭にフォールバック
    }
    if (!$gid) { $stat['noGirl']++; $unmatched[] = $name; continue; }
    $stat['matched']++;
    if (!$apply) continue;

    // 店舗コメント
    if (!empty($m['shop_comment'])) {
        $pdo->prepare('UPDATE girls SET shop_comment=? WHERE id=?')->execute([$m['shop_comment'], $gid]);
        $stat['comment']++;
    }

    // 特徴タグ（マスタに無い名前は新規作成）
    if (!empty($m['tags'])) {
        $pdo->prepare('DELETE FROM girl_image_tag_links WHERE girl_id=?')->execute([$gid]);
        $insT = $pdo->prepare('INSERT IGNORE INTO girl_image_tag_links (girl_id, girl_image_tag_id) VALUES (?,?)');
        $maxTagSort = (int)$pdo->query('SELECT COALESCE(MAX(sort),-1) FROM girl_image_tags WHERE shop_id=' . $SHOP)->fetchColumn();
        foreach ($m['tags'] as $t) {
            if (!isset($tagMaster[$t])) {
                $pdo->prepare('INSERT INTO girl_image_tags (shop_id,name,sort) VALUES (?,?,?)')->execute([$SHOP, $t, ++$maxTagSort]);
                $tagMaster[$t] = (int)$pdo->lastInsertId(); $stat['newTag']++;
            }
            $insT->execute([$gid, $tagMaster[$t]]);
        }
        $stat['tags']++;
    }

    // 基本プレイ + オプションプレイ（girl_option_links を入れ替え）
    $allOpt = array_merge((array)($m['basic_play'] ?? []), (array)($m['option_play'] ?? []));
    if ($allOpt) {
        $pdo->prepare('DELETE FROM girl_option_links WHERE girl_id=?')->execute([$gid]);
        $insO = $pdo->prepare('INSERT IGNORE INTO girl_option_links (girl_id, girl_option_id, shop_id) VALUES (?,?,?)');
        foreach ($allOpt as $o) {
            $o = trim((string)$o);
            if ($o === '') continue;
            if (!isset($optMaster[$o])) {
                $pdo->prepare('INSERT INTO girl_options (shop_id,name,is_basic,sort) VALUES (?,?,0,999)')->execute([$SHOP, $o]);
                $optMaster[$o] = (int)$pdo->lastInsertId(); $stat['newOpt']++;
            }
            $insO->execute([$gid, $optMaster[$o], $SHOP]);
        }
        $stat['opt']++;
    }

    // プロフィール（質問）— normQ で照合、無い質問は新規作成
    if (!empty($m['profiles'])) {
        $up = $pdo->prepare('INSERT INTO girl_profile_values (girl_id,girl_profile_id,value,is_display)
                             VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE value=VALUES(value), is_display=1');
        foreach ($m['profiles'] as $p) {
            $q = trim((string)($p['q'] ?? '')); $a = trim((string)($p['a'] ?? ''));
            if ($q === '' || $a === '') continue;
            $k = normQ($q);
            if (!isset($profMaster[$k])) {
                $pdo->prepare('INSERT INTO girl_profiles (shop_id,name,type,lang,sort) VALUES (?,?,"text","ja",?)')->execute([$SHOP, $q, ++$profMax]);
                $profMaster[$k] = (int)$pdo->lastInsertId(); $stat['newProf']++;
            }
            $up->execute([$gid, $profMaster[$k], $a]);
        }
        $stat['prof']++;
    }
}

if ($apply) $pdo->commit();

echo ($apply ? "[APPLIED 反映完了]" : "[DRY RUN ドライラン]") . "\n";
foreach ($stat as $k => $v) printf("  %-10s %d\n", $k, $v);
if ($unmatched) echo "\n未マッチ(" . count($unmatched) . "人): " . implode(', ', $unmatched) . "\n";
