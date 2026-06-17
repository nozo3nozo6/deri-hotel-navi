// 一覧の共通操作（表示トグル / 削除 / ドラッグ並べ替え）— content-actions.php へ非同期
(function () {
  const CSRF = window.__CSRF, TABLE = window.__TABLE;
  async function act(data) {
    const fd = new FormData();
    fd.append('_csrf', CSRF); fd.append('table', TABLE);
    for (const k in data) fd.append(k, data[k]);
    const r = await fetch('/admin/content-actions.php', { method: 'POST', body: fd });
    return r.json();
  }
  document.querySelectorAll('[data-toggle-id]').forEach(b => b.addEventListener('click', async () => {
    const j = await act({ action: 'toggle', id: b.dataset.toggleId });
    if (j.ok) b.classList.toggle('on', j.value === 1);
  }));
  document.querySelectorAll('[data-del-id]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm((b.dataset.name || 'これ') + ' を削除しますか？')) return;
    const j = await act({ action: 'delete', id: b.dataset.delId });
    if (j.ok) b.closest('tr').remove();
  }));
  const tb = document.querySelector('[data-sortable]');
  if (tb) {
    let d = null;
    tb.addEventListener('dragstart', e => { d = e.target.closest('tr'); });
    tb.addEventListener('dragover', e => {
      e.preventDefault();
      const t = e.target.closest('tr'); if (!t || t === d) return;
      const r = t.getBoundingClientRect();
      tb.insertBefore(d, (e.clientY - r.top) / r.height < 0.5 ? t : t.nextSibling);
    });
    tb.addEventListener('drop', async e => {
      e.preventDefault();
      const ids = [...tb.querySelectorAll('tr[data-id]')].map(r => r.dataset.id);
      await act(Object.assign({ action: 'reorder' }, Object.fromEntries(ids.map((id, i) => [`ids[${i}]`, id]))));
    });
  }
})();
