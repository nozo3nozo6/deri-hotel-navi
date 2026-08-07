<?php
require_once __DIR__ . '/_lib.php';
$admin = require_login();
$shop = current_shop_id();

// 出勤の状態。
//   work      … 通常の出勤（サイト・媒体に出る）
//   ops_only  … 出勤するが【どこにも公開しない】。オペレーションのタイムラインにだけ出す。
//               身内バレ・ストーカー対策で「サイトに載せずに働く」ケース用。
//               公開API(api/schedules.php, api/schedule-range.php)は未定に丸めて時刻も返さない。
//   off       … 休み / undecided … 未定
const SCHEDULE_STATUSES = ['work', 'ops_only', 'off', 'undecided'];
const SCHEDULE_STATUS_LABELS = ['undecided' => '未定', 'work' => '出勤', 'ops_only' => 'OPSのみ', 'off' => '休み'];

/** 時刻を持つ状態か（出勤・OPSのみ は時刻あり、休み・未定は時刻なし） */
function schedule_status_has_time(string $status): bool {
    return $status === 'work' || $status === 'ops_only';
}

// 終了時刻の意味（店長指定 2026-08-07）。内勤が受付するときの判断材料。
//   accept … 受：その時刻までの注文に対応する（＝受付の締め）
//   finish … 完：その時刻に完全に終了して帰宅できるようにする
// 公開サイト・媒体には出さない（OPS のタイムラインと CTRL の出勤管理でのみ見える）。
const SCHEDULE_END_TYPES = ['accept', 'finish'];
const SCHEDULE_END_TYPE_LABELS = ['accept' => '受', 'finish' => '完'];

/** 受/完 のセレクト。$name='' なら name 属性なし（一括適用用） */
function end_type_select(string $name, ?string $val, string $key = '', string $id = ''): string {
    $cur = in_array($val, SCHEDULE_END_TYPES, true) ? $val : 'accept';
    $nm = $name === '' ? '' : ' name="' . h($name) . '[' . h($key) . ']"';
    $idAttr = $id === '' ? '' : ' id="' . h($id) . '"';
    $o = '<select class="etsel"' . $nm . $idAttr . ' aria-label="終了の意味">';
    foreach (SCHEDULE_END_TYPE_LABELS as $v => $lb) {
        $o .= '<option value="' . $v . '"' . ($cur === $v ? ' selected' : '') . '>' . $lb . '</option>';
    }
    return $o . '</select>';
}

// date … 1日×全女性で登録 / girl … 1女性×28日で登録 / grid … 10日先までの一覧（見るだけ）
$mode = in_array($_GET['mode'] ?? 'date', ['girl', 'grid'], true) ? $_GET['mode'] : 'date';
// freq … 通算の出勤回数が多い順 / in_date … 入店が新しい順 / range … 表示中10日の出勤が多い順（一覧のみ）
$sort = in_array($_GET['sort'] ?? '', ['freq', 'in_date', 'range'], true) ? $_GET['sort'] : 'freq';
if ($sort === 'range' && $mode !== 'grid') $sort = 'freq';   // 登録タブには期間の概念が無い
if ($mode === 'grid' && !isset($_GET['sort'])) $sort = 'range';   // 一覧の既定は「この10日」

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
    // date … 1日×全女性 / girl … 1女性×28日 / cell … 一覧のマス目1つ（JSON応答）
    $postMode = in_array($_POST['mode'] ?? 'date', ['girl', 'cell'], true) ? $_POST['mode'] : 'date';
    $up = db()->prepare('INSERT INTO schedules (shop_id, girl_id, work_date, start_time, end_time, end_type, status)
                         VALUES (:shop,:girl,:date,:start,:end,:endtype,:status)
                         ON DUPLICATE KEY UPDATE start_time=VALUES(start_time), end_time=VALUES(end_time), end_type=VALUES(end_type), status=VALUES(status)');
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
          WHERE shop_id = :shop AND girl_id = :girl AND shift_business_date = :bd
            AND (COALESCE(shift_start_at, "") <> COALESCE(:s2, "") OR COALESCE(shift_end_at, "") <> COALESCE(:e2, ""))'
    );
    // ルールA（CLAUDE-PLAY-AT-SHIFT-RULES.md）: 出勤開始を「今すぐ(play_at)」より後ろにずらしたら
    //   play_at を新しい出勤開始に合わせる。
    //   ★ 発火は「開始が実際に変わったとき」だけ（仕様のトリガ=shift_start_at の更新／やらないこと=
    //     終了だけの変更で play_at を変える）。開始据え置きの再保存でも発火させると、出勤開始前に
    //     「今すぐ」で先に宣伝している play_at（21:00出勤に20:45）を勝手に21:00へ動かしてしまう。
    //   条件: 開始が変化・active・play_at not null・play_at < 新開始。前倒しは play_at>=開始 で自然に不変。
    //   status/shift_end_at は触らない。出勤開始は5分刻みセレクト値そのまま（丸め済み＝開始より前にしない）。
    $getStart = db()->prepare('SELECT shift_start_at FROM play_availability WHERE shop_id=? AND girl_id=? AND shift_business_date=?');
    $alignPlay = db()->prepare(
        'UPDATE play_availability SET play_at = :start, updated_by = :by
          WHERE shop_id = :shop AND girl_id = :girl AND shift_business_date = :bd AND status = "active"
            AND play_at IS NOT NULL AND play_at < :start2'
    );
    // ルールB（同）: 出勤取消（休み/未定＝出勤帯が無くなる）で「今すぐ」もリセット。
    //   ★ syncShift（shift_* を NULL 化）より前に判定＝「出勤帯があった active 行」だけを対象にする。
    //   即姫のみ（元々 shift 両 null）の行は巻き込まない（回帰: 出勤なしで play だけの子は触らない）。
    //   reception_closed（受付終了＝出勤中のまま即ヒメ停止）も解除する: 出勤自体が無くなれば受付終了は無意味で、
    //   cleared に受付終了フラグが残ると再出勤時に「出勤したのに受付終了のまま」になるため。
    $cancelPlay = db()->prepare(
        'UPDATE play_availability SET play_at = NULL, reception_closed = 0, status = "cleared", updated_by = :by
          WHERE shop_id = :shop AND girl_id = :girl AND shift_business_date = :bd AND status = "active"
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
    $webhookTargets = [];   // "sid:gid" => [sid, gid, changedFields[]]（当日D＝即姫/出勤の即時同期用）
    $weekTargets = [];      // "sid:gid" => [sid, gid]（未来日 D+1〜 の変更＝媒体の週間出勤同期用）

    // 1女性×1日を、対象店舗のうち「その店に掲載中」の店だけに upsert
    $saveOne = function ($gid, $date, $stt, $s, $e, $et = 'accept') use ($targets, $own, $up, $bizToday, $syncShift, $alignPlay, $cancelPlay, $getStart, $syncBy, $shiftDt, &$webhookTargets, &$weekTargets) {
        $et = in_array($et, SCHEDULE_END_TYPES, true) ? $et : 'accept';
        $cnt = 0;
        foreach ($targets as $sid) {
            $own->execute([$gid, $sid]);
            if (!$own->fetchColumn()) continue; // その店に未掲載ならスキップ
            $up->execute(['shop' => $sid, 'girl' => $gid, 'date' => $date, 'start' => $s, 'end' => $e, 'endtype' => $et, 'status' => $stt]);
            $changed = $up->rowCount() > 0;
            $cnt++;
            // play_availability はその営業日(=work_date)の行と連動（work=時刻セット / 休み・未定=NULL）。
            //   ※ 案A（営業日ごとに1行）になったので本日に限らず保存した営業日の行を同期できる。
            //     行が無ければ何も起きない（空行は作らない）。Webhook は本日(D)の変更時のみ送る
            //     ＝明日(D+1)の仕込みは bot が無視するため（朝5:01の rollover が D 昇格後に同期）。
            {
                $startAt = ($stt === 'work') ? $shiftDt($s, $date) : null;
                $endAt   = ($stt === 'work') ? $shiftDt($e, $date) : null;
                $changedFields = [];
                // ルールA用: 変更前の出勤開始（syncShift で上書きされる前に読む）
                $oldStart = null;
                if ($stt === 'work') { $getStart->execute([$sid, $gid, $date]); $oldStart = $getStart->fetchColumn() ?: null; }

                // ルールB は syncShift の前に判定（shift_* が NULL 化される前の「出勤帯あり」を見る）
                if ($stt !== 'work') {
                    $cancelPlay->execute([':by' => $syncBy, ':shop' => $sid, ':girl' => $gid, ':bd' => $date]);
                    if ($cancelPlay->rowCount() > 0) { $changedFields[] = 'play_at'; $changedFields[] = 'status'; }
                }

                $syncShift->execute([':s1' => $startAt, ':e1' => $endAt, ':by' => $syncBy,
                                     ':shop' => $sid, ':girl' => $gid, ':bd' => $date, ':s2' => $startAt, ':e2' => $endAt]);
                if ($changed) { $changedFields[] = 'shift_start_at'; $changedFields[] = 'shift_end_at'; }

                // ルールA: 出勤開始が「変わって」かつ play_at より後ろなら play_at を開始に合わせる
                if ($startAt !== null && $startAt !== $oldStart) {
                    $alignPlay->execute([':start' => $startAt, ':start2' => $startAt, ':by' => $syncBy, ':shop' => $sid, ':girl' => $gid, ':bd' => $date]);
                    if ($alignPlay->rowCount() > 0) $changedFields[] = 'play_at';
                }

                if ($changedFields && $date === $bizToday) $webhookTargets[$sid . ':' . $gid] = [$sid, $gid, array_values(array_unique($changedFields))];
                // 未来日（D+1〜）の出勤行が変わったら媒体の週間出勤同期（fujoho_schedule_week）を起動。
                //   当日Dは上の即姫/出勤Webhookが担当。週間jobは D+1〜D+cap を各媒体の最大日数ぶん反映。
                if ($changed && $date > $bizToday) $weekTargets[$sid . ':' . $gid] = [$sid, $gid];
            }
        }
        return $cnt;
    };

    // 保存完了後に本日分の変更を bot へ通知（best-effort・失敗しても保存は成功のまま）
    $notifyShiftWebhooks = function () use (&$webhookTargets, &$weekTargets) {
        if (!$webhookTargets && !$weekTargets) return;
        require_once __DIR__ . '/../api/media-webhook.php';
        $nameQ = db()->prepare('SELECT name FROM girls WHERE id=?');
        $names = [];
        $nm = function ($gid) use (&$names, $nameQ) {
            if (!isset($names[$gid])) { $nameQ->execute([$gid]); $names[$gid] = (string)$nameQ->fetchColumn(); }
            return $names[$gid];
        };
        foreach ($webhookTargets as [$sid, $gid, $changed]) {
            media_webhook_notify((int)$sid, (int)$gid, $nm($gid), $changed, 'shift');   // 当日: shift_* / play_at / status
        }
        // 未来日変更 → 各媒体の週間出勤同期を明示ジョブで起動（bot はドレインで jobs を重複排除して1回実行）。
        foreach ($weekTargets as [$sid, $gid]) {
            media_webhook_notify((int)$sid, (int)$gid, $nm($gid), ['shift'], 'shift', ['fujoho_schedule_week', 'ekichika_schedule_week', 'heaven_schedule_week', 'fuzoku_schedule_week', 'deli_schedule_week']);
        }
    };

    if ($postMode === 'cell') {
        // 「10日先まで一覧」のマス目を1つだけ更新（JSONで返す）。
        // 保存経路は $saveOne / $notifyShiftWebhooks 共通＝媒体同期の挙動は他タブと完全に同じ。
        header('Content-Type: application/json; charset=utf-8');
        $gid  = (int)($_POST['girl_id'] ?? 0);
        $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_POST['date'] ?? '') ? $_POST['date'] : '';
        $stt  = in_array($_POST['status'] ?? '', SCHEDULE_STATUSES, true) ? $_POST['status'] : '';
        if (!$gid || $date === '' || $stt === '') { http_response_code(400); exit(json_encode(['error' => '入力が不正です。'])); }
        $okGirl = false;
        foreach ($targets as $sid) { $own->execute([$gid, $sid]); if ($own->fetchColumn()) { $okGirl = true; break; } }
        if (!$okGirl) { http_response_code(403); exit(json_encode(['error' => '対象の女性が見つかりません。'])); }
        $s = $e = null;
        $et = in_array($_POST['end_type'] ?? '', SCHEDULE_END_TYPES, true) ? $_POST['end_type'] : 'accept';
        if (schedule_status_has_time($stt)) {
            $s = $mkTime($_POST['start_h'] ?? '', $_POST['start_m'] ?? '');
            $e = $mkTime($_POST['end_h'] ?? '', $_POST['end_m'] ?? '');
            // 出勤なのに時刻が欠けた保存は他タブでも止めている（未定扱いで消える事故を防ぐ）
            if ($s === null || $e === null) { http_response_code(400); exit(json_encode(['error' => '開始と終了の時間を選んでください。'])); }
        }
        $saveOne($gid, $date, $stt, $s, $e, $et);
        $notifyShiftWebhooks();
        exit(json_encode(['ok' => true, 'status' => $stt, 'start' => $s, 'end' => $e, 'end_type' => $et, 'shops' => $tlabel]));
    }

    if ($postMode === 'date') {
        // 1日 × 全女性
        $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_POST['date'] ?? '') ? $_POST['date'] : $bizToday;
        $status = (array)($_POST['status'] ?? []);
        $sh = (array)($_POST['start_h'] ?? []); $sm = (array)($_POST['start_m'] ?? []);
        $eh = (array)($_POST['end_h'] ?? []);   $em = (array)($_POST['end_m'] ?? []);
        $ety = (array)($_POST['end_type'] ?? []);
        foreach ($status as $gid => $stt) {
            $gid = (int)$gid;
            $stt = in_array($stt, SCHEDULE_STATUSES, true) ? $stt : 'undecided';
            $s = schedule_status_has_time($stt) ? $mkTime($sh[$gid] ?? '', $sm[$gid] ?? '') : null;
            $e = schedule_status_has_time($stt) ? $mkTime($eh[$gid] ?? '', $em[$gid] ?? '') : null;
            $saveOne($gid, $date, $stt, $s, $e, $ety[$gid] ?? 'accept');
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
        $ety = (array)($_POST['end_type'] ?? []);
        $n = 0;
        foreach ($status as $d => $stt) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$d)) continue;
            $stt = in_array($stt, SCHEDULE_STATUSES, true) ? $stt : 'undecided';
            $s = schedule_status_has_time($stt) ? $mkTime($sh[$d] ?? '', $sm[$d] ?? '') : null;
            $e = schedule_status_has_time($stt) ? $mkTime($eh[$d] ?? '', $em[$d] ?? '') : null;
            if ($saveOne($gid, $d, $stt, $s, $e, $ety[$d] ?? 'accept') > 0) $n++;
        }
        $notifyShiftWebhooks();
        flash('ok', $n . '日分の出勤を保存しました（' . $tlabel . '）。');
        redirect('schedules.php?mode=girl&girl_id=' . $gid . '&sort=' . $sort);
    }
}

// ============================================================ 女性一覧（girl_shops + 出勤頻度 + 並び順）
// 出勤頻度順の「日付で登録」画面では、表示中の日付に出勤しているキャストを最上位に
//   （時間変更などの操作をしやすくする・2026-07-18 店長要望）。入店順や girl モードには影響させない。
$schedBiz      = date('Y-m-d', time() - 5 * 3600);   // 本日営業日（朝5時区切り）
$schedViewDate = ($mode === 'date' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['date'] ?? '')) ? $_GET['date'] : $schedBiz;
$workTop = ($sort !== 'in_date' && $mode === 'date')
    ? "(NOT EXISTS (SELECT 1 FROM schedules sw WHERE sw.girl_id = g.id AND sw.shop_id = :shopw AND sw.work_date = :vdate AND sw.status = 'work')), "
    : '';   // 0=表示日に出勤あり(先頭) / 1=なし。その中では従来どおり wc DESC
$order = ($sort === 'in_date') ? 'g.in_date DESC, g.id DESC' : $workTop . 'wc DESC, g.in_date DESC, g.id DESC';
$gq = db()->prepare(
    'SELECT g.id, g.name, g.age, g.in_date,
            (SELECT COUNT(*) FROM schedules s WHERE s.girl_id = g.id AND s.shop_id = :shop AND s.status = \'work\') AS wc
       FROM girls g
       JOIN girl_shops gs ON gs.girl_id = g.id AND gs.shop_id = :shop2
      ORDER BY ' . $order
);
$params = ['shop' => $shop, 'shop2' => $shop];
if ($workTop !== '') { $params['shopw'] = $shop; $params['vdate'] = $schedViewDate; }
$gq->execute($params);
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
  .tbl tr.is-ops_only td{background:#faf3fd}
  .tbl tr.is-ops_only td:first-child::after{content:'🔒 非公開';display:block;font-size:11px;color:#7d4a95}
  .day-sat{color:#2563eb}.day-sun{color:#dc2626}
  .sched-sticky-save{position:sticky;bottom:0;background:#fff;padding:12px 0 2px;margin-top:14px;border-top:1px solid var(--border);display:flex;gap:16px;align-items:center;flex-wrap:wrap}
  .sched-shops{display:flex;gap:14px;align-items:center;flex-wrap:wrap;font-size:.88rem;color:var(--muted,#888)}
  .sched-shops label{display:inline-flex;gap:5px;align-items:center;color:var(--text,#333);font-weight:600;cursor:pointer}
  .sched-shops input{width:17px;height:17px;accent-color:var(--accent,#ec4899)}
  .tsel{display:inline-flex;align-items:center;gap:3px}
  .tsel select{padding:6px 4px;border:1px solid var(--border);border-radius:7px;font-size:.95rem;background:#fff}
  .tsel-c{color:var(--muted,#999);font-weight:700}
  /* 受/完（終了時刻の意味）。OPSの受付判断用で、公開サイト・媒体には出さない */
  .etsel{padding:6px 4px;border:1px solid var(--border);border-radius:7px;font-size:.95rem;background:#fff;font-weight:700}
  .media-sync{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:.86rem;line-height:1.7}
  .media-sync summary{cursor:pointer;font-weight:700;color:#166534;font-size:.92rem;list-style:none}
  .media-sync summary::-webkit-details-marker{display:none}
  .media-sync summary::before{content:'▶';font-size:.7em;margin-right:6px;color:#16a34a}
  .media-sync[open] summary::before{content:'▼'}
  .media-sync table{border-collapse:collapse;margin:10px 0 4px;width:100%;max-width:560px}
  .media-sync th,.media-sync td{border:1px solid #bbf7d0;padding:6px 10px;text-align:left;font-size:.85rem}
  .media-sync th{background:#dcfce7;color:#166534}
  .media-sync td.days{font-weight:700;color:#15803d;white-space:nowrap}
  .media-sync .note{color:#3f6212;margin-top:6px}
  .media-sync .warn{color:#9a3412}

  /* ===== 10日先まで一覧（見るだけ）===== */
  .grid-note{font-size:.85rem;color:var(--muted,#888);margin-bottom:10px}
  .sched-toolbar .btn-mini{display:inline-block;padding:6px 12px;font-size:.8rem;border:1px solid var(--accent,#ec4899);
                           color:var(--accent,#ec4899);background:#fff;border-radius:8px;text-decoration:none;font-weight:600;margin-right:6px}
  .sched-toolbar .btn-mini:hover{background:var(--accent,#ec4899);color:#fff}
  /* 角丸は容器側に持たせる（Safari は sticky セルに border-radius があると欠ける）。
     左右 padding も持たせない（sticky 左列の裏に中身が透ける） */
  .grid-wrap{overflow-x:auto;background:#fff;border:1px solid var(--border);border-radius:12px}
  .grid-tbl{border-collapse:separate;border-spacing:0;width:100%;font-size:.86rem}
  .grid-tbl th,.grid-tbl td{border-bottom:1px solid var(--border);padding:7px 6px;text-align:center;white-space:nowrap}
  .grid-tbl tbody tr:last-child th,.grid-tbl tbody tr:last-child td{border-bottom:none}
  .grid-tbl thead th{background:var(--bg-1,#faf7fb);font-weight:700;color:var(--text,#333);line-height:1.35}
  .grid-tbl thead th a{text-decoration:none;color:inherit;font-weight:700}
  .grid-tbl thead th a:hover{text-decoration:underline}
  .grid-tbl thead th small{font-weight:600;font-size:.76em;margin-left:1px}
  .grid-tbl thead th .gd-count{display:block;font-size:.72rem;font-weight:600;color:var(--muted,#999);margin-top:1px}
  .grid-tbl thead th .gd-count i{font-style:normal;color:#7d4a95}
  /* 女性名は横スクロールしても残す */
  .grid-tbl .gd-name{position:sticky;left:0;z-index:1;background:#fff;text-align:left;min-width:8.5rem;
                     box-shadow:1px 0 0 var(--border)}
  .grid-tbl thead .gd-name{z-index:2;background:var(--bg-1,#faf7fb)}
  .grid-tbl .gd-c{min-width:4.4rem;line-height:1.25;color:var(--muted,#999)}
  .grid-tbl .gd-c.s-work{background:#fdf2f8;color:var(--text,#333)}
  .grid-tbl .gd-c.s-ops_only{background:#faf3fd;color:#7d4a95}
  .grid-tbl .gd-c.s-off{background:#f6f6f6;color:#a1a1aa;font-weight:600}
  .grid-tbl .gd-c.is-today{box-shadow:inset 0 0 0 2px var(--accent,#d6218a)}
  .grid-tbl thead th.is-today{background:var(--accent-soft,#fce7f3)}
  .grid-tbl .gd-t{display:block;font-weight:700}
  .grid-tbl .gd-t2{display:block;font-size:.82em;opacity:.75}
  .grid-tbl .gd-t2::before{content:'〜'}
  /* 一覧のマス目に出す 受/完 のしるし。時刻の直後に小さく添える */
  .grid-tbl .gd-et{font-style:normal;font-size:.9em;font-weight:700;margin-left:2px;opacity:.9}
  .grid-tbl .gd-lock{font-size:.7rem}
  .grid-tbl .gd-un{opacity:.45}
  .grid-tbl .gd-total{background:var(--bg-1,#faf7fb);font-weight:700;min-width:3.2rem}
  .grid-tbl .gd-total small{font-weight:600;font-size:.78em;color:var(--muted,#999);margin-left:1px}
  .grid-legend{display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-top:10px;font-size:.8rem;color:var(--muted,#888)}
  .grid-legend .lg{display:inline-block;width:13px;height:13px;border-radius:4px;border:1px solid var(--border);margin-right:5px;vertical-align:-2px}
  .grid-legend .lg.s-work{background:#fdf2f8}
  .grid-legend .lg.s-ops_only{background:#faf3fd}
  .grid-legend .lg.s-off{background:#f6f6f6}
  .grid-legend .lg.s-undecided{background:#fff}
  .grid-legend i{font-style:normal;color:#7d4a95}
  .grid-shops{margin:0 0 10px}
  .grid-tbl .gd-c{cursor:pointer}
  .grid-tbl .gd-c:hover{filter:brightness(.96)}
  .grid-tbl .gd-c:focus-visible{outline:2px solid var(--accent,#d6218a);outline-offset:-2px}
  .grid-tbl .gd-c.is-editing{box-shadow:inset 0 0 0 2px var(--accent,#d6218a)}
  /* マス目の編集パネル */
  .cell-pop{position:absolute;z-index:60;background:#fff;border:1px solid var(--border);border-radius:12px;
            box-shadow:0 12px 32px -8px rgba(16,24,40,.28);padding:10px 12px 12px;min-width:250px}
  .cell-pop[hidden]{display:none}
  .cell-pop .cp-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:.9rem;margin-bottom:8px}
  .cell-pop .cp-head button{border:none;background:none;font-size:1.1rem;line-height:1;color:var(--muted,#888);cursor:pointer;padding:0 2px}
  .cell-pop .cp-st{display:flex;gap:5px;margin-bottom:9px;flex-wrap:wrap}
  .cell-pop .cp-st button{flex:1;min-width:62px;padding:6px 4px;font-size:.8rem;font-weight:600;cursor:pointer;
                          border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--muted,#6b7280)}
  .cell-pop .cp-st button.is-on{background:var(--accent,#d6218a);border-color:var(--accent,#d6218a);color:#fff}
  .cell-pop .cp-time{display:flex;align-items:center;gap:6px;margin-bottom:10px}
  .cell-pop .cp-wave{color:var(--muted,#999)}
  .cell-pop .cp-foot{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .cell-pop .cp-msg{font-size:.76rem;color:var(--danger,#e0395e)}
  @media (max-width:640px){
    .grid-tbl{font-size:.8rem}
    .grid-tbl .gd-name{min-width:6.5rem}
    .grid-tbl .gd-c{min-width:3.9rem}
  }
</style>

<div class="page-head">
  <h1>出勤管理</h1>
</div>

<?php
  // 媒体自動同期の案内（各媒体の同期範囲を動的な最終日つきで明示）。
  //   日付はローリング（毎日1日ずつ先へ）。cap=フォーム上限（今日+N日先）。当日Dは既存の当日同期が担当。
  $bizD = date('Y-m-d', time() - 5 * 3600);
  $mediaSync = [
    ['情報局',   27],
    ['ヘブン',   13],
    ['風じゃ',   13],
    ['デリじゃ', 13],
    ['駅ちか',    6],
  ];
  $fmtJ = function (string $ymd): string { $t = strtotime($ymd); return date('n/j', $t) . '（' . ['日','月','火','水','木','金','土'][(int)date('w', $t)] . '）'; };
?>
<details class="media-sync">
  <summary>📡 各媒体への自動同期について（同期される日数）</summary>
  <p>CTRLで出勤を保存すると、<strong>変更した女性だけ</strong>が各媒体へ自動反映されます（当日分は即時、未来日分も保存した瞬間＋定期巡回）。媒体ごとに反映できる日数の上限が違います。</p>
  <table>
    <tr><th>媒体</th><th>同期される範囲</th><th>今日時点の最終日</th></tr>
    <?php foreach ($mediaSync as [$name, $cap]): $end = date('Y-m-d', strtotime($bizD . ' +' . $cap . ' day')); ?>
    <tr>
      <td><?= h($name) ?></td>
      <td class="days">今日〜<?= $cap ?>日先</td>
      <td><?= h($fmtJ($end)) ?> まで</td>
    </tr>
    <?php endforeach; ?>
  </table>
  <p class="note">※ 日付は<strong>毎日1日ずつ先へずれます</strong>（ローリング）。駅ちかだけ1週間先までなのは媒体フォームの制約です（CTRLには28日先まで登録可。駅ちかは日付が近づいたら順次反映）。</p>
  <p class="note warn">※「休み」＝媒体からも消える／「未定」＝媒体は今のまま（触らない）。媒体から出勤を消したいときは<strong>「休み」</strong>にしてください。</p>
  <p class="note">※ 対応媒体: 情報局・駅ちか・シティヘブン・風俗じゃぱん・デリヘルじゃぱん。新しい女性は各媒体に在籍登録されていれば自動でひも付きます（同名の子のみ手動設定が必要）。</p>
</details>

<div class="sched-tabs">
<?php
  // タブ間で sort を持ち回さない。登録タブに range は無く、一覧の既定は range なので、
  // 持ち回すとタブを移った瞬間に既定が上書きされて「並び替わらない」ように見える（2026-08-05 店長指摘）。
  $tabSort = $sort === 'range' ? '' : '&sort=' . h($sort);
?>
  <a class="sched-tab <?= $mode === 'date' ? 'is-active' : '' ?>" href="schedules.php?mode=date<?= $tabSort ?>">📅 日付で登録</a>
  <a class="sched-tab <?= $mode === 'girl' ? 'is-active' : '' ?>" href="schedules.php?mode=girl<?= $tabSort ?>">👤 女性別まとめ登録</a>
  <a class="sched-tab <?= $mode === 'grid' ? 'is-active' : '' ?>" href="schedules.php?mode=grid">📊 10日先まで一覧</a>
</div>

<?php if ($mode === 'grid'): /* ===================== 10日先まで一覧 ===================== */ ?>
<?php
    // 先の予定を一望するビュー。マス目クリックでその場で出勤を追加・変更できる（POST mode=cell）。
    $DAYS  = 10;
    $from  = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['from'] ?? '') ? $_GET['from'] : $schedBiz;
    $baseTs = strtotime($from);
    $dates = [];
    for ($i = 0; $i < $DAYS; $i++) $dates[] = date('Y-m-d', $baseTs + $i * 86400);

    $gm = [];   // [girl_id][work_date] = 行
    if ($girls) {
        $sc = db()->prepare('SELECT girl_id, work_date, start_time, end_time, end_type, status
                               FROM schedules WHERE shop_id=? AND work_date BETWEEN ? AND ?');
        $sc->execute([$shop, $dates[0], end($dates)]);
        foreach ($sc->fetchAll() as $r) $gm[(int)$r['girl_id']][$r['work_date']] = $r;
    }
    // 日ごとの人数（公開される「出勤」と、非公開の「OPSのみ」は分けて数える）
    $dayWork = $dayOps = array_fill_keys($dates, 0);
    $girlWork = [];
    foreach ($girls as $g) {
        $gid = (int)$g['id'];
        $girlWork[$gid] = 0;
        foreach ($dates as $d) {
            $s = $gm[$gid][$d]['status'] ?? 'undecided';
            if ($s === 'work')          { $dayWork[$d]++; $girlWork[$gid]++; }
            elseif ($s === 'ops_only')  { $dayOps[$d]++;  $girlWork[$gid]++; }
        }
    }
    // 「この10日の出勤が多い順」— SQLの通算 wc ではなく、いま表示している期間で並べ替える。
    // 同数のときは元の並び（通算の出勤頻度→入店順）を保つので、安定ソートで順位だけ差し替える。
    if ($sort === 'range') {
        $idx = [];
        foreach ($girls as $i => $g) $idx[(int)$g['id']] = $i;
        usort($girls, function ($a, $b) use ($girlWork, $idx) {
            $d = $girlWork[(int)$b['id']] <=> $girlWork[(int)$a['id']];
            return $d !== 0 ? $d : $idx[(int)$a['id']] <=> $idx[(int)$b['id']];
        });
    }
    // 「04:00」→「4:00」。先頭ゼロだけ落とす（00:30 が :30 にならないように）
    $hm = fn(?string $t): string => $t ? (int)substr($t, 0, 2) . ':' . substr($t, 3, 2) : '';
    $prev = date('Y-m-d', $baseTs - $DAYS * 86400);
    $next = date('Y-m-d', $baseTs + $DAYS * 86400);
?>
  <div class="sched-toolbar">
    <span>
      <label>開始日</label>
      <input type="date" value="<?= h($from) ?>" onchange="location.href='schedules.php?mode=grid&sort=<?= h($sort) ?>&from='+this.value">
      <?php if ($from !== $schedBiz): ?>
        <a href="schedules.php?mode=grid&sort=<?= h($sort) ?>" style="margin-left:6px">→ 本日から</a>
      <?php endif; ?>
    </span>
    <span>
      <a class="btn-mini" href="schedules.php?mode=grid&sort=<?= h($sort) ?>&from=<?= h($prev) ?>">← 前の<?= $DAYS ?>日</a>
      <a class="btn-mini" href="schedules.php?mode=grid&sort=<?= h($sort) ?>&from=<?= h($next) ?>">次の<?= $DAYS ?>日 →</a>
    </span>
    <span>
      <label>並び順</label>
      <select onchange="location.href='schedules.php?mode=grid&from=<?= h($from) ?>&sort='+this.value">
        <option value="range" <?= $sort === 'range' ? 'selected' : '' ?>>この<?= $DAYS ?>日の出勤が多い順</option>
        <option value="freq" <?= $sort === 'freq' ? 'selected' : '' ?>>通算の出勤が多い順</option>
        <option value="in_date" <?= $sort === 'in_date' ? 'selected' : '' ?>>入店が新しい順</option>
      </select>
    </span>
  </div>

  <div class="grid-note">
    マス目を押すとその場で出勤を追加・変更できます。日付の見出し（<strong><?= (int)substr($dates[0], 5, 2) ?>/<?= (int)substr($dates[0], 8, 2) ?></strong> の部分）を押すと、その日をまとめて登録する画面が開きます。
  </div>
  <div class="sched-shops grid-shops">更新する店舗:
    <?php foreach ($allShops as $s): ?>
      <label><input type="checkbox" class="cp-shop" value="<?= (int)$s['id'] ?>" checked> <?= h($s['name']) ?>（<?= h($s['area']) ?>）</label>
    <?php endforeach; ?>
  </div>

  <div class="grid-wrap">
    <table class="grid-tbl">
      <thead>
        <tr>
          <th class="gd-name">女性</th>
          <?php foreach ($dates as $d): $wdi = (int)date('w', strtotime($d)); ?>
            <th class="<?= $d === $schedBiz ? 'is-today' : '' ?>">
              <a href="schedules.php?mode=date<?= $tabSort ?>&date=<?= h($d) ?>" class="<?= $wdi === 6 ? 'day-sat' : ($wdi === 0 ? 'day-sun' : '') ?>">
                <?= (int)substr($d, 5, 2) ?>/<?= (int)substr($d, 8, 2) ?><small>(<?= $WD[$wdi] ?>)</small>
              </a>
              <span class="gd-count"><?= $dayWork[$d] ?>人<?= $dayOps[$d] ? '<i>+' . $dayOps[$d] . '</i>' : '' ?></span>
            </th>
          <?php endforeach; ?>
          <th class="gd-total" title="出勤＋OPSのみ の日数">出勤計</th>
        </tr>
      </thead>
      <tbody>
        <?php foreach ($girls as $g): $gid = (int)$g['id']; ?>
          <tr data-gid="<?= $gid ?>">
            <td class="gd-name"><strong><?= h($g['name']) ?></strong> <span class="muted">(<?= (int)$g['age'] ?>)</span></td>
            <?php foreach ($dates as $d):
              $r   = $gm[$gid][$d] ?? null;
              $stt = $r['status'] ?? 'undecided';
              $today = $d === $schedBiz ? ' is-today' : '';
              $st5 = ($r['start_time'] ?? null) ? substr($r['start_time'], 0, 5) : '';
              $et5 = ($r['end_time']   ?? null) ? substr($r['end_time'], 0, 5)   : '';
              $ety = ($r['end_type'] ?? 'accept') === 'finish' ? 'finish' : 'accept';
            ?>
              <td class="gd-c s-<?= $stt ?><?= $today ?>" tabindex="0" role="button"
                  data-gid="<?= $gid ?>" data-name="<?= h($g['name']) ?>" data-date="<?= h($d) ?>"
                  data-label="<?= (int)substr($d, 5, 2) ?>/<?= (int)substr($d, 8, 2) ?>(<?= $WD[(int)date('w', strtotime($d))] ?>)"
                  data-st="<?= $stt ?>" data-s="<?= h($st5) ?>" data-e="<?= h($et5) ?>" data-et="<?= $ety ?>">
                <?php if ($stt === 'work' || $stt === 'ops_only'): ?>
                  <?php if ($stt === 'ops_only'): ?><span class="gd-lock" title="OPSのみ（サイト・媒体には出ません）">🔒</span><?php endif; ?>
                  <span class="gd-t"><?= h($hm($r['start_time'] ?? null)) ?></span>
                  <span class="gd-t2"><?= h($hm($r['end_time'] ?? null)) ?><i class="gd-et"><?= h(SCHEDULE_END_TYPE_LABELS[$ety]) ?></i></span>
                <?php elseif ($stt === 'off'): ?>
                  休
                <?php else: ?>
                  <span class="gd-un">＋</span>
                <?php endif; ?>
              </td>
            <?php endforeach; ?>
            <td class="gd-total"><?= $girlWork[$gid] ?><small>日</small></td>
          </tr>
        <?php endforeach; ?>
        <?php if (!$girls): ?><tr><td colspan="<?= $DAYS + 2 ?>" class="muted" style="text-align:center;padding:30px">この店舗に掲載中の女性がいません</td></tr><?php endif; ?>
      </tbody>
    </table>
  </div>
  <div class="grid-legend">
    <span><i class="lg s-work"></i>出勤</span>
    <span><i class="lg s-ops_only"></i>OPSのみ（🔒 サイト・媒体には出ません）</span>
    <span><i class="lg s-off"></i>休み（媒体からも消えます）</span>
    <span><i class="lg s-undecided"></i>未定（媒体は今のまま）</span>
    <span class="muted">見出しの人数は「出勤」の数、<i>+N</i> は OPSのみの数です</span>
  </div>

  <!-- マス目クリックで開く編集パネル（保存は mode=cell の JSON エンドポイント） -->
  <div class="cell-pop" id="cellPop" hidden>
    <div class="cp-head"><strong id="cpTitle"></strong><button type="button" id="cpClose" aria-label="閉じる">×</button></div>
    <div class="cp-st" id="cpSt">
      <button type="button" data-st="work">出勤</button>
      <button type="button" data-st="ops_only">OPSのみ</button>
      <button type="button" data-st="off">休み</button>
      <button type="button" data-st="undecided">未定</button>
    </div>
    <div class="cp-time" id="cpTime">
      <?= time_select('', null, '', 'cpStart') ?><span class="cp-wave">〜</span><?= time_select('', null, '', 'cpEnd') ?>
      <?= end_type_select('', null, '', 'cpEndType') ?>
    </div>
    <div class="cp-foot">
      <span class="cp-msg" id="cpMsg"></span>
      <button type="button" class="btn btn-primary" id="cpSave">保存</button>
    </div>
  </div>

  <script>
  (function () {
    var CSRF  = <?= json_encode(csrf_token()) ?>;
    var pop   = document.getElementById('cellPop');
    var wrap  = document.querySelector('.grid-wrap');
    var cell  = null;                       // いま編集中のマス
    var stCur = 'undecided';
    document.body.appendChild(pop);         // 座標は画面基準で出すので、位置指定のある祖先から外す

    function T(id) { var e = document.getElementById(id); return { h: e.querySelector('.tsel-h'), m: e.querySelector('.tsel-m') }; }
    var S = T('cpStart'), E = T('cpEnd');
    function setT(t, v) { t.h.value = v ? String(parseInt(v.slice(0, 2), 10)) : ''; t.m.value = v ? String(parseInt(v.slice(3, 5), 10)) : ''; }
    function getT(t) { return { h: t.h.value, m: t.m.value }; }
    function hasTime(v) { return v === 'work' || v === 'ops_only'; }
    function fmt(v) { return v ? parseInt(v.slice(0, 2), 10) + ':' + v.slice(3, 5) : ''; }

    function paintStatus() {
      pop.querySelectorAll('#cpSt button').forEach(function (b) { b.classList.toggle('is-on', b.dataset.st === stCur); });
      document.getElementById('cpTime').style.display = hasTime(stCur) ? '' : 'none';
    }

    function open(td) {
      cell = td;
      stCur = td.dataset.st || 'undecided';
      document.getElementById('cpTitle').textContent = td.dataset.name + '　' + td.dataset.label;
      document.getElementById('cpMsg').textContent = '';
      setT(S, td.dataset.s); setT(E, td.dataset.e);
      document.getElementById('cpEndType').value = td.dataset.et || 'accept';
      paintStatus();
      pop.hidden = false;
      // マスの真下に出す。画面からはみ出すときは内側へ寄せる
      var r = td.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
      var left = r.left + window.scrollX + r.width / 2 - w / 2;
      left = Math.max(8 + window.scrollX, Math.min(left, window.scrollX + document.documentElement.clientWidth - w - 8));
      var top = r.bottom + window.scrollY + 6;
      if (r.bottom + h + 12 > window.innerHeight) top = r.top + window.scrollY - h - 6;
      pop.style.left = left + 'px'; pop.style.top = Math.max(8, top) + 'px';
      document.querySelectorAll('.gd-c.is-editing').forEach(function (c) { c.classList.remove('is-editing'); });
      td.classList.add('is-editing');
    }
    function close() {
      pop.hidden = true; cell = null;
      document.querySelectorAll('.gd-c.is-editing').forEach(function (c) { c.classList.remove('is-editing'); });
    }

    // 保存後にマスの見た目を描き直す（ページ再読み込みなしで反映）
    function repaint(td, st, s, e, et) {
      td.dataset.st = st; td.dataset.s = s || ''; td.dataset.e = e || ''; td.dataset.et = et || 'accept';
      td.className = td.className.replace(/\bs-\w+/, 's-' + st);
      if (hasTime(st)) {
        td.innerHTML = (st === 'ops_only' ? '<span class="gd-lock" title="OPSのみ（サイト・媒体には出ません）">🔒</span>' : '')
          + '<span class="gd-t">' + fmt(s) + '</span><span class="gd-t2">' + fmt(e)
          + '<i class="gd-et">' + (et === 'finish' ? '完' : '受') + '</i></span>';
      } else {
        td.innerHTML = st === 'off' ? '休' : '<span class="gd-un">＋</span>';
      }
      recount();
    }
    // 見出しの人数と右端の日数を数え直す
    function recount() {
      var rows = wrap.querySelectorAll('tbody tr[data-gid]');
      var cols = wrap.querySelectorAll('thead th .gd-count');
      var work = [], ops = [];
      for (var i = 0; i < cols.length; i++) { work[i] = 0; ops[i] = 0; }
      rows.forEach(function (tr) {
        var cs = tr.querySelectorAll('.gd-c'), n = 0;
        cs.forEach(function (c, i) {
          if (c.dataset.st === 'work') { work[i]++; n++; }
          else if (c.dataset.st === 'ops_only') { ops[i]++; n++; }
        });
        var t = tr.querySelector('.gd-total');
        if (t) t.innerHTML = n + '<small>日</small>';
      });
      cols.forEach(function (el, i) { el.innerHTML = work[i] + '人' + (ops[i] ? '<i>+' + ops[i] + '</i>' : ''); });
    }

    wrap.addEventListener('click', function (e) {
      var td = e.target.closest('.gd-c');
      if (td) { e.stopPropagation(); open(td); }
    });
    wrap.addEventListener('keydown', function (e) {
      var td = e.target.closest('.gd-c');
      if (td && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(td); }
    });
    document.getElementById('cpSt').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-st]');
      if (!b) return;
      stCur = b.dataset.st;
      // 「出勤」に切り替えたとき時間が空なら、同じ女性の直近の出勤時間を引き継ぐ（毎回選び直さなくて済む）
      if (hasTime(stCur) && !S.h.value && cell) {
        var sib = cell.parentNode.querySelectorAll('.gd-c');
        for (var i = 0; i < sib.length; i++) {
          if (sib[i] !== cell && sib[i].dataset.s) {
            setT(S, sib[i].dataset.s); setT(E, sib[i].dataset.e);
            document.getElementById('cpEndType').value = sib[i].dataset.et || 'accept';
            break;
          }
        }
      }
      paintStatus();
    });
    document.getElementById('cpClose').addEventListener('click', close);
    document.addEventListener('click', function (e) { if (!pop.hidden && !pop.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    document.getElementById('cpSave').addEventListener('click', function () {
      if (!cell) return;
      var msg = document.getElementById('cpMsg');
      var s = getT(S), e = getT(E);
      if (hasTime(stCur) && (s.h === '' || s.m === '' || e.h === '' || e.m === '')) {
        msg.textContent = '開始と終了の時間を選んでください。'; return;
      }
      var shops = Array.prototype.map.call(document.querySelectorAll('.cp-shop:checked'), function (c) { return c.value; });
      if (!shops.length) { msg.textContent = '更新する店舗にチェックを入れてください。'; return; }
      var fd = new FormData();
      fd.append('_csrf', CSRF); fd.append('mode', 'cell');
      fd.append('girl_id', cell.dataset.gid); fd.append('date', cell.dataset.date); fd.append('status', stCur);
      fd.append('start_h', s.h); fd.append('start_m', s.m); fd.append('end_h', e.h); fd.append('end_m', e.m);
      fd.append('end_type', document.getElementById('cpEndType').value);
      shops.forEach(function (v) { fd.append('shops[]', v); });
      var btn = this, td = cell;
      btn.disabled = true; msg.textContent = '保存中...';
      fetch('schedules.php', { method: 'POST', body: fd, credentials: 'same-origin' })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          btn.disabled = false;
          if (!res.ok || res.j.error) { msg.textContent = res.j.error || '保存できませんでした。'; return; }
          repaint(td, res.j.status, res.j.start, res.j.end, res.j.end_type);
          close();
        })
        .catch(function () { btn.disabled = false; msg.textContent = '通信に失敗しました。'; });
    });
  })();
  </script>

<?php elseif ($mode === 'date'): ?>
<?php
    // 既定は「本日営業日」（朝5時区切り）。深夜0〜4時台に暦日デフォルトだと翌営業日のページが
    // 開き、スタッフが「本日の終了時刻」のつもりで明日の行を編集する事故が起きる（2026-07-14 0:06 実例）。
    $bizNow = date('Y-m-d', time() - 5 * 3600);
    $date = $_GET['date'] ?? $bizNow;
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) $date = $bizNow;
    $sc = db()->prepare('SELECT girl_id, start_time, end_time, end_type, status FROM schedules WHERE shop_id=? AND work_date=?');
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
        <thead><tr><th>女性</th><th>状態</th><th>開始</th><th>終了</th><th title="受=その時刻までの注文に対応 / 完=その時刻に完全終了">受/完</th></tr></thead>
        <tbody>
          <?php foreach ($girls as $g): $cur = $map[(int)$g['id']] ?? null; $stt = $cur['status'] ?? 'undecided'; ?>
            <tr class="is-<?= $stt ?>">
              <td><strong><?= h($g['name']) ?></strong> <span class="muted">(<?= (int)$g['age'] ?>)</span></td>
              <td>
                <select name="status[<?= (int)$g['id'] ?>]" data-status onchange="this.closest('tr').className='is-'+this.value">
                  <option value="undecided" <?= $stt === 'undecided' ? 'selected' : '' ?>>未定</option>
                  <option value="work" <?= $stt === 'work' ? 'selected' : '' ?>>出勤</option>
                  <option value="ops_only" <?= $stt === 'ops_only' ? 'selected' : '' ?>>OPSのみ</option>
                  <option value="off" <?= $stt === 'off' ? 'selected' : '' ?>>休み</option>
                </select>
              </td>
              <td><?= time_select('start', ($cur['start_time'] ?? null) ? substr($cur['start_time'], 0, 5) : null, (string)(int)$g['id']) ?></td>
              <td><?= time_select('end', ($cur['end_time'] ?? null) ? substr($cur['end_time'], 0, 5) : null, (string)(int)$g['id']) ?></td>
              <td><?= end_type_select('end_type', $cur['end_type'] ?? null, (string)(int)$g['id']) ?></td>
            </tr>
          <?php endforeach; ?>
          <?php if (!$girls): ?><tr><td colspan="5" class="muted" style="text-align:center;padding:30px">この店舗に掲載中の女性がいません</td></tr><?php endif; ?>
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
        $sc = db()->prepare('SELECT work_date, start_time, end_time, end_type, status FROM schedules WHERE shop_id=? AND girl_id=? AND work_date BETWEEN ? AND ?');
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
          <option value="work">出勤</option><option value="ops_only">OPSのみ</option><option value="off">休み</option><option value="undecided">未定</option>
        </select>
        <button type="button" class="btn-mini" id="applyStatus">全日に適用</button>
      </span>
      <span class="grp">一括時間
        <?= time_select('', null, '', 'bulkStart') ?> 〜 <?= time_select('', null, '', 'bulkEnd') ?>
        <?= end_type_select('', null, '', 'bulkEndType') ?>
        <button type="button" class="btn-mini" id="applyTime">出勤日に適用</button>
      </span>
    </div>

    <div class="table-wrap" style="border:none">
      <table class="tbl">
        <thead><tr><th>日付</th><th>状態</th><th>開始</th><th>終了</th><th title="受=その時刻までの注文に対応 / 完=その時刻に完全終了">受/完</th></tr></thead>
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
                  <option value="ops_only" <?= $stt === 'ops_only' ? 'selected' : '' ?>>OPSのみ</option>
                  <option value="off" <?= $stt === 'off' ? 'selected' : '' ?>>休み</option>
                </select>
              </td>
              <td><?= time_select('start', ($r['start_time'] ?? null) ? substr($r['start_time'], 0, 5) : null, $d) ?></td>
              <td><?= time_select('end', ($r['end_time'] ?? null) ? substr($r['end_time'], 0, 5) : null, $d) ?></td>
              <td><?= end_type_select('end_type', $r['end_type'] ?? null, $d) ?></td>
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
  // 時刻を持つ状態（出勤・OPSのみ）。休み・未定は時刻を扱わない
  function HAS_TIME(v) { return v === 'work' || v === 'ops_only'; }
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
      var bet = document.getElementById('bulkEndType').value;
      rows().forEach(function (tr) {
        if (!HAS_TIME(tr.querySelector('[data-status]').value)) return;
        var ts = tr.querySelectorAll('.tsel');
        setT(ts[0], bs); setT(ts[1], be);
        var et = tr.querySelector('.etsel');   // 受/完 も一括で揃える
        if (et) et.value = bet;
      });
    });
  })();
  </script>
  <?php endif; ?>
<?php endif; ?>

<script>
  // 時刻を持つ状態（出勤・OPSのみ）。休み・未定は時刻を扱わない
  function HAS_TIME(v) { return v === 'work' || v === 'ops_only'; }
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
        if (!st || !HAS_TIME(st.value)) return;
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
