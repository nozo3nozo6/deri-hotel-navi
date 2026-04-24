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
 * UX方針（ダブルアンカー）:
 * - iframe は「ページ内の1セクション」扱い。全画面乗っ取り（overlay/reparent/position:fixed）は**しない**
 * - 顧客HPのヘッダー/フッター/他ページ遷移を一切邪魔しない
 * - 入力 focus + キーボード開:
 *     ① 上端アンカー: iframe top を visualViewport top に揃える（チャットヘッダー可視化）
 *     ② 下端アンカー: iframe height を vv.height に固定 → iframe bottom = キーボード上端
 *                     （chat.js 側の #chat-root{position:fixed} + --embed-h で入力欄が底辺に貼り付く）
 *   → 同時成立で「ヘッダー上端 + 入力欄キーボード直上」が得られる
 *   iOS の focus-scroll には競わず即時1発 + vv.scroll 沈黙待ち（150ms quiet / 1.5s hard）後に最終補正
 * - キーボード閉（入力外タップ含む）: iframe size を復元した上で、チャットヘッダーを
 *   viewport top に一度だけアンカー → そこからユーザーが意図的にスクロール
 * - キーボード開中の手動スクロール: settle 後はアンカー停止 → 本体HPヘッダー/フッター閲覧可
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
    // kb 開く前の iframe size を記憶 → kb 閉じで元の状態に戻す
    var savedIframeStyle = null;
    // settle 監視の世代管理（新規 fit / reset で旧 settle をキャンセル）
    var settleGen = 0;

    // 単発アンカー: iframe top を visual viewport top に合わせる
    function alignOnce(iframe) {
        var vv = window.visualViewport;
        if (!vv) return 0;
        var rect = iframe.getBoundingClientRect();
        var drift = rect.top - vv.offsetTop;
        if (Math.abs(drift) > 0.5) {
            window.scrollBy(0, drift);
            return Math.abs(drift);
        }
        return 0;
    }

    // iOS の focus-scroll が静まるのを待ってコールバック。
    // vv.scroll が quietMs 沈黙 = 静まった判定。maxMs でハードデッドライン。
    // iOS と競わず、向こうが動き終わってから1発アンカーする設計。
    function waitForScrollSettle(cb, quietMs, maxMs) {
        var vv = window.visualViewport;
        if (!vv) { cb(); return; }
        var mySession = ++settleGen;
        var deadline = performance.now() + (maxMs || 1500);
        var quiet = quietMs || 150;
        var timer = null;
        var handler = null;
        var done = false;
        var finish = function () {
            if (done) return;
            done = true;
            if (timer) clearTimeout(timer);
            if (handler) vv.removeEventListener('scroll', handler);
            if (mySession === settleGen) cb();
        };
        handler = function () {
            if (mySession !== settleGen || done) return;
            if (timer) clearTimeout(timer);
            var remaining = deadline - performance.now();
            if (remaining <= 0) { finish(); return; }
            timer = setTimeout(finish, Math.min(quiet, remaining));
        };
        vv.addEventListener('scroll', handler);
        // scroll が一切来ない場合の保険: すぐ timer を仕掛ける
        handler();
    }

    function fitIframeToVisibleArea(iframe) {
        var vv = window.visualViewport;
        if (!vv) return;
        var targetH = Math.floor(vv.height);
        if (targetH < 100) return;
        if (savedIframeStyle === null) {
            savedIframeStyle = {
                height: iframe.style.height || '',
                maxHeight: iframe.style.maxHeight || '',
                minHeight: iframe.style.minHeight || ''
            };
        }
        // iframe を可視領域の高さに固定（下端 = キーボード直上が自動成立）
        iframe.style.setProperty('height', targetH + 'px', 'important');
        iframe.style.setProperty('max-height', targetH + 'px', 'important');
        iframe.style.setProperty('min-height', targetH + 'px', 'important');
        // 即時1発（先手、うまくいけばこれで決まる）
        alignOnce(iframe);
        // iOS の追加 scroll が静まるのを待って最終アンカー（取りこぼし保険）
        waitForScrollSettle(function () {
            alignOnce(iframe);
            requestAnimationFrame(function () { alignOnce(iframe); });
        }, 150, 1500);
        try {
            iframe.contentWindow.postMessage({ type: 'ychat:embed-h', h: targetH }, '*');
            diag('fit h=' + targetH);
        } catch (_) {}
    }

    function resetIframeHeight(iframe) {
        settleGen++; // 走行中の settle をキャンセル
        if (savedIframeStyle !== null) {
            iframe.style.removeProperty('height');
            iframe.style.removeProperty('max-height');
            iframe.style.removeProperty('min-height');
            if (savedIframeStyle.height) iframe.style.height = savedIframeStyle.height;
            if (savedIframeStyle.maxHeight) iframe.style.maxHeight = savedIframeStyle.maxHeight;
            if (savedIframeStyle.minHeight) iframe.style.minHeight = savedIframeStyle.minHeight;
            savedIframeStyle = null;
        }
        // resize 反映を待ってから一発アンカー（以降は追従しない → 意図的スクロール可）
        waitForScrollSettle(function () {
            alignOnce(iframe);
            requestAnimationFrame(function () { alignOnce(iframe); });
        }, 150, 1000);
        try {
            iframe.contentWindow.postMessage({ type: 'ychat:embed-h', h: null }, '*');
            diag('reset');
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
