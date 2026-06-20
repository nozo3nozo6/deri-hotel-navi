/* girls-filter.js — すけべな女の子達 一覧のクライアント側 絞り込み＋並び替え
   静的サイト（全カードがHTMLに存在）を JS で表示順入替・非表示にする。 */
(function () {
  var grid = document.getElementById('girl-grid');
  if (!grid) return;

  var cards = Array.prototype.slice.call(grid.querySelectorAll('.girl-card'));
  var countEl = document.getElementById('gresult-count');
  var emptyEl = document.getElementById('gresult-empty');
  var nameInput = document.getElementById('gsearch-name');
  var newChk = document.getElementById('gfilter-new');
  var resetBtn = document.getElementById('gfilter-reset');
  var tagBtns = Array.prototype.slice.call(document.querySelectorAll('[data-gtag]'));
  var sortBtns = Array.prototype.slice.call(document.querySelectorAll('.gsort-btn'));

  var state = { sort: 'in', dir: 'desc', name: '', tags: [], newOnly: false };

  function norm(s) {
    try { return (s || '').normalize('NFKC').toLowerCase(); }
    catch (e) { return (s || '').toLowerCase(); }
  }
  function num(el, key) { return parseInt(el.getAttribute('data-' + key) || '0', 10) || 0; }

  function apply() {
    var q = norm(state.name);
    var visible = [];
    cards.forEach(function (c) {
      var ok = true;
      if (q && norm(c.getAttribute('data-name')).indexOf(q) === -1) ok = false;
      if (ok && state.newOnly && c.getAttribute('data-new') !== '1') ok = false;
      if (ok && state.tags.length) {
        var ctags = (c.getAttribute('data-tags') || '').split('|');
        for (var i = 0; i < state.tags.length; i++) {
          if (ctags.indexOf(state.tags[i]) === -1) { ok = false; break; }
        }
      }
      c.style.display = ok ? '' : 'none';
      if (ok) visible.push(c);
    });

    var dir = state.dir === 'asc' ? 1 : -1;
    visible.sort(function (a, b) {
      var av = num(a, state.sort), bv = num(b, state.sort);
      if (av === bv) return num(b, 'id') - num(a, 'id'); // 同値は新しい順
      return (av - bv) * dir;
    });
    visible.forEach(function (c) { grid.appendChild(c); });

    if (countEl) countEl.textContent = '該当 ' + visible.length + ' 人';
    if (emptyEl) emptyEl.style.display = visible.length ? 'none' : '';
  }

  document.querySelectorAll('[data-gpanel-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var panel = btn.closest('.gpanel');
      var open = panel.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  sortBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      sortBtns.forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      state.sort = btn.getAttribute('data-sort');
      state.dir = btn.getAttribute('data-dir');
      apply();
    });
  });

  tagBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.classList.toggle('is-active');
      state.tags = tagBtns.filter(function (b) { return b.classList.contains('is-active'); })
                          .map(function (b) { return b.getAttribute('data-gtag'); });
      apply();
    });
  });

  if (nameInput) nameInput.addEventListener('input', function () { state.name = nameInput.value; apply(); });
  if (newChk) newChk.addEventListener('change', function () { state.newOnly = newChk.checked; apply(); });
  if (resetBtn) resetBtn.addEventListener('click', function () {
    state.name = ''; state.tags = []; state.newOnly = false;
    if (nameInput) nameInput.value = '';
    if (newChk) newChk.checked = false;
    tagBtns.forEach(function (b) { b.classList.remove('is-active'); });
    apply();
  });

  apply();
})();
