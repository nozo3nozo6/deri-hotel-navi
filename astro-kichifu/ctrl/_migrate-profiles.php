<?php
// ==========================================================================
// _migrate-profiles.php — admi 日本語プロフィール質問をマスタに揃える（CLI・冪等）
//   不足質問を text で投入し、出身地は選択肢未整備のため text に変更（自由入力）。
//   既存（seed済み・取り込み済み）は name 重複チェックで触らない。
//   デプロイ後: php admin/_migrate-profiles.php
// ==========================================================================
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }
require_once __DIR__ . '/../api/db.php';
$pdo  = DB::conn();
$SHOP = 1;

// 出身地：admiは都道府県のリスト選択だが、kichifuは選択肢未整備のため自由入力(text)に
$n = $pdo->prepare("UPDATE girl_profiles SET type='text' WHERE shop_id=? AND name='出身地は？' AND type='list'");
$n->execute([$SHOP]);
echo "出身地→text: " . $n->rowCount() . "\n";

// admi 日本語質問の不足分（seed/取り込みに無いもの）を text で投入
$add = [
    '好きな男性のタイプは何ですか？',
    '好きなオプションは？',
    'アンダーヘア―は？',
    'ハマっていることは？',
    'やってみたいことは？',
    'イキやすい？',
    '下着はノーマル派？Tバック派？',
];
$max = (int)$pdo->query("SELECT COALESCE(MAX(sort),0) FROM girl_profiles WHERE shop_id=$SHOP")->fetchColumn();
$chk = $pdo->prepare('SELECT id FROM girl_profiles WHERE shop_id=? AND name=?');
$ins = $pdo->prepare("INSERT INTO girl_profiles (shop_id,name,type,lang,sort) VALUES (?,?,'text','ja',?)");
$added = 0;
foreach ($add as $q) {
    $chk->execute([$SHOP, $q]);
    if (!$chk->fetchColumn()) { $ins->execute([$SHOP, $q, ++$max]); $added++; }
}
echo "追加した質問: $added\n";
echo "✅ done\n";
