// ==========================================================================
// banner-latest.js — top 下部バナーをページ読込ごとに最新化（デプロイ不要）
//   下部バナーは top.astro のビルド時取得(SSG)。CTRL でバナーを追加/削除/差し替え/
//   リンク変更しても再デプロイまで反映されなかった（slider-latest.js のバナー版）。
//   署名比較（画像URL|リンクURL|タイトル）で差分がある時だけ作り直す＝チラつき防止。
//   全消し→セクション非表示 / 0→1枚目→セクション表示（top.astro はセクション常設）。
//   ※ ASSET_ORIGIN は admi2888.com（kichifu は symlink で同一実体）。
// ==========================================================================
(function () {
  'use strict';
  var section = document.querySelector('[data-bottom-banners]');
  if (!section) return;
  var grid = section.querySelector('.bottom-banner-grid');
  if (!grid) return;

  var shop = window.__SHOP_ID || 1;
  var ASSET = 'https://admi2888.com';

  function assetUrl(p) {
    if (!p) return '';
    if (/^https?:\/\//.test(p)) return p;
    return ASSET + (p.charAt(0) === '/' ? '' : '/') + p;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // 自サイト(admi2888/kichifu)への絶対URLは相対パス化＝閲覧中サイト内に留める（config.ts localUrl と同じ）
  function localUrl(u) {
    if (!u) return '';
    var rel = String(u).replace(/^https?:\/\/(www\.)?(admi2888\.com|kichifu\.com)(?=\/|$)/i, '');
    return rel === '' ? '/' : rel;
  }
  // top.astro の bottom-banner-item と同一構造
  function itemHtml(b) {
    var img = '<img src="' + esc(assetUrl(b.image)) + '" alt="' + esc(b.title) + '" loading="lazy" />';
    return b.url
      ? '<a href="' + esc(localUrl(b.url)) + '" target="_self" rel="noopener" class="bottom-banner-item">' + img + '</a>'
      : '<span class="bottom-banner-item">' + img + '</span>';
  }
  // 差分判定用の署名（画像URL＋リンクURL＋タイトル）。slider-latest.js と同方式。
  function liveSig(live) {
    return live.map(function (b) {
      // href は localUrl 適用後の値で描画されるので、署名も同じ値で比較（毎回再描画を防ぐ）
      return assetUrl(b.image) + '|' + localUrl(b.url) + '|' + (b.title || '');
    }).join('~~');
  }
  function currSig() {
    return [].map.call(grid.querySelectorAll('.bottom-banner-item'), function (el) {
      var im = el.querySelector('img');
      var href = el.tagName === 'A' ? (el.getAttribute('href') || '') : '';
      return (im ? (im.getAttribute('src') || '') : '') + '|' + href + '|' + (im ? (im.getAttribute('alt') || '') : '');
    }).join('~~');
  }

  fetch('/api/banners.php?type=bottom&shop_id=' + encodeURIComponent(shop), { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !Array.isArray(d.banners)) return;                 // 失敗時は SSG のまま
      var live = d.banners.filter(function (b) { return b.image; }); // 画像未設定は除外（SSGと同条件）

      // 全消し／最後の1枚の削除・非表示 → セクションを隠す（古いバナーを残さない）
      if (!live.length) {
        if (grid.children.length) grid.innerHTML = '';
        section.style.display = 'none';
        return;
      }

      // 画像・リンク・タイトルまで完全一致なら触らない（チラつき防止）
      if (liveSig(live) === currSig()) { section.style.display = ''; return; }

      grid.innerHTML = live.map(itemHtml).join('');
      section.style.display = '';                                   // 0枚SSG→1枚目の即反映
    })
    .catch(function () { /* 通信失敗時は SSG のまま */ });
})();
