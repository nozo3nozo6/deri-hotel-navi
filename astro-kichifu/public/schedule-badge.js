// ==========================================================================
// schedule-badge.js — 本日の出勤を取得して girlsカードにバッジ表示
//   SSG(ビルド時生成)のHTMLに対し、クライアントで最新の出勤を後付けする。
//   /girls 一覧と top の新人セクション（.girl-card[data-id]）で共用。
// ==========================================================================
(function () {
  'use strict';
  fetch('/api/schedules.php?action=today&shop_id=1', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.work) return;
      var work = data.work;
      document.querySelectorAll('.girl-card[data-id]').forEach(function (card) {
        if (card.closest('#schedule-grid')) return;          // 出勤セクションは大バッジ(worktime)を使うので除外
        if (card.querySelector('.girl-card-shukkin')) return; // 二重付与防止
        var w = work[card.getAttribute('data-id')];
        if (!w) return;
        var start = w.start || '', end = w.end || '', label;
        if (start && end) {
          var endLabel = (end < start) ? ('翌' + end) : end; // 終了<開始 = 翌日
          label = '本日 ' + start + '〜' + endLabel;
        } else {
          label = '本日出勤';
        }
        var badge = document.createElement('span');
        badge.className = 'girl-card-shukkin';
        badge.textContent = label;
        (card.querySelector('.girl-card-img-wrap') || card).appendChild(badge);
        card.classList.add('is-working');
      });
    })
    .catch(function () {});
})();
