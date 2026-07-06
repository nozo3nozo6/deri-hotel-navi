<?php
/**
 * shop-service-areas.php — 店舗専用ページに表示する「対応エリア」CRUD.
 *
 * 公開 GET (?shop_id=) + shop-auth セッション認証 POST.
 *
 * Actions:
 *   GET  ?shop_id={uuid}            : 公開. 対応エリア一覧 (店舗専用ページから呼ぶ).
 *   POST action=save                : セッション必須. 配列で一括 upsert.
 *   POST action=delete              : セッション必須. id 指定で 1 件削除.
 *   POST action=set-primary         : セッション必須. id を is_primary=1 に, 他を 0 に.
 *   POST action=reorder             : セッション必須. ids[] の順に sort_order を 0,1,2,... で更新.
 *
 * テーブル: shop_service_areas (sql/shop_service_areas.sql)
 */
require_once __DIR__ . '/db.php';

define('SHOP_SVC_SESSION_TIMEOUT', 86400);
session_set_cookie_params([
    'lifetime' => SHOP_SVC_SESSION_TIMEOUT,
    'path' => '/',
    'domain' => 'yobuho.com',
    'secure' => true,
    'httponly' => true,
    'samesite' => 'Strict'
]);
session_start();

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (preg_match('#^https://([a-z0-9-]+\.)?yobuho\.com$#', $origin)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

function err(string $msg, int $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

function ok(array $data = []) {
    echo json_encode(['success' => true] + $data);
    exit;
}

function requireAuth(): string {
    if (empty($_SESSION['shop_id'])) err('Unauthorized', 401);
    if (time() - ($_SESSION['last_activity'] ?? 0) > SHOP_SVC_SESSION_TIMEOUT) {
        session_destroy();
        err('Session expired', 401);
    }
    $_SESSION['last_activity'] = time();
    return (string)$_SESSION['shop_id'];
}

function readJsonBody(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

function sanitizeArea(?string $s): ?string {
    if ($s === null) return null;
    $s = trim($s);
    if ($s === '') return null;
    if (mb_strlen($s) > 80) $s = mb_substr($s, 0, 80);
    return $s;
}

function buildLabel(?string $pref, ?string $area, ?string $detail, ?string $city): string {
    // 表示優先度: city > detail > area > pref. 一番具体的なものを label に.
    if ($city) return $city;
    if ($detail) return $detail;
    if ($area) return $area;
    if ($pref) return $pref;
    return '';
}

function fetchAreas(PDO $pdo, string $shopId): array {
    $stmt = $pdo->prepare(
        // 表示順は店舗が並べ替えた sort_order を最優先（is_primary は着地点フラグのみで順序に影響させない）
        'SELECT id, pref, area, detail, city, label, is_primary, sort_order
         FROM shop_service_areas
         WHERE shop_id = ?
         ORDER BY sort_order ASC, id ASC'
    );
    $stmt->execute([$shopId]);
    return array_map(function($r) {
        return [
            'id'         => (int)$r['id'],
            'pref'       => $r['pref'],
            'area'       => $r['area'],
            'detail'     => $r['detail'],
            'city'       => $r['city'],
            'label'      => $r['label'],
            'is_primary' => (int)$r['is_primary'] === 1,
            'sort_order' => (int)$r['sort_order'],
        ];
    }, $stmt->fetchAll(PDO::FETCH_ASSOC));
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // 公開エンドポイント: 店舗専用ページから呼ぶ. shop_id 必須.
    $shopId = $_GET['shop_id'] ?? '';
    if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $shopId)) {
        err('invalid shop_id');
    }
    $pdo = DB::conn();
    ok(['areas' => fetchAreas($pdo, $shopId)]);
}

// POST 以降は全て認証必須
$shopId = requireAuth();
$action = $_GET['action'] ?? '';
$pdo = DB::conn();

switch ($action) {
    case 'save':
        // body: { items: [ {id?, pref, area, city, is_primary?, sort_order?}, ... ] }
        // 既存 id があれば UPDATE, 無ければ INSERT.
        $body = readJsonBody();
        $items = $body['items'] ?? null;
        if (!is_array($items)) err('items required');
        $pdo->beginTransaction();
        try {
            $primaryCount = 0;
            foreach ($items as $idx => $it) {
                $pref   = sanitizeArea($it['pref']   ?? null);
                $area   = sanitizeArea($it['area']   ?? null);
                $detail = sanitizeArea($it['detail'] ?? null);
                $city   = sanitizeArea($it['city']   ?? null);
                if (!$pref && !$area && !$detail && !$city) continue;  // 全部空はスキップ
                $label = buildLabel($pref, $area, $detail, $city);
                $isPrimary = !empty($it['is_primary']) ? 1 : 0;
                if ($isPrimary) $primaryCount++;
                if ($primaryCount > 1) $isPrimary = 0;  // 1 行のみ primary 許可
                $sortOrder = (int)($it['sort_order'] ?? $idx);
                $id = isset($it['id']) ? (int)$it['id'] : 0;
                if ($id > 0) {
                    // 自店舗の行か確認
                    $chk = $pdo->prepare('SELECT shop_id FROM shop_service_areas WHERE id = ?');
                    $chk->execute([$id]);
                    $owner = $chk->fetchColumn();
                    if ((string)$owner !== $shopId) continue;
                    $upd = $pdo->prepare(
                        'UPDATE shop_service_areas
                         SET pref = ?, area = ?, detail = ?, city = ?, label = ?, is_primary = ?, sort_order = ?
                         WHERE id = ?'
                    );
                    $upd->execute([$pref, $area, $detail, $city, $label, $isPrimary, $sortOrder, $id]);
                } else {
                    $ins = $pdo->prepare(
                        'INSERT INTO shop_service_areas (shop_id, pref, area, detail, city, label, is_primary, sort_order)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
                    );
                    $ins->execute([$shopId, $pref, $area, $detail, $city, $label, $isPrimary, $sortOrder]);
                }
            }
            // primary が 1 行になるよう正規化: 最新の primary 以外を 0 に
            if ($primaryCount >= 1) {
                $latestPrimary = $pdo->prepare(
                    'SELECT id FROM shop_service_areas WHERE shop_id = ? AND is_primary = 1
                     ORDER BY updated_at DESC LIMIT 1'
                );
                $latestPrimary->execute([$shopId]);
                $keepId = $latestPrimary->fetchColumn();
                if ($keepId) {
                    $unsetOthers = $pdo->prepare(
                        'UPDATE shop_service_areas SET is_primary = 0 WHERE shop_id = ? AND id <> ?'
                    );
                    $unsetOthers->execute([$shopId, $keepId]);
                }
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            err('save failed: ' . $e->getMessage(), 500);
        }
        ok(['areas' => fetchAreas($pdo, $shopId)]);
        break;

    case 'delete':
        $body = readJsonBody();
        $id = (int)($body['id'] ?? 0);
        if ($id <= 0) err('id required');
        $del = $pdo->prepare('DELETE FROM shop_service_areas WHERE id = ? AND shop_id = ?');
        $del->execute([$id, $shopId]);
        ok(['deleted' => $del->rowCount(), 'areas' => fetchAreas($pdo, $shopId)]);
        break;

    case 'set-primary':
        $body = readJsonBody();
        $id = (int)($body['id'] ?? 0);
        if ($id <= 0) err('id required');
        $pdo->beginTransaction();
        try {
            // 自店舗の行か確認
            $chk = $pdo->prepare('SELECT id FROM shop_service_areas WHERE id = ? AND shop_id = ?');
            $chk->execute([$id, $shopId]);
            if (!$chk->fetchColumn()) {
                $pdo->rollBack();
                err('not found', 404);
            }
            $pdo->prepare('UPDATE shop_service_areas SET is_primary = 0 WHERE shop_id = ?')->execute([$shopId]);
            $pdo->prepare('UPDATE shop_service_areas SET is_primary = 1 WHERE id = ? AND shop_id = ?')
                ->execute([$id, $shopId]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            err('set-primary failed: ' . $e->getMessage(), 500);
        }
        ok(['areas' => fetchAreas($pdo, $shopId)]);
        break;

    case 'reorder':
        $body = readJsonBody();
        $ids = $body['ids'] ?? null;
        if (!is_array($ids)) err('ids required');
        $pdo->beginTransaction();
        try {
            $upd = $pdo->prepare(
                'UPDATE shop_service_areas SET sort_order = ? WHERE id = ? AND shop_id = ?'
            );
            foreach ($ids as $idx => $id) {
                $upd->execute([(int)$idx, (int)$id, $shopId]);
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            err('reorder failed: ' . $e->getMessage(), 500);
        }
        ok(['areas' => fetchAreas($pdo, $shopId)]);
        break;

    default:
        err('invalid action');
}
