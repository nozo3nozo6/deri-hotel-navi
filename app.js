// ==================== app.js - グロック先生 最終修正版 ====================

// CDNで読み込んだグローバル supabase をそのまま使う（再宣言しない）
const supabase = window.supabase;  // CDNから来たグローバル変数を使う

// または、CDNを使わずモジュールとしてインポートしたい場合は削除して以下に
// import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
// const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 設定値
const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB';

// 変数宣言（supabase は上記で定義済みなので再宣言しない）
let currentMode = 'men';
let currentLang = localStorage.getItem('app_lang') || 'ja';
let currentLevel = 'japan';
let historyStack = [];

// 多言語データ（省略可、必要なら前のものをコピー）
const i18n = { /* ... 省略 ... */ };

// 言語切り替え関数（省略可）
function changeLang(lang) { /* ... 省略 ... */ }

// 階層メニュー関数（そのまま）
async function loadLevel(level = 'japan', parentCode = null) {
    const container = document.getElementById('map-button-container');
    container.innerHTML = '';

    document.getElementById('current-level').innerHTML = 
        `現在: ${level === 'japan' ? '日本全国' : level === 'prefecture' ? '都道府県' : '市区町村'}`;

    document.getElementById('btn-map-back').style.display = level === 'japan' ? 'none' : 'block';

    let query = supabase.from('hotels').select('*');

    if (level === 'prefecture') {
        query = query.eq('middle_class_code', parentCode);
    } else if (level === 'smallClass') {
        query = query.eq('small_class_code', parentCode);
    }

    const { data } = await query.not('name', 'is', null).order('name');

    const unique = {};
    data.forEach(h => {
        const key = level === 'japan' ? h.prefecture : h.city;
        if (!unique[key]) unique[key] = h;
    });

    Object.values(unique).forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'map-btn';
        btn.textContent = level === 'japan' ? item.prefecture : item.city;
        btn.onclick = () => {
            historyStack.push({ level, code: parentCode });
            loadLevel(level === 'japan' ? 'prefecture' : 'smallClass', 
                      level === 'japan' ? item.middle_class_code : item.small_class_code);
        };
        container.appendChild(btn);
    });
}

function backLevel() {
    if (historyStack.length === 0) return;
    const prev = historyStack.pop();
    loadLevel(prev.level, prev.code);
}

// 初期化
window.onload = () => {
    currentMode = sessionStorage.getItem('session_mode') || 'men';
    if (currentMode === 'women') document.body.classList.add('mode-women');

    changeLang(currentLang);
    loadLevel('japan');   // ← これが動けばボタンが出る！
};