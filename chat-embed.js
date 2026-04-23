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
 * chat.html からの postMessage を受信:
 * - ychat:resize          → iframe 高さを中身追従（min/max clamp）
 * - ychat:input-focus     → iframe 末尾を画面内にスクロール（iOS キーボード対策）
 * - ychat:enter-fullscreen → iframe を一時全画面化（タッチ端末で入力開始時）
 * - ychat:exit-fullscreen  → 元のインラインサイズに復帰
 */
(function () {
    'use strict';

    if (window.__yobuhoChatEmbedLoaded) return;
    window.__yobuhoChatEmbedLoaded = true;

    var DEFAULT_MIN = 500;
    var DEFAULT_MAX = 900;

    function wire(iframe) {
        if (iframe.__ychatWired) return;
        iframe.__ychatWired = true;

        var min = parseInt(iframe.getAttribute('data-ychat-min'), 10);
        var max = parseInt(iframe.getAttribute('data-ychat-max'), 10);
        if (!min || min < 200) min = DEFAULT_MIN;
        if (!max || max < min) max = DEFAULT_MAX;

        var saved = null;

        function enter() {
            if (saved) return;
            saved = {
                style: iframe.getAttribute('style') || '',
                bodyOverflow: document.body.style.overflow || '',
                htmlOverflow: document.documentElement.style.overflow || ''
            };
            iframe.style.cssText =
                'position:fixed;inset:0;top:0;left:0;right:0;bottom:0;' +
                'width:100vw;height:100dvh;max-width:none;max-height:none;' +
                'margin:0;border:0;border-radius:0;box-shadow:none;' +
                'z-index:2147483647;background:#fff;';
            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
        }

        function exit() {
            if (!saved) return;
            iframe.setAttribute('style', saved.style);
            document.body.style.overflow = saved.bodyOverflow;
            document.documentElement.style.overflow = saved.htmlOverflow;
            saved = null;
        }

        window.addEventListener('message', function (e) {
            if (e.source !== iframe.contentWindow) return;
            var d = e.data;
            if (!d || typeof d !== 'object') return;
            if (d.type === 'ychat:resize') {
                if (saved) return; // 全画面中は高さ書換無効
                var h = d.h | 0;
                if (h < min) h = min;
                else if (h > max) h = max;
                iframe.style.height = h + 'px';
                return;
            }
            if (d.type === 'ychat:input-focus') {
                if (saved) return;
                try { iframe.scrollIntoView({ block: 'end', behavior: 'smooth' }); }
                catch (_) { try { iframe.scrollIntoView(false); } catch (_e) {} }
                return;
            }
            if (d.type === 'ychat:enter-fullscreen') { enter(); return; }
            if (d.type === 'ychat:exit-fullscreen') { exit(); return; }
        });

        window.addEventListener('pagehide', exit);
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
