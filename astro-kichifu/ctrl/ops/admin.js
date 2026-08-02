// ==========================================================================
// admin.js — 管理画面ロジック（3値ステータス対応）
// status: 'visited' | 'inquiry' | 'unavailable' | null
// ==========================================================================
(function(){
  'use strict';

  const API = '/ctrl/ops/api';
  let allHotels = [];
  let cities = [];
  let selectedIds = new Set();
  let editingHotel = null;
  let editingStatus = null;  // モーダル内の選択中ステータス
  let currentUser = null;     // {id, email, role, display_name}
  // 店長(manager)専用の表示モード: 'entry'(入口) | 'manager'(店長業務) | 'therapist'(マイページ)。他ロールは未使用
  let managerMode = null;
  let allUsers = [];
  let _tlBookingMap = {};      // タイムライン: id → booking（送迎コピー用）
  let _tlPrevScroll = null;    // タイムライン: 操作後に復元する横スクロール位置
  let _extUnit = { min: 30, price: 0, name: '延長30分' };  // 延長1回あたり（コースマスタの「延長」から取得）
  let createRole = 'staff';
  let resetPwUserId = null;

  // ===== Booking modal instance (primary / secondary) =====
  // クイック電話①→primary、②→secondary で2件同時操作可能
  let activeBmSuffix = '';  // '' (primary) or '-2' (secondary)
  function bel(id) { return document.getElementById(id + activeBmSuffix); }
  // 支払方法（現金/カード）— アクティブなモーダル内のボタンを切替
  function setBmPayment(pm) {
    pm = pm || '';
    const modal = document.getElementById('bookingModal' + activeBmSuffix);
    if (!modal) return;
    modal.querySelectorAll('[data-pay-btn]').forEach(b => b.classList.toggle('active', b.dataset.pay === pm));
    const hidden = modal.querySelector('[data-pay-hidden]');
    if (hidden) hidden.value = pm;
  }
  // fn が async の場合、最初の await で fn() が pending Promise を返して制御を戻すため、
  // 同期の try/finally だと fn の非同期処理が終わる前に activeBmSuffix が戻ってしまう
  // （fetch後の続きの処理が誤って別モーダルの suffix で動く）。async化 + await で fn の完了まで保持する。
  async function withBmSuffix(suffix, fn) {
    const prev = activeBmSuffix;
    activeBmSuffix = suffix;
    try { return await fn(); } finally { activeBmSuffix = prev; }
  }

  // 2件目モーダルを必要な時に複製
  let secondaryModalCreated = false;
  // 新規予約ボタン用: primary 使用中（show or minimized）ならセカンダリで開く
  function openBookingForAdd(prefill) {
    const primary = document.getElementById('bookingModal');
    const primaryInUse = primary?.classList.contains('show'); // minimized も show を保持
    if (primaryInUse) {
      ensureSecondaryModal();
      const secondary = document.getElementById('bookingModal-2');
      // セカンダリも使用中なら、minimized の方を復元
      if (secondary.classList.contains('show')) {
        // 両方使用中: primary を復元してそこに上書き入力
        if (primary.classList.contains('minimized')) {
          primary.classList.remove('minimized');
          document.querySelector('#minDock [data-restore="bookingModal"]')?.remove();
        }
        return withBmSuffix('', () => openBookingModal(null, prefill));
      }
      return withBmSuffix('-2', () => openBookingModal(null, prefill));
    }
    return openBookingModal(null, prefill);
  }

  function ensureSecondaryModal() {
    if (secondaryModalCreated) return document.getElementById('bookingModal-2');
    const primary = document.getElementById('bookingModal');
    if (!primary) return null;
    const clone = primary.cloneNode(true);
    clone.id = 'bookingModal-2';
    const renameMap = {};
    clone.querySelectorAll('[id]').forEach(el => {
      const old = el.id;
      el.id = old + '-2';
      renameMap[old] = el.id;
    });
    clone.querySelectorAll('label[for]').forEach(l => {
      const f = l.getAttribute('for');
      if (renameMap[f]) l.setAttribute('for', renameMap[f]);
    });
    clone.querySelectorAll('[data-close]').forEach(el => {
      el.setAttribute('data-close', 'bookingModal-2');
    });
    clone.querySelectorAll('input[name]').forEach(el => {
      el.name = el.name + '-2';
    });
    document.body.appendChild(clone);
    secondaryModalCreated = true;
    bindSecondaryModalEvents();
    return clone;
  }

  function bindSecondaryModalEvents() {
    // select 構築
    const sh = document.getElementById('bmStartHour-2');
    if (sh) {
      let optHtml = '';
      for (let h = 0; h < 24; h++) optHtml += `<option value="${h}">${('0'+h).slice(-2)}</option>`;
      sh.innerHTML = optHtml;
    }
    const sm = document.getElementById('bmStartMin-2');
    if (sm) {
      let minHtml = '';
      for (let m = 0; m < 60; m++) minHtml += `<option value="${m}">${('0'+m).slice(-2)}</option>`;
      sm.innerHTML = minHtml;
    }
    const modal2 = document.getElementById('bookingModal-2');
    if (!modal2) return;
    modal2.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) { closeModal('bookingModal-2'); return; }
      if (e.target.id === 'bmSave-2') { withBmSuffix('-2', saveBooking); return; }
      if (e.target.id === 'bmDelete-2') { withBmSuffix('-2', deleteBooking); return; }
      if (e.target.id === 'bmCopyText-2') { withBmSuffix('-2', copyBookingFormAsText); return; }
      if (e.target.id === 'bmCopyCustomerText-2') { withBmSuffix('-2', copyCustomerBookingText); return; }
      if (e.target.closest('#bmHistoryToggle-2')) { withBmSuffix('-2', toggleHistoryPanel); return; }
    });
    modal2.addEventListener('change', e => {
      if (e.target.id === 'bmStartHour-2' || e.target.id === 'bmStartMin-2') {
        withBmSuffix('-2', () => { updateEndTime(); autoToggleLateNight(); });
      } else if (e.target.id === 'bmLateNight-2' || e.target.id === 'bmCampaign-2' || e.target.id === 'bmStampReward-2' || e.target.id === 'bmNomination-2' || e.target.id === 'bmTransport-2') {
        withBmSuffix('-2', updateBookingTotal);
      } else if (e.target.name === 'bmMedia-2') {
        withBmSuffix('-2', updateEndTime);
      } else if (e.target.id === 'bmExtCount-2') {
        withBmSuffix('-2', () => { updateEndTime(); updateBookingTotal(); });
      } else if (e.target.id === 'bmCourse-2') {
        withBmSuffix('-2', () => {
          updateEndTime();
          const opt = e.target.selectedOptions[0];
          const price = opt && opt.dataset.price;
          if (price) { setMoney('bmPrice', price); autoToggleLateNight(); updateBookingTotal(); }
        });
      } else if (e.target.name === 'bmCityRegion-2') {
        withBmSuffix('-2', () => { populateCitySelect(e.target.value); populateHotelSelect(bel('bmCity').value); });
      } else if (e.target.id === 'bmCity-2') {
        withBmSuffix('-2', () => populateHotelSelect(e.target.value));
      } else if (e.target.id === 'bmHotelId-2') {
        withBmSuffix('-2', () => applyHotelTransportFee(e.target.value));
      } else if (e.target.id === 'bmStatus-2') {
        document.getElementById('bmCancelWrap-2').style.display = e.target.value === 'cancelled' ? 'block' : 'none';
        withBmSuffix('-2', updateBookingTotal);
      } else if (e.target.id === 'bmAdminId-2') {
        withBmSuffix('-2', () => { autoStatusOnAssign(); renderCastAlert(); });
      } else if (e.target.id === 'bmCancelType-2' || e.target.id === 'bmCancelFee-2') {
        withBmSuffix('-2', updateBookingTotal);
      } else if (e.target.name === 'bmLocType-2') {
        withBmSuffix('-2', () => switchLocSection(e.target.value));
      } else if (e.target.id === 'bmBreakMode-2') {
        withBmSuffix('-2', () => setBreakMode(e.target.checked));
      } else if (e.target.id === 'bmBreakDur-2') {
        withBmSuffix('-2', () => {
          const isCustom = e.target.value === 'custom';
          const wrap = document.getElementById('bmBreakCustomMinWrap-2');
          if (wrap) wrap.style.display = isCustom ? 'block' : 'none';
          updateEndTime();
        });
      }
      withBmSuffix('-2', () => { try { updateFooterStatus(); } catch (err) {} });
    });
    modal2.addEventListener('input', e => {
      if (e.target.id === 'bmCustomMin-2') withBmSuffix('-2', updateEndTime);
      else if (e.target.id === 'bmBreakCustomMin-2') withBmSuffix('-2', updateEndTime);
      else if (e.target.id === 'bmPrice-2' || e.target.id === 'bmDepositOverride-2') withBmSuffix('-2', updateBookingTotal);
      withBmSuffix('-2', () => { try { updateFooterStatus(); } catch (err) {} });
    });
    modal2.addEventListener('blur', e => {
      if (e.target.id === 'bmCustomerPhone-2') withBmSuffix('-2', lookupCustomerByPhone);
    }, true);
    withBmSuffix('-2', () => {
      populateCourseSelect();
      populateCitySelect();
      populateHotelSelect('');
    });
    setupDraggableSingle(modal2.querySelector('.modal.draggable'));
  }

  function setupDraggableSingle(modal) {
    if (!modal) return;
    const header = modal.querySelector('.modal-header');
    if (!header) return;
    let dragging = false, startX, startY, startLeft, startTop;
    const onDown = e => {
      if (e.target.closest('button, input, select, textarea, a')) return;
      const t = e.touches ? e.touches[0] : e;
      dragging = true;
      modal.classList.add('dragging');
      const rect = modal.getBoundingClientRect();
      startLeft = rect.left; startTop = rect.top;
      startX = t.clientX; startY = t.clientY;
      modal.style.position = 'fixed'; modal.style.margin = '0'; modal.style.transform = 'none';
      modal.style.left = startLeft + 'px'; modal.style.top = startTop + 'px';
      e.preventDefault();
    };
    const onMove = e => {
      if (!dragging) return;
      const t = e.touches ? e.touches[0] : e;
      const nx = startLeft + (t.clientX - startX);
      const ny = startTop + (t.clientY - startY);
      modal.style.left = Math.max(-modal.offsetWidth + 100, Math.min(window.innerWidth - 100, nx)) + 'px';
      modal.style.top = Math.max(0, Math.min(window.innerHeight - 80, ny)) + 'px';
    };
    const onUp = () => { dragging = false; modal.classList.remove('dragging'); };
    header.addEventListener('mousedown', onDown);
    header.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
  }

  // ===== Location helpers (ホテル / 自宅 / その他) =====
  const HOME_PREFIX = '【自宅】';
  const OTHER_PREFIX = '【その他】';

  function detectLocType(hotelId, snapshot) {
    if (hotelId) return 'hotel';
    if (!snapshot) return 'hotel';
    if (snapshot.startsWith(HOME_PREFIX)) return 'home';
    if (snapshot.startsWith(OTHER_PREFIX)) return 'other';
    return 'hotel';  // 自由入力のホテル名
  }
  function switchLocSection(type) {
    document.querySelectorAll('.loc-section').forEach(el => {
      el.style.display = el.dataset.loc === type ? 'block' : 'none';
    });
    document.querySelectorAll('input[name="bmLocType"]').forEach(r => r.checked = r.value === type);
  }
  // メインエリア（多摩）。立川駅からの直線距離が近い順。
  //   距離は各市区町村の役所の位置で概算（カッコ内はおおよその km）。
  //   ※ ホテル件数の多い順ではない。八王子は件数が多いが距離では 12 番目。
  const CITY_PROXIMITY = [
    '立川市',              // 0
    '国立市',              // 2.9
    '日野市',              // 3.4
    '国分寺市',            // 4.6
    '東大和市',            // 5.4
    '昭島市',              // 5.5
    '武蔵村山市',          // 6.2
    '小平市',              // 6.4
    '府中市',              // 6.5
    '多摩市',              // 7.4
    '東村山市',            // 8.0
    '小金井市',            // 8.1
    '福生市',              // 9.2
    '八王子市',            // 9.4
    '西多摩郡瑞穂町',      // 9.9
    '稲城市',              // 11.0
    'あきる野市',          // 11.2
    '西東京市',            // 11.5
    '羽村市',              // 12.0
    '調布市',              // 12.4
    '東久留米市',          // 12.7
    '三鷹市',              // 13.3
    '武蔵野市',            // 13.9
    '青梅市',              // 15.2
    '町田市',              // 17.0
    '西多摩郡檜原村',      // 24.2
    '西多摩郡奥多摩町',    // 29.3
  ];
  function cityProximityRank(c) {
    const i = CITY_PROXIMITY.indexOf(c);
    return i === -1 ? CITY_PROXIMITY.length : i;   // リスト外は末尾（同順は五十音）
  }
  function sortCitiesByProximity(list) {
    return [...list].sort((a, b) => {
      const ra = cityProximityRank(a), rb = cityProximityRank(b);
      return ra !== rb ? ra - rb : a.localeCompare(b, 'ja');
    });
  }
  // メイン以外のエリア。いずれも立川駅からの距離が近い順（区役所・市役所の位置で概算）。
  //   ホテルの登録が無い市区町村も選べるようにするため、ホテル一覧からではなく固定リストで持つ
  //   （選んだ市区町村にホテルが無ければ、ホテル名は手入力すればよい）。
  const CITY_REGIONS = {
    tokyo23: [
      '杉並区', '練馬区', '世田谷区', '中野区', '渋谷区', '新宿区', '目黒区', '板橋区',
      '豊島区', '北区', '品川区', '文京区', '千代田区', '港区', '大田区', '中央区',
      '台東区', '荒川区', '墨田区', '足立区', '江東区', '葛飾区', '江戸川区',
    ],
    saitama: [
      '所沢市', '入間市', '狭山市', '新座市', '志木市', '朝霞市', '和光市', '飯能市',
      '入間郡三芳町', 'ふじみ野市', '富士見市', '日高市', '川越市', '鶴ヶ島市', '坂戸市',
      '戸田市', '蕨市', '川口市', 'さいたま市', '上尾市',
    ],
    kanagawa: [
      '相模原市', '座間市', '大和市', '厚木市', '海老名市', '綾瀬市', '川崎市',
      '伊勢原市', '横浜市', '秦野市', '藤沢市', '茅ヶ崎市', '平塚市', '小田原市',
    ],
  };
  // 市区町村 → 都道府県。市区町村を選べば都道府県は決まるので、画面では都道府県を出さない。
  // （旧データは住所に県名が無い所沢市・狭山市などが「東京都」で取り込まれていた）
  const CITY_PREF = (() => {
    const m = {};
    CITY_PROXIMITY.forEach(c => { m[c] = '東京都'; });
    (CITY_REGIONS.tokyo23 || []).forEach(c => { m[c] = '東京都'; });
    (CITY_REGIONS.saitama || []).forEach(c => { m[c] = '埼玉県'; });
    (CITY_REGIONS.kanagawa || []).forEach(c => { m[c] = '神奈川県'; });
    return m;
  })();
  function prefOfCity(city) { return CITY_PREF[String(city || '').trim()] || ''; }
  /** 市区町村セレクトの中身（都道府県ごとにグループ分け）。現在値が一覧に無ければ末尾に足す */
  function cityOptionsHtml(current) {
    const cur = String(current || '').trim();
    const groups = [
      ['多摩・立川周辺', CITY_PROXIMITY],
      ['東京23区', CITY_REGIONS.tokyo23 || []],
      ['埼玉県', CITY_REGIONS.saitama || []],
      ['神奈川県', CITY_REGIONS.kanagawa || []],
    ];
    let html = '<option value="">— 選択 —</option>';
    let found = false;
    groups.forEach(([label, list]) => {
      html += `<optgroup label="${escapeAttr(label)}">`;
      list.forEach(c => {
        if (c === cur) found = true;
        html += `<option value="${escapeAttr(c)}"${c === cur ? ' selected' : ''}>${escapeHtml(c)}</option>`;
      });
      html += '</optgroup>';
    });
    if (cur && !found) html += `<optgroup label="その他"><option value="${escapeAttr(cur)}" selected>${escapeHtml(cur)}</option></optgroup>`;
    return html;
  }

  function currentCityRegion() {
    const r = document.querySelector(`input[name="bmCityRegion${activeBmSuffix}"]:checked`);
    return r ? r.value : 'main';
  }
  // 市区町村select。メイン=ホテル一覧から動的生成（立川市→近い順）、他=固定リスト
  function populateCitySelect(region) {
    const sel = bel('bmCity');
    if (!sel) return;
    const keep = sel.value;
    const reg = region || currentCityRegion();
    const cities = (reg === 'main')
      ? sortCitiesByProximity([...new Set(hotelsForSelect.map(h => h.city).filter(Boolean))])
      : (CITY_REGIONS[reg] || []);
    sel.innerHTML = '<option value="">— すべて —</option>' +
      cities.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
    if (keep && cities.includes(keep)) sel.value = keep;   // 同じ市区町村が新しいエリアにもあれば維持
  }
  // 市区町村の値から、それが属するエリアのタブを選び直す（既存予約を開いた時など）
  function syncCityRegionTab(city) {
    if (!city) return;
    let reg = 'main';
    for (const [k, list] of Object.entries(CITY_REGIONS)) if (list.includes(city)) { reg = k; break; }
    const r = document.querySelector(`input[name="bmCityRegion${activeBmSuffix}"][value="${reg}"]`);
    if (r && !r.checked) { r.checked = true; populateCitySelect(reg); }
  }
  // ホテルを選んだら、そのホテルに登録してある交通費を初期値として入れる。
  // 実績では同じホテルでも回により ¥0〜¥2,200 と揺れるので、あくまで初期値（手で変えられる）。
  function applyHotelTransportFee(hotelId) {
    const sel = bel('bmTransport');
    if (!sel || !hotelId) return;
    const h = hotelsForSelect.find(x => Number(x.id) === Number(hotelId));
    const raw = h ? h.transport_fee : null;
    if (raw === null || raw === undefined || raw === '') return;   // 未登録のホテルは触らない
    const fee = String(parseInt(raw, 10) || 0);
    if (![...sel.options].some(o => o.value === fee)) {
      const o = document.createElement('option');
      o.value = fee;
      o.textContent = `¥${Number(fee).toLocaleString()}`;
      sel.appendChild(o);
    }
    sel.value = fee;
    try { updateBookingTotal(); } catch (e) {}
  }

  // ホテルselectを市区町村で絞り込み
  function populateHotelSelect(filterCity) {
    const sel = bel('bmHotelId');
    const selectedValue = sel.value;
    const list = filterCity
      ? hotelsForSelect.filter(h => h.city === filterCity)
      : hotelsForSelect;
    sel.innerHTML = '<option value="">— 選択しない（下に手入力） —</option>' +
      list.map(h => `<option value="${h.id}">${escapeHtml(h.name)}${h.nearest_station ? ' (' + escapeHtml(h.nearest_station) + '駅)' : ''}</option>`).join('');
    if (selectedValue && list.some(h => Number(h.id) === Number(selectedValue))) sel.value = selectedValue;
  }

  // ===== 金額入力のカンマ表示（OPS共通ルール 2026-08-03）=====
  // 金額欄は data-money を付けた text 入力。type=number はカンマを表示できないため使わない。
  // 表示は「2,200」、読み取りは moneyVal() で数字だけにして使う。
  //   ※ 値を入れる時は setMoney() を通すこと。直接 .value に入れるとカンマが付かない
  function moneyDigits(v) { return String(v ?? '').replace(/[^\d]/g, ''); }
  /** 入力欄の金額を数値で取る（未入力は null） */
  function moneyVal(el) {
    if (typeof el === 'string') el = bel(el) || document.getElementById(el);
    if (!el) return null;
    const d = moneyDigits(el.value);
    return d === '' ? null : parseInt(d, 10);
  }
  /** 入力欄に金額を入れる（カンマ付きで表示） */
  function setMoney(el, v) {
    if (typeof el === 'string') el = bel(el) || document.getElementById(el);
    if (!el) return;
    const d = moneyDigits(v);
    el.value = d === '' ? '' : Number(d).toLocaleString();
  }
  /** 入力中の整形。カーソルは「右から数えた位置」で保つ（カンマが増減してもズレない） */
  function formatMoneyInput(el) {
    const before = el.value;
    const fromRight = before.length - (el.selectionStart ?? before.length);
    const d = moneyDigits(before);
    el.value = d === '' ? '' : Number(d).toLocaleString();
    if (document.activeElement === el) {
      const pos = Math.max(0, el.value.length - fromRight);
      try { el.setSelectionRange(pos, pos); } catch (e) {}
    }
  }
  // 動的に増える欄にも効くよう document 委譲で一度だけ張る
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el && el.matches && el.matches('input[data-money]')) formatMoneyInput(el);
  });

  // --- API helpers ---
  async function api(path, opts = {}) {
    const res = await fetch(API + path, { credentials: 'include', ...opts });
    if (res.status === 401) {
      location.href = location.pathname.replace(/\/dashboard\/?$/, '/');
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'request failed');
    }
    return res.json();
  }
  async function apiPost(path, body) {
    return api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // --- Toast ---
  let toastTimer;
  function toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  // --- Stats ---
  async function loadStats() {
    try {
      const s = await api('/admin-api.php?action=stats');
      document.getElementById('statTotal').textContent = s.total;
      document.getElementById('statVisited').textContent = s.visited;
      document.getElementById('statInquiry').textContent = s.inquiry;
      document.getElementById('statUnavailable').textContent = s.unavailable;
      document.getElementById('statUnset').textContent = s.unset;
    } catch (e) { /* silent */ }
  }

  // --- Cities ---
  async function loadCities() {
    try {
      const data = await api('/admin-api.php?action=cities');
      cities = data.cities || [];
      const sel = document.getElementById('fCity');
      sel.innerHTML = '<option value="">全市区町村</option>' +
        cities.map(c => {
          const pub = Number(c.visited) + Number(c.inquiry);
          return `<option value="${escapeAttr(c.city)}">${escapeHtml(c.city)} (公開${pub}/${c.total})</option>`;
        }).join('');
    } catch (e) { /* silent */ }
  }

  // --- Hotels ---
  async function loadHotels() {
    const list = document.getElementById('hotelList');
    list.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';

    const params = new URLSearchParams();
    const city = document.getElementById('fCity').value;
    const status = document.getElementById('fStatus').value;
    const kw = document.getElementById('fKeyword').value.trim();
    if (city) params.set('city', city);
    if (status) params.set('status', status);
    if (kw) params.set('keyword', kw);

    try {
      const data = await api('/admin-api.php?action=hotels&' + params.toString());
      allHotels = data.hotels || [];
      renderHotels();
    } catch (e) {
      list.innerHTML = '<div class="empty">読み込みに失敗しました: ' + escapeHtml(e.message) + '</div>';
    }
  }

  function statusClass(s) {
    return s ? 'status-' + s : '';
  }

  function renderHotels() {
    const list = document.getElementById('hotelList');
    document.getElementById('resultCount').textContent = allHotels.length;
    document.getElementById('filterNote').textContent = selectedIds.size > 0 ? `（${selectedIds.size}件選択中）` : '';

    if (allHotels.length === 0) {
      list.innerHTML = '<div class="empty">条件に該当するホテルがありません</div>';
      updateBulkBar();
      return;
    }

    list.innerHTML = allHotels.map(h => {
      const status = h.status || '';
      const checked = selectedIds.has(h.id);
      return `
        <div class="hotel-row ${statusClass(status)} ${checked ? 'selected' : ''}" data-id="${h.id}">
          <div class="row-check">
            <input type="checkbox" class="rowSelect" data-id="${h.id}" ${checked ? 'checked' : ''}>
          </div>
          <div class="row-status">
            <button class="sbtn v-visited ${status==='visited' ? 'active' : ''}" data-set-status data-id="${h.id}" data-status="visited" title="ご案内実績あり">実績</button>
            <button class="sbtn v-inquiry ${status==='inquiry' ? 'active' : ''}" data-set-status data-id="${h.id}" data-status="inquiry" title="ホテルに問い合わせいたします">問合</button>
            <button class="sbtn v-unavailable ${status==='unavailable' ? 'active' : ''}" data-set-status data-id="${h.id}" data-status="unavailable" title="ご案内不可">不可</button>
            <button class="sbtn v-unset ${!status ? 'active' : ''}" data-set-status data-id="${h.id}" data-status="" title="未設定">—</button>
          </div>
          <div class="row-info">
            <div class="row-name">${escapeHtml(h.name)}</div>
            ${h.address ? `<div class="row-addr">${escapeHtml((h.prefecture || '') + h.address)}${mapLinksHtml(h.prefecture, h.address, { small: true })}</div>` : ''}
            <div class="row-meta">
              ${h.city ? `<span><b>市区:</b> ${escapeHtml(h.city)}</span>` : ''}
              ${h.nearest_station ? `<span><b>駅:</b> ${escapeHtml(h.nearest_station)}</span>` : ''}
              ${h.transport_fee !== null && h.transport_fee !== undefined && h.transport_fee !== '' ? `<span><b>交通費:</b> ¥${Number(h.transport_fee).toLocaleString()}</span>` : ''}
              ${h.hotel_type ? `<span class="badge-mini">${hotelTypeLabel(h.hotel_type)}</span>` : ''}
              ${h.entry_method ? `<span class="badge-mini">${entryMethodLabel(h.entry_method)}</span>` : ''}
              ${h.internal_memo ? `<span title="${escapeAttr(h.internal_memo)}">📝</span>` : ''}
            </div>
          </div>
          <div class="row-actions">
            <button class="btn-edit" data-action="edit" data-id="${h.id}">編集</button>
            <button class="btn-del" data-action="delete" data-id="${h.id}" title="リストから外す">削除</button>
          </div>
        </div>`;
    }).join('');
    updateBulkBar();
  }

  function updateBulkBar() {
    const bar = document.getElementById('bulkBar');
    const cnt = selectedIds.size;
    if (cnt > 0) {
      bar.classList.add('show');
      document.getElementById('bulkCount').textContent = cnt;
    } else {
      bar.classList.remove('show');
    }
  }

  // --- Set status (single) ---
  async function setStatus(id, status) {
    const newStatus = status === '' ? null : status;
    try {
      await apiPost('/admin-api.php?action=update-info', { hotel_id: id, status: newStatus });
      const h = allHotels.find(x => x.id === id);
      if (h) h.status = newStatus;
      // 該当行のボタンとクラスを更新
      const row = document.querySelector(`.hotel-row[data-id="${id}"]`);
      if (row) {
        row.className = 'hotel-row ' + statusClass(newStatus || '') + (selectedIds.has(id) ? ' selected' : '');
        row.querySelectorAll('[data-set-status]').forEach(b => {
          b.classList.toggle('active', (b.dataset.status || '') === (newStatus || ''));
        });
      }
      const label = newStatus ? statusLabel(newStatus) : '未設定';
      toast(`✓ ${label}に変更しました`, 'ok');
      loadStats();
    } catch (e) {
      toast('保存失敗: ' + e.message, 'err');
    }
  }

  // --- 削除（リストから外す） ---
  // 使わないホテル（YLKA由来の民宿など）を消すため。
  // 予約で使われているものはサーバー側で【非表示】に切り替わる（履歴の hotel_id を壊さない）。
  async function deleteHotels(ids, label) {
    if (!ids.length) return;
    if (!confirm(`${label}をリストから削除します。よろしいですか？\n（予約で使用中のホテルは削除せず非表示にします）`)) return;
    try {
      const r = await apiPost('/admin-api.php?action=hotel-delete', { hotel_ids: ids });
      const msg = [r.deleted ? `${r.deleted}件を削除` : '', r.hidden ? `${r.hidden}件は使用中のため非表示` : '']
        .filter(Boolean).join(' / ');
      toast('✓ ' + (msg || '対象なし'), 'ok');
      ids.forEach(id => selectedIds.delete(id));
      hotelsForSelect = [];   // 予約モーダルのホテル候補も次回読み直す
      await Promise.all([loadHotels(), loadStats()]);
    } catch (e) {
      toast('削除に失敗: ' + e.message, 'err');
    }
  }

  // --- Bulk ---
  async function bulkSetStatus(status) {
    if (selectedIds.size === 0) return;
    const newStatus = status === 'unset' ? null : status;
    const ids = Array.from(selectedIds);
    try {
      await apiPost('/admin-api.php?action=bulk-status', { hotel_ids: ids, status: newStatus });
      const label = newStatus ? statusLabel(newStatus) : '未設定';
      toast(`✓ ${ids.length}件を${label}に更新`, 'ok');
      selectedIds.clear();
      await Promise.all([loadHotels(), loadStats()]);
    } catch (e) {
      toast('一括更新失敗: ' + e.message, 'err');
    }
  }

  // 住所から都道府県・市区町村を切り出す（住所欄は「市区町村から番地まで」を持つ）
  const OPS_PREFS = ['東京都', '埼玉県', '神奈川県', '千葉県', '山梨県'];
  function splitAddress(addr) {
    let s = String(addr || '').trim();
    let pref = '';
    for (const p of OPS_PREFS) if (s.startsWith(p)) { pref = p; s = s.slice(p.length).trim(); break; }
    return { pref, rest: s };
  }
  /** 「市区町村」だけを取り出す。郡→市→区→町村の順（羽村市→羽村 のような取り違えを防ぐ） */
  function pickCityFromAddress(addr) {
    const { rest } = splitAddress(addr);
    let m = rest.match(/^(.+?郡.+?[町村])/);   if (m) return m[1];
    m = rest.match(/^(.+?市)/);                if (m) return m[1];
    m = rest.match(/^(.+?区)/);                if (m) return m[1];
    m = rest.match(/^(.+?[町村])/);            if (m) return m[1];
    return '';
  }
  // 住所を打つ/貼るたびに、都道府県は左のセレクトへ、市区町村は上の欄へ自動で振り分ける。
  // 市区町村を手で直した後は上書きしない（住所から判定できないホテルがあるため）。
  let emCityTouched = false;
  // 住所から地図アプリへのリンク。ドライバーへの案内・場所確認用。
  // 検索語は「都道府県＋住所」。ホテル名は「シティ」等が多く別の場所を指しかねないので入れない。
  // 管理画面なので別タブで開く（編集中の内容を失わないため）。
  function mapLinksHtml(prefecture, address, opts) {
    const q = ((prefecture || '') + (address || '')).trim();
    if (!q) return '';
    const e = encodeURIComponent(q);
    const cls = (opts && opts.small) ? ' map-link-sm' : '';
    const a = (href, label) =>
      `<a class="map-link${cls}" href="${href}" target="_blank" rel="noopener" title="${escapeAttr(q)}">${label}</a>`;
    return '<span class="map-links">'
      + a(`https://www.google.com/maps/search/?api=1&query=${e}`, 'Google')
      + a(`https://map.yahoo.co.jp/search?q=${e}`, 'Yahoo')
      + a(`https://maps.apple.com/?q=${e}`, 'Apple')
      + '</span>';
  }

  /** 市区町村の固定表示を更新する */
  function renderAddrCity() {
    const el = document.getElementById('emAddrCity');
    const c = (document.getElementById('emCity')?.value || '').trim();
    if (!el) return;
    el.textContent = c || '市区町村を選択';
    el.classList.toggle('is-empty', !c);
    renderEmMapLinks();
  }
  /** 編集中の住所に対する地図リンクを出し直す */
  function renderEmMapLinks() {
    const box = document.getElementById('emMapLinks');
    if (!box) return;
    const city = (document.getElementById('emCity')?.value || '').trim();
    const rest = (document.getElementById('emAddress')?.value || '').trim();
    const pref = prefOfCity(city) || (editingHotel && editingHotel.prefecture) || '';
    box.innerHTML = (city || rest) ? mapLinksHtml(pref, city + rest) : '';
  }
  // 住所欄には市区町村より後ろだけを入れる（市区町村はプルダウンが正）。
  // 都道府県・市区町村付きで貼り付けられた時だけ、こちらで剥がして振り分ける。
  function wireAddressAutofill() {
    const addr = document.getElementById('emAddress');
    const city = document.getElementById('emCity');
    if (!addr || addr.dataset.wired) return;
    addr.dataset.wired = '1';
    city?.addEventListener('change', () => { emCityTouched = true; renderAddrCity(); });
    addr.addEventListener('input', () => {
      const { pref, rest } = splitAddress(addr.value);
      if (!pref && !/^(.+?[市区町村])/.test(addr.value)) return;   // 町名だけの通常入力は触らない
      const c = pickCityFromAddress(addr.value);
      if (c && city && [...city.options].some(o => o.value === c)) {
        city.value = c;
        emCityTouched = true;
        addr.value = rest.slice(c.length);      // 住所欄からは市区町村を落とす
        renderAddrCity();
      } else if (pref) {
        addr.value = rest;                      // 都道府県だけは落とす
      }
      renderEmMapLinks();
    });
    addr.addEventListener('blur', renderEmMapLinks);
  }

  // --- Modal ---
  // hotel が null のときは「新規ホテル追加」として開く
  function openEdit(hotel) {
    const isNew = !hotel;
    if (isNew) hotel = { id: 0, name: '', city: '', address: '', tel: '' };
    document.getElementById('emName').value = hotel.name || '';
    const cityEl = document.getElementById('emCity');
    cityEl.innerHTML = cityOptionsHtml(hotel.city || '');
    cityEl.value = hotel.city || '';
    // 住所欄は「市区町村より後ろ」だけ。都道府県と市区町村は剥がして固定表示に回す
    {
      let rest = splitAddress(hotel.address || '').rest;
      const c = (hotel.city || '').trim();
      if (c && rest.startsWith(c)) rest = rest.slice(c.length);
      document.getElementById('emAddress').value = rest;
    }
    document.getElementById('emTel').value = hotel.tel || '';
    emCityTouched = !isNew && !!(hotel.city || '').trim();   // 既存の市区町村は勝手に書き換えない
    wireAddressAutofill();
    renderAddrCity();
    editingHotel = hotel;
    editingStatus = hotel.status || '';
    document.getElementById('emTitle').textContent = isNew ? 'ホテルを追加' : hotel.name;
    document.getElementById('emSub').textContent = isNew ? '' : `${hotel.prefecture || ''}${hotel.address || ''}`;
    document.querySelectorAll('#emStatus .sbtn').forEach(b => {
      b.classList.toggle('active', (b.dataset.status || '') === editingStatus);
    });
    document.getElementById('emEntry').value = hotel.entry_method || '';
    // チップ再描画（hidden value を読み取って active 状態を反映）
    populateEntryMethodSelect();
    document.getElementById('emRoomRec').value = hotel.room_type_recommended || '';
    // 出張費（セレクト）: ''=未設定、0=無料、数値=その金額
    {
      const feeSel = document.getElementById('emTransportFee');
      const tf = hotel.transport_fee;
      const v = (tf === null || tf === undefined || tf === '') ? '' : String(parseInt(tf, 10) || 0);
      // 550円刻みに無い金額（旧データ）は選択肢として一時的に足してから選ぶ
      if (v !== '' && ![...feeSel.options].some(o => o.value === v)) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = `¥${Number(v).toLocaleString()}（登録時の金額）`;
        feeSel.appendChild(o);
      }
      feeSel.value = v;
    }
    document.getElementById('emGuide').value = hotel.guide_note || '';
    document.getElementById('emMemo').value = hotel.internal_memo || '';
    document.getElementById('editModal').classList.add('show');
  }
  function closeEdit() {
    document.getElementById('editModal').classList.remove('show');
    editingHotel = null;
  }
  async function saveEdit() {
    if (!editingHotel) return;
    // 先にホテル本体（名前・市区町村・住所・TEL）を保存。新規ならここで id が採番される
    const name = document.getElementById('emName').value.trim();
    if (!name) { toast('ホテル名を入力してください', 'err'); return; }
    try {
      const cityVal = document.getElementById('emCity').value.trim();
      const prefVal = prefOfCity(cityVal) || editingHotel.prefecture || '東京都';
      // 保存する住所は「市区町村＋入力欄」。表示と保存で形が変わらないようここで結合する
      const addrVal = (cityVal + document.getElementById('emAddress').value.trim()).trim();
      const r = await apiPost('/admin-api.php?action=hotel-save', {
        id: editingHotel.id || 0,
        name,
        city: cityVal,
        prefecture: prefVal,
        address: addrVal,
        tel: document.getElementById('emTel').value.trim(),
      });
      if (!editingHotel.id) editingHotel.id = r.id;   // 新規は採番された id を使う
      Object.assign(editingHotel, {
        name,
        city: cityVal,
        prefecture: prefVal,
        address: addrVal,
        tel: document.getElementById('emTel').value.trim(),
      });
    } catch (e) { toast('ホテル情報の保存に失敗: ' + e.message, 'err'); return; }

    const payload = {
      hotel_id: editingHotel.id,
      status: editingStatus === '' ? null : editingStatus,
      entry_method: document.getElementById('emEntry').value,
      room_type_recommended: document.getElementById('emRoomRec').value.trim(),
      transport_fee: document.getElementById('emTransportFee').value === ''
        ? null
        : Number(document.getElementById('emTransportFee').value),
      guide_note: document.getElementById('emGuide').value.trim(),
      internal_memo: document.getElementById('emMemo').value.trim(),
    };
    try {
      await apiPost('/admin-api.php?action=update-info', payload);
      Object.assign(editingHotel, {
        status: payload.status,
        entry_method: payload.entry_method || null,
        room_type_recommended: payload.room_type_recommended || null,
        transport_fee: payload.transport_fee,
        guide_note: payload.guide_note || null,
        internal_memo: payload.internal_memo || null,
      });
      hotelsForSelect = [];   // 予約モーダルのホテル候補を次回読み直す
      closeEdit();
      toast('✓ 保存しました', 'ok');
      await Promise.all([loadHotels(), loadStats()]);   // 新規追加も一覧に出す
    } catch (e) {
      toast('保存失敗: ' + e.message, 'err');
    }
  }

  // --- Utils ---
  function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  // 住所文字列から「市区町村」表記を抽出 (例: "東京都立川市曙町..." → "立川市")
  // 都道府県は除外し、市/区/町/村 で終わる最初のトークンを返す
  function extractCityFromAddress(addr) {
    if (!addr) return null;
    // 都道府県を除去
    let s = String(addr).replace(/^[\s　]*(東京都|北海道|京都府|大阪府|.{2,3}県)/, '').replace(/^[\s　]+/, '');
    // 「市」優先で抽出 (武蔵村山市・羽村市 等、市名の途中に村/町を含む地名に対応)。
    // 市が無ければ区→町→村の順。最短マッチで地名途中の村/町を拾わないようにする。
    const m = s.match(/^(.+?市)/) || s.match(/^(.+?区)/) || s.match(/^(.+?[町村])/);
    return m ? m[1] : null;
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function hotelTypeLabel(t) { return { city:'シティ', business:'ビジネス', ryokan:'旅館', other:'その他', resort:'リゾート', minshuku:'民宿', love_hotel:'ラブホ', love:'ラブホ', rental_room:'レンタルルーム' }[t] || t; }
  // 接客ライフサイクル状態: 未(pending) → 始(started) → 確(ended)。cancelled/no_show は対象外(null)
  // started/ended は内部的に status='completed'（経理計上は開始時点）。ended は service_ended_at 有無で判定
  function svcState(b) {
    if (!b || ['cancelled', 'no_show', 'inquiry'].includes(b.status)) return null;
    if (b.status !== 'completed') return 'pending';
    return b.service_ended_at ? 'ended' : 'started';
  }
  const SVC_LABEL = { pending: '未', started: '始', ended: '終' };
  const SVC_NEXT  = { pending: 'started', started: 'ended', ended: 'pending' }; // CTRL: クリックで巡回（確→未で巻き戻し）
  // ステータス表示ラベル: completed は内部的に 始(接客中)/確(接客完了) なので svcState で出し分ける
  function bookingStatusLabel(b) {
    if (b && b.status === 'completed') return svcState(b) === 'ended' ? '✓ 接客完了' : '接客中';
    return ({ inquiry:'問合せ', reserved:'予約', pre_reserved:'事前予約', on_hold:'保留', pending:'保留', cancelled:'キャンセル', no_show:'無連絡' })[b && b.status] || (b && b.status) || '';
  }
  // 入室方法マスタキャッシュ（公開ページ＋編集モーダル＋ホテルカード用）
  let entryMethodsCache = [];
  function entryMethodLabel(m) {
    if (!m) return '';
    const fallback = { front:'フロント呼出', card:'カードキー', direct:'客室直行', lobby:'ロビー待機', other:'その他' };
    return String(m).split(',').filter(Boolean).map(code => {
      const c = code.trim();
      const found = entryMethodsCache.find(e => e.code === c);
      return found ? found.label : (fallback[c] || c);
    }).join(' / ');
  }
  function populateEntryMethodSelect() {
    // チップ生成（複数選択UI）
    const chipsEl = document.getElementById('emEntryChips');
    const hidden = document.getElementById('emEntry');
    if (!chipsEl) return;
    const current = (hidden?.value || '').split(',').filter(Boolean);
    chipsEl.innerHTML = entryMethodsCache
      .filter(e => Number(e.is_active))
      .map(e => {
        const isActive = current.includes(e.code);
        return `<div class="em-chip${isActive ? ' active' : ''}" data-em-code="${escapeAttr(e.code)}">${escapeHtml(e.label)}</div>`;
      }).join('');
    chipsEl.querySelectorAll('.em-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        // hidden input に反映
        const codes = Array.from(chipsEl.querySelectorAll('.em-chip.active')).map(c => c.dataset.emCode);
        if (hidden) hidden.value = codes.join(',');
      });
    });
  }
  function statusLabel(s) { return { visited:'ご案内実績あり', inquiry:'要問合せ', unavailable:'ご案内不可' }[s] || '未設定'; }

  // --- Staff management ---
  function genPw() {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  // ロール別エンドポイント: owner は全項目(歩合/登録日)、それ以外は最小リスト(read-only)
  function staffListEndpoint() {
    return currentUser?.role === 'owner' ? 'admin-users' : 'staff-list';
  }

  async function loadAdminUsers() {
    const el = document.getElementById('staffTable');
    el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';
    try {
      const data = await api('/admin-api.php?action=' + staffListEndpoint());
      allUsers = data.users || [];
      renderAdminUsers();
    } catch (e) {
      el.innerHTML = '<div class="empty">読み込みに失敗: ' + escapeHtml(e.message) + '</div>';
    }
  }

  // スタッフ行 HTML（スタッフ管理 / キャスト管理 共通）
  // opts.drag: ドラッグ並び替え可（owner のみ）、opts.actions: 編集/PW/削除ボタン表示（owner のみ）
  function staffRowHtml(u, { drag = false, actions = false } = {}) {
    const me = currentUser ? Number(currentUser.id) : 0;
    const ownerCount = allUsers.filter(x => x.role === 'owner').length;
    const isMe = Number(u.id) === me;
    const isOwner = u.role === 'owner';
    const cannotDelete = isMe || (isOwner && ownerCount <= 1);
    const thumb = u.thumbnail_url
      ? `<img src="${escapeAttr(u.thumbnail_url)}" alt="" style="width:40px;height:50px;border-radius:10px;object-fit:cover;">`
      : `<div style="width:40px;height:50px;border-radius:10px;background:linear-gradient(135deg,var(--aqua),var(--sea));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.1rem;">${escapeHtml((u.display_name || u.username || '?').substring(0, 1))}</div>`;
    const roleLabel = u.role === 'owner' ? 'オーナー' : u.role === 'manager' ? '店長' : u.role === 'office' ? '内勤スタッフ' : u.role === 'driver' ? 'ドライバー' : 'キャスト';
    // 主ロールとは別の兼任（例: 橘=店長＋キャスト兼任＋内勤兼任）をラベルに追記
    const concurrentLabels = [];
    if (u.role !== 'staff' && Number(u.is_therapist) === 1) concurrentLabels.push('キャスト');
    if (u.role !== 'office' && Number(u.is_office) === 1) concurrentLabels.push('内勤');
    if (u.role !== 'driver' && Number(u.can_drive) === 1) concurrentLabels.push('ドライバー');
    const roleLabelFull = roleLabel + (concurrentLabels.length ? `（${concurrentLabels.join('・')}兼任）` : '');
    const rateMeta = ((u.role !== 'driver' && u.role !== 'office') || isTherapistCapable(u)) && u.commission_rate != null ? `歩合 ${parseFloat(u.commission_rate)}% ・ ` : '';
    const metaText = u.created_at ? `${rateMeta}登録: ${formatDate(u.created_at)}` : (rateMeta || '&nbsp;');
    // ドライバー(専任 or 兼任)には送迎・勤務実績の詳細ボタン
    const isDriverRow = isDriverCapable(u);
    const driverBtn = isDriverRow ? `<button class="sr-driver" data-action="driver-detail" data-id="${u.id}" type="button" style="margin-top:.3rem;padding:.28rem .7rem;font-size:.74rem;font-weight:700;border:1.5px solid var(--sea);color:var(--sea);background:#fff;border-radius:50px;cursor:pointer;">🚗 送迎・勤務</button>` : '';
    const meta = `${metaText}${driverBtn ? '<br>' + driverBtn : ''}`;
    const actionsHtml = actions ? `
            <button class="sr-edit" data-action="edit-user" data-id="${u.id}">編集</button>
            <button class="sr-pw" data-action="reset-pw" data-id="${u.id}" data-name="${escapeAttr(u.display_name || u.username)}">パスワード再発行</button>
            <button class="sr-del" data-action="delete-user" data-id="${u.id}" data-name="${escapeAttr(u.display_name || u.username)}" ${cannotDelete ? 'disabled title="' + (isMe ? '自分自身は削除できません' : '最後のオーナーは削除できません') + '"' : ''}>削除</button>` : '';
    return `
        <div class="staff-row${drag ? ' sortable' : ''}"${drag ? ' draggable="true"' : ''} data-user-id="${u.id}" style="grid-template-columns:auto auto auto 1fr auto auto;">
          <div class="drag-handle"${drag ? ' title="ドラッグで並び替え"' : ' style="visibility:hidden;"'}>⋮⋮</div>
          ${thumb}
          <span class="sr-role ${u.role}">${roleLabelFull}</span>
          <div class="sr-info">
            <div class="sr-name">${escapeHtml(u.display_name || '名前未設定')}${isMe ? ' <span style="color:#ff9a76;font-size:.7rem;margin-left:.4rem;">あなた</span>' : ''}</div>
            <div class="sr-email">${escapeHtml(u.username)}</div>
          </div>
          <div class="sr-meta">${meta}</div>
          <div class="sr-actions">${actionsHtml}</div>
        </div>`;
  }

  // スタッフ管理タブ = 運営側のみ（role≠staff）
  function renderAdminUsers() {
    const el = document.getElementById('staffTable');
    const isOwner = currentUser?.role === 'owner';
    const addBtn = document.getElementById('btnAddStaff');
    if (addBtn) addBtn.style.display = isOwner ? '' : 'none';
    const ops = allUsers.filter(u => u.role !== 'staff');
    if (!ops.length) { el.innerHTML = '<div class="empty">運営スタッフがいません</div>'; return; }
    el.innerHTML = ops.map(u => staffRowHtml(u, { drag: isOwner, actions: isOwner })).join('');
    if (isOwner) setupStaffSortable('staffTable');
  }

  // キャスト管理タブ = role=staff、または is_therapist 兼任者（例: 橘=manager+is_therapist）の一覧
  function renderTherapistBoard() {
    const el = document.getElementById('staffBoard');
    if (!el) return;
    const isOwner = currentUser?.role === 'owner';
    const addBtn = document.getElementById('btnAddTherapist');
    if (addBtn) addBtn.style.display = isOwner ? '' : 'none';
    const ths = allUsers.filter(u => isTherapistCapable(u));
    if (!ths.length) { el.innerHTML = '<p style="color:var(--ink-soft);padding:1.5rem 0;text-align:center;">キャストが登録されていません。</p>'; return; }
    el.innerHTML = ths.map(u => staffRowHtml(u, { drag: isOwner, actions: isOwner })).join('');
    if (isOwner) setupStaffSortable('staffBoard');
  }

  // ===== スタッフ並び替え（フィルタ表示でも全体順序を保つ） =====
  function setupStaffSortable(containerId) {
    const list = document.getElementById(containerId);
    if (!list) return;
    let dragSrc = null;
    list.querySelectorAll('.sortable').forEach(row => {
      row.addEventListener('dragstart', e => {
        if (e.target.closest('button')) { e.preventDefault(); return; }
        dragSrc = row; row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.userId);
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        list.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
      });
      row.addEventListener('dragover', e => {
        e.preventDefault();
        if (!dragSrc || row === dragSrc) return;
        const rect = row.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        list.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
        row.classList.add(before ? 'drag-over-top' : 'drag-over-bottom');
      });
      row.addEventListener('drop', async e => {
        e.preventDefault();
        if (!dragSrc || row === dragSrc) return;
        const rect = row.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        list.insertBefore(dragSrc, before ? row : row.nextSibling);
        list.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
        const visibleIds = Array.from(list.querySelectorAll('.sortable')).map(r => Number(r.dataset.userId));
        // 表示中グループの新順序 ＋ 非表示グループ(既存順) をマージして全体順序を保存
        const rest = allUsers.map(u => Number(u.id)).filter(id => !visibleIds.includes(id));
        const newIds = [...visibleIds, ...rest];
        try {
          await apiPost('/admin-api.php?action=admin-reorder', { ids: newIds });
          allUsers.sort((a, b) => newIds.indexOf(Number(a.id)) - newIds.indexOf(Number(b.id)));
          toast('✓ 順序を更新', 'ok');
        } catch (err) {
          toast('並び替え失敗: ' + err.message, 'err');
          loadAdminUsers();
        }
      });
    });
  }

  // 担当キャストの注意事項（猫アレルギー等）を予約モーダルに出す。
  // 「予約を取る前に確認したい」ものなので、モーダル本文の一番上に赤帯で表示する。
  // 注: adminUsersAll は一度読んだらキャッシュされるため、注意事項を書き足した直後に
  //     別画面から開くと古い値のことがある。保存時に両キャッシュを更新している。
  function renderCastAlert() {
    const box = bel('bmCastAlert');
    if (!box) return;
    const id = bel('bmAdminId')?.value;
    const u = id ? findStaffUser(id) : null;
    const note = (u?.cast_notes || '').trim();
    box.style.display = note ? 'block' : 'none';
    box.textContent = note ? `⚠️ ${u.display_name || ''}：${note}` : '';
  }

  // ===== スタッフ編集モーダル =====
  let editingStaffId = null;
  let editingStaffRole = 'staff';
  let editingStaffIsCast = false;   // CTRL同期のキャスト(girl_idあり)を編集中か
  let editingStaffUsername = '';
  let editingThumbData = null;  // 新サムネ Base64

  // スタッフ/キャストの参照。allUsers は「スタッフ管理」を開いた時だけ埋まるため、
  // タイムラインから呼ぶと空で何も起きなかった。タイムライン用の adminUsersAll も見る。
  function findStaffUser(id) {
    const n = Number(id);
    return allUsers.find(x => Number(x.id) === n)
        || adminUsersAll.find(x => Number(x.id) === n)
        || null;
  }
  function openEditStaffModal(id) {
    const u = findStaffUser(id);
    if (!u) { toast('スタッフ情報を読み込めませんでした', 'err'); return; }
    editingStaffId = u.id;
    editingStaffRole = u.role;
    editingThumbData = u.thumbnail_url || null;
    document.getElementById('esSub').textContent = u.username;
    document.getElementById('esName').value = u.display_name || '';
    editingStaffUsername = u.username || '';
    const esEmail = document.getElementById('esEmail');
    if (esEmail) esEmail.value = u.username || '';
    // CTRL から同期したキャスト(girl_id あり)は権限=キャスト固定。
    // 権限/兼任/歩合率はスタッフ管理でのみ扱う
    const isCast = u.girl_id != null && u.girl_id !== '';
    editingStaffIsCast = isCast;
    const staffOnly = document.getElementById('esStaffOnlyFields');
    if (staffOnly) staffOnly.style.display = isCast ? 'none' : '';
    const castNote = document.getElementById('esCastNote');
    if (castNote) castNote.style.display = isCast ? '' : 'none';
    const esTitle = document.getElementById('esTitle');
    if (esTitle) esTitle.textContent = isCast ? 'キャスト編集' : 'スタッフ編集';

    const esNotes = document.getElementById('esCastNotes');
    if (esNotes) esNotes.value = u.cast_notes || '';
    // 注意事項は店長も編集できる（cast-note-update）。それ以外の項目は owner 専用
    const canEditAll = currentUser?.role === 'owner';
    ['esName', 'esEmail', 'esThumbFile', 'esThumbRemove'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.disabled = !canEditAll; el.style.opacity = canEditAll ? 1 : .55; }
    });

    const esCanDrive = document.getElementById('esCanDrive');
    if (esCanDrive) esCanDrive.checked = Number(u.can_drive) === 1;
    const esIsTherapist = document.getElementById('esIsTherapist');
    if (esIsTherapist) esIsTherapist.checked = Number(u.is_therapist) === 1;
    const esIsOffice = document.getElementById('esIsOffice');
    if (esIsOffice) esIsOffice.checked = Number(u.is_office) === 1;
    document.querySelectorAll('[data-es-role]').forEach(b => b.classList.toggle('active', b.dataset.esRole === u.role));
    const me = Number(currentUser?.id) === Number(u.id);
    document.getElementById('esRoleHint').textContent = me ? '⚠️ 自分自身の権限は変更できません' : '';
    document.querySelectorAll('[data-es-role]').forEach(b => { b.disabled = me; b.style.opacity = me ? .5 : 1; });
    // サムネプレビュー
    const prev = document.getElementById('esThumbPreview');
    prev.innerHTML = editingThumbData
      ? `<img src="${escapeAttr(editingThumbData)}" style="width:100%;height:100%;object-fit:cover;">`
      : 'なし';
    document.getElementById('esThumbFile').value = '';
    openModal('editStaffModal');
  }

  // 画像をリサイズしてBase64化
  async function resizeImage(file, maxSize = 512) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = e => { img.src = e.target.result; };
      reader.onerror = reject;
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          const ratio = Math.min(maxSize / w, maxSize / h);
          w = Math.round(w * ratio); h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function saveStaffEdit() {
    if (!editingStaffId) return;
    // 注意事項は owner/manager どちらでも保存できる（受付中に気づいた点を足せるように）
    const noteEl = document.getElementById('esCastNotes');
    if (noteEl) {
      try {
        await apiPost('/admin-api.php?action=cast-note-update', { id: editingStaffId, cast_notes: noteEl.value });
        const note = noteEl.value.trim();
        [allUsers, adminUsersAll].forEach(list => {
          const u0 = list.find(x => Number(x.id) === Number(editingStaffId));
          if (u0) u0.cast_notes = note;
        });
        try { renderTimeline(); } catch (_) {}
      } catch (e) { toast('注意事項の保存に失敗しました', 'err'); return; }
    }
    if (currentUser?.role !== 'owner') {   // 他項目は owner 専用。店長は注意事項だけ保存して終了
      toast('✓ 注意事項を保存しました', 'ok');
      closeModal('editStaffModal');
      try { renderCastAlert(); } catch (_) {}
      return;
    }
    const name = document.getElementById('esName').value.trim();
    if (!name) { toast('表示名を入力してください', 'err'); return; }
    const payload = { id: editingStaffId, display_name: name, thumbnail_url: editingThumbData };
    // キャストは権限=キャスト固定・兼任/歩合率なし。該当項目は送らず現状維持にする
    if (!editingStaffIsCast) {
      payload.can_drive = document.getElementById('esCanDrive')?.checked ? 1 : 0;
      payload.is_therapist = document.getElementById('esIsTherapist')?.checked ? 1 : 0;
      payload.is_office = document.getElementById('esIsOffice')?.checked ? 1 : 0;
    }
    // メール(=ログインID) 変更時のみ送信
    const emailVal = (document.getElementById('esEmail')?.value || '').trim();
    if (emailVal && emailVal !== editingStaffUsername) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailVal)) { toast('メールアドレスの形式が正しくありません', 'err'); return; }
      payload.email = emailVal;
    }
    // 自分以外なら role も送信
    // キャストは role=staff 固定（権限UIを出していないので送らない）
    if (!editingStaffIsCast && Number(currentUser?.id) !== Number(editingStaffId)) {
      payload.role = editingStaffRole;
    }
    try {
      await apiPost('/admin-api.php?action=admin-update', payload);
      toast('✓ 更新しました', 'ok');
      closeModal('editStaffModal');
      reloadStaffData();
    } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
  }

  function formatDate(s) {
    if (!s) return '';
    const d = new Date(s.replace(' ', 'T'));
    if (isNaN(d.getTime())) return s;
    return `${d.getFullYear()}/${('0'+(d.getMonth()+1)).slice(-2)}/${('0'+d.getDate()).slice(-2)}`;
  }

  async function createStaff() {
    const email = document.getElementById('csEmail').value.trim();
    const password = document.getElementById('csPassword').value;
    const displayName = document.getElementById('csName').value.trim();
    if (!email || !password || !displayName) {
      toast('全項目を入力してください', 'err');
      return;
    }
    if (password.length < 8) {
      toast('パスワードは8文字以上必要です', 'err');
      return;
    }
    const csRate = document.getElementById('csRate');
    const rate = csRate && csRate.value !== '' ? Math.max(0, Math.min(100, parseFloat(csRate.value) || 0)) : 50;
    try {
      await apiPost('/admin-api.php?action=admin-create', {
        email, password, display_name: displayName, role: createRole, commission_rate: rate,
        can_drive: document.getElementById('csCanDrive')?.checked ? 1 : 0,
        is_therapist: document.getElementById('csIsTherapist')?.checked ? 1 : 0,
        is_office: document.getElementById('csIsOffice')?.checked ? 1 : 0,
      });
      toast(`✓ ${displayName}さんを追加しました`, 'ok');
      closeModal('createStaffModal');
      reloadStaffData();
    } catch (e) {
      toast('追加失敗: ' + e.message, 'err');
    }
  }

  async function resetPassword() {
    if (!resetPwUserId) return;
    const pw = document.getElementById('rpPassword').value;
    if (pw.length < 8) {
      toast('パスワードは8文字以上必要です', 'err');
      return;
    }
    try {
      await apiPost('/admin-api.php?action=admin-reset-password', { id: resetPwUserId, password: pw });
      toast('✓ パスワードを変更しました', 'ok');
      closeModal('resetPwModal');
    } catch (e) {
      toast('変更失敗: ' + e.message, 'err');
    }
  }

  async function deleteUser(id, name) {
    if (!confirm(`「${name}」を削除しますか？\nログインできなくなります。`)) return;
    try {
      await apiPost('/admin-api.php?action=admin-delete', { id: Number(id) });
      toast('✓ 削除しました', 'ok');
      reloadStaffData();
    } catch (e) {
      toast('削除失敗: ' + e.message, 'err');
    }
  }

  function openModal(id) {
    const overlay = document.getElementById(id);
    overlay.classList.add('show');
    // ドラッグ可能モーダルは位置をリセット（再センター）
    const draggable = overlay.querySelector('.modal.draggable');
    if (draggable) {
      draggable.style.left = '50%';
      draggable.style.top = '50%';
      draggable.style.transform = 'translate(-50%,-50%)';
      draggable.style.margin = '';
    }
  }
  function closeModal(id) { document.getElementById(id).classList.remove('show'); }

  // ドラッグ可能モーダルのセットアップ（モジュール読み込み時1回だけ）
  function setupDraggableModals() {
    document.querySelectorAll('.modal.draggable').forEach(modal => {
      const header = modal.querySelector('.modal-header');
      if (!header) return;
      let dragging = false;
      let startX, startY, startLeft, startTop;

      const onDown = (e) => {
        // ボタンやインタラクティブ要素は除外
        if (e.target.closest('button, input, select, textarea, a')) return;
        const t = e.touches ? e.touches[0] : e;
        dragging = true;
        modal.classList.add('dragging');
        const rect = modal.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        startX = t.clientX;
        startY = t.clientY;
        // 中央寄せ transform を解除し、left/top で絶対位置に
        modal.style.position = 'fixed';
        modal.style.margin = '0';
        modal.style.transform = 'none';
        modal.style.left = startLeft + 'px';
        modal.style.top = startTop + 'px';
        e.preventDefault();
      };
      const onMove = (e) => {
        if (!dragging) return;
        const t = e.touches ? e.touches[0] : e;
        const nx = startLeft + (t.clientX - startX);
        const ny = startTop + (t.clientY - startY);
        // ビューポート内に収める
        const maxX = window.innerWidth - 100;
        const maxY = window.innerHeight - 80;
        modal.style.left = Math.max(-modal.offsetWidth + 100, Math.min(maxX, nx)) + 'px';
        modal.style.top = Math.max(0, Math.min(maxY, ny)) + 'px';
      };
      const onUp = () => {
        dragging = false;
        modal.classList.remove('dragging');
      };

      header.addEventListener('mousedown', onDown);
      header.addEventListener('touchstart', onDown, { passive: false });
      document.addEventListener('mousemove', onMove);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchend', onUp);
    });
  }

  // ==========================================================================
  // Timeline / Bookings / Customers / Shifts
  // ==========================================================================
  // 営業日基準 (10:00 開始, 翌10:00 終了) — 10時前は前日扱い
  function getBusinessDayDate() {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (now.getHours() < 10) d.setDate(d.getDate() - 1);
    return d;
  }
  let tlCurrentDate = getBusinessDayDate();  // 1日分のタイムライン (営業日基準)
  let adminUsersAll = [];      // {id, username, display_name, role}
  let CARD_FEE_RATE = 3;       // クレジット手数料率(%)。init で card-fee-get から取得。半分がキャスト負担
  const NOMINATION_FEES = { first: 0, regular: 0, free: 0 };  // 指名料(固定額)。init で nomination-fees-get から取得
  const nominationFeeFor = (type) => NOMINATION_FEES[type] || 0;
  let tlBookings = [];
  let tlShifts = [];
  let hotelsForSelect = [];    // selectで使う簡易ホテル一覧
  let bookingsList = [];
  let customersList = [];
  // primary('')/secondary('-2') それぞれで別の予約を編集できるため、suffix別に保持する
  const editingBookingIdBySuffix = { '': null, '-2': null };
  const getEditingBookingId = () => editingBookingIdBySuffix[activeBmSuffix] ?? null;
  const setEditingBookingId = (v) => { editingBookingIdBySuffix[activeBmSuffix] = v; };
  let editingCustomerId = null;
  let editingShiftId = null;
  let shCurrent = new Date();
  let shSelectedStaff = '';
  let shViewMode = 'timetable';  // 'timetable' (10日) | 'calendar' (月)
  let shCachedShifts = [];       // タイムテーブルの自動保存で参照
  let coursesCache = [];
  let editingCourseId = null;

  function fmtDate(d) { return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function dowLabel(d) { return ['日','月','火','水','木','金','土'][d.getDay()]; }

  // ===== 24h+ 時刻パーサー =====
  // "26:00" → { date_offset: 1, time: "02:00" }
  // "14:00" → { date_offset: 0, time: "14:00" }
  function parseExtTime(s) {
    const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = m[2];
    let offset = 0;
    while (h >= 24) { h -= 24; offset++; }
    return { offset, time: ('0'+h).slice(-2) + ':' + min };
  }
  // 営業日(bizDate) + 24h+表記時刻 → { booking_date, time }
  function bizTimeToBookingDate(bizDate, extTime) {
    const p = parseExtTime(extTime);
    if (!p) return null;
    if (p.offset === 0) return { booking_date: bizDate, time: p.time };
    // offset があれば bookingDate を +offset
    const [y, m, day] = bizDate.split('-').map(Number);
    const d = new Date(y, m - 1, day);
    d.setDate(d.getDate() + p.offset);
    return { booking_date: fmtDate(d), time: p.time };
  }
  // 入力UI用: bookingDate + time → 営業日基準の "HH:MM" or "26:00"
  function bookingToExtTime(bookingDate, time, bizDate) {
    if (!bookingDate || !time) return '';
    const t = String(time).substring(0, 5);
    if (bookingDate === bizDate) return t;
    const [h, mn] = t.split(':');
    return (parseInt(h, 10) + 24) + ':' + mn;
  }

  // 開始時刻+分数 → 終了時刻 (24h+表記)
  function calcEndExtTime(startHour, startMin, totalMin) {
    const totalStartMin = parseInt(startHour, 10) * 60 + parseInt(startMin, 10);
    const totalEndMin = totalStartMin + parseInt(totalMin, 10);
    const eh = Math.floor(totalEndMin / 60);
    const em = totalEndMin % 60;
    return ('0' + eh).slice(-2) + ':' + ('0' + em).slice(-2);
  }
  // 24h+表記の HH:MM → {hour, min} 数値
  function splitExtTime(ext) {
    const m = String(ext || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return { hour: 14, min: 0 };
    return { hour: parseInt(m[1], 10), min: parseInt(m[2], 10) };
  }
  // コースselect: option value=duration_min or 'custom'。dataset.name でコース名
  function courseToMinutes() {
    return parseInt(bel('bmCourse').value || '0', 10);
  }
  // bmCourse select を coursesCache から動的生成
  function populateCourseSelect() {
    const sel = bel('bmCourse');
    const selectedValue = sel.value;  // 復元用
    let html = '<option value="">選択</option>';
    coursesCache.filter(c => c.is_active == 1).forEach(c => {
      // 「延長」コースはコース選択肢から除外し、延長1回分の単価として保持
      if (/延長/.test(c.name)) {
        _extUnit = { min: parseInt(c.duration_min, 10) || 30, price: parseInt(c.price, 10) || 0, name: c.name };
        return;
      }
      const priceTag = c.price ? ` (¥${Number(c.price).toLocaleString()})` : '';
      html += `<option value="${c.duration_min}" data-name="${escapeAttr(c.name)}" data-price="${c.price || ''}">${escapeHtml(c.name)}${priceTag}</option>`;
    });
    sel.innerHTML = html;
    if (selectedValue) sel.value = selectedValue;
    // 延長フィールドの説明を更新
    const ext = document.getElementById('bmExtInfo' + activeBmSuffix) || document.getElementById('bmExtInfo');
    if (ext) ext.textContent = _extUnit.price ? `1回 +${_extUnit.min}分 / +¥${_extUnit.price.toLocaleString()}` : '';
  }
  async function ensureCoursesLoaded(force) {
    if (coursesCache.length === 0 || force) {
      try {
        const d = await api('/courses.php?action=list&include_inactive=1');
        coursesCache = d.courses || [];
        populateCourseSelect();
      } catch (e) {}
    }
  }
  // 休憩 duration select の値を分数に変換 (custom は bmBreakCustomMin から)
  function breakDurToMinutes() {
    const v = bel('bmBreakDur')?.value;
    if (!v) return 0;
    if (v === 'custom') return parseInt(bel('bmBreakCustomMin')?.value || '0', 10);
    return parseInt(v, 10);
  }
  // 終了時刻を再計算して表示更新
  // 媒体・予約経路（複数可）。ylka のカウンセリング+10分と違い、アドミは
  // 【LINE予約のときだけ +10分(無料)】。既定は未チェック（店長運用 2026-08-02）
  const BM_MEDIA_KEYS = ['fujoho', 'ekichika', 'heaven', 'fuzoku', 'deli', 'other', 'line'];
  const BM_MEDIA_LABEL = {
    fujoho: '情報局', ekichika: '駅ちか', heaven: 'ヘブン', fuzoku: '風じゃ',
    deli: 'デリじゃ', other: 'その他', line: 'LINE予約',
  };
  function mediaCheckboxes() {
    const modal = document.getElementById('bookingModal' + activeBmSuffix);
    return modal ? modal.querySelectorAll('input[name^="bmMedia"]') : [];
  }
  function getBmMedia() {
    return Array.from(mediaCheckboxes()).filter(c => c.checked).map(c => c.value);
  }
  function setBmMedia(list) {
    const set = new Set(String(list || '').split(',').map(s => s.trim()).filter(Boolean));
    mediaCheckboxes().forEach(c => { c.checked = set.has(c.value); });
  }
  function mediaLabels(list) {
    return String(list || '').split(',').map(s => s.trim()).filter(Boolean)
      .map(k => BM_MEDIA_LABEL[k] || k).join('・');
  }
  /** LINE予約特典 +10分 */
  function lineBonusExtra() {
    return (getBmMedia().includes('line') && !bel('bmBreakMode')?.checked) ? 10 : 0;
  }
  // 延長回数（30分×n）
  function extCount() {
    return parseInt(bel('bmExtCount')?.value || '0', 10) || 0;
  }
  function extMinutes() { return _extUnit.min * extCount(); }
  function extAmount() { return _extUnit.price * extCount(); }
  // フッター状態表示: 「14:00〜15:10（60分コース）」等、小さく現在の入力状況を要約
  function updateFooterStatus() {
    // 予約内容サマリーをモーダル下端の固定バーに表示（本文=日時・コース・指名・お名前・場所 / 右端=合計、入力に連動）
    const fs = bel('bmFooterSummary');
    if (!fs) return;
    const mainEl = bel('bmSummaryMain');
    const totalEl = bel('bmSummaryTotal');
    const setOut = (txt, totalTxt) => {
      if (mainEl) mainEl.textContent = txt;
      if (totalEl) totalEl.textContent = totalTxt || '';
      fs.classList.toggle('show', !!(txt || totalTxt));
    };
    const sh = bel('bmStartHour')?.value;
    const sm = bel('bmStartMin')?.value;
    if (sh === undefined || sh === '' || sh === null) { setOut(''); return; }
    const dateV = bel('bmDate')?.value || '';
    const dateDisp = dateV ? `${parseInt(dateV.slice(5, 7), 10)}/${parseInt(dateV.slice(8, 10), 10)}` : '';
    // 時刻は実時刻・0埋めなし（26:30→2:30）
    const startStr = `${parseInt(sh, 10)}:${('0' + parseInt(sm || 0, 10)).slice(-2)}`;
    const endRaw = bel('bmEndDisplay')?.textContent || '—';
    let endStr = '';
    if (endRaw !== '—' && /^\d{1,2}:\d{2}/.test(endRaw)) {
      const [ehRaw, emRaw] = endRaw.split(':');
      endStr = `${parseInt(ehRaw, 10) % 24}:${emRaw.slice(0, 2)}`;
    }
    const timeDisp = `${startStr}〜${endStr}`;
    const isBreak = bel('bmBreakMode')?.checked;
    const segs = [];
    if (isBreak) {
      segs.push(`💤 休憩 ${dateDisp} ${timeDisp}`.replace(/\s+/g, ' ').trim());
      const city = (bel('bmBreakCity')?.value || '').trim();
      if (city) segs.push(`📍 ${city}`);
      setOut(segs.join('　'));
      return;
    }
    const courseSel = bel('bmCourse');
    const opt = courseSel?.options?.[courseSel.selectedIndex];
    const course = opt?.dataset?.name || '';
    const nomSel = bel('bmNomination');
    const nom = nomSel?.value ? (nomSel.options[nomSel.selectedIndex]?.text || '') : '';
    let head = `📅 ${dateDisp} ${timeDisp}`.replace(/\s+/g, ' ').trim();
    const meta = [course, nom].filter(Boolean).join('・');
    if (meta) head += `（${meta}）`;
    segs.push(head);
    const locType = document.querySelector(`input[name="bmLocType${activeBmSuffix}"]:checked`)?.value
      || document.querySelector('input[name="bmLocType"]:checked')?.value || 'hotel';
    let place = '';
    if (locType === 'hotel') {
      const hid = bel('bmHotelId')?.value;
      if (hid) { const h = (hotelsForSelect || []).find(x => Number(x.id) === Number(hid)); place = h ? h.name : ''; }
      else place = (bel('bmHotelName')?.value || '').trim();
      const room = (bel('bmRoom')?.value || '').trim();
      if (place && room) place += ` ${room}`;
    } else if (locType === 'home') {
      place = (bel('bmHomeAddress')?.value || '').trim();
    } else {
      place = (bel('bmOtherLoc')?.value || '').trim().split('\n')[0];
    }
    if (place) segs.push(`📍 ${place}`);
    // 料金内訳: コース料金・指名料・出張費（0円の項目も含めて常に表示）
    const coursePrice = parseInt(String(bel('bmPrice')?.value || '').replace(/[^\d]/g, ''), 10) || 0;
    const nomFee = nominationFeeFor(bel('bmNomination')?.value);
    const transportFee = parseInt(String(bel('bmTransport')?.value || '').replace(/[^\d]/g, ''), 10) || 0;
    segs.push(`コース料金¥${coursePrice.toLocaleString()}・指名料¥${nomFee.toLocaleString()}・出張費¥${transportFee.toLocaleString()}`);
    const total = (bel('bmTotal')?.textContent || '').trim();
    setOut(segs.join('　'), total ? `合計 ${total}` : '');
  }
  function updateEndTime() {
    const sh = bel('bmStartHour').value;
    const sm = bel('bmStartMin').value;
    const isBreak = bel('bmBreakMode')?.checked;
    const baseMin = isBreak ? breakDurToMinutes() : courseToMinutes();
    if (!baseMin) {
      bel('bmEndDisplay').textContent = '—';
      bel('bmEnd').value = '';
      // 送迎時刻も連動更新
      try { syncPickupTimes(); } catch(e) {}
      try { updateFooterStatus(); } catch(e) {}
      return;
    }
    const extra = isBreak ? 0 : (lineBonusExtra() + extMinutes());
    const totalMin = baseMin + extra;
    const end = calcEndExtTime(sh, sm, totalMin);
    bel('bmEndDisplay').textContent = end;
    bel('bmEnd').value = end;
    // 送迎時刻も連動更新
    try { syncPickupTimes(); } catch(e) {}
    try { updateFooterStatus(); } catch(e) {}
  }

  // ===== 営業日（10:00 開始, 翌10:00 終了）ロジック =====
  const BIZ_DAY_START_HOUR = 10;  // 営業日の開始時刻
  // 予約の booking_date / start_time から「どの営業日に属するか」を返す（YYYY-MM-DD）
  function bizDateOf(bookingDate, startTime) {
    const hour = parseInt(String(startTime).substring(0, 2), 10);
    if (hour < BIZ_DAY_START_HOUR) {
      // 10時前 → 前日扱い
      const [y, m, day] = bookingDate.split('-').map(Number);
      const d = new Date(y, m - 1, day);
      d.setDate(d.getDate() - 1);
      return fmtDate(d);
    }
    return bookingDate;
  }
  // 営業日(表示・入力用) + 開始時(0-23) → 実カレンダー保存日。開始が10時前なら翌カレンダー日へ繰り上げ
  // （bizDateOf の逆変換。編集モーダルの日付欄は営業日で扱い、保存時にこれでカレンダー日へ戻す）
  function bizDateToCalendar(bizDate, startHour) {
    if (!bizDate) return bizDate;
    return startHour < BIZ_DAY_START_HOUR ? fmtDate(addDays(new Date(bizDate + 'T00:00:00'), 1)) : bizDate;
  }
  // 予約オブジェクトの営業日を整形表示（内部スタッフ向け表示の共通ヘルパー）
  function fmtBizDate(b) { return formatDate(bizDateOf(b.booking_date, b.start_time || '00:00')); }
  // 表示用時刻（営業日基準）: 翌朝の2:00 → "26:00", 深夜0:30 → "24:30"
  function displayTime(bookingDate, time, bizDate) {
    const t = String(time).substring(0, 5);
    if (bookingDate === bizDate) return t;
    // 翌日カレンダー → +24
    const [h, m] = t.split(':');
    return (parseInt(h, 10) + 24) + ':' + m;
  }

  // ========== Timeline (1日 × 24時間 × スタッフ) ==========
  // ===== 受付リスト（着信履歴）左パネル =====
  // ※ 現状はデザイン確認用のサンプル表示。CTI連携が入ったら loadReceptionCalls() を
  //   実データ取得（その日の着信ログをAPIから取得）に差し替えるだけで動く構造。
  //   返却形式: [{ time:'21:25', phone:'090-…', name:'こまつ', booking_id:null|123, status:''|'inquiry'|'reserved' }]
  const SAMPLE_RECV_CALLS = [
    { time: '21:25', phone: '090-1234-5678', name: 'こまつ',   booking_id: null, status: '' },
    { time: '20:53', phone: '080-2222-3333', name: 'たけうち', booking_id: null, status: '' },
    { time: '20:35', phone: '080-2222-3333', name: 'たけうち', booking_id: 0,    status: 'reserved' },
    { time: '19:24', phone: '070-4444-5555', name: 'すがわら', booking_id: null, status: 'inquiry' },
    { time: '18:22', phone: '090-6666-7777', name: 'たなか',   booking_id: null, status: '' },
  ];
  function loadReceptionCalls(bizDay) {
    // TODO: CTI連携後、bizDay の着信ログをAPIから取得して返す（下記サンプルと同形式）
    // デザイン確認用: コンソールで localStorage.ylka_recv_demo='1' にするとサンプル表示
    if (localStorage.getItem('ylka_recv_demo') === '1') return SAMPLE_RECV_CALLS;
    return [];
  }
  function recvStateBadge(status) {
    if (status === 'reserved') return '<span class="recv-state s-reserved">予約</span>';
    if (status === 'inquiry')  return '<span class="recv-state s-inquiry">問合せ</span>';
    return '<span class="recv-state s-none">—</span>';
  }
  function renderReceptionList(bizDay) {
    const listEl = document.getElementById('recvList');
    const countEl = document.getElementById('recvCount');
    if (!listEl) return;
    const calls = loadReceptionCalls(bizDay) || [];
    if (countEl) countEl.textContent = calls.length;
    if (!calls.length) {
      listEl.innerHTML = '<div class="recv-empty">本日の着信はまだありません<br><span style="font-size:.72rem;opacity:.7;">（CTI連携後に自動表示されます）</span></div>';
      return;
    }
    listEl.innerHTML = calls.map(c => {
      const hasBooking = c.booking_id != null;
      const actBtn = hasBooking
        ? `<button class="recv-act edit" data-recv-edit="${c.booking_id}">編集</button>`
        : `<button class="recv-act" data-recv-new="${escapeHtml(c.phone || '')}">新規</button>`;
      return `<div class="recv-row">`
        + `<span class="rr-time">${escapeHtml(c.time || '')}</span>`
        + `<span class="rr-phone">${escapeHtml(c.phone || '')}</span>`
        + `<span class="rr-name${c.name ? '' : ' empty'}">${escapeHtml(c.name || '—')}</span>`
        + recvStateBadge(c.status)
        + actBtn
        + `</div>`;
    }).join('');
    listEl.querySelectorAll('[data-recv-new]').forEach(b =>
      b.addEventListener('click', () => openBookingForAdd({ date: fmtDate(tlCurrentDate), phone: b.dataset.recvNew })));
    listEl.querySelectorAll('[data-recv-edit]').forEach(b =>
      b.addEventListener('click', () => openBookingModal(Number(b.dataset.recvEdit))));
  }

  async function loadTimeline(keepScroll = false) {
    const grid = document.getElementById('timelineGrid');
    // 操作後の再描画ではスクロール位置を保持（10時に戻さない）。renderTimeline で復元するためモジュール変数へ
    _tlPrevScroll = keepScroll ? (document.querySelector('.tl-wrap')?.scrollLeft ?? null) : null;
    grid.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';

    const bizDay = fmtDate(tlCurrentDate);
    const nextDay = fmtDate(addDays(tlCurrentDate, 1));

    // タイトルは年を省いて短縮表示（例: 06/18 (木)）。日付ピッカー(dp.value)には年付き bizDay を使う
    const bizDayShort = bizDay.slice(5).replace('-', '/');
    document.getElementById('tlTitle').innerHTML = `${bizDayShort} (${dowLabel(tlCurrentDate)})<span class="tl-sub">営業日 10:00〜翌10:00</span>`;
    const dp = document.getElementById('tlDatePicker');
    if (dp) dp.value = bizDay;
    renderReceptionList(bizDay);

    try {
      // タイムラインはキャスト(isTherapistCapable)のみ表示 (内勤/ドライバー専任は行に出さない)
      //   - owner: admin-users (将来編集用、フル属性)
      //   - その他 (office/manager/driver): staff-list (read-only、最小属性)
      const urlUsers = currentUser?.role === 'owner' ? '/admin-api.php?action=admin-users' : '/admin-api.php?action=staff-list';
      const [usersRes, bookingsRes, shiftsRes] = await Promise.all([
        api(urlUsers),
        api(`/bookings.php?action=range&from=${bizDay}&to=${nextDay}`),
        api(`/shifts.php?action=range&from=${bizDay}&to=${nextDay}`),
      ]);
      adminUsersAll = usersRes.users || [];
      tlBookings = bookingsRes.bookings || [];
      tlShifts = shiftsRes.shifts || [];
      renderTimeline();
    } catch (e) {
      grid.innerHTML = '<div class="view-empty">読み込み失敗: ' + escapeHtml(e.message) + '</div>';
    }
  }

  // タイムラインを現在時刻付近までスクロール (営業日 10:00〜翌10:00 起点)
  // 上段クリック → 開始時刻を ±分 で微調整するポップ
  function closeTimeAdjust() {
    document.querySelectorAll('.tl-time-pop').forEach(p => p.remove());
    document.removeEventListener('click', _ttpOutside, true);
  }
  function _ttpOutside(e) { if (!e.target.closest('.tl-time-pop')) closeTimeAdjust(); }
  function openTimeAdjust(id, anchor) {
    closeTimeAdjust();
    const b = _tlBookingMap[id];
    if (!b) return;
    const toMin = (t) => { const p = String(t).split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); };
    const cur = toMin(b.start_time);
    // 現在時刻を中心に ±90分・5分刻みのプルダウン
    let opts = '';
    for (let d = -90; d <= 90; d += 5) {
      const m = cur + d;
      if (m < 0) continue;
      const hh = Math.floor(m / 60) % 24, mm = m % 60;
      const label = hh + ':' + ('0' + mm).slice(-2);
      opts += `<option value="${d}" ${d === 0 ? 'selected' : ''}>${label}${d === 0 ? '(現在)' : ''}</option>`;
    }
    const pop = document.createElement('div');
    pop.id = 'tlTimePop';
    pop.className = 'tl-time-pop';
    pop.innerHTML = `<div class="ttp-head"><span class="ttp-label">開始時刻</span><button class="ttp-close" type="button" aria-label="閉じる">×</button></div><select class="ttp-sel">${opts}</select>`;
    document.body.appendChild(pop);
    pop.querySelector('.ttp-close').addEventListener('click', (ev) => { ev.stopPropagation(); closeTimeAdjust(); });
    const r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + window.scrollY + 4) + 'px';
    pop.style.left = (r.left + window.scrollX) + 'px';
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) pop.style.left = (window.innerWidth - pr.width - 8 + window.scrollX) + 'px';
    const sel = pop.querySelector('.ttp-sel');
    sel.addEventListener('change', async (ev) => {
      ev.stopPropagation();
      const delta = parseInt(ev.target.value, 10);
      if (delta === 0) { closeTimeAdjust(); return; }
      sel.disabled = true;
      try {
        await apiPost('/bookings.php?action=shift-time', { id, delta });
        closeTimeAdjust();
        loadTimeline(true);
      } catch (e) { toast('変更失敗: ' + e.message, 'err'); closeTimeAdjust(); }
    });
    setTimeout(() => document.addEventListener('click', _ttpOutside, true), 0);
  }

  // 下段クリック → 送迎情報をクリップボードへ（LINE等でドライバーに送る）
  // 送迎情報テキスト＋件名＋対象ドライバーIDを生成（コピー / メール送信で共用）
  function buildPickupInfo(id, dir) {
    const b = _tlBookingMap[id];
    if (!b) return null;
    const isGo = dir === 'go';
    const wrapHM = (hm) => { const p = String(hm).split(':'); return (parseInt(p[0], 10) % 24) + ':' + (p[1] || '00'); };
    const cust = b.customer_name || b.customer_name_snapshot || '匿名';
    let place = b.hotel_name || b.hotel_name_snapshot || '';
    if (place.startsWith(HOME_PREFIX)) place = '自宅 ' + place.slice(HOME_PREFIX.length);
    else if (place.startsWith(OTHER_PREFIX)) place = place.slice(OTHER_PREFIX.length);
    if (b.room_number) place += ' / ' + b.room_number;
    const drvRaw = isGo ? b.driver_name : b.back_driver_name;
    const drv = drvRaw || ('自走' + (b.staff_name ? '（' + b.staff_name + '）' : ''));
    const st = b.start_time ? wrapHM(String(b.start_time).slice(0, 5)) : '';
    const et = b.end_time ? wrapHM(String(b.end_time).slice(0, 5)) : '';
    const lines = [];
    lines.push(isGo ? '🚗【送迎 行き（送り）】' : '🚗【送迎 帰り（迎え）】');
    lines.push('ドライバー: ' + drv);
    lines.push('日付: ' + fmtBizDate(b));
    lines.push('お客様: ' + cust + ' 様');
    if (st && et) lines.push('接客: ' + st + '〜' + et);
    // コース（何分）・指名・料金
    const nomLabel = { first: '初指名', regular: '本指名', free: 'フリー' }[b.nomination_type] || '';
    const courseBits = [b.course_name, nomLabel].filter(Boolean).join('・');
    if (courseBits) lines.push('コース: ' + courseBits);
    const priceN = parseInt(b.price, 10) || 0;
    const transN = parseInt(b.transport_fee, 10) || 0;
    if (priceN + transN > 0) lines.push('料金: ¥' + (priceN + transN).toLocaleString() + (transN ? '（出張費込）' : ''));
    if (place) lines.push('場所: ' + place);
    // 住所: ホテルは hotel_address、自宅は snapshot 内の住所部を使う。地図アプリで開けるようリンク付き
    let mapAddr = b.hotel_address || '';
    if (!mapAddr) {
      const snap = b.hotel_name_snapshot || '';
      if (snap.startsWith(HOME_PREFIX)) mapAddr = snap.slice(HOME_PREFIX.length).split(' / ')[0].trim();
    }
    if (mapAddr) {
      lines.push('住所: ' + mapAddr);
      const q = encodeURIComponent(mapAddr);
      lines.push('Googleマップ: https://www.google.com/maps/search/?api=1&query=' + q);
      lines.push('Yahoo!マップ: https://map.yahoo.co.jp/search?q=' + q);
    }
    const driverId = Number(isGo ? (b.driver_id || 0) : (b.back_driver_id || 0));
    const subject = `${isGo ? '【送迎 行き（送り）】' : '【送迎 帰り（迎え）】'}${cust}様 ${fmtBizDate(b)}${st ? ' ' + st : ''}`;
    return { text: lines.join('\n'), subject, driverId };
  }

  function copyPickup(id, dir) {
    const info = buildPickupInfo(id, dir);
    if (!info) { toast('情報が見つかりません', 'err'); return; }
    copyTextToClipboard(info.text).then(ok =>
      toast(ok ? '✓ 送迎情報をコピーしました（LINE等で送れます）' : 'コピーに失敗しました', ok ? 'ok' : 'err'));
  }

  // 送迎情報を担当ドライバーの登録メール(username)へ relux@ylka.jp から送信
  async function sendPickupMail(id, dir) {
    const info = buildPickupInfo(id, dir);
    if (!info) { toast('情報が見つかりません', 'err'); return; }
    // 送信先ドライバー = ポップの選択値を優先（保存直後でも拾えるよう）→ 無ければ予約の割当
    const selEl = document.getElementById('tlDrvSel');
    const driverId = (selEl && parseInt(selEl.value, 10)) || info.driverId;
    if (!driverId) { toast('先にドライバーを選択してください', 'err'); return; }
    const drv = (adminUsersAll || []).find(u => Number(u.id) === Number(driverId));
    const email = drv && drv.username ? String(drv.username).trim() : '';
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast('ドライバーのメールアドレスが未登録です（スタッフ編集で登録してください）', 'err'); return;
    }
    if (!confirm(`${drv.display_name || email} 宛に送迎情報をメール送信しますか？\n送信先: ${email}`)) return;
    try {
      await apiPost('/bookings.php?action=send-pickup-mail', { id: Number(id), leg: dir, driver_id: Number(driverId), subject: info.subject, body: info.text });
      toast('✓ ' + (drv.display_name || email) + ' にメール送信しました', 'ok');
      closeTimeAdjust();
      loadTimeline(true);  // 送信済みの色(金色)を反映
    } catch (e) { toast('メール送信失敗: ' + e.message, 'err'); }
  }

  // 下段クリック → ドライバー指定 + 送迎情報コピー のポップ
  function openDriverAssign(id, dir, anchor) {
    closeTimeAdjust();
    const b = _tlBookingMap[id];
    if (!b) return;
    const isGo = dir === 'go';
    const curDrv = isGo ? (b.driver_id || '') : (b.back_driver_id || '');
    // ドライバー候補 = ロールがドライバー、または兼任(can_drive)のスタッフ
    const drivers = (adminUsersAll || []).filter(u => isDriverCapable(u));
    const opts = '<option value="">自走（ドライバーなし）</option>' +
      drivers.map(u => `<option value="${u.id}" ${String(u.id) === String(curDrv) ? 'selected' : ''}>${escapeHtml(u.display_name || u.username)}</option>`).join('');
    const pop = document.createElement('div');
    pop.id = 'tlDrvPop';
    pop.className = 'tl-time-pop';
    pop.innerHTML = `<div class="ttp-head"><span class="ttp-label">${isGo ? '行き（送り）' : '帰り（迎え）'}の送迎</span><button class="ttp-close" type="button" aria-label="閉じる">×</button></div>
      <select class="ttp-sel" id="tlDrvSel">${opts}</select>
      <button type="button" class="ttp-mail" id="tlDrvMail">✉️ メール送信</button>
      <button type="button" class="ttp-copy" id="tlDrvCopy">📋 送迎情報をコピー</button>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + window.scrollY + 4) + 'px';
    pop.style.left = (r.left + window.scrollX) + 'px';
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) pop.style.left = (window.innerWidth - pr.width - 8 + window.scrollX) + 'px';
    pop.querySelector('.ttp-close').addEventListener('click', (e) => { e.stopPropagation(); closeTimeAdjust(); });
    const sel = pop.querySelector('#tlDrvSel');
    sel.addEventListener('change', async (e) => {
      e.stopPropagation();
      const dv = parseInt(e.target.value, 10) || 0;
      sel.disabled = true;
      try {
        const res = await apiPost('/bookings.php?action=set-driver', { id, leg: dir, driver_id: dv });
        const nm = dv ? (drivers.find(u => String(u.id) === String(dv))?.display_name || '') : '';
        if (isGo) { b.driver_id = dv || null; b.driver_name = nm; b.pickup_go_time = res.pickup_time; }
        else { b.back_driver_id = dv || null; b.back_driver_name = nm; b.pickup_back_time = res.pickup_time; }
        toast('✓ ' + (dv ? nm + ' を割当' : '自走に設定'), 'ok');
        loadTimeline(true);
        sel.disabled = false;
      } catch (err) { toast('更新失敗: ' + err.message, 'err'); sel.disabled = false; }
    });
    pop.querySelector('#tlDrvMail').addEventListener('click', (e) => { e.stopPropagation(); sendPickupMail(id, dir); });
    pop.querySelector('#tlDrvCopy').addEventListener('click', (e) => { e.stopPropagation(); copyPickup(id, dir); });
    setTimeout(() => document.addEventListener('click', _ttpOutside, true), 0);
  }

  function scrollTimelineToNow() {
    const scroller = document.querySelector('.tl-wrap');
    const grid = document.getElementById('timelineGrid')?.querySelector('.tl-grid');
    if (!scroller || !grid) return;
    const now = new Date();
    const curH = now.getHours() + now.getMinutes() / 60;
    let offsetH = curH - 10;            // 営業開始 10:00 起点
    if (offsetH < 0) offsetH += 24;     // 深夜帯は翌日扱い
    if (offsetH > 24) offsetH = 24;
    // 1時間セル幅を実測 (PC=96px / mobile=72px)
    const headCells = grid.querySelectorAll('.tl-head:not(.staff-col)');
    if (headCells.length < 2) return;
    const hourWidth = headCells[0].getBoundingClientRect().width;
    // 現在時刻のセルを画面左 25% に配置 → 直前 2〜3 時間も視野に入る
    const padCells = Math.max(1, Math.floor(scroller.clientWidth / hourWidth * 0.25));
    const targetLeft = Math.max(0, (offsetH - padCells) * hourWidth);
    scroller.scrollTo({ left: targetLeft, behavior: 'auto' });
  }

  // タイムラインから新規予約を開くときの日付＝表示中の営業日（日付欄は営業日基準。保存時に開始時刻からカレンダー日へ変換）
  function tlPrefillDate() {
    return fmtDate(tlCurrentDate);
  }
  // 24h+時刻 (例 "26:30") を 10時起点の0〜24の数値オフセットに変換
  // 10:00→0, 11:00→1, ..., 24:00→14, 26:30→16.5, 33:59→23.98
  function timeToOffset(ext) {
    const m = String(ext).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return 0;
    return parseInt(m[1], 10) + parseInt(m[2], 10) / 60 - 10;
  }

  // スタッフ列の出勤/休みトグル（owner/manager）。その日のシフト status を切替（無ければ受付時間で作成）
  async function setStaffAttendance(adminId, status) {
    try {
      await apiPost('/shifts.php?action=set-attendance', { admin_user_id: adminId, shift_date: fmtDate(tlCurrentDate), status });
      toast(status === 'off' ? '休みにしました' : status === 'done' ? '終了にしました' : status === 'tentative' ? '予定にしました' : '出勤にしました', 'ok');
      await loadTimeline(true);
    } catch (e) { toast('更新失敗: ' + e.message, 'err'); }
  }

  // クレジット決済のキャスト負担カード手数料 = 売上全額(price+trans) ×(手数料率÷2)%。現金/振込は0
  function cardFeeSelf(price, trans, pm) {
    if (pm !== 'credit' && pm !== 'card') return 0;
    return Math.floor(((price || 0) + (trans || 0)) * (CARD_FEE_RATE / 2) / 100);
  }
  // キャスト報酬の算出（サーバ ylkaReward と同式）: 深夜=帰り送迎ありは店、出張費は片道max(½,850)を送迎分だけ店取り
  // pm(payment_method) がクレジットのときはカード手数料のキャスト負担分を差し引く
  // rewardOverride: 予約単位の手入力オーバーライド（微調整用）が入っていればそれをそのまま返す
  // コース名から、マスタに登録された「キャスト報酬」を引く（admi 方式）。
  // 未登録・見つからない場合は null を返し、歩合率(%)方式にフォールバックする。
  function courseCastReward(courseName) {
    if (!courseName) return null;
    const c = (coursesCache || []).find(x => String(x.name) === String(courseName));
    if (!c || c.cast_reward == null || c.cast_reward === '') return null;
    return parseInt(c.cast_reward, 10) || 0;
  }
  function calcReward(price, late, trans, rate, goDrv, backDrv, pm, rewardOverride, courseName) {
    if (rewardOverride !== undefined && rewardOverride !== null && rewardOverride !== '') return parseInt(rewardOverride, 10) || 0;
    const lateT = backDrv ? 0 : late;
    let transT = 0;
    if (trans > 0) { const perLeg = Math.max(Math.floor(trans / 2), 850); let shop = (goDrv ? perLeg : 0) + (backDrv ? perLeg : 0); if (shop > trans) shop = trans; transT = trans - shop; }
    // admi: マスタのコース別「キャスト報酬」を優先。無ければ従来の歩合率(%)で算出
    const fixed = courseCastReward(courseName);
    const base = (fixed !== null) ? fixed : Math.floor((price - late) * rate / 100);
    return base + lateT + transT - cardFeeSelf(price, trans, pm);
  }
  // 時刻のテキスト表示は実時刻・0埋めなし（例 02:00→2:00）。24h+表記(displayTime)は位置計算・ソート専用
  function fmtTimeDisp(t) { return String(t || '').slice(0, 5).replace(/^0/, ''); }
  // 現金を預からない決済（カード/振込）。預り金・入金分の「現金の所在」追跡から除外する
  const NON_CASH_PM = ['credit', 'card', 'bank'];
  const isNonCash = (b) => NON_CASH_PM.includes(String(b.payment_method || ''));
  const pmBadge = (b) => String(b.payment_method) === 'bank' ? '🏦 振込' : '💳 カード';
  // 兼任判定: role(主ロール)に加え is_therapist/is_office/can_drive の兼任フラグも見る（例: 橘=role manager だが is_therapist/is_office 兼任）
  const isTherapistCapable = (u) => u.role === 'staff' || Number(u.is_therapist) === 1;
  const isOfficeCapable = (u) => u.role === 'office' || Number(u.is_office) === 1;
  const isDriverCapable = (u) => u.role === 'driver' || Number(u.can_drive) === 1;

  // スタッフ列の「売上」クリック → その人が保有する売上の内訳＋保有者の付け替え（owner/manager）
  function openHolderModal(adminId) {
    if (!document.getElementById('holderModal')) { toast('画面を再読み込みしてください', 'err'); return; }
    const bizDay = fmtDate(tlCurrentDate);
    const earned = tlBookings.filter(b =>
      bizDateOf(b.booking_date, b.start_time) === bizDay && b.status === 'completed'
      && Number(b.assigned_admin_id) === Number(adminId)
    );
    const drivers = (adminUsersAll || []).filter(u => isDriverCapable(u));
    const me = (adminUsersAll || []).find(u => Number(u.id) === Number(adminId)) || {};
    const nameOf = (id) => { const d = (adminUsersAll || []).find(u => Number(u.id) === Number(id)); return d ? (d.display_name || d.username) : '—'; };
    const meRate = Number(me.commission_rate);
    const meHasRate = me.commission_rate != null && me.commission_rate !== '' && !Number.isNaN(meRate);
    document.getElementById('holderModalTitle').textContent = `${me.display_name || me.username || ''} の入金（店入金分）`;
    // 入金分（店取り分）= 全額 − 報酬
    const netOf = (b) => {
      const price = Number(b.price) || 0, late = Number(b.late_fee) || 0, trans = Number(b.transport_fee) || 0;
      const amt = price + trans;
      const reward = meHasRate ? calcReward(price, late, trans, meRate, !!b.driver_id, !!b.back_driver_id, b.payment_method, b.reward_override, b.course_name) : 0;
      return amt - reward;
    };
    const netTotal = earned.reduce((s, b) => s + netOf(b), 0);
    // 入金分の保有者 = 預り金の保有者（held_by。無ければ受領者/担当）。カード/振込は最初から店の口座
    const netHolderOf = (b) => {
      if (isNonCash(b)) return `${pmBadge(b)}入金`;
      if (b.held_by != null && b.held_by !== '') return nameOf(b.held_by);
      if (b.shop_settled && b.shop_settled_by) return nameOf(b.shop_settled_by);
      return nameOf(b.assigned_admin_id);
    };
    // 誰が入金分をいくら持っているか（人別合計）。精算確定済みは別枠
    const netHolderTotals = new Map();
    let settledNetTotal = 0, settledCount = 0;
    earned.forEach(b => {
      if (b.shop_settled) { settledNetTotal += netOf(b); settledCount++; return; }
      const nm = netHolderOf(b);
      netHolderTotals.set(nm, (netHolderTotals.get(nm) || 0) + netOf(b));
    });
    const netSummary = earned.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:.4rem;margin:.35rem 0 .55rem;">
          ${[...netHolderTotals.entries()].map(([nm, v]) => `<span class="chain-now-badge">📍 ${escapeHtml(nm)}：<b>${yen(v)}</b></span>`).join('')}
          ${settledCount ? `<span class="chain-now-badge" style="border-color:#8ed3a6;background:#e9f7ee;color:#2e7d4f;">✅ 精算済み：<b>${yen(settledNetTotal)}</b>（${settledCount}件）</span>` : ''}
        </div>`
      : '';
    // 締め: 未精算をまとめて精算確定
    const unsettledList = earned.filter(b => !b.shop_settled);
    const batchSettleBtn = unsettledList.length
      ? `<button class="sbtn holder-settle-all" type="button" style="margin-bottom:.7rem;padding:.5rem .9rem;font-weight:700;background:var(--green);color:#fff;border:none;width:100%;">✓ 本日分をまとめて精算確定（${unsettledList.length}件）</button>`
      : '';
    // 受け渡し候補（未割当を除く全スタッフ）
    const people = (adminUsersAll || []).filter(u => u.id && u.role !== 'unassigned');
    let html = `<div style="font-weight:700;">入金分合計 ${yen(netTotal)}（${earned.length}件）</div>
      ${netSummary}
      <div style="font-size:.8rem;color:var(--ink-soft);margin-bottom:.7rem;">入金分（預り金 − 報酬）を誰がいくら持っているかを表示します。お金のやり取りが終わったお仕事は「精算確定」で締めてください。</div>${batchSettleBtn}`;
    if (!earned.length) html += '<p style="color:var(--ink-soft);">この日の入金はありません。</p>';
    earned.forEach(b => {
      const price = Number(b.price) || 0, late = Number(b.late_fee) || 0, trans = Number(b.transport_fee) || 0;
      const amt = price + trans;
      const reward = meHasRate ? calcReward(price, late, trans, meRate, !!b.driver_id, !!b.back_driver_id, b.payment_method, b.reward_override, b.course_name) : 0;
      const net = amt - reward;
      const head = `<div style="display:flex;justify-content:space-between;gap:.5rem;"><span>${formatDate(bizDay)} ${escapeHtml(fmtTimeDisp(b.start_time))}・${escapeHtml(b.customer_name_snapshot || '—')}</span><span style="white-space:nowrap;"><b>${yen(net)}</b><small style="color:var(--ink-soft);font-weight:500;"> ／全額 ${yen(amt)}</small></span></div>
        <div style="margin-top:.35rem;"><span class="chain-now-badge">📍 <b>${escapeHtml(netHolderOf(b))}</b></span></div>`;
      // 精算済み: バッジ＋取消のみ。未精算: 受け渡し＋精算確定ボタン
      let ctrl = '';
      if (b.shop_settled) {
        ctrl = `<div style="display:flex;gap:.5rem;align-items:center;margin-top:.4rem;flex-wrap:wrap;">
            <span style="font-size:.82rem;font-weight:700;color:#2e9e5b;">✅ 精算済み — このお仕事のお金のやり取りは終了</span>
            <button class="sbtn settle-undo" data-id="${b.id}" type="button" style="padding:.3rem .55rem;font-size:.74rem;">取消</button>
          </div>`;
      } else {
        let handoffUi = '';
        if (!isNonCash(b) && !b.reward_paid_at && meHasRate) {
          const curHolder = (b.held_by != null && b.held_by !== '') ? Number(b.held_by) : Number(b.assigned_admin_id);
          const opts = people.filter(p => Number(p.id) !== curHolder)
            .map(p => `<option value="${p.id}">${escapeHtml(p.display_name || p.username)}${p.role === 'driver' ? '（ドライバー）' : ''}</option>`).join('');
          handoffUi = `<select class="net-to" data-id="${b.id}" style="flex:1;min-width:0;padding:.35rem .4rem;border:1.5px solid var(--gray);border-radius:8px;"><option value="">渡す先…</option>${opts}</select>
            <button class="sbtn net-handoff" data-id="${b.id}" data-net="${net}" data-reward="${reward}" type="button" style="padding:.35rem .6rem;font-weight:700;white-space:nowrap;">入金分を渡す（${yen(net)}）</button>`;
        }
        ctrl = `<div style="display:flex;gap:.35rem;align-items:center;margin-top:.4rem;flex-wrap:nowrap;">
            ${handoffUi}
            <button class="sbtn settle-confirm" data-id="${b.id}" data-rwddone="${b.reward_paid_at ? 1 : 0}" data-desc="${escapeAttr(`${formatDate(bizDay)} ${b.customer_name_snapshot || '—'}`)}" type="button" style="padding:.35rem .6rem;font-weight:700;white-space:nowrap;background:var(--green);color:#fff;border:none;">✓ 精算確定</button>
          </div>`;
      }
      html += `<div style="border:1px solid var(--gray);border-radius:10px;padding:.6rem;margin-bottom:.5rem;${b.shop_settled ? 'opacity:.7;' : ''}">${head}${ctrl}</div>`;
    });
    document.getElementById('holderModalBody').innerHTML = html;
    const holderReload = async () => { await loadTimeline(true); openHolderModal(adminId); };
    document.querySelectorAll('#holderModalBody .settle-confirm').forEach(btn => btn.addEventListener('click', async () => {
      const warn = btn.dataset.rwddone === '1' ? '' : '\n※ 報酬はまだ「渡し済み」になっていません。';
      if (!confirm(`「${btn.dataset.desc}」のお金のやり取りを終了（精算確定）します。${warn}\nよろしいですか？`)) return;
      btn.disabled = true;
      try { await apiPost('/admin-api.php?action=booking-settle', { id: Number(btn.dataset.id), settled: 1, kind: 'full' }); toast('✓ 精算確定しました', 'ok'); await holderReload(); }
      catch (e) { toast('確定失敗: ' + e.message, 'err'); btn.disabled = false; }
    }));
    document.querySelectorAll('#holderModalBody .settle-undo').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('精算確定を取り消しますか？')) return;
      btn.disabled = true;
      try { await apiPost('/admin-api.php?action=booking-settle', { id: Number(btn.dataset.id), settled: 0 }); toast('精算確定を取り消しました', 'ok'); await holderReload(); }
      catch (e) { toast('取消失敗: ' + e.message, 'err'); btn.disabled = false; }
    }));
    const settleAllBtn = document.querySelector('#holderModalBody .holder-settle-all');
    if (settleAllBtn) settleAllBtn.addEventListener('click', async () => {
      const ids = unsettledList.map(b => b.id);
      const noRwd = unsettledList.filter(b => !b.reward_paid_at).length;
      const warn = noRwd ? `\n※ うち${noRwd}件は報酬がまだ「渡し済み」になっていません。` : '';
      if (!confirm(`本日分 ${ids.length}件をまとめて精算確定します。${warn}\nよろしいですか？`)) return;
      settleAllBtn.disabled = true;
      try { await apiPost('/admin-api.php?action=booking-settle-batch', { ids, kind: 'full' }); toast(`${ids.length}件を精算確定しました`, 'ok'); await holderReload(); }
      catch (e) { toast('確定失敗: ' + e.message, 'err'); settleAllBtn.disabled = false; }
    });
    document.querySelectorAll('#holderModalBody .net-handoff').forEach(btn => btn.addEventListener('click', async () => {
      const sel = document.querySelector(`#holderModalBody .net-to[data-id="${btn.dataset.id}"]`);
      const to = sel && sel.value;
      if (!to) { toast('渡す先を選んでください', 'err'); return; }
      const toName = nameOf(to);
      const meName = me.display_name || me.username || '担当';
      if (!confirm(`入金分 ${yen(Number(btn.dataset.net))} を ${toName} に渡します。\n報酬 ${yen(Number(btn.dataset.reward))} は ${meName} の手元に残る記録になります。よろしいですか？`)) return;
      btn.disabled = true;
      try {
        await apiPost('/admin-api.php?action=booking-net-handoff', { id: Number(btn.dataset.id), to_admin_id: Number(to) });
        toast(`入金分を ${toName} に渡しました（報酬は${meName}保持）`, 'ok');
        await loadTimeline(true);
        openHolderModal(adminId);
      } catch (e) { toast('記録失敗: ' + e.message, 'err'); btn.disabled = false; }
    }));
    openModal('holderModal');
  }

  // ドライバー詳細: その日の送迎(送り/お迎え)・保有預り金・勤務実績(出勤/退勤/走行km)。owner/manager が入力
  let driverModalCtx = { id: null, name: '', date: null };
  async function openDriverModal(driverId, date) {
    if (!document.getElementById('driverModal')) { toast('画面を再読み込みしてください', 'err'); return; }
    const u = (adminUsersAll || allUsers || []).find(x => Number(x.id) === Number(driverId)) || {};
    const dstr = date || fmtDate(tlCurrentDate);
    driverModalCtx = { id: Number(driverId), name: u.display_name || u.username || 'ドライバー', date: dstr };
    document.getElementById('driverModalTitle').textContent = `🚗 ${driverModalCtx.name}`;
    const body = document.getElementById('driverModalBody');
    body.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    openModal('driverModal');
    let d;
    try { d = await api(`/admin-api.php?action=driver-day&driver_id=${driverId}&date=${dstr}`); }
    catch (e) { body.innerHTML = '<p style="color:var(--coral);">読み込み失敗: ' + escapeHtml(e.message) + '</p>'; return; }
    renderDriverModal(d);
  }
  function renderDriverModal(d) {
    const body = document.getElementById('driverModalBody');
    const log = d.log || {};
    // 勤務時間 = 退勤 − 出勤（退勤<出勤は日跨ぎ +24h）
    let wm = null;
    if (log.clock_in && log.clock_out) {
      const [h1, m1] = log.clock_in.split(':').map(Number);
      const [h2, m2] = log.clock_out.split(':').map(Number);
      wm = (h2 * 60 + m2) - (h1 * 60 + m1); if (wm < 0) wm += 24 * 60;
    }
    const wmStr = wm != null ? `${Math.floor(wm / 60)}時間${wm % 60 ? (wm % 60) + '分' : ''}` : '—';
    const nav = `<div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.8rem;">
        <button class="sbtn dm-day" data-delta="-1" type="button" style="padding:.35rem .7rem;">‹ 前日</button>
        <b style="font-family:'Outfit';">${formatDate(d.date)}</b>
        <button class="sbtn dm-day" data-delta="1" type="button" style="padding:.35rem .7rem;">翌日 ›</button>
      </div>`;
    const logForm = `
      <div style="background:var(--foam);border-radius:12px;padding:.8rem;margin-bottom:.9rem;">
        <div style="font-weight:700;margin-bottom:.5rem;">🕒 勤務実績</div>
        <div style="display:flex;gap:.7rem;flex-wrap:wrap;align-items:flex-end;">
          <label style="font-size:.76rem;color:var(--ink-soft);">出勤<br><input id="dmCi" type="time" value="${log.clock_in || ''}" style="padding:.4rem;border:1.5px solid var(--gray);border-radius:8px;"></label>
          <label style="font-size:.76rem;color:var(--ink-soft);">退勤<br><input id="dmCo" type="time" value="${log.clock_out || ''}" style="padding:.4rem;border:1.5px solid var(--gray);border-radius:8px;"></label>
          <label style="font-size:.76rem;color:var(--ink-soft);">走行距離(km)<br><input id="dmKm" type="number" step="0.1" min="0" value="${log.distance_km != null ? log.distance_km : ''}" style="width:92px;padding:.4rem;border:1.5px solid var(--gray);border-radius:8px;"></label>
          <div style="font-size:.76rem;color:var(--ink-soft);">勤務時間<br><b style="font-size:1rem;color:var(--deep);">${wmStr}</b></div>
        </div>
        <input id="dmNote" type="text" placeholder="メモ（任意）" value="${escapeAttr(log.note || '')}" style="width:100%;box-sizing:border-box;margin-top:.55rem;padding:.4rem;border:1.5px solid var(--gray);border-radius:8px;">
        <button id="dmSave" type="button" class="sbtn" style="margin-top:.55rem;padding:.5rem .9rem;font-weight:700;background:var(--green);color:#fff;border:none;">保存</button>
      </div>`;
    const legList = (arr, label) => {
      if (!arr.length) return `<div style="color:var(--ink-soft);font-size:.82rem;padding:.3rem 0;">${label}の送迎はありません</div>`;
      return arr.map(x => `<div style="display:flex;justify-content:space-between;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--foam);">
          <div style="min-width:0;">
            <b>${x.pickup ? escapeHtml(x.pickup) : '—'}</b> <span style="font-size:.82rem;">${escapeHtml(x.therapist)}</span>
            <div style="font-size:.74rem;color:var(--ink-soft);">${escapeHtml(x.customer || '—')}${x.place ? '・' + escapeHtml(x.place) : ''}${x.room ? ' ' + escapeHtml(x.room) : ''}</div>
          </div>
          <div style="font-size:.72rem;color:var(--ink-soft);white-space:nowrap;">接客 ${escapeHtml(x.start_time)}〜${escapeHtml(x.end_time)}</div>
        </div>`).join('');
    };
    const custodyHtml = d.custody.length
      ? d.custody.map(c => `<div style="display:flex;justify-content:space-between;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--foam);">
          <span style="font-size:.84rem;">${escapeHtml(c.customer || '—')} <small style="color:var(--ink-soft);">/ ${escapeHtml(c.therapist)}</small></span>
          <b style="white-space:nowrap;">${yen(c.amount)}</b>
        </div>`).join('') + `<div style="text-align:right;font-weight:800;margin-top:.4rem;color:var(--deep);">保有合計 ${yen(d.custody_total)}</div>`
      : '<div style="color:var(--ink-soft);font-size:.82rem;">現在このドライバーが預かっている現金はありません</div>';
    body.innerHTML = nav + logForm
      + `<div style="font-weight:700;margin:.2rem 0 .3rem;">🚗 送り（${d.go.length}）</div>${legList(d.go, '送り')}`
      + `<div style="font-weight:700;margin:.9rem 0 .3rem;">🏠 お迎え（${d.back.length}）</div>${legList(d.back, 'お迎え')}`
      + `<div style="font-weight:700;margin:.9rem 0 .3rem;">💰 預かっている現金</div>${custodyHtml}`;
    document.getElementById('dmSave').addEventListener('click', async () => {
      const btn = document.getElementById('dmSave'); btn.disabled = true;
      try {
        await apiPost('/admin-api.php?action=driver-log-upsert', {
          driver_id: driverModalCtx.id, work_date: driverModalCtx.date,
          clock_in: document.getElementById('dmCi').value,
          clock_out: document.getElementById('dmCo').value,
          distance_km: document.getElementById('dmKm').value,
          note: document.getElementById('dmNote').value,
        });
        toast('勤務実績を保存しました', 'ok');
        openDriverModal(driverModalCtx.id, driverModalCtx.date);
      } catch (e) { toast('保存失敗: ' + e.message, 'err'); btn.disabled = false; }
    });
    document.querySelectorAll('#driverModalBody .dm-day').forEach(b => b.addEventListener('click', () => {
      const nd = fmtDate(addDays(driverModalCtx.date + 'T12:00:00', Number(b.dataset.delta)));
      openDriverModal(driverModalCtx.id, nd);
    }));
  }

  // 現金まとめ: 本日出勤スタッフが現在いくら預り金を持っているかを一覧表示（owner/manager）
  async function openCashSummaryModal() {
    const el = document.getElementById('cashSummaryBody');
    if (!el) { toast('画面を再読み込みしてください', 'err'); return; }
    el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    openModal('cashSummaryModal');
    let data;
    try { data = await api('/admin-api.php?action=cash-summary'); }
    catch (e) { el.innerHTML = '<p style="color:var(--coral);">読み込み失敗: ' + escapeHtml(e.message) + '</p>'; return; }

    const nameOf = (id, name, uname) => name || uname || ('#' + id);
    let html = '';

    // ─ 預り金の保有状況（本日出勤のキャスト・内勤・ドライバーを名簿ベースで表示） ─
    // 報酬確定済み（渡し済み/本人確保）の予約は残額（全額−報酬）で計上
    const heldAmtOf = (b) => {
      const price = Number(b.price) || 0, late = Number(b.late_fee) || 0, trans = Number(b.transport_fee) || 0;
      const rate = Number(b.commission_rate);
      const hasRate = b.commission_rate != null && b.commission_rate !== '' && !Number.isNaN(rate);
      const amt = price + trans;
      if (b.reward_paid_at && hasRate) return amt - calcReward(price, late, trans, rate, !!b.driver_id, !!b.back_driver_id, b.payment_method, b.reward_override, b.course_name);
      return amt;
    };
    const unc = data.uncollected || [];
    // 現在の保有者ID別に集計（held_by優先、未設定なら担当本人）
    const byHolderId = {};
    unc.forEach(b => {
      const hId = Number(b.held_by != null ? b.held_by : b.assigned_admin_id);
      if (!byHolderId[hId]) byHolderId[hId] = [];
      byHolderId[hId].push(b);
    });
    // 本日出勤の名簿: シフト「出勤」中 or 本日の担当予約ありの キャスト/内勤/ドライバー
    const cashBizDay = fmtDate(tlCurrentDate);
    const onDutyIds = new Set();
    tlShifts.forEach(s => {
      if (String(s.shift_date).slice(0, 10) === cashBizDay && s.status === 'available') onDutyIds.add(Number(s.admin_user_id));
    });
    tlBookings.forEach(b => {
      if (b.assigned_admin_id && bizDateOf(b.booking_date, b.start_time) === cashBizDay
          && b.status !== 'cancelled' && b.status !== 'no_show') onDutyIds.add(Number(b.assigned_admin_id));
    });
    const roster = adminUsersAll.filter(u => onDutyIds.has(Number(u.id))
      && (isTherapistCapable(u) || isOfficeCapable(u) || isDriverCapable(u)));
    const rosterRoleBadge = (u) => {
      const badges = [];
      if (isOfficeCapable(u)) badges.push('🪪内勤');
      if (isDriverCapable(u)) badges.push('🚗ドライバー');
      return badges.length ? ' ' + badges.join(' ') : '';
    };

    html += `<div style="font-size:.95rem;font-weight:700;margin-bottom:.5rem;">💰 本日出勤スタッフの預り金（${roster.length}名）</div>`;
    if (!roster.length) {
      html += '<p style="color:var(--ink-soft);font-size:.86rem;margin-bottom:1rem;">本日出勤のスタッフはいません。</p>';
    } else {
      roster.forEach(u => {
        const items = byHolderId[Number(u.id)] || [];
        const total = items.reduce((s, b) => s + heldAmtOf(b), 0);
        html += `<div style="border:1px solid var(--gray);border-radius:10px;padding:.6rem;margin-bottom:.5rem;">
          <div style="font-weight:700;margin-bottom:.25rem;">📍 ${escapeHtml(nameOf(u.id, u.display_name, u.username))}${rosterRoleBadge(u)} <span style="font-weight:400;font-size:.8rem;color:var(--ink-soft);">計 ${yen(total)}（${items.length}件）</span></div>`;
        items.forEach(b => {
          const amt = heldAmtOf(b);
          const therapistNote = (b.held_by != null && Number(b.held_by) !== Number(b.assigned_admin_id))
            ? ` <span style="font-size:.74rem;color:var(--ink-soft);">担当:${escapeHtml(nameOf(b.assigned_admin_id, b.therapist_name, b.therapist_username))}</span>` : '';
          html += `<div style="font-size:.8rem;padding:.2rem 0;border-top:1px solid #eee;display:flex;justify-content:space-between;gap:.4rem;">
            <span>${formatDate(bizDateOf(b.booking_date, b.start_time || '00:00'))} ${fmtTimeDisp(b.start_time)} ${escapeHtml(b.customer_name_snapshot || '—')}${therapistNote}</span>
            <b style="white-space:nowrap;">${yen(amt)}</b></div>`;
        });
        html += '</div>';
      });
      // 本日出勤名簿に含まれない保有者がいれば見落とし防止に表示（前日以前からの繰越等）
      const rosterIds = new Set(roster.map(u => Number(u.id)));
      const strayIds = Object.keys(byHolderId).map(Number).filter(id => !rosterIds.has(id));
      if (strayIds.length) {
        html += '<div style="font-size:.78rem;color:var(--coral-deep);margin:.6rem 0 .3rem;">⚠ 本日出勤名簿以外で保有中（繰越分など）</div>';
        strayIds.forEach(id => {
          const items = byHolderId[id];
          const total = items.reduce((s, b) => s + heldAmtOf(b), 0);
          const first = items[0];
          const name = (first.held_by != null && Number(first.held_by) === id)
            ? nameOf(id, first.holder_name, first.holder_username)
            : nameOf(id, first.therapist_name, first.therapist_username);
          html += `<div style="font-size:.8rem;padding:.2rem 0;display:flex;justify-content:space-between;">
            <span>📍 ${escapeHtml(name)}</span><b>${yen(total)}（${items.length}件）</b></div>`;
        });
      }
    }

    el.innerHTML = html;
  }

  // スタッフ列の「預り金」クリック → その人の当日売上(予約ごと)の受け渡しの流れを表示・記録（owner/manager）
  //   起点=担当本人。各ホップを booking_handoffs に記録、現在保有者は held_by で同期。連鎖で店受領まで。
  async function openHeldChainModal(adminId) {
    if (!document.getElementById('chainModal')) { toast('画面を再読み込みしてください', 'err'); return; }
    const bizDay = fmtDate(tlCurrentDate);
    const earned = tlBookings.filter(b =>
      bizDateOf(b.booking_date, b.start_time) === bizDay && b.status === 'completed'
      && Number(b.assigned_admin_id) === Number(adminId)
    );
    const me = (adminUsersAll || []).find(u => Number(u.id) === Number(adminId)) || {};
    const nameOf = (id) => {
      if (id === null || id === undefined || id === '') return '—';
      const d = (adminUsersAll || []).find(u => Number(u.id) === Number(id));
      return d ? (d.display_name || d.username) : ('#' + id);
    };
    // 受け渡し候補（担当本人を含む全スタッフ＋ドライバー、未割当を除く）。
    // 本人も含めるのは「一旦渡した預り金を本人に戻す」ケースがあるため。現在の保有者は opts 側で除外する。
    const people = (adminUsersAll || []).filter(u => u.id && u.role !== 'unassigned');
    // 本人の歩合率（入金分＝全額−報酬 の算出用）
    const meRate = Number(me.commission_rate);
    const meHasRate = me.commission_rate != null && me.commission_rate !== '' && !Number.isNaN(meRate);
    document.getElementById('chainModalTitle').textContent = `${me.display_name || me.username || ''} の預り金 受け渡し`;
    const body = document.getElementById('chainModalBody');
    body.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    openModal('chainModal');

    let handoffs = [];
    if (earned.length) {
      try {
        const res = await api(`/admin-api.php?action=booking-handoffs&ids=${earned.map(b => b.id).join(',')}`);
        handoffs = res.handoffs || [];
      } catch (e) { body.innerHTML = '<p style="color:var(--coral);">読み込み失敗: ' + escapeHtml(e.message) + '</p>'; return; }
    }
    const byBooking = {};
    handoffs.forEach(h => { (byBooking[h.booking_id] = byBooking[h.booking_id] || []).push(h); });

    // 予約1件の「いま預り金として残っている額」: 報酬が確定（渡し済み/本人確保）なら残額（全額−報酬）
    const heldAmountOf = (b) => {
      if (isNonCash(b)) return 0;                                                  // カード/振込は現金を預からない
      const price = Number(b.price) || 0, late = Number(b.late_fee) || 0, trans = Number(b.transport_fee) || 0;
      const amt = price + trans;
      const reward = meHasRate ? calcReward(price, late, trans, meRate, !!b.driver_id, !!b.back_driver_id, b.payment_method, b.reward_override, b.course_name) : 0;
      if (b.reward_paid_at) return amt - reward;                                   // 報酬確定 → 残額（入金分）
      if (b.shop_settled && b.settle_kind === 'net') return amt - reward;          // 旧データ互換
      return amt;                                                                   // 全額のまま
    };
    // 予約1件の「いま持っている人」: 未受領→保有者、受領後→受領した人（報酬渡し済みなら渡した人=残額の保有者）
    const orShop = (id) => (id != null && id !== '') ? nameOf(id) : '店';
    const holderNameOf = (b) => {
      if (b.shop_settled) {
        const paidFull = b.reward_paid_at && b.settle_kind !== 'net';
        return orShop(paidFull ? (b.reward_paid_by ?? b.shop_settled_by) : b.shop_settled_by);
      }
      return nameOf((b.held_by != null && b.held_by !== '') ? b.held_by : b.assigned_admin_id);
    };
    const total = earned.reduce((s, b) => s + heldAmountOf(b), 0);
    const cashCount = earned.filter(b => !isNonCash(b)).length;
    const nonCashCount = earned.length - cashCount;
    // 誰がいくら持っているか（人別合計・現金のみ）
    const holderTotals = new Map();
    earned.forEach(b => {
      if (isNonCash(b)) return;
      const nm = holderNameOf(b);
      holderTotals.set(nm, (holderTotals.get(nm) || 0) + heldAmountOf(b));
    });
    const holderSummary = earned.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:.4rem;margin:.35rem 0 .55rem;">
          ${[...holderTotals.entries()].map(([nm, v]) => `<span class="chain-now-badge">📍 ${escapeHtml(nm)}：<b>${yen(v)}</b></span>`).join('')}
        </div>`
      : '';
    // 本人がいま持っている分をまとめて誰かに渡す（現金のみ）
    const holdableList = earned.filter(b => {
      if (isNonCash(b)) return false;
      const h = (b.held_by != null && b.held_by !== '') ? Number(b.held_by) : Number(b.assigned_admin_id);
      return h === Number(adminId);
    });
    const batchPeople = people.filter(p => Number(p.id) !== Number(adminId));
    const batchBtn = holdableList.length
      ? `<div style="display:flex;gap:.4rem;align-items:center;margin-bottom:.7rem;">
          <select id="chainBatchTo" style="flex:1;min-width:0;padding:.45rem .5rem;border:1.5px solid var(--gray);border-radius:8px;"><option value="">まとめて渡す先…</option>${batchPeople.map(p => `<option value="${p.id}">${escapeHtml(p.display_name || p.username)}${p.role === 'driver' ? '（ドライバー）' : ''}</option>`).join('')}</select>
          <button class="sbtn chain-handoff-all" type="button" style="padding:.45rem .8rem;font-weight:700;background:var(--sea);color:#fff;border:none;white-space:nowrap;">まとめて渡す（${holdableList.length}件）</button>
        </div>`
      : '';
    let html = `<div style="font-weight:700;">預り金合計 ${yen(total)}（${cashCount}件${nonCashCount ? `・ほか💳${nonCashCount}件` : ''}）</div>
      ${holderSummary}
      <div style="font-size:.78rem;color:var(--ink-soft);margin-bottom:.7rem;">いま誰がいくら持っているかは上のバッジで確認できます。「渡した先」を選ぶと受け渡しの流れが残ります。カード・振込は現金を預からないため対象外です。</div>${batchBtn}`;
    if (!earned.length) html += '<p style="color:var(--ink-soft);">この日の預り金はありません。</p>';

    earned.forEach(b => {
      const price = Number(b.price) || 0, late = Number(b.late_fee) || 0, trans = Number(b.transport_fee) || 0;
      const amt = price + trans;
      // カード/振込決済: 現金の預かりなし。受け渡しUIは出さずバッジのみ
      if (isNonCash(b)) {
        html += `<div style="border:1px solid var(--gray);border-radius:10px;padding:.6rem;margin-bottom:.5rem;opacity:.8;">
          <div style="display:flex;justify-content:space-between;gap:.5rem;">
            <span>${formatDate(bizDay)} ${escapeHtml(fmtTimeDisp(b.start_time))}・${escapeHtml(b.customer_name_snapshot || '—')}</span>
            <span style="white-space:nowrap;"><b>¥0</b><small style="color:var(--ink-soft);font-weight:500;"> ／${pmBadge(b)} ${yen(amt)}</small></span>
          </div>
          <div style="margin-top:.35rem;"><span class="chain-now-badge">${pmBadge(b)}決済・現金の預かりなし</span></div>
        </div>`;
        return;
      }
      // 入金分（店の取り分）= 全額 − 報酬。報酬は本人の歩合で算出
      const reward = meHasRate ? calcReward(price, late, trans, meRate, !!b.driver_id, !!b.back_driver_id, b.payment_method, b.reward_override, b.course_name) : 0;
      const net = amt - reward;
      const hops = byBooking[b.id] || [];
      const legacyHolder = (b.held_by != null && b.held_by !== '') ? Number(b.held_by)
                          : (b.shop_settled && b.shop_settled_by ? Number(b.shop_settled_by) : Number(b.assigned_admin_id));
      const curHolder = hops.length ? Number(hops[hops.length - 1].to_admin_id) : legacyHolder;
      // チェーン（担当→…→現在の保有者）。保有者は下のバッジで明示
      let chain = `<span class="chain-node start">${escapeHtml(nameOf(b.assigned_admin_id))}<small>担当</small></span>`;
      hops.forEach(h => { chain += `<span class="chain-arrow">→</span><span class="chain-node">${escapeHtml(nameOf(h.to_admin_id))}</span>`; });
      if (!hops.length && curHolder !== Number(b.assigned_admin_id)) {
        chain += `<span class="chain-arrow">→</span><span class="chain-node">${escapeHtml(nameOf(curHolder))}</span>`;
      }
      const held = heldAmountOf(b);
      const headAmt = held !== amt
        ? `<span style="white-space:nowrap;"><b>${yen(held)}</b><small style="color:var(--ink-soft);font-weight:500;"> ／全額 ${yen(amt)}</small></span>`
        : `<b style="white-space:nowrap;">${yen(amt)}</b>`;
      const head = `<div style="display:flex;justify-content:space-between;gap:.5rem;"><span>${formatDate(bizDay)} ${escapeHtml(fmtTimeDisp(b.start_time))}・${escapeHtml(b.customer_name_snapshot || '—')}</span>${headAmt}</div>`;
      const opts = people.filter(p => Number(p.id) !== Number(curHolder))
        .map(p => `<option value="${p.id}">${escapeHtml(p.display_name || p.username)}${p.role === 'driver' ? '（ドライバー）' : ''}</option>`).join('');
      const undo = hops.length ? `<button class="sbtn chain-undo" data-id="${b.id}" type="button" style="padding:.35rem .5rem;font-size:.78rem;white-space:nowrap;">↩ 直前を取消</button>` : '';
      const ctrl = `<div class="chain-ctrl">
          <span class="chain-now-badge">📍 いま持っている人：<b>${escapeHtml(nameOf(curHolder))}</b></span>
          <div style="display:flex;gap:.35rem;align-items:center;width:100%;flex-wrap:nowrap;">
            <select class="chain-to" data-id="${b.id}" style="flex:1;min-width:0;padding:.35rem .4rem;border:1.5px solid var(--gray);border-radius:8px;"><option value="">渡した先…</option>${opts}</select>
            <button class="sbtn chain-add" data-id="${b.id}" type="button" style="padding:.35rem .6rem;font-weight:700;white-space:nowrap;">渡した</button>
            ${undo}
          </div>
        </div>`;
      html += `<div style="border:1px solid var(--gray);border-radius:10px;padding:.6rem;margin-bottom:.5rem;">${head}<div class="chain-flow">${chain}</div>${ctrl}</div>`;
    });
    body.innerHTML = html;

    const reload = async () => { await loadTimeline(true); openHeldChainModal(adminId); };
    const handoffAllBtn = body.querySelector('.chain-handoff-all');
    if (handoffAllBtn) handoffAllBtn.addEventListener('click', async () => {
      const to = document.getElementById('chainBatchTo')?.value;
      if (!to) { toast('まとめて渡す先を選んでください', 'err'); return; }
      const ids = holdableList.map(b => b.id);
      if (!ids.length) return;
      if (!confirm(`本日分 ${ids.length}件を ${nameOf(to)} にまとめて渡します。よろしいですか？`)) return;
      handoffAllBtn.disabled = true;
      try { await apiPost('/admin-api.php?action=booking-handoff-batch', { ids, to_admin_id: Number(to) }); toast(`${ids.length}件を ${nameOf(to)} に渡しました`, 'ok'); await reload(); }
      catch (e) { toast('記録失敗: ' + e.message, 'err'); handoffAllBtn.disabled = false; }
    });
    body.querySelectorAll('.chain-add').forEach(btn => btn.addEventListener('click', async () => {
      const sel = body.querySelector(`.chain-to[data-id="${btn.dataset.id}"]`);
      const to = sel && sel.value;
      if (!to) { toast('渡した先を選んでください', 'err'); return; }
      btn.disabled = true;
      try { await apiPost('/admin-api.php?action=booking-handoff-add', { booking_id: Number(btn.dataset.id), to_admin_id: Number(to) }); toast('受け渡しを記録しました', 'ok'); await reload(); }
      catch (e) { toast('記録失敗: ' + e.message, 'err'); btn.disabled = false; }
    }));
    body.querySelectorAll('.chain-undo').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await apiPost('/admin-api.php?action=booking-handoff-undo', { booking_id: Number(btn.dataset.id) }); toast('直前の受け渡しを取消しました', 'ok'); await reload(); }
      catch (e) { toast('取消失敗: ' + e.message, 'err'); btn.disabled = false; }
    }));
  }

  // ============== 報酬専用モーダル: 報酬がいま誰の手元にあるか・誰が本人に渡したか ==============
  function openRewardModal(adminId) {
    if (!document.getElementById('rewardModal')) { toast('画面を再読み込みしてください', 'err'); return; }
    const bizDay = fmtDate(tlCurrentDate);
    const earned = tlBookings.filter(b =>
      bizDateOf(b.booking_date, b.start_time) === bizDay && b.status === 'completed'
      && Number(b.assigned_admin_id) === Number(adminId)
      && b.course_name !== '休憩' && b.customer_name_snapshot !== '【休憩】'
    );
    const me = (adminUsersAll || []).find(u => Number(u.id) === Number(adminId)) || {};
    const meName = me.display_name || me.username || '';
    const nameOf = (id) => {
      if (id === null || id === undefined || id === '') return '—';
      const d = (adminUsersAll || []).find(u => Number(u.id) === Number(id));
      return d ? (d.display_name || d.username) : ('#' + id);
    };
    const meRate = Number(me.commission_rate);
    const meHasRate = me.commission_rate != null && me.commission_rate !== '' && !Number.isNaN(meRate);
    document.getElementById('rewardModalTitle').textContent = `${meName} の報酬`;
    const body = document.getElementById('rewardModalBody');
    openModal('rewardModal');

    // 見やすい濃色の報酬ボタン（白背景に薄オレンジだと視認性が低いため coral-deep 系）
    const PAY_BTN = 'padding:.4rem .8rem;font-size:.82rem;font-weight:700;background:#e87a4f;color:#fff;border:none;border-radius:8px;';
    let totalReward = 0, unpaidReward = 0;
    const unpaidIds = [];
    const holderOf = (b) => (b.held_by != null && b.held_by !== '') ? Number(b.held_by)
                          : (b.shop_settled && b.shop_settled_by ? Number(b.shop_settled_by) : Number(b.assigned_admin_id));
    const items = earned.map(b => {
      const price = Number(b.price) || 0, late = Number(b.late_fee) || 0, trans = Number(b.transport_fee) || 0;
      const reward = meHasRate ? calcReward(price, late, trans, meRate, !!b.driver_id, !!b.back_driver_id, b.payment_method, b.reward_override, b.course_name) : 0;
      totalReward += reward;
      let statusHtml;
      if (b.reward_paid_at) {
        const selfKept = Number(b.reward_paid_by) === Number(b.assigned_admin_id);
        const payer = b.reward_paid_by ? nameOf(b.reward_paid_by) : '—';
        const label = selfKept
          ? `✅ 本人（${escapeHtml(meName)}）が保持 — 入金分を渡し済み`
          : `✅ 渡し済み：${escapeHtml(payer)} → ${escapeHtml(meName)}`;
        statusHtml = `<span style="font-size:.82rem;font-weight:700;color:#2e9e5b;">${label}</span>
          <span style="font-size:.72rem;color:var(--ink-soft);">${fmtDT(b.reward_paid_at)}</span>
          <button class="sbtn rwd-unpay" data-id="${b.id}" type="button" style="padding:.3rem .55rem;font-size:.74rem;">取消</button>`;
      } else {
        unpaidReward += reward; unpaidIds.push(b.id);
        const holderBadge = isNonCash(b)
          ? `<span class="chain-now-badge">${pmBadge(b)}決済・店が回収済み</span>`
          : `<span class="chain-now-badge">📍 いま <b>${escapeHtml(nameOf(holderOf(b)))}</b> が保有<small style="font-weight:500;">　預り金に含む</small></span>`;
        const payBtn = meHasRate
          ? `<button class="sbtn rwd-pay" data-id="${b.id}" data-desc="${escapeAttr(`${formatDate(bizDateOf(b.booking_date, b.start_time))} ${b.customer_name_snapshot || '—'}`)}" data-reward="${reward}" type="button" style="${PAY_BTN}">💸 ${escapeHtml(meName)}に報酬を渡す（${yen(reward)}）</button>`
          : '';
        statusHtml = `${holderBadge}${payBtn}`;
      }
      return `<div style="border:1px solid var(--gray);border-radius:10px;padding:.6rem;margin-bottom:.5rem;">
        <div style="display:flex;justify-content:space-between;gap:.5rem;">
          <span>${formatDate(bizDay)} ${escapeHtml(fmtTimeDisp(b.start_time))}・${escapeHtml(b.customer_name_snapshot || '—')}</span>
          <b style="white-space:nowrap;">${yen(reward)}</b>
        </div>
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:.45rem;margin-top:.4rem;">${statusHtml}</div>
      </div>`;
    });
    const batchBtn = (meHasRate && unpaidIds.length)
      ? `<button class="sbtn rwd-pay-all" type="button" style="width:100%;margin-bottom:.7rem;${PAY_BTN}padding:.55rem .9rem;">💸 まとめて${escapeHtml(meName)}に報酬を渡す（${yen(unpaidReward)}・${unpaidIds.length}件）</button>`
      : '';
    body.innerHTML = `<div style="font-weight:700;">報酬合計 ${yen(totalReward)}（${earned.length}件）</div>
      <div style="font-size:.78rem;color:var(--ink-soft);margin-bottom:.7rem;">各お仕事の報酬を ${escapeHtml(meName)} に渡したら 💸 で記録します。</div>
      ${batchBtn}
      ${earned.length ? items.join('') : '<p style="color:var(--ink-soft);">この日の報酬はありません。</p>'}`;

    body.querySelectorAll('.rwd-pay').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm(`「${btn.dataset.desc}」の報酬 ${yen(Number(btn.dataset.reward))} を ${meName} に渡した記録にします。よろしいですか？`)) return;
      btn.disabled = true;
      try {
        await apiPost('/admin-api.php?action=booking-reward-pay', { id: Number(btn.dataset.id), paid: 1 });
        toast('報酬を渡したと記録しました', 'ok');
        await loadTimeline(true);
        openRewardModal(adminId);
      } catch (e) { toast('記録失敗: ' + e.message, 'err'); btn.disabled = false; }
    }));
    body.querySelectorAll('.rwd-unpay').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('報酬を渡した記録を取り消します。よろしいですか？')) return;
      btn.disabled = true;
      try {
        await apiPost('/admin-api.php?action=booking-reward-pay', { id: Number(btn.dataset.id), paid: 0 });
        toast('報酬渡しを取り消しました', 'ok');
        await loadTimeline(true);
        openRewardModal(adminId);
      } catch (e) { toast('取消失敗: ' + e.message, 'err'); btn.disabled = false; }
    }));
    const payAllBtn = body.querySelector('.rwd-pay-all');
    if (payAllBtn) payAllBtn.addEventListener('click', async () => {
      if (!confirm(`未渡しの報酬 ${unpaidIds.length}件（${yen(unpaidReward)}）を ${meName} にまとめて渡した記録にします。よろしいですか？`)) return;
      payAllBtn.disabled = true;
      try {
        await apiPost('/admin-api.php?action=booking-reward-pay-batch', { ids: unpaidIds });
        toast(`${unpaidIds.length}件の報酬を渡しました`, 'ok');
        await loadTimeline(true);
        openRewardModal(adminId);
      } catch (e) { toast('記録失敗: ' + e.message, 'err'); payAllBtn.disabled = false; }
    });
  }

  function renderTimeline() {
    const grid = document.getElementById('timelineGrid');
    const bizDay = fmtDate(tlCurrentDate);

    // ヘッダー: スタッフ列 + 24時間スロット (10:00 〜 翌09:00)
    let html = '<div class="tl-grid"><div class="tl-head staff-col">キャスト</div>';
    for (let h = 10; h < 34; h++) {
      const displayH = h % 24;
      const isNext = h >= 24;
      html += `<div class="tl-head"><span class="tl-hour ${isNext?'next-day':''}">${('0'+displayH).slice(-2)}:00</span></div>`;
    }

    // スタッフ行: その営業日にシフトがあるスタッフのみ表示
    const dayShiftUserIds = new Set(
      tlShifts
        .filter(s => String(s.shift_date).slice(0, 10) === bizDay) // shift_date=営業日規約で直照合。available/off/tentative 全て（休みも薄く表示）
        .map(s => Number(s.admin_user_id))
    );
    // シフトが入っているスタッフ + 既に予約が割り当てられているスタッフ（キャスト兼任のみ。内勤/ドライバー専任は除外）
    const dayBookingUserIds = new Set(
      tlBookings
        .filter(b => bizDateOf(b.booking_date, b.start_time) === bizDay && b.assigned_admin_id)
        .map(b => Number(b.assigned_admin_id))
    );
    // 並び順は予約モーダルの担当プルダウンと共通（sortCastsByShift）。
    // 出勤開始が早い順 → 終了は最後 → 同着は sort_order
    const visibleStaff = sortCastsByShift(
      adminUsersAll.filter(u =>
        isTherapistCapable(u) && (dayShiftUserIds.has(Number(u.id)) || dayBookingUserIds.has(Number(u.id)))),
      tlShifts, bizDay);
    if (adminUsersAll.length === 0) {
      html += `<div class="tl-staff" style="grid-column:1/-1;text-align:center;padding:2rem;">キャストが登録されていません</div>`;
    } else {
      // シフト or 既存予約あるスタッフ + 「未割当」擬似行
      const usersWithUnassigned = [
        ...visibleStaff,
        { id: 0, display_name: 'キャスト未割当', role: 'unassigned' },
      ];
      // キャスト報酬の算出（モジュール共通の calcReward を使用）
      const tlReward = calcReward;
      // 出勤状態の3ステート: available=出勤 / tentative=予定 / off=休み（タップで順に切替）
      const ATT_NEXT  = { available: 'done', done: 'off', off: 'tentative', tentative: 'available' };
      const ATT_LABEL = { available: '出勤', done: '終了', off: '休み', tentative: '予定' };
      const ATT_BG    = { available: 'var(--sea)', done: '#7a7a7a', off: '#c0392b', tentative: '#a0aab4' };
      usersWithUnassigned.forEach(u => {
        const roleLabel = u.role === 'owner' ? 'オーナー'
                        : u.role === 'manager' ? '店長'
                        : u.role === 'office' ? '🪪 内勤スタッフ'
                        : u.role === 'driver' ? '🚗ドライバー'
                        : u.role === 'unassigned' ? '📅 担当未割当'
                        : 'キャスト';
        // その日の担当予約（キャンセル/無連絡/休憩を除く＝予約時点の計上基準）→ 件数と預り金に使用
        const dayJobs = (u.role !== 'unassigned')
          ? tlBookings.filter(b => bizDateOf(b.booking_date, b.start_time) === bizDay && Number(b.assigned_admin_id) === Number(u.id)
              && b.status !== 'cancelled' && b.status !== 'no_show'
              && b.course_name !== '休憩' && b.customer_name_snapshot !== '【休憩】')
          : [];
        const dayCount = dayJobs.length;
        const uRate = Number(u.commission_rate);
        const hasRate = u.commission_rate != null && u.commission_rate !== '' && !Number.isNaN(uRate);
        // 預り金・入金分は現金決済のみ（カード/振込は現金を預からない）。報酬は全決済で発生
        let heldSales = 0, heldReward = 0, heldShop = 0;
        dayJobs.forEach(b => {
          const price = Number(b.price) || 0, late = Number(b.late_fee) || 0, trans = Number(b.transport_fee) || 0;
          const amt = price + trans;
          const rw = hasRate ? tlReward(price, late, trans, uRate, !!b.driver_id, !!b.back_driver_id, b.payment_method, b.reward_override, b.course_name) : 0;
          if (hasRate) heldReward += rw;
          if (!isNonCash(b)) { heldSales += amt; heldShop += amt - rw; }
        });
        const canHolder = currentUser?.role === 'owner' || currentUser?.role === 'manager';
        // 担当キャスト行のみ数値を表示（0でも ¥0 を表示）。ドライバー/内勤/未割当は非表示（is_therapist兼任者は表示）
        const showSales = u.id && u.role !== 'unassigned' && ((u.role !== 'driver' && u.role !== 'office') || isTherapistCapable(u));
        // 右BOX: 件数 / 預り金 / 報酬 / 入金（報酬・入金は歩合のある owner/manager のみ。入金=店受取、クリックで受け渡し状況）
        const nyukinRow = !hasRate ? '' : (canHolder
          ? `<button type="button" class="tl-staff-sales tl-m" data-admin="${u.id}" title="入金分（預り金−報酬）のありか"><span class="tl-m-l">入金分</span><span class="tl-m-v">${yen(heldShop)} ▸</span></button>`
          : `<div class="tl-m"><span class="tl-m-l">入金分</span><span class="tl-m-v">${yen(heldShop)}</span></div>`);
        // 預り金: owner/manager はクリックで受け渡し履歴（担当→A→B→…→店）を表示・記録
        const heldRow = canHolder
          ? `<button type="button" class="tl-staff-held tl-m" data-admin="${u.id}" title="預り金の受け渡し履歴"><span class="tl-m-l">預り金</span><span class="tl-m-v">${yen(heldSales)} ▸</span></button>`
          : `<div class="tl-m"><span class="tl-m-l">預り金</span><span class="tl-m-v">${yen(heldSales)}</span></div>`;
        const metricsHtml = showSales
          ? `<div class="tl-m"><span class="tl-m-l">件数</span><span class="tl-m-v">${dayCount}件</span></div>`
            + heldRow
            + (hasRate ? (canHolder
                ? `<button type="button" class="tl-staff-reward tl-m" data-admin="${u.id}" title="報酬のありか・渡した記録"><span class="tl-m-l">報酬</span><span class="tl-m-v">${yen(heldReward)} ▸</span></button>`
                : `<div class="tl-m"><span class="tl-m-l">報酬</span><span class="tl-m-v">${yen(heldReward)}</span></div>`) : '')
            + nyukinRow
          : '';
        // 役職ラベルは機能的な driver / 未割当 / 内勤 のみ表示（店長・オーナー・キャストは非表示）
        const roleMini = (u.role === 'driver' || u.role === 'unassigned' || u.role === 'office') ? `<span class="role-mini">${roleLabel}</span>` : '';
        // 出勤状態トグル（owner/manager が操作）。3ステート: 予定→出勤→休み→予定
        const myShift = (u.id && u.role !== 'unassigned') ? tlShifts.find(s => Number(s.admin_user_id) === Number(u.id) && String(s.shift_date).slice(0, 10) === bizDay) : null;
        const isOff = !!(myShift && myShift.status === 'off');
        const attStatus = myShift ? (myShift.status || 'available') : 'available';
        // select は iOS Safari で innerHTML に含めると TypeError になるため placeholder を使い後で挿入
        const attToggle = (canHolder && u.id && u.role !== 'unassigned')
          ? `<span class="tl-att-ph" data-admin="${u.id}" data-state="${attStatus}"></span>`
          : '';
        const tlThumb = (u.id && u.role !== 'unassigned')
          ? (u.thumbnail_url
              ? `<img src="${escapeAttr(u.thumbnail_url)}" class="tl-staff-thumb" data-cast-edit="${u.id}" title="クリックでキャスト編集" alt="" loading="lazy">`
              : `<span class="tl-staff-thumb tl-staff-thumb-ph" data-cast-edit="${u.id}" title="クリックでキャスト編集">${escapeHtml(String(u.display_name || '?').slice(0,1))}</span>`)
          : '';
        // 出勤時間はシフト登録時に表示（アイコンなし）
        // 🔒＝CTRLの出勤を「OPSのみ」で登録した日。サイトにも媒体にも出していないので、
        //     スタッフが公開情報と誤解して案内しないよう明示する
        const isPrivateShift = !!(myShift && Number(myShift.is_private) === 1);
        const privateTag = isPrivateShift
          ? `<div class="tl-m tl-m-private" title="サイト・媒体には出していない出勤です"><span class="tl-m-l">🔒</span><span class="tl-m-v">サイト非掲載</span></div>`
          : '';
        const tlShiftTime = (myShift && myShift.start_time && myShift.end_time)
          ? `<div class="tl-m tl-m-time"><span class="tl-m-l">時間</span><span class="tl-m-v">${String(myShift.start_time).slice(0,5)}<span class="tl-m-wave">〜</span>${String(myShift.end_time).slice(0,5)}</span></div>`
          : '';
        html += `<div class="tl-staff${u.role==='unassigned'?' tl-staff-unassigned':''}" style="${isOff ? 'background:#eef1f3;color:var(--ink-soft);' : ''}"><div class="tl-staff-body"><div class="tl-staff-left">${tlThumb}<div class="tl-staff-name">${escapeHtml(u.display_name || u.username)}${(u.cast_notes || '').trim() ? `<span class="tl-staff-alert" data-cast-edit="${u.id}" title="${escapeAttr(u.cast_notes)}">⚠️</span>` : ''}</div>${attToggle}</div><div class="tl-staff-info">${tlShiftTime}${privateTag}${roleMini}${metricsHtml}</div></div></div>`;

        // この行の予約とシフト（営業日基準）
        // ドライバー行では driver_id=自分の予約、未割当行では assigned_admin_id=null/0 の予約
        const rowBookings = tlBookings.filter(b => {
          if (bizDateOf(b.booking_date, b.start_time) !== bizDay) return false;
          if (u.role === 'unassigned') return !b.assigned_admin_id;
          if (u.role === 'driver') return Number(b.driver_id) === Number(u.id) || Number(b.back_driver_id) === Number(u.id);
          return Number(b.assigned_admin_id) === Number(u.id);
        });
        const rowShifts = tlShifts.filter(s => Number(s.admin_user_id) === Number(u.id) && String(s.shift_date).slice(0, 10) === bizDay);

        // 24時間スロット（予約は row-area 内の独立レイヤーに描画＝sticky列の下層に閉じ込め透け防止）
        html += '<div class="tl-row-area">';
        for (let h = 10; h < 34; h++) {
          const slotStart = h;  // 10..33
          const slotEnd = h + 1;
          // このスロットがシフト時間内か？
          let inShift = false;
          rowShifts.forEach(s => {
            if (s.status !== 'available') return;
            // shift_date=営業日なので時刻だけで24h+化（10時前=翌側）
            const extT = (t) => { let h = parseInt(String(t).slice(0, 2), 10); if (h < 10) h += 24; return h + ':' + String(t).slice(3, 5); };
            const ss = timeToOffset(extT(s.start_time)) + 10;
            let se = timeToOffset(extT(s.end_time)) + 10;
            if (se <= ss) se = ss + 24;  // 24h (start===end) or 翌日跨ぎ
            if (slotStart >= ss && slotStart < se) inShift = true;
          });
          const slotTime = ('0' + (h % 24)).slice(-2) + ':00';
          html += `<div class="tl-cell ${inShift?'shift-bg':''}" data-date="${bizDay}" data-admin="${u.id}" data-hour="${h % 24}" data-ext-hour="${h}"></div>`;
          // 予約ブロックは row-area 内の独立レイヤー(.tl-bk-wrap)にまとめて配置（最初の反復で一度だけ）
          if (h === 10) {
            html += '<div class="tl-bk-wrap">';
            rowBookings.forEach(b => {
              const st = displayTime(b.booking_date, b.start_time, bizDay);
              let et = displayTime(b.booking_date, b.end_time, bizDay);
              const startOff = timeToOffset(st);  // 0..24
              let endOff = timeToOffset(et);
              // 終了が開始より数値的に早ければ翌日扱い (例: 23:00→00:00 を 23:00→24:00 として描画)
              if (endOff <= startOff) {
                endOff += 24;
                const [eh, em] = et.split(':');
                et = (parseInt(eh, 10) + 24) + ':' + em;
              }
              // 予約/休憩とも終了+10分の余地を視覚的に確保 (片付け・移動の見込み).
              endOff += 10 / 60;
              const widthSlots = Math.max(0.4, endOff - startOff);
              const leftPct = (startOff / 24) * (24 * 100);  // 単位は次のセル幅で計算
              // 1セル = 100% / 24 → 計算しなおし: cellのwrap = 24cells幅
              // wrap は最初のセルのみだから、 left = startOff * cellWidth, width = widthSlots * cellWidth
              // cellWidth はCSS gridで決まる(=計算しにくい) → calc()を使う
              const leftCalc = `calc((100% + 1px) / 24 * ${startOff})`;
              const widthCalc = `calc((100% + 1px) / 24 * ${widthSlots} - 4px)`;
              const name = b.customer_name || b.customer_name_snapshot || '匿名';
              const hotelFull = b.hotel_name || b.hotel_name_snapshot || '';
              // タイムラインは幅が狭いので、訪問先は市区町村名のみ表示 (ホテル名はそのまま, 住所は市まで)
              let hotel = hotelFull;
              const _hclean = hotelFull.replace(HOME_PREFIX, '').replace(OTHER_PREFIX, '');
              const _city = extractCityFromAddress(_hclean);
              if (hotelFull.startsWith(HOME_PREFIX)) hotel = _city ? '🏠' + _city : '🏠自宅';
              else if (hotelFull.startsWith(OTHER_PREFIX)) hotel = _hclean;
              // ホテル名(施設名)はそのまま全文 (CSS で省略表示)
              const go = b.pickup_go_time ? String(b.pickup_go_time).substring(0,5) : '';
              const back = b.pickup_back_time ? String(b.pickup_back_time).substring(0,5) : '';
              const goDrv = b.driver_name ? escapeHtml(b.driver_name) : '';
              const backDrv = b.back_driver_name ? escapeHtml(b.back_driver_name) : '';
              let pickupHtml = '';
              if (go || back) {
                const tip = [go ? '行き' + (goDrv ? '(' + goDrv + ')' : '') : '', back ? '帰り' + (backDrv ? '(' + backDrv + ')' : '') : ''].filter(Boolean).join(' / ');
                pickupHtml = `<div class="bk-pickup" title="送迎: ${tip}">${go ? `🚗送 ${go}` : ''}${go && back ? ' / ' : ''}${back ? `🚗迎 ${back}` : ''}</div>`;
              }
              // 表示用に 24時間超え表記(24:40,25:40,27:00..)を通常表記(0:40,1:40,3:00)へ
              const wrapHM = (hm) => { const p = String(hm).split(':'); const h = parseInt(p[0],10) % 24; return h + ':' + (p[1] || '00'); };
              const stDisp = wrapHM(st), etDisp = wrapHM(et);
              const titleText = `${stDisp}-${etDisp} ${name}${hotelFull ? ' / ' + hotelFull : ''}`;
              const isBreakRow = (b.course_name === '休憩') || (b.customer_name_snapshot === '【休憩】');
              const svc = svcState(b);                   // 未/始/確（接客ライフサイクル）
              const canMeet = !isBreakRow && svc !== null;  // CTRL で 未→始→確→未 を巡回操作
              _tlBookingMap[b.id] = b;
              // 3段目: 地名（市区町村、接尾辞なし）。ホテルは名前に市が無いのでマスタ/住所から取得
              let _cityRaw = _city;
              if (!hotelFull.startsWith(HOME_PREFIX) && !hotelFull.startsWith(OTHER_PREFIX)) {
                _cityRaw = b.display_city || b.hotel_city || extractCityFromAddress(b.hotel_address || '') || _city;
              }
              const placeShort = _cityRaw ? String(_cityRaw).replace(/[市区町村]$/, '') : '';
              // 4段目: 場所（自宅=ご自宅 / ホテル=ホテル名 / その他=詳細）
              let venue = '';
              if (hotelFull.startsWith(HOME_PREFIX)) venue = 'ご自宅';
              else if (hotelFull.startsWith(OTHER_PREFIX)) venue = hotelFull.slice(OTHER_PREFIX.length);
              else venue = hotelFull;
              // 5段目: ドライバー名（記号なし、左=行き / 右=帰り）。未定は自走。
              const goMailed = !!b.pickup_go_mailed_at;
              const backMailed = !!b.pickup_back_mailed_at;
              const goCell = (goMailed ? '✓' : '') + (goDrv || '<span class="bk-self">自走</span>');
              const backCell = (backMailed ? '✓' : '') + (backDrv || '<span class="bk-self">自走</span>');
              const svcTitle = svc === 'pending' ? '開始（接客開始＝経理に計上）' : svc === 'started' ? '終了（接客終了）' : 'クリックで未開始に戻す（巻き戻し）';
              html += `<div class="tl-booking s-${b.status}${svc === 'ended' ? ' svc-ended' : ''}" data-booking-id="${b.id}" title="${escapeAttr(titleText)}" style="left:${leftCalc};width:${widthCalc};top:2px;bottom:2px;">
                <div class="bk-top" data-bk-time="${b.id}">
                  <span class="bk-st">${stDisp}</span><span class="bk-dash">〜</span><span class="bk-et">${etDisp}</span>
                </div>
                <div class="bk-mid">
                  <span class="bk-name" data-bk-edit="${b.id}">${escapeHtml(name)}</span>
                  ${canMeet ? `<span class="bk-svc-ph" data-svc-ph="${b.id}" data-svc-state="${svc}"></span>` : ''}
                </div>
                ${isBreakRow ? '' : `<div class="bk-place">${escapeHtml(placeShort)}</div><div class="bk-venue">${escapeHtml(venue)}</div>`}
                ${!isBreakRow
                  ? `<div class="bk-bottom">
                       <button class="bk-go${goMailed ? ' mailed' : ''}" data-bk-go="${b.id}" title="行き: ドライバー指定・送迎情報をコピー">${goCell}</button>
                       <button class="bk-back${backMailed ? ' mailed' : ''}" data-bk-back="${b.id}" title="帰り: ドライバー指定・送迎情報をコピー">${backCell}</button>
                     </div>`
                  : ''}
              </div>`;
            });
            html += '</div>';
          }
        }
        html += '</div>';
      });
    }
    html += '</div>';
    grid.innerHTML = html;

    // select を DOM API で挿入（iOS Safari は innerHTML 内の select を弾くため）。
    // 万一ここで例外が出てもタイムライン本体は既に描画済みなので握りつぶす
    try {
      grid.querySelectorAll('.tl-att-ph[data-admin]').forEach(ph => {
        const adminId = ph.getAttribute('data-admin');
        const state   = ph.getAttribute('data-state') || 'available';
        const sel = document.createElement('select');
        sel.className = 'tl-att-sel tl-att-' + state;
        sel.setAttribute('data-admin', adminId);
        ['available:出勤', 'done:終了', 'tentative:予定', 'off:休み'].forEach(pair => {
          const v = pair.split(':')[0], l = pair.split(':')[1];
          const opt = document.createElement('option');
          opt.value = v; opt.textContent = l;
          if (v === state) opt.selected = true;
          sel.appendChild(opt);
        });
        if (ph.parentNode) ph.parentNode.replaceChild(sel, ph);
      });
    } catch (err) { console.error('att-select build failed', err); }

    // 接客ライフサイクル 未/始/終 を select で（iOS Safari 対策で DOM API 挿入）。
    // owner/manager は任意に変更可。change で set-service を直接呼ぶ。
    try {
      grid.querySelectorAll('.bk-svc-ph[data-svc-ph]').forEach(ph => {
        const id = ph.getAttribute('data-svc-ph');
        const state = ph.getAttribute('data-svc-state') || 'pending';
        const sel = document.createElement('select');
        sel.className = 'bk-svc-sel svc-' + state;
        sel.setAttribute('data-svc-sel', id);
        [['pending', '未'], ['started', '始'], ['ended', '終']].forEach(([v, l]) => {
          const opt = document.createElement('option');
          opt.value = v; opt.textContent = l;
          if (v === state) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener('click', e => e.stopPropagation());
        sel.addEventListener('change', async e => {
          e.stopPropagation();
          const next = sel.value;
          sel.disabled = true;
          try {
            await apiPost('/bookings.php?action=set-service', { id: Number(id), state: next });
            toast(next === 'started' ? '▶ 開始（経理に計上）' : next === 'ended' ? '■ 終了' : '未開始に戻しました', 'ok');
            loadTimeline(true);
          } catch (err) { toast('更新失敗: ' + err.message, 'err'); sel.disabled = false; }
        });
        if (ph.parentNode) ph.parentNode.replaceChild(sel, ph);
      });
    } catch (err) { console.error('svc-select build failed', err); }

    // 操作後の再描画はスクロール位置を復元。それ以外で当日表示時は現在時刻へ。
    const todayBiz = fmtDate(getBusinessDayDate());
    if (_tlPrevScroll != null) {
      const keep = _tlPrevScroll;
      const sc = document.querySelector('.tl-wrap');
      if (sc) requestAnimationFrame(() => { sc.scrollLeft = keep; });
    } else if (bizDay === todayBiz) {
      requestAnimationFrame(scrollTimelineToNow);
    }
    _tlPrevScroll = null;

    // （売上クリックは init() の document 委譲で処理）

    // クリックハンドラ（段ごとに動作を分ける）
    // 中段 お客様名 → 編集
    grid.querySelectorAll('[data-bk-edit]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        openBookingModal(Number(el.dataset.bkEdit));
      });
    });
    // 上段 時間 → ±調整ポップ
    grid.querySelectorAll('[data-bk-time]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.bk-done')) return;
        e.stopPropagation();
        openTimeAdjust(Number(el.dataset.bkTime), el);
      });
    });
    // 中段 接客 select（未/始/終）は上の DOM API 挿入時に change を配線済み
    // 下段 行き / 帰り → 送迎テキストをコピー
    grid.querySelectorAll('[data-bk-go]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openDriverAssign(Number(btn.dataset.bkGo), 'go', btn); });
    });
    grid.querySelectorAll('[data-bk-back]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openDriverAssign(Number(btn.dataset.bkBack), 'back', btn); });
    });
    grid.querySelectorAll('.tl-cell').forEach(c => {
      c.addEventListener('click', () => {
        // 日付欄は営業日基準。クリックしたセルの営業日と実時刻(0-23)を渡す（保存時に開始時刻からカレンダー日へ変換）
        const bizDay = c.dataset.date;
        const extH = parseInt(c.dataset.extHour, 10);  // 10-33
        const realHour = extH % 24;  // 0-23
        openBookingModal(null, { date: bizDay, adminId: c.dataset.admin, startHour: realHour, startMin: 0 });
      });
    });
  }

  // ========== Bookings list ==========
  async function loadBookings() {
    const el = document.getElementById('bookingList');
    el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';
    const params = new URLSearchParams();
    const kw = document.getElementById('bkKeyword').value.trim();
    const st = document.getElementById('bkFilterStatus').value;
    if (kw) params.set('keyword', kw);
    // 'break' は status ではなく course_name 判定なので API には送らずクライアント側で絞り込む
    if (st && st !== 'break') params.set('status', st);
    try {
      const data = await api('/bookings.php?action=list&' + params.toString());
      let list = data.bookings || [];
      const isBk = (b) => b.course_name === '休憩' || b.customer_name_snapshot === '【休憩】';
      // 休憩フィルタ: 'break' 選択時は休憩のみ、それ以外（全/特定ステータス）は休憩を除外
      if (st === 'break') {
        list = list.filter(isBk);
      } else {
        list = list.filter(b => !isBk(b));
      }
      // ロール別: ドライバーは自分の送迎予約のみ. owner/manager/office は全件（キャストは予約タブ不可視）
      if ((currentUser?.role || '') === 'driver') {
        list = list.filter(b => Number(b.driver_id) === Number(currentUser.id) || Number(b.back_driver_id) === Number(currentUser.id));
      }
      bookingsList = list;
      renderBookingsList();
    } catch (e) {
      el.innerHTML = '<div class="view-empty">読み込み失敗: ' + escapeHtml(e.message) + '</div>';
    }
  }
  function renderBookingsList() {
    const el = document.getElementById('bookingList');
    if (bookingsList.length === 0) {
      el.innerHTML = '<div class="view-empty"><div class="ve-icon">📋</div>予約はまだありません</div>';
      return;
    }
    el.innerHTML = bookingsList.map(b => {
      const name = b.customer_name || b.customer_name_snapshot || '匿名';
      const hotel = b.hotel_name || b.hotel_name_snapshot || '';
      const dateMD = b.booking_date ? bizDateOf(b.booking_date, b.start_time || '00:00').substring(5).replace('-','/') : '';
      const svc = svcState(b);                       // 始(接客中)/確(接客完了) 出し分け用
      const stLabel = bookingStatusLabel(b);
      return `<div class="bk-row" data-booking-id="${b.id}">
        <div class="bk-date-col">
          <div class="bd-date">${dateMD}</div>
          <div class="bd-time">${b.start_time.substring(0,5)}-${b.end_time.substring(0,5)}</div>
        </div>
        <div class="bk-info">
          <div class="bi-name">${escapeHtml(name)}</div>
          <div class="bi-meta">
            ${hotel ? `<span>🏨 ${escapeHtml(hotel)}${b.room_number ? ' #' + escapeHtml(b.room_number) : ''}</span>` : ''}
            ${b.course_name ? `<span>📋 ${escapeHtml(b.course_name)}</span>` : ''}
            ${b.staff_name ? `<span>👤 ${escapeHtml(b.staff_name)}</span>` : ''}
            ${b.price ? `<span>💴 ¥${Number(b.price).toLocaleString()}</span>` : ''}
          </div>
        </div>
        <div class="bk-status s-${b.status}${svc === 'ended' ? ' svc-ended' : ''}">${stLabel}</div>
        <div class="bk-actions"><button class="btn-edit" data-edit-booking="${b.id}">編集</button></div>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-edit-booking]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openBookingModal(Number(btn.dataset.editBooking)); });
    });
    el.querySelectorAll('.bk-row').forEach(row => {
      row.addEventListener('click', () => openBookingModal(Number(row.dataset.bookingId)));
    });
  }

  // ---- その営業日の出勤キャスト（タイムラインと予約モーダルで並び順を共有）----
  // 並び順の規約: 出勤開始が早い順 → 終了(done)は最後 → 同着は sort_order
  // タイムラインとプルダウンで別々に実装すると必ずズレるので、必ずここを経由する
  function shiftForDay(shifts, bizDay, uid) {
    return (shifts || []).find(s =>
      String(s.shift_date).slice(0, 10) === bizDay && Number(s.admin_user_id) === Number(uid)) || null;
  }
  // 顧客メモは「店長が書いた本文」と「旧システムからの移行情報」が同じ欄に同居している。
  // さらに改行が潰れて全部1行に見えていたため読みにくかった（店長指摘 2026-08-02）。
  // 本文を主役に出し、移行情報（統合された別登録・旧ID・初回/最終担当）は控えめに分ける。
  //
  // 【メモ2種類の役割】混同しないこと（店長の運用 2026-08-02）
  //   お客様メモ（ops_customers.notes）… そのお客様にずっと付いて回るメモ。
  //       キャストには伝えない内容を書く場所。予約モーダルからも編集・追加できる。
  //   予約メモ（ops_bookings.notes, #bmNotes）… その予約1件かぎり。
  //       キャストやドライバーに伝えたいことを書く場所。
  //
  const NOTE_META_HEAD = /^(【同番号の別登録を統合】|─ 旧システム移行|初回担当[:：]|最終担当[:：])/;
  /** お客様メモを「本文」と「旧システムの移行情報」に割る。編集時は本文だけを触らせる */
  function splitCustomerNote(notes) {
    const lines = String(notes || '').split('\n');
    // 統合行は本文が複数行に渡ることがあるので、見つけた行以降はすべて移行情報として扱う
    const metaAt = lines.findIndex(l => NOTE_META_HEAD.test(l.trim()));
    return {
      main: (metaAt === -1 ? lines : lines.slice(0, metaAt)).join('\n').trim(),
      meta: (metaAt === -1 ? [] : lines.slice(metaAt)).join('\n').trim(),
    };
  }
  function customerNoteHead(withEdit) {
    return '<div class="bhn-head"><span class="bhn-title">👤 お客様メモ'
      + '<span class="bhn-sub">キャストには伝えない</span></span>'
      + (withEdit ? '<button type="button" class="bhn-btn" data-note-edit>✏️ 編集</button>' : '')
      + '</div>';
  }
  function renderCustomerNote(notes) {
    const { main, meta } = splitCustomerNote(notes);
    return '<div class="bm-history-note">'
      + customerNoteHead(true)
      + (main ? `<div class="bhn-main">${escapeHtml(main)}</div>`
              : '<div class="bhn-empty">（未記入）— 編集から追加できます</div>')
      + (meta ? `<div class="bhn-meta">${escapeHtml(meta)}</div>` : '')
      + '</div>';
  }
  /** 予約モーダルの履歴パネル内で、お客様メモを編集できるようにする */
  function wireCustomerNoteEdit(panelEl, customerId, getNotes, setNotes) {
    const rerender = () => {
      const host = panelEl.querySelector('.bm-history-note');
      if (!host) return;
      host.outerHTML = renderCustomerNote(getNotes());
      wireCustomerNoteEdit(panelEl, customerId, getNotes, setNotes);
    };
    const editBtn = panelEl.querySelector('[data-note-edit]');
    if (!editBtn) return;
    editBtn.addEventListener('click', () => {
      const host = panelEl.querySelector('.bm-history-note');
      const { main, meta } = splitCustomerNote(getNotes());
      host.innerHTML = customerNoteHead(false)
        + `<textarea class="bhn-ta" rows="4" placeholder="キャストには伝えない、このお客様の情報">${escapeHtml(main)}</textarea>`
        + '<div class="bhn-actions"><button type="button" class="bhn-btn" data-note-cancel>キャンセル</button>'
        + '<button type="button" class="bhn-btn primary" data-note-save>保存</button></div>'
        + (meta ? `<div class="bhn-meta">${escapeHtml(meta)}</div>` : '');
      const ta = host.querySelector('.bhn-ta');
      ta.focus();
      host.querySelector('[data-note-cancel]').addEventListener('click', rerender);
      host.querySelector('[data-note-save]').addEventListener('click', async () => {
        // 移行情報は編集させず、そのまま末尾に戻す（旧IDなどを消さないため）
        const next = [ta.value.trim(), meta].filter(Boolean).join('\n');
        try {
          await apiPost('/customers.php?action=update', { id: customerId, notes: next });
          setNotes(next);
          toast('✓ お客様メモを保存しました', 'ok');
          rerender();
        } catch (e) { toast('保存に失敗しました', 'err'); }
      });
    });
  }

  // ===== ご利用履歴の表（顧客詳細・予約モーダルで共通） =====
  // 並び: 区分/利用日/キャスト/コース/指名/料金/交通費/場所/メモ/店舗。
  // 店舗は現状ほぼ「アドミ」一択で見る必要が薄いため一番右（旧データには他店舗も混在）。
  // 旧予約(legacy)と OPS予約(booking)を同じ表に混ぜて時系列で見せる。
  const HIST_STATUS = {
    inquiry: ['問合せ', ''], reserved: ['予約', ''], pre_reserved: ['事前予約', ''],
    on_hold: ['保留', ''], pending: ['保留', ''],
    completed: ['完了', 'ok'], cancelled: ['キャンセル', 'ng'], no_show: ['無連絡', 'ng'],
    other: ['その他', ''],
  };
  const HIST_NOM = { first: '初指名', regular: '本指名', free: 'フリー' };

  /** 予約(b)・旧履歴(v) を時系列（新しい順）に混ぜる */
  function mergeHistoryRows(bookings, legacy) {
    return [
      ...(bookings || []).map(b => ({ t: `${b.booking_date} ${(b.start_time || '00:00')}`, kind: 'b', b })),
      ...(legacy || []).map(v => ({ t: String(v.visit_at), kind: 'l', v })),
    ].sort((a, b) => String(b.t).localeCompare(String(a.t)));
  }

  /** 日付「8/8(土)」＋時刻「10:15」 */
  function histDateCell(dateStr, timeStr) {
    const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return escapeHtml(String(dateStr || ''));
    const dow = ['日','月','火','水','木','金','土'][new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`).getDay()] || '';
    const hm = String(timeStr || '').substring(0, 5);
    return `${parseInt(m[2],10)}/${parseInt(m[3],10)}${dow ? `(${dow})` : ''}` + (hm ? ` <span style="color:var(--deep);font-weight:700;">${escapeHtml(hm)}</span>` : '');
  }

  /**
   * 履歴テーブルのHTML。
   * @param rows mergeHistoryRows の結果
   * @param opts {clickable:boolean} 行クリックで予約を開くか（顧客詳細のみ true）
   */
  function renderHistoryTable(rows, opts) {
    const clickable = !!(opts && opts.clickable);
    if (!rows.length) return '<div class="bm-history-empty">ご利用履歴はありません</div>';
    const body = rows.map(row => {
      let kind, date, cast, course, nom, price, trans, place, memo, legacyTag, shop, bid = '';
      if (row.kind === 'l') {
        const v = row.v;
        const st = HIST_STATUS[v.status] || [v.status, ''];
        kind = st; date = histDateCell(String(v.visit_at).substring(0, 10), String(v.visit_at).substring(11, 16));
        cast = v.cast_name || ''; course = v.course_name || '';
        nom = v.nominate_name || '';
        price = parseInt(v.total_price, 10) || 0;
        trans = parseInt(v.transport_fee, 10) || 0;
        place = legacyPlaceLabel(v); memo = (v.memo || '').trim();
        shop = v.shop_name || '';
        legacyTag = '<span class="ht-old">旧</span>';
      } else {
        const b = row.b;
        const st = HIST_STATUS[b.status] || [b.status, ''];
        kind = st; date = histDateCell(bizDateOf(b.booking_date, b.start_time || '00:00'), b.start_time);
        cast = b.staff_name || ''; course = b.course_name || '';
        nom = HIST_NOM[b.nomination_type] || '';
        trans = parseInt(b.transport_fee, 10) || 0;
        price = (parseInt(b.price, 10) || 0) + trans;   // 料金は交通費込みの総額
        const hotel = b.hotel_name_snapshot || b.hotel_name || '';
        place = hotel ? '🏨 ' + hotel : '';
        memo = (b.notes || '').trim();
        shop = 'アドミ';   // OPSの予約は当店のみ
        legacyTag = '';
        bid = b.id;
      }
      return `
      <tr class="${row.kind === 'l' ? 'is-legacy' : ''}${clickable && bid ? ' clickable' : ''}"${clickable && bid ? ` data-booking-id="${bid}"` : ''}>
        <td><span class="ht-kind ${kind[1]}">${escapeHtml(kind[0])}</span>${legacyTag}</td>
        <td class="ht-date">${date}</td>
        <td>${escapeHtml(cast)}</td>
        <td class="ht-course">${escapeHtml(course)}</td>
        <td>${escapeHtml(nom)}</td>
        <td class="ht-price">${price > 0 ? '¥' + price.toLocaleString() : ''}</td>
        <td class="ht-price ht-trans">${trans > 0 ? '¥' + trans.toLocaleString() : ''}</td>
        <td class="ht-place">${escapeHtml(place)}</td>
        <td class="ht-memo">${escapeHtml(memo)}</td>
        <td class="ht-shop">${escapeHtml(shop)}</td>
      </tr>`;
    }).join('');
    return `<div class="hist-tbl-wrap"><table class="hist-tbl">
      <thead><tr><th>区分</th><th>利用日</th><th>キャスト</th><th>コース</th><th>指名</th><th>料金</th><th>交通費</th><th>場所</th><th>メモ</th><th>店舗</th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }

  // 旧履歴の「場所」表示。ホテルは市区町村つき（どこで利用したかが一目で分かるように）
  function legacyPlaceLabel(v, opts) {
    const compact = !!(opts && opts.compact);
    if (v.place_type === 'hotel' || v.hotel_name) {
      const city = (v.hotel_city || '').trim();
      const room = (v.room || '').trim();
      const name = (v.hotel_name || '').trim();
      return '🏨 ' + [city, name].filter(Boolean).join(' ') + (room && !compact ? ' ' + room + '号室' : '');
    }
    if (v.place_type === 'home') return '🏠 自宅';
    if (v.place_type === 'other') return '📍 その他';
    return '';
  }

  function castDayRank(shifts, bizDay, uid) {
    const s = shiftForDay(shifts, bizDay, uid);
    if (!s || !s.start_time) return 9999;   // 出勤なし（予約だけある人）は最後
    if (s.status === 'off') return 2e9;     // 休みは終了より下（一番下）
    if (s.status === 'done') return 1e9;    // 終了は出勤中の下へ
    const [hh, mm] = String(s.start_time).split(':').map(Number);
    return ((hh < 10 ? hh + 24 : hh) * 60) + (mm || 0);
  }
  function sortCastsByShift(users, shifts, bizDay) {
    return users.slice().sort((a, b) => {
      const d = castDayRank(shifts, bizDay, a.id) - castDayRank(shifts, bizDay, b.id);
      if (d !== 0) return d;
      return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
    });
  }
  // 指定営業日のシフト。タイムラインで表示中の日なら取得済みのものを使う
  async function shiftsForDay(bizDay) {
    if (bizDay && bizDay === fmtDate(tlCurrentDate) && tlShifts.length) return tlShifts;
    if (!bizDay) return [];
    try {
      const d = await api(`/shifts.php?action=range&from=${bizDay}&to=${bizDay}`);
      return d.shifts || [];
    } catch (e) { return []; }
  }
  // 担当プルダウン: その日に出勤しているキャストだけを、タイムラインと同じ並びで出す。
  // 休み(off)は除外。既に割り当て済みのキャストは、その日出勤していなくても
  // 選択が消えないよう必ず残す（過去予約の編集で担当が飛ぶのを防ぐ）
  async function populateCastSelect(bizDay, mustIncludeId) {
    const adSel = bel('bmAdminId');
    if (!adSel) return;
    const keep = String(mustIncludeId || adSel.value || '');
    const shifts = await shiftsForDay(bizDay);
    const all = adminUsersAll || [];
    const onDuty = all.filter(u => {
      if (!isTherapistCapable(u)) return false;
      const s = shiftForDay(shifts, bizDay, u.id);
      return !!s && s.status !== 'off';
    });
    if (keep && !onDuty.some(u => String(u.id) === keep)) {
      const assigned = all.find(u => String(u.id) === keep);
      if (assigned) onDuty.push(assigned);
    }
    const list = sortCastsByShift(onDuty, shifts, bizDay);
    // 名前だけを出す。出勤時間はタイムラインで把握できるうえ、ヘッダーの狭い枠では
    // 「あおい（15:30〜」と切れて読みにくかった（店長判断 2026-08-03）
    adSel.innerHTML = '<option value="">— 未割当 —</option>' +
      list.map(u => `<option value="${u.id}">${escapeHtml(u.display_name || u.username)}</option>`).join('');
    if (keep) adSel.value = keep;
  }

  // ========== Booking modal ==========
  async function ensureSelectsLoaded() {
    if (hotelsForSelect.length === 0) {
      try {
        const data = await api('/admin-api.php?action=hotels&limit=500');
        hotelsForSelect = data.hotels || [];
        populateCitySelect();
        populateHotelSelect('');
      } catch (e) {}
    }
    if (adminUsersAll.length === 0) {
      // owner=admin-users / 他=staff-list (read-only)
      const ep = currentUser?.role === 'owner' ? 'admin-users' : 'staff-list';
      try {
        const d = await api('/admin-api.php?action=' + ep);
        adminUsersAll = d.users || [];
      } catch (e) {}
    }
    const usersForSel = adminUsersAll.length ? adminUsersAll : [{ id: currentUser.id, display_name: currentUser.display_name, username: currentUser.email, role: currentUser.role }];
    // 担当キャストの選択肢は日付が決まってから populateCastSelect() が入れる
    // （その日の出勤者だけに絞るため。ここで全員を入れると一瞬全件が見えてしまう）
    // ドライバー = role=driver、または can_drive 兼任者（行き/帰りで別ドライバー可）
    const drvOpts = '<option value="">未定(自走)</option>' +
      usersForSel.filter(u => isDriverCapable(u))
        .map(u => `<option value="${u.id}">${escapeHtml(u.display_name || u.username)}</option>`).join('');
    const drvSel = bel('bmDriverId');
    if (drvSel) drvSel.innerHTML = drvOpts;
    const drvBackSel = bel('bmBackDriverId');
    if (drvBackSel) drvBackSel.innerHTML = drvOpts;
  }

  // 深夜料金 (+¥3,300) — チェックは合計表示のみに反映 (bmPrice はコース料金のまま)
  const LATE_NIGHT_FEE = 3300;
  const CAMPAIGN_RATE = 0.1;  // キャンペーン割引: コース料金の 10%OFF (通常→オープニング特価と一致)
  // コース料金に対する割引額 (10%, 円未満切り捨て)
  function campaignDiscount(base) {
    return bel('bmCampaign')?.checked ? Math.floor(base * CAMPAIGN_RATE) : 0;
  }
  // スタンプ特典: コース料金(キャンペーン割引後)から特典時間ぶんを按分割引。
  // 特典時間 ≥ コース時間なら全額無料 (円未満切り捨て)。延長・出張費・深夜料金は対象外。
  function stampDiscount(postCampaignCourse) {
    const rewardMin = parseInt(bel('bmStampReward')?.value || '0', 10) || 0;
    if (!rewardMin || postCampaignCourse <= 0) return 0;
    const courseMin = courseToMinutes();
    if (!courseMin) return 0;
    const ratio = Math.min(rewardMin, courseMin) / courseMin;
    return Math.floor(postCampaignCourse * ratio);
  }
  function updateBookingTotal() {
    const priceEl = bel('bmPrice');
    const transportEl = bel('bmTransport');
    const totalEl = bel('bmTotal');
    if (!totalEl) return;
    // 預り金の手入力があれば自動計算をまるごと上書き（微調整用）
    const depositOverrideRaw = String(bel('bmDepositOverride')?.value || '').replace(/[^\d]/g, '');
    const hasDepositOverride = depositOverrideRaw !== '';
    const amtEl = bel('bmCampaignAmt');
    const stampEl = bel('bmStampAmt');
    if (hasDepositOverride) {
      totalEl.textContent = '¥' + (parseInt(depositOverrideRaw, 10) || 0).toLocaleString();
      if (amtEl) amtEl.textContent = '';
      if (stampEl) stampEl.textContent = '';
    } else {
      const price = parseInt(String(priceEl?.value || '').replace(/[^\d]/g, ''), 10) || 0;
      const transport = parseInt(String(transportEl?.value || '').replace(/[^\d]/g, ''), 10) || 0;
      const lateNight = bel('bmLateNight')?.checked ? LATE_NIGHT_FEE : 0;
      const ext = extAmount();
      const discount = campaignDiscount(price);
      const stamp = stampDiscount(price - discount);
      const nomFee = bel('bmBreakMode')?.checked ? 0 : nominationFeeFor(bel('bmNomination')?.value);
      const total = price + transport + lateNight + ext + nomFee - discount - stamp;
      totalEl.textContent = '¥' + total.toLocaleString();
      // 割引額をチェック横に表示
      if (amtEl) amtEl.textContent = discount > 0 ? `(−¥${discount.toLocaleString()})` : '';
      if (stampEl) stampEl.textContent = stamp > 0 ? `−¥${stamp.toLocaleString()}` : '';
    }
    // キャンセル時の計上注記（合計は元料金のまま表示し、計上の有無/額を明示）
    const noteEl = bel('bmCancelNote');
    if (noteEl) {
      if (bel('bmStatus')?.value === 'cancelled') {
        if (bel('bmCancelType')?.value === 'customer') {
          const fee = parseInt(String(bel('bmCancelFee')?.value || '').replace(/[^\d]/g, ''), 10) || 0;
          noteEl.textContent = `お客様都合キャンセル → 計上額 ¥${fee.toLocaleString()}（キャンセル料）`;
          noteEl.style.color = 'var(--coral)';
        } else {
          noteEl.textContent = '※ キャンセルのため未計上（合計は元の料金）';
          noteEl.style.color = 'var(--ink-soft)';
        }
        noteEl.style.display = 'block';
      } else {
        noteEl.style.display = 'none';
      }
    }
  }
  // 担当キャストが選ばれたら、ステータスが「問合せ」のときのみ自動で「予約」に切替える
  // （完了・キャンセル等、既に確定した状態は上書きしない）
  function autoStatusOnAssign() {
    const adSel = bel('bmAdminId');
    const stSel = bel('bmStatus');
    if (!adSel || !stSel) return;
    if (adSel.value && stSel.value === 'inquiry') {
      stSel.value = 'reserved';
      const cw = bel('bmCancelWrap');
      if (cw) cw.style.display = 'none';
      try { updateBookingTotal(); } catch (e) {}
      try { updateFooterStatus(); } catch (e) {}
    }
  }
  // 深夜料金は手動チェック運用（立川駅周辺は深夜料金無料のため時刻での自動ONはしない）。
  // 休憩モードのときだけ安全に OFF にする。
  function autoToggleLateNight() {
    const cb = bel('bmLateNight');
    if (!cb) return;
    if (bel('bmBreakMode')?.checked && cb.checked) {
      cb.checked = false;
      updateBookingTotal();
    }
  }

  // 送迎時刻を自動セット
  function syncPickupTimes() {
    const sh = parseInt(bel('bmStartHour').value, 10);
    const sm = parseInt(bel('bmStartMin').value, 10);
    if (Number.isNaN(sh) || Number.isNaN(sm)) return;
    // 行き: 開始30分前
    if (bel('bmGoEnabled')?.checked) {
      const total = sh * 60 + sm - 30;
      const norm = ((total % 1440) + 1440) % 1440;
      const gh = Math.floor(norm / 60), gm = norm % 60;
      bel('bmGoTime').value = ('0'+gh).slice(-2) + ':' + ('0'+gm).slice(-2);
    }
    // 帰り: 終了時刻
    if (bel('bmBackEnabled')?.checked) {
      const totalMin = courseToMinutes();
      if (totalMin) {
        const endMin = (sh * 60 + sm + totalMin) % 1440;
        const eh = Math.floor(endMin / 60), em = endMin % 60;
        bel('bmBackTime').value = ('0'+eh).slice(-2) + ':' + ('0'+em).slice(-2);
      }
    }
  }
  function bindPickupEvents() {
    const go = bel('bmGoEnabled');
    const back = bel('bmBackEnabled');
    // 行きドライバー選択 → 行きを自動ON
    const drvGo = bel('bmDriverId');
    if (drvGo && !drvGo._pickupBound) {
      drvGo._pickupBound = true;
      drvGo.addEventListener('change', () => {
        if (drvGo.value !== '' && !go.checked) { go.checked = true; bel('bmGoTime').disabled = false; }
        syncPickupTimes();
      });
    }
    // 帰りドライバー選択 → 帰りを自動ON
    const drvBack = bel('bmBackDriverId');
    if (drvBack && !drvBack._pickupBound) {
      drvBack._pickupBound = true;
      drvBack.addEventListener('change', () => {
        if (drvBack.value !== '' && !back.checked) { back.checked = true; bel('bmBackTime').disabled = false; }
        syncPickupTimes();
      });
    }
    [go, back].forEach((cb, i) => {
      if (!cb || cb._pickupBound) return;
      cb._pickupBound = true;
      const timeEl = i === 0 ? bel('bmGoTime') : bel('bmBackTime');
      cb.addEventListener('change', () => {
        timeEl.disabled = !cb.checked;
        if (!cb.checked) timeEl.value = '';
        else syncPickupTimes();
      });
    });
  }

  // suffix('' / '-2')ごとの最新リクエスト連番。古いfetchの応答が新しい顧客の表示を上書きしないためのガード
  const historyReqSeq = { '': 0, '-2': 0 };
  // リピーター履歴: 電話番号ヒット時 / 予約編集時に、その顧客の予約履歴を読み取り専用で表示（トグル開閉）
  // excludeBookingId: 編集中の予約自身を履歴リストから除外（新規予約時は未指定でOK）
  // 呼び出し時点の activeBmSuffix を同期的に確定させ、以降は明示的にそのsuffixのDOMだけを触る
  // （bel()＝ambientなactiveBmSuffix参照だと、await中に他の操作でactiveBmSuffixが変わるとズレるため）
  async function loadCustomerHistory(customerId, excludeBookingId) {
    const suffix = activeBmSuffix;
    const belS = (id) => document.getElementById(id + suffix);
    const wrap = belS('bmHistoryWrap');
    const toggleBtn = belS('bmHistoryToggle');
    const panelEl = belS('bmHistoryPanel');
    const summaryEl = belS('bmHistorySummary');
    if (!wrap || !toggleBtn || !panelEl || !summaryEl) return;
    const hide = () => { wrap.style.display = 'none'; panelEl.style.display = 'none'; panelEl.innerHTML = ''; toggleBtn.setAttribute('aria-expanded', 'false'); };
    if (!customerId) { hide(); return; }
    const mySeq = ++historyReqSeq[suffix];
    wrap.style.display = 'block';
    summaryEl.textContent = '読み込み中…';
    panelEl.style.display = 'none';
    panelEl.innerHTML = '';
    toggleBtn.setAttribute('aria-expanded', 'false');
    try {
      const d = await api('/customers.php?action=get&id=' + customerId);
      if (historyReqSeq[suffix] !== mySeq) return;  // その間に新しい呼び出しが発生済み→この古い結果は破棄
      const c = d.customer || {};
      const visitCount = parseInt(c.visit_count, 10) || 0;
      const notesTrim = (c.notes || '').trim();
      const rows = (d.bookings || []).filter(b => Number(b.id) !== Number(excludeBookingId));
      const legacy = d.legacy_visits || [];   // 旧システムの利用履歴（2017-10〜2026-07）
      // 履歴もメモも無い新規客でも、お客様メモを書けるようパネルは出す
      const mdDate = (s) => { const m = String(s || '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${parseInt(m[1], 10)}/${parseInt(m[2], 10)}` : escapeHtml(s || ''); };
      // 「前回」は OPS予約と旧履歴の両方から最新の完了を拾う（8/1直後は旧履歴側が直近になる）
      const lastCompleted = rows.find(b => b.status === 'completed');
      const lastLegacy = legacy.find(v => v.status === 'completed');
      let lastLabel = '';
      const bKey = lastCompleted ? `${lastCompleted.booking_date} ${lastCompleted.start_time || '00:00'}` : '';
      const lKey = lastLegacy ? String(lastLegacy.visit_at) : '';
      if (bKey >= lKey && lastCompleted) {
        lastLabel = `（前回 ${mdDate(bizDateOf(lastCompleted.booking_date, lastCompleted.start_time || '00:00'))} ${lastCompleted.course_name || ''}）`;
      } else if (lastLegacy) {
        lastLabel = `（前回 ${mdDate(lastLegacy.visit_at)} ${lastLegacy.course_name || ''}${lastLegacy.cast_name ? ' ' + lastLegacy.cast_name : ''}）`;
      }
      const histCount = rows.length + legacy.length;
      summaryEl.textContent = visitCount > 0
        ? `リピーター・ご利用${visitCount}回` + lastLabel
        : (notesTrim ? '📝 お客様メモあり' : (histCount > 0 ? `予約履歴 ${histCount}件` : '新規のお客様'));
      let curNotes = notesTrim;
      const noteHtml = renderCustomerNote(curNotes);
      // 旧システムの一覧と同じ表形式。件数が多いので直近30件まで
      const mergedRows = mergeHistoryRows(rows, legacy).slice(0, 30);
      const rowsHtml = renderHistoryTable(mergedRows, { clickable: false });
      panelEl.innerHTML = noteHtml + rowsHtml;
      wireCustomerNoteEdit(panelEl, customerId, () => curNotes, v => { curNotes = v; });
    } catch (e) {
      if (historyReqSeq[suffix] !== mySeq) return;
      summaryEl.textContent = 'リピーター履歴（読み込み失敗）';
      panelEl.innerHTML = '';
    }
  }

  function toggleHistoryPanel() {
    const btn = bel('bmHistoryToggle');
    const panel = bel('bmHistoryPanel');
    if (!btn || !panel) return;
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', open ? 'false' : 'true');
    panel.style.display = open ? 'none' : 'block';
  }

  // 電話番号 blur で既存顧客検索
  async function lookupCustomerByPhone() {
    const phone = bel('bmCustomerPhone').value.trim();
    if (!phone) { loadCustomerHistory(null); return; }
    try {
      const d = await api('/customers.php?action=find-by-phone&phone=' + encodeURIComponent(phone));
      if (d.customer) {
        bel('bmCustomerId').value = d.customer.id;
        const nameField = bel('bmCustomerName');
        if (!nameField.value.trim()) nameField.value = d.customer.name || '';
        const emailField = bel('bmCustomerEmail');
        if (!emailField.value.trim() && d.customer.email) emailField.value = d.customer.email;
        loadCustomerHistory(d.customer.id, getEditingBookingId());
      } else {
        bel('bmCustomerId').value = '';
        loadCustomerHistory(null);
      }
    } catch (e) {}
  }

  async function openBookingModal(id, prefill) {
    await ensureSelectsLoaded();
    await ensureCoursesLoaded();
    // 開くたびに現在のモーダル(primary/-2)の bmCourse を最新の option(data-price付き)で再生成。
    // ensureCoursesLoaded は cache 済みだと populate を呼ばないため、ここで明示的に保証する
    populateCourseSelect();
    setEditingBookingId(id);
    const labelSuffix = activeBmSuffix === '-2' ? '（②）' : (document.getElementById('bookingModal-2')?.classList.contains('show') ? '（①）' : '');
    bel('bmTitle').textContent = (id ? '予約編集' : '新規予約') + labelSuffix;
    bel('bmDelete').style.display = id && currentUser?.role === 'owner' ? 'inline-flex' : 'none';
    // 休憩モードリセット (デフォルト OFF)
    const breakChk = bel('bmBreakMode');
    if (breakChk) { breakChk.checked = false; setBreakMode(false); }

    if (id) {
      try {
        const d = await api('/bookings.php?action=get&id=' + id);
        const b = d.booking;
        bel('bmCustomerId').value = b.customer_id || '';
        bel('bmCustomerName').value = b.customer_name || b.customer_name_snapshot || '';
        bel('bmCustomerPhone').value = b.customer_phone || b.customer_phone_snapshot || '';
        bel('bmCustomerEmail').value = b.customer_email_snapshot || '';
        loadCustomerHistory(b.customer_id || null, id);
        // カレンダー日基準でそのまま表示
        bel('bmDate').value = bizDateOf(b.booking_date, b.start_time || '00:00');  // 日付欄は営業日で表示（深夜0-10時は前日）
        const sh = parseInt(String(b.start_time).substring(0, 2), 10);
        const sm = parseInt(String(b.start_time).substring(3, 5), 10);
        const eh = parseInt(String(b.end_time).substring(0, 2), 10);
        const em = parseInt(String(b.end_time).substring(3, 5), 10);
        bel('bmStartHour').value = sh;
        bel('bmStartMin').value = sm;
        setBmMedia(b.media || '');
        // コース復元: course_name からマスタを照合（端数や旧カスタムは分数で照合）
        let courseMin = null;
        if (b.course_name) {
          const cm = (coursesCache || []).find(c => c.name === b.course_name);
          if (cm) courseMin = parseInt(cm.duration_min, 10);
          else { const mm = String(b.course_name).match(/(\d+)\s*分/); if (mm) courseMin = parseInt(mm[1], 10); }
        }
        // マスタに一致する分数があれば選択、無ければ未選択（カスタムは廃止）
        const opt = courseMin != null && [...bel('bmCourse').options].find(o => o.value === String(courseMin));
        bel('bmCourse').value = opt ? String(courseMin) : '';
        // 延長回数の復元
        if (bel('bmExtCount')) bel('bmExtCount').value = String(b.extension_count || 0);
        updateEndTime();
        // ロケーションタイプ判定 + 復元
        const locType = detectLocType(b.hotel_id, b.hotel_name_snapshot);
        switchLocSection(locType);
        if (locType === 'hotel') {
          // ホテルの市区町村も復元
          const h = hotelsForSelect.find(x => Number(x.id) === Number(b.hotel_id));
          if (h && h.city) {
            syncCityRegionTab(h.city);   // 23区などの予約を開いたらエリアタブも合わせる
            bel('bmCity').value = h.city;
            populateHotelSelect(h.city);
          } else {
            bel('bmCity').value = '';
            populateHotelSelect('');
          }
          bel('bmHotelId').value = b.hotel_id || '';
          bel('bmHotelName').value = b.hotel_id ? '' : (b.hotel_name_snapshot || '');
          bel('bmRoom').value = b.room_number || '';
        } else if (locType === 'home') {
          const raw = (b.hotel_name_snapshot || '').replace(HOME_PREFIX, '');
          // " / " で住所と建物を分割
          const parts = raw.split(' / ');
          bel('bmHomeAddress').value = parts[0] || '';
          bel('bmHomeBuilding').value = parts[1] || '';
        } else if (locType === 'other') {
          bel('bmOtherLoc').value = (b.hotel_name_snapshot || '').replace(OTHER_PREFIX, '');
        }
        // 担当プルダウンはその日の出勤者だけ。割当済みの担当は出勤外でも残す
        await populateCastSelect(bel('bmDate').value, b.assigned_admin_id || '');
        bel('bmAdminId').value = b.assigned_admin_id || '';
        renderCastAlert();
        // 送迎ドライバーはタイムラインで操作（モーダルでは扱わない）
        bel('bmStatus').value = b.status || 'reserved';
        bel('bmCancelType').value = b.cancellation_reason_type || 'customer';
        bel('bmCancelReason').value = b.cancellation_reason || '';
        setMoney('bmCancelFee', b.cancellation_fee ?? '');
        setMoney('bmCancelReward', b.cancellation_reward ?? '');
        bel('bmCancelWrap').style.display = b.status === 'cancelled' ? 'block' : 'none';
        // コース料金はコースマスタの基本料金を入れる（保存値は延長/深夜込みのため二重計上を防ぐ）
        const courseOptEl = opt ? [...bel('bmCourse').options].find(o => o.value === String(courseMin)) : null;
        const basePrice = courseOptEl?.dataset?.price;
        setMoney('bmPrice', basePrice ? basePrice : (b.price || ''));
        // 出張費セレクトに無い金額(旧・手入力データ等)なら選択肢として一時追加してから復元する
        {
          const transSel = bel('bmTransport');
          const transVal = String(b.transport_fee || 0);
          if (transSel && ![...transSel.options].some(o => o.value === transVal)) {
            const extraOpt = document.createElement('option');
            extraOpt.value = transVal;
            extraOpt.textContent = `¥${(parseInt(transVal, 10) || 0).toLocaleString()}（登録時の金額）`;
            transSel.appendChild(extraOpt);
          }
          if (transSel) transSel.value = transVal;
        }
        setBmPayment(b.payment_method || '');
        if (bel('bmNomination')) bel('bmNomination').value = b.nomination_type || '';
        // 預り金は都度の手入力のため常に空欄（既存の報酬オーバーライドのみ編集時に復元）
        if (bel('bmDepositOverride')) bel('bmDepositOverride').value = '';
        if (bel('bmRewardOverride')) setMoney('bmRewardOverride', b.reward_override != null ? b.reward_override : '');
        bel('bmNotes').value = b.notes || '';
        // 深夜料金・キャンペーン割引を保存値から復元（bmPrice はコース基本料金＝通常価格）。
        // 保存 price = 基本 + 深夜 + 延長 − 割引 − スタンプ。スタンプは保存されないため 0 とみなし逆算する。
        const stampSelEdit = bel('bmStampReward');
        if (stampSelEdit) stampSelEdit.value = '';
        const lateCbEdit = bel('bmLateNight');
        if (lateCbEdit) lateCbEdit.checked = Number(b.late_fee) > 0;   // 深夜料金は late_fee 列で確定
        const campCbEdit = bel('bmCampaign');
        if (campCbEdit) {
          const baseVal = parseInt(String(basePrice || b.price || '0').replace(/[^\d]/g, ''), 10) || 0;
          const impliedDisc = baseVal + (Number(b.late_fee) || 0) + extAmount() - (Number(b.price) || 0);
          const expectDisc = Math.floor(baseVal * CAMPAIGN_RATE);
          // コースがマスタに一致し、逆算した割引が 10% とほぼ一致すればキャンペーン適用済み
          campCbEdit.checked = !!opt && expectDisc > 0 && Math.abs(impliedDisc - expectDisc) <= 2;
        }
        updateBookingTotal();
        bel('bmSub').textContent = b.customer_name || b.customer_name_snapshot || '';
        // 休憩予約の自動判定
        const isBreakRow = (b.course_name === '休憩') || (b.customer_name_snapshot === '【休憩】');
        if (breakChk && isBreakRow) {
          breakChk.checked = true;
          setBreakMode(true);
          // 休憩エリア復元
          if (bel('bmBreakCity')) bel('bmBreakCity').value = b.display_city || '';
          // 休憩時間 = 終了 − 開始（跨ぎ考慮）
          let totalMin = (eh * 60 + em) - (sh * 60 + sm);
          if (totalMin <= 0) totalMin += 24 * 60;
          // 休憩時間を totalMin から復元 (60/90/120 preset or custom)
          const breakPreset = [60, 90, 120].find(m => m === totalMin);
          if (breakPreset) {
            bel('bmBreakDur').value = String(breakPreset);
            bel('bmBreakCustomMinWrap').style.display = 'none';
          } else if (totalMin > 0) {
            bel('bmBreakDur').value = 'custom';
            bel('bmBreakCustomMin').value = totalMin;
            bel('bmBreakCustomMinWrap').style.display = 'block';
          }
          updateEndTime();
        }
      } catch (e) { toast('読み込み失敗', 'err'); return; }
    } else {
      // リセット
      ['bmCustomerId','bmCustomerName','bmCustomerPhone','bmCustomerEmail','bmCourse','bmNomination','bmCustomMin','bmBreakDur','bmBreakCustomMin','bmBreakCity','bmHotelId','bmHotelName','bmRoom','bmHomeAddress','bmHomeBuilding','bmOtherLoc','bmPrice','bmNotes','bmStampReward','bmDepositOverride','bmRewardOverride'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
      if (bel('bmTransport')) bel('bmTransport').value = '0';  // select化: 「なし(¥0)」がデフォルト
      loadCustomerHistory(null);
      // デフォルト: キャンペーン割引ON・深夜料金OFF
      const lateCb = bel('bmLateNight');
      if (lateCb) lateCb.checked = false;
      const campCbNew = bel('bmCampaign');
      if (campCbNew) campCbNew.checked = true;
      updateBookingTotal();
      const mainRegion = document.querySelector(`input[name="bmCityRegion${activeBmSuffix}"][value="main"]`);
      if (mainRegion) { mainRegion.checked = true; populateCitySelect('main'); }
      bel('bmCity').value = '';
      populateHotelSelect('');
      switchLocSection('hotel');
      bel('bmDate').value = prefill?.date || fmtDate(getBusinessDayDate());  // 日付欄は営業日基準（深夜0-10時は前営業日）。保存時に開始時刻からカレンダー日へ変換
      bel('bmCancelType').value = 'customer';
      bel('bmCancelReason').value = '';
      setMoney('bmCancelFee', '');
      setMoney('bmCancelReward', '');
      bel('bmCancelWrap').style.display = 'none';
      // 開始時刻 prefill (0-23h で渡される)
      const sh = prefill?.startHour ?? 14;
      const sm = prefill?.startMin ?? 0;
      bel('bmStartHour').value = sh;
      bel('bmStartMin').value = sm;
      updateEndTime();  // コース未選択なので「—」
      // 開始時刻が深夜帯なら自動で深夜料金チェック ON (料金はまだ 0 なので加算しても影響なし)
      autoToggleLateNight();
      // クイック電話番号の prefill
      if (prefill?.phone) {
        bel('bmCustomerPhone').value = prefill.phone;
        await lookupCustomerByPhone();
      }
      // 担当プルダウンはその日の出勤者だけ（タイムラインの担当行から作成した場合はその人を保持）
      await populateCastSelect(bel('bmDate').value, prefill?.adminId || '');
      bel('bmAdminId').value = prefill?.adminId || '';
      renderCastAlert();
      setBmPayment('cash');  // 支払方法デフォルト=現金
      if (bel('bmExtCount')) bel('bmExtCount').value = '0';  // 延長デフォルト=なし
      setBmMedia('');   // 媒体・予約経路は既定で未チェック
      // デフォルト: 担当キャスト未割当なら「問合せ」、既に割当済み(タイムラインの担当行から作成)なら「予約」
      bel('bmStatus').value = prefill?.adminId ? 'reserved' : 'inquiry';
      bel('bmSub').textContent = '';
    }
    const modalId = 'bookingModal' + activeBmSuffix;
    // 最小化中なら復元してから表示
    const m = document.getElementById(modalId);
    if (m?.classList.contains('minimized')) {
      m.classList.remove('minimized');
      document.querySelector(`#minDock [data-restore="${modalId}"]`)?.remove();
    }
    // フッターの予約内容サマリーを全項目セット後に反映（編集時は場所・料金が updateEndTime より後に入るため）
    try { updateFooterStatus(); } catch (e) {}
    openModal(modalId);
  }

  // 休憩モード切替: 顧客欄・ホテル欄・送迎・料金等を隠す
  function setBreakMode(checked) {
    const hideIds = ['bmCustomerPhone','bmCustomerName','bmCustomerEmail','bmPrice','bmTransport'];
    hideIds.forEach(id => {
      const el = document.getElementById(id);
      const f = el?.closest('.field');
      if (f) f.style.display = checked ? 'none' : '';
    });
    // コース欄 ⇔ 休憩時間欄 を切替 (終了時刻は常に自動計算で bmEndDisplay に表示)
    const courseF = document.getElementById('bmCourseField');
    if (courseF) courseF.style.display = checked ? 'none' : '';
    const nominationF = document.getElementById('bmNominationField');
    if (nominationF) nominationF.style.display = checked ? 'none' : '';
    const breakDurF = document.getElementById('bmBreakDurField');
    if (breakDurF) breakDurF.style.display = checked ? '' : 'none';
    // 休憩エリア入力欄 (公開タイムライン用)
    const breakCityF = document.getElementById('bmBreakCityField');
    if (breakCityF) breakCityF.style.display = checked ? '' : 'none';
    const endHint = document.getElementById('bmEndHint');
    if (endHint) endHint.textContent = checked ? '休憩時間を選ぶと計算されます' : 'コースを選ぶと計算されます';
    // 休憩モード ON 時、休憩時間デフォルト 60分 (未設定時のみ) + 料金系をOFF
    if (checked) {
      const bd = document.getElementById('bmBreakDur');
      if (bd && !bd.value) bd.value = '60';
      const lateCb = bel('bmLateNight'); if (lateCb) lateCb.checked = false;       // 深夜料金OFF
      const campCb = bel('bmCampaign'); if (campCb) campCb.checked = false;        // キャンペーンOFF
      const stampCb = bel('bmStampReward'); if (stampCb) stampCb.value = '';       // スタンプ特典なし
      try { updateBookingTotal(); } catch (e) {}
    }
    // 終了時刻を即時再計算
    try { updateEndTime(); } catch (e) {}
    // 訪問先タイプ + loc-section
    document.querySelectorAll('.loc-section').forEach(el => el.style.display = checked ? 'none' : '');
    const locTypeField = document.querySelector('input[name="bmLocType"]')?.closest('.field');
    if (locTypeField) locTypeField.style.display = checked ? 'none' : '';
    // 市区町村は loc-section ではなくなった（訪問先タイプを変えても残す）ので、休憩モードでは個別に隠す
    ['bmCityField', 'bmCityRegionField'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = checked ? 'none' : '';
    });
    // ドライバー欄 + 送迎関連
    const drvF = document.getElementById('bmDriverId')?.closest('.field');
    if (drvF) drvF.style.display = checked ? 'none' : '';
    const goF = document.getElementById('bmGoEnabled')?.closest('.field');
    if (goF) goF.style.display = checked ? 'none' : '';
    const bkF = document.getElementById('bmBackEnabled')?.closest('.field');
    if (bkF) bkF.style.display = checked ? 'none' : '';
    // 休憩は接客ではないため、料金・特典・支払い関連もまとめて非表示（日付/開始/終了・カウンセリング・延長・休憩時間・エリア・メモのみ表示）
    ['bmCampaignField','bmStampField','bmLateNightField','bmMediaField'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = checked ? 'none' : 'flex';
    });
    const paymentF = document.getElementById('bmPaymentField');
    if (paymentF) paymentF.style.display = checked ? 'none' : '';
    const totalRow = document.getElementById('bmTotalRow');
    if (totalRow) totalRow.style.display = checked ? 'none' : 'flex';
  }

  // ============== オーダー詳細（キャスト用 読み取り専用） ==============
  // ステータス表示は bookingStatusLabel() に統一（旧 STATUS_LABEL は廃止）
  let currentOrderId = null;
  async function openOrderDetailModal(id) {
    try {
      const d = await api('/bookings.php?action=get&id=' + id);
      const b = d.booking;
      currentOrderId = b.id;
      _odLastBooking = b;
      // 休憩はオーダー画面を出さない (編集モーダルへ戻す)
      const isBreakRow = (b.course_name === '休憩') || (b.customer_name_snapshot === '【休憩】');
      if (isBreakRow) { openBookingModal(id); return; }

      const st = String(b.start_time).substring(0, 5);
      const et = String(b.end_time).substring(0, 5);
      const sh = parseInt(st.substring(0, 2), 10);
      const sm = parseInt(st.substring(3, 5), 10);
      const eh = parseInt(et.substring(0, 2), 10);
      const em = parseInt(et.substring(3, 5), 10);
      let totalMin = (eh * 60 + em) - (sh * 60 + sm);
      if (totalMin <= 0) totalMin += 24 * 60;

      const setText = (id, txt, muted) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = txt || '—';
        el.classList.toggle('muted', !!muted || !txt);
      };
      const fmtDateLabel = (s) => {
        if (!s) return '';
        const [y, m, dd] = s.split('-').map(Number);
        return `${y}/${('0'+m).slice(-2)}/${('0'+dd).slice(-2)}`;
      };

      document.getElementById('odSub').textContent = `予約 #${b.id}`;
      setText('odDateTime', `${fmtDateLabel(bizDateOf(b.booking_date, b.start_time || '00:00'))} ${st} 〜 ${et} (${totalMin}分)`);
      setText('odCourse', b.course_name || '');
      setText('odPrice', b.price ? `¥${Number(b.price).toLocaleString()}` : '');
      setText('odTransport', (b.transport_fee != null && b.transport_fee !== '') ? `¥${Number(b.transport_fee).toLocaleString()}` : '');
      setText('odCustomerName', b.customer_name || b.customer_name_snapshot || '');
      // 電話番号はキャスト(staff)には非表示（行ごと隠す＋APIでも返さない）
      const phoneRow = document.getElementById('odPhoneRow');
      if (currentUser?.role === 'staff') {
        if (phoneRow) phoneRow.style.display = 'none';
      } else {
        if (phoneRow) phoneRow.style.display = '';
        const phone = b.customer_phone || b.customer_phone_snapshot || '';
        const phoneEl = document.getElementById('odCustomerPhone');
        phoneEl.innerHTML = phone ? `<a href="tel:${phone.replace(/[^0-9+]/g, '')}" style="color:var(--sea);">${phone}</a>` : '—';
        phoneEl.classList.toggle('muted', !phone);
      }

      // 訪問先
      const hotel = b.hotel_name_snapshot || b.hotel_name || '';
      let locDisplay = hotel;
      if (hotel.startsWith(HOME_PREFIX)) locDisplay = '🏠 ' + hotel.replace(HOME_PREFIX, '');
      else if (hotel.startsWith(OTHER_PREFIX)) locDisplay = '📍 ' + hotel.replace(OTHER_PREFIX, '');
      else if (hotel) locDisplay = '🏨 ' + hotel;
      setText('odLocation', locDisplay);
      const roomRow = document.getElementById('odRoomRow');
      if (b.room_number) { roomRow.style.display = ''; setText('odRoom', b.room_number); }
      else roomRow.style.display = 'none';

      // 送迎（行き / 帰り）: ドライバー割当があれば「名前（時刻）」、無ければ「自走」
      const go = b.pickup_go_time ? String(b.pickup_go_time).substring(0,5) : '';
      const back = b.pickup_back_time ? String(b.pickup_back_time).substring(0,5) : '';
      setText('odGo', b.driver_name ? `${b.driver_name}${go ? '（' + go + '）' : ''}` : '自走');
      setText('odBack', b.back_driver_name ? `${b.back_driver_name}${back ? '（' + back + '）' : ''}` : '自走');

      // お仕事メモ（この予約＝自分が担当した仕事に保存。顧客に紐づく共通メモはお店の顧客管理のみ）
      const noteEl = document.getElementById('odNoteEdit');
      if (noteEl) {
        noteEl.value = b.notes ?? '';
        noteEl.placeholder = 'この予約の申し送り・気づきを記録（担当したお仕事のメモ）';
      }

      // ステータス（completed は接客中/接客完了を出し分け）
      setText('odStatus', bookingStatusLabel(b));

      // カウンセリングシート
      const sheetPreview = document.getElementById('odSheetPreview');
      const sheetLink    = document.getElementById('odSheetLink');
      const sheetImg     = document.getElementById('odSheetImg');
      const sheetFile    = document.getElementById('odSheetFile');
      const sheetName    = document.getElementById('odSheetFileName');
      const sheetSave    = document.getElementById('odSheetSave');
      if (b.counseling_sheet_url) {
        if (sheetPreview) sheetPreview.style.display = '';
        if (sheetLink)    sheetLink.href = b.counseling_sheet_url;
        if (sheetImg)     sheetImg.src   = b.counseling_sheet_url;
      } else {
        if (sheetPreview) sheetPreview.style.display = 'none';
      }
      if (sheetFile) sheetFile.value = '';
      if (sheetName) sheetName.textContent = '未選択';
      if (sheetSave) sheetSave.style.display = 'none';

      // 読み取り専用ビュー: 接客の開始/終了はマイページ一覧のボタンで行うため、このモーダルでは状態変更しない
      const compBtn = document.getElementById('odComplete');
      if (compBtn) compBtn.style.display = 'none';

      openModal('orderDetailModal');
    } catch (e) { toast('読み込み失敗', 'err'); }
  }

  async function uploadCounselingSheet() {
    const fileInput = document.getElementById('odSheetFile');
    const f = fileInput?.files[0];
    if (!f || !currentOrderId) return;
    const btn = document.getElementById('odSheetSave');
    if (btn) { btn.disabled = true; btn.textContent = 'アップロード中...'; }
    try {
      const fd = new FormData();
      fd.append('booking_id', currentOrderId);
      fd.append('image', f);
      const res = await fetch('/ctrl/ops/api/counseling-upload.php', { method: 'POST', body: fd, credentials: 'include' });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || 'upload failed');
      toast(d.linked_customer ? '✓ 保存しました（顧客の誓約書にも反映）' : '✓ カウンセリングシートを保存しました', 'ok');
      const prev = document.getElementById('odSheetPreview');
      const link = document.getElementById('odSheetLink');
      const img  = document.getElementById('odSheetImg');
      if (prev) prev.style.display = '';
      if (link) link.href = d.url;
      if (img)  img.src  = d.url + '?t=' + Date.now();
      fileInput.value = '';
      const nameEl = document.getElementById('odSheetFileName');
      if (nameEl) nameEl.textContent = '未選択';
      if (btn) btn.style.display = 'none';
    } catch (e) {
      toast('アップロード失敗: ' + e.message, 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⬆ アップロード'; }
    }
  }

  async function markOrderCompleted() {
    if (!currentOrderId) return;
    if (!confirm('この予約を「接客完了」にしますか？')) return;
    try {
      await apiPost('/bookings.php?action=update', { id: currentOrderId, status: 'completed' });
      toast('✓ 接客完了に更新しました', 'ok');
      closeModal('orderDetailModal');
      loadTimeline(true);
    } catch (e) { toast('更新失敗: ' + e.message, 'err'); }
  }

  // お客様メモを保存（この予約の notes。staff は自分の予約のみ＝サーバー側で認可）
  async function saveOrderNote() {
    if (!currentOrderId) return;
    const noteEl = document.getElementById('odNoteEdit');
    try {
      await apiPost('/bookings.php?action=set-note', { id: currentOrderId, notes: noteEl ? noteEl.value : '' });
      toast('✓ メモを保存しました', 'ok');
    } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
  }

  // ============== 予約情報をテキスト化（コピー用） ==============
  function buildBookingText(b) {
    const lines = [];
    const name = b.customer_name || b.customer_name_snapshot || '';
    lines.push(`【予約】${name || '匿名'} 様`);
    // 内部向け文面は営業日で表示（深夜0-10時は前営業日）
    const date = b.booking_date ? bizDateOf(b.booking_date, b.start_time || '00:00') : '';
    const st = String(b.start_time || '').substring(0, 5);
    const et = String(b.end_time || '').substring(0, 5);
    let dur = '';
    if (st && et) {
      const sh = parseInt(st.substring(0,2),10), sm = parseInt(st.substring(3,5),10);
      const eh = parseInt(et.substring(0,2),10), em = parseInt(et.substring(3,5),10);
      let m = (eh*60+em) - (sh*60+sm);
      if (m <= 0) m += 24*60;
      dur = ` (${m}分)`;
    }
    if (date || st) lines.push(`日時: ${date}${date && st ? ' ' : ''}${st}${st && et ? '〜' + et : ''}${dur}`);
    if (b.course_name) {
      const priceTxt = b.price ? ` ¥${Number(b.price).toLocaleString()}` : '';
      const lineBonus = String(b.media || '').split(',').includes('line');
      lines.push(`コース: ${b.course_name}${priceTxt}${lineBonus ? '（＋LINE予約特典10分無料）' : ''}${b.extension_count ? `（延長${b.ext_unit_min || 30}分×${b.extension_count}）` : ''}`);
    } else if (b.price) {
      lines.push(`料金: ¥${Number(b.price).toLocaleString()}`);
    }
    const _trans = (b.transport_fee != null && b.transport_fee !== '') ? Number(b.transport_fee) : 0;
    if (_trans > 0) lines.push(`交通費: ¥${_trans.toLocaleString()}`);
    const _disc = Number(b.discount) || 0;
    if (_disc > 0) lines.push(`🎁キャンペーン割引: -¥${_disc.toLocaleString()}`);
    const _stamp = Number(b.stamp_discount) || 0;
    if (_stamp > 0) lines.push(`🎟️スタンプ特典: -¥${_stamp.toLocaleString()}`);
    if (b.price && (_trans > 0 || _disc > 0 || _stamp > 0)) lines.push(`合計: ¥${(Number(b.price) + _trans - _disc - _stamp).toLocaleString()}`);
    const phone = b.customer_phone || b.customer_phone_snapshot || '';
    if (phone) lines.push(`電話: ${phone}`);
    const hotel = b.hotel_name_snapshot || b.hotel_name || '';
    if (hotel) {
      let loc = hotel;
      if (hotel.startsWith(HOME_PREFIX)) loc = '🏠 ' + hotel.replace(HOME_PREFIX, '');
      else if (hotel.startsWith(OTHER_PREFIX)) loc = '📍 ' + hotel.replace(OTHER_PREFIX, '');
      else loc = '🏨 ' + hotel;
      lines.push(`訪問先: ${loc}`);
    }
    if (b.room_number) lines.push(`部屋番号: ${b.room_number}`);
    const go = b.pickup_go_time ? String(b.pickup_go_time).substring(0,5) : '';
    const back = b.pickup_back_time ? String(b.pickup_back_time).substring(0,5) : '';
    if (go || back) {
      const parts = [];
      if (go) parts.push('送 ' + go + (b.driver_name ? ` [${b.driver_name}]` : ''));
      if (back) parts.push('迎 ' + back + (b.back_driver_name ? ` [${b.back_driver_name}]` : ''));
      lines.push(`🚗送迎: ${parts.join(' / ')}`);
    }
    if (b.notes) lines.push(`メモ:\n${b.notes}`);
    return lines.join('\n');
  }

  // お客様送信用の文面 (内部情報=電話/送迎/ドライバー/メモ を除外、丁寧な挨拶付き)
  function buildCustomerBookingText(b, stampUrl) {
    const name = b.customer_name || b.customer_name_snapshot || '';
    // 日付を「2026年6月14日(土)」形式に
    let dateStr = b.booking_date || '';
    try {
      if (b.booking_date) {
        const d = new Date(b.booking_date + 'T00:00:00');
        const w = ['日','月','火','水','木','金','土'][d.getDay()];
        dateStr = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日(${w})`;
      }
    } catch (e) {}
    const st = String(b.start_time || '').substring(0, 5);
    const et = String(b.end_time || '').substring(0, 5);
    const lines = [];
    lines.push(`${name || 'お客様'} 様`);
    lines.push('');
    lines.push('この度はご予約ありがとうございます。');
    lines.push('下記の内容で承りました。');
    lines.push('');
    if (dateStr || st) lines.push(`■ 日時：${dateStr}${dateStr && st ? ' ' : ''}${st}${st && et ? '〜' + et : ''}`);
    if (b.course_name) lines.push(`■ コース：${b.course_name}${String(b.media || '').split(',').includes('line') ? ' ＋ LINE予約特典10分（無料）' : ''}${b.extension_count ? ` ＋ 延長${b.ext_unit_min || 30}分×${b.extension_count}` : ''}`);
    if (b.media) lines.push(`■ 媒体：${mediaLabels(b.media)}`);
    const priceNum = Number(b.price) || 0;
    const transNum = (b.transport_fee != null && b.transport_fee !== '') ? Number(b.transport_fee) : 0;
    const discNum = Number(b.discount) || 0;
    if (priceNum) lines.push(`■ 料金：¥${priceNum.toLocaleString()}（税込）`);
    if (transNum > 0) lines.push(`■ 出張費：¥${transNum.toLocaleString()}`);
    if (discNum > 0) lines.push(`■ キャンペーン割引：-¥${discNum.toLocaleString()}`);
    const stampNum = Number(b.stamp_discount) || 0;
    if (stampNum > 0) lines.push(`■ スタンプ特典：-¥${stampNum.toLocaleString()}`);
    if (priceNum && (transNum > 0 || discNum > 0 || stampNum > 0)) lines.push(`■ 合計：¥${(priceNum + transNum - discNum - stampNum).toLocaleString()}（税込）`);
    // 訪問先 (内部プレフィックスは外して表示)
    const hotel = b.hotel_name_snapshot || b.hotel_name || '';
    if (hotel) {
      let loc = hotel;
      if (hotel.startsWith(HOME_PREFIX)) loc = hotel.replace(HOME_PREFIX, '');
      else if (hotel.startsWith(OTHER_PREFIX)) loc = hotel.replace(OTHER_PREFIX, '');
      lines.push(`■ 訪問先：${loc}${b.room_number ? ' ' + b.room_number + '号室' : ''}`);
    }
    if (b.therapist_name) lines.push(`■ 担当キャスト：${b.therapist_name}`);
    lines.push('');
    lines.push('当日はどうぞよろしくお願いいたします。');
    lines.push('ご変更・ご不明な点はお気軽にご連絡ください。');
    lines.push('');
    lines.push('＜スタンプカードのご案内＞');
    if (stampUrl) {
      lines.push(`${name || 'お客様'}様専用のスタンプカードはこちらです。`);
      lines.push('ご利用ごとにスタンプが貯まり、特典もございます。');
      lines.push(stampUrl);
    } else {
      lines.push('当店ではスタンプカードを発行しております。');
      lines.push('ご利用ごとにスタンプが貯まり、特典もございます。');
      lines.push('ご利用後、お客様専用のスタンプカードをお送りいたします。');
    }
    lines.push('');
    lines.push('───────────────');
    lines.push('YLKA（イルカ）');
    lines.push('立川・多摩エリア 出張リラクゼーション');
    lines.push('📞 042-512-8507（受付 10:00〜翌4:00）');
    return lines.join('\n');
  }

  // お客様用テキストをクリップボードにコピー (copyBookingFormAsText と同じ b 構築を流用)
  async function copyCustomerBookingText() {
    const isBreak = bel('bmBreakMode')?.checked;
    if (isBreak) { toast('休憩予約はお客様送信の対象外です', 'err'); return; }
    const sh = bel('bmStartHour').value;
    const sm = bel('bmStartMin').value;
    const endTxt = bel('bmEnd').value || '';
    const courseSel = bel('bmCourse');
    const courseOpt = courseSel?.options[courseSel.selectedIndex];
    let courseName = courseOpt?.dataset?.name || courseOpt?.text || '';
    if (courseSel?.value === 'custom') courseName = `カスタム ${bel('bmCustomMin').value}分`;
    const locType = document.querySelector(`input[name="bmLocType${activeBmSuffix}"]:checked`)?.value
      || document.querySelector('input[name="bmLocType"]:checked')?.value || 'hotel';
    let hotelSnap = '';
    let roomNum = '';
    if (locType === 'hotel') {
      const hid = bel('bmHotelId').value;
      if (hid) {
        const h = hotelsForSelect.find(x => Number(x.id) === Number(hid));
        hotelSnap = h ? h.name : '';
      } else {
        hotelSnap = bel('bmHotelName').value.trim();
      }
      roomNum = bel('bmRoom').value.trim();
    } else if (locType === 'home') {
      const addr = bel('bmHomeAddress').value.trim();
      const bld = bel('bmHomeBuilding').value.trim();
      hotelSnap = HOME_PREFIX + addr + (bld ? ' / ' + bld : '');
    } else if (locType === 'other') {
      hotelSnap = OTHER_PREFIX + bel('bmOtherLoc').value.trim();
    }
    const baseForCopy = parseInt(String(bel('bmPrice').value || '').replace(/[^\d]/g, ''), 10) || 0;
    const lateForCopy = bel('bmLateNight')?.checked ? LATE_NIGHT_FEE : 0;
    // 担当キャスト名 (select の表示テキスト、未割当は除外)
    const adSel = bel('bmAdminId');
    const adOpt = adSel?.options[adSel.selectedIndex];
    const therapistName = (adSel?.value && adOpt) ? (adOpt.dataset?.name || adOpt.text || '').trim() : '';
    const b = {
      customer_name_snapshot: bel('bmCustomerName').value.trim(),
      // お客様向け文面は実カレンダー日で表示（日付欄は営業日なので開始時刻から逆変換）
      booking_date: bizDateToCalendar(bel('bmDate').value, parseInt(sh, 10) || 0),
      start_time: ('0'+sh).slice(-2) + ':' + ('0'+sm).slice(-2),
      end_time: endTxt,
      course_name: courseName,
      price: baseForCopy + lateForCopy,
      discount: campaignDiscount(baseForCopy),
      stamp_discount: stampDiscount(baseForCopy - campaignDiscount(baseForCopy)),
      transport_fee: bel('bmTransport').value,
      hotel_name_snapshot: hotelSnap,
      room_number: roomNum,
      therapist_name: therapistName,
    };
    // お客様専用スタンプカードURL（会員トークンは未発行なら自動生成される）
    let stampUrl = '';
    const custId = bel('bmCustomerId').value;
    if (custId) {
      try { const d = await apiPost('/customers.php?action=member-link', { id: Number(custId) }); stampUrl = d?.url || ''; } catch (e) {}
    }
    const text = buildCustomerBookingText(b, stampUrl);
    const ok = await copyTextToClipboard(text);
    if (ok) toast('✓ お客様用テキストをコピーしました', 'ok');
    else toast('コピーに失敗しました', 'err');
  }

  async function copyTextToClipboard(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}
    // フォールバック (古いブラウザ / 非HTTPS)
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  // 予約編集モーダル → フォーム値からテキスト化
  async function copyBookingFormAsText() {
    const isBreak = bel('bmBreakMode')?.checked;
    if (isBreak) { toast('休憩予約はコピー対象外です', 'err'); return; }
    const sh = bel('bmStartHour').value;
    const sm = bel('bmStartMin').value;
    const endTxt = bel('bmEnd').value || '';
    const courseSel = bel('bmCourse');
    const courseOpt = courseSel?.options[courseSel.selectedIndex];
    let courseName = courseOpt?.dataset?.name || courseOpt?.text || '';
    if (courseSel?.value === 'custom') courseName = `カスタム ${bel('bmCustomMin').value}分`;
    // 訪問先文字列構築
    const locType = document.querySelector('input[name="bmLocType"]:checked')?.value || 'hotel';
    let hotelSnap = '';
    let roomNum = '';
    if (locType === 'hotel') {
      const hid = bel('bmHotelId').value;
      if (hid) {
        const h = hotelsForSelect.find(x => Number(x.id) === Number(hid));
        hotelSnap = h ? h.name : '';
      } else {
        hotelSnap = bel('bmHotelName').value.trim();
      }
      roomNum = bel('bmRoom').value.trim();
    } else if (locType === 'home') {
      const addr = bel('bmHomeAddress').value.trim();
      const bld = bel('bmHomeBuilding').value.trim();
      hotelSnap = HOME_PREFIX + addr + (bld ? ' / ' + bld : '');
    } else if (locType === 'other') {
      hotelSnap = OTHER_PREFIX + bel('bmOtherLoc').value.trim();
    }
    // ドライバー名取得（行き/帰り）
    const drvSel = bel('bmDriverId');
    const drvOpt = drvSel?.options[drvSel.selectedIndex];
    const drvName = drvSel?.value ? (drvOpt?.text || '') : '';
    const drvBackSel = bel('bmBackDriverId');
    const drvBackOpt = drvBackSel?.options[drvBackSel.selectedIndex];
    const drvBackName = drvBackSel?.value ? (drvBackOpt?.text || '') : '';
    const baseForCopy = parseInt(String(bel('bmPrice').value || '').replace(/[^\d]/g, ''), 10) || 0;
    const lateForCopy = bel('bmLateNight')?.checked ? LATE_NIGHT_FEE : 0;
    const discForCopy = campaignDiscount(baseForCopy);
    const b = {
      customer_name_snapshot: bel('bmCustomerName').value.trim(),
      customer_phone_snapshot: bel('bmCustomerPhone').value.trim(),
      // オブジェクトの booking_date は常にカレンダー日で持つ（buildBookingText 側で営業日に整形表示）
      booking_date: bizDateToCalendar(bel('bmDate').value, parseInt(sh, 10) || 0),
      start_time: ('0'+sh).slice(-2) + ':' + ('0'+sm).slice(-2),
      end_time: endTxt,
      course_name: courseName,
      price: baseForCopy + lateForCopy,
      discount: discForCopy,
      stamp_discount: stampDiscount(baseForCopy - discForCopy),
      transport_fee: bel('bmTransport').value,
      hotel_name_snapshot: hotelSnap,
      room_number: roomNum,
      media: getBmMedia().join(','),
      extension_count: extCount(),
      ext_unit_min: _extUnit.min,
      notes: bel('bmNotes').value,
    };
    const text = buildBookingText(b);
    const ok = await copyTextToClipboard(text);
    if (ok) toast('✓ コピーしました', 'ok');
    else toast('コピーに失敗しました', 'err');
  }

  // オーダー詳細モーダル → 直近に読み込んだ予約をテキスト化
  let _odLastBooking = null;
  async function copyOrderDetailAsText() {
    if (!_odLastBooking) { toast('予約情報がありません', 'err'); return; }
    const text = buildBookingText(_odLastBooking);
    const ok = await copyTextToClipboard(text);
    if (ok) toast('✓ コピーしました', 'ok');
    else toast('コピーに失敗しました', 'err');
  }

  async function saveBooking() {
    const isBreak = bel('bmBreakMode')?.checked;
    let totalMin;
    let phone = '', name = '';
    const sh = parseInt(bel('bmStartHour').value, 10);
    const sm = parseInt(bel('bmStartMin').value, 10);
    // 日付欄は営業日。開始時刻(0-9時台)なら翌カレンダー日へ戻して保存（保存値は常にカレンダー日）
    const bookingDate = bizDateToCalendar(bel('bmDate').value, sh);
    const totalStart = sh * 60 + sm;
    let eh, em, totalEnd;
    if (isBreak) {
      name = '【休憩】';
      totalMin = breakDurToMinutes();
      if (!totalMin || totalMin <= 0) { toast('休憩時間を選択してください', 'err'); return; }
      totalEnd = totalStart + totalMin;
      eh = Math.floor(totalEnd / 60) % 24;
      em = totalEnd % 60;
    } else {
      totalMin = courseToMinutes();
      if (!totalMin) { toast('コースを選択してください', 'err'); return; }
      phone = bel('bmCustomerPhone').value.trim();
      name = bel('bmCustomerName').value.trim();
      if (!name) { toast('お名前を入力してください', 'err'); return; }
      // 終了時刻はカウンセリング+10分を加算（コース名・料金は totalMin のまま）
      totalEnd = totalStart + totalMin + lineBonusExtra() + extMinutes();
      eh = Math.floor(totalEnd / 60) % 24;
      em = totalEnd % 60;
    }
    const sp = { booking_date: bookingDate, time: ('0'+sh).slice(-2) + ':' + ('0'+sm).slice(-2) };
    const ep = { time: ('0'+eh).slice(-2) + ':' + ('0'+em).slice(-2) };
    // コース表示名（dataset.name から取得、selectのtextに料金が含まれるため）
    const courseSelect = bel('bmCourse');
    const opt = courseSelect.options[courseSelect.selectedIndex];
    let courseName = opt?.dataset?.name || opt?.text || '';
    if (courseSelect.value === 'custom') courseName = `カスタム${totalMin}分`;
    if (isBreak) courseName = '休憩';
    // ロケーション処理
    let hotelId = null;
    let hotelSnapshot = '';
    let roomNumber = '';
    let displayCity = null;
    if (!isBreak) {
      const locType = document.querySelector('input[name="bmLocType"]:checked')?.value || 'hotel';
      if (locType === 'hotel') {
        hotelId = bel('bmHotelId').value || null;
        hotelSnapshot = bel('bmHotelName').value.trim();
        roomNumber = bel('bmRoom').value.trim();
        // 選択ホテルから city を抽出
        if (hotelId && Array.isArray(hotelsForSelect)) {
          const h = hotelsForSelect.find(x => Number(x.id) === Number(hotelId));
          if (h && h.city) displayCity = h.city;
        }
        if (!displayCity) displayCity = extractCityFromAddress(hotelSnapshot);
      } else if (locType === 'home') {
        const addr = bel('bmHomeAddress').value.trim();
        const bld = bel('bmHomeBuilding').value.trim();
        if (!addr) { toast('住所を入力してください', 'err'); return; }
        hotelSnapshot = HOME_PREFIX + addr + (bld ? ' / ' + bld : '');
        displayCity = extractCityFromAddress(addr);
      } else if (locType === 'other') {
        const other = bel('bmOtherLoc').value.trim();
        if (!other) { toast('場所の詳細を入力してください', 'err'); return; }
        hotelSnapshot = OTHER_PREFIX + other;
        displayCity = extractCityFromAddress(other);
      }
    } else {
      // 休憩: ユーザー入力 (未入力なら立川市)
      displayCity = (bel('bmBreakCity')?.value || '').trim() || '立川市';
    }

    const payload = {
      customer_id: isBreak ? null : (bel('bmCustomerId').value || null),
      customer_name_snapshot: name,
      customer_phone_snapshot: phone,
      customer_email_snapshot: isBreak ? '' : bel('bmCustomerEmail').value,
      booking_date: sp.booking_date,
      start_time: sp.time,
      end_time: ep.time,
      course_name: courseName,
      hotel_id: hotelId,
      hotel_name_snapshot: hotelSnapshot,
      display_city: displayCity,
      room_number: roomNumber,
      assigned_admin_id: bel('bmAdminId').value || null,
      status: isBreak ? 'confirmed' : bel('bmStatus').value,
      cancellation_reason_type: bel('bmStatus').value === 'cancelled' && !isBreak ? bel('bmCancelType').value : null,
      cancellation_reason: bel('bmStatus').value === 'cancelled' && !isBreak ? bel('bmCancelReason').value : null,
      cancellation_fee: bel('bmStatus').value === 'cancelled' && bel('bmCancelType').value === 'customer' && !isBreak ? moneyVal('bmCancelFee') : null,
      cancellation_reward: bel('bmStatus').value === 'cancelled' && bel('bmCancelType').value === 'customer' && !isBreak ? moneyVal('bmCancelReward') : null,
      price: (() => {
        if (isBreak) return 0;
        // 預り金の手入力があれば自動計算をまるごと上書き（出張費込み・微調整用）
        const depositRaw = String(bel('bmDepositOverride')?.value || '').replace(/[^\d]/g, '');
        if (depositRaw !== '') return parseInt(depositRaw, 10) || 0;
        // コース料金欄が空ならコースマスタの基本料金で補完
        let base = parseInt(String(bel('bmPrice').value || '').replace(/[^\d]/g, ''), 10) || 0;
        if (!base) base = parseInt(opt?.dataset?.price || '0', 10) || 0;
        const late = bel('bmLateNight')?.checked ? LATE_NIGHT_FEE : 0;
        const nomFee = nominationFeeFor(bel('bmNomination')?.value);
        const disc = campaignDiscount(base);
        const stamp = stampDiscount(base - disc);
        return base + late + extAmount() + nomFee - disc - stamp;  // コース + 深夜 + 延長 + 指名料 − キャンペーン割引 − スタンプ特典
      })(),
      late_fee: isBreak ? 0 : (bel('bmLateNight')?.checked ? LATE_NIGHT_FEE : 0),
      // 預り金の手入力があれば出張費込みで上書きするため、出張費は0にして二重計上を防ぐ
      transport_fee: isBreak ? 0 : (String(bel('bmDepositOverride')?.value || '').replace(/[^\d]/g, '') !== '' ? 0 : bel('bmTransport').value),
      extension_count: isBreak ? 0 : extCount(),
      payment_method: isBreak ? null : (bel('bmPayment')?.value || null),
      nomination_type: isBreak ? null : (bel('bmNomination')?.value || null),
      nomination_fee: isBreak ? 0 : nominationFeeFor(bel('bmNomination')?.value),
      media: isBreak ? '' : getBmMedia().join(','),
      notes: isBreak ? ('[休憩] ' + bel('bmNotes').value).trim() : bel('bmNotes').value,
      reward_override: (() => {
        const raw = String(bel('bmRewardOverride')?.value || '').replace(/[^\d]/g, '');
        return raw !== '' ? parseInt(raw, 10) : null;
      })(),
    };
    try {
      const editId = getEditingBookingId();
      if (editId) {
        await apiPost('/bookings.php?action=update', { id: editId, ...payload });
        toast('✓ 更新しました', 'ok');
      } else {
        await apiPost('/bookings.php?action=create', payload);
        toast('✓ 予約を作成しました', 'ok');
      }
      closeModal('bookingModal' + activeBmSuffix);
      // 関連ビュー更新
      const activeView = document.querySelector('.view.active')?.id;
      if (activeView === 'view-timeline') loadTimeline(true);
      else if (activeView === 'view-bookings') loadBookings();
    } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
  }

  async function deleteBooking() {
    const editId = getEditingBookingId();
    if (!editId) return;
    if (!confirm('この予約を削除しますか？')) return;
    try {
      await apiPost('/bookings.php?action=delete', { id: editId });
      toast('✓ 削除しました', 'ok');
      closeModal('bookingModal' + activeBmSuffix);
      const activeView = document.querySelector('.view.active')?.id;
      if (activeView === 'view-timeline') loadTimeline(true);
      else if (activeView === 'view-bookings') loadBookings();
    } catch (e) { toast('削除失敗: ' + e.message, 'err'); }
  }

  // ========== Customers ==========
  async function loadCustomers() {
    const el = document.getElementById('customerList');
    el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';
    const kw = document.getElementById('cuKeyword').value.trim();
    const sort = document.getElementById('cuSort')?.value || 'recent';
    try {
      const d = await api('/customers.php?action=list&sort=' + sort + (kw ? '&keyword=' + encodeURIComponent(kw) : ''));
      customersList = d.customers || [];
      renderCustomers();
    } catch (e) {
      el.innerHTML = '<div class="view-empty">読み込み失敗</div>';
    }
  }
  function renderCustomers() {
    const el = document.getElementById('customerList');
    if (customersList.length === 0) {
      el.innerHTML = '<div class="view-empty"><div class="ve-icon">👥</div>顧客はまだ登録されていません</div>';
      return;
    }
    el.innerHTML = customersList.map(c => {
      // 利用回数は旧システムの実績＋OPSの予約の合計（OPS分だけだと全員0回に見えてしまう）
      const cnt = (c.total_visits != null)
        ? Number(c.total_visits)
        : Number(c.visit_count || 0) + Number(c.actual_booking_count || 0);
      const last = c.last_visit_at ? String(c.last_visit_at).slice(0, 10).replace(/-/g, '/') : '';
      return `
      <div class="cu-row" data-customer-id="${c.id}">
        <div class="cu-name">${escapeHtml(c.name)}${c.name_kana ? `<span class="kana">${escapeHtml(c.name_kana)}</span>` : ''}</div>
        <div class="cu-contact">${c.phone ? '📞 ' + escapeHtml(c.phone) : ''} ${c.email ? '✉️ ' + escapeHtml(c.email) : ''}${last ? `<span class="cu-last">最終 ${escapeHtml(last)}</span>` : ''}</div>
        <div class="cu-visits"><b>${cnt.toLocaleString()}</b><br>回</div>
        <div class="cu-actions"><button>編集</button></div>
      </div>`;
    }).join('');
    el.querySelectorAll('.cu-row').forEach(r => {
      r.addEventListener('click', () => openCustomerModal(Number(r.dataset.customerId)));
    });
  }

  // 会員証URLを入力欄に表示（発行ボタンを隠してコピー行を出す）
  function showMemberUrl(url) {
    const row = document.getElementById('cmMemberRow');
    const btn = document.getElementById('cmMemberBtn');
    const u = document.getElementById('cmMemberUrl');
    if (u) u.value = url;
    if (row) row.style.display = 'flex';
    if (btn) btn.style.display = 'none';
  }

  async function openCustomerModal(id) {
    editingCustomerId = id;
    document.getElementById('cmTitle').textContent = id ? '顧客編集' : '新規顧客';
    document.getElementById('cmDelete').style.display = id && currentUser?.role === 'owner' ? 'inline-flex' : 'none';
    document.getElementById('cmHistory').style.display = 'none';
    // 会員証リンク（既存顧客のみ）
    const memWrap = document.getElementById('cmMemberWrap');
    if (memWrap) {
      memWrap.style.display = id ? 'block' : 'none';
      const row = document.getElementById('cmMemberRow');
      const btn = document.getElementById('cmMemberBtn');
      const u = document.getElementById('cmMemberUrl');
      if (u) u.value = '';
      if (row) row.style.display = 'none';
      if (btn) btn.style.display = '';
    }

    if (id) {
      try {
        const d = await api('/customers.php?action=get&id=' + id);
        const c = d.customer;
        document.getElementById('cmName').value = c.name || '';
        document.getElementById('cmKana').value = c.name_kana || '';
        document.getElementById('cmPhone').value = c.phone || '';
        document.getElementById('cmPhone2').value = c.phone2 || '';
        document.getElementById('cmEmail').value = c.email || '';
        document.getElementById('cmGender').value = c.gender || '';
        document.getElementById('cmLocation').value = c.default_location || '';
        document.getElementById('cmLocation2').value = c.default_location2 || '';
        document.getElementById('cmNotes').value = c.notes || '';
        // 会員証（スタンプカード）URL: トークン既発行なら即表示
        if (c.member_token) showMemberUrl('https://ylka.jp/member.html?t=' + c.member_token);
        // 誓約書 復元
        try { cmPledgesState = JSON.parse(c.pledge_images || '[]') || []; }
        catch (_) { cmPledgesState = []; }
        if (!Array.isArray(cmPledgesState)) cmPledgesState = [];
        renderCmPledges();

        // 予約履歴（OPS） + 旧システム履歴 + チャット履歴を統合表示
        const bookings = d.bookings || [];
        const legacy = d.legacy_visits || [];   // 2017-10〜2026-07 の取り込み分（import-ops-visits.php）
        const chats = d.chat_sessions || [];
        const histEl = document.getElementById('cmHistory');
        const listEl = document.getElementById('cmHistoryList');
        if (bookings.length > 0 || legacy.length > 0 || chats.length > 0) {
          histEl.style.display = 'block';
          const CHAT_STATUS_LABEL = { open:'対応中', closed:'終了', archived:'保管' };
          // ご利用履歴: 旧システムの一覧と同じ表形式（区分/利用日/キャスト/コース/指名/料金/場所/メモ）
          const merged = mergeHistoryRows(bookings, legacy);
          const bookingHtml = merged.length === 0 ? '' : `
            <div style="margin-bottom:.8rem;">
              <div style="font-weight:700;color:var(--deep);margin-bottom:.3rem;font-size:.88rem;">📅 ご利用履歴 (${merged.length}件)</div>
              ${renderHistoryTable(merged, { clickable: true })}
            </div>`;
          const chatHtml = chats.length === 0 ? '<div style="font-size:.78rem;color:var(--ink-soft);">💬 チャット履歴なし</div>' : `
            <div>
              <div style="font-weight:700;color:var(--deep);margin-bottom:.3rem;font-size:.88rem;">💬 チャット履歴 (${chats.length}件)</div>
              ${chats.map(s => {
                const preview = (s.last_message || '').replace(/\n/g, ' ').substring(0, 60);
                const date = (s.updated_at || s.created_at || '').substring(0, 16).replace('T',' ');
                return `
                <div class="cm-chat-row" data-session-id="${s.id}" style="padding:.45rem .5rem;border-bottom:1px dashed var(--gray);cursor:pointer;border-radius:6px;display:flex;justify-content:space-between;gap:.5rem;align-items:center;">
                  <div style="min-width:0;flex:1;">
                    <div style="font-size:.82rem;color:var(--ink-soft);">${escapeHtml(date)} · ${CHAT_STATUS_LABEL[s.status] || s.status}</div>
                    <div style="font-size:.83rem;color:var(--deep);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(preview) || '<span style="color:var(--ink-soft);">(メッセージなし)</span>'}</div>
                  </div>
                  <button class="btn-secondary cm-chat-open" data-session-id="${s.id}" style="padding:.4rem .7rem;font-size:.75rem;white-space:nowrap;">開く →</button>
                </div>`;
              }).join('')}
            </div>`;
          listEl.innerHTML = bookingHtml + chatHtml;
          // 予約行クリック → 予約モーダルへ
          listEl.querySelectorAll('tr.clickable[data-booking-id]').forEach(row => {
            row.addEventListener('click', () => {
              closeModal('customerModal');
              openBookingModal(Number(row.dataset.bookingId));
            });
          });
          // チャットを開くボタン → チャットタブ + セッション選択
          listEl.querySelectorAll('.cm-chat-open').forEach(btn => {
            btn.addEventListener('click', e => {
              e.stopPropagation();
              const sid = Number(btn.dataset.sessionId);
              closeModal('customerModal');
              switchView('chat');
              // チャットセッションを開く (loadChatInbox 後にセッション選択)
              setTimeout(() => { try { openChatThread(sid); } catch (_) {} }, 350);
            });
          });
        } else {
          histEl.style.display = 'none';
        }
      } catch (e) { toast('読み込み失敗', 'err'); return; }
    } else {
      ['cmName','cmKana','cmPhone','cmPhone2','cmEmail','cmGender','cmLocation','cmLocation2','cmNotes'].forEach(i => document.getElementById(i).value = '');
      cmPledgesState = [];
      renderCmPledges();
    }
    openModal('customerModal');
  }

  // ========== 誓約書アップロード ==========
  let cmPledgesState = [];  // [{url: dataURL, uploaded_at: ISOString}]

  function renderCmPledges() {
    const el = document.getElementById('cmPledgeList');
    if (!el) return;
    if (cmPledgesState.length === 0) {
      el.innerHTML = '<div style="color:var(--ink-soft);font-size:.8rem;padding:.4rem 0;">未登録</div>';
      return;
    }
    el.innerHTML = cmPledgesState.map((p, i) => {
      const date = p.uploaded_at ? String(p.uploaded_at).substring(0, 10) : '';
      const fromCounseling = p.source === 'counseling';
      const srcBadge = fromCounseling
        ? `<div style="position:absolute;top:-6px;left:-6px;background:var(--sea);color:#fff;font-size:.6rem;font-weight:700;padding:.1rem .35rem;border-radius:50px;white-space:nowrap;">📋シート</div>`
        : '';
      return `<div class="cm-pledge-thumb" data-idx="${i}" style="position:relative;width:84px;">
        <img src="${escapeAttr(p.url)}" alt="誓約書${i+1}" data-open-pledge="${i}" style="width:84px;height:84px;object-fit:cover;border-radius:10px;border:1.5px solid var(--gray);cursor:pointer;display:block;">
        ${srcBadge}
        <button type="button" data-del-pledge="${i}" title="削除" style="position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;background:var(--red);color:#fff;border:none;font-size:13px;cursor:pointer;line-height:1;font-weight:700;">×</button>
        <div style="font-size:.65rem;color:var(--ink-soft);text-align:center;margin-top:.2rem;">${escapeHtml(date)}</div>
      </div>`;
    }).join('');
    // クリックで拡大表示
    el.querySelectorAll('[data-open-pledge]').forEach(img => {
      img.addEventListener('click', () => openPledgeLightbox(Number(img.dataset.openPledge)));
    });
    // 削除ボタン
    el.querySelectorAll('[data-del-pledge]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const i = Number(btn.dataset.delPledge);
        if (confirm('この誓約書画像を削除しますか？（保存ボタンで確定）')) {
          cmPledgesState.splice(i, 1);
          renderCmPledges();
        }
      });
    });
  }

  function openPledgeLightbox(idx) {
    const p = cmPledgesState[idx];
    if (!p) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:1rem;';
    overlay.innerHTML = `<img src="${escapeAttr(p.url)}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;">`;
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }

  // 画像縮小: 長辺 max 1600px、JPEG 0.85
  async function resizePledgeImage(file) {
    const MAX = 1600;
    const QUALITY = 0.85;
    const reader = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = reader;
    });
    const longSide = Math.max(img.width, img.height);
    const scale = longSide > MAX ? MAX / longSide : 1;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', QUALITY);
  }

  async function handlePledgeUpload(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('画像ファイルを選択してください', 'err'); return; }
    if (file.size > 20 * 1024 * 1024) { toast('画像が大きすぎます (20MB以下)', 'err'); return; }
    try {
      const dataUrl = await resizePledgeImage(file);
      cmPledgesState.push({ url: dataUrl, uploaded_at: new Date().toISOString() });
      renderCmPledges();
      toast('✓ 追加しました (保存ボタンで確定)', 'ok');
    } catch (e) { toast('画像処理に失敗: ' + (e.message || e), 'err'); }
  }

  async function saveCustomer() {
    const name = document.getElementById('cmName').value.trim();
    if (!name) { toast('お名前を入力してください', 'err'); return; }
    const payload = {
      name, name_kana: document.getElementById('cmKana').value,
      phone: document.getElementById('cmPhone').value,
      phone2: document.getElementById('cmPhone2').value,
      email: document.getElementById('cmEmail').value, gender: document.getElementById('cmGender').value,
      default_location: document.getElementById('cmLocation').value,
      default_location2: document.getElementById('cmLocation2').value,
      notes: document.getElementById('cmNotes').value,
      pledge_images: JSON.stringify(cmPledgesState || []),
    };
    try {
      if (editingCustomerId) {
        await apiPost('/customers.php?action=update', { id: editingCustomerId, ...payload });
        toast('✓ 更新しました', 'ok');
      } else {
        await apiPost('/customers.php?action=create', payload);
        toast('✓ 顧客を追加しました', 'ok');
      }
      closeModal('customerModal');
      loadCustomers();
    } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
  }
  async function deleteCustomer() {
    if (!editingCustomerId || !confirm('この顧客を削除しますか？\n過去の予約データは残りますが顧客情報は失われます。')) return;
    try {
      await apiPost('/customers.php?action=delete', { id: editingCustomerId });
      toast('✓ 削除しました', 'ok');
      closeModal('customerModal');
      loadCustomers();
    } catch (e) { toast('削除失敗: ' + e.message, 'err'); }
  }

  // ========== Shifts (calendar / timetable) ==========
  function setShiftViewMode(mode) {
    shViewMode = mode;
    document.getElementById('shModeTimetable').classList.toggle('is-active', mode === 'timetable');
    document.getElementById('shModeCalendar').classList.toggle('is-active', mode === 'calendar');
    document.getElementById('shTimetable').style.display = mode === 'timetable' ? '' : 'none';
    document.getElementById('shCalendar').style.display = mode === 'calendar' ? '' : 'none';
    // スタッフフィルタの「全スタッフ」オプションは表示モードで出し分け
    //   - タイムテーブル: 1日1行で1人分しか登録できないので「全スタッフ」非表示
    //   - カレンダー: 全員のシフトをピル表示できるので「全スタッフ」表示
    syncShiftStaffFilterForMode();
    // モード切替時は今日基準にリセット (起点が日/月で意味が違うので)
    shCurrent = mode === 'timetable' ? getBusinessDayDate() : new Date();
    loadShifts();
  }

  function syncShiftStaffFilterForMode() {
    const sel = document.getElementById('shStaffFilter');
    if (!sel) return;
    const allOpt = sel.querySelector('option[value=""]');
    if (!allOpt) return;
    if (shViewMode === 'timetable') {
      allOpt.style.display = 'none';
      allOpt.disabled = true;
      // 「全スタッフ」が選ばれていたら、現在ユーザー or 最初の実スタッフに切替
      if (sel.value === '') {
        const firstReal = Array.from(sel.options).find(o => o.value);
        if (firstReal) {
          sel.value = currentUser?.id && Array.from(sel.options).some(o => o.value === String(currentUser.id))
            ? String(currentUser.id) : firstReal.value;
          shSelectedStaff = sel.value;
        }
      }
    } else {
      allOpt.style.display = '';
      allOpt.disabled = false;
    }
  }

  // 30 分刻みの時刻オプション (10:00〜翌10:00)
  function shiftTimeOptions(includeStart) {
    const opts = [];
    // 開始: 10:00〜翌09:30 / 終了: 10:30〜翌10:00
    const startMin = includeStart ? 10 * 60 : 10 * 60 + 30;
    const endMin = includeStart ? 10 * 60 + 24 * 60 - 30 : 10 * 60 + 24 * 60;
    for (let m = startMin; m <= endMin; m += 30) {
      const totalH = Math.floor(m / 60);
      const mi = m % 60;
      const dispH = totalH >= 24 ? totalH - 24 : totalH;
      const prefix = totalH >= 24 ? '翌' : '';
      const val = `${String(dispH).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
      const label = `${prefix}${String(dispH).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
      // 終了時刻の「翌10:00」は値が start と同じ "10:00" になるので、24h を区別するため特別扱い
      opts.push({ val, label, crossDay: totalH >= 24 });
    }
    return opts;
  }

  async function loadShifts() {
    if (currentUser?.role === 'owner' && document.getElementById('shStaffFilter').options.length <= 1) {
      try {
        const d = await api('/admin-api.php?action=admin-users');
        // キャストの出勤は CTRL(/ctrl/schedules.php)が正なのでここには出さない。
        // シフトは内勤スタッフ・ドライバーのスケジュール登録専用
        const targets = (d.users || []).filter(u => isOfficeCapable(u) || isDriverCapable(u));
        const sel = document.getElementById('shStaffFilter');
        sel.style.display = 'inline-block';
        sel.innerHTML = '<option value="">全スタッフ</option>' + targets.map(u => `<option value="${u.id}">${escapeHtml(u.display_name || u.username)}</option>`).join('');
        syncShiftStaffFilterForMode();
        if (targets.length === 0) {
          const msg = '<div class="view-empty">内勤スタッフ・ドライバーがまだ登録されていません。<br>'
                    + '「スタッフ管理」で追加すると、ここでスケジュールを登録できます。<br>'
                    + '<span style="font-size:.85rem;color:var(--ink-soft);">※ キャストの出勤は CTRL の「出勤管理」で登録してください</span></div>';
          document.getElementById('shTimetable').innerHTML = msg;
          document.getElementById('shCalendar').innerHTML = msg;
          return;
        }
      } catch (e) {}
    }

    if (shViewMode === 'timetable') return loadShiftsTimetable();
    return loadShiftsCalendar();
  }

  async function loadShiftsCalendar() {
    const cal = document.getElementById('shCalendar');
    cal.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';

    const y = shCurrent.getFullYear(), m = shCurrent.getMonth();
    document.getElementById('shTitle').textContent = `${y}年 ${m+1}月`;
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m+1, 0);
    const startDow = firstDay.getDay();
    const gridStart = addDays(firstDay, -startDow);
    const gridEnd = addDays(lastDay, 6 - lastDay.getDay());

    try {
      const params = new URLSearchParams({ from: fmtDate(gridStart), to: fmtDate(gridEnd) });
      if (shSelectedStaff) params.set('admin_id', shSelectedStaff);
      const d = await api('/shifts.php?action=range&' + params.toString());
      renderShiftCalendar(gridStart, gridEnd, d.shifts || []);
    } catch (e) {
      cal.innerHTML = '<div class="view-empty">読み込み失敗</div>';
    }
  }

  async function loadShiftsTimetable() {
    const tt = document.getElementById('shTimetable');
    tt.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';

    const start = new Date(shCurrent.getFullYear(), shCurrent.getMonth(), shCurrent.getDate());
    const end = addDays(start, 9);  // 10日分
    document.getElementById('shTitle').textContent = `内勤・送迎シフト ${fmtDate(start)} 〜 ${fmtDate(end)}`;

    try {
      const params = new URLSearchParams({ from: fmtDate(start), to: fmtDate(end) });
      // owner で staff 未選択時は自分の id を渡す (タイムテーブルは 1 スタッフ分)
      const targetAdminId = shSelectedStaff || currentUser?.id;
      if (targetAdminId) params.set('admin_id', targetAdminId);
      const d = await api('/shifts.php?action=range&' + params.toString());
      shCachedShifts = d.shifts || [];
      renderShiftTimetable(start, shCachedShifts, targetAdminId);
    } catch (e) {
      tt.innerHTML = '<div class="view-empty">読み込み失敗</div>';
    }
  }

  function renderShiftTimetable(startDate, shifts, targetAdminId) {
    const tt = document.getElementById('shTimetable');
    const todayStr = fmtDate(getBusinessDayDate());
    const startOpts = shiftTimeOptions(true);
    const endOpts = shiftTimeOptions(false);
    let html = '';
    for (let i = 0; i < 10; i++) {
      const d = addDays(startDate, i);
      const ds = fmtDate(d);
      const dow = ['日','月','火','水','木','金','土'][d.getDay()];
      const dowClass = d.getDay() === 0 ? 'dow-sun' : d.getDay() === 6 ? 'dow-sat' : '';
      const isToday = ds === todayStr;
      const s = shifts.find(x => x.shift_date === ds) || null;
      const isRegistered = !!s;
      const status = s?.status || '';  // '' = 未登録
      const start = s ? s.start_time.substring(0,5) : '10:00';
      const end = s ? s.end_time.substring(0,5) : '22:00';
      const note = s?.note || '';
      const is24h = isRegistered && start === '10:00' && end === '10:00';
      const rowClasses = [
        dowClass,
        isToday ? 'today' : '',
        !isRegistered ? 'is-unreg' : '',
        status === 'off' ? 'is-off-only' : '',
        is24h ? 'is-24h' : '',
      ].filter(Boolean).join(' ');
      const buildOpts = (opts, sel) => opts.map(o => `<option value="${o.val}"${o.val === sel ? ' selected' : ''}>${o.label}</option>`).join('');
      const currentChip = isRegistered ? status : 'unreg';
      // PC=フル / モバイル=省略 を data-short で出し分け
      const chip = (val, full, short) => `<button type="button" class="sh-tt-stchip${currentChip === val ? ' is-on' : ''}" data-status="${val}"><span class="lbl-full">${full}</span><span class="lbl-short">${short}</span></button>`;
      html += `<div class="sh-tt-row ${rowClasses}" data-date="${ds}" data-shift-id="${s?.id || ''}">
        <div class="sh-tt-date"><span>${d.getDate()}日</span><span class="dow">(${dow})</span><span class="ymd">${ds.substring(5)}</span></div>
        <div class="sh-tt-stchips">
          ${chip('available', '🟢 出勤', '🟢出')}
          ${chip('tentative', '🟡 仮', '🟡仮')}
          ${chip('off', '⚫ 休み', '⚫休')}
          ${chip('unreg', '○ 未登録', '○未')}
        </div>
        <label class="sh-tt-24h" title="10:00〜翌10:00 (24時間)"><input type="checkbox" class="sh-tt-24h-cb"${is24h?' checked':''}>24H</label>
        <select class="sh-tt-start" data-field="start_time"${is24h?' disabled':''}>${buildOpts(startOpts, start)}</select>
        <select class="sh-tt-end" data-field="end_time"${is24h?' disabled':''}>${buildOpts(endOpts, end)}</select>
        <input type="text" class="sh-tt-memo" data-field="note" value="${escapeAttr(note)}" placeholder="メモ (任意)">
        <div class="sh-tt-status-cell">
          <span class="sh-status-indicator"></span>
        </div>
      </div>`;
    }
    tt.innerHTML = html;

    // ステータスチップ: 4択 (未登録/出勤/仮/休み) 排他切替
    tt.querySelectorAll('.sh-tt-stchip').forEach(chip => {
      chip.addEventListener('click', async () => {
        const row = chip.closest('.sh-tt-row');
        const newStatus = chip.dataset.status;
        const isAlreadyOn = chip.classList.contains('is-on');
        if (isAlreadyOn) return;  // 既に選択中 → 何もしない

        // 排他切替: 全チップ OFF → クリックしたものだけ ON
        row.querySelectorAll('.sh-tt-stchip').forEach(c => c.classList.remove('is-on'));
        chip.classList.add('is-on');

        if (newStatus === 'unreg') {
          // 未登録 → 既存があれば削除
          row.classList.add('is-unreg');
          row.classList.remove('is-off-only');
          const existingId = row.dataset.shiftId ? Number(row.dataset.shiftId) : 0;
          if (existingId) {
            try {
              await apiPost('/shifts.php?action=delete', { id: existingId });
              row.dataset.shiftId = '';
              toast('✓ 未登録に戻しました', 'ok');
            } catch (e) { toast('削除失敗: ' + e.message, 'err'); }
          }
        } else {
          // 出勤/仮/休み → 保存
          row.classList.remove('is-unreg');
          row.classList.toggle('is-off-only', newStatus === 'off');
          saveShiftTimetableRow(row, targetAdminId);
        }
      });
    });

    // 24H チェック: ON で 10:00〜翌10:00 固定、プルダウンを disable
    tt.querySelectorAll('.sh-tt-24h-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const row = cb.closest('.sh-tt-row');
        const startSel = row.querySelector('.sh-tt-start');
        const endSel = row.querySelector('.sh-tt-end');
        if (cb.checked) {
          startSel.value = '10:00';
          endSel.value = '10:00';
          startSel.disabled = true;
          endSel.disabled = true;
          row.classList.add('is-24h');
        } else {
          startSel.disabled = false;
          endSel.disabled = false;
          if (endSel.value === '10:00') endSel.value = '22:00';
          row.classList.remove('is-24h');
        }
        saveShiftTimetableRow(row, targetAdminId);
      });
    });

    // 自動保存: change で upsert (未登録行は無視)
    tt.querySelectorAll('.sh-tt-row').forEach(row => {
      row.querySelectorAll('select[data-field], input[type=text]').forEach(el => {
        el.addEventListener('change', () => {
          if (row.classList.contains('is-unreg')) return;  // 未登録 → 保存しない
          saveShiftTimetableRow(row, targetAdminId);
        });
      });
    });
  }

  let _shiftSaveTimers = {};
  async function saveShiftTimetableRow(row, targetAdminId) {
    if (row.classList.contains('is-unreg')) return;  // 未登録行は保存しない
    const ds = row.dataset.date;
    const activeChip = row.querySelector('.sh-tt-stchip.is-on');
    if (!activeChip) return;  // 状態未選択 → 保存しない
    const status = activeChip.dataset.status;
    const start = row.querySelector('.sh-tt-start').value;
    const end = row.querySelector('.sh-tt-end').value;
    const note = row.querySelector('.sh-tt-memo').value;
    const existingId = row.dataset.shiftId ? Number(row.dataset.shiftId) : 0;
    const indicator = row.querySelector('.sh-status-indicator');
    indicator.innerHTML = '<span class="sh-saving">保存中…</span>';

    clearTimeout(_shiftSaveTimers[ds]);
    _shiftSaveTimers[ds] = setTimeout(async () => {
      const payload = {
        shift_date: ds,
        start_time: start,
        end_time: end,
        status,
        note: note.trim(),
      };
      if (existingId) payload.id = existingId;
      if (currentUser?.role === 'owner' && targetAdminId) payload.admin_user_id = targetAdminId;
      try {
        const r = await apiPost('/shifts.php?action=upsert', payload);
        if (r?.id && !existingId) row.dataset.shiftId = r.id;
        // 未登録に戻すには 同じステータスチップを再クリック
        indicator.innerHTML = '<span class="sh-saved">✓ 保存</span>';
        setTimeout(() => { if (indicator) indicator.innerHTML = ''; }, 1500);
      } catch (e) {
        indicator.innerHTML = '<span class="sh-saving" style="color:var(--red);">失敗</span>';
        toast('保存失敗: ' + e.message, 'err');
      }
    }, 350);
  }
  function renderShiftCalendar(gridStart, gridEnd, shifts) {
    const cal = document.getElementById('shCalendar');
    const todayStr = fmtDate(getBusinessDayDate());
    const currentMonth = shCurrent.getMonth();
    let html = '';
    ['日','月','火','水','木','金','土'].forEach((d,i) => {
      const cls = i === 0 ? 'sun' : i === 6 ? 'sat' : '';
      html += `<div class="sh-dow-head ${cls}">${d}</div>`;
    });
    let d = new Date(gridStart);
    while (d <= gridEnd) {
      const ds = fmtDate(d);
      const dayShifts = shifts.filter(s => s.shift_date === ds);
      const isOtherMonth = d.getMonth() !== currentMonth;
      const isToday = ds === todayStr;
      const dowClass = d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : '';
      html += `<div class="sh-day ${isOtherMonth?'other-month':''} ${isToday?'today':''}" data-date="${ds}">
        <div class="sd-date ${dowClass}">${d.getDate()}</div>
        <div class="sd-shifts">
          ${dayShifts.map(s => `<div class="sh-shift-pill s-${s.status}" data-shift-id="${s.id}" title="${escapeAttr(s.staff_name||'')} ${s.start_time}-${s.end_time}">${escapeHtml(s.staff_name||'').substring(0,4)} ${s.start_time.substring(0,5)}-${s.end_time.substring(0,5)}</div>`).join('')}
        </div>
      </div>`;
      d = addDays(d, 1);
    }
    cal.innerHTML = html;
    cal.querySelectorAll('.sh-day').forEach(el => {
      el.addEventListener('click', e => {
        const pill = e.target.closest('[data-shift-id]');
        if (pill) openShiftModal(Number(pill.dataset.shiftId), null);
        else openShiftModal(null, el.dataset.date);
      });
    });
  }

  async function openShiftModal(id, date) {
    editingShiftId = id;
    document.getElementById('smTitle').textContent = id ? 'シフト編集' : 'シフト登録';
    document.getElementById('smDelete').style.display = id ? 'inline-flex' : 'none';

    if (currentUser?.role === 'owner') {
      document.getElementById('smStaffField').style.display = 'block';
      if (adminUsersAll.length === 0) {
        try { const d = await api('/admin-api.php?action=admin-users'); adminUsersAll = d.users; } catch (e) {}
      }
      document.getElementById('smStaff').innerHTML = adminUsersAll.map(u => `<option value="${u.id}">${escapeHtml(u.display_name || u.username)}</option>`).join('');
      document.getElementById('smStaff').value = currentUser.id;
    }

    if (id) {
      try {
        const d = await api(`/shifts.php?action=range&from=2020-01-01&to=2100-12-31`);
        const s = (d.shifts || []).find(x => Number(x.id) === id);
        if (!s) throw new Error('not found');
        document.getElementById('smSub').textContent = s.shift_date;
        document.getElementById('smStart').value = s.start_time.substring(0,5);
        document.getElementById('smEnd').value = s.end_time.substring(0,5);
        document.getElementById('smStatus').value = s.status;
        document.getElementById('smNote').value = s.note || '';
        document.getElementById('smStaff').value = s.admin_user_id;
        // 編集時の日付保持
        document.getElementById('smTitle').dataset.date = s.shift_date;
      } catch (e) { toast('読み込み失敗', 'err'); return; }
    } else {
      document.getElementById('smSub').textContent = date;
      document.getElementById('smStart').value = '10:00';
      document.getElementById('smEnd').value = '22:00';
      document.getElementById('smStatus').value = 'available';
      document.getElementById('smNote').value = '';
      document.getElementById('smTitle').dataset.date = date;
    }
    // 24時間チェック状態を反映
    const sm24 = document.getElementById('sm24h');
    if (sm24) {
      const isAll = document.getElementById('smStart').value === '10:00' && document.getElementById('smEnd').value === '10:00';
      sm24.checked = isAll;
      document.getElementById('smStart').disabled = isAll;
      document.getElementById('smEnd').disabled = isAll;
    }
    openModal('shiftModal');
  }
  async function saveShift() {
    const payload = {
      shift_date: document.getElementById('smTitle').dataset.date,
      start_time: document.getElementById('smStart').value,
      end_time: document.getElementById('smEnd').value,
      status: document.getElementById('smStatus').value,
      note: document.getElementById('smNote').value,
    };
    if (currentUser?.role === 'owner') payload.admin_user_id = document.getElementById('smStaff').value;
    if (editingShiftId) payload.id = editingShiftId;
    try {
      await apiPost('/shifts.php?action=upsert', payload);
      toast('✓ 保存しました', 'ok');
      closeModal('shiftModal');
      loadShifts();
    } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
  }
  async function deleteShift() {
    if (!editingShiftId || !confirm('このシフトを削除しますか？')) return;
    try {
      await apiPost('/shifts.php?action=delete', { id: editingShiftId });
      toast('✓ 削除しました', 'ok');
      closeModal('shiftModal');
      loadShifts();
    } catch (e) { toast('削除失敗: ' + e.message, 'err'); }
  }

  // ========== Course management ==========
  async function loadCourses() {
    const el = document.getElementById('courseList');
    el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';
    try {
      const d = await api('/courses.php?action=list&include_inactive=1');
      coursesCache = d.courses || [];
      populateCourseSelect();
      renderCourses();
    } catch (e) {
      el.innerHTML = '<div class="view-empty">読み込み失敗</div>';
    }
  }
  function renderCourses() {
    const el = document.getElementById('courseList');
    if (coursesCache.length === 0) {
      el.innerHTML = '<div class="view-empty">コースがありません</div>';
      return;
    }
    el.innerHTML = coursesCache.map(c => `
      <div class="bk-row sortable" draggable="true" data-course-id="${c.id}" style="grid-template-columns:auto auto 1fr auto;">
        <div class="drag-handle" title="ドラッグで並び替え">⋮⋮</div>
        <div class="bk-date-col"><div class="bd-date">${c.duration_min}</div><div class="bd-time">分</div></div>
        <div class="bk-info">
          <div class="bi-name">${escapeHtml(c.name)} ${Number(c.is_active) ? '' : '<span style="color:var(--red);font-size:.78rem;">[無効]</span>'}</div>
          <div class="bi-meta">
            ${c.price ? `<span>💴 ¥${Number(c.price).toLocaleString()}</span>` : '<span style="color:var(--ink-soft);">料金未設定</span>'}
            ${c.cast_reward != null && c.cast_reward !== '' ? `<span>💰 報酬 ¥${Number(c.cast_reward).toLocaleString()}</span>` : '<span style="color:var(--ink-soft);">報酬未設定</span>'}
            <span>表示順: ${c.sort_order}</span>
          </div>
        </div>
        <button class="btn-edit" data-course-edit="${c.id}">編集</button>
      </div>`).join('');
    el.querySelectorAll('[data-course-edit]').forEach(b => {
      b.addEventListener('click', e => { e.stopPropagation(); openCourseModal(Number(b.dataset.courseEdit)); });
    });
    el.querySelectorAll('.bk-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('button, .drag-handle')) return;
        openCourseModal(Number(row.dataset.courseId));
      });
    });
    setupCourseSortable();
  }

  function setupCourseSortable() {
    const list = document.getElementById('courseList');
    if (!list) return;
    let dragSrc = null;
    list.querySelectorAll('.sortable').forEach(row => {
      row.addEventListener('dragstart', e => {
        dragSrc = row;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.courseId);
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        list.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
      });
      row.addEventListener('dragover', e => {
        e.preventDefault();
        if (!dragSrc || row === dragSrc) return;
        const rect = row.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        list.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
        row.classList.add(before ? 'drag-over-top' : 'drag-over-bottom');
      });
      row.addEventListener('drop', async e => {
        e.preventDefault();
        if (!dragSrc || row === dragSrc) return;
        const rect = row.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        list.insertBefore(dragSrc, before ? row : row.nextSibling);
        list.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
        // 順序API送信
        const newIds = Array.from(list.querySelectorAll('.sortable')).map(r => Number(r.dataset.courseId));
        try {
          await apiPost('/courses.php?action=reorder', { ids: newIds });
          // キャッシュも並び替え + sort_order 更新
          coursesCache.sort((a, b) => newIds.indexOf(a.id) - newIds.indexOf(b.id));
          coursesCache.forEach((c, i) => c.sort_order = (i + 1) * 10);
          populateCourseSelect();
          toast('✓ 順序を更新', 'ok');
        } catch (err) {
          toast('順序更新失敗: ' + err.message, 'err');
          loadCourses();
        }
      });
    });
  }
  function openCourseModal(id) {
    editingCourseId = id;
    document.getElementById('coTitle').textContent = id ? 'コース編集' : '新規コース';
    document.getElementById('coDelete').style.display = id && currentUser?.role === 'owner' ? 'inline-flex' : 'none';
    if (id) {
      const c = coursesCache.find(x => x.id === id);
      if (!c) return;
      document.getElementById('coName').value = c.name || '';
      document.getElementById('coDuration').value = c.duration_min || 60;
      setMoney('coPrice', c.price || '');
      setMoney('coCastReward', c.cast_reward != null ? c.cast_reward : '');
      document.getElementById('coIsActive').checked = Number(c.is_active) === 1;
    } else {
      document.getElementById('coName').value = '';
      document.getElementById('coDuration').value = 60;
      setMoney('coPrice', '');
      setMoney('coCastReward', '');
      document.getElementById('coIsActive').checked = true;
    }
    openModal('courseModal');
  }

  async function saveCourse() {
    const name = document.getElementById('coName').value.trim();
    const dur = parseInt(document.getElementById('coDuration').value, 10);
    if (!name) { toast('コース名を入力してください', 'err'); return; }
    if (!dur || dur < 5) { toast('時間（分）を5以上で入力してください', 'err'); return; }
    const payload = {
      name, duration_min: dur,
      price: moneyVal('coPrice'),
      cast_reward: moneyVal('coCastReward'),
      is_active: document.getElementById('coIsActive').checked ? 1 : 0,
    };
    // 新規時のみ末尾の sort_order をセット（既存編集時は変えない、ドラッグで並び替え）
    if (!editingCourseId) {
      const maxOrder = coursesCache.reduce((max, c) => Math.max(max, Number(c.sort_order || 0)), 0);
      payload.sort_order = maxOrder + 10;
    }
    try {
      if (editingCourseId) {
        await apiPost('/courses.php?action=update', { id: editingCourseId, ...payload });
        toast('✓ 更新しました', 'ok');
      } else {
        await apiPost('/courses.php?action=create', payload);
        toast('✓ 追加しました', 'ok');
      }
      closeModal('courseModal');
      await ensureCoursesLoaded(true);
      renderCourses();
    } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
  }
  async function deleteCourse() {
    if (!editingCourseId || !confirm('このコースを削除しますか？\n既存予約のコース名表示には影響しません。')) return;
    try {
      await apiPost('/courses.php?action=delete', { id: editingCourseId });
      toast('✓ 削除しました', 'ok');
      closeModal('courseModal');
      await ensureCoursesLoaded(true);
      renderCourses();
    } catch (e) { toast('削除失敗: ' + e.message, 'err'); }
  }

  // ========== 入室方法マスタ ==========
  let editingEntryMethodId = null;
  async function loadEntryMethods() {
    const el = document.getElementById('entryMethodList');
    if (el) el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';
    try {
      const d = await api('/entry-methods.php?action=list&include_inactive=1');
      entryMethodsCache = d.entry_methods || [];
      populateEntryMethodSelect();
      renderEntryMethods();
    } catch (e) {
      if (el) el.innerHTML = '<div class="view-empty">読み込み失敗</div>';
    }
  }

  // ↓ 施術メニュー/キャンペーン削除時に巻き込んで消してしまった分を復元（2026-08-02）
  //   入室方法マスタの描画・編集。これが無いとタイムライン初期化が例外で止まる
  function renderEntryMethods() {
    const el = document.getElementById('entryMethodList');
    if (!el) return;
    if (entryMethodsCache.length === 0) {
      el.innerHTML = '<div class="view-empty">入室方法がありません</div>';
      return;
    }
    el.innerHTML = entryMethodsCache.map(e => `
      <div class="bk-row sortable" draggable="true" data-em-id="${e.id}" style="grid-template-columns:auto 1fr auto;">
        <div class="drag-handle" title="ドラッグで並び替え">⋮⋮</div>
        <div class="bk-info">
          <div class="bi-name">${escapeHtml(e.label)} ${Number(e.is_active) ? '' : '<span style="color:var(--red);font-size:.78rem;">[無効]</span>'}</div>
        </div>
        <button class="btn-edit" data-em-edit="${e.id}">編集</button>
      </div>`).join('');
    el.querySelectorAll('[data-em-edit]').forEach(b => {
      b.addEventListener('click', ev => { ev.stopPropagation(); openEntryMethodModal(Number(b.dataset.emEdit)); });
    });
    el.querySelectorAll('.bk-row').forEach(row => {
      row.addEventListener('click', ev => {
        if (ev.target.closest('button, .drag-handle')) return;
        openEntryMethodModal(Number(row.dataset.emId));
      });
    });
    setupEntryMethodSortable();
  }
  function openEntryMethodModal(id) {
    editingEntryMethodId = id;
    document.getElementById('emaTitle').textContent = id ? '入室方法を編集' : '新規入室方法';
    document.getElementById('emaDelete').style.display = id && currentUser?.role === 'owner' ? 'inline-flex' : 'none';
    if (id) {
      const e = entryMethodsCache.find(x => x.id === id);
      if (!e) return;
      document.getElementById('emaCode').value = e.code || '';
      document.getElementById('emaLabel').value = e.label || '';
      document.getElementById('emaIsActive').checked = Number(e.is_active) === 1;
    } else {
      document.getElementById('emaCode').value = '';
      document.getElementById('emaLabel').value = '';
      document.getElementById('emaIsActive').checked = true;
    }
    openModal('entryMethodModal');
  }
  async function saveEntryMethod() {
    const label = document.getElementById('emaLabel').value.trim();
    if (!label) { toast('表示ラベルを入力してください', 'err'); return; }
    // 編集時は code を変更しない（既存ホテルの紐付け維持）
    // 新規時: code を自動生成（em_XXXXX 形式）
    const payload = {
      label,
      is_active: document.getElementById('emaIsActive').checked ? 1 : 0,
    };
    if (!editingEntryMethodId) {
      payload.code = 'em_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    }
    if (!editingEntryMethodId) {
      const maxOrder = entryMethodsCache.reduce((max, e) => Math.max(max, Number(e.sort_order || 0)), 0);
      payload.sort_order = maxOrder + 10;
    }
    try {
      if (editingEntryMethodId) {
        await apiPost('/entry-methods.php?action=update', { id: editingEntryMethodId, ...payload });
        toast('✓ 更新しました', 'ok');
      } else {
        await apiPost('/entry-methods.php?action=create', payload);
        toast('✓ 追加しました', 'ok');
      }
      closeModal('entryMethodModal');
      await loadEntryMethods();
    } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
  }
  async function deleteEntryMethod() {
    if (!editingEntryMethodId || !confirm('この入室方法を削除しますか？\n既にホテルに設定されている場合、その表示は影響を受けます。')) return;
    try {
      await apiPost('/entry-methods.php?action=delete', { id: editingEntryMethodId });
      toast('✓ 削除しました', 'ok');
      closeModal('entryMethodModal');
      await loadEntryMethods();
    } catch (e) { toast('削除失敗: ' + e.message, 'err'); }
  }
  // ========== 駅マスタ管理 ==========
  let stationsCache = [];
  let editingStationId = null;
  async function loadStations() {
    const el = document.getElementById('stationList');
    if (el) el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';
    try {
      const d = await api('/stations.php?action=list');
      stationsCache = d.stations || [];
      renderStations();
    } catch (e) {
      if (el) el.innerHTML = '<div class="view-empty">読み込み失敗</div>';
    }
  }
  function renderStations() {
    const el = document.getElementById('stationList');
    if (!el) return;
    if (stationsCache.length === 0) {
      el.innerHTML = '<div class="view-empty">駅マスタが空です</div>';
      return;
    }
    // 立川から往復運賃の安い順（未設定は最後）。同額は駅名順
    const fareOf = (s) => (s.fare_from_tachikawa === null || s.fare_from_tachikawa === undefined) ? Infinity : Number(s.fare_from_tachikawa);
    const sorted = [...stationsCache].sort((a, b) => fareOf(a) - fareOf(b) || String(a.name).localeCompare(String(b.name), 'ja'));

    el.innerHTML = `
      <div class="st-toolbar">
        <input type="search" id="stSearch" placeholder="🔍 駅名・市区町村で絞り込み" style="flex:1;padding:.6rem .9rem;border:1.5px solid rgba(91,188,212,.3);border-radius:10px;font-size:15px;">
      </div>
      <div id="stGroups" class="st-grid">${sorted.map(st => stationRowHtml(st)).join('')}</div>`;
    const bindEdit = () => el.querySelectorAll('[data-st-edit]').forEach(b => {
      b.addEventListener('click', e => { e.stopPropagation(); openStationModal(Number(b.dataset.stEdit)); });
    });
    bindEdit();
    // 検索フィルタ（並び順は維持）
    const searchEl = document.getElementById('stSearch');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        const q = searchEl.value.trim().toLowerCase();
        const list = q ? sorted.filter(st => String(st.name).toLowerCase().includes(q) || String(st.city || '').includes(q)) : sorted;
        document.getElementById('stGroups').innerHTML = list.length ? list.map(st => stationRowHtml(st)).join('') : '<div class="view-empty">該当する駅がありません</div>';
        bindEdit();
      });
    }
  }
  function stationRowHtml(s) {
    const isFree = Number(s.base_fee) === 0;
    const feeBig = isFree
      ? '<span style="color:#3a9a60;font-weight:700;">無料</span>'
      : '<span style="color:var(--sea);font-weight:700;">¥' + Number(s.base_fee).toLocaleString() + '</span>';
    const fareTachikawa = s.fare_from_tachikawa === null || s.fare_from_tachikawa === undefined
      ? '<span style="color:var(--ink-soft);font-size:.72rem;">🚆 運賃未設定</span>'
      : '<span style="color:var(--ink-soft);font-size:.74rem;">🚆 立川から往復 ¥' + Number(s.fare_from_tachikawa).toLocaleString() + '</span>';
    return `<div class="bk-row" data-st-id="${s.id}" style="grid-template-columns:1fr auto auto;align-items:center;gap:.5rem;padding:.45rem .65rem;">
      <div class="bk-info" style="min-width:0;">
        <div class="bi-name" style="font-size:.9rem;">🚉 ${escapeHtml(s.name)}駅 <span style="font-weight:500;font-size:.72rem;color:var(--ink-soft);">${escapeHtml(s.city || '')}</span></div>
        <div class="bi-meta">${fareTachikawa}</div>
      </div>
      <div class="st-fee-cell" style="text-align:right;min-width:64px;">${feeBig}</div>
      <button class="btn-edit" data-st-edit="${s.id}" style="padding:.35rem .7rem;font-size:.8rem;">編集</button>
    </div>`;
  }
  function openStationModal(id) {
    const s = stationsCache.find(x => Number(x.id) === id);
    if (!s) return;
    editingStationId = id;
    document.getElementById('stName').textContent = s.name + '駅';
    setMoney('stBaseFee', s.base_fee || 0);
    setMoney('stFareTachikawa', (s.fare_from_tachikawa === null || s.fare_from_tachikawa === undefined) ? '' : s.fare_from_tachikawa);
    openModal('stationModal');
  }
  async function saveStation() {
    if (!editingStationId) return;
    const baseFee = moneyVal('stBaseFee') || 0;
    const fareVal = moneyDigits(document.getElementById('stFareTachikawa').value);
    const fare = fareVal === '' ? null : Math.max(0, Number(fareVal));
    try {
      await apiPost('/stations.php?action=update', { id: editingStationId, base_fee: baseFee, fare_from_tachikawa: fare });
      toast('✓ 更新しました', 'ok');
      closeModal('stationModal');
      await loadStations();
    } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
  }

  // ========== 権限管理 ==========
  const TAB_INFO = {
    timeline:    { label: 'タイムライン', desc: '日次予約タイムラインの閲覧・操作' },
    bookings:    { label: '予約管理',     desc: '予約一覧の閲覧と編集' },
    customers:   { label: '顧客管理',     desc: '顧客情報の閲覧・編集' },
    shifts:      { label: '内勤・送迎シフト', desc: '内勤スタッフ・ドライバーのスケジュール登録（キャストの出勤はCTRLの出勤管理が正）' },
    courses:     { label: 'コース',       desc: 'コースの追加・編集' },
    hotel:       { label: 'ホテル管理',   desc: 'ホテルのステータス・ガイド編集' },
    chat:        { label: '💬 チャット',  desc: 'お客様からのチャット問い合わせの受信・返信' },
    payroll:     { label: '💰 経理',      desc: '各キャストの報酬集計（オーナー・店長のみ・固定）' },
    settlement:  { label: '💴 入金',      desc: '自分の店舗への受け渡し確認（スタッフ本人）' },
    staffboard:  { label: '👥 キャスト管理', desc: '当日の売上・件数・報酬・出勤（オーナー・店長）' },
    staff:       { label: 'スタッフ管理', desc: 'スタッフアカウントの追加・削除（必ずownerを含む）' },
    permissions: { label: '権限管理',     desc: 'このページ自体（必ずownerを含む）' },
  };
  let tabPermissions = null;

  async function loadPermissions(forceReload = false) {
    if (tabPermissions && !forceReload) return tabPermissions;
    try {
      const d = await api('/admin-api.php?action=permissions-get');
      tabPermissions = d.permissions || {};
      return tabPermissions;
    } catch (e) { return {}; }
  }

  function userCanSeeTab(tab) {
    if (!currentUser) return false;
    const role = currentUser.role;
    // タブ別のデフォルト権限 (まだ保存されていない場合のフォールバック)
    const TAB_DEFAULTS = {
      chat:        ['owner', 'manager', 'office'],
      payroll:     ['owner', 'manager'],
      settlement:  ['owner', 'manager', 'office', 'staff', 'driver'],
      staff:       ['owner', 'manager'],
      permissions: ['owner'],
    };
    // 管理タブ(マネージャー管理モードで出すもの)の可否判定
    const managerCanSee = (t) => {
      if (t === 'therapist' || t === 'myclients' || t === 'settlement') return false;
      if (t === 'payroll' || t === 'staffboard' || t === 'staff') return ['owner', 'manager'].includes(role);
      if (!tabPermissions || !tabPermissions[t]) {
        const def = TAB_DEFAULTS[t];
        return def ? def.includes(role) : true;
      }
      return tabPermissions[t].includes(role);
    };
    // キャスト(staff)は「マイページ」1タブのみ。お客様/シフト/入金はマイページ内のボタンから開く
    if (role === 'staff') return tab === 'therapist';
    // 店長(manager) = 店長兼キャスト。モードで出し分け（入口/マネージャー管理/キャスト管理）
    if (role === 'manager') {
      if (managerMode === 'therapist') return tab === 'therapist';
      if (managerMode === 'manager') return managerCanSee(tab);
      return false; // entry(入口画面)では全タブ非表示
    }
    // owner / office / driver は従来通り（モードなし）
    if (tab === 'therapist' || tab === 'myclients') return false;
    if (tab === 'settlement') return ['office', 'driver'].includes(role);
    if (role === 'owner') return true;
    return managerCanSee(tab);
  }

  function applyTabVisibility() {
    document.querySelectorAll('.tab-btn[data-view]').forEach(btn => {
      const tab = btn.dataset.view;
      const visible = userCanSeeTab(tab);
      btn.style.display = visible ? '' : 'none';
    });
  }

  // ===== 店長(manager)専用: 名前プルダウンで マネージャー管理 / キャスト管理 を切替 =====
  function updateModeSwitch() {
    const menu = document.getElementById('userMenu');
    const caret = document.getElementById('userCaret');
    if (!menu) return;
    const isManager = currentUser?.role === 'manager';
    menu.classList.toggle('has-modes', isManager);
    if (caret) caret.style.display = isManager ? '' : 'none';
    if (!isManager) menu.classList.remove('open');
    document.querySelectorAll('#userDropdown [data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === managerMode));
  }
  function toggleUserMenu(force) {
    const menu = document.getElementById('userMenu');
    if (!menu || !menu.classList.contains('has-modes')) return;
    menu.classList.toggle('open', force);
  }
  // 入口画面（ログイン直後・店長のみ）。タブは全部隠して2択カードを表示
  function showManagerEntry() {
    managerMode = 'entry';
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const ev = document.getElementById('view-entry');
    if (ev) ev.classList.add('active');
    applyTabVisibility();
    updateModeSwitch();
  }
  // モード確定 → タブ可視を更新し、そのモードの既定画面へ
  function setManagerMode(mode) {
    if (mode !== 'manager' && mode !== 'therapist') return;
    managerMode = mode;
    applyTabVisibility();
    updateModeSwitch();
    toggleUserMenu(false); // プルダウンを閉じる
    if (mode === 'therapist') switchView('therapist');
    else switchView('timeline');
  }

  async function renderPermissions() {
    await loadPermissions(true);
    const el = document.getElementById('permTable');
    const roles = ['owner', 'manager', 'office', 'staff', 'driver'];
    // ドライバーのデフォルト可視タブ
    const driverDefault = { timeline: true, bookings: true, shifts: true };
    // 内勤スタッフのデフォルト可視タブ (施術はしないが予約/顧客/チャット対応)
    const officeDefault = { timeline: true, bookings: true, customers: true, chat: true };
    let html = `<div class="perm-row header">
      <div>タブ</div>
      <div class="perm-cell">オーナー</div>
      <div class="perm-cell">店長</div>
      <div class="perm-cell">🪪 内勤</div>
      <div class="perm-cell">キャスト</div>
      <div class="perm-cell">🚗ドライバー</div>
    </div>`;
    // チャットはデフォルトでオーナー＋店長＋内勤のみ (お客様対応用)
    const chatDefault = ['owner', 'manager', 'office'];
    const settlementDefault = ['owner', 'manager', 'office', 'staff', 'driver'];
    Object.entries(TAB_INFO).forEach(([key, info]) => {
      const defaultAllowed = (key === 'chat') ? [...chatDefault]
                           : (key === 'settlement') ? [...settlementDefault]
                           : ['owner','manager','staff'];
      if (driverDefault[key]) defaultAllowed.push('driver');
      if (officeDefault[key] && !defaultAllowed.includes('office')) defaultAllowed.push('office');
      const payrollLocked = (key === 'payroll');
      const allowed = payrollLocked ? ['owner', 'manager'] : (tabPermissions[key] || defaultAllowed);
      const ownerLocked = (key === 'staff' || key === 'permissions');
      html += `<div class="perm-row" data-perm-tab="${key}">
        <div class="perm-name">${info.label}<span class="perm-desc">${info.desc}</span></div>
        ${roles.map(r => {
          const checked = allowed.includes(r) ? 'checked' : '';
          const disabled = ((r === 'owner' && ownerLocked) || payrollLocked) ? 'disabled' : '';
          return `<div class="perm-cell"><input type="checkbox" data-role="${r}" ${checked} ${disabled}></div>`;
        }).join('')}
      </div>`;
    });
    el.innerHTML = html;
  }

  async function savePermissions() {
    const newPerms = {};
    document.querySelectorAll('[data-perm-tab]').forEach(row => {
      const tab = row.dataset.permTab;
      const roles = [];
      row.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (cb.checked) roles.push(cb.dataset.role);
      });
      newPerms[tab] = roles;
    });
    try {
      await apiPost('/admin-api.php?action=permissions-update', { permissions: newPerms });
      tabPermissions = newPerms;
      applyTabVisibility();
      toast('✓ 権限を保存しました', 'ok');
    } catch (e) {
      toast('保存失敗: ' + e.message, 'err');
    }
  }

  // ========== View switching ==========
  // 👥 キャスト管理（role=staff の登録一覧＋追加/編集）。owner/manager 閲覧、追加/編集は owner のみ
  async function loadStaffBoard() {
    const el = document.getElementById('staffBoard');
    if (!el) return;
    el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';
    try {
      const data = await api('/admin-api.php?action=' + staffListEndpoint());
      allUsers = data.users || [];
      renderTherapistBoard();
    } catch (e) {
      el.innerHTML = `<p style="color:var(--coral);">読み込み失敗: ${escapeHtml(e.message)}</p>`;
    }
  }

  // 追加/編集/削除後、両タブ（スタッフ管理＋キャスト管理）を再描画
  async function reloadStaffData() {
    try {
      const data = await api('/admin-api.php?action=' + staffListEndpoint());
      allUsers = data.users || [];
    } catch (e) {}
    renderAdminUsers();
    renderTherapistBoard();
  }

  // 🪪 キャスト専用マイページ（出勤切替＋出勤時間表示・予約[日ナビ]・実績[月ナビ]・シフト申請）
  let thBookDate = null;   // 予約セクションの表示日 YYYY-MM-DD
  let thMonth = null;      // 実績セクションの表示月 YYYY-MM
  const _parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const _ymShift = (ym, n) => { const [y, m] = ym.split('-').map(Number); const dt = new Date(y, m - 1 + n, 1); return dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2); };

  async function loadTherapistHome() {
    const el = document.getElementById('therapistHome');
    if (!el) return;
    el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';
    const today = fmtDate(getBusinessDayDate());
    thBookDate = today;            // タブを開いたら今日 / 今月にリセット
    thMonth = today.slice(0, 7);
    const me = Number(currentUser?.id) || 0;
    const dl = document.getElementById('thDateLabel');
    if (dl) dl.textContent = `（${today}）`;
    try {
      const [shiftRes, todaySettle] = await Promise.all([
        api(`/shifts.php?action=range&from=${today}&to=${today}&admin_id=${me}`).catch(() => ({ shifts: [] })),
        api(`/admin-api.php?action=my-settlement-bookings&scope=all&from=${today}&to=${today}`).catch(() => ({ summary: {} })),
      ]);
      const sh = (shiftRes.shifts || [])[0];
      const shStatus = sh ? sh.status : null;           // available / off / tentative / null（本人は変更不可・閲覧のみ）
      const isOff = shStatus === 'off';
      const shTime = (sh && sh.start_time && sh.end_time) ? `${String(sh.start_time).slice(0,5)}〜${String(sh.end_time).slice(0,5)}` : '';
      const tsm = todaySettle.summary || {};
      const yenN = (n) => '¥' + Number(n || 0).toLocaleString();
      const attBadge = isOff ? '<span class="th-att-badge off">休み</span>'
                     : shStatus === 'available' ? '<span class="th-att-badge on">● 出勤</span>'
                     : shStatus === 'done' ? '<span class="th-att-badge off">終了</span>'
                     : shStatus === 'tentative' ? '<span class="th-att-badge tentative">仮シフト</span>'
                     : '<span class="th-att-badge none">シフト未登録</span>';

      // 出勤状態は読取専用（シフトから）＋今日の実績を連動表示
      const attHtml = `
        <div class="th-card">
          <div class="th-card-h">今日の出勤</div>
          <div class="th-att-row">
            ${attBadge}
            ${!isOff && shTime ? `<span class="th-att-time">🕐 ${shTime}</span>` : ''}
          </div>
          <div class="th-tp-label">今日の予定</div>
          <div class="th-stats">
            <div><span class="th-num">${tsm.count || 0}件</span><span class="th-lbl">本数</span></div>
            <div><span class="th-num">${yenN(tsm.sales_total)}</span><span class="th-lbl">預り金</span></div>
            <div><span class="th-num">${yenN(tsm.reward_total)}</span><span class="th-lbl">報酬</span></div>
          </div>
        </div>`;

      const shiftHtml = `
        <div class="th-card">
          <div class="th-card-h">メニュー</div>
          <p style="color:var(--ink-soft);font-size:.82rem;margin:.2rem 0 .6rem;">お客様の履歴・シフト申請・入金明細はこちらから（戻るときは上の「マイページ」タブ）。</p>
          <div style="display:flex;flex-direction:column;gap:.5rem;">
            <button class="btn-primary-coral" id="thToSettleMenu" type="button">💴 入金の明細を見る</button>
            <button class="btn-primary-coral" id="thToClients" type="button">👤 担当したお客様</button>
            <button class="btn-primary-coral" id="thToShifts" type="button">📅 シフト申請</button>
          </div>
        </div>`;

      el.innerHTML = `<div class="th-grid">${attHtml}<div class="th-card" id="thBookCard"></div><div class="th-card" id="thPerfCard"></div>${shiftHtml}</div>`;

      // 出勤/休みの自己切替は廃止（キャストは閲覧のみ・出勤はシフトで管理）
      document.getElementById('thToClients')?.addEventListener('click', () => switchView('myclients'));
      document.getElementById('thToShifts')?.addEventListener('click', () => switchView('shifts'));
      // 入金明細は「今日」を表示してから開く
      document.getElementById('thToSettleMenu')?.addEventListener('click', () => { msSetRange('today'); switchView('settlement'); });

      await Promise.all([renderThBookings(), renderThPerf()]);
    } catch (e) {
      el.innerHTML = `<p style="color:var(--coral);">読み込み失敗: ${escapeHtml(e.message)}</p>`;
    }
  }

  // 予約セクション（前日 / 今日 / 明日 ナビ）。開始/終了ボタンは今日のみ表示（本人・一方通行）
  async function renderThBookings() {
    const card = document.getElementById('thBookCard');
    if (!card) return;
    const me = Number(currentUser?.id) || 0;
    const todayBiz = fmtDate(getBusinessDayDate());
    const d = thBookDate || todayBiz;
    const dObj = _parseYmd(d);
    const isToday = d === todayBiz;
    const rel = isToday ? '今日'
              : d === fmtDate(addDays(getBusinessDayDate(), -1)) ? '前日'
              : d === fmtDate(addDays(getBusinessDayDate(), 1)) ? '明日' : '';
    const dateLabel = `${d.slice(5).replace('-', '/')}(${dowLabel(dObj)})${rel ? ' ・ ' + rel : ''}`;
    const navBar = `<div class="th-nav">
        <button class="th-nav-btn" data-bk-prev type="button">◀ 前日</button>
        <button class="th-nav-btn ${isToday ? 'active' : ''}" data-bk-today type="button">今日</button>
        <button class="th-nav-btn" data-bk-next type="button">明日 ▶</button>
      </div>`;
    card.innerHTML = `<div class="th-card-h">${dateLabel}の予約</div>${navBar}<div style="color:var(--ink-soft);padding:.6rem 0;">読み込み中...</div>`;

    // 営業日 d は カレンダー d の10:00〜カレンダー d+1 の10:00 → 2日分取得して bizDateOf で絞る
    const nextD = fmtDate(addDays(dObj, 1));
    const res = await api(`/bookings.php?action=range&from=${d}&to=${nextD}&admin_id=${me}`).catch(() => ({ bookings: [] }));
    const dispT = (b, t) => t ? displayTime(b.booking_date, String(t).slice(0, 5), d) : '';  // 深夜は24h+表記（02:00→26:00）
    const bizMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
    const bookings = (res.bookings || [])
      .filter(b => b.status !== 'cancelled' && bizDateOf(b.booking_date, b.start_time) === d)
      .sort((a, b) => bizMin(dispT(a, a.start_time)) - bizMin(dispT(b, b.start_time)));  // 営業日内の時間順
    const listHtml = bookings.length ? bookings.map((b, idx) => {
      const place = b.hotel_name_snapshot || b.hotel_name || '';
      const svc = svcState(b);
      const badge = svc === 'ended' ? '<span class="th-svc done">終了済</span>'
                  : svc === 'started' ? '<span class="th-svc live">接客中</span>'
                  : svc === 'pending' ? '<span class="th-svc">未開始</span>'
                  : `<span class="th-svc">${escapeHtml(bookingStatusLabel(b))}</span>`;
      const svcDesc = `${fmtTimeDisp(b.start_time)} ${b.course_name || ''}`.trim();
      const action = (isToday && svc === 'pending') ? `<button class="btn-primary-coral th-svc-btn" data-svc-start="${b.id}" data-svc-desc="${escapeAttr(svcDesc)}">▶ 開始</button>`
                   : (isToday && svc === 'started') ? `<button class="btn-primary-coral th-svc-btn" data-svc-end="${b.id}" data-svc-desc="${escapeAttr(svcDesc)}">■ 終了</button>`
                   : '';
      const isBreakRow = (b.course_name === '休憩') || (b.customer_name_snapshot === '【休憩】');
      // 表示は実時刻・0埋めなし（2:00 等）。並び順のみ営業日基準（深夜は最後）
      const stTime = fmtTimeDisp(b.start_time);
      const etTime = fmtTimeDisp(b.end_time);
      return `<div class="th-book${isBreakRow ? '' : ' tappable'}"${isBreakRow ? '' : ` data-bk-detail="${b.id}"`}>
        <span class="th-book-time">${stTime}</span>
        <div class="th-book-main">
          ${isBreakRow ? '' : `<div class="th-book-seq">${idx + 1}件目</div>`}
          <div>${escapeHtml(b.course_name || '—')}</div>
          ${isBreakRow
            ? (etTime ? `<div style="color:var(--ink-soft);font-size:.82rem;">${stTime} 〜 ${etTime}</div>` : '')
            : `${place ? `<div style="color:var(--ink-soft);font-size:.82rem;">${escapeHtml(place)}</div>` : ''}${badge}`}
        </div>
        ${isBreakRow ? '' : action}
        ${isBreakRow ? '' : '<span class="th-book-chev" aria-hidden="true">›</span>'}
      </div>`;
    }).join('') : '<div style="color:var(--ink-soft);padding:.6rem 0;">この日の予約はありません。</div>';
    card.innerHTML = `<div class="th-card-h">${dateLabel}の予約（${bookings.length}件）</div>${navBar}${listHtml}`;

    card.querySelector('[data-bk-prev]')?.addEventListener('click', () => { thBookDate = fmtDate(addDays(dObj, -1)); renderThBookings(); });
    card.querySelector('[data-bk-next]')?.addEventListener('click', () => { thBookDate = fmtDate(addDays(dObj, 1)); renderThBookings(); });
    card.querySelector('[data-bk-today]')?.addEventListener('click', () => { thBookDate = todayBiz; renderThBookings(); });
    // 開始 / 終了（今日・自分の予約のみ・一方通行）。操作後は予約セクションのみ再描画（表示日を維持）
    const svcAction = async (id, state, label) => {
      try { await apiPost('/bookings.php?action=set-service', { id: Number(id), state }); toast(label, 'ok'); renderThBookings(); }
      catch (e) { toast('更新失敗: ' + e.message, 'err'); }
    };
    // 誤操作防止: 開始/終了は確認ダイアログを挟む（本人は巻き戻せない一方通行のため）
    card.querySelectorAll('[data-svc-start]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`「${btn.dataset.svcDesc}」の接客を開始しますか？`)) return;
      svcAction(btn.dataset.svcStart, 'started', '▶ 接客を開始しました');
    }));
    card.querySelectorAll('[data-svc-end]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`「${btn.dataset.svcDesc}」の接客を終了しますか？\n※ 終了後はご自分では戻せません`)) return;
      svcAction(btn.dataset.svcEnd, 'ended', '■ 接客を終了しました');
    }));
    // 予約行をタップ → 読み取り専用の詳細モーダル（休憩行は除く）
    card.querySelectorAll('[data-bk-detail]').forEach(row => row.addEventListener('click', () => openOrderDetailModal(Number(row.dataset.bkDetail))));
  }

  // 実績セクション（先月 / 今月 / 来月 ナビ）。来月以降は無効（データ無し）
  async function renderThPerf() {
    const card = document.getElementById('thPerfCard');
    if (!card) return;
    const todayBiz = fmtDate(getBusinessDayDate());
    const curYm = todayBiz.slice(0, 7);
    const ym = thMonth || curYm;
    const [y, m] = ym.split('-').map(Number);
    const monthStart = `${ym}-01`;
    const monthEnd = fmtDate(new Date(y, m, 0));            // 当月末
    const to = monthEnd > todayBiz ? todayBiz : monthEnd;   // 当月は今日まで・過去月は月末まで
    const isCur = ym === curYm;
    const yenN = (n) => '¥' + Number(n || 0).toLocaleString();
    const navBar = `<div class="th-nav">
        <button class="th-nav-btn" data-pf-prev type="button">◀ 先月</button>
        <button class="th-nav-btn ${isCur ? 'active' : ''}" data-pf-today type="button">今月</button>
        <button class="th-nav-btn" data-pf-next type="button" ${ym >= curYm ? 'disabled' : ''}>来月 ▶</button>
      </div>`;
    card.innerHTML = `<div class="th-card-h">${y}年${m}月の実績</div>${navBar}<div style="color:var(--ink-soft);padding:.6rem 0;">読み込み中...</div>`;

    const settle = await api(`/admin-api.php?action=my-settlement-bookings&from=${monthStart}&to=${to}`).catch(() => ({ summary: {} }));
    const sm = settle.summary || {};
    const statsHtml = `<div class="th-stats">
        <div><span class="th-num">${sm.count || 0}件</span><span class="th-lbl">本数</span></div>
        <div><span class="th-num">${yenN(sm.sales_total)}</span><span class="th-lbl">預り金</span></div>
        <div><span class="th-num">${yenN(sm.reward_total)}</span><span class="th-lbl">報酬</span></div>
      </div>`;
    const unsettled = sm.unsettled_count ? `<div style="margin-top:.5rem;color:var(--coral);font-size:.85rem;">未精算 ${sm.unsettled_count}件 ・ ${yenN(sm.unsettled)}</div>` : '';
    card.innerHTML = `<div class="th-card-h">${y}年${m}月の実績</div>${navBar}${statsHtml}${unsettled}`;

    card.querySelector('[data-pf-prev]')?.addEventListener('click', () => { thMonth = _ymShift(ym, -1); renderThPerf(); });
    card.querySelector('[data-pf-next]')?.addEventListener('click', () => { if (ym < curYm) { thMonth = _ymShift(ym, 1); renderThPerf(); } });
    card.querySelector('[data-pf-today]')?.addEventListener('click', () => { thMonth = curYm; renderThPerf(); });
  }

  function switchView(name) {
    const tabName = (name === 'hotel' || name === 'stations') ? 'courses' : name;  // ホテル管理・駅マスタはマスタ配下（タブ廃止）
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === tabName));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    if (name === 'staff' && ['owner', 'manager'].includes(currentUser?.role)) loadAdminUsers();
    else if (name === 'therapist') loadTherapistHome();
    else if (name === 'myclients') loadMyClients();
    else if (name === 'timeline') loadTimeline();
    else if (name === 'bookings') loadBookings();
    else if (name === 'customers') loadCustomers();
    else if (name === 'shifts') loadShifts();
    else if (name === 'courses') { loadCourses(); loadEntryMethods(); }
    else if (name === 'stations') loadStations();
    else if (name === 'permissions' && currentUser?.role === 'owner') renderPermissions();
    else if (name === 'chat' && userCanSeeTab('chat')) loadChatInbox();
    else if (name === 'staffboard' && userCanSeeTab('staffboard')) loadStaffBoard();
    else if (name === 'payroll' && userCanSeeTab('payroll')) loadAccounting();
    else if (name === 'settlement') loadMySettlements();
  }

  // ============ 💰 経理 ============
  let _acInit = false;
  let _acPanel = 'summary';
  const yen = (n) => '¥' + Number(n || 0).toLocaleString();

  function acSetRange(range) {
    const now = getBusinessDayDate();  // 営業日基準（深夜0-10時は前日が「今日」）
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const fmt = (dt) => `${dt.getFullYear()}-${('0'+(dt.getMonth()+1)).slice(-2)}-${('0'+dt.getDate()).slice(-2)}`;
    let from, to;
    if (range === 'today') { from = to = new Date(y, m, d); }
    else if (range === 'yesterday') {
      const cur = document.getElementById('acFrom').value;
      const base = cur ? new Date(cur + 'T00:00:00') : new Date(y, m, d);
      base.setDate(base.getDate() - 1);
      from = to = base;
    }
    else if (range === 'this-week') {
      const dow = (now.getDay() + 6) % 7; // 月曜始まり
      from = new Date(y, m, d - dow); to = new Date(y, m, d - dow + 6);
    }
    else if (range === 'last-month') { from = new Date(y, m - 1, 1); to = new Date(y, m, 0); }
    else { from = new Date(y, m, 1); to = new Date(y, m + 1, 0); } // this-month
    document.getElementById('acFrom').value = fmt(from);
    document.getElementById('acTo').value = fmt(to);
    document.querySelectorAll('.ac-range').forEach(b => b.classList.toggle('active', b.dataset.range === range));
  }
  function acPeriod() {
    return { from: document.getElementById('acFrom').value, to: document.getElementById('acTo').value };
  }
  function acFmtPeriodLabel(from, to) {
    if (!from || !to) return '';
    const wd = ['日','月','火','水','木','金','土'];
    const mk = (s) => new Date(s + 'T00:00:00');
    const f = mk(from), t = mk(to);
    if (from === to) return `${f.getFullYear()}年${f.getMonth()+1}月${f.getDate()}日（${wd[f.getDay()]}）`;
    return `${f.getFullYear()}年${f.getMonth()+1}月${f.getDate()}日 〜 ${t.getFullYear()}年${t.getMonth()+1}月${t.getDate()}日`;
  }
  function acUpdatePeriodLabel() {
    const el = document.getElementById('acPeriodLabel');
    if (!el) return;
    const { from, to } = acPeriod();
    const label = acFmtPeriodLabel(from, to);
    el.textContent = label ? `📅 ${label}` : '';
  }
  // 経理: キャスト絞り込みセレクタ（全タブ共通）
  async function acPopulateTherapists() {
    const sel = document.getElementById('acTherapist');
    if (!sel) return;
    if (!adminUsersAll || adminUsersAll.length === 0) {
      try { const d = await api('/admin-api.php?action=admin-users'); adminUsersAll = d.users || []; } catch (e) {}
    }
    const therapists = (adminUsersAll || []).filter(u => (u.role !== 'driver' && u.role !== 'office') || isTherapistCapable(u));
    const cur = sel.value || '';
    sel.innerHTML = '<option value="">全体</option>' +
      therapists.map(u => `<option value="${u.id}">${escapeHtml(u.display_name || u.username)}</option>`).join('');
    if (cur && therapists.some(u => String(u.id) === cur)) sel.value = cur;
  }
  function acTherapistId() { return document.getElementById('acTherapist')?.value || ''; }
  function acTQ() { const t = acTherapistId(); return t ? `&therapist_id=${encodeURIComponent(t)}` : ''; }

  function loadAccounting() {
    if (!_acInit) {
      _acInit = true;
      acSetRange('today');
      document.querySelectorAll('.ac-range').forEach(b => {
        b.addEventListener('click', () => { acSetRange(b.dataset.range); acReloadActive(); });
      });
      document.getElementById('acApply')?.addEventListener('click', () => {
        document.querySelectorAll('.ac-range').forEach(x => x.classList.remove('active'));
        acReloadActive();
      });
      document.querySelectorAll('.ac-tab').forEach(b => {
        b.addEventListener('click', () => acSwitchPanel(b.dataset.ac));
      });
      document.getElementById('expAdd')?.addEventListener('click', () => openExpenseModal(null));
      document.getElementById('expSave')?.addEventListener('click', saveExpense);
      document.getElementById('expDelete')?.addEventListener('click', deleteExpense);
      document.querySelectorAll('.settle-filter').forEach(b => {
        b.addEventListener('click', () => {
          _settleFilter = b.dataset.sf;
          document.querySelectorAll('.settle-filter').forEach(x => x.classList.toggle('active', x === b));
          loadSettlements();
        });
      });
      acPopulateTherapists();
      document.getElementById('acTherapist')?.addEventListener('change', acReloadActive);
    }
    acSwitchPanel(_acPanel);
  }

  function acSwitchPanel(name) {
    _acPanel = name;
    document.querySelectorAll('.ac-tab').forEach(b => b.classList.toggle('active', b.dataset.ac === name));
    document.querySelectorAll('.ac-panel').forEach(p => p.style.display = p.id === 'ac-' + name ? '' : 'none');
    acReloadActive();
  }
  function acReloadActive() {
    acUpdatePeriodLabel();
    if (_acPanel === 'summary') loadAcSummary();
    else if (_acPanel === 'sales') loadAcSales();
    else if (_acPanel === 'payroll') loadPayroll();
    else if (_acPanel === 'settle') loadSettlements();
    else if (_acPanel === 'expenses') loadExpenses();
  }

  // --- 📊 損益サマリー ---
  async function loadAcSummary() {
    const { from, to } = acPeriod();
    if (!from || !to) return;
    const el = document.getElementById('ac-summary');
    el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>集計中...</div>';
    try {
      const d = await api(`/admin-api.php?action=accounting-summary&from=${from}&to=${to}${acTQ()}`);
      renderAcSummary(d);
    } catch (e) {
      el.innerHTML = `<p style="color:var(--coral);">読み込み失敗: ${escapeHtml(e.message)}</p>`;
    }
  }
  function renderAcSummary(d) {
    const s = d.sales || { cash:0, credit:0, bank:0, unset:0, total:0, count:0 };
    const bd = d.breakdown || { course:0, late:0, transport:0 };
    const subhead = (t) => `<div style="font-size:.72rem;color:var(--ink-soft);padding:.35rem 0 .1rem 1.2rem;letter-spacing:.04em;">${t}</div>`;
    const row = (label, val, opt = {}) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:${opt.big?'.8rem 0':'.45rem 0'};${opt.border?'border-top:1.5px solid var(--gray);':''}${opt.sub?'padding-left:1.2rem;':''}">
        <span style="color:${opt.sub?'var(--ink-soft)':'var(--deep)'};font-size:${opt.big?'1rem':opt.sub?'.85rem':'.92rem'};font-weight:${opt.big?'700':opt.sub?'500':'600'};">${label}</span>
        <span style="font-family:'Outfit';font-weight:${opt.big?'800':'700'};font-size:${opt.big?'1.4rem':opt.sub?'.9rem':'1.02rem'};color:${opt.accent||(opt.minus?'#c0392b':'var(--deep)')};">${opt.minus?'−':''}${val}</span>
      </div>`;
    const catRows = (d.expense_by_category || []).map(c =>
      row(`　・${escapeHtml(c.category)}`, yen(c.amount), { sub:true })).join('');
    // 店舗売上 = お客様総額 − キャスト報酬（＝キャストから店が受け取る額）
    const shopSales = (s.total || 0) - (d.reward_total || 0);
    document.getElementById('ac-summary').innerHTML = `
      <div style="background:var(--white);border:1.5px solid var(--gray);border-radius:14px;padding:1.1rem 1.3rem;max-width:560px;">
        ${row(`お客様総額 <span style="color:var(--ink-soft);font-weight:500;font-size:.8rem;">（完了 ${s.count}件）</span>`, yen(s.total))}
        ${subhead('料金内訳')}
        ${row('コース料金', yen(bd.course), { sub:true })}
        ${row('深夜料金', yen(bd.late), { sub:true })}
        ${row('出張費', yen(bd.transport), { sub:true })}
        ${subhead('支払方法')}
        ${row('現金', yen(s.cash), { sub:true })}
        ${row('クレジット', yen(s.credit), { sub:true })}
        ${row('銀行振込', yen(s.bank), { sub:true })}
        ${s.unset ? row('支払方法 未設定', yen(s.unset), { sub:true }) : ''}
        ${row('キャスト報酬', yen(d.reward_total), { minus:true })}
        ${row('＝ 店舗売上（キャストからの入金）', yen(shopSales), { big:true, border:true })}
        ${row(`クレジット手数料 <button id="acCardFeeBtn" type="button" style="margin-left:.4rem;background:transparent;border:1px solid var(--gray);border-radius:6px;padding:.1rem .5rem;font-size:.75rem;color:var(--ink-soft);cursor:pointer;">${parseFloat(d.card_fee_rate)}% 変更</button>`, yen(d.card_fee), { minus:true })}
        ${row(`指名料 <button id="acNominationFeeBtn" type="button" style="margin-left:.4rem;background:transparent;border:1px solid var(--gray);border-radius:6px;padding:.1rem .5rem;font-size:.75rem;color:var(--ink-soft);cursor:pointer;">設定</button>`, `<span style="font-size:.78rem;color:var(--ink-soft);font-weight:500;">初¥${NOMINATION_FEES.first.toLocaleString()} / 本¥${NOMINATION_FEES.regular.toLocaleString()} / フリー¥${NOMINATION_FEES.free.toLocaleString()}</span>`, { sub:true })}
        ${row(`経費合計`, yen(d.expense_total), { minus:true })}
        ${catRows}
        ${row('＝ 利益', yen(d.gross_profit), { big:true, border:true, accent:'var(--coral)' })}
      </div>`;
    document.getElementById('acCardFeeBtn')?.addEventListener('click', async () => {
      const cur = parseFloat(d.card_fee_rate);
      const v = prompt('カード手数料率（%）を入力', String(cur));
      if (v === null) return;
      const rate = parseFloat(v);
      if (isNaN(rate) || rate < 0 || rate > 100) { toast('0〜100の数値を入力してください', 'err'); return; }
      try {
        await apiPost('/admin-api.php?action=card-fee-set', { card_fee_rate: rate });
        toast('✓ 手数料率を更新しました', 'ok');
        loadAcSummary();
      } catch (e) { toast('更新失敗: ' + e.message, 'err'); }
    });
    document.getElementById('acNominationFeeBtn')?.addEventListener('click', async () => {
      const vf = prompt('初指名の指名料（円）を入力', String(NOMINATION_FEES.first));
      if (vf === null) return;
      const vr = prompt('本指名の指名料（円）を入力', String(NOMINATION_FEES.regular));
      if (vr === null) return;
      const vfr = prompt('フリーの指名料（円）を入力', String(NOMINATION_FEES.free));
      if (vfr === null) return;
      const parsed = { first: parseInt(vf, 10), regular: parseInt(vr, 10), free: parseInt(vfr, 10) };
      if (Object.values(parsed).some(n => isNaN(n) || n < 0)) { toast('0以上の数値を入力してください', 'err'); return; }
      try {
        const res = await apiPost('/admin-api.php?action=nomination-fees-set', { nomination_fees: parsed });
        if (res?.nomination_fees) Object.assign(NOMINATION_FEES, res.nomination_fees);
        toast('✓ 指名料を更新しました', 'ok');
        loadAcSummary();
      } catch (e) { toast('更新失敗: ' + e.message, 'err'); }
    });
  }

  // --- 💴 売上 ---
  async function loadAcSales() {
    const { from, to } = acPeriod();
    if (!from || !to) return;
    const el = document.getElementById('ac-sales');
    el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>集計中...</div>';
    try {
      const d = await api(`/admin-api.php?action=sales&from=${from}&to=${to}${acTQ()}`);
      renderAcSales(d);
    } catch (e) {
      el.innerHTML = `<p style="color:var(--coral);">読み込み失敗: ${escapeHtml(e.message)}</p>`;
    }
  }
  function renderAcSales(d) {
    const PM = { cash:'💴 現金', credit:'💳 クレジット', card:'💳 クレジット', bank:'🏦 銀行振込' };
    const payHtml = (d.by_payment || []).map(r =>
      `<div style="display:flex;justify-content:space-between;padding:.4rem 0;border-top:1px solid var(--foam);">
        <span>${PM[r.pm] || '未設定'} <span style="color:var(--ink-soft);font-size:.8rem;">${r.cnt}件</span></span>
        <span style="font-weight:700;font-family:'Outfit';">${yen(r.amt)}</span></div>`).join('') || '<p style="color:var(--ink-soft);">データなし</p>';
    const courseHtml = (d.by_course || []).map(r =>
      `<tr style="border-top:1px solid var(--foam);">
        <td style="padding:.35rem .4rem;">${escapeHtml(r.course)}</td>
        <td style="padding:.35rem .4rem;text-align:right;">${r.cnt}</td>
        <td style="padding:.35rem .4rem;text-align:right;font-weight:700;">${yen(r.amt)}</td></tr>`).join('') || '<tr><td colspan="3" style="padding:.6rem;color:var(--ink-soft);">データなし</td></tr>';
    const dayHtml = (d.by_day || []).map(r =>
      `<tr style="border-top:1px solid var(--foam);">
        <td style="padding:.35rem .4rem;">${formatDate(r.d)}</td>
        <td style="padding:.35rem .4rem;text-align:right;">${r.cnt}</td>
        <td style="padding:.35rem .4rem;text-align:right;font-weight:700;">${yen(r.amt)}</td></tr>`).join('') || '<tr><td colspan="3" style="padding:.6rem;color:var(--ink-soft);">データなし</td></tr>';
    document.getElementById('ac-sales').innerHTML = `
      <div style="display:grid;gap:1rem;">
        <div style="background:var(--white);border:1.5px solid var(--gray);border-radius:14px;padding:1rem 1.2rem;">
          <div style="font-weight:700;margin-bottom:.4rem;">支払方法別</div>${payHtml}
        </div>
        <div style="background:var(--white);border:1.5px solid var(--gray);border-radius:14px;padding:1rem 1.2rem;">
          <div style="font-weight:700;margin-bottom:.4rem;">コース別</div>
          <table style="width:100%;border-collapse:collapse;font-size:.85rem;">
            <thead><tr style="color:var(--ink-soft);text-align:left;"><th style="padding:.3rem .4rem;">コース</th><th style="padding:.3rem .4rem;text-align:right;">件数</th><th style="padding:.3rem .4rem;text-align:right;">売上</th></tr></thead>
            <tbody>${courseHtml}</tbody>
          </table>
        </div>
        <div style="background:var(--white);border:1.5px solid var(--gray);border-radius:14px;padding:1rem 1.2rem;">
          <div style="font-weight:700;margin-bottom:.4rem;">日別</div>
          <table style="width:100%;border-collapse:collapse;font-size:.85rem;">
            <thead><tr style="color:var(--ink-soft);text-align:left;"><th style="padding:.3rem .4rem;">日付</th><th style="padding:.3rem .4rem;text-align:right;">件数</th><th style="padding:.3rem .4rem;text-align:right;">売上</th></tr></thead>
            <tbody>${dayHtml}</tbody>
          </table>
        </div>
      </div>`;
  }

  // --- ✅ 集金（日×スタッフ単位の受け渡し・双方確認） ---
  let _settleFilter = 'unsettled';

  function settleCard(label, val, accent) {
    return `<div style="background:${accent ? 'linear-gradient(135deg,#fff0f3,#fff)' : 'var(--white)'};border:1.5px solid var(--gray);border-radius:12px;padding:.9rem .8rem;text-align:center;">
        <div style="font-family:'Outfit';font-size:1.35rem;font-weight:700;line-height:1.1;color:${accent ? 'var(--coral)' : 'var(--deep)'};">${val}</div>
        <div style="font-size:.74rem;color:var(--ink-soft);margin-top:.3rem;">${label}</div>
      </div>`;
  }
  function fmtDT(s) {
    if (!s) return '';
    const m = String(s).replace('T', ' ').match(/(\d{4})-(\d{2})-(\d{2})[ ]?(\d{2})?:?(\d{2})?/);
    if (!m) return '';
    return `${Number(m[2])}/${Number(m[3])}${m[4] ? ' ' + m[4] + ':' + m[5] : ''}`;
  }
  // mode: 'owner'（店舗が受領を確認） / 'staff'（本人が渡したを確認）
  function settleRow(r, mode) {
    const bs = 'font-size:.66rem;font-weight:700;padding:.12rem .5rem;border-radius:50px;margin-left:.3rem;white-space:nowrap;';
    const badge = r.both
      ? `<span style="${bs}background:#e6f7ee;color:#2e9e5b;">双方確認済</span>`
      : (r.settled
          ? `<span style="${bs}background:#fff4e0;color:#c47d12;">受領済</span>`
          : `<span style="${bs}background:#f3f3f3;color:var(--ink-soft);">未受領</span>`);
    const tConf = r.therapist_confirmed_at
      ? `<span style="color:#2e9e5b;font-weight:600;">✅ スタッフ渡し ${fmtDT(r.therapist_confirmed_at)}</span>`
      : `<span style="color:var(--ink-soft);">スタッフ未確認</span>`;
    const sConf = r.shop_confirmed_at
      ? `<span style="color:#2e9e5b;font-weight:600;">✅ 店舗受領 ${fmtDT(r.shop_confirmed_at)}</span>`
      : `<span style="color:var(--ink-soft);">店舗未確認</span>`;
    const snapWarn = (r.amount_snapshot !== null && r.amount_snapshot !== r.shop_amount)
      ? `<div style="font-size:.64rem;color:var(--coral);">⚠ 確認時 ${yen(r.amount_snapshot)}</div>` : '';
    const side = mode === 'owner' ? 'shop' : 'therapist';
    const on = mode === 'owner' ? !!r.shop_confirmed_at : !!r.therapist_confirmed_at;
    const onLabel = mode === 'owner' ? '✓ 受領済（取消）' : '✓ 渡し済（取消）';
    const offLabel = mode === 'owner' ? '店舗で受領' : '渡しました';
    const btn = `<button class="sbtn settle-act" data-side="${side}" data-date="${r.date}" data-tid="${r.therapist_id}" data-on="${on ? 1 : 0}" type="button"
        style="padding:.5rem .8rem;font-weight:700;${on ? 'background:#e6f7ee;color:#2e9e5b;border-color:#bfe6cf;' : ''}">${on ? onLabel : offLabel}</button>`;
    const head = mode === 'owner'
      ? `<b>${escapeHtml(r.therapist)}</b> <span style="color:var(--ink-soft);font-weight:500;font-size:.8rem;">${formatDate(r.date)}・${r.booking_count}件</span>`
      : `<b>${formatDate(r.date)}</b> <span style="color:var(--ink-soft);font-weight:500;font-size:.8rem;">${r.booking_count}件</span>`;
    return `
      <div class="hotel-row" style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;margin-bottom:.5rem;${r.settled ? 'opacity:.72;' : ''}">
        <div style="min-width:0;">
          <div>${head} ${badge}</div>
          <div style="font-size:.72rem;margin-top:.25rem;display:flex;gap:.8rem;flex-wrap:wrap;">${tConf}${sConf}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.7rem;white-space:nowrap;">
          <div style="text-align:right;">
            <div style="font-weight:800;font-family:'Outfit';color:var(--deep);">${yen(r.shop_amount)}</div>
            <div style="font-size:.66rem;color:var(--ink-soft);">店入金額</div>${snapWarn}
          </div>
          ${btn}
        </div>
      </div>`;
  }
  function bindSettleActions(reload) {
    document.querySelectorAll('.settle-act').forEach(btn => {
      btn.addEventListener('click', async () => {
        const value = btn.dataset.on === '1' ? 0 : 1;
        btn.disabled = true;
        try {
          await apiPost('/admin-api.php?action=settlement-confirm', {
            settle_date: btn.dataset.date, therapist_id: Number(btn.dataset.tid), side: btn.dataset.side, value,
          });
          reload();
        } catch (e) { toast('更新失敗: ' + e.message, 'err'); btn.disabled = false; }
      });
    });
  }
  // 1件ごとの集金行（店舗が受領、shop_settled）
  function settleBookingRow(r, readonly) {
    const bs = 'font-size:.66rem;font-weight:700;padding:.12rem .5rem;border-radius:50px;margin-left:.3rem;white-space:nowrap;';
    // 受け渡し済み（担当以外が保有中・店未受領）なら「→ 〜に渡した」を表示。カード/振込は💳バッジ
    const handedOn = !r.settled && r.held_by && Number(r.held_by) !== Number(r.assigned_admin_id) && r.holder;
    // 決済種別タグ（現金/カード/振込）を常に表示 → 精算確認で一目で判別できるように
    const payTag = isNonCash(r)
      ? `<span style="${bs}background:#eef4fb;color:var(--sea);">${pmBadge(r)}</span>`
      : `<span style="${bs}background:#fff6ea;color:var(--coral-deep);">💵 現金</span>`;
    // 現金のみ精算ステータス（カード/振込は店の口座に入るため精算対象外）
    const statusTag = isNonCash(r)
      ? ''
      : (r.settled
        ? `<span style="${bs}background:#e6f7ee;color:#2e9e5b;">✓ 精算済み</span>`
        : (handedOn
            ? `<span style="${bs}background:#fff3ee;color:var(--coral-deep);">→ ${escapeHtml(r.holder)}に渡した</span>`
            : `<span style="${bs}background:#f3f3f3;color:var(--ink-soft);">未精算</span>`));
    const badge = payTag + statusTag;
    const on = !!r.settled;
    // この1件分だけの入金依頼をコピー（未精算・現金のみ・owner画面）
    const copyOne = (!readonly && !r.settled && !isNonCash(r))
      ? `<button class="sbtn copy-settle-one" data-id="${r.id}" type="button" title="この1件の入金依頼をコピー"
          style="padding:.5rem .6rem;font-weight:700;background:#fff;border:1px solid var(--deep);color:var(--deep);">📋</button>`
      : '';
    const btn = readonly ? '' : `${copyOne}<button class="sbtn settle-act" data-id="${r.id}" data-on="${on ? 1 : 0}" type="button"
        style="padding:.5rem .8rem;font-weight:700;${on ? 'background:#e6f7ee;color:#2e9e5b;border-color:#bfe6cf;' : ''}">${on ? '✓ 精算済み（取消）' : '✓ 精算確定'}</button>`;
    // 営業日(10:00〜翌10:00)基準で表示。00:35 等の深夜は前営業日＋24h表記(24:35)にする
    const bizDate = bizDateOf(r.date, r.time || '00:00');
    const dispTime = fmtTimeDisp(r.time);
    return `
      <div class="hotel-row" data-od-id="${r.id}" style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;margin-bottom:.5rem;${r.settled ? 'opacity:.72;' : ''}${readonly ? 'cursor:pointer;' : ''}">
        <div style="min-width:0;">
          <div><b>${escapeHtml(r.therapist)}</b> <span style="color:var(--ink-soft);font-weight:500;font-size:.8rem;">${formatDate(bizDate)} ${escapeHtml(dispTime)}</span> ${badge}</div>
          <div style="font-size:.72rem;color:var(--ink-soft);margin-top:.25rem;">${escapeHtml(r.customer || '—')}・${escapeHtml(r.course || '—')}${r.settled_at ? ' ・受領 ' + fmtDT(r.settled_at) : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.7rem;white-space:nowrap;">
          <div style="text-align:right;">
            <div style="font-weight:800;font-family:'Outfit';color:var(--deep);">${yen(r.shop_amount)}</div>
            <div style="font-size:.66rem;color:var(--ink-soft);">店入金額</div>
          </div>
          ${readonly ? '<span class="th-book-chev" aria-hidden="true">›</span>' : btn}
        </div>
      </div>`;
  }
  // 「〇〇さんへ入金依頼」用の文面を組み立てる（LINE等にコピペする想定・プレーンテキスト）
  // 1件＝3行（日付時刻／お客様・コース／入金額）、複数件は空行区切り＋入金額合計
  function buildSettleRequestText(name, rows) {
    const entry = (r) => {
      const bizDate = bizDateOf(r.date, r.time || '00:00');
      return `・${formatDate(bizDate)} ${fmtTimeDisp(r.time)}\n${r.customer || '—'}／${r.course || '—'}\n入金額${yen(r.shop_amount)}`;
    };
    const body = rows.map(entry).join('\n\n');
    const total = rows.reduce((s, r) => s + (Number(r.shop_amount) || 0), 0);
    const tail = rows.length > 1
      ? `\n\n入金額合計 ${yen(total)}\nよろしくお願いします。`
      : `\n\nよろしくお願いします。`;
    return `${name}さん\nお疲れさまです。\n下記の分の店入金をお願いします。\n\n${body}${tail}`;
  }
  function bindBookingSettleActions(reload) {
    document.querySelectorAll('#settleList .settle-act').forEach(btn => {
      btn.addEventListener('click', async () => {
        const settled = btn.dataset.on === '1' ? 0 : 1;
        btn.disabled = true;
        try {
          // 精算確認は「店入金額(net＝売上−報酬)」の受領。報酬は担当が保持するため kind='net'（未払い報酬に出さない）
          await apiPost('/admin-api.php?action=booking-settle', { id: Number(btn.dataset.id), settled, kind: 'net' });
          reload();
        } catch (e) { toast('更新失敗: ' + e.message, 'err'); btn.disabled = false; }
      });
    });
  }

  // 店舗側（owner/manager）: 全スタッフの集金
  async function loadSettlements() {
    const { from, to } = acPeriod();
    if (!from || !to) return;
    const el = document.getElementById('settleList');
    el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';
    try {
      const d = await api(`/admin-api.php?action=settlements&from=${from}&to=${to}${acTQ()}`);
      renderSettlements(d);
    } catch (e) {
      el.innerHTML = `<p style="color:var(--coral);">読み込み失敗: ${escapeHtml(e.message)}</p>`;
    }
  }
  function renderSettlements(d) {
    const sm = d.summary || { unsettled:0, settled:0, unsettled_count:0, settled_count:0 };
    // 人別に未精算（現金のみ）をまとめ、「〇〇さんへ入金依頼をコピー」ボタンを作る
    const byPerson = {};
    (d.rows || []).forEach(r => {
      if (r.settled || isNonCash(r)) return;
      const k = r.therapist || '—';
      (byPerson[k] = byPerson[k] || []).push(r);
    });
    const copyBtns = Object.keys(byPerson).map(name => {
      const list = byPerson[name];
      const total = list.reduce((s, r) => s + (Number(r.shop_amount) || 0), 0);
      return `<button class="sbtn copy-settle-req" data-name="${escapeAttr(name)}" type="button"
        style="padding:.5rem .9rem;font-weight:700;background:#fff;border:1px solid var(--deep);color:var(--deep);border-radius:10px;">
        📋 ${escapeHtml(name)}さんへ入金依頼（${list.length}件 ${yen(total)}）</button>`;
    }).join('');
    document.getElementById('settleSummary').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:.7rem;">
        ${settleCard(`未精算（${sm.unsettled_count}件）`, yen(sm.unsettled), true)}
        ${settleCard(`精算済み（${sm.settled_count}件）`, yen(sm.settled))}
      </div>${copyBtns ? `<div style="display:flex;flex-wrap:wrap;gap:.6rem;margin-top:.8rem;">${copyBtns}</div>` : ''}`;
    document.querySelectorAll('#settleSummary .copy-settle-req').forEach(btn => btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      const list = byPerson[name] || [];
      const ok = await copyTextToClipboard(buildSettleRequestText(name, list));
      toast(ok ? `✓ ${name}さんへの入金依頼をコピーしました` : 'コピーに失敗しました', ok ? 'ok' : 'err');
    }));
    let rows = d.rows || [];
    if (_settleFilter === 'unsettled') rows = rows.filter(r => !r.settled);
    else if (_settleFilter === 'settled') rows = rows.filter(r => r.settled);
    if (!rows.length) {
      document.getElementById('settleList').innerHTML = '<p style="color:var(--ink-soft);padding:1.5rem 0;text-align:center;">対象がありません。</p>';
      return;
    }
    document.getElementById('settleList').innerHTML = rows.map(r => settleBookingRow(r)).join('');
    bindBookingSettleActions(loadSettlements);
    // 1件ずつの入金依頼コピー
    const rowMap = {}; (d.rows || []).forEach(r => { rowMap[r.id] = r; });
    document.querySelectorAll('#settleList .copy-settle-one').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const r = rowMap[btn.dataset.id];
      if (!r) return;
      const ok = await copyTextToClipboard(buildSettleRequestText(r.therapist || '—', [r]));
      toast(ok ? '✓ この1件の入金依頼をコピーしました' : 'コピーに失敗しました', ok ? 'ok' : 'err');
    }));
  }

  // スタッフ側（本人）: 自分の集金タブ
  let _msInit = false;
  function msSetRange(range) {
    const now = getBusinessDayDate();  // 営業日基準（深夜0-10時は前日が「今日」）
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const fmt = (dt) => `${dt.getFullYear()}-${('0'+(dt.getMonth()+1)).slice(-2)}-${('0'+dt.getDate()).slice(-2)}`;
    let from, to;
    if (range === 'today') { from = to = new Date(y, m, d); }
    else if (range === 'yesterday') {
      const cur = document.getElementById('msFrom').value;
      const base = cur ? new Date(cur + 'T00:00:00') : new Date(y, m, d);
      base.setDate(base.getDate() - 1);
      from = to = base;
    }
    else if (range === 'this-week') { const dow = (now.getDay() + 6) % 7; from = new Date(y, m, d - dow); to = new Date(y, m, d - dow + 6); }
    else if (range === 'last-month') { from = new Date(y, m - 1, 1); to = new Date(y, m, 0); }
    else { from = new Date(y, m, 1); to = new Date(y, m + 1, 0); }
    document.getElementById('msFrom').value = fmt(from);
    document.getElementById('msTo').value = fmt(to);
    document.querySelectorAll('.ms-range').forEach(b => b.classList.toggle('active', b.dataset.range === range));
  }
  // 👤 担当したお客様（キャスト本人。自分の予約から集計・電話/お店の顧客メモは出さない）
  let _mcData = [];
  let _mcInit = false;
  async function loadMyClients() {
    const el = document.getElementById('mcList');
    if (!el) return;
    if (!_mcInit) { _mcInit = true; document.getElementById('mcKeyword')?.addEventListener('input', renderMyClients); document.getElementById('mcDate')?.addEventListener('change', renderMyClients); }
    el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';
    try {
      const d = await api('/admin-api.php?action=my-customers');
      _mcData = d.customers || [];
      renderMyClients();
    } catch (e) { el.innerHTML = `<p style="color:var(--coral);">読み込み失敗: ${escapeHtml(e.message)}</p>`; }
  }
  function renderMyClients() {
    const el = document.getElementById('mcList');
    if (!el) return;
    const kw = (document.getElementById('mcKeyword')?.value || '').trim().toLowerCase();
    const date = document.getElementById('mcDate')?.value || '';  // カレンダー選択日 YYYY-MM-DD
    const list = _mcData.filter(c => {
      if (kw && !String(c.name || '').toLowerCase().includes(kw)) return false;
      if (date && !(c.bookings || []).some(b => bizDateOf(String(b.date || ''), b.time || '00:00') === date)) return false;
      return true;
    });
    if (!list.length) {
      el.innerHTML = `<div style="color:var(--ink-soft);padding:1.5rem 0;text-align:center;">${_mcData.length ? '該当するお客様がいません。' : '担当したお客様がまだいません。'}</div>`;
      return;
    }
    const md = (d) => d ? String(d).slice(5).replace('-', '/') : '—';
    // 履歴の日付・時刻は営業日基準（深夜は前営業日＋24h+表記）
    const bkBizDate = (b) => bizDateOf(String(b.date || ''), b.time || '00:00');
    const bkBizTime = (b) => fmtTimeDisp(b.time);
    const lastBizDate = (c) => (c.bookings && c.bookings.length) ? bkBizDate(c.bookings[0]) : c.last_date;
    el.innerHTML = list.map(c => `
      <div class="mc-card">
        <div class="mc-head">
          <span class="mc-name">${escapeHtml(c.name)}</span>
          <span class="mc-meta">${c.count}回 ・ 最終 ${md(lastBizDate(c))} <span class="mc-chev">›</span></span>
        </div>
        <div class="mc-detail" style="display:none;">
          ${(c.bookings || []).map(b => `<div class="mc-bk">
            <span class="mc-bk-date">${md(bkBizDate(b))} ${bkBizTime(b)}</span> ${escapeHtml(b.course || '—')}
            ${b.notes ? `<div class="mc-bk-note">📝 ${escapeHtml(b.notes)}</div>` : ''}
          </div>`).join('')}
        </div>
      </div>`).join('');
    el.querySelectorAll('.mc-card').forEach(card => card.addEventListener('click', () => {
      const d = card.querySelector('.mc-detail');
      if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
    }));
  }

  async function loadMySettlements() {
    if (!_msInit) {
      _msInit = true;
      msSetRange('today');
      document.querySelectorAll('.ms-range').forEach(b => b.addEventListener('click', () => { msSetRange(b.dataset.range); loadMySettlements(); }));
      document.getElementById('msApply')?.addEventListener('click', () => { document.querySelectorAll('.ms-range').forEach(x => x.classList.remove('active')); loadMySettlements(); });
    }
    const from = document.getElementById('msFrom').value, to = document.getElementById('msTo').value;
    if (!from || !to) return;
    const el = document.getElementById('msList');
    el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';
    try {
      const d = await api(`/admin-api.php?action=my-settlement-bookings&from=${from}&to=${to}`);
      const sm = d.summary || { unsettled:0, settled:0, unsettled_count:0, settled_count:0 };
      const rows = d.rows || [];
      // 集計: 手元(現在自分が保有) / 誰に渡したか / 店に入金済 / 報酬
      const myId = Number(currentUser?.id) || 0;
      let heldByMeTotal = 0, handedTotal = 0, settledTotal = 0, rewardTotal = 0;
      const heldRows = [];               // 現在自分が持っている預り金（1件ずつ表示用）
      const handedHolders = new Map();   // 保有者名 → 金額
      rows.forEach(r => {
        const sales = Number(r.sales) || 0;
        rewardTotal += Number(r.reward) || 0;
        if (isNonCash(r)) { settledTotal += sales; return; }  // カード/振込は現金を預からない（店の口座へ）
        if (r.settled) { settledTotal += sales; return; }
        // 報酬確定済み（渡し済み/本人確保）なら、預り金として動くのは残額（入金分）だけ
        const heldAmt = r.reward_paid_at ? sales - (Number(r.reward) || 0) : sales;
        if (r.held_by && Number(r.held_by) !== myId) {
          // 誰かに渡した（手元にない）
          handedTotal += heldAmt;
          const nm = r.holder || '—';
          handedHolders.set(nm, (handedHolders.get(nm) || 0) + heldAmt);
        } else {
          // 自分が保有中（＝いま持っている）
          heldByMeTotal += heldAmt;
          heldRows.push({ ...r, _heldAmt: heldAmt });
        }
      });
      // 4ブロックの上: いま持っている預り金を1件ずつ表示
      const perJob = heldRows.length
        ? `<div style="background:#fff;border:1.5px solid var(--gray);border-radius:12px;padding:.6rem .8rem;margin-bottom:.6rem;">
             <div style="font-size:.74rem;color:var(--ink-soft);font-weight:700;margin-bottom:.35rem;">📋 いま持っている預り金</div>
             ${heldRows.map(r => `<div style="display:flex;justify-content:space-between;gap:.5rem;font-size:.85rem;padding:.28rem 0;border-top:1px solid #f2f2f2;">
                <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${formatDate(bizDateOf(r.date, r.time || '00:00'))} ${escapeHtml(r.customer || '—')}・${escapeHtml(r.course || '')}</span>
                <b style="white-space:nowrap;font-family:'Outfit';color:var(--deep);">${yen(Number(r._heldAmt ?? r.sales) || 0)}</b>
             </div>`).join('')}
           </div>`
        : '';
      const block = (val, label, opt = {}) => `
        <div style="background:${opt.bg || '#fff'};border:${opt.border || '1.5px solid var(--gray)'};border-radius:12px;padding:.9rem .7rem;text-align:center;${opt.shadow || ''}">
          <div style="font-family:'Outfit';font-size:${opt.small ? '1.15rem' : '1.5rem'};font-weight:800;line-height:1.15;color:${opt.color || 'var(--deep)'};word-break:break-word;">${val}</div>
          <div style="font-size:.72rem;color:${opt.labelColor || 'var(--ink-soft)'};margin-top:.28rem;">${label}</div>
        </div>`;
      // 右上「誰に渡したか」= 相手＋金額を大きく。複数の相手にも対応（1行ずつ）
      const handedEntries = [...handedHolders.entries()];
      let handedBlock;
      if (handedEntries.length === 0) {
        handedBlock = block('なし', '🤝 誰に渡したか', { color:'var(--ink-soft)' });
      } else {
        const single = handedEntries.length === 1;
        const listHtml = handedEntries.map(([nm, amt]) => `
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;padding:.12rem 0;">
            <span style="color:var(--coral);font-weight:800;font-size:${single ? '1.25rem' : '1rem'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(nm)}</span>
            <b style="font-family:'Outfit';color:var(--deep);font-size:${single ? '1.35rem' : '1.05rem'};white-space:nowrap;">${yen(amt)}</b>
          </div>`).join('');
        handedBlock = `
          <div style="background:#fff;border:1.5px solid var(--gray);border-radius:12px;padding:.75rem .8rem;display:flex;flex-direction:column;justify-content:center;">
            <div style="font-size:.72rem;color:var(--ink-soft);margin-bottom:.3rem;">🤝 誰に渡したか</div>
            ${listHtml}
          </div>`;
      }
      document.getElementById('msSummary').innerHTML = `
        ${perJob}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;">
          ${block(yen(heldByMeTotal), `💰 預り金（${heldRows.length}件）`, { bg:'linear-gradient(135deg,#ff9a76,#e87a4f)', border:'none', color:'#fff', labelColor:'#fff', shadow:'box-shadow:0 3px 10px rgba(224,116,60,.28);' })}
          ${handedBlock}
          ${block(yen(settledTotal), `✅ 精算済み（${sm.settled_count}件）`, { color:settledTotal > 0 ? 'var(--green)' : 'var(--ink-soft)' })}
          ${block(yen(rewardTotal), '💴 報酬（あなたの取り分）', { color:'var(--deep)' })}
        </div>`;
      if (!rows.length) {
        document.getElementById('msList').innerHTML = '<p style="color:var(--ink-soft);padding:1.5rem 0;text-align:center;">この期間の入金はありません。</p>';
        return;
      }
      document.getElementById('msList').innerHTML = rows.map(r => settleBookingRow(r, true)).join('');
      // 各行クリック → 読み取り専用の予約詳細モーダル
      document.querySelectorAll('#msList [data-od-id]').forEach(row => row.addEventListener('click', () => openOrderDetailModal(Number(row.dataset.odId))));
    } catch (e) {
      el.innerHTML = `<p style="color:var(--coral);">読み込み失敗: ${escapeHtml(e.message)}</p>`;
    }
  }

  // --- 🧾 経費 ---
  async function loadExpenses() {
    const { from, to } = acPeriod();
    if (!from || !to) return;
    const el = document.getElementById('expList');
    el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';
    try {
      const d = await api(`/admin-api.php?action=expenses-list&from=${from}&to=${to}`);
      renderExpenses(d);
    } catch (e) {
      el.innerHTML = `<p style="color:var(--coral);">読み込み失敗: ${escapeHtml(e.message)}</p>`;
    }
  }
  function renderExpenses(d) {
    document.getElementById('expTotal').textContent = `経費合計: ${yen(d.total)}（${(d.expenses||[]).length}件）`;
    const list = d.expenses || [];
    if (!list.length) {
      document.getElementById('expList').innerHTML = '<p style="color:var(--ink-soft);padding:1.5rem 0;text-align:center;">この期間の経費はありません。「＋ 経費を追加」から登録してください。</p>';
      return;
    }
    document.getElementById('expList').innerHTML = list.map(e => `
      <div class="hotel-row" style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;margin-bottom:.5rem;cursor:pointer;" data-exp-edit='${escapeAttr(JSON.stringify(e))}'>
        <div>
          <div style="font-weight:700;">${escapeHtml(e.category)} <span style="color:var(--ink-soft);font-weight:500;font-size:.82rem;">${formatDate(e.expense_date)}</span></div>
          <div style="color:var(--ink-soft);font-size:.8rem;">${e.vendor ? escapeHtml(e.vendor) : ''}${e.vendor && e.memo ? ' / ' : ''}${e.memo ? escapeHtml(e.memo) : ''}</div>
        </div>
        <div style="font-weight:800;font-family:'Outfit';color:var(--deep);white-space:nowrap;">${yen(e.amount)}</div>
      </div>`).join('');
    document.querySelectorAll('[data-exp-edit]').forEach(el => {
      el.addEventListener('click', () => { try { openExpenseModal(JSON.parse(el.dataset.expEdit)); } catch (_) {} });
    });
  }
  let editingExpenseId = null;
  function openExpenseModal(exp) {
    editingExpenseId = exp ? exp.id : null;
    document.getElementById('expTitle').textContent = exp ? '経費を編集' : '経費を追加';
    document.getElementById('expDate').value = exp ? String(exp.expense_date).substring(0,10) : (acPeriod().to || acPeriod().from || '');
    setMoney('expAmount', exp ? exp.amount : '');
    document.getElementById('expCategory').value = exp ? exp.category : '広告費';
    document.getElementById('expVendor').value = exp ? (exp.vendor || '') : '';
    document.getElementById('expMemo').value = exp ? (exp.memo || '') : '';
    document.getElementById('expDelete').style.display = exp ? 'inline-flex' : 'none';
    openModal('expenseModal');
  }
  async function saveExpense() {
    const payload = {
      id: editingExpenseId || 0,
      expense_date: document.getElementById('expDate').value,
      amount: moneyVal('expAmount') || 0,
      category: document.getElementById('expCategory').value,
      vendor: document.getElementById('expVendor').value.trim(),
      memo: document.getElementById('expMemo').value.trim(),
    };
    if (!payload.expense_date) { toast('日付を入力してください', 'err'); return; }
    if (payload.amount <= 0) { toast('金額を入力してください', 'err'); return; }
    try {
      await apiPost('/admin-api.php?action=expense-save', payload);
      toast('✓ 保存しました', 'ok');
      closeModal('expenseModal');
      loadExpenses();
    } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
  }
  async function deleteExpense() {
    if (!editingExpenseId) return;
    if (!confirm('この経費を削除しますか？')) return;
    try {
      await apiPost('/admin-api.php?action=expense-delete', { id: editingExpenseId });
      toast('✓ 削除しました', 'ok');
      closeModal('expenseModal');
      loadExpenses();
    } catch (e) { toast('削除失敗: ' + e.message, 'err'); }
  }

  // --- 👤 報酬 ---
  async function loadPayroll() {
    const { from, to } = acPeriod();
    if (!from || !to) return;
    const res = document.getElementById('payResult');
    res.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>集計中...</div>';
    try {
      const d = await api(`/admin-api.php?action=payroll&from=${from}&to=${to}`);
      renderPayroll(d);
    } catch (e) {
      res.innerHTML = `<p style="color:var(--coral);">読み込み失敗: ${escapeHtml(e.message)}</p>`;
    }
  }

  let _payrollData = null;
  function renderPayroll(d) {
    _payrollData = d;
    renderPayrollView();
  }
  function renderPayrollView() {
    const d = _payrollData;
    if (!d) return;
    const all = d.therapists || [];
    const selVal = document.getElementById('acTherapist')?.value || '';
    let list, totals, single = false;
    if (!selVal) {
      list = all;
      totals = d.grand || { count: 0, base_total: 0, reward_total: 0 };
    } else {
      const t = all.find(x => String(x.admin_id) === selVal);
      list = t ? [t] : [];
      totals = t ? { count: t.count, base_total: t.base_total, reward_total: t.reward_total } : { count: 0, base_total: 0, reward_total: 0 };
      single = true;
    }
    const card = (label, val, accent) => `
      <div style="background:${accent ? 'linear-gradient(135deg,#fff0f3,#fff)' : 'var(--white)'};border:1.5px solid var(--gray);border-radius:12px;padding:.9rem .8rem;text-align:center;">
        <div style="font-family:'Outfit';font-size:1.5rem;font-weight:700;line-height:1.1;color:${accent ? 'var(--coral)' : 'var(--deep)'};">${val}</div>
        <div style="font-size:.74rem;color:var(--ink-soft);margin-top:.3rem;letter-spacing:.04em;">${label}</div>
      </div>`;
    document.getElementById('payTotal').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.7rem;">
        ${card('完了件数', totals.count)}
        ${card('対象売上', yen(totals.base_total))}
        ${card(single ? '報酬' : '報酬合計', yen(totals.reward_total), true)}
      </div>`;
    if (!list.length) {
      document.getElementById('payResult').innerHTML = '<p style="color:var(--ink-soft);padding:1.5rem 0;text-align:center;">対象期間に完了予約がありません。</p>';
      return;
    }
    let html = '';
    list.forEach((t, i) => {
      const detailId = 'payDetail' + i;
      const open = single;
      html += `
      <div class="hotel-row" style="display:block;margin-bottom:.6rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;cursor:pointer;" data-pay-toggle="${detailId}">
          <div style="font-weight:700;">${escapeHtml(t.name)} <span style="color:var(--ink-soft);font-weight:500;font-size:.85rem;">（歩合 ${parseFloat(t.rate)}%・${t.count}件）</span></div>
          <div style="display:flex;gap:1.2rem;align-items:baseline;">
            <span style="color:var(--ink-soft);font-size:.85rem;">対象 ${yen(t.base_total)}</span>
            <span style="font-weight:800;color:var(--coral);font-size:1.05rem;">${yen(t.reward_total)}</span>
            <span style="color:var(--ink-soft);font-size:.8rem;">▼</span>
          </div>
        </div>
        <div id="${detailId}" style="display:${open ? '' : 'none'};margin-top:.7rem;border-top:1px solid var(--gray);padding-top:.6rem;">
          <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
            <thead><tr style="color:var(--ink-soft);text-align:left;">
              <th style="padding:.3rem .4rem;">日付</th><th style="padding:.3rem .4rem;">時刻</th>
              <th style="padding:.3rem .4rem;">お客様</th><th style="padding:.3rem .4rem;">コース</th>
              <th style="padding:.3rem .4rem;text-align:right;">対象額</th><th style="padding:.3rem .4rem;text-align:right;">報酬</th>
            </tr></thead>
            <tbody>
              ${(t.details || []).map(x => `<tr style="border-top:1px solid var(--foam);">
                <td style="padding:.3rem .4rem;">${formatDate(bizDateOf(String(x.date), x.time || '00:00'))}</td>
                <td style="padding:.3rem .4rem;">${escapeHtml(fmtTimeDisp(x.time))}</td>
                <td style="padding:.3rem .4rem;">${escapeHtml(x.customer || '—')}</td>
                <td style="padding:.3rem .4rem;">${escapeHtml(x.course || '—')}</td>
                <td style="padding:.3rem .4rem;text-align:right;">${yen(x.base)}</td>
                <td style="padding:.3rem .4rem;text-align:right;font-weight:700;color:var(--coral);">${yen(x.reward)}</td>
              </tr>
              <tr><td colspan="6" style="padding:0 .4rem .45rem 1.2rem;color:var(--ink-soft);font-size:.73rem;line-height:1.5;">コース ${yen(x.course_fee || 0)}×${parseFloat(t.rate)}% = ${yen(x.course_reward || 0)}${x.late_self ? ` ＋ 深夜 ${yen(x.late_self)}` : (x.late_shop > 0 ? ` ＋ 深夜 ${yen(x.late_shop)}はお迎えで店` : '')} ＋ 出張費 ${yen(x.transport_self || 0)}${x.has_driver && x.transport_shop > 0 ? `（送迎で店 ${yen(x.transport_shop)}）` : ''}${x.card_fee_self > 0 ? ` <span style="color:var(--sea);">− 💳カード手数料 ${yen(x.card_fee_self)}</span>` : ''}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
    });
    const res = document.getElementById('payResult');
    res.innerHTML = html;
    res.querySelectorAll('[data-pay-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const t = document.getElementById(el.dataset.payToggle);
        if (t) t.style.display = t.style.display === 'none' ? '' : 'none';
      });
    });
  }

  // ============ 💬 チャット管理 ============
  const CHAT_API = '/ctrl/ops/api/chat-api.php';
  let chatSessions = [];
  let chatCurrentSessionId = null;
  let chatLastMsgId = 0;
  let chatPollTimer = null;
  let chatThreadPollTimer = null;
  let chatSettings = { is_online: 1, welcome_message: '', notify_email: '', reception_start: null, reception_end: null };

  async function chatApi(path, opts = {}) {
    const r = await fetch(CHAT_API + path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...opts,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }

  async function loadChatInbox() {
    try {
      const d = await chatApi('?action=owner-inbox');
      chatSessions = d.sessions || [];
      renderChatInbox();
      // 設定取得
      const s = await chatApi('?action=get-settings');
      chatSettings = { ...chatSettings, ...s };
      const toggle = document.getElementById('caOnlineToggle');
      if (toggle) toggle.checked = !!chatSettings.is_online;
      // バッジ更新
      updateChatBadge();
      // PWA アプリアイコンのバッジ (SW が累積したもの) をクリア
      clearChatAppBadge();
      // Web Push 通知ボタンの初期化
      refreshChatPushButton();
      // 自動ポーリング開始
      startChatInboxPolling();
    } catch (e) { toast('チャット取得失敗: ' + e.message, 'err'); }
  }

  // PWA アプリアイコンのバッジをクリア (iOS 16.4+ / Android Chrome)
  // SW が IndexedDB に蓄積した count をリセット + navigator.clearAppBadge() を呼び出す
  async function clearChatAppBadge() {
    try {
      if ('clearAppBadge' in navigator) {
        await navigator.clearAppBadge();
      } else if ('setAppBadge' in navigator) {
        await navigator.setAppBadge(0);
      }
    } catch (_) {}
    // SW 側 IndexedDB の count もリセット (次回 push 時に正しい数から累積)
    try {
      const req = indexedDB.open('ylka-chat-badge', 1);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(0, 'count');
        } catch (_) {}
      };
    } catch (_) {}
  }

  // ============ Web Push 通知 (iPhone PWA 対応) ============
  // 仕様:
  //  - SW: /chat-push-sw.js  scope: '/ctrl/'
  //  - VAPID 公開鍵を chat-api から取得
  //  - 購読: pushManager.subscribe() → サーバーに endpoint/p256dh/auth を保存
  //  - 解除: pushManager.unsubscribe() + サーバーから削除

  function isPushSupported() {
    return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
  }

  function urlBase64ToUint8Array(b64) {
    const padding = '='.repeat((4 - (b64.length % 4)) % 4);
    const b = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function ensureChatSWRegistration() {
    if (!isPushSupported()) return null;
    try {
      // 既存登録を取得 or 新規登録
      let reg = await navigator.serviceWorker.getRegistration('/ctrl/');
      if (!reg) reg = await navigator.serviceWorker.register('/chat-push-sw.js', { scope: '/ctrl/' });
      return reg;
    } catch (e) {
      console.warn('SW register failed', e);
      return null;
    }
  }

  async function getCurrentPushSubscription() {
    const reg = await ensureChatSWRegistration();
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  }

  async function refreshChatPushButton() {
    const btn = document.getElementById('caPushBtn');
    if (!btn) return;
    if (!isPushSupported()) {
      btn.textContent = '🔔 通知 (非対応端末)';
      btn.disabled = true;
      btn.style.opacity = '.5';
      return;
    }
    const sub = await getCurrentPushSubscription();
    if (sub) {
      btn.textContent = '🔕 通知をOFF';
      btn.dataset.state = 'on';
    } else {
      btn.textContent = '🔔 通知をON';
      btn.dataset.state = 'off';
    }
  }

  async function toggleChatPush() {
    const btn = document.getElementById('caPushBtn');
    if (!isPushSupported()) { toast('この端末は Web Push 非対応です (iOS は PWA としてホーム画面追加後に有効化)', 'err'); return; }
    btn.disabled = true;
    try {
      const sub = await getCurrentPushSubscription();
      if (sub) {
        await chatApi('?action=push-unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
        toast('🔕 通知をOFFにしました', 'ok');
      } else {
        // 通知許可ダイアログ
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { toast('通知が許可されませんでした', 'err'); return; }
        // VAPID 公開鍵取得
        const keyRes = await chatApi('?action=push-vapid-public-key');
        if (!keyRes.public_key) { toast('VAPID 鍵取得失敗', 'err'); return; }
        const reg = await ensureChatSWRegistration();
        if (!reg) { toast('Service Worker 登録失敗', 'err'); return; }
        const newSub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyRes.public_key),
        });
        const json = newSub.toJSON();
        await chatApi('?action=push-subscribe', {
          method: 'POST',
          body: JSON.stringify({
            endpoint: json.endpoint,
            p256dh:   json.keys && json.keys.p256dh,
            auth:     json.keys && json.keys.auth,
          }),
        });
        toast('🔔 通知をONにしました', 'ok');
      }
    } catch (e) {
      toast('通知設定失敗: ' + (e.message || e), 'err');
    } finally {
      btn.disabled = false;
      refreshChatPushButton();
    }
  }

  function renderChatInbox() {
    const el = document.getElementById('caInbox');
    if (!el) return;
    if (chatSessions.length === 0) {
      el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--ink-soft);font-size:.9rem;">受信メッセージはありません</div>';
      return;
    }
    el.innerHTML = chatSessions.map(s => {
      const name = escapeHtml(s.visitor_name || '匿名訪問者');
      const preview = escapeHtml((s.last_message || '').substring(0, 60));
      const time = s.last_at ? formatChatTime(s.last_at) : '';
      const unread = s.unread_owner_count > 0 ? `<span class="ci-unread">${s.unread_owner_count}</span>` : '';
      const isActive = Number(s.id) === Number(chatCurrentSessionId) ? 'active' : '';
      // 紐付け予約バッジ
      let bkBadge = '';
      if (s.booking_id) {
        const bkLabel = s.booking_status === 'reserved' ? '✅予約確定'
                      : s.booking_status === 'completed' ? '✓完了'
                      : s.booking_status === 'cancelled' ? '✕キャンセル'
                      : '📅仮予約済';
        bkBadge = `<span class="ci-bk-badge" data-bk-id="${s.booking_id}" title="クリックで予約編集">${bkLabel}</span>`;
      }
      return `<div class="ca-inbox-item ${isActive}" data-session-id="${s.id}">
        <div class="ci-name">${name} ${unread}</div>
        <div class="ci-preview">${s.last_sender === 'owner' ? '↩ ' : ''}${preview}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.3rem;">
          <div class="ci-time">${time}</div>
          ${bkBadge}
        </div>
      </div>`;
    }).join('');
    el.querySelectorAll('.ca-inbox-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // 予約バッジクリック時は予約モーダルを開く
        const bk = e.target.closest('.ci-bk-badge');
        if (bk) {
          e.stopPropagation();
          openBookingModal(Number(bk.dataset.bkId));
          return;
        }
        openChatThread(Number(item.dataset.sessionId));
      });
    });
  }

  async function openChatThread(sessionId) {
    chatCurrentSessionId = sessionId;
    chatLastMsgId = 0;
    const sess = chatSessions.find(s => Number(s.id) === sessionId);
    const titleEl = document.getElementById('caThreadTitle');
    const baseTitle = (sess?.visitor_name || '匿名訪問者') + ' / ' + (sess?.page_url || '');
    // 顧客紐付け済みなら 顧客名 + リンクボタンを表示
    if (sess?.linked_customer_id) {
      const custName = sess.linked_customer_name || sess.visitor_name || '';
      titleEl.innerHTML = `<span>${escapeHtml(baseTitle)}</span>
        <button class="ca-cust-link" data-customer-id="${sess.linked_customer_id}"
          style="margin-left:.6rem;background:linear-gradient(135deg,var(--coral),#e87a4f);color:#fff;border:none;padding:.3rem .7rem;border-radius:50px;font-size:.78rem;font-weight:600;cursor:pointer;">
          📌 顧客: ${escapeHtml(custName)}
        </button>`;
      const btn = titleEl.querySelector('.ca-cust-link');
      if (btn) btn.addEventListener('click', () => openCustomerModal(Number(btn.dataset.customerId)));
    } else {
      titleEl.textContent = baseTitle;
    }
    document.querySelector('.chat-admin-grid')?.classList.add('show-thread');
    document.getElementById('caMessages').innerHTML = '<div style="text-align:center;color:var(--ink-soft);padding:1rem;">読み込み中…</div>';
    document.getElementById('caReply').style.display = 'flex';
    document.querySelectorAll('.ca-inbox-item').forEach(i => i.classList.toggle('active', Number(i.dataset.sessionId) === sessionId));
    try {
      const d = await chatApi('?action=owner-messages&session_id=' + sessionId);
      renderChatMessages(d.messages || []);
      updateOwnerReadStatus(d.last_read_owner_msg_id || 0);
      // 既読化
      await chatApi('?action=owner-mark-read', { method: 'POST', body: JSON.stringify({ session_id: sessionId }) });
      // 受信箱再ロード（未読数更新）
      loadChatInbox();
      startChatThreadPolling();
    } catch (e) { toast('スレッド取得失敗: ' + e.message, 'err'); }
  }

  // HTMLエスケープした上で http(s) URL をクリック可能なリンクに変換
  function linkifyChat(s) {
    return escapeHtml(s).replace(/https?:\/\/[^\s<]+/g, url =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  }
  function renderChatMessages(messages, append = false) {
    const el = document.getElementById('caMessages');
    if (!append) el.innerHTML = '';
    messages.forEach(m => {
      const row = document.createElement('div');
      row.className = 'ca-msg ca-msg-' + m.sender_type;
      row.dataset.msgId = m.id;
      row.innerHTML = linkifyChat(m.body) + `<div class="ca-msg-meta">${formatChatTime(m.created_at)}</div>`;
      el.appendChild(row);
      if (m.id > chatLastMsgId) chatLastMsgId = m.id;
    });
    setTimeout(() => { el.scrollTop = el.scrollHeight; }, 30);
  }

  function updateOwnerReadStatus(lastReadId) {
    if (!lastReadId) return;
    const el = document.getElementById('caMessages');
    el?.querySelectorAll('.ca-msg-owner').forEach(row => {
      const id = Number(row.dataset.msgId || 0);
      if (id > 0 && id <= lastReadId) {
        const meta = row.querySelector('.ca-msg-meta');
        if (meta && !meta.querySelector('.ca-read')) {
          const span = document.createElement('span');
          span.className = 'ca-read';
          span.textContent = ' 既読';
          meta.appendChild(span);
        }
      }
    });
  }

  async function sendChatReply() {
    const text = document.getElementById('caReplyText').value.trim();
    if (!text || !chatCurrentSessionId) return;
    const cmid = generateUUID();
    document.getElementById('caReplyText').value = '';
    try {
      await chatApi('?action=owner-reply', {
        method: 'POST',
        body: JSON.stringify({ session_id: chatCurrentSessionId, body: text, client_msg_id: cmid }),
      });
      // 即座にポーリングして反映
      pollChatThread();
    } catch (e) { toast('送信失敗: ' + e.message, 'err'); }
  }

  // ========== チャット定型文 (localStorage 保存) ==========
  const CHAT_TPL_KEY = 'ylka_chat_templates';
  // 定型文で使える差し込みタグ: {お名前}=対応中の顧客名 / {スタンプカードURL}=その顧客専用の会員URL
  // ※ 文面を変えたら CHAT_TPL_STAMP_VER をバンプ（既存スタッフのd6も自動更新される）
  const CHAT_TPL_STAMP_VER = 2;
  const CHAT_TPL_STAMP_BODY = '本日はご利用いただき誠にありがとうございました\n\n{お名前}様専用のスタンプカードはこちらです。\nご利用ごとにスタンプが貯まり、特典もございます。\n{スタンプカードURL}\n\n次回のご予約も、こちらのリンクからこのチャットの続きで承ります。\nまたのご利用を心よりお待ちしております！';
  const CHAT_TPL_DEFAULTS = [
    { id: 'd1', title: 'ご挨拶', body: 'お問い合わせありがとうございます。YLKA（イルカ）でございます。' },
    { id: 'd2', title: '空き確認', body: 'ただいま空き状況を確認しております。少々お待ちくださいませ。' },
    { id: 'd3', title: '予約確定', body: 'ご予約を承りました。当日はどうぞよろしくお願いいたします。' },
    { id: 'd4', title: '到着連絡', body: 'まもなく到着いたします。お部屋番号をお教えいただけますでしょうか。' },
    { id: 'd5', title: 'お礼', body: '本日はご利用いただき誠にありがとうございました。またのご利用を心よりお待ちしております。' },
    { id: 'd6', title: 'お礼＋スタンプカード', body: CHAT_TPL_STAMP_BODY },
  ];
  // 「お礼＋スタンプカード」定型文を（未追加なら追加／文面更新があれば上書き）反映する
  function ensureStampTemplate() {
    try {
      const seededVer = parseInt(localStorage.getItem('ylka_chat_tpl_stamp_ver') || '0', 10);
      if (seededVer >= CHAT_TPL_STAMP_VER) return;
      const arr = loadChatTemplates();
      const idx = arr.findIndex(t => t.id === 'd6');
      if (idx >= 0) { arr[idx].title = 'お礼＋スタンプカード'; arr[idx].body = CHAT_TPL_STAMP_BODY; }
      else arr.push({ id: 'd6', title: 'お礼＋スタンプカード', body: CHAT_TPL_STAMP_BODY });
      saveChatTemplates(arr);
      localStorage.setItem('ylka_chat_tpl_stamp_ver', String(CHAT_TPL_STAMP_VER));
    } catch (_) {}
  }
  function loadChatTemplates() {
    try {
      const raw = localStorage.getItem(CHAT_TPL_KEY);
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
    } catch (_) {}
    return CHAT_TPL_DEFAULTS.slice();
  }
  function saveChatTemplates(arr) {
    try { localStorage.setItem(CHAT_TPL_KEY, JSON.stringify(arr)); } catch (_) {}
  }
  function renderChatTplPanel() {
    const panel = document.getElementById('caTplPanel');
    if (!panel) return;
    const tpls = loadChatTemplates();
    const items = tpls.length === 0
      ? '<div class="ca-tpl-empty">定型文がありません。「編集」から追加してください。</div>'
      : tpls.map(t => `
          <div class="ca-tpl-item" data-tpl-id="${escapeHtml(t.id)}">
            <div class="tpl-title">${escapeHtml(t.title || '(無題)')}</div>
            <div class="tpl-body">${escapeHtml(t.body || '')}</div>
          </div>`).join('');
    panel.innerHTML = `
      <div class="tpl-head"><b>定型文</b><button type="button" id="caTplEdit">✏️ 編集</button></div>
      ${items}`;
    panel.querySelectorAll('.ca-tpl-item').forEach(el => {
      el.addEventListener('click', () => {
        const t = loadChatTemplates().find(x => x.id === el.dataset.tplId);
        if (t) insertChatTemplate(t.body);
        toggleChatTplPanel(false);
      });
    });
    document.getElementById('caTplEdit')?.addEventListener('click', () => {
      toggleChatTplPanel(false);
      openChatTplModal();
    });
  }
  async function insertChatTemplate(text) {
    const ta = document.getElementById('caReplyText');
    if (!ta) return;
    let out = text;
    // 差し込みタグの置換（対応中チャットの顧客情報から）
    if (out.includes('{お名前}') || out.includes('{スタンプカードURL}')) {
      const sess = chatSessions.find(s => Number(s.id) === Number(chatCurrentSessionId));
      const custId = sess?.linked_customer_id;
      out = out.replace(/\{お名前\}/g, sess?.linked_customer_name || sess?.visitor_name || 'お客様');
      if (out.includes('{スタンプカードURL}')) {
        let url = '';
        if (custId) {
          try { const d = await apiPost('/customers.php?action=member-link', { id: Number(custId) }); url = d?.url || ''; } catch (e) {}
        }
        if (url) {
          out = out.replace(/\{スタンプカードURL\}/g, url);
        } else {
          // 顧客未紐付け or 取得失敗 → URLを含む行を丸ごと省く
          out = out.replace(/^.*\{スタンプカードURL\}.*\r?\n?/gm, '');
          toast(custId ? 'スタンプカードURLの取得に失敗しました' : 'このチャットは顧客未紐付けのためURLは挿入されません', 'err');
        }
      }
    }
    const cur = ta.value;
    ta.value = cur ? (cur.replace(/\s*$/, '') + '\n' + out) : out;
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  }
  function toggleChatTplPanel(show) {
    const panel = document.getElementById('caTplPanel');
    if (!panel) return;
    const willShow = show === undefined ? panel.style.display === 'none' : show;
    if (willShow) renderChatTplPanel();
    panel.style.display = willShow ? 'block' : 'none';
  }
  // 管理モーダル
  function renderChatTplEditList() {
    const wrap = document.getElementById('ctEditList');
    if (!wrap) return;
    const tpls = loadChatTemplates();
    wrap.innerHTML = tpls.length === 0
      ? '<div style="color:var(--ink-soft);font-size:.82rem;">未登録です</div>'
      : tpls.map(t => `
          <div style="display:flex;align-items:center;gap:.5rem;padding:.5rem .2rem;border-bottom:1px dashed var(--gray);">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:.84rem;color:var(--deep);">${escapeHtml(t.title || '(無題)')}</div>
              <div style="font-size:.76rem;color:var(--ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.body || '')}</div>
            </div>
            <button type="button" class="btn-secondary ct-edit" data-id="${escapeHtml(t.id)}" style="padding:.35rem .6rem;font-size:.76rem;">編集</button>
            <button type="button" class="btn-secondary ct-del" data-id="${escapeHtml(t.id)}" style="padding:.35rem .6rem;font-size:.76rem;color:var(--red);border-color:var(--red);">削除</button>
          </div>`).join('');
    wrap.querySelectorAll('.ct-edit').forEach(b => b.addEventListener('click', () => {
      const t = loadChatTemplates().find(x => x.id === b.dataset.id);
      if (!t) return;
      document.getElementById('ctEditId').value = t.id;
      document.getElementById('ctTitle').value = t.title || '';
      document.getElementById('ctBody').value = t.body || '';
      document.getElementById('ctSave').textContent = '💾 更新する';
    }));
    wrap.querySelectorAll('.ct-del').forEach(b => b.addEventListener('click', () => {
      if (!confirm('この定型文を削除しますか？')) return;
      saveChatTemplates(loadChatTemplates().filter(x => x.id !== b.dataset.id));
      renderChatTplEditList();
      resetChatTplForm();
    }));
  }
  function resetChatTplForm() {
    document.getElementById('ctEditId').value = '';
    document.getElementById('ctTitle').value = '';
    document.getElementById('ctBody').value = '';
    document.getElementById('ctSave').textContent = '＋ 追加する';
  }
  function openChatTplModal() {
    resetChatTplForm();
    renderChatTplEditList();
    openModal('chatTplModal');
  }

  function startChatInboxPolling() {
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = setInterval(() => {
      if (document.getElementById('view-chat')?.classList.contains('active')) {
        loadChatInboxSilent();
      } else {
        updateChatBadgeOnly();
      }
    }, 10000);
  }
  async function loadChatInboxSilent() {
    try {
      const d = await chatApi('?action=owner-inbox');
      chatSessions = d.sessions || [];
      renderChatInbox();
      updateChatBadge();
    } catch (e) {}
  }
  async function updateChatBadgeOnly() {
    try {
      const d = await chatApi('?action=owner-inbox');
      const unread = (d.sessions || []).reduce((a, s) => a + Number(s.unread_owner_count || 0), 0);
      const b = document.getElementById('chatUnreadBadge');
      if (b) { b.textContent = unread; b.style.display = unread > 0 ? 'inline-block' : 'none'; }
    } catch (e) {}
  }
  function updateChatBadge() {
    const unread = chatSessions.reduce((a, s) => a + Number(s.unread_owner_count || 0), 0);
    const b = document.getElementById('chatUnreadBadge');
    if (b) { b.textContent = unread; b.style.display = unread > 0 ? 'inline-block' : 'none'; }
  }

  function startChatThreadPolling() {
    if (chatThreadPollTimer) clearInterval(chatThreadPollTimer);
    chatThreadPollTimer = setInterval(pollChatThread, 4000);
  }
  async function pollChatThread() {
    if (!chatCurrentSessionId) return;
    try {
      const d = await chatApi(`?action=owner-messages&session_id=${chatCurrentSessionId}&since_id=${chatLastMsgId}`);
      if (d.messages?.length) {
        renderChatMessages(d.messages, true);
        await chatApi('?action=owner-mark-read', { method: 'POST', body: JSON.stringify({ session_id: chatCurrentSessionId }) });
      }
      updateOwnerReadStatus(d.last_read_owner_msg_id || 0);
    } catch (e) {}
  }

  async function toggleChatOnline() {
    const checked = document.getElementById('caOnlineToggle').checked;
    try {
      await chatApi('?action=update-settings', {
        method: 'POST',
        body: JSON.stringify({ is_online: checked ? 1 : 0 }),
      });
      chatSettings.is_online = checked ? 1 : 0;
      toast(checked ? '✓ オンラインになりました' : 'オフラインに切替', 'ok');
    } catch (e) { toast('更新失敗: ' + e.message, 'err'); }
  }

  function openChatSettingsModal() {
    document.getElementById('csWelcome').value = chatSettings.welcome_message || '';
    document.getElementById('csNotifyEmail').value = chatSettings.notify_email || '';
    document.getElementById('csReceptionStart').value = chatSettings.reception_start ? String(chatSettings.reception_start).substring(0, 5) : '';
    document.getElementById('csReceptionEnd').value = chatSettings.reception_end ? String(chatSettings.reception_end).substring(0, 5) : '';
    openModal('chatSettingsModal');
  }
  async function saveChatSettings() {
    const payload = {
      welcome_message: document.getElementById('csWelcome').value,
      notify_email: document.getElementById('csNotifyEmail').value,
      reception_start: document.getElementById('csReceptionStart').value || null,
      reception_end: document.getElementById('csReceptionEnd').value || null,
    };
    try {
      const d = await chatApi('?action=update-settings', { method: 'POST', body: JSON.stringify(payload) });
      chatSettings = { ...chatSettings, ...d.settings };
      closeModal('chatSettingsModal');
      toast('✓ 設定を保存しました', 'ok');
    } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
  }

  function formatChatTime(iso) {
    if (!iso) return '';
    const d = new Date(String(iso).replace(' ', 'T'));
    if (isNaN(d)) return '';
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
  }
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // チャットイベントバインド（init後）
  function bindChatEvents() {
    ensureStampTemplate();  // 「お礼＋スタンプカード」定型文を（未追加なら）一度だけ追加
    document.getElementById('caOnlineToggle')?.addEventListener('change', toggleChatOnline);
    document.getElementById('caSettings')?.addEventListener('click', openChatSettingsModal);
    document.getElementById('caPushBtn')?.addEventListener('click', toggleChatPush);
    document.getElementById('caReplySend')?.addEventListener('click', sendChatReply);
    document.getElementById('caReplyText')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendChatReply(); }
    });
    // 定型文: パネル開閉・外側クリックで閉じる・保存
    document.getElementById('caTplBtn')?.addEventListener('click', e => { e.stopPropagation(); toggleChatTplPanel(); });
    document.addEventListener('click', e => {
      const panel = document.getElementById('caTplPanel');
      if (!panel || panel.style.display === 'none') return;
      if (e.target.closest('#caTplPanel') || e.target.closest('#caTplBtn')) return;
      toggleChatTplPanel(false);
    });
    document.getElementById('ctSave')?.addEventListener('click', () => {
      const title = document.getElementById('ctTitle').value.trim();
      const body = document.getElementById('ctBody').value.trim();
      if (!body) { toast('本文を入力してください', 'err'); return; }
      const editId = document.getElementById('ctEditId').value;
      const tpls = loadChatTemplates();
      if (editId) {
        const t = tpls.find(x => x.id === editId);
        if (t) { t.title = title || '(無題)'; t.body = body; }
      } else {
        tpls.push({ id: 't' + Date.now().toString(36), title: title || '(無題)', body });
      }
      saveChatTemplates(tpls);
      renderChatTplEditList();
      resetChatTplForm();
      toast('✓ 定型文を保存しました', 'ok');
    });
    document.getElementById('csSaveSettings')?.addEventListener('click', saveChatSettings);
    // モバイル: スレッドから受信箱に戻る
    document.getElementById('caBackMobile')?.addEventListener('click', () => {
      document.querySelector('.chat-admin-grid')?.classList.remove('show-thread');
      chatCurrentSessionId = null;
      // メッセージビューはクリアしておく
      const el = document.getElementById('caMessages');
      if (el) el.innerHTML = '';
      document.getElementById('caReply').style.display = 'none';
      document.getElementById('caThreadTitle').textContent = 'セッションを選択してください';
    });
  }

  // --- Init ---
  // アプリ更新検知: ロード中HTMLの版数(window.__APP_VERSION__)とサーバ最新版(/version.json)を照合。
  // 古い版を掴んでいたら（iOSホーム画面アプリ/PWAのキャッシュ対策）URLに ?_v= を付けて強制リロード。
  async function checkAppVersion() {
    try {
      const current = String(window.__APP_VERSION__ || '');
      if (!current) return false;
      const res = await fetch('/ctrl/ops/version.php?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return false;
      const data = await res.json();
      const latest = String((data && data.v) || '');
      if (!latest || latest === current) return false; // 最新を読み込めている
      // 古いHTMLを掴んでいる → 1回だけ強制リロード（無限ループ防止に sessionStorage ガード）
      const guard = 'app_reloaded_' + latest;
      if (sessionStorage.getItem(guard)) { showUpdateNotice(); return false; }
      sessionStorage.setItem(guard, '1');
      location.replace(location.pathname + '?_v=' + encodeURIComponent(latest) + (location.hash || ''));
      return true; // リロード中（以降の init を中断）
    } catch (e) { return false; }
  }
  function showUpdateNotice() {
    if (document.getElementById('appUpdateNotice')) return;
    const bar = document.createElement('div');
    bar.id = 'appUpdateNotice';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#c0392b;color:#fff;padding:.8rem 1rem;text-align:center;font-weight:700;font-size:.9rem;box-shadow:0 -2px 10px rgba(0,0,0,.25);';
    bar.textContent = '⚠ 新しいバージョンがあります。アプリを一度削除して再追加してください。';
    document.body.appendChild(bar);
  }

  async function init() {
    if (await checkAppVersion()) return; // 古い版ならリロードして以降を中断
    try {
      const auth = await fetch(API + '/auth.php?action=check', { credentials: 'include' }).then(r => r.json());
      if (!auth.logged_in) {
        location.href = location.pathname.replace(/\/dashboard\/?$/, '/');
        return;
      }
      currentUser = { id: auth.id || 0, email: auth.email, role: auth.role, display_name: auth.display_name };
      document.getElementById('userEmail').textContent = auth.display_name || auth.email;
      if (auth.role === 'owner') document.body.classList.add('is-owner');
      // currentUser.id を admin-users から取得
      if (auth.role === 'owner') {
        try {
          const ud = await api('/admin-api.php?action=admin-users');
          const me = (ud.users || []).find(u => u.username === auth.email);
          if (me) currentUser.id = me.id;
        } catch (e) {}
      }
    } catch (e) {
      location.href = location.pathname.replace(/\/dashboard\/?$/, '/');
      return;
    }

    // クレジット手数料率を取得（報酬計算のキャスト負担分に使用）
    try {
      const cf = await api('/admin-api.php?action=card-fee-get');
      if (cf && cf.card_fee_rate != null) CARD_FEE_RATE = parseFloat(cf.card_fee_rate) || CARD_FEE_RATE;
    } catch (e) {}
    // 指名料（初指名/本指名/フリーの固定額）を取得（予約合計への加算・フッターサマリー内訳に使用）
    try {
      const nf = await api('/admin-api.php?action=nomination-fees-get');
      if (nf && nf.nomination_fees) Object.assign(NOMINATION_FEES, nf.nomination_fees);
    } catch (e) {}

    // 権限取得 → タブ表示制御
    await loadPermissions();
    applyTabVisibility();

    // キャスト(staff)は専用マイページに自動分岐
    if (currentUser?.role === 'staff') switchView('therapist');
    // 店長(manager)はログイン直後に入口画面（マネージャー管理 / キャスト管理 の2択）
    if (currentUser?.role === 'manager') showManagerEntry();
    updateModeSwitch();

    // 支払方法ボタン（予約モーダル / クローン両対応）
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-pay-btn]');
      if (!btn) return;
      const group = btn.parentElement;
      group.querySelectorAll('[data-pay-btn]').forEach(b => b.classList.toggle('active', b === btn));
      const modal = btn.closest('.modal-overlay');
      const hidden = modal ? modal.querySelector('[data-pay-hidden]') : null;
      if (hidden) hidden.value = btn.dataset.pay;
    });

    // PWA でアプリ起動時にバッジクリア (通知をタップしなかった場合の対応)
    if (typeof clearChatAppBadge === 'function') clearChatAppBadge();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && typeof clearChatAppBadge === 'function') clearChatAppBadge();
    });

    await Promise.all([loadStats(), loadCities(), loadHotels()]);

    document.getElementById('btnLogout').addEventListener('click', async () => {
      // ops は CTRL のログインを使うので、ログアウトも CTRL 側で行う
      let to = '/ctrl/logout.php';
      try {
        const r = await fetch(API + '/auth.php?action=logout', { method: 'POST', credentials: 'include' }).then(r => r.json());
        if (r && r.redirect) to = r.redirect;
      } catch (e) {}
      location.href = to;
    });

    let filterTimer;
    document.getElementById('fCity').addEventListener('change', loadHotels);
    document.getElementById('fStatus').addEventListener('change', loadHotels);
    document.getElementById('fKeyword').addEventListener('input', () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(loadHotels, 280);
    });
    document.getElementById('btnReset').addEventListener('click', () => {
      document.getElementById('fCity').value = '';
      document.getElementById('fStatus').value = '';
      document.getElementById('fKeyword').value = '';
      loadHotels();
    });

    document.getElementById('hotelList').addEventListener('click', e => {
      // ステータスボタン
      const sbtn = e.target.closest('[data-set-status]');
      if (sbtn) {
        e.preventDefault();
        setStatus(Number(sbtn.dataset.id), sbtn.dataset.status);
        return;
      }
      const editBtn = e.target.closest('[data-action="edit"]');
      if (editBtn) {
        const h = allHotels.find(x => x.id === Number(editBtn.dataset.id));
        if (h) openEdit(h);
        return;
      }
      const delBtn = e.target.closest('[data-action="delete"]');
      if (delBtn) {
        const h = allHotels.find(x => x.id === Number(delBtn.dataset.id));
        if (h) deleteHotels([h.id], `「${h.name}」`);
      }
    });
    document.getElementById('hotelList').addEventListener('change', e => {
      if (e.target.classList.contains('rowSelect')) {
        const id = Number(e.target.dataset.id);
        if (e.target.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        const row = e.target.closest('.hotel-row');
        if (row) row.classList.toggle('selected', e.target.checked);
        updateBulkBar();
        document.getElementById('filterNote').textContent = selectedIds.size > 0 ? `（${selectedIds.size}件選択中）` : '';
      }
    });

    // 一括操作バー
    document.querySelectorAll('[data-bulk]').forEach(btn => {
      btn.addEventListener('click', () => bulkSetStatus(btn.dataset.bulk));
    });
    document.getElementById('btnBulkDelete')?.addEventListener('click', () => {
      deleteHotels(Array.from(selectedIds), `選択中の${selectedIds.size}件`);
    });
    document.getElementById('btnHotelAdd')?.addEventListener('click', () => openEdit(null));
    document.getElementById('btnBulkClear').addEventListener('click', () => {
      selectedIds.clear();
      document.querySelectorAll('.rowSelect').forEach(cb => cb.checked = false);
      document.querySelectorAll('.hotel-row.selected').forEach(r => r.classList.remove('selected'));
      updateBulkBar();
      document.getElementById('filterNote').textContent = '';
    });

    // モーダル
    document.getElementById('emClose').addEventListener('click', closeEdit);
    document.getElementById('emCancel').addEventListener('click', closeEdit);
    document.getElementById('emSave').addEventListener('click', saveEdit);
    document.getElementById('editModal').addEventListener('click', e => {
      if (e.target.id === 'editModal') closeEdit();
    });
    document.getElementById('emStatus').addEventListener('click', e => {
      const sbtn = e.target.closest('.sbtn');
      if (!sbtn) return;
      editingStatus = sbtn.dataset.status || '';
      document.querySelectorAll('#emStatus .sbtn').forEach(b => {
        b.classList.toggle('active', (b.dataset.status || '') === editingStatus);
      });
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.getElementById('editModal').classList.contains('show')) closeEdit();
    });

    // タブ切替
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // 店長: 入口カード / 名前プルダウン（マネージャー管理 ⇔ キャスト管理）
    document.querySelectorAll('#view-entry [data-mode], #userDropdown [data-mode]').forEach(btn => {
      btn.addEventListener('click', () => setManagerMode(btn.dataset.mode));
    });
    // 名前プルダウンの開閉（店長のみ has-modes）
    const userNameBtn = document.getElementById('userNameBtn');
    if (userNameBtn) userNameBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleUserMenu(); });
    // 外側クリックで閉じる
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('userMenu');
      if (menu && menu.classList.contains('open') && !e.target.closest('#userMenu')) menu.classList.remove('open');
    });

    // スタッフ追加モーダルを開く共通処理。lockStaff=true なら role=staff 固定＋権限選択を隠す
    function openCreateStaff(lockStaff) {
      document.getElementById('csName').value = '';
      document.getElementById('csEmail').value = '';
      document.getElementById('csPassword').value = '';
      { const cd = document.getElementById('csCanDrive'); if (cd) cd.checked = false; }
      { const it = document.getElementById('csIsTherapist'); if (it) it.checked = false; }
      { const io = document.getElementById('csIsOffice'); if (io) io.checked = false; }
      const csRate = document.getElementById('csRate'); if (csRate) csRate.value = 50;
      createRole = 'staff';
      document.querySelectorAll('[data-role-btn]').forEach(b => b.classList.toggle('active', b.dataset.role === 'staff'));
      const roleField = document.getElementById('csRoleField');
      if (roleField) roleField.style.display = lockStaff ? 'none' : '';
      const title = document.getElementById('csTitle');
      if (title) title.textContent = lockStaff ? 'キャストを追加' : 'スタッフを追加';
      openModal('createStaffModal');
    }
    // スタッフ管理ボタン（運営側 = 権限選択あり）
    document.getElementById('btnAddStaff').addEventListener('click', () => openCreateStaff(false));
    // キャストの登録は CTRL の /ctrl/girls.php が正。ここでは取り込み直しだけ行う
    document.getElementById('btnSyncCasts')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = '取り込み中…';
      try {
        const r = await api('/admin-api.php?action=sync-casts', { method: 'POST' });
        toast(`キャストを取り込みました（新規 ${r.added} / 更新 ${r.updated} / 非表示 ${r.hidden}）`);
        adminUsersAll = [];       // キャッシュを空にして次回再取得させる
        await loadStaffBoard();
      } catch (err) {
        toast('取り込みに失敗しました: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });
    document.querySelectorAll('[data-role-btn]').forEach(b => {
      b.addEventListener('click', () => {
        createRole = b.dataset.role;
        document.querySelectorAll('[data-role-btn]').forEach(b2 => b2.classList.toggle('active', b2.dataset.role === createRole));
      });
    });
    document.getElementById('csGenPw').addEventListener('click', () => {
      document.getElementById('csPassword').value = genPw();
    });
    document.getElementById('csSave').addEventListener('click', createStaff);
    document.getElementById('rpGenPw').addEventListener('click', () => {
      document.getElementById('rpPassword').value = genPw();
    });
    document.getElementById('rpSave').addEventListener('click', resetPassword);

    // モーダル close
    document.querySelectorAll('[data-close]').forEach(b => {
      b.addEventListener('click', () => closeModal(b.dataset.close));
    });
    // 通常モーダル (.transparent でない) は外クリックで閉じる
    document.querySelectorAll('.modal-overlay:not(.transparent)').forEach(m => {
      m.addEventListener('click', e => { if (e.target === m) m.classList.remove('show'); });
    });

    // ============ 最小化機能（フッターチップに退避） ============
    // ＿ ボタンクリック
    document.addEventListener('click', e => {
      const minBtn = e.target.closest('[data-minimize]');
      if (minBtn) {
        e.preventDefault();
        minimizeModal(minBtn.dataset.minimize);
        return;
      }
      // 透過モーダルの「外クリック」を document レベルで検出
      // overlay は pointer-events:none なので、modal の外をクリックすると背景要素にイベントが行く
      // 透過モーダルが開いていて、クリック先が .modal の内部でない場合は最小化
      const openTransparent = document.querySelectorAll('.modal-overlay.transparent.show:not(.minimized)');
      if (openTransparent.length === 0) return;
      // ＿ ボタンや × はすでに上で処理済みなのでスルー
      if (e.target.closest('.modal')) return;
      if (e.target.closest('.min-card')) return;
      // タイムライン領域なら最小化のみ（モーダルを邪魔にしない）
      openTransparent.forEach(m => minimizeModal(m.id));
    }, true);

    function minimizeModal(modalId) {
      const modal = document.getElementById(modalId);
      if (!modal || !modal.classList.contains('show')) return;
      modal.classList.add('minimized');
      // ヘッダーからタイトルを抜き出してチップ表示
      const titleEl = modal.querySelector('.mh-title');
      const baseTitle = titleEl ? titleEl.textContent.trim() : '予約';
      // 予約モーダルの場合、入力中の顧客名を優先表示
      let label = baseTitle;
      const isBooking = modalId.startsWith('bookingModal');
      if (isBooking) {
        const suffix = modalId === 'bookingModal-2' ? '-2' : '';
        const nameEl = document.getElementById('bmCustomerName' + suffix);
        const customerName = nameEl?.value?.trim() || '';
        if (customerName) {
          // 「みやと さん（①）」のように名前 + 番号
          const numMatch = baseTitle.match(/[（(](①|②)[）)]/);
          label = customerName + ' さん' + (numMatch ? ' ' + numMatch[0] : '');
        }
      }
      const dock = document.getElementById('minDock');
      if (!dock) return;
      // 既存チップを削除（同じモーダルは1つだけ）
      const existing = dock.querySelector(`[data-restore="${modalId}"]`);
      if (existing) existing.remove();
      const card = document.createElement('div');
      card.className = 'min-card';
      card.dataset.restore = modalId;
      card.innerHTML = `
        <span class="mc-label">予約</span>
        <span class="mc-name">${escapeHtml(label)}</span>
        <button class="mc-close" type="button" data-min-close="${modalId}" aria-label="閉じる">✕</button>
      `;
      card.addEventListener('click', ev => {
        if (ev.target.closest('[data-min-close]')) {
          ev.stopPropagation();
          closeMinimized(modalId);
          return;
        }
        restoreModal(modalId);
      });
      dock.appendChild(card);
    }

    function restoreModal(modalId) {
      const modal = document.getElementById(modalId);
      if (!modal) return;
      modal.classList.remove('minimized');
      // チップ削除
      const dock = document.getElementById('minDock');
      const chip = dock?.querySelector(`[data-restore="${modalId}"]`);
      if (chip) chip.remove();
    }

    function closeMinimized(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.classList.remove('show','minimized');
      const dock = document.getElementById('minDock');
      const chip = dock?.querySelector(`[data-restore="${modalId}"]`);
      if (chip) chip.remove();
    }
    // close → 通常閉じる時はチップも消す
    const origCloseModal = window.closeModal;
    window.closeModal = function(id) {
      const dock = document.getElementById('minDock');
      const chip = dock?.querySelector(`[data-restore="${id}"]`);
      if (chip) chip.remove();
      if (typeof origCloseModal === 'function') return origCloseModal(id);
      const m = document.getElementById(id);
      if (m) m.classList.remove('show','minimized');
    };
    function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    // スタッフ操作（スタッフ管理 / キャスト管理 共通）
    function handleStaffRowClick(e) {
      const btn = e.target.closest('button[data-action]');
      if (!btn || btn.disabled) return;
      if (btn.dataset.action === 'reset-pw') {
        resetPwUserId = Number(btn.dataset.id);
        document.getElementById('rpTarget').textContent = btn.dataset.name;
        document.getElementById('rpPassword').value = genPw();
        openModal('resetPwModal');
      } else if (btn.dataset.action === 'delete-user') {
        deleteUser(btn.dataset.id, btn.dataset.name);
      } else if (btn.dataset.action === 'edit-user') {
        openEditStaffModal(Number(btn.dataset.id));
      } else if (btn.dataset.action === 'driver-detail') {
        openDriverModal(Number(btn.dataset.id));
      }
    }
    document.getElementById('staffTable').addEventListener('click', handleStaffRowClick);
    document.getElementById('staffBoard')?.addEventListener('click', handleStaffRowClick);

    // スタッフ編集モーダル
    document.querySelectorAll('[data-es-role]').forEach(b => {
      b.addEventListener('click', () => {
        if (b.disabled) return;
        editingStaffRole = b.dataset.esRole;
        document.querySelectorAll('[data-es-role]').forEach(x => x.classList.toggle('active', x.dataset.esRole === editingStaffRole));
      });
    });
    document.getElementById('esThumbFile').addEventListener('change', async e => {
      const f = e.target.files?.[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { toast('画像は5MB以下', 'err'); return; }
      try {
        editingThumbData = await resizeImage(f, 512);
        document.getElementById('esThumbPreview').innerHTML = `<img src="${escapeAttr(editingThumbData)}" style="width:100%;height:100%;object-fit:cover;">`;
      } catch (err) { toast('画像読み込み失敗', 'err'); }
    });
    document.getElementById('esThumbRemove').addEventListener('click', () => {
      editingThumbData = null;
      document.getElementById('esThumbPreview').innerHTML = 'なし';
      document.getElementById('esThumbFile').value = '';
    });
    document.getElementById('esSave').addEventListener('click', saveStaffEdit);

    // ========== Timeline / Bookings / Customers / Shifts events ==========
    document.getElementById('tlPrev').addEventListener('click', () => { tlCurrentDate = addDays(tlCurrentDate, -1); loadTimeline(); });
    document.getElementById('tlToday').addEventListener('click', () => { tlCurrentDate = getBusinessDayDate(); loadTimeline(); });
    document.getElementById('tlNext').addEventListener('click', () => { tlCurrentDate = addDays(tlCurrentDate, 1); loadTimeline(); });
    document.getElementById('tlDatePicker').addEventListener('change', e => {
      const [y,m,d] = e.target.value.split('-').map(Number);
      tlCurrentDate = new Date(y, m-1, d); loadTimeline();
    });
    document.getElementById('tlAddBooking').addEventListener('click', () => openBookingForAdd({ date: tlPrefillDate() }));
    const tlCashSummaryBtn = document.getElementById('tlCashSummary');
    if (tlCashSummaryBtn) tlCashSummaryBtn.addEventListener('click', () => openCashSummaryModal());

    // クイック電話入力 → 予約モーダル起動（①=primary、②=secondary 2件同時可能）
    function quickPhoneStart(num) {
      const inputId = num === 1 ? 'pq1' : 'pq2';
      const phone = document.getElementById(inputId).value.trim();
      if (!phone) { toast('電話番号を入力してください', 'err'); return; }
      if (num === 2) ensureSecondaryModal();
      const suffix = num === 2 ? '-2' : '';
      withBmSuffix(suffix, () => openBookingModal(null, { date: tlPrefillDate(), phone }));
      document.getElementById(inputId).value = '';
    }
    document.querySelectorAll('[data-pq]').forEach(btn => {
      btn.addEventListener('click', () => quickPhoneStart(Number(btn.dataset.pq)));
    });
    ['pq1', 'pq2'].forEach((id, idx) => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); quickPhoneStart(idx + 1); }
      });
    });

    // Bookings
    document.getElementById('bkAddNew').addEventListener('click', () => openBookingForAdd({ date: fmtDate(getBusinessDayDate()) }));
    document.getElementById('bkFilterStatus').addEventListener('change', loadBookings);
    let bkTimer;
    document.getElementById('bkKeyword').addEventListener('input', () => { clearTimeout(bkTimer); bkTimer = setTimeout(loadBookings, 300); });
    bel('bmSave').addEventListener('click', saveBooking);
    bel('bmDelete').addEventListener('click', deleteBooking);
    bel('bmCustomerPhone').addEventListener('blur', lookupCustomerByPhone);
    // オーダー詳細モーダル: 接客完了ボタン
    const odComp = document.getElementById('odComplete');
    if (odComp) odComp.addEventListener('click', markOrderCompleted);
    const odSaveNote = document.getElementById('odSaveNote');
    if (odSaveNote) odSaveNote.addEventListener('click', saveOrderNote);
    // カウンセリングシートアップロード
    const odSheetBtn  = document.getElementById('odSheetUploadBtn');
    const odSheetFile = document.getElementById('odSheetFile');
    const odSheetSave = document.getElementById('odSheetSave');
    odSheetBtn?.addEventListener('click', () => odSheetFile?.click());
    odSheetFile?.addEventListener('change', () => {
      const f = odSheetFile.files[0];
      const nameEl = document.getElementById('odSheetFileName');
      if (nameEl) nameEl.textContent = f ? f.name : '未選択';
      if (odSheetSave) odSheetSave.style.display = f ? '' : 'none';
    });
    odSheetSave?.addEventListener('click', uploadCounselingSheet);
    // テキストコピーボタン
    const bmCopy = document.getElementById('bmCopyText');
    if (bmCopy) bmCopy.addEventListener('click', copyBookingFormAsText);
    const bmCopyCust = document.getElementById('bmCopyCustomerText');
    if (bmCopyCust) bmCopyCust.addEventListener('click', copyCustomerBookingText);
    const odCopy = document.getElementById('odCopyText');
    if (odCopy) odCopy.addEventListener('click', copyOrderDetailAsText);
    // 休憩モードトグル
    const bmBreak = document.getElementById('bmBreakMode');
    if (bmBreak) bmBreak.addEventListener('change', e => setBreakMode(e.target.checked));

    // Customers
    document.getElementById('cuAddNew').addEventListener('click', () => openCustomerModal(null));
    let cuTimer;
    document.getElementById('cuKeyword').addEventListener('input', () => { clearTimeout(cuTimer); cuTimer = setTimeout(loadCustomers, 300); });
    document.getElementById('cuSort')?.addEventListener('change', loadCustomers);
    document.getElementById('cmSave').addEventListener('click', saveCustomer);
    document.getElementById('cmDelete').addEventListener('click', deleteCustomer);
    document.getElementById('cmMemberBtn')?.addEventListener('click', async () => {
      if (!editingCustomerId) return;
      try {
        const d = await apiPost('/customers.php?action=member-link', { id: editingCustomerId });
        showMemberUrl(d.url);
        const ok = await copyTextToClipboard(d.url);
        toast(ok ? '✓ 会員証URLを発行・コピーしました（LINE等で送れます）' : '発行しました（コピーは📋ボタンから）', ok ? 'ok' : 'err');
      } catch (e) { toast('発行失敗: ' + e.message, 'err'); }
    });
    document.getElementById('cmMemberCopy')?.addEventListener('click', async () => {
      const url = document.getElementById('cmMemberUrl')?.value;
      if (!url) return;
      const ok = await copyTextToClipboard(url);
      toast(ok ? '✓ 会員証URLをコピーしました' : 'コピー失敗', ok ? 'ok' : 'err');
    });
    // 誓約書アップロード (カメラ撮影 / ファイル選択)
    ['cmPledgeCam', 'cmPledgeFile'].forEach(id => {
      const inp = document.getElementById(id);
      if (inp) inp.addEventListener('change', async e => {
        const file = e.target.files && e.target.files[0];
        if (file) await handlePledgeUpload(file);
        e.target.value = '';  // 同じファイル再選択を許可
      });
    });

    // Shifts (タイムテーブル=10日窓 / カレンダー=月)
    document.getElementById('shPrev').addEventListener('click', () => {
      if (shViewMode === 'timetable') shCurrent = addDays(shCurrent, -10);
      else shCurrent = new Date(shCurrent.getFullYear(), shCurrent.getMonth()-1, 1);
      loadShifts();
    });
    document.getElementById('shToday').addEventListener('click', () => {
      shCurrent = shViewMode === 'timetable' ? getBusinessDayDate() : new Date();
      loadShifts();
    });
    document.getElementById('shNext').addEventListener('click', () => {
      if (shViewMode === 'timetable') shCurrent = addDays(shCurrent, 10);
      else shCurrent = new Date(shCurrent.getFullYear(), shCurrent.getMonth()+1, 1);
      loadShifts();
    });
    document.getElementById('shStaffFilter').addEventListener('change', e => { shSelectedStaff = e.target.value; loadShifts(); });
    // ビュー切替トグル (タイムテーブル ↔ カレンダー)
    document.getElementById('shModeTimetable').addEventListener('click', () => setShiftViewMode('timetable'));
    document.getElementById('shModeCalendar').addEventListener('click', () => setShiftViewMode('calendar'));
    document.getElementById('smSave').addEventListener('click', saveShift);
    document.getElementById('smDelete').addEventListener('click', deleteShift);
    // 24時間チェック: ON で 10:00〜翌10:00 固定、入力欄をdisable
    const sm24el = document.getElementById('sm24h');
    if (sm24el) {
      sm24el.addEventListener('change', e => {
        const checked = e.target.checked;
        const startEl = document.getElementById('smStart');
        const endEl = document.getElementById('smEnd');
        if (checked) {
          startEl.value = '10:00';
          endEl.value = '10:00';
        }
        startEl.disabled = checked;
        endEl.disabled = checked;
      });
    }

    // ========== コース管理イベント ==========
    document.getElementById('coAddNew').addEventListener('click', () => openCourseModal(null));
    document.getElementById('coSave').addEventListener('click', saveCourse);
    document.getElementById('coDelete').addEventListener('click', deleteCourse);
    // ホテル管理（マスタ内から開く）
    document.getElementById('openHotelMgr')?.addEventListener('click', () => switchView('hotel'));
    document.getElementById('hotelBackToMaster')?.addEventListener('click', () => switchView('courses'));
    document.getElementById('openStationMgr')?.addEventListener('click', () => switchView('stations'));
    document.getElementById('stationBackToMaster')?.addEventListener('click', () => switchView('courses'));
    // 入室方法マスタ
    document.getElementById('emaAddNew')?.addEventListener('click', () => openEntryMethodModal(null));
    document.getElementById('emaSave')?.addEventListener('click', saveEntryMethod);
    document.getElementById('emaDelete')?.addEventListener('click', deleteEntryMethod);
    // 駅マスタ
    document.getElementById('stSave')?.addEventListener('click', saveStation);

    // ========== 権限管理イベント ==========
    const permSaveBtn = document.getElementById('permSave');
    if (permSaveBtn) permSaveBtn.addEventListener('click', savePermissions);

    // 開始時刻 select 構築 (0〜23 時、カレンダー日基準)
    const shSel = bel('bmStartHour');
    let optHtml = '';
    for (let h = 0; h < 24; h++) {
      optHtml += `<option value="${h}">${('0'+h).slice(-2)}</option>`;
    }
    shSel.innerHTML = optHtml;
    // 分 select 構築 (0〜59 分)
    const smSel = bel('bmStartMin');
    let minHtml = '';
    for (let m = 0; m < 60; m++) {
      minHtml += `<option value="${m}">${('0'+m).slice(-2)}</option>`;
    }
    smSel.innerHTML = minHtml;

    // 予約モーダル: 入力変更ごとにフッターの予約内容サマリーを更新（要素個別リスナーの後に発火するようバブリングで拾う）
    const bmBodyEl = document.querySelector('#bookingModal .modal-body');
    if (bmBodyEl) ['input', 'change'].forEach(ev => bmBodyEl.addEventListener(ev, () => { try { updateFooterStatus(); } catch (e) {} }));
    // リピーター履歴バーの開閉
    bel('bmHistoryToggle')?.addEventListener('click', toggleHistoryPanel);
    // 予約モーダル: 時刻/コース/休憩時間 変更時に終了時刻再計算
    bel('bmStartHour').addEventListener('change', () => { updateEndTime(); autoToggleLateNight(); });
    bel('bmStartMin').addEventListener('change', () => { updateEndTime(); autoToggleLateNight(); });
    bel('bmCourse').addEventListener('change', () => {
      const sel = bel('bmCourse');
      updateEndTime();
      const opt = sel.selectedOptions[0];
      const price = opt && opt.dataset.price;
      if (price) {
        // コース選択時はベース料金 (=コース料金) を入れて合計を再計算
        setMoney('bmPrice', price);
        autoToggleLateNight();
        updateBookingTotal();
      }
    });
    // 媒体・予約経路: LINE予約で +10分 になるので終了時刻を再計算
    mediaCheckboxes().forEach(cb => cb.addEventListener('change', updateEndTime));
    // 延長回数: 終了時刻と合計を再計算
    const extSel = bel('bmExtCount');
    if (extSel) extSel.addEventListener('change', () => { updateEndTime(); updateBookingTotal(); });
    // 深夜料金チェック: 合計表示を更新 (bmPrice はコース料金のまま、保存時に合算)
    const lateCb = bel('bmLateNight');
    if (lateCb) lateCb.addEventListener('change', updateBookingTotal);
    // キャンペーン割引チェック: 合計を再計算
    const campCb = bel('bmCampaign');
    if (campCb) campCb.addEventListener('change', updateBookingTotal);
    // スタンプ特典: 合計を再計算
    const stampSel = bel('bmStampReward');
    if (stampSel) stampSel.addEventListener('change', updateBookingTotal);
    // 指名方法: 指名料を合計へ反映
    const nomSel = bel('bmNomination');
    if (nomSel) nomSel.addEventListener('change', updateBookingTotal);
    // 料金の手入力・出張費の選択で合計再計算
    bel('bmPrice').addEventListener('input', updateBookingTotal);
    bel('bmTransport').addEventListener('change', updateBookingTotal);
    bel('bmDepositOverride')?.addEventListener('input', updateBookingTotal);
    // 休憩時間 select 変更
    const bdSel = bel('bmBreakDur');
    if (bdSel) bdSel.addEventListener('change', () => {
      const isCustom = bdSel.value === 'custom';
      const wrap = bel('bmBreakCustomMinWrap');
      if (wrap) wrap.style.display = isCustom ? 'block' : 'none';
      updateEndTime();
    });
    const bdCustom = bel('bmBreakCustomMin');
    if (bdCustom) bdCustom.addEventListener('input', updateEndTime);

    // 訪問先タイプ切替
    document.querySelectorAll('input[name="bmLocType"]').forEach(r => {
      r.addEventListener('change', () => switchLocSection(r.value));
    });
    // 市区町村のエリア切替 → 市区町村を組み直す
    document.querySelectorAll('input[name="bmCityRegion"]').forEach(r => {
      r.addEventListener('change', () => { populateCitySelect(r.value); populateHotelSelect(bel('bmCity').value); });
    });
    // 市区町村変更 → ホテル絞り込み
    bel('bmCity').addEventListener('change', e => populateHotelSelect(e.target.value));
    // ホテル変更 → そのホテルの交通費を初期値に入れる
    bel('bmHotelId')?.addEventListener('change', e => applyHotelTransportFee(e.target.value));
    // ステータス変更 → キャンセル理由欄の表示制御＋合計注記更新
    bel('bmStatus').addEventListener('change', e => {
      bel('bmCancelWrap').style.display = e.target.value === 'cancelled' ? 'block' : 'none';
      updateBookingTotal();
    });
    // 担当キャスト選択 → 問合せ状態なら自動で「予約」へ（キャストが決まった＝実予約成立）
    bel('bmAdminId').addEventListener('change', e => { autoStatusOnAssign(); renderCastAlert(); });
    // 日付を変えたら、その日の出勤キャストで担当プルダウンを組み直す
    bel('bmDate')?.addEventListener('change', e => populateCastSelect(e.target.value, bel('bmAdminId').value));
    // キャンセル理由/料金 変更 → 合計注記（計上額）を更新
    bel('bmCancelType')?.addEventListener('change', updateBookingTotal);
    bel('bmCancelFee')?.addEventListener('input', updateBookingTotal);

    // ドラッグ可能モーダルのセットアップ
    setupDraggableModals();

    // タイムラインのスタッフ列「売上」クリック → 保有者モーダル（document 委譲・1回のみ）
    document.addEventListener('click', (e) => {
      if (!e.target.closest) return;
      // サムネイルクリックでキャスト編集（注意事項をその場で確認・追記できるように）
      const ce = e.target.closest('[data-cast-edit]');
      if (ce && ['owner', 'manager'].includes(currentUser?.role)) {
        openEditStaffModal(Number(ce.dataset.castEdit));
        return;
      }
      const sb = e.target.closest('.tl-staff-sales[data-admin]');
      if (sb) { openHolderModal(Number(sb.dataset.admin)); return; }
      const rb = e.target.closest('.tl-staff-reward[data-admin]');
      if (rb) { openRewardModal(Number(rb.dataset.admin)); return; }
      const hb = e.target.closest('.tl-staff-held[data-admin]');
      if (hb) { openHeldChainModal(Number(hb.dataset.admin)); return; }
      const ab = e.target.closest('.tl-att-btn[data-admin]');
      if (ab) setStaffAttendance(Number(ab.dataset.admin), ab.dataset.att);
    });
    document.addEventListener('change', (e) => {
      if (!e.target || !e.target.closest) return;
      const sel = e.target.closest('.tl-att-sel[data-admin]');
      if (sel) setStaffAttendance(Number(sel.getAttribute('data-admin')), sel.value);
    });

    // コースを起動時に1回読み込んでおく（予約モーダル即応のため）
    ensureCoursesLoaded();
    // 入室方法マスタを起動時にロード（select の選択肢で必要）
    loadEntryMethods();

    // チャット管理イベントバインド (owner のみ実質的に使う)
    bindChatEvents();

    // 初期表示: タイムライン（店長は入口画面に着地するので自動ロードしない）
    if (currentUser?.role !== 'manager') loadTimeline();

    // バックグラウンドで未読バッジ更新 (owner のみ)
    if (currentUser?.role === 'owner') {
      updateChatBadgeOnly();
      setInterval(updateChatBadgeOnly, 30000);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
