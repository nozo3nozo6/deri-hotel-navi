<?php
// ==========================================================================
// courses.php — 施術コース管理API
//
// Actions:
//   GET  ?action=list            一覧（公開API: is_active=1のみ、認証なしでもOK）
//   POST ?action=create          {name, duration_min, price, cast_reward, description, sort_order}
//
//   cast_reward = このコース1本あたりのキャスト報酬（円）。
//   admi は歩合率(%)ではなくコースごとの固定額で報酬を決める運用のため、
//   ops_admin_users.commission_rate ではなくこの列を使う。
//   POST ?action=update          {id, ...}
//   POST ?action=delete          {id}  (owner only)
//   POST ?action=toggle-active   {id, is_active}
// ==========================================================================
require_once __DIR__ . '/db.php';

setCorsHeaders();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// list は認証不要（予約モーダルの dropdown 等で使用）
if ($action === 'list' && $method === 'GET') {
    $includeInactive = !empty($_GET['include_inactive']);
    try {
        $pdo = getPdo();
        $sql = "SELECT id, name, duration_min, price, cast_reward, description, bg_image_url, sort_order, is_active
                FROM ops_courses "
                . ($includeInactive ? '' : 'WHERE is_active = 1 ')
                . "ORDER BY sort_order, id";
        $stmt = $pdo->query($sql);
        jsonResponse(['courses' => $stmt->fetchAll()]);
    } catch (Throwable $e) {
        errorResponse('query failed', 500);
    }
}

// それ以外は要認証
require_once __DIR__ . '/auth-guard.php';

$pdo = getPdo();

if ($action === 'create' && $method === 'POST') {
    $b = readJsonBody();
    $name = trim($b['name'] ?? '');
    $dur = (int)($b['duration_min'] ?? 0);
    if ($name === '' || $dur <= 0) errorResponse('name and duration_min required', 400);
    $pdo->prepare("INSERT INTO ops_courses (name, duration_min, price, cast_reward, description, sort_order, is_active)
                   VALUES (?, ?, ?, ?, ?, ?, 1)")->execute([
        $name, $dur,
        isset($b['price']) && $b['price'] !== '' ? (int)$b['price'] : null,
        isset($b['cast_reward']) && $b['cast_reward'] !== '' ? (int)$b['cast_reward'] : null,
        trim($b['description'] ?? '') ?: null,
        (int)($b['sort_order'] ?? 100),
    ]);
    jsonResponse(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

if ($action === 'update' && $method === 'POST') {
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $cols = []; $vals = [];
    foreach (['name', 'duration_min', 'price', 'cast_reward', 'description', 'bg_image_url', 'sort_order', 'is_active'] as $k) {
        if (array_key_exists($k, $b)) {
            $cols[] = "$k = ?";
            $v = $b[$k];
            if (in_array($k, ['duration_min', 'price', 'cast_reward', 'sort_order', 'is_active'], true)) {
                $v = ($v === '' || $v === null) ? null : (int)$v;
            } elseif (is_string($v)) {
                $v = trim($v); if ($v === '') $v = null;
            }
            $vals[] = $v;
        }
    }
    if (!$cols) errorResponse('nothing to update', 400);
    $vals[] = $id;
    $pdo->prepare("UPDATE ops_courses SET " . implode(', ', $cols) . " WHERE id = ?")->execute($vals);
    jsonResponse(['ok' => true]);
}

if ($action === 'toggle-active' && $method === 'POST') {
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    $active = isset($b['is_active']) ? (int)$b['is_active'] : 1;
    if ($id <= 0) errorResponse('invalid id', 400);
    $pdo->prepare("UPDATE ops_courses SET is_active = ? WHERE id = ?")->execute([$active ? 1 : 0, $id]);
    jsonResponse(['ok' => true]);
}

if ($action === 'delete' && $method === 'POST') {
    requireOwner();
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $pdo->prepare("DELETE FROM ops_courses WHERE id = ?")->execute([$id]);
    jsonResponse(['ok' => true]);
}

if ($action === 'reorder' && $method === 'POST') {
    $b = readJsonBody();
    $ids = $b['ids'] ?? [];
    if (!is_array($ids) || count($ids) === 0) errorResponse('ids required', 400);
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("UPDATE ops_courses SET sort_order = ? WHERE id = ?");
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
