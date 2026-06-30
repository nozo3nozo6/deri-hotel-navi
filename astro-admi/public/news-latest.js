// ==========================================================================
// news-latest.js — 「最新情報」をページ読込ごとに最新化（デプロイ不要）
//   手動お知らせ(news) と 写メ日記(fujoho取込) を交互配置でマージ:
//   お知らせ最新 → 写メ日記最新 → お知らせ2番目 → 写メ日記2番目 …
//   対象コンテナ:
//     #top-news-list      … top「最新情報」（上位6件・小サムネ・h3・抜粋なし）
//     #news-archive-list  … /news 一覧（全件・大サムネ・h2・お知らせのみ抜粋）
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
  function fmtDate(s, diary) {
    if (!s) return '';
    var d = s.slice(0, 10).split('-'), y = +d[0], mo = +d[1], da = +d[2];
    var w = '日月火水木金土'[new Date(y, mo - 1, da).getDay()];
    return (diary ? '' : y + '年') + mo + '月' + da + '日(' + w + ')' + (s.length > 10 ? ' ' + s.slice(11, 16).replace(/^0/, '') : '');
  }
  function imgUrlOf(it) {
    if (!it.thumb) return '';
    var isD = it.kind === 'diary';
    // 写メ日記は fujoho の絶対URL。お知らせは相対パス→ASSET 前置。
    return isD ? it.thumb : (ASSET + (String(it.thumb).charAt(0) === '/' ? '' : '/') + it.thumb);
  }
  function hrefOf(it) {
    return it.kind === 'diary' ? '/diary/' + encodeURIComponent(it.id) : '/news/' + encodeURIComponent(it.id);
  }
  function excerptOf(it) {
    if (!it.body) return '';
    var plain = String(it.body)
      .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '') // style/script ブロックごと除去
      .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    return plain ? (plain.length > 80 ? plain.slice(0, 80) + '…' : plain) : '';
  }

  // top: 小サムネ・h3・抜粋なし
  function topCard(it) {
    var isD = it.kind === 'diary';
    var img = imgUrlOf(it);
    var thumb = img
      ? '<img src="' + img + '" alt="" width="64" height="80" loading="lazy" class="news-thumb">'
      : '<div class="news-no-thumb">📢</div>';
    var badge = isD ? '<span class="news-diary-badge">写メ日記</span>' : '';
    return '<a href="' + hrefOf(it) + '" target="_self" class="news-item">' + thumb +
      '<div class="news-meta"><p class="news-date">' + badge + esc(fmtDate(it.posted_at, isD)) + '</p>' +
      '<h3 class="news-title">' + esc(it.title) + '</h3>' +
      '</div></a>';
  }

  // /news: 大サムネ・h2・お知らせのみ抜粋
  function archCard(it, tw, th) {
    var isD = it.kind === 'diary';
    var img = imgUrlOf(it);
    var thumb = img
      ? '<img src="' + img + '" alt="" width="' + tw + '" height="' + th + '" loading="lazy" class="news-thumb">'
      : '<div class="news-no-thumb">📢</div>';
    var badge = isD ? '<span class="news-diary-badge">写メ日記</span>' : '';
    var ex = isD ? '' : excerptOf(it);
    return '<a href="' + hrefOf(it) + '" target="_self" class="news-item">' + thumb +
      '<div class="news-meta"><p class="news-date">' + badge + esc(fmtDate(it.posted_at, isD)) + '</p>' +
      '<h2 class="news-title">' + esc(it.title) + '</h2>' +
      (ex ? '<p class="news-excerpt">' + esc(ex) + '</p>' : '') +
      '</div></a>';
  }

  function mergeFeed(news, diaries, cap) {
    var feed = [];
    for (var i = 0; i < Math.max(news.length, diaries.length) && feed.length < cap; i++) {
      if (news[i]) feed.push(news[i]);
      if (diaries[i] && feed.length < cap) feed.push(diaries[i]);
    }
    return feed;
  }

  Promise.all([
    fetch('/api/news.php?action=list&shop_id=' + shop, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch('/api/news.php?action=diaries&shop_id=' + shop + '&limit=30', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ]).then(function (res) {
    var nd = res[0], dd = res[1];
    var news = ((nd && nd.items) || []).map(function (n) {
      return { kind: 'news', id: n.id, title: n.title, thumb: n.thumb, body: n.body, posted_at: n.posted_at };
    });
    var diaries = ((dd && dd.diaries) || []).map(function (d) {
      return { kind: 'diary', id: d.id, girl_id: d.girl_id, link_url: d.link_url, title: d.title, thumb: d.image, body: d.body, posted_at: d.posted_at };
    });
    if (!news.length && !diaries.length) return;   // 両方失敗時は SSG のまま維持

    if (topWrap) {
      topWrap.innerHTML = mergeFeed(news, diaries, 6).map(topCard).join('');
    }
    if (archWrap) {
      var tw = +archWrap.getAttribute('data-thumb-w') || 108;
      var th = +archWrap.getAttribute('data-thumb-h') || 144;
      archWrap.innerHTML = mergeFeed(news, diaries, 999).map(function (it) { return archCard(it, tw, th); }).join('');
      var empty = document.getElementById('news-empty');
      if (empty) empty.style.display = 'none';
    }
  });
})();
