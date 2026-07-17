<?php
// ==========================================================================
// bot-schedule.php — 駅ちか「上位表示」自動実行の時刻設定（CLAUDE-EKICHIKA-BULKTOP.md）
//   店長が ON/OFF・日次回数・実行時刻リストを編集する。保存すると bot(Grok)が毎分GETで拾い、
//   駅ちか管理画面「掲載順位を上げる」を指定時刻に自動実行する（媒体POSTはbotの持ち場）。
//   保存ロジックは api/_bot-schedule.php に集約（api/bot-schedule.php と共通・二重実装しない）。
// ==========================================================================
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/../api/_bot-schedule.php';
$admin = require_login();
$shop  = current_shop_id();

// 現状 UI で扱う job は駅ちか上位表示のみ（将来 job 追加時はここを配列化）
const BS_JOB = 'ekichika_bulktop';
const BS_JOB_LABEL = '駅ちか 上位表示（掲載順位アップ）';

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $times = bot_schedule_parse_text((string)($_POST['schedule_text'] ?? ''));
    $in = [
        'enabled'          => isset($_POST['enabled']) ? 1 : 0,
        'daily_limit'      => (int)($_POST['daily_limit'] ?? 35),
        'min_interval_sec' => (int)($_POST['min_interval_sec'] ?? 60),
        'schedule'         => $times,
    ];
    $res = bot_schedule_save(db(), $shop, BS_JOB, $in, $admin['username'] ?? 'ctrl');
    if (isset($res['error'])) {
        flash('err', '保存できませんでした: ' . $res['error'] . '（時刻は HH:MM 形式で入力してください）');
    } else {
        $msg = '保存しました（' . count($res['schedule']) . '件の時刻・' . ($res['enabled'] ? 'ON' : 'OFF') . '）。次回のbot巡回から反映されます。';
        if (!empty($res['_trimmed'])) $msg .= ' ※日次回数(' . $res['daily_limit'] . ')を超えた ' . $res['_trimmed'] . ' 件は早い時刻を優先して切り詰めました。';
        flash('ok', $msg);
    }
    redirect('bot-schedule.php');
}

$row = bot_schedule_fetch(db(), $shop, BS_JOB);
$cfg = $row ? bot_schedule_to_json($row) : [
    'enabled' => true, 'daily_limit' => 35, 'min_interval_sec' => 60, 'schedule' => [], 'updated_at' => null, 'updated_by' => null,
];
$scheduleText = implode("\n", $cfg['schedule']);

layout_header('駅ちか 上位表示オート', 'bot-schedule.php');
?>
<style>
  .bs-help { background:#f0fdfa; border:1px solid #99f6e4; border-radius:10px; padding:12px 16px; font-size:.82rem; line-height:1.7; margin-bottom:16px; }
  .bs-card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:18px 20px; max-width:640px; }
  .bs-row { display:flex; gap:14px; align-items:center; flex-wrap:wrap; margin-bottom:16px; }
  .bs-row label.lbl { font-weight:700; font-size:.9rem; min-width:110px; }
  .bs-toggle { display:inline-flex; align-items:center; gap:8px; font-weight:700; }
  .bs-num { width:80px; padding:7px 9px; border:1px solid #cbd5e1; border-radius:8px; }
  .bs-times { width:100%; min-height:200px; font-family:ui-monospace,monospace; font-size:.9rem; line-height:1.6; padding:10px; border:1px solid #cbd5e1; border-radius:8px; }
  .bs-count { font-size:.8rem; color:#0d9488; font-weight:700; }
  .bs-presets { display:flex; gap:8px; flex-wrap:wrap; margin:8px 0; }
  .bs-preset { border:1px solid #cbd5e1; background:#f8fafc; border-radius:8px; padding:5px 12px; font-size:.78rem; cursor:pointer; }
  .bs-preset:hover { background:#f0fdfa; border-color:#0d9488; }
  .bs-meta { font-size:.75rem; color:#94a3b8; margin-top:4px; }
</style>

<h1>📈 駅ちか 上位表示オート</h1>

<div class="bs-help">
  駅ちか管理画面の「<b>掲載順位を上げる</b>」を、指定した時刻に自動実行します（bot が代行）。<br>
  1日最大 <b>38回</b>（媒体上限）、連続実行は最低 <b>1分</b> 空けます。エリア・市区町村・駅の<b>店舗一覧</b>で上位に出やすくなります。<br>
  ※ 駅ちかの「ニュース更新」とは別枠です。保存すると次回のbot巡回（毎分）から反映されます。
</div>

<form method="post" class="bs-card">
  <?= csrf_field() ?>
  <div class="bs-row">
    <label class="lbl">自動実行</label>
    <label class="bs-toggle"><input type="checkbox" name="enabled" value="1" <?= $cfg['enabled'] ? 'checked' : '' ?>> ON にする（OFFにすると bot は上位表示しません）</label>
  </div>
  <div class="bs-row">
    <label class="lbl">1日の回数</label>
    <input class="bs-num" type="number" name="daily_limit" min="1" max="38" value="<?= (int)$cfg['daily_limit'] ?>"> 回（1〜38・媒体上限38）
  </div>
  <div class="bs-row">
    <label class="lbl">最短間隔</label>
    <input class="bs-num" type="number" name="min_interval_sec" min="60" step="10" value="<?= (int)$cfg['min_interval_sec'] ?>"> 秒（60以上・媒体注意）
  </div>
  <div class="bs-row" style="display:block">
    <label class="lbl" style="display:block;margin-bottom:6px">実行時刻（HH:MM を改行かカンマ区切りで）</label>
    <div class="bs-presets">
      <button type="button" class="bs-preset" data-preset="35">既定35枠を入れる</button>
      <button type="button" class="bs-preset" data-preset="sort">昇順に整える</button>
      <button type="button" class="bs-preset" data-preset="clear">全消し</button>
    </div>
    <textarea class="bs-times" id="bs-times" name="schedule_text" spellcheck="false" placeholder="10:00&#10;12:00&#10;18:00"><?= h($scheduleText) ?></textarea>
    <div class="bs-count" id="bs-count"></div>
    <div class="bs-meta">保存時に自動で「重複除去・ゼロ埋め・昇順」に整えます。回数を超えた分は早い時刻を優先して切り詰めます。</div>
  </div>
  <?php if ($cfg['updated_at']): ?>
    <div class="bs-meta">最終更新: <?= h(date('Y/n/j H:i', strtotime($cfg['updated_at']))) ?><?= $cfg['updated_by'] ? ' / ' . h($cfg['updated_by']) : '' ?></div>
  <?php endif; ?>
  <div style="margin-top:16px"><button class="btn btn-primary" type="submit">保存する</button></div>
</form>

<script>
  var PRESET_35 = <?= json_encode(BOT_SCHEDULE_PRESET_35) ?>;
  var ta = document.getElementById('bs-times');
  var countEl = document.getElementById('bs-count');
  function parse(text) {
    return (text || '').replace(/[：]/g, ':').replace(/[、　]/g, ' ')
      .split(/[\s,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function updateCount() {
    var n = parse(ta.value).length;
    countEl.textContent = '現在 ' + n + ' 件';
  }
  ta.addEventListener('input', updateCount);
  document.querySelectorAll('.bs-preset').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var p = btn.getAttribute('data-preset');
      if (p === '35') ta.value = PRESET_35.join('\n');
      else if (p === 'clear') ta.value = '';
      else if (p === 'sort') {
        // 重複除去・ゼロ埋め・昇順（不正な値はそのまま末尾に残す＝保存時にサーバーが弾く）
        var seen = {}, good = [], bad = [];
        parse(ta.value).forEach(function (t) {
          var m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t);
          if (m) { var v = (m[1].length < 2 ? '0' + m[1] : m[1]) + ':' + m[2]; if (!seen[v]) { seen[v] = 1; good.push(v); } }
          else bad.push(t);
        });
        good.sort();
        ta.value = good.concat(bad).join('\n');
      }
      updateCount();
    });
  });
  updateCount();
</script>

<?php layout_footer(); ?>
