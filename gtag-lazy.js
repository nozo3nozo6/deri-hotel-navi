// gtag-lazy.js — gtag.js 本体を window.load 後に遅延ロード。
// gtag-init.js で window.gtag と dataLayer は即時定義済みのため、
// ページ初期描画中に gtag('event',...) を呼んでも OK（dataLayerにキューされ、
// gtag.js ロード後にまとめて送信される）。LCP/FCP から GTMを除外できる。
(function () {
    function loadGtm() {
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=G-250LFPCPCE';
        document.head.appendChild(s);
    }
    if (document.readyState === 'complete') {
        setTimeout(loadGtm, 0);
    } else {
        window.addEventListener('load', function () { setTimeout(loadGtm, 0); });
    }
})();
