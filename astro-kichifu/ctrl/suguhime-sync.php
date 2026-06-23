<?php
// ==========================================================================
// suguhime-sync.php — 口コミ情報局「すぐヒメ」同期アシスト（半自動）
//   母艦 admi(立川/id=57) の公開すぐヒメを scrape し、
//   kichifu(吉祥寺/id=53179) の公開すぐヒメと差分表示する。
//   書き込みは一切しない（ToS/アカBANリスク回避）。最終操作は
//   「kichifu 出勤表を開く」深リンク → 人が ▼→すぐヒメに掲載 を押す。
//
//   ※ fujoho 店舗管理は 2段階POSTフォーム＋サーバーセッションで自動投稿が
//     脆い & 規約リスクがあるため、v1 は読み取り専用アシストに留める。
//   関連メモリ: project_admi_media_sync_tool
// ==========================================================================
require_once __DIR__ . '/_lib.php';
require_login();
$shop = current_shop_id();

date_default_timezone_set('Asia/Tokyo');

// --- 媒体（口コミ情報局）の店舗ID。当面は 立川→吉祥寺 固定。----------------
//   将来は shops テーブルに媒体IDカラムを持たせて店舗ごとに切替予定。
const FUJOHO_SRC_ID    = 57;     // admi（立川 since2002・母艦）= 同期元
const FUJOHO_DST_ID    = 53179;  // kichifu（吉祥寺 since2009）   = 同期先
const FUJOHO_SRC_LABEL = 'admi（立川・母艦）';
const FUJOHO_DST_LABEL = 'kichifu（吉祥寺）';
// kichifu 出勤表（ここで ▼→「すぐヒメ！に掲載」を押す）
const FUJOHO_DST_SCHED = 'https://fujoho.jp/index.php?sh=53179&p=shp_girl_schedule_list';

/**
 * 口コミ情報局の公開すぐヒメページを scrape する。
 * 返り値: ['ok'=>bool, 'as_of'=>?string, 'list'=>[ name => ['name','age','status'] ]]
 *   すぐヒメ0人のときページは 404 になる → ok=true / list=[] 扱い。
 */
function fujoho_fetch_suguhime(int $id): array {
    $url = "https://fujoho.jp/index.php?p=shop_info_notime_girl&id={$id}";
    $ctx = stream_context_create(['http' => [
        'timeout'       => 15,
        'ignore_errors' => true, // 404でも本文/ヘッダを取得
        'header'        => "User-Agent: kichifu-suguhime-sync\r\nAccept-Language: ja\r\n",
    ]]);
    $html = @file_get_contents($url, false, $ctx);

    $code = 0;
    foreach (($http_response_header ?? []) as $hh) {
        if (preg_match('#^HTTP/\S+\s+(\d+)#', $hh, $m)) $code = (int)$m[1];
    }
    // 通信自体に失敗（タイムアウト等）したときだけ ok=false。404は「0人」。
    if ($html === false) return ['ok' => false, 'as_of' => null, 'list' => []];
    if ($code === 404)   return ['ok' => true,  'as_of' => null, 'list' => []];
    if ($code >= 400)    return ['ok' => false, 'as_of' => null, 'list' => []];

    $doc = new DOMDocument();
    @$doc->loadHTML('<?xml encoding="UTF-8">' . $html);
    $xp = new DOMXPath($doc);

    $clsHas = fn(string $c) => "contains(concat(' ',normalize-space(@class),' '),' {$c} ')";

    // すぐヒメ一覧は最初の article.shop_contents 内。他店レコメンド混入を避ける。
    $scope = $xp->query("(//*[" . $clsHas('shop_contents') . "])[1]")->item(0);
    $ctxNode = $scope ?: $doc;

    $cards = $xp->query(".//*[" . $clsHas('main_section_info_inner') . "]", $ctxNode);
    $list = [];
    $asOf = null;
    foreach ($cards as $c) {
        $nameNode   = $xp->query(".//*[" . $clsHas('main_section_info_name') . "]", $c)->item(0);
        $statusNode = $xp->query(".//*[" . $clsHas('main_section_info_notime_top_text') . "]", $c)->item(0);
        if (!$nameNode || !$statusNode) continue; // すぐヒメカードのみ採用

        $raw  = trim(preg_replace('/\s+/u', ' ', $nameNode->textContent));
        $name = $raw; $age = null;
        // 「かれん（29）」→ 名前＋年齢（全角/半角括弧）
        if (preg_match('/^(.*?)\s*[（(]\s*(\d{1,2})\s*[)）]/u', $raw, $m)) {
            $name = trim($m[1]); $age = (int)$m[2];
        }
        if ($name === '') continue;

        $status = trim(preg_replace('/\s+/u', ' ', $statusNode->textContent));

        if ($asOf === null) {
            $b = $xp->query(".//*[" . $clsHas('main_section_info_notime_bottom') . "]", $c)->item(0);
            if ($b && preg_match('/(\d{1,2}:\d{2})/', $b->textContent, $mm)) $asOf = $mm[1];
        }
        $list[$name] = ['name' => $name, 'age' => $age, 'status' => $status];
    }
    return ['ok' => true, 'as_of' => $asOf, 'list' => $list];
}

$src = fujoho_fetch_suguhime(FUJOHO_SRC_ID); // admi
$dst = fujoho_fetch_suguhime(FUJOHO_DST_ID); // kichifu

// kichifu の在籍（girls テーブル）= 「吉祥寺に居るか」判定用
$rosterSet = [];
try {
    $st = db()->prepare('SELECT name FROM girls WHERE shop_id = ?');
    $st->execute([$shop]);
    foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $n) $rosterSet[trim((string)$n)] = true;
} catch (Throwable $e) { /* roster無しでも続行 */ }

// --- 差分計算 -------------------------------------------------------------
//   synced   : admi にも kichifu にも居る → OK
//   add      : admi に居て kichifu すぐヒメに無い・かつ吉祥寺在籍あり → 追加候補
//   noroster : admi に居るが吉祥寺に在籍なし（あおい等）→ 同期不可
//   remove   : kichifu すぐヒメに居るが admi にもう居ない → 取消候補
$rows = [];
foreach ($src['list'] as $name => $g) {
    if (isset($dst['list'][$name]))      $state = 'synced';
    elseif (isset($rosterSet[$name]))    $state = 'add';
    else                                 $state = 'noroster';
    $rows[$name] = [
        'name' => $name, 'age' => $g['age'],
        'srcStatus' => $g['status'],
        'dstStatus' => $dst['list'][$name]['status'] ?? null,
        'state' => $state,
    ];
}
foreach ($dst['list'] as $name => $g) {
    if (isset($src['list'][$name])) continue;
    $rows[$name] = [
        'name' => $name, 'age' => $g['age'],
        'srcStatus' => null,
        'dstStatus' => $g['status'],
        'state' => 'remove',
    ];
}
// 並び: 追加候補 → 在籍なし → 取消候補 → 同期済み の順で目立たせる
$order = ['add' => 0, 'noroster' => 1, 'remove' => 2, 'synced' => 3];
uasort($rows, fn($a, $b) => ($order[$a['state']] <=> $order[$b['state']]) ?: strcmp($a['name'], $b['name']));

$nAdd = count(array_filter($rows, fn($r) => $r['state'] === 'add'));

$STATE_BADGE = [
    'add'      => ['badge-new', '➕ 追加候補'],
    'noroster' => ['badge-off', '⚠️ 吉祥寺に在籍なし'],
    'remove'   => ['badge-off', '➖ admiにもう無い（取消候補）'],
    'synced'   => ['badge-on',  '✅ 同期済み'],
];

layout_header('すぐヒメ同期', 'suguhime-sync.php');
?>
<div class="page-head">
  <h1>⚡ すぐヒメ同期 <span class="muted" style="font-size:13px;font-weight:400">口コミ情報局</span></h1>
  <div style="display:flex;gap:10px;flex-wrap:wrap">
    <a class="btn" href="/ctrl/suguhime-sync.php">🔄 再チェック</a>
    <a class="btn btn-primary" href="<?= h(FUJOHO_DST_SCHED) ?>" target="_blank" rel="noopener">kichifu 出勤表を開いて設定 ↗</a>
  </div>
</div>

<?php if (!$src['ok'] || !$dst['ok']): ?>
  <div class="flash flash-err">
    <?php if (!$src['ok']): ?>admi（立川）のすぐヒメ取得に失敗しました。<?php endif; ?>
    <?php if (!$dst['ok']): ?>kichifu（吉祥寺）のすぐヒメ取得に失敗しました。<?php endif; ?>
    時間をおいて「再チェック」してください。
  </div>
<?php endif; ?>

<div class="stat-grid" style="margin-bottom:20px">
  <div class="stat">
    <div class="l">🛰 <?= h(FUJOHO_SRC_LABEL) ?> すぐヒメ<?= $src['as_of'] ? ' <span class="muted">('.h($src['as_of']).'時点)</span>' : '' ?></div>
    <div class="n"><?= count($src['list']) ?><span style="font-size:14px;font-weight:400" class="muted"> 人</span></div>
  </div>
  <div class="stat">
    <div class="l">🏠 <?= h(FUJOHO_DST_LABEL) ?> すぐヒメ<?= $dst['as_of'] ? ' <span class="muted">('.h($dst['as_of']).'時点)</span>' : '' ?></div>
    <div class="n"><?= count($dst['list']) ?><span style="font-size:14px;font-weight:400" class="muted"> 人</span></div>
  </div>
  <div class="stat">
    <div class="l">➕ 追加すべき人数</div>
    <div class="n" style="<?= $nAdd ? 'color:var(--accent)' : '' ?>"><?= $nAdd ?><span style="font-size:14px;font-weight:400" class="muted"> 人</span></div>
  </div>
</div>

<div class="table-wrap">
  <table class="tbl">
    <thead>
      <tr><th>女の子</th><th><?= h(FUJOHO_SRC_LABEL) ?>の状況</th><th><?= h(FUJOHO_DST_LABEL) ?>の状況</th><th>判定</th></tr>
    </thead>
    <tbody>
      <?php foreach ($rows as $r): [$cls, $label] = $STATE_BADGE[$r['state']]; ?>
        <tr>
          <td><strong><?= h($r['name']) ?></strong><?= $r['age'] ? ' <span class="muted">('.(int)$r['age'].')</span>' : '' ?></td>
          <td><?= $r['srcStatus'] !== null ? h($r['srcStatus']) : '<span class="muted">—</span>' ?></td>
          <td><?= $r['dstStatus'] !== null ? h($r['dstStatus']) : '<span class="muted">—</span>' ?></td>
          <td><span class="badge <?= $cls ?>"><?= h($label) ?></span></td>
        </tr>
      <?php endforeach; ?>
      <?php if (!$rows): ?>
        <tr><td colspan="4" class="muted" style="text-align:center;padding:30px">現在どちらの店舗もすぐヒメは0人です</td></tr>
      <?php endif; ?>
    </tbody>
  </table>
</div>

<div class="card card-pad" style="margin-top:20px">
  <h2 style="margin-top:0;font-size:15px">使い方</h2>
  <ol style="margin:0;padding-left:20px;line-height:2;color:var(--text)">
    <li><strong>➕ 追加候補</strong>の女の子を、上の「<strong>kichifu 出勤表を開いて設定</strong>」から開く。</li>
    <li>出勤表で対象の女の子カードの <strong>▼ →「すぐヒメ！に掲載」</strong>→ 何時から遊べるか選択 → 確認画面 → 掲載。</li>
    <li>戻って「🔄 再チェック」。✅ 同期済み になれば完了。</li>
    <li><strong>➖ 取消候補</strong>は出勤表のすぐヒメ欄 ▼ →「掲載取消」、<strong>⚠️ 在籍なし</strong>は吉祥寺に居ないため同期不可。</li>
  </ol>
  <p class="muted" style="margin:14px 0 0;font-size:12px">
    ※ すぐヒメはリアルタイム（待機中／○時から）で変動します。このページは開いた時点のスナップショットです。<br>
    ※ 書き込みは自動化していません（媒体の規約・アカウント保全のため、最終操作は人が行います）。
  </p>
</div>
<?php layout_footer(); ?>
