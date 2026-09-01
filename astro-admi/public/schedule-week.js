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
  // 訳文つきの短い断片をspanで包む（admiI18n.reapplyで現在の言語に即置換される）
  function i18nSpan(key, fallback) { return '<span data-i18n="' + key + '">' + fallback + '</span>'; }

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
          var endL = (info.end && info.end < info.start) ? i18nSpan('schedule_next_day_prefix', '翌') + fmtT(info.end) : fmtT(info.end);
          timeHtml = '<span class="gw-time">' + fmtT(info.start) + '〜' + (info.end ? endL : '') + '</span>';
          // 先の日(前日予約の日)は出勤タイムラインを表示（予約が無くても空バー＝空きあり）。当日(i===0)は日付＋時間のみ（店長要望 2026-08-14）。
          // 終了時刻(end)がある時だけ軸が引ける。未定/ラストの日はバー無し
          if (i !== 0 && info.end) {
            var nx = function (t) { return (+String(t).slice(0, 2) < 10 ? i18nSpan('schedule_next_day_prefix', '翌') : '') + fmtT(t); };
            var nxT = function (t) { return (+String(t).slice(0, 2) < 10 ? '翌' : '') + fmtT(t); };   // title用（タグを入れられない）
            var toMin = function (t) { var a = String(t).split(':'); return (+a[0]) * 60 + (+a[1]); };
            // 営業日は 10:00〜翌10:00。10時より前は「翌日側」として +24時間で見る。
            // 出勤開始との大小で翌日判定していた頃は、出勤より少し前に始まる予約
            //   （例: 出勤20:00 / 予約19:45〜21:25）を翌19:45と誤解してバーから消えていた（店長指摘 2026-08-19）
            var bizMin = function (t) { var m = toMin(t); return m < 600 ? m + 1440 : m; };
            var hm = function (m) { m = ((m % 1440) + 1440) % 1440; return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); };
            var booked = info.booked || [];
            var ws = bizMin(info.start), we = bizMin(info.end); if (we <= ws) we += 1440;
            var span = (we - ws) || 1, blocks = '';
            // 出勤枠に収めた予約。バーとチップで同じ時間を出す（片方だけ枠外だと食い違って見える）
            var vis = [];
            booked.forEach(function (bk) {
              var bs = bizMin(bk.start);
              var be = bk.end ? bizMin(bk.end) : bs + 30; if (be <= bs) be += 1440;
              if (be <= ws || bs >= we) return;              // 出勤枠の外は出さない
              vis.push({ s: Math.max(bs, ws), e: Math.min(be, we) });
            });
            vis.sort(function (a, b) { return a.s - b.s; });
            vis.forEach(function (v, vi) {
              var l = (v.s - ws) / span * 100, w = (v.e - v.s) / span * 100;
              // 帯が細いと「ご予約済」が切れて読めないので、狭いときは文字を出さない（色だけで示す）。
              // 予約が3件以上ある日はどうしても1本ずつが細くなるため（店長要望 2026-08-19）
              var label = w >= 16 ? '<span class="gw-tl-in" data-i18n="schedule_slot_reserved">ご予約済</span>' : '';
              // --gw-i = 左から何番目か。光がこの順に流れる（同時に光らせない・店長要望 2026-08-19）
              blocks += '<span class="gw-tl-bk" style="--gw-i:' + vi + ';left:' + l.toFixed(2) + '%;width:' + w.toFixed(2) + '%" title="' + (nxT(hm(v.s)) + '〜' + nxT(hm(v.e))) + '">'
                      + label + '</span>';
            });
            var tl = '<div class="gw-tl"><div class="gw-tl-track">' + blocks + '</div>'
                   + '<div class="gw-tl-ends"><span>' + fmtT(info.start) + '</span><span>' + endL + '</span></div></div>';
            var chips = vis.length
              ? '<span class="gw-booked">' + vis.map(function (v) {
                  // スマホでは「ご予約済」の文字をCSSで隠して時間だけにする（3件以上でも1行に並ぶように）。
                  // 隠しても意味が分かるよう ✓ を頭に付け、title には従来どおり全文を入れる
                  return '<span class="gw-bk" title="' + (nxT(hm(v.s)) + '〜' + nxT(hm(v.e))) + ' ご予約済">'
                       + '<span class="gw-bk-t">' + nx(hm(v.s)) + '〜' + nx(hm(v.e)) + '</span> '
                       + '<span class="gw-bk-l">' + i18nSpan('schedule_slot_reserved', 'ご予約済') + '</span></span>';
                }).join('') + '</span>'
              : '';
            timeHtml += tl + chips;
          }
          cls = 'is-work';
        } else if (info && info.status === 'off') {
          timeHtml = '<span class="gw-off" data-i18n="schedule_week_off">お休み</span>';
          cls = 'is-off';
        } else {
          timeHtml = '<span class="gw-none">‑</span>';
          cls = 'is-none';
        }
        var dayCls = wd === 0 ? 'gw-sun' : (wd === 6 ? 'gw-sat' : '');
        rows += '<div class="gw-row ' + cls + (i === 0 ? ' is-today' : '') + '" data-d="' + ymd + '">'
              + '<span class="gw-date ' + dayCls + '">' + (i === 0 ? '<b data-i18n="schedule_badge_today_prefix">本日</b> ' : '') + md + '（' + WD[wd] + '）</span>'
              + timeHtml + '</div>';
      }
      var body = box.querySelector('.gw-body');
      if (nWork === 0) {
        body.innerHTML = '<div class="gw-empty" data-i18n="schedule_week_empty">今週の出勤予定はまだ登録されていません。</div>';
      } else {
        body.innerHTML = rows;
      }
      box.style.display = '';
      if (window.admiI18n) window.admiI18n.reapply(); // 挿入分に選択中の言語を即適用
      // 前日予約バーから「?rd=YYYY-MM-DD」で来たら、その日のタイムライン付近まで送り、行を強調する
      try {
        var rd = (new URLSearchParams(location.search)).get('rd');
        if (rd) {
          var trow = body.querySelector('.gw-row[data-d="' + rd + '"]');
          if (trow) { trow.classList.add('gw-hl'); setTimeout(function () { trow.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 250); }
        }
      } catch (e) {}
    })
    .catch(function () { box.style.display = 'none'; });
})();
