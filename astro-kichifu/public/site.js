(function () {
  'use strict';

  var body  = document.body;
  var modal = document.getElementById('reserve-modal');

  document.addEventListener('click', function (e) {
    var t = e.target;

    if (t.closest('[data-menu-open]')) {
      body.classList.add('menu-open');
      return;
    }
    if (t.closest('[data-menu-close]')) {
      body.classList.remove('menu-open');
      return;
    }
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
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    body.classList.remove('menu-open');
    body.classList.remove('reserve-open');
    if (modal) modal.setAttribute('aria-hidden', 'true');
  });
})();
