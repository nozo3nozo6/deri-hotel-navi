// ==========================================================================
// girl-detail-refresh.js — 女の子詳細(/girls/{id})のCTRL編集を即反映（デプロイ不要）
//   girls詳細は純SSG。CTRLで店舗コメント等を編集してもビルドし直すまで公開ページに出ない。
//   そこで最新情報(news-latest.js)と同じく、読込時にAPIから最新を取得してリッチテキスト
//   3項目を差し替える。SEOにはビルド時の内容が残る（検索＝静的版 / 訪問者＝最新版）。
//   対象: 店舗コメント(shop_comment) / 一言(comment) / キャッチ(catch_copy)。
//   構造データ(画像/サイズ/タグ/プロフ/プレイ)は変更頻度が低くSSG再ビルドで対応。
// ==========================================================================
(function () {
  'use strict';
  var root = document.querySelector('.girl-detail-wrap[data-girl-id]');
  if (!root) return;
  var id = root.getAttribute('data-girl-id');
  if (!id) return;
  var shop = window.__SHOP_ID || 1;

  fetch('/api/girls.php?action=detail&id=' + encodeURIComponent(id) + '&shop_id=' + shop, { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var g = d && d.girl;
      if (!g) return;
      syncHtml('girl-shop-comment', 'お店からのメッセージ', g.shop_comment);
      syncHtml('comment-box', (g.name || '') + 'からの一言', g.comment);
      syncCatch(g.catch_copy);
    })
    .catch(function () { /* API失敗時はSSGのまま */ });

  // set:html 系セクション（ラベル<p.section-label> + 本文<div.cls>）を最新へ。
  //   既存あり→innerHTML差し替え / 空に編集→セクション非表示 / 無→追加（末尾.girl-detail本文列）
  function syncHtml(cls, label, html) {
    html = html == null ? '' : String(html);
    var el = root.querySelector('.' + cls);
    if (el) {
      var lbl = prevLabel(el);
      if (html === '') {                       // 内容が空になった→ラベルごと隠す
        el.style.display = 'none';
        if (lbl) lbl.style.display = 'none';
        return;
      }
      if (el.innerHTML !== html) el.innerHTML = html;
      el.style.display = '';
      if (lbl) lbl.style.display = '';
      return;
    }
    if (html === '') return;                    // 元々無く今も空→何もしない
    // ビルド時に無かったセクションを新規追加（本文列の末尾に label + div）。
    //   本文列は無名divだが、常時描画される .girl-flags の親＝右カラム。
    var anchor = root.querySelector('.girl-flags');
    var col = anchor && anchor.parentElement;
    if (!col) return;
    var p = document.createElement('p');
    p.className = 'section-label';
    p.style.cssText = 'font-size:.95rem;margin-top:32px';
    p.textContent = label;
    var div = document.createElement('div');
    div.className = cls;
    div.innerHTML = html;
    col.appendChild(p);
    col.appendChild(div);
  }

  function syncCatch(text) {
    text = text == null ? '' : String(text).trim();
    var el = root.querySelector('.girl-catch');
    if (el) {
      if (text === '') { el.style.display = 'none'; return; }
      var want = '「' + text + '」';
      if (el.textContent !== want) el.textContent = want;
      el.style.display = '';
    }
    // キャッチが元々無い場合の新規追加はレイアウト依存が大きいためSSG再ビルドに任せる
  }

  function prevLabel(el) {
    var p = el.previousElementSibling;
    return (p && p.classList.contains('section-label')) ? p : null;
  }
})();
