// ==========================================================================
// news-latest.js — 「最新情報」をページ読込ごとに最新化（デプロイ不要）
//   お知らせ(news)のみ表示。※写メ日記(diary)のマージは撤去（2026-07-06）:
//   最新情報に日記を混ぜるとポイント対象の口コミ局ヒメ日記ウィジェットがクリックされなくなるため。
//   写メ日記は最新情報の下の HimeDiary ウィジェット（fujoho iframe）に集約。
//   対象コンテナ:
//     #top-news-list      … top「最新情報」（上位6件・小サムネ・h3・抜粋なし）
//     #news-archive-list  … /news 一覧（全件・大サムネ・h2・抜粋あり）
//   shop は window.__SHOP_ID（kichifu=2 / admi=1）。両サイト共通コード。
// ==========================================================================
(function () {
  'use strict';
  var topWrap  = document.getElementById('top-news-list');
  var archWrap = document.getElementById('news-archive-list');
  if (!topWrap && !archWrap) return;

  var shop = window.__SHOP_ID || 2;
  var ASSET = 'https://admi2888.com';   // 画像配信元（admi2888が正・kichifuはsymlink）

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
  function imgUrlOf(thumb) {
    if (!thumb) return '';
    return ASSET + (String(thumb).charAt(0) === '/' ? '' : '/') + thumb;
  }
  function excerptOf(body) {
    if (!body) return '';
    var plain = String(body)
      .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '') // style/script ブロックごと除去
      .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    return plain ? (plain.length > 80 ? plain.slice(0, 80) + '…' : plain) : '';
  }

  // top: 小サムネ・h3・抜粋なし
  function topCard(it) {
    var img = imgUrlOf(it.thumb);
    var thumb = img
      ? '<img src="' + img + '" alt="" width="64" height="80" loading="lazy" class="news-thumb">'
      : '<div class="news-no-thumb">📢</div>';
    return '<a href="/news/' + encodeURIComponent(it.id) + '" target="_self" class="news-item">' + thumb +
      '<div class="news-meta"><p class="news-date">' + esc(fmtDate(it.posted_at)) + '</p>' +
      '<h3 class="news-title">' + esc(it.title) + '</h3>' +
      '</div></a>';
  }

  // /news: 大サムネ・h2・抜粋あり
  function archCard(it, tw, th) {
    var img = imgUrlOf(it.thumb);
    var thumb = img
      ? '<img src="' + img + '" alt="" width="' + tw + '" height="' + th + '" loading="lazy" class="news-thumb">'
      : '<div class="news-no-thumb">📢</div>';
    var ex = excerptOf(it.body);
    return '<a href="/news/' + encodeURIComponent(it.id) + '" target="_self" class="news-item">' + thumb +
      '<div class="news-meta"><p class="news-date">' + esc(fmtDate(it.posted_at)) + '</p>' +
      '<h2 class="news-title">' + esc(it.title) + '</h2>' +
      (ex ? '<p class="news-excerpt">' + esc(ex) + '</p>' : '') +
      '</div></a>';
  }

  fetch('/api/news.php?action=list&shop_id=' + shop, { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (nd) {
      var news = ((nd && nd.items) || []);
      if (!news.length) return;   // 失敗/空時は SSG のまま維持

      if (topWrap) {
        topWrap.innerHTML = news.slice(0, 6).map(topCard).join('');
      }
      if (archWrap) {
        var tw = +archWrap.getAttribute('data-thumb-w') || 108;
        var th = +archWrap.getAttribute('data-thumb-h') || 144;
        archWrap.innerHTML = news.map(function (it) { return archCard(it, tw, th); }).join('');
        var empty = document.getElementById('news-empty');
        if (empty) empty.style.display = 'none';
      }
    })
    .catch(function () { /* SSGのまま維持 */ });
})();
