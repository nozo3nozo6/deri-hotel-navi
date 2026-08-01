<?php
// ==========================================================================
// campaigns.php — キャンペーン（イベント）マスタ
// GET  ?action=active            公開（認証不要）。今表示すべき有効キャンペーン1件（無ければ null）
// GET  ?action=list              要認証（owner/manager）。全件＋状態(status)
// POST ?action=save              要認証（owner/manager）。新規/更新
// POST ?action=delete            要認証（owner/manager）。削除
//
// トップの marquee ＋ 料金バナーはこの active を JS で取得して描画する（デプロイ不要で即反映）。
// ==========================================================================
require_once __DIR__ . '/db.php';
setCorsHeaders();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// ---- 公開: 今有効なキャンペーン（複数可・最大5件） ----
if ($action === 'active' && $method === 'GET') {
    try {
        $pdo = getPdo();
        // 有効フラグON かつ 開始<=now<=終了（NULLは無制限）。開始が新しい順
        $sql = "SELECT id, tag_label, pill_label, marquee_text, banner_strong, headline, headline_small, note, starts_at, ends_at
                FROM ops_ylka_campaigns
                WHERE is_active = 1
                  AND (starts_at IS NULL OR starts_at <= NOW())
                  AND (ends_at   IS NULL OR ends_at   >= NOW())
                ORDER BY (starts_at IS NULL) ASC, starts_at DESC, id ASC
                LIMIT 5";
        $rows = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
        // campaign は後方互換（先頭1件）。複数表示は campaigns を使う
        jsonResponse(['campaign' => $rows[0] ?? null, 'campaigns' => $rows]);
    } catch (Throwable $e) {
        errorResponse('query failed', 500);
    }
}

// ---- ここから要認証（owner/manager） ----
require_once __DIR__ . '/auth-guard.php';
$role = currentUserRole();
if (!in_array($role, ['owner', 'manager'], true)) errorResponse('owner or manager role required', 403);
$pdo = getPdo();

if ($action === 'list' && $method === 'GET') {
    $rows = $pdo->query("SELECT id, tag_label, pill_label, marquee_text, banner_strong, headline, headline_small, note,
                                starts_at, ends_at, is_active, created_at, updated_at
                         FROM ops_ylka_campaigns
                         ORDER BY (starts_at IS NULL) ASC, starts_at DESC, id DESC")->fetchAll(PDO::FETCH_ASSOC);
    // 状態を付与: inactive / scheduled(未来) / ended(終了済) / current(表示中)
    $now = time();
    foreach ($rows as &$r) {
        $s = $r['starts_at'] ? strtotime($r['starts_at']) : null;
        $e = $r['ends_at']   ? strtotime($r['ends_at'])   : null;
        if ((int)$r['is_active'] !== 1)       $r['status'] = 'inactive';
        elseif ($s !== null && $now < $s)     $r['status'] = 'scheduled';
        elseif ($e !== null && $now > $e)     $r['status'] = 'ended';
        else                                  $r['status'] = 'current';
    }
    unset($r);
    jsonResponse(['campaigns' => $rows]);
}

if ($action === 'save' && $method === 'POST') {
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    // 空文字→NULL 変換（日時）
    $norm = fn($v) => (isset($v) && $v !== '') ? $v : null;
    $fields = [
        'tag_label'      => trim((string)($b['tag_label'] ?? '')),
        'pill_label'     => trim((string)($b['pill_label'] ?? '')),
        'marquee_text'   => trim((string)($b['marquee_text'] ?? '')),
        'banner_strong'  => trim((string)($b['banner_strong'] ?? '')),
        'headline'       => trim((string)($b['headline'] ?? '')),
        'headline_small' => trim((string)($b['headline_small'] ?? '')),
        'note'           => trim((string)($b['note'] ?? '')),
        'starts_at'      => $norm($b['starts_at'] ?? null),
        'ends_at'        => $norm($b['ends_at'] ?? null),
        'is_active'      => !empty($b['is_active']) ? 1 : 0,
    ];
    if ($id > 0) {
        $set = implode(', ', array_map(fn($k) => "$k = ?", array_keys($fields)));
        $stmt = $pdo->prepare("UPDATE ops_ylka_campaigns SET $set WHERE id = ?");
        $stmt->execute([...array_values($fields), $id]);
        jsonResponse(['ok' => true, 'id' => $id]);
    } else {
        $cols = implode(', ', array_keys($fields));
        $ph   = implode(', ', array_fill(0, count($fields), '?'));
        $stmt = $pdo->prepare("INSERT INTO ops_ylka_campaigns ($cols) VALUES ($ph)");
        $stmt->execute(array_values($fields));
        jsonResponse(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
    }
}

if ($action === 'delete' && $method === 'POST') {
    $b = readJsonBody();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) errorResponse('invalid id', 400);
    $pdo->prepare("DELETE FROM ops_ylka_campaigns WHERE id = ?")->execute([$id]);
    jsonResponse(['ok' => true]);
}

errorResponse('unknown action', 404);
