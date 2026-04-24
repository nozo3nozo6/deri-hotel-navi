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
 * UX仕様（リリース確定）:
 * - iframe は「ページ内の1セクション」扱い。全画面乗っ取り（overlay/reparent/position:fixed）は禁止
 * - ウィジェット内タップ全般: チャットヘッダーを viewport top にスナップ
 * - 入力欄タップ: 上記 + 入力欄がキーボード直上
 * - ウィジェット外（顧客HP）: 通常動作を一切邪魔しない
 *
 * 設計原理（iOS と競わない）:
 * - iOS の focus-scroll は「input を可視領域に入れる」挙動。iframe が tall だと iframe 上端を削ってでも
 *   input を押し込もうとする → チャットヘッダーが viewport から消える
 * - 解決: focus 時に iframe を **安全サイズ（innerHeight×0.35、最低150px）に縮める**。
 *   input は iframe bottom = 可視領域内に自然に収まるので iOS は scroll する必要がない
 *   → iframe top は viewport top 付近に維持される（競争なし = jitter なし）
 * - キーボード開通知（vv.resize）が来たら実際の vv.height に拡大。上端固定のまま下に伸びる
 *   → 上端 = チャットヘッダー、下端 = キーボード上端、入力欄 = キーボード直上（ダブルアンカー自動成立）
 *
 * 注意: iframe 内側 (chat.js) の visualViewport は iOS では iframe 自身の
 * レンダリング高さを返し、キーボード状態を検知できない。そのため「親側」で
 * iframe サイズを調整する必要がある。
 *
 * chat.html からの postMessage を受信:
 * - ychat:resize          → iframe 高さを中身追従（min/max clamp）
 * - ychat:widget-tap      → iframe 内任意タップ: iframe top を viewport top にスナップ
 * - ychat:input-focus     → 入力欄 focus: prefocus 縮小 + 最終 expandToVV（kb 開通知時）
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
    // prefocus 済みフラグ（kb 開通知時に expand を発動するかの判定）
    var prefocusedIframe = null;
    // prefocus 後に kb 開が来なかった時の安全復元タイマー
    var prefocusSafetyTimer = null;
    // input-focus dedupe: 1回の input タップで touchend + focusin の両方が
    // ychat:input-focus を送ってくるので、200ms 以内の重複を無視.
    // widget-tap も直後に click で来るが、input-focus が既に align 済みなので 400ms は無視.
    var lastInputFocusTs = 0;

    // iOS判定: focus-scroll が問題になるのは iOS のみ。Android/PC では prefocus しない
    var isIOS = (function () {
        var ua = navigator.userAgent || '';
        if (/iPad|iPhone|iPod/.test(ua)) return true;
        // iPadOS 13+ は Mac として UA 出てくる
        if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
        return false;
    })();

    // 顧客HPの sticky/fixed トップ要素群の最大下端を検出.
    // 注意: elementsFromPoint(x, y) は「点 (x,y) を含む要素」しか返さない.
    // 例えば go-kichi.com のように 2層ヘッダー (breadcrumb y=0-30 + nav y=30-130) がある場合、
    // y=5 だけサンプルすると breadcrumb しか取れず nav を見逃す → stickyInset=30 で nav 裏に iframe 上端が潜る.
    // → 複数 y (5, 30, 60, 100, 150) で スキャンして最大下端を取る.
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
                        // rect.top が viewport 上端付近 (<=y) = top を覆う固定要素. rect.bottom が最大のものを採用.
                        if (rect.top <= y && rect.bottom > maxBottom) {
                            maxBottom = rect.bottom;
                        }
                    }
                }
            }
        }
        // 過検出防止: viewport の 30% を超えるインセットは無視（ヒーロー要素等に騙されない）
        return Math.min(maxBottom, Math.floor(window.innerHeight * 0.3));
    }

    // 単発アンカー: iframe top を「可視領域のトップ（sticky nav の直下）」に合わせる。
    // 顧客HPが position:fixed のヘッダーを持っている場合も chat-header が隠れないようにする。
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

    // iframe サイズ記憶（1度だけ）
    function saveIframeStyle(iframe) {
        if (savedIframeStyle !== null) return;
        savedIframeStyle = {
            height: iframe.style.height || '',
            maxHeight: iframe.style.maxHeight || '',
            minHeight: iframe.style.minHeight || ''
        };
    }

    // iframe 高さを強制（!important で顧客HP CSS に勝つ）
    function forceHeight(iframe, h) {
        iframe.style.setProperty('height', h + 'px', 'important');
        iframe.style.setProperty('max-height', h + 'px', 'important');
        iframe.style.setProperty('min-height', h + 'px', 'important');
    }

    // プリフォーカス: iframe を安全サイズに縮めて iOS focus-scroll を不発化 + align
    // 安全サイズ = (innerHeight - stickyInset) × 0.35、最低 150px 保証
    // 安全タイマー: kb 開通知が 800ms 以内に来なければ自動復元（縮み残りロック防止）
    function prefocusForInput(iframe) {
        saveIframeStyle(iframe);
        var stickyInset = getStickyTopInset();
        var usable = Math.max(200, window.innerHeight - stickyInset);
        var safeH = Math.max(150, Math.floor(usable * 0.35));
        forceHeight(iframe, safeH);
        alignOnce(iframe);
        prefocusedIframe = iframe;
        try {
            iframe.contentWindow.postMessage({ type: 'ychat:embed-h', h: safeH }, '*');
            diag('prefocus h=' + safeH + ' sticky=' + stickyInset);
        } catch (_) {}
        if (prefocusSafetyTimer) clearTimeout(prefocusSafetyTimer);
        prefocusSafetyTimer = setTimeout(function () {
            prefocusSafetyTimer = null;
            // kb 開通知が 1000ms 以内に来なければ iframe 復元 (kb 真に開かないケース).
            // activeIframe は null にしない: kb が遅れて開いた時 onVVChange の expandToVV が動くように.
            if (prefocusedIframe === iframe && !lastKbOpen) {
                diag('prefocus safety fallback: kb never opened');
                resetIframeHeight(iframe);
            }
        }, 1000);
    }

    // kb 開通知後の最終サイズ: iframe を (vv.height - stickyInset) に拡大。
    // iframe top = sticky nav 直下、iframe bottom = キーボード上端 → chat-header と入力欄が同時に可視.
    function expandToVV(iframe) {
        if (prefocusSafetyTimer) { clearTimeout(prefocusSafetyTimer); prefocusSafetyTimer = null; }
        var vv = window.visualViewport;
        if (!vv) return;
        var stickyInset = getStickyTopInset();
        var targetH = Math.floor(vv.height - stickyInset);
        if (targetH < 100) return;
        saveIframeStyle(iframe);
        forceHeight(iframe, targetH);
        alignOnce(iframe);
        try {
            iframe.contentWindow.postMessage({ type: 'ychat:embed-h', h: targetH }, '*');
            diag('expand h=' + targetH + ' sticky=' + stickyInset);
        } catch (_) {}
    }

    function resetIframeHeight(iframe) {
        if (prefocusSafetyTimer) { clearTimeout(prefocusSafetyTimer); prefocusSafetyTimer = null; }
        prefocusedIframe = null;
        if (savedIframeStyle !== null) {
            iframe.style.removeProperty('height');
            iframe.style.removeProperty('max-height');
            iframe.style.removeProperty('min-height');
            if (savedIframeStyle.height) iframe.style.height = savedIframeStyle.height;
            if (savedIframeStyle.maxHeight) iframe.style.maxHeight = savedIframeStyle.maxHeight;
            if (savedIframeStyle.minHeight) iframe.style.minHeight = savedIframeStyle.minHeight;
            savedIframeStyle = null;
        }
        // kb-close アニメ (~300ms) + iOS の自律 scroll が settle してから 1発だけ snap.
        // rAF 2重発火は scrollBy 連発で「上に行って下に戻る」ジッター原因になるので単発に統一.
        setTimeout(function () { alignOnce(iframe); }, 350);
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
            // 閉→開 エッジ: prefocus 縮小後の最終 expand（vv.height に拡大）
            if (activeIframe) expandToVV(activeIframe);
        } else if (!kbOpen && lastKbOpen) {
            // 開→閉 エッジ: iframe サイズ復元 + snap-to-top
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
                // dedupe: touchend(capture) + focusin の 2重発火を抑制
                var now = Date.now();
                if (now - lastInputFocusTs < 200) {
                    diag('input-focus deduped');
                    return;
                }
                lastInputFocusTs = now;
                activeIframe = iframe;
                var vv = window.visualViewport;
                var kbOpen = vv && (window.innerHeight - vv.height) > 100;
                if (kbOpen) {
                    // kb 既に開: 直接 expand（他 input への re-focus ケース）
                    expandToVV(iframe);
                } else if (isIOS) {
                    // iOS で kb まだ閉: prefocus で iframe を縮め focus-scroll を不発化
                    // (kb 開通知が来なければ 800ms で自動復元)
                    prefocusForInput(iframe);
                } else {
                    // Android/PC: focus-scroll 問題なし。align だけして kb 開通知を待つ
                    alignOnce(iframe);
                }
                return;
            }
            if (d.type === 'ychat:widget-tap') {
                // input-focus の直後 (400ms 以内) は input-focus 経路が既に align 済み.
                // ここで alignOnce を重ねると iOS focus-scroll と殴り合って「上→下」ジッター発生.
                if (Date.now() - lastInputFocusTs < 400) {
                    diag('widget-tap suppressed (input-focus recent)');
                    return;
                }
                // ウィジェット内任意タップ: iframe top を viewport top にスナップ
                // kb 開中の input 再タップは input-focus 経路が別途処理するのでここは noop
                var vv2 = window.visualViewport;
                if (!(vv2 && (window.innerHeight - vv2.height) > 100)) {
                    alignOnce(iframe);
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
