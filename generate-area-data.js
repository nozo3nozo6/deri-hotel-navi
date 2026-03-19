// ==========================================================================
// generate-area-data.js — エリアナビ用の静的JSONを事前生成
// Usage: node generate-area-data.js
// ==========================================================================
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const PREFS = [
    '北海道',
    '青森県','岩手県','宮城県','秋田県','山形県','福島県',
    '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
    '富山県','石川県','福井県',
    '新潟県','山梨県','長野県',
    '岐阜県','静岡県','愛知県','三重県',
    '滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
    '鳥取県','島根県','岡山県','広島県','山口県',
    '徳島県','香川県','愛媛県','高知県',
    '福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県',
    '沖縄県'
];

function extractCity(address) {
    if (!address) return null;
    let addr = address;
    for (const p of PREFS) {
        if (addr.startsWith(p)) { addr = addr.slice(p.length); break; }
    }
    const m = addr.match(/^(.+?[市区町村郡])/);
    return m ? m[1] : null;
}

async function fetchAllHotels() {
    let all = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
        const { data, error } = await supabase.from('hotels')
            .select('prefecture,major_area,detail_area,city,address,hotel_type')
            .eq('is_published', true)
            .range(from, from + PAGE - 1);
        if (error) { console.error('Fetch error:', error.message); process.exit(1); }
        if (!data || !data.length) break;
        all = all.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
    }
    return all;
}

function isLoveho(h) {
    return h.hotel_type === 'love_hotel' || h.hotel_type === 'rental_room';
}

async function main() {
    console.log('Fetching hotels...');
    const hotels = await fetchAllHotels();
    console.log(`Fetched ${hotels.length} hotels`);

    // city正規化
    hotels.forEach(h => { if (!h.city) h.city = extractCity(h.address); });

    const regular = hotels.filter(h => !isLoveho(h));
    const loveho = hotels.filter(h => isLoveho(h));

    // --- prefCounts ---
    const prefCounts = {};
    regular.forEach(h => {
        if (h.prefecture) prefCounts[h.prefecture] = (prefCounts[h.prefecture] || 0) + 1;
    });

    // --- loveho counts by prefecture+city ---
    const lovehoByCityPref = {};
    loveho.forEach(h => {
        if (!h.prefecture || !h.city) return;
        const key = h.prefecture + '\t' + h.city;
        lovehoByCityPref[key] = (lovehoByCityPref[key] || 0) + 1;
    });

    // --- per-prefecture: area counts + noArea ---
    const pref = {};
    regular.forEach(h => {
        if (!h.prefecture) return;
        if (!pref[h.prefecture]) pref[h.prefecture] = { _areas: {}, _noArea: 0 };
        if (h.major_area) {
            pref[h.prefecture]._areas[h.major_area] = (pref[h.prefecture]._areas[h.major_area] || 0) + 1;
        } else {
            pref[h.prefecture]._noArea++;
        }
    });
    const prefData = {};
    for (const [p, d] of Object.entries(pref)) {
        const areas = Object.entries(d._areas).sort((a, b) => b[1] - a[1]);
        prefData[p] = { areas, hasNoArea: d._noArea > 0 };
    }

    // --- per-area: detailAreas + cities ---
    // Group regular hotels by pref+majorArea
    const areaHotels = {};
    regular.forEach(h => {
        if (!h.prefecture || !h.major_area) return;
        const key = h.prefecture + '\t' + h.major_area;
        if (!areaHotels[key]) areaHotels[key] = [];
        areaHotels[key].push(h);
    });

    // Also need: for each pref, all regular hotels by city (for cityCount across pref)
    const prefCityCount = {}; // pref -> city -> count
    regular.forEach(h => {
        if (!h.prefecture || !h.city) return;
        if (!prefCityCount[h.prefecture]) prefCityCount[h.prefecture] = {};
        prefCityCount[h.prefecture][h.city] = (prefCityCount[h.prefecture][h.city] || 0) + 1;
    });

    // cityAreaCount: pref -> city -> majorArea -> count
    const cityAreaCountMap = {};
    regular.forEach(h => {
        if (!h.prefecture || !h.city || !h.major_area) return;
        if (!cityAreaCountMap[h.prefecture]) cityAreaCountMap[h.prefecture] = {};
        if (!cityAreaCountMap[h.prefecture][h.city]) cityAreaCountMap[h.prefecture][h.city] = {};
        const m = cityAreaCountMap[h.prefecture][h.city];
        m[h.major_area] = (m[h.major_area] || 0) + 1;
    });

    const areaData = {};
    for (const [key, hotelList] of Object.entries(areaHotels)) {
        const [p, ma] = key.split('\t');

        // detailAreas
        const daCounts = {};
        hotelList.forEach(h => {
            if (h.detail_area && h.detail_area !== ma) {
                daCounts[h.detail_area] = (daCounts[h.detail_area] || 0) + 1;
            }
        });
        const hasDetailArea = Object.keys(daCounts).length > 0;
        const detailAreas = Object.entries(daCounts).sort((a, b) => b[1] - a[1]);

        // cities in this area
        const citySet = new Set();
        hotelList.forEach(h => { if (h.city) citySet.add(h.city); });
        const candidateCities = [...citySet];

        // display filter: only show city in area where it has most hotels
        const displayCities = candidateCities.filter(city => {
            const ac = cityAreaCountMap[p] && cityAreaCountMap[p][city];
            if (!ac) return true;
            const maxCount = Math.max(...Object.values(ac));
            const currentCount = ac[ma] || 0;
            return currentCount >= maxCount;
        });

        // city counts (pref-wide for consistency)
        const pcc = prefCityCount[p] || {};
        const cities = displayCities
            .sort((a, b) => (pcc[b] || 0) - (pcc[a] || 0))
            .map(city => {
                const lk = p + '\t' + city;
                return [city, pcc[city] || 0, lovehoByCityPref[lk] || 0];
            });

        areaData[key] = { da: detailAreas, ct: cities };
    }

    // --- per-detailArea: cities ---
    // Group regular hotels by pref+majorArea+detailArea
    const daHotels = {};
    regular.forEach(h => {
        if (!h.prefecture || !h.major_area || !h.detail_area) return;
        if (h.detail_area === h.major_area) return;
        const key = h.prefecture + '\t' + h.major_area + '\t' + h.detail_area;
        if (!daHotels[key]) daHotels[key] = [];
        daHotels[key].push(h);
    });

    const detailAreaData = {};
    for (const [key, hotelList] of Object.entries(daHotels)) {
        const p = key.split('\t')[0];
        const citySet = new Set();
        hotelList.forEach(h => { if (h.city) citySet.add(h.city); });
        const pcc = prefCityCount[p] || {};
        const cities = [...citySet]
            .sort((a, b) => (pcc[b] || 0) - (pcc[a] || 0))
            .map(city => {
                const lk = p + '\t' + city;
                return [city, pcc[city] || 0, lovehoByCityPref[lk] || 0];
            });
        detailAreaData[key] = { ct: cities };
    }

    // --- noArea cities (major_area=null) ---
    const noAreaHotels = {};
    regular.filter(h => !h.major_area && h.prefecture).forEach(h => {
        if (!noAreaHotels[h.prefecture]) noAreaHotels[h.prefecture] = {};
        const city = h.city || 'unknown';
        noAreaHotels[h.prefecture][city] = (noAreaHotels[h.prefecture][city] || 0) + 1;
    });

    const noAreaData = {};
    for (const [p, cityCounts] of Object.entries(noAreaHotels)) {
        const cities = Object.entries(cityCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([city, count]) => {
                const lk = p + '\t' + city;
                return [city, count, lovehoByCityPref[lk] || 0];
            });
        noAreaData[p] = cities;
    }

    // --- output ---
    const result = {
        generated: new Date().toISOString(),
        prefCounts,
        pref: prefData,
        area: areaData,
        da: detailAreaData,
        noArea: noAreaData
    };

    const json = JSON.stringify(result);
    fs.writeFileSync('area-data.json', json);
    console.log(`Generated area-data.json (${(json.length / 1024).toFixed(1)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
