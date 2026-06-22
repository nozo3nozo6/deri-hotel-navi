// ==========================================================================
// schedule-page.js — 本日の出勤ページ(/schedule)用
//   全 girls カード(初期hidden)のうち本日出勤のみ表示し、日付帯と出勤時間バッジを付与。
// ==========================================================================
(function () {
  'use strict';
  fetch('/api/schedules.php?action=today&shop_id=1', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      var grid = document.getElementById('schedule-grid');
      if (!data || !grid) return;
      var work = data.work || {};

      // 日付帯「アドミ MM月DD日（曜）」
      var dateEl = document.getElementById('schedule-date');
      if (dateEl && data.date) {
        var d = new Date(data.date + 'T00:00:00+09:00');
        var wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
        var mm = d.getMonth() + 1;
        var dd = d.getDate();
        dateEl.textContent = 'アドミ ' + mm + '月' + dd + '日（' + wd + '）';
      }

      // 出勤時間 早い順（営業日は朝5時区切り：5時未満の出勤は翌日＝遅い扱い）
      function sortKey(t) {
        if (!t) return 99999;
        var p = t.split(':'), h = parseInt(p[0], 10) || 0, m = parseInt(p[1], 10) || 0;
        if (h < 5) h += 24;
        return h * 60 + m;
      }
      var workIds = Object.keys(work).sort(function (a, b) { return sortKey(work[a].start) - sortKey(work[b].start); });

      var shown = 0;
      workIds.forEach(function (id) {
        var card = grid.querySelector('.girl-card[data-id="' + id + '"]');
        if (!card) return;
        card.style.display = 'block';
        grid.appendChild(card); // 出勤時間の早い順に並べ替え（DOM末尾へ順に）
        shown++;
        if (!card.querySelector('.girl-card-worktime')) {
          var w = work[id], start = w.start || '', end = w.end || '';
          var endLabel = (start && end && end < start) ? ('翌' + end) : end;
          var badge = document.createElement('div');
          badge.className = 'girl-card-worktime';
          badge.textContent = (start && end ? start + '〜' + endLabel : '出勤');
          var wrap = card.querySelector('.girl-card-img-wrap');
          if (wrap) wrap.insertAdjacentElement('afterend', badge); // 写真の下＝サイズの下・タグの上
          else card.appendChild(badge);
        }
      });

      if (shown === 0) {
        var e = document.getElementById('schedule-empty');
        if (e) e.style.display = '';
      }
    })
    .catch(function () {});
})();
