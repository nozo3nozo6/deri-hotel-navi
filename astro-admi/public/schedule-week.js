// ==========================================================================
// schedule-week.js — 女の子プロフィールの「週間出勤予定」を描画（SSGページにクライアント取得）
//   #girl-week[data-girl-id] を探し、api/schedules.php?action=girl-week から7日分を取得して表示。
//   shop は window.__SHOP_ID（admi=1 / kichifu=2）。営業日は朝5時区切り（サーバー側 from で吸収）。
//   両サイト共通コード。API失敗・データ無しは静かに非表示（SSGを汚さない）。
// ==========================================================================
(function () {
  var box = document.getElementById('girl-week');
  if (!box) return;
  var gid = box.getAttribute('data-girl-id');
  if (!gid) return;
  var shop = window.__SHOP_ID || 1;
  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  function fmtT(t) { return t ? t.replace(/^0/, '') : t; }          // 09:00 → 9:00
  function wdIndex(ymd) { return new Date(ymd + 'T00:00:00Z').getUTCDay(); }
  function addDays(ymd, n) {
    var dt = new Date(ymd + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }

  fetch('/api/schedules.php?action=girl-week&girl_id=' + encodeURIComponent(gid) + '&shop_id=' + shop + '&days=7', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.from) { box.style.display = 'none'; return; }
      var sch = d.schedule || {};
      var days = d.days || 7;
      var rows = '', nWork = 0;
      for (var i = 0; i < days; i++) {
        var ymd = addDays(d.from, i);
        var wd = wdIndex(ymd);
        var info = sch[ymd];
        var md = (+ymd.slice(5, 7)) + '/' + (+ymd.slice(8, 10));
        var timeHtml, cls;
        if (info && info.status === 'work' && info.start) {
          nWork++;
          var endL = (info.end && info.end < info.start) ? '翌' + fmtT(info.end) : fmtT(info.end);
          timeHtml = '<span class="gw-time">' + fmtT(info.start) + '〜' + (info.end ? endL : '') + '</span>';
          cls = 'is-work';
        } else if (info && info.status === 'off') {
          timeHtml = '<span class="gw-off">お休み</span>';
          cls = 'is-off';
        } else {
          timeHtml = '<span class="gw-none">‑</span>';
          cls = 'is-none';
        }
        var dayCls = wd === 0 ? 'gw-sun' : (wd === 6 ? 'gw-sat' : '');
        rows += '<div class="gw-row ' + cls + (i === 0 ? ' is-today' : '') + '">'
              + '<span class="gw-date ' + dayCls + '">' + (i === 0 ? '<b>本日</b> ' : '') + md + '（' + WD[wd] + '）</span>'
              + timeHtml + '</div>';
      }
      var body = box.querySelector('.gw-body');
      if (nWork === 0) {
        body.innerHTML = '<div class="gw-empty">今週の出勤予定はまだ登録されていません。</div>';
      } else {
        body.innerHTML = rows;
      }
      box.style.display = '';
    })
    .catch(function () { box.style.display = 'none'; });
})();
