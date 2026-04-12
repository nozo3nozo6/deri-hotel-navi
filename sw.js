// ==========================================================================
// Service Worker — YobuHo オフラインキャッシュ
// ==========================================================================

const CACHE_NAME = 'yobuho-v1';
const STATIC_ASSETS = [
    '/',
    '/style.css',
    '/api-service.js',
    '/ui-utils.js',
    '/area-navigation.js',
    '/hotel-search.js',
    '/form-handler.js',
    '/portal-init.js',
    '/fuse-worker.js',
    '/master-data.json',
    '/area-data.json',
];

// インストール: 静的アセットをキャッシュ
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// アクティベート: 古いキャッシュ削除
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// フェッチ: Network First（API）/ Cache First（静的アセット）
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // API呼び出し: Network First
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // GET のみキャッシュ
                    if (event.request.method === 'GET' && response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // 静的アセット: Cache First
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) {
                // バックグラウンドで更新
                fetch(event.request).then(response => {
                    if (response.ok) {
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
                    }
                }).catch(() => {});
                return cached;
            }
            return fetch(event.request).then(response => {
                if (response.ok && event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            });
        })
    );
});
