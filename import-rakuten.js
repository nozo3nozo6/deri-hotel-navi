require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const WAIT_TIME = 2000;
const RETRY_WAIT = 5000; // 503エラー時のリトライ待機（5秒）
const MAX_RETRY = 3;     // 最大リトライ回数

const HEADERS = {
    'Referer': 'https://yobuho.com',
    'Origin': 'https://yobuho.com',
    'Authorization': `Bearer ${RAKUTEN_ACCESS_KEY}`
};

const REGION_MAP = {
    "hokkaido": "北海道",
    "aomori": "東北", "iwate": "東北", "miyagi": "東北", "akita": "東北", "yamagata": "東北", "fukushima": "東北",
    "ibaraki": "関東", "tochigi": "関東", "gunma": "関東", "saitama": "関東", "chiba": "関東", "tokyo": "関東", "kanagawa": "関東",
    "niigata": "中部", "toyama": "中部", "ishikawa": "中部", "fukui": "中部", "yamanashi": "中部", "nagano": "中部", "gifu": "中部", "shizuoka": "中部", "aichi": "中部",
    "mie": "近畿", "shiga": "近畿", "kyoto": "近畿", "osaka": "近畿", "hyogo": "近畿", "nara": "近畿", "wakayama": "近畿",
    "tottori": "中国", "shimane": "中国", "okayama": "中国", "hiroshima": "中国", "yamaguchi": "中国",
    "tokushima": "四国", "kagawa": "四国", "ehime": "四国", "kochi": "四国",
    "fukuoka": "九州", "saga": "九州", "nagasaki": "九州", "kumamoto": "九州", "oita": "九州", "miyazaki": "九州", "kagoshima": "九州",
    "okinawa": "沖縄"
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function detectHotelType(name) {
    if (!name) return 'other';
    if (/旅館|温泉|湯|宿|荘|館/.test(name)) return 'ryokan';
    if (/ペンション/.test(name)) return 'pension';
    if (/民宿/.test(name)) return 'minshuku';
    if (/リゾート/.test(name)) return 'resort';
    if (/ゲストハウス|ホステル|カプセル/.test(name)) return 'other';
    if (/東横イン|アパホテル|ルートイン|スーパーホテル|ドーミーイン|コンフォート|ホテルリブマックス|ビジネス|イン|[Ii]nn/.test(name)) return 'business';
    if (/ホテル/.test(name)) return 'city';
    return 'other';
}

function extractCity(address) {
    if (!address) return null;
    const match = address.match(/(?:都|道|府|県)([^0-9０-９\-－\s]{1,10}?[市区町村郡])/);
    return match ? match[1] : null;
}

// リトライ付きAPIリクエスト
async function rakutenRequest(params, retry = 0) {
    try {
        const res = await axios.get(
            'https://openapi.rakuten.co.jp/engine/api/Travel/SimpleHotelSearch/20170426',
            { params, headers: HEADERS }
        );
        return res;
    } catch (err) {
        const code = err.response?.data?.errors?.errorCode || err.response?.status;
        const isRetryable = code === 503 || code === 429 || code === 500;

        if (isRetryable && retry < MAX_RETRY) {
            const wait = RETRY_WAIT * (retry + 1); // 5秒→10秒→15秒
            console.log(`  ⚠️  エラー${code} — ${wait/1000}秒後にリトライ (${retry + 1}/${MAX_RETRY})...`);
            await sleep(wait);
            return rakutenRequest(params, retry + 1);
        }
        throw err;
    }
}

async function syncAllJapan() {
    console.log('🇯🇵 【全国制覇モード】ホテル収集を開始します...');
    try {
        const areaRes = await axios.get(
            'https://openapi.rakuten.co.jp/engine/api/Travel/GetAreaClass/20140210',
            {
                params: { applicationId: RAKUTEN_APP_ID, accessKey: RAKUTEN_ACCESS_KEY, format: 'json' },
                headers: HEADERS
            }
        );

        const middleClasses = areaRes.data.areaClasses.largeClasses[0].largeClass.middleClasses;
        console.log(`📍 全${middleClasses.length}都道府県を順次取得します。\n`);

        for (const middleObj of middleClasses) {
            const pref = middleObj.middleClass;
            const prefCode = pref.middleClassCode;
            const prefName = pref.middleClassName;
            const region = REGION_MAP[prefCode] || 'その他';

            console.log(`\n==============\n🗾 ${region} - ${prefName}\n==============`);

            const smallClasses = pref.smallClasses || [];

            for (const smallObj of smallClasses) {
                const city = smallObj.smallClass;
                const cityCode = city.smallClassCode;
                const cityName = city.smallClassName;
                const detailClasses = city.detailClasses || [];

                if (detailClasses.length > 0) {
                    for (const detailObj of detailClasses) {
                        const detail = detailObj.detailClass;
                        const detailCode = detail.detailClassCode;
                        const detailName = detail.detailClassName;
                        process.stdout.write(`  🔎 ${cityName}/${detailName} のホテルを検索中... `);
                        const count = await fetchAndSave(region, prefName, prefCode, cityName, cityCode, detailCode, detailName);
                        if (count > 0) console.log(`=> ✅ ${count}軒 追加`);
                        else console.log(`=> ☁️ なし`);
                        await sleep(WAIT_TIME);
                    }
                } else {
                    process.stdout.write(`  🔎 ${cityName} のホテルを検索中... `);
                    const count = await fetchAndSave(region, prefName, prefCode, cityName, cityCode, null, null);
                    if (count > 0) console.log(`=> ✅ ${count}軒 追加`);
                    else console.log(`=> ☁️ なし`);
                    await sleep(WAIT_TIME);
                }
            }
        }
        console.log('\n🎉🎉🎉 日本全国のホテルデータ同期が完了しました！ 🎉🎉🎉');
    } catch (err) {
        console.error('\n❌ 致命的エラー:', err.response?.data || err.message);
    }
}

async function fetchAndSave(region, prefecture, prefCode, majorArea, cityCode, detailCode, detailName) {
    try {
        let page = 1;
        let totalSaved = 0;

        while (true) {
            const params = {
                applicationId: RAKUTEN_APP_ID,
                accessKey: RAKUTEN_ACCESS_KEY,
                format: 'json',
                largeClassCode: 'japan',
                middleClassCode: prefCode,
                smallClassCode: cityCode,
                hits: 30,
                page: page,
                datumType: 1
            };
            if (detailCode) params.detailClassCode = detailCode;

            const res = await rakutenRequest(params); // リトライ付き

            const hotels = res.data.hotels || [];
            if (hotels.length === 0) break;

            for (const h of hotels) {
                const info = h.hotel[0]?.hotelBasicInfo;
                if (!info) continue;

                const address = (info.address1 || '') + (info.address2 || '');

                const { error } = await supabase.from('hotels').upsert({
                    rakuten_hotel_no: String(info.hotelNo),
                    name: info.hotelName,
                    address: address,
                    tel: info.telephoneNo,
                    postal_code: info.postalCode,
                    region: region,
                    prefecture: prefecture,
                    major_area: majorArea,
                    city: extractCity(address),
                    detail_area: detailName || null,
                    detail_area_code: detailCode || null,
                    latitude: parseFloat(info.latitude),
                    longitude: parseFloat(info.longitude),
                    thumbnail_url: info.hotelThumbnailUrl,
                    hotel_url: info.hotelInformationUrl,
                    nearest_station: info.nearestStation,
                    image_url: info.hotelImageUrl,
                    review_average: info.reviewAverage ? parseFloat(info.reviewAverage) : null,
                    min_charge: info.hotelMinCharge ? parseInt(info.hotelMinCharge) : null,
                    hotel_type: detectHotelType(info.hotelName)
                }, { onConflict: 'rakuten_hotel_no' });

                if (error) console.error('  💥 保存エラー:', error.message);
            }

            totalSaved += hotels.length;

            const pageInfo = res.data.pagingInfo;
            if (!pageInfo || page >= pageInfo.pageCount) break;

            page++;
            await sleep(WAIT_TIME);
        }

        return totalSaved;
    } catch (err) {
        console.error(`  ❌ エラー (リトライ上限):`, err.response?.data || err.message);
        return 0;
    }
}

syncAllJapan();