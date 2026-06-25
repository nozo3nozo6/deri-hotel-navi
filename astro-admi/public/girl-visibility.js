// ==========================================================================
// girl-visibility.js — 女性カードの掲載状況をページ読込ごとに最新化（デプロイ不要）
//   Astro は SSG で女性カードを焼き込むため、/ctrl のトグルOFF（girl_shops から
//   当該店舗行を削除）が再デプロイまで反映されない。本JSが現在の掲載中 id を
//   api/girls.php から取得し、非掲載になったカードを除去して即反映する。
//   ※ news-latest.js / schedule-page.js と同じ「SSG + クライアント動的補正」パターン。
//   ※ 除去のみ（OFF即反映）。ビルド後にONになった新規女性のカードは無いので追加はしない
//     （新規女性の登録は画像等の都合でどのみち再デプロイ前提）。
// ==========================================================================
(function () {
  'use strict';
  var cards = document.querySelectorAll('.girl-card[data-id]');
  if (!cards.length) return;                 // 女性カードが無いページは何もしない（無駄な fetch も避ける）

  var shop = window.__SHOP_ID;
  if (!shop) return;

  fetch('/api/girls.php?action=list&shop_id=' + encodeURIComponent(shop) + '&limit=300', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      // 取得失敗・形式不正時は SSG 表示を維持（API 異常で全消しを防ぐ）
      if (!d || !Array.isArray(d.girls)) return;
      var live = {};
      d.girls.forEach(function (g) { live[String(g.id)] = 1; });
      cards.forEach(function (c) {
        if (!live[c.getAttribute('data-id')]) c.remove();  // 掲載リストに無い = 非掲載 → 除去
      });
    })
    .catch(function () {});                   // 通信失敗時も SSG 表示を維持
})();
