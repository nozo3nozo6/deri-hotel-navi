// 1. 変数名を supabaseClient に変更して名前の衝突を避ける
const supabaseClient = supabase.createClient(
    'https://ojkhwbvoaiaqekxrbpdd.supabase.co',
    'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB'
);

let currentMode = 'men';
let currentLang = localStorage.getItem('app_lang') || 'ja';
let currentLevel = 'japan';
let currentParentCode = null;
let historyStack = [];

// 多言語データ
const i18n = {
    ja: {
        select_area: "エリアを選択してください",
        back: "戻る",
        region_select: "地域を選択",
        back_level: "一つ前に戻る",
        search_placeholder: "地域名やホテル名を入力...",
        list_placeholder: "エリアを選択すると、ここにホテルが表示されます",
        loading: "読み込み中...",
        no_data: "データがありません"
    }
};

// -----------------------------------------
// 階層メニュー表示ロジック
// -----------------------------------------
async function loadLevel(level = 'japan', parentCode = null) {
    currentLevel = level;
    currentParentCode = parentCode;

    const container = document.getElementById('map-button-container');
    const statusEl = document.getElementById('current-level');
    const texts = i18n[currentLang] || i18n.ja;

    container.innerHTML = `<p style="grid-column: 1/-1; text-align:center;">${texts.loading}</p>`;

    // 表示テキストの更新
    statusEl.innerHTML = `現在: ${level === 'japan' ? '日本全国' : level === 'prefecture' ? '都道府県内' : '市区町村'}`;
    document.getElementById('btn-map-back').style.display = level === 'japan' ? 'none' : 'block';

    // ★ supabaseClient を使用してデータを取得
    let query = supabaseClient.from('hotels').select('*');

    if (level === 'prefecture') {
        query = query.eq('middle_class_code', parentCode);
    } else if (level === 'smallClass') {
        query = query.eq('small_class_code', parentCode);
    }

    const { data, error } = await query;

    if (error) {
        console.error("DB Error:", error);
        container.innerHTML = `<p style="color:red;">エラーが発生しました</p>`;
        return;
    }

    container.innerHTML = '';

    // 重複を排除してボタンを生成
    const unique = {};
    data.forEach(h => {
        const key = level === 'japan' ? h.prefecture : h.city;
        if (key && !unique[key]) unique[key] = h;
    });

    const items = Object.values(unique);

    if (items.length === 0) {
        container.innerHTML = `<p style="grid-column: 1/-1; text-align:center; color:#999;">${texts.no_data}</p>`;
    }

    items.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'map-btn';
        btn.textContent = level === 'japan' ? item.prefecture : item.city;
        
        btn.onclick = () => {
            historyStack.push({ level, code: parentCode });
            loadLevel(
                level === 'japan' ? 'prefecture' : 'smallClass', 
                level === 'japan' ? item.middle_class_code : item.small_class_code
            );
        };
        container.appendChild(btn);
    });
}

// -----------------------------------------
// 補助関数
// -----------------------------------------
function backLevel() {
    if (historyStack.length === 0) return;
    const prev = historyStack.pop();
    loadLevel(prev.level, prev.code);
}

function changeLang(lang) {
    currentLang = lang;
    localStorage.setItem('app_lang', lang);
    const texts = i18n[lang] || i18n.ja;
    document.querySelectorAll('[data-lang]').forEach(el => {
        const key = el.getAttribute('data-lang');
        if (texts[key]) el.textContent = texts[key];
    });
}

window.onload = () => {
    currentMode = sessionStorage.getItem('session_mode') || 'men';
    if (currentMode === 'women') document.body.classList.add('mode-women');

    changeLang(currentLang);
    loadLevel('japan');
};