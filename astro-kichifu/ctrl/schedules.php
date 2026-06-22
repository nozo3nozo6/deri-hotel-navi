<?php
require_once __DIR__ . '/_lib.php';
require_login();
$shop = current_shop_id();

$date = $_GET['date'] ?? date('Y-m-d');
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) $date = date('Y-m-d');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_POST['date'] ?? '') ? $_POST['date'] : date('Y-m-d');
    $status = (array)($_POST['status'] ?? []);
    $start  = (array)($_POST['start'] ?? []);
    $end    = (array)($_POST['end'] ?? []);
    $up = db()->prepare('INSERT INTO schedules (shop_id, girl_id, work_date, start_time, end_time, status)
                         VALUES (:shop,:girl,:date,:start,:end,:status)
                         ON DUPLICATE KEY UPDATE start_time=VALUES(start_time), end_time=VALUES(end_time), status=VALUES(status)');
    foreach ($status as $gid => $stt) {
        $gid = (int)$gid;
        $stt = in_array($stt, ['work', 'off', 'undecided'], true) ? $stt : 'undecided';
        $own = db()->prepare('SELECT 1 FROM girls WHERE id=? AND shop_id=?'); $own->execute([$gid, $shop]);
        if (!$own->fetchColumn()) continue;
        $s = ($stt === 'work' && !empty($start[$gid])) ? $start[$gid] : null;
        $e = ($stt === 'work' && !empty($end[$gid])) ? $end[$gid] : null;
        $up->execute(['shop' => $shop, 'girl' => $gid, 'date' => $date, 'start' => $s, 'end' => $e, 'status' => $stt]);
    }
    flash('ok', $date . ' の出勤を保存しました。');
    redirect('schedules.php?date=' . $date);
}

$girls = db()->prepare('SELECT id, name, age FROM girls WHERE shop_id=? AND is_display=1 ORDER BY sort, id');
$girls->execute([$shop]);
$girls = $girls->fetchAll();

$sc = db()->prepare('SELECT girl_id, start_time, end_time, status FROM schedules WHERE shop_id=? AND work_date=?');
$sc->execute([$shop, $date]);
$map = [];
foreach ($sc->fetchAll() as $r) $map[(int)$r['girl_id']] = $r;

layout_header('出勤管理', 'schedules.php');
?>
<div class="page-head">
  <h1>出勤管理</h1>
  <form method="get"><input type="date" name="date" value="<?= h($date) ?>" onchange="this.form.submit()" style="padding:8px 10px;border:1px solid var(--border);border-radius:9px"></form>
</div>

<form method="post" class="card card-pad">
  <?= csrf_field() ?>
  <input type="hidden" name="date" value="<?= h($date) ?>">
  <div class="table-wrap" style="border:none">
    <table class="tbl">
      <thead><tr><th>女性</th><th>状態</th><th>開始</th><th>終了</th></tr></thead>
      <tbody>
        <?php foreach ($girls as $g): $cur = $map[(int)$g['id']] ?? null; $stt = $cur['status'] ?? 'undecided'; ?>
          <tr>
            <td><strong><?= h($g['name']) ?></strong> <span class="muted">(<?= (int)$g['age'] ?>)</span></td>
            <td>
              <select name="status[<?= (int)$g['id'] ?>]" data-status>
                <option value="undecided" <?= $stt === 'undecided' ? 'selected' : '' ?>>未定</option>
                <option value="work" <?= $stt === 'work' ? 'selected' : '' ?>>出勤</option>
                <option value="off" <?= $stt === 'off' ? 'selected' : '' ?>>休み</option>
              </select>
            </td>
            <td><input type="time" name="start[<?= (int)$g['id'] ?>]" value="<?= h($cur['start_time'] ? substr($cur['start_time'], 0, 5) : '') ?>"></td>
            <td><input type="time" name="end[<?= (int)$g['id'] ?>]" value="<?= h($cur['end_time'] ? substr($cur['end_time'], 0, 5) : '') ?>"></td>
          </tr>
        <?php endforeach; ?>
        <?php if (!$girls): ?><tr><td colspan="4" class="muted" style="text-align:center;padding:30px">表示中の女性がいません</td></tr><?php endif; ?>
      </tbody>
    </table>
  </div>
  <div class="form-actions" style="margin-top:16px"><button class="btn btn-primary" type="submit">この日の出勤を保存</button></div>
</form>
<?php layout_footer(); ?>
