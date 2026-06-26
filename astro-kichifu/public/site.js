(function () {
  'use strict';

  var body  = document.body;
  var modal = document.getElementById('reserve-modal');
  var iconsModal = document.getElementById('icons-modal');
  var lb    = document.getElementById('lightbox');

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var currentIndex = 0;

  // ---- ギャラリー画像リスト（サムネ data-full、無ければメイン1枚）----
  function getGallery() {
    var thumbs = document.querySelectorAll('[data-girl-thumb]');
    if (thumbs.length) {
      var a = [];
      for (var i = 0; i < thumbs.length; i++) a.push(thumbs[i].getAttribute('data-full'));
      return a;
    }
    var main = document.getElementById('girlMainPhoto');
    return main ? [main.getAttribute('src')] : [];
  }

  // ---- インライン（ページ内）メイン写真＋サムネ active を同期 ----
  function setInlineMain(i) {
    var g = getGallery();
    if (!g.length) return;
    i = (i + g.length) % g.length;
    currentIndex = i;
    var main = document.getElementById('girlMainPhoto');
    if (main) main.src = g[i];
    var thumbs = document.querySelectorAll('[data-girl-thumb]');
    for (var k = 0; k < thumbs.length; k++) thumbs[k].classList.toggle('is-active', k === i);
  }

  // ---- ライトボックス ----
  function buildDots(n) {
    var d = document.getElementById('lightboxDots');
    if (!d) return;
    d.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var b = document.createElement('button');
      b.className = 'lb-dot';
      b.setAttribute('data-lb-dot', i);
      b.setAttribute('aria-label', (i + 1) + '枚目');
      d.appendChild(b);
    }
  }
  function updateDots(active) {
    var dots = document.querySelectorAll('.lb-dot');
    for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('is-active', i === active);
  }
  function updateCounter(i, n) {
    var c = document.getElementById('lightboxCounter');
    if (c) c.textContent = (i + 1) + ' / ' + n;
  }

  function burstSparkles() {
    var boxEl = document.getElementById('lightboxSparkles');
    if (!boxEl || reduceMotion) return;
    boxEl.innerHTML = '';
    var chars = ['✨', '💕', '⭐', '✨', '💖'];
    for (var i = 0; i < 6; i++) {
      var s = document.createElement('span');
      s.className = 'lb-spark';
      s.textContent = chars[i % chars.length];
      s.style.left = (8 + Math.random() * 84) + '%';
      s.style.top  = (18 + Math.random() * 64) + '%';
      s.style.fontSize = (14 + Math.random() * 18) + 'px';
      s.style.animationDelay = (Math.random() * 0.18) + 's';
      boxEl.appendChild(s);
    }
    setTimeout(function () { if (boxEl) boxEl.innerHTML = ''; }, 1100);
  }

  function lbShow(i) {
    if (!lb) return;
    var g = getGallery();
    if (!g.length) return;
    i = (i + g.length) % g.length;
    currentIndex = i;
    var img = document.getElementById('lightboxImg');
    if (img) {
      if (reduceMotion) {
        img.src = g[i];
      } else {
        img.classList.add('is-fading');
        setTimeout(function () {
          img.src = g[i];
          img.classList.remove('is-fading');
        }, 150);
      }
    }
    updateDots(i);
    updateCounter(i, g.length);
    setInlineMain(i);
  }

  function lbOpen(i) {
    if (!lb) return;
    var g = getGallery();
    if (!g.length) return;
    i = (i + g.length) % g.length;
    currentIndex = i;
    buildDots(g.length);
    var img = document.getElementById('lightboxImg');
    if (img) img.src = g[i];
    updateDots(i);
    updateCounter(i, g.length);
    lb.setAttribute('aria-hidden', 'false');
    body.classList.add('lb-open');
    burstSparkles();
  }

  function lbClose() {
    if (!lb) return;
    lb.setAttribute('aria-hidden', 'true');
    body.classList.remove('lb-open');
  }

  // ---- クリック委譲 ----
  document.addEventListener('click', function (e) {
    var t = e.target;

    // サムネ → インラインメイン切替
    var thumb = t.closest('[data-girl-thumb]');
    if (thumb) {
      var thumbs = thumb.parentNode.querySelectorAll('[data-girl-thumb]');
      var idx = 0;
      for (var i = 0; i < thumbs.length; i++) if (thumbs[i] === thumb) { idx = i; break; }
      setInlineMain(idx);
      return;
    }

    // ライトボックス
    if (t.closest('[data-lightbox-open]'))  { lbOpen(currentIndex); return; }
    if (t.closest('[data-lightbox-next]'))  { lbShow(currentIndex + 1); return; }
    if (t.closest('[data-lightbox-prev]'))  { lbShow(currentIndex - 1); return; }
    var dot = t.closest('[data-lb-dot]');
    if (dot) { lbShow(parseInt(dot.getAttribute('data-lb-dot'), 10)); return; }
    if (t.closest('[data-lightbox-close]') || t === lb ||
        (t.classList && t.classList.contains('lightbox-stage'))) { lbClose(); return; }

    // メニュー / 予約
    if (t.closest('[data-menu-open]'))  { body.classList.add('menu-open'); return; }
    if (t.closest('[data-menu-close]')) { body.classList.remove('menu-open'); return; }
    if (t.closest('[data-reserve-open]')) {
      body.classList.remove('menu-open');
      body.classList.add('reserve-open');
      if (modal) modal.setAttribute('aria-hidden', 'false');
      return;
    }
    if (t.closest('[data-reserve-close]') || t === modal) {
      body.classList.remove('reserve-open');
      if (modal) modal.setAttribute('aria-hidden', 'true');
      return;
    }

    // アイコンの見かた（凡例）モーダル
    var iconsTrigger = t.closest('[data-icons-open]');
    if (iconsTrigger) {
      body.classList.remove('menu-open');
      body.classList.add('icons-open');
      if (iconsModal) {
        iconsModal.setAttribute('aria-hidden', 'false');
        var key = iconsTrigger.getAttribute('data-icon-key');
        var items = iconsModal.querySelectorAll('.iconlegend-item');
        for (var qi = 0; qi < items.length; qi++) {
          items[qi].classList.toggle('is-active', !!key && items[qi].getAttribute('data-icon-key') === key);
        }
        var active = key && iconsModal.querySelector('.iconlegend-item.is-active');
        if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    if (t.closest('[data-icons-close]') || t === iconsModal) {
      body.classList.remove('icons-open');
      if (iconsModal) iconsModal.setAttribute('aria-hidden', 'true');
      return;
    }
  });

  // ---- スワイプ（モバイル）----
  if (lb) {
    var sx = 0, sy = 0;
    lb.addEventListener('touchstart', function (e) {
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    lb.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - sx;
      var dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) lbShow(currentIndex + 1); else lbShow(currentIndex - 1);
      }
    }, { passive: true });
  }

  // ---- キーボード ----
  document.addEventListener('keydown', function (e) {
    if (lb && lb.getAttribute('aria-hidden') === 'false') {
      if (e.key === 'ArrowRight') { lbShow(currentIndex + 1); return; }
      if (e.key === 'ArrowLeft')  { lbShow(currentIndex - 1); return; }
      if (e.key === 'Escape')     { lbClose(); return; }
    }
    if (e.key !== 'Escape') return;
    body.classList.remove('menu-open');
    body.classList.remove('reserve-open');
    body.classList.remove('icons-open');
    if (modal) modal.setAttribute('aria-hidden', 'true');
    if (iconsModal) iconsModal.setAttribute('aria-hidden', 'true');
  });
})();
