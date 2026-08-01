<?php
// ==========================================================================
// treatment-menus.php — 施術メニューマスタ
// GET ?action=list  公開 (認証不要、is_active=1のみ)
// GET ?action=list&include_inactive=1  要認証
// POST ?action=update  {id, name?, description?, guide?, bg_image_url?, sort_order?, is_active?}
// 名称や内容を変更したいときに使う。新規追加は当面不要 (固定 6 種類)
// ==========================================================================
require_once __DIR__ . '/db.php';
setCorsHeaders();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($action === 'list' && $method === 'GET') {
    $includeInactive = !empty($_GET['include_inactive']);
    if ($includeInactive) require_once __DIR__ . '/auth-guard.php';  // 編集時のみ全件
    try {
        $pdo = getPdo();
        $sql = "SELECT id, name, description, guide, bg_image_url, sort_order, is_active
                FROM ops_treatment_menus "
                . ($includeInactive ? '' : 'WHERE is_active = 1 ')
                . "ORDER BY sort_order, id";
        jsonResponse(['menus' => $pdo->query($sql)->fetchAll()]);
    } catch (Throwable $e) {
        errorResponse('query failed', 500);
    }
}

require_once __DIR__ . '/auth-guard.php';
$pdo = getPdo();

if ($action === 'update' && $method === 'POST') {
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $cols = []; $vals = [];
    foreach (['name', 'description', 'guide', 'bg_image_url', 'sort_order', 'is_active'] as $k) {
        if (array_key_exists($k, $b)) {
            $cols[] = "$k = ?";
            $v = $b[$k];
            if (in_array($k, ['sort_order', 'is_active'], true)) {
                $v = ($v === '' || $v === null) ? null : (int)$v;
            } elseif (is_string($v)) {
                $v = trim($v); if ($v === '') $v = null;
            }
            $vals[] = $v;
        }
    }
    if (!$cols) errorResponse('nothing to update', 400);
    $vals[] = $id;
    $pdo->prepare("UPDATE ops_treatment_menus SET " . implode(', ', $cols) . " WHERE id = ?")->execute($vals);
    jsonResponse(['ok' => true]);
}

errorResponse('invalid action', 400);
