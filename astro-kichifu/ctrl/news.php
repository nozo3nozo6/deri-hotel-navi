<?php
require_once __DIR__ . '/_lib.php';
require_login();
$shop = current_shop_id();

$q = trim((string)($_GET['q'] ?? ''));
$page = max(1, (int)($_GET['page'] ?? 1));
$per = 20;
$where = 'shop_id = ?'; $args = [$shop];
if ($q !== '') { $where .= ' AND title LIKE ?'; $args[] = '%' . $q . '%'; }

$cnt = db()->prepare("SELECT COUNT(*) FROM news WHERE $where"); $cnt->execute($args);
$total = (int)$cnt->fetchColumn();
$st = db()->prepare("SELECT * FROM news WHERE $where ORDER BY COALESCE(posted_at, created) DESC, id DESC LIMIT $per OFFSET " . (($page - 1) * $per));
$st->execute($args);
$rows = $st->fetchAll();

// ---- 媒体への反映状況（bot が news-media-report.php へ送った記録）----
// 営業日は 5:00〜翌5:00。bot 側の判定と揃える
$bizDate = date('H:i') < '05:00' ? date('Y-m-d', strtotime('-1 day')) : date('Y-m-d');
$bizFrom = $bizDate . ' 05:00:00';
// 上限は bot の既定値と合わせる（変えたら両方直す）
$MEDIA_CAP = ['manzoku' => ['マンゾク', 1], 'mensv' => ['メンズバ', 3], 'fucolle' => ['フーコレ', 2]];

$todayNews = [];
$mediaLog = [];
$mediaReady = true;
try {
    $tn = db()->prepare(
        'SELECT id, title, posted_at FROM news
          WHERE shop_id = ? AND is_display = 1 AND posted_at IS NOT NULL
            AND posted_at <= NOW() AND posted_at >= ?
          ORDER BY posted_at ASC, id ASC'
    );
    $tn->execute([$shop, $bizFrom]);
    $todayNews = $tn->fetchAll();

    $ml = db()->prepare('SELECT media, news_id, status, message, created FROM news_media_posts WHERE shop_id = ? AND biz_date = ?');
    $ml->execute([$shop, $bizDate]);
    foreach ($ml->fetchAll() as $r) {
        $mediaLog[$r['media']][(int)$r['news_id']] = $r;
    }
} catch (Throwable $e) {
    // 記録テーブルがまだ無い等はカードごと出さない
    $mediaReady = false;
}

layout_header('お知らせ', 'news.php');
?>
<?php if ($mediaReady): ?>
<div class="card card-pad" style="margin-bottom:16px">
  <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px">
    <h2 style="font-size:1rem;margin:0">媒体への反映状況</h2>
    <span class="muted" style="font-size:.8rem"><?= h(date('n/j', strtotime($bizDate))) ?> の営業日ぶん（5:00〜翌5:00）</span>
  </div>
  <div class="table-wrap">
    <table class="tbl nm-media-tbl">
      <thead>
        <tr>
          <th style="min-width:60px">公開</th>
          <th>お知らせ</th>
          <?php foreach ($MEDIA_CAP as $mk => [$label, $cap]):
              $used = 0;
              foreach ($mediaLog[$mk] ?? [] as $r) { if ($r['status'] === 'ok') $used++; } ?>
            <th style="text-align:center;white-space:nowrap">
              <?= h($label) ?><br>
              <span class="muted" style="font-weight:400;font-size:.72rem"><?= $used ?> / <?= (int)$cap ?> 件</span>
            </th>
          <?php endforeach; ?>
        </tr>
      </thead>
      <tbody>
        <?php if (!$todayNews): ?>
          <tr><td colspan="<?= 2 + count($MEDIA_CAP) ?>" class="muted" style="text-align:center;padding:18px">
            この営業日に公開したお知らせはまだありません
          </td></tr>
        <?php endif; ?>
        <?php foreach ($todayNews as $n): ?>
          <tr>
            <td class="muted" style="white-space:nowrap"><?= h(date('H:i', strtotime($n['posted_at']))) ?></td>
            <td><?= h(mb_substr($n['title'], 0, 34)) ?></td>
            <?php foreach ($MEDIA_CAP as $mk => $_):
                $r = $mediaLog[$mk][(int)$n['id']] ?? null; ?>
              <td style="text-align:center">
                <?php if ($r === null): ?>
                  <span class="nm-wait" title="まだ送っていません">—</span>
                <?php elseif ($r['status'] === 'ok'): ?>
                  <span class="nm-ok" title="<?= h(date('H:i', strtotime($r['created']))) ?> に反映">✓</span>
                <?php else: ?>
                  <span class="nm-ng" title="<?= h((string)$r['message']) ?>">✕</span>
                <?php endif; ?>
              </td>
            <?php endforeach; ?>
          </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
  <p class="muted" style="font-size:.78rem;margin:10px 0 0;line-height:1.7">
    公開したお知らせを、媒体ごとの1日の枠数まで、公開順に自動で載せます（反映まで数分）。<br>
    <b>—</b> はまだ送っていないもの。枠を使い切ったぶんや、10時より前・前の営業日のお知らせは載りません。
    <b>✕</b> は媒体側で弾かれたときで、カーソルを合わせると理由が出ます。
  </p>
</div>
<style>
  .nm-media-tbl td,.nm-media-tbl th{vertical-align:middle}
  .nm-ok{color:#1d8a4e;font-weight:800;font-size:1.05rem}
  .nm-ng{color:#c0392b;font-weight:800;font-size:1.05rem;cursor:help}
  .nm-wait{color:#9aa7ad;font-weight:700}
</style>
<?php endif; ?>
<div class="page-head">
  <h1>お知らせ <span class="muted" style="font-size:14px">（<?= number_format($total) ?>件）</span></h1>
  <a class="btn btn-primary" href="/ctrl/news-edit.php">＋ 新規作成</a>
</div>
<form class="toolbar" method="get">
  <div class="search"><input type="text" name="q" value="<?= h($q) ?>" placeholder="タイトルで検索"></div>
  <button class="btn" type="submit">検索</button>
</form>
<div class="table-wrap">
  <table class="tbl">
    <thead><tr><th>画像</th><th>タイトル</th><th>日付</th><th>表示</th><th style="width:60px">操作</th></tr></thead>
    <tbody>
      <?php foreach ($rows as $n): ?>
        <tr>
          <td>
            <?php $tSrc = h(asset_url($n['thumb'] ?: '/img/placeholder.svg')); ?>
            <?php if ($n['thumb'] && preg_match('/\.mp4(\?|$)/i', (string)$n['thumb'])): // 紹介動画をサムネにした場合 ?>
              <video class="thumb" src="<?= $tSrc ?>" muted loop playsinline autoplay preload="metadata"></video>
            <?php else: ?>
              <img class="thumb" src="<?= $tSrc ?>" alt="">
            <?php endif; ?>
          </td>
          <td><?= h($n['title']) ?></td>
          <td class="muted"><?= h($n['posted_at'] ?: $n['created']) ?></td>
          <td><button type="button" class="toggle <?= (int)$n['is_display'] ? 'on' : '' ?>" data-toggle-id="<?= (int)$n['id'] ?>"></button></td>
          <td>
            <div class="rowmenu"><button class="rowmenu-btn" type="button">⋯</button>
              <div class="rowmenu-list">
                <a href="/ctrl/news-edit.php?id=<?= (int)$n['id'] ?>">✏️ 編集</a>
                <button type="button" class="danger" data-del-id="<?= (int)$n['id'] ?>" data-name="<?= h($n['title']) ?>">🗑 削除</button>
              </div>
            </div>
          </td>
        </tr>
      <?php endforeach; ?>
      <?php if (!$rows): ?><tr><td colspan="5" class="muted" style="text-align:center;padding:30px">お知らせがありません</td></tr><?php endif; ?>
    </tbody>
  </table>
</div>
<?= pager($total, $page, $per, 'q=' . urlencode($q) . '&') ?>
<script>window.__CSRF='<?= h(csrf_token()) ?>';window.__TABLE='news';</script>
<script src="/ctrl/list.js?v=1"></script>
<?php layout_footer(); ?>
