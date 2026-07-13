<?php
// ==========================================================================
// play-availability.php — 最速で遊べる時間（即ヒメ正データ）
//   この画面が正（Single Source of Truth）。各媒体bot（情報局/駅ちか/ヘブン）が
//   api/play-availability.php を updated_at ポーリングで読んで媒体へ反映する。
//   ここからは媒体へ直接POSTしない（媒体操作は別bot＝スコープ外）。
//
//   仕様: 1キャスト有効1件（shop_id×girl_id UNIQUE・上書き更新）/ play_at はJST・5分刻み
//   「今すぐ」= 現在時刻を5分単位に切り下げ（→ play_at<=now で即「今すぐ遊べる」になる）
//   時刻指定で選択時刻が現在より過去なら翌日扱い（過去にしたい時は「今すぐ」を使う）
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

    $upsert = db()->prepare(
        'INSERT INTO play_availability (shop_id, girl_id, play_at, status, updated_by)
         VALUES (?,?,?,"active",?)
         ON DUPLICATE KEY UPDATE play_at=VALUES(play_at), status="active", updated_by=VALUES(updated_by)'
    );

    if ($action === 'set') {
        $hh = $_POST['pa_h'][$gid] ?? '';
        $mm = $_POST['pa_m'][$gid] ?? '';
        if ($hh === '' || $mm === '') { flash('err', $gname . ': 時と分を選択してください。'); redirect('play-availability.php'); }
        // 営業日（10:00〜翌5:00・5時区切り）で解釈: 10〜23時=当営業日 / 0〜9時=その深夜側（翌暦日）。
        // 過去時刻はそのまま保存（=「その時刻から遊べる」が既に来ている → プレビュー/媒体上は「今すぐ遊べる」。情報局と同じ解釈）
        $hh = (int)$hh; $mm = (int)$mm;
        $bizDate = date('Y-m-d', time() - 5 * 3600);
        $dateStr = ($hh >= 10) ? $bizDate : date('Y-m-d', strtotime($bizDate . ' +1 day'));
        $ts = strtotime($dateStr . sprintf(' %02d:%02d:00', $hh, $mm));
        $upsert->execute([$shop, $gid, date('Y-m-d H:i:00', $ts), $by]);
        flash('ok', $gname . ': ' . ($ts <= time()
            ? date('n/j H:i', $ts) . ' から遊べる（時刻が来ているので「今すぐ遊べる」表示）で保存しました。'
            : date('n/j H:i', $ts) . ' から遊べる、で保存しました。'));
        media_webhook_notify($shop, $gid, $gname, ['play_at', 'status']);
    } elseif ($action === 'now') {
        $ts = intdiv(time(), 300) * 300;                     // 5分切り下げ → play_at<=now で即「今すぐ」
        $upsert->execute([$shop, $gid, date('Y-m-d H:i:00', $ts), $by]);
        flash('ok', $gname . ': 「今すぐ遊べる（即姫）」で保存しました。');
        media_webhook_notify($shop, $gid, $gname, ['play_at', 'status']);
    } elseif ($action === 'clear') {
        $st = db()->prepare('UPDATE play_availability SET status="cleared", updated_by=? WHERE shop_id=? AND girl_id=?');
        $st->execute([$by, $shop, $gid]);
        flash('ok', $gname . ': クリアしました（媒体側は bot が取消します）。');
        media_webhook_notify($shop, $gid, $gname, ['play_at', 'status']);
    } elseif ($action === 'himewari') {
        // ヒメ割（情報局のみ・CLAUDE-HIMEWARI-AUTO.md）: 編集できるのは「分」「円」だけ。
        //   ON/OFFは廃止（本日出勤があれば自動掲載・出勤終了で自動取消＝bot側は shift_end_at と現在時刻のみで判断）。
        //   期限＝出勤表の終了と連動（APIが出勤表から直接導出）。ここでは終了時刻を触らない。
        //   分・円は NULL 可＝bot既定 70分/11000円。play_at(即姫)とは独立。
        $min   = ($_POST['hw_min'] ?? '') !== '' ? (int)$_POST['hw_min'] : null;
        $price = ($_POST['hw_price'] ?? '') !== '' ? (int)$_POST['hw_price'] : null;
        $st = db()->prepare(
            'INSERT INTO play_availability (shop_id, girl_id, play_at, status, himewari_minutes, himewari_price, updated_by)
             VALUES (?,?,NULL,"active",?,?,?)
             ON DUPLICATE KEY UPDATE himewari_minutes=VALUES(himewari_minutes),
                 himewari_price=VALUES(himewari_price), updated_by=VALUES(updated_by)'
        );
        $st->execute([$shop, $gid, $min, $price, $by]);
        flash('ok', $gname . ': ヒメ割の分・円を保存しました（' . ($min ?? 70) . '分 / ' . number_format($price ?? 11000) . '円' . ($min === null && $price === null ? '＝既定値' : '') . '）。期限は出勤表の終了と連動します。');
        media_webhook_notify($shop, $gid, $gname, ['himewari_minutes', 'himewari_price']);
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
        media_webhook_notify($shop, $gid, $gname, ['media_ids']);   // 不明フィールド→bot側は全ジョブ推定（媒体IDの張り替え直後に再反映させる）
    }
    redirect('play-availability.php');
}

// ============================================================ 一覧データ
$bizDate = date('Y-m-d', time() - 5 * 3600);   // 営業日（朝5時区切り、schedules と同じ）

$rows = db()->prepare(
    'SELECT g.id, g.name,
            pa.play_at, pa.shift_end_at, pa.himewari_enabled, pa.himewari_minutes, pa.himewari_price,
            pa.status, pa.updated_at, pa.updated_by,
            mi.fujoho_girl_id, mi.ekichika_girl_id, mi.heaven_member_id, mi.fuzoku_girl_no, mi.deli_girl_no,
            s.start_time AS work_start, s.end_time AS work_end
       FROM girls g
       JOIN girl_shops gs ON gs.girl_id = g.id AND gs.shop_id = :shop1
       LEFT JOIN play_availability pa ON pa.girl_id = g.id AND pa.shop_id = :shop2
       LEFT JOIN girl_media_ids mi   ON mi.girl_id = g.id AND mi.shop_id = :shop3
       LEFT JOIN schedules s ON s.girl_id = g.id AND s.shop_id = :shop4 AND s.work_date = :bd AND s.status = "work"
      WHERE g.is_display = 1
      ORDER BY (s.girl_id IS NULL), s.start_time, g.name'
);
$rows->execute([':shop1' => $shop, ':shop2' => $shop, ':shop3' => $shop, ':shop4' => $shop, ':bd' => $bizDate]);
$girls = $rows->fetchAll(PDO::FETCH_ASSOC);

// プレビュー文言（情報局と同じ考え方）。$shiftEndDt=play_availability.shift_end_at（出勤保存の
//   たびにP3で自動同期される永続カラム。s.end_time(本日bizDateのみJOIN)ではなくこちらを使う理由:
//   営業日切替直後(朝5時〜)は s.work_date=:今日bizDate のJOINが前日分の出勤にヒットしなくなり
//   終了判定が丸ごとスキップされ、古いplay_atが「今すぐ遊べる」のまま残り続けるバグがあったため。
//   終了時刻を過ぎていたら play_at が残っていても「―」表示にする（DBのplay_atは変更しない・
//   表示のみ。出勤が終わった後に古い時刻がいつまでも見え続けて紛らわしい問題への対応）。
function pa_preview(?string $playAt, ?string $status, ?string $shiftEndDt): array {
    if (!$playAt || $status !== 'active') return ['—', 'pa-none'];
    if ($shiftEndDt && strtotime($shiftEndDt) <= time()) return ['—', 'pa-none'];
    $ts = strtotime($playAt);
    if ($ts <= time()) return ['🔥 今すぐ遊べる（即姫）', 'pa-now'];
    $label = (date('Y-m-d', $ts) === date('Y-m-d')) ? date('H:i', $ts) : date('n/j H:i', $ts);
    return [$label . ' から遊べる', 'pa-future'];
}

layout_header('最速で遊べる時間', 'play-availability.php');
?>
<style>
  .pa-help { background:#f0fdfa; border:1px solid #99f6e4; border-radius:10px; padding:12px 16px; font-size:.82rem; line-height:1.7; margin-bottom:16px; }
  .pa-help table { border-collapse:collapse; margin-top:6px; }
  .pa-help th, .pa-help td { border:1px solid #a7e3d9; padding:3px 10px; font-size:.78rem; text-align:left; }
  .pa-help th { background:#e0f6f1; }
  .pa-table { width:100%; border-collapse:collapse; background:#fff; }
  .pa-table th, .pa-table td { border-bottom:1px solid #e5e7eb; padding:8px 10px; font-size:.85rem; vertical-align:middle; text-align:left; }
  .pa-table th { background:#f8fafc; font-size:.75rem; color:#475569; }
  .pa-name { font-weight:700; white-space:nowrap; }
  .pa-work { display:inline-block; margin-left:6px; font-size:.68rem; background:#0d9488; color:#fff; border-radius:99px; padding:1px 8px; vertical-align:middle; }
  .pa-prev { font-weight:700; white-space:nowrap; }
  .pa-now { color:#dc2626; }
  .pa-future { color:#0d9488; }
  .pa-none { color:#94a3b8; font-weight:400; }
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

<div class="pa-help">
  <b>この画面が正データです。</b>保存すると各媒体のbotがここを読んで自動反映します（この画面から媒体へ直接投稿はしません）。
  時刻は5分刻み・「その時刻から遊べる」の意味です。<b>過ぎた時刻を設定してもOK</b>＝すでに遊べる時間が来ている、として「🔥今すぐ遊べる（即姫）」表示になります。
  0〜9時台の時刻は深夜側（翌日の未明）として扱います。
  ※「今すぐ」ボタン＝現在時刻を即姫として保存するショートカットです（媒体への同期ボタンではありません。同期はbotが自動で行います）。
  <b>即姫（時刻設定・今すぐ）＝「遊べる開始時刻」</b>です。出勤終了・ヒメ割期限とは別で、互いに影響しません。
  <b>ヒメ割＝本日出勤があれば自動掲載</b>（情報局のみ・即姫とは独立・ON/OFF操作は不要です）。期限＝本日出勤の終了時刻に自動連動し、出勤終了を過ぎるとbotが自動取消します。<b>終了を変えたいときは出勤表を編集</b>してください。ここで変更できるのは分・円だけ（未設定は70分/11,000円）。
  <b>媒体ID</b>：情報局は名前一致でbotが自動解決するので<b>通常は空欄でOK</b>（同名がいる時だけ手入力で指定）。駅ちか・ヘブン・風じゃ・デリじゃは入力が必要です（未設定の媒体はbotがスキップ）。
  <table>
    <tr><th>媒体</th><th>反映（すべて別botが自動）</th></tr>
    <tr><td>口コミ情報局 すぐヒメ</td><td>変更時＋3分ごと自動再更新</td></tr>
    <tr><td>口コミ情報局 ヒメ割</td><td>終了時刻ベース・1分ごと自動再更新</td></tr>
    <tr><td>駅ちか 即ヒメ</td><td>変更時＋45分ごと</td></tr>
    <tr><td>ヘブン 即ヒメ</td><td>1日10回まで・ここぞで手動</td></tr>
    <tr><td>風じゃ／デリじゃ</td><td>READY・45分ごと</td></tr>
  </table>
</div>

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
    $shiftEndDt = $g['shift_end_at'] ?? null;                         // 永続カラム（P3同期・営業日境界の影響を受けない）
    $endPassed  = $shiftEndDt && strtotime($shiftEndDt) <= time();    // 出勤終了を過ぎたか
    [$prev, $cls] = pa_preview($g['play_at'], $g['status'], $shiftEndDt);
    // 時刻セレクトのプリセット値も、出勤終了を過ぎていたら --:-- にする（プレビューと連動）
    $paPreset = ($g['status'] === 'active' && $g['play_at'] && !$endPassed) ? substr($g['play_at'], 11, 5) : null;
  ?>
  <tr>
    <td class="pa-name">
      <?= h($g['name']) ?>
      <?php if ($g['work_start']): ?>
        <span class="pa-work">本日 <?= h(substr($g['work_start'], 0, 5)) ?>〜</span>
      <?php endif; ?>
    </td>
    <td class="pa-prev <?= $cls ?>"><?= h($prev) ?></td>
    <td>
      <div class="pa-forms">
        <form method="post">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="set">
          <input type="hidden" name="girl_id" value="<?= (int)$g['id'] ?>">
          <?= pa_time_select('pa', $paPreset, (string)$g['id']) ?>
          <button type="submit" class="pa-btn">時刻設定</button>
        </form>
        <form method="post">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="now">
          <input type="hidden" name="girl_id" value="<?= (int)$g['id'] ?>">
          <button type="submit" class="pa-btn pa-btn-now">今すぐ</button>
        </form>
        <form method="post">
          <?= csrf_field() ?>
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
        if ($g['work_end']) {
            $hwSummary = '〜' . substr($g['work_end'], 0, 5) . '・' . $hwMin . '分/' . number_format($hwPrice) . '円';
            $hwCls = 'pa-hw-on';
        } else {
            $hwSummary = '本日出勤なし';
            $hwCls = '';
        }
      ?>
      <details class="pa-media">
        <summary class="<?= $hwCls ?>"><?= h($hwSummary) ?></summary>
        <div class="pa-hw-note">期限＝<b>出勤表の終了と連動</b><?= $g['work_end'] ? '（本日 ' . h(substr($g['work_end'], 0, 5)) . ' まで）' : '（本日出勤なし＝掲載されません）' ?>。終了を変えるときは出勤表を編集してください。</div>
        <form method="post">
          <?= csrf_field() ?>
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

<?php layout_footer(); ?>
