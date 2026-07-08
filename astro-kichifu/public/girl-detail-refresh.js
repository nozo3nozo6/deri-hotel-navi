// ==========================================================================
// girl-detail-refresh.js — 女の子詳細(/girls/{id})のCTRL編集を即反映（デプロイ不要）
//   girls詳細は純SSG。CTRLで編集してもビルドし直すまで公開ページに出ない。
//   そこで最新情報(news-latest.js)と同じく、読込時にAPIから最新を取得して差し替える。
//   SEOにはビルド時の内容が残る（検索＝静的版 / 訪問者＝最新版）。
//   対象（=CTRLで編集できる全項目・2026-07-09 全項目対応に拡張）:
//     リッチテキスト: 店舗コメント(shop_comment) / 一言(comment) / キャッチ(catch_copy)
//     画像ギャラリー: 並び順・差し替え・追加
//     構造データ: 名前・年齢(h1) / 属性フラグ / 特徴タグ / スリーサイズ / プロフィールQ&A / 基本・オプションプレイ
//   ※ #girl-week（週間出勤）は schedule-week.js の持ち場なので触らない（in-place patchで温存）。
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

  function isNewcomer(inDate) {
    if (!inDate) return false;
    var cut = new Date();
    cut.setMonth(cut.getMonth() - 3);
    return String(inDate).slice(0, 10) >= cut.toISOString().slice(0, 10);
  }

  fetch('/api/girls.php?action=detail&id=' + encodeURIComponent(id) + '&shop_id=' + shop, { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var g = d && d.girl;
      if (!g) return;
      syncName(g);
      syncFlags(g);
      syncCatch(g.catch_copy);
      syncTags(g.tags || []);
      syncSizes(g);
      syncHtml('girl-shop-comment', 'お店からのメッセージ', g.shop_comment);
      syncProfiles(g.profiles || [], g.name || '');
      syncPlays(g.basic_play || [], g.option_play || []);
      syncHtml('comment-box', (g.name || '') + 'からの一言', g.comment);
      syncGallery(g.images || [], g.name || '');
    })
    .catch(function () { /* API失敗時はSSGのまま */ });

  // ---- 名前・年齢（ページ見出し h1） ----
  function syncName(g) {
    var h1 = document.querySelector('h1.girl-detail-name');
    if (!h1) return;
    var want = (g.name || '') + '|' + (g.age ? Number(g.age) + '歳' : '');
    var ageEl = h1.querySelector('.girl-detail-age');
    var cur = (h1.childNodes[0] && h1.childNodes[0].nodeType === 3 ? h1.childNodes[0].nodeValue : '') +
              '|' + (ageEl ? ageEl.textContent : '');
    if (cur === want) return;
    h1.innerHTML = esc(g.name || '') + (g.age ? '<span class="girl-detail-age">' + Number(g.age) + '歳</span>' : '');
  }

  // ---- 属性フラグ（順序: 新人→待ち合わせ→インバウンド→ジェンダーレス→電話、[id].astroと同一） ----
  function syncFlags(g) {
    var box = root.querySelector('.girl-flags');
    if (!box) return;
    var want = [];
    if (isNewcomer(g.in_date)) want.push('新人');
    if (g.is_trial)            want.push('待ち合わせ');
    if (g.is_inbound)          want.push('インバウンド');
    if (g.is_genderless)       want.push('ジェンダーレス');
    if (g.is_tel)              want.push('電話');
    var cur = [].map.call(box.querySelectorAll('img'), function (i) { return i.getAttribute('alt') || ''; });
    if (want.join('|') === cur.join('|')) return;
    var FLAG_IMG = { '新人': 'flag-newgirl', '待ち合わせ': 'flag-machiawase', 'インバウンド': 'flag-inbound', 'ジェンダーレス': 'flag-genderless', '電話': 'flag-tel' };
    box.innerHTML = want.map(function (k) {
      return '<img src="/img/' + FLAG_IMG[k] + '.png" class="girl-flag-icon" width="128" height="128" alt="' + k + '" title="' + k + '" />';
    }).join('');
  }

  // ---- 特徴タグ（.girl-tags チップ） ----
  function syncTags(tags) {
    var box = root.querySelector('.girl-tags');
    var cur = box ? [].map.call(box.querySelectorAll('.girl-tag-chip'), function (s) { return s.textContent; }) : [];
    if (tags.join('|') === cur.join('|')) { if (box) box.style.display = ''; return; }
    if (!tags.length) { if (box) box.style.display = 'none'; return; }
    var html = tags.map(function (t) { return '<span class="girl-tag-chip">' + esc(t) + '</span>'; }).join('');
    if (box) {
      box.innerHTML = html;
      box.style.display = '';
      return;
    }
    // ビルド時に無かった→ .girl-catch（あれば）または .girl-flags の直後に作る
    var anchor = root.querySelector('.girl-catch') || root.querySelector('.girl-flags');
    if (!anchor) return;
    box = document.createElement('div');
    box.className = 'girl-tags';
    box.innerHTML = html;
    anchor.insertAdjacentElement('afterend', box);
  }

  // ---- 身長・スリーサイズ（T/B/CUP/W/H 固定順の5マス） ----
  function syncSizes(g) {
    var vals = [
      g.height ? String(Number(g.height)) : '—',
      g.bust   ? String(Number(g.bust))   : '—',
      g.cup    ? String(g.cup)            : '—',
      g.waist  ? String(Number(g.waist))  : '—',
      g.hip    ? String(Number(g.hip))    : '—'
    ];
    var any = !!(g.height || g.bust || g.cup || g.waist || g.hip);
    var grid = root.querySelector('.girl-size-grid');
    if (grid) {
      var lbl = prevLabel(grid);
      if (!any) { grid.style.display = 'none'; if (lbl) lbl.style.display = 'none'; return; }
      grid.style.display = '';
      if (lbl) lbl.style.display = '';
      var cells = grid.querySelectorAll('.girl-size-val');
      for (var i = 0; i < cells.length && i < 5; i++) {
        if (cells[i].textContent !== vals[i]) cells[i].textContent = vals[i];
      }
      return;
    }
    if (!any) return;
    // ビルド時に無かった→ タグ/キャッチ/フラグの直後に label + grid を作る
    var anchor = root.querySelector('.girl-tags') || root.querySelector('.girl-catch') || root.querySelector('.girl-flags');
    if (!anchor) return;
    var p = document.createElement('p');
    p.className = 'section-label';
    p.textContent = '身長・スリーサイズ';
    var div = document.createElement('div');
    div.className = 'girl-size-grid';
    div.innerHTML = [['T', vals[0]], ['B', vals[1]], ['CUP', vals[2]], ['W', vals[3]], ['H', vals[4]]].map(function (x) {
      return '<div class="girl-size-item"><span class="girl-size-label">' + x[0] + '</span><span class="girl-size-val">' + esc(x[1]) + '</span></div>';
    }).join('');
    anchor.insertAdjacentElement('afterend', div);
    div.insertAdjacentElement('beforebegin', p);
  }

  // ---- プロフィール（女の子に質問）テーブル ----
  function syncProfiles(profiles, name) {
    var table = root.querySelector('.girl-profile-table');
    var labelText = name + 'さんに質問';
    var sig = profiles.map(function (p) { return p.name + '=' + p.value; }).join('|');
    var cur = table ? [].map.call(table.querySelectorAll('tr'), function (tr) {
      var th = tr.querySelector('th'), td = tr.querySelector('td');
      return (th ? th.textContent : '') + '=' + (td ? td.textContent : '');
    }).join('|') : '';
    if (table) {
      var lbl = prevLabel(table);
      if (!profiles.length) { table.style.display = 'none'; if (lbl) lbl.style.display = 'none'; return; }
      if (lbl && lbl.textContent !== labelText) lbl.textContent = labelText;   // 名前変更時にラベルも追従
      table.style.display = '';
      if (lbl) lbl.style.display = '';
      if (sig === cur) return;
      table.innerHTML = profiles.map(function (p) {
        return '<tr><th>' + esc(p.name) + '</th><td>' + esc(p.value) + '</td></tr>';
      }).join('');
      return;
    }
    if (!profiles.length) return;
    // ビルド時に無かった→ 最初のプレイラベル or #girl-week の前に作る
    var anchor = root.querySelector('.play-label') || document.getElementById('girl-week');
    if (!anchor) return;
    var p2 = document.createElement('p');
    p2.className = 'section-label';
    p2.style.cssText = 'font-size:.95rem;margin-top:32px';
    p2.textContent = labelText;
    table = document.createElement('table');
    table.className = 'girl-profile-table';
    table.innerHTML = profiles.map(function (p) {
      return '<tr><th>' + esc(p.name) + '</th><td>' + esc(p.value) + '</td></tr>';
    }).join('');
    anchor.insertAdjacentElement('beforebegin', p2);
    p2.insertAdjacentElement('afterend', table);
  }

  // ---- 基本プレイ / オプションプレイ（チップ2グループ） ----
  function syncPlays(basic, option) {
    syncPlayGroup(basic, false);
    syncPlayGroup(option, true);
  }
  function syncPlayGroup(items, isOption) {
    // ラベルで既存グループを特定（基本= .play-label:not(.play-label-option) / オプション= .play-label-option）
    var label = null;
    [].forEach.call(root.querySelectorAll('.play-label'), function (l) {
      var opt = l.classList.contains('play-label-option');
      if (opt === isOption && !label) label = l;
    });
    var box = label && label.nextElementSibling && label.nextElementSibling.classList.contains('girl-options')
      ? label.nextElementSibling : null;
    var chipCls = 'play-chip' + (isOption ? ' is-option' : '');
    var cur = box ? [].map.call(box.querySelectorAll('.play-chip'), function (s) { return s.textContent; }) : [];
    if (items.join('|') === cur.join('|')) {
      if (box) { box.style.display = ''; if (label) label.style.display = ''; }
      return;
    }
    if (!items.length) {
      if (box) box.style.display = 'none';
      if (label) label.style.display = 'none';
      return;
    }
    var html = items.map(function (o) { return '<span class="' + chipCls + '">' + esc(o) + '</span>'; }).join('');
    if (box) {
      box.innerHTML = html;
      box.style.display = '';
      if (label) label.style.display = '';
      return;
    }
    // ビルド時に無かった→ 基本=オプションラベル or #girl-week の前 / オプション= #girl-week の前
    var anchor = (!isOption && root.querySelector('.play-label-option')) || document.getElementById('girl-week');
    if (!anchor) return;
    var p = document.createElement('p');
    p.className = 'section-label play-label' + (isOption ? ' play-label-option' : '');
    p.textContent = isOption ? 'オプションプレイ' : '基本プレイ';
    var div = document.createElement('div');
    div.className = 'girl-options';
    div.innerHTML = html;
    anchor.insertAdjacentElement('beforebegin', p);
    p.insertAdjacentElement('afterend', div);
  }

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
      if (lbl) {
        lbl.style.display = '';
        if (lbl.textContent !== label) lbl.textContent = label;   // 名前変更時に「○○からの一言」等も追従
      }
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
      return;
    }
    if (text === '') return;
    // ビルド時に無かった→ .girl-flags の直後に作る（[id].astro と同位置）
    var anchor = root.querySelector('.girl-flags');
    if (!anchor) return;
    el = document.createElement('p');
    el.className = 'girl-catch';
    el.textContent = '「' + text + '」';
    anchor.insertAdjacentElement('afterend', el);
  }

  function prevLabel(el) {
    var p = el.previousElementSibling;
    return (p && p.classList.contains('section-label')) ? p : null;
  }
})();
