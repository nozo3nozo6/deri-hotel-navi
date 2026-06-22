// ==========================================================================
// schedule-page.js — 出勤スケジュール
//   /schedule : 1週間の日付タブ（admi2888 風）で切替表示。
//   top など  : タブが無ければ本日の出勤のみ表示（従来動作）。
//   全 girls カード(初期hidden)のうち選択日の出勤のみ表示し、日付帯と出勤時間バッジを付与。
//   営業日は朝5時区切り（5時未満の出勤は前営業日扱い）。
// ==========================================================================
(function () {
  'use strict';
  var grid = document.getElementById('schedule-grid');
  if (!grid) return;
  var tabsEl = document.getElementById('schedule-tabs');

  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  // 出勤時間 早い順（営業日は朝5時区切り：5時未満は翌日＝遅い扱い）
  function sortKey(t) {
    if (!t) return 99999;
    var p = t.split(':'), h = parseInt(p[0], 10) || 0, m = parseInt(p[1], 10) || 0;
    if (h < 5) h += 24;
    return h * 60 + m;
  }
  function jstDate(ts) { return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }); } // YYYY-MM-DD
  function wdIndex(d) { return new Date(d + 'T00:00:00Z').getUTCDay(); }

  // 選択日の出勤をグリッドに描画
  function render(dateStr, work) {
    work = work || {};
    // 既存バッジ除去 & 全カード非表示（日切替対応）
    grid.querySelectorAll('.girl-card-worktime').forEach(function (b) { b.remove(); });
    grid.querySelectorAll('.girl-card').forEach(function (c) { c.style.display = 'none'; });

    // 日付帯「アドミ MM月DD日（曜）」
    var dateEl = document.getElementById('schedule-date');
    if (dateEl && dateStr) {
      var wd = WD[wdIndex(dateStr)], p = dateStr.split('-');
      dateEl.textContent = 'アドミ ' + parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日（' + wd + '）';
    }

    var ids = Object.keys(work).sort(function (a, b) { return sortKey(work[a].start) - sortKey(work[b].start); });
    var shown = 0;
    ids.forEach(function (id) {
      var card = grid.querySelector('.girl-card[data-id="' + id + '"]');
      if (!card) return;
      card.style.display = 'block';
      grid.appendChild(card); // 出勤時間の早い順に並べ替え（DOM末尾へ順に）
      shown++;
      var w = work[id], start = w.start || '', end = w.end || '';
      var endLabel = (start && end && end < start) ? ('翌' + end) : end;
      var badge = document.createElement('div');
      badge.className = 'girl-card-worktime';
      badge.textContent = (start && end ? start + '〜' + endLabel : '出勤');
      var wrap = card.querySelector('.girl-card-img-wrap');
      if (wrap) wrap.insertAdjacentElement('afterend', badge); // 写真の下＝サイズの下・タグの上
      else card.appendChild(badge);
    });

    var e = document.getElementById('schedule-empty');
    if (e) e.style.display = shown === 0 ? '' : 'none';
  }

  // ---- 週表示（/schedule、タブあり） ----
  if (tabsEl) {
    var baseTs = Date.now() - 5 * 3600 * 1000; // 営業日5時区切り
    var dates = [];
    for (var i = 0; i < 7; i++) dates.push(jstDate(baseTs + i * 86400000));
    var from = dates[0];

    fetch('/api/schedules.php?action=range&shop_id=1&from=' + from + '&days=7', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var dw = (data && data.days_work) || {};
        tabsEl.innerHTML = '';
        dates.forEach(function (d, idx) {
          var wi = wdIndex(d), p = d.split('-');
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'schedule-tab' + (idx === 0 ? ' is-active' : '') +
            (wi === 6 ? ' is-sat' : '') + (wi === 0 ? ' is-sun' : '');
          btn.setAttribute('role', 'tab');
          btn.dataset.date = d;
          btn.innerHTML = '<span class="schedule-tab-md">' + p[1] + '/' + p[2] +
            '</span><span class="schedule-tab-wd">(' + WD[wi] + ')</span>';
          btn.addEventListener('click', function () {
            tabsEl.querySelectorAll('.schedule-tab').forEach(function (t) { t.classList.remove('is-active'); });
            btn.classList.add('is-active');
            render(d, dw[d]);
          });
          tabsEl.appendChild(btn);
        });
        render(from, dw[from]); // 初期＝本日
      })
      .catch(function () {});
    return;
  }

  // ---- 本日のみ（top など、タブなし。従来動作） ----
  fetch('/api/schedules.php?action=today&shop_id=1', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) { if (data) render(data.date, data.work); })
    .catch(function () {});
})();
