// ==========================================================================
// girl-visibility.js — 女性カードの掲載状況をページ読込ごとに最新化（デプロイ不要）
//   Astro SSG は女性カードをビルド時に焼き込む。CTRLで変更した場合、
//   本JSがAPIから最新の掲載中リストを取得し:
//     1. 非掲載になったカードを除去（掲載OFF即反映）
//     2. ビルド後に新規追加された女性のカードを各グリッドに追加（新規即表示）
//     3. 既存カードの写真URLを最新化（写真差し替え即反映）
//     4. 既存カードの文字情報を最新化（名前/年齢/サイズ/属性フラグ/タグ/リンク先/data-*）
//        ※ schedule-badge.js が差し込む出勤バッジ(.girl-card-shukkin等)を壊さないよう
//          カードは作り直さず要素単位で patch する
//   ※ news-latest.js / girl-detail-refresh.js と同じ「SSG + クライアント動的補正」パターン。
//   ※ ASSET_ORIGIN は admi2888.com（kichifu は symlink で同一実体）。
// ==========================================================================
(function () {
  'use strict';

  // === GirlCardItem.astro / config.ts と同期 ===
  var ASSET_ORIGIN = 'https://admi2888.com';
  var TAG_EMOJI = {
    'オススメ': '⭐', '素人': '🔰', '未経験': '🌱', '可愛い系': '🎀',
    '綺麗系': '💎', 'お嬢様': '👑', '女子大生': '🎓', 'OL系': '🏢',
    'セクシー': '💋', '清楚': '🪷', '癒し': '🍵', 'ギャル系': '💄',
    'モデル系': '💃', 'ロリ系': '🍭', 'グラマー': '🍑', 'スレンダー': '🦩',
    '美乳': '🍒', '美脚': '👠', '巨乳': '🍈', '色白': '🌙',
    '愛嬌抜群': '😊', 'イチャイチャ系': '💕', 'テクニシャン': '✨', '痴女': '😈',
    'サービス抜群': '🎁', '敏感': '⚡', '濃厚サービス': '🍯', '天然': '🍀',
    'おっとり': '🌷'
  };

  function asset(path) {
    if (!path) return '';
    if (/^https?:\/\//.test(path)) return path;
    return ASSET_ORIGIN + (path.charAt(0) === '/' ? path : '/' + path);
  }
  function tagEmoji(name) { return TAG_EMOJI[name] || '♡'; }
  function isNewcomer(inDate) {
    if (!inDate) return false;
    var cut = new Date();
    cut.setMonth(cut.getMonth() - 3);
    return inDate.slice(0, 10) >= cut.toISOString().slice(0, 10);
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // 新しい写真をバックグラウンドでプリロードしてから src を差し替える。
  //   直接 src を書き換えるとダウンロード中は空白/壊れた画像アイコンが一瞬見えるため、
  //   読込完了後に一度で切り替える（旧写真→新写真がシームレスに見える）。
  function preloadThenSwap(imgEl, newSrc) {
    var pre = new Image();
    pre.onload = function () { imgEl.src = newSrc; };
    pre.onerror = function () {}; // 読込失敗時は現状（旧写真）を維持
    pre.src = newSrc;
  }

  // GirlCardItem.astro と同一構造の HTML を生成
  function buildCard(g) {
    var age     = g.age ? '(' + g.age + ')' : '';
    var sizes   = 'T' + (g.height || '—') + ' B' + (g.bust || '—') + '(' + (g.cup || '—') + ') W' + (g.waist || '—') + ' H' + (g.hip || '—');
    var tags    = (g.tags || []).slice(0, 4);
    var inNum   = g.in_date ? (parseInt(String(g.in_date).slice(0, 10).replace(/-/g, ''), 10) || 0) : 0;
    var isNew   = isNewcomer(g.in_date) ? 1 : 0;
    var thumbUrl = g.external_url || '/girls/' + g.id;

    var photoHtml = g.photo
      ? '<img src="' + esc(asset(g.photo)) + '" alt="' + esc(g.name) + '" width="300" height="400" loading="lazy" class="girl-card-img" />'
      : '<div class="girl-card-no-photo">👤</div>';

    var flagsHtml = '';
    if (isNew)             flagsHtml += '<img src="/img/flag-newgirl.png"   class="girl-card-flag-icon" width="128" height="128" alt="新人"           title="新人"           loading="lazy" data-i18n-attr="alt=flag_newgirl, title=flag_newgirl" />';
    if (g.is_trial)        flagsHtml += '<img src="/img/flag-machiawase.png" class="girl-card-flag-icon" width="128" height="128" alt="待ち合わせ"      title="待ち合わせ"      loading="lazy" data-i18n-attr="alt=flag_machiawase, title=flag_machiawase" />';
    if (g.is_tel)          flagsHtml += '<img src="/img/flag-tel.png"        class="girl-card-flag-icon" width="128" height="128" alt="電話"            title="電話"            loading="lazy" data-i18n-attr="alt=flag_tel, title=flag_tel" />';
    if (g.is_inbound)      flagsHtml += '<img src="/img/flag-inbound.png"    class="girl-card-flag-icon" width="128" height="128" alt="インバウンド"    title="インバウンド"    loading="lazy" data-i18n-attr="alt=flag_inbound, title=flag_inbound" />';
    if (g.is_genderless)   flagsHtml += '<img src="/img/flag-genderless.png" class="girl-card-flag-icon" width="128" height="128" alt="ジェンダーレス" title="ジェンダーレス" loading="lazy" data-i18n-attr="alt=flag_genderless, title=flag_genderless" />';

    var tagsHtml = tags.length
      ? '<div class="girl-card-tags">' + tags.map(function (t) {
          return '<span class="girl-card-tag-ico" title="' + esc(t) + '" aria-label="' + esc(t) + '">' + tagEmoji(t) + '</span>';
        }).join('') + '</div>'
      : '';

    return '<div class="girl-card"' +
      ' data-id="'     + esc(g.id)          + '"' +
      ' data-in="'     + inNum               + '"' +
      ' data-height="' + (g.height || 0)    + '"' +
      ' data-bust="'   + (g.bust   || 0)    + '"' +
      ' data-age="'    + (g.age    || 0)    + '"' +
      ' data-name="'   + esc(g.name)        + '"' +
      ' data-new="'    + isNew               + '"' +
      ' data-tags="'   + esc(tags.join('|'))+ '">' +
      '<a class="girl-card-img-wrap" href="' + esc(thumbUrl) + '" target="_self">' +
        photoHtml +
        '<div class="girl-card-info">' +
          '<p class="girl-card-name">' + esc(g.name) + '<span class="girl-card-age">' + esc(age) + '</span></p>' +
          '<p class="girl-card-size">' + esc(sizes) + '</p>' +
        '</div>' +
      '</a>' +
      '<div class="girl-card-flags">' + flagsHtml + '</div>' +
      tagsHtml +
      '<a class="girl-card-official" href="/girls/' + esc(g.id) + '" target="_self"' +
        ' aria-label="' + esc(g.name) + ' のオフィシャルプロフィール" data-i18n="girl_official_profile">オフィシャルプロフ</a>' +
    '</div>';
  }

  // 対象グリッドを収集
  var mainGrid  = document.getElementById('girl-grid');     // /girls 一覧
  var schedGrid = document.getElementById('schedule-grid'); // top/schedule（schedule-page.jsがhide/show管理）
  // top の新人グリッド: .girl-grid で id 無しの最初の要素
  var newGrid   = document.querySelector('.girl-grid:not([id])');
  if (!mainGrid && !schedGrid && !newGrid) return;

  var shop = window.__SHOP_ID;
  if (!shop) return;

  fetch('/api/girls.php?action=list&shop_id=' + encodeURIComponent(shop) + '&limit=300', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !Array.isArray(d.girls)) return; // 失敗時は SSG 表示を維持

      var liveMap = {};
      d.girls.forEach(function (g) { liveMap[String(g.id)] = g; });

      // 1. 非掲載になったカードを除去
      document.querySelectorAll('.girl-card[data-id]').forEach(function (c) {
        if (!liveMap[c.getAttribute('data-id')]) c.remove();
      });

      // 2. SSGに無い新規女性を追加
      function addMissing(grid, filterFn) {
        if (!grid) return;
        var existing = {};
        grid.querySelectorAll('.girl-card[data-id]').forEach(function (c) {
          existing[c.getAttribute('data-id')] = 1;
        });
        d.girls.forEach(function (g) {
          if (existing[String(g.id)]) return;
          if (filterFn && !filterFn(g)) return;
          grid.insertAdjacentHTML('beforeend', buildCard(g));
        });
      }

      addMissing(mainGrid, null);                                          // /girls: 全員
      addMissing(schedGrid, null);                                         // schedule: 全員（schedule-page.jsがhide/show）
      addMissing(newGrid, function (g) { return isNewcomer(g.in_date); }); // top新人セクション: 新人のみ

      // 並びは「入店日が新しい順」（2026-07-18 店長指示）。addMissing は末尾appendのため、
      //   デプロイ後に登録された子が最後尾に表示されてしまう（むぎ実例）。data-in(=YYYYMMDD数値)
      //   降順→id降順で並べ替える。件数上限なし＝新人セクションも入店3ヶ月未満なら全員表示。
      function sortByInDate(grid) {
        if (!grid) return;
        var cards = Array.prototype.slice.call(grid.querySelectorAll('.girl-card[data-id]'));
        cards.sort(function (a, b) {
          return (parseInt(b.getAttribute('data-in') || '0', 10) - parseInt(a.getAttribute('data-in') || '0', 10))
              || (parseInt(b.getAttribute('data-id') || '0', 10) - parseInt(a.getAttribute('data-id') || '0', 10));
        });
        cards.forEach(function (c) { grid.appendChild(c); });   // appendChild は既存ノードの移動＝ソート順に並び直す
      }
      sortByInDate(newGrid);    // top新人セクション（入店3ヶ月未満・入店日新しい順・全員）
      sortByInDate(mainGrid);   // /girls 全員一覧（初期表示も入店日新しい順。girls-filter.jsの既定ソートと同一規則）
      // schedGrid は schedule-page.js が出勤開始時刻順に並べ替えるため触らない

      // 3+4. 既存カードの写真＋文字情報を最新化（CTRL編集を即反映）
      document.querySelectorAll('.girl-card[data-id]').forEach(function (c) {
        var g = liveMap[c.getAttribute('data-id')];
        if (!g) return;

        // --- 3. 写真 ---
        var newSrc = g.photo ? asset(g.photo) : '';
        var img = c.querySelector('img.girl-card-img');
        if (newSrc && img) {
          // SSGの絶対URLと比較（ASSET_ORIGIN='https://admi2888.com' で統一済み）
          if (img.src !== newSrc) preloadThenSwap(img, newSrc);
        } else if (newSrc && !img) {
          // 写真なし→写真あり（新規アップ）。プリロード後に挿入（無写真プレースホルダの空白期間を最小化）
          var noPhoto = c.querySelector('.girl-card-no-photo');
          if (noPhoto) {
            var pre = new Image();
            pre.onload = pre.onerror = function () {
              var newImg = document.createElement('img');
              newImg.src = newSrc;
              newImg.alt = esc(g.name || '');
              newImg.width = 300;
              newImg.height = 400;
              newImg.loading = 'lazy';
              newImg.className = 'girl-card-img';
              noPhoto.replaceWith(newImg);
            };
            pre.src = newSrc;
          }
        }

        // --- 4. 文字情報（要素単位patch＝出勤バッジ等の後入れ要素を壊さない） ---
        var tags  = (g.tags || []).slice(0, 4);
        var isNew = isNewcomer(g.in_date) ? 1 : 0;
        var inNum = g.in_date ? (parseInt(String(g.in_date).slice(0, 10).replace(/-/g, ''), 10) || 0) : 0;

        // data-*（girls-filter.js の並び替え/絞り込みが最新値で動くように）
        c.setAttribute('data-in', String(inNum));
        c.setAttribute('data-height', String(g.height || 0));
        c.setAttribute('data-bust', String(g.bust || 0));
        c.setAttribute('data-age', String(g.age || 0));
        c.setAttribute('data-name', g.name || '');
        c.setAttribute('data-new', String(isNew));
        c.setAttribute('data-tags', tags.join('|'));

        // サムネのリンク先（external_url 変更）
        var wrap = c.querySelector('a.girl-card-img-wrap');
        var wantHref = g.external_url || '/girls/' + g.id;
        if (wrap && wrap.getAttribute('href') !== wantHref) wrap.setAttribute('href', wantHref);

        // 名前＋年齢
        var nameEl = c.querySelector('.girl-card-name');
        if (nameEl) {
          var wantName = esc(g.name) + '<span class="girl-card-age">' + esc(g.age ? '(' + g.age + ')' : '') + '</span>';
          var ageSpan = nameEl.querySelector('.girl-card-age');
          var curName = (nameEl.childNodes[0] && nameEl.childNodes[0].nodeType === 3 ? nameEl.childNodes[0].nodeValue : '') +
                        '|' + (ageSpan ? ageSpan.textContent : '');
          if (curName !== (g.name || '') + '|' + (g.age ? '(' + g.age + ')' : '')) nameEl.innerHTML = wantName;
        }

        // スリーサイズ行
        var sizeEl = c.querySelector('.girl-card-size');
        if (sizeEl) {
          var wantSize = 'T' + (g.height || '—') + ' B' + (g.bust || '—') + '(' + (g.cup || '—') + ') W' + (g.waist || '—') + ' H' + (g.hip || '—');
          if (sizeEl.textContent !== wantSize) sizeEl.textContent = wantSize;
        }

        // 属性フラグ（順序: 新人→待ち合わせ→電話→インバウンド→ジェンダーレス、GirlCardItem.astroと同一）
        //   比較キーは img の src（flag-xxx.png）で行う。alt/titleはi18n.jsが言語切替時に
        //   書き換えるため、alt値ベースの比較だと英語モードで毎回誤検知＝無駄な再構築が起きてしまう。
        var flagsBox = c.querySelector('.girl-card-flags');
        if (flagsBox) {
          var FLAG_DEFS = [
            { on: isNew,             slug: 'newgirl',     label: '新人',           i18n: 'flag_newgirl' },
            { on: !!g.is_trial,      slug: 'machiawase',  label: '待ち合わせ',      i18n: 'flag_machiawase' },
            { on: !!g.is_tel,        slug: 'tel',         label: '電話',           i18n: 'flag_tel' },
            { on: !!g.is_inbound,    slug: 'inbound',     label: 'インバウンド',    i18n: 'flag_inbound' },
            { on: !!g.is_genderless, slug: 'genderless',  label: 'ジェンダーレス', i18n: 'flag_genderless' },
          ];
          var wantDefs = FLAG_DEFS.filter(function (d) { return d.on; });
          var curSlugs = [].map.call(flagsBox.querySelectorAll('img'), function (i) {
            var m = (i.getAttribute('src') || '').match(/flag-([a-z]+)\.png/);
            return m ? m[1] : '';
          });
          if (wantDefs.map(function (d) { return d.slug; }).join('|') !== curSlugs.join('|')) {
            flagsBox.innerHTML = wantDefs.map(function (d) {
              return '<img src="/img/flag-' + d.slug + '.png" class="girl-card-flag-icon" width="128" height="128" alt="' + d.label + '" title="' + d.label + '" loading="lazy" data-i18n-attr="alt=' + d.i18n + ', title=' + d.i18n + '" />';
            }).join('');
            if (window.admiI18n) window.admiI18n.reapply(); // 新規挿入分に選択中の言語を即適用
          }
        }

        // 特徴タグ絵文字（差分時のみ rebuild／空→除去／無→オフィシャルプロフリンクの前に挿入）
        var tagsBox = c.querySelector('.girl-card-tags');
        var curTags = tagsBox
          ? [].map.call(tagsBox.querySelectorAll('.girl-card-tag-ico'), function (s) { return s.getAttribute('title') || ''; })
          : [];
        if (tags.join('|') !== curTags.join('|')) {
          if (!tags.length) {
            if (tagsBox) tagsBox.remove();
          } else {
            var tagsHtml = tags.map(function (t) {
              return '<span class="girl-card-tag-ico" title="' + esc(t) + '" aria-label="' + esc(t) + '">' + tagEmoji(t) + '</span>';
            }).join('');
            if (tagsBox) {
              tagsBox.innerHTML = tagsHtml;
            } else {
              var official = c.querySelector('.girl-card-official');
              var div = document.createElement('div');
              div.className = 'girl-card-tags';
              div.innerHTML = tagsHtml;
              if (official) c.insertBefore(div, official); else c.appendChild(div);
            }
          }
        }
      });

      if (window.admiI18n) window.admiI18n.reapply(); // 新規追加カード(buildCard)等に選択中の言語を即適用
    })
    .catch(function () {}); // 通信失敗時は SSG 表示を維持
})();
