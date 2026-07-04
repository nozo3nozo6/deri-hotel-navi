// ==========================================================================
// slider-latest.js — top ヒーロースライダーをページ読込ごとに最新化（デプロイ不要）
//   ヒーロースライダーは top.astro のビルド時取得(SSG)。CTRL でスライダーを
//   追加/削除/並べ替えしても再デプロイまで反映されなかった（他の news/girls と違い
//   クライアント補正が無かった）。API 最新で track を差し替え→banner-slider.js を再初期化。
//   ※ news-latest.js / girl-visibility.js / girl-detail-refresh.js と同じパターン。
//   ※ ASSET_ORIGIN は admi2888.com（kichifu は symlink で同一実体）。
// ==========================================================================
(function () {
  'use strict';
  var slider = document.querySelector('[data-slider]');
  if (!slider) return; // SSGが0枚(ロゴヒーローfallback)の時はセクション自体が無い→デプロイで反映
  var track = slider.querySelector('.hero-slider-track');
  if (!track) return;

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
  // top.astro の hero-slide と同一構造（image_sp あれば <picture>）
  function slideHtml(s) {
    var pc = assetUrl(s.image_pc || s.image_sp);
    var sp = assetUrl(s.image_sp);
    var img = sp
      ? '<picture><source media="(max-width:640px)" srcset="' + esc(sp) + '"><img src="' + esc(pc) + '" alt="' + esc(s.title) + '"></picture>'
      : '<img src="' + esc(pc) + '" alt="' + esc(s.title) + '">';
    var inner = s.url ? '<a href="' + esc(s.url) + '" target="_self" rel="noopener">' + img + '</a>' : img;
    return '<div class="hero-slide">' + inner + '</div>';
  }

  fetch('/api/sliders.php?shop_id=' + encodeURIComponent(shop), { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !Array.isArray(d.sliders)) return;              // 失敗時は SSG のまま
      var live = d.sliders.filter(function (s) { return s.image_pc || s.image_sp; });
      if (!live.length) return;                                  // 全消しは触らない（SSG維持）

      var curr = [].map.call(track.querySelectorAll('.hero-slide img'), function (im) { return im.getAttribute('src'); });
      var next = live.map(function (s) { return assetUrl(s.image_pc || s.image_sp); });
      // 枚数・並び・URL が完全一致なら触らない（チラつき防止）
      if (curr.length === next.length && curr.every(function (u, i) { return u === next[i]; })) return;

      track.innerHTML = live.map(slideHtml).join('');
      if (typeof window.__initHeroSliders === 'function') window.__initHeroSliders();
    })
    .catch(function () { /* 通信失敗時は SSG のまま */ });
})();
