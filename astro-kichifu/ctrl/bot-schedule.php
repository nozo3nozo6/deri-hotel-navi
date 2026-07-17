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
    'fujoho_sokuho' => [
        'tab'    => '情報局 速報',
        'h1'     => '📣 情報局 速報オート',
        'help'   => '情報局の「<b>速報！</b>」を5枠ローテで自動投稿します。<b>一定間隔</b>（初期10分）か、<b>指定時刻</b>のどちらかで実行できます。'
                  . '<br>1日の上限 <b>0＝無制限</b>（媒体が拒否するまで）。本文は「お知らせ」最新1件と固定枠のローテです。',
        'preset' => BOT_SCHEDULE_NEWS_10,
        'preset_label' => '既定10枠を入れる',
    ],
    'ekichika_news' => [
        'tab'    => '駅ちか ニュース',
        'h1'     => '🗞️ 駅ちか ニュースオート',
        'help'   => '駅ちか管理のニュース5カテゴリを順番に更新します。<b>一定間隔</b>（初期10分）か<b>指定時刻</b>で周期を変えられます（上限なし）。'
                  . '<br>※「掲載順位を上げる」（駅ちか上位表示タブ）とは別機能です。',
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
    $jmp = bot_schedule_job_meta($pjob);
    $mode = ($jmp['interval'] && ($_POST['mode'] ?? '') === 'interval') ? 'interval'
          : ($jmp['interval'] ? 'schedule' : 'schedule');   // 固定時刻系は常に schedule
    $in = [
        'enabled'     => isset($_POST['enabled']) ? 1 : 0,
        'daily_limit' => (int)($_POST['daily_limit'] ?? ($jmp['default_limit'] ?? 10)),
        // min_interval_sec は 2026-07-18 廃止（UIから入力欄なし＝既存維持）。
    ];
    if ($jmp['interval']) $in['mode'] = $mode;
    if ($mode === 'interval') {
        $in['interval_min'] = (int)($_POST['interval_min'] ?? 10);
    } else {
        $in['schedule'] = bot_schedule_parse_text((string)($_POST['schedule_text'] ?? ''));
    }
    $res = bot_schedule_save(db(), $shop, $pjob, $in, $admin['username'] ?? 'ctrl');
    if (isset($res['error'])) {
        flash('err', '保存できませんでした: ' . $res['error'] . '（時刻は HH:MM 形式で入力してください）');
    } else {
        if (($res['mode'] ?? '') === 'interval') {
            $lim = (int)$res['daily_limit'];
            $msg = $JOBS[$pjob]['tab'] . ' を保存しました（' . $res['interval_min'] . '分間隔・' . ($lim === 0 ? '上限なし' : '1日' . $lim . '回まで') . '・' . ($res['enabled'] ? 'ON' : 'OFF') . '）。次回のbot巡回から反映されます。';
        } else {
            $msg = $JOBS[$pjob]['tab'] . ' を保存しました（' . count($res['schedule']) . '件の時刻・' . ($res['enabled'] ? 'ON' : 'OFF') . '）。次回のbot巡回から反映されます。';
            if (!empty($res['_trimmed'])) $msg .= ' ※日次回数(' . $res['daily_limit'] . ')を超えた ' . $res['_trimmed'] . ' 件は早い時刻を優先して切り詰めました。';
        }
        flash('ok', $msg);
    }
    redirect('bot-schedule.php?job=' . urlencode($pjob));
}

$jm  = bot_schedule_job_meta($job);
$row = bot_schedule_fetch(db(), $shop, $job);
$cfg = $row ? bot_schedule_to_json($row) : [
    'enabled' => true, 'mode' => $jm['default_mode'], 'interval_min' => $jm['default_interval'],
    'daily_limit' => $jm['default_limit'], 'schedule' => [], 'updated_at' => null, 'updated_by' => null,
];
$scheduleText = implode("\n", $cfg['schedule']);
$meta = $JOBS[$job];
$isInterval = !empty($jm['interval']);                       // この job が周期モードを扱えるか
$curMode = $cfg['mode'] ?? 'schedule';                       // 現在の保存モード
$curIntMin = $cfg['interval_min'] !== null ? (int)$cfg['interval_min'] : ($jm['default_interval'] ?? 10);

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

  <?php if ($isInterval): ?>
  <div class="bs-row">
    <label class="lbl">実行方式</label>
    <label class="bs-toggle" style="font-weight:600"><input type="radio" name="mode" value="interval" <?= $curMode !== 'schedule' ? 'checked' : '' ?> data-bs-mode> 一定間隔</label>
    <label class="bs-toggle" style="font-weight:600"><input type="radio" name="mode" value="schedule" <?= $curMode === 'schedule' ? 'checked' : '' ?> data-bs-mode> 指定時刻リスト</label>
  </div>
  <div class="bs-row" id="bs-interval-row">
    <label class="lbl">間隔</label>
    <input class="bs-num" type="number" name="interval_min" min="1" max="120" value="<?= (int)$curIntMin ?>"> 分ごと（1〜120分）
    <span class="bs-meta" style="margin:0">※ 5分など10分未満にする場合は bot の巡回周期も合わせる必要があります（担当に連絡）。</span>
  </div>
  <div class="bs-row">
    <label class="lbl">1日の上限</label>
    <input class="bs-num" type="number" name="daily_limit" min="0" max="<?= (int)$jm['max'] ?>" value="<?= (int)$cfg['daily_limit'] ?>"> 回（<b>0＝無制限</b>・最大<?= (int)$jm['max'] ?>）
  </div>
  <?php else: ?>
  <div class="bs-row">
    <label class="lbl">1日の回数</label>
    <input class="bs-num" type="number" name="daily_limit" min="1" max="<?= (int)$jm['max'] ?>" value="<?= (int)$cfg['daily_limit'] ?>"> 回まで（1〜<?= (int)$jm['max'] ?>・実際は下の時刻リストの件数で実行）
  </div>
  <?php endif; ?>

  <div class="bs-row" style="display:block" id="bs-schedule-block">
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

  // 実行方式ラジオで「間隔（分）」と「時刻リスト」の表示を切替（interval系タブのみ）
  var modeRadios = document.querySelectorAll('[data-bs-mode]');
  var intervalRow = document.getElementById('bs-interval-row');
  var scheduleBlock = document.getElementById('bs-schedule-block');
  function applyMode() {
    if (!modeRadios.length) return;   // 固定時刻系タブは常に時刻リストのみ（切替なし）
    var m = document.querySelector('[data-bs-mode]:checked');
    var isInterval = m && m.value === 'interval';
    if (intervalRow) intervalRow.style.display = isInterval ? '' : 'none';
    if (scheduleBlock) scheduleBlock.style.display = isInterval ? 'none' : 'block';
  }
  modeRadios.forEach(function (r) { r.addEventListener('change', applyMode); });
  applyMode();
</script>

<?php layout_footer(); ?>
