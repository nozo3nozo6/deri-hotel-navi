<?php
// ==========================================================================
// entry-methods.php — 入室方法マスタ管理API
//
// Actions:
//   GET  ?action=list            一覧（公開: is_active=1のみ、認証なし）
//   POST ?action=create          {code, label, sort_order}
//   POST ?action=update          {id, code?, label?, sort_order?, is_active?}
//   POST ?action=delete          {id}  (owner only)
//   POST ?action=toggle-active   {id, is_active}
//   POST ?action=reorder         {ids: [1,2,3,...]}
// ==========================================================================
require_once __DIR__ . '/db.php';

setCorsHeaders();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// list は認証不要（公開ページ・ホテル編集の dropdown で使用）
if ($action === 'list' && $method === 'GET') {
    $includeInactive = !empty($_GET['include_inactive']);
    try {
        $pdo = getPdo();
        $sql = "SELECT id, code, label, sort_order, is_active
                FROM ops_entry_methods "
                . ($includeInactive ? '' : 'WHERE is_active = 1 ')
                . "ORDER BY sort_order, id";
        $stmt = $pdo->query($sql);
        jsonResponse(['entry_methods' => $stmt->fetchAll()]);
    } catch (Throwable $e) {
        errorResponse('query failed', 500);
    }
}

require_once __DIR__ . '/auth-guard.php';

$pdo = getPdo();

if ($action === 'create' && $method === 'POST') {
    $b = readJsonBody();
    $code = trim($b['code'] ?? '');
    $label = trim($b['label'] ?? '');
    if ($code === '' || $label === '') errorResponse('code and label required', 400);
    if (!preg_match('/^[a-z0-9_-]+$/', $code)) errorResponse('code must be lowercase alnum/_/-', 400);
    try {
        $pdo->prepare("INSERT INTO ops_entry_methods (code, label, sort_order, is_active) VALUES (?, ?, ?, 1)")
            ->execute([$code, $label, (int)($b['sort_order'] ?? 100)]);
    } catch (PDOException $e) {
        if ($e->errorInfo[1] === 1062) errorResponse('code already exists', 409);
        throw $e;
    }
    jsonResponse(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

if ($action === 'update' && $method === 'POST') {
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $cols = []; $vals = [];
    foreach (['code', 'label', 'sort_order', 'is_active'] as $k) {
        if (array_key_exists($k, $b)) {
            $cols[] = "$k = ?";
            $v = $b[$k];
            if (in_array($k, ['sort_order', 'is_active'], true)) {
                $v = ($v === '' || $v === null) ? null : (int)$v;
            } elseif (is_string($v)) {
                $v = trim($v);
                if ($k === 'code' && !preg_match('/^[a-z0-9_-]+$/', $v)) errorResponse('invalid code', 400);
                if ($v === '') $v = null;
            }
            $vals[] = $v;
        }
    }
    if (!$cols) errorResponse('nothing to update', 400);
    $vals[] = $id;
    try {
        $pdo->prepare("UPDATE ops_entry_methods SET " . implode(', ', $cols) . " WHERE id = ?")->execute($vals);
    } catch (PDOException $e) {
        if ($e->errorInfo[1] === 1062) errorResponse('code already exists', 409);
        throw $e;
    }
    jsonResponse(['ok' => true]);
}

if ($action === 'toggle-active' && $method === 'POST') {
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    $active = isset($b['is_active']) ? (int)$b['is_active'] : 1;
    if ($id <= 0) errorResponse('invalid id', 400);
    $pdo->prepare("UPDATE ops_entry_methods SET is_active = ? WHERE id = ?")->execute([$active ? 1 : 0, $id]);
    jsonResponse(['ok' => true]);
}

if ($action === 'delete' && $method === 'POST') {
    requireTabOps($pdo, 'courses');
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $pdo->prepare("DELETE FROM ops_entry_methods WHERE id = ?")->execute([$id]);
    jsonResponse(['ok' => true]);
}

if ($action === 'reorder' && $method === 'POST') {
    $b = readJsonBody();
    $ids = $b['ids'] ?? [];
    if (!is_array($ids) || count($ids) === 0) errorResponse('ids required', 400);
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("UPDATE ops_entry_methods SET sort_order = ? WHERE id = ?");
        $i = 10;
        foreach ($ids as $id) {
            $stmt->execute([$i, (int)$id]);
            $i += 10;
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        errorResponse('reorder failed', 500);
    }
    jsonResponse(['ok' => true]);
}

errorResponse('invalid action', 400);
