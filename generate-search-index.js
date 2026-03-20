// ==========================================================================
// generate-search-index.js — Fuse.js用の軽量検索インデックス生成
// Usage: node generate-search-index.js
// Output: search-index.json（id, name, address, city, station, type のみ）
// ==========================================================================
const fs = require('fs');
const path = require('path');

const HOTEL_DATA_DIR = path.join(__dirname, 'hotel-data');

function main() {
    const index = JSON.parse(fs.readFileSync(path.join(HOTEL_DATA_DIR, 'index.json'), 'utf8'));
    const records = [];

    for (const pref of index.prefectures) {
        const filePath = path.join(HOTEL_DATA_DIR, `${pref.prefecture}.json`);
        if (!fs.existsSync(filePath)) continue;
        const hotels = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        for (const h of hotels) {
            // 短縮キーで容量削減
            records.push({
                i: h.id,                          // id
                n: h.name,                        // name
                a: h.address || '',               // address
                c: h.city || '',                  // city
                s: h.nearest_station || '',        // station
                t: h.hotel_type || '',             // type
            });
        }
    }

    const output = JSON.stringify(records);
    fs.writeFileSync(path.join(__dirname, 'search-index.json'), output);
    const sizeMB = (Buffer.byteLength(output) / 1024 / 1024).toFixed(2);
    console.log(`Generated search-index.json: ${records.length} hotels, ${sizeMB} MB`);
}

main();
