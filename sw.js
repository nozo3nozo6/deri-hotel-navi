// ==========================================================================
// Service Worker 廃止 — 自己破棄スクリプト
// 既存のSWがこのファイルを取得した時点で、全キャッシュを削除し、
// 自分自身をunregisterして、制御下のクライアントをリロードさせる。
// 今後SWは使わない。
// ==========================================================================

self.addEventListener('install', function() {
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(keys.map(function(k) { return caches.delete(k); }));
        }).then(function() {
            return self.registration.unregister();
        }).then(function() {
            return self.clients.matchAll();
        }).then(function(clients) {
            clients.forEach(function(client) {
                // 現在のページをそのままリロード（URLは維持される）
                if (client.navigate) { client.navigate(client.url).catch(function() {}); }
            });
        })
    );
});

// fetchハンドラは一切持たない → すべてネットワーク直送
