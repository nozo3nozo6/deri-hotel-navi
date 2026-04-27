/**
 * chat-embed.js — YobuChat 埋込ブリッジ (B+α 設計, 2026-04-27)
 *
 * 設計思想:
 *   親側はサイズ制御を一切しない. iframe は customer 指定の固定高さで動く.
 *   chat.js (子側) も埋込モードでは kb 追従をしない.
 *   iOS のデフォルト挙動 (input focus → 入力欄が見える位置へ自動スクロール) に任せる.
 *
 *   過去 4 日間ハマった visualViewport / postMessage / position:fixed の
 *   iframe + iOS の競合は構造的に回避した.
 *
 * 親 = init only:
 *   - data-ychat-slug を持つ全 iframe を自動ワイヤリング (MutationObserver で遅延挿入も拾う)
 *   - モバイル時の左右ガッター付与 (見た目調整, 16px)
 *   - postMessage 受信は一切しない (chat.js 側も送信しない)
 *
 * 旧仕様 (2026-04-27 削除):
 *   ychat:resize / input-focus / input-blur / widget-tap / embed-h / blur-input /
 *   enter-fullscreen / exit-fullscreen, alignOnce, expandToVV, fitToViewport,
 *   prefocusForInput, alignWatchdog, expandVerifyWatch, vv.resize listener — 全廃.
 */
(function () {
    'use strict';

    if (window.__yobuhoChatEmbedLoaded) return;
    window.__yobuhoChatEmbedLoaded = true;

    // モバイル時の左右ガッター. PC (vw>=600) では iframe の max-width 制約で auto-margin が
    // centering するので不要. 既に customer が ml/mr>=4px を inline 指定済みなら touch しない.
    function ensureGutter(iframe) {
        if (window.innerWidth >= 600) return;
        try {
            var cs = getComputedStyle(iframe);
            var ml = parseFloat(cs.marginLeft) || 0;
            var mr = parseFloat(cs.marginRight) || 0;
            if (ml >= 4 && mr >= 4) return;
            iframe.style.setProperty('width', 'calc(100% - 16px)', 'important');
            iframe.style.setProperty('margin-left', 'auto', 'important');
            iframe.style.setProperty('margin-right', 'auto', 'important');
            iframe.style.setProperty('display', 'block', 'important');
            iframe.style.setProperty('box-sizing', 'border-box', 'important');
        } catch (_) {}
    }

    function wire(iframe) {
        if (iframe.__ychatWired) return;
        iframe.__ychatWired = true;
        ensureGutter(iframe);
    }

    function scan(root) {
        var list = (root || document).querySelectorAll('iframe[data-ychat-slug]');
        for (var i = 0; i < list.length; i++) wire(list[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { scan(); }, { once: true });
    } else {
        scan();
    }

    if (typeof MutationObserver !== 'undefined') {
        var mo = new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
                var nodes = muts[i].addedNodes;
                for (var j = 0; j < nodes.length; j++) {
                    var n = nodes[j];
                    if (!n || n.nodeType !== 1) continue;
                    if (n.tagName === 'IFRAME' && n.hasAttribute && n.hasAttribute('data-ychat-slug')) {
                        wire(n);
                    } else if (n.querySelectorAll) {
                        scan(n);
                    }
                }
            }
        });
        try {
            mo.observe(document.documentElement, { childList: true, subtree: true });
        } catch (_) {}
    }
})();
