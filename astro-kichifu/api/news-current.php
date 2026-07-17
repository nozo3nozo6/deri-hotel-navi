<?php
// ==========================================================================
// news-current.php — 「いま情報局(速報!)に出すべき最新お知らせ1件」API（bot連携）
//   仕様: official-media-update/references/CLAUDE-NEWS-API.md（2026-07-16）
//   bot(Grok)が本APIをポーリング/Webhook起点で読み、情報局 shp_event へ投稿する。
//   認証: X-Api-Key または Authorization: Bearer ＝ db-config.php の PLAY_API_KEY（play-availabilityと同一）。
//
//   GET ?shop_id=1                 → 公開中の最新1件（該当なし item=null）
//   媒体別自動整形: body_html=駅ちか用(CSS可・URL除去) / body_text=情報局用(CSS不可・URL併記) /
//                   body_html_raw=元HTML（2026-07-17 店長指示）
//   GET ?shop_id=1&id=277          → 単体取得（公開窓の判定はせず status で返す・仕様§4.3）
//   GET ...&urls=0                 → body_text からURLを全削除（コピペ用タブと同一。URL不可媒体向け）
//
//   選定ロジック（仕様§4.1）: shop_id一致 AND 公開中(is_display=1) AND posted_at<=now
//     → posted_at DESC, modified DESC, id DESC の先頭1件。
//   既存スキーマとの対応: publish_at=posted_at / updated_at=modified(ON UPDATE自動) /
//     status: is_display=0→hidden, posted_at NULL or 未来→draft, それ以外→published /
//     end_at カラムは存在しない→常に null（公開終了の概念が必要になったら追加）。
//   body_text: api/_html-text.php news_html_to_text()（コピペ用タブとアルゴリズム共通）。
//     既定はリンクURL併記（仕様§3.1）。DBには保存しない（GET時生成・仕様§7で許容）。
// ==========================================================================
declare(strict_types=1);
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/db-config.php';   // PLAY_API_KEY を認証チェック前に読む（db.php は遅延読込）
require_once __DIR__ . '/_html-text.php';

date_default_timezone_set('Asia/Tokyo');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (!defined('PLAY_API_KEY') || PLAY_API_KEY === '') {
    http_response_code(503); echo json_encode(['error' => 'api disabled']); exit;
}
$key = $_SERVER['HTTP_X_API_KEY'] ?? '';
if ($key === '' && preg_match('/^Bearer\s+(.+)$/i', $_SERVER['HTTP_AUTHORIZATION'] ?? '', $m)) $key = trim($m[1]);
if ($key === '' && isset($_GET['key'])) $key = (string)$_GET['key'];
if (!is_string($key) || $key === '' || !hash_equals(PLAY_API_KEY, $key)) {
    http_response_code(401); echo json_encode(['error' => 'unauthorized']); exit;
}

$shopId = (int)($_GET['shop_id'] ?? 0);
if (!$shopId) { http_response_code(400); echo json_encode(['error' => 'shop_id required']); exit; }
$withUrls = !isset($_GET['urls']) || $_GET['urls'] !== '0';

// 画像URLの絶対化（画像の正は admi2888.com。/uploads 相対と旧kichifu絶対URLを正規化）
function news_image_url(?string $thumb): ?string {
    if ($thumb === null || $thumb === '') return null;
    if (preg_match('#^https?://#i', $thumb)) {
        return preg_replace('#^https?://kichifu\.com(/uploads/)#i', 'https://admi2888.com$1', $thumb);
    }
    return 'https://admi2888.com' . (str_starts_with($thumb, '/') ? '' : '/') . $thumb;
}

function news_item_json(array $r, bool $withUrls): array {
    $now = time();
    $published = (int)$r['is_display'] === 1 && $r['posted_at'] !== null && strtotime($r['posted_at']) <= $now;
    $status = (int)$r['is_display'] !== 1 ? 'hidden' : ($published ? 'published' : 'draft');
    $bodyText = news_html_to_text((string)($r['body'] ?? ''), $withUrls);
    $iso = fn(?string $dt) => $dt ? date('Y-m-d\TH:i:sP', strtotime($dt)) : null;
    return [
        'id'         => (int)$r['id'],
        'shop_id'    => (int)$r['shop_id'],
        'title'      => (string)$r['title'],
        // 媒体別の自動整形（2026-07-17 店長指示）:
        //   body_html = 駅ちか用: CSS可・URL不可 → URL除去版（<a>はstyle維持のまま<span>化＋裸URL削除）
        //   body_text = 情報局用: CSS不可・URL可 → プレーン抽出＋リンクURL併記（既定）
        //   body_html_raw = 編集画面の元HTML（そのまま。必要な媒体・デバッグ用）
        'body_html'  => news_html_strip_urls((string)($r['body'] ?? '')),
        'body_html_raw' => (string)($r['body'] ?? ''),
        'body_text'  => $bodyText,
        'image_url'  => news_image_url($r['thumb'] ?? null),
        'publish_at' => $iso($r['posted_at']),
        'end_at'     => null,                          // 公開終了カラムなし（仕様どおり null=終了なし）
        'status'     => $status,
        'updated_at' => $iso($r['modified']),
        'updated_by' => 'ctrl',
        // bot の変更検知用: id + 更新時刻 + 抽出テキストのハッシュ
        '_fingerprint' => 'sha256:' . hash('sha256', $r['id'] . '|' . $r['modified'] . '|' . $bodyText),
    ];
}

try {
    $id = (int)($_GET['id'] ?? 0);
    if ($id) {
        // 単体取得（仕様§4.3）: 公開窓に関わらず返す（status で判断できる）
        $st = DB::conn()->prepare('SELECT * FROM news WHERE id = ? AND shop_id = ?');
        $st->execute([$id, $shopId]);
        $r = $st->fetch(PDO::FETCH_ASSOC);
        if (!$r) { http_response_code(404); echo json_encode(['error' => 'not found']); exit; }
        $item = news_item_json($r, $withUrls);
    } else {
        // 最新1件（仕様§4.1）
        $st = DB::conn()->prepare(
            'SELECT * FROM news
              WHERE shop_id = ? AND is_display = 1 AND posted_at IS NOT NULL AND posted_at <= NOW()
              ORDER BY posted_at DESC, modified DESC, id DESC
              LIMIT 1'
        );
        $st->execute([$shopId]);
        $r = $st->fetch(PDO::FETCH_ASSOC);
        $item = $r ? news_item_json($r, $withUrls) : null;
    }

    $fp = $item['_fingerprint'] ?? null;
    if ($item) unset($item['_fingerprint']);
    echo DB::jsonEncode([
        'item'        => $item,
        'server_time' => date('Y-m-d\TH:i:sP'),
        'fingerprint' => $fp,
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'server error']);
}
