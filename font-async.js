// font-async.js — Google Fonts の非同期読込（CSP unsafe-inline 不要）
// <link rel="preload" as="style" data-font-async> を rel="stylesheet" に昇格して適用。
// preload のため DL は即時開始、render-blocking ではないので LCP を大きく短縮する。
(function () {
    function run() {
        var links = document.querySelectorAll('link[data-font-async]');
        for (var i = 0; i < links.length; i++) {
            var l = links[i];
            l.rel = 'stylesheet';
            l.removeAttribute('data-font-async');
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
})();
