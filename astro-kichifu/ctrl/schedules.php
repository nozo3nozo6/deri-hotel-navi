<?php
require_once __DIR__ . '/_lib.php';
$admin = require_login();
$shop = current_shop_id();

$mode = (($_GET['mode'] ?? 'date') === 'girl') ? 'girl' : 'date';
$sort = in_array($_GET['sort'] ?? '', ['freq', 'in_date'], true) ? $_GET['sort'] : 'freq';

// 全店舗（更新先チェックボックス用。アドミ立川/吉祥寺 をまとめて更新できるように）
$allShops = db()->query('SELECT id, name, area FROM shops ORDER BY id')->fetchAll();
$shopIds  = array_map(fn($s) => (int)$s['id'], $allShops);

// 時刻ピッカー（input type=time は step が picker に効かないため独自 select）。
//   時=先頭ゼロなし表示（4, 20, 0）/ 分=15分単位（00/15/30/45）。営業は10:00〜翌5:00なので 10→23→0→9 の順。
//   $name='' なら name 属性なし（一括適用用）。値は "HH:MM"。
function time_select(string $name, ?string $val, string $key = '', string $id = ''): string {
    $ch = ($val !== null && $val !== '') ? (int)substr($val, 0, 2) : null;
    $cm = ($val !== null && $val !== '') ? (int)substr($val, 3, 2) : null;
    $hours = array_merge(range(10, 23), range(0, 9));
    $mins  = [0, 15, 30, 45];
    if ($cm !== null && !in_array($cm, $mins, true)) { $mins[] = $cm; sort($mins); } // 既存の非15分値も失わない
    $hn = $name === '' ? '' : ' name="' . h($name) . '_h[' . h($key) . ']"';
    $mn = $name === '' ? '' : ' name="' . h($name) . '_m[' . h($key) . ']"';
    $idAttr = $id === '' ? '' : ' id="' . h($id) . '"';
    $o = '<span class="tsel"' . $idAttr . '>';
    $o .= '<select class="tsel-h"' . $hn . ' aria-label="時"><option value="">--</option>';
    foreach ($hours as $hh) $o .= '<option value="' . $hh . '"' . ($ch === $hh ? ' selected' : '') . '>' . $hh . '</option>';
    $o .= '</select><span class="tsel-c">:</span><select class="tsel-m"' . $mn . ' aria-label="分"><option value="">--</option>';
    foreach ($mins as $mm) $o .= '<option value="' . $mm . '"' . ($cm === $mm ? ' selected' : '') . '>' . sprintf('%02d', $mm) . '</option>';
    return $o . '</select></span>';
}

// ============================================================ POST
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $postMode = (($_POST['mode'] ?? 'date') === 'girl') ? 'girl' : 'date';
    $up = db()->prepare('INSERT INTO schedules (shop_id, girl_id, work_date, start_time, end_time, status)
                         VALUES (:shop,:girl,:date,:start,:end,:status)
                         ON DUPLICATE KEY UPDATE start_time=VALUES(start_time), end_time=VALUES(end_time), status=VALUES(status)');
    // 掲載店舗チェック（girl_shops）— girls.shop_id ではなく多対多で判定
    $own = db()->prepare('SELECT 1 FROM girl_shops WHERE girl_id=? AND shop_id=?');
    // 時・分 select から HH:MM を組み立て（どちらか未選択なら null）
    $mkTime = function ($hh, $mm) {
        if ($hh === '' || $hh === null || $mm === '' || $mm === null) return null;
        $hh = (int)$hh; $mm = (int)$mm;
        if ($hh < 0 || $hh > 23 || $mm < 0 || $mm > 59) return null;
        return sprintf('%02d:%02d', $hh, $mm);
    };

    // 更新先店舗（チェックされた店舗すべてに保存。未選択なら現在の店舗のみ＝安全側）
    $targets = array_values(array_intersect(array_map('intval', (array)($_POST['shops'] ?? [])), $shopIds));
    if (!$targets) $targets = [$shop];
    $shopName = function ($id) use ($allShops) { foreach ($allShops as $s) if ((int)$s['id'] === (int)$id) return $s['name'] . '（' . $s['area'] . '）'; return '#' . $id; };
    $tlabel = implode('・', array_map($shopName, $targets));

    // 出勤帯 → play_availability(shift_start_at/shift_end_at) の連動（CLAUDE-SHIFT-SYNC.md + CLAUDE-SCHEDULE-API.md）。
    //   本日営業日の出勤(work)を保存したら、同一キャストの shift_start_at/shift_end_at を同じ日時に揃える。
    //   休み/未定に変更したら両方 NULL に。himewari のON/OFFに関わらず常に同期。
    //   ※ APIのGET(shift_*)は schedules から直接導出するため常に正確。このカラム同期は
    //     「updated_at を動かして bot に変更を知らせる」役割＋監査（updated_by=shift:xxx）。
    //   既存の play_availability 行がある場合のみ UPDATE（空行は作らない。行が無い子でも
    //   本日出勤があれば API GET には出る＝API側で担保）。
    //   同値なら no-op ＝ updated_at を動かさない（botの無駄な再反映を防ぐ）。play_at には触らない。
    $bizToday   = date('Y-m-d', time() - 5 * 3600);   // 営業日（朝5時区切り）
    $syncBy     = 'shift:' . ($admin['username'] ?? 'ctrl');
    $syncShift = db()->prepare(
        'UPDATE play_availability SET shift_start_at = :s1, shift_end_at = :e1, updated_by = :by
          WHERE shop_id = :shop AND girl_id = :girl
            AND (COALESCE(shift_start_at, "") <> COALESCE(:s2, "") OR COALESCE(shift_end_at, "") <> COALESCE(:e2, ""))'
    );
    // ルールA（CLAUDE-PLAY-AT-SHIFT-RULES.md）: 出勤開始を「今すぐ(play_at)」より後ろにずらしたら
    //   play_at を新しい出勤開始に合わせる。
    //   ★ 発火は「開始が実際に変わったとき」だけ（仕様のトリガ=shift_start_at の更新／やらないこと=
    //     終了だけの変更で play_at を変える）。開始据え置きの再保存でも発火させると、出勤開始前に
    //     「今すぐ」で先に宣伝している play_at（21:00出勤に20:45）を勝手に21:00へ動かしてしまう。
    //   条件: 開始が変化・active・play_at not null・play_at < 新開始。前倒しは play_at>=開始 で自然に不変。
    //   status/shift_end_at は触らない。出勤開始は5分刻みセレクト値そのまま（丸め済み＝開始より前にしない）。
    $getStart = db()->prepare('SELECT shift_start_at FROM play_availability WHERE shop_id=? AND girl_id=?');
    $alignPlay = db()->prepare(
        'UPDATE play_availability SET play_at = :start, updated_by = :by
          WHERE shop_id = :shop AND girl_id = :girl AND status = "active"
            AND play_at IS NOT NULL AND play_at < :start2'
    );
    // ルールB（同）: 出勤取消（休み/未定＝出勤帯が無くなる）で「今すぐ」もリセット。
    //   ★ syncShift（shift_* を NULL 化）より前に判定＝「出勤帯があった active 行」だけを対象にする。
    //   即姫のみ（元々 shift 両 null）の行は巻き込まない（回帰: 出勤なしで play だけの子は触らない）。
    //   reception_closed（受付終了＝出勤中のまま即ヒメ停止）も解除する: 出勤自体が無くなれば受付終了は無意味で、
    //   cleared に受付終了フラグが残ると再出勤時に「出勤したのに受付終了のまま」になるため。
    $cancelPlay = db()->prepare(
        'UPDATE play_availability SET play_at = NULL, reception_closed = 0, status = "cleared", updated_by = :by
          WHERE shop_id = :shop AND girl_id = :girl AND status = "active"
            AND (shift_start_at IS NOT NULL OR shift_end_at IS NOT NULL)'
    );
    // 出勤TIME(HH:MM[:SS]) → 実datetime（0〜9時台=翌暦日の深夜側。start<end が常に成立）
    $shiftDt = function (?string $t, string $date): ?string {
        if ($t === null || $t === '') return null;
        $h = (int)substr($t, 0, 2);
        $d = ($h >= 10) ? $date : date('Y-m-d', strtotime($date . ' +1 day'));
        return $d . ' ' . substr($t, 0, 5) . ':00';
    };

    // 本日営業日の出勤が実際に変わったキャスト → 保存後に bot へ Webhook 通知（WEBHOOK-CTRL.md）。
    //   schedules の upsert rowCount>0（insert=1/update=2、同値no-op=0）で変更判定
    //   ＝ play_availability 行が無い子（APIは schedules 直接導出で出る）も取りこぼさない。
    $webhookTargets = [];   // "sid:gid" => [sid, gid, changedFields[]]

    // 1女性×1日を、対象店舗のうち「その店に掲載中」の店だけに upsert
    $saveOne = function ($gid, $date, $stt, $s, $e) use ($targets, $own, $up, $bizToday, $syncShift, $alignPlay, $cancelPlay, $getStart, $syncBy, $shiftDt, &$webhookTargets) {
        $cnt = 0;
        foreach ($targets as $sid) {
            $own->execute([$gid, $sid]);
            if (!$own->fetchColumn()) continue; // その店に未掲載ならスキップ
            $up->execute(['shop' => $sid, 'girl' => $gid, 'date' => $date, 'start' => $s, 'end' => $e, 'status' => $stt]);
            $changed = $up->rowCount() > 0;
            $cnt++;
            // 本日営業日の保存のみ shift_start_at/shift_end_at を連動更新（work=時刻セット / 休み・未定=NULL）
            if ($date === $bizToday) {
                $startAt = ($stt === 'work') ? $shiftDt($s, $date) : null;
                $endAt   = ($stt === 'work') ? $shiftDt($e, $date) : null;
                $changedFields = [];
                // ルールA用: 変更前の出勤開始（syncShift で上書きされる前に読む）
                $oldStart = null;
                if ($stt === 'work') { $getStart->execute([$sid, $gid]); $oldStart = $getStart->fetchColumn() ?: null; }

                // ルールB は syncShift の前に判定（shift_* が NULL 化される前の「出勤帯あり」を見る）
                if ($stt !== 'work') {
                    $cancelPlay->execute([':by' => $syncBy, ':shop' => $sid, ':girl' => $gid]);
                    if ($cancelPlay->rowCount() > 0) { $changedFields[] = 'play_at'; $changedFields[] = 'status'; }
                }

                $syncShift->execute([':s1' => $startAt, ':e1' => $endAt, ':by' => $syncBy,
                                     ':shop' => $sid, ':girl' => $gid, ':s2' => $startAt, ':e2' => $endAt]);
                if ($changed) { $changedFields[] = 'shift_start_at'; $changedFields[] = 'shift_end_at'; }

                // ルールA: 出勤開始が「変わって」かつ play_at より後ろなら play_at を開始に合わせる
                if ($startAt !== null && $startAt !== $oldStart) {
                    $alignPlay->execute([':start' => $startAt, ':start2' => $startAt, ':by' => $syncBy, ':shop' => $sid, ':girl' => $gid]);
                    if ($alignPlay->rowCount() > 0) $changedFields[] = 'play_at';
                }

                if ($changedFields) $webhookTargets[$sid . ':' . $gid] = [$sid, $gid, array_values(array_unique($changedFields))];
            }
        }
        return $cnt;
    };

    // 保存完了後に本日分の変更を bot へ通知（best-effort・失敗しても保存は成功のまま）
    $notifyShiftWebhooks = function () use (&$webhookTargets) {
        if (!$webhookTargets) return;
        require_once __DIR__ . '/../api/media-webhook.php';
        $nameQ = db()->prepare('SELECT name FROM girls WHERE id=?');
        $names = [];
        foreach ($webhookTargets as [$sid, $gid, $changed]) {
            if (!isset($names[$gid])) { $nameQ->execute([$gid]); $names[$gid] = (string)$nameQ->fetchColumn(); }
            media_webhook_notify((int)$sid, (int)$gid, $names[$gid], $changed, 'shift');   // shift_* / play_at / status を含む
        }
    };

    if ($postMode === 'date') {
        // 1日 × 全女性
        $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_POST['date'] ?? '') ? $_POST['date'] : $bizToday;
        $status = (array)($_POST['status'] ?? []);
        $sh = (array)($_POST['start_h'] ?? []); $sm = (array)($_POST['start_m'] ?? []);
        $eh = (array)($_POST['end_h'] ?? []);   $em = (array)($_POST['end_m'] ?? []);
        foreach ($status as $gid => $stt) {
            $gid = (int)$gid;
            $stt = in_array($stt, ['work', 'off', 'undecided'], true) ? $stt : 'undecided';
            $s = ($stt === 'work') ? $mkTime($sh[$gid] ?? '', $sm[$gid] ?? '') : null;
            $e = ($stt === 'work') ? $mkTime($eh[$gid] ?? '', $em[$gid] ?? '') : null;
            $saveOne($gid, $date, $stt, $s, $e);
        }
        $notifyShiftWebhooks();
        flash('ok', $date . ' の出勤を保存しました（' . $tlabel . '）。');
        redirect('schedules.php?date=' . $date . '&sort=' . $sort);
    } else {
        // 1女性 × 複数日（まとめて登録）
        $gid = (int)($_POST['girl_id'] ?? 0);
        // どこかの対象店に掲載されていれば許可
        $okGirl = false;
        foreach ($targets as $sid) { $own->execute([$gid, $sid]); if ($own->fetchColumn()) { $okGirl = true; break; } }
        if (!$gid || !$okGirl) { flash('err', '対象の女性が見つかりません。'); redirect('schedules.php?mode=girl&sort=' . $sort); }
        $status = (array)($_POST['status'] ?? []); // key = 日付
        $sh = (array)($_POST['start_h'] ?? []); $sm = (array)($_POST['start_m'] ?? []);
        $eh = (array)($_POST['end_h'] ?? []);   $em = (array)($_POST['end_m'] ?? []);
        $n = 0;
        foreach ($status as $d => $stt) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$d)) continue;
            $stt = in_array($stt, ['work', 'off', 'undecided'], true) ? $stt : 'undecided';
            $s = ($stt === 'work') ? $mkTime($sh[$d] ?? '', $sm[$d] ?? '') : null;
            $e = ($stt === 'work') ? $mkTime($eh[$d] ?? '', $em[$d] ?? '') : null;
            if ($saveOne($gid, $d, $stt, $s, $e) > 0) $n++;
        }
        $notifyShiftWebhooks();
        flash('ok', $n . '日分の出勤を保存しました（' . $tlabel . '）。');
        redirect('schedules.php?mode=girl&girl_id=' . $gid . '&sort=' . $sort);
    }
}

// ============================================================ 女性一覧（girl_shops + 出勤頻度 + 並び順）
$order = ($sort === 'in_date') ? 'g.in_date DESC, g.id DESC' : 'wc DESC, g.in_date DESC, g.id DESC';
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
  .sched-sticky-save{position:sticky;bottom:0;background:#fff;padding:12px 0 2px;margin-top:14px;border-top:1px solid var(--border);display:flex;gap:16px;align-items:center;flex-wrap:wrap}
  .sched-shops{display:flex;gap:14px;align-items:center;flex-wrap:wrap;font-size:.88rem;color:var(--muted,#888)}
  .sched-shops label{display:inline-flex;gap:5px;align-items:center;color:var(--text,#333);font-weight:600;cursor:pointer}
  .sched-shops input{width:17px;height:17px;accent-color:var(--accent,#ec4899)}
  .tsel{display:inline-flex;align-items:center;gap:3px}
  .tsel select{padding:6px 4px;border:1px solid var(--border);border-radius:7px;font-size:.95rem;background:#fff}
  .tsel-c{color:var(--muted,#999);font-weight:700}
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
    // 既定は「本日営業日」（朝5時区切り）。深夜0〜4時台に暦日デフォルトだと翌営業日のページが
    // 開き、スタッフが「本日の終了時刻」のつもりで明日の行を編集する事故が起きる（2026-07-14 0:06 実例）。
    $bizNow = date('Y-m-d', time() - 5 * 3600);
    $date = $_GET['date'] ?? $bizNow;
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) $date = $bizNow;
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
      <?php if ($date === $bizNow): ?>
        <strong style="color:#0a7d4f;background:#e6f7ef;border-radius:4px;padding:2px 8px;margin-left:4px">本日（営業日）</strong>
      <?php else: ?>
        <a href="schedules.php?mode=date&sort=<?= h($sort) ?>&date=<?= h($bizNow) ?>" style="margin-left:4px">→ 本日（営業日）に戻る</a>
      <?php endif; ?>
      <span class="muted" style="display:block;font-size:.8em;margin-top:2px">※深夜0〜4時台の「本日」は前日の日付です（営業日は朝5時区切り）</span>
    </span>
    <span>
      <label>並び順</label>
      <select onchange="location.href='schedules.php?mode=date&date=<?= h($date) ?>&sort='+this.value">
        <option value="freq" <?= $sort === 'freq' ? 'selected' : '' ?>>出勤頻度が高い順</option>
        <option value="in_date" <?= $sort === 'in_date' ? 'selected' : '' ?>>入店が新しい順</option>
      </select>
    </span>
  </div>

  <form method="post" class="card card-pad">
    <?= csrf_field() ?>
    <input type="hidden" name="mode" value="date">
    <input type="hidden" name="date" value="<?= h($date) ?>">
    <div class="table-wrap" style="border:none">
      <table class="tbl">
        <thead><tr><th>女性</th><th>状態</th><th>開始</th><th>終了</th></tr></thead>
        <tbody>
          <?php foreach ($girls as $g): $cur = $map[(int)$g['id']] ?? null; $stt = $cur['status'] ?? 'undecided'; ?>
            <tr class="is-<?= $stt ?>">
              <td><strong><?= h($g['name']) ?></strong> <span class="muted">(<?= (int)$g['age'] ?>)</span></td>
              <td>
                <select name="status[<?= (int)$g['id'] ?>]" data-status onchange="this.closest('tr').className='is-'+this.value">
                  <option value="undecided" <?= $stt === 'undecided' ? 'selected' : '' ?>>未定</option>
                  <option value="work" <?= $stt === 'work' ? 'selected' : '' ?>>出勤</option>
                  <option value="off" <?= $stt === 'off' ? 'selected' : '' ?>>休み</option>
                </select>
              </td>
              <td><?= time_select('start', ($cur['start_time'] ?? null) ? substr($cur['start_time'], 0, 5) : null, (string)(int)$g['id']) ?></td>
              <td><?= time_select('end', ($cur['end_time'] ?? null) ? substr($cur['end_time'], 0, 5) : null, (string)(int)$g['id']) ?></td>
            </tr>
          <?php endforeach; ?>
          <?php if (!$girls): ?><tr><td colspan="4" class="muted" style="text-align:center;padding:30px">この店舗に掲載中の女性がいません</td></tr><?php endif; ?>
        </tbody>
      </table>
    </div>
    <div class="sched-sticky-save">
      <div class="sched-shops">更新する店舗:
        <?php foreach ($allShops as $s): ?>
          <label><input type="checkbox" name="shops[]" value="<?= (int)$s['id'] ?>" checked> <?= h($s['name']) ?>（<?= h($s['area']) ?>）</label>
        <?php endforeach; ?>
      </div>
      <button class="btn btn-primary" type="submit">この日の出勤を保存</button>
    </div>
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
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['from'] ?? '') ? $_GET['from'] : date('Y-m-d', time() - 5 * 3600);   // 本日営業日起点（5時区切り）
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
            <?= h($g['name']) ?> (<?= (int)$g['age'] ?>)
          </option>
        <?php endforeach; ?>
      </select>
    </span>
    <span>
      <label>並び順</label>
      <select onchange="location.href='schedules.php?mode=girl&sort='+this.value">
        <option value="freq" <?= $sort === 'freq' ? 'selected' : '' ?>>出勤頻度が高い順</option>
        <option value="in_date" <?= $sort === 'in_date' ? 'selected' : '' ?>>入店が新しい順</option>
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
        <?= time_select('', null, '', 'bulkStart') ?> 〜 <?= time_select('', null, '', 'bulkEnd') ?>
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
              <td><?= time_select('start', ($r['start_time'] ?? null) ? substr($r['start_time'], 0, 5) : null, $d) ?></td>
              <td><?= time_select('end', ($r['end_time'] ?? null) ? substr($r['end_time'], 0, 5) : null, $d) ?></td>
            </tr>
          <?php endforeach; ?>
        </tbody>
      </table>
    </div>
    <div class="sched-sticky-save">
      <div class="sched-shops">更新する店舗:
        <?php foreach ($allShops as $s): ?>
          <label><input type="checkbox" name="shops[]" value="<?= (int)$s['id'] ?>" checked> <?= h($s['name']) ?>（<?= h($s['area']) ?>）</label>
        <?php endforeach; ?>
      </div>
      <button class="btn btn-primary" type="submit"><?= h($cur['name']) ?> の出勤を保存</button>
    </div>
  </form>
  <script>
  (function () {
    var f = document.getElementById('girlForm');
    function rows() { return f.querySelectorAll('tbody tr'); }
    document.getElementById('applyStatus').addEventListener('click', function () {
      var v = document.getElementById('bulkStatus').value;
      rows().forEach(function (tr) { var s = tr.querySelector('[data-status]'); s.value = v; tr.className = 'is-' + v; });
    });
    function getT(el) { return { h: el.querySelector('.tsel-h').value, m: el.querySelector('.tsel-m').value }; }
    function setT(el, t) { if (t.h !== '') el.querySelector('.tsel-h').value = t.h; if (t.m !== '') el.querySelector('.tsel-m').value = t.m; }
    document.getElementById('applyTime').addEventListener('click', function () {
      var bs = getT(document.getElementById('bulkStart')), be = getT(document.getElementById('bulkEnd'));
      rows().forEach(function (tr) {
        if (tr.querySelector('[data-status]').value !== 'work') return;
        var ts = tr.querySelectorAll('.tsel');
        setT(ts[0], bs); setT(ts[1], be);
      });
    });
  })();
  </script>
  <?php endif; ?>
<?php endif; ?>

<script>
(function () {
  // ① 時(左)を選んだら、分(右)が未選択のとき自動で「00」にする（全ピッカー＝行＋一括時間）。
  document.querySelectorAll('.tsel').forEach(function (cell) {
    var h = cell.querySelector('.tsel-h'), m = cell.querySelector('.tsel-m');
    if (h && m) h.addEventListener('change', function () {
      if (h.value !== '' && m.value === '') m.value = '0';   // 分の「00」は option value="0"
    });
  });
  // ② 開始/終了の時間を「--」以外にしたら、その行を自動で「出勤」にする（両モード共通）。
  //    状態を未定のまま時間だけ入れて保存→未定で保存される事故を防ぐ。
  document.querySelectorAll('table.tbl tbody tr').forEach(function (tr) {
    var st = tr.querySelector('[data-status]');
    if (!st) return;
    tr.querySelectorAll('.tsel-h, .tsel-m').forEach(function (sel) {
      sel.addEventListener('change', function () {
        if (sel.value !== '' && st.value !== 'work') {
          st.value = 'work';
          tr.className = 'is-work';
        }
      });
    });
  });
  // ③ 保存時チェック：「出勤」の行で開始・終了どちらかが「--」なら保存を中止して注意。
  document.querySelectorAll('form').forEach(function (form) {
    if (!form.querySelector('[data-status]')) return;
    form.addEventListener('submit', function (e) {
      var bad = 0, first = null;
      form.querySelectorAll('.tsel-h, .tsel-m').forEach(function (s) { s.style.outline = ''; });
      form.querySelectorAll('tbody tr').forEach(function (tr) {
        var st = tr.querySelector('[data-status]');
        if (!st || st.value !== 'work') return;
        tr.querySelectorAll('.tsel-h, .tsel-m').forEach(function (sel) {
          if (sel.value === '') { sel.style.outline = '2px solid #e11d48'; bad++; if (!first) first = sel; }
        });
      });
      if (bad) {
        e.preventDefault();
        alert('「出勤」の行で開始・終了の時間が未入力（--）の箇所があります。\n赤枠の時間を選んでから保存してください。');
        if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  });
})();
</script>
<?php layout_footer(); ?>
