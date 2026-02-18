// ==================== app.js - 階層メニュー完成版 ====================

const supabase = supabase.createClient(
    'https://ojkhwbvoaiaqekxrbpdd.supabase.co',
    'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'
);

let currentMode = 'men';
let currentLang = localStorage.getItem('app_lang') || 'ja';
let currentLevel = 'japan';
let currentParentCode = null;
let historyStack = [];

// 多言語（必要最低限）
const i18n = {
    ja: {
        select_area: "エリアを選択してください",
        back: "戻る",
        region_select: "地域を選択",
        back_level: "一つ前に戻る",
        search_placeholder: "地域名やホテル名を入力...",
        list_placeholder: "エリアを選択すると、ここにホテルが表示されます"
    }
};

// 言語切り替え
function changeLang(lang) {
    currentLang = lang;
    localStorage.setItem('app_lang', lang);
    document.querySelectorAll('[data-lang]').forEach(el => {
        const key = el.getAttribute('data-lang');
        if (i18n[lang] && i18n[lang][key]) el.textContent = i18n[lang][key];
    });
}

// 階層メニュー表示
async function loadLevel(level = 'japan', parentCode = null) {
    currentLevel = level;
    currentParentCode = parentCode;

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

    const { data } = await query.not('name', 'is', null);

    const unique = {};
    data.forEach(h => {
        const key = level === 'japan' ? h.prefecture : h.city;
        if (key && !unique[key]) unique[key] = h;
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
    loadLevel('japan');
};