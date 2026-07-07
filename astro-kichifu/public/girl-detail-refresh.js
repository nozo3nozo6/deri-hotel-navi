// ==========================================================================
// girl-detail-refresh.js — 女の子詳細(/girls/{id})のCTRL編集を即反映（デプロイ不要）
//   girls詳細は純SSG。CTRLで店舗コメント等を編集してもビルドし直すまで公開ページに出ない。
//   そこで最新情報(news-latest.js)と同じく、読込時にAPIから最新を取得してリッチテキスト
//   3項目を差し替える。SEOにはビルド時の内容が残る（検索＝静的版 / 訪問者＝最新版）。
//   対象: 店舗コメント(shop_comment) / 一言(comment) / キャッチ(catch_copy) / 画像ギャラリー(並び順・差替)。
//   その他構造データ(サイズ/タグ/プロフ/プレイ)は変更頻度が低くSSG再ビルドで対応。
// ==========================================================================
(function () {
  'use strict';
  var ASSET_ORIGIN = 'https://admi2888.com'; // 画像配信元（kichifu は symlink で同一実体）
  var root = document.querySelector('.girl-detail-wrap[data-girl-id]');
  if (!root) return;
  var id = root.getAttribute('data-girl-id');
  if (!id) return;
  var shop = window.__SHOP_ID || 1;

  function asset(path) {
    if (!path) return '';
    if (/^https?:\/\//.test(path)) return path;
    return ASSET_ORIGIN + (path.charAt(0) === '/' ? '' : '/') + path;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 新しい画像をバックグラウンドでプリロードしてから src を差し替える。
  //   直接 src を書き換えるとダウンロード中は空白/壊れた画像アイコンが一瞬見えるため、
  //   読込完了後に一度で切り替える（旧画像→新画像がシームレスに見える）。
  function preloadThenSwap(imgEl, newSrc) {
    var pre = new Image();
    pre.onload = function () { imgEl.src = newSrc; };
    pre.onerror = function () {}; // 読込失敗時は現状（旧画像）を維持
    pre.src = newSrc;
  }
  // 複数画像をまとめてプリロード。全て読込完了(または失敗)、もしくはタイムアウトでコールバック。
  function preloadAll(urls, cb) {
    if (!urls.length) { cb(); return; }
    var remaining = urls.length, done = false;
    var timer = setTimeout(finish, 4000); // 保険: 遅延・失敗で無限に待たない
    urls.forEach(function (u) {
      var im = new Image();
      im.onload = im.onerror = tick;
      im.src = u;
    });
    function tick() { remaining--; if (remaining <= 0) finish(); }
    function finish() { if (done) return; done = true; clearTimeout(timer); cb(); }
  }

  fetch('/api/girls.php?action=detail&id=' + encodeURIComponent(id) + '&shop_id=' + shop, { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var g = d && d.girl;
      if (!g) return;
      syncHtml('girl-shop-comment', 'お店からのメッセージ', g.shop_comment);
      syncHtml('comment-box', (g.name || '') + 'からの一言', g.comment);
      syncCatch(g.catch_copy);
      syncGallery(g.images || [], g.name || '');
    })
    .catch(function () { /* API失敗時はSSGのまま */ });

  // 画像ギャラリーを API の並び順(sort)で最新化。メイン写真＋サムネ群を作り直す。
  //   site.js は getGallery()/イベント委譲で都度 [data-girl-thumb] を読むので innerHTML 差替で動作継続。
  function syncGallery(images, name) {
    var urls = images.map(function (im) { return asset(im.path); }).filter(Boolean);
    if (!urls.length) return; // 画像なし→SSGのまま

    // メイン写真を先頭画像に（プリロード後に瞬時切替＝ダウンロード中の空白/崩れを防ぐ）
    var main = document.getElementById('girlMainPhoto');
    if (main && main.getAttribute('src') !== urls[0]) preloadThenSwap(main, urls[0]);

    if (urls.length < 2) return; // サブ無し（1枚）→メインのみで完了

    // 既存サムネの並びと一致なら触らない（チラつき防止）
    var sub = root.querySelector('.girl-sub-photos');
    var isNewSub = !sub;
    if (sub) {
      var cur = [].map.call(sub.querySelectorAll('[data-girl-thumb]'), function (b) { return b.getAttribute('data-full'); });
      if (cur.length === urls.length && cur.every(function (u, i) { return u === urls[i]; })) return;
    }

    // 全サムネをプリロードしてから一括で差し替え（1枚ずつ読み込まれる途中の崩れを防ぐ）
    preloadAll(urls, function () {
      if (isNewSub) {
        // SSGが1枚で .girl-sub-photos 未生成 → メイン写真の直後に作る
        var wrap = main && main.closest('.girl-main-wrap');
        var col = wrap && wrap.parentElement;
        if (!col) return;
        sub = document.createElement('div');
        sub.className = 'girl-sub-photos';
        wrap.insertAdjacentElement('afterend', sub);
      }
      sub.innerHTML = urls.map(function (u, i) {
        return '<button type="button" class="girl-thumb' + (i === 0 ? ' is-active' : '') + '"' +
          ' data-girl-thumb data-full="' + esc(u) + '" aria-label="' + esc(name) + ' 写真' + (i + 1) + '">' +
          '<img src="' + esc(u) + '" alt="' + esc(name) + ' 写真' + (i + 1) + '" width="200" height="267" loading="lazy"></button>';
      }).join('');
    });
  }

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
