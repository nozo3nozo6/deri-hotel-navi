// ==========================================================================
// schedule-badge.js — 本日の出勤を取得して girlsカードにバッジ表示
//   SSG(ビルド時生成)のHTMLに対し、クライアントで最新の出勤を後付けする。
//   /girls 一覧と top の新人セクション（.girl-card[data-id]）で共用。
// ==========================================================================
(function () {
  'use strict';
  // 訳文つきの短い断片をspanで包む（admiI18n.reapplyで現在の言語に即置換される）
  function i18nSpan(key, fallback) { return '<span data-i18n="' + key + '">' + fallback + '</span>'; }
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
        var start = w.start || '', end = w.end || '', labelHtml;
        function fmtT(t) { return t ? t.replace(/^0/, '') : t; }
        if (start && end) {
          var endLabel = (end < start) ? (i18nSpan('schedule_next_day_prefix', '翌') + fmtT(end)) : fmtT(end); // 終了<開始 = 翌日
          labelHtml = i18nSpan('schedule_badge_today_prefix', '本日') + ' ' + fmtT(start) + '〜' + endLabel;
        } else {
          labelHtml = i18nSpan('schedule_badge_today_only', '本日出勤');
        }
        var badge = document.createElement('span');
        badge.className = 'girl-card-shukkin';
        badge.innerHTML = labelHtml;
        // 公式プロフ(footer)の先頭に置き、CSSでその上端＝サイズ帯とのと境目に中央リボン配置（absolute=レイアウト不変）
        var footer = card.querySelector('.girl-card-official');
        if (footer) footer.insertBefore(badge, footer.firstChild);
        else card.appendChild(badge);
        card.classList.add('is-working');
      });
      if (window.admiI18n) window.admiI18n.reapply(); // 挿入分に選択中の言語を即適用
    })
    .catch(function () {});
})();
