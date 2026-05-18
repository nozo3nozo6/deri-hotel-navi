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

    // 2026-05-19: アプリアイコンバッジ (iOS PWA 16.4+ / Android Chrome).
    // 通知数を累積する小さな state を IndexedDB に保持. main 側 (chat.js) が可視時にクリア.
    function setBadge() {
        if (!('setAppBadge' in self.navigator || (self.navigator && 'setAppBadge' in self.navigator))) return Promise.resolve();
        return readBadgeCount().then(function(n) {
            var next = n + 1;
            return writeBadgeCount(next).then(function() {
                try { return self.navigator.setAppBadge(next); } catch (_) { return Promise.resolve(); }
            });
        }).catch(function() {});
    }

    event.waitUntil(Promise.all([
        self.registration.showNotification(title, options),
        setBadge()
    ]));
});

// 通知クリック: 既存のチャットタブがあればフォーカス、なければ新規オープン
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    var targetUrl = (event.notification.data && event.notification.data.url) || '/';

    // バッジクリア (累積 0 にする)
    function clearBadge() {
        return writeBadgeCount(0).then(function() {
            try {
                if (self.navigator && self.navigator.clearAppBadge) return self.navigator.clearAppBadge();
            } catch (_) {}
            return Promise.resolve();
        }).catch(function() {});
    }

    event.waitUntil(Promise.all([
        clearBadge(),
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
    ]));
});

// ========== Badge カウンタ用 IndexedDB (SW restart 跨いで保持) ==========
function openBadgeDB() {
    return new Promise(function(resolve, reject) {
        var req = indexedDB.open('ychat-badge', 1);
        req.onupgradeneeded = function() {
            req.result.createObjectStore('kv');
        };
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
    });
}
function readBadgeCount() {
    return openBadgeDB().then(function(db) {
        return new Promise(function(resolve) {
            try {
                var tx = db.transaction('kv', 'readonly');
                var req = tx.objectStore('kv').get('count');
                req.onsuccess = function() { resolve(Number(req.result) || 0); };
                req.onerror = function() { resolve(0); };
            } catch (_) { resolve(0); }
        });
    }).catch(function() { return 0; });
}
function writeBadgeCount(n) {
    return openBadgeDB().then(function(db) {
        return new Promise(function(resolve) {
            try {
                var tx = db.transaction('kv', 'readwrite');
                tx.objectStore('kv').put(n, 'count');
                tx.oncomplete = function() { resolve(); };
                tx.onerror = function() { resolve(); };
            } catch (_) { resolve(); }
        });
    }).catch(function() {});
}

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
