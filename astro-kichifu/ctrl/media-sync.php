<?php
// ==========================================================================
// media-sync.php — 媒体ID同期ステータス（在籍キャスト × 5媒体の突き合わせ）
//   目的: 新人が入ったとき「どの媒体への登録・ひも付けがまだか」を一目で分かるようにする。
//   データ: ① girl_media_ids（DBのひも付け・確定） ② botが6時間毎に収集する媒体在籍カタログ
//           （media_catalog.json = api/media-catalog.php 経由でアップロード。名前一致なら自動解決）。
//   「今すぐ収集」ボタン: Webhookで bot の collect-girl-ids を即時実行（新人を媒体に登録した直後用）。
//   ※ カタログは立川の媒体アカウントのもの。吉祥寺(shop2)は情報局のみ別アカウントのため参考表示。
// ==========================================================================
require_once __DIR__ . '/_lib.php';
$admin = require_login();
$shop = current_shop_id();

// bot と同一の名前正規化（src/Sources/CastNameNormalizer.php 移植。部分一致禁止）
function ms_normalize(string $displayName): string {
    $name = trim(html_entity_decode($displayName, ENT_QUOTES));
    $name = mb_convert_kana($name, 'as', 'UTF-8');
    $name = preg_replace('/\s+/u', '', $name) ?? $name;
    if (preg_match('/^(.+?)（\d+）$/u', $name, $m)) return trim($m[1]);
    if (preg_match('/^(.+?)\(\d+\)$/u', $name, $m)) return trim($m[1]);
    return trim($name);
}

$MEDIA = [
    'fujoho'   => ['label' => '情報局',   'db' => 'fujoho_girl_id'],
    'ekichika' => ['label' => '駅ちか',   'db' => 'ekichika_girl_id'],
    'heaven'   => ['label' => 'ヘブン',   'db' => 'heaven_member_id'],
    'fuzoku'   => ['label' => '風じゃ',   'db' => 'fuzoku_girl_no'],
    'deli'     => ['label' => 'デリじゃ', 'db' => 'deli_girl_no'],
];

// ---- POST: 今すぐ収集（bot Webhook） ----
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && ($_POST['action'] ?? '') === 'collect') {
    csrf_check();
    require_once __DIR__ . '/../api/media-webhook.php';
    media_webhook_notify((int)$shop, 0, '(media-sync)', ['media_ids'], 'ctrl', ['collect_girl_ids']);
    flash('ok', '媒体ID収集をbotに依頼しました。5媒体を巡回するため数分かかります。数分後にこのページを再読み込みしてください。');
    redirect('media-sync.php');
}

// ---- データ読み込み ----
$girls = db()->prepare('SELECT g.id, g.name FROM girls g JOIN girl_shops gs ON gs.girl_id = g.id AND gs.shop_id = ? WHERE g.is_display = 1 ORDER BY g.name');
$girls->execute([$shop]);
$girls = $girls->fetchAll(PDO::FETCH_ASSOC);

$mi = [];
$st = db()->prepare('SELECT * FROM girl_media_ids WHERE shop_id = ?');
$st->execute([$shop]);
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) { $mi[(int)$r['girl_id']] = $r; }

// カタログ（Web非公開領域）
$catPath = dirname($_SERVER['DOCUMENT_ROOT']) . '/media_catalog.json';
$catData = is_file($catPath) ? (json_decode((string)file_get_contents($catPath), true) ?: []) : [];
$uploadedAt = (string)($catData['uploaded_at'] ?? '');
$catalog = (array)($catData['catalog'] ?? []);
$catN = [];   // 媒体 => 正規化名 => [元名, id]
foreach ($MEDIA as $mk => $mv) {
    $catN[$mk] = [];
    foreach ((array)($catalog[$mk] ?? []) as $nm => $id) {
        $catN[$mk][ms_normalize((string)$nm)] = [(string)$nm, (string)$id];
    }
}

// CTRL側 正規化名（同名検知つき）
$ctrlNorm = [];   // norm => 出現回数
foreach ($girls as $g) { $n = ms_normalize($g['name']); $ctrlNorm[$n] = ($ctrlNorm[$n] ?? 0) + 1; }

// マトリクス計算
$rows = [];
$summary = array_fill_keys(array_keys($MEDIA), ['ok' => 0, 'auto' => 0, 'ng' => 0]);
foreach ($girls as $g) {
    $gid = (int)$g['id'];
    $norm = ms_normalize($g['name']);
    $dup = ($ctrlNorm[$norm] ?? 0) > 1;   // 同名（自動解決不可＝手動ID必須）
    $cells = [];
    foreach ($MEDIA as $mk => $mv) {
        $dbId = trim((string)($mi[$gid][$mv['db']] ?? ''));
        if ($dbId !== '') {
            $cells[$mk] = ['st' => 'ok', 'id' => $dbId];
            $summary[$mk]['ok']++;
        } elseif (!$dup && isset($catN[$mk][$norm])) {
            $cells[$mk] = ['st' => 'auto', 'id' => $catN[$mk][$norm][1]];
            $summary[$mk]['auto']++;
        } else {
            $cells[$mk] = ['st' => 'ng', 'id' => ''];
            $summary[$mk]['ng']++;
        }
    }
    $rows[] = ['id' => $gid, 'name' => $g['name'], 'dup' => $dup, 'cells' => $cells];
}

// 逆方向: 媒体カタログにいるが CTRL 在籍にいない（退店処理漏れ候補）
$orphans = [];
foreach ($MEDIA as $mk => $mv) {
    $orphans[$mk] = [];
    foreach ($catN[$mk] as $norm => [$origName, $id]) {
        if (!isset($ctrlNorm[$norm])) $orphans[$mk][] = ['name' => $origName, 'id' => $id];
    }
}

layout_header('媒体ID同期', 'media-sync.php');
?>
<style>
  .ms-head { display:flex; gap:14px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .ms-collect { background:#0d9488; color:#fff; border:none; border-radius:9px; padding:10px 20px; font-size:.9rem; font-weight:700; cursor:pointer; }
  .ms-collect:hover { background:#0f766e; }
  .ms-meta { font-size:.78rem; color:#64748b; }
  .ms-legend { background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px; font-size:.8rem; line-height:1.8; margin-bottom:14px; }
  .ms-wrap { overflow-x:auto; background:#fff; border:1px solid #e5e7eb; border-radius:10px; }
  .ms-table { width:100%; border-collapse:collapse; min-width:640px; }
  .ms-table th, .ms-table td { border-bottom:1px solid #eef2f7; padding:7px 10px; font-size:.82rem; text-align:center; white-space:nowrap; }
  .ms-table th { background:#f8fafc; color:#475569; font-size:.75rem; position:sticky; top:0; }
  .ms-table td.nm { text-align:left; font-weight:700; }
  .ms-dup { display:inline-block; margin-left:6px; font-size:.65rem; background:#fef3c7; color:#92400e; border-radius:99px; padding:1px 7px; }
  .ms-ok { color:#15803d; } .ms-auto { color:#0369a1; } .ms-ng { color:#dc2626; font-weight:700; }
  .ms-id { display:block; font-size:.62rem; color:#94a3b8; font-weight:400; }
  .ms-sum td { background:#f0fdf4; font-weight:700; }
  .ms-orphans { margin-top:20px; }
  .ms-orphans details { background:#fff; border:1px solid #fde68a; border-radius:10px; padding:10px 14px; margin-bottom:8px; }
  .ms-orphans summary { cursor:pointer; font-weight:700; color:#92400e; font-size:.88rem; }
  .ms-orphans ul { margin:8px 0 2px; padding-left:20px; font-size:.82rem; line-height:1.9; }
  @media (max-width:720px){ .ms-table th, .ms-table td { padding:6px 6px; font-size:.76rem; } }
</style>

<div class="page-head"><h1>🔗 媒体ID同期ステータス</h1></div>

<div class="ms-head">
  <form method="post" onsubmit="return confirm('botに媒体ID収集を依頼します。5媒体を巡回するため数分かかります。\n新人を媒体に登録した直後に使ってください。');">
    <?= csrf_field() ?>
    <input type="hidden" name="action" value="collect">
    <button class="ms-collect" type="submit">🔄 媒体IDを今すぐ収集</button>
  </form>
  <span class="ms-meta">媒体在籍データ: <?= $uploadedAt ? h(date('n/j H:i', strtotime($uploadedAt))) . ' 時点（botが6時間毎に自動更新）' : 'まだありません（ボタンで初回収集）' ?></span>
</div>

<div class="ms-legend">
  <b class="ms-ok">✅ ひも付け済み</b>＝ID確定・出勤/即姫が同期される ／
  <b class="ms-auto">🔍 自動解決</b>＝媒体に同じ名前あり・botが名前で自動ひも付け（動作OK）／
  <b class="ms-ng">❌ 未登録</b>＝その媒体に在籍が見つからない（媒体側に未登録 or 名前が違う）
  <br>新人の流れ: ①CTRLに登録 → ②各媒体の管理画面で在籍登録（名前はCTRLと同じ表記に）→ ③「今すぐ収集」→ ✅/🔍になれば同期開始。
  <b>同名の子（⚠マーク）だけは自動解決できない</b>ため <a href="play-availability.php">最速で遊べる時間</a> の媒体ID欄で手動設定してください。
</div>

<div class="ms-wrap">
<table class="ms-table">
  <tr>
    <th style="text-align:left">キャスト（<?= count($rows) ?>名）</th>
    <?php foreach ($MEDIA as $mk => $mv): ?><th><?= h($mv['label']) ?></th><?php endforeach; ?>
  </tr>
  <tr class="ms-sum">
    <td class="nm" style="text-align:left">登録済み（✅+🔍）</td>
    <?php foreach ($MEDIA as $mk => $mv): $s = $summary[$mk]; ?>
      <td><?= $s['ok'] + $s['auto'] ?>/<?= count($rows) ?></td>
    <?php endforeach; ?>
  </tr>
  <?php foreach ($rows as $r): ?>
  <tr>
    <td class="nm"><?= h($r['name']) ?><?php if ($r['dup']): ?><span class="ms-dup">⚠同名</span><?php endif; ?></td>
    <?php foreach ($MEDIA as $mk => $mv): $c = $r['cells'][$mk]; ?>
      <td>
        <?php if ($c['st'] === 'ok'): ?><span class="ms-ok">✅</span><span class="ms-id"><?= h($c['id']) ?></span>
        <?php elseif ($c['st'] === 'auto'): ?><span class="ms-auto">🔍</span><span class="ms-id"><?= h($c['id']) ?></span>
        <?php else: ?><span class="ms-ng">❌</span><?php endif; ?>
      </td>
    <?php endforeach; ?>
  </tr>
  <?php endforeach; ?>
</table>
</div>

<div class="ms-orphans">
  <h2 style="font-size:1rem;margin:18px 0 10px;">🧹 媒体に残っているがCTRL在籍にいない子（退店処理漏れの確認用）</h2>
  <p class="ms-meta" style="margin-bottom:10px;">退店済みの子が媒体に載ったままだと指名事故のもとです。各媒体の管理画面で非表示/削除してください（この画面からは消せません）。<br>※ 名前の表記ゆれで「CTRLにいるのに載る」場合もあります。その場合は媒体側の名前をCTRLと同じ表記に直すと消えます。</p>
  <?php foreach ($MEDIA as $mk => $mv): ?>
    <details>
      <summary><?= h($mv['label']) ?>: <?= count($orphans[$mk]) ?>名</summary>
      <?php if ($orphans[$mk]): ?>
        <ul><?php foreach ($orphans[$mk] as $o): ?><li><?= h($o['name']) ?>（媒体ID: <?= h($o['id']) ?>）</li><?php endforeach; ?></ul>
      <?php else: ?><p class="ms-meta" style="margin:8px 0 2px;">なし ✨</p><?php endif; ?>
    </details>
  <?php endforeach; ?>
</div>

<?php if ($shop !== 1): ?>
  <p class="ms-meta" style="margin-top:14px;">⚠ 媒体在籍データは立川の媒体アカウントのものです。吉祥寺の情報局は別アカウント（id=53179）のため、この画面は参考値です。</p>
<?php endif; ?>

<?php layout_footer(); ?>
