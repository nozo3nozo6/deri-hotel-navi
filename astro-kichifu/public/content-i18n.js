/* ============================================================
 * content-i18n.js — CTRL入力の動的コンテンツを選択言語へ機械翻訳
 *   静的UIラベルは i18n.js（data-i18n属性）が担当。本スクリプトは
 *   お知らせ本文・女性のコメント/プロフィール回答など、店舗が自由入力する
 *   [data-i18n-dynamic] 要素だけを対象に /api/translate.php（Gemini+DBキャッシュ）で翻訳する。
 *   window.admiI18n の 'admi:langchange' イベントで言語切替に追従（i18n.js必須）。
 *   client-refresh JS（news-latest.js 等）が後からDOMに要素を追加した場合は、
 *   各JSの更新処理の最後で window.applyContentI18n() を呼べば再適用される。
 *   既存の[data-i18n-dynamic]要素の中身をJS側で直接書き換えた場合（例: girl-detail-refresh.js
 *   がCTRL編集後の新しい日本語テキストに差し替えた場合）は、そのままだと本スクリプトが前回
 *   キャッシュした「古い原文」を使い続けてしまう。window.applyContentI18n(true) を呼べば
 *   原文キャッシュを全リセットしてから翻訳し直す。
 * ============================================================ */
(function () {
  'use strict';
  // i18n.js の SUPPORTED（ja/en/zh-CN/zh-TW/ko）→ 翻訳API言語コード（ja/en/zh/zh-tw/ko）
  var LANG_MAP = { ja: 'ja', en: 'en', 'zh-CN': 'zh', 'zh-TW': 'zh-tw', ko: 'ko' };
  var originals = new WeakMap(); // 要素 → 元のHTML（ja復帰用）
  var inflight = new WeakMap();  // 要素 → 進行中のリクエストトークン（連打・切替競合対策）

  // 一覧ページ(news/girls等)は data-i18n-dynamic 要素が数十個になり得るため、
  // 翻訳APIへの同時リクエスト数を絞る簡易キュー（Gemini無料枠のレート制限対策）。
  var MAX_CONCURRENT = 4;
  var queue = [];
  var active = 0;
  function enqueue(task) {
    queue.push(task);
    pump();
  }
  function pump() {
    while (active < MAX_CONCURRENT && queue.length) {
      var task = queue.shift();
      active++;
      task().finally(function () { active--; pump(); });
    }
  }

  function htmlToText(html) {
    return String(html)
      .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '') // style/scriptはブロックごと除去（中身のCSS/JSを翻訳APIに送らない）
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();
  }
  function textToHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
  }

  function translateEl(el, apiLang) {
    if (!originals.has(el)) originals.set(el, el.innerHTML);
    var original = originals.get(el);
    if (apiLang === 'ja') { el.innerHTML = original; return; }
    if (/<(img|iframe|video)\b/i.test(original)) return; // 複雑なHTML（画像埋込等）は翻訳せず原文のまま
    var plain = htmlToText(original);
    if (!plain) return;

    var token = {};
    inflight.set(el, token);
    enqueue(function () {
      return fetch('/api/translate.php?text=' + encodeURIComponent(plain) + '&from=ja&to=' + apiLang, { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (inflight.get(el) !== token) return; // 応答が来る前に別言語へ切り替わった/再翻訳された→古い応答は破棄
          if (d && d.translated) el.innerHTML = textToHtml(d.translated);
        })
        .catch(function () { /* 失敗時は原文のまま維持 */ });
    });
  }

  function applyAll(lang) {
    var apiLang = LANG_MAP[lang] || 'ja';
    queue.length = 0; // 言語切替の連打時、古い言語向けの未実行タスクは破棄
    document.querySelectorAll('[data-i18n-dynamic]').forEach(function (el) { translateEl(el, apiLang); });
  }

  window.applyContentI18n = function (forceReset) {
    if (forceReset) { originals = new WeakMap(); inflight = new WeakMap(); }
    if (window.admiI18n) applyAll(window.admiI18n.getLang());
  };

  window.addEventListener('admi:langchange', function (e) { applyAll(e.detail.lang); });
})();
