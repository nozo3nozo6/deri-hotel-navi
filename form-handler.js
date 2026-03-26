// ==========================================================================
// form-handler.js — 投稿フォーム、フラグ、ホテル追加申請
// ==========================================================================

let CONDITIONS = [
    '直通', 'カードキー必須', 'EV待ち合わせ',
    '玄関待ち合わせ', '深夜玄関待合', '2名予約必須',
    'フロント相談', 'ノウハウ', 'その他'
];

const TIME_SLOTS = [
    '早朝（5:00〜8:00）',
    '朝（8:00〜11:00）',
    '昼（11:00〜16:00）',
    '夕方（16:00〜18:00）',
    '夜（18:00〜23:00）',
    '深夜（23:00〜5:00）',
];

let hotelFormState = {
    can_call: null,
    conditions: new Set(),
    time_slot: '',
    can_call_reasons: new Set(),
    cannot_call_reasons: new Set(),
    comment: '',
    poster_name: '',
    room_type: '',
    multi_person: false,
    multi_fee: false,
    guest_male: 1,
    guest_female: 1,
};

// AppState.form 登録
Object.defineProperty(AppState.form, 'hotel', { get() { return hotelFormState; }, set(v) { hotelFormState = v; } });

function hotelStepGuest(gender, delta) {
    const key = gender === 'male' ? 'guest_male' : 'guest_female';
    const elId = gender === 'male' ? 'form-guest-male' : 'form-guest-female';
    const next = Math.min(4, Math.max(0, (hotelFormState[key] || 0) + delta));
    hotelFormState[key] = next;
    const el = document.getElementById(elId);
    if (el) el.textContent = next;
}

function hotelToggleMultiPerson(checked) {
    hotelFormState.multi_person = checked;
    const section = document.getElementById('form-multi-person-section');
    if (section) section.style.display = checked ? 'block' : 'none';
    if (checked) {
        hotelFormState.guest_male = 1;
        hotelFormState.guest_female = 1;
        const mEl = document.getElementById('form-guest-male');
        const fEl = document.getElementById('form-guest-female');
        if (mEl) mEl.textContent = 1;
        if (fEl) fEl.textContent = 1;
    }
}

function updatePostDatetime() {
    const el = document.getElementById('post-datetime');
    if (!el) return;
    const now = new Date();
    const fmt = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    el.textContent = fmt;
    setTimeout(updatePostDatetime, 60000);
}

function hotelSetCanCall(val) {
    hotelFormState.can_call = val;
    document.getElementById('btn-can').classList.toggle('active', val === true);
    document.getElementById('btn-cannot').classList.toggle('active', val === false);
    if (val) {
        hotelFormState.cannot_call_reasons.clear();
        const cd = document.getElementById('cannot-reasons-display');
        if (cd) cd.innerHTML = '';
        showCanReasonsModal();
    } else {
        hotelFormState.can_call_reasons.clear();
        const cd = document.getElementById('can-reasons-display');
        if (cd) cd.innerHTML = '';
        hotelFormState.conditions.clear();
        hotelFormState.time_slot = '';
        const tsEl = document.getElementById('form-time-slot');
        if (tsEl) tsEl.value = '';
        showCannotReasonsModal();
    }
}

// ==========================================================================
// 呼べた理由モーダル
// ==========================================================================
function showCanReasonsModal() {
    hotelFormState.can_call_reasons.clear();
    const checkboxes = document.getElementById('can-reasons-checkboxes');
    checkboxes.innerHTML = CAN_CALL_REASONS.map((r, i) => {
        const narrow = CAN_CALL_REASONS_NARROW[r] || r;
        return `
        <label id="cr-${i}" onclick="toggleCanReason(${i})"
            style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-3,#f0ebe0);border:2px solid var(--border,rgba(180,150,100,0.18));border-radius:8px;cursor:pointer;transition:all 0.15s;">
            <span class="cr-check" style="width:18px;height:18px;border:2px solid rgba(180,150,100,0.4);border-radius:4px;background:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:transparent;"></span>
            <span class="cr-label-full" style="font-size:13px;font-weight:500;color:var(--text,#1a1410);">${esc(r)}</span>
            <span class="cr-label-narrow" style="font-size:13px;font-weight:500;color:var(--text,#1a1410);">${esc(narrow)}</span>
        </label>`;
    }).join('');
    document.getElementById('can-reasons-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('can-reasons-modal')?.focus(), 100);
}

function toggleCanReason(idx) {
    const reason = CAN_CALL_REASONS[idx];
    const el = document.getElementById(`cr-${idx}`);
    const check = el.querySelector('.cr-check');
    if (hotelFormState.can_call_reasons.has(reason)) {
        hotelFormState.can_call_reasons.delete(reason);
        el.style.borderColor = '';
        el.style.background = '';
        check.textContent = '';
        check.style.background = '#fff';
        check.style.borderColor = 'rgba(180,150,100,0.4)';
        check.style.color = 'transparent';
    } else {
        hotelFormState.can_call_reasons.add(reason);
        el.style.borderColor = 'rgba(58,154,96,0.5)';
        el.style.background = 'rgba(58,154,96,0.06)';
        check.textContent = '✓';
        check.style.background = '#3a9a60';
        check.style.borderColor = '#3a9a60';
        check.style.color = '#fff';
    }
}

function cancelCanReasons() {
    document.getElementById('can-reasons-modal').style.display = 'none';
    hotelFormState.can_call = null;
    hotelFormState.can_call_reasons.clear();
    document.getElementById('btn-can').classList.remove('active');
}

function confirmCanReasons() {
    document.getElementById('can-reasons-modal').style.display = 'none';
    const display = document.getElementById('can-reasons-display');
    if (display) {
        const selected = [...hotelFormState.can_call_reasons];
        display.innerHTML = selected.length > 0
            ? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:6px 0 2px;">
                <span style="font-size:11px;color:var(--text-3);">呼べた理由：</span>
                ${selected.map(r => `<span style="padding:3px 9px;background:rgba(58,154,96,0.1);border:1px solid rgba(58,154,96,0.3);border-radius:10px;font-size:11px;color:#3a9a60;font-weight:600;">${esc(r)}</span>`).join('')}
                <button onclick="showCanReasonsModal()" style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:10px;background:transparent;cursor:pointer;color:var(--text-3);">変更</button>
               </div>`
            : `<div style="padding:4px 0;"><button onclick="showCanReasonsModal()" style="font-size:12px;padding:4px 12px;border:1px dashed rgba(58,154,96,0.4);border-radius:10px;background:transparent;cursor:pointer;color:#3a7a50;">＋ 呼べた理由を選択（任意）</button></div>`;
    }
}

// ==========================================================================
// 呼べなかった理由モーダル
// ==========================================================================
function showCannotReasonsModal() {
    hotelFormState.cannot_call_reasons.clear();
    const checkboxes = document.getElementById('cannot-reasons-checkboxes');
    checkboxes.innerHTML = CANNOT_CALL_REASONS.map((r, i) => `
        <label id="cnr-${i}" onclick="toggleCannotReason(${i})"
            style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-3,#f0ebe0);border:2px solid var(--border,rgba(180,150,100,0.18));border-radius:8px;cursor:pointer;transition:all 0.15s;">
            <span class="cnr-check" style="width:18px;height:18px;border:2px solid rgba(180,150,100,0.4);border-radius:4px;background:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:transparent;"></span>
            <span style="font-size:13px;font-weight:500;color:var(--text,#1a1410);">${esc(r)}</span>
        </label>`).join('');
    document.getElementById('cannot-reasons-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('cannot-reasons-modal')?.focus(), 100);
}

function toggleCannotReason(idx) {
    const reason = CANNOT_CALL_REASONS[idx];
    const el = document.getElementById(`cnr-${idx}`);
    const check = el.querySelector('.cnr-check');
    if (hotelFormState.cannot_call_reasons.has(reason)) {
        hotelFormState.cannot_call_reasons.delete(reason);
        el.style.borderColor = '';
        el.style.background = '';
        check.textContent = '';
        check.style.background = '#fff';
        check.style.borderColor = 'rgba(180,150,100,0.4)';
        check.style.color = 'transparent';
    } else {
        hotelFormState.cannot_call_reasons.add(reason);
        el.style.borderColor = 'rgba(192,80,80,0.5)';
        el.style.background = 'rgba(192,80,80,0.06)';
        check.textContent = '✓';
        check.style.background = '#c05050';
        check.style.borderColor = '#c05050';
        check.style.color = '#fff';
    }
}

function cancelCannotReasons() {
    document.getElementById('cannot-reasons-modal').style.display = 'none';
    hotelFormState.can_call = null;
    hotelFormState.cannot_call_reasons.clear();
    document.getElementById('btn-cannot').classList.remove('active');
}

function confirmCannotReasons() {
    document.getElementById('cannot-reasons-modal').style.display = 'none';
    const display = document.getElementById('cannot-reasons-display');
    if (display) {
        const selected = [...hotelFormState.cannot_call_reasons];
        display.innerHTML = selected.length > 0
            ? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:6px 0 2px;">
                <span style="font-size:11px;color:var(--text-3);">呼べなかった理由：</span>
                ${selected.map(r => `<span style="padding:3px 9px;background:rgba(192,80,80,0.1);border:1px solid rgba(192,80,80,0.3);border-radius:10px;font-size:11px;color:#c05050;font-weight:600;">${esc(r)}</span>`).join('')}
                <button onclick="showCannotReasonsModal()" style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:10px;background:transparent;cursor:pointer;color:var(--text-3);">変更</button>
               </div>`
            : `<div style="padding:4px 0;"><button onclick="showCannotReasonsModal()" style="font-size:12px;padding:4px 12px;border:1px dashed rgba(192,80,80,0.4);border-radius:10px;background:transparent;cursor:pointer;color:#c05050;">＋ 呼べなかった理由を選択（任意）</button></div>`;
    }
}

function hotelToggleTimeSlot(idx) {
    const slot = TIME_SLOTS[idx];
    const el = document.getElementById(`ts-${idx}`);
    if (!el) return;

    const isSame = hotelFormState.time_slot === slot;

    TIME_SLOTS.forEach((_, i) => {
        const btn = document.getElementById(`ts-${i}`);
        if (btn) {
            btn.style.background = 'var(--bg-3)';
            btn.style.borderColor = 'var(--border)';
            btn.style.color = 'var(--text-2)';
            btn.style.fontWeight = '400';
        }
    });

    if (isSame) {
        hotelFormState.time_slot = '';
    } else {
        hotelFormState.time_slot = slot;
        el.style.background = 'var(--accent-bg)';
        el.style.borderColor = 'var(--border-strong)';
        el.style.color = 'var(--accent-dim)';
        el.style.fontWeight = '600';
    }
}

function hotelToggleCondition(cond) {
    const el = document.getElementById(`cond-${cond}`);
    if (hotelFormState.conditions.has(cond)) {
        hotelFormState.conditions.delete(cond);
        el.classList.remove('checked');
    } else {
        hotelFormState.conditions.add(cond);
        el.classList.add('checked');
    }
}

async function voteReport(reportId, vote) {
    const fp = await generateFingerprint();

    try {
        const res = await fetch('/api/submit-vote.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ report_id: reportId, fingerprint: fp, vote }),
        });
        const result = await res.json();
        if (!res.ok) {
            showToast(result.error === 'already_voted' ? '既に評価済みです' : '評価に失敗しました');
            return;
        }
    } catch (e) {
        showToast('評価に失敗しました');
        return;
    }

    const countEl = document.getElementById(`${vote === 'helpful' ? 'helpful' : 'unhelpful'}-count-${reportId}`);
    if (countEl) countEl.textContent = parseInt(countEl.textContent || '0') + 1;

    const btnEl = document.getElementById(`vote-${vote}-${reportId}`);
    if (btnEl) {
        btnEl.style.background = vote === 'helpful' ? 'rgba(58,154,96,0.1)' : 'rgba(192,80,80,0.08)';
        btnEl.style.borderColor = vote === 'helpful' ? 'rgba(58,154,96,0.3)' : 'rgba(192,80,80,0.25)';
        btnEl.style.color = vote === 'helpful' ? '#3a9a60' : '#c05050';
    }

    if (vote === 'unhelpful') {
        const unhelpfulCount = parseInt(document.getElementById(`unhelpful-count-${reportId}`)?.textContent || '0');
        if (unhelpfulCount >= 3) {
            const card = btnEl?.closest('div[style*="border-radius:10px"]');
            if (card) {
                card.style.opacity = '0.5';
                card.innerHTML = `<div style="font-size:12px;color:var(--text-3);text-align:center;padding:8px;cursor:pointer;" onclick="this.parentElement.style.opacity='1';this.parentElement.innerHTML='';">
                    ⚠️ 低評価が多い投稿です（タップで表示）
                </div>` + card.innerHTML;
            }
        }
    }

    showToast(vote === 'helpful' ? '👍 参考になりました' : '👎 評価しました');
}

function hotelSubmitReport() {
    if (hotelFormState.can_call === null) {
        showToast('「呼べた」か「呼べなかった」を選択してください');
        return;
    }
    showPostConfirmModal();
}

function showPostConfirmModal() {
    const doBtn = document.getElementById('btn-do-submit');
    if (doBtn) { doBtn.disabled = false; doBtn.textContent = 'この内容で投稿する'; }

    const s = hotelFormState;
    const posterName = s.poster_name?.trim() || '匿名希望';
    const resultText = s.can_call ? '✅ 呼べた' : '❌ 呼べなかった';
    const resultColor = s.can_call ? '#3a9a60' : '#c05050';
    const reasons = s.can_call ? [...s.can_call_reasons] : [...s.cannot_call_reasons];
    const reasonLabel = s.can_call ? '呼べた理由' : '呼べなかった理由';
    const timeSlot = s.time_slot || '';

    function row(label, value) {
        if (!value) return '';
        return `<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(180,150,100,0.15);">
            <div style="font-size:12px;color:#8a7a6a;width:90px;flex-shrink:0;padding-top:1px;">${esc(label)}</div>
            <div style="font-size:13px;color:#1a1410;flex:1;line-height:1.6;">${esc(value)}</div>
        </div>`;
    }

    function tags(arr, color) {
        if (!arr || arr.length === 0) return null;
        return arr.map(r => `<span style="display:inline-block;padding:3px 9px;background:${color}1a;border:1px solid ${color}40;border-radius:10px;font-size:11px;color:${color};margin:2px 2px 2px 0;">${esc(r)}</span>`).join('');
    }

    const content = `
        ${row('投稿者名', posterName)}
        <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(180,150,100,0.15);">
            <div style="font-size:12px;color:#8a7a6a;width:90px;flex-shrink:0;padding-top:1px;">結果</div>
            <div style="font-size:13px;font-weight:700;color:${resultColor};">${resultText}</div>
        </div>
        ${reasons.length > 0 ? `<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(180,150,100,0.15);">
            <div style="font-size:12px;color:#8a7a6a;width:90px;flex-shrink:0;padding-top:4px;">${reasonLabel}</div>
            <div style="flex:1;">${tags(reasons, s.can_call ? '#3a9a60' : '#c05050')}</div>
        </div>` : ''}
        ${timeSlot ? `<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(180,150,100,0.15);">
            <div style="font-size:12px;color:#8a7a6a;width:90px;flex-shrink:0;padding-top:1px;">時間帯</div>
            <div style="font-size:13px;color:#1a1410;">${esc(timeSlot)}</div>
        </div>` : ''}
        ${row('部屋タイプ', s.room_type || null)}
        ${row('コメント', s.comment || null)}
    `;

    document.getElementById('post-confirm-content').innerHTML = content;
    document.getElementById('post-confirm-modal').style.display = 'flex';
}

function closePostConfirmModal() {
    document.getElementById('post-confirm-modal').style.display = 'none';
}

// ==========================================================================
// 強化フィンガープリント生成（SHA-256）
// ==========================================================================
async function generateFingerprint() {
    try {
        // Canvas fingerprint
        let canvasHash = '';
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 50;
            const ctx = canvas.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillStyle = '#f60';
            ctx.fillRect(0, 0, 100, 50);
            ctx.fillStyle = '#069';
            ctx.fillText('fingerprint', 2, 15);
            ctx.fillStyle = 'rgba(102,204,0,0.7)';
            ctx.fillText('fingerprint', 4, 17);
            canvasHash = canvas.toDataURL();
        } catch (_) {
            canvasHash = 'no-canvas';
        }

        const components = [
            navigator.userAgent || '',
            screen.width + 'x' + screen.height,
            screen.colorDepth || '',
            Intl.DateTimeFormat().resolvedOptions().timeZone || '',
            navigator.language || '',
            navigator.platform || '',
            canvasHash,
            (navigator.plugins ? navigator.plugins.length : 0).toString(),
            new Date().getTimezoneOffset().toString(),
        ].join('|||');

        const encoder = new TextEncoder();
        const data = encoder.encode(components);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        // Fallback: weak fingerprint if crypto.subtle unavailable
        // SHA-256 unavailable, using fallback
        return btoa([navigator.userAgent, screen.width+'x'+screen.height, Intl.DateTimeFormat().resolvedOptions().timeZone].join('|')).slice(0,32);
    }
}

async function doSubmitReport() {
    const doBtn = document.getElementById('btn-do-submit');
    if (doBtn) { doBtn.disabled = true; doBtn.textContent = '送信中...'; }

    if (!currentHotelId) {
        showToast('ホテルが選択されていません。ページを再読み込みしてください。');
        closePostConfirmModal();
        if (doBtn) { doBtn.disabled = false; doBtn.textContent = 'この内容で投稿する'; }
        return;
    }

    const posterType = 'user';

    const fingerprint = await generateFingerprint();
    const payload = {
        hotel_id: currentHotelId,
        can_call: hotelFormState.can_call,
        poster_type: posterType,
        can_call_reasons: hotelFormState.can_call ? [...hotelFormState.can_call_reasons] : [],
        cannot_call_reasons: !hotelFormState.can_call ? [...hotelFormState.cannot_call_reasons] : [],
        time_slot: hotelFormState.time_slot || null,
        comment: hotelFormState.comment ? hotelFormState.comment.slice(0, 500) : null,
        poster_name: hotelFormState.poster_name?.trim() || '無記名',
        room_type: hotelFormState.room_type || null,
        multi_person: hotelFormState.multi_person || false,
        multi_fee: hotelFormState.multi_person ? (hotelFormState.multi_fee || false) : false,
        guest_male: hotelFormState.multi_person ? hotelFormState.guest_male
            : (MODE === 'women' || MODE === 'women_same' ? 0 : 1),
        guest_female: hotelFormState.multi_person ? hotelFormState.guest_female
            : (MODE === 'women' || MODE === 'women_same' ? 1 : 0),
        gender_mode: typeof MODE !== 'undefined' ? MODE : 'men',
        fingerprint,
    };

    try {
        const response = await fetch('/api/submit-report.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (!response.ok) {
            closePostConfirmModal();
            if (doBtn) { doBtn.disabled = false; doBtn.textContent = 'この内容で投稿する'; }
            if (response.status === 429) {
                showToast(result.error || '投稿制限中です。しばらく時間をおいてから再度お試しください。', 5000);
            } else if (response.status === 409) {
                showToast('このホテルへは既に投稿済みです');
            } else {
                showToast('送信エラー: ' + (result.error || '予期しないエラーが発生しました'), 4000);
            }
            return;
        }

        closePostConfirmModal();
        if (doBtn) { doBtn.disabled = false; doBtn.textContent = 'この内容で投稿する'; }
        showSuccessModal('投稿ありがとうございます！', '口コミが投稿されました。');
        setTimeout(() => loadDetail(currentHotelId, false), 1500);
    } catch (e) {
        closePostConfirmModal();
        if (doBtn) { doBtn.disabled = false; doBtn.textContent = 'この内容で投稿する'; }
        showToast('通信エラーが発生しました。ネットワーク接続を確認してください。', 4000);
    }
}

// ==========================================================================
// ラブホ投稿
// ==========================================================================

function lhToggleGoodPoint(el, name) {
    const active = el.dataset.active === '1';
    if (active) {
        el.dataset.active = '0';
        el.style.borderColor = 'rgba(201,169,110,0.4)';
        el.style.background = '#fff';
        el.style.color = 'var(--text-2)';
        el.style.fontWeight = 'normal';
        lhFormState.good_points = lhFormState.good_points.filter(p => p !== name);
    } else {
        el.dataset.active = '1';
        el.style.borderColor = '#c9a96e';
        el.style.background = 'rgba(201,169,110,0.12)';
        el.style.color = '#c9a96e';
        el.style.fontWeight = '600';
        if (!lhFormState.good_points.includes(name)) lhFormState.good_points.push(name);
    }
}

function lhToggleFac(el, name) {
    const cb = el.querySelector('input');
    cb.checked = !cb.checked;
    el.style.borderColor = cb.checked ? '#c9a96e' : '';
    el.style.background = cb.checked ? 'rgba(201,169,110,0.1)' : '';
    el.style.color = cb.checked ? '#c9a96e' : '';
    if (cb.checked) { if (!lhFormState.facilities.includes(name)) lhFormState.facilities.push(name); }
    else { lhFormState.facilities = lhFormState.facilities.filter(f => f !== name); }
}

function submitLovehoReport() {
    if (!currentHotelId) {
        showToast('ホテルが選択されていません。ページを再読み込みしてください。');
        return;
    }
    const hasData = lhFormState.solo_entry || lhFormState.atmosphere || lhFormState.time_slot || lhFormState.comment || lhFormState.good_points.length;
    if (!hasData) { showToast('少なくとも1つ以上の項目を入力してください'); return; }
    showLhConfirmModal();
}

function showLhConfirmModal() {
    const doBtn = document.getElementById('btn-do-lh-submit');
    if (doBtn) { doBtn.disabled = false; doBtn.textContent = 'この内容で投稿する'; }

    const s = lhFormState;
    const posterName = s.poster_name?.trim() || '匿名';
    const soloMap = { yes: '一人で入れた', no: '一人では入れなかった', together: '一緒に入室', lobby: 'ロビー待機', unknown: '不明' };
    function row(label, val) {
        if (!val) return '';
        return `<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;"><span style="min-width:90px;color:var(--text-3);font-weight:600;">${label}</span><span style="color:var(--text);word-break:break-all;">${esc(String(val))}</span></div>`;
    }
    const content = `
        ${row('投稿者名', posterName)}
        ${row('一人入室', soloMap[s.solo_entry] || null)}
        ${row('雰囲気', s.atmosphere)}
        ${row('良かった点', s.good_points.length ? s.good_points.join('、') : null)}
        ${row('時間帯', s.time_slot)}
        ${s.multi_person ? row('複数人利用', `男性${s.guest_male || 0}名・女性${s.guest_female || 0}名${s.multi_fee ? '（追加料金あり）' : ''}`) : ''}
        ${row('コメント', s.comment || null)}
    `;
    document.getElementById('lh-confirm-content').innerHTML = content;
    document.getElementById('lh-confirm-modal').style.display = 'flex';
}

async function doSubmitLovehoReport() {
    const doBtn = document.getElementById('btn-do-lh-submit');
    if (doBtn) { doBtn.disabled = true; doBtn.textContent = '送信中...'; }
    try {
        const payload = {
            hotel_id: currentHotelId,
            solo_entry: lhFormState.solo_entry || null,
            atmosphere: lhFormState.atmosphere || null,
            good_points: lhFormState.good_points.length ? lhFormState.good_points : null,
            time_slot: lhFormState.time_slot || null,
            comment: lhFormState.comment ? lhFormState.comment.slice(0, 500) : null,
            poster_name: lhFormState.poster_name || null,
            gender_mode: typeof MODE !== 'undefined' ? MODE : null,
            multi_person: lhFormState.multi_person || false,
            multi_fee: lhFormState.multi_person ? (lhFormState.multi_fee || false) : false,
            guest_male: lhFormState.guest_male ? parseInt(lhFormState.guest_male) : null,
            guest_female: lhFormState.guest_female ? parseInt(lhFormState.guest_female) : null,
        };
        const res = await fetch('/api/submit-loveho-report.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const result = await res.json();
            document.getElementById('lh-confirm-modal').style.display = 'none';
            if (doBtn) { doBtn.disabled = false; doBtn.textContent = 'この内容で投稿する'; }
            if (res.status === 429) { showToast(result.error || '投稿制限中です。'); return; }
            throw new Error(result.error || 'Submit failed');
        }
        document.getElementById('lh-confirm-modal').style.display = 'none';
        showSuccessModal('投稿完了', '口コミを投稿しました。ありがとうございます！');
        cachedLovehoData = null;
        loadDetail(currentHotelId, true);
    } catch (e) {
        showToast('投稿エラーが発生しました');
    } finally {
        if (doBtn) { doBtn.disabled = false; doBtn.textContent = 'この内容で投稿する'; }
    }
}

function shopVerdict(r) {
    if (r.can_call === true) return '可';
    return '不可';
}

// ==========================================================================
// 投稿報告（フラグ）
// ==========================================================================
let flagTargetId = null;
let flagSelectedReason = null;
let flagTargetTable = 'reports';

Object.defineProperties(AppState.form.flag, {
    targetId:       { get() { return flagTargetId; },       set(v) { flagTargetId = v; } },
    selectedReason: { get() { return flagSelectedReason; }, set(v) { flagSelectedReason = v; } },
    targetTable:    { get() { return flagTargetTable; },    set(v) { flagTargetTable = v; } },
});

function showFlagModal(reportId, table) {
    if (!reportId || reportId === 'null' || reportId === 'undefined') {
        showToast('報告対象が取得できませんでした');
        return;
    }
    flagTargetId = reportId;
    flagTargetTable = table || 'reports';
    flagSelectedReason = null;
    document.getElementById('flag-comment-input').value = '';
    document.getElementById('flag-reason-err').style.display = 'none';
    document.querySelectorAll('#flag-reason-btns button').forEach(b => {
        b.style.background = 'var(--bg-3,#f0ebe0)';
        b.style.borderColor = 'rgba(180,150,100,0.25)';
        b.style.fontWeight = '400';
        b.style.color = '#1a1410';
    });
    document.getElementById('flag-step1').style.display = '';
    document.getElementById('flag-step2').style.display = 'none';
    document.getElementById('flag-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('flag-modal')?.focus(), 100);
}

function openFlagModal(reportId) { showFlagModal(reportId, 'loveho_reports'); }
function closeFlagModal() {
    document.getElementById('flag-modal').style.display = 'none';
    flagTargetId = null;
    flagSelectedReason = null;
    flagTargetTable = 'reports';
}

function selectFlagReason(reason, btn) {
    if (flagSelectedReason === reason) {
        flagSelectedReason = null;
        btn.style.background = 'var(--bg-3,#f0ebe0)';
        btn.style.borderColor = 'rgba(180,150,100,0.25)';
        btn.style.fontWeight = '400';
        btn.style.color = '#1a1410';
        return;
    }
    flagSelectedReason = reason;
    document.getElementById('flag-reason-err').style.display = 'none';
    document.querySelectorAll('#flag-reason-btns button').forEach(b => {
        b.style.background = 'var(--bg-3,#f0ebe0)';
        b.style.borderColor = 'rgba(180,150,100,0.25)';
        b.style.fontWeight = '400';
        b.style.color = '#1a1410';
    });
    btn.style.background = 'rgba(192,80,80,0.08)';
    btn.style.borderColor = 'rgba(192,80,80,0.4)';
    btn.style.fontWeight = '700';
    btn.style.color = '#c05050';
}

function showFlagStep1() {
    document.getElementById('flag-step1').style.display = '';
    document.getElementById('flag-step2').style.display = 'none';
}

function showFlagConfirm() {
    if (!flagSelectedReason) {
        document.getElementById('flag-reason-err').style.display = 'block';
        return;
    }
    const comment = document.getElementById('flag-comment-input').value.trim();
    document.getElementById('flag-confirm-reason').textContent = flagSelectedReason;
    const cWrap = document.getElementById('flag-confirm-comment-wrap');
    if (comment) {
        cWrap.style.display = '';
        document.getElementById('flag-confirm-comment').textContent = comment;
    } else {
        cWrap.style.display = 'none';
    }
    document.getElementById('flag-step1').style.display = 'none';
    document.getElementById('flag-step2').style.display = '';
}

async function submitFlag() {
    const targetId = flagTargetId;
    const selectedReason = flagSelectedReason;
    const tbl = flagTargetTable || 'reports';

    if (!targetId || targetId === 'null' || targetId === 'undefined') {
        showToast('報告対象が不明です。ページを再読み込みしてください。');
        return;
    }
    if (!selectedReason) return;

    const flag_comment = document.getElementById('flag-comment-input').value.trim() || null;
    const flagPayload = {
        flagged_at: new Date().toISOString(),
        flag_reason: selectedReason,
        flag_comment,
    };

    closeFlagModal();

    try {
        const res = await fetch('/api/submit-flag.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: targetId, table: tbl, flag_reason: selectedReason, flag_comment: flag_comment }),
        });
        if (!res.ok) {
            const result = await res.json();
            showToast('報告の送信に失敗しました: ' + (result.error || ''));
        } else {
            showToast('🚩 報告を受け付けました。ご協力ありがとうございます。');
        }
    } catch (e) {
        showToast('報告の送信に失敗しました');
    }
}

// ==========================================================================
// ホテル追加申請モーダル
// ==========================================================================
const HOTEL_TYPE_LABELS = {
    business: 'ビジネスホテル', city: 'シティホテル', resort: 'リゾートホテル',
    ryokan: '旅館', pension: 'ペンション', minshuku: '民宿',
    love_hotel: 'ラブホテル', rental_room: 'レンタルルーム', other: 'その他',
};

function openHotelRequestModal() {
    document.getElementById('hreq-name').value = '';
    document.getElementById('hreq-address').value = '';
    document.getElementById('hreq-tel').value = '';
    document.getElementById('hreq-type').value = 'business';
    document.getElementById('hreq-err').style.display = 'none';
    document.getElementById('hreq-step1').style.display = '';
    document.getElementById('hreq-step2').style.display = 'none';
    document.getElementById('hreq-done').style.display = 'none';
    document.getElementById('hotel-request-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('hreq-name')?.focus(), 100);
}

function closeHotelRequestModal() {
    document.getElementById('hotel-request-modal').style.display = 'none';
}

function hreqToConfirm() {
    const name = document.getElementById('hreq-name').value.trim();
    const address = document.getElementById('hreq-address').value.trim();
    const errEl = document.getElementById('hreq-err');
    if (!name || !address) {
        errEl.textContent = 'ホテル名と住所は必須です';
        errEl.style.display = 'block';
        return;
    }
    errEl.style.display = 'none';

    const tel = document.getElementById('hreq-tel').value.trim();
    const type = document.getElementById('hreq-type').value;
    const rows = [
        ['ホテル名', name],
        ['住所', address],
        ...(tel ? [['電話番号', tel]] : []),
        ['タイプ', HOTEL_TYPE_LABELS[type] || type],
    ];
    document.getElementById('hreq-confirm-body').innerHTML = rows.map(([k, v]) =>
        `<div><span style="font-size:11px;color:#8a7a6a;font-weight:700;">${esc(k)}</span><div style="font-size:13px;color:#1a1410;margin-top:2px;">${esc(v)}</div></div>`
    ).join('');

    document.getElementById('hreq-step1').style.display = 'none';
    document.getElementById('hreq-step2').style.display = '';
}

function hreqBack() {
    document.getElementById('hreq-step2').style.display = 'none';
    document.getElementById('hreq-step1').style.display = '';
}

async function submitHotelRequest() {
    const btn = document.getElementById('hreq-submit-btn');
    btn.disabled = true;
    btn.textContent = '送信中...';

    const name = document.getElementById('hreq-name').value.trim();
    const address = document.getElementById('hreq-address').value.trim();
    const tel = document.getElementById('hreq-tel').value.trim() || null;
    const type = document.getElementById('hreq-type').value;

    try {
        const res = await fetch('/api/submit-hotel-request.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hotel_name: name, address, tel, hotel_type: type }),
        });

        btn.disabled = false;
        btn.textContent = '送信する';

        if (!res.ok) {
            const result = await res.json();
            if (res.status === 429) { showToast(result.error || '申請数が上限に達しました。'); return; }
            showToast('送信に失敗しました: ' + (result.error || ''));
            return;
        }

        closeHotelRequestModal();
        showSuccessModal('送信ありがとうございます！', 'ホテル情報を受け付けました。確認後、掲載いたします。');
    } catch (e) {
        btn.disabled = false;
        btn.textContent = '送信する';
        showToast('通信エラーが発生しました');
    }
}

// ==========================================================================
// ホテル情報修正リクエストモーダル
// ==========================================================================
const CORR_CATEGORY_LABELS = {
    address: '📍 住所が違う',
    area: '🗺️ エリアが違う',
    tel: '📞 電話番号が違う',
    hotel_name: '🏨 ホテル名が違う',
    closed: '🚫 閉業している',
    other: '💬 その他',
};

let corrHotelId = null;
let corrHotelName = '';
let corrSelectedCategory = null;

function openCorrectionModal(hotelId, hotelName) {
    corrHotelId = hotelId;
    corrHotelName = hotelName || '';
    corrSelectedCategory = null;
    document.getElementById('corr-hotel-name').textContent = corrHotelName;
    document.getElementById('corr-detail').value = '';
    document.getElementById('corr-category-err').style.display = 'none';
    document.getElementById('corr-err').style.display = 'none';
    document.querySelectorAll('#corr-category-btns .corr-cat-btn').forEach(b => {
        b.style.background = 'var(--bg-3,#f0ebe0)';
        b.style.borderColor = 'rgba(180,150,100,0.25)';
        b.style.fontWeight = '400';
        b.style.color = '#1a1410';
    });
    document.getElementById('corr-step1').style.display = '';
    document.getElementById('corr-step2').style.display = 'none';
    document.getElementById('corr-done').style.display = 'none';
    document.getElementById('correction-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('correction-modal')?.focus(), 100);
}

function closeCorrectionModal() {
    document.getElementById('correction-modal').style.display = 'none';
    corrHotelId = null;
    corrHotelName = '';
    corrSelectedCategory = null;
}

function selectCorrectionCategory(cat, btn) {
    if (corrSelectedCategory === cat) {
        corrSelectedCategory = null;
        btn.style.background = 'var(--bg-3,#f0ebe0)';
        btn.style.borderColor = 'rgba(180,150,100,0.25)';
        btn.style.fontWeight = '400';
        btn.style.color = '#1a1410';
        return;
    }
    corrSelectedCategory = cat;
    document.getElementById('corr-category-err').style.display = 'none';
    document.querySelectorAll('#corr-category-btns .corr-cat-btn').forEach(b => {
        b.style.background = 'var(--bg-3,#f0ebe0)';
        b.style.borderColor = 'rgba(180,150,100,0.25)';
        b.style.fontWeight = '400';
        b.style.color = '#1a1410';
    });
    btn.style.background = 'rgba(192,80,80,0.08)';
    btn.style.borderColor = 'rgba(192,80,80,0.4)';
    btn.style.fontWeight = '700';
    btn.style.color = '#c05050';
}

function correctionToConfirm() {
    if (!corrSelectedCategory) {
        document.getElementById('corr-category-err').style.display = 'block';
        return;
    }
    const detail = document.getElementById('corr-detail').value.trim();
    if (!detail) {
        const errEl = document.getElementById('corr-err');
        errEl.textContent = '正しい情報・詳細を入力してください';
        errEl.style.display = 'block';
        return;
    }
    document.getElementById('corr-err').style.display = 'none';

    const rows = [
        ['ホテル', corrHotelName],
        ['カテゴリ', CORR_CATEGORY_LABELS[corrSelectedCategory] || corrSelectedCategory],
        ['詳細', detail],
    ];
    document.getElementById('corr-confirm-body').innerHTML = rows.map(([k, v]) =>
        `<div><span style="font-size:11px;color:#8a7a6a;font-weight:700;">${esc(k)}</span><div style="font-size:13px;color:#1a1410;margin-top:2px;">${esc(v)}</div></div>`
    ).join('');

    document.getElementById('corr-step1').style.display = 'none';
    document.getElementById('corr-step2').style.display = '';
}

function correctionBack() {
    document.getElementById('corr-step2').style.display = 'none';
    document.getElementById('corr-step1').style.display = '';
}

async function submitCorrection() {
    if (!confirm('この内容で情報修正リクエストを送信しますか？')) return;

    const btn = document.getElementById('corr-submit-btn');
    btn.disabled = true;
    btn.textContent = '送信中...';

    const detail = document.getElementById('corr-detail').value.trim();

    try {
        const res = await fetch('/api/submit-hotel-correction.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hotel_id: corrHotelId,
                category: corrSelectedCategory,
                detail: detail,
            }),
        });

        btn.disabled = false;
        btn.textContent = '送信する';

        if (!res.ok) {
            const result = await res.json();
            if (res.status === 429) { showToast(result.error || '送信数が上限に達しました。'); return; }
            showToast('送信に失敗しました: ' + (result.error || ''));
            return;
        }

        document.getElementById('corr-step2').style.display = 'none';
        document.getElementById('corr-done').style.display = '';
    } catch (e) {
        btn.disabled = false;
        btn.textContent = '送信する';
        showToast('通信エラーが発生しました');
    }
}

// ==========================================================================
// Escapeキーリスナー
// ==========================================================================
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modals = [
            { id: 'success-modal', close: closeSuccessModal },
            { id: 'can-reasons-modal', close: cancelCanReasons },
            { id: 'cannot-reasons-modal', close: cancelCannotReasons },
            { id: 'post-confirm-modal', close: closePostConfirmModal },
            { id: 'flag-modal', close: closeFlagModal },
            { id: 'hotel-request-modal', close: closeHotelRequestModal },
            { id: 'correction-modal', close: closeCorrectionModal },
        ];
        for (const { id, close } of modals) {
            const el = document.getElementById(id);
            if (el && el.style.display !== 'none' && el.style.display !== '') {
                close();
                break;
            }
        }
    }
});

// ==========================================================================
// 初期化
// ==========================================================================
window.onload = async () => {
    const savedLang = localStorage.getItem('yobuho_lang');
    if (savedLang && savedLang !== 'ja') {
        changeLang(savedLang);
    }
    await initShopMode();
    restoreFromUrl();
};
