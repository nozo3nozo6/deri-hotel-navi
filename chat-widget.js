/**
 * chat-widget.js — YobuChat 埋め込みウィジェット v2
 *
 * 使い方: クライアントHPに1行貼り付け
 *   <script src="https://yobuho.com/chat-widget.js" data-slug="shop-slug" async></script>
 *
 * 設計方針:
 * - 固有クラス名プレフィックス `ychatw-` で外部CSSとの干渉を最小化
 * - 重要スタイルは !important で保護
 * - モバイルファースト（スマホ=デフォルト、PC=@media min-width:768px）
 * - 画像・テキスト折り返し対応、text-scaling耐性
 */
(function () {
    'use strict';

    if (window.__yobuhoChatWidgetLoaded) return;
    window.__yobuhoChatWidgetLoaded = true;

    // ===== slug取得 =====
    const script = document.currentScript || (function () {
        const scripts = document.getElementsByTagName('script');
        for (let i = scripts.length - 1; i >= 0; i--) {
            if (scripts[i].src && scripts[i].src.indexOf('chat-widget.js') >= 0) return scripts[i];
        }
        return null;
    })();

    function getSlug() {
        if (!script) return '';
        if (script.dataset && script.dataset.slug) return script.dataset.slug;
        try {
            const u = new URL(script.src, window.location.href);
            return u.searchParams.get('slug') || '';
        } catch (e) { return ''; }
    }

    const SLUG = getSlug();
    if (!SLUG || !/^[a-z0-9\-]+$/i.test(SLUG)) {
        console.warn('[YobuHo Chat] slug not specified');
        return;
    }

    const CHAT_URL = 'https://yobuho.com/chat/' + encodeURIComponent(SLUG) + '/';

    // ===== スタイル注入（外部干渉回避: ychatw- プレフィックス + !important） =====
    const CSS = `
/* === YobuChat Widget Scoped Styles === */
.ychatw-btn,
.ychatw-btn *,
.ychatw-wrap,
.ychatw-wrap * {
  box-sizing: border-box !important;
  -webkit-font-smoothing: antialiased !important;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif !important;
}

/* 起動ボタン（モバイルファースト: 56px） */
.ychatw-btn {
  position: fixed !important;
  right: 16px !important;
  bottom: 16px !important;
  width: 56px !important;
  height: 56px !important;
  min-width: 56px !important;
  min-height: 56px !important;
  padding: 0 !important;
  margin: 0 !important;
  border: none !important;
  border-radius: 50% !important;
  background: linear-gradient(135deg, #9b2d35 0%, #7a1f27 100%) !important;
  color: #fff !important;
  cursor: pointer !important;
  box-shadow: 0 4px 14px rgba(0,0,0,.22) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 26px !important;
  line-height: 1 !important;
  z-index: 2147483646 !important;
  transition: transform .18s ease, box-shadow .18s ease !important;
  -webkit-tap-highlight-color: transparent !important;
  touch-action: manipulation !important;
}
.ychatw-btn:hover {
  transform: scale(1.06) !important;
  box-shadow: 0 6px 20px rgba(0,0,0,.28) !important;
}
.ychatw-btn:focus-visible {
  outline: 3px solid #ffd27a !important;
  outline-offset: 2px !important;
}

/* ボタン横のラベル（PCのみ表示） */
.ychatw-btn-label {
  position: absolute !important;
  right: calc(100% + 10px) !important;
  top: 50% !important;
  transform: translateY(-50%) !important;
  background: #fff !important;
  color: #333 !important;
  padding: 6px 12px !important;
  border-radius: 16px !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  white-space: nowrap !important;
  box-shadow: 0 2px 8px rgba(0,0,0,.15) !important;
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity .2s ease !important;
  display: none !important;
}

/* モーダル背景（モバイル=全画面、PC=ドロワー風） */
.ychatw-wrap {
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  background: rgba(0,0,0,.5) !important;
  display: none !important;
  animation: ychatw-fade .18s ease !important;
}
.ychatw-wrap.ychatw-open {
  display: block !important;
}

/* モーダル本体（モバイル=全画面） */
.ychatw-inner {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  max-width: 100% !important;
  max-height: 100dvh !important;
  background: #fff !important;
  border-radius: 0 !important;
  overflow: hidden !important;
  box-shadow: 0 10px 40px rgba(0,0,0,.3) !important;
  display: flex !important;
  flex-direction: column !important;
}

/* 閉じるボタン */
.ychatw-close {
  position: absolute !important;
  top: 10px !important;
  right: 10px !important;
  width: 36px !important;
  height: 36px !important;
  min-width: 36px !important;
  min-height: 36px !important;
  padding: 0 !important;
  border-radius: 50% !important;
  background: rgba(0,0,0,.45) !important;
  color: #fff !important;
  border: none !important;
  cursor: pointer !important;
  font-size: 16px !important;
  line-height: 1 !important;
  z-index: 10 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  -webkit-tap-highlight-color: transparent !important;
  touch-action: manipulation !important;
}
.ychatw-close:hover { background: rgba(0,0,0,.65) !important; }

/* iframe（画像最大480px・折り返し対策はiframe内CSSで） */
.ychatw-iframe {
  flex: 1 1 auto !important;
  width: 100% !important;
  height: 100% !important;
  max-width: 100% !important;
  border: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  background: #fff !important;
  display: block !important;
  overflow: auto !important;
  word-wrap: break-word !important;
  overflow-wrap: anywhere !important;
}

/* iframe内の画像上限（親ページからの指定で壊れないようバックアップ） */
.ychatw-inner img {
  max-width: 480px !important;
  height: auto !important;
}

@keyframes ychatw-fade { from { opacity: 0 } to { opacity: 1 } }

/* ========== PC (>= 768px): 余白・サイズ拡大、最大幅維持 ========== */
@media (min-width: 768px) {
  .ychatw-btn {
    right: 24px !important;
    bottom: 24px !important;
    width: 64px !important;
    height: 64px !important;
    min-width: 64px !important;
    min-height: 64px !important;
    font-size: 30px !important;
  }
  .ychatw-btn-label { display: block !important; }
  .ychatw-btn:hover .ychatw-btn-label { opacity: 1 !important; }

  .ychatw-inner {
    inset: auto !important;
    right: 24px !important;
    bottom: 96px !important;
    left: auto !important;
    top: auto !important;
    width: 420px !important;
    max-width: calc(100vw - 48px) !important;
    height: 640px !important;
    max-height: calc(100dvh - 120px) !important;
    border-radius: 14px !important;
  }
  .ychatw-close {
    width: 38px !important;
    height: 38px !important;
    font-size: 17px !important;
  }
}

/* ========== 大画面 (>= 1200px): さらに余裕 ========== */
@media (min-width: 1200px) {
  .ychatw-inner {
    width: 440px !important;
    height: 680px !important;
  }
}

/* ========== 横向き低高さデバイス対策 ========== */
@media (max-width: 767px) and (orientation: landscape) and (max-height: 500px) {
  .ychatw-btn {
    width: 48px !important;
    height: 48px !important;
    min-width: 48px !important;
    min-height: 48px !important;
    font-size: 22px !important;
  }
}

/* ========== テキストスケーリング耐性: 最大フォント制限 ========== */
@media (max-width: 767px) {
  .ychatw-btn { font-size: clamp(22px, 7vw, 28px) !important; }
}

/* ========== prefers-reduced-motion ========== */
@media (prefers-reduced-motion: reduce) {
  .ychatw-btn,
  .ychatw-wrap { animation: none !important; transition: none !important; }
}
`;

    const style = document.createElement('style');
    style.setAttribute('data-ychatw', '1');
    style.textContent = CSS;
    document.head.appendChild(style);

    // ===== ボタン生成 =====
    const btn = document.createElement('button');
    btn.className = 'ychatw-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'YobuChatを開く');
    btn.innerHTML = '<span aria-hidden="true">💬</span><span class="ychatw-btn-label">YobuChat</span>';

    // ===== モーダル生成 =====
    const wrap = document.createElement('div');
    wrap.className = 'ychatw-wrap';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'YobuChat');
    wrap.innerHTML =
        '<div class="ychatw-inner">' +
        '<button type="button" class="ychatw-close" aria-label="閉じる">✕</button>' +
        '<iframe class="ychatw-iframe" src="" title="YobuChat" allow="clipboard-write" loading="lazy"></iframe>' +
        '</div>';

    document.body.appendChild(btn);
    document.body.appendChild(wrap);

    const iframe = wrap.querySelector('.ychatw-iframe');
    const closeBtn = wrap.querySelector('.ychatw-close');

    // ===== 開閉ロジック =====
    let lastFocused = null;

    function openChat() {
        lastFocused = document.activeElement;
        if (!iframe.src) iframe.src = CHAT_URL + '?embed=1';
        wrap.classList.add('ychatw-open');
        btn.style.display = 'none';
        document.documentElement.style.overflow = 'hidden';
        setTimeout(() => { try { closeBtn.focus(); } catch (_) {} }, 50);
    }

    function closeChat() {
        wrap.classList.remove('ychatw-open');
        btn.style.display = '';
        document.documentElement.style.overflow = '';
        try { if (lastFocused && lastFocused.focus) lastFocused.focus(); } catch (_) {}
    }

    btn.addEventListener('click', openChat);
    closeBtn.addEventListener('click', closeChat);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeChat(); });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && wrap.classList.contains('ychatw-open')) closeChat();
    });

})();
