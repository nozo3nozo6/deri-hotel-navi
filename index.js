const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// --- 設定情報 ---
const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co'; 
const SUPABASE_KEY = 'sb_secret_YTSjsm66P67WKiuXEEVIig_3NyBMHTl';
const RAKUTEN_APP_ID = '18c62ced-24a7-4c8b-9917-b41d6ae300fe'; 
const RAKUTEN_ACCESS_KEY = 'pk_42uxCSTpax33Jbgv0zbf89kgrHyfiGk4BstKcHLrp5J';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const WAIT_TIME = 1000;

// 🔑 楽天管理画面の設定と「完全一致」させる必要があります
const REFERER_URL = "https://deri-hotel-navi.vercel.app"; 

async function syncAllJapan() {
    console.log('🇯🇵 【全件網羅モード】全ページの収集を開始します...');
    try {
        const config = { 
            headers: { 
                "Referer": REFERER_URL,
                "Origin": REFERER_URL 
            } 
        };

        // エリア情報の取得
        const areaRes = await axios.get(`https://openapi.rakuten.co.jp/engine/api/Travel/GetAreaClass/20140210`, {
            params: { 
                applicationId: RAKUTEN_APP_ID, 
                accessKey: RAKUTEN_ACCESS_KEY, 
                format: "json", 
                formatVersion: "2" 
            },
            headers: config.headers
        });

        const areaData = areaRes.data;
        // 最新のレスポンス構造（items直下）から都道府県を抽出
        const prefectures = areaData.items?.[0]?.middleClasses || areaData.areaClasses?.largeClasses?.[0]?.middleClasses || [];

        if (prefectures.length === 0) {
            throw new Error("都道府県データの取得に失敗しました。レスポンス構造を確認してください。");
        }

        for (const pref of prefectures) {
            console.log(`\n🗾 ${pref.middleClassName} の全ホテルをスキャン中...`);
            const cities = pref.smallClasses || [];
            for (const city of cities) {
                // 詳細エリアがあれば詳細、なければ小エリア名を使用
                const details = city.detailClasses || [{ detailClassCode: null, detailClassName: city.smallClassName }];
                for (const d of details) {
                    await fetchAllPages(pref.middleClassCode, city.smallClassCode, d.detailClassCode, d.detailClassName, config);
                }
            }
        }
        console.log('\n🎉 日本全国・全ホテルデータの同期が完了しました！');
    } catch (err) { 
        console.error('❌ 致命的エラー:', err.response?.data || err.message); 
    }
}

async function fetchAllPages(mid, sml, dtl, name, config) {
    let page = 1;
    let hasNext = true;

    while (hasNext) {
        process.stdout.write(`  🔎 ${name} (${page}ページ目)... `);
        try {
            const params = {
                applicationId: RAKUTEN_APP_ID, 
                accessKey: RAKUTEN_ACCESS_KEY, 
                format: "json",
                largeClassCode: "japan", 
                middleClassCode: mid, 
                smallClassCode: sml,
                hits: 30, 
                page: page
            };
            if (dtl) params.detailClassCode = dtl;

            const res = await axios.get(`https://openapi.rakuten.co.jp/engine/api/Travel/SimpleHotelSearch/20170426`, {
                params: params,
                headers: config.headers
            });

            const hotels = res.data.hotels || [];
            if (hotels.length === 0) { hasNext = false; break; }

            for (const h of hotels) {
                const info = h.hotel[0]?.hotelBasicInfo || h.hotel[0];
                if (!info) continue;

                await supabase.from('hotels').upsert({
                    rakuten_hotel_no: String(info.hotelNo),
                    name: info.hotelName,
                    address: (info.address1 || '') + (info.address2 || ''),
                    city: name,
                    latitude: parseFloat(info.latitude) || 0,
                    longitude: parseFloat(info.longitude) || 0
                }, { onConflict: 'rakuten_hotel_no' });
            }

            console.log(`✅ ${hotels.length}軒取得`);
            
            const paging = res.data.pagingInfo;
            // 次のページがあるか判定
            if (!paging || page >= paging.pageCount) { 
                hasNext = false; 
            } else { 
                page++; 
            }
            await new Promise(r => setTimeout(r, WAIT_TIME));

        } catch (e) { 
            console.log(`☁️ 終了 (Page ${page})`); 
            hasNext = false; 
        }
    }
}

syncAllJapan();