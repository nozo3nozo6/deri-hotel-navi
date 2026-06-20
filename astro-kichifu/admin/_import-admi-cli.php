<?php
// ==========================================================================
// _import-admi-cli.php — admi(MINERVA)の入店日・表示/非表示・各フラグをTSVから一括反映（CLI専用）
//   TSV列(タブ区切り):
//     name  in_date(YYYY-MM-DD|空)  disp(1/0)  new  trial  tel  inbound  genderless  bust  cup  waist  hip
//   照合: 名前（同名はスリーサイズ B/cup/W/H で判定）。入店日空は上書きしない。
//   更新: in_date, is_display, is_newgirl, is_trial, is_tel, is_inbound, is_genderless
//        （年齢・サイズ・名前・画像・コメント・タグは変更しない）
//   使い方: php _import-admi-cli.php data.tsv           # ドライラン
//           php _import-admi-cli.php data.tsv --yes      # 実反映
// ==========================================================================
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }
require_once __DIR__ . '/../api/db.php';

$tsv   = $argv[1] ?? '';
$apply = in_array('--yes', $argv, true);
$SHOP  = 1;
if (!is_file($tsv)) { fwrite(STDERR, "TSVが見つかりません: $tsv\n"); exit(1); }

$pdo = DB::conn();
$st = $pdo->prepare('SELECT id,name,bust,cup,waist,hip,is_display FROM girls WHERE shop_id=?');
$st->execute([$SHOP]);
$byName = [];
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $g) $byName[trim($g['name'])][] = $g;

$i = fn($v) => ($v !== '' && $v !== '0') ? 1 : 0;
$recs = [];
foreach (file($tsv, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    if ($line === '' || $line[0] === '#') continue;
    $c = explode("\t", $line);
    if (count($c) < 3) continue;
    $recs[] = [
        'name'    => trim($c[0]),
        'in_date' => trim($c[1] ?? ''),
        'disp'    => (int)trim($c[2] ?? '1'),
        'new'     => $i(trim($c[3] ?? '0')),
        'trial'   => $i(trim($c[4] ?? '0')),
        'tel'     => $i(trim($c[5] ?? '0')),
        'inbound' => $i(trim($c[6] ?? '0')),
        'gless'   => $i(trim($c[7] ?? '0')),
        'bust'    => isset($c[8]) && $c[8] !== '' && $c[8] !== '--' ? (int)$c[8] : null,
        'cup'     => isset($c[9]) && $c[9] !== '' && $c[9] !== '--' ? trim($c[9]) : null,
        'waist'   => isset($c[10]) && $c[10] !== '' && $c[10] !== '--' ? (int)$c[10] : null,
        'hip'     => isset($c[11]) && $c[11] !== '' && $c[11] !== '--' ? (int)$c[11] : null,
    ];
}

$up = $pdo->prepare('UPDATE girls SET in_date=COALESCE(?, in_date), is_display=?, is_newgirl=?, is_trial=?, is_tel=?, is_inbound=?, is_genderless=? WHERE id=? AND shop_id=?');
$okN=0; $ambN=0; $noN=0; $used=[]; $seen=[];
if ($apply) $pdo->beginTransaction();
foreach ($recs as $r) {
    $cands = $byName[$r['name']] ?? [];
    $g = null;
    if (count($cands) === 1) $g = $cands[0];
    elseif (count($cands) > 1) {
        $hit = array_values(array_filter($cands, fn($x) =>
            (int)$x['bust'] === (int)$r['bust'] && (int)$x['waist'] === (int)$r['waist']
            && (int)$x['hip'] === (int)$r['hip'] && (string)$x['cup'] === (string)$r['cup']));
        if (count($hit) === 1) $g = $hit[0];
    }
    if (!$g) {
        if (count($cands) === 0) { $noN++; fwrite(STDERR, "[該当なし] {$r['name']} ({$r['bust']}{$r['cup']} {$r['waist']} {$r['hip']})\n"); }
        else { $ambN++; fwrite(STDERR, "[あいまい] {$r['name']} ({$r['bust']}{$r['cup']} {$r['waist']} {$r['hip']})\n"); }
        continue;
    }
    if (isset($used[$g['id']])) continue;
    $used[$g['id']] = true; $seen[trim($g['name'])] = true;
    $okN++;
    $inDate = $r['in_date'] !== '' ? $r['in_date'] : null;
    if ($apply) $up->execute([$inDate, $r['disp'], $r['new'], $r['trial'], $r['tel'], $r['inbound'], $r['gless'], $g['id'], $SHOP]);
}
if ($apply) $pdo->commit();

$missing = [];
foreach ($byName as $nm => $list) if (!isset($seen[$nm])) $missing[] = $nm;

fwrite(STDERR, "\n==== " . ($apply ? '実反映' : 'ドライラン') . " ====\n");
fwrite(STDERR, "TSV ".count($recs)." / 反映 {$okN} / あいまい {$ambN} / admi該当なし {$noN}\n");
fwrite(STDERR, "kichifu未照合 " . count($missing) . ": " . implode('、', $missing) . "\n");
