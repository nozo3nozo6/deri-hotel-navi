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
    // expand 後の kb-close 検出 watchdog (iOS で vv.resize が発火しないケース対策).
    // vv.resize のエッジだけに頼ると, iOS が close 通知を出さなかった時に iframe が縮んだまま固着する.
    var expandVerifyInterval = null;
    // input-focus dedupe: 1回の input タップで touchend + focusin の両方が
    // ychat:input-focus を送ってくるので、200ms 以内の重複を無視.
    var lastInputFocusTs = 0;
    // input-blur 直後の timestamp (参考用).
    var lastInputBlurTs = 0;
    // FIT モード: widget-tap (入力欄以外タップ) で viewport fit 状態に入った. sticky.
    // kb-close signal では reset せず fit を再適用して FIT モードを維持する.
    // 解除は pointerdown-outside-iframe (顧客HPタップ) のみ.
    var fitMode = false;
    // widget-tap 直後の時刻. iOS auto-refocus による spurious kb-open を識別するのに使う.
    // 0 = widget-tap なし.
    var lastWidgetTapTs = 0;
    // kb-close エッジを deferred reset するタイマー. 250ms 以内に kb-open が来れば cancel.
    // 送信時の意図的な blur+focus サイクル (chat.js v=163 / IME強制コミット用) で
    // iframe が一瞬縮んだまま activeIframe=null されて re-expand 不能になる事故を防ぐ.
    var kbCloseDeferTimer = null;
    // 直近の「touch で直接タップされた入力欄 focus」の時刻.
    // chat.js が input-focus postMessage に source='touch' (touchend) or 'focus' (focusin only) を付けてくるので、
    // touch 由来の方だけこの timestamp を進める. 'focus' 由来は iOS auto-refocus 疑いがあり信用しない.
    var lastTouchFocusTs = 0;

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
    //
    // window.scrollBy が効かない顧客HP (body{overflow:hidden} / scrollable wrapper構造) のケースも
    // 拾うため、scrollBy の結果を再検証して drift が残っていれば iframe.scrollIntoView でフォールバック.
    // これがないと go-kichi.com 等で「画面上に親ヘッダーが残ってチャットヘッダーが中途半端」事象が起きる
    // (2026-04-27 修正).
    function alignOnce(iframe) {
        var vv = window.visualViewport;
        var stickyInset = getStickyTopInset();
        var targetY = (vv ? vv.offsetTop : 0) + stickyInset;
        var rect = iframe.getBoundingClientRect();
        var drift = rect.top - targetY;
        if (Math.abs(drift) <= 0.5) return;

        // primary: window 全体スクロール (body 直下スクロールの一般ケース)
        window.scrollBy(0, drift);
        var rect2 = iframe.getBoundingClientRect();
        var stillDrift = rect2.top - targetY;
        if (Math.abs(stillDrift) <= 2) {
            diag('align ok via scrollBy drift=' + Math.round(drift));
            return;
        }

        // fallback: scrollIntoView が祖先の scrollable container も巻き込んで合わせる.
        // window.scrollBy で動かなかった = body もしくは祖先 wrapper に overflow 制約あり.
        try {
            iframe.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
        } catch (_) {}
        // scrollIntoView は stickyInset を考慮しないので, スクロール後に inset 分だけ戻す.
        if (stickyInset > 0) {
            try { window.scrollBy(0, -stickyInset); } catch (_) {}
        }
        var rect3 = iframe.getBoundingClientRect();
        var finalDrift = rect3.top - targetY;
        diag('align fallback scrollIntoView drift=' + Math.round(stillDrift) + '→' + Math.round(finalDrift));
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

    // iframe 高さを強制（!important で顧客HP CSS に勝つ）.
    // iOS Safari は kb-close 後に iframe の style.height 変更を即座にリフローしない
    // ことがある (input-blur → fit(667) を call しても iframe が 319 のまま固まる現象).
    // offsetHeight を読んで強制的に同期レイアウトを発火し, さらに rAF で再適用する.
    function forceHeight(iframe, h) {
        iframe.style.setProperty('height', h + 'px', 'important');
        iframe.style.setProperty('max-height', h + 'px', 'important');
        iframe.style.setProperty('min-height', h + 'px', 'important');
        try { void iframe.offsetHeight; } catch (_) {}
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function () {
                try {
                    iframe.style.setProperty('height', h + 'px', 'important');
                    iframe.style.setProperty('max-height', h + 'px', 'important');
                    iframe.style.setProperty('min-height', h + 'px', 'important');
                    void iframe.offsetHeight;
                } catch (_) {}
            });
        }
    }

    // プリフォーカス: iframe を「kb 開時の最終サイズ」に近い値まで縮め, iOS focus-scroll を
    // 不発化させつつ jarring な二段階遷移 (例: 707→247→319) を回避する.
    // 推定 kb 高さ ≈ innerHeight × 0.45 (iPhone 全機種で 0.37-0.46 範囲).
    // safeH = innerHeight - 推定 kb - stickyInset - 16(buffer). 最低 150px 保証.
    // 旧仕様 (usable × 0.35) は iframe が小さすぎて「縮んでまた広がる」体感悪化要因 (2026-04-25 修正).
    function prefocusForInput(iframe) {
        saveIframeStyle(iframe);
        var stickyInset = getStickyTopInset();
        var ih = window.innerHeight;
        var expectedKbH = Math.floor(ih * 0.45);
        var safeH = Math.max(150, ih - expectedKbH - stickyInset - 16);
        forceHeight(iframe, safeH);
        alignOnce(iframe);
        prefocusedIframe = iframe;
        try {
            iframe.contentWindow.postMessage({ type: 'ychat:embed-h', h: safeH }, '*');
            diag('prefocus h=' + safeH + ' sticky=' + stickyInset);
        } catch (_) {}
        // deferred re-align: iOS の focus-scroll は alignOnce の後に走るケースがある
        // (本体ヘッダーが上部にある状態で input タップ → iOS が大きく auto-scroll → iframe top
        // が viewport top からズレる, IMG_8760). 100ms / 300ms 後に再 align で iOS 後勝ちを上書き.
        // ガード付き: state 抜けたら noop. alignOnce 内 drift<=0.5 早期 return で連発しても無害.
        scheduleDeferredRealign(iframe, [100, 300], 'prefocus');
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

    // deferred re-align: iOS の focus-scroll / kb-open scroll が settle した後に
    // alignOnce を再実行して最終位置を上書き. prefocus / expandToVV 両方から呼ばれる.
    // ガード: 同 iframe が active のまま & 想定 state (prefocus または kb-open) を維持している場合のみ動く.
    // 連発しても alignOnce 内 drift<=0.5 早期 return で実害なし.
    function scheduleDeferredRealign(iframe, delays, label) {
        for (var i = 0; i < delays.length; i++) {
            (function (d) {
                setTimeout(function () {
                    if (label === 'prefocus') {
                        // prefocus 由来: prefocusedIframe が同じままなら有効.
                        // (kb 開いて expandToVV が走った場合 prefocusedIframe=null になるので, expand 側 defer に任せる)
                        if (prefocusedIframe !== iframe) { diag('defer-realign[' + label + ' ' + d + 'ms] skip: state changed'); return; }
                    } else if (label === 'expand') {
                        // expand 由来: activeIframe が同じ + kb まだ開いている場合のみ有効.
                        if (activeIframe !== iframe) { diag('defer-realign[' + label + ' ' + d + 'ms] skip: activeIframe changed'); return; }
                        if (!lastKbOpen) { diag('defer-realign[' + label + ' ' + d + 'ms] skip: kb closed'); return; }
                    }
                    diag('defer-realign[' + label + ' ' + d + 'ms]');
                    alignOnce(iframe);
                }, d);
            })(delays[i]);
        }
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
        // NOTE: alignOnce (= window.scrollBy) を expand 直後に呼ぶと iOS Safari は kb-open 遷移中の
        // プログラム的 scroll を「ユーザーが kb を閉じたい」と解釈して kb を dismiss する.
        // → 即時には呼ばず, kb-open transition (~250ms) 終了後に deferred で再 align (300/500ms).
        // prefocus で iframe top は概ね正しいが, 本体ヘッダー可視時に iOS の追加 auto-scroll が
        // 走り上端ズレするケースを deferred alignOnce で最終位置を保証.
        try {
            iframe.contentWindow.postMessage({ type: 'ychat:embed-h', h: targetH }, '*');
            diag('expand h=' + targetH + ' sticky=' + stickyInset);
        } catch (_) {}
        scheduleDeferredRealign(iframe, [300, 500], 'expand');
        // iOS で vv.resize が kb-close 時に発火しないケースに備え, vv.height を定期確認して
        // 開→閉 を watchdog で補完する. onVVChange が正常発火すれば resetIframeHeight 側で clearInterval される.
        startExpandVerifyWatch(iframe);
    }

    // expand 後の watchdog: 500ms毎に vv.height を確認し, kb 閉じを検知したら reset を発動.
    // iOS で vv.resize が kb-close で欠落する既知バグの補完.
    function startExpandVerifyWatch(iframe) {
        if (expandVerifyInterval) clearInterval(expandVerifyInterval);
        var tickCount = 0;
        diag('wd: started');
        expandVerifyInterval = setInterval(function () {
            tickCount++;
            var vv = window.visualViewport;
            if (!vv) { clearInterval(expandVerifyInterval); expandVerifyInterval = null; diag('wd: no vv, stop'); return; }
            var kbH = window.innerHeight - vv.height;
            // 2s毎にステータスログ (ノイズ抑制)
            if (tickCount % 4 === 0) diag('wd: tick=' + tickCount + ' kbH=' + Math.round(kbH) + ' ih=' + window.innerHeight + ' vh=' + Math.round(vv.height));
            if (kbH <= 50) {
                // kb 閉じを検出. vv.resize が来てないので onVVChange を肩代わりする.
                clearInterval(expandVerifyInterval);
                expandVerifyInterval = null;
                if (fitMode && activeIframe) {
                    diag('kb closed (watchdog) → refresh fit');
                    fitToViewport(activeIframe);
                } else if (activeIframe) {
                    diag('kb closed (watchdog) kbH=' + Math.round(kbH));
                    resetIframeHeight(activeIframe);
                    activeIframe = null;
                }
                lastKbOpen = false;
            }
        }, 500);
    }

    // fit: iframe を viewport に合わせる (header=sticky nav 直下, footer=画面下端).
    // widget-tap (入力欄以外のタップ) で発動. customer が 900px など大きい iframe を置いてる時の
    // 「footer が画面外」問題の対応. kb 開閉に関わらず確実に最終形状へ遷移.
    //
    // kb が実際に開いている時 (vv.height < innerHeight - 100) は innerHeight ベースで
    // サイズすると iframe が kb の裏に潜り、textarea が見えなくなる. その場合は vv ベースの
    // expandToVV にフォールバック (input-blur 300ms timer が kb-close 検出をミスったケース対応,
    // 2026-04-27).
    function fitToViewport(iframe) {
        if (prefocusSafetyTimer) { clearTimeout(prefocusSafetyTimer); prefocusSafetyTimer = null; }
        var vv = window.visualViewport;
        if (vv && (window.innerHeight - vv.height) > 100) {
            diag('fit() rerouted to expandToVV (kb still open kbH=' + Math.round(window.innerHeight - vv.height) + ')');
            activeIframe = iframe;
            fitMode = true;
            expandToVV(iframe);
            return;
        }
        if (expandVerifyInterval) { clearInterval(expandVerifyInterval); expandVerifyInterval = null; }
        prefocusedIframe = null;
        var stickyInset = getStickyTopInset();
        var ih = window.innerHeight;
        var targetH = Math.floor(ih - stickyInset);
        diag('fit() entry ih=' + ih + ' sticky=' + stickyInset + ' targetH=' + targetH);
        if (targetH < 200) { diag('fit BAILED targetH<200'); return; }
        saveIframeStyle(iframe);
        forceHeight(iframe, targetH);
        alignOnce(iframe);
        activeIframe = iframe;
        fitMode = true;
        try {
            iframe.contentWindow.postMessage({ type: 'ychat:embed-h', h: targetH }, '*');
            diag('fit h=' + targetH + ' sticky=' + stickyInset);
        } catch (e) { diag('fit ERR ' + (e && e.message)); }
    }

    function resetIframeHeight(iframe) {
        if (prefocusSafetyTimer) { clearTimeout(prefocusSafetyTimer); prefocusSafetyTimer = null; }
        if (expandVerifyInterval) { clearInterval(expandVerifyInterval); expandVerifyInterval = null; }
        prefocusedIframe = null;
        fitMode = false;
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
            // 閉→開 エッジ.
            // 直前の kb-close defer がまだ走っていれば cancel (送信時の brief blur+focus サイクル対応).
            if (kbCloseDeferTimer) { clearTimeout(kbCloseDeferTimer); kbCloseDeferTimer = null; diag('kb-open cancelled pending close-defer (likely send blur cycle)'); }
            // FIT モード中 + widget-tap 直後 (1500ms 以内) の kb-open は iOS の spurious kb-open
            // (body タップ後の auto-refocus による焼き直し kb 開閉) の疑い. ただし widget-tap 後に
            // 「真に touch で入力欄をタップ」した場合 (lastTouchFocusTs > lastWidgetTapTs) は本物の
            // kb-open なので expand を許可する. focus 由来 (auto-refocus) は lastTouchFocusTs を更新しないので
            // ここで touch が新しいかだけ見れば両ケースを切り分けられる.
            var sinceWidgetTap = Date.now() - lastWidgetTapTs;
            var realTouchSinceTap = lastTouchFocusTs > lastWidgetTapTs;
            if (fitMode && sinceWidgetTap < 1500 && !realTouchSinceTap) {
                diag('kb-open ignored (fitMode, widget-tap ' + sinceWidgetTap + 'ms ago, no real touch)');
            } else if (activeIframe) {
                expandToVV(activeIframe);
            }
        } else if (!kbOpen && lastKbOpen) {
            // 開→閉 エッジ. 250ms 待って kb-open が来なければ本物の close.
            // 送信時の意図的な blur+focus (IME強制コミット用) は 100ms 以内に kb 再オープンするため、
            // ここで即座に reset すると activeIframe=null になり re-expand 不能になる.
            if (kbCloseDeferTimer) clearTimeout(kbCloseDeferTimer);
            kbCloseDeferTimer = setTimeout(function () {
                kbCloseDeferTimer = null;
                if (fitMode && activeIframe) {
                    diag('kb closed (deferred) → refresh fit');
                    fitToViewport(activeIframe);
                } else if (activeIframe) {
                    diag('kb closed (deferred)');
                    resetIframeHeight(activeIframe);
                    activeIframe = null;
                }
            }, 250);
        }
        lastKbOpen = kbOpen;
    }
    if (window.visualViewport) {
        // resize のみ監視（scroll は手動スクロール妨害の原因になるので監視しない）
        window.visualViewport.addEventListener('resize', onVVChange);
    }

    // (削除) iframe 外タップによる kb-close 補完
    // 旧仕様では「親 pointerdown = ④番目の kb-close signal (vv.resize/watchdog/input-blur 失敗時の保険)」
    // として reset を発火していたが、顧客サイトの header/footer 等を 1タップしただけで iframe が
    // 縮む副作用がユーザー体験を損なう (2026-04-25 ユーザー指摘).
    // ① vv.resize エッジ ② expandVerifyWatch watchdog ③ input.blur で十分なので削除.

    // ensureGutter: モバイルで iframe が viewport 端に張り付くのを防ぐ左右マージン.
    // 旧スニペットは width:100%;margin:20px auto で配布されており, vw < max-width のとき
    // auto-margin が 0 になり edge-to-edge になる. 既存埋込先 (顧客HP) で再貼付けせず
    // 自動的にガッターを付与するため chat-embed.js 側で強制する.
    // box-sizing:border-box + width:calc(100% - 24px) で 12px*2 のガッター.
    // PC (vw >= 600) では max-width 制約で iframe < parent となり auto-margin が centering する
    // ので元から問題なし → モバイル (vw < 600) のみ適用.
    // 既に customer が ml/mr >= 8px を inline 指定済み or width <= calc(100% - 24px) なら touch しない.
    function ensureGutter(iframe) {
        if (window.innerWidth >= 600) return;
        try {
            var cs = getComputedStyle(iframe);
            var ml = parseFloat(cs.marginLeft) || 0;
            var mr = parseFloat(cs.marginRight) || 0;
            if (ml >= 8 && mr >= 8) { diag('gutter: skip (margin already ml=' + ml + ' mr=' + mr + ')'); return; }
            iframe.style.setProperty('width', 'calc(100% - 24px)', 'important');
            iframe.style.setProperty('margin-left', 'auto', 'important');
            iframe.style.setProperty('margin-right', 'auto', 'important');
            iframe.style.setProperty('display', 'block', 'important');
            iframe.style.setProperty('box-sizing', 'border-box', 'important');
            diag('gutter applied (vw=' + window.innerWidth + ')');
        } catch (e) { diag('gutter ERR ' + (e && e.message)); }
    }

    function wire(iframe) {
        if (iframe.__ychatWired) return;
        iframe.__ychatWired = true;
        diag('wire() slug=' + iframe.getAttribute('data-ychat-slug'));

        ensureGutter(iframe);

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
                // widget-tap 直後 (1500ms 以内) で かつ d.source === 'focus' の input-focus は
                // iOS auto-refocus の焼き直し (body タップ後に iOS が直前 input の focus を自動復元).
                // d.source === 'touch' (touchend) は訪問者が直接入力欄をタップした明確な意図なので,
                // widget-tap 直後でも処理する (送信ボタン連打 → 直後の入力タップが無効化されるのを防ぐ).
                var sinceWidgetTap = Date.now() - lastWidgetTapTs;
                if (sinceWidgetTap < 1500 && d.source !== 'touch') {
                    diag('input-focus (source=' + (d.source || 'unknown') + ') ignored: widget-tap ' + sinceWidgetTap + 'ms ago, iOS auto-refocus suspected');
                    return;
                }
                if (d.source === 'touch') {
                    lastTouchFocusTs = Date.now();
                }
                // dedupe: touchend(capture) + focusin の 2重発火を抑制
                var now = Date.now();
                if (now - lastInputFocusTs < 200) {
                    diag('input-focus deduped');
                    return;
                }
                lastInputFocusTs = now;
                activeIframe = iframe;
                var vv = window.visualViewport;
                var vvKbOpen = vv && (window.innerHeight - vv.height) > 100;
                // iOS では kb 閉じ後も vv.height が戻らない「嘘をつく」バグがあるので, vv 単独判定だと
                // 2回目タップで「kb 既に開いてる」と誤判定して expand に直行してしまう.
                // lastKbOpen (vv.resize エッジ or input-blur で更新) を併用することで正確な状態把握.
                var kbOpen = vvKbOpen && lastKbOpen;
                diag('focus branch: vvKbOpen=' + vvKbOpen + ' lastKbOpen=' + lastKbOpen + ' fitMode=' + fitMode);
                if (kbOpen) {
                    // kb 既に開: 直接 expand（他 input への re-focus ケース）
                    expandToVV(iframe);
                } else if (isIOS) {
                    // iOS は kb まだ閉. fitMode (state ③) であっても必ず prefocus する.
                    // 旧仕様: fitMode 時は「sticky 下にいるから iOS は scroll しない」と仮定して
                    // prefocus を skip していた. しかし fit 状態で iframe は全高 (innerHeight-stickyInset
                    // ~870px) あり、入力欄は iframe 下端付近. ここで iOS は input を kb 上に上げるため
                    // page を auto-scroll する. iframe top が viewport 上に押し上げられ、その後 expand で
                    // h=323 にしても iframe 自体が画面外になり「ピタッ」とならない (state ② subsequent 失敗).
                    // 解決: 常に prefocus で iframe を ~150px に縮めて auto-scroll を不発化させ、
                    // kb 開通知 (vv.resize) で expandToVV により h=vv.height-stickyInset に拡大する.
                    prefocusForInput(iframe);
                } else {
                    // Android/PC: focus-scroll 問題なし。align だけして kb 開通知を待つ
                    alignOnce(iframe);
                }
                return;
            }
            if (d.type === 'ychat:widget-tap') {
                lastWidgetTapTs = Date.now();
                // 入力欄のクリックは chat.js 側で widget-tap を送らない (input-focus のみ).
                // widget-tap が来た = 「入力欄以外のタップ」= 訪問者が widget を fit で見たい意思表示.
                // kb 状態に関わらず常に fit に遷移. kb 開中なら blur-input も送って kb を閉じさせる
                // (iOS は body タップで input を自動 blur しない). 入力欄既に blur 済みなら blur() は noop.
                try {
                    iframe.contentWindow.postMessage({ type: 'ychat:blur-input' }, '*');
                } catch (_) {}
                fitToViewport(iframe);
                // iOS kb-close アニメ中は forceHeight が即反映されない(innerHeight が
                // kb 分シュリンクしたまま, または render が deferred). kb 完全に閉じた後にもう一度
                // fit する保険. これで「1タップで広がらない / 2タップ目で広がる」問題を解消.
                // 350ms = iOS kb-close anim (~250ms) + safety margin.
                setTimeout(function () {
                    if (fitMode && activeIframe === iframe) {
                        diag('widget-tap retry fit (post kb-close)');
                        fitToViewport(iframe);
                    }
                }, 350);
                return;
            }
            if (d.type === 'ychat:exit-fullscreen') {
                return; // no-op（後方互換）
            }
            if (d.type === 'ychat:input-blur') {
                // iOS で visualViewport.height が kb 閉じ後も小さいまま残るバグへの確実な対策.
                // input blur は iOS でも正常に発火するので, これを真の kb-close 信号として使う.
                // 300ms 後に新しい input-focus が来てなければ reset か fit (fitPending の場合).
                var blurTs = Date.now();
                lastInputBlurTs = blurTs;
                lastKbOpen = false;
                setTimeout(function () {
                    if (lastInputFocusTs > blurTs) {
                        diag('input-blur: refocus detected, keep state');
                        return;
                    }
                    if (fitMode && activeIframe) {
                        diag('kb closed (input-blur) → refresh fit');
                        fitToViewport(activeIframe);
                        return;
                    }
                    if (activeIframe) {
                        diag('kb closed (input-blur)');
                        resetIframeHeight(activeIframe);
                        activeIframe = null;
                    } else {
                        diag('input-blur: activeIframe already null');
                    }
                }, 300);
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
