// fuse-worker.js — Fuse.js検索をWeb Workerで実行（メインスレッド非ブロック）
importScripts('https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js');

let fuse = null;

// 半角/全角統一（NFKC: ＩＮＮ→INN、全角数字→半角等）+ 小文字化
function norm(s) {
    return s ? s.normalize('NFKC').toLowerCase() : '';
}

self.onmessage = async function(e) {
    const { type, keyword, limit } = e.data;

    if (type === 'init') {
        try {
            const res = await fetch('/search-index.json');
            const data = await res.json();
            // 検索用に正規化フィールドを追加（元データは保持）
            data.forEach(d => {
                d._n = norm(d.n);
                d._a = norm(d.a);
                d._c = norm(d.c);
                d._s = norm(d.s);
            });
            fuse = new Fuse(data, {
                keys: ['_n', '_a', '_c', '_s'],
                threshold: 0.35,
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
        // クエリもNFKC正規化
        const results = fuse.search(norm(keyword), { limit: limit || 30 });
        self.postMessage({ type: 'result', ids: results.map(r => r.item.i) });
    }
};
