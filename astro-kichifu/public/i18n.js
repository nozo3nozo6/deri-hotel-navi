/* ============================================================
 * i18n.js — admi2888.com / kichifu.com 静的UIラベルの多言語切替
 *   ylka.jp の i18n.js を移植（同じ data-i18n 属性方式、5言語）。
 *   - data-i18n="key"      → textContent を t(key) に置換
 *   - data-i18n-html="key" → innerHTML を t(key) に置換（HTML含む文言用）
 *   - data-i18n-attr="title=key, aria-label=key" → 属性に t(key) を適用
 *   - data-i18n-meta="key" → <title>/<meta> の content/text を更新
 *   - [data-lang-btn="en"] のような要素は document 全体でイベント委譲して自動的に
 *     言語切替ボタンとして機能する（ylkaは各ヘッダーに個別実装だったが、
 *     ここではAssureTabsのLanguageタブ含め複数箇所に置けるよう1箇所に集約）。
 *   - localStorage('admi_lang') で永続化、初回は URL ?lang= → localStorage → Accept-Language。
 *   - 動的コンテンツ（お知らせ本文・女性コメント等）の翻訳は別ファイル content-i18n.js が担当。
 *     言語切替のたびに 'admi:langchange' カスタムイベントを発火し、content-i18n.js が拾う。
 * ============================================================ */
(function () {
  'use strict';
  var SUPPORTED = ['ja', 'en', 'zh-CN', 'zh-TW', 'ko'];
  var FALLBACK = 'ja';

  function detectLang() {
    var fromUrl = new URLSearchParams(location.search).get('lang');
    if (fromUrl && SUPPORTED.indexOf(fromUrl) !== -1) return fromUrl;
    var fromStorage = localStorage.getItem('admi_lang');
    if (fromStorage && SUPPORTED.indexOf(fromStorage) !== -1) return fromStorage;
    var nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
    if (nav.indexOf('en') === 0) return 'en';
    if (nav.indexOf('ko') === 0) return 'ko';
    if (nav.indexOf('zh-tw') === 0 || nav.indexOf('zh-hk') === 0 || nav.indexOf('zh-mo') === 0) return 'zh-TW';
    if (nav.indexOf('zh') === 0) return 'zh-CN';
    return FALLBACK;
  }

  var currentLang = detectLang();
  var dict = {};
  var fallbackDict = null;

  function fetchJson(lang) {
    return fetch('/i18n/' + lang + '.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('not found'); return r.json(); })
      .catch(function () { return {}; });
  }

  function loadDict(lang) {
    var p = fallbackDict ? Promise.resolve(fallbackDict) : fetchJson(FALLBACK).then(function (d) { fallbackDict = d; return d; });
    return p.then(function (fb) {
      if (lang === FALLBACK) return Object.assign({}, fb);
      return fetchJson(lang).then(function (target) { return Object.assign({}, fb, target); });
    });
  }

  function t(key) { return dict[key] || key; }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (key && dict[key] !== undefined) el.textContent = dict[key];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (key && dict[key] !== undefined) el.innerHTML = dict[key];
    });
    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      var spec = el.getAttribute('data-i18n-attr');
      spec.split(',').map(function (s) { return s.trim(); }).forEach(function (pair) {
        var parts = pair.split('=').map(function (s) { return s && s.trim(); });
        var attr = parts[0], key = parts[1];
        if (attr && key && dict[key] !== undefined) el.setAttribute(attr, dict[key]);
      });
    });
    var tEl = document.querySelector('title[data-i18n-meta]');
    if (tEl) {
      var tk = tEl.getAttribute('data-i18n-meta');
      if (dict[tk]) tEl.textContent = dict[tk];
    }
    document.querySelectorAll('meta[data-i18n-meta]').forEach(function (m) {
      var k = m.getAttribute('data-i18n-meta');
      if (dict[k]) m.setAttribute('content', dict[k]);
    });
    document.documentElement.lang = currentLang === 'ja' ? 'ja' : currentLang.toLowerCase();
    document.body.classList.toggle('is-translated', currentLang !== 'ja');
  }

  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1) lang = FALLBACK;
    currentLang = lang;
    localStorage.setItem('admi_lang', lang);
    return loadDict(lang).then(function (d) {
      dict = d;
      applyTranslations();
      document.querySelectorAll('[data-lang-btn]').forEach(function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-lang-btn') === lang);
      });
      window.dispatchEvent(new CustomEvent('admi:langchange', { detail: { lang: lang } }));
    });
  }

  // [data-lang-btn] は AssureTabs の Language タブ・ヘッダー等どこに置いても機能する（イベント委譲）
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-lang-btn]');
    if (btn) setLang(btn.getAttribute('data-lang-btn'));
  });

  // reapply: client-refresh JS（news-latest.js/girl-visibility.js等）がDOMに新規要素を
  //   追加/再構築した後に呼ぶと、その要素にも現在の言語の翻訳が即座に適用される。
  window.admiI18n = { setLang: setLang, t: t, getLang: function () { return currentLang; }, SUPPORTED: SUPPORTED, reapply: applyTranslations };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setLang(currentLang); });
  } else {
    setLang(currentLang);
  }
})();
