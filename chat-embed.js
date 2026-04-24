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

    function wire(iframe) {
        if (iframe.__ychatWired) return;
        iframe.__ychatWired = true;
        diag('wire() slug=' + iframe.getAttribute('data-ychat-slug'));

        // 親に ?ychat_diag=1 が付いていれば iframe 側にも &diag=1 を伝播（同時に diag バー点灯）
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

        var saved = null;

        // 祖先要素が transform/filter/perspective/will-change/contain を持つと
        // containing block になり position:fixed が viewport に効かない。
        // 検出に頼らず **全ての祖先を無条件に中和**（見逃し防止）。exit で復元。
        function neutralizeAncestors() {
            var list = [];
            var cur = iframe.parentElement;
            var idx = 0;
            // html (documentElement) も含めて traversal（html に transform があるケース対応）
            while (cur) {
                var cs = null;
                try { cs = getComputedStyle(cur); } catch (_) {}
                var trapStr = '';
                if (cs) {
                    if (cs.transform && cs.transform !== 'none') trapStr += 'transform=' + cs.transform.slice(0, 30) + ' ';
                    if (cs.translate && cs.translate !== 'none') trapStr += 'translate=' + cs.translate + ' ';
                    if (cs.rotate && cs.rotate !== 'none') trapStr += 'rotate=' + cs.rotate + ' ';
                    if (cs.scale && cs.scale !== 'none') trapStr += 'scale=' + cs.scale + ' ';
                    if (cs.filter && cs.filter !== 'none') trapStr += 'filter ';
                    if (cs.perspective && cs.perspective !== 'none') trapStr += 'perspective ';
                    if (cs.willChange && cs.willChange !== 'auto') trapStr += 'wc=' + cs.willChange.slice(0, 20) + ' ';
                    if (cs.contain && cs.contain !== 'none') trapStr += 'contain=' + cs.contain + ' ';
                    if (cs.backdropFilter && cs.backdropFilter !== 'none') trapStr += 'bdf ';
                    if (cs.overflow && cs.overflow !== 'visible') trapStr += 'ovf=' + cs.overflow + ' ';
                    if (cs.clipPath && cs.clipPath !== 'none') trapStr += 'clip ';
                    if (cs.opacity && cs.opacity !== '1') trapStr += 'op=' + cs.opacity + ' ';
                    if (cs.isolation && cs.isolation !== 'auto') trapStr += 'iso=' + cs.isolation + ' ';
                    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') trapStr += 'mbm=' + cs.mixBlendMode + ' ';
                    if (cs.mask && cs.mask !== 'none') trapStr += 'mask ';
                }
                list.push({
                    el: cur,
                    transform: cur.style.transform,
                    translate: cur.style.translate,
                    rotate: cur.style.rotate,
                    scale: cur.style.scale,
                    filter: cur.style.filter,
                    perspective: cur.style.perspective,
                    willChange: cur.style.willChange,
                    contain: cur.style.contain,
                    backdropFilter: cur.style.backdropFilter,
                    overflow: cur.style.overflow,
                    clipPath: cur.style.clipPath,
                    opacity: cur.style.opacity,
                    isolation: cur.style.isolation,
                    mixBlendMode: cur.style.mixBlendMode,
                    mask: cur.style.mask,
                    webkitMask: cur.style.webkitMask
                });
                // 無条件中和: containing block 生成系
                cur.style.setProperty('transform', 'none', 'important');
                cur.style.setProperty('translate', 'none', 'important');
                cur.style.setProperty('rotate', 'none', 'important');
                cur.style.setProperty('scale', 'none', 'important');
                cur.style.setProperty('filter', 'none', 'important');
                cur.style.setProperty('perspective', 'none', 'important');
                cur.style.setProperty('will-change', 'auto', 'important');
                cur.style.setProperty('contain', 'none', 'important');
                cur.style.setProperty('backdrop-filter', 'none', 'important');
                // clip/clip-path
                cur.style.setProperty('clip-path', 'none', 'important');
                cur.style.setProperty('mask', 'none', 'important');
                cur.style.setProperty('-webkit-mask', 'none', 'important');
                // stacking context 生成系（z-index max の iframe を埋もれさせない）
                cur.style.setProperty('opacity', '1', 'important');
                cur.style.setProperty('isolation', 'auto', 'important');
                cur.style.setProperty('mix-blend-mode', 'normal', 'important');
                // overflow: visible（fixed を clip される可能性排除）
                // ただし html/body は後でまとめて hidden にするので中和対象から外す
                if (cur !== document.documentElement && cur !== document.body) {
                    cur.style.setProperty('overflow', 'visible', 'important');
                }
                if (trapStr) {
                    diag('[' + idx + '] ' + (cur.tagName || '?') + '.' +
                         (cur.className || '').toString().slice(0, 30) + ' [' + trapStr.trim() + ']');
                }
                idx++;
                cur = cur.parentElement;
            }
            diag('neutralized ' + list.length + ' ancestors (incl html)');
            return list;
        }

        function restoreAncestors(list) {
            for (var i = 0; i < list.length; i++) {
                var r = list[i];
                try {
                    r.el.style.transform = r.transform;
                    r.el.style.translate = r.translate;
                    r.el.style.rotate = r.rotate;
                    r.el.style.scale = r.scale;
                    r.el.style.filter = r.filter;
                    r.el.style.perspective = r.perspective;
                    r.el.style.willChange = r.willChange;
                    r.el.style.contain = r.contain;
                    r.el.style.backdropFilter = r.backdropFilter;
                    r.el.style.overflow = r.overflow;
                    r.el.style.clipPath = r.clipPath;
                    r.el.style.opacity = r.opacity;
                    r.el.style.isolation = r.isolation;
                    r.el.style.mixBlendMode = r.mixBlendMode;
                    r.el.style.mask = r.mask;
                    r.el.style.webkitMask = r.webkitMask;
                } catch (_) {}
            }
        }

        // 監視: iframe が position:fixed 以外に戻された / rect が viewport 外に動いた場合に警告
        var enterFsChangeHandler = null;

        function enterFallback() {
            // enter() 前のビューポート情報をログ
            if (diagMode) {
                try {
                    var vv = window.visualViewport;
                    diag('env: iw=' + window.innerWidth + ' ih=' + window.innerHeight +
                         ' sy=' + (window.scrollY | 0) +
                         ' sc=' + (document.scrollingElement ? document.scrollingElement.scrollTop | 0 : '?') +
                         (vv ? ' vv=' + Math.round(vv.width) + 'x' + Math.round(vv.height) +
                              '@' + Math.round(vv.offsetLeft) + ',' + Math.round(vv.offsetTop) +
                              ' scale=' + vv.scale.toFixed(2) : ''));
                } catch (_) {}
            }
            var scrollY = window.scrollY || document.documentElement.scrollTop || 0;
            saved = {
                mode: 'fallback',
                style: iframe.getAttribute('style') || '',
                bodyOverflow: document.body.style.overflow || '',
                htmlOverflow: document.documentElement.style.overflow || '',
                htmlScrollBehavior: document.documentElement.style.scrollBehavior || '',
                scrollY: scrollY,
                ancestors: neutralizeAncestors()
            };
            document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
            try { window.scrollTo(0, 0); } catch (_) {}
            // cssText ではなく setProperty で個別に !important を適用
            // (iOS Safari は cssText 内の !important を一部プロパティで無視するバグあり)
            var sp = function (k, v) { iframe.style.setProperty(k, v, 'important'); };
            sp('position', 'fixed');
            sp('top', '0');
            sp('left', '0');
            sp('right', '0');
            sp('bottom', '0');
            sp('width', '100vw');
            sp('height', '100dvh');
            sp('max-width', 'none');
            sp('max-height', 'none');
            sp('margin', '0');
            sp('padding', '0');
            sp('border', '0');
            sp('border-radius', '0');
            sp('box-shadow', 'none');
            sp('z-index', '2147483647');
            sp('background', '#fff');
            sp('transform', 'none');
            sp('translate', 'none');
            sp('rotate', 'none');
            sp('scale', 'none');
            sp('inset', '0');
            document.body.style.setProperty('overflow', 'hidden', 'important');
            document.documentElement.style.setProperty('overflow', 'hidden', 'important');

            // 根本原因診断: 我々の inline !important が computed に反映されているか検証
            // rect.y != 0 かつ computed top == '0px' → iOS 独自の positioning バグ（祖先 CB 以外の要因）
            // rect.y != 0 かつ computed top != '0px' → 何かが我々の inline !important を上書き
            if (diagMode) {
                var snap = function (when) {
                    try {
                        var cs = getComputedStyle(iframe);
                        var rect = iframe.getBoundingClientRect();
                        var vv = window.visualViewport;
                        var vvInfo = vv ? (' vv@' + Math.round(vv.offsetLeft) + ',' + Math.round(vv.offsetTop)) : '';
                        diag(when + ': r=' + Math.round(rect.x) + ',' + Math.round(rect.y) +
                             ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height) +
                             ' cs=' + cs.position + ' t:' + cs.top + ' l:' + cs.left +
                             ' m:' + cs.marginTop + ' tf:' + (cs.transform === 'none' ? 'none' : 'Y') +
                             ' sy=' + (window.scrollY | 0) + vvInfo);
                    } catch (e) { diag(when + ' err: ' + e.message); }
                };
                requestAnimationFrame(function () {
                    snap('rAF1');
                    requestAnimationFrame(function () { snap('rAF2'); });
                });
                setTimeout(function () { snap('+200ms'); }, 200);
                setTimeout(function () { snap('+800ms'); }, 800);
            }
        }

        function enter() {
            if (saved) return;
            // Fullscreen API を第1選択: containing block / stacking / scroll 問題を完全回避
            // iOS 16.4+ / Android Chrome / Desktop すべてサポート
            var reqFs = iframe.requestFullscreen || iframe.webkitRequestFullscreen;
            diag('enter() reqFs=' + (reqFs ? 'yes' : 'no'));
            if (reqFs) {
                try {
                    // allowfullscreen 属性を動的に追加（既存埋込コードに含まれていない場合のため）
                    iframe.setAttribute('allowfullscreen', '');
                    iframe.setAttribute('allow', 'fullscreen');
                    var savedAllow = iframe.getAttribute('allow') || '';
                    var result = reqFs.call(iframe);
                    saved = { mode: 'fs-api', savedAllow: savedAllow };
                    diag('enter via fullscreen API');
                    // fullscreenchange で ESC 等による外部解除を検知し state 同期
                    enterFsChangeHandler = function () {
                        var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
                        if (!fsEl && saved && saved.mode === 'fs-api') {
                            diag('fullscreen exited externally');
                            saved = null;
                            document.removeEventListener('fullscreenchange', enterFsChangeHandler);
                            document.removeEventListener('webkitfullscreenchange', enterFsChangeHandler);
                            // chat 側に exit 通知（入力欄復帰処理）
                            try { iframe.contentWindow.postMessage({ type: 'ychat:fullscreen-exited' }, '*'); } catch (_) {}
                        }
                    };
                    document.addEventListener('fullscreenchange', enterFsChangeHandler);
                    document.addEventListener('webkitfullscreenchange', enterFsChangeHandler);
                    if (result && result.catch) {
                        result.catch(function (err) {
                            diag('fs-api rejected: ' + (err.name || '?') + ' ' + (err.message || '?'));
                            saved = null;
                            document.removeEventListener('fullscreenchange', enterFsChangeHandler);
                            document.removeEventListener('webkitfullscreenchange', enterFsChangeHandler);
                            enterFallback();
                        });
                    }
                    return;
                } catch (e) {
                    diag('fs-api threw: ' + (e.message || '?'));
                }
            }
            enterFallback();
        }

        function exit() {
            if (!saved) return;
            var mode = saved.mode;
            if (mode === 'fs-api') {
                // Fullscreen API モード: exitFullscreen で解除（fullscreenchange で後始末）
                try {
                    var exitFs = document.exitFullscreen || document.webkitExitFullscreen;
                    if (exitFs && (document.fullscreenElement || document.webkitFullscreenElement)) {
                        exitFs.call(document);
                    }
                } catch (_) {}
                if (enterFsChangeHandler) {
                    document.removeEventListener('fullscreenchange', enterFsChangeHandler);
                    document.removeEventListener('webkitfullscreenchange', enterFsChangeHandler);
                    enterFsChangeHandler = null;
                }
                saved = null;
                return;
            }
            // fallback モード: iframe/ancestors/scroll の復元
            iframe.setAttribute('style', saved.style);
            document.body.style.overflow = saved.bodyOverflow;
            document.documentElement.style.overflow = saved.htmlOverflow;
            if (saved.htmlScrollBehavior) {
                document.documentElement.style.scrollBehavior = saved.htmlScrollBehavior;
            } else {
                document.documentElement.style.removeProperty('scroll-behavior');
            }
            restoreAncestors(saved.ancestors || []);
            try { window.scrollTo(0, saved.scrollY || 0); } catch (_) {}
            saved = null;
        }

        window.addEventListener('message', function (e) {
            if (e.source !== iframe.contentWindow) return;
            var d = e.data;
            if (!d || typeof d !== 'object') return;
            diag('recv ' + d.type);
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
