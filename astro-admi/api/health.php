<?php
// ==========================================================================
// health.php — 疎通確認エンドポイント（/api/health.php）
//   PHP が実行されているか・DBに繋がるかを JSON で返す。
//   DB未設定でも 200 を返す（基盤デプロイの確認用）。
// ==========================================================================
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$out = [
    'ok'      => true,
    'service' => 'kichifu',
    'php'     => PHP_VERSION,
    'time'    => date('c'),
    'db'      => 'not_configured',
];

if (file_exists(__DIR__ . '/db-config.php')) {
    try {
        require_once __DIR__ . '/db.php';
        DB::conn()->query('SELECT 1');
        $out['db'] = 'connected';
    } catch (Throwable $e) {
        $out['db'] = 'error';
    }
}

echo json_encode($out, JSON_UNESCAPED_UNICODE);
