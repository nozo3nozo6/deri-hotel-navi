// ==========================================================================
// chat-push-sw.js — YobuChat Web Push 専用 Service Worker
//
// IMPORTANT: このSWは fetch ハンドラを一切持たない。
//   2026-04-15 に全SW廃止した経緯（Cache Firstでの旧コード配信問題）を踏まえ、
//   push/notificationclick のみを扱う。キャッシュAPIも触らない。
//   scope は '/' で登録するが fetch を横取りしないのでネットワークに影響しない。
// ==========================================================================

self.addEventListener('install', function(event) {
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    event.waitUntil(self.clients.claim());
});

// push 受信: payload は CF Worker から暗号化されて届く (aes128gcm).
// 復号後の JSON 形式: { title, body, url, tag, icon, badge, renotify }
self.addEventListener('push', function(event) {
    var payload = {};
    if (event.data) {
        try {
            payload = event.data.json();
        } catch (_) {
            try {
                payload = { body: event.data.text() };
            } catch (__) {
                payload = {};
            }
        }
    }

    var title = payload.title || 'YobuChat';
    var options = {
        body: payload.body || '',
        icon: payload.icon || '/yobuchat-brand.png',
        badge: payload.badge || '/favicon.ico',
        tag: payload.tag || 'yobuchat',
        renotify: payload.renotify !== false,
        data: {
            url: payload.url || '/',
            ts: Date.now(),
        },
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// 通知クリック: 既存のチャットタブがあればフォーカス、なければ新規オープン
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    var targetUrl = (event.notification.data && event.notification.data.url) || '/';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
            for (var i = 0; i < clients.length; i++) {
                var c = clients[i];
                try {
                    var u = new URL(c.url);
                    var t = new URL(targetUrl, self.location.origin);
                    if (u.origin === t.origin && u.pathname === t.pathname) {
                        if ('focus' in c) {
                            c.postMessage({ type: 'ychat:push-click', url: targetUrl });
                            return c.focus();
                        }
                    }
                } catch (_) {}
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});

// push購読が無効化された時: サーバーに通知して購読レコード削除
self.addEventListener('pushsubscriptionchange', function(event) {
    event.waitUntil(
        self.registration.pushManager.getSubscription().then(function(sub) {
            if (sub) return;
            // サブスクリプションが完全に失効した場合はクライアント側で再購読を促す
            return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
                clients.forEach(function(c) {
                    try { c.postMessage({ type: 'ychat:push-lost' }); } catch (_) {}
                });
            });
        }).catch(function() {})
    );
});
