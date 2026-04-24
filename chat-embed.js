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
 * - iframe のサイズもスタイルも変えない（本体ページのレイアウトを破壊しない）
 * - 入力 focus + キーボード開: 親ページをスクロールして iframe 下端を
 *   キーボードの真上（= visualViewport 下端）に揃える → 入力欄がキーボード直上に出る
 *   ユーザーはスワイプで iframe 上部（チャットヘッダー）・本体HPヘッダーを見れる
 * - キーボード閉: 何もしない（ユーザーの自然なスクロール位置を尊重）
 *
 * 注意: iframe 内側 (chat.js) の visualViewport は iOS では iframe 自身の
 * レンダリング高さを返し、キーボード状態を検知できない。そのため「親側」で
 * スクロール位置を調整する必要がある。
 *
 * chat.html からの postMessage を受信:
 * - ychat:resize          → iframe 高さを中身追従（min/max clamp）
 * - ychat:input-focus     → キーボード開いたら iframe 下端をキーボード上端に揃える
 * - ychat:enter-fullscreen → 後方互換で input-focus と同一
 * - ychat:exit-fullscreen  → no-op
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

    // 「最後に入力 focus を通知してきた iframe」をアクティブ扱い
    var activeIframe = null;
    var lastKbOpen = false;

    // iframe 上端を viewport 上端に揃え、「可視領域の高さ」を iframe に送る。
    // iframe 側の chat.js は --embed-h を受け取った値で上書きし、内部を収縮。
    // 結果: iframe element 自体は本体ページで 640px のまま（レイアウト破壊なし）
    //       iframe 内部の chat-root だけが 440px（= 可視高）に縮む
    //       → header が viewport top、input が keyboard 直上、両方可視
    function fitIframeToVisibleArea(iframe) {
        var vv = window.visualViewport;
        if (!vv) return;
        var rect = iframe.getBoundingClientRect();
        var desiredTop = vv.offsetTop || 0;
        var delta = rect.top - desiredTop;
        if (Math.abs(delta) > 2) {
            window.scrollBy(0, delta);
            // スクロール後の最新 rect
            rect = iframe.getBoundingClientRect();
        }
        // iframe の可視部分 = vv.height - 見切れ分
        var topClip = Math.max(0, desiredTop - rect.top);
        var effectiveH = Math.max(100, Math.min(iframe.offsetHeight, vv.height - Math.max(0, rect.top - desiredTop) - topClip));
        try {
            iframe.contentWindow.postMessage({ type: 'ychat:embed-h', h: effectiveH }, '*');
            diag('sent embed-h=' + Math.round(effectiveH) + ' (vv.h=' + Math.round(vv.height) + ' rect.top=' + Math.round(rect.top) + ')');
        } catch (_) {}
    }

    function resetIframeHeight(iframe) {
        try {
            iframe.contentWindow.postMessage({ type: 'ychat:embed-h', h: null }, '*');
            diag('sent embed-h=null (reset)');
        } catch (_) {}
    }

    // キーボード開閉の**エッジ**でだけ動く。開いてる最中の手動スクロールは妨害しない。
    function onVVChange() {
        var vv = window.visualViewport;
        if (!vv) return;
        var kbH = window.innerHeight - vv.height;
        var kbOpen = kbH > 100;
        if (kbOpen && !lastKbOpen) {
            // 閉→開 のエッジ: 一度だけ fit
            if (activeIframe) fitIframeToVisibleArea(activeIframe);
        } else if (!kbOpen && lastKbOpen) {
            // 開→閉 のエッジ: iframe の --embed-h をリセット
            diag('kb closed');
            if (activeIframe) resetIframeHeight(activeIframe);
            activeIframe = null;
        }
        lastKbOpen = kbOpen;
    }
    if (window.visualViewport) {
        // resize のみ監視（scroll は手動スクロール妨害の原因になるので監視しない）
        window.visualViewport.addEventListener('resize', onVVChange);
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
                activeIframe = iframe;
                // キーボードが既に開いていれば即座に fit（閉じていれば次の vv.resize で発火）
                var vv = window.visualViewport;
                if (vv && (window.innerHeight - vv.height) > 100) {
                    fitIframeToVisibleArea(iframe);
                }
                return;
            }
            if (d.type === 'ychat:exit-fullscreen') {
                return; // no-op（後方互換）
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
