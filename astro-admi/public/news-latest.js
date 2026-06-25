// ==========================================================================
// news-latest.js — top「最新情報」をページ読込ごとに最新化（デプロイ不要）
//   手動お知らせ(news) と 写メ日記(fujoho取込) を交互配置でマージ:
//   お知らせ最新 → 写メ日記最新 → お知らせ2番目 → 写メ日記2番目 …（上位6件）
//   shop は window.__SHOP_ID（kichifu=2 / admi=1）。両サイト共通コード。
// ==========================================================================
(function () {
  'use strict';
  var wrap = document.getElementById('top-news-list');
  if (!wrap) return;
  var shop = window.__SHOP_ID || 2;
  var ASSET = 'https://kichifu.com';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmtDate(s) {
    if (!s) return '';
    var d = s.slice(0, 10).split('-'), y = +d[0], mo = +d[1], da = +d[2];
    var w = '日月火水木金土'[new Date(y, mo - 1, da).getDay()];
    return y + '年' + mo + '月' + da + '日(' + w + ')' + (s.length > 10 ? ' ' + s.slice(11, 16).replace(/^0/, '') : '');
  }
  function card(it) {
    var isD = it.kind === 'diary';
    var date = fmtDate(it.posted_at);
    var plain = (it.body || '').replace(/<[^>]*>/g, '');
    var excerpt = plain.length > 40 ? plain.slice(0, 40) + '…' : plain;
    var href = isD ? (it.link_url || (it.girl_id ? '/girls/' + it.girl_id : '#')) : '/news/' + encodeURIComponent(it.id);
    var imgUrl = it.thumb ? (isD ? it.thumb : ASSET + (String(it.thumb).charAt(0) === '/' ? '' : '/') + it.thumb) : '';
    var thumb = imgUrl
      ? '<img src="' + imgUrl + '" alt="" width="80" height="80" loading="lazy" class="news-thumb">'
      : '<div class="news-no-thumb">📢</div>';
    var badge = isD ? '<span class="news-diary-badge">写メ日記</span>' : '';
    return '<a href="' + href + '" target="_self" class="news-item">' + thumb +
      '<div class="news-meta"><p class="news-date">' + esc(date) + badge + '</p>' +
      '<h3 class="news-title">' + esc(it.title) + '</h3>' +
      (excerpt ? '<p class="news-excerpt">' + esc(excerpt) + '</p>' : '') +
      '</div></a>';
  }

  Promise.all([
    fetch('/api/news.php?action=list&shop_id=' + shop, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch('/api/news.php?action=diaries&shop_id=' + shop + '&limit=8', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ]).then(function (res) {
    var nd = res[0], dd = res[1];
    var news = ((nd && nd.items) || []).map(function (n) {
      return { kind: 'news', id: n.id, title: n.title, thumb: n.thumb, body: n.body, posted_at: n.posted_at };
    });
    var diaries = ((dd && dd.diaries) || []).map(function (d) {
      return { kind: 'diary', girl_id: d.girl_id, link_url: d.link_url, title: d.title, thumb: d.image, body: d.body, posted_at: d.posted_at };
    });
    if (!news.length && !diaries.length) return;   // 両方失敗時は SSG のまま維持
    var feed = [];
    for (var i = 0; i < Math.max(news.length, diaries.length) && feed.length < 6; i++) {
      if (news[i]) feed.push(news[i]);
      if (diaries[i]) feed.push(diaries[i]);
    }
    wrap.innerHTML = feed.map(card).join('');
  });
})();
