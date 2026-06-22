// ==========================================================================
// fujoho-slider.js — 口コミ風俗情報局バナー(Fujoho)の横スクロールに矢印/ドット操作を付与
//   3カードの横スクロール。矢印で前後、ドットで該当カードへ。スクロールでドット同期。
//   ※ iframe 内部は口コミ局仕様で不変。外側のスクロール位置だけ操作する。
// ==========================================================================
(function () {
  'use strict';
  document.querySelectorAll('[data-fujoho-slider]').forEach(function (root) {
    var grid = root.querySelector('.fujoho-grid');
    if (!grid) return;
    var cards = grid.querySelectorAll('.fujoho-card');
    if (cards.length < 2) return;

    var prev = root.querySelector('[data-fujoho-prev]');
    var next = root.querySelector('[data-fujoho-next]');
    var dotsWrap = root.querySelector('[data-fujoho-dots]');
    var dots = [];

    if (dotsWrap) {
      for (var i = 0; i < cards.length; i++) {
        var d = document.createElement('button');
        d.type = 'button';
        d.className = 'fujoho-dot';
        d.setAttribute('aria-label', (i + 1) + '枚目');
        (function (n) { d.addEventListener('click', function () { scrollToCard(n); }); })(i);
        dotsWrap.appendChild(d);
        dots.push(d);
      }
    }

    function step() {
      return cards.length > 1 ? (cards[1].offsetLeft - cards[0].offsetLeft) : cards[0].offsetWidth;
    }
    function curIndex() {
      var s = step();
      return s ? Math.round(grid.scrollLeft / s) : 0;
    }
    function scrollToCard(n) {
      n = Math.max(0, Math.min(cards.length - 1, n));
      grid.scrollTo({ left: (cards[n].offsetLeft - cards[0].offsetLeft), behavior: 'smooth' });
    }
    function update() {
      var idx = curIndex();
      dots.forEach(function (dot, i) { dot.classList.toggle('is-active', i === idx); });
      if (prev) prev.disabled = (idx <= 0);
      if (next) next.disabled = (idx >= cards.length - 1);
    }

    if (prev) prev.addEventListener('click', function () { scrollToCard(curIndex() - 1); });
    if (next) next.addEventListener('click', function () { scrollToCard(curIndex() + 1); });

    var ticking = false;
    grid.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(function () { update(); ticking = false; }); }
    });
    window.addEventListener('resize', update);
    update();
  });
})();
