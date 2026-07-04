// ==========================================================================
// banner-slider.js — top ヒーローのバナースライダー（自動切替＋矢印＋ドット）
//   slider-latest.js が API 最新スライダーで track を差し替えた後、
//   window.__initHeroSliders() で再初期化できるよう再実行可能に（2026-07-05）。
// ==========================================================================
(function () {
  'use strict';

  function setup(slider) {
    // 既存インスタンスがあれば後始末（タイマー/リスナー/ドット）してから作り直す
    if (slider.__sliderCleanup) slider.__sliderCleanup();

    var imgWrap = slider.querySelector('.hero-slider'); // 画像枠（高さ調整対象。矢印/ドットは枠外）
    var track = slider.querySelector('.hero-slider-track');
    var slides = slider.querySelectorAll('.hero-slide');
    var dotsWrap = slider.querySelector('[data-slider-dots]');
    if (dotsWrap) dotsWrap.innerHTML = ''; // 再初期化時に古いドットを除去

    function setHeightSingle() {
      if (slides.length && imgWrap) {
        var h = slides[0].offsetHeight;
        if (h) imgWrap.style.height = h + 'px';
      }
    }
    if (!track || slides.length < 2) { setHeightSingle(); return; } // 0/1枚は操作不要

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

    var onNext = function () { go(idx + 1); };
    var onPrev = function () { go(idx - 1); };
    var onResize = setHeight;
    var nx = slider.querySelector('[data-slider-next]');
    if (nx) nx.addEventListener('click', onNext);
    var pv = slider.querySelector('[data-slider-prev]');
    if (pv) pv.addEventListener('click', onPrev);

    // 画像ロード／リサイズで高さ再計算
    slides.forEach(function (s) {
      var im = s.querySelector('img');
      if (im && !im.complete) im.addEventListener('load', setHeight);
    });
    window.addEventListener('resize', onResize);

    // 再初期化時に呼ぶ後始末（重複リスナー/多重タイマー防止）
    slider.__sliderCleanup = function () {
      clearInterval(timer);
      if (nx) nx.removeEventListener('click', onNext);
      if (pv) pv.removeEventListener('click', onPrev);
      window.removeEventListener('resize', onResize);
      if (dotsWrap) dotsWrap.innerHTML = '';
    };

    render();
    restart();
  }

  function initAll() {
    document.querySelectorAll('[data-slider]').forEach(setup);
  }
  window.__initHeroSliders = initAll; // slider-latest.js から差し替え後に再初期化
  initAll();
})();
