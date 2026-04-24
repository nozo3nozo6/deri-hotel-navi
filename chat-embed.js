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

    // 単発アンカー: iframe top を visual viewport top に合わせる（必要な時だけ scrollBy）
    function alignOnce(iframe) {
        var vv = window.visualViewport;
        var rect = iframe.getBoundingClientRect();
        var drift = rect.top - (vv ? vv.offsetTop : 0);
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
    // 安全サイズ = innerHeight × 0.35（iPhone 縦 ~230 / 横 ~130）で、最低 150px 保証
    function prefocusForInput(iframe) {
        saveIframeStyle(iframe);
        var safeH = Math.max(150, Math.floor(window.innerHeight * 0.35));
        forceHeight(iframe, safeH);
        alignOnce(iframe);
        prefocusedIframe = iframe;
        try {
            iframe.contentWindow.postMessage({ type: 'ychat:embed-h', h: safeH }, '*');
            diag('prefocus h=' + safeH);
        } catch (_) {}
    }

    // kb 開通知後の最終サイズ: iframe を vv.height に拡大。上端は prefocus で揃っているので
    // 下に伸びるだけ → 下端 = キーボード上端、入力欄がキーボード直上に自動配置。
    function expandToVV(iframe) {
        var vv = window.visualViewport;
        if (!vv) return;
        var targetH = Math.floor(vv.height);
        if (targetH < 100) return;
        saveIframeStyle(iframe);
        forceHeight(iframe, targetH);
        alignOnce(iframe); // 保険（prefocus してない経路用）
        try {
            iframe.contentWindow.postMessage({ type: 'ychat:embed-h', h: targetH }, '*');
            diag('expand h=' + targetH);
        } catch (_) {}
    }

    function resetIframeHeight(iframe) {
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
        // resize 反映後に一度だけ snap（以降は追従しない → ユーザーは自由にスクロール）
        requestAnimationFrame(function () {
            alignOnce(iframe);
            requestAnimationFrame(function () { alignOnce(iframe); });
        });
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
                activeIframe = iframe;
                var vv = window.visualViewport;
                var kbOpen = vv && (window.innerHeight - vv.height) > 100;
                if (kbOpen) {
                    // kb 既に開: 直接 expand（他 input への re-focus ケース）
                    expandToVV(iframe);
                } else {
                    // kb まだ閉: prefocus で iframe を縮め iOS focus-scroll を不発化
                    prefocusForInput(iframe);
                }
                return;
            }
            if (d.type === 'ychat:widget-tap') {
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
