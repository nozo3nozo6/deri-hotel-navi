// fuse-worker.js — Fuse.js検索をWeb Workerで実行（メインスレッド非ブロック）
importScripts('https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js');

let fuse = null;

self.onmessage = async function(e) {
    const { type, keyword, limit } = e.data;

    if (type === 'init') {
        try {
            const res = await fetch('/search-index.json');
            const data = await res.json();
            fuse = new Fuse(data, {
                keys: ['n', 'a', 'c', 's'],
                threshold: 0.4,
                ignoreLocation: true,
                minMatchCharLength: 2,
                includeMatches: false,
                includeScore: false
            });
            self.postMessage({ type: 'ready' });
        } catch (e) {
            self.postMessage({ type: 'error', error: e.message });
        }
        return;
    }

    if (type === 'search') {
        if (!fuse) {
            self.postMessage({ type: 'result', ids: [] });
            return;
        }
        const results = fuse.search(keyword, { limit: limit || 30 });
        self.postMessage({ type: 'result', ids: results.map(r => r.item.i) });
    }
};
