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
  if (!slider) return;
  var track = slider.querySelector('.hero-slider-track');
  if (!track) return;
  var fallback = document.querySelector('.hero-fallback'); // 0枚時のロゴヒーロー
  var controls = slider.querySelector('.hero-slider-controls');

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

  // 差分判定用の署名。画像URL＋リンクURL＋タイトルまで含めて比較するので、
  // 画像を変えずにリンク/タイトルだけ編集した場合も検出できる（Astroのattr自動エスケープは
  // getAttribute で元の値にデコードされるため、SSG側とAPI側の署名は損失なく一致する）。
  function liveSig(live) {
    return live.map(function (s) {
      return assetUrl(s.image_pc || s.image_sp) + '|' + (s.url || '') + '|' + (s.title || '');
    }).join('~~');
  }
  function currSig() {
    return [].map.call(track.querySelectorAll('.hero-slide'), function (sl) {
      var im = sl.querySelector('img'), a = sl.querySelector('a');
      return (im ? (im.getAttribute('src') || '') : '') + '|' +
             (a ? (a.getAttribute('href') || '') : '') + '|' +
             (im ? (im.getAttribute('alt') || '') : '');
    }).join('~~');
  }

  fetch('/api/sliders.php?shop_id=' + encodeURIComponent(shop), { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !Array.isArray(d.sliders)) return;              // 失敗時は SSG のまま
      var live = d.sliders.filter(function (s) { return s.image_pc || s.image_sp; });

      // 全消し／最後の1枚の削除・非表示 → スライダーを隠しロゴfallbackを表示（古いスライドを残さない）
      if (!live.length) {
        if (track.children.length) track.innerHTML = '';
        slider.style.display = 'none';
        if (fallback) fallback.style.display = '';
        return;
      }

      // 画像・リンク・タイトルまで含めて完全一致なら触らない（チラつき防止）
      if (liveSig(live) === currSig()) return;

      track.innerHTML = live.map(slideHtml).join('');
      // 0枚SSG(ロゴfallback)→ スライダーを表示しfallbackを隠す（0→1枚目の即反映）
      slider.style.display = '';
      if (fallback) fallback.style.display = 'none';
      if (controls) controls.style.display = live.length > 1 ? '' : 'none'; // 2枚以上で操作を出す
      if (typeof window.__initHeroSliders === 'function') window.__initHeroSliders();
    })
    .catch(function () { /* 通信失敗時は SSG のまま */ });
})();
