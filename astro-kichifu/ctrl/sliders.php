<?php
require_once __DIR__ . '/_lib.php';
require_login();
// この画面は店舗に依存しない（ヘッダーの店舗切替は layout_header 側で処理される）。
// スライダーは全店で1本の一覧。どの店に出すかは各行の「表示店舗」トグルだけで決まる（2026-08-03）。
// 以前は上部の店舗ドロップダウンでも一覧が切り替わり、「立川で吉祥寺のON/OFF」と
// 「吉祥寺は吉祥寺で」の2系統が混在していた。出し先の決め方をトグル1つに寄せる。
$rows = db()->query('SELECT * FROM sliders ORDER BY sort, id')->fetchAll();

// 表示先店舗（slider_shops）と店舗別リンクURLを行ごとに集計
$shopCount = (int)db()->query('SELECT COUNT(*) FROM shops')->fetchColumn();
$dispMap = [];
$urlMap  = [];   // [slider_id][shop_id] => 店舗別URL
$rowIds = array_map('intval', array_column($rows, 'id'));
if ($rowIds) {
    $in = implode(',', array_fill(0, count($rowIds), '?'));
    $ds = db()->prepare("SELECT ss.slider_id, ss.shop_id, ss.url, sh.area FROM slider_shops ss JOIN shops sh ON sh.id=ss.shop_id WHERE ss.slider_id IN ($in) ORDER BY ss.shop_id");
    $ds->execute($rowIds);
    foreach ($ds->fetchAll() as $r) {
        $dispMap[(int)$r['slider_id']][] = $r['area'];
        if (trim((string)$r['url']) !== '') $urlMap[(int)$r['slider_id']][(int)$r['shop_id']] = trim((string)$r['url']);
    }
}

// 各店のサイトに実際に何枚出るか（表示ON かつ 表示先に入っている行）
$allShops = shops_list();
$liveCount = [];
foreach ($allShops as $sh) $liveCount[(int)$sh['id']] = 0;
foreach ($rows as $r) {
    if (!(int)$r['is_display']) continue;
    foreach ($allShops as $sh) {
        if (in_array($sh['area'], $dispMap[(int)$r['id']] ?? [], true)) $liveCount[(int)$sh['id']]++;
    }
}

layout_header('スライダー', 'sliders.php');
?>
<div class="page-head"><h1>スライダー</h1><a class="btn btn-primary" href="/ctrl/slider-edit.php">＋ 新規作成</a></div>
<p class="muted" style="margin:-6px 0 10px">スライダーは<strong>両店で1つの一覧</strong>です。どの店に出すかは各行の「表示先」で決まります（上の店舗の切り替えは効きません）。行をドラッグで並べ替え</p>
<p class="live-count">
  <?php foreach ($allShops as $sh): ?>
    <span><?= h($sh['area']) ?>のサイトに出る <strong><?= (int)$liveCount[(int)$sh['id']] ?></strong> 枚</span>
  <?php endforeach; ?>
</p>
<div class="table-wrap">
  <table class="tbl">
    <thead><tr><th style="width:34px"></th><th>PC画像</th><th>タイトル</th><th>表示先</th><th>リンク</th><th>表示</th><th style="width:60px">操作</th></tr></thead>
    <tbody data-sortable>
      <?php foreach ($rows as $s): $disp = $dispMap[(int)$s['id']] ?? []; ?>
        <tr draggable="true" data-id="<?= (int)$s['id'] ?>">
          <td style="cursor:grab;color:#bbb">⠿</td>
          <td><img class="thumb" style="width:72px;height:40px" src="<?= h(asset_url($s['image_pc'] ?: '/img/placeholder.svg')) ?>" alt=""></td>
          <td><?= h($s['title'] ?: '（無題）') ?></td>
          <td><?php if (count($disp) >= $shopCount && $shopCount > 0): ?><span class="disp-badge disp-both">両店</span><?php elseif (count($disp) === 1): ?><span class="disp-badge disp-one"><?= h($disp[0]) ?>のみ</span><?php else: ?><span class="disp-badge disp-none">表示先なし</span><?php endif; ?></td>
          <?php $own = $urlMap[(int)$s['id']] ?? []; ?>
          <td class="muted" style="max-width:260px">
            <div class="url-cell"><?= h($s['url']) ?></div>
            <?php foreach ($allShops as $sh): $u = $own[(int)$sh['id']] ?? ''; if ($u === '') continue; ?>
              <div class="url-own"><span class="url-own-tag"><?= h($sh['area']) ?></span><span class="url-cell"><?= h($u) ?></span></div>
            <?php endforeach; ?>
          </td>
          <td><button type="button" class="toggle <?= (int)$s['is_display'] ? 'on' : '' ?>" data-toggle-id="<?= (int)$s['id'] ?>"></button></td>
          <td><div class="rowmenu"><button class="rowmenu-btn" type="button">⋯</button>
            <div class="rowmenu-list">
              <a href="/ctrl/slider-edit.php?id=<?= (int)$s['id'] ?>">✏️ 編集</a>
              <button type="button" class="danger" data-del-id="<?= (int)$s['id'] ?>" data-name="スライダー">🗑 削除</button>
            </div></div></td>
        </tr>
      <?php endforeach; ?>
      <?php if (!$rows): ?><tr><td colspan="7" class="muted" style="text-align:center;padding:30px">スライダーがありません</td></tr><?php endif; ?>
    </tbody>
  </table>
</div>
<style>
.disp-badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}
.disp-both{background:#ecfdf5;color:#0d9488;border:1px solid #99f6e4}
.disp-one{background:#fdf2f8;color:#be185d;border:1px solid #fbcfe8}
.disp-none{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
.url-cell{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.url-own{display:flex;align-items:center;gap:6px;margin-top:3px;min-width:0}
.url-own-tag{flex:none;font-size:10px;font-weight:700;color:#be185d;background:#fdf2f8;border:1px solid #fbcfe8;border-radius:999px;padding:1px 7px}
.live-count{display:flex;flex-wrap:wrap;gap:8px 16px;margin:0 0 12px;font-size:12px;color:var(--muted)}
.live-count strong{color:var(--text);font-size:13px}
</style>
<script>window.__CSRF='<?= h(csrf_token()) ?>';window.__TABLE='sliders';</script>
<script src="/ctrl/list.js?v=1"></script>
<?php layout_footer(); ?>
