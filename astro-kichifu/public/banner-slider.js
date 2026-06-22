// ==========================================================================
// banner-slider.js — top ヒーローのバナースライダー（自動切替＋矢印＋ドット）
// ==========================================================================
(function () {
  'use strict';
  document.querySelectorAll('[data-slider]').forEach(function (slider) {
    var imgWrap = slider.querySelector('.hero-slider'); // 画像枠（高さ調整対象。矢印/ドットは枠外）
    var track = slider.querySelector('.hero-slider-track');
    var slides = slider.querySelectorAll('.hero-slide');
    if (!track || slides.length < 2) return;

    var dotsWrap = slider.querySelector('[data-slider-dots]');
    var idx = 0, timer, dots = [];

    if (dotsWrap) {
      for (var i = 0; i < slides.length; i++) {
        var d = document.createElement('button');
        d.type = 'button';
        d.className = 'hero-slider-dot';
        d.setAttribute('aria-label', (i + 1) + '枚目');
        (function (n) { d.addEventListener('click', function () { go(n); }); })(i);
        dotsWrap.appendChild(d);
        dots.push(d);
      }
    }

    // 表示中バナーの高さに slider を合わせる（短いバナー下の余白を解消）
    function setHeight() {
      var h = slides[idx].offsetHeight;
      if (h && imgWrap) imgWrap.style.height = h + 'px';
    }
    function render() {
      track.style.transform = 'translateX(' + (-idx * 100) + '%)';
      dots.forEach(function (dot, i) { dot.classList.toggle('is-active', i === idx); });
      setHeight();
    }
    function go(n) { idx = (n + slides.length) % slides.length; render(); restart(); }
    function restart() { clearInterval(timer); timer = setInterval(function () { go(idx + 1); }, 5000); }

    var nx = slider.querySelector('[data-slider-next]');
    if (nx) nx.addEventListener('click', function () { go(idx + 1); });
    var pv = slider.querySelector('[data-slider-prev]');
    if (pv) pv.addEventListener('click', function () { go(idx - 1); });

    // 画像ロード／リサイズで高さ再計算
    slides.forEach(function (s) {
      var im = s.querySelector('img');
      if (im && !im.complete) im.addEventListener('load', setHeight);
    });
    window.addEventListener('resize', setHeight);

    render();
    restart();
  });
})();
