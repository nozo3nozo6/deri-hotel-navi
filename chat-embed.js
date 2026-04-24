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
 * UX仕様（リリース確定、最小構成）:
 * - iframe は「ページ内の1セクション」扱い。全画面乗っ取り（overlay/reparent/position:fixed）は禁止
 * - ウィジェット内タップ全般: チャットヘッダーを viewport top（sticky nav 直下）にスナップ
 * - iframe 高さは変更しない: 内部レイアウト（#chat-root:fixed + visualViewport 追従）が
 *   キーボード開閉を自律的に処理するので、親側で iframe を縮める必要はない
 *
 * 過去の複雑な prefocus/expand/watchdog/input-blur 方式は放棄した:
 * - iOS の visualViewport.height が kb-close 後も嘘をつくバグに対し、複数 signal を
 *   重ねても確実に復元できないケースが残り続けた（memory 参照）
 * - そもそも chat.js 内の #chat-root を position:fixed + visualViewport で作っているので、
 *   iframe を縮める必要は原理的になかった
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

    // input-focus dedupe: 1回の input タップで touchend + focusin の両方が
    // ychat:input-focus を送ってくるので、200ms 以内の重複を無視.
    // widget-tap も直後に click で来るが、input-focus が既に align 済みなので 400ms は無視.
    var lastInputFocusTs = 0;

    // 顧客HPの sticky/fixed トップ要素群の最大下端を検出.
    // 複数層ヘッダー（例: breadcrumb y=0-30 + nav y=30-130）を拾うため複数 y でスキャン.
    function getStickyTopInset() {
        if (typeof document.elementsFromPoint !== 'function') return 0;
        var maxBottom = 0;
        var iw = window.innerWidth;
        var xSamples = [Math.floor(iw * 0.1), Math.floor(iw * 0.5), Math.floor(iw * 0.9)];
        var ySamples = [5, 30, 60, 100, 150];
        for (var yi = 0; yi < ySamples.length; yi++) {
            var y = ySamples[yi];
            for (var xi = 0; xi < xSamples.length; xi++) {
                var x = xSamples[xi];
                var els = document.elementsFromPoint(x, y) || [];
                for (var j = 0; j < els.length; j++) {
                    var el = els[j];
                    if (!el || el === document.documentElement || el === document.body) continue;
                    var cs;
                    try { cs = getComputedStyle(el); } catch (_) { continue; }
                    if (cs.position === 'fixed' || cs.position === 'sticky') {
                        var rect = el.getBoundingClientRect();
                        if (rect.top <= y && rect.bottom > maxBottom) {
                            maxBottom = rect.bottom;
                        }
                    }
                }
            }
        }
        // 過検出防止: viewport の 30% を超えるインセットは無視
        return Math.min(maxBottom, Math.floor(window.innerHeight * 0.3));
    }

    // 単発アンカー: iframe top を「可視領域のトップ（sticky nav の直下）」に合わせる.
    function alignOnce(iframe) {
        var vv = window.visualViewport;
        var stickyInset = getStickyTopInset();
        var rect = iframe.getBoundingClientRect();
        var targetY = (vv ? vv.offsetTop : 0) + stickyInset;
        var drift = rect.top - targetY;
        if (Math.abs(drift) > 0.5) {
            window.scrollBy(0, drift);
        }
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
                // dedupe: touchend(capture) + focusin の 2重発火を抑制
                var now = Date.now();
                if (now - lastInputFocusTs < 200) {
                    diag('input-focus deduped');
                    return;
                }
                lastInputFocusTs = now;
                alignOnce(iframe);
                return;
            }
            if (d.type === 'ychat:widget-tap') {
                // input-focus の直後 (400ms 以内) は align 済みなのでスキップ
                if (Date.now() - lastInputFocusTs < 400) {
                    diag('widget-tap suppressed (input-focus recent)');
                    return;
                }
                alignOnce(iframe);
                return;
            }
            // ychat:input-blur / ychat:exit-fullscreen は後方互換で受信するが no-op
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
