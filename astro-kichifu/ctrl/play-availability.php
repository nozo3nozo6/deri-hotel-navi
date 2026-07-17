<?php
// ==========================================================================
// play-availability.php — 最速で遊べる時間（即ヒメ正データ）
//   この画面が正（Single Source of Truth）。各媒体bot（情報局/駅ちか/ヘブン）が
//   api/play-availability.php を updated_at ポーリングで読んで媒体へ反映する。
//   ここからは媒体へ直接POSTしない（媒体操作は別bot＝スコープ外）。
//
//   仕様: 1キャスト×1営業日=1行（shop_id×girl_id×shift_business_date UNIQUE・上書き更新）
//   play_at はJST・5分刻み /「今すぐ」= 現在時刻を5分単位に切り下げ（→ play_at<=now で即「今すぐ遊べる」）
//   本日/明日（CLAUDE-NEXT-DAY-PREP.md 案A）: 今夜のうちに明日(D+1)の即姫を仕込める。
//     一覧の表示営業日は §4 のロジックで自動選択（本日出勤が終了前=本日 / 終わった or 無い=明日）。
//     明日行の保存では Webhook を送らない（bot は D+1 を無視。朝5:01の rollover が D 昇格後に force 同期）。
//     「今すぐ」「受付終了」は"いま"の操作なので本日行のみ（明日は時刻設定で仕込む）。
//   関連: sql/migration_play_availability.sql / references: official-ui-brief-for-claude.md
// ==========================================================================
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/../api/media-webhook.php';   // 保存後に bot へ変更通知（WEBHOOK-CTRL.md）
$admin = require_login();
$shop  = current_shop_id();
date_default_timezone_set('Asia/Tokyo');

// 時刻ピッカー（schedules.php と同型・分は5分刻み=情報局スロット準拠）
function pa_time_select(string $name, ?string $val, string $key): string {
    $ch = ($val !== null && $val !== '') ? (int)substr($val, 0, 2) : null;
    $cm = ($val !== null && $val !== '') ? (int)substr($val, 3, 2) : null;
    $hours = array_merge(range(10, 23), range(0, 9));   // 営業 10:00〜翌5:00 の順
    $o = '<span class="tsel">';
    $o .= '<select class="tsel-h" name="' . h($name) . '_h[' . h($key) . ']" aria-label="時"><option value="">--</option>';
    foreach ($hours as $hh) $o .= '<option value="' . $hh . '"' . ($ch === $hh ? ' selected' : '') . '>' . $hh . '</option>';
    $o .= '</select><span class="tsel-c">:</span><select class="tsel-m" name="' . h($name) . '_m[' . h($key) . ']" aria-label="分"><option value="">--</option>';
    for ($mm = 0; $mm < 60; $mm += 5) $o .= '<option value="' . $mm . '"' . ($cm === $mm ? ' selected' : '') . '>' . sprintf('%02d', $mm) . '</option>';
    return $o . '</select></span>';
}

// ============================================================ POST
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $action = $_POST['action'] ?? '';
    $gid    = (int)($_POST['girl_id'] ?? 0);
    $by     = $admin['username'] ?? 'ctrl';

    // 対象営業日（本日 D / 明日 D+1 のみ許可・不正やなりすましは本日に丸める）
    $bizDate  = date('Y-m-d', time() - 5 * 3600);
    $nextDate = date('Y-m-d', strtotime($bizDate . ' +1 day'));
    $bd = (string)($_POST['bd'] ?? '');
    if (!in_array($bd, [$bizDate, $nextDate], true)) $bd = $bizDate;
    $isNext = ($bd === $nextDate);
    $dayLbl = $isNext ? '明日' : '本日';
    // 明日行の変更は媒体へ即時反映しない（bot が D+1 を無視するため送っても無意味＋誤爆防止）
    $notify = function (array $changed, array $jobs = []) use ($isNext, $shop, $gid, &$gname) {
        if ($isNext) return;
        media_webhook_notify($shop, $gid, $gname, $changed, 'ctrl', $jobs);
    };

    // girl が当店掲載中か（越境防止）
    $own = db()->prepare('SELECT 1 FROM girl_shops WHERE girl_id=? AND shop_id=?');
    $own->execute([$gid, $shop]);
    $gname = '';
    if ($gid && $own->fetchColumn()) {
        $st = db()->prepare('SELECT name FROM girls WHERE id=?');
        $st->execute([$gid]);
        $gname = (string)$st->fetchColumn();
    }
    if ($gname === '') { flash('err', '対象キャストが見つかりません。'); redirect('play-availability.php'); }

    // 時刻設定/今すぐ＝即姫の設定。play_at を入れる操作は「受付再開」でもある（reception_closed=0 に戻す）
    $upsert = db()->prepare(
        'INSERT INTO play_availability (shop_id, girl_id, shift_business_date, play_at, reception_closed, status, updated_by)
         VALUES (?,?,?,?,0,"active",?)
         ON DUPLICATE KEY UPDATE play_at=VALUES(play_at), reception_closed=0, status="active", updated_by=VALUES(updated_by)'
    );

    if ($action === 'set') {
        $hh = $_POST['pa_h'][$gid] ?? '';
        $mm = $_POST['pa_m'][$gid] ?? '';
        if ($hh === '' || $mm === '') { flash('err', $gname . ': 時と分を選択してください。'); redirect('play-availability.php'); }
        // 対象営業日（10:00〜翌5:00・5時区切り）で解釈: 10〜23時=その営業日 / 0〜9時=深夜側（翌暦日）。
        // 過去時刻はそのまま保存（=「その時刻から遊べる」が既に来ている → プレビュー/媒体上は「今すぐ遊べる」。情報局と同じ解釈）
        $hh = (int)$hh; $mm = (int)$mm;
        $dateStr = ($hh >= 10) ? $bd : date('Y-m-d', strtotime($bd . ' +1 day'));
        $ts = strtotime($dateStr . sprintf(' %02d:%02d:00', $hh, $mm));
        $upsert->execute([$shop, $gid, $bd, date('Y-m-d H:i:00', $ts), $by]);
        flash('ok', $gname . ': ' . $dayLbl . ' ' . ($isNext
            ? date('n/j H:i', $ts) . ' から遊べる、で保存しました（媒体へは明日の朝5時以降に自動反映されます）。'
            : (($ts <= time())
                ? date('n/j H:i', $ts) . ' から遊べる（時刻が来ているので「今すぐ遊べる」表示）で保存しました。'
                : date('n/j H:i', $ts) . ' から遊べる、で保存しました。')));
        $notify(['play_at', 'status']);
    } elseif ($action === 'now') {
        if ($isNext) { flash('err', $gname . ': 「今すぐ」は本日のみです（明日は時刻設定で仕込んでください）。'); redirect('play-availability.php'); }
        $ts = intdiv(time(), 300) * 300;                     // 5分切り下げ → play_at<=now で即「今すぐ」
        $upsert->execute([$shop, $gid, $bd, date('Y-m-d H:i:00', $ts), $by]);
        flash('ok', $gname . ': 「今すぐ遊べる（即姫）」で保存しました。');
        $notify(['play_at', 'status']);
    } elseif ($action === 'close') {
        // 受付終了（CLAUDE-UKETSUKE-SHURYO.md）: 出勤(shift_*)は残したまま即姫だけ止める＝出勤解除とは別。
        //   status は active のまま（GET既定 status=active から落とすと bot がヒメ割・出勤表の対象を見失う）。
        //   jobs を明示＝schedule(出勤表)/himewari(ヒメ割)は絶対に起動させない（媒体の出勤表とヒメ割は維持）。
        if ($isNext) { flash('err', $gname . ': 「受付終了」は本日のみです。'); redirect('play-availability.php'); }
        $st = db()->prepare(
            'INSERT INTO play_availability (shop_id, girl_id, shift_business_date, play_at, reception_closed, status, updated_by)
             VALUES (?,?,?,NULL,1,"active",?)
             ON DUPLICATE KEY UPDATE play_at=NULL, reception_closed=1, status="active", updated_by=VALUES(updated_by)'
        );
        $st->execute([$shop, $gid, $bd, $by]);
        flash('ok', $gname . ': 受付終了にしました（出勤はそのまま／即ヒメ・接客・待機のみ停止。ヒメ割は掲載継続）。');
        $notify(['play_at', 'status', 'reception_closed'], ['sugu_hime', 'ekichika', 'heaven', 'fuzoku', 'deli']);
    } elseif ($action === 'clear') {
        // 即姫クリア（受付終了フラグも解除＝cleared と受付終了が同時に立つ曖昧な状態を作らない）
        $st = db()->prepare('UPDATE play_availability SET status="cleared", reception_closed=0, updated_by=? WHERE shop_id=? AND girl_id=? AND shift_business_date=?');
        $st->execute([$by, $shop, $gid, $bd]);
        flash('ok', $gname . ': ' . $dayLbl . 'の設定をクリアしました' . ($isNext ? '。' : '（媒体側は bot が取消します）。'));
        $notify(['play_at', 'status', 'reception_closed']);
    } elseif ($action === 'himewari') {
        // ヒメ割（情報局のみ・CLAUDE-HIMEWARI-AUTO.md）: 編集できるのは「分」「円」だけ。
        //   ON/OFFは廃止（本日出勤があれば自動掲載・出勤終了で自動取消＝bot側は shift_end_at と現在時刻のみで判断）。
        //   期限＝出勤表の終了と連動（APIが出勤表から直接導出）。ここでは終了時刻を触らない。
        //   分・円は NULL 可＝bot既定 70分/11000円。play_at(即姫)とは独立。
        $min   = ($_POST['hw_min'] ?? '') !== '' ? (int)$_POST['hw_min'] : null;
        $price = ($_POST['hw_price'] ?? '') !== '' ? (int)$_POST['hw_price'] : null;
        $st = db()->prepare(
            'INSERT INTO play_availability (shop_id, girl_id, shift_business_date, play_at, status, himewari_minutes, himewari_price, updated_by)
             VALUES (?,?,?,NULL,"active",?,?,?)
             ON DUPLICATE KEY UPDATE himewari_minutes=VALUES(himewari_minutes),
                 himewari_price=VALUES(himewari_price), updated_by=VALUES(updated_by)'
        );
        $st->execute([$shop, $gid, $bd, $min, $price, $by]);
        flash('ok', $gname . ': ヒメ割の分・円を保存しました（' . ($min ?? 70) . '分 / ' . number_format($price ?? 11000) . '円' . ($min === null && $price === null ? '＝既定値' : '') . '）。期限は出勤表の終了と連動します。');
        $notify(['himewari_minutes', 'himewari_price']);
    } elseif ($action === 'media') {
        $f  = trim((string)($_POST['fujoho'] ?? ''));
        $e  = trim((string)($_POST['ekichika'] ?? ''));
        $hv = trim((string)($_POST['heaven'] ?? ''));
        $fz = trim((string)($_POST['fuzoku'] ?? ''));
        $dl = trim((string)($_POST['deli'] ?? ''));
        $st = db()->prepare(
            'INSERT INTO girl_media_ids (shop_id, girl_id, fujoho_girl_id, ekichika_girl_id, heaven_member_id, fuzoku_girl_no, deli_girl_no)
             VALUES (?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE fujoho_girl_id=VALUES(fujoho_girl_id),
                 ekichika_girl_id=VALUES(ekichika_girl_id), heaven_member_id=VALUES(heaven_member_id),
                 fuzoku_girl_no=VALUES(fuzoku_girl_no), deli_girl_no=VALUES(deli_girl_no)'
        );
        $st->execute([$shop, $gid, $f !== '' ? $f : null, $e !== '' ? $e : null, $hv !== '' ? $hv : null, $fz !== '' ? $fz : null, $dl !== '' ? $dl : null]);
        flash('ok', $gname . ': 媒体IDを保存しました。');
        // 媒体ID(girl_media_ids)は営業日と無関係な即時データなので、明日行からの保存でも常に通知する
        media_webhook_notify($shop, $gid, $gname, ['media_ids']);   // 不明フィールド→bot側は全ジョブ推定（張り替え直後に再反映させる）
    }
    redirect('play-availability.php' . (isset($_POST['view']) && in_array($_POST['view'], ['today', 'tomorrow'], true) ? '?view=' . $_POST['view'] : ''));
}

// ============================================================ 一覧データ（本日 D と 明日 D+1 を両方取る）
$bizDate  = date('Y-m-d', time() - 5 * 3600);                  // 現在営業日 D（朝5時区切り、schedules と同じ）
$nextDate = date('Y-m-d', strtotime($bizDate . ' +1 day'));    // 翌営業日 D+1（明日の仕込み）

// 表示営業日の選択: 既定は auto（§4 のロジックで行ごとに本日/明日を自動選択）。
//   ?view=today / ?view=tomorrow で全行を固定（明日の仕込みをまとめて入れたい時など）。
$view = $_GET['view'] ?? 'auto';
if (!in_array($view, ['auto', 'today', 'tomorrow'], true)) $view = 'auto';

$rows = db()->prepare(
    'SELECT g.id, g.name,
            st.start_time AS t_ws, st.end_time AS t_we,
            sm.start_time AS m_ws, sm.end_time AS m_we,
            pt.play_at AS t_play, pt.reception_closed AS t_rc, pt.shift_end_at AS t_se, pt.status AS t_status,
            pt.himewari_minutes AS t_hwmin, pt.himewari_price AS t_hwprice, pt.updated_at AS t_upd, pt.updated_by AS t_by,
            pm.play_at AS m_play, pm.reception_closed AS m_rc, pm.shift_end_at AS m_se, pm.status AS m_status,
            pm.himewari_minutes AS m_hwmin, pm.himewari_price AS m_hwprice, pm.updated_at AS m_upd, pm.updated_by AS m_by,
            mi.fujoho_girl_id, mi.ekichika_girl_id, mi.heaven_member_id, mi.fuzoku_girl_no, mi.deli_girl_no
       FROM girls g
       JOIN girl_shops gs ON gs.girl_id = g.id AND gs.shop_id = :shop1
       LEFT JOIN schedules st ON st.girl_id = g.id AND st.shop_id = :shop2 AND st.work_date = :bd1 AND st.status = "work"
       LEFT JOIN schedules sm ON sm.girl_id = g.id AND sm.shop_id = :shop3 AND sm.work_date = :nd1 AND sm.status = "work"
       LEFT JOIN play_availability pt ON pt.girl_id = g.id AND pt.shop_id = :shop4 AND pt.shift_business_date = :bd2
       LEFT JOIN play_availability pm ON pm.girl_id = g.id AND pm.shop_id = :shop5 AND pm.shift_business_date = :nd2
       LEFT JOIN girl_media_ids mi   ON mi.girl_id = g.id AND mi.shop_id = :shop6
      WHERE g.is_display = 1'
);
$rows->execute([':shop1' => $shop, ':shop2' => $shop, ':shop3' => $shop, ':shop4' => $shop, ':shop5' => $shop, ':shop6' => $shop,
                ':bd1' => $bizDate, ':bd2' => $bizDate, ':nd1' => $nextDate, ':nd2' => $nextDate]);
$raw = $rows->fetchAll(PDO::FETCH_ASSOC);

// 出勤TIME(HH:MM[:SS]) → 実datetime（0〜9時台=翌暦日の深夜側。start<end が常に成立）
$paShiftDt = function (?string $t, string $date): ?string {
    if ($t === null || $t === '') return null;
    $h = (int)substr($t, 0, 2);
    $d = ($h >= 10) ? $date : date('Y-m-d', strtotime($date . ' +1 day'));
    return $d . ' ' . substr($t, 0, 5) . ':00';
};

// 表示用シフトの決定（CLAUDE-NEXT-DAY-PREP.md §4）
//   本日出勤があり、まだ終了前 → 本日
//   そうでなく明日出勤がある     → 明日（本日終了後〜朝5時前もここ。朝5時を過ぎれば D が繰り上がり自動で「本日」）
//   本日出勤だけ（終了済）       → 本日（終了済のグレー表示）
//   どちらも無し                 → 本日（出勤なし）
$girls = [];
foreach ($raw as $r) {
    $tEnd  = $paShiftDt($r['t_we'], $bizDate);
    $todayLive = $r['t_ws'] !== null && (!$tEnd || strtotime($tEnd) > time());
    if ($view === 'today')          $useNext = false;
    elseif ($view === 'tomorrow')   $useNext = true;
    else                            $useNext = (!$todayLive && $r['m_ws'] !== null);   // auto = §4

    $p = $useNext ? 'm_' : 't_';
    $girls[] = [
        'id' => $r['id'], 'name' => $r['name'],
        'bd' => $useNext ? $nextDate : $bizDate,
        'is_next' => $useNext,
        'work_start' => $r[$p . 'ws'], 'work_end' => $r[$p . 'we'],
        'play_at' => $r[$p . 'play'], 'reception_closed' => $r[$p . 'rc'], 'shift_end_at' => $r[$p . 'se'],
        'status' => $r[$p . 'status'], 'himewari_minutes' => $r[$p . 'hwmin'], 'himewari_price' => $r[$p . 'hwprice'],
        'updated_at' => $r[$p . 'upd'], 'updated_by' => $r[$p . 'by'],
        'fujoho_girl_id' => $r['fujoho_girl_id'], 'ekichika_girl_id' => $r['ekichika_girl_id'],
        'heaven_member_id' => $r['heaven_member_id'], 'fuzoku_girl_no' => $r['fuzoku_girl_no'], 'deli_girl_no' => $r['deli_girl_no'],
        // 並び用: 出勤あり(本日→明日の順) → 開始時刻 → 名前
        '_sort' => [$r[$p . 'ws'] === null ? 1 : 0, $useNext ? 1 : 0,
                    $paShiftDt($r[$p . 'ws'], $useNext ? $nextDate : $bizDate) ?? '9999', $r['name']],
    ];
}
usort($girls, fn($a, $b) => $a['_sort'] <=> $b['_sort']);

// 「出勤終了を過ぎたか」の判定（陳腐化した play_at を「―」表示に抑制する用）。
//   優先1: 本日営業日の出勤表 s.end_time（work行がJOINで取れていれば最も新鮮＝事前登録にも追従）。
//          end 0〜9時台=翌暦日として実datetime化。end未入力(null)なら期限なし＝隠さない。
//   優先2: 本日work行が無い場合のみ pa.shift_end_at（永続カラム）。営業日切替直後(朝5時〜)に
//          前日分がJOINから消えても、前日の古い終了時刻(過去)で正しく「―」にできる。
//   ※ shift_end_at 単独判定にすると逆の事故が起きる（2026-07-14 実例: 事前登録した本日出勤
//     20:30〜04:00 は本日中の出勤保存が無く永続カラムが前日の 03:30 のまま → 過去扱いで
//     play_at=20:30 の宣伝設定が「―」に抑制され「登録されない」ように見えた）。両方を併用する。
function pa_shift_end_passed(?string $workEnd, ?string $shiftEndDt, string $bizDate): bool {
    if ($workEnd !== null && $workEnd !== '') {
        $h = (int)substr($workEnd, 0, 2);
        $d = ($h >= 10) ? $bizDate : date('Y-m-d', strtotime($bizDate . ' +1 day'));
        return strtotime($d . ' ' . substr($workEnd, 0, 5) . ':00') <= time();
    }
    if ($shiftEndDt) return strtotime($shiftEndDt) <= time();
    return false;
}

// プレビュー文言（情報局と同じ考え方）。$endPassed=出勤終了を過ぎたら play_at が残っていても
//   「―」表示にする（DBのplay_atは変更しない・表示のみ）。
function pa_preview(?string $playAt, ?string $status, bool $endPassed): array {
    if (!$playAt || $status !== 'active') return ['—', 'pa-none'];
    if ($endPassed) return ['—', 'pa-none'];
    $ts = strtotime($playAt);
    if ($ts <= time()) return ['🔥 今すぐ遊べる（即姫）', 'pa-now'];
    $label = (date('Y-m-d', $ts) === date('Y-m-d')) ? date('H:i', $ts) : date('n/j H:i', $ts);
    return [$label . ' から遊べる', 'pa-future'];
}

// 各フォームに「この行の営業日」と「表示中のタブ」を持たせる（保存先の営業日を取り違えない）
$bdFields = function (array $g) use ($view): string {
    return '<input type="hidden" name="bd" value="' . h($g['bd']) . '">'
         . '<input type="hidden" name="view" value="' . h($view) . '">';
};

layout_header('最速で遊べる時間', 'play-availability.php');
?>
<style>
  .pa-refreshbar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; background:#fff7ed; border:1px solid #fdba74; border-radius:10px; padding:10px 14px; margin-bottom:14px; }
  .pa-refresh-btn { display:inline-flex; align-items:center; gap:6px; background:#ea580c; color:#fff; border:none; border-radius:8px; padding:9px 18px; font-size:.9rem; font-weight:700; cursor:pointer; white-space:nowrap; }
  .pa-refresh-btn:hover { background:#c2410c; }
  .pa-refresh-note { font-size:.78rem; color:#9a3412; line-height:1.5; }
  .pa-refresh-time { font-size:.72rem; color:#c2410c; font-weight:700; white-space:nowrap; }
  .pa-table { width:100%; border-collapse:collapse; background:#fff; }
  .pa-table th, .pa-table td { border-bottom:1px solid #e5e7eb; padding:8px 10px; font-size:.85rem; vertical-align:middle; text-align:left; }
  .pa-table th { background:#f8fafc; font-size:.75rem; color:#475569; }
  .pa-name { font-weight:700; white-space:nowrap; }
  .pa-work { display:inline-block; margin-left:6px; font-size:.68rem; background:#0d9488; color:#fff; border-radius:99px; padding:1px 8px; vertical-align:middle; }
  .pa-work-next { background:#4f46e5; }                                    /* 明日=青系（本日と一目で区別） */
  .pa-work-done { background:#cbd5e1; color:#475569; }                     /* 本日ぶんは終了済み */
  .pa-viewtabs { display:flex; gap:6px; align-items:center; margin-bottom:12px; flex-wrap:wrap; }
  .pa-viewtab { border:1px solid #cbd5e1; background:#fff; color:#475569; border-radius:8px; padding:6px 14px; font-size:.8rem; font-weight:700; text-decoration:none; white-space:nowrap; }
  .pa-viewtab.is-active { background:#0d9488; border-color:#0d9488; color:#fff; }
  .pa-viewtab-note { font-size:.75rem; color:#94a3b8; }
  .pa-next-note { background:#eef2ff; border:1px solid #c7d2fe; border-radius:8px; padding:8px 12px; font-size:.78rem; color:#3730a3; margin-bottom:12px; line-height:1.6; }
  .pa-prev { font-weight:700; white-space:nowrap; }
  .pa-now { color:#dc2626; }
  .pa-future { color:#0d9488; }
  .pa-none { color:#94a3b8; font-weight:400; }
  .pa-closed { color:#b45309; }
  .pa-btn-close { border-color:#f59e0b; color:#b45309; }
  .pa-btn-close:hover { background:#fffbeb; }
  .pa-forms { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .pa-forms form { display:inline-flex; align-items:center; gap:6px; margin:0; }
  .pa-btn { border:1px solid #0d9488; background:#fff; color:#0d9488; border-radius:8px; padding:5px 12px; font-size:.78rem; font-weight:700; cursor:pointer; white-space:nowrap; }
  .pa-btn:hover { background:#f0fdfa; }
  .pa-btn-now { background:#0d9488; color:#fff; }
  .pa-btn-now:hover { background:#0f766e; }
  .pa-btn-clear { border-color:#cbd5e1; color:#64748b; }
  .pa-btn-clear:hover { background:#f1f5f9; }
  .pa-meta { font-size:.7rem; color:#94a3b8; white-space:nowrap; }
  .pa-media summary { cursor:pointer; font-size:.72rem; color:#0d9488; white-space:nowrap; }
  .pa-media summary.pa-hw-on { color:#dc2626; font-weight:700; }
  .pa-media form { display:flex; gap:6px; margin-top:6px; flex-wrap:wrap; align-items:center; }
  .pa-media input { width:100px; padding:4px 6px; border:1px solid #cbd5e1; border-radius:6px; font-size:.75rem; }
  .pa-media label { font-size:.68rem; color:#64748b; }
  .pa-optional { display:inline-block; margin-left:4px; font-size:.62rem; background:#dcfce7; color:#16a34a; border-radius:99px; padding:0 6px; font-weight:700; }
  .pa-hw-note { margin-top:6px; font-size:.7rem; color:#64748b; line-height:1.5; max-width:230px; }
  .tsel select { padding:4px 4px; border:1px solid #cbd5e1; border-radius:6px; font-size:.82rem; }
  .tsel-c { margin:0 2px; }
  @media (max-width: 720px) {
    .pa-table th:nth-child(5), .pa-table td:nth-child(5) { display:none; } /* 更新情報はスマホ非表示（ヒメ割列追加でズレたため5列目に） */
  }
</style>

<h1>⏰ 最速で遊べる時間</h1>

<div class="pa-refreshbar">
  <button type="button" class="pa-refresh-btn" onclick="location.reload()">🔄 最新の状態に更新</button>
  <span class="pa-refresh-time">表示: <?= date('n/j H:i:s') ?> 時点</span>
  <span class="pa-refresh-note">別のブラウザ・スマホで変更されている場合があります。<b>操作の前にこのボタンで最新化</b>してください（古い画面のまま保存すると上書きされます）。</span>
</div>

<?php $vlbl = ['auto' => '自動', 'today' => '本日', 'tomorrow' => '明日']; ?>
<div class="pa-viewtabs">
  <a class="pa-viewtab <?= $view === 'auto' ? 'is-active' : '' ?>" href="play-availability.php">自動</a>
  <a class="pa-viewtab <?= $view === 'today' ? 'is-active' : '' ?>" href="play-availability.php?view=today">本日 (<?= date('n/j', strtotime($bizDate)) ?>)</a>
  <a class="pa-viewtab <?= $view === 'tomorrow' ? 'is-active' : '' ?>" href="play-availability.php?view=tomorrow">明日 (<?= date('n/j', strtotime($nextDate)) ?>)</a>
  <span class="pa-viewtab-note"><?= $view === 'auto' ? '本日の出勤が終わった子は自動で「明日」を表示します' : ($view === 'tomorrow' ? '全員を明日（' . h(date('n/j', strtotime($nextDate))) . '）の設定として表示中' : '全員を本日（' . h(date('n/j', strtotime($bizDate))) . '）の設定として表示中') ?></span>
</div>

<?php if ($view === 'tomorrow'): ?>
  <div class="pa-next-note">📅 <b>明日（<?= h(date('n/j', strtotime($nextDate))) ?>）の仕込み</b>です。ここで保存した即姫は<b>媒体にはまだ出ません</b>。明日の朝5時を過ぎると自動で「本日」になり、botが媒体へ反映します。<br>※「今すぐ」「受付終了」は“いまの操作”なので本日のみです。明日は<b>時刻設定</b>で仕込んでください。</div>
<?php endif; ?>

<table class="pa-table">
  <tr>
    <th>キャスト</th>
    <th>現在の設定</th>
    <th>操作</th>
    <th>ヒメ割<br><span style="font-weight:400;color:#94a3b8">情報局のみ</span></th>
    <th>更新</th>
    <th>媒体ID</th>
  </tr>
  <?php foreach ($girls as $g):
    // 出勤終了を過ぎたか（本日出勤表を最優先・無ければ永続カラム。詳細は pa_shift_end_passed 参照）
    $isNext = !empty($g['is_next']);                       // この行が「明日(D+1)」の設定かどうか
    $rowBd  = $g['bd'];                                    // この行の営業日（保存先）
    // 明日行は未来なので「出勤終了を過ぎた」判定は不要（本日行のみ）
    $endPassed = $isNext ? false : pa_shift_end_passed($g['work_end'] ?? null, $g['shift_end_at'] ?? null, $rowBd);
    // 陳腐化した即姫を抑制: play_at がその営業日の窓（当日5:00〜翌5:00）の外＝別営業日の残骸なら無効。
    //   ★ 出勤開始との比較で判定してはいけない（2026-07-16 事故）: 出勤開始前に「今すぐ」を押して
    //     先に宣伝する運用は正当（21:00出勤の子に20:46「今すぐ」→ play_at=20:45）。開始との比較だと
    //     その正当な設定まで「―」に消され、店長からは「今すぐが登録できない」に見える。
    $playAt = $g['play_at'];
    if ($playAt && (strtotime($playAt) < strtotime($rowBd . ' 05:00:00')
                 || strtotime($playAt) >= strtotime($rowBd . ' 05:00:00 +1 day'))) $playAt = null;
    // 受付終了（出勤は継続・即ヒメ系のみ停止）は即姫プレビューより優先して表示
    $rcClosed = !empty($g['reception_closed']);
    [$prev, $cls] = $rcClosed ? ['🚫 受付終了（出勤中）', 'pa-closed'] : pa_preview($playAt, $g['status'], $endPassed);
    // 時刻セレクトのプリセット値も、出勤終了を過ぎていたら --:-- にする（プレビューと連動）
    $paPreset = (!$rcClosed && $g['status'] === 'active' && $playAt && !$endPassed) ? substr($playAt, 11, 5) : null;
    // 出勤バッジ: 本日=緑「本日 21:00〜01:00」/ 明日=青「明日 18:00〜02:00」/ 本日終了済=グレー
    $wkLabel = $g['work_start']
        ? ($isNext ? '明日' : ($endPassed ? '本日終了' : '本日')) . ' ' . substr($g['work_start'], 0, 5)
          . ($g['work_end'] ? '〜' . substr($g['work_end'], 0, 5) : '〜')
        : null;
    $wkCls = $isNext ? 'pa-work pa-work-next' : ($endPassed ? 'pa-work pa-work-done' : 'pa-work');
  ?>
  <tr>
    <td class="pa-name">
      <?= h($g['name']) ?>
      <?php if ($wkLabel): ?>
        <span class="<?= $wkCls ?>"><?= h($wkLabel) ?></span>
      <?php endif; ?>
    </td>
    <td class="pa-prev <?= $cls ?>"><?= h($prev) ?></td>
    <td>
      <div class="pa-forms">
        <form method="post">
          <?= csrf_field() ?>
          <?= $bdFields($g) ?>
          <input type="hidden" name="action" value="set">
          <input type="hidden" name="girl_id" value="<?= (int)$g['id'] ?>">
          <?= pa_time_select('pa', $paPreset, (string)$g['id']) ?>
          <button type="submit" class="pa-btn">時刻設定</button>
        </form>
        <?php if (!$isNext): /* 「今すぐ」は"いま"の操作＝本日のみ（明日は時刻設定で仕込む） */ ?>
        <form method="post">
          <?= csrf_field() ?>
          <?= $bdFields($g) ?>
          <input type="hidden" name="action" value="now">
          <input type="hidden" name="girl_id" value="<?= (int)$g['id'] ?>">
          <button type="submit" class="pa-btn pa-btn-now"><?= $rcClosed ? '受付再開（今すぐ）' : '今すぐ' ?></button>
        </form>
        <?php endif; ?>
        <?php if (!$isNext && $g['work_start'] && !$endPassed && !$rcClosed): /* 出勤中のみ。受付終了＝出勤は残して即ヒメ系だけ止める（退勤・出勤クリアとは別） */ ?>
        <form method="post">
          <?= csrf_field() ?>
          <?= $bdFields($g) ?>
          <input type="hidden" name="action" value="close">
          <input type="hidden" name="girl_id" value="<?= (int)$g['id'] ?>">
          <button type="submit" class="pa-btn pa-btn-close" onclick="return confirm('<?= h(addslashes($g['name'])) ?>を受付終了にしますか？\n\n・出勤（本日<?= h(substr($g['work_start'], 0, 5)) ?>〜）はそのまま残ります\n・即ヒメ／接客／待機だけ停止します\n・ヒメ割は掲載を続けます\n・再開は「今すぐ」か時刻設定でOK');">🚫 受付終了</button>
        </form>
        <?php endif; ?>
        <form method="post">
          <?= csrf_field() ?>
          <?= $bdFields($g) ?>
          <input type="hidden" name="action" value="clear">
          <input type="hidden" name="girl_id" value="<?= (int)$g['id'] ?>">
          <button type="submit" class="pa-btn pa-btn-clear" onclick="return confirm('<?= h(addslashes($g['name'])) ?>の即姫設定をクリアしますか？');">クリア</button>
        </form>
      </div>
    </td>
    <td>
      <?php
        // ヒメ割＝本日出勤があれば自動掲載（ON/OFF廃止・CLAUDE-HIMEWARI-AUTO.md）。
        // 期限＝出勤表の終了と連動（読み取り専用）。編集できるのは分・円のみ。
        $hwMin = $g['himewari_minutes'] !== null ? (int)$g['himewari_minutes'] : 70;
        $hwPrice = $g['himewari_price'] !== null ? (int)$g['himewari_price'] : 11000;
        $dayw = $isNext ? '明日' : '本日';   // この行の営業日ラベル
        if ($g['work_end']) {
            $hwSummary = '〜' . substr($g['work_end'], 0, 5) . '・' . $hwMin . '分/' . number_format($hwPrice) . '円';
            $hwCls = 'pa-hw-on';
        } else {
            $hwSummary = $dayw . '出勤なし';
            $hwCls = '';
        }
      ?>
      <details class="pa-media">
        <summary class="<?= $hwCls ?>"><?= h($hwSummary) ?></summary>
        <div class="pa-hw-note">期限＝<b>出勤表の終了と連動</b><?= $g['work_end'] ? '（' . h($dayw) . ' ' . h(substr($g['work_end'], 0, 5)) . ' まで）' : '（' . h($dayw) . '出勤なし＝掲載されません）' ?>。出勤終了を変えるときは <a href="schedules.php">出勤管理</a> で編集してください（この画面の即姫時刻では変わりません）。</div>
        <form method="post">
          <?= csrf_field() ?>
          <?= $bdFields($g) ?>
          <input type="hidden" name="action" value="himewari">
          <input type="hidden" name="girl_id" value="<?= (int)$g['id'] ?>">
          <label>分<br><input name="hw_min" value="<?= h($g['himewari_minutes'] ?? '') ?>" placeholder="70" style="width:56px"></label>
          <label>円<br><input name="hw_price" value="<?= h($g['himewari_price'] ?? '') ?>" placeholder="11000" style="width:72px"></label>
          <button type="submit" class="pa-btn">保存</button>
        </form>
      </details>
    </td>
    <td class="pa-meta">
      <?php if ($g['updated_at']): ?>
        <?= h(date('n/j H:i', strtotime($g['updated_at']))) ?><?= $g['updated_by'] ? '<br>' . h($g['updated_by']) : '' ?>
      <?php else: ?>—<?php endif; ?>
    </td>
    <td>
      <?php $hasMedia = $g['fujoho_girl_id'] || $g['ekichika_girl_id'] || $g['heaven_member_id'] || $g['fuzoku_girl_no'] || $g['deli_girl_no']; ?>
      <details class="pa-media">
        <summary><?= $hasMedia ? '設定済み ✏️' : '未設定 ＋' ?></summary>
        <form method="post">
          <?= csrf_field() ?>
          <?= $bdFields($g) ?>
          <input type="hidden" name="action" value="media">
          <input type="hidden" name="girl_id" value="<?= (int)$g['id'] ?>">
          <label>情報局<span class="pa-optional">任意・自動</span><br><input name="fujoho" value="<?= h($g['fujoho_girl_id'] ?? '') ?>" placeholder="通常は空欄でOK"></label>
          <label>駅ちか<br><input name="ekichika" value="<?= h($g['ekichika_girl_id'] ?? '') ?>" placeholder="girl_id"></label>
          <label>ヘブン<br><input name="heaven" value="<?= h($g['heaven_member_id'] ?? '') ?>" placeholder="c_member_id"></label>
          <label>風じゃ<br><input name="fuzoku" value="<?= h($g['fuzoku_girl_no'] ?? '') ?>" placeholder="girl_no"></label>
          <label>デリじゃ<br><input name="deli" value="<?= h($g['deli_girl_no'] ?? '') ?>" placeholder="girl_no"></label>
          <button type="submit" class="pa-btn">保存</button>
        </form>
      </details>
    </td>
  </tr>
  <?php endforeach; ?>
</table>

<script>
  // 時(左)を選んだら、分(右)が未選択のとき自動で「00」にする（出勤表 schedules.php と同じUX）。
  //   分の「00」は option value="0"。既に分が選ばれている場合は上書きしない。
  document.querySelectorAll('.tsel').forEach(function (cell) {
    var h = cell.querySelector('.tsel-h'), m = cell.querySelector('.tsel-m');
    if (h && m) h.addEventListener('change', function () {
      if (h.value !== '' && m.value === '') m.value = '0';
    });
  });
</script>

<?php layout_footer(); ?>
