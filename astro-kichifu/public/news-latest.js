// ==========================================================================
// news-latest.js — top の「最新情報」をページ読込ごとに最新化（デプロイ不要）
//   SSRで初期表示済みの #top-news-list を、news.php の最新4件で上書きする。
// ==========================================================================
(function () {
  'use strict';
  var wrap = document.getElementById('top-news-list');
  if (!wrap) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  fetch('/api/news.php?action=list&shop_id=2', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.items) return;
      var items = data.items.slice(0, 4);
      if (!items.length) { wrap.innerHTML = '<p class="empty-state">お知らせはまだありません</p>'; return; }
      var ASSET = 'https://kichifu.com';
      wrap.innerHTML = items.map(function (it) {
        var date = it.posted_at ? it.posted_at.slice(0, 10).replace(/-/g, '.') + (it.posted_at.length > 10 ? ' ' + it.posted_at.slice(11, 16).replace(/^0/, '') : '') : '';
        var plain = (it.body || '').replace(/<[^>]*>/g, '');
        var excerpt = plain.length > 40 ? plain.slice(0, 40) + '…' : plain;
        var thumb = it.thumb
          ? '<img src="' + ASSET + (String(it.thumb).charAt(0) === '/' ? '' : '/') + it.thumb + '" alt="" width="80" height="80" loading="lazy" class="news-thumb">'
          : '<div class="news-no-thumb">📢</div>';
        return '<a href="/news/' + encodeURIComponent(it.id) + '" class="news-item">' + thumb +
          '<div class="news-meta"><p class="news-date">' + esc(date) + '</p>' +
          '<h3 class="news-title">' + esc(it.title) + '</h3>' +
          (excerpt ? '<p class="news-excerpt">' + esc(excerpt) + '</p>' : '') +
          '</div></a>';
      }).join('');
    })
    .catch(function () {});
})();
