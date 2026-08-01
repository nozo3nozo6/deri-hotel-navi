<?php
// ==========================================================================
// stations.php — 駅マスタ管理API（admin）
//
// Actions:
//   GET  ?action=list           一覧（認証なし、公開）
//   POST ?action=update         {id, base_fee}  (admin認証)
// ==========================================================================
require_once __DIR__ . '/db.php';
setCorsHeaders();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($action === 'list' && $method === 'GET') {
    try {
        $pdo = getPdo();
        $stmt = $pdo->query("SELECT id, name, latitude, longitude, base_fee, fare_from_tachikawa FROM ops_stations ORDER BY base_fee, name");
        jsonResponse(['stations' => $stmt->fetchAll()]);
    } catch (Throwable $e) {
        errorResponse('query failed', 500);
    }
}

require_once __DIR__ . '/auth-guard.php';

if ($action === 'update' && $method === 'POST') {
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $cols = []; $vals = [];
    if (array_key_exists('base_fee', $b)) {
        $cols[] = 'base_fee = ?';
        $vals[] = $b['base_fee'] === '' ? 0 : max(0, (int)$b['base_fee']);
    }
    if (array_key_exists('fare_from_tachikawa', $b)) {
        $cols[] = 'fare_from_tachikawa = ?';
        $v = $b['fare_from_tachikawa'];
        $vals[] = ($v === '' || $v === null) ? null : max(0, (int)$v);
    }
    if (!$cols) errorResponse('nothing to update', 400);
    $vals[] = $id;
    getPdo()->prepare("UPDATE ops_stations SET " . implode(', ', $cols) . " WHERE id = ?")->execute($vals);
    jsonResponse(['ok' => true]);
}

errorResponse('invalid action', 400);
