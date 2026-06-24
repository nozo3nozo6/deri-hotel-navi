<?php
require_once __DIR__ . '/_lib.php';
require_login();
$shop = current_shop_id();

$mode = (($_GET['mode'] ?? 'date') === 'girl') ? 'girl' : 'date';
$sort = in_array($_GET['sort'] ?? '', ['freq', 'in_date'], true) ? $_GET['sort'] : 'freq';

// ============================================================ POST
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $postMode = (($_POST['mode'] ?? 'date') === 'girl') ? 'girl' : 'date';
    $up = db()->prepare('INSERT INTO schedules (shop_id, girl_id, work_date, start_time, end_time, status)
                         VALUES (:shop,:girl,:date,:start,:end,:status)
                         ON DUPLICATE KEY UPDATE start_time=VALUES(start_time), end_time=VALUES(end_time), status=VALUES(status)');
    // 掲載店舗チェック（girl_shops）— girls.shop_id ではなく多対多で判定
    $own = db()->prepare('SELECT 1 FROM girl_shops WHERE girl_id=? AND shop_id=?');
    $clean = function ($t) { return preg_match('/^\d{2}:\d{2}$/', (string)$t) ? $t : null; };

    if ($postMode === 'date') {
        // 1日 × 全女性
        $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_POST['date'] ?? '') ? $_POST['date'] : date('Y-m-d');
        $status = (array)($_POST['status'] ?? []);
        $start  = (array)($_POST['start'] ?? []);
        $end    = (array)($_POST['end'] ?? []);
        foreach ($status as $gid => $stt) {
            $gid = (int)$gid;
            $stt = in_array($stt, ['work', 'off', 'undecided'], true) ? $stt : 'undecided';
            $own->execute([$gid, $shop]);
            if (!$own->fetchColumn()) continue;
            $s = ($stt === 'work') ? $clean($start[$gid] ?? null) : null;
            $e = ($stt === 'work') ? $clean($end[$gid] ?? null) : null;
            $up->execute(['shop' => $shop, 'girl' => $gid, 'date' => $date, 'start' => $s, 'end' => $e, 'status' => $stt]);
        }
        flash('ok', $date . ' の出勤を保存しました。');
        redirect('schedules.php?date=' . $date . '&sort=' . $sort);
    } else {
        // 1女性 × 複数日（まとめて登録）
        $gid = (int)($_POST['girl_id'] ?? 0);
        $own->execute([$gid, $shop]);
        if (!$gid || !$own->fetchColumn()) { flash('err', '対象の女性が見つかりません。'); redirect('schedules.php?mode=girl&sort=' . $sort); }
        $status = (array)($_POST['status'] ?? []); // key = 日付
        $start  = (array)($_POST['start'] ?? []);
        $end    = (array)($_POST['end'] ?? []);
        $n = 0;
        foreach ($status as $d => $stt) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$d)) continue;
            $stt = in_array($stt, ['work', 'off', 'undecided'], true) ? $stt : 'undecided';
            $s = ($stt === 'work') ? $clean($start[$d] ?? null) : null;
            $e = ($stt === 'work') ? $clean($end[$d] ?? null) : null;
            $up->execute(['shop' => $shop, 'girl' => $gid, 'date' => $d, 'start' => $s, 'end' => $e, 'status' => $stt]);
            $n++;
        }
        flash('ok', $n . '日分の出勤を保存しました。');
        redirect('schedules.php?mode=girl&girl_id=' . $gid . '&sort=' . $sort);
    }
}

// ============================================================ 女性一覧（girl_shops + 出勤頻度 + 並び順）
$order = ($sort === 'in_date') ? 'g.in_date ASC, g.id' : 'wc DESC, g.in_date ASC, g.id';
$gq = db()->prepare(
    'SELECT g.id, g.name, g.age, g.in_date,
            (SELECT COUNT(*) FROM schedules s WHERE s.girl_id = g.id AND s.shop_id = :shop AND s.status = \'work\') AS wc
       FROM girls g
       JOIN girl_shops gs ON gs.girl_id = g.id AND gs.shop_id = :shop2
      ORDER BY ' . $order
);
$gq->execute(['shop' => $shop, 'shop2' => $shop]);
$girls = $gq->fetchAll();

$WD = ['日', '月', '火', '水', '木', '金', '土'];
$sortLabel = $sort === 'in_date' ? '入店順' : '出勤頻度順';

layout_header('出勤管理', 'schedules.php');
?>
<style>
  .sched-tabs{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
  .sched-tab{padding:8px 16px;border:1px solid var(--border);border-radius:9px;background:#fff;color:var(--text,#333);text-decoration:none;font-size:.9rem;font-weight:600}
  .sched-tab.is-active{background:var(--accent,#ec4899);border-color:var(--accent,#ec4899);color:#fff}
  .sched-toolbar{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
  .sched-toolbar label{font-size:.85rem;color:var(--muted,#888)}
  .sched-toolbar select,.sched-toolbar input[type=date],.sched-toolbar input[type=time]{padding:7px 9px;border:1px solid var(--border);border-radius:8px}
  .sched-bulk{background:var(--bg-1,#faf7fb);border:1px dashed var(--border);border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  .sched-bulk .grp{display:flex;gap:6px;align-items:center;font-size:.85rem}
  .sched-bulk .btn-mini{padding:6px 12px;font-size:.8rem;border:1px solid var(--accent,#ec4899);color:var(--accent,#ec4899);background:#fff;border-radius:8px;cursor:pointer;font-weight:600}
  .tbl tr.is-off td,.tbl tr.is-undecided td{opacity:.55}
  .day-sat{color:#2563eb}.day-sun{color:#dc2626}
  .sched-sticky-save{position:sticky;bottom:0;background:#fff;padding:12px 0 2px;margin-top:14px;border-top:1px solid var(--border)}
</style>

<div class="page-head">
  <h1>出勤管理</h1>
</div>

<div class="sched-tabs">
  <a class="sched-tab <?= $mode === 'date' ? 'is-active' : '' ?>" href="schedules.php?mode=date&sort=<?= h($sort) ?>">📅 日付で登録</a>
  <a class="sched-tab <?= $mode === 'girl' ? 'is-active' : '' ?>" href="schedules.php?mode=girl&sort=<?= h($sort) ?>">👤 女性別まとめ登録</a>
</div>

<?php if ($mode === 'date'): ?>
<?php
    $date = $_GET['date'] ?? date('Y-m-d');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) $date = date('Y-m-d');
    $sc = db()->prepare('SELECT girl_id, start_time, end_time, status FROM schedules WHERE shop_id=? AND work_date=?');
    $sc->execute([$shop, $date]);
    $map = [];
    foreach ($sc->fetchAll() as $r) $map[(int)$r['girl_id']] = $r;
    $wdi = (int)date('w', strtotime($date));
?>
  <div class="sched-toolbar">
    <span>
      <label>日付</label>
      <input type="date" value="<?= h($date) ?>" onchange="location.href='schedules.php?mode=date&sort=<?= h($sort) ?>&date='+this.value">
      <strong class="<?= $wdi === 6 ? 'day-sat' : ($wdi === 0 ? 'day-sun' : '') ?>">（<?= $WD[$wdi] ?>）</strong>
    </span>
    <span>
      <label>並び順</label>
      <select onchange="location.href='schedules.php?mode=date&date=<?= h($date) ?>&sort='+this.value">
        <option value="freq" <?= $sort === 'freq' ? 'selected' : '' ?>>出勤頻度が高い順</option>
        <option value="in_date" <?= $sort === 'in_date' ? 'selected' : '' ?>>入店順</option>
      </select>
    </span>
  </div>

  <form method="post" class="card card-pad">
    <?= csrf_field() ?>
    <input type="hidden" name="mode" value="date">
    <input type="hidden" name="date" value="<?= h($date) ?>">
    <div class="table-wrap" style="border:none">
      <table class="tbl">
        <thead><tr><th>女性</th><th>出勤<?= h($sortLabel === '出勤頻度順' ? '回数' : '') ?></th><th>状態</th><th>開始</th><th>終了</th></tr></thead>
        <tbody>
          <?php foreach ($girls as $g): $cur = $map[(int)$g['id']] ?? null; $stt = $cur['status'] ?? 'undecided'; ?>
            <tr class="is-<?= $stt ?>">
              <td><strong><?= h($g['name']) ?></strong> <span class="muted">(<?= (int)$g['age'] ?>)</span></td>
              <td class="muted" style="font-size:.85rem"><?= (int)$g['wc'] ?>回</td>
              <td>
                <select name="status[<?= (int)$g['id'] ?>]" data-status onchange="this.closest('tr').className='is-'+this.value">
                  <option value="undecided" <?= $stt === 'undecided' ? 'selected' : '' ?>>未定</option>
                  <option value="work" <?= $stt === 'work' ? 'selected' : '' ?>>出勤</option>
                  <option value="off" <?= $stt === 'off' ? 'selected' : '' ?>>休み</option>
                </select>
              </td>
              <td><input type="time" name="start[<?= (int)$g['id'] ?>]" value="<?= h($cur['start_time'] ? substr($cur['start_time'], 0, 5) : '') ?>"></td>
              <td><input type="time" name="end[<?= (int)$g['id'] ?>]" value="<?= h($cur['end_time'] ? substr($cur['end_time'], 0, 5) : '') ?>"></td>
            </tr>
          <?php endforeach; ?>
          <?php if (!$girls): ?><tr><td colspan="5" class="muted" style="text-align:center;padding:30px">この店舗に掲載中の女性がいません</td></tr><?php endif; ?>
        </tbody>
      </table>
    </div>
    <div class="sched-sticky-save"><button class="btn btn-primary" type="submit">この日の出勤を保存</button></div>
  </form>

<?php else: /* ===================== 女性別まとめ登録 ===================== */ ?>
<?php
    $gid = (int)($_GET['girl_id'] ?? 0);
    $validIds = array_map(fn($g) => (int)$g['id'], $girls);
    if (!in_array($gid, $validIds, true)) $gid = $validIds[0] ?? 0;
    $cur = null;
    foreach ($girls as $g) if ((int)$g['id'] === $gid) { $cur = $g; break; }

    // 期間: 今日から28日（4週間）
    $DAYS = 28;
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['from'] ?? '') ? $_GET['from'] : date('Y-m-d');
    $baseTs = strtotime($from);
    $dates = [];
    for ($i = 0; $i < $DAYS; $i++) $dates[] = date('Y-m-d', $baseTs + $i * 86400);

    $map = [];
    if ($gid) {
        $sc = db()->prepare('SELECT work_date, start_time, end_time, status FROM schedules WHERE shop_id=? AND girl_id=? AND work_date BETWEEN ? AND ?');
        $sc->execute([$shop, $gid, $dates[0], end($dates)]);
        foreach ($sc->fetchAll() as $r) $map[$r['work_date']] = $r;
    }
?>
  <div class="sched-toolbar">
    <span>
      <label>女性</label>
      <select onchange="location.href='schedules.php?mode=girl&sort=<?= h($sort) ?>&girl_id='+this.value">
        <?php foreach ($girls as $g): ?>
          <option value="<?= (int)$g['id'] ?>" <?= (int)$g['id'] === $gid ? 'selected' : '' ?>>
            <?= h($g['name']) ?> (<?= (int)$g['age'] ?>)<?= $sort === 'freq' ? '　出勤' . (int)$g['wc'] . '回' : '　入店' . h($g['in_date']) ?>
          </option>
        <?php endforeach; ?>
      </select>
    </span>
    <span>
      <label>並び順</label>
      <select onchange="location.href='schedules.php?mode=girl&girl_id=<?= $gid ?>&sort='+this.value">
        <option value="freq" <?= $sort === 'freq' ? 'selected' : '' ?>>出勤頻度が高い順</option>
        <option value="in_date" <?= $sort === 'in_date' ? 'selected' : '' ?>>入店順</option>
      </select>
    </span>
    <span>
      <label>開始日</label>
      <input type="date" value="<?= h($from) ?>" onchange="location.href='schedules.php?mode=girl&sort=<?= h($sort) ?>&girl_id=<?= $gid ?>&from='+this.value">
    </span>
  </div>

  <?php if (!$gid): ?>
    <div class="card card-pad muted" style="text-align:center;padding:30px">この店舗に掲載中の女性がいません</div>
  <?php else: ?>
  <form method="post" class="card card-pad" id="girlForm">
    <?= csrf_field() ?>
    <input type="hidden" name="mode" value="girl">
    <input type="hidden" name="girl_id" value="<?= $gid ?>">

    <div class="sched-bulk">
      <strong style="font-size:.9rem"><?= h($cur['name']) ?> の <?= $DAYS ?>日分をまとめて登録</strong>
      <span class="grp">一括状態
        <select id="bulkStatus">
          <option value="work">出勤</option><option value="off">休み</option><option value="undecided">未定</option>
        </select>
        <button type="button" class="btn-mini" id="applyStatus">全日に適用</button>
      </span>
      <span class="grp">一括時間
        <input type="time" id="bulkStart"> 〜 <input type="time" id="bulkEnd">
        <button type="button" class="btn-mini" id="applyTime">出勤日に適用</button>
      </span>
    </div>

    <div class="table-wrap" style="border:none">
      <table class="tbl">
        <thead><tr><th>日付</th><th>状態</th><th>開始</th><th>終了</th></tr></thead>
        <tbody>
          <?php foreach ($dates as $d): $r = $map[$d] ?? null; $stt = $r['status'] ?? 'undecided'; $wdi = (int)date('w', strtotime($d)); ?>
            <tr class="is-<?= $stt ?>">
              <td class="<?= $wdi === 6 ? 'day-sat' : ($wdi === 0 ? 'day-sun' : '') ?>">
                <strong><?= (int)substr($d, 5, 2) ?>/<?= (int)substr($d, 8, 2) ?></strong>（<?= $WD[$wdi] ?>）
              </td>
              <td>
                <select name="status[<?= h($d) ?>]" data-status onchange="this.closest('tr').className='is-'+this.value">
                  <option value="undecided" <?= $stt === 'undecided' ? 'selected' : '' ?>>未定</option>
                  <option value="work" <?= $stt === 'work' ? 'selected' : '' ?>>出勤</option>
                  <option value="off" <?= $stt === 'off' ? 'selected' : '' ?>>休み</option>
                </select>
              </td>
              <td><input type="time" name="start[<?= h($d) ?>]" value="<?= h($r['start_time'] ? substr($r['start_time'], 0, 5) : '') ?>"></td>
              <td><input type="time" name="end[<?= h($d) ?>]" value="<?= h($r['end_time'] ? substr($r['end_time'], 0, 5) : '') ?>"></td>
            </tr>
          <?php endforeach; ?>
        </tbody>
      </table>
    </div>
    <div class="sched-sticky-save"><button class="btn btn-primary" type="submit"><?= h($cur['name']) ?> の出勤を保存</button></div>
  </form>
  <script>
  (function () {
    var f = document.getElementById('girlForm');
    function rows() { return f.querySelectorAll('tbody tr'); }
    document.getElementById('applyStatus').addEventListener('click', function () {
      var v = document.getElementById('bulkStatus').value;
      rows().forEach(function (tr) { var s = tr.querySelector('[data-status]'); s.value = v; tr.className = 'is-' + v; });
    });
    document.getElementById('applyTime').addEventListener('click', function () {
      var st = document.getElementById('bulkStart').value, en = document.getElementById('bulkEnd').value;
      rows().forEach(function (tr) {
        if (tr.querySelector('[data-status]').value !== 'work') return;
        var ins = tr.querySelectorAll('input[type=time]');
        if (st) ins[0].value = st;
        if (en) ins[1].value = en;
      });
    });
  })();
  </script>
  <?php endif; ?>
<?php endif; ?>
<?php layout_footer(); ?>
