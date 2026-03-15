import { describe, it, expect, beforeAll } from 'vitest';

// -------------------------------------------------------------------------
// Setup: These functions are defined as globals in the browser.
// We replicate them here for unit testing since there is no module export.
// Source: ui-utils.js, api-service.js
// -------------------------------------------------------------------------

// From api-service.js
function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// From ui-utils.js
function extractCity(address) {
    if (!address) return null;

    const PREFS = [
        '北海道',
        '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
        '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
        '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県',
        '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
        '鳥取県', '島根県', '岡山県', '広島県', '山口県',
        '徳島県', '香川県', '愛媛県', '高知県',
        '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
    ];

    let after = address;
    for (const pref of PREFS) {
        if (address.startsWith(pref)) {
            after = address.slice(pref.length).trimStart();
            break;
        }
    }
    if (!after) return null;

    const base = after.replace(/^[\u4E00-\u9FFF\u3040-\u30FF]{1,5}郡/, '');
    let m;

    m = base.match(/^((?:(?!区)[\u4E00-\u9FFF\u3040-\u30FF]){1,10}?市)/);
    if (m) return m[1];

    m = base.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}?区)/);
    if (m) return m[1];

    m = after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,5}郡[\u4E00-\u9FFF\u3040-\u30FF]{1,5}[町村])/);
    if (m) return m[1];

    m = after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}郡)/);
    if (m) return m[1];

    m = after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}[町村])/);
    if (m) return m[1];

    return null;
}

// From ui-utils.js
function calcDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// From ui-utils.js
function freshnessLabel(isoDate) {
    if (!isoDate) return '';
    const diff = Math.floor((Date.now() - new Date(isoDate)) / 86400000);
    if (diff === 0) return '<span class="freshness fresh">本日更新</span>';
    else if (diff <= 7) return `<span class="freshness recent">${diff}日前に更新</span>`;
    else if (diff <= 30) return `<span class="freshness normal">${diff}日前に更新</span>`;
    else return `<span class="freshness old">${diff}日前に更新</span>`;
}

// From ui-utils.js
function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// From ui-utils.js
function formatTransportFee(val) {
    if (val === null || val === undefined || val === '') return null;
    if (val === 0 || val === '0') return '無料';
    const num = parseInt(String(val).replace(/,/g, ''), 10);
    if (isNaN(num)) return null;
    return '¥' + num.toLocaleString('ja-JP') + '-';
}

// From ui-utils.js
function getReportCount(h) {
    const s = h.summary;
    if (!s) return 0;
    if (s.total_reports != null) return s.total_reports;
    return (s.can_call_count || 0) + (s.cannot_call_count || 0) + (s.shop_can_count || 0) + (s.shop_ng_count || 0);
}

// =========================================================================
// Tests
// =========================================================================

describe('esc', () => {
    it('HTMLタグをエスケープする', () => {
        expect(esc('<script>alert("xss")</script>')).toBe(
            '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
        );
    });

    it('nullを空文字に変換する', () => {
        expect(esc(null)).toBe('');
    });

    it('undefinedを空文字に変換する', () => {
        expect(esc(undefined)).toBe('');
    });

    it('空文字をそのまま返す', () => {
        expect(esc('')).toBe('');
    });

    it('&をエスケープする', () => {
        expect(esc('A & B')).toBe('A &amp; B');
    });

    it('数値を文字列に変換してそのまま返す', () => {
        expect(esc(12345)).toBe('12345');
    });
});

describe('extractCity', () => {
    it('東京都の市を抽出する', () => {
        expect(extractCity('東京都新宿区歌舞伎町1-1-1')).toBe('新宿区');
    });

    it('大阪府の市を抽出する', () => {
        expect(extractCity('大阪府大阪市北区梅田1-1-1')).toBe('大阪市');
    });

    it('北海道の市を抽出する', () => {
        expect(extractCity('北海道札幌市中央区北1条西2丁目')).toBe('札幌市');
    });

    it('郡を含む住所から町を抽出する', () => {
        expect(extractCity('長野県北安曇郡白馬村北城')).toBe('北安曇郡白馬村');
    });

    it('nullを返す（null入力）', () => {
        expect(extractCity(null)).toBe(null);
    });

    it('nullを返す（空文字入力）', () => {
        expect(extractCity('')).toBe(null);
    });
});

describe('calcDistance', () => {
    it('同一地点の距離は0', () => {
        expect(calcDistance(35.6812, 139.7671, 35.6812, 139.7671)).toBe(0);
    });

    it('東京-大阪間の距離は約400km', () => {
        const dist = calcDistance(35.6812, 139.7671, 34.6937, 135.5023);
        expect(dist).toBeGreaterThan(380);
        expect(dist).toBeLessThan(420);
    });

    it('近距離（東京駅-新宿駅）は約6-7km', () => {
        const dist = calcDistance(35.6812, 139.7671, 35.6896, 139.7006);
        expect(dist).toBeGreaterThan(5);
        expect(dist).toBeLessThan(8);
    });
});

describe('freshnessLabel', () => {
    it('nullの場合は空文字を返す', () => {
        expect(freshnessLabel(null)).toBe('');
    });

    it('本日の日付で「本日更新」を返す', () => {
        const today = new Date().toISOString();
        expect(freshnessLabel(today)).toContain('本日更新');
        expect(freshnessLabel(today)).toContain('fresh');
    });

    it('3日前の日付で「3日前に更新」を返す', () => {
        const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
        const result = freshnessLabel(threeDaysAgo);
        expect(result).toContain('3日前に更新');
        expect(result).toContain('recent');
    });

    it('60日前の日付で「old」クラスを含む', () => {
        const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();
        const result = freshnessLabel(sixtyDaysAgo);
        expect(result).toContain('old');
        expect(result).toContain('60日前に更新');
    });
});

describe('formatDate', () => {
    it('ISO日付をyyyy/MM/dd形式に変換する', () => {
        expect(formatDate('2025-01-05T12:00:00Z')).toBe('2025/01/05');
    });

    it('空文字を返す（null入力）', () => {
        expect(formatDate(null)).toBe('');
    });

    it('空文字を返す（空文字入力）', () => {
        expect(formatDate('')).toBe('');
    });
});

describe('formatTransportFee', () => {
    it('0の場合「無料」を返す', () => {
        expect(formatTransportFee(0)).toBe('無料');
    });

    it('文字列"0"の場合「無料」を返す', () => {
        expect(formatTransportFee('0')).toBe('無料');
    });

    it('数値を円表記に変換する', () => {
        expect(formatTransportFee(3000)).toBe('¥3,000-');
    });

    it('nullの場合はnullを返す', () => {
        expect(formatTransportFee(null)).toBe(null);
    });

    it('空文字の場合はnullを返す', () => {
        expect(formatTransportFee('')).toBe(null);
    });

    it('カンマ付き文字列を正しく変換する', () => {
        expect(formatTransportFee('5,000')).toBe('¥5,000-');
    });
});

describe('getReportCount', () => {
    it('summaryがnullの場合0を返す', () => {
        expect(getReportCount({ summary: null })).toBe(0);
    });

    it('total_reportsがある場合はそれを返す', () => {
        expect(getReportCount({ summary: { total_reports: 15 } })).toBe(15);
    });

    it('個別カウントの合計を返す', () => {
        const h = {
            summary: {
                can_call_count: 3,
                cannot_call_count: 2,
                shop_can_count: 1,
                shop_ng_count: 0,
            },
        };
        expect(getReportCount(h)).toBe(6);
    });

    it('部分的なカウントでもNaNにならない', () => {
        expect(getReportCount({ summary: { can_call_count: 5 } })).toBe(5);
    });
});
