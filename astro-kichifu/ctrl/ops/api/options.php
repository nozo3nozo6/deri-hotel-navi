<?php
// ==========================================================================
// options.php — オプション（ローター・バイブ等）管理API
//
// Actions:
//   GET  ?action=list            一覧（予約モーダルの選択肢に使うので認証なしでもOK）
//   POST ?action=create          {name, price, cast_reward, sort_order}
//   POST ?action=update          {id, ...}
//   POST ?action=delete          {id}  (owner only)
//   POST ?action=toggle-active   {id, is_active}
//   POST ?action=reorder         {ids:[...]}
//
//   cast_reward = そのオプション1つあたりのキャスト報酬（円）。
//   未設定（NULL）なら店の取り分＝キャスト報酬に加算しない（courses と同じ考え方）。
// ==========================================================================
require_once __DIR__ . '/db.php';

setCorsHeaders();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// list は認証不要（予約モーダルの選択肢で使用）
if ($action === 'list' && $method === 'GET') {
    $includeInactive = !empty($_GET['include_inactive']);
    try {
        $pdo = getPdo();
        $sql = "SELECT id, name, price, cast_reward, is_lendable, sort_order, is_active
                FROM ops_options "
                . ($includeInactive ? '' : 'WHERE is_active = 1 ')
                . "ORDER BY sort_order, id";
        jsonResponse(['options' => $pdo->query($sql)->fetchAll()]);
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
    if ($name === '') errorResponse('name required', 400);
    $pdo->prepare("INSERT INTO ops_options (name, price, cast_reward, is_lendable, sort_order, is_active, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())")->execute([
        $name,
        (int)($b['price'] ?? 0),
        isset($b['cast_reward']) && $b['cast_reward'] !== '' ? (int)$b['cast_reward'] : null,
        !empty($b['is_lendable']) ? 1 : 0,   // 貸出品（持ち帰り忘れ防止の対象）
        (int)($b['sort_order'] ?? 100),
    ]);
    jsonResponse(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

if ($action === 'update' && $method === 'POST') {
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $cols = []; $vals = [];
    foreach (['name', 'price', 'cast_reward', 'is_lendable', 'sort_order', 'is_active'] as $k) {
        if (array_key_exists($k, $b)) {
            $cols[] = "$k = ?";
            $v = $b[$k];
            if ($k === 'name') {
                $v = trim((string)$v);
                if ($v === '') errorResponse('name required', 400);
            } else {
                $v = ($v === '' || $v === null) ? null : (int)$v;
            }
            $vals[] = $v;
        }
    }
    if (!$cols) errorResponse('nothing to update', 400);
    $cols[] = 'updated_at = NOW()';
    $vals[] = $id;
    $pdo->prepare("UPDATE ops_options SET " . implode(', ', $cols) . " WHERE id = ?")->execute($vals);
    jsonResponse(['ok' => true]);
}

if ($action === 'toggle-active' && $method === 'POST') {
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    $active = isset($b['is_active']) ? (int)$b['is_active'] : 1;
    if ($id <= 0) errorResponse('invalid id', 400);
    $pdo->prepare("UPDATE ops_options SET is_active = ?, updated_at = NOW() WHERE id = ?")->execute([$active ? 1 : 0, $id]);
    jsonResponse(['ok' => true]);
}

if ($action === 'delete' && $method === 'POST') {
    requireTabOps($pdo, 'courses');
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    // 予約に残った内容は menu_items にテキストで保存済みなので、消しても過去の記録は壊れない
    $pdo->prepare("DELETE FROM ops_options WHERE id = ?")->execute([$id]);
    jsonResponse(['ok' => true]);
}

if ($action === 'reorder' && $method === 'POST') {
    $b = readJsonBody();
    $ids = $b['ids'] ?? [];
    if (!is_array($ids) || count($ids) === 0) errorResponse('ids required', 400);
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("UPDATE ops_options SET sort_order = ? WHERE id = ?");
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

errorResponse('unknown action', 400);
