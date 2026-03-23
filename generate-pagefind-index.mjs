/**
 * generate-pagefind-index.mjs — Pagefind Node APIでカスタムインデックス生成
 * Usage: node generate-pagefind-index.mjs
 * Input:  pagefind-data.json (generate-pagefind-data.php で生成)
 * Output: pagefind/ ディレクトリ
 */
import { readFileSync } from 'fs';
import * as pagefind from 'pagefind';

const data = JSON.parse(readFileSync('pagefind-data.json', 'utf8'));
console.log(`Loading ${data.count} hotels (generated: ${data.generated})`);

const { index } = await pagefind.createIndex({ forceLanguage: 'ja' });

const MODE_FILTER_MAP = {
    men:        'deri',
    women:      'jofu',
    men_same:   'same_m',
    women_same: 'same_f',
};

// 半角/全角統一（NFKC: ＩＮＮ→INN、全角数字→半角等）
const norm = s => s ? s.normalize('NFKC') : '';

let added = 0;
for (const h of data.hotels) {
    // 検索対象テキスト: ホテル名 + 住所 + 駅名（NFKC正規化で表記ゆれ吸収）
    const content = [h.name, h.address, h.station].filter(Boolean).map(norm).join(' ');

    // フィルタ構築
    const filters = {
        prefecture: [h.pref],
        hotel_type: [h.type],
    };
    if (h.city)   filters.city = [h.city];
    if (h.area)   filters.major_area = [h.area];
    if (h.detail) filters.detail_area = [h.detail];

    // gender_mode別フィルタ: 呼べた実績があれば "OK"
    for (const [mode, filterKey] of Object.entries(MODE_FILTER_MAP)) {
        const stats = h.modes[mode];
        if (stats && stats.ok > 0) {
            filters[filterKey] = ['OK'];
        }
    }

    // ラブホレポート実績フィルタ
    const hasLovehoReport = Object.values(h.modes).some(m => m.loveho > 0);
    if (hasLovehoReport) {
        filters.loveho_report = ['OK'];
    }

    const { errors } = await index.addCustomRecord({
        url: `/hotel/${h.id}`,
        content,
        language: 'ja',
        meta: {
            title: h.name,
            id: String(h.id),
        },
        filters,
        sort: {
            // レポート総数でソート（多い順）
            report_count: String(
                Object.values(h.modes).reduce((sum, m) => sum + m.total + (m.loveho || 0), 0)
            ),
        },
    });

    if (errors.length) {
        console.error(`Error for hotel ${h.id}:`, errors);
    } else {
        added++;
    }
}

console.log(`Added ${added}/${data.count} hotels to index`);

const { errors: writeErrors } = await index.writeFiles({ outputPath: './pagefind' });
if (writeErrors.length) {
    console.error('Write errors:', writeErrors);
    process.exit(1);
}

await pagefind.close();
console.log('Pagefind index generated in ./pagefind/');
