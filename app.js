const SUPABASE_URL = 'https://ojkhwbvoaiaqekxrbpdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentMode = 'men';
let currentLang = localStorage.getItem('app_lang') || 'ja';
let currentLevel = 'japan';
let currentParentCode = null;
let historyStack = [];

// 多言語データ（シンプルに）
const i18n = {
    ja: {
        select_area: "エリアを選択してください",
        back: "戻る",
        region_select: "地域を選択",
        back_level: "一つ前に戻る",
        search_placeholder: "地域名やホテル名を入力...",
        list_placeholder: "エリアを選択すると、ここにホテルが表示されます",
        loading: "読み込み中...",
        no_data: "データがありません（テスト中）"
    }
};

// 階層メニュー（データがなくても仮表示で動く）
async function loadLevel(level = 'japan', parentCode = null) {
    currentLevel = level;
    currentParentCode = parentCode;

    const container = document.getElementById('map-button-container');
    const statusEl = document.getElementById('current-level');
    const texts = i18n[currentLang] || i18n.ja;

    container.innerHTML = `<p style="grid-column: 1/-1; text-align:center;">${texts.loading}</p>`;
    statusEl.innerHTML = `現在: ${level === 'japan' ? '日本全国' : level === 'prefecture' ? '都道府県' : '市区町村'}`;
    document.getElementById('btn-map-back').style.display = level === 'japan' ? 'none' : 'block';

    let items = [];

    if (level === 'japan') {
        // 仮データ（データがなくても動くように）
        items = [
            { prefecture: '東京都', middle_class_code: '13' },
            { prefecture: '大阪府', middle_class_code: '27' },
            { prefecture: '北海道', middle_class_code: '1' },
            { prefecture: '沖縄県', middle_class_code: '47' },
            { prefecture: '愛知県', middle_class_code: '23' }
        ];
    } else if (level === 'prefecture') {
        // 仮データ（実際のデータが入ったら置き換わる）
        items = [
            { city: '新宿区', small_class_code: '13104' },
            { city: '渋谷区', small_class_code: '13113' },
            { city: '大阪市中央区', small_class_code: '27128' }
        ];
    }

    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = `<p style="grid-column: 1/-1; text-align:center; color:#999;">${texts.no_data}</p>`;
        return;
    }

    items.forEach(item => {
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

// 戻るボタン
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