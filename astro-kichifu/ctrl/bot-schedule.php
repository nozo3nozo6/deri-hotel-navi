<?php
// ==========================================================================
// bot-schedule.php — 媒体自動更新の時刻設定（CLAUDE-EKICHIKA-BULKTOP.md / -NEWS.md）
//   店長が媒体ごとに ON/OFF・日次回数・実行時刻リストを編集する。保存すると bot(Grok)が
//   毎分GETで拾い、各媒体の自動実行に使う（媒体POSTはbotの持ち場）。
//   タブ: 駅ちか上位表示 / 風じゃ速報 / デリじゃ速報（?job= でタブ選択・保存は表示中jobのみ）。
//   保存ロジックは api/_bot-schedule.php に集約（api/bot-schedule.php と共通・二重実装しない）。
// ==========================================================================
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/../api/_bot-schedule.php';
$admin = require_login();
$shop  = current_shop_id();

// タブ定義（説明文・既定プリセットは job ごと）
$JOBS = [
    'ekichika_bulktop' => [
        'tab'    => '駅ちか 上位表示',
        'h1'     => '📈 駅ちか 上位表示オート',
        'help'   => '駅ちか管理画面の「<b>掲載順位を上げる</b>」を、<b>下に指定した時刻ちょうど</b>に自動実行します（bot が代行）。'
                  . '<br>1日の回数は<b>時刻リストの件数</b>です（最大 <b>38回</b>・媒体上限）。<b>指定時刻を過ぎた枠はスキップ</b>します（後からまとめて実行することはありません）。'
                  . '<br>エリア・市区町村・駅の<b>店舗一覧</b>で上位に出やすくなります。※ 駅ちかの「ニュース更新」とは別枠です。',
        'preset' => BOT_SCHEDULE_PRESET_35,
        'preset_label' => '既定35枠を入れる',
    ],
    'fuzoku_news' => [
        'tab'    => '風じゃ 速報',
        'h1'     => '📰 風じゃ 速報オート',
        'help'   => '風俗じゃぱんの<b>店舗速報</b>を、<b>指定時刻ちょうど</b>に自動投稿します（新規投稿・1日最大 <b>10回</b>）。'
                  . '<br>本文は「お知らせ」最新1件と固定枠(新人/イベント/割引)のローテです（時刻設定のみここで管理）。'
                  . '<br>駅ちか上位表示・デリじゃとは<b>別カウンタ</b>です。指定時刻を過ぎた枠はスキップします。',
        'preset' => BOT_SCHEDULE_NEWS_10,
        'preset_label' => '既定10枠を入れる',
    ],
    'deli_news' => [
        'tab'    => 'デリじゃ 速報',
        'h1'     => '📰 デリじゃ 速報オート',
        'help'   => 'デリヘルじゃぱんの<b>店舗速報</b>を、<b>指定時刻ちょうど</b>に自動投稿します（新規投稿・1日最大 <b>10回</b>）。'
                  . '<br>本文は「お知らせ」最新1件と固定枠のローテです。風じゃと同じ時刻表で始めていますが、<b>別設定</b>として保存されます。'
                  . '<br>指定時刻を過ぎた枠はスキップします。',
        'preset' => BOT_SCHEDULE_NEWS_10,
        'preset_label' => '既定10枠を入れる',
    ],
];

$job = (string)($_GET['job'] ?? 'ekichika_bulktop');
if (!isset($JOBS[$job])) $job = 'ekichika_bulktop';

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $pjob = (string)($_POST['job'] ?? '');
    if (!isset($JOBS[$pjob])) { flash('err', '対象が不正です。'); redirect('bot-schedule.php'); }
    $times = bot_schedule_parse_text((string)($_POST['schedule_text'] ?? ''));
    $in = [
        'enabled'     => isset($_POST['enabled']) ? 1 : 0,
        'daily_limit' => (int)($_POST['daily_limit'] ?? 10),
        'schedule'    => $times,
        // min_interval_sec は 2026-07-18 廃止（bot は時刻表どおりのみ実行）。UIから入力欄なし＝既存維持。
    ];
    $res = bot_schedule_save(db(), $shop, $pjob, $in, $admin['username'] ?? 'ctrl');
    if (isset($res['error'])) {
        flash('err', '保存できませんでした: ' . $res['error'] . '（時刻は HH:MM 形式で入力してください）');
    } else {
        $msg = $JOBS[$pjob]['tab'] . ' を保存しました（' . count($res['schedule']) . '件の時刻・' . ($res['enabled'] ? 'ON' : 'OFF') . '）。次回のbot巡回から反映されます。';
        if (!empty($res['_trimmed'])) $msg .= ' ※日次回数(' . $res['daily_limit'] . ')を超えた ' . $res['_trimmed'] . ' 件は早い時刻を優先して切り詰めました。';
        flash('ok', $msg);
    }
    redirect('bot-schedule.php?job=' . urlencode($pjob));
}

$jm  = bot_schedule_job_meta($job);
$row = bot_schedule_fetch(db(), $shop, $job);
$cfg = $row ? bot_schedule_to_json($row) : [
    'enabled' => true, 'daily_limit' => $jm['default_limit'], 'schedule' => [], 'updated_at' => null, 'updated_by' => null,
];
$scheduleText = implode("\n", $cfg['schedule']);
$meta = $JOBS[$job];

layout_header('媒体自動更新', 'bot-schedule.php');
?>
<style>
  .bs-tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px; }
  .bs-tab { border:1px solid #cbd5e1; background:#fff; color:#475569; border-radius:9px 9px 0 0; padding:9px 18px; font-size:.9rem; font-weight:700; text-decoration:none; white-space:nowrap; }
  .bs-tab.is-active { background:#0d9488; border-color:#0d9488; color:#fff; }
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

<h1><?= $meta['h1'] ?></h1>

<div class="bs-tabs">
  <?php foreach ($JOBS as $k => $m): ?>
    <a class="bs-tab <?= $k === $job ? 'is-active' : '' ?>" href="bot-schedule.php?job=<?= urlencode($k) ?>"><?= h($m['tab']) ?></a>
  <?php endforeach; ?>
</div>

<div class="bs-help"><?= $meta['help'] ?><br>保存すると次回のbot巡回（毎分の見張り）から反映されます。</div>

<form method="post" class="bs-card">
  <?= csrf_field() ?>
  <input type="hidden" name="job" value="<?= h($job) ?>">
  <div class="bs-row">
    <label class="lbl">自動実行</label>
    <label class="bs-toggle"><input type="checkbox" name="enabled" value="1" <?= $cfg['enabled'] ? 'checked' : '' ?>> ON にする（OFFにすると bot はこの媒体を更新しません）</label>
  </div>
  <div class="bs-row">
    <label class="lbl">1日の回数</label>
    <input class="bs-num" type="number" name="daily_limit" min="1" max="<?= (int)$jm['max'] ?>" value="<?= (int)$cfg['daily_limit'] ?>"> 回まで（1〜<?= (int)$jm['max'] ?>・実際は下の時刻リストの件数で実行）
  </div>
  <div class="bs-row" style="display:block">
    <label class="lbl" style="display:block;margin-bottom:6px">実行時刻（HH:MM を改行かカンマ区切りで）</label>
    <div class="bs-meta" style="margin:0 0 6px">1行1時刻。<b>その時刻の分に1回だけ</b>実行します（例: <code>22:45</code> → 毎日 22時45分）。</div>
    <div class="bs-presets">
      <button type="button" class="bs-preset" data-preset="default"><?= h($meta['preset_label']) ?></button>
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
  <div style="margin-top:16px"><button class="btn btn-primary" type="submit"><?= h($meta['tab']) ?> を保存する</button></div>
</form>

<script>
  var PRESET = <?= json_encode(array_values($meta['preset'])) ?>;
  var ta = document.getElementById('bs-times');
  var countEl = document.getElementById('bs-count');
  function parse(text) {
    return (text || '').replace(/[：]/g, ':').replace(/[、　]/g, ' ')
      .split(/[\s,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function updateCount() { countEl.textContent = '現在 ' + parse(ta.value).length + ' 件'; }
  ta.addEventListener('input', updateCount);
  document.querySelectorAll('.bs-preset').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var p = btn.getAttribute('data-preset');
      if (p === 'default') ta.value = PRESET.join('\n');
      else if (p === 'clear') ta.value = '';
      else if (p === 'sort') {
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
