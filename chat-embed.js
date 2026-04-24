/**
 * chat-embed.js — YobuChat 外部サイト埋込ブリッジ
 *
 * 使い方: 顧客HPに iframe 1つ + 1行 script-src を貼るだけ
 *   <iframe data-ychat-slug="my-slug" src="https://yobuho.com/chat/my-slug/?embed=1"
 *           style="..." title="お問い合わせチャット"></iframe>
 *   <script src="https://yobuho.com/chat-embed.js" async></script>
 *
 * 設計方針:
 * - inline script を使わない → CMSの description auto-extraction を汚染しない
 * - サーバー配信なので改良が全埋込先に自動反映（.htaccess で 1h cache + revalidate）
 * - data-ychat-slug を持つ全 iframe を自動検出してワイヤリング
 * - data-ychat-min / data-ychat-max でページ単位に高さ範囲を指定可能（省略時 500-900px）
 *
 * UX方針:
 * - iframe は「ページ内の1セクション」扱い。全画面乗っ取りは**しない**
 * - 顧客HPのヘッダー/フッター/他ページ遷移を一切邪魔しない
 * - 入力 focus 時は iframe 位置にアンカーリンクスクロール（キーボードを避ける）
 * - 内部レイアウトの収縮は chat.js 側が visualViewport で対応（埋込側は関与しない）
 *
 * chat.html からの postMessage を受信:
 * - ychat:resize          → iframe 高さを中身追従（min/max clamp）
 * - ychat:input-focus     → iframe 末尾を画面内にスクロール（アンカーリンク方式）
 * - ychat:enter-fullscreen → アンカーリンク方式 scroll と同等（後方互換）
 * - ychat:exit-fullscreen  → 何もしない（後方互換の no-op）
 */
(function () {
    'use strict';

    if (window.__yobuhoChatEmbedLoaded) return;
    window.__yobuhoChatEmbedLoaded = true;

    var DEFAULT_MIN = 500;
    var DEFAULT_MAX = 900;

    // 診断: 顧客HPのURLに ?ychat_diag=1 を付けると on-screen にログ表示
    var diagMode = false;
    try { diagMode = /[?&]ychat_diag=1/.test(location.search); } catch (_) {}
    function diag(msg) {
        if (!diagMode) return;
        var el = document.getElementById('__ychat_parent_diag');
        if (!el) {
            el = document.createElement('div');
            el.id = '__ychat_parent_diag';
            el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483646;background:#002c;color:#0ff;font:11px/1.3 monospace;padding:4px 6px;max-height:30vh;overflow:auto;word-break:break-all;pointer-events:none';
            (document.body || document.documentElement).appendChild(el);
        }
        var line = document.createElement('div');
        line.textContent = '[' + new Date().toTimeString().slice(0, 8) + '] ' + msg;
        el.appendChild(line);
        while (el.childNodes.length > 20) el.removeChild(el.firstChild);
    }
    diag('chat-embed.js loaded');

    function scrollIframeIntoView(iframe) {
        // block:'start' で iframe 上端を可視領域の上端へ揃える。
        // チャットヘッダーが画面上部、入力欄がキーボード直上に来る（内部は chat.js の
        // visualViewport ハンドラが --embed-h を縮めて自動収縮）。
        try { iframe.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
        catch (_) { try { iframe.scrollIntoView(true); } catch (_e) {} }
    }

    function wire(iframe) {
        if (iframe.__ychatWired) return;
        iframe.__ychatWired = true;
        diag('wire() slug=' + iframe.getAttribute('data-ychat-slug'));

        if (diagMode) {
            try {
                var src = iframe.getAttribute('src') || '';
                if (src && !/[?&]diag=1/.test(src)) {
                    iframe.setAttribute('src', src + (src.indexOf('?') >= 0 ? '&' : '?') + 'diag=1');
                    diag('propagated diag=1 to iframe src');
                }
            } catch (_) {}
        }

        var min = parseInt(iframe.getAttribute('data-ychat-min'), 10);
        var max = parseInt(iframe.getAttribute('data-ychat-max'), 10);
        if (!min || min < 200) min = DEFAULT_MIN;
        if (!max || max < min) max = DEFAULT_MAX;

        window.addEventListener('message', function (e) {
            if (e.source !== iframe.contentWindow) return;
            var d = e.data;
            if (!d || typeof d !== 'object') return;
            diag('recv ' + d.type);
            if (d.type === 'ychat:resize') {
                var h = d.h | 0;
                if (h < min) h = min;
                else if (h > max) h = max;
                iframe.style.height = h + 'px';
                return;
            }
            if (d.type === 'ychat:input-focus' || d.type === 'ychat:enter-fullscreen') {
                // アンカーリンク方式: iframe 末尾を可視領域内へ（キーボード上に入力欄が来る）
                // 内部レイアウトの収縮は chat.js が visualViewport で対応
                scrollIframeIntoView(iframe);
                return;
            }
            if (d.type === 'ychat:exit-fullscreen') {
                // 全画面化していないので復元不要（後方互換のため no-op）
                return;
            }
        });
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

    // 後から DOM に iframe が挿入された場合（SPA / 遅延挿入 CMS）も拾う
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
