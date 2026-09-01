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
  let _tlPrevScroll = null;    // タイムライン: 操作後に復元するスクロール位置 {left, top}
  let _tlSyncVer = null;       // タイムライン: 他PCの変更を検知する軽量バージョン（件数＋最終更新時刻）
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
    try { syncCardUi(); } catch (_) { /* 初期化前に呼ばれた場合 */ }
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

  /**
   * 時のプルダウン。並びは営業日と同じ 10時 → 23時 → 0時 → 9時（店長指定 2026-08-08）。
   * value はこれまでどおり 0〜23 の実時刻なので、保存や計算側は何も変わらない
   */
  function bizHourOptions() {
    let html = '';
    for (let i = 0; i < 24; i++) {
      const h = (10 + i) % 24;
      html += `<option value="${h}">${h}</option>`;   // 時は先頭の0なし（6:00・店長指定 2026-08-16）
    }
    return html;
  }

  /** シフトの開始/終了は時select+分select（分は15分刻み）。値は "HH:MM" でやり取りする */
  function smTimeGet(pfx) {
    const h = document.getElementById(pfx + 'H'), m = document.getElementById(pfx + 'M');
    if (!h || !m) return '';
    if (h.value === '') return '';                       // 「--」＝未選択
    return ('0' + (parseInt(h.value, 10) || 0)).slice(-2) + ':' + ('0' + (parseInt(m.value, 10) || 0)).slice(-2);
  }
  function smTimeSet(pfx, hhmm) {
    const h = document.getElementById(pfx + 'H'), m = document.getElementById(pfx + 'M');
    if (!h || !m) return;
    if (!hhmm) { h.value = ''; m.value = ''; return; }    // 空＝「--」に戻す
    const parts = String(hhmm || '').split(':');
    h.value = String(parseInt(parts[0], 10) || 0);
    let mi = parseInt(parts[1], 10) || 0;
    mi = Math.round(mi / 15) * 15; if (mi >= 60) mi = 45;   // 15分刻みに丸める
    m.value = String(mi);
  }
  function smTimeSetDisabled(pfx, dis) {
    const h = document.getElementById(pfx + 'H'), m = document.getElementById(pfx + 'M');
    if (h) h.disabled = dis; if (m) m.disabled = dis;
  }

  function bindSecondaryModalEvents() {
    // select 構築
    const sh = document.getElementById('bmStartHour-2');
    if (sh) sh.innerHTML = bizHourOptions();
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
      // アイコン(svg)を押したときも拾えるよう closest で見る（e.target だとsvgになる）
      if (e.target.closest('#bmCopyText-2')) { withBmSuffix('-2', copyBookingFormAsText); return; }
      if (e.target.closest('#bmCopyCustomerText-2')) { withBmSuffix('-2', copyCustomerBookingText); return; }
      if (e.target.closest('#bmHistoryToggle-2')) { withBmSuffix('-2', toggleHistoryPanel); return; }
      if (e.target.id === 'bmPhoneLookup-2') { withBmSuffix('-2', lookupCustomerByPhoneManual); return; }
    });
    modal2.addEventListener('change', e => {
      if (e.target.id === 'bmStartHour-2' || e.target.id === 'bmStartMin-2') {
        bmStartTouched['-2'] = true;
        withBmSuffix('-2', () => { updateEndTime(); autoToggleLateNight(); });
      } else if (e.target.id === 'bmDate-2') {
        withBmSuffix('-2', () => { syncBmDateDisp(); applyDefaultStartOnDateChange(); });
      } else if (e.target.id === 'bmHotelFirst-2') {
        bmHotelFirstTouched['-2'] = true;
        withBmSuffix('-2', () => { populateCourseSelect(); applyCoursePrice(); updateBookingTotal(); });
      } else if (e.target.id === 'bmCampaign-2') {
        withBmSuffix('-2', () => { updateBookingTotal(); syncCampaignFieldVisibility(); });
      } else if (e.target.id === 'bmLateNight-2' || e.target.id === 'bmStampReward-2' || e.target.id === 'bmTransport-2') {
        withBmSuffix('-2', updateBookingTotal);
      } else if (e.target.id === 'bmNomination-2') {
        withBmSuffix('-2', () => { updateBookingTotal(); syncDealBadges(); });
      } else if (e.target.id === 'bmPlus10-2') {
        bmPlus10Touched['-2'] = true;
        withBmSuffix('-2', () => { updateEndTime(); applyBonusCoursePrice(); updateBookingTotal(); });
      } else if (e.target.name === 'bmMedia-2') {
        bmPlus10Touched['-2'] = false;
        withBmSuffix('-2', () => { syncDealBadges(); updateEndTime(); });
      } else if (e.target.id === 'bmExtCount-2') {
        withBmSuffix('-2', () => { updateEndTime(); updateBookingTotal(); });
      } else if (e.target.id === 'bmCourse-2' || e.target.id === 'bmCourse2-2') {
        withBmSuffix('-2', () => { syncComboUi(); updateEndTime(); applyCoursePrice(); autoToggleLateNight(); syncDealBadges(); });
      } else if (e.target.name === 'bmCityRegion-2') {
        withBmSuffix('-2', () => { populateCitySelect(e.target.value); populateHotelSelect(bel('bmCity').value); });
      } else if (e.target.id === 'bmCity-2') {
        withBmSuffix('-2', () => { populateHotelSelect(e.target.value); onCityChangedForHome(); loadBmTowns().then(() => withBmSuffix('-2', applyHomeTransportFee)); });
      } else if (e.target.id === 'bmTown-2') {
        withBmSuffix('-2', () => { onTownChangedForHome(); applyHomeTransportFee(); syncTownHint(); });
      } else if (e.target.id === 'bmHotelId-2') {
        withBmSuffix('-2', () => { applyHotelTransportFee(e.target.value); renderBmHotelAddr(); });
      } else if (e.target.id === 'bmStatus-2') {
        document.getElementById('bmCancelWrap-2').style.display = bmIsCancel(e.target.value) ? 'block' : 'none';
        withBmSuffix('-2', syncCancelTypeFromStatus);
        withBmSuffix('-2', () => {
          const cb = bel('bmBreakMode');
          const want = e.target.value === 'break';
          if (cb && cb.checked !== want) { cb.checked = want; setBreakMode(want); }
          updateBookingTotal();
        });
      } else if (e.target.id === 'bmAdminId-2') {
        withBmSuffix('-2', () => { autoStatusOnAssign(); renderCastAlert(); renderNgAlert(); syncDealBadges(); });
      } else if (e.target.id === 'bmCancelType-2' || e.target.id === 'bmCancelFee-2') {
        withBmSuffix('-2', updateBookingTotal);
      } else if (e.target.name === 'bmLocType-2') {
        withBmSuffix('-2', () => { switchLocSection(e.target.value); syncDealBadges(); });
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
      else if (e.target.id === 'bmPrice-2' || e.target.id === 'bmDepositOverride-2' || e.target.id === 'bmCashAmount-2') withBmSuffix('-2', updateBookingTotal);
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
  /**
   * ホテルが決まっていないときの場所名（店長要望 2026-08-24）。
   * ラブホは「お客様が直前に決める」ことが多く、ホテル名なしでも保存できるようにする。
   *   ラブホ → 「立川市ラブホテル」 / ホテル → 「立川市ホテル」（市区町村が空なら市区町村なし）
   */
  function undecidedVenueName(locType) {
    const city = (bel('bmCity')?.value || '').trim();
    return city + (locType === 'loveho' ? 'ラブホテル' : 'ホテル');
  }
  const HOME_PREFIX = '【自宅】';
  // 自宅の場所は「住所」と「建物名・部屋番号」の2欄。保存は半角スペースで1本に結合する。
  // 旧データは ' / ' 区切りなので、読むときは両方に対応する。
  const HOME_SEP = ' ';
  /** 「住所＋建物」の1本の文字列を [住所, 建物] に分ける。番地（数字・ハイフン・丁目/番/号）までが住所 */
  function splitAddressBuilding(full) {
    const t = String(full || '').trim();
    if (!t) return ['', ''];
    if (t.includes(' / ')) {                    // 旧形式はそのまま素直に割る
      const p = t.split(' / ');
      return [p[0].trim(), p.slice(1).join(' / ').trim()];
    }
    const m = t.match(/^(.*?[0-9０-９][0-9０-９\-－‐ー―]*(?:(?:丁目|番地|丁|番|号)[0-9０-９\-－‐ー―]*)*)[\s　]*(.*)$/u);
    if (!m) return [t, ''];
    return [m[1].trim(), (m[2] || '').trim()];
  }
  /** [住所, 建物] を保存用の1本に結合（建物が空なら住所だけ）。住所欄に既に建物が入っていれば二重にしない */
  function joinAddressBuilding(addr, bld) {
    const a = String(addr || '').trim();
    const b = String(bld || '').trim();
    if (!b) return a;
    if (a.replace(/[\s　]+$/, '').endsWith(b)) return a;   // 住所末尾が建物と同じ＝既に含む → 付け足さない
    return a + HOME_SEP + b;
  }
  /** 末尾に同じ文字列が繰り返されていたら1つに畳む（「…プレステージ立川 805 プレステージ立川 805」→「…プレステージ立川 805」） */
  function dedupeRepeatedSuffix(s) {
    const t = String(s || '').trim();
    const n = t.length;
    for (let len = Math.floor(n / 2); len >= 4; len--) {
      const tail = t.slice(n - len);
      const before = t.slice(0, n - len).replace(/[\s　]+$/, '');
      if (before.endsWith(tail)) return before;
    }
    return t;
  }
  const OTHER_PREFIX = '【その他】';

  /** ラブホ / ホテル はどちらも同じホテル選択欄を使う（一覧の中身だけ種別で切り替える） */
  const isHotelLoc = (type) => type === 'hotel' || type === 'loveho';
  /** ホテルマスタの hotel_type がラブホか（love_hotel の162件。他は city/business/ryokan/minshuku/other） */
  const isLoveHotel = (h) => String(h?.hotel_type || '') === 'love_hotel';

  function detectLocType(hotelId, snapshot) {
    if (hotelId) {
      // 登録済みホテルならラブホかどうかでタブを決める（店長要望 2026-08-08: ラブホを独立タブに）
      const h = (hotelsForSelect || []).find(x => Number(x.id) === Number(hotelId));
      return isLoveHotel(h) ? 'loveho' : 'hotel';
    }
    if (!snapshot) return 'hotel';
    if (snapshot.startsWith(HOME_PREFIX)) return 'home';
    if (snapshot.startsWith(OTHER_PREFIX)) return 'other';
    return 'hotel';  // 自由入力のホテル名
  }
  function switchLocSection(type) {
    const modal = document.getElementById('bookingModal' + activeBmSuffix) || document;
    // ラブホは hotel セクションを流用する（欄は同じで、選べる一覧だけが変わる）
    const sectionFor = isHotelLoc(type) ? 'hotel' : type;
    modal.querySelectorAll('.loc-section').forEach(el => {
      el.style.display = el.dataset.loc === sectionFor ? 'block' : 'none';
    });
    modal.querySelectorAll(`input[name="bmLocType${activeBmSuffix}"]`).forEach(r => r.checked = r.value === type);
    if (isHotelLoc(type)) { populateHotelSelect(); loadBmTowns(); }   // ラブホ・ホテルでは町名欄を消す
    if (type === 'home') { prefillHomeCity(); loadBmTowns().then(applyHomeTransportFee); }
    if (type === 'other') loadBmTowns();   // その他でも町名は不要
    renderBmMapLinks();
  }
  /**
   * 自宅・オフィスのとき、住所の頭に市区町村を入れておく（毎回打つのが手間なため）。
   * すでに何か入っていれば触らない＝オペレーターの入力を消さない。
   */
  /** 市区町村を変えたとき: 自宅タブで住所が空 or 市区町村名だけなら差し替える */
  function onCityChangedForHome() {
    const locType = document.querySelector(`input[name="bmLocType${activeBmSuffix}"]:checked`)?.value || 'hotel';
    if (locType !== 'home') return;
    const addr = bel('bmHomeAddress');
    if (!addr) return;
    const cur = String(addr.value || '').trim();
    // 空、または「立川市」のように市区町村名だけのときだけ差し替える（住所を打ってあれば触らない）
    if (cur !== '' && !/^[^0-9０-９]{1,8}[市区町村]$/.test(cur)) return;
    addr.value = (bel('bmCity')?.value || '').trim();
  }
  /**
   * 自宅・その他の住所にも、ホテルと同じ住所パネル（住所＋出発→ルート）を出す
   *（店長要望 2026-08-09）。ホテルは選ぶと出るが、手で打つ自宅・その他には無かった。
   * 建物名・部屋番号は入れない（地図アプリが別の場所を指すため。ホテルと同じ考え方）
   */
  function renderBmMapLinks() {
    const put = (boxId, raw) => {
      const box = bel(boxId);
      if (!box) return;
      const a = String(raw || '').split('\n')[0].trim();
      if (!a) { box.style.display = 'none'; box.innerHTML = ''; return; }
      // 市区町村が住所に無いときだけプルダウンの値で補う（「1-27-3」だけ打つ人がいるため）。
      // 住所に別の市区町村が既に入っている場合は補わない。以前は選択中の市名だけを見ていたため
      //「国分寺市を選んだまま青梅市の住所」で 東京都国分寺市青梅市… と二重になっていた（店長指摘 2026-08-10）
      const city = (bel('bmCity')?.value || '').trim();
      const hasAnyCity = !!extractCityFromAddress(a);
      const withCity = (city && !hasAnyCity) ? city + a : a;
      const full = composeAddress(prefOfCity(extractCityFromAddress(withCity)) || '', '', withCity);
      const origin = bmRouteOrigin();
      box.innerHTML = `<div class="bha-line"><span class="bha-l">住所</span><span>${escapeHtml(full)}</span></div>
        <div class="bha-route">
          <span class="bha-l">出発</span>
          <input type="text" class="bha-origin" value="${escapeAttr(origin)}" placeholder="いまキャストがいる場所（住所・駅名）">
          <button type="button" class="bha-office" data-bha-prev style="display:none;">直前</button>
          <button type="button" class="bha-office" data-bha-office>事務所</button>
          <button type="button" class="bha-fix" data-bha-eta-go title="この出発地で所要時間を計算する">確定</button>
          <span class="bha-eta" data-bha-eta></span>
          <button type="button" class="bha-go" data-bha-route>🚗 ルート</button>
        </div>`;
      box.style.display = 'block';
      wireBhaRoute(box, full);
    };
    put('bmHomeMapLinks', bel('bmHomeAddress')?.value);
    put('bmOtherMapLinks', bel('bmOtherLoc')?.value);
  }

  function prefillHomeCity() {
    const addr = bel('bmHomeAddress');
    const city = (bel('bmCity')?.value || '').trim();
    if (!addr || !city) return;
    if (String(addr.value || '').trim() !== '') return;
    addr.value = city;
  }

  // ===== 過去に使ったご自宅住所（2つ以上あるお客様は選べるように・店長要望 2026-08-14）=====
  const bmPastAddrs = { '': [], '-2': [] };   // suffix ごと。新しく使った順
  /**
   * そのお客様のご自宅住所を新しい順に取り出す。同じ住所は最新の1つだけ。
   * 予約履歴（新しい順）のあとに、顧客登録の「よく使う場所」も候補に足す
   *（引っ越し前の住所などが登録側に残っていることがあるため・店長要望 2026-08-14）
   */
  function collectHomeAddresses(bookings, defaultLoc) {
    const out = [], seen = new Set();
    const add = (raw) => {
      const addr = dedupeRepeatedSuffix(String(raw || '').trim());
      if (!addr) return;
      const key = addr.replace(/\s+/g, '');
      if (seen.has(key)) return;
      seen.add(key);
      out.push(addr);
    };
    (bookings || []).forEach(b => {
      const snap = String(b.hotel_name_snapshot || '');
      if (!snap.startsWith(HOME_PREFIX)) return;
      add(snap.slice(HOME_PREFIX.length));
    });
    add(defaultLoc);
    return out;
  }
  /** 過去のご利用住所プルダウンを作る。1つ以下なら出さない（選ぶ必要が無いため） */
  function renderPastAddrSelect(suffix, addrs, current) {
    const sel = document.getElementById('bmPastAddr' + suffix);
    const field = document.getElementById('bmPastAddrField' + suffix);
    if (!sel || !field) return;
    bmPastAddrs[suffix] = addrs || [];
    if (!addrs || addrs.length < 2) { field.style.display = 'none'; sel.innerHTML = ''; return; }
    sel.innerHTML = addrs.map((a, i) =>
      `<option value="${escapeAttr(a)}">${escapeHtml(a)}${i === 0 ? '（直近）' : ''}</option>`).join('');
    const cur = String(current || '').replace(/\s+/g, '');
    const hit = addrs.find(a => a.replace(/\s+/g, '') === cur);
    sel.value = hit || addrs[0];
    field.style.display = '';
  }

  // ===== いつもの場所の自動入力 =====
  // 電話番号でお客様が当たったとき、顧客登録の「よく使う場所」（＝ご自宅の住所が多い）を
  // 訪問先に自動セットする。基本ご自宅利用のお客様で毎回住所を打ち直さなくて済むように。
  // 稀にホテル利用もあるので、あくまで初期値＝「ホテル」タブに切り替えれば普通にホテル選択。
  // 場所を少しでも触っていたら何もしない（オペレーターの入力を消さない）。
  function prefillUsualLocation(c, pastAddrs) {
    const note = bel('bmUsualLocNote');
    // 直近に使ったご自宅住所を最優先（住所が変わった／2つある人は最新が正しいことが多い・店長要望 2026-08-14）。
    // 履歴が無いときだけ顧客登録の「よく使う場所」を使う
    const addr = String((pastAddrs && pastAddrs[0]) || c?.default_location || '').trim();
    const locType = document.querySelector(`input[name="bmLocType${activeBmSuffix}"]:checked`)?.value || 'hotel';
    // 「まだ場所を何も入れていない」＝どの欄も空。タブがホテル/自宅のどちらを向いていても入れる
    // （自宅タブに切り替えただけで住所が空、というのが一番多い。ここを弾いていて出なかった）
    const untouched = !bel('bmHotelId')?.value
      && !(bel('bmHotelName')?.value || '').trim()
      && !(bel('bmRoom')?.value || '').trim()
      && !(bel('bmHomeAddress')?.value || '').trim()
      && !(bel('bmOtherLoc')?.value || '').trim();
    // 「その他」を自分で選んでいるときは意図があるので触らない
    if (!addr || !untouched || locType === 'other' || bel('bmBreakMode')?.checked) {
      if (note && !addr) note.style.display = 'none';
      return;
    }
    switchLocSection('home');
    const [pAddr, pBld] = splitAddressBuilding(addr);
    bel('bmHomeAddress').value = pAddr;
    bel('bmHomeBuilding').value = pBld;
    // 市区町村も住所から合わせる（エリアタブごと）。プルダウンに無い市はそのまま
    const city = extractCityFromAddress(addr);
    if (city) {
      syncCityRegionTab(city);
      const citySel = bel('bmCity');
      if (citySel && [...citySel.options].some(o => o.value === city)) {
        citySel.value = city;
        populateHotelSelect(city);   // ホテルタブに切り替えたとき絞り込み済みにしておく
      }
    }
    if (note) {
      note.style.display = 'block';
      note.textContent = '📍 いつもの場所を自動入力しました（ホテル利用のときは「ホテル」タブへ）';
    }
    renderBmMapLinks();   // 自動入力した住所にも地図リンクを出す
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
    '狛江市',              // 16.4（自宅の交通費で選べなかった・店長指摘 2026-08-29）
    '町田市',              // 17.0
    '西多摩郡檜原村',      // 24.2
    '西多摩郡奥多摩町',    // 29.3
  ];
  // 市区町村の読み。プルダウンをキーボードで探せるようにするため（店長要望 2026-08-30）。
  // ここに無い市区町村は漢字の部分一致だけで探せる
  const CITY_KANA = {
    '立川市': 'たちかわし', '国立市': 'くにたちし', '日野市': 'ひのし', '国分寺市': 'こくぶんじし',
    '東大和市': 'ひがしやまとし', '昭島市': 'あきしまし', '武蔵村山市': 'むさしむらやまし', '小平市': 'こだいらし',
    '府中市': 'ふちゅうし', '多摩市': 'たまし', '東村山市': 'ひがしむらやまし', '小金井市': 'こがねいし',
    '福生市': 'ふっさし', '八王子市': 'はちおうじし', '西多摩郡瑞穂町': 'にしたまぐんみずほまち',
    '稲城市': 'いなぎし', 'あきる野市': 'あきるのし', '西東京市': 'にしとうきょうし', '羽村市': 'はむらし',
    '調布市': 'ちょうふし', '東久留米市': 'ひがしくるめし', '三鷹市': 'みたかし', '武蔵野市': 'むさしのし',
    '青梅市': 'おうめし', '狛江市': 'こまえし', '町田市': 'まちだし',
    '西多摩郡檜原村': 'にしたまぐんひのはらむら', '西多摩郡奥多摩町': 'にしたまぐんおくたままち',
    '杉並区': 'すぎなみく', '練馬区': 'ねりまく', '世田谷区': 'せたがやく', '中野区': 'なかのく',
    '渋谷区': 'しぶやく', '新宿区': 'しんじゅくく', '目黒区': 'めぐろく', '板橋区': 'いたばしく',
    '豊島区': 'としまく', '北区': 'きたく', '品川区': 'しながわく', '文京区': 'ぶんきょうく',
    '千代田区': 'ちよだく', '港区': 'みなとく', '大田区': 'おおたく', '中央区': 'ちゅうおうく',
    '台東区': 'たいとうく', '荒川区': 'あらかわく', '墨田区': 'すみだく', '足立区': 'あだちく',
    '江東区': 'こうとうく', '葛飾区': 'かつしかく', '江戸川区': 'えどがわく',
    '所沢市': 'ところざわし', '入間市': 'いるまし', '狭山市': 'さやまし', '新座市': 'にいざし',
    '志木市': 'しきし', '朝霞市': 'あさかし', '和光市': 'わこうし', '飯能市': 'はんのうし',
    '入間郡三芳町': 'いるまぐんみよしまち', 'ふじみ野市': 'ふじみのし', '富士見市': 'ふじみし',
    '日高市': 'ひだかし', '川越市': 'かわごえし', '鶴ヶ島市': 'つるがしまし', '坂戸市': 'さかどし',
    '戸田市': 'とだし', '蕨市': 'わらびし', '川口市': 'かわぐちし', 'さいたま市': 'さいたまし', '上尾市': 'あげおし',
    '相模原市': 'さがみはらし', '座間市': 'ざまし', '大和市': 'やまとし', '厚木市': 'あつぎし',
    '海老名市': 'えびなし', '綾瀬市': 'あやせし', '川崎市': 'かわさきし', '伊勢原市': 'いせはらし',
    '横浜市': 'よこはまし', '秦野市': 'はだのし', '藤沢市': 'ふじさわし', '茅ヶ崎市': 'ちがさきし',
    '平塚市': 'ひらつかし', '小田原市': 'おだわらし',
  };
  /** カタカナ→ひらがな・全角英数→半角にそろえる（打ち方の違いを吸収） */
  function kanaNorm(t) {
    return String(t || '').normalize('NFKC')
      .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .toLowerCase();
  }

  /**
   * 市区町村のプルダウンを、キーボードで打って探せるようにする（店長要望 2026-08-30）。
   * select はそのまま残し（値の持ち主は select のまま）、その上に入力欄をかぶせる。
   * 漢字でも ひらがな・カタカナ でも候補が出る。
   */
  function attachCitySearch(sel) {
    if (!sel || sel.dataset.searchable === '1') return;
    sel.dataset.searchable = '1';
    const box = document.createElement('div');
    box.className = 'city-search';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'city-search-inp';
    inp.setAttribute('placeholder', '例: たちかわ');
    inp.setAttribute('autocomplete', 'off');
    const list = document.createElement('div');
    list.className = 'city-search-list';
    box.appendChild(inp);
    box.appendChild(list);
    sel.parentNode.insertBefore(box, sel);
    sel.style.display = 'none';

    const optionsOf = () => [...sel.options].map(o => ({ value: o.value, label: o.textContent }));
    const syncInput = () => {
      const o = sel.selectedOptions[0];
      inp.value = (o && o.value) ? o.textContent : '';
    };
    const close = () => { list.classList.remove('is-open'); list.innerHTML = ''; };
    const render = (q) => {
      const nq = kanaNorm(q);
      const hits = optionsOf().filter(o => {
        if (!o.value) return false;                           // 「— すべて —」は候補に出さない（店長指定 2026-08-30）
        if (nq === '') return true;
        const kana = kanaNorm(CITY_KANA[o.value] || '');
        return o.value.includes(q) || kanaNorm(o.value).includes(nq) || kana.includes(nq);
      }).slice(0, 40);
      if (!hits.length) { close(); return; }
      list.innerHTML = hits.map((o, i) =>
        `<button type="button" class="city-search-item${i === 0 ? ' is-on' : ''}" data-v="${escapeAttr(o.value)}">${escapeHtml(o.label)}</button>`).join('');
      list.classList.add('is-open');
    };
    const pick = (v) => {
      sel.value = v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      syncInput();
      close();
    };
    inp.addEventListener('focus', () => { inp.select(); render(''); });
    inp.addEventListener('input', () => render(inp.value.trim()));
    inp.addEventListener('keydown', (e) => {
      const items = [...list.querySelectorAll('.city-search-item')];
      if (!items.length) return;
      const cur = items.findIndex(b => b.classList.contains('is-on'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, cur + 1) : Math.max(0, cur - 1);
        items.forEach(b => b.classList.remove('is-on'));
        items[next].classList.add('is-on');
        items[next].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        (items[cur] || items[0]).click();
      } else if (e.key === 'Escape') { close(); }
    });
    list.addEventListener('mousedown', (e) => {
      const b = e.target.closest('.city-search-item');
      if (b) { e.preventDefault(); pick(b.dataset.v); }
    });
    inp.addEventListener('blur', () => setTimeout(() => { close(); syncInput(); }, 120));
    // 中身が入れ替わったとき（エリアタブの切替など）に表示をそろえる
    sel.addEventListener('change', syncInput);
    const mo = new MutationObserver(syncInput);
    mo.observe(sel, { childList: true });
    syncInput();
  }

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
    // メインはホテルのある市区町村＋正規リスト(CITY_PROXIMITY)。ホテルが無い市区町村
    // （武蔵村山市など）も選べるようにする（店長指摘 2026-08-13）
    const cities = (reg === 'main')
      ? sortCitiesByProximity([...new Set([...hotelsForSelect.map(h => h.city).filter(Boolean), ...CITY_PROXIMITY])])
      : (CITY_REGIONS[reg] || []);
    sel.innerHTML = '<option value="">— すべて —</option>' +
      cities.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
    if (keep && cities.includes(keep)) sel.value = keep;   // 同じ市区町村が新しいエリアにもあれば維持
    attachCitySearch(sel);   // 打って探せるようにする（1回だけ付く）
  }
  // 市区町村の値から、それが属するエリアのタブを選び直す（既存予約を開いた時など）
  /**
   * 自宅・その他の予約を開いたとき、市区町村プルダウンを戻す（店長要望 2026-08-22）。
   * 保存してある display_city を優先し、無ければ住所から切り出す。
   * 交通費は保存値のままにしたいので、ここでは再計算しない（値は変更しない）
   */
  function restoreBmCityFor(b, addr) {
    const sel = bel('bmCity');
    if (!sel) return;
    const city = (b && b.display_city) || extractCityFromAddress(addr || '') || '';
    if (!city) return;
    syncCityRegionTab(city);                       // 23区などはエリアタブも合わせる
    sel.value = city;
    if (sel.value !== city) {                      // 選択肢に無い市区町村（他エリア）でも表示できるよう足す
      const opt = document.createElement('option');
      opt.value = city; opt.textContent = city;
      sel.appendChild(opt);
      sel.value = city;
    }
  }
  function syncCityRegionTab(city) {
    if (!city) return;
    let reg = 'main';
    for (const [k, list] of Object.entries(CITY_REGIONS)) if (list.includes(city)) { reg = k; break; }
    const r = document.querySelector(`input[name="bmCityRegion${activeBmSuffix}"][value="${reg}"]`);
    if (r && !r.checked) { r.checked = true; populateCitySelect(reg); }
    populateHotelSelect(city);   // 市区町村が変わったらホテル一覧も絞り直す
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
  /**
   * 選んだホテルの住所・TEL・入室方法と地図リンクを出す。
   * ドライバーへ送る文面にも同じ内容が入るので、ここで先に確認できるようにする。
   */
  function renderBmHotelAddr() {
    const box = bel('bmHotelAddr');
    if (!box) return;
    const hid = bel('bmHotelId')?.value;
    const h = hid ? (hotelsForSelect || []).find(x => Number(x.id) === Number(hid)) : null;
    if (!h) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const city = (h.city || '').trim();
    const addr = (h.address || '').trim();
    const pref = (typeof prefOfCity === 'function' ? prefOfCity(city) : '') || '';
    const full = composeAddress(pref, city, addr);   // 建物名は入れない・重複させない
    const bits = [];
    if (full) bits.push(`<div class="bha-line"><span class="bha-l">住所</span><span>${escapeHtml(full)}</span></div>`);
    const sub = [];
    if (h.tel) sub.push(`TEL ${escapeHtml(h.tel)}`);
    if (h.nearest_station) sub.push(`${escapeHtml(h.nearest_station)}駅`);
    if (h.entry_method) sub.push(`入室 ${escapeHtml(entryMethodLabel(h.entry_method))}`);
    if (sub.length) bits.push(`<div class="bha-line"><span class="bha-l">情報</span><span>${sub.join('　')}</span></div>`);
    if (h.guide_note) bits.push(`<div class="bha-line"><span class="bha-l">案内</span><span>${escapeHtml(h.guide_note)}</span></div>`);
    // ルート案内: キャストがいまいる場所 → 訪問先。所要時間はGoogleマップ側で出る
    if (full) {
      const origin = bmRouteOrigin();
      bits.push(`<div class="bha-route">
        <span class="bha-l">出発</span>
        <input type="text" class="bha-origin" value="${escapeAttr(origin)}" placeholder="いまキャストがいる場所（住所・駅名）">
        <button type="button" class="bha-office" data-bha-prev style="display:none;">直前</button>
        <button type="button" class="bha-office" data-bha-office>事務所</button>
        <button type="button" class="bha-fix" data-bha-eta-go title="この出発地で所要時間を計算する">確定</button>
        <span class="bha-eta" data-bha-eta></span>
        <button type="button" class="bha-go" data-bha-route>🚗 ルート</button>
      </div>`);
    }
    if (!bits.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.innerHTML = bits.join('');
    box.style.display = 'block';
    wireBhaRoute(box, full);
  }

  /**
   * 住所パネルの「出発 → ルート」を動かす。ホテル・自宅・その他で共用（店長要望 2026-08-09）。
   * @param {HTMLElement} box パネル要素
   * @param {string} full 目的地の住所
   */
  function wireBhaRoute(box, full) {
    const originEl = box.querySelector('.bha-origin');
    // 出発地は端末ごとに覚える（毎回打ち直さなくて済むように）
    if (originEl) originEl.addEventListener('change', () => {
      try { localStorage.setItem('opsRouteOrigin', originEl.value.trim()); } catch (_) {}
    });
    const officeBtn = box.querySelector('[data-bha-office]');
    if (officeBtn) officeBtn.addEventListener('click', () => {
      if (originEl) originEl.value = _officeAddress || '';
      try { localStorage.removeItem('opsRouteOrigin'); } catch (_) {}
      if (!_officeAddress) toast('事務所の住所が未設定です（マスタ → 事務所の住所）', 'err');
    });
    // 直前のお仕事の住所を出発地に入れる（送迎の判断・所要時間の見積もりに使う・店長要望 2026-08-10）
    const prevBtn = box.querySelector('[data-bha-prev]');
    if (prevBtn) {
      prevBtn.addEventListener('click', async () => {
        prevBtn.disabled = true;
        try {
          const prev = await prevJobOf();
          if (!prev) { refreshPrevJobButtons(); return; }
          const addr = addressOfBooking(prev);
          if (!addr) return;
          if (originEl) originEl.value = addr;
          try { localStorage.setItem('opsRouteOrigin', addr); } catch (_) {}
          const who = String(prev.customer_name_snapshot || prev.customer_name || '').trim();
          toast(`${fmtTimeDisp(prev.start_time)}${who ? ' ' + who + ' 様' : ''} の場所を入れました`, 'ok');
        } finally { prevBtn.disabled = false; }
      });
      refreshPrevJobButtons();   // 直前が無い日は最初から出さない
    }
    // 出発地が入っていれば、車での所要時間をその場に出す（Googleへのリンクはそのまま残す）
    const etaEl = box.querySelector('[data-bha-eta]');
    if (etaEl) {
      const runEta = () => {
        const from = (originEl?.value || '').trim();
        if (from) { try { localStorage.setItem('opsRouteOrigin', from); } catch (_) {} }
        renderRouteEta(etaEl, from, addressForMap(full));
      };
      runEta();
      if (originEl) {
        originEl.addEventListener('change', runEta);
        // Enter でも計算（Googleへは飛ばさない）
        originEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runEta(); } });
      }
      // 「確定」= この出発地で時間だけ出し直す。🚗ルート は Google が開くので分けてある（店長要望 2026-08-10）
      const fixBtn = box.querySelector('[data-bha-eta-go]');
      if (fixBtn) fixBtn.addEventListener('click', runEta);
    }
    const goBtn = box.querySelector('[data-bha-route]');
    if (goBtn) goBtn.addEventListener('click', () => {
      const from = (originEl?.value || '').trim();
      const to = addressForMap(full);
      if (!from) { toast('出発地を入力してください', 'err'); originEl?.focus(); return; }
      const url = 'https://www.google.com/maps/dir/?api=1'
        + '&origin=' + encodeURIComponent(from)
        + '&destination=' + encodeURIComponent(to)
        + '&travelmode=driving';
      window.open(url, '_blank', 'noopener');
    });
  }

  /**
   * 出発地 → 目的地 の車での所要時間を出す（店長要望 2026-08-10）。
   * 渋滞は考慮しない「道なりの時間」なので、正確に見たいときは 🚗ルート で Google を開く。
   * 同じ組み合わせはサーバー側で貯めるので、2回目以降はすぐ出る。
   */
  const _etaMem = {};   // 画面内のメモ（同じ組み合わせを何度も投げない）
  async function renderRouteEta(el, from, to) {
    if (!el) return;
    if (!from || !to) { el.textContent = ''; el.className = 'bha-eta'; return; }
    const key = from + '|' + to;
    const put = (txt, cls) => { el.textContent = txt; el.className = 'bha-eta' + (cls ? ' ' + cls : ''); };
    if (_etaMem[key]) { put(_etaMem[key], 'is-ok'); return; }
    put('計測中…', 'is-loading');
    try {
      const d = await api(`/route-eta.php?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const min = Math.max(1, Math.round((d.duration_sec || 0) / 60));
      const km = ((d.distance_m || 0) / 1000);
      const txt = `🚗約${min}分・${km >= 10 ? km.toFixed(0) : km.toFixed(1)}km`;
      _etaMem[key] = txt;
      put(txt, 'is-ok');
      el.title = '渋滞は考えていない道なりの時間です。正確な時間は「🚗 ルート」でご確認ください';
    } catch (e) {
      put('—', 'is-ng');
      el.title = '所要時間を取れませんでした: ' + (e.message || '');
    }
  }

  /** 予約1件から「住所」だけを取り出す（ナビにそのまま貼れる形）。bookingAddressText の引数版 */
  function addressOfBooking(b) {
    if (!b) return '';
    const addr = (b.hotel_address || '').trim();
    if (addr) return addressForMap(composeAddress('', (b.display_city || b.hotel_city || ''), addr));
    const snap = (b.hotel_name_snapshot || '').trim();
    if (snap.startsWith(HOME_PREFIX)) return addressForMap(snap.slice(HOME_PREFIX.length));
    if (snap.startsWith(OTHER_PREFIX)) return snap.slice(OTHER_PREFIX.length).split('\n')[0].trim();
    return '';
  }

  // その営業日の予約一覧。「直前」ボタンの判定で何度も同じ日を取りに行かないよう1日ぶんだけ持つ。
  // 予約モーダルを開くたびに捨てる（保存直後の古いデータを掴まないため）
  let _prevJobCache = { key: '', rows: null };
  function clearPrevJobCache() { _prevJobCache = { key: '', rows: null }; }
  async function fetchDayBookings(bizDay) {
    if (_prevJobCache.key === bizDay && _prevJobCache.rows) return _prevJobCache.rows;
    const next = fmtDate(addDays(_parseYmd(bizDay), 1));
    const d = await api(`/bookings.php?action=range&from=${bizDay}&to=${next}`);
    _prevJobCache = { key: bizDay, rows: d.bookings || [] };
    return _prevJobCache.rows;
  }
  /**
   * いま開いている予約の「直前のお仕事」を返す（無ければ null）。
   * 同じキャスト・同じ営業日で、開始時刻がこの予約より前のもののうち一番遅いもの。
   * キャンセル・無連絡は移動元にならないので除く。
   */
  async function prevJobOf() {
    const adminId = Number(bel('bmAdminId')?.value || 0);
    const bizDay = (bel('bmDate')?.value || '').trim();
    if (!adminId || !bizDay) return null;
    const bizMin = (h, m) => ((h < 10 ? h + 24 : h) * 60 + m);
    const bizMinOf = (t) => bizMin(parseInt(String(t).slice(0, 2), 10) || 0, parseInt(String(t).slice(3, 5), 10) || 0);
    const myMin = bizMin(parseInt(bel('bmStartHour')?.value || '0', 10), parseInt(bel('bmStartMin')?.value || '0', 10));
    const myId = Number(getEditingBookingId() || 0);
    let rows = [];
    // 取得に失敗したときは「無い」と決めつけない（ボタンを消さずに残す）
    try { rows = await fetchDayBookings(bizDay); } catch (e) { return undefined; }
    const cands = rows.filter(b =>
      Number(b.assigned_admin_id) === adminId
      && Number(b.id) !== myId
      && !['cancelled', 'no_show'].includes(String(b.status || ''))
      && bizDateOf(b.booking_date, b.start_time || '00:00') === bizDay
      && bizMinOf(b.start_time) < myMin
      && !!addressOfBooking(b)          // 住所が入っていないものは出発地にできない
    );
    if (!cands.length) return null;
    // 並べ替えは営業日の時刻順。文字列で並べると 0:06 が 23:00 より前になり、直前を取り違える
    cands.sort((a, b) => bizMinOf(a.start_time) - bizMinOf(b.start_time));
    return cands[cands.length - 1];
  }
  /** 直前のお仕事が無ければ「直前」ボタンを消す（店長要望 2026-08-10） */
  async function refreshPrevJobButtons() {
    const btns = document.querySelectorAll('[data-bha-prev]');
    if (!btns.length) return;
    let prev = null;
    try { prev = await prevJobOf(); } catch (e) { prev = undefined; }
    if (prev === undefined) {   // 取得できなかった → 判断がつかないので消さずに残す
      btns.forEach(b => { b.style.display = ''; b.title = '直前のお仕事の場所を出発地に入れる'; });
      return;
    }
    const who = prev ? String(prev.customer_name_snapshot || prev.customer_name || '').trim() : '';
    btns.forEach(b => {
      b.style.display = prev ? '' : 'none';
      b.title = prev ? `直前のお仕事: ${fmtTimeDisp(prev.start_time)}${who ? ' ' + who + ' 様' : ''} の場所を出発地に入れる` : '';
    });
  }

  // 事務所の住所（ルート案内の既定の出発地）。init とマスタタブで読み込む
  let _officeAddress = '';
  async function loadOfficeAddress() {
    const el = document.getElementById('officeAddress');
    if (!el) return;
    try {
      const d = await api('/admin-api.php?action=setting-get&key=office_address');
      _officeAddress = (d && d.value) || '';
      el.value = _officeAddress;
    } catch (e) {}
    const btn = document.getElementById('officeAddressSave');
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        try {
          const d = await apiPost('/admin-api.php?action=setting-set', { key: 'office_address', value: el.value.trim() });
          _officeAddress = (d && d.value) || '';
          toast('✓ 事務所の住所を保存しました', 'ok');
        } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
      });
    }
  }
  // クレジット手数料（お客様への上乗せ率）。マスタタブで設定する（店長要望 2026-08-07）
  async function loadCardSurchargeSetting() {
    const el = document.getElementById('msCardSurcharge');
    if (!el) return;
    try {
      const d = await api('/admin-api.php?action=card-fee-get');
      if (d && d.card_surcharge_rate != null) {
        CARD_SURCHARGE_RATE = parseFloat(d.card_surcharge_rate) || CARD_SURCHARGE_RATE;
      }
    } catch (e) {}
    el.value = CARD_SURCHARGE_RATE;
    const btn = document.getElementById('msCardSurchargeSave');
    const msg = document.getElementById('msCardSurchargeMsg');
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        const rate = parseFloat(el.value);
        if (isNaN(rate) || rate < 0 || rate > 100) { toast('0〜100の数値を入力してください', 'err'); return; }
        try {
          const d = await apiPost('/admin-api.php?action=card-fee-set', { card_surcharge_rate: rate });
          CARD_SURCHARGE_RATE = parseFloat(d.card_surcharge_rate);
          el.value = CARD_SURCHARGE_RATE;
          if (msg) { msg.textContent = '✓ 保存しました'; setTimeout(() => { msg.textContent = ''; }, 2000); }
          toast('✓ クレジット手数料を ' + CARD_SURCHARGE_RATE + '% に更新しました', 'ok');
        } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
      });
    }
  }

  // 指名料。マスタタブで設定する（店長要望 2026-08-08: 損益タブは金額の集計だけにする）
  async function loadNominationFeeSetting() {
    const fFirst = document.getElementById('msNomFirst');
    const fReg = document.getElementById('msNomRegular');
    const fFree = document.getElementById('msNomFree');
    if (!fFirst || !fReg || !fFree) return;
    // 指名料（お客様）とキャスト報酬は別物。同じ画面で並べて設定する（店長要望 2026-08-08）
    const rFirst = document.getElementById('msNomRewFirst');
    const rReg = document.getElementById('msNomRewRegular');
    const rFree = document.getElementById('msNomRewFree');
    const fill = () => {
      fFirst.value = NOMINATION_FEES.first;
      fReg.value = NOMINATION_FEES.regular;
      fFree.value = NOMINATION_FEES.free;
      if (rFirst) rFirst.value = NOMINATION_REWARDS.first;
      if (rReg) rReg.value = NOMINATION_REWARDS.regular;
      if (rFree) rFree.value = NOMINATION_REWARDS.free;
    };
    fill();
    const btn = document.getElementById('msNomSave');
    const msg = document.getElementById('msNomMsg');
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        const parsed = {
          first: parseInt(fFirst.value, 10),
          regular: parseInt(fReg.value, 10),
          free: parseInt(fFree.value, 10),
        };
        const rewards = {
          first: parseInt(rFirst?.value ?? '0', 10),
          regular: parseInt(rReg?.value ?? '0', 10),
          free: parseInt(rFree?.value ?? '0', 10),
        };
        if (Object.values(parsed).concat(Object.values(rewards)).some(n => isNaN(n) || n < 0)) {
          toast('0以上の数値を入力してください', 'err'); return;
        }
        try {
          const res = await apiPost('/admin-api.php?action=nomination-fees-set',
            { nomination_fees: parsed, nomination_rewards: rewards });
          if (res?.nomination_fees) Object.assign(NOMINATION_FEES, res.nomination_fees);
          if (res?.nomination_rewards) Object.assign(NOMINATION_REWARDS, res.nomination_rewards);
          fill();
          if (msg) { msg.textContent = '✓ 保存しました'; setTimeout(() => { msg.textContent = ''; }, 2000); }
          toast('✓ 指名料・報酬を更新しました', 'ok');
          if (typeof loadTimeline === 'function') loadTimeline(true);   // 報酬の表示に即反映
        } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
      });
    }
  }

  // 自宅の交通費（市区町村＋町名）。予約モーダルで自宅を選んだときの初期値に使う（店長要望 2026-08-08）。
  // CITY_FEES = { 市区町村: { "": 全域の額, 町名: その町の額, ... } }。
  // 使い方は「まず市区町村で一括、その後 町名で調整」。例: 立川市 全域¥1,650 / 羽村市の一部の町だけ別額。
  let CITY_FEES = {};
  // 町名一覧のキャッシュ（市区町村 → [町名...]）。API側もDBにキャッシュするが、二度目以降の切替を速くする
  const TOWNS_CACHE = {};
  async function fetchTowns(city) {
    if (!city) return [];
    if (TOWNS_CACHE[city]) return TOWNS_CACHE[city];
    try {
      const d = await api('/admin-api.php?action=city-towns&city=' + encodeURIComponent(city));
      TOWNS_CACHE[city] = d.towns || [];
    } catch (e) { TOWNS_CACHE[city] = []; }
    return TOWNS_CACHE[city];
  }

  // ===== 🏠 自宅の交通費 専用ページ（マスタから開く。店長要望 2026-08-08: 町名一覧を見ながら設定） =====
  let cfAllCities = [];
  const cfState = { region: 'main', city: '' };

  async function loadCityFeeView() {
    try {
      const d = await api('/admin-api.php?action=city-fees');
      CITY_FEES = d.fees || {};
      cfAllCities = d.cities || [];
    } catch (e) { toast('読み込み失敗: ' + e.message, 'err'); return; }
    renderCfCities();
    renderCfTownPanel();
  }

  /** 金額プルダウンの中身。cur=null は未設定（emptyLabel を出す） */
  function cfFeeOptions(cur, emptyLabel) {
    // ¥1,100 から550円刻み（¥550 は廃止・店長指定 2026-08-08）
    const steps = [0, 1100, 1650, 2200, 2750, 3300, 3850, 4400, 4950, 5500, 6050, 6600, 7150, 7700, 8250, 8800, 9350, 9900, 10450, 11000];
    // 刻みに無い金額（設定済みの旧データ）は、選ばれたまま残るよう選択肢に足す
    if (cur != null && !steps.includes(cur)) steps.push(Number(cur));
    steps.sort((a, b) => a - b);
    return `<option value=""${cur == null ? ' selected' : ''}>${escapeHtml(emptyLabel)}</option>` +
      steps.map(v => `<option value="${v}"${cur === v ? ' selected' : ''}>${v === 0 ? '🆓 無料（¥0）' : '¥' + v.toLocaleString()}</option>`).join('');
  }

  /** エリアタブに応じた市区町村チップ。設定済みは金額と町別件数のバッジ付き */
  function renderCfCities() {
    const box = document.getElementById('cfCityChips');
    if (!box) return;
    const inOtherRegions = new Set([].concat(...Object.values(CITY_REGIONS)));
    let cities;
    if (cfState.region === 'main') {
      // メイン=多摩。ホテルのある市区町村（他エリアに属さないもの）＋設定だけ残っている市区町村
      const base = (cfAllCities || []).filter(c => !inOtherRegions.has(c));
      Object.keys(CITY_FEES).forEach(c => { if (!inOtherRegions.has(c) && !base.includes(c)) base.push(c); });
      // メインの正規リスト(CITY_PROXIMITY)も必ず含める。ホテルも設定も無い市区町村（武蔵村山市など）が
      // 交通費を設定できなくなるのを防ぐ（店長指摘 2026-08-13）
      CITY_PROXIMITY.forEach(c => { if (!inOtherRegions.has(c) && !base.includes(c)) base.push(c); });
      cities = sortCitiesByProximity(base);
    } else {
      cities = CITY_REGIONS[cfState.region] || [];
    }
    box.innerHTML = cities.map(c => {
      const f = CITY_FEES[c] || {};
      const baseFee = f[''] != null ? '¥' + Number(f['']).toLocaleString() : '';
      const townCount = Object.keys(f).filter(t => t !== '').length;
      const tag = [baseFee, townCount ? `町別${townCount}` : ''].filter(Boolean).join('・');
      const on = c === cfState.city;
      return `<button type="button" data-cf-city="${escapeAttr(c)}"
        style="padding:.45rem .8rem;border-radius:999px;border:1.5px solid ${on ? 'var(--sea)' : 'var(--gray)'};background:${on ? 'var(--sea)' : '#fff'};color:${on ? '#fff' : 'var(--ink)'};font-size:.86rem;font-weight:600;cursor:pointer;">
        ${escapeHtml(c)}${tag ? `<span style="margin-left:.35rem;font-size:.76rem;opacity:.85;">${escapeHtml(tag)}</span>` : ''}</button>`;
    }).join('') || '<p class="hint">このエリアの市区町村がありません</p>';
  }

  /** 選んだ市区町村の「全域＋町名一覧」パネル。金額を選ぶと即保存 */
  async function renderCfTownPanel() {
    const panel = document.getElementById('cfTownPanel');
    if (!panel) return;
    const city = cfState.city;
    if (!city) {
      panel.innerHTML = '<p class="hint" style="margin:.4rem 0;">市区町村を選ぶと、全域の金額と町名ごとの調整ができます。</p>';
      return;
    }
    panel.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    const towns = await fetchTowns(city);
    if (cfState.city !== city) return;   // 読み込み中に別の市区町村へ変わっていたら捨てる
    const f = CITY_FEES[city] || {};
    const zen = f[''] != null ? Number(f['']) : null;
    let html = `
      <div class="card card-pad" style="margin-top:.4rem;">
        <div style="display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;padding-bottom:.7rem;border-bottom:1.5px solid var(--gray);margin-bottom:.8rem;">
          <b style="font-size:1.05rem;">${escapeHtml(city)}</b>
          <span style="font-weight:700;">全域</span>
          <select data-cf-fee data-town="" style="padding:.4rem .55rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.92rem;font-weight:700;">${cfFeeOptions(zen, '（未設定）')}</select>
          <span class="hint">選ぶと即保存。町名は「全域と同じ」のままなら全域の金額が使われます</span>
        </div>`;
    if (towns.length) {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:.45rem .9rem;">' +
        towns.map(t => {
          const name = t.name;
          const own = f[name] != null ? Number(f[name]) : null;
          const emptyLabel = zen != null ? `全域と同じ（¥${zen.toLocaleString()}）` : '（全域と同じ）';
          // 立川駅からの直線距離（丁目の平均座標から計算）。交通費の目安として名前の隣に出す
          const km = t.km != null ? `<small style="color:var(--ink-soft);font-weight:500;margin-left:.3rem;">${t.km}km</small>` : '';
          return `<label style="display:flex;align-items:center;gap:.5rem;font-size:.9rem;font-weight:600;">
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}${km}</span>
            <select data-cf-fee data-town="${escapeAttr(name)}" style="width:11.5em;padding:.3rem .45rem;border:1.5px solid ${own != null ? 'var(--sea)' : 'var(--gray)'};border-radius:8px;font-size:.84rem;font-weight:600;${own != null ? 'background:var(--foam);' : ''}">${cfFeeOptions(own, emptyLabel)}</select>
          </label>`;
        }).join('') + '</div>';
    } else {
      html += '<p class="hint">この市区町村の町名一覧を取得できませんでした（全域の設定だけ使えます）</p>';
    }
    html += '</div>';
    panel.innerHTML = html;
  }

  /**
   * 自宅で「町名（任意）」が未選択のときだけ注意を出す（店長要望 2026-08-24）。
   * 町名で交通費が変わるのに、市区町村だけ選んで先へ進んでしまう事故があった。
   * 町名一覧が無い市区町村（プルダウンが出ない）では何も言わない
   */
  function syncTownHint() {
    const town = bel('bmTown');
    const hint = bel('bmTownHint');
    if (!town || !hint) return;
    const locType = document.querySelector(`input[name="bmLocType${activeBmSuffix}"]:checked`)?.value || 'hotel';
    const shown = town.style.display !== 'none' && town.options.length > 1;
    const need = locType === 'home' && shown && !town.value;
    hint.style.display = need ? '' : 'none';
    town.classList.toggle('need-pick', need);
  }
  /** 予約モーダルの町名プルダウン。市区町村を選んだら右に出す（町名一覧が取れない市区町村では出さない） */
  async function loadBmTowns() {
    // await の後は activeBmSuffix が呼び出し時と変わっていることがある（クローンモーダル②）。
    // bel() を await 後に呼び直すと別モーダルの要素を触るので、要素は最初に捕まえておく
    const townSel = bel('bmTown');
    const citySel = bel('bmCity');
    if (!townSel) return;
    const city = citySel?.value || '';
    const keep = townSel.value;
    townSel.style.display = "none";
    setCityRowWide(false);
    townSel.innerHTML = '<option value="">町名（任意）</option>';
    // 町名は自宅の交通費を決めるためだけの欄。ラブホ・ホテルでは使わないので出さない（店長指定 2026-08-08）
    const locType = document.querySelector(`input[name="bmLocType${activeBmSuffix}"]:checked`)?.value || 'hotel';
    if (locType !== 'home') { syncTownHint(); return; }
    if (!city) { syncTownHint(); return; }
    const towns = await fetchTowns(city);
    if ((citySel?.value || '') !== city) return;   // 読み込み中に変わっていたら捨てる
    if (!towns.length) { syncTownHint(); return; }
    // towns は {name, km} の配列。距離はマスタ専用の表示なので、予約モーダルでは名前だけ使う
    const names = towns.map(t => t.name);
    townSel.innerHTML = '<option value="">町名（任意）</option>' +
      names.map(t => `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`).join('');
    if (keep && names.includes(keep)) townSel.value = keep;
    townSel.style.display = '';
    setCityRowWide(true);   // 町名が並ぶと市区町村が狭くなるので列幅を広げる
    syncTownHint();
  }

  /**
   * 市区町村の列幅。町名プルダウンが出ているときは2つ並ぶので広くする
   *（店長指摘 2026-08-09: 「国分寺市」が切れて読めない）
   */
  function setCityRowWide(on) {
    const row = document.getElementById('bmLocTypeRow' + activeBmSuffix);
    if (row) row.classList.toggle('has-town', !!on);
  }

  /** 自宅・オフィスのとき、市区町村（＋町名）に対応する交通費を入れる。町名の設定が全域より優先 */
  function applyHomeTransportFee() {
    const locType = document.querySelector(`input[name="bmLocType${activeBmSuffix}"]:checked`)?.value || 'hotel';
    if (locType !== 'home') return;
    const city = bel('bmCity')?.value || '';
    const town = bel('bmTown')?.value || '';
    const f = CITY_FEES[city] || {};
    const raw = (town !== '' && f[town] != null) ? f[town] : f[''];
    if (raw == null) return;   // 未設定の市区町村は触らない
    const sel = bel('bmTransport');
    if (!sel) return;
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

  /** 町名を選んだとき、自宅住所が空か市区町村（＋町名）だけなら「立川市曙町」の形に差し替える */
  function onTownChangedForHome() {
    const locType = document.querySelector(`input[name="bmLocType${activeBmSuffix}"]:checked`)?.value || 'hotel';
    if (locType !== 'home') return;
    const addr = bel('bmHomeAddress');
    const city = bel('bmCity')?.value || '';
    const town = bel('bmTown')?.value || '';
    if (!addr || !city) return;
    const cur = String(addr.value || '').trim();
    // 空、または「市区町村だけ」「市区町村＋町名だけ」（数字なし）のときだけ差し替える。番地を打ってあれば触らない
    if (cur !== '' && !(cur.startsWith(city) && !/[0-9０-９]/.test(cur) && cur.length <= city.length + 10)) return;
    addr.value = city + town;
  }

  /** 出発地の初期値: 端末で最後に使った場所 → 無ければ事務所 */
  function bmRouteOrigin() {
    try { const v = localStorage.getItem('opsRouteOrigin'); if (v) return v; } catch (_) {}
    return _officeAddress || '';
  }

  function populateHotelSelect(filterCity) {
    const sel = bel('bmHotelId');
    if (!sel) return;
    // 引数なしで呼ばれたら、いま選ばれている市区町村で絞る。
    // （市区町村だけ変えて一覧を絞り直し忘れる事故を防ぐ。''を渡せば従来どおり全件）
    if (filterCity === undefined) filterCity = bel('bmCity')?.value || '';
    const selectedValue = sel.value;
    // 訪問先タイプが「ラブホ」ならラブホだけ、「ホテル」ならそれ以外だけを出す（店長要望 2026-08-08）
    const locType = document.querySelector(`input[name="bmLocType${activeBmSuffix}"]:checked`)?.value || 'hotel';
    let list = hotelsForSelect;
    if (locType === 'loveho') list = list.filter(isLoveHotel);
    else if (locType === 'hotel') list = list.filter(h => !isLoveHotel(h));
    if (filterCity) list = list.filter(h => h.city === filterCity);
    // 予約入力はホテル名を探しながら選ぶので、あいうえお順に並べる（店長要望 2026-08-10）
    list = [...list].sort(byNameJa);
    sel.innerHTML = '<option value="">— 選択しない（下に手入力） —</option>' +
      list.map(h => `<option value="${h.id}">${escapeHtml(h.name)}${h.nearest_station ? ' (' + escapeHtml(h.nearest_station) + '駅)' : ''}</option>`).join('');
    if (selectedValue && list.some(h => Number(h.id) === Number(selectedValue))) sel.value = selectedValue;
    renderBmHotelAddr();
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
      const keep = sel.value;
      // 予約モーダルと同じ並び（多摩・立川周辺は立川駅から近い順 → 23区 → 埼玉 → 神奈川）に揃える。
      // 件数の多い順だと探しにくい、との店長要望 2026-08-10
      const byCity = {};
      cities.forEach(c => { byCity[String(c.city || '').trim()] = c; });
      const opt = (name) => {
        const c = byCity[name];
        if (!c) return '';
        const pub = Number(c.visited) + Number(c.inquiry);
        return `<option value="${escapeAttr(name)}">${escapeHtml(name)} (公開${pub}/${c.total})</option>`;
      };
      const groups = [
        ['多摩・立川周辺（立川駅から近い順）', CITY_PROXIMITY],
        ['東京23区', CITY_REGIONS.tokyo23 || []],
        ['埼玉県', CITY_REGIONS.saitama || []],
        ['神奈川県', CITY_REGIONS.kanagawa || []],
      ];
      const listed = new Set();
      let html = '<option value="">全市区町村</option>';
      groups.forEach(([label, list]) => {
        const body = list.map(name => { const o = opt(name); if (o) listed.add(name); return o; }).join('');
        if (body) html += `<optgroup label="${escapeAttr(label)}">${body}</optgroup>`;
      });
      // どのグループにも入っていない市区町村（旧データなど）は最後にまとめる
      const rest = cities.map(c => String(c.city || '').trim()).filter(n => n && !listed.has(n));
      if (rest.length) {
        html += '<optgroup label="その他">' + rest.sort((a, b) => a.localeCompare(b, 'ja')).map(opt).join('') + '</optgroup>';
      }
      sel.innerHTML = html;
      if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
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
    const htype = document.getElementById('fHotelType')?.value || '';
    const sort = document.getElementById('fSort')?.value || '';
    if (city) params.set('city', city);
    if (status) params.set('status', status);
    if (kw) params.set('keyword', kw);
    if (htype) params.set('hotel_type', htype);
    if (sort) params.set('sort', sort);

    try {
      const data = await api('/admin-api.php?action=hotels&' + params.toString());
      allHotels = data.hotels || [];
      // 名前順は DB の並びだと ひらがな/カタカナ/漢字 が別々に固まるので、日本語の並び（あいうえお順）で整え直す
      if (sort === 'name') allHotels.sort(byNameJa);
      renderHotels();
    } catch (e) {
      list.innerHTML = '<div class="empty">読み込みに失敗しました: ' + escapeHtml(e.message) + '</div>';
    }
  }

  function statusClass(s) {
    return s ? 'status-' + s : '';
  }

  /**
   * ホテル名から読みを自動で作る。カタカナ→ひらがなに直すだけなので、
   * カタカナ・ひらがなで始まる名前はこれだけで正しい位置に並ぶ。
   * 漢字・英字で始まる名前は読み仮名を手で入れてもらう（emNameKana）。
   */
  function autoKana(name) {
    return String(name || '').trim()
      .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))   // カタカナ→ひらがな
      .replace(/[ー]/g, 'ー');
  }
  /** 並べ替えに使う読み。手入力の読み仮名があればそれ、無ければ名前から自動生成 */
  const kanaKeyOf = (h) => {
    const k = String(h?.name_kana || '').trim();
    return autoKana(k || h?.name || '');
  };
  /** かな以外で始まる名前なのに読み仮名が無い＝あいうえお順の位置がずれるもの */
  const needsKana = (h) => !String(h?.name_kana || '').trim()
    && !/^[ぁ-んァ-ヶ]/.test(String(h?.name || '').trim());
  /** ホテル名の並び（あいうえお順）。ひらがな/カタカナを同じ扱いにし、数字も数として比べる */
  const byNameJa = (a, b) => kanaKeyOf(a).localeCompare(kanaKeyOf(b), 'ja', { numeric: true, sensitivity: 'base' });

  function renderHotels() {
    const list = document.getElementById('hotelList');
    document.getElementById('resultCount').textContent = allHotels.length;
    document.getElementById('filterNote').textContent = selectedIds.size > 0 ? `（${selectedIds.size}件選択中）` : '';

    if (allHotels.length === 0) {
      list.innerHTML = '<div class="empty">条件に該当するホテルがありません</div>';
      updateBulkBar();
      return;
    }

    // 「自分の順番」のときだけ行をドラッグして並べ替えられるようにする
    const manual = (document.getElementById('fSort')?.value || '') === 'manual';
    list.innerHTML = allHotels.map(h => {
      const status = h.status || '';
      const checked = selectedIds.has(h.id);
      return `
        <div class="hotel-row ${statusClass(status)} ${checked ? 'selected' : ''}${manual ? ' sortable' : ''}" data-id="${h.id}"${manual ? ' draggable="true"' : ''}>
          ${manual ? '<div class="drag-handle" title="ドラッグで並べ替え">⠿</div>' : ''}
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
              <span class="${(h.transport_fee === null || h.transport_fee === undefined || h.transport_fee === '') ? 'row-fee-unset' : ''}"><b>交通費:</b> ${(h.transport_fee === null || h.transport_fee === undefined || h.transport_fee === '') ? '未設定' : '¥' + Number(h.transport_fee).toLocaleString()}</span>
              ${h.hotel_type ? `<span class="badge-mini">${hotelTypeLabel(h.hotel_type)}</span>` : ''}
              ${needsKana(h) ? '<span class="badge-mini badge-kana" title="かな以外で始まる名前です。読み仮名を入れるとあいうえお順の正しい位置に並びます">読み未設定</span>' : ''}
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
    if (manual) setupHotelSortable(list);
    updateBulkBar();
  }

  /**
   * ホテル一覧のドラッグ並べ替え（並び順=自分の順番のときだけ）。
   * 表示中の並びをそのまま 1 から振り直す。絞り込み中でも、見えている行の順番だけを保存する。
   */
  function setupHotelSortable(list) {
    let dragSrc = null;
    const clearMarks = () => list.querySelectorAll('.drag-over-top, .drag-over-bottom')
      .forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
    list.querySelectorAll('.hotel-row.sortable').forEach(row => {
      row.addEventListener('dragstart', e => {
        // ボタンやチェックからのドラッグは無視（誤操作防止）
        if (e.target.closest('button, input')) { e.preventDefault(); return; }
        dragSrc = row;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.id);
      });
      row.addEventListener('dragend', () => { row.classList.remove('dragging'); clearMarks(); });
      row.addEventListener('dragover', e => {
        e.preventDefault();
        if (!dragSrc || row === dragSrc) return;
        const rect = row.getBoundingClientRect();
        clearMarks();
        row.classList.add((e.clientY - rect.top) < rect.height / 2 ? 'drag-over-top' : 'drag-over-bottom');
      });
      row.addEventListener('drop', async e => {
        e.preventDefault();
        if (!dragSrc || row === dragSrc) return;
        const rect = row.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        list.insertBefore(dragSrc, before ? row : row.nextSibling);
        clearMarks();
        const ids = [...list.querySelectorAll('.hotel-row.sortable')].map(r => Number(r.dataset.id));
        try {
          await apiPost('/admin-api.php?action=hotel-reorder', { ids });
          // 次に描き直したときも同じ順になるよう、手元のデータも並べ替えておく
          allHotels.sort((a, b) => ids.indexOf(Number(a.id)) - ids.indexOf(Number(b.id)));
          toast('✓ 並び順を保存しました', 'ok');
        } catch (err) {
          toast('並べ替え失敗: ' + err.message, 'err');
          loadHotels();
        }
      });
    });
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
    updateBulkFeeBtn();
    syncSelectAllCheckbox();
  }
  // 「全て選択」チェックボックスの状態を、いま絞り込まれている一覧と選択状況に合わせる
  //（一部だけ選択中は中間表示、全部選択済みならON）
  function syncSelectAllCheckbox() {
    const cb = document.getElementById('selectAllHotels');
    if (!cb) return;
    const total = allHotels.length;
    const selectedInView = allHotels.filter(h => selectedIds.has(h.id)).length;
    cb.checked = total > 0 && selectedInView === total;
    cb.indeterminate = selectedInView > 0 && selectedInView < total;
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
    if (!await opsConfirm(`${label}をリストから削除します。よろしいですか？\n（予約で使用中のホテルは削除せず非表示にします）`)) return;
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

  // 交通費の一括設定（チェックした複数ホテルへまとめて反映・店長要望 2026-08-07）
  async function bulkSetTransportFee() {
    if (selectedIds.size === 0) return;
    const sel = document.getElementById('bulkFeeSelect');
    const raw = sel?.value || '';
    if (raw === '') return;
    const fee = raw === 'unset' ? null : Number(raw);
    const ids = Array.from(selectedIds);
    const label = fee === null ? '未設定' : (fee === 0 ? '無料（¥0）' : `¥${fee.toLocaleString()}`);
    if (!await opsConfirm(`選択中の${ids.length}件の交通費を「${label}」に設定します。よろしいですか？`)) return;
    try {
      await apiPost('/admin-api.php?action=bulk-transport-fee', { hotel_ids: ids, transport_fee: fee });
      toast(`✓ ${ids.length}件の交通費を${label}に設定しました`, 'ok');
      selectedIds.clear();
      if (sel) sel.value = '';
      updateBulkFeeBtn();
      await loadHotels();
    } catch (e) {
      toast('一括設定失敗: ' + e.message, 'err');
    }
  }
  // 選択0件・未選択のときはボタンを押せなくする
  function updateBulkFeeBtn() {
    const btn = document.getElementById('btnBulkFee');
    const sel = document.getElementById('bulkFeeSelect');
    if (btn) btn.disabled = selectedIds.size === 0 || !sel?.value;
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

  /** 手入力のホテル名: 中身があるときだけ開いておく（普段は畳む） */
  function syncFreeHotelWrap() {
    const wrap = bel('bmHotelNameWrap');
    if (!wrap) return;
    wrap.open = !!(bel('bmHotelName')?.value || '').trim();
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
    {
      // 読み仮名。未入力のときは自動で使われる読みをプレースホルダに出しておく
      const kEl = document.getElementById('emNameKana');
      if (kEl) {
        kEl.value = hotel.name_kana || '';
        kEl.placeholder = autoKana(hotel.name) || '（自動）';
      }
    }
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
    // タイプ（ラブホ / ホテル各種）。選択肢に無い古い値はその場で足してから選ぶ
    {
      const tSel = document.getElementById('emHotelType');
      const tv = String(hotel.hotel_type || (isNew ? 'love_hotel' : 'other'));
      if (![...tSel.options].some(o => o.value === tv)) {
        const o = document.createElement('option');
        o.value = tv;
        o.textContent = hotelTypeLabel(tv);
        tSel.appendChild(o);
      }
      tSel.value = tv;
    }
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
    // 交通費（セレクト）: ''=未設定、0=無料、数値=その金額
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
      const typeVal = document.getElementById('emHotelType').value;
      const kanaVal = (document.getElementById('emNameKana')?.value || '').trim();
      const r = await apiPost('/admin-api.php?action=hotel-save', {
        id: editingHotel.id || 0,
        name,
        name_kana: kanaVal,
        city: cityVal,
        prefecture: prefVal,
        address: addrVal,
        tel: document.getElementById('emTel').value.trim(),
        hotel_type: typeVal,
      });
      if (!editingHotel.id) editingHotel.id = r.id;   // 新規は採番された id を使う
      Object.assign(editingHotel, {
        name,
        name_kana: kanaVal || null,
        city: cityVal,
        prefecture: prefVal,
        address: addrVal,
        tel: document.getElementById('emTel').value.trim(),
        hotel_type: typeVal,
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
      internal_memo: document.getElementById('emMemo').value.trim(),
    };
    try {
      await apiPost('/admin-api.php?action=update-info', payload);
      Object.assign(editingHotel, {
        status: payload.status,
        entry_method: payload.entry_method || null,
        room_type_recommended: payload.room_type_recommended || null,
        transport_fee: payload.transport_fee,
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
    // マスタに無いコード（削除済み・過去の不整合データ等）は内部コードのまま出すと文字化けに見えるので、
    // 表示からは落とす（データは残す＝編集画面で開けばチップの状態としては見える）
    return String(m).split(',').map(c => c.trim()).filter(Boolean).map(c => {
      const found = entryMethodsCache.find(e => e.code === c);
      return found ? found.label : fallback[c] || null;
    }).filter(Boolean).join(' / ');
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

  /**
   * スタッフ管理を操作できるか。owner は常に可。それ以外は権限管理（tab_permissions.staff）で
   * チェックの入ったロール（店長要望 2026-08-14: 管理者にスタッフ管理を任せる）。
   * オーナーアカウントの編集・削除・PW再発行はサーバー側で owner のみに制限される
   */
  function canManageStaffTab() {
    // 制限はメニューのチェックだけ。スタッフ管理 か キャスト管理 が見えていれば操作できる（店長指定 2026-08-15）
    return userCanSeeTab('staff') || userCanSeeTab('staffboard');
  }

  // ロール別エンドポイント: スタッフ管理権限あり=全項目(admin-users)、なし=最小リスト(read-only)
  function staffListEndpoint() {
    return canManageStaffTab() ? 'admin-users' : 'staff-list';
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

  // キャスト管理画面の専用URL（admin_user_id → {url, pin_set, ...}）。キャスト管理タブで読む
  let castAccessMap = {};
  let showCastAccess = false;
  async function loadCastAccess() {
    try {
      const d = await api('/admin-api.php?action=cast-access-list');
      castAccessMap = d.access || {};
    } catch (e) { castAccessMap = {}; }
  }
  function castAccessHtml(u) {
    const a = castAccessMap[String(u.id)];
    if (!a || !a.url) {
      return `<div class="sr-access">
        <button class="sra-btn" data-action="cast-url-issue" data-id="${u.id}" type="button">🔑 専用URLを発行</button>
      </div>`;
    }
    const pin = a.pin_set
      ? `<span class="sra-pin is-set">暗証番号 設定済み</span>`
      : `<span class="sra-pin">暗証番号 未設定<span class="sra-note">（次に開いたとき本人が決めます）</span></span>`;
    const locked = a.locked ? '<span class="sra-pin is-locked">ロック中</span>' : '';
    const nm = escapeAttr(u.display_name || u.username);
    return `<div class="sr-access">
      <div class="sra-url"><input type="text" class="sra-url-in" value="${escapeAttr(a.url)}" readonly>
        <button class="sra-copy" data-action="cast-url-copy" data-url="${escapeAttr(a.url)}" type="button" title="コピー">📋</button></div>
      <div class="sra-line">${pin}${locked}
        <button class="sra-btn" data-action="cast-pin-reset" data-id="${u.id}" data-name="${nm}" type="button">リセット</button>
        <button class="sra-btn is-warn" data-action="cast-url-issue" data-id="${u.id}" data-renew="1" data-name="${nm}" type="button">URLを作り直す</button>
      </div>
      <div class="sra-line">
        <input type="text" class="sra-pin-in" id="sraPin${u.id}" inputmode="numeric" maxlength="4" placeholder="□□□□" autocomplete="off">
        <button class="sra-btn" data-action="cast-pin-set" data-id="${u.id}" data-name="${nm}" type="button">この番号にする</button>
        <span class="sra-note">店長が決めて本人に伝えます</span>
      </div>
    </div>`;
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
    const roleLabel = u.role === 'owner' ? 'オーナー' : u.role === 'manager' ? '管理者' : u.role === 'office' ? '内勤スタッフ' : u.role === 'driver' ? 'ドライバー' : 'キャスト';
    // 主ロールとは別の兼任（例: 橘=店長＋キャスト兼任＋内勤兼任）をラベルに追記
    const concurrentLabels = [];
    if (u.role !== 'staff' && Number(u.is_therapist) === 1) concurrentLabels.push('キャスト');
    if (u.role !== 'office' && Number(u.is_office) === 1) concurrentLabels.push('内勤');
    if (u.role !== 'driver' && Number(u.can_drive) === 1) concurrentLabels.push('ドライバー');
    const roleLabelFull = roleLabel + (concurrentLabels.length ? `（${concurrentLabels.join('・')}兼任）` : '');
    // 報酬はマスタのコース別「キャスト報酬」で決まるので歩合率(%)は使わない＝一覧にも出さない
    //（店長指定 2026-08-06）
    const metaText = u.created_at ? `登録: ${formatDate(u.created_at)}` : '&nbsp;';
    // ドライバー(専任 or 兼任)には送迎・勤務実績の詳細ボタン
    const isDriverRow = isDriverCapable(u);
    const driverBtn = isDriverRow ? `<button class="sr-driver" data-action="driver-detail" data-id="${u.id}" type="button" style="margin-top:.3rem;padding:.28rem .7rem;font-size:.74rem;font-weight:700;border:1.5px solid var(--sea);color:var(--sea);background:#fff;border-radius:50px;cursor:pointer;">🚗 送迎・勤務</button>` : '';
    // キャスト管理画面（biyobu.com/cosmenote/）の専用URLと暗証番号の状態。
    // 本人に渡すもの＝URL。暗証番号は本人が決めたものを取り出せない形で持っているので、
    // 分からなくなったらリセットして決め直してもらう（店長要望 2026-08-11）
    const accessHtml = (showCastAccess && isTherapistCapable(u)) ? castAccessHtml(u) : '';
    const meta = `${metaText}${driverBtn ? '<br>' + driverBtn : ''}${accessHtml}`;
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

  // スタッフ管理タブ = 運営側のみ（role≠staff）。操作可否は権限管理のスタッフ管理チェックに従う
  function renderAdminUsers() {
    const el = document.getElementById('staffTable');
    const canManage = canManageStaffTab();
    const addBtn = document.getElementById('btnAddStaff');
    if (addBtn) addBtn.style.display = canManage ? '' : 'none';
    const ops = allUsers.filter(u => u.role !== 'staff');
    if (!ops.length) { el.innerHTML = '<div class="empty">運営スタッフがいません</div>'; return; }
    el.innerHTML = ops.map(u => staffRowHtml(u, { drag: canManage, actions: canManage })).join('');
    if (canManage) setupStaffSortable('staffTable');
  }

  // ===== キャスト一覧の並び替え（店長要望 2026-08-11。CTRL の出勤管理と同じ考え方）=====
  //   manual  … 手動（sort_order。ドラッグで並べ替え）
  //   in_date … 入店順。新しく入った子が上（CTRL と同じ in_date DESC）
  //   work    … 出勤頻度順。出勤（予定・終了ふくむ）の日数が多い順
  //   kana    … あいうえお順。源氏名の読みで並べる（カタカナはひらがなに寄せる）
  let sbSort = 'manual';
  try { sbSort = localStorage.getItem('opsCastSort') || 'manual'; } catch (e) {}
  const SB_SORT_NOTE = {
    in_date: '入店日の新しい順です',
    work: '出勤日数の多い順です',
    kana: '源氏名のあいうえお順です',
  };
  function sortTherapists(list) {
    const arr = list.slice();
    if (sbSort === 'in_date') {
      arr.sort((a, b) => String(b.in_date || '').localeCompare(String(a.in_date || ''))
        || Number(b.id) - Number(a.id));
    } else if (sbSort === 'work') {
      arr.sort((a, b) => (Number(b.work_days) || 0) - (Number(a.work_days) || 0)
        || String(b.in_date || '').localeCompare(String(a.in_date || '')));
    } else if (sbSort === 'kana') {
      arr.sort((a, b) => kanaKeyOf({ name: a.display_name || a.username })
        .localeCompare(kanaKeyOf({ name: b.display_name || b.username }), 'ja', { numeric: true, sensitivity: 'base' }));
    }
    return arr;   // manual は API の sort_order 順のまま
  }

  // キャスト管理タブ = role=staff、または is_therapist 兼任者（例: 橘=manager+is_therapist）の一覧
  function renderTherapistBoard() {
    const el = document.getElementById('staffBoard');
    if (!el) return;
    // このタブを開ける人は中の操作も全部できる（制限は上のメニューだけ・店長指定 2026-08-15）
    const isOwner = currentUser?.role !== 'staff';
    const addBtn = document.getElementById('btnAddTherapist');
    if (addBtn) addBtn.style.display = isOwner ? '' : 'none';
    const ths = sortTherapists(allUsers.filter(u => isTherapistCapable(u)));
    if (!ths.length) { el.innerHTML = '<p style="color:var(--ink-soft);padding:1.5rem 0;text-align:center;">キャストが登録されていません。</p>'; return; }
    // 手動（ドラッグ）以外の並びのときは、動かしても保存されないので掴めなくする
    const manual = sbSort === 'manual';
    showCastAccess = true;
    el.innerHTML = ths.map(u => staffRowHtml(u, { drag: isOwner && manual, actions: isOwner })).join('');
    showCastAccess = false;
    const note = document.getElementById('sbSortNote');
    if (note) note.textContent = manual ? '' : SB_SORT_NOTE[sbSort] || '';
    if (isOwner && manual) setupStaffSortable('staffBoard');
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

  // 予約モーダルのNG警告。電話番号でお客様が当たった時点と、担当キャストを選んだ時点の
  // 両方で出す（どちらが先でも気づけるように）。モーダル①②で別々に持つ。
  const bmNg = { '': null, '-2': null };   // {level, reason, castIds:[]}

  function setBookingNg(info) {
    bmNg[activeBmSuffix] = info;
    renderNgAlert();
  }
  /** 電話番号からNG情報だけ取り直す（予約編集を開いたとき用。名前欄などは触らない） */
  async function refreshBookingNg(phone) {
    const p = String(phone || '').trim();
    if (!p) { setBookingNg(null); return; }
    try {
      const d = await api('/customers.php?action=find-by-phone&phone=' + encodeURIComponent(p));
      setBookingNg(d.customer
        ? { level: Number(d.customer.ng_level || 0), reason: d.customer.ng_reason || '', castIds: d.ng_cast_ids || [] }
        : null);
    } catch (e) { setBookingNg(null); }
  }

  function renderNgAlert() {
    const ng = bmNg[activeBmSuffix];
    const box = bel('bmNgAlert');
    const castBox = bel('bmNgCastAlert');
    if (box) {
      const lv = Number(ng?.level || 0);
      box.className = 'bm-ng-alert' + (lv ? ' lv' + lv : '');
      box.style.display = lv ? 'block' : 'none';
      box.textContent = lv
        ? `⚠️ ${lv === 2 ? '出禁' : '要注意'}のお客様です${ng.reason ? '（' + ng.reason + '）' : ''}`
        : '';
    }
    if (castBox) {
      const id = Number(bel('bmAdminId')?.value || 0);
      const hit = id && (ng?.castIds || []).map(Number).includes(id);
      const u = hit ? findStaffUser(id) : null;
      castBox.className = 'bm-ng-alert' + (hit ? ' lv2' : '');
      castBox.style.display = hit ? 'block' : 'none';
      castBox.textContent = hit ? `⚠️ ${u?.display_name || ''} はこのお客様NGです` : '';
      // 選んでいるキャストをその場でNGにできるボタン（店長要望 2026-08-22）
      const ngBtn = bel('bmNgCastBtn');
      if (ngBtn) {
        const custId = Number(bel('bmCustomerId')?.value || 0);
        const show = !!id;
        ngBtn.style.display = show ? 'inline-block' : 'none';
        ngBtn.classList.toggle('is-on', !!hit);
        ngBtn.textContent = hit ? '🚫 NG解除' : '🚫 NG';
        ngBtn.disabled = !custId;
        ngBtn.title = !custId
          ? 'お客様が特定できてからNGにできます（電話番号を入れるか、保存してから）'
          : (hit ? 'このお客様のNGから外す' : '選んでいるキャストをこのお客様のNGにする');
      }
    }
  }

  // 担当キャストの注意事項（猫アレルギー等）を予約モーダルに出す。
  // 「予約を取る前に確認したい」ものなので、モーダル本文の一番上に赤帯で表示する。
  // 注: adminUsersAll は一度読んだらキャッシュされるため、注意事項を書き足した直後に
  //     別画面から開くと古い値のことがある。保存時に両キャッシュを更新している。
  function renderCastAlert() {
    // 担当キャストの注意事項はヘッダーに小さく出す（本文の一等地を使わない・店長指定 2026-08-05）
    const box = bel('bmCastAlertHead') || bel('bmCastAlert');
    if (!box) return;
    const id = bel('bmAdminId')?.value;
    const u = id ? findStaffUser(id) : null;
    const note = (u?.cast_notes || '').trim();
    box.style.display = note ? 'block' : 'none';
    box.textContent = note ? `⚠️ ${note}` : '';
    box.title = note ? `${u.display_name || ''}：${note}` : '';
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
    // ログインID = username、メールアドレス = email（分離）
    const esLoginId = document.getElementById('esLoginId');
    if (esLoginId) esLoginId.value = u.username || '';
    const esEmail = document.getElementById('esEmail');
    if (esEmail) esEmail.value = u.email || '';
    // 写メ日記（URL/ID/PASS）
    { const el = document.getElementById('esDiaryUrl');   if (el) el.value = u.diary_url || ''; }
    { const el = document.getElementById('esDiaryLogin'); if (el) el.value = u.diary_login || ''; }
    { const el = document.getElementById('esDiaryPass');  if (el) el.value = u.diary_pass || ''; }
    // キャスト画面の「出勤確認」ボタンを出すか（既定は非表示）
    { const el = document.getElementById('esSelfConfirm'); if (el) el.checked = Number(u.self_confirm_shift) === 1; }
    // 預り金カードの色（内勤以上）。他のスタッフが使用中の色は選べない（誰の現金か見分ける色のため・店長要望 2026-08-14）
    { const el = document.getElementById('esColor');
      if (el) {
        const roster = (allUsers && allUsers.length ? allUsers : adminUsersAll) || [];
        const used = {};
        roster.forEach(x => { if (x.staff_color && Number(x.id) !== Number(u.id)) used[String(x.staff_color).toLowerCase()] = x.display_name || x.username; });
        Array.from(el.options).forEach(o => {
          if (!o.dataset.base) o.dataset.base = o.textContent;
          const holder = o.value ? used[o.value.toLowerCase()] : '';
          o.disabled = !!holder;
          o.textContent = holder ? `${o.dataset.base}（${holder} 使用中）` : o.dataset.base;
        });
        el.value = u.staff_color || ''; if (el.value !== (u.staff_color || '')) el.value = '';   // 一覧に無い旧値は「なし」扱い
        const pv = document.getElementById('esColorPreview'); if (pv) pv.style.background = el.value || 'transparent';
      } }
    // CTRL から同期したキャスト(girl_id あり)は権限=キャスト固定。
    // 権限/兼任/歩合率はスタッフ管理でのみ扱う
    const isCast = u.girl_id != null && u.girl_id !== '';
    editingStaffIsCast = isCast;
    const staffOnly = document.getElementById('esStaffOnlyFields');
    if (staffOnly) staffOnly.style.display = isCast ? 'none' : '';
    const castNote = document.getElementById('esCastNote');
    if (castNote) castNote.style.display = isCast ? '' : 'none';
    // 注意事項は「予約を取る前にキャストについて確認すること」なのでキャスト編集のときだけ出す
    const notesField = document.getElementById('esCastNotesField');
    if (notesField) notesField.style.display = isCast ? '' : 'none';
    // 写メ日記はキャストだけに出す（内勤・ドライバーには不要）
    const diaryField = document.getElementById('esDiaryField');
    if (diaryField) diaryField.style.display = isCast ? '' : 'none';
    const selfConfirmField = document.getElementById('esSelfConfirmField');
    if (selfConfirmField) selfConfirmField.style.display = isCast ? '' : 'none';
    const esTitle = document.getElementById('esTitle');
    if (esTitle) esTitle.textContent = isCast ? 'キャスト編集' : 'スタッフ編集';

    const esNotes = document.getElementById('esCastNotes');
    if (esNotes) esNotes.value = u.cast_notes || '';
    // 注意事項は店長も編集できる（cast-note-update）。それ以外の項目はスタッフ管理権限（権限管理で許可）。
    // ただしオーナーのアカウントは owner のみ編集可（サーバー側と同じ制限）
    const canEditAll = canManageStaffTab() && !(u.role === 'owner' && currentUser?.role !== 'owner');
    ['esName', 'esLoginId', 'esEmail', 'esThumbFile', 'esThumbRemove'].forEach(id => {
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
    syncConcurrentFields('es', u.role);
    const me = Number(currentUser?.id) === Number(u.id);
    document.getElementById('esRoleHint').textContent = me ? '⚠️ 自分自身の権限は変更できません' : '';
    document.querySelectorAll('[data-es-role]').forEach(b => {
      // オーナー権限の付与は owner のみ（サーバー側と同じ制限）
      const lock = me || (b.dataset.esRole === 'owner' && currentUser?.role !== 'owner');
      b.disabled = lock; b.style.opacity = lock ? .5 : 1;
    });
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
    // 他項目はスタッフ管理権限（権限管理で許可されたロール）。オーナーのアカウントは owner のみ。
    // 権限がない場合は注意事項だけ保存して終了（従来の店長の挙動）
    if (!canManageStaffTab() || (editingStaffRole === 'owner' && currentUser?.role !== 'owner')) {
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
      payload.staff_color = document.getElementById('esColor')?.value || '';   // 預り金カード色（空=なし）
    }
    // ログインID（username）変更時のみ送信
    const loginIdVal = (document.getElementById('esLoginId')?.value || '').trim();
    if (loginIdVal && loginIdVal !== editingStaffUsername) {
      if (!/^[A-Za-z0-9@._-]{2,190}$/.test(loginIdVal)) { toast('ログインIDは半角英数字・記号(@._-)で入力してください', 'err'); return; }
      payload.login_id = loginIdVal;
    }
    // メールアドレス（送迎メール送信先）。空にもできる（未設定）ので常に送る
    const emailVal = (document.getElementById('esEmail')?.value || '').trim();
    if (emailVal !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailVal)) { toast('メールアドレスの形式が正しくありません', 'err'); return; }
    payload.email = emailVal;
    // 写メ日記（URL/ID/PASS）はキャストのみ。空にもできるので常に送る
    if (editingStaffIsCast) {
      payload.diary_url = (document.getElementById('esDiaryUrl')?.value || '').trim();
      payload.diary_login = (document.getElementById('esDiaryLogin')?.value || '').trim();
      payload.diary_pass = (document.getElementById('esDiaryPass')?.value || '').trim();
      payload.self_confirm_shift = document.getElementById('esSelfConfirm')?.checked ? 1 : 0;
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
    const loginId = document.getElementById('csLoginId').value.trim();
    const email = document.getElementById('csEmail').value.trim();
    const password = document.getElementById('csPassword').value;
    const displayName = document.getElementById('csName').value.trim();
    if (!loginId || !password || !displayName) {
      toast('表示名・ログインID・パスワードは必須です', 'err');
      return;
    }
    if (!/^[A-Za-z0-9@._-]{2,190}$/.test(loginId)) {
      toast('ログインIDは半角英数字・記号(@._-)で入力してください', 'err');
      return;
    }
    if (email !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast('メールアドレスの形式が正しくありません', 'err');
      return;
    }
    if (password.length < 8) {
      toast('パスワードは8文字以上必要です', 'err');
      return;
    }
    // 歩合率の入力欄は廃止（報酬はマスタのコース別「キャスト報酬」で決まる）。
    // DB のカラムは残っているので既定値だけ入れておく
    const rate = 50;
    try {
      await apiPost('/admin-api.php?action=admin-create', {
        login_id: loginId, email, password, display_name: displayName, role: createRole, commission_rate: rate,
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
    if (!await opsConfirm(`「${name}」を削除しますか？\nログインできなくなります。`)) return;
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
    // 中身のスクロールも先頭に戻す。前に開いたときの位置が残っていると、
    // 開いた直後が途中から表示されて上の項目が見えない（店長指摘 2026-08-08 予約編集）。
    // 実際にスクロールしているのは .modal 自身（overflow-y:auto）。ここを外していたため
    // 電話番号を入れて開いたときに下の方が出ていた（店長指摘 2026-08-09）。
    // show の直後はまだレイアウト前のことがあり、顧客履歴の読み込みで高さも変わるので、
    // 次フレームと少し後にもう一度当てる。
    const toTop = () => {
      overlay.scrollTop = 0;
      overlay.querySelectorAll('.modal, .modal-body, .bm-cols, .bm-col').forEach(el => { el.scrollTop = 0; });
    };
    toTop();
    requestAnimationFrame(() => { toTop(); requestAnimationFrame(toTop); });
    setTimeout(toTop, 200);   // 履歴の読み込みで高さが変わったあと
  }
  function closeModal(id) {
    if (id === 'bookingModal') releaseBookingLock('');
    else if (id === 'bookingModal-2') releaseBookingLock('-2');
    document.getElementById(id).classList.remove('show');
  }

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
  /**
   * 新規予約の開始時刻の既定値。
   *   その営業日（＝今まさに受けている日）なら現在時刻に近い値、
   *   別の日を選んだら開店の10:00。手で入れた時刻は上書きしない側で制御する。
   * 深夜0〜9時台は前営業日の扱いなので、その時間帯も「今日」として現在時刻を返す。
   */
  function defaultStartFor(dateStr) {
    const biz = fmtDate(getBusinessDayDate());
    if (dateStr && dateStr !== biz) return { h: 10, m: 0 };   // 別の日 → 開店時刻
    const now = new Date();
    return { h: now.getHours(), m: now.getMinutes() };
  }

  let tlCurrentDate = getBusinessDayDate();  // 1日分のタイムライン (営業日基準)
  let adminUsersAll = [];      // {id, username, display_name, role}
  // カード会社へ払う手数料率(%)。init で card-fee-get から取得。お客様の決済総額（上乗せ後）にかかる。
  // アドミはキャストに負担させない（報酬は決済方法で変わらない）ので、まるごと店の経費
  let CARD_FEE_RATE = 3;
  // クレジット決済でお客様の合計に上乗せする手数料率(%)。上の CARD_FEE_RATE(キャスト負担用)とは別物
  let CARD_SURCHARGE_RATE = 10;
  const NOMINATION_FEES = { first: 0, regular: 0, free: 0 };  // 指名料(固定額)。init で nomination-fees-get から取得
  const nominationFeeFor = (type) => NOMINATION_FEES[type] || 0;
  // 指名料のうちキャストへ支払う報酬。お客様の指名料とは別に設定する（店長要望 2026-08-08）
  const NOMINATION_REWARDS = { first: 0, regular: 0, free: 0 };
  const nominationRewardFor = (type) => NOMINATION_REWARDS[type] || 0;
  /**
   * コースの本数。組み合わせ（90分コース ＋ 90分コース）は2本。
   * 指名料も指名の報酬も、この本数ぶんかかる（店長指定 2026-08-08）。
   * ＋10分は LINE 特典の無料延長なので本数に数えない
   */
  function courseUnitCount(courseName) {
    const cname = String(courseName || '').replace(/\s*＋\s*10\s*分\s*$/, '').trim();
    if (!cname) return 1;
    return Math.max(1, cname.split(/\s*[＋+]\s*/).map(x => x.trim()).filter(Boolean).length);
  }
  /**
   * 延長1回あたりのキャスト報酬。コースマスタの「延長」コースの キャスト報酬 を使う
   *（コース選択肢からは外しているので、コース名には出てこない・店長指摘 2026-08-08）
   */
  function extensionRewardUnit() {
    const c = (coursesCache || []).find(x => /延長/.test(String(x.name || '')));
    if (!c || c.cast_reward == null || c.cast_reward === '') return 0;
    return parseInt(c.cast_reward, 10) || 0;
  }
  let tlBookings = [];
  let tlShifts = [];
  let tlDayFlags = {};   // 「貴重品お預かり」「釣銭お渡し」その日・その人ぶん（"admin_id|YYYY-MM-DD" → {valuables, change_given}）
  let tlPlayNow = {};        // 今から遊べる時間（即姫）: admin_user_id → {hm, closed}
  let hotelsForSelect = [];    // selectで使う簡易ホテル一覧
  let bookingsList = [];
  let legacyVisitsList = [];   // 予約一覧に混ぜる旧システムの利用履歴
  let customersList = [];
  // primary('')/secondary('-2') それぞれで別の予約を編集できるため、suffix別に保持する
  const editingBookingIdBySuffix = { '': null, '-2': null };
  const getEditingBookingId = () => editingBookingIdBySuffix[activeBmSuffix] ?? null;
  const setEditingBookingId = (v) => { editingBookingIdBySuffix[activeBmSuffix] = v; };

  // ===== 予約の同時編集ロック =====
  // モーダルを開いたらサーバーにロックを立て、他の端末は読み取り専用で開く。
  // 30秒ごとに延長・90秒で自動失効（閉じ忘れ・スリープ対策）。
  // すり抜けた場合の砦は保存時の expected_updated_at チェック（サーバー側 409）。
  const _bmLockToken = 'lk' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const _bmLock = { '': null, '-2': null };
  const _bmLoadedUpdatedAt = { '': '', '-2': '' };

  function applyBookingLockUi(suffix, lockedBy) {
    const belS = (i) => document.getElementById(i + suffix);
    let note = belS('bmLockNotice');
    if (lockedBy) {
      if (!note) {
        const body = document.querySelector(`#bookingModal${suffix} .modal-body`);
        if (body) {
          note = document.createElement('div');
          note.id = 'bmLockNotice' + suffix;
          note.className = 'bm-lock-notice';
          body.prepend(note);
        }
      }
      if (note) {
        note.textContent = `⚠️ ${lockedBy}さんがこの予約を編集中です（読み取り専用で表示しています）`;
        note.style.display = 'block';
      }
    } else if (note) {
      note.style.display = 'none';
    }
    ['bmSave', 'bmDelete'].forEach(i => { const el = belS(i); if (el) el.disabled = !!lockedBy; });
  }

  function releaseBookingLock(suffix) {
    const st = _bmLock[suffix];
    _bmLock[suffix] = null;
    if (st && st.timer) clearInterval(st.timer);
    if (st && !st.readonly) apiPost('/bookings.php?action=unlock', { id: st.id, token: _bmLockToken }).catch(() => {});
    applyBookingLockUi(suffix, null);
  }

  async function acquireBookingLock(id) {
    const suffix = activeBmSuffix;
    releaseBookingLock(suffix);
    let denied = null;
    try {
      const r = await apiPost('/bookings.php?action=lock', { id, token: _bmLockToken });
      if (r && r.ok === false) denied = r.locked_by || '別の端末';
    } catch (e) { /* 通信失敗はロックなしで続行（保存時チェックが砦） */ }
    const st = { id, timer: null, readonly: !!denied };
    _bmLock[suffix] = st;
    if (!denied) {
      st.timer = setInterval(() => {
        apiPost('/bookings.php?action=lock', { id, token: _bmLockToken }).then(r => {
          if (r && r.ok === false) {   // 失効の隙に他端末へ渡った → こちらを読み取り専用に落とす
            st.readonly = true;
            applyBookingLockUi(suffix, r.locked_by || '別の端末');
            clearInterval(st.timer); st.timer = null;
          }
        }).catch(() => {});
      }, 30000);
    }
    applyBookingLockUi(suffix, denied);
  }

  // ページを離れるときは即返す（失効を待たせない）
  window.addEventListener('pagehide', () => {
    ['', '-2'].forEach(sfx => {
      const st = _bmLock[sfx];
      if (st && !st.readonly && navigator.sendBeacon) {
        navigator.sendBeacon(API + '/bookings.php?action=unlock',
          new Blob([JSON.stringify({ id: st.id, token: _bmLockToken })], { type: 'application/json' }));
      }
    });
  });
  let editingCustomerId = null;
  let editingShiftId = null;
  // 内勤・送迎シフトの表示開始日。日付の切り替わりは 10:00（営業日）。
  // 深夜0〜9時台はまだ前日の営業日なので、暦日の new Date() では1日先に飛んでしまう（店長指摘 2026-08-11）
  let shCurrent = getBusinessDayDate();
  let shSelectedStaff = '';
  let shViewMode = 'timetable';  // 'timetable' (10日) | 'calendar' (月)
  let shCachedShifts = [];       // タイムテーブルの自動保存で参照
  let shStaffList = [];          // 内勤・送迎シフトの対象スタッフ（キャストは除く）。一覧グリッドの行に使う
  let coursesCache = [];
  let editingCourseId = null;

  function fmtDate(d) { return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function dowLabel(d) { return ['日','月','火','水','木','金','土'][d.getDay()]; }
  /**
   * 予約モーダルの日付欄の上に重ねる表示（店長要望 2026-08-16）。
   *   年は出さず「8/15（土）」＋ 当日なら「本日」、先の日付なら「前日」（＝前日までに受けた予約）の目印。
   * 営業日は10:00区切りなので、当日判定は getBusinessDayDate() と突き合わせる
   */
  function syncBmDateDisp() {
    const inp = bel('bmDate');
    const disp = bel('bmDateDisp');
    if (!inp || !disp) return;
    const v = String(inp.value || '');
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) { disp.textContent = ''; return; }
    const today = fmtDate(getBusinessDayDate());
    const pill = v === today ? '<span class="bmd-pill is-today">本日</span>'
               : (v > today ? '<span class="bmd-pill is-adv">前日</span>' : '');
    disp.innerHTML = `<span>${parseInt(m[2], 10)}/${parseInt(m[3], 10)}（${dowLabel(new Date(v))}）</span>${pill}`;
  }

  /** 日付欄の上に重ねる表示（年なし・曜日つき）。input[type=date] の value(YYYY-MM-DD)から作る（店長指摘 2026-08-16） */
  function syncDateDisp() {
    const dp = document.getElementById('tlDatePicker');
    const disp = document.getElementById('tlDateDisp');
    if (!dp || !disp) return;
    const m = String(dp.value || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
    disp.textContent = m ? `${parseInt(m[1], 10)}/${parseInt(m[2], 10)}（${dowLabel(new Date(dp.value))}）` : '';
  }

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
    const combo = course2Minutes();
    if (combo) return combo;   // 組み合わせを選んでいればそれが全体の分数
    const b = bonusCourse();
    return b ? (parseInt(b.duration_min, 10) || 0) : (parseInt(bel('bmCourse').value || '0', 10) || 0);
  }
  /** 組み合わせコースの合計分数（未選択なら0） */
  function course2Minutes() {
    return parseInt(bel('bmCourse2')?.value || '0', 10) || 0;
  }
  /** 組み合わせ2本目の選択肢（未選択なら null） */
  function course2Opt() {
    const sel = bel('bmCourse2');
    if (!sel || !sel.value) return null;
    return sel.options[sel.selectedIndex] || null;
  }
  /**
   * ＋10分（無料）を付けるかどうか。チェックボックスの状態がそのまま答え。
   * 自動で入る条件（店長指定 2026-08-05）:
   *   ・LINE予約のお客様
   *   ・当店が初めてのお客様が媒体を見て来たとき
   * ただし「お店が初めてでも媒体を見ていない」ときなど外したい場合があるので、
   * 手でチェックを触ったら以後そちらを優先する。
   */
  function bonusApplies() {
    if (bel('bmBreakMode')?.checked) return false;
    return !!bel('bmPlus10')?.checked;
  }
  /**
   * 自動判定の答え（チェックを手で触っていないときだけ反映する）。
   * 媒体・LINEのどれかにチェックが入っていれば付ける。
   * 以前は「LINE は常時／それ以外はご新規様のみ」だったが、ホテルから電話をかけてくるお客様など
   * 新規かどうかを判定できない場面が多く、媒体を選んでも付かないことがあった（店長指定 2026-08-08）。
   * 媒体を見ていないお客様のときは、チェックを手で外せば外れたままになる。
   */
  function plus10Auto() {
    if (bel('bmBreakMode')?.checked) return false;
    return getBmMedia().length > 0;
  }
  /**
   * ＋10分が付くとき、選択中コースに「＋10分のときのコース」が設定されていればそれを返す。
   * 差し替えたときは分数・料金・コース名ごとそのコースの値を使う（10分の追加はしない）。
   */
  function bonusCourse() {
    if (!bonusApplies()) return null;
    const sel = bel('bmCourse');
    const opt = sel && sel.options[sel.selectedIndex];
    const bid = opt && opt.dataset ? opt.dataset.bonusId : '';
    if (!bid) return null;
    return (coursesCache || []).find(c => String(c.id) === String(bid)) || null;
  }
  /**
   * 保存・コピー・要約に使うコース名。
   * ・「＋10分のときのコース」に差し替わっていれば、そのコース名（分数が名前に入っている）
   * ・そうでなく＋10分が付くときは「60分コース ＋10分」のように付けて記録に残す（店長指定 2026-08-05）
   */
  function bmCourseName(opt) {
    const o2 = course2Opt();
    if (o2) {
      // 組み合わせコース。中身（90分コース ＋ 90分コース）をそのまま記録する
      const nm = (o2.dataset && o2.dataset.name) || o2.text || '';
      return nm && lineBonusExtra() > 0 ? nm + ' ＋10分' : nm;
    }
    const b = bonusCourse();
    const base = b ? b.name : ((opt && opt.dataset && opt.dataset.name) || (opt && opt.text) || '');
    return base && !b && lineBonusExtra() > 0 ? base + ' ＋10分' : base;
  }
  /**
   * 1本目（基本）のコース料金。＋10分の差し替えとホテル料金を反映して返す。
   * 選べていなければ null。{ price, hotel, name }
   */
  function courseBasePrice() {
    const sel = bel('bmCourse');
    const opt = sel && sel.options[sel.selectedIndex];
    if (!sel || !sel.value || !opt) return null;
    const b = bonusCourse();
    const nameOf = (o) => (o && o.dataset && o.dataset.name) || (o && o.text) || '';
    const row = firstCourseRow();
    const useHotel = !!(bel('bmHotelFirst')?.checked && !bel('bmBreakMode')?.checked
      && row && row.hotel_price != null && row.hotel_price !== '');
    if (useHotel) return { price: parseInt(row.hotel_price, 10) || 0, hotel: true, name: b ? b.name : nameOf(opt) };
    if (b) return { price: b.price != null ? parseInt(b.price, 10) || 0 : null, hotel: false, name: b.name };
    const p = (opt.dataset && opt.dataset.price !== '') ? parseInt(opt.dataset.price, 10) || 0 : null;
    return { price: p, hotel: false, name: nameOf(opt) };
  }
  /** いまのコース選択（＋10分の差し替え・組み合わせ2本目を含む）の合計料金。取れなければ null */
  function coursePriceSum() {
    const o2 = course2Opt();
    if (o2) return parseInt(o2.dataset.price, 10) || 0;   // 組み合わせを選んでいればそれが全体の料金
    const base = courseBasePrice();
    if (!base || base.price === null) return null;
    return base.price;
  }
  /**
   * コース欄の金額メモ（指名方法の下）。
   * お客様にそのまま説明できるよう、組み合わせは1本ずつ並べる。
   *   90分コース  ¥16,500
   *   90分コース  ¥16,500
   *   計          ¥33,000
   */
  function updateCourseCalc() {
    const box = bel('bmCourseCalc');
    if (!box) return;
    const yen = (n) => '¥' + (Number(n) || 0).toLocaleString();
    const o2   = course2Opt();
    const base = courseBasePrice();
    if (bel('bmBreakMode')?.checked || (!base && !o2)) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    let lines = [];
    const add = lineBonusExtra();   // 無料の＋10分（コース差し替えのときは0）
    if (o2) {
      try { lines = JSON.parse(o2.dataset.lines || '[]'); } catch (e) { lines = []; }
      if (!lines.length) lines = [{ name: o2.dataset.name || '組み合わせ', price: parseInt(o2.dataset.price, 10) || 0 }];
      // 組み合わせは本数ぶん並んでいるので、＋10分は別行にして「無料」だと分かるようにする
      if (add > 0) lines.push({ name: `＋${add}分サービス`, price: 0 });
    } else if (base && base.price !== null) {
      // ＋10分が付くときは「70分（60＋10）」と読み上げられる形にする
      const m = parseInt(bel('bmCourse')?.value || '0', 10) || 0;
      const name = add > 0
        ? (m ? `${m + add}分（${m}＋${add}）` : `${base.name || 'コース'} ＋${add}分`)
        : (base.name || 'コース');
      lines = [{ name, price: base.price, hotel: base.hotel }];
    }
    const rows = bel('bmCcRows');
    if (rows) {
      rows.innerHTML = lines.map(l =>
        `<div class="bm-ccalc-r"><span>${l.hotel ? '🏨 ' : ''}${escapeHtml(l.name || '')}</span><b>${yen(l.price)}</b></div>`
      ).join('') || '<div class="bm-ccalc-r bm-cc-off"><span>コース</span><b>—</b></div>';
    }
    const sum = coursePriceSum();
    const tEl = bel('bmCcTotal');
    if (tEl) tEl.textContent = sum === null ? '—' : yen(sum);
  }
  /** コース選択が変わったら基本料金を入れ直す */
  function applyCoursePrice() {
    const sum = coursePriceSum();
    if (sum === null) return;
    setMoney('bmPrice', String(sum));
    updateBookingTotal();
  }
  /** ＋10分コースを持つコースのときだけ、媒体チェックの切替に合わせて料金を入れ直す */
  function applyBonusCoursePrice() {
    const sel = bel('bmCourse');
    const opt = sel && sel.options[sel.selectedIndex];
    if (!sel || !sel.value || !opt || !opt.dataset || !opt.dataset.bonusId) return;
    applyCoursePrice();
  }
  // bmCourse select を coursesCache から動的生成
  /**
   * 組み合わせコース（180分〜10時間・30分刻み）の選択肢を作る。
   * 180分以上の単独コースは無く「90＋90」のように足す運用なので、
   * 登録済みコース＋延長30分の組み合わせから **いちばん安くなる組み合わせ** を分数ごとに計算して並べる。
   * 例: 180分 → 90＋90（¥33,000）／150＋延長30（¥41,800）より安いのでこちらを採用。
   * 組み合わせには割引が無いので、コース欄とは別の段（2つ目のプルダウン）に置く。
   */
  const COMBO_MAX_MIN = 600;   // 10時間
  function populateComboSelect(hotelFirstOn) {
    const sel2 = bel('bmCourse2');
    if (!sel2) return;
    const prev2 = sel2.value;
    // 使える単位はコース管理で「組み合わせコースの部品に使う」を入れたコースだけ。
    // 延長・お泊りコースは単独で使うものなので材料にしない（店長指定 2026-08-06）
    const units = [];
    (coursesCache || []).filter(c => c.is_active == 1 && Number(c.is_combinable) !== 0).forEach(c => {
      const min = parseInt(c.duration_min, 10) || 0;
      const price = parseInt(c.price, 10) || 0;
      if (min <= 0 || !price) return;
      units.push({
        min, price, name: c.name,
        label: String(min),
        hotel: (c.hotel_price != null && c.hotel_price !== '') ? (parseInt(c.hotel_price, 10) || 0) : null,
      });
    });
    const step = 30;
    // 本数がいちばん少ない組み合わせを優先。同数なら安い方、それも同じなら均等に割れている方
    // （180分は 120＋60 と 90＋90 が同額。店の言い方に合わせて 90＋90 を採る）
    const spread = (parts) => {
      if (!parts.length) return 0;
      const mins = parts.map(x => x.min);
      return Math.max(...mins) - Math.min(...mins);
    };
    const better = (a, b) => {
      if (!b) return true;
      if (a.parts.length !== b.parts.length) return a.parts.length < b.parts.length;
      if (a.price !== b.price) return a.price < b.price;
      return spread(a.parts) < spread(b.parts);
    };
    const best = { 0: { price: 0, parts: [] } };
    for (let t = step; t <= COMBO_MAX_MIN; t += step) {
      let cur = null;
      units.forEach(u => {
        const prev = best[t - u.min];
        if (!prev) return;
        const cand = { price: prev.price + u.price, parts: prev.parts.concat([u]) };
        if (better(cand, cur)) cur = cand;
      });
      if (cur) best[t] = cur;
    }
    // ホテル料金が効いているときは、いちばん長いコース1本だけ特別料金・残りは通常料金
    /** 1本ずつの料金（お客様への説明にそのまま使う）。{name, price, hotel} の配列 */
    const comboLines = (parts) => {
      const target = hotelFirstOn ? parts.filter(x => x.hotel !== null).sort((a, b) => b.min - a.min)[0] : null;
      let used = false;
      return parts.map(x => {
        const hit = !used && target && x === target;
        if (hit) used = true;
        return { name: x.name, price: hit ? x.hotel : x.price, hotel: !!hit };
      });
    };
    // 180分以上だけ出す（それ未満は1本目のコースで選ぶ）
    let opts = '<option value="">＋ 組み合わせなし</option>';
    for (let t = 180; t <= COMBO_MAX_MIN; t += step) {
      const b = best[t];
      if (!b || b.parts.length < 2) continue;
      const parts = b.parts.slice().sort((x, y) => y.min - x.min);
      const lines = comboLines(parts);
      const price = lines.reduce((n, x) => n + x.price, 0);
      const combo = parts.map(x => x.label).join('＋');
      const names = parts.map(x => x.name).join(' ＋ ');
      opts += `<option value="${t}" data-name="${escapeAttr(names)}" data-price="${price}" data-parts="${parts.length}"`
            + ` data-lines="${escapeAttr(JSON.stringify(lines))}">`
            + `${t}分（${escapeHtml(combo)}） ¥${price.toLocaleString()}</option>`;
    }
    sel2.innerHTML = opts;
    if (prev2 && [...sel2.options].some(o => o.value === prev2)) sel2.value = prev2;
    syncComboUi();
  }

  /** 指名料の本数。組み合わせコースはその本数ぶん（90＋90なら2倍）かかる */
  function nominationCount() {
    const o2 = course2Opt();
    const n = o2 && o2.dataset ? parseInt(o2.dataset.parts, 10) : 1;
    return n > 0 ? n : 1;
  }
  /** この予約の指名料の合計 */
  function nominationFeeTotal() {
    if (bel('bmBreakMode')?.checked) return 0;
    return nominationFeeFor(bel('bmNomination')?.value) * nominationCount();
  }

  /** 組み合わせを選んでいる間は、1本目のコース欄は使わない（合計はそちらで決まる） */
  function syncComboUi() {
    const sel = bel('bmCourse');
    const sel2 = bel('bmCourse2');
    const on = !!(sel2 && sel2.value);
    if (sel) { sel.disabled = on; sel.style.opacity = on ? '.5' : ''; }
    const note = bel('bmComboNote');
    if (note) {
      const o = on ? sel2.options[sel2.selectedIndex] : null;
      note.textContent = o ? `${o.dataset.name}（コース欄は使いません）` : '';
      note.style.display = o ? 'block' : 'none';
    }
  }

  function populateCourseSelect() {
    const sel = bel('bmCourse');
    if (!sel) return;
    const hotelFirstOn = !!(bel('bmHotelFirst')?.checked && !bel('bmBreakMode')?.checked);
    const selectedValue = sel.value;  // 復元用
    let html = '<option value="">選択</option>';
    coursesCache.filter(c => c.is_active == 1).forEach(c => {
      // 「延長」コースはコース選択肢から除外し、延長1回分の単価として保持
      if (/延長/.test(c.name)) {
        _extUnit = { min: parseInt(c.duration_min, 10) || 30, price: parseInt(c.price, 10) || 0, name: c.name };
        return;
      }
      // 「🏨 ホテル料金」にチェックが入っているときは、選ぶ前に分かるようホテル料金を出す
      const useHotel = hotelFirstOn && c.hotel_price != null && c.hotel_price !== '';
      const shownPrice = useHotel ? Number(c.hotel_price) : Number(c.price || 0);
      const priceTag = (useHotel || c.price) ? ` (¥${shownPrice.toLocaleString()})` : '';
      html += `<option value="${c.duration_min}" data-name="${escapeAttr(c.name)}" data-price="${c.price || ''}" data-bonus-id="${c.bonus_course_id || ''}">${escapeHtml(c.name)}${priceTag}</option>`;
    });
    sel.innerHTML = html;
    if (selectedValue) sel.value = selectedValue;
    populateComboSelect(hotelFirstOn);
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
  // ===== 予約モーダルのオプション（ローター等） =====
  /** 有効なオプションをチェックボックスで描画（両モーダル） */
  function renderBmOptions() {
    ['', '-2'].forEach(sfx => {
      const wrap = document.getElementById('bmOptionList' + sfx);
      if (!wrap) return;
      const active = optionsCache.filter(o => Number(o.is_active) === 1);
      if (!active.length) {
        wrap.innerHTML = '<span class="hint">オプションが登録されていません（マスタタブで追加できます）</span>';
        return;
      }
      const cur = bmOptionCounts(sfx);   // {id: 個数}
      wrap.innerHTML = active.map(o => {
        const n = cur[o.id] || 0;
        const opts = [0, 1, 2, 3, 4, 5].map(v => `<option value="${v}"${v === n ? ' selected' : ''}>${v === 0 ? '—' : String(v)}</option>`).join('');
        return `<label class="bm-media bm-opt${n ? ' has-count' : ''}">
          <span class="bm-opt-name">${escapeHtml(o.name)} ¥${Number(o.price || 0).toLocaleString()}</span>
          <select class="bm-opt-qty" name="bmOption${sfx}" data-opt-id="${o.id}">${opts}</select>
        </label>`;
      }).join('');
    });
    updateBmOptionSum();
  }
  /** いま選ばれているオプションの個数 { オプションID: 個数 }（0のものは含めない） */
  function bmOptionCounts(sfx) {
    const s = sfx === undefined ? activeBmSuffix : sfx;
    const wrap = document.getElementById('bmOptionList' + s);
    if (!wrap) return {};
    const out = {};
    wrap.querySelectorAll('.bm-opt-qty').forEach(sel => {
      const n = parseInt(sel.value, 10) || 0;
      if (n > 0) out[Number(sel.dataset.optId)] = n;
    });
    return out;
  }
  /** いま選ばれているオプションID（個数は見ない。判定用） */
  function bmOptionIds(sfx) {
    return Object.keys(bmOptionCounts(sfx)).map(Number);
  }
  /** 個数を復元。数値配列（旧形式=各1個）と {id:個数} の両方を受ける */
  function setBmOptionCounts(counts) {
    const wrap = bel('bmOptionList');
    if (!wrap) return;
    const map = Array.isArray(counts)
      ? Object.fromEntries((counts || []).map(id => [Number(id), 1]))
      : Object.fromEntries(Object.entries(counts || {}).map(([k, v]) => [Number(k), Number(v) || 0]));
    wrap.querySelectorAll('.bm-opt-qty').forEach(sel => {
      const n = map[Number(sel.dataset.optId)] || 0;
      sel.value = String(n);
      sel.closest('.bm-opt')?.classList.toggle('has-count', n > 0);
    });
    // 何も選ばれていない状態にしたときは畳んでおく（新規予約は毎回閉じた状態で始まる）
    const acc = bel('bmOptionField');
    if (acc && acc.tagName === 'DETAILS' && !Object.values(map).some(v => v > 0)) acc.open = false;
    updateBmOptionSum();
  }
  const setBmOptionIds = setBmOptionCounts;   // 旧名の呼び出しをそのまま活かす
  /**
   * 保存した menu_items（「ローター¥1,100 / 無料ローター¥0 / バイブ×2 ¥2,200」）を
   * オプションID→個数 に戻す（店長指摘 2026-08-30）。
   * 以前は名前の部分一致で拾っていたため、「無料ローター」を選んで保存すると
   * 「ローター」にもチェックが入って開いていた。区切りごとに名前を切り出して照合する。
   */
  function parseMenuItemCounts(txt) {
    const raw = String(txt || '').trim();
    const counts = {};
    if (!raw) return counts;
    const byName = {};
    (optionsCache || []).forEach(o => { if (o.name) byName[String(o.name)] = o; });
    let matched = 0;
    raw.split('/').map(t => t.trim()).filter(Boolean).forEach(part => {
      const m = part.match(/^(.*?)(?:×(\d+))?\s*¥[\d,]+$/);
      const name = (m ? m[1] : part).trim();
      const n = (m && m[2]) ? (parseInt(m[2], 10) || 1) : 1;
      const o = byName[name];
      if (o) { counts[Number(o.id)] = n; matched++; }
    });
    if (matched) return counts;
    // 上の切り出しで1つも当たらない古い書き方のときだけ、名前の部分一致で拾う。
    // 「無料ローター」があるときに「ローター」まで拾わないよう、他の名前に含まれる名前は落とす
    const hits = (optionsCache || []).filter(o => o.name && raw.includes(o.name)).map(o => String(o.name));
    hits.filter(nm => !hits.some(other => other !== nm && other.includes(nm)))
        .forEach(nm => { const o = byName[nm]; if (o) counts[Number(o.id)] = 1; });
    return counts;
  }
  /** オプション合計（料金）。個数ぶん掛ける */
  function optionTotal() {
    if (bel('bmBreakMode')?.checked) return 0;
    const cnt = bmOptionCounts();
    return optionsCache.reduce((n, o) => n + (Number(o.price) || 0) * (cnt[Number(o.id)] || 0), 0);
  }
  /** オプションのキャスト報酬合計（未設定は店の取り分＝0）。個数ぶん掛ける */
  function optionReward() {
    if (bel('bmBreakMode')?.checked) return 0;
    const cnt = bmOptionCounts();
    return optionsCache.reduce((n, o) => {
      const r = (o.cast_reward != null && o.cast_reward !== '') ? Number(o.cast_reward) : 0;
      return n + r * (cnt[Number(o.id)] || 0);
    }, 0);
  }
  /** 保存用テキスト（menu_items）。「ローター¥1,000 / バイブ×2 ¥2,000」 */
  function optionText() {
    const cnt = bmOptionCounts();
    return optionsCache.filter(o => cnt[Number(o.id)]).map(o => {
      const n = cnt[Number(o.id)];
      const sub = (Number(o.price) || 0) * n;
      return o.name + (n > 1 ? '×' + n : '') + '¥' + sub.toLocaleString();
    }).join(' / ');
  }
  function updateBmOptionSum() {
    const el = bel('bmOptionSum');
    if (!el) return;
    const t = optionTotal();
    const names = optionText();   // 「ローター¥1,100 / バイブ×2 ¥2,200」
    // 畳んでいても何を選んだか分かるように、見出しに内容を出す（店長要望 2026-08-09）
    el.textContent = t > 0 ? `　${names}` : '';
    // 選ばれている予約を開いたときは開いた状態にする（畳んだままだと気付けない）
    const acc = bel('bmOptionField');
    if (acc && acc.tagName === 'DETAILS' && t > 0) acc.open = true;
  }

  // 予約モーダルごとの「このお客様」情報。isNew: true=ご新規様 / false=会員様 / null=不明（電話未入力等）
  // castNames: 過去に利用したキャスト名の集合（OPS予約の担当名＋旧システムの源氏名）
  // lastFee: 前回ご案内したときの交通費 {fee, day, cast}（無ければ null）
  const bmCust = { '': { isNew: null, castNames: null, lastFee: null }, '-2': { isNew: null, castNames: null, lastFee: null } };
  // 特別料金チェックを手で触ったら自動では動かさない
  const bmHotelFirstTouched = { '': false, '-2': false };
  const bmPlus10Touched = { '': false, '-2': false };   // ＋10分を手で触ったら自動判定を止める
  // 予約編集のステータスは「予約そのものの状態」だけを扱う。接客の進み具合（始／終）は
  // タイムラインのバッジで見るので選択肢に出さない（店長指定 2026-08-06）。
  // ただし接客完了の予約を開いて保存したときに、その状態を消してしまわないよう元の値を覚えておく。
  const bmKeptStatus = { '': null, '-2': null };
  // 開始時刻を手で触ったか。触っていなければ日付の変更に追従して既定値を入れ直す
  const bmStartTouched = { '': false, '-2': false };

  function resetBmCust() {
    bmCust[activeBmSuffix] = { isNew: null, castNames: null, lastFee: null };
    bmHotelFirstTouched[activeBmSuffix] = false;
    const badge = bel('bmNewBadge');
    if (badge) badge.style.display = 'none';
  }

  /** 選択中の担当キャスト名 */
  function selectedCastName() {
    const sel = bel('bmAdminId');
    const opt = sel?.options[sel.selectedIndex];
    return sel?.value && opt ? String(opt.dataset?.name || opt.text || '').trim() : '';
  }

  /** ホテル利用×初対面キャスト＝特別料金の対象か。不明（電話未入力など）は対象外 */
  function hotelFirstEligible() {
    const locType = document.querySelector(`input[name="bmLocType${activeBmSuffix}"]:checked`)?.value || 'hotel';
    // ラブホもホテル特別料金の対象（タブを分ける前と同じ扱い・店長確認 2026-08-08）
    if (!isHotelLoc(locType) || bel('bmBreakMode')?.checked) return false;
    if (bel('bmNomination')?.value === 'regular') return false;   // 本指名＝そのキャストは2回目以降なので対象外
    const st = bmCust[activeBmSuffix];
    if (st.isNew === true) return true;   // ご新規様はどのキャストとも初対面
    if (st.isNew === false && st.castNames) {
      const nm = selectedCastName();
      return nm !== '' && !st.castNames.has(nm);
    }
    return false;
  }
  /** いま選んでいる1本目のコース（＋10分で差し替わっていればそちら）のマスタ行 */
  function firstCourseRow() {
    const b = bonusCourse();
    if (b) return b;
    const sel = bel('bmCourse');
    const opt = sel && sel.options[sel.selectedIndex];
    const nm = opt && opt.dataset ? opt.dataset.name : '';
    return nm ? (coursesCache || []).find(c => c.name === nm) || null : null;
  }
  /**
   * ホテル料金でいくら安くなるか（表示用）。コース管理の「ホテル料金」との差額。
   * ホテル料金を設定していないコース（お泊りコース等）は対象外なので0。
   */
  function hotelDeltaForCurrentCourse() {
    const c = firstCourseRow();
    if (c && c.hotel_price != null && c.hotel_price !== '') {
      const d = (parseInt(c.price, 10) || 0) - (parseInt(c.hotel_price, 10) || 0);
      return d > 0 ? d : 0;
    }
    return 0;
  }
  /**
   * そのコースがホテル料金の対象かどうか（コース管理でホテル料金を入れてあるか）。
   * 組み合わせは構成コースのどれかに入っていれば対象。コース未選択のうちは触らせる。
   */
  function hotelPriceAvailable() {
    const o2 = course2Opt();
    if (o2) {
      return String(o2.dataset.name || '').split(' ＋ ').some(n => {
        const c = (coursesCache || []).find(x => x.name === n);
        return !!(c && c.hotel_price != null && c.hotel_price !== '');
      });
    }
    const sel = bel('bmCourse');
    if (!sel || !sel.value) return true;
    const row = firstCourseRow();
    return !!(row && row.hotel_price != null && row.hotel_price !== '');
  }
  /**
   * ホテル料金の「引き」は常に0。ホテル料金はコース料金欄をその金額に**置き換える**方式で、
   * 組み合わせも料金にホテル料金が織り込み済みなので、ここで引くと二重になる。
   */
  function hotelFirstDiscount() {
    return 0;
  }

  /** 新規/会員・訪問先・担当・媒体が変わるたびに特典まわりを同期する */
  function syncDealBadges() {
    const st = bmCust[activeBmSuffix];
    // ご新規様バッジ（電話で照合して見つからなかったとき）
    const badge = bel('bmNewBadge');
    if (badge) badge.style.display = (st.isNew === true && !bel('bmBreakMode')?.checked) ? 'block' : 'none';
    // 本指名＝そのキャストとは2回目以降なのでホテル料金は対象外。押せないようにして外す
    const nomNow = bel('bmNomination')?.value || '';
    const hfLock = nomNow === 'regular' && !bel('bmBreakMode')?.checked;
    // お泊りコースのようにホテル料金を設定していないコースも対象外
    const hfNA = !hotelPriceAvailable();
    const hfOff = hfLock || hfNA;
    const hfField = bel('bmHotelFirstField');
    const hfInput = bel('bmHotelFirst');
    if (hfInput) {
      hfInput.disabled = hfOff;
      // 先にチェックしてから本指名にした場合は外す。黙って消えると気づけないので知らせる
      if (hfOff && hfInput.checked) {
        hfInput.checked = false;
        try { toast(hfLock ? '本指名（2回目以降）のためホテル料金を外しました' : 'このコースはホテル料金の設定がないため外しました', 'err'); } catch (_) {}
        // チェックを外したらコース選択肢も通常料金に戻す。呼び忘れると
        // 「チェックの状態」と「選択肢の金額」が食い違ったまま残る（2026-08-08）
        try { populateCourseSelect(); applyCoursePrice(); } catch (_) {}
      }
    }
    if (hfField) {
      hfField.style.opacity = hfOff ? '.55' : '';
      hfField.style.cursor = hfOff ? 'not-allowed' : 'pointer';
      hfField.title = hfLock ? '本指名（2回目以降）のためホテル料金は対象外です'
                    : hfNA ? 'このコースはコース管理でホテル料金を設定していません' : '';
    }
    // チェックする前に条件が分かるよう、指名方法に応じた注意をその場に出す
    const hfWarn = bel('bmHotelFirstWarn');
    if (hfWarn) {
      let w = '';
      if (hfLock) w = '⚠️ 本指名（そのキャストが2回目以降）のため対象外です';
      else if (hfNA) w = '⚠️ このコースはホテル料金の設定がありません（対象外）';
      else if (nomNow === '') w = '（本指名は対象外）';
      hfWarn.textContent = w;
      // 通常は見出しと同じ行（inline）。CSS の .is-block 側で本指名のときだけ改行させる
      hfWarn.style.display = w ? '' : 'none';
      hfWarn.classList.toggle('is-block', hfLock);
    }
    // 特別料金の自動チェック（手で触っていなければ）
    const cb = bel('bmHotelFirst');
    if (cb && !bmHotelFirstTouched[activeBmSuffix] && !hfOff) {
      const next = hotelFirstEligible();
      if (cb.checked !== next) { cb.checked = next; populateCourseSelect(); applyCoursePrice(); }
    }
    // ヒント: なぜ対象/対象外か
    const hint = bel('bmHotelFirstHint');
    if (hint) {
      const nm = selectedCastName();
      if (st.isNew === true) hint.textContent = '（初めてのキャスト限定）';
      else if (st.isNew === false && st.castNames && nm) hint.textContent = st.castNames.has(nm) ? `（${nm} は2回目以降）` : `（${nm} と初対面）`;
      else hint.textContent = '（初めてのキャスト限定）';
    }
    // ホテル料金の引き額（コース管理の「ホテル料金」があればその差額）
    // 引き額は出さない（ホテル料金はコース料金を置き換える方式で、−¥0 と出ても意味がない）。
    // コース管理で未設定のときだけ、その旨を残す（店長指定 2026-08-08）
    const hfAmt = bel('bmHotelFirstAmt');
    if (hfAmt) hfAmt.textContent = hfNA ? '（このコースは設定なし）' : '';
    // ＋10分: 手で触っていなければ自動判定を反映する
    const p10 = bel('bmPlus10');
    if (p10 && !bmPlus10Touched[activeBmSuffix]) {
      const next = plus10Auto();
      if (p10.checked !== next) { p10.checked = next; updateEndTime(); }
    }
    // 指名方法のヒント（初対面なら初指名、2回目以降なら本指名）
    const nomHint = bel('bmNomHint');
    if (nomHint) {
      const nm = selectedCastName();
      const nomVal = bel('bmNomination')?.value;
      let txt = '';
      if (nm && (nomVal === 'first' || nomVal === 'regular')) {
        const first = st.isNew === true || (st.isNew === false && st.castNames && !st.castNames.has(nm));
        const known = st.isNew !== null && (st.isNew === true || st.castNames);
        if (known) {
          if (first && nomVal === 'regular') txt = `💡 ${nm} とは初対面 → 初指名（¥${NOMINATION_FEES.first.toLocaleString()}）では？`;
          if (!first && nomVal === 'first') txt = `💡 ${nm} は2回目以降 → 本指名（¥${NOMINATION_FEES.regular.toLocaleString()}）では？`;
        }
      }
      nomHint.textContent = txt;
      nomHint.style.display = txt ? 'block' : 'none';
    }
    updateEndTime();
    updateBookingTotal();
  }

  /** +10分(無料): 媒体・LINE予約のどれかにチェックが入っていれば。重なっても10分まで。
   *  ただし「＋10分のときのコース」が設定されたコースは、そのコースの分数に既に含まれるので0を返す */
  function lineBonusExtra() {
    if (!bonusApplies()) return 0;
    return bonusCourse() ? 0 : 10;
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
    // 1本の長い行だと読みづらいので、意味の固まりごとに行を分けて出す（店長要望 2026-08-05）
    const setOut = (rows, totalTxt) => {
      const list = Array.isArray(rows) ? rows.filter(Boolean) : (rows ? [rows] : []);
      if (mainEl) mainEl.innerHTML = list.map(r => `<span class="fs-row">${r}</span>`).join('');
      if (totalEl) totalEl.textContent = totalTxt || '';
      fs.classList.toggle('show', !!(list.length || totalTxt));
    };
    const lbl = (t) => `<span class="fs-l">${t}</span>`;
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
    if (isBreak) {
      const city = (bel('bmBreakCity')?.value || '').trim();
      setOut([`💤 休憩　${escapeHtml(`${dateDisp} ${timeDisp}`.trim())}`, city ? `📍 ${escapeHtml(city)}` : '']);
      return;
    }
    const courseSel = bel('bmCourse');
    const opt = courseSel?.options?.[courseSel.selectedIndex];
    // コース名は bmCourseName() が＋10分ぶんまで面倒を見る（保存される名前と同じ表記）
    const course = opt ? bmCourseName(opt) : '';
    const nomSel = bel('bmNomination');
    const nom = nomSel?.value ? (nomSel.options[nomSel.selectedIndex]?.text || '') : '';
    // 店長指定の並び（2026-08-05）: 開始時刻だけ / 金額の内訳 / お客様・キャスト。
    // 終了時刻・場所・媒体・支払方法はここには出さない（本文で見えるため）
    const startLine = `${dateDisp} ${startStr}〜`.replace(/\s+/g, ' ').trim();
    const coursePrice = parseInt(String(bel('bmPrice')?.value || '').replace(/[^\d]/g, ''), 10) || 0;
    const nomFee = nominationFeeTotal();
    const transportFee = parseInt(String(bel('bmTransport')?.value || '').replace(/[^\d]/g, ''), 10) || 0;
    const optFee = optionTotal();
    const extFee = extAmount();
    const lateFee = bel('bmLateNight')?.checked ? LATE_NIGHT_FEE : 0;
    const hfOff = hotelFirstDiscount();
    const campOff = campaignDiscount(coursePrice);
    const stampOff = stampDiscount(coursePrice - campOff);
    const cardFee = ['credit', 'split'].includes(bel('bmPayment')?.value)
      ? cardSurcharge(coursePrice + transportFee + lateFee + extFee + nomFee + optFee - campOff - stampOff - hfOff)
      : 0;
    const yenTag = (label, amount, sign) =>
      `<span class="fs-item"><span class="fs-n">${escapeHtml(label)}</span><b>${sign || ''}¥${Math.abs(amount).toLocaleString()}</b></span>`;
    const money = [];
    if (course && coursePrice) money.push(yenTag(course, coursePrice));
    else if (course) money.push(`<span class="fs-item"><span class="fs-n">${escapeHtml(course)}</span></span>`);
    if (nom && nomFee) money.push(yenTag(nom, nomFee));
    if (optFee) money.push(yenTag(optionText() || 'オプション', optFee));
    if (extFee) money.push(yenTag(`延長×${extCount()}`, extFee));
    if (lateFee) money.push(yenTag('深夜料金', lateFee));
    if (transportFee) money.push(yenTag('交通費', transportFee));
    if (hfOff) money.push(yenTag('ホテル料金', hfOff, '−'));
    if (campOff) money.push(yenTag('キャンペーン', campOff, '−'));
    if (stampOff) money.push(yenTag('スタンプ', stampOff, '−'));
    if (cardFee) money.push(yenTag('カード手数料', cardFee, '+'));
    const total = (bel('bmTotal')?.textContent || '').trim();
    const totalNum = parseInt(total.replace(/[^\d]/g, ''), 10) || 0;
    const custName = (bel('bmCustomerName')?.value || '').trim();
    const adminSel = bel('bmAdminId');
    const castName = adminSel?.value ? (adminSel.options[adminSel.selectedIndex]?.text || '').replace(/^担当\s*/, '') : '';
    // 指名方法も出す（初指名/本指名/フリーは金額に効くので、確認のとき必ず読む・店長要望 2026-08-25）
    const NOM_LABEL = { first: '初指名', regular: '本指名', free: 'フリー' };
    const nomTxt = NOM_LABEL[bel('bmNomination')?.value] || '';
    const who = [
      custName ? `${escapeHtml(custName)} 様` : '',
      castName && castName !== '—' ? `💁 ${escapeHtml(castName)}` : '',
      nomTxt ? `<b>${escapeHtml(nomTxt)}</b>` : '',
    ].filter(Boolean).join('　');
    setOut([
      startLine ? `<b>${escapeHtml(startLine)}</b>` : '',
      money.join('<i class="fs-sep"></i>'),
      who,
    ], totalNum > 0 ? total : '');
  }
  /** 日付を変えたとき、時刻を手で触っていなければ既定値（今日=現在時刻／別日=10:00）に合わせる */
  function applyDefaultStartOnDateChange() {
    if (bmStartTouched[activeBmSuffix] || bel('bmBreakMode')?.checked) return;
    const def = defaultStartFor(bel('bmDate')?.value);
    const hSel = bel('bmStartHour');
    const mSel = bel('bmStartMin');
    if (hSel) hSel.value = def.h;
    if (mSel) mSel.value = def.m;
    updateEndTime();
    autoToggleLateNight();
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
  /**
   * その営業日に出勤している人のID。受け渡し・報酬の相手はこの人たちだけ出す
   * （出ていないスタッフ・ドライバーが選べると誤って記録してしまう・店長指摘 2026-08-15）。
   * extraIds には「すでに預り金を持っている／報酬を渡した」人を渡す（出勤登録が無くても消さないため）
   */
  function opsOnDutySet(bizDay, extraIds) {
    const set = new Set();
    (tlShifts || []).forEach(x => {
      if (String(x.shift_date).slice(0, 10) === bizDay && (x.status === 'available' || x.status === 'done')) set.add(Number(x.admin_user_id));
    });
    (extraIds || []).forEach(id => { if (id !== null && id !== undefined && id !== '') set.add(Number(id)); });
    if (currentUser?.id) set.add(Number(currentUser.id));   // 操作している本人は常に選べる
    return set;
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
  // 旧システム(asyura)の受電リストをサーバーの取込ボット（~/asyura-cti-cron、1分cron）が
  // ops_incoming_calls へ流し込み、ここは営業日単位で表示するだけ。
  // 顧客名・当日予約の突合はサーバー側（calls.php list）。Asterisk直叩き（?src=&dst=）も同じ受け口。
  async function loadReceptionCalls(bizDay) {
    try {
      const d = await api('/calls.php?action=list&date=' + encodeURIComponent(bizDay));
      return d.calls || [];
    } catch (_) {
      return null;   // 取得失敗（テーブル未作成・ネットワーク等）はエラー表示にしない
    }
  }
  function recvStateBadge(status, cast) {
    // 予約はキャスト名を出す（誰の予約かがその場で分かる・店長要望 2026-08-16）。列幅は変えない
    if (status === 'reserved') {
      const nm = String(cast || '').trim();
      return nm ? `<span class="recv-state s-reserved" title="予約：${escapeHtml(nm)}">${escapeHtml(nm)}</span>`
                : '<span class="recv-state s-reserved">予約</span>';
    }
    if (status === 'inquiry')  return '<span class="recv-state s-inquiry">問合せ</span>';
    return '<span class="recv-state s-none">—</span>';
  }
  // 数字のみの番号を読みやすく（09012345678 → 090-1234-5678）。それ以外は受信したまま出す
  /**
   * 電話番号を読みやすくハイフンで区切る（見た目だけ。保存は半角数字のまま）。
   * 形が想定外のときは元の文字列をそのまま返す（勝手に切らない）
   */
  function hyphenPhone(s) {
    const n = String(s || '').replace(/[^0-9]/g, '');
    if (/^0(120|800)\d{6}$/.test(n)) return n.slice(0, 4) + '-' + n.slice(4, 7) + '-' + n.slice(7);  // フリーダイヤル
    if (/^0\d{10}$/.test(n)) return n.slice(0, 3) + '-' + n.slice(3, 7) + '-' + n.slice(7);           // 携帯・050
    if (/^0\d{9}$/.test(n)) {
      // 固定電話（東京03/大阪06は2桁局番、それ以外は3桁で区切る）
      return /^0[36]/.test(n) ? n.slice(0, 2) + '-' + n.slice(2, 6) + '-' + n.slice(6)
                              : n.slice(0, 3) + '-' + n.slice(3, 6) + '-' + n.slice(6);
    }
    return String(s || '');
  }
  function fmtRecvPhone(c) {
    const out = hyphenPhone(c.phone_norm || '');
    return out || c.phone || '';
  }
  let _recvRenderSeq = 0;
  let _recvLastJson = '';
  // 新しく入った着信は10秒だけ色を付ける（見逃し防止・店長要望 2026-08-15）。
  // 同じ番号でも掛け直しがあれば時刻が変わるので、番号＋最新時刻を目印にする
  const RECV_NEW_MS = 10000;
  let _recvSeenKeys = null;              // null = まだ一度も読んでいない（初回は光らせない）
  const _recvNewUntil = new Map();       // 目印 → いつまで新着扱いか
  const recvKeyOf = (c) => (c.phone_norm || c.phone || '') + '|' + (c.time || '');
  let _recvBizDay = '';
  let _recvNewTimer = null;      // 点滅を止めるための再描画タイマー
  async function renderReceptionList(bizDay) {
    const listEl = document.getElementById('recvList');
    const countEl = document.getElementById('recvCount');
    if (!listEl) return;
    const seq = ++_recvRenderSeq;
    if (_recvBizDay !== bizDay) { _recvBizDay = bizDay; _recvSeenKeys = null; _recvNewUntil.clear(); }
    const calls = await loadReceptionCalls(bizDay);
    if (seq !== _recvRenderSeq) return;   // 日付を連打したときは最後の描画だけ有効
    if (calls === null) {
      if (countEl) countEl.textContent = '0';
      listEl.innerHTML = '<div class="recv-empty">着信履歴を取得できませんでした</div>';
      _recvLastJson = '';
      return;
    }
    // 内容が前回と同じなら描画しない（4秒ポーリングでのちらつき・スクロールリセット防止）
    const json = bizDay + '\n' + JSON.stringify(calls);
    if (json === _recvLastJson) return;
    _recvLastJson = json;
    if (countEl) countEl.textContent = calls.length;
    if (!calls.length) {
      listEl.innerHTML = '<div class="recv-empty">この営業日の着信はまだありません</div>';
      _recvSeenKeys = new Set();
      return;
    }
    // 前回に無かった着信＝新着。日付を切り替えた直後（初回）は光らせない
    const nowMs = Date.now();
    const keys = calls.map(recvKeyOf);
    if (_recvSeenKeys) keys.forEach(k => { if (!_recvSeenKeys.has(k)) _recvNewUntil.set(k, nowMs + RECV_NEW_MS); });
    // 点滅が終わったら色を消すために、10秒後にもう一度描き直す（内容が変わらないと再描画されないため）
    if (_recvNewUntil.size && !_recvNewTimer) {
      _recvNewTimer = setTimeout(() => {
        _recvNewTimer = null; _recvLastJson = '';
        renderReceptionList(fmtDate(tlCurrentDate));
      }, RECV_NEW_MS + 400);
    }
    _recvSeenKeys = new Set(keys);
    _recvNewUntil.forEach((until, k) => { if (until < nowMs) _recvNewUntil.delete(k); });
    listEl.innerHTML = calls.map(c => {
      const hasBooking = c.booking_id != null;
      const phoneDisp = fmtRecvPhone(c);
      const actBtn = hasBooking
        ? `<button class="recv-act edit" data-recv-edit="${c.booking_id}">編集</button>`
        : `<button class="recv-act" data-recv-new="${escapeHtml(c.phone_norm || c.phone || '')}">受付</button>`;
      const ngMark = (c.ng_level || 0) >= 2 ? '⛔' : (c.ng_level || 0) === 1 ? '⚠️' : '';
      // 掛け直しは1行にまとまっている。時刻は最新、何回かけてきたかはバッジ、全時刻はホバーで
      const cnt = c.count || 1;
      const cntBadge = cnt > 1 ? `<span class="rr-cnt">${cnt}回</span>` : '';
      const tip = cnt > 1 ? ` title="着信 ${escapeHtml((c.times || []).join(' / '))}"` : '';
      const isNew = (_recvNewUntil.get(recvKeyOf(c)) || 0) > nowMs;
      return `<div class="recv-row${isNew ? ' is-new' : ''}"${tip}>`
        + `<span class="rr-time">${escapeHtml(c.time || '')}</span>`
        + `<span class="rr-phone">${escapeHtml(phoneDisp)}${cntBadge}</span>`
        // 修飾子は is-empty。素の empty は全画面共通の空状態(.loading,.empty{padding:3rem})に当たって行が3倍の高さになる
        + `<span class="rr-name${c.name ? '' : ' is-empty'}">${ngMark}${escapeHtml(c.name || '—')}</span>`
        + recvStateBadge(c.status, c.cast)
        + actBtn
        + `</div>`;
    }).join('');
    listEl.querySelectorAll('[data-recv-new]').forEach(b =>
      b.addEventListener('click', () => openBookingForAdd({ date: fmtDate(tlCurrentDate), phone: b.dataset.recvNew })));
    listEl.querySelectorAll('[data-recv-edit]').forEach(b =>
      b.addEventListener('click', () => openBookingModal(Number(b.dataset.recvEdit))));
  }
  // 受付リスト（着信）は4秒おきに再取得（内容不変なら再描画しない）
  setInterval(() => {
    const view = document.getElementById('view-timeline');
    if (document.hidden || !view || !view.classList.contains('active')) return;
    renderReceptionList(fmtDate(tlCurrentDate));
  }, 4000);
  // 他PCの予約変更（事前予約→予約 など）の追従は、超軽量の変更チェックを1.5秒おきに。
  // 変わっていない間はほぼ無負荷（約50バイトの返答のみ）、変わった瞬間だけフル取得して描き直す
  setInterval(refreshTimelineIfChanged, 1500);

  /**
   * 予約モーダルを開いたままタイムラインの日付を変えたとき、モーダルの日付も合わせる
   * （店長要望 2026-08-18）。既存の予約を編集中は動かさない（その予約の日付を勝手に変えないため）。
   */
  function syncOpenBookingModalDate(bizDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(bizDay || ''))) return;
    ['', '-2'].forEach(suffix => {
      const modal = document.getElementById('bookingModal' + suffix);
      if (!modal || !modal.classList.contains('show')) return;
      if (editingBookingIdBySuffix[suffix]) return;      // 編集中の予約は触らない
      const inp = document.getElementById('bmDate' + suffix);
      if (!inp || inp.value === bizDay) return;
      inp.value = bizDay;
      // 日付欄を手で変えたときと同じ後処理（表示・既定の開始時刻・キャスト候補）
      withBmSuffix(suffix, () => {
        syncBmDateDisp();
        applyDefaultStartOnDateChange();
        try { populateCastSelect(bizDay, bel('bmAdminId')?.value || ''); } catch (_) {}
      });
    });
  }

  // 操作のあとに戻したいスクロール位置。描き直しの途中で何度もあて直す
  let _tlHold = null;
  let _tlHoldTimer = null;
  /**
   * タイムラインのスクロール位置を、描画が落ち着くまで当て続ける（店長指摘 2026-08-30）。
   * 1回だけ戻すと、まだ中身が組み上がっていないうちに戻してしまい位置が頭打ちになり、
   * 数時間前が表示されたり、上へ飛んだりしていた。秘密基地の行のように
   * あとから足される中身もあるので、しばらく見張って当て直す。
   */
  function holdTimelineScroll(pos) {
    if (!pos) return;
    _tlHold = pos;
    clearInterval(_tlHoldTimer);
    const put = () => {
      const sc = document.querySelector('.tl-wrap');
      if (!sc || !_tlHold) return;
      if (sc.scrollLeft !== _tlHold.left) sc.scrollLeft = _tlHold.left;
      if (sc.scrollTop !== _tlHold.top) sc.scrollTop = _tlHold.top;
    };
    requestAnimationFrame(() => { put(); requestAnimationFrame(put); });
    let n = 0;
    _tlHoldTimer = setInterval(() => {
      put();
      // 1.5秒ごとの自動更新をまたげるよう、少し長めに見張る
      if (++n >= 20) { clearInterval(_tlHoldTimer); _tlHoldTimer = null; _tlHold = null; }   // 約2秒で見張り終了
    }, 100);
  }

  async function loadTimeline(keepScroll = false) {
    const grid = document.getElementById('timelineGrid');
    // 操作後の再描画ではスクロール位置を保持（10時に戻さない）。renderTimeline で復元するためモジュール変数へ
    // 縦も一緒に覚える。横だけだと、秘密基地など下の行を見ていたときに上へ飛ぶ。
    // 位置を戻している最中（_tlHold）は、いまの表示ではなくその狙いの位置を引き継ぐ。
    // 描き直しの途中は一瞬 0 になるので、そこを読むと先頭に飛んでしまう（店長指摘 2026-08-30）
    {
      const w = document.querySelector('.tl-wrap');
      _tlPrevScroll = !keepScroll ? null
        : (_tlHold ? { left: _tlHold.left, top: _tlHold.top }
                   : (w ? { left: w.scrollLeft, top: w.scrollTop } : null));
    }
    // 操作後の描き直し（keepScroll）では「読み込み中」に差し替えない。
    // 差し替えると枠の中身が一瞬つぶれて、位置が飛んでから戻る＝カクついて見える（店長指摘 2026-08-30）
    if (!keepScroll) grid.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';

    const bizDay = fmtDate(tlCurrentDate);
    const nextDay = fmtDate(addDays(tlCurrentDate, 1));

    // タイトルは年を省いて短縮表示（例: 06/18 (木)）。日付ピッカー(dp.value)には年付き bizDay を使う
    const bizDayShort = bizDay.slice(5).replace('-', '/');
    // 今この画面が「今日」なのかを、見出しと日付ナビの両方でハッキリ出す（店長要望 2026-08-11）。
    // 営業日は 10:00 切り替えなので、暦の今日ではなく getBusinessDayDate() と突き合わせる
    const isTodayView = bizDay === fmtDate(getBusinessDayDate());
    document.getElementById('tlTitle').innerHTML = `${bizDayShort} (${dowLabel(tlCurrentDate)})`
      + (isTodayView ? '<span class="tl-todaypill">本日</span>' : '')
      + `<span class="tl-sub">営業日 10:00〜翌10:00</span>`;
    document.querySelector('.tl-toolbar .tl-nav')?.classList.toggle('is-today', isTodayView);
    refreshCastReportBadge();
    const todayBtn = document.getElementById('tlToday');
    if (todayBtn) {
      todayBtn.disabled = isTodayView;                       // 今日を見ているときは押す必要がない
      todayBtn.textContent = isTodayView ? '本日' : '本日へ';
    }
    const dp = document.getElementById('tlDatePicker');
    if (dp) dp.value = bizDay;
    syncDateDisp();
    syncOpenBookingModalDate(bizDay);   // 開いている新規予約の日付も合わせる（店長要望 2026-08-18）
    renderReceptionList(bizDay);

    try {
      // タイムラインはキャスト(isTherapistCapable)のみ表示 (内勤/ドライバー専任は行に出さない)
      //   - owner: admin-users (将来編集用、フル属性)
      //   - その他 (office/manager/driver): staff-list (read-only、最小属性)
      const urlUsers = '/admin-api.php?action=' + staffListEndpoint();
      // オプションのマスタも必ず待つ。未読込だと貸出品（🧺）の判定ができず、
      // バスタオル以外が出なかった（店長指摘 2026-08-16）
      const [usersRes, bookingsRes, shiftsRes, playRes] = await Promise.all([
        api(urlUsers),
        api(`/bookings.php?action=range&from=${bizDay}&to=${nextDay}`),
        api(`/shifts.php?action=range&from=${bizDay}&to=${nextDay}`),
        // 「今から遊べる時間」（即姫）。表示だけなので、取れなくてもタイムラインは出す
        api(`/play-now.php?action=list&date=${bizDay}`).catch(() => ({ play: {} })),
        ensureOptionsLoaded(),
      ]);
      adminUsersAll = usersRes.users || [];
      tlBookings = bookingsRes.bookings || [];
      tlShifts = shiftsRes.shifts || [];
      tlDayFlags = shiftsRes.day_flags || {};
      tlPlayNow = playRes.play || {};
      renderTimeline();
      // 手動ロード直後は基準を取り直す（次の同期チェックが誤発火しないよう null に戻す）
      _tlSyncVer = null;
    } catch (e) {
      grid.innerHTML = '<div class="view-empty">読み込み失敗: ' + escapeHtml(e.message) + '</div>';
    }
  }

  // 他PCでの変更（事前予約→予約 など）を、こちらが操作しなくても1〜2秒で反映する。
  //   - まず超軽量の sync-version（件数＋最終更新時刻）だけ取得。変わっていなければ何もしない
  //   - 変わった時だけフル取得して描き直す（差分なし＝点滅・スクロール飛びなし）
  //   - 編集中（モーダル表示中・入力フォーカス中）は邪魔しないでスキップ
  let _tlAutoBusy = false;
  async function refreshTimelineIfChanged() {
    const view = document.getElementById('view-timeline');
    if (document.hidden || !view || !view.classList.contains('active')) return;
    if (_tlAutoBusy) return;
    if (document.querySelector('.modal-overlay.active')) return;   // 何か編集中
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return; // 入力中
    _tlAutoBusy = true;
    try {
      const bizDay = fmtDate(tlCurrentDate);
      const nextDay = fmtDate(addDays(tlCurrentDate, 1));
      // ① 超軽量チェック
      const vr = await api(`/bookings.php?action=sync-version&from=${bizDay}&to=${nextDay}`);
      if (bizDay !== fmtDate(tlCurrentDate)) return;   // 取得中に日付を動かした
      const v = vr && vr.v;
      if (v == null) return;
      if (_tlSyncVer === null) { _tlSyncVer = v; return; }  // 初回は基準を記録するだけ
      if (v === _tlSyncVer) return;                          // 変化なし → 何もしない
      _tlSyncVer = v;
      // ② 変化あり → フル取得して再描画
      const [bookingsRes, shiftsRes] = await Promise.all([
        api(`/bookings.php?action=range&from=${bizDay}&to=${nextDay}`),
        api(`/shifts.php?action=range&from=${bizDay}&to=${nextDay}`),
      ]);
      if (bizDay !== fmtDate(tlCurrentDate)) return;
      tlBookings = bookingsRes.bookings || [];
      tlShifts = shiftsRes.shifts || [];
      tlDayFlags = shiftsRes.day_flags || {};
      {
        // 自動更新（1.5秒ごと）。操作直後で位置を戻している最中なら、その狙いの位置を引き継ぐ
        const w = document.querySelector('.tl-wrap');
        _tlPrevScroll = _tlHold ? { left: _tlHold.left, top: _tlHold.top }
                                : (w ? { left: w.scrollLeft, top: w.scrollTop } : null);
      }
      renderTimeline();
    } catch (_) {
    } finally {
      _tlAutoBusy = false;
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
    // 時と分を別々に選ぶ（分は1分刻み）。営業は10:00〜翌9:00なので時は 10→23→0→9 の順
    const curH = Math.floor(cur / 60) % 24, curM = cur % 60;
    const hours = [...Array(14).keys()].map(i => i + 10).concat([...Array(10).keys()]);
    const hOpts = hours.map(h => `<option value="${h}"${h === curH ? ' selected' : ''}>${h}</option>`).join('');
    const mOpts = [...Array(60).keys()].map(m => `<option value="${m}"${m === curM ? ' selected' : ''}>${('0' + m).slice(-2)}</option>`).join('');
    const pop = document.createElement('div');
    pop.id = 'tlTimePop';
    pop.className = 'tl-time-pop';
    pop.innerHTML = `<div class="ttp-head"><span class="ttp-label">開始時刻</span><button class="ttp-close" type="button" aria-label="閉じる">×</button></div>
      <div class="ttp-time"><select class="ttp-sel ttp-h" aria-label="時">${hOpts}</select><span class="ttp-c">:</span><select class="ttp-sel ttp-m" aria-label="分">${mOpts}</select></div>
      <button type="button" class="ttp-apply">この時刻に変更</button>
      <button type="button" class="ttp-apply ttp-start">この時刻で始</button>
      <div class="ttp-sep"></div>
      <button type="button" class="ttp-apply ttp-play">この時刻に変更 / 即姫更新</button>
      <button type="button" class="ttp-apply ttp-start ttp-play">この時刻で始 / 即姫更新</button>
      <div class="ttp-playhint" id="ttpPlayHint"></div>`;
    document.body.appendChild(pop);
    pop.querySelector('.ttp-close').addEventListener('click', (ev) => { ev.stopPropagation(); closeTimeAdjust(); });
    const r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + window.scrollY + 4) + 'px';
    pop.style.left = (r.left + window.scrollX) + 'px';
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) pop.style.left = (window.innerWidth - pr.width - 8 + window.scrollX) + 'px';
    // 即姫（最速で遊べる時間）に入る時刻の予告。終了予定＝開始＋コース＋延長 を5分に丸めた値。
    // 丸めは「0〜2分は切り下げ / 3〜4分は切り上げ」（店長指定 2026-08-18・案B）
    const round5B = (mins) => { const r = ((mins % 5) + 5) % 5; return mins + (r <= 2 ? -r : 5 - r); };
    const durMin = (() => {                       // いまの予約の長さ（終了−開始）。日またぎも吸収
      if (!b.end_time) return null;
      let d = toMin(b.end_time) - toMin(b.start_time);
      if (d < 0) d += 1440;
      return d;
    })();
    // 即姫は「本日の営業日」の予約だけ。前日・翌日の予約で押して媒体に出してしまう事故を防ぐ
    // （店長指定 2026-08-18）
    const bkBizDay = bizDateOf(b.booking_date, b.start_time || '00:00');
    const isTodayBooking = bkBizDay === fmtDate(getBusinessDayDate());
    if (!isTodayBooking) {
      pop.querySelectorAll('.ttp-play, .ttp-sep, .ttp-playhint').forEach(el => el.remove());
    }
    const playHint = pop.querySelector('#ttpPlayHint');
    const syncPlayHint = () => {
      if (!playHint) return;
      if (durMin === null) { playHint.textContent = '終了予定が無いため即姫は設定できません'; return; }
      const h = parseInt(pop.querySelector('.ttp-h').value, 10);
      const m = parseInt(pop.querySelector('.ttp-m').value, 10);
      const end = round5B((h * 60 + m + durMin) % 1440);
      playHint.innerHTML = `即姫 → <b>${Math.floor(end / 60) % 24}:${('0' + (end % 60)).slice(-2)}</b>`;
    };
    pop.querySelectorAll('.ttp-sel').forEach(s => s.addEventListener('change', syncPlayHint));
    syncPlayHint();

    // 「この時刻に変更」＝時間だけ動かす / 「この時刻で始」＝時間を合わせて接客開始（始）にする
    // ttp-play が付いていれば、続けて「最速で遊べる時間」も更新する（上書き・店長指定 2026-08-18）
    const applyTime = async (alsoStart, btn) => {
      const alsoPlay = !!(btn && btn.classList.contains('ttp-play'));
      const h = parseInt(pop.querySelector('.ttp-h').value, 10);
      const m = parseInt(pop.querySelector('.ttp-m').value, 10);
      // ずらす分数。日をまたぐ選び方（19:05→2:00 など）は近い方向へ寄せる
      let delta = (h * 60 + m) - cur;
      if (delta > 720) delta -= 1440;
      if (delta < -720) delta += 1440;
      // 時刻を変えずに即姫だけ更新したいこともあるので、即姫つきのときは素通りさせない
      // （同じ時刻を選ぶと何も起きなかった・店長指摘 2026-08-18）
      if (delta === 0 && !alsoStart && !alsoPlay) { closeTimeAdjust(); return; }
      pop.querySelectorAll('button').forEach(x => { x.disabled = true; });
      try {
        if (delta !== 0) await apiPost('/bookings.php?action=shift-time', { id, delta, expected_updated_at: (b.updated_at || '') });
        if (alsoStart) {
          await apiPost('/bookings.php?action=set-service', { id: Number(id), state: 'started' });
          toast(`▶ ${h}:${('0' + m).slice(-2)} で開始（経理に計上）`, 'ok');
        }
        if (alsoPlay) {
          // 時間を動かしたあとの終了予定から決まるので、サーバー側で計算して書く
          const r = await apiPost('/play-now.php?action=from-booking', { booking_id: Number(id) });
          toast(`⏰ ${r.cast} の遊べる時間を ${r.hm} に更新しました`, 'ok');
        }
        closeTimeAdjust();
        loadTimeline(true);
      } catch (e) {
        toast('変更失敗: ' + e.message, 'err');
        closeTimeAdjust();
      }
    };
    // 4つとも登録する。querySelector で1つずつ拾っていたときは
    // 「/即姫更新」の2つにクリックが付いておらず押せなかった（店長指摘 2026-08-18）
    pop.querySelectorAll('.ttp-apply').forEach(bt => {
      bt.addEventListener('click', (ev) => {
        ev.stopPropagation();
        applyTime(bt.classList.contains('ttp-start'), bt);
      });
    });
    setTimeout(() => document.addEventListener('click', _ttpOutside, true), 0);
  }

  /**
   * 都道府県・市区町村・住所から1本の住所文字列を作る。
   * すでに含まれているものは足さない（「東京都立川市立川市錦町…」のような重複を防ぐ）。
   * 建物名・部屋番号は入れない（地図アプリが別の場所を探してしまうため）。
   */
  function composeAddress(pref, city, addr) {
    let out = String(addr || '').trim();
    if (!out) return '';
    const c = String(city || '').trim();
    if (c && !out.includes(c)) out = c + out;
    const p = String(pref || '').trim();
    if (p && !out.startsWith(p)) out = p + out;
    return out;
  }

  /**
   * 地図・ナビに渡す住所。番地までで切る（ビル名・部屋番号があると
   * Googleマップが別の場所を探してしまうため。店長指定 2026-08-05）
   */
  function addressForMap(full) {
    return splitAddressBuilding(String(full || ''))[0] || '';
  }

  /** タイムラインの予約から「住所」だけを取り出す（ナビにそのまま貼れる形） */
  function bookingAddressText(id) {
    const b = _tlBookingMap[id];
    if (!b) return '';
    const addr = (b.hotel_address || '').trim();
    if (addr) return addressForMap(composeAddress('', (b.display_city || b.hotel_city || ''), addr));
    const snap = (b.hotel_name_snapshot || '').trim();
    // 自宅は「住所」だけ。建物名・部屋番号は地図アプリが誤検索するので入れない
    if (snap.startsWith(HOME_PREFIX)) return addressForMap(snap.slice(HOME_PREFIX.length));
    if (snap.startsWith(OTHER_PREFIX)) return snap.slice(OTHER_PREFIX.length).split('\n')[0].trim();
    return '';
  }

  // =============================================================
  // 予約バーの詳細ふきだし（店長要望 2026-08-08）
  // ブラウザ標準の title は文字が小さく、住所・電話・支払も出せないため独自に描く。
  // バーは幅が狭く1〜2行しか載らないので、電話をかける前に要る情報をここで全部見せる。
  // =============================================================
  const TIP_NOM_LABEL = { first: '初指名', regular: '本指名', free: 'フリー' };
  const TIP_PAY_LABEL = { cash: '現金', credit: 'クレジット', card: 'クレジット', bank: '振込', split: '現金＋クレジット' };
  let _bkTipEl = null;      // ふきだし本体（body直下。バーの overflow:hidden に切られないため）
  let _bkTipFor = null;     // 今出している予約ID（同じバー内を動いても作り直さない）
  let _bkTipTouchAt = 0;    // 直前のタッチ時刻。タップでmouseoverが飛ぶ端末で一瞬光るのを防ぐ

  /** ラベル＋値の1行。値は組み立て済みHTML（呼び出し側でエスケープ済み） */
  function bkTipRow(label, valueHtml) {
    if (!valueHtml) return '';
    return `<div class="bk-tip-l">${escapeHtml(label)}</div><div class="bk-tip-v">${valueHtml}</div>`;
  }

  function buildBookingTipHtml(b) {
    const wrapHM = (hm) => { const p = String(hm).split(':'); return (parseInt(p[0], 10) % 24) + ':' + (p[1] || '00'); };
    const st = b.start_time ? wrapHM(String(b.start_time).slice(0, 5)) : '';
    const et = b.end_time ? wrapHM(String(b.end_time).slice(0, 5)) : '';
    const timeTxt = st && et ? `${st}〜${et}` : (st || '');
    const isBreakRow = (b.course_name === '休憩') || (b.customer_name_snapshot === '【休憩】');
    const notes = String(b.notes || '').trim();
    const noteHtml = notes ? `<div class="bk-tip-note">${escapeHtml(notes)}</div>` : '';

    if (isBreakRow) {
      return `<div class="bk-tip-head"><span class="bk-tip-time">${escapeHtml(timeTxt)}</span>`
        + `<span class="bk-tip-name">休憩</span></div>${noteHtml}`;
    }

    const name = b.customer_name || b.customer_name_snapshot || '匿名';
    const nom = TIP_NOM_LABEL[b.nomination_type] || '';

    // 訪問先: 自宅／その他は内部の目印を外して読める形にする
    const full = b.hotel_name || b.hotel_name_snapshot || '';
    const cleaned = full.replace(HOME_PREFIX, '').replace(OTHER_PREFIX, '');
    const isHome = full.startsWith(HOME_PREFIX);
    const isOther = full.startsWith(OTHER_PREFIX);
    const cityFromName = extractCityFromAddress(cleaned);
    const city = (isHome || isOther)
      ? cityFromName
      : (b.display_city || b.hotel_city || extractCityFromAddress(b.hotel_address || '') || cityFromName);
    let venue = full;
    if (isHome) venue = 'ご自宅';
    else if (isOther) venue = cleaned.split('\n')[0].trim();
    const placeHtml = [
      venue ? escapeHtml(venue) : '',
      city ? `<span class="bk-tip-city">＜${escapeHtml(city)}＞</span>` : '',
      b.room_number ? escapeHtml(String(b.room_number)) + '号室' : '',
    ].filter(Boolean).join(' ');

    // 住所: ホテルは登録住所、自宅／その他は入力された文字列から。番地・建物まで出す（現地の手がかり）
    let addr = composeAddress('', (b.display_city || b.hotel_city || ''), (b.hotel_address || ''));
    if (!addr && (isHome || isOther)) addr = cleaned.split('\n')[0].trim();

    // 支払: お客様が払う総額 = コース料金(深夜・延長・指名料・OP・割引を含む) + 交通費 + カード上乗せ
    const price = Number(b.price) || 0;
    const trans = Number(b.transport_fee) || 0;
    const cardUp = Number(b.card_fee) || 0;
    const total = price + trans + cardUp;
    const payLabel = TIP_PAY_LABEL[String(b.payment_method || '')] || '';
    // 併用は「現金いくら／カードいくら」まで出す。電話で確認するとき必要になる
    const splitBreak = isSplitPay(b)
      ? `<span class="bk-tip-sub">（現金¥${cashTakenOf(b).toLocaleString()} ／ カード¥${cardTakenOf(b).toLocaleString()}）</span>` : '';
    const payHtml = (payLabel || total)
      ? escapeHtml(payLabel) + (total ? ` ¥${total.toLocaleString()}` : '') + splitBreak
        + (trans ? `<span class="bk-tip-sub">（交通費¥${trans.toLocaleString()}込）</span>` : '')
      : '';

    // 送迎: 時刻とドライバー。担当が居なければ自走
    const legHtml = (time, drv, label) => {
      const t = time ? String(time).slice(0, 5) : '';
      if (!t && !drv) return '';
      return escapeHtml(label) + ' ' + [t, escapeHtml(drv || 'キャスト')].filter(Boolean).join(' ');
    };
    const pickupHtml = [legHtml(b.pickup_go_time, b.driver_name, '行き'), legHtml(b.pickup_back_time, b.back_driver_name, '帰り')]
      .filter(Boolean).join(' <span class="bk-tip-sub">/</span> ');

    const course = [b.course_name, b.extension_count ? `延長×${b.extension_count}` : ''].filter(Boolean).join(' ');
    // ふきだしの電話はハイフン区切りで（掛け間違い防止・店長要望 2026-08-20）
    const phone = hyphenPhone(toHalfWidth(b.customer_phone || b.customer_phone_snapshot || ''));

    // 決済確認: カードを使う予約だけ出す。誰がいつ確認したかを残す（店長要望 2026-08-08）
    let cardPaidHtml = '';
    if (['credit', 'card', 'split'].includes(String(b.payment_method || ''))) {
      if (b.card_paid_at) {
        const who = b.card_paid_by_name ? `${b.card_paid_by_name}` : '';
        const when = String(b.card_paid_at).slice(0, 16).replace('T', ' ');
        cardPaidHtml = `<span class="bk-tip-ok">✅ 確認済み</span>`
          + (who ? ` ${escapeHtml(who)}` : '')
          + `<span class="bk-tip-sub">（${escapeHtml(when)}）</span>`;
      } else {
        cardPaidHtml = '<span class="bk-tip-warn">⚠ 未確認</span>';
      }
    }

    // キャスト報酬（店長要望 2026-08-08）。どこから出た額か分かるよう内訳を添える
    const hotelApplied = Number(b.hotel_price_applied) === 1;
    const rewardTotal = rewardOf(b);
    let rewardHtml = '';
    if (!isBreakRow && rewardTotal) {
      const ov = b.reward_override != null && b.reward_override !== '';
      const parts = [];
      if (ov) parts.push('手入力');
      else {
        const courseR = courseCastReward(b.course_name, hotelApplied) || 0;
        const selfLegs = (selfLegOf(b, 'go') ? 1 : 0) + (selfLegOf(b, 'back') ? 1 : 0);
        const bonus = trans > 0
          ? (selfLegs === 2 ? trans : (selfLegs === 1 ? Math.ceil(Math.ceil(trans / 2) / 50) * 50 : 0))
          : 0;
        const lateR = selfLegOf(b, 'back') ? (Number(b.late_fee) || 0) : 0;
        const nomCnt = courseUnitCount(b.course_name);
        const nomR = nominationRewardFor(b.nomination_type) * nomCnt;
        const optR = menuItemsReward(b.menu_items);
        const extCnt = Number(b.extension_count) || 0;
        const extR = extensionRewardUnit() * extCnt;
        if (courseR) parts.push(`コース¥${courseR.toLocaleString()}`);
        if (extR) parts.push(`延長¥${extR.toLocaleString()}${extCnt > 1 ? `（${extCnt}回）` : ''}`);
        if (optR) parts.push(`OP¥${optR.toLocaleString()}`);
        if (nomR) parts.push(`指名¥${nomR.toLocaleString()}${nomCnt > 1 ? `（${nomCnt}本分）` : ''}`);
        // 何片道ぶんの機動ボーナスかが一目で分かるように（店長要望 2026-08-08）
        if (bonus) parts.push(`${selfLegs === 2 ? '往復' : '片道'}機動¥${bonus.toLocaleString()}`);
        if (lateR) parts.push(`深夜¥${lateR.toLocaleString()}`);
      }
      rewardHtml = `¥${rewardTotal.toLocaleString()}`
        + (parts.length ? `<span class="bk-tip-sub">（${escapeHtml(parts.join(' ＋ '))}）</span>` : '');
    }

    return `<div class="bk-tip-head">
        <span class="bk-tip-time">${escapeHtml(timeTxt)}</span>
        <span class="bk-tip-name">${escapeHtml(name)} 様</span>
        ${nom ? `<span class="bk-tip-badge">${escapeHtml(nom)}</span>` : ''}
      </div>
      <div class="bk-tip-r">
        ${bkTipRow('キャスト', escapeHtml(b.staff_name || ''))}
        ${bkTipRow('コース', escapeHtml(course))}
        ${bkTipRow('場所', placeHtml)}
        ${bkTipRow('住所', escapeHtml(addr))}
        ${bkTipRow('電話', escapeHtml(phone))}
        ${bkTipRow('支払', payHtml)}
        ${bkTipRow('決済', cardPaidHtml)}
        ${bkTipRow('報酬', rewardHtml)}
        ${bkTipRow('送迎', pickupHtml)}
      </div>${noteHtml}`;
  }

  /** バーの外側（下→入らなければ上）に置く。画面端では左右も内側へ寄せる */
  function positionBookingTip(anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    _bkTipEl.style.left = '0px';
    _bkTipEl.style.top = '0px';        // 折り返しを確定させてから実寸を測る
    const w = _bkTipEl.offsetWidth, h = _bkTipEl.offsetHeight;
    let left = r.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 8) left = 8;
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = r.top - h - 8;
    if (top < 8) top = 8;
    _bkTipEl.style.left = left + 'px';
    _bkTipEl.style.top = top + 'px';
  }

  function showBookingTip(anchorEl, id) {
    const b = _tlBookingMap[id];
    if (!b) return;
    if (!_bkTipEl) {
      _bkTipEl = document.createElement('div');
      _bkTipEl.className = 'bk-tip';
      document.body.appendChild(_bkTipEl);
    }
    _bkTipEl.innerHTML = buildBookingTipHtml(b);
    _bkTipFor = String(id);
    positionBookingTip(anchorEl);
    _bkTipEl.classList.add('show');
  }

  function hideBookingTip() {
    if (_bkTipEl) _bkTipEl.classList.remove('show');
    _bkTipFor = null;
  }

  // 出すのはお客様の名前に乗せたときだけ（店長指定 2026-08-08）。
  // バー全体だと送迎ボタンや場所を触るたびに出て邪魔になる。位置はバーを基準にして重ねない
  // ─ 電話番号・部屋番号は全角で打たれても半角に直す（店長要望 2026-08-08 / 2026-08-11）─
  // 全角のままだと顧客の引き当てに外れる。保存時にもサーバ側で正規化しているが、
  // 入力欄の見た目が全角のままだと「合っているのに引けない」ように見えるのでその場で直す。
  // 変換中（IME確定前）は触らない。確定した文字だけを直す
  // 部屋番号もここに乗せる（「２０５」と打たれても「205」に直す・店長要望 2026-08-11）
  const PHONE_SEL = 'input[type="tel"], #cmPhone, #cmPhone2, [id^="bmRoom"], #tlRoomInp';
  let _phoneComposing = false;
  document.addEventListener('compositionstart', (e) => { if (e.target?.matches?.(PHONE_SEL)) _phoneComposing = true; });
  document.addEventListener('compositionend', (e) => {
    if (!e.target?.matches?.(PHONE_SEL)) return;
    _phoneComposing = false;
    normalizePhoneInput(e.target);
  });
  document.addEventListener('input', (e) => {
    if (_phoneComposing || !e.target?.matches?.(PHONE_SEL)) return;
    normalizePhoneInput(e.target);
  });
  function normalizePhoneInput(el) {
    const before = el.value;
    const after = toHalfWidth(before);
    if (after === before) return;
    const pos = el.selectionStart;
    const sameLen = after.length === before.length;   // 前後の空白が落ちたときは位置が変わる
    el.value = after;
    if (sameLen) { try { el.setSelectionRange(pos, pos); } catch (_) { /* 使えない入力欄がある */ } }
  }

  document.addEventListener('mouseover', (e) => {
    if (Date.now() - _bkTipTouchAt < 800) return;   // タップ由来の mouseover は無視
    const nameEl = e.target && e.target.closest ? e.target.closest('.tl-booking .bk-name') : null;
    if (!nameEl) { if (_bkTipFor) hideBookingTip(); return; }
    const bar = nameEl.closest('.tl-booking');
    const id = bar && bar.getAttribute('data-booking-id');
    if (!id) return;
    if (String(id) === _bkTipFor) return;           // 同じ名前の上で動いただけ
    showBookingTip(bar, id);
  });
  document.addEventListener('mouseout', (e) => {
    const nameEl = e.target && e.target.closest ? e.target.closest('.tl-booking .bk-name') : null;
    if (!nameEl) return;
    if (e.relatedTarget && nameEl.contains(e.relatedTarget)) return;   // 子要素へ移っただけ
    hideBookingTip();
  });
  // スクロール・クリック・タッチでは即座に消す（位置がずれたまま残らないように）
  window.addEventListener('scroll', hideBookingTip, true);
  document.addEventListener('click', hideBookingTip, true);
  document.addEventListener('touchstart', () => { _bkTipTouchAt = Date.now(); hideBookingTip(); }, { passive: true, capture: true });

  // 下段クリック → 送迎情報をクリップボードへ（LINE等でドライバーに送る）
  // 送迎情報テキスト＋件名＋対象ドライバーIDを生成（コピー / メール送信で共用）
  function buildPickupInfo(id, dir) {
    const b = _tlBookingMap[id];
    if (!b) return null;
    const isGo = dir === 'go';
    const wrapHM = (hm) => { const p = String(hm).split(':'); return (parseInt(p[0], 10) % 24) + ':' + (p[1] || '00'); };
    const cust = b.customer_name || b.customer_name_snapshot || '匿名';
    let place = b.hotel_name || b.hotel_name_snapshot || '';
    // 自宅は「場所: 自宅」だけにする（住所は下の「住所:」行に出すので二重に書かない・店長指摘 2026-08-14）
    if (place.startsWith(HOME_PREFIX)) place = '自宅';
    else if (place.startsWith(OTHER_PREFIX)) place = place.slice(OTHER_PREFIX.length);
    if (b.room_number) place += ' 『' + b.room_number + '』';   // 部屋番号は見落とさないよう括弧で囲む
    const drvRaw = isGo ? b.driver_name : b.back_driver_name;
    const drv = drvRaw || ('キャスト' + (b.staff_name ? '（' + b.staff_name + '）' : ''));
    const st = b.start_time ? wrapHM(String(b.start_time).slice(0, 5)) : '';
    const et = b.end_time ? wrapHM(String(b.end_time).slice(0, 5)) : '';
    const lines = [];
    lines.push(isGo ? '🚗【送迎 行き（送り）】' : '🚗【送迎 帰り（迎え）】');
    // キャスト名は送り・迎えどちらにも必ず出す（ドライバー欄はキャスト自走時のみキャスト名になり
    // 誰を乗せる送迎かが分からなくなっていた・店長指摘 2026-08-20）
    if (b.staff_name) lines.push('キャスト: ' + b.staff_name);
    lines.push('ドライバー: ' + drv);
    lines.push('日付: ' + fmtBizDate(b));
    lines.push('お客様: ' + cust + ' 様');
    // 行き＝キャストが着く時間、帰り＝迎えに行く時間（帰りは店長指定の並びで「時刻＋お迎え予定」）
    if (st && et) lines.push(isGo ? `到着見込み: ${st}〜${et}` : `${st}〜${et}お迎え予定`);
    // 領収証が必要なお客様は送迎の文面にも出す（渡し忘れが多い・店長要望 2026-08-23）
    if (Number(b.receipt_needed) === 1) {
      lines.push(b.receipt_given_at ? '🧾 領収証: お渡しずみ' : '🧾 領収証: 必要です ← お渡しをお願いします');
    }
    // 貸出品は帰りに必ず回収する。持ち帰られたまま無くなるのを防ぐ（店長要望 2026-08-18）
    if (!isGo && !b.lend_returned_at) {
      const lend = lentItemsOf(b);
      if (lend.length) lines.push('🧺 貸出品: ' + lend.join('・') + ' ← キャストが持ち帰ったか確認をお願いします');
    }
    // コース（何分）・指名・料金
    const nomLabel = { first: '初指名', regular: '本指名', free: 'フリー' }[b.nomination_type] || '';
    const courseBits = [b.course_name, nomLabel].filter(Boolean).join('・');
    if (courseBits) lines.push('コース: ' + courseBits);
    const priceN = parseInt(b.price, 10) || 0;
    const transN = parseInt(b.transport_fee, 10) || 0;
    // 料金は交通費を足した総額。ドライバー宛の文面では「（交通費込）」は付けない（店長指定 2026-08-20）
    if (priceN + transN > 0) lines.push('料金: ¥' + (priceN + transN).toLocaleString());
    if (place) lines.push('場所: ' + place);
    // 住所: ホテルは hotel_address、自宅は snapshot 内の住所部を使う。地図アプリで開けるようリンク付き
    // 読む行はフル住所（現地でビル名が手がかりになる）。地図リンクだけ番地までにする
    let fullAddr = composeAddress('', (b.display_city || b.hotel_city || ''), (b.hotel_address || ''));
    const snap = b.hotel_name_snapshot || '';
    // 自宅は snapshot の住所を正とする（番地・建物まで）。建物名の二重を畳む
    if (snap.startsWith(HOME_PREFIX)) fullAddr = dedupeRepeatedSuffix(snap.slice(HOME_PREFIX.length).trim());
    else if (!fullAddr && snap.startsWith(OTHER_PREFIX)) fullAddr = dedupeRepeatedSuffix(snap.slice(OTHER_PREFIX.length).trim());
    if (fullAddr) {
      lines.push('住所: ' + fullAddr);
      const q = encodeURIComponent(addressForMap(fullAddr));
      lines.push('Googleマップ: https://www.google.com/maps/search/?api=1&query=' + q);
      lines.push('Yahoo!マップ: https://map.yahoo.co.jp/search?q=' + q);
      lines.push('Appleマップ: https://maps.apple.com/?q=' + q);
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

  // 中央に出す確認ダイアログ（ブラウザ既定の confirm() は画面上部に固定され位置を変えられないため自前で用意）
  function opsConfirm(message, opts) {
    const o = opts || {};
    const okLabel = o.ok || 'OK';
    const cancelLabel = o.cancel || 'キャンセル';
    return new Promise((resolve) => {
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const lines = String(message).split('\n')
        .map((l) => `<div class="ops-confirm-line">${esc(l) || '&nbsp;'}</div>`).join('');
      const ov = document.createElement('div');
      ov.className = 'ops-confirm-ov';
      ov.innerHTML = `<div class="ops-confirm" role="dialog" aria-modal="true">
        <div class="ops-confirm-body">${lines}</div>
        <div class="ops-confirm-btns">
          <button type="button" class="ops-confirm-cancel">${esc(cancelLabel)}</button>
          <button type="button" class="ops-confirm-ok">${esc(okLabel)}</button>
        </div></div>`;
      document.body.appendChild(ov);
      const done = (v) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') done(false); else if (e.key === 'Enter') done(true); };
      ov.querySelector('.ops-confirm-ok').addEventListener('click', () => done(true));
      ov.querySelector('.ops-confirm-cancel').addEventListener('click', () => done(false));
      ov.addEventListener('click', (e) => { if (e.target === ov) done(false); });
      document.addEventListener('keydown', onKey);
      requestAnimationFrame(() => ov.querySelector('.ops-confirm-ok').focus());
    });
  }

  // 送迎情報を担当ドライバーの登録メール(email)へ admi2888 から送信
  async function sendPickupMail(id, dir) {
    const info = buildPickupInfo(id, dir);
    if (!info) { toast('情報が見つかりません', 'err'); return; }
    // 送信先ドライバー = ポップの選択値を優先（保存直後でも拾えるよう）→ 無ければ予約の割当
    const selEl = document.getElementById('tlDrvSel');
    const driverId = (selEl && parseInt(selEl.value, 10)) || info.driverId;
    if (!driverId) { toast('先にドライバーを選択してください', 'err'); return; }
    const drv = (adminUsersAll || []).find(u => Number(u.id) === Number(driverId));
    // 送信先はメール欄（email）。ログインID(username)とは別。旧データで空なら username(旧メール) にフォールバック
    let email = (drv && drv.email ? String(drv.email) : '').trim();
    if (!email && drv && drv.username) email = String(drv.username).trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast('ドライバーのメールアドレスが未登録です（スタッフ編集で登録してください）', 'err'); return;
    }
    if (!await opsConfirm(`${drv.display_name || email} 宛に送迎情報をメール送信しますか？\n送信先: ${email}`)) return;
    try {
      await apiPost('/bookings.php?action=send-pickup-mail', { id: Number(id), leg: dir, driver_id: Number(driverId), subject: info.subject, body: info.text });
      toast('✓ ' + (drv.display_name || email) + ' にメール送信しました', 'ok');
      closeTimeAdjust();
      loadTimeline(true);  // 送信済みの色(金色)を反映
    } catch (e) { toast('メール送信失敗: ' + e.message, 'err'); }
  }

  // 下段クリック → ドライバー指定 + 送迎情報コピー のポップ
  /**
   * 部屋番号セルをクリック → その場で登録・修正する小さなポップ（店長要望 2026-08-16）。
   * 予約モーダルを開かずに部屋番号だけ直せるようにする。ホテル名はこれまでどおり住所コピー。
   */
  function openRoomEdit(id, anchorEl) {
    closeTimeAdjust();
    const b = _tlBookingMap[id];
    if (!b) return;
    const cur = b.room_number ? String(b.room_number).trim() : '';
    const pop = document.createElement('div');
    pop.id = 'tlRoomPop';
    pop.className = 'tl-time-pop';
    pop.innerHTML = `<div class="ttp-head"><span class="ttp-label">部屋番号</span><button class="ttp-close" type="button" aria-label="閉じる">×</button></div>
      <div class="ttp-room-row">
        <input type="text" id="tlRoomInp" class="ttp-room-inp" value="${escapeAttr(cur)}" placeholder="例: 303" maxlength="20">
        <button type="button" class="ttp-room-save" id="tlRoomSave">保存</button>
      </div>`;
    document.body.appendChild(pop);
    const r = anchorEl.getBoundingClientRect();
    pop.style.top = (r.bottom + window.scrollY + 4) + 'px';
    pop.style.left = (r.left + window.scrollX) + 'px';
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) pop.style.left = (window.innerWidth - pr.width - 8 + window.scrollX) + 'px';
    pop.querySelector('.ttp-close').addEventListener('click', (e) => { e.stopPropagation(); closeTimeAdjust(); });
    const inp = pop.querySelector('#tlRoomInp');
    const saveBtn = pop.querySelector('#tlRoomSave');
    const save = async () => {
      const val = toHalfWidth(inp.value);   // 数字は必ず半角で保存
      inp.value = val;
      saveBtn.disabled = true; inp.disabled = true;
      try {
        await apiPost('/bookings.php?action=set-room', { id, room_number: val });
        b.room_number = val || null;
        toast(val ? `✓ 部屋番号 ${val}` : '✓ 部屋番号を消しました', 'ok');
        closeTimeAdjust();
        loadTimeline(true);
      } catch (err) {
        toast('保存失敗: ' + err.message, 'err');
        saveBtn.disabled = false; inp.disabled = false;
      }
    };
    saveBtn.addEventListener('click', (e) => { e.stopPropagation(); save(); });
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      else if (e.key === 'Escape') closeTimeAdjust();
    });
    inp.addEventListener('click', (e) => e.stopPropagation());
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
    setTimeout(() => document.addEventListener('click', _ttpOutside, true), 0);
  }

  /**
   * 事前予約の「お約束」チップをクリック → 予約（確定）に変えられる小さなポップ（店長要望 2026-08-20）。
   * お客様と連絡がついて確定したときに、予約モーダルを開かずその場でフラグだけ変える。
   */
  function openPrepFlag(id, anchor) {
    closeTimeAdjust();
    const b = _tlBookingMap[id];
    if (!b) return;
    const cur = b.status || 'pre_reserved';
    const opts = [['reserved', '予約'], ['pre_reserved', '事前予約']];
    const pop = document.createElement('div');
    pop.id = 'tlFlagPop';
    pop.className = 'tl-time-pop';
    pop.innerHTML = `<div class="ttp-head"><span class="ttp-label">予約のフラグ</span><button class="ttp-close" type="button" aria-label="閉じる">×</button></div>` +
      opts.map(([v, l]) => `<button type="button" class="ttp-apply${v === cur ? ' is-cur' : ''}" data-flag="${v}">${v === cur ? '✓ ' : ''}${l}</button>`).join('');
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + window.scrollY + 4) + 'px';
    pop.style.left = (r.left + window.scrollX) + 'px';
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) pop.style.left = (window.innerWidth - pr.width - 8 + window.scrollX) + 'px';
    pop.querySelector('.ttp-close').addEventListener('click', (e) => { e.stopPropagation(); closeTimeAdjust(); });
    const btns = pop.querySelectorAll('[data-flag]');
    btns.forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const next = btn.getAttribute('data-flag');
      if (next === cur) { closeTimeAdjust(); return; }
      btns.forEach(x => { x.disabled = true; });
      try {
        await apiPost('/bookings.php?action=set-status', { id: Number(id), status: next });
        b.status = next;
        const cached = _tlBookingMap[id];
        if (cached && cached !== b) cached.status = next;
        toast(next === 'reserved' ? '✓ 予約にしました' : '✓ 事前予約にしました', 'ok');
        closeTimeAdjust();
        loadTimeline(true);
      } catch (err) {
        toast('更新失敗: ' + err.message, 'err');
        btns.forEach(x => { x.disabled = false; });
      }
    }));
    setTimeout(() => document.addEventListener('click', _ttpOutside, true), 0);
  }

  /**
   * 「遊べる時間」（即姫）をその場で決めるポップ（店長要望 2026-08-22）。
   * 予約の終了予定からではなく、手で決めた時刻をそのまま入れる。設定できるのは本日ぶんだけ
   */
  function openPlayEdit(userId, bizDay, curHm, anchor) {
    closeTimeAdjust();
    const parts = /^\d{1,2}:\d{2}$/.test(curHm) ? curHm.split(':') : null;
    const curH = parts ? parseInt(parts[0], 10) : null;
    const curM = parts ? parseInt(parts[1], 10) : null;
    // 営業は10:00〜翌9:00なので、時は 10→23→0→9 の順に並べる
    const hours = [...Array(14).keys()].map(i => i + 10).concat([...Array(10).keys()]);
    const hOpts = hours.map(h => `<option value="${h}"${h === curH ? ' selected' : ''}>${h}</option>`).join('');
    const mOpts = [...Array(12).keys()].map(i => i * 5)
      .map(m => `<option value="${m}"${m === curM ? ' selected' : ''}>${('0' + m).slice(-2)}</option>`).join('');
    const pop = document.createElement('div');
    pop.id = 'tlPlayPop';
    pop.className = 'tl-time-pop';
    // 操作はCTRLの即姫画面と同じ4つ（時刻設定 / 今すぐ / 受付終了 / クリア・店長指定 2026-08-22）
    pop.innerHTML = `<div class="ttp-head"><span class="ttp-label">遊べる時間</span><button class="ttp-close" type="button" aria-label="閉じる">×</button></div>
      <div class="ttp-time"><select class="ttp-sel ttp-h" aria-label="時">${hOpts}</select><span class="ttp-c">:</span><select class="ttp-sel ttp-m" aria-label="分">${mOpts}</select></div>
      <button type="button" class="ttp-apply" data-play-act="set">時刻設定</button>
      <button type="button" class="ttp-apply" data-play-act="now">今すぐ</button>
      <div class="ttp-sep"></div>
      <button type="button" class="ttp-apply is-cur" data-play-act="close">🚫 受付終了</button>
      <button type="button" class="ttp-apply is-cur" data-play-act="clear">クリア</button>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + window.scrollY + 4) + 'px';
    pop.style.left = (r.left + window.scrollX) + 'px';
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) pop.style.left = (window.innerWidth - pr.width - 8 + window.scrollX) + 'px';
    pop.querySelector('.ttp-close').addEventListener('click', (e) => { e.stopPropagation(); closeTimeAdjust(); });
    pop.querySelectorAll('select').forEach(sel => sel.addEventListener('click', e => e.stopPropagation()));

    const run = async (act, body, okMsg) => {
      pop.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try {
        await apiPost('/play-now.php?action=' + act, body);
        toast(okMsg, 'ok');
        closeTimeAdjust();
        loadTimeline(true);
      } catch (err) {
        toast('更新失敗: ' + err.message, 'err');
        pop.querySelectorAll('button').forEach(b => { b.disabled = false; });
      }
    };
    pop.querySelectorAll('[data-play-act]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = btn.getAttribute('data-play-act');
      if (act === 'set') {
        const h = parseInt(pop.querySelector('.ttp-h').value, 10);
        const m = parseInt(pop.querySelector('.ttp-m').value, 10);
        const hm = h + ':' + ('0' + m).slice(-2);
        run('set', { admin_user_id: userId, date: bizDay, hm }, `✓ ${hm}〜 遊べるにしました`);
      } else if (act === 'now') {
        run('now', { admin_user_id: userId, date: bizDay }, '✓ 今すぐ遊べるにしました');
      } else if (act === 'close') {
        run('close', { admin_user_id: userId, date: bizDay }, '✓ 受付終了にしました（出勤・ヒメ割はそのまま）');
      } else {
        run('clear', { admin_user_id: userId, date: bizDay }, '遊べる時間をクリアしました');
      }
    }));
    setTimeout(() => document.addEventListener('click', _ttpOutside, true), 0);
  }

  /**
   * 💳未 バッジをクリック → 「決済を確認した」だけをその場で付ける小さなポップ（店長要望 2026-08-22）。
   * 予約モーダルを開かずに、カード決済の確認を済ませられるようにする
   */
  // ===== 領収証（店長要望 2026-08-23）=====
  // 「領収証が必要」を押した予約は、タイムラインで 🧾 が点滅する。渡し忘れが多いため。
  // 🧾 を押して「渡した」にすると点滅が止まり、🧾✓ の点灯だけになる
  function setReceiptBtn(on) {
    const hid = bel('bmReceiptNeeded');
    const btn = bel('bmReceiptBtn');
    if (hid) hid.value = on ? '1' : '0';
    if (btn) {
      btn.classList.toggle('is-on', !!on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.textContent = on ? '🧾 領収証が必要 ✓' : '🧾 領収証が必要';
    }
  }
  function openReceiptGiven(id, anchor) {
    closeTimeAdjust();
    const b = _tlBookingMap[id];
    if (!b) return;
    const pop = document.createElement('div');
    pop.id = 'tlReceiptPop';
    pop.className = 'tl-time-pop';
    pop.innerHTML = `<div class="ttp-head"><span class="ttp-label">領収証</span><button class="ttp-close" type="button" aria-label="閉じる">×</button></div>
      <label class="ttp-card-chk"><input type="checkbox" id="tlReceiptChk"${b.receipt_given_at ? ' checked' : ''}> ✅ 領収証を渡した</label>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + window.scrollY + 4) + 'px';
    pop.style.left = (r.left + window.scrollX) + 'px';
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) pop.style.left = (window.innerWidth - pr.width - 8 + window.scrollX) + 'px';
    pop.querySelector('.ttp-close').addEventListener('click', (e) => { e.stopPropagation(); closeTimeAdjust(); });
    const chk = pop.querySelector('#tlReceiptChk');
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', async (e) => {
      e.stopPropagation();
      const given = chk.checked;
      chk.disabled = true;
      try {
        await apiPost('/bookings.php?action=set-receipt-given', { id: Number(id), given: given ? 1 : 0 });
        b.receipt_given_at = given ? '1' : null;
        toast(given ? '✓ 領収証をお渡しずみにしました' : 'まだ渡していないに戻しました', 'ok');
        closeTimeAdjust();
        loadTimeline(true);
      } catch (err) {
        toast('更新失敗: ' + err.message, 'err');
        chk.checked = !given; chk.disabled = false;
      }
    });
    setTimeout(() => document.addEventListener('click', _ttpOutside, true), 0);
  }

  function openCardPaid(id, anchor) {
    closeTimeAdjust();
    const b = _tlBookingMap[id];
    if (!b) return;
    const pop = document.createElement('div');
    pop.id = 'tlCardPop';
    pop.className = 'tl-time-pop';
    pop.innerHTML = `<div class="ttp-head"><span class="ttp-label">カード決済</span><button class="ttp-close" type="button" aria-label="閉じる">×</button></div>
      <label class="ttp-card-chk"><input type="checkbox" id="tlCardChk"${b.card_paid_at ? ' checked' : ''}> ✅ 決済を確認した</label>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + window.scrollY + 4) + 'px';
    pop.style.left = (r.left + window.scrollX) + 'px';
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) pop.style.left = (window.innerWidth - pr.width - 8 + window.scrollX) + 'px';
    pop.querySelector('.ttp-close').addEventListener('click', (e) => { e.stopPropagation(); closeTimeAdjust(); });
    const chk = pop.querySelector('#tlCardChk');
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', async (e) => {
      e.stopPropagation();
      const paid = chk.checked;
      chk.disabled = true;
      try {
        await apiPost('/bookings.php?action=set-card-paid', { id: Number(id), paid: paid ? 1 : 0 });
        b.card_paid_at = paid ? '1' : null;
        toast(paid ? '✓ 決済を確認しました' : '未確認に戻しました', 'ok');
        closeTimeAdjust();
        loadTimeline(true);
      } catch (err) {
        toast('更新失敗: ' + err.message, 'err');
        chk.checked = !paid; chk.disabled = false;
      }
    });
    setTimeout(() => document.addEventListener('click', _ttpOutside, true), 0);
  }

  async function openDriverAssign(id, dir, anchor) {
    closeTimeAdjust();
    const b = _tlBookingMap[id];
    if (!b) return;
    const isGo = dir === 'go';
    const curDrv = isGo ? (b.driver_id || '') : (b.back_driver_id || '');
    const curSelf = Number(isGo ? b.go_self : b.back_self) === 1;
    // ドライバー候補 = ロールがドライバー、または兼任(can_drive)のスタッフ。
    // そのうち **その営業日に出勤している人だけ** を出す（休み・未登録は出さない・店長要望 2026-08-11）。
    // 既に割り当て済みの人は、その日出勤していなくても選択が消えないよう必ず残す
    const bizDay = bizDateOf(String(b.booking_date || '').slice(0, 10), String(b.start_time || '10:00'));
    const [shifts, offSet] = await Promise.all([shiftsForDay(bizDay), driverOffSetForDay(bizDay)]);
    const capable = (adminUsersAll || []).filter(u => isDriverCapable(u));
    const drivers = capable.filter(u => {
      if (offSet.has(Number(u.id))) return false;   // まとめで「休み」にした人は候補から外す
      const sh = shiftForDay(shifts, bizDay, u.id);
      return !!sh && sh.status !== 'off';
    });
    if (curDrv && !drivers.some(u => String(u.id) === String(curDrv))) {
      const assigned = capable.find(u => String(u.id) === String(curDrv));
      if (assigned) drivers.push(assigned);
    }
    drivers.sort(opsStaffOrder(bizDay, shifts));   // 並びは「まとめ」と同じ（終了した人は下）
    // 送迎なしは「未定(-)」と「キャスト（自走）」の2択。値が違うので、どちらを選んでも change が飛ぶ
    const opts = `<option value="undecided" ${!curDrv && !curSelf ? 'selected' : ''}>-（未定）</option>` +
      `<option value="self" ${!curDrv && curSelf ? 'selected' : ''}>キャスト（自走）</option>` +
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
      const raw = String(e.target.value || '');
      const isSelf = raw === 'self';
      const dv = (raw === 'self' || raw === 'undecided') ? 0 : (parseInt(raw, 10) || 0);
      sel.disabled = true;
      try {
        const res = await apiPost('/bookings.php?action=set-driver', { id, leg: dir, driver_id: dv, self: isSelf ? 1 : 0 });
        const nm = dv ? (drivers.find(u => String(u.id) === String(dv))?.display_name || '') : '';
        if (isGo) { b.driver_id = dv || null; b.driver_name = nm; b.go_self = isSelf ? 1 : 0; b.pickup_go_time = res.pickup_time; }
        else { b.back_driver_id = dv || null; b.back_driver_name = nm; b.back_self = isSelf ? 1 : 0; b.pickup_back_time = res.pickup_time; }
        toast('✓ ' + (dv ? nm + ' を割当' : (isSelf ? 'キャスト（自走）に設定' : '未定に戻しました')), 'ok');
        loadTimeline(true);
        sel.disabled = false;
      } catch (err) { toast('更新失敗: ' + err.message, 'err'); sel.disabled = false; }
    });
    pop.querySelector('#tlDrvMail').addEventListener('click', (e) => { e.stopPropagation(); sendPickupMail(id, dir); });
    pop.querySelector('#tlDrvCopy').addEventListener('click', (e) => { e.stopPropagation(); copyPickup(id, dir); });
    setTimeout(() => document.addEventListener('click', _ttpOutside, true), 0);
  }

  /**
   * 横スクロールする箱を「掴んで動かせる」ようにする（店長要望 2026-08-08）。
   * 下のスクロールバーまで手を伸ばすのが面倒なため。
   *  - 指はブラウザ標準のスクロールに任せる（マウスのときだけ有効）
   *  - 5px 動くまでは「クリック」のまま。セルをクリックして新規予約、タブを押して切替、が従来どおり効く
   *  - ドラッグしたときは直後のクリックを1回だけ握りつぶす（動かした先で予約やタブが開かないように）
   *  - プルダウン等の上からは始めない（選択操作を邪魔しない）
   * @param {string} selector 対象の箱
   * @param {boolean} withPage 縦方向にページごと動かすか（タイムラインだけ true）
   */
  function initDragScroll(selector, withPage) {
    const wrap = document.querySelector(selector);
    if (!wrap || wrap.dataset.dragScroll) return;
    wrap.dataset.dragScroll = '1';
    const NO_DRAG = 'input,select,textarea,option,a';
    let down = false, dragging = false, sx = 0, sy = 0, startLeft = 0, startTop = 0;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (e.target?.closest?.(NO_DRAG)) return;
      down = true; dragging = false;
      sx = e.clientX; sy = e.clientY;
      startLeft = wrap.scrollLeft; startTop = window.scrollY;
    });
    window.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragging) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        dragging = true;
        wrap.classList.add('tl-dragging');
      }
      wrap.scrollLeft = startLeft - dx;
      if (withPage) window.scrollTo(window.scrollX, Math.max(0, startTop - dy));
      e.preventDefault();
    });
    window.addEventListener('pointerup', () => {
      if (!down) return;
      down = false;
      if (!dragging) return;
      dragging = false;
      wrap.classList.remove('tl-dragging');
      // click は pointerup の直後に同期的に飛ぶので、1回だけ止めてすぐ外す
      const kill = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', kill, true);
      setTimeout(() => window.removeEventListener('click', kill, true), 0);
    });
  }

  /**
   * ご利用履歴の表とモーダルの中身を、掴んで動かせるようにする（店長要望 2026-08-14）。
   * 中身は描き直されるので、要素ごとではなく委譲で拾う。いちばん近い枠を対象にするので、
   * モーダルの中の表は表が、それ以外はモーダル全体が動く。
   * 行はクリックで予約を開けるので、ドラッグした直後のクリックは1回だけ無効にする。
   */
  function initTableDragScroll() {
    if (document.body.dataset.histDrag) return;
    document.body.dataset.histDrag = '1';
    const NO_DRAG = 'input,select,textarea,option,a,button';
    const SCROLLERS = '.hist-tbl-wrap,.modal';   // .modal が縦スクロールの枠（.modal-body ではない）
    let wrap = null, down = false, dragging = false, allowX = false, sx = 0, sy = 0, sl = 0, st = 0;
    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (e.target?.closest?.(NO_DRAG)) return;
      const w = e.target?.closest?.(SCROLLERS);
      if (!w) return;
      // 動かせる余地が無い枠（縦にも横にもはみ出していない）は掴まない
      if (w.scrollHeight <= w.clientHeight + 2 && w.scrollWidth <= w.clientWidth + 2) return;
      wrap = w; down = true; dragging = false;
      allowX = w.matches('.hist-tbl-wrap');   // 横に長い表だけ横ドラッグ。モーダル本体は縦だけ
      sx = e.clientX; sy = e.clientY; sl = w.scrollLeft; st = w.scrollTop;
    });
    window.addEventListener('pointermove', (e) => {
      if (!down || !wrap) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragging) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        // 横向きの動きは文字を選んでコピーしたいとき。モーダル本体では掴まず、選択にまかせる（店長要望 2026-08-14）
        if (!allowX && Math.abs(dx) > Math.abs(dy)) { down = false; wrap = null; return; }
        dragging = true;
        wrap.classList.add('tl-dragging');
      }
      if (allowX) wrap.scrollLeft = sl - dx;
      wrap.scrollTop = st - dy;
      e.preventDefault();
    });
    window.addEventListener('pointerup', () => {
      if (!down) return;
      down = false;
      if (!dragging) { wrap = null; return; }
      dragging = false;
      wrap.classList.remove('tl-dragging');
      wrap = null;
      const kill = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', kill, true);
      setTimeout(() => window.removeEventListener('click', kill, true), 0);
    });
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

  // 現在時刻の赤い縦線（当日を表示しているときだけ）。1分ごとに動く。
  function updateNowLine() {
    const gridEl = document.getElementById('timelineGrid')?.querySelector('.tl-grid');
    if (!gridEl) return;
    let line = gridEl.querySelector('.tl-nowline');
    // 今日（営業日）以外を見ているときは出さない
    if (fmtDate(tlCurrentDate) !== fmtDate(getBusinessDayDate())) { if (line) line.remove(); return; }
    const headCells = gridEl.querySelectorAll('.tl-head:not(.staff-col)');
    if (!headCells.length) return;
    const now = new Date();
    let offsetH = now.getHours() + now.getMinutes() / 60 - 10;   // 10:00 起点
    if (offsetH < 0) offsetH += 24;                               // 深夜帯は翌日扱い
    if (offsetH < 0 || offsetH > 24) { if (line) line.remove(); return; }
    // 時間セルの実位置で正確に置く（セル幅・隙間に依存しない）
    const hi = Math.min(headCells.length - 1, Math.floor(offsetH));
    const cell = headCells[hi];
    const x = cell.offsetLeft + (offsetH - Math.floor(offsetH)) * cell.offsetWidth;
    if (!line) {
      line = document.createElement('div');
      line.className = 'tl-nowline';
      gridEl.appendChild(line);
    }
    line.style.left = x + 'px';
    // 時刻ヘッダー行の高さ分だけ下げて開始 → 時刻ラベルは常に前面、点線はその下から
    line.style.top = (cell.offsetHeight || 0) + 'px';
  }
  // 現在時刻ラインを自走させる（タイムライン表示中のみ、20秒ごと）
  setInterval(() => {
    const view = document.getElementById('view-timeline');
    if (document.hidden || !view || !view.classList.contains('active')) return;
    updateNowLine();
  }, 20000);

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

  // admi はカード手数料をお客様に上乗せして受け取るので、キャストの報酬は決済方法に左右されない
  //（ylka はキャストが半分負担していた・店長指定 2026-08-07）。サーバ ylkaCardFeeTherapist と同じく0固定。
  function cardFeeSelf(price, trans, pm) {
    return 0;
  }
  // キャスト報酬の算出（サーバ ylkaReward と同式）: 深夜=帰り送迎ありは店、交通費は自走した片道ごとに機動ボーナス
  // クレジットでも報酬は変わらない（手数料はお客様に上乗せして受け取る・admi 方式）
  // rewardOverride: 予約単位の手入力オーバーライド（微調整用）が入っていればそれをそのまま返す
  // コース名から、マスタに登録された「キャスト報酬」を引く（admi 方式）。
  // 未登録・見つからない場合は null を返し、歩合率(%)方式にフォールバックする。
  function courseCastReward(courseName, hotelApplied) {
    if (!courseName) return null;
    // 保存名は「60分コース ＋10分」「90分コース ＋ 90分コース」の形になりうるので、
    // ＋10分を落として ＋ で分解し、各コースの報酬を足す
    const cname = String(courseName).replace(/\s*＋\s*10\s*分\s*$/, '').trim();
    const parts = cname.split(/\s*[＋+]\s*/).map(x => x.trim()).filter(Boolean);
    let total = null;
    parts.forEach(nm => {
      const c = (coursesCache || []).find(x => String(x.name) === nm);
      if (!c) return;
      // ホテル料金を適用した予約は、そのコースの「ホテル料金のキャスト報酬」を使う（未設定なら通常）
      let v = null;
      if (hotelApplied && c.hotel_cast_reward != null && c.hotel_cast_reward !== '') v = parseInt(c.hotel_cast_reward, 10) || 0;
      else if (c.cast_reward != null && c.cast_reward !== '') v = parseInt(c.cast_reward, 10) || 0;
      if (v !== null) total = (total || 0) + v;
    });
    return total;
  }
  /** 保存済みの menu_items テキストからオプションのキャスト報酬を出す（PHP の opsOptionReward と同式） */
  function menuItemsReward(menuItems) {
    const txt = String(menuItems || '').trim();
    if (!txt) return 0;
    return (optionsCache || []).reduce((n, o) => {
      const r = (o.cast_reward != null && o.cast_reward !== '') ? Number(o.cast_reward) || 0 : 0;
      return n + (r && o.name && txt.includes(o.name) ? r : 0);
    }, 0);
  }
  /**
   * 予約1件のキャスト報酬。**サーバの ylkaReward と必ず同じ式にすること**。
   *   コース報酬（マスタ固定額）＋ オプション報酬 ＋ 指名料の報酬 ＋ 深夜料金 ＋ 機動ボーナス
   * 歩合率(%)は使わない（店長方針 2026-08-05: 報酬はコース管理の固定額のみ）。
   * 深夜料金は帰りが「キャスト（自走）」のときだけキャスト。送迎（と未定）は全額お店。
   */
  function calcReward(price, late, trans, rate, goDrv, backDrv, pm, rewardOverride, courseName, hotelApplied, nominationType, menuItems, extensionCount, goSelf, backSelf) {
    if (rewardOverride !== undefined && rewardOverride !== null && rewardOverride !== '') return parseInt(rewardOverride, 10) || 0;
    const lateT = backSelf ? late : 0;
    let transT = 0;
    // 機動ボーナス（店長指定 2026-08-09）。PHP の ylkaTherapistTransport と同式。
    //   行き帰りとも自走 … 交通費の全額（¥1,650 なら ¥1,650）
    //   片道だけ自走     … 交通費の半分を50円単位で切り上げ（¥1,650 → ¥825 → ¥850）
    // 片道ずつ切り上げて足すと往復が ¥1,700 になり交通費を超えるため、往復は満額とする
    // 対象は「キャスト（自走）」を選んだ片道だけ。「-（未定）」は送迎とみなす（店長指定 2026-08-10）
    if (trans > 0) {
      const selfLegs = (goSelf ? 1 : 0) + (backSelf ? 1 : 0);
      if (selfLegs === 2) transT = trans;
      else if (selfLegs === 1) transT = Math.ceil(Math.ceil(trans / 2) / 50) * 50;
    }
    // マスタのコース別「キャスト報酬」。未設定のコースは0円（マスタに入れるまで報酬は出ない）
    const base = courseCastReward(courseName, hotelApplied) || 0;
    // 指名の報酬もコースの本数ぶん（90＋90 なら2本分）。お客様の指名料と同じ数え方
    return base + menuItemsReward(menuItems)
      + nominationRewardFor(nominationType) * courseUnitCount(courseName)
      + extensionRewardUnit() * (Number(extensionCount) || 0)
      + lateT + transT - cardFeeSelf(price, trans, pm);
  }
  /** 予約オブジェクトからの報酬。画面のどこから出しても同じ額になるよう必ずここを通す */
  function rewardOf(b) {
    return calcReward(
      Number(b.price) || 0, Number(b.late_fee) || 0, Number(b.transport_fee) || 0, Number(b.commission_rate),
      !!b.driver_id, !!b.back_driver_id, b.payment_method, b.reward_override,
      b.course_name, Number(b.hotel_price_applied) === 1, b.nomination_type, b.menu_items, b.extension_count,
      selfLegOf(b, 'go'), selfLegOf(b, 'back'));
  }
  /** その片道をキャストが自走したか。「-（未定）」は送迎とみなす（機動ボーナスなし） */
  function selfLegOf(b, leg) {
    return leg === 'go'
      ? (!b.driver_id && Number(b.go_self) === 1)
      : (!b.back_driver_id && Number(b.back_self) === 1);
  }
  // 時刻のテキスト表示は実時刻・0埋めなし（例 02:00→2:00）。24h+表記(displayTime)は位置計算・ソート専用
  function fmtTimeDisp(t) { return String(t || '').slice(0, 5).replace(/^0/, ''); }
  // 現金を預からない決済（カード/振込）。預り金・入金分の「現金の所在」追跡から除外する
  const NON_CASH_PM = ['credit', 'card', 'bank'];
  const isNonCash = (b) => NON_CASH_PM.includes(String(b.payment_method || ''));
  // 現金＋クレジットの併用（稀にある・店長要望 2026-08-08）。1件の中に両方が混ざるので
  // 「現金かどうか」ではなく「いくら現金で受け取ったか」で追跡する
  const isSplitPay = (b) => String(b.payment_method || '') === 'split';
  /** カードを使う予約なのに決済確認がまだ。回収漏れになるのでタイムラインで目立たせる（店長要望 2026-08-08） */
  const isCardUnconfirmed = (b) => ['credit', 'card', 'split'].includes(String(b.payment_method || '')) && !b.card_paid_at;
  /**
   * お客様から受け取る総額（クレジットの上乗せ分を含む）。
   * 集金APIの行は金額が sales に入っていて明細を持たないので、そちらも受けられるようにしている
   */
  const customerTotalOf = (b) => (b && b.price == null && b.sales != null)
    ? (Number(b.sales) || 0)
    : (Number(b.price) || 0) + (Number(b.transport_fee) || 0) + (Number(b.card_fee) || 0);
  /** そのうち現金で受け取る額。カード/振込は0、併用は入力された現金額（総額は超えない） */
  const cashTakenOf = (b) => {
    if (isNonCash(b)) return 0;
    if (isSplitPay(b)) return Math.min(customerTotalOf(b), Math.max(0, Number(b.cash_amount) || 0));
    return customerTotalOf(b);
  };
  /** クレジットで切った額（併用の残り） */
  const cardTakenOf = (b) => isSplitPay(b) ? customerTotalOf(b) - cashTakenOf(b) : (isNonCash(b) ? customerTotalOf(b) : 0);
  // 預り金の既定の保有者 = 帰りのお迎え担当（ドライバー）。お迎えが無ければ担当キャスト本人。
  // キャストは接客後にお迎えのドライバーへ現金を渡す運用のため（店長指定 2026-08-07）。
  // held_by（受け渡しで明示的に記録された保有者）があればそちらが優先。
  const defaultHolderOf = (b) => {
    if (!b) return 0;
    // 報酬を渡した人は、その現金を持っていた人（渡す原資がその予約の現金のため）。
    // 受け渡しの記録が無いときは、お迎え担当よりこちらを優先する（記録漏れで現金が残って見えるのを防ぐ・店長指摘 2026-08-15）
    if (b.reward_paid_at && b.reward_paid_by != null && b.reward_paid_by !== '') return Number(b.reward_paid_by);
    return (b.back_driver_id != null && b.back_driver_id !== '') ? Number(b.back_driver_id) : Number(b.assigned_admin_id);
  };
  /**
   * その予約の現金を「いま持っている人」に登録された色（スタッフ管理の🎨預り金カードの色）。
   * 受け渡し済みなら held_by、未受け渡しなら既定の保有者（帰りのお迎え担当→無ければ担当キャスト）。
   * 現金の入りが無い予約（カード・振込）と、色を登録していない人は色なし。
   */
  const holderColorOf = (b) => {
    if (!b || cashTakenOf(b) <= 0) return '';
    const hid = (b.held_by != null && b.held_by !== '') ? Number(b.held_by) : defaultHolderOf(b);
    if (!hid) return '';
    const u = (adminUsersAll || []).find(x => Number(x.id) === hid) || (allUsers || []).find(x => Number(x.id) === hid);
    return (u && u.staff_color) ? String(u.staff_color) : '';
  };
  const pmBadge = (b) => String(b.payment_method) === 'bank' ? '🏦 振込'
    : (String(b.payment_method) === 'split' ? '🧾 現金＋カード' : '💳 カード');
  // 兼任判定: role(主ロール)に加え is_therapist/is_office/can_drive の兼任フラグも見る（例: 橘=role manager だが is_therapist/is_office 兼任）
  const isTherapistCapable = (u) => u.role === 'staff' || Number(u.is_therapist) === 1;

  /**
   * 権限に応じて兼任チェックの出し分けをする（店長指定 2026-08-07）。
   *   ドライバー … 送迎のみ。兼任は無し
   *   内勤スタッフ・管理者・オーナー … もともと内勤業務なので「内勤兼任」は出さない。送迎兼任だけ選べる
   *   キャスト … 両方選べる
   * 隠した項目のチェックは外して、実態と保存値がずれないようにする。
   */
  function syncConcurrentFields(prefix, role) {
    const wrap = document.getElementById(prefix + 'ConcurrentField');
    const officeRow = document.getElementById(prefix + 'OfficeRow');
    const officeCb = document.getElementById(prefix === 'cs' ? 'csIsOffice' : 'esIsOffice');
    const driveCb = document.getElementById(prefix === 'cs' ? 'csCanDrive' : 'esCanDrive');
    const isDriver = role === 'driver';
    const isOfficeSide = role === 'office' || role === 'manager' || role === 'owner';
    if (wrap) wrap.style.display = isDriver ? 'none' : '';
    if (officeRow) officeRow.style.display = (isDriver || isOfficeSide) ? 'none' : '';
    if (officeCb && (isDriver || isOfficeSide)) officeCb.checked = false;
    if (driveCb && isDriver) driveCb.checked = false;
  }

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
    // 入金分（店取り分）= 全額 − 報酬。
    // ただしキャストへの報酬は現金からのみ支払うため、カード・振込は満額がそのまま店の入金分になる（店長指定 2026-08-15）
    const netOf = (b) => {
      const price = Number(b.price) || 0, late = Number(b.late_fee) || 0, trans = Number(b.transport_fee) || 0, cardFee = Number(b.card_fee) || 0;
      const amt = customerTotalOf(b);   // お客様から受け取る総額（クレジットの上乗せ分を含む）
      if (isNonCash(b)) return amt;     // カード・振込は満額。報酬は現金から出るので引かない
      const reward = meHasRate ? rewardOf(b) : 0;
      return amt - reward;
    };
    const netTotal = earned.reduce((s, b) => s + netOf(b), 0);
    // 入金分の保有者 = 預り金の保有者（held_by。無ければ受領者/担当）。カード/振込は最初から店の口座
    const netHolderOf = (b) => {
      if (isNonCash(b)) return `${pmBadge(b)}入金`;
      if (b.held_by != null && b.held_by !== '') return nameOf(b.held_by);
      if (b.shop_settled && b.shop_settled_by) return nameOf(b.shop_settled_by);
      return nameOf(defaultHolderOf(b));
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
    // 受け渡し候補: 内勤スタッフとドライバーのみ（キャストへの受け渡しは無い・店長指定 2026-08-07）。その日の出勤者だけ
    const netDuty = opsOnDutySet(bizDay, earned.flatMap(b => [b.held_by, b.reward_paid_by, b.shop_settled_by]));
    const people = (adminUsersAll || []).filter(u => u.id && netDuty.has(Number(u.id)) && (isOfficeCapable(u) || isDriverCapable(u))).sort(opsStaffOrder(bizDay));
    let html = `<div style="font-weight:700;">入金分合計 ${yen(netTotal)}（${earned.length}件）</div>
      ${netSummary}
      <div style="font-size:.8rem;color:var(--ink-soft);margin-bottom:.7rem;">入金分（預り金 − 報酬）を誰がいくら持っているかを表示します。お金のやり取りが終わったお仕事は「精算確定」で締めてください。</div>${batchSettleBtn}`;
    if (!earned.length) html += '<p style="color:var(--ink-soft);">この日の入金はありません。</p>';
    earned.forEach(b => {
      const price = Number(b.price) || 0, late = Number(b.late_fee) || 0, trans = Number(b.transport_fee) || 0, cardFee = Number(b.card_fee) || 0;
      const amt = customerTotalOf(b);   // お客様から受け取る総額（クレジットの上乗せ分を含む）
      const reward = meHasRate ? rewardOf(b) : 0;
      const net = netOf(b);
      // カード・振込は満額が入金分。報酬は現金から出ることが分かるように添える（店長指定 2026-08-15）
      const cardNote = (isNonCash(b) && reward > 0)
        ? `<span class="chain-now-badge">💰 報酬 ${yen(reward)} は現金から支払い</span>` : '';
      const amtCell = net !== amt
        ? `<b>${yen(net)}</b><small style="color:var(--ink-soft);font-weight:500;"> ／全額 ${yen(amt)}</small>`
        : `<b>${yen(amt)}</b>`;
      const head = `<div style="display:flex;justify-content:space-between;gap:.5rem;"><span>${formatDate(bizDay)} ${escapeHtml(fmtTimeDisp(b.start_time))}・${escapeHtml(b.customer_name_snapshot || '—')}</span><span style="white-space:nowrap;">${amtCell}</span></div>
        <div style="margin-top:.35rem;display:flex;gap:.35rem;flex-wrap:wrap;"><span class="chain-now-badge">📍 <b>${escapeHtml(netHolderOf(b))}</b></span>${cardNote}</div>`;
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
          const curHolder = (b.held_by != null && b.held_by !== '') ? Number(b.held_by) : defaultHolderOf(b);
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
      if (!await opsConfirm(`「${btn.dataset.desc}」のお金のやり取りを終了（精算確定）します。${warn}\nよろしいですか？`)) return;
      btn.disabled = true;
      try { await apiPost('/admin-api.php?action=booking-settle', { id: Number(btn.dataset.id), settled: 1, kind: 'full' }); toast('✓ 精算確定しました', 'ok'); await holderReload(); }
      catch (e) { toast('確定失敗: ' + e.message, 'err'); btn.disabled = false; }
    }));
    document.querySelectorAll('#holderModalBody .settle-undo').forEach(btn => btn.addEventListener('click', async () => {
      if (!await opsConfirm('精算確定を取り消しますか？')) return;
      btn.disabled = true;
      try { await apiPost('/admin-api.php?action=booking-settle', { id: Number(btn.dataset.id), settled: 0 }); toast('精算確定を取り消しました', 'ok'); await holderReload(); }
      catch (e) { toast('取消失敗: ' + e.message, 'err'); btn.disabled = false; }
    }));
    const settleAllBtn = document.querySelector('#holderModalBody .holder-settle-all');
    if (settleAllBtn) settleAllBtn.addEventListener('click', async () => {
      const ids = unsettledList.map(b => b.id);
      const noRwd = unsettledList.filter(b => !b.reward_paid_at).length;
      const warn = noRwd ? `\n※ うち${noRwd}件は報酬がまだ「渡し済み」になっていません。` : '';
      if (!await opsConfirm(`本日分 ${ids.length}件をまとめて精算確定します。${warn}\nよろしいですか？`)) return;
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
      if (!await opsConfirm(`入金分 ${yen(Number(btn.dataset.net))} を ${toName} に渡します。\n報酬 ${yen(Number(btn.dataset.reward))} は ${meName} の手元に残る記録になります。よろしいですか？`)) return;
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

  // 勤務実績の時刻は15分刻み（店長指定 2026-08-11）。
  // <input type="time"> の step はブラウザのピッカーに効かない（分が1刻みのまま出る）ので、
  // 時と分の select を自前で組む。時は営業日の並び（10時始まり）、分は 00/15/30/45。
  // 既に別の分で保存されている値は、勝手に丸めず選択肢に足して残す。
  const WORK_MIN_STEPS = ['00', '15', '30', '45'];
  function workTimeSelects(cls, val) {
    const v = String(val || '').slice(0, 5);
    const hh = v ? v.slice(0, 2) : '';
    const mm = v ? v.slice(3, 5) : '';
    const hours = Array.from({ length: 24 }, (_, i) => String((i + 10) % 24).padStart(2, '0'));
    const mins = (mm === '' || WORK_MIN_STEPS.includes(mm)) ? WORK_MIN_STEPS : [...WORK_MIN_STEPS, mm].sort();
    return `<select class="${cls}-h" aria-label="時">
        <option value="">--</option>${hours.map(h => `<option value="${h}"${h === hh ? ' selected' : ''}>${Number(h)}</option>`).join('')}
      </select><span class="cs-work-colon">:</span><select class="${cls}-m" aria-label="分">
        <option value="">--</option>${mins.map(m => `<option value="${m}"${m === mm ? ' selected' : ''}>${m}</option>`).join('')}
      </select>`;
  }
  /** 時＋分の select から "HH:MM" を組む。時が空なら未入力あつかいで '' */
  function readWorkTime(row, cls) {
    const h = row.querySelector('.' + cls + '-h')?.value || '';
    const m = row.querySelector('.' + cls + '-m')?.value || '';
    return h ? (h + ':' + (m || '00')) : '';
  }


  // ===== ⚠ キャストからの報告（キャスト画面の「お店に報告」）=====
  // キャストは伝えるだけ。出禁/要注意/その子だけ外す の判断は店長が押す（店長方針 2026-08-11）。
  // 押した内容はお客様のNG設定にそのまま入るので、予約時の警告は既存のものが効く。
  const CR_LV = { ng: ['lv-ng', 'NGにしてほしい'], caution: ['lv-caution', '気をつけてほしい'] };

  async function refreshCastReportBadge() {
    const btn = document.getElementById('tlCastReports');
    if (!btn) return;
    if (!userCanSeeTab('timeline')) { btn.hidden = true; return; }
    try {
      const d = await api('/admin-api.php?action=cast-reports-count');
      const n = Number(d.pending) || 0;
      document.getElementById('tlCastRepN').textContent = n;
      btn.hidden = n === 0;
    } catch (e) { btn.hidden = true; }
  }

  async function openCastReportModal() {
    const body = document.getElementById('castRepBody');
    if (!body) { toast('画面を再読み込みしてください', 'err'); return; }
    body.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    openModal('castRepModal');
    await renderCastReports();
  }

  async function renderCastReports() {
    const body = document.getElementById('castRepBody');
    const all = document.getElementById('crShowAll')?.checked;
    let d;
    try { d = await api('/admin-api.php?action=cast-reports&status=' + (all ? 'all' : 'pending')); }
    catch (e) { body.innerHTML = '<p style="color:var(--coral);">読み込み失敗: ' + escapeHtml(e.message) + '</p>'; return; }
    const rows = d.reports || [];
    if (!rows.length) {
      body.innerHTML = `<p style="color:var(--ink-soft);padding:1.5rem 0;text-align:center;">${all ? '報告はありません。' : '未対応の報告はありません。'}</p>`;
      return;
    }
    body.innerHTML = rows.map(r => {
      const [cls, label] = CR_LV[r.level] || ['lv-caution', r.level || ''];
      const when = String(r.created_at || '').slice(5, 16).replace('-', '/');
      const job = r.booking_date
        ? `${formatDate(bizDateOf(r.booking_date, r.start_time || '00:00'))} ${fmtTimeDisp(r.start_time)}のお仕事`
        : '';
      const done = r.status === 'done';
      const nm = escapeAttr(r.customer_name || 'お客様');
      const acts = done
        ? `<div class="cr-done-note">✓ 対応済み${r.handled_name ? '（' + escapeHtml(r.handled_name) + '）' : ''}${r.handled_at ? ' ' + String(r.handled_at).slice(5, 16).replace('-', '/') : ''}</div>`
        : `<div class="cr-acts">
             <button type="button" data-cr="cast_ng" data-id="${r.id}" data-name="${nm}" data-cast="${escapeAttr(r.cast_name || '')}">この子だけ外す</button>
             <button type="button" data-cr="caution" data-id="${r.id}" data-name="${nm}">⚠ 要注意にする</button>
             <button type="button" class="is-ng" data-cr="ng" data-id="${r.id}" data-name="${nm}">🚫 出禁にする</button>
             <button type="button" data-cr="done" data-id="${r.id}" data-name="${nm}">確認済み</button>
           </div>`;
      const now = Number(r.ng_level) > 0 || Number(r.cast_ng) === 1
        ? `<span style="font-size:.78rem;color:var(--ink-soft);">現在: ${Number(r.ng_level) === 2 ? '出禁' : Number(r.ng_level) === 1 ? '要注意' : ''}${Number(r.cast_ng) === 1 ? (Number(r.ng_level) > 0 ? '・' : '') + 'この子だけNG' : ''}</span>` : '';
      return `<div class="cr-item${done ? ' is-done' : ''}">
        <div class="cr-top"><span class="cr-lv ${cls}">${escapeHtml(label)}</span>
          <b style="color:var(--deep);">${escapeHtml(r.cast_name || '—')}</b> より
          <span>${escapeHtml(when)}</span>${job ? `<span>・${escapeHtml(job)}</span>` : ''}${now}</div>
        <div class="cr-cust">${escapeHtml(r.customer_name || 'お客様')} 様</div>
        ${r.reason ? `<div class="cr-reason">${escapeHtml(r.reason)}</div>` : ''}
        ${acts}
      </div>`;
    }).join('');

    body.querySelectorAll('[data-cr]').forEach(btn => btn.addEventListener('click', async () => {
      const act = btn.dataset.cr;
      const msg = {
        cast_ng: `${btn.dataset.name} 様に ${btn.dataset.cast} を出さないようにします。お店としては受けます。よろしいですか？`,
        caution: `${btn.dataset.name} 様を「要注意」にします。予約を取るときに警告が出ます。よろしいですか？`,
        ng: `${btn.dataset.name} 様を「出禁」にします。お店として受けなくなります。よろしいですか？`,
        done: '記録だけ残して対応済みにします。よろしいですか？',
      }[act];
      if (!await opsConfirm(msg)) return;
      btn.disabled = true;
      try {
        await apiPost('/admin-api.php?action=cast-report-handle', { id: Number(btn.dataset.id), act });
        toast('✓ 対応済みにしました', 'ok');
        await renderCastReports();
        refreshCastReportBadge();
      } catch (e) { toast('失敗: ' + e.message, 'err'); btn.disabled = false; }
    }));
  }

  /** 顧客カルテに出す「キャストからの報告」履歴 */
  async function renderCustomerReports(customerId) {
    const box = document.getElementById('cmReports');
    if (!box) return;
    box.innerHTML = '';
    if (!customerId) return;
    let d;
    try { d = await api('/admin-api.php?action=cast-reports-for-customer&customer_id=' + Number(customerId)); }
    catch (e) { return; }
    const rows = d.reports || [];
    if (!rows.length) return;
    box.innerHTML = `<div class="field-label" style="font-weight:700;font-size:.85rem;margin-bottom:.3rem;">⚠ キャストからの報告（${rows.length}件）</div>`
      + rows.map(r => {
        const [, label] = CR_LV[r.level] || ['', r.level || ''];
        return `<div class="cm-rep">
          <div class="cm-rep-h"><b>${escapeHtml(r.cast_name || '—')}</b>
            <span>${escapeHtml(String(r.created_at || '').slice(5, 16).replace('-', '/'))}</span>
            <span>${escapeHtml(label)}</span>
            <span>${r.status === 'done' ? '✓ 対応済み' : '未対応'}</span></div>
          ${r.reason ? `<div class="cm-rep-b">${escapeHtml(r.reason)}</div>` : ''}
        </div>`;
      }).join('');
  }

  // 現金まとめ: 本日出勤スタッフが現在いくら預り金を持っているかを一覧表示（owner/manager）
  async function openCashSummaryModal() {
    const el = document.getElementById('cashSummaryBody');
    if (!el) { toast('画面を再読み込みしてください', 'err'); return; }
    el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    openModal('cashSummaryModal');
    // コース・オプションのマスタが未読込のまま計算すると、コース報酬が0円になって
    // 報酬が指名料ぶんだけの少額で出てしまう（起動時の読み込みは待っていないため・店長指摘 2026-08-14）
    try { await Promise.all([ensureCoursesLoaded(), ensureOptionsLoaded()]); } catch (e) {}
    let data;
    // 現金は営業日ごとに締める。繰越は無い（店長指定 2026-08-08）ので、
    // タイムラインで見ている営業日のぶんだけを出す。前の日ぶんはその日に戻れば見られる
    const cashBizDay = fmtDate(tlCurrentDate);
    try { data = await api('/admin-api.php?action=cash-summary&date=' + encodeURIComponent(cashBizDay)); }
    catch (e) { el.innerHTML = '<p style="color:var(--coral);">読み込み失敗: ' + escapeHtml(e.message) + '</p>'; return; }

    const nameOf = (id, name, uname) => name || uname || ('#' + id);
    // 立て替えで手元がマイナスになりうるので、符号を頭に出す（¥-9,000 は読みにくい）
    const yenSigned = (n) => (n < 0 ? '−¥' + Math.abs(Number(n)).toLocaleString() : yen(n));
    let html = '';
    let summaryText = '';   // まとめのプレーンテキスト（コピー / メール用）
    const holderCardText = {};   // 担当者ごとのカード文面（uid → テキスト。個別コピー/メール用）

    // 受け渡しの権限と渡し先候補（内勤スタッフとドライバーのみ・キャストへは渡さない）。
    // ルールはタイムラインの受け渡しモーダルと同じにそろえる
    // まとめの閲覧・受け渡しは内勤スタッフ以上（事務所として締める作業のため・店長指定 2026-08-14）
    const csCanHandoff = currentUser?.role !== 'staff';   // 制限はメニューのみ（店長指定 2026-08-14）
    const csDuty = opsOnDutySet(cashBizDay, (data.uncollected || []).flatMap(b => [b.held_by, b.reward_paid_by, b.assigned_admin_id]));
    const csHandoffPeople = (adminUsersAll || []).filter(u => u.id && csDuty.has(Number(u.id)) && (isOfficeCapable(u) || isDriverCapable(u))).sort(opsStaffOrder(cashBizDay));

    // ─ 預り金の保有状況（本日出勤のキャスト・内勤・ドライバーを名簿ベースで表示） ─
    // 報酬確定済み（渡し済み/本人確保）の予約は残額（全額−報酬）で計上
    const heldAmtOf = (b) => {
      const price = Number(b.price) || 0, late = Number(b.late_fee) || 0, trans = Number(b.transport_fee) || 0, cardFee = Number(b.card_fee) || 0;
      const rate = Number(b.commission_rate);
      const hasRate = b.commission_rate != null && b.commission_rate !== '' && !Number.isNaN(rate);
      const amt = cashTakenOf(b);   // 現金として預かっている額（併用は現金ぶんだけ）
      if (b.reward_paid_at && hasRate) return amt - rewardOf(b);
      return amt;
    };
    // お客様名は「様」付きで（店長要望 2026-08-08）。名前が無いときは付けない
    const custName = (b) => {
      const n = String(b.customer_name_snapshot || '').trim();
      return n ? escapeHtml(n) + ' 様' : '—';
    };
    // 渡した報酬の額（0のときは記録しない）。報酬を渡した予約は預り金がそのぶん減っている
    const paidRewardOf = (b) => {
      if (!b.reward_paid_at) return 0;
      const rate = Number(b.commission_rate);
      if (b.commission_rate == null || b.commission_rate === '' || Number.isNaN(rate)) return 0;
      return rewardOf(b);
    };
    // クレジット・振込は現金の入りが無い。報酬を立て替えていない予約は出す意味がないので落とす
    //（立て替えたものは「−報酬」の行として残し、手元がいくら減ったかを見せる）
    const unc = (data.uncollected || []).filter(b => cashTakenOf(b) > 0 || paidRewardOf(b) > 0);
    // 現在の保有者ID別に集計（held_by優先、未設定なら担当本人）。
    // カード・振込予約は現金を持たないので保有明細には並べない（報酬の立て替えは「渡した人」の手元から引く・店長指摘 2026-08-14）
    const byHolderId = {};
    unc.forEach(b => {
      if (cashTakenOf(b) <= 0) return;
      const hId = (b.held_by != null && b.held_by !== '') ? Number(b.held_by) : defaultHolderOf(b);
      if (!byHolderId[hId]) byHolderId[hId] = [];
      byHolderId[hId].push(b);
    });
    // 「💸 ◯◯ に報酬を渡した」は、その予約の現金を持っているかに関係なく
    // 実際に報酬を渡した人(reward_paid_by)基準で集計する（報酬はまとめて誰かが渡す運用・店長指摘 2026-08-14）
    const rewardOfPaid = (b) => {
      const rate = Number(b.commission_rate);
      const hasRate = b.commission_rate != null && b.commission_rate !== '' && !Number.isNaN(rate);
      return (b.reward_paid_at && hasRate) ? rewardOf(b) : 0;
    };
    const payerIdOf = (b) => b.reward_paid_at ? Number(b.reward_paid_by) : null;
    // 明細は「お預り金（お客様からの現金・満額）」で出す（店長指摘 2026-08-14）
    const depositOf = (b) => cashTakenOf(b);
    // 並び順のキー: 営業日 + 受付時刻。0〜9時台は同じ営業日の続きなので24時足しで後ろへ
    const csTimeOrd = (b) => {
      const d = Number(String(bizDateOf(b.booking_date, b.start_time || '00:00') || '').replace(/-/g, '')) || 0;
      const m = String(b.start_time || '00:00').match(/^(\d{1,2}):(\d{2})/);
      const h = m ? Number(m[1]) : 0, mi = m ? Number(m[2]) : 0;
      return d * 10000 + ((h < 10 ? h + 24 : h) * 60 + mi);
    };
    // カード・振込予約の報酬は現金の入りが無いぶん、渡した人(reward_paid_by)の手元現金から出ている。
    // その人が現金を次の人へ渡していれば、渡した額はそのぶん少ない＝控除も渡し先へ移る（現金の動きだけを追う・店長指摘 2026-08-14）
    const pocketHolderOf = (uid, seen) => {
      const id = Number(uid);
      if ((byHolderId[id] || []).length) return id;          // まだ現金（保有予約）がある
      const gave = gaveByAdminId[id] || [];
      if (!gave.length) return id;
      const to = Number(gave[gave.length - 1].to);
      const s = new Set(seen || []);
      if (!to || to === id || s.has(to)) return id;
      s.add(id);
      return pocketHolderOf(to, s);
    };
    // 報酬を出した現金の持ち主。記録上の支払者が現金の流れに居ないとき（キャスト本人が確保した等）は、
    // その時刻に現金を持っていた人の手元から出たものとして扱う（そうしないと帳尻が合わない）
    const effPayerOf = (b) => {
      const pid = payerIdOf(b);
      if (!pid) return null;
      // 記録上の支払者がその予約の担当キャスト＝本人が自分の報酬を確保した場合。
      // 現金はそのとき持っていた人の手元から出ているので、その人を支払者として扱う
      if (cashTakenOf(b) > 0 && Number(pid) === Number(b.assigned_admin_id)) {
        const chain = custodyChain(b);
        const hops = hopsByBooking[Number(b.id)] || [];
        const at = String(b.reward_paid_at || '');
        let holder = chain[0];
        hops.forEach((h, i) => { if (String(h.created_at || '') <= at) holder = chain[i + 1]; });
        return Number(holder);
      }
      return Number(pid);
    };
    /**
     * 報酬は「その予約の預り金」からではなく、渡す人の手元の現金から出る（店長指定 2026-08-16）。
     * どの予約のぶんかは現金の計算に持ち込まない。払った人の手元からまとめて引く。
     */
    const isPocketReward = (b) => rewardOfPaid(b) > 0;
    // その現金が流れていった順（自分 → 渡した先 → …）。カード予約の報酬を、道すじの全員に反映するため
    const pocketPath = (start) => {
      const path = [Number(start)];
      const seen = new Set(path);
      for (;;) {
        const id = path[path.length - 1];
        if ((byHolderId[id] || []).length) break;       // まだ現金が手元にある＝ここで止まる
        const g = gaveByAdminId[id] || [];
        if (!g.length) break;
        const to = Number(g[g.length - 1].to);
        if (!to || seen.has(to)) break;
        seen.add(to);
        path.push(to);
      }
      return path;
    };
    // 報酬は「現金を持っている人」からだけ引く。立て替えの概念は使わない（店長指定 2026-08-22）。
    // 現金の流れをたどった先が誰も現金を持っていない（カード予約など）ときは、誰の手元からも引かない
    const pocketPaidOf = (uid) => unc.reduce((s, b) => {
      if (!isPocketReward(b)) return s;
      const pid = effPayerOf(b);
      if (!pid) return s;
      const holder = pocketHolderOf(pid);
      if (holder !== Number(uid)) return s;
      if (!(byHolderId[Number(uid)] || []).length) return s;   // 手元に現金が無い人からは引かない
      return s + rewardOfPaid(b);
    }, 0);
    // 金額だけの現金受け渡し（つり銭など）。渡した人は減り、受け取った人は増える（店長要望 2026-08-14）
    const cashTransfers = data.transfers || [];
    const transferNetOf = (uid) => cashTransfers.reduce((s, t) =>
      s + (Number(t.to_admin_id) === Number(uid) ? Number(t.amount) || 0 : 0)
        - (Number(t.from_admin_id) === Number(uid) ? Number(t.amount) || 0 : 0), 0);
    // uid の手元現金＝保有しているお預り金の合計 −（その予約で渡し済みの報酬）−（カード予約ぶんの報酬立て替え）
    // 報酬を渡しているのにお預り金満額が手元にあるのはおかしいため差し引く（店長指摘 2026-08-14）
    const netCashOf = (uid) => (byHolderId[Number(uid)] || [])
      .reduce((s, b) => s + depositOf(b), 0)
      - pocketPaidOf(uid) + transferNetOf(uid);

    // ─ 受け渡しの履歴（店長要望 2026-08-08: 保有額だけでは「◯◯さんに渡した」が確かめられない）─
    const uncById = {};
    unc.forEach(b => { uncById[Number(b.id)] = b; });
    const hopsByBooking = {};
    (data.handoffs || []).forEach(h => {
      const k = Number(h.booking_id);
      if (!hopsByBooking[k]) hopsByBooking[k] = [];
      hopsByBooking[k].push(h);
    });
    const userNameOf = (id) => {
      const u = (adminUsersAll || []).find(x => Number(x.id) === Number(id));
      return u ? (u.display_name || u.username) : ('#' + id);
    };
    // 受け渡し時刻「M/D H:MM」（時は先頭ゼロなし）。同じ人でも別々の時刻ぶんは分けて出すため
    const fmtRecvAt = (at) => {
      const m = String(at || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
      return m ? `${parseInt(m[2], 10)}/${parseInt(m[3], 10)} ${parseInt(m[4], 10)}:${m[5]}` : '';
    };
    /** 現金が渡ってきた順の名前の並び。受け渡しが無ければ今の保有者ひとりだけ */
    const custodyChain = (b) => {
      const hops = hopsByBooking[Number(b.id)] || [];
      const cur = (b.held_by != null && b.held_by !== '') ? Number(b.held_by) : defaultHolderOf(b);
      // 記録どおりの並びだけを出す。記録に無い受け渡しを勝手に足さない（店長指摘 2026-08-16）
      return hops.length
        ? [Number(hops[0].from_admin_id), ...hops.map(h => Number(h.to_admin_id))]
        : [cur];
    };
    // 「この人が誰かに渡して、今は持っていないぶん」を人ごとにまとめる。
    // 渡したあと戻ってきた（今も保有している）ぶんは保有側に出るのでここには入れない
    const gaveByAdminId = {};
    const gaveSeen = {};   // 同じ人が同じ予約を何度も渡した場合は最後の1回だけ残す
    (data.handoffs || []).forEach(h => {
      const b = uncById[Number(h.booking_id)];
      if (!b) return;
      const from = Number(h.from_admin_id);
      const cur = (b.held_by != null && b.held_by !== '') ? Number(b.held_by) : defaultHolderOf(b);
      if (from === cur) return;   // 渡したあと戻ってきた＝今も持っているので保有側に出る
      if (!gaveByAdminId[from]) gaveByAdminId[from] = [];
      const key = from + '|' + b.id;
      const entry = { booking: b, to: Number(h.to_admin_id), at: h.created_at };
      if (gaveSeen[key] !== undefined) gaveByAdminId[from][gaveSeen[key]] = entry;
      else { gaveSeen[key] = gaveByAdminId[from].length; gaveByAdminId[from].push(entry); }
    });
    // 本日出勤の名簿: シフト「出勤」中 or 本日の担当予約ありの キャスト/内勤/ドライバー
    const onDutyIds = new Set();
    tlShifts.forEach(s => {
      // 「終了」にした人も名簿に残す。押し間違いのときに戻せるように（店長要望 2026-08-16）
      if (String(s.shift_date).slice(0, 10) === cashBizDay && (s.status === 'available' || s.status === 'done')) onDutyIds.add(Number(s.admin_user_id));
    });
    tlBookings.forEach(b => {
      if (b.assigned_admin_id && bizDateOf(b.booking_date, b.start_time) === cashBizDay
          && b.status !== 'cancelled' && b.status !== 'no_show') onDutyIds.add(Number(b.assigned_admin_id));
    });
    // 預り金を持っている人は、出勤名簿に載っていなくても必ず出す（ドライバー・内勤が持ったままを見落とさないため）
    Object.keys(byHolderId).forEach(id => onDutyIds.add(Number(id)));
    // 渡し終えて手元が空になった人も出す。「自分は渡した」を後から確かめられるようにするため
    Object.keys(gaveByAdminId).forEach(id => onDutyIds.add(Number(id)));
    // 金額だけの受け渡しに関わった人も名簿に入れる（つり銭だけ受け取った人が消えないように）
    (data.transfers || []).forEach(t => { onDutyIds.add(Number(t.from_admin_id)); onDutyIds.add(Number(t.to_admin_id)); });

    // ─ 報酬を受け取った記録（店長要望 2026-08-08）─
    // 預り金からキャストへ報酬を渡すと、その予約の残額はそのぶん減る。
    // 減った理由が画面から追えないと「¥13,200 のはずが ¥5,600」に見えてしまうため、
    // 受け取った本人の欄に「いつ・いくら・誰から」を残す
    const rewardsByAdminId = {};
    unc.forEach(b => {
      const amt = paidRewardOf(b);
      if (!amt) return;
      const castId = Number(b.assigned_admin_id);
      if (!castId) return;
      if (!rewardsByAdminId[castId]) rewardsByAdminId[castId] = [];
      rewardsByAdminId[castId].push({ booking: b, amount: amt });
    });
    Object.keys(rewardsByAdminId).forEach(id => onDutyIds.add(Number(id)));
    // 報酬を実際に渡した人も必ず出す（現金は他の人へ渡していても「誰に払ったか」はその人の欄に残す）
    unc.forEach(b => { const p = effPayerOf(b); if (p) onDutyIds.add(Number(p)); });
    const roster = adminUsersAll.filter(u => onDutyIds.has(Number(u.id))
      && (isTherapistCapable(u) || isOfficeCapable(u) || isDriverCapable(u)));
    // 誰が持っているのかが一目で分かるよう役割を添える（内勤・ドライバーは特に取り違えやすい）
    const rosterRoleBadge = (u) => {
      const badges = [];
      if (isOfficeCapable(u)) badges.push('<span class="cs-role cs-role-office">🪪 内勤</span>');
      if (isDriverCapable(u)) badges.push('<span class="cs-role cs-role-driver">🚗 ドライバー</span>');
      if (!badges.length && isTherapistCapable(u)) badges.push('<span class="cs-role cs-role-cast">💆 キャスト</span>');
      return badges.length ? ' ' + badges.join('') : '';
    };

    // ★「まとめて渡す」＝手元にある現金を渡す（店長指定 2026-08-25）。
    //   預り金は満額のまま次の人へ動くので、その前に「金額を渡す」で現金を出していると
    //   出したぶんが二重に引かれ、渡した本人がマイナスになる（例: 矢島 −6,900）。
    //   手持ちがマイナスになった人は、その不足分を「最後に渡した相手」への行から差し引き、
    //   受け取った側も同じだけ少なく受け取った扱いにする＝実際に手渡した額に合わせる。
    const csShort = {};      // 渡した人 => { to: 受け取った人, amount: 実際には渡していない額 }
    const csShortIn = {};    // 受け取った人 => 少なく受け取った合計
    // その人が「最後に預り金を渡した相手」
    const csLastTo = {};
    roster.forEach(u => {
      const uid = Number(u.id);
      let last = null;
      (data.handoffs || []).forEach(h => {
        if (Number(h.from_admin_id) !== uid || !uncById[Number(h.booking_id)]) return;
        if (!last || String(h.created_at) > String(last.created_at)) last = h;
      });
      if (last) csLastTo[uid] = Number(last.to_admin_id);
    });
    // 少なく渡したぶんは次の人にも順に効く（矢島→戸塚→宮時 のように連鎖する）ので、
    // 変化が無くなるまで繰り返す
    for (let pass = 0; pass < 12; pass++) {
      let changed = false;
      roster.forEach(u => {
        const uid = Number(u.id);
        const to = csLastTo[uid];
        if (to === undefined) return;         // 預り金を誰にも渡していない＝立て替え等。触らない
        const eff = netCashOf(uid) + ((csShort[uid] || {}).amount || 0) - (csShortIn[uid] || 0);
        if (eff >= 0) return;
        const add = -eff;
        csShort[uid] = { to, amount: ((csShort[uid] || {}).amount || 0) + add };
        csShortIn[to] = (csShortIn[to] || 0) + add;
        changed = true;
      });
      if (!changed) break;
    }
    /** 実際の手持ち（上の調整を反映） */
    const netCashAdj = (uid) => netCashOf(uid)
      + ((csShort[Number(uid)] || {}).amount || 0)
      - (csShortIn[Number(uid)] || 0);

    const grandTotal = unc.reduce((sum, b) => sum + depositOf(b) - rewardOfPaid(b), 0);   // その日の手元現金（お預り金 − 渡した報酬）
    const holderCount = roster.filter(u => netCashAdj(u.id) > 0).length;
    html += `<div style="font-size:.95rem;font-weight:700;margin-bottom:.15rem;">💰 ${escapeHtml(formatDate(cashBizDay))}の現金 ${yenSigned(grandTotal)}（${holderCount}名が保有）</div>
      <div style="font-size:.76rem;color:var(--ink-soft);margin-bottom:.6rem;">この営業日ぶんの、精算が済んでいない現金です。前の日からの繰越はありません。</div>`;
    html += `<div class="cs-actions"><button type="button" id="csCopy" class="cs-act-btn">📋 コピー</button><button type="button" id="csMail" class="cs-act-btn">✉️ メール</button><span id="csCopyMsg" class="cs-act-msg"></span></div>`;
    // 「まだ渡していない報酬」の一覧は出さない（まとめは出納だけ・店長指定 2026-08-22）。
    // キャストごとの当日の報酬対象件数だけ数える（渡した件数と同じなら「1件全て」と出すため）
    const castDayCount = {};
    (tlBookings || []).forEach(b => {
      if (bizDateOf(b.booking_date, b.start_time) !== cashBizDay) return;
      if (b.status !== 'completed') return;
      if (b.course_name === '休憩' || b.customer_name_snapshot === '【休憩】') return;
      if (!rewardOf(b)) return;
      const castId = Number(b.assigned_admin_id);
      castDayCount[castId] = (castDayCount[castId] || 0) + 1;
    });
    let csFinishedHtml = '';   // 終了した人のカード（勤務実績の下に置く）
    if (!roster.length) {
      html += '<p style="color:var(--ink-soft);font-size:.86rem;margin-bottom:1rem;">この日に出勤したスタッフはいません。</p>';
    } else {
      // 内勤・ドライバーを先に、キャストはその下（現金は最後にお店側へ集まるため・店長要望 2026-08-14）。
      // それぞれの中では金額の大きい順（受け渡しの判断がしやすい）
      const isCastRow = (u) => !isOfficeCapable(u) && !isDriverCapable(u) && isTherapistCapable(u);
      // 上がった人（シフト＝終了）は一番下へ。キャストはタイムラインの出勤トグルで「終了」にすると
      // ここでも下がる。内勤・ドライバーはこのカードの「終了」ボタンで下げる（店長要望 2026-08-16）
      const csDoneSet = new Set((tlShifts || [])
        .filter(s => String(s.shift_date).slice(0, 10) === cashBizDay && s.status === 'done')
        .map(s => Number(s.admin_user_id)));
      const csIsDone = (u) => csDoneSet.has(Number(u.id));
      roster.sort((a, b) => (Number(csIsDone(a)) - Number(csIsDone(b)))
        || (Number(isCastRow(a)) - Number(isCastRow(b)))
        || (netCashAdj(b.id) - netCashAdj(a.id)));
      // 1人ぶんのカードを組み立てる（外側の html には足さず、文字列を返す）
      const renderHolderCard = (u) => {
        let html = '';
        const uid = Number(u.id);
        // 明細は上から時系列（古い順）。深夜(0〜9時台)は同じ営業日の続きなので後ろに置く（店長要望 2026-08-15）
        const items = (byHolderId[uid] || []).slice().sort((a, b) => csTimeOrd(a) - csTimeOrd(b));
        const total = netCashAdj(uid);   // いま手元にある現金（渡していない不足分を調整ずみ）
        // ── 現金の出入りを受け渡しの順に組み立てる（手元が0になるまでの履歴・店長要望 2026-08-15）──
        // お客様から直接お預りしたぶん ／ 誰から受け取ったか ／ 誰へ渡したか
        const direct = { sum: 0, count: 0 };
        const directList = [];   // お客様から預かった予約を1件ずつ出すため（店長要望 2026-08-22）
        const recvFrom = {};   // 「誰から・いつ」ごと
        const gaveTo = {};     // 「誰へ・いつ」ごと
        unc.forEach(b => {
          if (cashTakenOf(b) <= 0) return;                 // 現金を預かる予約だけが手渡しの対象
          const chain = custodyChain(b);
          const i = chain.indexOf(uid);
          if (i < 0) return;                               // この予約の現金には触っていない
          const hops = hopsByBooking[Number(b.id)] || [];
          if (i === 0) {
            direct.sum += depositOf(b);                    // 現場でお客様から預かった＝入り口
            direct.count++;
            directList.push(b);
          } else {
            const at = (hops[i - 1] || {}).created_at || '';
            const key = chain[i - 1] + '|' + String(at).slice(0, 16);
            if (!recvFrom[key]) recvFrom[key] = { from: chain[i - 1], at, net: 0, count: 0 };
            recvFrom[key].net += depositOf(b);       // 預り金は満額のまま動く（報酬は別建て）
            recvFrom[key].count++;
          }
          if (i < chain.length - 1) {
            const at = (hops[i] || {}).created_at || '';
            const key = chain[i + 1] + '|' + String(at).slice(0, 16);
            if (!gaveTo[key]) gaveTo[key] = { to: chain[i + 1], at, net: 0, count: 0 };
            gaveTo[key].net += depositOf(b);         // 渡した報酬は下の 💸 行で引く
            gaveTo[key].count++;
          }
        });
        // カード・振込予約の報酬は現金から出るので、その現金が流れた道すじの全員に効かせる。
        // 「誰との受け渡しで減ったのか」まで合わせたいので、相手ごとに持つ
        const pocketIn = {}, pocketOut = {};
        unc.forEach(b => {
          if (!isPocketReward(b)) return;
          const r = rewardOfPaid(b), pid = effPayerOf(b);
          if (!r || !pid) return;
          const path = pocketPath(pid);
          const i = path.indexOf(uid);
          if (i < 0) return;
          if (i > 0) pocketIn[path[i - 1]] = (pocketIn[path[i - 1]] || 0) + r;           // 前の人から、そのぶん少なく受け取っている
          if (i < path.length - 1) pocketOut[path[i + 1]] = (pocketOut[path[i + 1]] || 0) + r;  // 次の人へ、そのぶん少なく渡している
        });
        const byAt = (a, b) => String(a.at).localeCompare(String(b.at));
        const recvList = Object.values(recvFrom).sort(byAt);
        const gaveList = Object.values(gaveTo).sort(byAt);
        // 同じ相手が複数回ある場合は最後の受け渡しから引く
        Object.keys(pocketIn).forEach(fid => {
          const rows = recvList.filter(r => Number(r.from) === Number(fid));
          if (rows.length) { const l = rows[rows.length - 1]; l.net -= pocketIn[fid]; }
        });
        Object.keys(pocketOut).forEach(tid => {
          const rows = gaveList.filter(g => Number(g.to) === Number(tid));
          if (rows.length) { const l = rows[rows.length - 1]; l.net -= pocketOut[tid]; }
        });
        // 「金額を渡す」で先に現金を出していたぶん（csShort）も、渡した額・受け取った額から差し引く
        const myShort = csShort[uid];
        if (myShort) {
          const rows = gaveList.filter(g => Number(g.to) === Number(myShort.to));
          if (rows.length) { const l = rows[rows.length - 1]; l.net -= myShort.amount; }
        }
        Object.keys(csShort).forEach(fid => {
          if (Number(csShort[fid].to) !== uid) return;
          const rows = recvList.filter(r => Number(r.from) === Number(fid));
          if (rows.length) { const l = rows[rows.length - 1]; l.net -= csShort[fid].amount; }
        });
        const has = total !== 0;   // 立て替えでマイナスにもなる
        const minus = total < 0;
        // 内勤・ドライバーは「終了」で下へ下げる（キャストはタイムラインの出勤トグルの終了でこうなる）
        const csDone = csDoneSet.has(uid);
        const finishBtn = isCastRow(u) ? ''
          : `<button type="button" class="cs-finish${csDone ? ' is-done' : ''}" data-finish="${uid}" data-done="${csDone ? 1 : 0}"
               title="${csDone ? 'クリックで出勤中に戻す' : 'この人は上がり。まとめの下へ移します'}">${csDone ? '✓ 終了' : '終了'}</button>`;
        html += `<div class="cs-holder${has ? ' has-cash' : ''}${minus ? ' is-minus' : ''}${csDone ? ' is-finished' : ''}">
          <div style="font-weight:700;margin-bottom:.25rem;display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;">📍 ${escapeHtml(nameOf(u.id, u.display_name, u.username))}${rosterRoleBadge(u)} <span style="font-weight:700;font-size:.92rem;color:${minus ? '#c0392b' : (has ? 'var(--coral-deep,#c2410c)' : 'var(--deep)')};">いま持っている ${yenSigned(total)}（${items.length}件）</span>${finishBtn}</div>`;
        const rewards = rewardsByAdminId[uid] || [];
        // 予約1件ずつの明細は出さない。「誰からいくら受け取り／誰にいくら渡した」だけで足りる（店長要望 2026-08-15）
        // 渡した報酬は「実際に渡した人」の欄に出す（店長指定 2026-08-15）。
        // 現金を他の人へ渡していても、キャストへ手渡ししたのはこの人なのでここに残す
        const paidOut = {};
        unc.forEach(b => {
          const r = rewardOfPaid(b);
          if (!r || effPayerOf(b) !== uid) return;
          const castId = Number(b.assigned_admin_id);
          if (!paidOut[castId]) paidOut[castId] = { id: castId, name: nameOf(b.assigned_admin_id, b.therapist_name, b.therapist_username), sum: 0, count: 0, at: '' };
          paidOut[castId].sum += r;
          paidOut[castId].count++;
          const rat = String(b.reward_paid_at || '');
          if (rat > paidOut[castId].at) paidOut[castId].at = rat;
        });
        // 基本はその日のぶんをまとめて渡すので「◯件全て」。一部だけ渡したときだけ「◯件分」（店長要望 2026-08-14）
        const paidCountNote = (p) => (castDayCount[p.id] && p.count >= castDayCount[p.id]) ? `${p.count}件全て` : `${p.count}件分`;
        // ── やり取りを時刻順に並べ、行の右にその時点の手持ち額を出す（店長要望 2026-08-15）──
        const ev = [];
        // 現場でお客様から預かったぶんは1件ずつ出す（どの予約のお金かが分かるように・店長要望 2026-08-22）。
        // 手元の現金の入り口なので、受け渡しより前（時刻順の先頭）に並べる
        directList.slice().sort((a, b) => csTimeOrd(a) - csTimeOrd(b)).forEach(b => {
          const t = String(b.start_time || '').slice(0, 5).replace(/^0/, '');
          const who = b.assigned_admin_id ? userNameOf(Number(b.assigned_admin_id)) : '';
          const note = [t, who].filter(Boolean).join(' ');
          ev.push({ at: '', d: depositOf(b), cls: 'cs-recv-head',
            txt: `📥 お客様から ${yen(depositOf(b))} お預り${note ? '（' + note + '）' : ''}`,
            html: `📥 お客様から ${yen(depositOf(b))} お預り${note ? `<span class="cs-gave-note">${escapeHtml(note)}</span>` : ''}` });
        });
        // 誰から・いつ受け取ったか。同じ人でも受け渡しが分かれていれば、その都度ぶんを分けて出す（店長要望 2026-08-14）
        recvList.forEach(r => {
          const t = fmtRecvAt(r.at);
          ev.push({ at: r.at, d: r.net, cls: 'cs-recv-head',
            txt: `📥 ${userNameOf(r.from)} から ${yen(r.net)} 受け取り${t ? ' ' + t : ''}（${r.count}件）`,
            html: `📥 ${escapeHtml(userNameOf(r.from))} から ${yen(r.net)} 受け取り${t ? `<span class="cs-recv-at">${t}</span>` : ''}<span class="cs-gave-note">（${r.count}件）</span>` });
        });
        Object.values(paidOut).forEach(p => {
          ev.push({ at: p.at, d: -p.sum, cls: 'cs-reward-head',
            txt: `💸 ${p.name} に報酬 ${yen(p.sum)} を渡した（${paidCountNote(p)}）`,
            html: `💸 ${escapeHtml(p.name)} に報酬 ${yen(p.sum)} を渡した<span class="cs-gave-note">（${paidCountNote(p)}）</span>` });
        });
        // 渡したぶん: 予約ごとではなく「誰へいくら」だけ（店長要望 2026-08-15）
        gaveList.forEach(g => {
          const t = fmtRecvAt(g.at);
          ev.push({ at: g.at, d: -g.net, cls: 'cs-gave-head',
            txt: `📤 ${userNameOf(g.to)} へ ${yen(g.net)} 渡した${t ? ' ' + t : ''}（${g.count}件）`,
            html: `📤 ${escapeHtml(userNameOf(g.to))} へ ${yen(g.net)} 渡した${t ? `<span class="cs-recv-at">${t}</span>` : ''}<span class="cs-gave-note">（${g.count}件）</span>` });
        });
        // 金額だけの受け渡し（つり銭など）も同じ流れに混ぜる（店長要望 2026-08-14）
        cashTransfers.forEach(t => {
          const amt = Number(t.amount) || 0;
          const at = fmtRecvAt(t.created_at);
          const memo = String(t.note || '').trim();
          const memoHtml = memo ? `<span class="cs-gave-note">${escapeHtml(memo)}</span>` : '';
          const delBtn = csCanHandoff ? `<button type="button" class="cs-tr-del" data-tr="${t.id}" title="取り消す">×</button>` : '';
          if (Number(t.to_admin_id) === uid) {
            ev.push({ at: t.created_at || '', d: amt, cls: 'cs-recv-head',
              txt: `📥 ${userNameOf(Number(t.from_admin_id))} から ${yen(amt)} 受け取り${at ? ' ' + at : ''}${memo ? '（' + memo + '）' : ''}`,
              html: `📥 ${escapeHtml(userNameOf(Number(t.from_admin_id)))} から ${yen(amt)} 受け取り${at ? `<span class="cs-recv-at">${at}</span>` : ''}${memoHtml}${delBtn}` });
          } else if (Number(t.from_admin_id) === uid) {
            ev.push({ at: t.created_at || '', d: -amt, cls: 'cs-gave-head',
              txt: `📤 ${userNameOf(Number(t.to_admin_id))} へ ${yen(amt)} 渡した${at ? ' ' + at : ''}${memo ? '（' + memo + '）' : ''}`,
              html: `📤 ${escapeHtml(userNameOf(Number(t.to_admin_id)))} へ ${yen(amt)} 渡した${at ? `<span class="cs-recv-at">${at}</span>` : ''}${memoHtml}${delBtn}` });
          }
        });
        ev.sort((a, b) => String(a.at).localeCompare(String(b.at)));
        // 右の額は「その時点で手元にいくらあるか」。最後の行が「いま持っている」と一致する
        const balTxt = (n) => n > 0 ? '＋' + yen(n) : (n < 0 ? '−' + yen(-n) : '¥0');
        let bal = 0;
        ev.forEach(e => {
          bal += e.d;
          const cls = bal > 0 ? 'is-plus' : (bal < 0 ? 'is-minus' : 'is-zero');
          html += `<div class="${e.cls}">${e.html}<span class="cs-bal ${cls}">${balTxt(bal)}</span></div>`;
        });
        // まとめの中から直接、次の人へ渡せるようにする（店長要望 2026-08-11）。
        // タイムラインの「預り金 受け渡し」を開かなくても、この画面で締められる。
        // カード・振込は現金を預かっていないので対象外（受け渡しモーダルと同じ扱い）
        const handable = items.filter(b => !isNonCash(b));
        if (csCanHandoff && handable.length) {
          const to = csHandoffPeople.filter(p => Number(p.id) !== Number(u.id));
          html += `<div class="cs-handoff">
            <select class="cs-handoff-to" data-holder="${u.id}"><option value="">渡す先…</option>${to.map(p => `<option value="${p.id}">${escapeHtml(p.display_name || p.username)}${p.role === 'driver' ? '（ドライバー）' : ''}</option>`).join('')}</select>
            <button type="button" class="sbtn cs-handoff-go" data-holder="${u.id}" data-ids="${handable.map(b => b.id).join(',')}">まとめて渡す（${handable.length}件）</button>
          </div>`;
        }
        // 誰かから受け取る（間に人が入るときに「誰から」を選べるように・店長要望 2026-08-22）。
        // 渡す側の画面を開かなくても、受け取った本人が記録できる
        if (csCanHandoff) {
          const froms = roster
            .filter(p => Number(p.id) !== Number(u.id))
            .map(p => ({ id: Number(p.id), name: nameOf(p.id, p.display_name, p.username),
                         ids: (byHolderId[Number(p.id)] || []).filter(b => !isNonCash(b)).map(b => b.id) }))
            .filter(p => p.ids.length);
          if (froms.length) {
            html += `<div class="cs-handoff cs-recv">
              <select class="cs-recv-from" data-holder="${u.id}"><option value="">受け取り元…</option>`
              + froms.map(p => `<option value="${p.id}" data-ids="${p.ids.join(',')}">${escapeHtml(p.name)}（${p.ids.length}件）</option>`).join('')
              + `</select>
              <button type="button" class="sbtn cs-recv-go" data-holder="${u.id}">受け取る</button>
            </div>`;
          }
        }
        // 予約とは関係なく、現金を金額だけ渡すとき（つり銭・両替など）
        if (csCanHandoff) {
          const to2 = csHandoffPeople.filter(p => Number(p.id) !== Number(u.id));
          html += `<div class="cs-handoff cs-amt">
            <select class="cs-amt-to" data-holder="${u.id}"><option value="">渡す先…</option>${to2.map(p => `<option value="${p.id}">${escapeHtml(p.display_name || p.username)}${p.role === 'driver' ? '（ドライバー）' : ''}</option>`).join('')}</select>
            <input type="text" class="cs-amt-yen" data-holder="${u.id}" inputmode="numeric" placeholder="金額">
            <input type="text" class="cs-amt-note" data-holder="${u.id}" placeholder="メモ（つり銭など）">
            <button type="button" class="sbtn cs-amt-go" data-holder="${u.id}">金額を渡す</button>
          </div>`;
        }
        // 受け取った報酬も、予約ごとではなく合計1行で（店長要望 2026-08-08）
        if (rewards.length) {
          const rewardTotal = rewards.reduce((s, r) => s + r.amount, 0);
          const payers = [...new Set(rewards.map(r => r.booking.reward_paid_by_name).filter(Boolean))];
          const from = payers.length ? `<span class="cs-reward-from">${escapeHtml(payers.join('・'))} から</span>` : '';
          const recvNote = (castDayCount[uid] && rewards.length >= castDayCount[uid]) ? `${rewards.length}件全て` : `${rewards.length}件分`;
          html += `<div class="cs-reward-head">💸 受け取った報酬 ${yen(rewardTotal)} ${from}<span class="cs-gave-note">（${recvNote}）</span></div>`;
        }
        // 担当者ごとのコピー / メール（この状況を本人へ送れるように・店長要望 2026-08-14）
        const roleTxt = isOfficeCapable(u) ? '（内勤）' : (isDriverCapable(u) ? '（ドライバー）' : (isTherapistCapable(u) ? '（キャスト）' : ''));
        const nmT = nameOf(u.id, u.display_name, u.username);
        const tLines = [`【現金まとめ ${formatDate(cashBizDay)}】`, `${nmT}${roleTxt} いま持っている ${yenSigned(total)}（${items.length}件）`, ''];
        // 画面と同じ並び。右にその時点の手持ち額（店長要望 2026-08-15）
        let balT = 0;
        ev.forEach(e => { balT += e.d; tLines.push(`${e.txt}  ${balTxt(balT)}`); });
        holderCardText[uid] = tLines.join('\n');
        html += `<div class="cs-hcard-actions">
          <button type="button" class="cs-hcopy cs-act-btn" data-uid="${uid}">📋 コピー</button>
          <button type="button" class="cs-hmail cs-act-btn" data-uid="${uid}">✉️ ${escapeHtml(nmT)}にメール</button>
          <span class="cs-hmsg cs-act-msg" data-uid="${uid}"></span></div>`;
        html += '</div>';
        return html;
      };

      // その日のスタッフは全員そのまま出す（店長指定 2026-08-15）。
      // ほとんどは渡し終えて ±0 になるので、0 の人も並べて「確かに締まっている」を見えるようにする
      const holders = roster;
      // コピー / メール用のプレーンテキスト（お客様・担当キャスト・金額）
      const roleTextOf = (u) => isOfficeCapable(u) ? '（内勤）' : (isDriverCapable(u) ? '（ドライバー）' : (isTherapistCapable(u) ? '（キャスト）' : ''));
      const custRaw = (b) => { const n = String(b.customer_name_snapshot || '').trim(); return n ? n + ' 様' : '—'; };
      const stLines = [`【まとめ】${formatDate(cashBizDay)}の現金 ${yenSigned(grandTotal)}（${holderCount}名が保有）`];
      holders.forEach(u => {
        const uid = Number(u.id);
        const items = byHolderId[uid] || [];
        stLines.push('');
        stLines.push(`■ ${nameOf(u.id, u.display_name, u.username)}${roleTextOf(u)} いま持っている ${yenSigned(netCashAdj(uid))}（${items.length}件）`);
        // 予約1件ずつは載せない（店長要望 2026-08-15）
        // 渡した報酬（いま持っている予約ぶん＋カード予約の立て替えぶん・キャスト別）
        const pd = {};
        unc.forEach(b => { if (effPayerOf(b) === uid && rewardOfPaid(b) > 0) { const c = Number(b.assigned_admin_id); (pd[c] = pd[c] || { n: nameOf(b.assigned_admin_id, b.therapist_name, b.therapist_username), s: 0 }).s += rewardOfPaid(b); } });
        Object.values(pd).forEach(p => stLines.push(`  💸 ${p.n} に報酬 −${yen(p.s)}`));
      });
      summaryText = stLines.join('\n');
      // 終了した人は消さずに、勤務実績（シフト）の下へまとめて置く（押し間違いを戻せるように・店長要望 2026-08-16）
      holders.filter(u => !csIsDone(u)).forEach(u => { html += renderHolderCard(u); });
      csFinishedHtml = holders.filter(u => csIsDone(u)).map(u => renderHolderCard(u)).join('');
      if (!holders.length) {
        html += '<p style="color:var(--ink-soft);font-size:.86rem;margin-bottom:1rem;">この日の出勤スタッフがいません。</p>';
      }
      // 名簿に載っていない保有者も上の roster に含めているので、ここでの繰越表示は不要
      // （預り金はその営業日ぶんのみ・繰越は扱わない / 店長指定 2026-08-07）
    }

    // 勤務実績は「🚗 勤務実績」ボタンの別画面へ移した（まとめから独立・店長要望 2026-08-29）

    // 上がった人はここ（勤務実績の下）。消さずに残すので、間違えて押しても「終了」をもう一度で戻せる
    if (csFinishedHtml) {
      html += `<div class="cs-finished-sec"><div class="cs-finished-title">🏁 終了したスタッフ</div>${csFinishedHtml}</div>`;
    }

    el.innerHTML = html;

    // まとめのコピー / メール（お預かり情報を日報や引き継ぎに使えるように・店長要望 2026-08-13）
    const csCopyMsg = () => document.getElementById('csCopyMsg');
    const flashMsg = (t) => { const m = csCopyMsg(); if (!m) return; m.textContent = t; setTimeout(() => { if (csCopyMsg() === m) m.textContent = ''; }, 2000); };
    document.getElementById('csCopy')?.addEventListener('click', async () => {
      if (!summaryText) { flashMsg('コピーする内容がありません'); return; }
      try { await navigator.clipboard.writeText(summaryText); }
      catch (e) {
        const ta = document.createElement('textarea');
        ta.value = summaryText; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e2) {}
        ta.remove();
      }
      flashMsg('✓ コピーしました');
    });
    document.getElementById('csMail')?.addEventListener('click', () => {
      const subj = encodeURIComponent(`まとめ ${formatDate(cashBizDay)}`);
      const body = encodeURIComponent(summaryText || '');
      window.location.href = `mailto:?subject=${subj}&body=${body}`;
    });

    // 「終了」= その日のシフトを終了にする（タイムラインの出勤トグルと同じ状態）。
    // まとめの中で今いる人／上がった人がひと目で分かるように（店長要望 2026-08-16）
    el.querySelectorAll('[data-finish]').forEach(btn => btn.addEventListener('click', async () => {
      const uid = Number(btn.dataset.finish);
      const done = btn.dataset.done === '1';
      const nm = (adminUsersAll || []).find(x => Number(x.id) === uid);
      const label = nm ? (nm.display_name || nm.username) : '';
      if (!await opsConfirm(done ? `${label} を出勤中に戻しますか？` : `${label} は終了（上がり）でよろしいですか？`)) return;
      btn.disabled = true;
      try {
        await apiPost('/shifts.php?action=set-attendance', {
          admin_user_id: uid, shift_date: cashBizDay, status: done ? 'available' : 'done',
        });
        await loadTimeline(true);      // タイムラインの並び・出勤トグルも合わせる
        await openCashSummaryModal();  // まとめを組み直して並べ替える
      } catch (e) { btn.disabled = false; toast('更新失敗: ' + e.message, 'err'); }
    }));

    // 担当者ごとのコピー / メール（本人の状況をその人へ送る）
    const flashHMsg = (uid, t) => { const m = el.querySelector(`.cs-hmsg[data-uid="${uid}"]`); if (!m) return; m.textContent = t; setTimeout(() => { if (m.textContent === t) m.textContent = ''; }, 2000); };
    el.querySelectorAll('.cs-hcopy').forEach(btn => btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid;
      const txt = holderCardText[uid] || '';
      if (!txt) { flashHMsg(uid, 'コピーする内容がありません'); return; }
      try { await navigator.clipboard.writeText(txt); }
      catch (e) {
        const ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e2) {}
        ta.remove();
      }
      flashHMsg(uid, '✓ コピーしました');
    }));
    el.querySelectorAll('.cs-hmail').forEach(btn => btn.addEventListener('click', async () => {
      const uid = Number(btn.dataset.uid);
      const txt = holderCardText[uid] || '';
      if (!txt) { flashHMsg(uid, '送る内容がありません'); return; }
      const person = (adminUsersAll || []).find(x => Number(x.id) === uid) || {};
      const pName = person.display_name || person.username || '';
      if (!await opsConfirm(`${pName} 宛に、この現金まとめの状況をメール送信しますか？`)) return;
      try {
        await apiPost('/admin-api.php?action=send-reward-mail', { to_admin_id: uid, subject: `現金まとめ ${formatDate(cashBizDay)}`, body: txt });
        flashHMsg(uid, '✓ メールしました');
      } catch (e) { flashHMsg(uid, 'メール失敗: ' + e.message); }
    }));

    // まとめて渡す
    el.querySelectorAll('.cs-handoff-go').forEach(btn => btn.addEventListener('click', async () => {
      const sel = el.querySelector(`.cs-handoff-to[data-holder="${btn.dataset.holder}"]`);
      const to = sel && sel.value;
      if (!to) { toast('渡す先を選んでください', 'err'); return; }
      const ids = String(btn.dataset.ids || '').split(',').map(Number).filter(Boolean);
      if (!ids.length) return;
      const toName = nameOf(to, ...(() => { const d = (adminUsersAll || []).find(x => Number(x.id) === Number(to)); return [d?.display_name, d?.username]; })());
      if (!await opsConfirm(`${ids.length}件を ${toName} にまとめて渡します。よろしいですか？`)) return;
      btn.disabled = true;
      try {
        await apiPost('/admin-api.php?action=booking-handoff-batch', { ids, to_admin_id: Number(to) });
        toast(`${ids.length}件を ${toName} に渡しました`, 'ok');
        await loadTimeline(true);
        openCashSummaryModal();
      } catch (e) { toast('記録失敗: ' + e.message, 'err'); btn.disabled = false; }
    }));

    // 「◯◯ から受け取る」（店長要望 2026-08-22）。渡す側と同じ記録を、受け取った人の側から作る
    el.querySelectorAll('.cs-recv-go').forEach(btn => btn.addEventListener('click', async () => {
      const sel = el.querySelector(`.cs-recv-from[data-holder="${btn.dataset.holder}"]`);
      const opt = sel && sel.selectedOptions[0];
      const ids = String((opt && opt.dataset.ids) || '').split(',').map(Number).filter(Boolean);
      if (!ids.length) { toast('受け取り元を選んでください', 'err'); return; }
      const meId = Number(btn.dataset.holder);
      const meName = nameOf(meId, ...(() => { const d = (adminUsersAll || []).find(x => Number(x.id) === meId); return [d?.display_name, d?.username]; })());
      if (!await opsConfirm(`${opt.textContent.replace(/（.*）$/, '')} から ${ids.length}件ぶんの現金を ${meName} が受け取ります。よろしいですか？`)) return;
      btn.disabled = true;
      try {
        await apiPost('/admin-api.php?action=booking-handoff-batch', { ids, to_admin_id: meId });
        toast(`${ids.length}件を受け取りました`, 'ok');
        await loadTimeline(true);
        openCashSummaryModal();
      } catch (e) { toast('記録失敗: ' + e.message, 'err'); btn.disabled = false; }
    }));

    // 金額だけの受け渡し（つり銭など）を記録（店長要望 2026-08-14）
    el.querySelectorAll('.cs-amt-go').forEach(btn => btn.addEventListener('click', async () => {
      const holder = btn.dataset.holder;
      const sel = el.querySelector(`.cs-amt-to[data-holder="${holder}"]`);
      const yenEl = el.querySelector(`.cs-amt-yen[data-holder="${holder}"]`);
      const noteEl = el.querySelector(`.cs-amt-note[data-holder="${holder}"]`);
      const to = sel && sel.value;
      const amt = parseInt(String(yenEl?.value || '').replace(/[^\d]/g, ''), 10) || 0;
      if (!to) { toast('渡す先を選んでください', 'err'); return; }
      if (amt <= 0) { toast('金額を入れてください', 'err'); return; }
      const toName = nameOf(to, ...(() => { const d = (adminUsersAll || []).find(x => Number(x.id) === Number(to)); return [d?.display_name, d?.username]; })());
      if (!await opsConfirm(`${toName} に ${yen(amt)} を渡します。よろしいですか？`)) return;
      btn.disabled = true;
      try {
        await apiPost('/admin-api.php?action=cash-transfer-add', {
          date: cashBizDay, from_admin_id: Number(holder), to_admin_id: Number(to), amount: amt, note: (noteEl?.value || '').trim(),
        });
        toast(`${toName} に ${yen(amt)} を渡しました`, 'ok');
        openCashSummaryModal();
      } catch (e) { toast('記録失敗: ' + e.message, 'err'); btn.disabled = false; }
    }));
    // 記録の取り消し
    el.querySelectorAll('.cs-tr-del').forEach(btn => btn.addEventListener('click', async () => {
      if (!await opsConfirm('この受け渡しの記録を取り消しますか？')) return;
      btn.disabled = true;
      try {
        await apiPost('/admin-api.php?action=cash-transfer-delete', { id: Number(btn.dataset.tr) });
        toast('✓ 取り消しました', 'ok');
        openCashSummaryModal();
      } catch (e) { toast('取り消し失敗: ' + e.message, 'err'); btn.disabled = false; }
    }));

  }

  /**
   * 🚗 勤務実績（日報の「増田22:00〜1:00(3H30km)」用）。
   * もとは現金まとめの中にあったが、締め作業と入力作業を分けたいので独立させた（店長要望 2026-08-29）。
   */
  async function openWorkLogModal() {
    const el = document.getElementById('workLogBody');
    if (!el) { toast('画面を再読み込みしてください', 'err'); return; }
    el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    openModal('workLogModal');
    const bizDay = fmtDate(tlCurrentDate);
    let data;
    try { data = await api('/admin-api.php?action=cash-summary&date=' + encodeURIComponent(bizDay)); }
    catch (e) { el.innerHTML = '<p style="color:var(--coral);">読み込み失敗: ' + escapeHtml(e.message) + '</p>'; return; }

    const logs = data.driver_logs || {};
    // その日にシフトが入っている内勤・ドライバー（キャストは対象外）。
    // 実績だけ入っていてシフトが無い人も落とさない
    const ids = new Set();
    (tlShifts || []).forEach(sh => {
      if (String(sh.shift_date).slice(0, 10) === bizDay && sh.status !== 'off') ids.add(Number(sh.admin_user_id));
    });
    Object.keys(logs).forEach(id => ids.add(Number(id)));
    const workStaff = (adminUsersAll || []).filter(u => ids.has(Number(u.id))
      && !(u.role === 'staff' || Number(u.is_therapist) === 1))
      .sort(opsStaffOrder(bizDay));   // 並びは「まとめ」と同じ（終了した人は下）
    // 予定は「休み以外」なら出す。終わった人(done)や仮(tentative)でも予定は見たい
    const schedByAdmin = {};
    (tlShifts || []).forEach(sh => {
      if (String(sh.shift_date).slice(0, 10) === bizDay && sh.status !== 'off') schedByAdmin[Number(sh.admin_user_id)] = sh;
    });
    // 24H・早番・遅番はその名前で出す（時刻より区分のほうが早く読める・店長要望 2026-08-29）
    const schedText = (sh) => ({ '24h': '24H', early: '早番', late: '遅番' })[sh.shift_preset || '']
      || `${hhmm(sh.start_time)}〜${sh.end_time ? hhmm(sh.end_time) : (sh.end_open === 'last' ? 'ラスト' : '未定')}`;

    if (!workStaff.length) {
      el.innerHTML = '<p style="color:var(--ink-soft);font-size:.86rem;">この営業日に出勤している内勤・ドライバーがいません。</p>';
      return;
    }
    let html = `<div class="cs-work" style="margin-top:0;">
      <div class="cs-work-head">🚗 勤務実績<span class="cs-gave-note">日報に「22:00〜1:00(3H30km)」の形で入ります</span></div>`;
    workStaff.forEach(u => {
      const lg = logs[Number(u.id)] || {};
      const sc = schedByAdmin[Number(u.id)];
      const schedNote = sc ? `<span class="cs-work-sched">予定 ${escapeHtml(schedText(sc))}</span>` : '';
      // シフトに入っていたのに結局出ていない人は「休」で記録する（空欄だと未入力と区別が付かない）
      const isOff = Number(lg.off) === 1;
      html += `<div class="cs-work-row${isOff ? ' is-off' : ''}" data-work-id="${u.id}" data-off="${isOff ? 1 : 0}" data-off0="${isOff ? 1 : 0}">
        <span class="cs-work-name">${escapeHtml(u.display_name || u.username || ('#' + u.id))}${schedNote}</span>
        <button type="button" class="cs-work-off${isOff ? ' is-on' : ''}" title="この日は出ていない（お休み）ときに押す">休</button>
        ${workTimeSelects('cs-work-in', lg.clock_in)}
        <span class="cs-work-sep">〜</span>
        ${workTimeSelects('cs-work-out', lg.clock_out)}
        <input type="number" class="cs-work-km" min="0" step="1" placeholder="km" value="${escapeAttr(lg.distance_km || '')}">
        <span class="cs-work-unit">km</span>
        <span class="cs-work-hours"></span>
      </div>`;
    });
    html += `<div class="cs-work-foot">
      <button class="btn-primary" type="button" id="csWorkSave" style="padding:.4rem 1rem;font-size:.82rem;">保存</button>
      <span id="csWorkMsg" style="font-size:.8rem;color:var(--ink-soft);"></span>
    </div></div>`;
    el.innerHTML = html;

    /**
     * 開始と終了がそろったら勤務時間を出す（店長要望 2026-08-29）。
     * 日報と同じ数え方: 15分＝0.25H、ちょうどなら「3H」。日をまたぐ場合は+24時間
     */
    const showHours = (row) => {
      const out = row.querySelector('.cs-work-hours');
      if (!out) return;
      const ci = readWorkTime(row, 'cs-work-in');
      const co = readWorkTime(row, 'cs-work-out');
      if (row.dataset.off === '1' || !ci || !co) { out.textContent = ''; return; }
      const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      let mins = toMin(co) - toMin(ci);
      if (mins <= 0) mins += 24 * 60;
      const h = Math.round(mins / 15) / 4;
      out.textContent = (Number.isInteger(h) ? h : h.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + 'H';
    };
    // 時を選んだら分は自動で 00（CTRL の出勤編集と同じ操作感）
    el.querySelectorAll('.cs-work-in-h,.cs-work-out-h').forEach(sel => sel.addEventListener('change', () => {
      const m = sel.parentElement?.querySelector(sel.classList.contains('cs-work-in-h') ? '.cs-work-in-m' : '.cs-work-out-m');
      if (m && sel.value && !m.value) m.value = '00';
      if (m && !sel.value) m.value = '';
    }));
    el.querySelectorAll('.cs-work-in-h,.cs-work-in-m,.cs-work-out-h,.cs-work-out-m').forEach(sel => {
      sel.addEventListener('change', () => showHours(sel.closest('.cs-work-row')));
    });
    // 「休」を押したら時刻・kmは入れられなくする（もう一度押すと戻る）
    const applyOffRow = (row) => {
      const off = row.dataset.off === '1';
      row.classList.toggle('is-off', off);
      row.querySelector('.cs-work-off')?.classList.toggle('is-on', off);
      row.querySelectorAll('.cs-work-in-h,.cs-work-in-m,.cs-work-out-h,.cs-work-out-m,.cs-work-km').forEach(f => {
        f.disabled = off;
        if (off) f.value = '';
      });
      showHours(row);
    };
    el.querySelectorAll('.cs-work-off').forEach(btn => btn.addEventListener('click', () => {
      const row = btn.closest('.cs-work-row');
      if (!row) return;
      row.dataset.off = row.dataset.off === '1' ? '0' : '1';
      applyOffRow(row);
    }));
    el.querySelectorAll('.cs-work-row').forEach(applyOffRow);

    const saveBtn = document.getElementById('csWorkSave');
    saveBtn?.addEventListener('click', async () => {
      const msg = document.getElementById('csWorkMsg');
      saveBtn.disabled = true;
      try {
        // 空欄のままの人は送らない（毎回全員ぶん書き込まないように）。お休みは空でも送る
        const rows = [...el.querySelectorAll('.cs-work-row')].map(r => ({
          driver_id: Number(r.dataset.workId),
          work_date: bizDay,
          off: r.dataset.off === '1' ? 1 : 0,
          _changed: r.dataset.off !== r.dataset.off0,   // 休みを解除しただけ（他は空）でも保存する
          clock_in: readWorkTime(r, 'cs-work-in'),
          clock_out: readWorkTime(r, 'cs-work-out'),
          distance_km: r.querySelector('.cs-work-km').value,
        })).filter(r => r.off || r._changed || r.clock_in || r.clock_out || r.distance_km !== '');
        for (const r of rows) await apiPost('/admin-api.php?action=driver-log-upsert', r);
        delete _driverOffCache[bizDay];   // 休みの更新を送迎ドライバー選択にすぐ反映させる
        if (msg) { msg.textContent = `✓ ${rows.length}名ぶん保存しました`; setTimeout(() => { msg.textContent = ''; }, 2500); }
        toast('✓ 勤務実績を保存しました', 'ok');
      } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
      saveBtn.disabled = false;
    });
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
    // 受け渡し候補: 内勤スタッフとドライバーのみ（キャストへの受け渡しは無い・店長指定 2026-08-07）。
    // 本人(内勤/ドライバー)も候補に含まれるのは「一旦渡した預り金を本人に戻す」ケースがあるため。現在の保有者は opts 側で除外する。
    const chainDuty = opsOnDutySet(bizDay, earned.flatMap(b => [b.held_by, b.reward_paid_by, b.shop_settled_by]));
    const people = (adminUsersAll || []).filter(u => u.id && chainDuty.has(Number(u.id)) && (isOfficeCapable(u) || isDriverCapable(u))).sort(opsStaffOrder(bizDay));
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
      const price = Number(b.price) || 0, late = Number(b.late_fee) || 0, trans = Number(b.transport_fee) || 0, cardFee = Number(b.card_fee) || 0;
      const amt = cashTakenOf(b);   // 現金として預かっている額（併用は現金ぶんだけ）
      const reward = meHasRate ? rewardOf(b) : 0;
      // 報酬は手元の現金から渡すので、予約の預り金からは引かない（店長指定 2026-08-16）
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
      return nameOf((b.held_by != null && b.held_by !== '') ? b.held_by : defaultHolderOf(b));
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
      const h = (b.held_by != null && b.held_by !== '') ? Number(b.held_by) : defaultHolderOf(b);
      return h === Number(adminId);
    });
    const batchPeople = people.filter(p => Number(p.id) !== Number(adminId));
    const batchBtn = holdableList.length
      ? `<div style="display:flex;gap:.4rem;align-items:center;margin-bottom:.7rem;">
          <select id="chainBatchTo" style="flex:1;min-width:0;padding:.45rem .5rem;border:1.5px solid var(--gray);border-radius:8px;"><option value="">まとめて渡す先…</option>${batchPeople.map(p => `<option value="${p.id}">${escapeHtml(p.display_name || p.username)}${p.role === 'driver' ? '（ドライバー）' : ''}</option>`).join('')}</select>
          <button class="sbtn chain-handoff-all" type="button" style="padding:.45rem .8rem;font-weight:700;background:var(--sea);color:#fff;border:none;white-space:nowrap;">まとめて渡す（${holdableList.length}件）</button>
        </div>`
      : '';
    // 見出しは「この人がいま持っている額」。他の人へ渡したぶんまで足すと持ち金を取り違える（店長指摘 2026-08-15）
    const mineTotal = holdableList.reduce((s, b) => s + heldAmountOf(b), 0);
    let html = `<div style="font-weight:700;">${escapeHtml(me.display_name || me.username || '')} がいま持っている ${yen(mineTotal)}（${holdableList.length}件）</div>
      <div style="font-size:.78rem;color:var(--ink-soft);margin:.1rem 0 .1rem;">この日の預り金 ${yen(total)}（${cashCount}件${nonCashCount ? `・ほか💳${nonCashCount}件` : ''}）— 内訳は下のとおり</div>
      ${holderSummary}
      <div style="font-size:.78rem;color:var(--ink-soft);margin-bottom:.7rem;">いま誰がいくら持っているかは上のバッジで確認できます。「渡した先」を選ぶと受け渡しの流れが残ります。カード・振込は現金を預からないため対象外です。</div>${batchBtn}`;
    if (!earned.length) html += '<p style="color:var(--ink-soft);">この日の預り金はありません。</p>';

    earned.forEach(b => {
      const price = Number(b.price) || 0, late = Number(b.late_fee) || 0, trans = Number(b.transport_fee) || 0, cardFee = Number(b.card_fee) || 0;
      const amt = customerTotalOf(b), cashAmt = cashTakenOf(b);   // 総額と、そのうち現金で預かっている額
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
      const reward = meHasRate ? rewardOf(b) : 0;
      const net = amt - reward;
      const hops = byBooking[b.id] || [];
      const legacyHolder = (b.held_by != null && b.held_by !== '') ? Number(b.held_by)
                          : (b.shop_settled && b.shop_settled_by ? Number(b.shop_settled_by) : defaultHolderOf(b));
      const curHolder = hops.length ? Number(hops[hops.length - 1].to_admin_id) : legacyHolder;
      // チェーン（担当→…→現在の保有者）。保有者は下のバッジで明示。
      // 記録に残っていない受け渡し（担当キャスト→お迎え担当）も間に補って、
      // 「誰から誰へ渡ったか」が飛ばずに追えるようにする（店長指摘 2026-08-07）
      const chainIds = [Number(b.assigned_admin_id)];
      hops.forEach(h => {
        const from = Number(h.from_admin_id);
        // 直前のノードと繋がらない場合はその人を補完（例: かれん→[徳安]→三宅）
        if (from && from !== chainIds[chainIds.length - 1]) chainIds.push(from);
        chainIds.push(Number(h.to_admin_id));
      });
      if (!hops.length && curHolder !== Number(b.assigned_admin_id)) chainIds.push(curHolder);
      let chain = chainIds.map((id, i) => {
        // 名前チップの色は、スタッフ管理で本人ごとに決めた色を使う（店長指定 2026-08-16）。
        // 色を決めていない人（キャスト・ドライバーなど）は役割の色で出す
        const cu = (adminUsersAll || []).find(x => Number(x.id) === Number(id));
        const sc = /^#[0-9a-fA-F]{6}$/.test(String(cu?.staff_color || '')) ? String(cu.staff_color) : '';
        const officeSide = cu && (isOfficeCapable(cu) || cu.role === 'owner' || cu.role === 'manager');
        const roleCls = (sc || !cu) ? '' : (officeSide ? ' r-office' : (isDriverCapable(cu) ? ' r-driver' : (isTherapistCapable(cu) ? ' r-cast' : '')));
        const scStyle = sc ? ` style="background:${sc}1a;border-color:${sc};color:${sc};"` : '';
        const node = `<span class="chain-node${i === 0 ? ' start' : ''}${roleCls}"${scStyle}>${escapeHtml(nameOf(id))}${i === 0 ? '<small>担当</small>' : ''}</span>`;
        return i === 0 ? node : `<span class="chain-arrow">→</span>${node}`;
      }).join('');
      const held = heldAmountOf(b);
      const headAmt = held !== amt
        ? `<span style="white-space:nowrap;"><b>${yen(held)}</b><small style="color:var(--ink-soft);font-weight:500;"> ／全額 ${yen(amt)}</small></span>`
        : `<b style="white-space:nowrap;">${yen(amt)}</b>`;
      // 併用は「預かったのは現金ぶんだけ」が伝わるように内訳を添える
      const splitNote = isSplitPay(b)
        ? `<div style="margin-top:.3rem;"><span class="chain-now-badge">🧾 併用：現金 ${yen(cashAmt)} ／ カード ${yen(amt - cashAmt)}</span></div>` : '';
      const head = `<div style="display:flex;justify-content:space-between;gap:.5rem;"><span>${formatDate(bizDay)} ${escapeHtml(fmtTimeDisp(b.start_time))}・${escapeHtml(b.customer_name_snapshot || '—')}</span>${headAmt}</div>${splitNote}`;
      // ドライバーが受け取り忘れて、実はキャストが持ったままのことがあるので、
      // その予約の担当キャストもプルダウン末尾に混ぜる（店長要望 2026-08-14）
      const castId = Number(b.assigned_admin_id);
      const castOpt = (castId && castId !== Number(curHolder) && !people.some(p => Number(p.id) === castId))
        ? `<option value="${castId}">${escapeHtml(nameOf(castId))}（キャスト）</option>` : '';
      const opts = people.filter(p => Number(p.id) !== Number(curHolder))
        .map(p => `<option value="${p.id}">${escapeHtml(p.display_name || p.username)}${p.role === 'driver' ? '（ドライバー）' : ''}</option>`).join('') + castOpt;
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
      if (!await opsConfirm(`本日分 ${ids.length}件を ${nameOf(to)} にまとめて渡します。よろしいですか？`)) return;
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
  /**
   * その日の報酬をぜんぶ渡し終えたら、そのキャストの出勤を自動で「終了」にする（店長要望 2026-08-10）。
   * 報酬を渡す＝その日の仕事が締まった、という運用のため。
   * 出勤中のときだけ触る（休み・予定・すでに終了は動かさない）。
   */
  async function autoFinishIfAllRewardPaid(adminId) {
    const bizDay = fmtDate(tlCurrentDate);
    const earned = (tlBookings || []).filter(b =>
      bizDateOf(b.booking_date, b.start_time) === bizDay && b.status === 'completed'
      && Number(b.assigned_admin_id) === Number(adminId)
      && b.course_name !== '休憩' && b.customer_name_snapshot !== '【休憩】'
    );
    if (!earned.length) return;
    if (earned.some(b => !b.reward_paid_at)) return;   // まだ渡していないものが残っている
    const sel = document.querySelector(`.tl-att-sel[data-admin="${adminId}"]`);
    if (!sel || sel.value !== 'available') return;     // 出勤中のときだけ
    await setStaffAttendance(adminId, 'done');
  }

  /**
   * スタッフのプルダウンの並びを「まとめ」と同じにする（店長要望 2026-08-29）。
   *   ① 上がった人（シフト＝終了）は一番下
   *   ② 内勤・ドライバーが先、キャストはその下
   *   ③ 同じ並びの中は名簿の順（sort_order → 名前）
   * まとめは③が金額順だが、プルダウンには金額が無いので名簿順にそろえる。
   */
  function opsStaffOrder(bizDay, shifts) {
    const list = shifts || tlShifts || [];
    const doneSet = new Set(list
      .filter(sh => String(sh.shift_date).slice(0, 10) === bizDay && sh.status === 'done')
      .map(sh => Number(sh.admin_user_id)));
    const isCastRow = (u) => !isOfficeCapable(u) && !isDriverCapable(u) && isTherapistCapable(u);
    return (a, b) => (Number(doneSet.has(Number(a.id))) - Number(doneSet.has(Number(b.id))))
      || (Number(isCastRow(a)) - Number(isCastRow(b)))
      || ((Number(a.sort_order) || 9999) - (Number(b.sort_order) || 9999))
      || String(a.display_name || a.username || '').localeCompare(String(b.display_name || b.username || ''), 'ja');
  }

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
                          : (b.shop_settled && b.shop_settled_by ? Number(b.shop_settled_by) : defaultHolderOf(b));
    const items = earned.map(b => {
      const price = Number(b.price) || 0, late = Number(b.late_fee) || 0, trans = Number(b.transport_fee) || 0, cardFee = Number(b.card_fee) || 0;
      const reward = meHasRate ? rewardOf(b) : 0;
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
    // 渡す人（誰が報酬を渡すか）。内勤・ドライバー・管理者から選ぶ
    const giverDuty = opsOnDutySet(bizDay, earned.flatMap(b => [holderOf(b), b.reward_paid_by, b.held_by]));
    const giverCandidates = (adminUsersAll || []).filter(u => u.id && giverDuty.has(Number(u.id))
      && (isOfficeCapable(u) || isDriverCapable(u) || u.role === 'owner' || u.role === 'manager'))
      .sort(opsStaffOrder(bizDay));   // 並びは「まとめ」と同じ（終了した人は下）
    // 既定では誰も選ばない（「--」）。誰かが入っていると、その人が渡したと勘違いする（店長指摘 2026-08-29）
    // オーナーと管理者は役職を出さない（店長指定 2026-08-22 / 2026-08-29）
    const roleSuffix = (u) => u.role === 'driver' ? '（ドライバー）' : (u.role === 'office' ? '（内勤）' : '');
    const giverRow = (meHasRate && earned.length && giverCandidates.length)
      ? `<div class="rwd-giver-row"><span class="rwd-giver-l">渡す人</span>
          <select id="rwdGiver" class="rwd-giver-sel"><option value="" selected>--</option>${giverCandidates.map(u => `<option value="${u.id}">${escapeHtml(u.display_name || u.username)}${roleSuffix(u)}</option>`).join('')}</select>
          <button type="button" id="rwdMail" class="rwd-mail-btn">✉️ 渡す人にメール</button></div>`
      : '';
    // 全部渡し終わっていたら見出しの右に印を出す（店長要望 2026-08-29）
    const allPaidBadge = (earned.length && !unpaidIds.length)
      ? '<span style="margin-left:.5rem;font-size:.78rem;font-weight:700;color:#2e9e5b;background:#e6f7ee;border-radius:999px;padding:.12rem .6rem;">✅ 精算済</span>'
      : '';
    body.innerHTML = `<div style="font-weight:700;">報酬合計 ${yen(totalReward)}（${earned.length}件）${allPaidBadge}</div>
      <div style="font-size:.78rem;color:var(--ink-soft);margin-bottom:.7rem;">各お仕事の報酬を ${escapeHtml(meName)} に渡したら 💸 で記録します。</div>
      ${giverRow}
      ${batchBtn}
      ${earned.length ? items.join('') : '<p style="color:var(--ink-soft);">この日の報酬はありません。</p>'}`;

    // 渡す人メール（選んだ担当者へ、報酬明細を送る）
    document.getElementById('rwdMail')?.addEventListener('click', async () => {
      const giverId = Number(document.getElementById('rwdGiver')?.value) || 0;
      if (!giverId) { toast('渡す人を選んでください', 'err'); return; }
      const giver = (adminUsersAll || []).find(u => Number(u.id) === giverId) || {};
      const giverName = giver.display_name || giver.username || '';
      const targets = earned.filter(b => !b.reward_paid_at);
      const list = targets.length ? targets : earned;
      if (!list.length) { toast('渡す報酬がありません', 'err'); return; }
      const sumR = list.reduce((s, b) => s + (meHasRate ? rewardOf(b) : 0), 0);
      const lines = [
        `${meName} さんへ報酬をお渡しください。`,
        `合計 ${yen(sumR)}（${list.length}件）`,
        '',
        ...list.map(b => `${formatDate(bizDateOf(b.booking_date, b.start_time))} ${fmtTimeDisp(b.start_time)} ${b.customer_name_snapshot || '—'} 様  ${yen(meHasRate ? rewardOf(b) : 0)}`),
        '',
        `渡し終えたら OPS「まとめ」→ ${meName} の報酬 で「渡した」記録をお願いします。`,
      ];
      const subject = `【報酬】${meName} へ ${yen(sumR)}（${formatDate(bizDay)}）`;
      if (!await opsConfirm(`${giverName} 宛に、${meName} の報酬明細（${yen(sumR)}・${list.length}件）をメール送信しますか？`)) return;
      try {
        await apiPost('/admin-api.php?action=send-reward-mail', { to_admin_id: giverId, subject, body: lines.join('\n') });
        toast(`${giverName} にメールしました`, 'ok');
      } catch (e) { toast('メール送信失敗: ' + e.message, 'err'); }
    });

    body.querySelectorAll('.rwd-pay').forEach(btn => btn.addEventListener('click', async () => {
      const by = Number(document.getElementById('rwdGiver')?.value) || null;
      // 既定を「--」にしたので、誰が渡したかを選ばずに記録できてしまわないようにする（店長指摘 2026-08-29）
      if (!by) { toast('渡す人を選んでください', 'err'); document.getElementById('rwdGiver')?.focus(); return; }
      const byName = nameOf(by);
      if (!await opsConfirm(`「${btn.dataset.desc}」の報酬 ${yen(Number(btn.dataset.reward))} を ${meName} に渡した記録にします。${byName ? `\n渡す人: ${byName}` : ''}`)) return;
      btn.disabled = true;
      try {
        await apiPost('/admin-api.php?action=booking-reward-pay', { id: Number(btn.dataset.id), paid: 1, by });
        toast('報酬を渡したと記録しました', 'ok');
        await loadTimeline(true);
        await autoFinishIfAllRewardPaid(adminId);   // 全部渡し終えたら出勤を「終了」に
        openRewardModal(adminId);
      } catch (e) { toast('記録失敗: ' + e.message, 'err'); btn.disabled = false; }
    }));
    body.querySelectorAll('.rwd-unpay').forEach(btn => btn.addEventListener('click', async () => {
      if (!await opsConfirm('報酬を渡した記録を取り消します。よろしいですか？')) return;
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
      const by = Number(document.getElementById('rwdGiver')?.value) || null;
      if (!by) { toast('渡す人を選んでください', 'err'); document.getElementById('rwdGiver')?.focus(); return; }
      const byName = nameOf(by);
      if (!await opsConfirm(`未渡しの報酬 ${unpaidIds.length}件（${yen(unpaidReward)}）を ${meName} にまとめて渡した記録にします。${byName ? `\n渡す人: ${byName}` : ''}`)) return;
      payAllBtn.disabled = true;
      try {
        await apiPost('/admin-api.php?action=booking-reward-pay-batch', { ids: unpaidIds, by });
        toast(`${unpaidIds.length}件の報酬を渡しました`, 'ok');
        await loadTimeline(true);
        await autoFinishIfAllRewardPaid(adminId);   // 全部渡し終えたら出勤を「終了」に
        openRewardModal(adminId);
      } catch (e) { toast('記録失敗: ' + e.message, 'err'); payAllBtn.disabled = false; }
    });
  }


  // =============================================================
  // 立川秘密基地（別システム）のその日の出勤セラピストを、タイムラインの
  // 「キャスト未割当」の下に足す（読み取り専用・店長要望 2026-08-19）。
  //   ・向こうのシステムには書き込まない
  //   ・お客様の名前・電話は取らない。出ているのは「出勤時間」と「埋まっている時間帯」だけ
  //   ・取得に失敗しても OPS のタイムラインは壊さない（黙って何も足さない）
  // =============================================================
  // 秘密基地のお仕事に、こちら側で付けた送迎の割り当て（order_id → {driver_id,self,mailed_at}）
  let _hkPickups = {};
  // 送迎ポップで出す内容（order_id → {name,start,end,label,place}）。描画のたびに作り直す
  let _hkBusyByOrder = {};
  /** 表示中の営業日が本日なら「今」を 10〜34 の目盛りで返す（別日なら null） */
  function hkNowAbs(bizDay) {
    if (bizDay !== fmtDate(getBusinessDayDate())) return null;
    const d = new Date();
    const h = d.getHours();
    return (h < 10 ? h + 24 : h) + d.getMinutes() / 60;
  }

  // 秘密基地の管理画面（オーダー登録/編集）への入口URL（店長要望 2026-09-01）。
  // こちらのサーバーからは一切書かない。店長自身のブラウザ（向こうに自分でログイン済み）で
  // 開くだけなので、連携用Cookieや端末登録には触れない＝読み取り専用の約束はそのまま。
  const HK_ORDER_URL = 'https://himitsu-kichi.mydns.jp/control/shop/order/';
  function hkBackQuery(bizDay) {
    const [y, m, d] = String(bizDay).split('-').map(Number);
    return `back_page=orderStatus&back_year=${y}&back_month=${m}&back_day=${d}`;
  }
  /** 既存オーダーの編集画面URL */
  function hkEditUrl(orderId, bizDay) {
    return `${HK_ORDER_URL}?order_id=${encodeURIComponent(orderId)}&${hkBackQuery(bizDay)}`;
  }
  /** 新規オーダー登録画面URL（セラピスト・日付を選んだ状態で開く。worker_id 無しなら素の登録画面） */
  function hkNewUrl(workerId, bizDay) {
    const [y, m, d] = String(bizDay).split('-').map(Number);
    const wk = workerId ? `worker_id=${encodeURIComponent(workerId)}&` : '';
    return `${HK_ORDER_URL}?${wk}in_year=${y}&in_month=${m}&in_day=${d}&${hkBackQuery(bizDay)}`;
  }

  async function renderHimitsuRows(bizDay) {
    const grid = document.getElementById('timelineGrid')?.querySelector('.tl-grid');
    if (!grid) return;
    // 秘密基地の行は一番下にあるので、消して作り直すとスクロール位置が上へ戻ってしまう。
    // 送迎メールを送ったあとに表示が飛んでいた（店長指摘 2026-08-29）ので、位置を覚えて戻す
    const wrap = grid.closest('.tl-wrap');
    // タイムライン全体の描き直し中（位置を戻している最中）は、その位置に合わせる
    const keep = _tlHold ? { top: _tlHold.top, left: _tlHold.left }
               : (wrap ? { top: wrap.scrollTop, left: wrap.scrollLeft } : null);
    const restore = () => { if (wrap && keep) { wrap.scrollTop = keep.top; wrap.scrollLeft = keep.left; } };
    grid.querySelectorAll('.hk-row').forEach(el => el.remove());
    let d = null;
    try { d = await api('/himitsu.php?action=day&date=' + encodeURIComponent(bizDay)); }
    catch (e) { restore(); return; }   // 別システムなので、取れなくてもタイムライン本体は出す
    if (!d || !d.ok || !Array.isArray(d.therapists) || !d.therapists.length) { restore(); return; }
    _hkPickups = d.pickups || {};
    _hkBusyByOrder = {};
    (d.therapists || []).forEach(t => (t.busy || []).forEach(b => {
      if (b.order_id) _hkBusyByOrder[String(b.order_id)] = { name: t.name, start: b.start, end: b.end, label: b.label, place: b.place, guest: b.guest };
    }));
    if (fmtDate(tlCurrentDate) !== bizDay) return;   // 表示中の日が変わっていたら捨てる（位置は新しい描画に任せる）

    const frag = document.createDocumentFragment();
    const head = document.createElement('div');
    head.className = 'tl-staff hk-row hk-head';
    head.style.gridColumn = '1 / -1';
    head.innerHTML = `<span class="hk-head-t">🏠 立川秘密基地（別システム）の出勤</span>`
                   + `<span class="hk-head-n">${d.therapists.length}名`
                   + ` <button type="button" class="hk-add" data-hk-new="" data-hk-newdate="${escapeAttr(bizDay)}" title="オーダーを登録">＋ オーダー登録</button></span>`;
    frag.appendChild(head);

    d.therapists.forEach(t => {
      const staff = document.createElement('div');
      staff.className = 'tl-staff hk-row hk-staff';
      const timeTxt = `${t.shift_start}<span class="tl-m-wave">〜</span>${t.shift_end}`;
      // お仕事が入っているか一目で分かるように（店長要望 2026-08-20）。
      // 黒（講習会など）以外を「お仕事」として数える（判定は himitsu-lib.php 側）
      const jobs = (t.busy || []).filter(x => x.kind === 'job');
      const nowAbs = hkNowAbs(bizDay);
      const working = nowAbs != null && jobs.some(x => x.start_h != null && x.end_h != null && x.start_h <= nowAbs && nowAbs < x.end_h);
      // 件数と「対応中」は別々に出す（今どうかと、その日に何件あるかは別の話・店長要望 2026-08-27）
      const jobChip = (jobs.length
          ? `<span class="hk-job">お仕事 ${jobs.length}件</span>`
          : '<span class="hk-job hk-job-none">お仕事なし</span>')
        + (working ? '<span class="hk-job hk-job-now">🟠 対応中</span>' : '');
      staff.innerHTML = `<div class="tl-staff-body"><div class="tl-staff-left">`
        + `<span class="tl-staff-thumb tl-staff-thumb-ph hk-thumb">${escapeHtml(String(t.name || '?').slice(0, 1))}</span>`
        + `<div class="tl-staff-name">${escapeHtml(t.name)}</div>`
        + (t.worker_id ? `<button type="button" class="hk-add" data-hk-new="${escapeAttr(String(t.worker_id))}" data-hk-newdate="${escapeAttr(bizDay)}" title="${escapeAttr(t.name)} のお仕事を登録">＋ お仕事</button>` : '')
        + `</div>`
        + `<div class="tl-staff-info">`
        + `<div class="tl-m tl-m-time"><span class="tl-m-l">時間</span><span class="tl-m-v">${timeTxt}</span></div>`
        + (t.note ? `<div class="tl-m"><span class="tl-m-l">備考</span><span class="tl-m-v">${escapeHtml(t.note)}</span></div>` : '')
        + `<div class="tl-m hk-job-row">${jobChip}</div>`
        + `<span class="role-mini hk-mini">${escapeHtml(t.shop || '')}秘密基地</span>`
        + `</div></div>`;
      frag.appendChild(staff);

      // 24スロット。OPSは10:00〜翌10:00、向こうは9:00〜翌8:00なので、重なる範囲だけ描く
      const ss = (t.start_h == null) ? null : Number(t.start_h);
      const se = (t.end_h == null) ? null : Number(t.end_h);
      let cells = '';
      for (let h = 10; h < 34; h++) {
        const inShift = (ss != null && se != null && h + 1 > ss && h < se);
        cells += `<div class="tl-cell hk-cell${inShift ? ' shift-bg' : ''}"></div>`;
      }
      let bars = '';
      (t.busy || []).forEach(b => {
        if (b.start_h == null || b.end_h == null) return;
        const bs = Math.max(10, Number(b.start_h));
        const be = Math.min(34, Number(b.end_h));
        if (!(be > bs)) return;   // 表示範囲の外
        const left = `calc((100% + 1px) / 24 * ${bs - 10})`;
        const width = `calc((100% + 1px) / 24 * ${be - bs} - 4px)`;
        const isJob = b.kind === 'job';
        const lbl = String(b.label || '').trim();
        const place = String(b.place || '').trim();
        const guest = String(b.guest || '').trim();
        // アドミの予約カードと同じ作りにする（店長要望 2026-08-29）。
        // 上から 時間 / お客様名 / 利用エリア / 詳細な場所 / 行き・帰りのドライバー
        const pu = (b.order_id && _hkPickups[String(b.order_id)]) || {};
        const drvNameOf = (id) => id
          ? ((adminUsersAll || []).find(u => Number(u.id) === Number(id))?.display_name || ('#' + id))
          : '';
        const legCell = (id, self, mailed) => (mailed ? '✓' : '')
          + (id ? escapeHtml(drvNameOf(id))
                : (Number(self) === 1 ? '<span class="bk-self">セラピ</span>' : '<span class="bk-self bk-drv-undecided">-</span>'));
        if (!isJob || !b.order_id) {
          const tip = `${b.start}〜${b.end}${lbl ? ' ' + lbl : ''}`;
          bars += `<div class="hk-busy is-other" style="left:${left};width:${width};" title="${escapeAttr(tip)}">`
                + `${escapeHtml(b.start)}〜${escapeHtml(b.end)}${lbl ? ' ' + escapeHtml(lbl) : ''}</div>`;
          return;
        }
        const tip = [guest, `${b.start}〜${b.end}${lbl ? ' ' + lbl : ''}`, place].filter(Boolean).join('\n');
        bars += `<div class="tl-booking hk-bk" data-hk-order="${escapeAttr(String(b.order_id))}" data-hk-date="${escapeAttr(bizDay)}"
                   style="left:${left};width:${width};top:2px;bottom:2px;" title="${escapeAttr(tip)}">
            <div class="bk-top"><span class="bk-st">${escapeHtml(b.start)}</span><span class="bk-dash">〜</span><span class="bk-et">${escapeHtml(b.end)}</span></div>
            <div class="bk-mid"><span class="bk-name">${escapeHtml(guest || '—')}</span></div>
            ${(lbl || place) ? `<div class="bk-venue hk-venue">${lbl ? `<span class="hk-area">${escapeHtml(lbl)}</span>` : ''}${place ? `🏠${escapeHtml(place)}` : ''}</div>` : ''}
            <div class="bk-bottom">
              <button class="bk-go${pu.mailed_at ? ' mailed' : ''}" data-hk-go="${escapeAttr(String(b.order_id))}" data-hk-date="${escapeAttr(bizDay)}" title="行き: ドライバー指定・メール送信">${legCell(pu.driver_id, pu.self === undefined ? 1 : pu.self, pu.mailed_at)}</button>
              <button class="bk-back${pu.back_mailed_at ? ' mailed' : ''}" data-hk-back="${escapeAttr(String(b.order_id))}" data-hk-date="${escapeAttr(bizDay)}" title="帰り: ドライバー指定・メール送信">${legCell(pu.back_driver_id, pu.back_self === undefined ? 1 : pu.back_self, pu.back_mailed_at)}</button>
            </div>
          </div>`;
      });
      const area = document.createElement('div');
      area.className = 'tl-row-area hk-row hk-area';
      area.innerHTML = cells + `<div class="tl-bk-wrap">${bars}</div>`;
      frag.appendChild(area);
    });
    grid.appendChild(frag);
    restore();
    requestAnimationFrame(restore);   // 描画が落ち着いたあとにもう一度あわせる
    // 行き / 帰り のボタン → ドライバー指定（既定はセラピ自走）。アドミの予約カードと同じ操作
    grid.querySelectorAll('[data-hk-go]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openHimitsuPickup(btn.dataset.hkGo, btn.dataset.hkDate, btn, 'go');
    }));
    grid.querySelectorAll('[data-hk-back]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openHimitsuPickup(btn.dataset.hkBack, btn.dataset.hkDate, btn, 'back');
    }));
    // お仕事バー本体をタップ → OPS内のオーダー編集モーダル（店長要望 2026-09-01「画面内で直接入力」）。
    // 行き/帰りボタンは上で止めているので混ざらない
    grid.querySelectorAll('.hk-bk[data-hk-order]').forEach(bar => bar.addEventListener('click', () => {
      openHkOrderModal({ orderId: bar.dataset.hkOrder, date: bar.dataset.hkDate });
    }));
    grid.querySelectorAll('.hk-add[data-hk-newdate]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openHkOrderModal({ workerId: btn.dataset.hkNew || null, date: btn.dataset.hkNewdate });
    }));
  }

  // ===== 🏠 秘密基地オーダーの登録・編集モーダル =====
  // アドミの予約（ops_bookings）とは完全に別物。保存先は秘密基地の管理システムで、
  // サーバー側が「全項目収穫→触った所だけ差し替え→全部返す」ので、ここに出していない
  // 項目（ポイント・ティッカー等）は壊れない。終了時刻も向こうの計算APIに任せる。
  let _hkoMeta = null;   // 開いているフォームの meta（保存時に slot 一覧を使う）
  let _hkoCtx = null;    // {orderId, workerId, date}
  async function openHkOrderModal(ctx) {
    const body = document.getElementById('hkOrderBody');
    const title = document.getElementById('hkOrderTitle');
    if (!body) { toast('画面を再読み込みしてください', 'err'); return; }
    _hkoCtx = ctx;
    title.textContent = ctx.orderId ? '🏠 立川秘密基地 オーダー編集' : '🏠 立川秘密基地 オーダー登録';
    body.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>秘密基地から読み込み中...</div>';
    openModal('hkOrderModal');
    let f;
    try {
      const q = ctx.orderId
        ? 'order_id=' + encodeURIComponent(ctx.orderId)
        : 'worker_id=' + encodeURIComponent(ctx.workerId || '') + '&date=' + encodeURIComponent(ctx.date || '');
      f = await api('/himitsu.php?action=order-form&' + q);
    } catch (e) {
      body.innerHTML = '<div class="empty">読み込みに失敗しました: ' + escapeHtml(e.message) + '</div>';
      return;
    }
    _hkoMeta = f.meta;
    renderHkOrderForm(f);
  }

  function hkoSel(name, opts = {}) {
    const m = _hkoMeta.selects[name];
    if (!m) return '';
    // 選択肢の「&yen1,100」は ¥ 表記に直して見せる（交通費・出張費）
    return `<select data-hko="${name}"${opts.grow ? ' style="flex:1;min-width:0;"' : ''}>`
      + m.options.map(([v, t]) => `<option value="${escapeAttr(v)}"${v === m.value ? ' selected' : ''}>${hkoLabel(t)}</option>`).join('')
      + `</select>`;
  }
  function hkoRadio(name, cls = '') {
    const m = _hkoMeta.radios[name];
    if (!m) return '';
    return m.options.map(([v, t]) => `<label class="hko-radio ${cls}"><input type="radio" name="hko_${name}" value="${escapeAttr(v)}"${v === m.value ? ' checked' : ''}>${escapeHtml(t)}</label>`).join('');
  }
  function hkoText(name, ph = '', type = 'text') {
    const v = _hkoMeta.texts[name] ?? '';
    return `<input type="${type}" data-hko="${name}" value="${escapeAttr(v)}" placeholder="${escapeAttr(ph)}" autocomplete="off">`;
  }
  /** 金額ラベル（&yen11,000 → ¥11,000） */
  function hkoLabel(s) { return escapeHtml(String(s || '').replace(/&yen;?/g, '¥')); }

  // コース・延長は「選んだものだけ」行で見せる（16行全部並べると読めない・店長指摘 2026-09-01）。
  // 向こうの回数selectは未選択が '0' なので、空判定は Number>0 で行う
  let _hkoRows = [];   // [{kind:'course'|'encho', slot, count}]
  function hkoSlotDef(kind, slot) {
    return (_hkoMeta.slots[kind] || []).find(x => Number(x.slot) === Number(slot));
  }
  /** ラベルから金額を読む（「1100 &yen1,100」→1100）。traffic_id / trip_id の料金計算用 */
  function hkoPriceFromLabel(t) {
    const m = String(t || '').match(/(?:&yen;?|¥)([\d,]+)/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
  }
  function hkoNum(v) { const n = parseInt(String(v || '').replace(/[^\-0-9]/g, ''), 10); return isNaN(n) ? 0 : n; }

  function renderHkoSlotRows() {
    const box = document.getElementById('hkoSlotRows');
    if (!box) return;
    if (!_hkoRows.length) {
      box.innerHTML = '<div class="hko-note" style="padding:.2rem 0 .4rem;">まだコースがありません。下の「＋ 追加」から選んでください。</div>';
    } else {
      box.innerHTML = _hkoRows.map((r, i) => {
        const def = hkoSlotDef(r.kind, r.slot) || { label: '?' };
        let opts = '';
        for (let n = 1; n <= 9; n++) opts += `<option value="${n}"${Number(r.count) === n ? ' selected' : ''}>${n}</option>`;
        if (Number(r.count) > 9) opts += `<option value="${escapeAttr(String(r.count))}" selected>${escapeHtml(String(r.count))}</option>`;
        return `<div class="hko-course-row">
            <span class="hko-ckind">${r.kind === 'encho' ? '延長' : 'コース'}</span>
            <span class="hko-cname">${hkoLabel(def.label)}</span>
            <select data-hko-rowcount="${i}">${opts}</select><span class="hko-note">回</span>
            <button type="button" class="hko-course-del" data-hko-rowdel="${i}" title="外す">×</button>
          </div>`;
      }).join('');
    }
    box.querySelectorAll('[data-hko-rowcount]').forEach(sel => sel.addEventListener('change', () => {
      _hkoRows[Number(sel.dataset.hkoRowcount)].count = sel.value;
      recalcHkTotals();
    }));
    box.querySelectorAll('[data-hko-rowdel]').forEach(btn => btn.addEventListener('click', () => {
      _hkoRows.splice(Number(btn.dataset.hkoRowdel), 1);
      renderHkoSlotRows();
      recalcHkTotals();
    }));
  }

  /**
   * 料金・ポイント・終了時刻を、向こうのフォームと同じ考え方で概算表示する。
   *   料金 = コース＋延長＋指名＋オプション＋交通費＋出張費＋追加移動費＋その他料金
   *   ポイント = 料金＋本指名pt＋貸切pt＋延長pt＋追加ポイント
   * 確定値は保存時に向こうのシステムが計算する（ここは目安の表示）
   */
  function recalcHkTotals() {
    const body = document.getElementById('hkOrderBody');
    if (!body || !_hkoMeta) return;
    const P = _hkoMeta.extras?.points || {};
    let price = 0, points = 0, mins = 0, kashikiriCnt = 0;
    _hkoRows.forEach(r => {
      const def = hkoSlotDef(r.kind, r.slot);
      if (!def) return;
      const c = Number(r.count) || 0;
      price += (def.price || 0) * c;
      mins += (def.min || 0) * c;
      if (r.kind === 'course' && def.kashikiri) kashikiriCnt += c;
      if (r.kind === 'encho' && def.pt_flag) points += (P['point_encho' + def.pt_flag] || 0) * c;
    });
    const c1 = hkoNum(body.querySelector('[data-hko="shimei_count1"]')?.value);
    const c2 = hkoNum(body.querySelector('[data-hko="shimei_count2"]')?.value);
    const sm1 = _hkoMeta.slots.shimei.find(x => x.slot === 1), sm2 = _hkoMeta.slots.shimei.find(x => x.slot === 2);
    price += (sm1?.price || 0) * c1 + (sm2?.price || 0) * c2;
    points += (P.point_honshi || 0) * c2 + (P.point_kashikiri || 0) * kashikiriCnt;
    body.querySelectorAll('[data-hko-opt]').forEach(el => {
      if (!el.checked) return;
      const o = _hkoMeta.slots.option.find(x => Number(x.slot) === Number(el.dataset.hkoOpt));
      price += o?.price || 0;
    });
    ['traffic_id', 'trip_id'].forEach(name => {
      const sel = body.querySelector(`[data-hko="${name}"]`);
      if (!sel || !sel.value) return;
      const opt = (_hkoMeta.selects[name]?.options || []).find(([v]) => v === sel.value);
      price += hkoPriceFromLabel(opt?.[1]);
    });
    price += hkoNum(body.querySelector('[data-hko="traffic_price_add"]')?.value);
    price += hkoNum(body.querySelector('[data-hko="etc_price"]')?.value);
    points += price + hkoNum(body.querySelector('[data-hko="add_point"]')?.value);
    const priceEl = document.getElementById('hkoTotalPrice');
    const ptEl = document.getElementById('hkoTotalPoint');
    if (priceEl) priceEl.textContent = price.toLocaleString();
    if (ptEl) ptEl.textContent = points.toLocaleString();
    // 終了時刻の目安（開始＋コース・延長の合計分）。確定値は保存時に向こうが計算
    const outEl = document.getElementById('hkoOutTime');
    if (outEl) {
      const y = hkoNum(body.querySelector('[data-hko="in_year"]')?.value);
      const mo = hkoNum(body.querySelector('[data-hko="in_month"]')?.value);
      const d = hkoNum(body.querySelector('[data-hko="in_day"]')?.value);
      const h = hkoNum(body.querySelector('[data-hko="in_hour"]')?.value);
      const mi = hkoNum(body.querySelector('[data-hko="in_min"]')?.value);
      if (y && mo && d && mins > 0) {
        const dt = new Date(y, mo - 1, d, h, mi + mins);
        outEl.textContent = `終了時間 ${dt.getMonth() + 1}/${dt.getDate()} ${dt.getHours()}:${String(dt.getMinutes()).padStart(2, '0')}（コースから自動計算）`;
      } else {
        outEl.textContent = '終了時間はコースから自動計算されます';
      }
    }
  }

  function hkoField(label, inner, req = false) {
    return `<div class="hko-field"><label>${label}${req ? '<span class="hko-req">(必須)</span>' : ''}</label>${inner}</div>`;
  }

  function renderHkOrderForm(f) {
    const body = document.getElementById('hkOrderBody');
    const m = f.meta;
    const slots = m.slots;
    const ex = m.extras || {};
    _hkoRows = [];
    slots.course.forEach(c => { if (Number(c.count) > 0) _hkoRows.push({ kind: 'course', slot: c.slot, count: c.count }); });
    slots.encho.forEach(c => { if (Number(c.count) > 0) _hkoRows.push({ kind: 'encho', slot: c.slot, count: c.count }); });
    // 指名: 向こうと同じく初指名・本指名の本数を両方見せる。radioは入力補助（押すと本数が入る）
    const sm1 = slots.shimei.find(x => x.slot === 1) || { count: '0', label: '初指名' };
    const sm2 = slots.shimei.find(x => x.slot === 2) || { count: '0', label: '本指名' };
    const shimeiMode = Number(sm2.count) > 0 ? 'main' : (Number(sm1.count) > 0 ? 'first' : 'free');
    const cntSel = (name, cur) => {
      let o = `<option value="0"${Number(cur) === 0 ? ' selected' : ''}>なし</option>`;
      for (let n = 1; n <= 9; n++) o += `<option value="${n}"${Number(cur) === n ? ' selected' : ''}>${n}回</option>`;
      if (Number(cur) > 9) o += `<option value="${escapeAttr(String(cur))}" selected>${escapeHtml(String(cur))}回</option>`;
      return `<select data-hko="${name}">${o}</select>`;
    };
    const shimeiRadio = [['free', 'フリー'], ['first', '初指名'], ['main', '本指名']]
      .map(([v, t]) => `<label class="hko-radio"><input type="radio" name="hko_shimei_mode" value="${v}"${v === shimeiMode ? ' checked' : ''}>${t}</label>`).join('');
    const adderOpts = `<option value="">＋ コース・延長を追加...</option>`
      + `<optgroup label="ご利用コース">${slots.course.map(c => `<option value="course:${c.slot}">${hkoLabel(c.label)}</option>`).join('')}</optgroup>`
      + `<optgroup label="延長">${slots.encho.map(c => `<option value="encho:${c.slot}">延長 ${hkoLabel(c.label)}</option>`).join('')}</optgroup>`;
    const copyBtns = (_hkoCtx.orderId && (ex.worker_url || ex.guest_url))
      ? `<div class="hko-row" style="margin-bottom:.6rem;">
          ${ex.worker_url ? `<button type="button" class="hko-copybtn" data-hko-copy="${escapeAttr(ex.worker_url)}">📋 セラピスト用URL</button>` : ''}
          ${ex.guest_url ? `<button type="button" class="hko-copybtn" data-hko-copy="${escapeAttr(ex.guest_url)}">📋 お客様用URL</button>` : ''}
        </div>` : '';

    body.innerHTML = `
      ${copyBtns}
      <div class="hko-sec">基本</div>
      ${hkoField('セラピスト', hkoSel('worker_id', { grow: 1 }), true)}
      <div class="hko-field"><label>ステータス</label><div class="hko-row">${hkoRadio('status')}</div></div>
      <div class="hko-field"><label>支払い方法<span class="hko-req">(必須)</span></label>
        <div class="hko-row">${hkoSel('method_of_payment')}
        <label class="hko-check"><input type="checkbox" data-hko-check="payment_status"${m.checks.payment_status ? ' checked' : ''}>支払い済み</label></div></div>
      <div class="hko-field"><label>開始時間</label>
        <div class="hko-row">${hkoSel('in_year')}${hkoSel('in_month')}${hkoSel('in_day')}
          <span class="hko-gap"></span>${hkoSel('in_hour')}<b>:</b>${hkoSel('in_min')}</div>
        <div class="hko-note" id="hkoOutTime" style="margin-top:.25rem;"></div></div>
      <div class="hko-sec">お客様</div>
      <div class="hko-field"><label>新規/会員<span class="hko-req">(必須)</span></label><div class="hko-row">${hkoRadio('client_type')}</div></div>
      ${hkoField('お名前（様）', hkoText('client_name', ''), true)}
      ${hkoField('予約方法', hkoSel('method_of_reserve', { grow: 1 }))}
      <div class="hko-field"><label>電話番号</label>
        <div class="hko-row" style="flex-wrap:nowrap;">${hkoText('client_tel', '半角数字英数', 'tel')}
          <button type="button" class="hko-copybtn" id="hkoTelSearch" style="flex:0 0 auto;">🔍 照会</button></div>
        <div id="hkoTelResult"></div></div>
      ${hkoField('メールアドレス', hkoText('client_email', ''))}
      ${hkoField('ご利用エリア', hkoText('area', ''))}
      ${hkoField('合流方法', hkoSel('method_of_join', { grow: 1 }))}
      ${hkoField('詳細な場所', hkoText('place', ''))}
      <div class="hko-sec">指名（本数自動計算）</div>
      <div class="hko-row">${shimeiRadio}</div>
      <div class="hko-course-row"><span class="hko-cname">${hkoLabel(sm1.label)}</span>${cntSel('shimei_count1', sm1.count)}</div>
      <div class="hko-course-row"><span class="hko-cname">${hkoLabel(sm2.label)}</span>${cntSel('shimei_count2', sm2.count)}</div>
      <div class="hko-sec">ご利用コース・延長</div>
      <div id="hkoSlotRows"></div>
      <div class="hko-row"><select id="hkoSlotAdd" style="flex:1;">${adderOpts}</select></div>
      <div class="hko-sec">交通費</div>
      ${hkoField('交通費', hkoSel('traffic_id', { grow: 1 }))}
      ${hkoField('追加移動費<span class="hko-req">（深夜料金・お客様から頂くタクシー代など）</span>', hkoText('traffic_price_add', '半角数字') + '<span class="hko-note"> 円</span>')}
      ${hkoField('交通費実費<span class="hko-req">（実際にセラピストが受け取る金額）</span>', hkoText('full_back_price', '半角数字') + '<span class="hko-note"> 円</span>')}
      <div class="hko-sec">オプション</div>
      <div class="hko-opts">
        ${slots.option.map(o => `<label class="hko-check hko-opt-chip"><input type="checkbox" data-hko-opt="${o.slot}"${o.enabled ? ' checked' : ''}>${hkoLabel(o.label)}</label>`).join('')}</div>
      ${hkoField('出張費', hkoSel('trip_id', { grow: 1 }))}
      ${hkoField('その他料金（調整用）', hkoText('etc_price', '') + '<span class="hko-note"> 円</span>')}
      <div class="hko-sec">備考</div>
      <div class="hko-field"><label>備考（セラピスト用のオーダー確認用URLに反映されます）</label>
        <textarea data-hko="bikou" rows="4">${escapeHtml(m.texts.bikou ?? '')}</textarea></div>
      ${hkoField('追加ポイント', hkoText('add_point', '半角数字', 'tel'))}
      <div class="hko-field"><label>メモ（ここの項目はお客様にもセラピストにも見えません）</label>
        <textarea data-hko="bikou_staff_only" rows="4">${escapeHtml(m.texts.bikou_staff_only ?? '')}</textarea></div>
      <div class="hko-total">料金は <b>¥<span id="hkoTotalPrice">0</span></b> です<br>
        ポイントは <b><span id="hkoTotalPoint">0</span></b> ポイントです
        <span class="hko-note">（目安。確定は保存時に秘密基地側で計算）</span></div>
      <div class="hko-foot">
        <button type="button" class="hko-save" id="hkoSave">${_hkoCtx.orderId ? '保存する' : '登録する'}</button>
        ${_hkoCtx.orderId ? '<button type="button" class="hko-trash" id="hkoTrash">削除（ゴミ箱）</button>' : ''}
        <a class="hko-open-hk" href="${escapeAttr(_hkoCtx.orderId ? hkEditUrl(_hkoCtx.orderId, _hkoCtx.date || fmtDate(tlCurrentDate)) : hkNewUrl(_hkoCtx.workerId, _hkoCtx.date || fmtDate(tlCurrentDate)))}" target="_blank" rel="noopener">秘密基地の画面で開く</a>
      </div>`;
    renderHkoSlotRows();
    recalcHkTotals();
    // コース・延長の追加
    document.getElementById('hkoSlotAdd')?.addEventListener('change', (e) => {
      const v = e.target.value; e.target.value = '';
      if (!v) return;
      const [kind, slot] = v.split(':');
      const exRow = _hkoRows.find(r => r.kind === kind && Number(r.slot) === Number(slot));
      if (exRow) exRow.count = String(Number(exRow.count) + 1);
      else _hkoRows.push({ kind, slot: Number(slot), count: '1' });
      renderHkoSlotRows();
      recalcHkTotals();
    });
    // 指名: radioを押すと本数が入る（向こうの自動計算ボタンの代わり）。本数を直接触るとradioが追従
    const smSync = () => {
      const c1 = hkoNum(body.querySelector('[data-hko="shimei_count1"]')?.value);
      const c2 = hkoNum(body.querySelector('[data-hko="shimei_count2"]')?.value);
      const mode = c2 > 0 ? 'main' : (c1 > 0 ? 'first' : 'free');
      const r = body.querySelector(`input[name="hko_shimei_mode"][value="${mode}"]`);
      if (r) r.checked = true;
    };
    body.querySelectorAll('input[name="hko_shimei_mode"]').forEach(r => r.addEventListener('change', () => {
      const v = body.querySelector('input[name="hko_shimei_mode"]:checked')?.value;
      const s1 = body.querySelector('[data-hko="shimei_count1"]');
      const s2 = body.querySelector('[data-hko="shimei_count2"]');
      if (v === 'free') { if (s1) s1.value = '0'; if (s2) s2.value = '0'; }
      if (v === 'first') { if (s1 && hkoNum(s1.value) === 0) s1.value = '1'; if (s2) s2.value = '0'; }
      if (v === 'main') { if (s2 && hkoNum(s2.value) === 0) s2.value = '1'; if (s1) s1.value = '0'; }
      recalcHkTotals();
    }));
    body.querySelector('[data-hko="shimei_count1"]')?.addEventListener('change', () => { smSync(); });
    body.querySelector('[data-hko="shimei_count2"]')?.addEventListener('change', () => { smSync(); });
    // どこを触っても料金・ポイント・終了時刻を計算し直す
    body.addEventListener('change', recalcHkTotals);
    body.addEventListener('input', recalcHkTotals);
    // 電話番号で顧客照会（秘密基地の顧客管理を検索・店長要望 2026-09-01）
    document.getElementById('hkoTelSearch')?.addEventListener('click', async () => {
      const tel = String(body.querySelector('[data-hko="client_tel"]')?.value || '').replace(/[^0-9]/g, '');
      const box = document.getElementById('hkoTelResult');
      if (!box) return;
      if (tel.length < 4) { toast('電話番号を入力してください', 'err'); return; }
      box.innerHTML = '<div class="hko-note" style="padding:.3rem 0;">照会中...</div>';
      let d;
      try { d = await api('/himitsu.php?action=client-search&tel=' + encodeURIComponent(tel)); }
      catch (e) { box.innerHTML = `<div class="hko-note" style="color:#c0392b;">照会失敗: ${escapeHtml(e.message)}</div>`; return; }
      const list = d.clients || [];
      if (!list.length) { box.innerHTML = '<div class="hko-tel-none">この番号の顧客は見つかりません（新規のお客様）</div>'; return; }
      box.innerHTML = list.map((c, i) => `<div class="hko-tel-hit">
          <div class="hko-tel-info"><b>${escapeHtml(c.name)}様</b>
            <span>利用 ${escapeHtml(c.count)}</span><span>最終 ${escapeHtml(c.last)}</span><span>${escapeHtml(c.tel)}</span></div>
          <button type="button" class="hko-copybtn" data-hko-fill="${i}">この顧客を反映</button>
        </div>`).join('');
      box.querySelectorAll('[data-hko-fill]').forEach(btn => btn.addEventListener('click', () => {
        const c = list[Number(btn.dataset.hkoFill)];
        const nameIn = body.querySelector('[data-hko="client_name"]');
        if (nameIn) nameIn.value = c.name;
        const member = body.querySelector('input[name="hko_client_type"][value="member"]');
        if (member) member.checked = true;
        toast(`✓ ${c.name}様（会員）を反映しました`, 'ok');
      }));
    });
    // URLコピー
    body.querySelectorAll('[data-hko-copy]').forEach(btn => btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(btn.dataset.hkoCopy); toast('✓ URLをコピーしました', 'ok'); }
      catch (e) { toast('コピーできませんでした', 'err'); }
    }));
    document.getElementById('hkoSave')?.addEventListener('click', saveHkOrder);
    document.getElementById('hkoTrash')?.addEventListener('click', trashHkOrder);
  }

  async function saveHkOrder() {
    const body = document.getElementById('hkOrderBody');
    const edits = {};
    body.querySelectorAll('[data-hko]').forEach(el => { edits[el.getAttribute('data-hko')] = el.value; });
    body.querySelectorAll('input[name^="hko_"][type="radio"]:checked').forEach(el => {
      const name = el.name.replace(/^hko_/, '');
      if (name === 'shimei_mode') return;   // 補助ボタン。実体は shimei_count1/2
      edits[name] = el.value;
    });
    // コース・延長: 全スロットを明示的に送る（外したものは '0'＝向こうの「なし」）
    (_hkoMeta.slots.course || []).forEach(c => {
      const r = _hkoRows.find(x => x.kind === 'course' && Number(x.slot) === Number(c.slot));
      edits['course_count' + c.slot] = r ? String(r.count) : '0';
    });
    (_hkoMeta.slots.encho || []).forEach(c => {
      const r = _hkoRows.find(x => x.kind === 'encho' && Number(x.slot) === Number(c.slot));
      edits['encho_count' + c.slot] = r ? String(r.count) : '0';
    });
    // チェックボックス
    edits.payment_status = !!body.querySelector('[data-hko-check="payment_status"]')?.checked;
    body.querySelectorAll('[data-hko-opt]').forEach(el => { edits['option_enable' + el.dataset.hkoOpt] = el.checked; });
    if (!_hkoRows.some(r => r.kind === 'course' && Number(r.count) > 0)) { toast('コースを選んでください', 'err'); return; }
    if (!String(edits.client_name || '').trim()) { toast('お名前を入力してください', 'err'); return; }
    const nm = (_hkoMeta.selects.worker_id?.options || []).find(([v]) => v === edits.worker_id)?.[1] || '';
    if (!await opsConfirm(`立川秘密基地にこのオーダーを${_hkoCtx.orderId ? '上書き保存' : '登録'}します。\nセラピスト: ${nm}\nよろしいですか？`)) return;
    const btn = document.getElementById('hkoSave');
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
    try {
      await apiPost('/himitsu.php?action=order-save', {
        order_id: _hkoCtx.orderId || '',
        worker_id: _hkoCtx.workerId || '',
        date: _hkoCtx.date || fmtDate(tlCurrentDate),
        edits,
      });
      toast('✓ 秘密基地に保存しました', 'ok');
      closeModal('hkOrderModal');
      loadTimeline(true);
    } catch (e) {
      toast('保存失敗: ' + e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = _hkoCtx.orderId ? '保存する' : '登録する'; }
    }
  }

  async function trashHkOrder() {
    if (!_hkoCtx?.orderId) return;
    if (!await opsConfirm('このオーダーを削除（ゴミ箱に移動）します。\n本当によろしいですか？')) return;
    const btn = document.getElementById('hkoTrash');
    if (btn) { btn.disabled = true; btn.textContent = '削除中...'; }
    try {
      await apiPost('/himitsu.php?action=order-trash', { order_id: _hkoCtx.orderId });
      toast('✓ ゴミ箱に移動しました', 'ok');
      closeModal('hkOrderModal');
      loadTimeline(true);
    } catch (e) {
      toast('削除失敗: ' + e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = '削除（ゴミ箱）'; }
    }
  }

  /**
   * 立川秘密基地のお仕事の送迎割り当て（店長要望 2026-08-29）。
   * 向こうのシステムには一切書かず、こちら側だけで「誰が送るか」を持ち、ドライバーにメールを送る。
   * 既定は「セラピ（自走）」。
   */
  async function openHimitsuPickup(orderId, bizDay, anchorEl, leg) {
    closeTimeAdjust();
    const isGo = leg !== 'back';
    const p0 = _hkPickups[String(orderId)] || {};
    const cur = isGo
      ? { driver_id: p0.driver_id || null, self: p0.self === undefined ? 1 : p0.self }
      : { driver_id: p0.back_driver_id || null, self: p0.back_self === undefined ? 1 : p0.back_self };
    const [shifts, offSet] = await Promise.all([shiftsForDay(bizDay), driverOffSetForDay(bizDay)]);
    const capable = (adminUsersAll || []).filter(u => isDriverCapable(u));
    const drivers = capable.filter(u => {
      if (offSet.has(Number(u.id))) return false;
      const sh = shiftForDay(shifts, bizDay, u.id);
      return !!sh && sh.status !== 'off';
    });
    if (cur.driver_id && !drivers.some(u => Number(u.id) === Number(cur.driver_id))) {
      const a = capable.find(u => Number(u.id) === Number(cur.driver_id));
      if (a) drivers.push(a);
    }
    drivers.sort(opsStaffOrder(bizDay, shifts));
    // 行き先（詳細な場所）はバーの title から拾う。ここでも改めて出す
    const info = _hkBusyByOrder[String(orderId)] || {};
    const opts = `<option value="self"${!cur.driver_id ? ' selected' : ''}>セラピ（自走）</option>`
      + drivers.map(u => `<option value="${u.id}"${Number(u.id) === Number(cur.driver_id) ? ' selected' : ''}>${escapeHtml(u.display_name || u.username)}</option>`).join('');
    const pop = document.createElement('div');
    pop.id = 'tlHkPop';
    pop.className = 'tl-time-pop';
    pop.innerHTML = `<div class="ttp-head"><span class="ttp-label">🏠 秘密基地 ${isGo ? '行き（送り）' : '帰り（迎え）'}</span><button class="ttp-close" type="button" aria-label="閉じる">×</button></div>
      <div class="ttp-hk-info">${escapeHtml(info.guest || '')}${info.guest ? '　' : ''}${escapeHtml(info.name || '')}　${escapeHtml(info.start || '')}〜${escapeHtml(info.end || '')}${info.label ? '　' + escapeHtml(info.label) : ''}</div>
      ${info.place ? `<div class="ttp-hk-place">${escapeHtml(info.place)}</div>` : ''}
      <select class="ttp-sel" id="tlHkSel">${opts}</select>
      <button type="button" class="ttp-mail" id="tlHkMail">✉️ ドライバーにメール</button>`;
    document.body.appendChild(pop);
    const r = anchorEl.getBoundingClientRect();
    pop.style.top = (r.bottom + window.scrollY + 4) + 'px';
    pop.style.left = (r.left + window.scrollX) + 'px';
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) pop.style.left = (window.innerWidth - pr.width - 8 + window.scrollX) + 'px';
    pop.querySelector('.ttp-close').addEventListener('click', (e) => { e.stopPropagation(); closeTimeAdjust(); });
    pop.addEventListener('click', (e) => e.stopPropagation());

    const sel = pop.querySelector('#tlHkSel');
    sel.addEventListener('change', async (e) => {
      e.stopPropagation();
      const raw = String(e.target.value || '');
      const isSelf = raw === 'self';
      const dv = isSelf ? 0 : (parseInt(raw, 10) || 0);
      sel.disabled = true;
      try {
        await apiPost('/himitsu.php?action=pickup-set', { order_id: orderId, work_date: bizDay, leg: isGo ? 'go' : 'back', driver_id: dv, self: isSelf ? 1 : 0 });
        const cache = _hkPickups[String(orderId)] = _hkPickups[String(orderId)] || {};
        if (isGo) { cache.driver_id = dv || null; cache.self = isSelf ? 1 : 0; cache.mailed_at = null; }
        else { cache.back_driver_id = dv || null; cache.back_self = isSelf ? 1 : 0; cache.back_mailed_at = null; }
        toast(isSelf ? '✓ セラピ（自走）にしました' : '✓ ' + (drivers.find(u => Number(u.id) === dv)?.display_name || '') + ' を割当', 'ok');
        renderHimitsuRows(bizDay).catch(() => {});
      } catch (err) { toast('更新失敗: ' + err.message, 'err'); }
      sel.disabled = false;
    });

    pop.querySelector('#tlHkMail').addEventListener('click', async (e) => {
      e.stopPropagation();
      const dv = parseInt(sel.value, 10) || 0;
      if (!dv) { toast('先にドライバーを選んでください', 'err'); return; }
      const drv = (adminUsersAll || []).find(u => Number(u.id) === dv) || {};
      let email = String(drv.email || '').trim() || String(drv.username || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('ドライバーのメールアドレスが未登録です', 'err'); return; }
      // 文面はアドミの送迎メールにそろえる（店長要望 2026-08-29）。
      // ただし秘密基地（セラピスト）のぶんはお客様名を入れない（店長指定 2026-08-29）
      const lines = [];
      lines.push(isGo ? '🚗【送迎 行き（送り）】' : '🚗【送迎 帰り（迎え）】');
      if (info.name) lines.push('セラピスト: ' + info.name);
      lines.push('ドライバー: ' + (drv.display_name || drv.username || ''));
      lines.push('日付: ' + formatDate(bizDay));
      if (info.start && info.end) lines.push(isGo ? `到着見込み: ${info.start}〜${info.end}` : `${info.start}〜${info.end}お迎え予定`);
      if (info.label) lines.push('エリア: ' + info.label);
      if (info.place) {
        lines.push('場所: ' + info.place);
        // 住所らしい（市区町村＋番地）ときだけ地図リンクを付ける。「DMにて」等には付けない
        if (/[都道府県市区町村郡]/.test(info.place) && /[0-9０-９]/.test(info.place)) {
          const q = encodeURIComponent(addressForMap(info.place));
          lines.push('Googleマップ: https://www.google.com/maps/search/?api=1&query=' + q);
          lines.push('Yahoo!マップ: https://map.yahoo.co.jp/search?q=' + q);
          lines.push('Appleマップ: https://maps.apple.com/?q=' + q);
        }
      }
      const subject = `${isGo ? '【送迎 行き（送り）】' : '【送迎 帰り（迎え）】'}${info.name || ''} ${formatDate(bizDay)}${info.start ? ' ' + info.start : ''}`;
      if (!await opsConfirm(`${drv.display_name || email} 宛に送迎情報をメール送信しますか？\n送信先: ${email}`)) return;
      try {
        await apiPost('/admin-api.php?action=send-reward-mail', { to_admin_id: dv, subject, body: lines.join('\n') });
        await apiPost('/himitsu.php?action=pickup-mailed', { order_id: orderId, leg: isGo ? 'go' : 'back' });
        const c2 = _hkPickups[String(orderId)] = _hkPickups[String(orderId)] || {};
        if (isGo) c2.mailed_at = '1'; else c2.back_mailed_at = '1';
        toast('✓ ' + (drv.display_name || email) + ' にメール送信しました', 'ok');
        closeTimeAdjust();
        renderHimitsuRows(bizDay).catch(() => {});
      } catch (err) { toast('メール送信失敗: ' + err.message, 'err'); }
    });
    setTimeout(() => document.addEventListener('click', _ttpOutside, true), 0);
  }

  /**
   * タイムライン枠の高さを実測で決める（店長指摘 2026-08-27: スマホで下の行まで届かない）。
   * ヘッダー(sticky) と日付バー(sticky) は画面に貼りつくので、枠の高さは
   * 「画面の高さ − その2つ」でないと、枠の底がページの底より下にはみ出して最後の行が見えなくなる。
   * 日付バーの背の高さは画面幅で変わる（スマホは電話番号欄などで2〜3行）ため決め打ちにできない。
   */
  function syncTimelineHeight() {
    const hdr = document.querySelector('header');
    const bar = document.querySelector('#view-timeline .tl-toolbar');
    const hdrH = hdr ? Math.round(hdr.getBoundingClientRect().height) : 68;
    const barH = bar ? Math.round(bar.getBoundingClientRect().height) : 90;
    const root = document.documentElement;
    root.style.setProperty('--hdr-h', hdrH + 'px');
    // 枠の下に少しだけ余白（影が切れないぶん）
    root.style.setProperty('--tl-stick', (hdrH + barH + 8) + 'px');
  }
  window.addEventListener('resize', syncTimelineHeight);
  window.addEventListener('orientationchange', () => setTimeout(syncTimelineHeight, 250));

  /**
   * 遊べる時刻を過ぎたキャストは、交互表示をやめて出勤時間に「今」を出しっぱなしにする。
   * まだのキャストは交互のまま。4秒ごとに呼ぶので、時刻が来たらその場で切り替わる
   */
  function syncPlayNowMode() {
    const now = Date.now();
    document.querySelectorAll('.tl-m-alt[data-play-at]').forEach(el => {
      const at  = Date.parse(String(el.getAttribute('data-play-at') || '').replace(' ', 'T'));
      const end = Date.parse(String(el.getAttribute('data-shift-end') || '').replace(' ', 'T'));
      const ended = !isNaN(end) && now >= end;             // 出勤が終わった＝もう案内できない
      const passed = !ended && !isNaN(at) && now >= at;
      // 終わった人は交互表示もやめて、出勤時間だけを出す
      el.classList.toggle('is-nowmode', passed || ended);
      const mark = el.querySelector('.tl-nowmark');
      if (mark) mark.hidden = !passed;
    });
  }

  // 「時間」の交互表示を動かす時計。描き直しても止まらないよう1本だけ持つ
  let _tlAltTimer = null;
  let _tlAltOn = false;
  function ensureTimeAltTimer() {
    if (_tlAltTimer) return;
    _tlAltTimer = setInterval(() => {
      _tlAltOn = !_tlAltOn;
      document.querySelectorAll('.tl-m-alt').forEach(el => el.classList.toggle('show-b', _tlAltOn));
      syncPlayNowMode();     // 見直すたびに、時刻が来ていれば「今」に切り替わる
    }, 5000);                // ゆっくり溶ける切り替え（0.75秒）に合わせて、間隔も少し長めに
  }

  function renderTimeline() {
    const grid = document.getElementById('timelineGrid');
    const bizDay = fmtDate(tlCurrentDate);
    // 描き直すとバーのDOMごと入れ替わり mouseout が飛ばないので、先にふきだしを消す
    // （消さないと古い内容が宙に浮いたまま残る）
    hideBookingTip();
    // どこから呼ばれても、既に描いてある画面の「描き直し」なら今の位置を引き継ぐ。
    // 一部の操作（始/終の記録・注意事項の保存など）が位置を覚えずに描き直していて、
    // 10〜11時台へ飛んでいた（店長指摘 2026-09-01）。呼び出し側の覚え忘れを個別に
    // 直すのではなく、ここで一括して面倒を見る。日付移動・初回表示は先に「読み込み中」
    // を挟む＝ .loading がある時だけ初回扱いにして、従来どおり現在時刻へスクロールする
    if (_tlPrevScroll == null) {
      const w0 = document.querySelector('.tl-wrap');
      if (w0 && grid && grid.children.length && !grid.querySelector('.loading')) {
        _tlPrevScroll = _tlHold ? { left: _tlHold.left, top: _tlHold.top }
                                : { left: w0.scrollLeft, top: w0.scrollTop };
      }
    }

    // ヘッダー: スタッフ列 + 24時間スロット (10:00 〜 翌09:00)
    let html = '<div class="tl-grid"><div class="tl-head staff-col">キャスト</div>';
    // 今この時間、という目印。表示中の営業日が本日のときだけ出す（一日中見る画面で今どこかを見失わないため）
    const _nh = new Date().getHours();
    const nowH = bizDay === fmtDate(getBusinessDayDate()) ? (_nh < 10 ? _nh + 24 : _nh) : -1;
    for (let h = 10; h < 34; h++) {
      const displayH = h % 24;
      const isNext = h >= 24;
      // 時刻は「1:00」形式（先頭の0は付けない）。マスの左端＝その時刻の位置なので左寄せ（店長要望 2026-08-10）
      html += `<div class="tl-head${h === nowH ? ' is-now' : ''}"><span class="tl-hour ${isNext?'next-day':''}">${displayH}:00</span></div>`;
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
      // 報酬は必ず rewardOf(予約) を通す。位置引数で直接 calcReward を呼ぶと
      // 指名料の報酬・オプション報酬を渡し忘れて金額がズレる（実際にズレた 2026-08-08）
      // 出勤状態の3ステート: available=出勤 / tentative=予定 / off=休み（タップで順に切替）
      const ATT_NEXT  = { available: 'done', done: 'off', off: 'tentative', tentative: 'available' };
      const ATT_LABEL = { available: '出勤', done: '終了', off: '休み', tentative: '予定' };
      const ATT_BG    = { available: 'var(--sea)', done: '#7a7a7a', off: '#c0392b', tentative: '#a0aab4' };
      usersWithUnassigned.forEach(u => {
        const roleLabel = u.role === 'owner' ? ''
                        : u.role === 'manager' ? '管理者'
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
        // 預り金＝現金決済のみ（カード/振込は現金を預からない）。報酬は全決済で発生。
        // 入金分（店取り分＝全額−報酬）は現金ぶん(要回収)とカードぶん(すでに店口座)に分けて出す（店長要望 2026-08-13）
        let heldSales = 0, heldReward = 0, heldShop = 0, cardFull = 0;
        // その日のお仕事が全部「報酬を渡し済み」「入金分を精算確定済み」なら印を出す（店長要望 2026-08-29）
        let allRewardPaid = dayJobs.length > 0;
        let allNetSettled = dayJobs.length > 0;
        dayJobs.forEach(b => {
          if (!b.reward_paid_at) allRewardPaid = false;
          if (!Number(b.shop_settled)) allNetSettled = false;
          const cashPart = cashTakenOf(b);   // 現金で受け取る額（カード=0／併用は現金ぶん）
          const cardPart = cardTakenOf(b);   // カードで切る額（併用の残り／カード=全額）
          // rewardOf を通す（指名料の報酬・オプション報酬が抜けないように）
          const rw = hasRate ? rewardOf(b) : 0;
          if (hasRate) heldReward += rw;
          heldSales += cashPart;
          // キャストへの報酬は現金からのみ支払う。カードぶんからは引かない（店長指定 2026-08-15）
          // → カード予約の報酬も現金から出るので、現金の入金分がそのぶん減る（マイナスもそのまま出す）
          heldShop  += cashPart - rw;   // 現金の店取り分（物理的に回収が必要）
          cardFull  += cardPart;        // カードで切った満額（お客様が払った額。報酬は引かない）
        });
        // 預り金・報酬・入金分の詳細（受け渡しの記録）は内勤スタッフ以上が扱う（店長指定 2026-08-14）
        // 制限は上のメニュー（タブ）だけ。タイムラインを見られる人は中の操作を全部できる（店長指定 2026-08-14）
        const canHolder = currentUser?.role !== 'staff';
        // 担当キャスト行のみ数値を表示（0でも ¥0 を表示）。ドライバー/内勤/未割当は非表示（is_therapist兼任者は表示）
        const showSales = u.id && u.role !== 'unassigned' && ((u.role !== 'driver' && u.role !== 'office') || isTherapistCapable(u));
        // 右BOX: 件数 / 預り金 / 報酬 / 入金（報酬・入金は歩合のある owner/manager のみ。入金=店受取、クリックで受け渡し状況）
        // 入金分の見せ方: 現金ぶん＋（あれば）💳カードぶん。全額カードなら 💳 のみ、両方なら並べる
        // カードは満額（お客様が切った額）で出す。報酬を引いた額ではない（店長指定 2026-08-14）
        // 現金ぶんはマイナスもある（カード予約の報酬を現金から払った日）。その場合は店が返す額
        const yenS = (n) => (n < 0 ? '−¥' + Math.abs(Number(n) || 0).toLocaleString() : yen(n));
        const cardTag = cardFull > 0 ? `<span class="tl-m-card">💳${yen(cardFull)}</span>` : '';
        const nyukinInner = cardFull > 0
          ? (heldShop !== 0 ? `${yenS(heldShop)} ${cardTag}` : cardTag)
          : yenS(heldShop);
        const okMark = '<span class="tl-m-ok" title="この日のぶんは終わっています">✅</span>';
        const netOk = allNetSettled ? okMark : '';
        const rwdOk = allRewardPaid ? okMark : '';
        const nyukinRow = !hasRate ? '' : (canHolder
          ? `<button type="button" class="tl-staff-sales tl-m${allNetSettled ? ' is-done' : ''}" data-admin="${u.id}" title="入金分（現金＝要回収／💳＝カードで切った満額・すでに店口座。報酬は現金からのみ支払い）"><span class="tl-m-l">${netOk}入金分</span><span class="tl-m-v">${nyukinInner} ▸</span></button>`
          : `<div class="tl-m${allNetSettled ? ' is-done' : ''}"><span class="tl-m-l">${netOk}入金分</span><span class="tl-m-v">${nyukinInner}</span></div>`);
        // 預り金: owner/manager はクリックで受け渡し履歴（担当→A→B→…→店）を表示・記録
        const heldRow = canHolder
          ? `<button type="button" class="tl-staff-held tl-m" data-admin="${u.id}" title="預り金の受け渡し履歴"><span class="tl-m-l">預り金</span><span class="tl-m-v">${yen(heldSales)} ▸</span></button>`
          : `<div class="tl-m"><span class="tl-m-l">預り金</span><span class="tl-m-v">${yen(heldSales)}</span></div>`;
        const metricsHtml = showSales
          ? `<div class="tl-m tl-m-count"><span class="tl-m-flags">${dayFlagBtn(u.id, bizDay, 'valuables', '貴重品')}${dayFlagBtn(u.id, bizDay, 'change_given', '釣銭')}</span><span class="tl-m-v">${dayCount}件</span></div>`
            + heldRow
            + (hasRate ? (canHolder
                ? `<button type="button" class="tl-staff-reward tl-m${allRewardPaid ? ' is-done' : ''}" data-admin="${u.id}" title="報酬のありか・渡した記録"><span class="tl-m-l">${rwdOk}報酬</span><span class="tl-m-v">${yen(heldReward)} ▸</span></button>`
                : `<div class="tl-m${allRewardPaid ? ' is-done' : ''}"><span class="tl-m-l">${rwdOk}報酬</span><span class="tl-m-v">${yen(heldReward)}</span></div>`) : '')
            + nyukinRow
          : '';
        // 役職ラベルは機能的な driver / 未割当 / 内勤 のみ表示（店長・オーナー・キャストは非表示）
        const roleMini = (u.role === 'driver' || u.role === 'unassigned' || u.role === 'office') ? `<span class="role-mini">${roleLabel}</span>` : '';
        // 出勤状態トグル（owner/manager が操作）。3ステート: 予定→出勤→休み→予定
        const myShift = (u.id && u.role !== 'unassigned') ? tlShifts.find(s => Number(s.admin_user_id) === Number(u.id) && String(s.shift_date).slice(0, 10) === bizDay) : null;
        const isOff = !!(myShift && myShift.status === 'off');
        const attStatus = myShift ? (myShift.status || 'available') : 'available';
        // select は iOS Safari で innerHTML に含めると TypeError になるため placeholder を使い後で挿入
        // 出勤の切替は内勤スタッフも操作できる（事務所として組むため・店長要望 2026-08-14）。
        // サーバー側(shifts.php set-attendance)も owner/manager/office を許可している
        const canAttend = currentUser?.role !== 'staff';   // 制限はメニューのみ（店長指定 2026-08-14）
        const attToggle = (canAttend && u.id && u.role !== 'unassigned')
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
        // 受/完＝終了時刻の意味（CTRLの出勤管理で選ぶ）。受付できる時間の判断に使う
        //   受 … その時刻までの注文に対応 / 完 … その時刻に完全終了して帰宅
        const endTypeLabel = (myShift && myShift.end_type === 'finish') ? '完' : '受';
        const endTypeTitle = endTypeLabel === '完'
          ? 'この時刻に完全終了して帰宅（この時刻までに終わる注文のみ）'
          : 'この時刻までの注文に対応';
        // 出勤時間と「今から遊べる時間」（即姫）の見せ方（店長要望 2026-08-20/21）:
        //   ・もう遊べる人  … 切り替えずに、出勤時間の「受」の隣に「今」を出しっぱなし
        //   ・これから遊べる人… 出勤時間 ⇄「0:00〜遊べる」を交互に
        //   ・即姫なし        … 出勤時間だけ
        // どちらの状態かは syncPlayNowMode() が今の時刻を見て切り替える（開きっぱなしでも変わる）
        const pn = tlPlayNow[String(u.id)];
        const nowMark = (pn && pn.at && !pn.closed)
          ? `<span class="tl-nowmark" data-play-edit="${u.id}" data-play-hm="${escapeAttr(pn.hm || '')}" title="クリックで遊べる時間を変える" hidden>今</span>`
          : '';
        // 受付終了にしている人は「受」の代わりに「終」を出す（並べるとはみ出すので置き換え・店長指定 2026-08-22）。
        // 押せば遊べる時間を入れ直せる（＝受付再開）
        const isClosedNow = !!(pn && pn.closed);
        const endMark = isClosedNow
          ? `<span class="tl-endmark" data-play-edit="${u.id}" data-play-hm="" title="受付終了（クリックで遊べる時間を入れ直せます）">終</span>`
          : '';
        const shiftInner = (myShift && myShift.start_time)
          ? `<span class="tl-m-l">時間</span><span class="tl-m-v">${hhmm(myShift.start_time)}<span class="tl-m-wave">〜</span>${myShift.end_time ? `${hhmm(myShift.end_time)}${isClosedNow ? endMark : `<span class="tl-endtype tl-endtype-${endTypeLabel === '完' ? 'finish' : 'accept'}" title="${endTypeTitle}">${endTypeLabel}</span>`}` : `<span class="tl-end-undecided">${myShift.end_open === 'last' ? 'ラスト' : '未定'}</span>${endMark}`}${nowMark}</span>`
          : '';
        // 受付終了は出さない（店長指定 2026-08-21）。遊べる時刻があるときだけ交互表示にする
        const playInner = (pn && pn.hm && !pn.closed)
          ? `<span class="tl-m-v tl-play-hm" data-play-edit="${u.id}" data-play-hm="${escapeAttr(pn.hm)}" title="クリックで遊べる時間を変える">${escapeHtml(pn.hm)}〜遊べる</span>`
          : '';
        // 出勤が終わった人には「今」も「〜遊べる」も出さない（店長指摘 2026-08-22）。
        // 終了が未定・ラストのときは終わりが分からないので、これまでどおり出す
        const shiftEndAt = (() => {
          if (!myShift || !myShift.start_time || !myShift.end_time) return '';
          // ★ hhmm() は先頭の0を落とす（0:00）ので日時として読めない。DBの値をそのまま2桁で使う
          const st = String(myShift.start_time).slice(0, 5);   // 例 17:00
          const en = String(myShift.end_time).slice(0, 5);     // 例 00:00
          if (!/^\d{2}:\d{2}$/.test(st) || !/^\d{2}:\d{2}$/.test(en)) return '';
          // 営業日は10:00〜翌10:00。開始が10時前なら暦は翌日、終了が開始以下ならさらに翌日
          const day = new Date(bizDay + 'T00:00:00');
          if (parseInt(st.slice(0, 2), 10) < 10) day.setDate(day.getDate() + 1);
          if (en <= st) day.setDate(day.getDate() + 1);
          return fmtDate(day) + ' ' + en;
        })();
        const tlShiftTime = !shiftInner ? ''
          : playInner
            ? `<div class="tl-m tl-m-time tl-m-alt" data-play-at="${escapeAttr(pn.at || '')}" data-shift-end="${escapeAttr(shiftEndAt)}" title="出勤時間と、今から遊べる時間（即姫）">`
              + `<span class="tl-alt-a">${shiftInner}</span><span class="tl-alt-b">${playInner}</span></div>`
            : `<div class="tl-m tl-m-time">${shiftInner}</div>`;
        html += `<div class="tl-staff${u.role==='unassigned'?' tl-staff-unassigned':''}" style="${isOff ? 'background:#eef1f3;color:var(--ink-soft);' : ''}"><div class="tl-staff-body"><div class="tl-staff-left">${tlThumb}<div class="tl-staff-name">${escapeHtml(u.display_name || u.username)}${(u.cast_notes || '').trim() ? `<span class="tl-staff-alert" data-cast-edit="${u.id}" title="${escapeAttr(u.cast_notes)}">⚠️</span>` : ''}</div>${attToggle}</div><div class="tl-staff-info">${tlShiftTime}${privateTag}${roleMini}${metricsHtml}</div></div></div>`;

        // この行の予約とシフト（営業日基準）
        // ドライバー行では driver_id=自分の予約、未割当行では assigned_admin_id=null/0 の予約
        const rowBookings = tlBookings.filter(b => {
          if (bizDateOf(b.booking_date, b.start_time) !== bizDay) return false;
          if (b.status === 'cancelled') return false;   // キャンセルはタイムラインに出さない（店長指定 2026-08-16）
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
            let se = s.end_time ? timeToOffset(extT(s.end_time)) + 10 : 34;   // 終了未定は当日いっぱい
            if (s.end_time && se <= ss) se = ss + 24;  // 24h (start===end) or 翌日跨ぎ
            if (slotStart >= ss && slotStart < se) inShift = true;
          });
          const slotTime = ('0' + (h % 24)).slice(-2) + ':00';
          html += `<div class="tl-cell ${inShift?'shift-bg':''}" title="ダブルクリックで新規予約" data-date="${bizDay}" data-admin="${u.id}" data-hour="${h % 24}" data-ext-hour="${h}"></div>`;
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
              // カードの右端＝終了時刻ちょうど（+10分の余地は隣の予約と重なるため廃止・店長指摘 2026-08-14）。
              // 左端＝開始時刻ちょうど（leftCalc が startOff）なので、2:08終了と2:10開始は重ならない
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
              // 4段目: 場所（自宅=ご自宅＋番地まで / ホテル=ホテル名（部屋番号は右寄せ） / その他=詳細）
              let venue = '';
              const isHomeRow = hotelFull.startsWith(HOME_PREFIX);
              const isOtherRow = hotelFull.startsWith(OTHER_PREFIX);
              if (isHomeRow) {
                // 自宅は市区町村から番地まで通しで出す（建物は省く）。
                // 「新町5-8-3」だけだとどこの町か読み取れないため、市も残す（店長指摘 2026-08-16）
                const addrFull = dedupeRepeatedSuffix(hotelFull.slice(HOME_PREFIX.length).trim());
                const addrNoBld = splitAddressBuilding(addrFull)[0] || addrFull;
                venue = addrNoBld ? '🏠' + addrNoBld : '🏠ご自宅';   // 自宅は家アイコン（間は詰める・店長要望 2026-08-16）
              } else if (isOtherRow) venue = hotelFull.slice(OTHER_PREFIX.length);
              // ホテルは種別でアイコンを分ける（ラブホ=💗 / ビジネス・シティ等=🏨・店長要望 2026-08-16）。
              // hotel_type はマスタの値（love_hotel / city / business / ryokan / minshuku / other）
              else venue = (String(b.hotel_type || '') === 'love_hotel' ? '💗' : '🏨') + hotelFull;
              // ホテルは部屋番号を欄の右端に、専用のセルとしてクリックで登録できるようにする
              // （見落とし防止・店長要望 2026-08-14／セル分離・クリック登録は 2026-08-16）
              const isHotelRow = !isHomeRow && !isOtherRow;
              const roomNo = (isHotelRow && b.room_number) ? String(b.room_number).trim() : '';
              const venueHtml = isHotelRow
                ? `<span class="bk-venue-name">${escapeHtml(venue)}</span>` +
                  `<span class="bk-venue-room${roomNo ? '' : ' is-empty'}" data-bk-room="${b.id}" title="クリックで部屋番号を登録">${roomNo ? escapeHtml(roomNo) : '部屋番'}</span>`
                : escapeHtml(venue);
              // 5段目: ドライバー名（記号なし、左=行き / 右=帰り）。未定は自走。
              const goMailed = !!b.pickup_go_mailed_at;
              const backMailed = !!b.pickup_back_mailed_at;
              // ドライバー未設定の表示。予約を入れた時点ではまだ送迎を決めていないので「-」のまま。
              // 送迎ポップアップで「キャスト（自走）」を選んだときだけ go_self/back_self が立ち
              // 「キャスト」に変わる（店長要望 2026-08-10）。接客の進み具合では自動で変えない
              const noDrv = (self) => self
                ? '<span class="bk-self">キャスト</span>'
                : '<span class="bk-self bk-drv-undecided">-</span>';
              const goCell = (goMailed ? '✓' : '') + (goDrv || noDrv(Number(b.go_self) === 1));
              const backCell = (backMailed ? '✓' : '') + (backDrv || noDrv(Number(b.back_self) === 1));
              // お預り金を持っている人に色が登録してあれば、帰りボタンをその色にする（誰が現金を持っているか一目で・店長要望 2026-08-14）。
              // 受け渡し前（held_by 未設定）は既定の保有者＝帰りのお迎え担当。色はスタッフ管理で登録した人だけが持つ
              const holderColor = holderColorOf(b);
              const backStyle = holderColor ? ` style="background:${escapeAttr(holderColor)};color:#fff;"` : '';
              const holderColored = !!holderColor;
              const svcTitle = svc === 'pending' ? '開始（接客開始＝経理に計上）' : svc === 'started' ? '終了（接客終了）' : 'クリックで未開始に戻す（巻き戻し）';
              // カード決済の予約は、両サイドのラインの色で決済前(橙)／決済後(緑)を示す
              const usesCard = !isBreakRow && ['credit', 'card', 'split'].includes(String(b.payment_method || ''));
              const cardWarn = usesCard && !b.card_paid_at;
              // カード決済は黒縁で囲む（お預かりが現金でないと一目で分かるように・店長要望 2026-08-14）
              const payCls = usesCard ? (cardWarn ? ' pay-card pay-unconfirmed' : ' pay-card pay-confirmed') : '';
              html += `<div class="tl-booking s-${b.status}${svc === 'ended' ? ' svc-ended' : ''}${payCls}" data-booking-id="${b.id}" style="left:${leftCalc};width:${widthCalc};top:2px;bottom:2px;">
                <div class="bk-top" data-bk-time="${b.id}">
                  <span class="bk-st">${stDisp}</span><span class="bk-dash">〜</span><span class="bk-et">${etDisp}</span>
                </div>
                <div class="bk-mid">
                  <span class="bk-name" data-bk-edit="${b.id}">${escapeHtml(name)}</span>
                  ${usesCard ? (cardWarn
                    ? `<span class="bk-paywarn" data-bk-card="${b.id}" title="カード決済の確認がまだです（クリックで確認）">💳未</span>`
                    : `<span class="bk-paywarn is-paid" data-bk-card="${b.id}" title="カード決済の確認ずみ（クリックで戻せます）">💳✓</span>`) : ''}
                  ${Number(b.receipt_needed) === 1
                    ? `<span class="bk-receipt${b.receipt_given_at ? ' is-given' : ''}" data-bk-receipt="${b.id}" title="${b.receipt_given_at ? '領収証はお渡しずみ（クリックで戻せます）' : '領収証が必要です（クリックで「渡した」に）'}">🧾${b.receipt_given_at ? '✓' : ''}</span>`
                    : ''}
                  ${prepBadgeHtml(b)}
                  ${lendBadgeHtml(b)}
                  ${canMeet ? `<span class="bk-svc-ph" data-svc-ph="${b.id}" data-svc-state="${svc}"></span>` : ''}
                </div>
                ${isBreakRow ? '' : `<div class="bk-place" data-bk-addr="${b.id}" title="クリックで住所をコピー">${escapeHtml(placeShort)}</div><div class="bk-venue${isHotelRow ? ' has-room' : ''}" data-bk-addr="${b.id}" title="クリックでホテル名・住所をコピー">${venueHtml}</div>`}
                ${!isBreakRow
                  ? `<div class="bk-bottom">
                       <button class="bk-go${goMailed ? ' mailed' : ''}" data-bk-go="${b.id}" title="行き: ドライバー指定・送迎情報をコピー">${goCell}</button>
                       <button class="bk-back${backMailed ? ' mailed' : ''}" data-bk-back="${b.id}"${backStyle} title="帰り: ドライバー指定・送迎情報をコピー${holderColored ? '（お預り金保有中）' : ''}">${backCell}</button>
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
    // 入れ替えた直後、画面に出る前に位置を戻す。あとから（次のフレームで）戻すと
    // 一瞬だけ先頭が描かれてカクついて見える（店長指摘 2026-08-30）
    if (_tlPrevScroll != null) {
      const sc0 = document.querySelector('.tl-wrap');
      if (sc0) { sc0.scrollLeft = _tlPrevScroll.left; sc0.scrollTop = _tlPrevScroll.top; }
    }

    // 出勤時間 ⇄ 今から遊べる時間 の切り替えを動かす（描き直した直後は出勤時間から）
    ensureTimeAltTimer();
    if (_tlAltOn) grid.querySelectorAll('.tl-m-alt').forEach(el => el.classList.add('show-b'));
    syncPlayNowMode();
    // 日付バーの行数は中身で変わる（スマホは折り返す）ので、描画のたびに枠の高さを取り直す
    syncTimelineHeight();

    // 立川秘密基地の出勤を「キャスト未割当」の下に後から足す（別システムなので非同期）
    renderHimitsuRows(bizDay).catch(() => {});

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
            await apiPost('/bookings.php?action=set-service', { id: Number(id), state: next, expected_updated_at: (_tlBookingMap[id]?.updated_at || '') });
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
      holdTimelineScroll(_tlPrevScroll);
    } else if (bizDay === todayBiz) {
      requestAnimationFrame(scrollTimelineToNow);
    }
    _tlPrevScroll = null;
    requestAnimationFrame(updateNowLine);   // 現在時刻ライン（赤い縦線）を今の位置に

    // （売上クリックは init() の document 委譲で処理）

    // クリックハンドラ（段ごとに動作を分ける）
    // 中段 お客様名 → 編集
    grid.querySelectorAll('[data-bk-edit]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        openBookingModal(Number(el.dataset.bkEdit));
      });
    });
    // 3〜4段目 地名・場所 → 住所をコピー（ナビや案内にそのまま貼れるように）。
    // 部屋番号セルは専用の登録UIを持つので、そちらのクリックでは住所コピーを起こさない（店長要望 2026-08-16）
    grid.querySelectorAll('[data-bk-addr]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('[data-bk-room]')) return;
        e.stopPropagation();
        const addr = bookingAddressText(Number(el.dataset.bkAddr));
        if (!addr) { toast('住所が登録されていません', 'err'); return; }
        copyTextToClipboard(addr).then(ok => toast(ok ? '📋 ' + addr : 'コピーに失敗しました', ok ? 'ok' : 'err'));
      });
    });
    // 「〇:〇〇〜遊べる」「今」→ その場で遊べる時間を決めるポップ（店長要望 2026-08-22）
    grid.querySelectorAll('[data-play-edit]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        openPlayEdit(Number(el.dataset.playEdit), bizDay, el.dataset.playHm || '', el);
      });
    });
    // 💳未 バッジ → その場で「決済を確認した」を付けるポップ（店長要望 2026-08-22）
    grid.querySelectorAll('[data-bk-card]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        openCardPaid(Number(el.dataset.bkCard), el);
      });
    });
    // お約束チップ（💬未 など）→ クリックで「予約」に変えるポップ（店長要望 2026-08-20）
    grid.querySelectorAll('[data-bk-flag]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        openPrepFlag(Number(el.dataset.bkFlag), el);
      });
    });
    // 🧾 領収証バッジ → 渡した/まだ を切り替える（店長要望 2026-08-23）
    grid.querySelectorAll('[data-bk-receipt]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        openReceiptGiven(Number(el.dataset.bkReceipt), el);
      });
    });
    // 部屋番号セル → クリックでその場で登録・修正（店長要望 2026-08-16）
    grid.querySelectorAll('[data-bk-room]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        openRoomEdit(Number(el.dataset.bkRoom), el);
      });
    });
    // 件数行の「貴重品」「釣銭」→ 誰が預かった/返したを記録（店長要望 2026-08-16）
    grid.querySelectorAll('[data-day-flag]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        openDayFlagEdit(Number(el.dataset.admin), el.dataset.date, el.dataset.dayFlag, el);
      });
    });
    // 貸出品バッジ → クリックで「誰が回収したか」を選んで記録（店長要望 2026-08-26）
    grid.querySelectorAll('[data-bk-lend]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        openLendReturn(Number(el.dataset.bkLend), el);
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
    // 空きマスは【ダブルクリック】で新規予約。1クリックだと横スクロールや誤タップで
    // 予約モーダルが開いてしまい邪魔だった（店長指摘 2026-08-09）
    grid.querySelectorAll('.tl-cell').forEach(c => {
      c.addEventListener('dblclick', () => {
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
    // 旧システムから取り込んだ利用履歴も混ぜる（休憩フィルタのときは対象外）
    if (st !== 'break') params.set('include_legacy', '1');
    try {
      const data = await api('/bookings.php?action=list&' + params.toString());
      let list = data.bookings || [];
      legacyVisitsList = st === 'break' ? [] : (data.legacy_visits || []);
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
  // ── 旧システムの履歴と OPS 予約の重なり判定 ──
  // 旧＝予定の時刻 / OPS＝実際に受けた時刻 で数分ずれることがある。
  // ただし幅を持たせると別のお仕事まで消えるので、ぴったり一致のときだけ隠す
  //（店長判断 2026-08-11: ズレている分は旧側の状態を直して運用する）。
  const SAME_JOB_MIN = 0;
  /** 営業日内の分。10時前は翌日ぶんとして +24h（0:35 が 23:00 より後になる） */
  function bizMinOf(hm) {
    const p = String(hm || '00:00').split(':');
    const h = parseInt(p[0], 10) || 0, m = parseInt(p[1], 10) || 0;
    return (h < BIZ_DAY_START_HOUR ? h + 24 : h) * 60 + m;
  }
  /** OPS予約から「お客様・営業日・開始分」の一覧を作る（withCustomer=false なら顧客は見ない） */
  function bookedSlotsOf(bookings, withCustomer) {
    return (bookings || []).map(b => {
      const hm = String(b.start_time || '00:00').substring(0, 5);
      return {
        cid: withCustomer ? (Number(b.customer_id) || 0) : 0,
        day: bizDateOf(b.booking_date, b.start_time || '00:00'),
        min: bizMinOf(hm),
      };
    });
  }
  /** その旧履歴が OPS 予約と同じお仕事か（＝一覧では隠す） */
  function legacyIsDup(v, slots, withCustomer) {
    const at = String(v.visit_at || '');
    if (at.length < 16) return false;
    const cid = Number(v.customer_id) || 0;
    if (withCustomer && !cid) return false;
    const hm = at.substring(11, 16);
    const day = bizDateOf(at.substring(0, 10), hm);
    const min = bizMinOf(hm);
    return slots.some(sl => (!withCustomer || sl.cid === cid) && sl.day === day
      && Math.abs(sl.min - min) <= SAME_JOB_MIN);
  }

  function renderBookingsList() {
    const el = document.getElementById('bookingList');
    // 旧システムの履歴のうち、同じ予約を OPS にも入れたものは二重に出さない。
    // お客様・営業日が同じで、開始時刻が30分以内なら同じお仕事とみなす（別のお仕事は消さない）
    const bookedSlots = bookedSlotsOf(bookingsList, true);
    const legacyRows = (legacyVisitsList || []).filter(v => !legacyIsDup(v, bookedSlots, true));
    // OPSの予約と旧システムの利用履歴を、日時の新しい順に1本の並びにする
    const merged = [
      ...bookingsList.map(b => ({
        k: 'b', v: b,
        at: bizDateOf(b.booking_date, b.start_time || '00:00') + ' ' + String(b.start_time || '00:00').substring(0, 5),
      })),
      ...legacyRows.map(v => ({
        k: 'l', v,
        at: String(v.visit_at || '').substring(0, 10) + ' ' + String(v.visit_at || '').substring(11, 16),
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    if (merged.length === 0) {
      el.innerHTML = '<div class="view-empty"><div class="ve-icon">📋</div>予約はまだありません</div>';
      return;
    }
    // 列の並び（店長指定 2026-08-05）: 日付 / 時間 / お客様 / 電話 / キャスト / 分 / 場所 / 金額
    _legacyRowMap = {};
    el.innerHTML = `<div class="bkt-wrap"><div class="bkt">
      <div class="bkt-head">
        <span>日付</span><span>時間</span><span>お客様</span><span>電話</span><span>キャスト</span>
        <span class="c">分</span><span>場所</span><span class="r">金額</span><span>状態</span><span></span>
      </div>
      ${merged.map(row => row.k === 'l' ? renderLegacyRow(row.v) : renderBookingRow(row.v)).join('')}
    </div></div>`;
    wireBookingsList(el);
  }

  /** 「120分」「イベント120分」→ [分, 呼び名]。分が書かれていなければ分は空 */
  function splitCourseLabel(name) {
    const s = String(name || '').trim();
    const m = s.match(/(\d+)\s*分/);
    const tag = s.replace(/(\d+)\s*分/, '').replace(/[（(]\s*[)）]/g, '').replace(/\s+/g, ' ').trim();
    return [m ? m[1] : '', tag];
  }
  /** 開始〜終了の分数（24時超え表記 25:00 などにも対応） */
  function minutesBetween(st, et) {
    const p = (v) => { const a = String(v || '').split(':'); return (parseInt(a[0], 10) || 0) * 60 + (parseInt(a[1], 10) || 0); };
    const s = p(st), e = p(et);
    if (!st || !et) return 0;
    return e >= s ? e - s : e + 1440 - s;
  }
  /** 分セル。コース名に分が無ければ開始〜終了から出す。呼び名（イベント等）は小さく添える */
  function bktMinCell(courseName, st, et) {
    let [min, tag] = splitCourseLabel(courseName);
    if (!min && (st || et)) { const d = minutesBetween(st, et); if (d > 0) min = String(d); }
    if (!min && !tag) return '';
    return (min ? `<b>${escapeHtml(min)}</b><small>分</small>` : '')
         + (tag ? `<span class="bkt-tag">${escapeHtml(tag)}</span>` : '');
  }
  /** 電話番号・部屋番号は必ず半角で出す（旧システムのデータや全角入力が混ざっている） */
  function toHalfWidth(s) {
    return String(s || '')
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[－‐‑–—ー―]/g, '-')
      .trim();
  }
  /** 日付セル「8/2(土)」 */
  function bktDateCell(ymd) {
    const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return escapeHtml(String(ymd || ''));
    const dow = ['日','月','火','水','木','金','土'][new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`).getDay()] || '';
    return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}<small>(${dow})</small>`;
  }

  /** 旧システムの利用履歴の行（読み取り専用・「旧」バッジ付き） */
  function renderLegacyRow(v) {
    const at = String(v.visit_at || '');
    const st = HIST_STATUS[v.status] || [v.status || '', ''];
    const name = v.customer_name || '匿名';
    const place = legacyPlaceLabel(v, { compact: true });
    const price = (parseInt(v.total_price, 10) || 0) + (parseInt(v.transport_fee, 10) || 0);
    _legacyRowMap[v.id] = v;
    return `<div class="bkt-row is-legacy" data-legacy-id="${v.id}">
      <div class="bkt-date">${bktDateCell(at.substring(0, 10))}</div>
      <div class="bkt-time">${escapeHtml(at.substring(11, 16))}</div>
      <div class="bkt-cust">${escapeHtml(name)} <span class="ht-old">旧</span></div>
      <div class="bkt-tel">${escapeHtml(toHalfWidth(v.customer_phone || ''))}</div>
      <div class="bkt-cast">${escapeHtml(v.cast_name || '')}</div>
      <div class="bkt-min">${bktMinCell(v.course_name, '', '')}</div>
      <div class="bkt-place">${escapeHtml(place)}</div>
      <div class="bkt-price">${price ? '¥' + price.toLocaleString() : ''}</div>
      <div class="bkt-st"><span class="bk-status s-${escapeHtml(v.status || 'other')}">${escapeHtml(st[0])}</span></div>
      <div class="bkt-act"><button class="btn-edit" data-view-legacy="${v.id}">内容</button></div>
    </div>`;
  }

  // 旧履歴の詳細モーダル用（一覧を描くたびに詰め直す）
  let _legacyRowMap = {};

  /** 旧システムの利用履歴を、予約編集ページと同じ見た目で読み取り専用に開く */
  function openLegacyDetail(id) {
    const v = _legacyRowMap[id];
    if (!v) return;
    const at = String(v.visit_at || '');
    const st = HIST_STATUS[v.status] || [v.status || '', ''];
    const price = parseInt(v.total_price, 10) || 0;
    const trans = parseInt(v.transport_fee, 10) || 0;
    const row = (label, val, cls) => val
      ? `<div class="od-row"><div class="od-label">${label}</div><div class="od-value${cls ? ' ' + cls : ''}">${val}</div></div>`
      : '';
    const hr = '<hr style="border:0;border-top:1px solid var(--gray);margin:.7rem 0;">';
    document.getElementById('lgSub').textContent =
      `${at.substring(0, 10).replace(/-/g, '/')} ${at.substring(11, 16)}`;
    document.getElementById('lgBody').innerHTML = [
      row('日時', `${bktDateCell(at.substring(0, 10))} ${escapeHtml(at.substring(11, 16))}`),
      row('ステータス', `<span class="bk-status s-${escapeHtml(v.status || 'other')}">${escapeHtml(st[0])}</span>`),
      hr,
      row('お客様', escapeHtml(v.customer_name || '匿名')),
      row('電話', escapeHtml(toHalfWidth(v.customer_phone || ''))),
      hr,
      row('キャスト', escapeHtml(v.cast_name || '')),
      row('指名', escapeHtml(v.nominate_name || '')),
      row('コース', escapeHtml(v.course_name || '')),
      row('料金', price ? '¥' + price.toLocaleString() : ''),
      row('交通費', trans ? '¥' + trans.toLocaleString() : ''),
      row('合計', price + trans ? `<b>¥${(price + trans).toLocaleString()}</b>` : ''),
      hr,
      row('訪問先', escapeHtml(legacyPlaceLabel(v, { compact: true }))),   // 部屋番号は次の行で別に出す
      row('部屋番号', escapeHtml(v.room || '')),
      row('店舗', escapeHtml(v.shop_name || '')),
      (v.memo || '').trim() ? hr + row('メモ', escapeHtml(v.memo.trim()), 'lg-memo') : '',
    ].join('');
    openModal('legacyDetailModal');
  }

  function renderBookingRow(b) {
    const name = b.customer_name || b.customer_name_snapshot || '匿名';
    const hotel = b.hotel_name || b.hotel_name_snapshot || '';
    const city = (b.display_city || b.hotel_city || '').trim();
    // 場所: 自宅/その他は接頭辞を落として素の文言に。ホテルは「市区町村 ホテル名 #部屋」
    let place = '';
    if (hotel.startsWith(HOME_PREFIX)) place = '🏠 ' + hotel.slice(HOME_PREFIX.length);
    else if (hotel.startsWith(OTHER_PREFIX)) place = '📍 ' + hotel.slice(OTHER_PREFIX.length);
    else if (hotel) place = '🏨 ' + [city, hotel].filter(Boolean).join(' ') + (b.room_number ? ' #' + b.room_number : '');
    const svc = svcState(b);                       // 始(接客中)/確(接客完了) 出し分け用
    return `<div class="bkt-row" data-booking-id="${b.id}">
      <div class="bkt-date">${bktDateCell(bizDateOf(b.booking_date, b.start_time || '00:00'))}</div>
      <div class="bkt-time">${String(b.start_time || '').substring(0,5)}<small>-${String(b.end_time || '').substring(0,5)}</small></div>
      <div class="bkt-cust">${escapeHtml(name)}</div>
      <div class="bkt-tel">${escapeHtml(toHalfWidth(b.customer_phone || b.customer_phone_snapshot || ''))}</div>
      <div class="bkt-cast">${escapeHtml(b.staff_name || '')}</div>
      <div class="bkt-min">${bktMinCell(b.course_name, b.start_time, b.end_time)}</div>
      <div class="bkt-place">${escapeHtml(place)}</div>
      <div class="bkt-price">${b.price ? '¥' + Number(b.price).toLocaleString() : ''}</div>
      <div class="bkt-st"><span class="bk-status s-${b.status}${svc === 'ended' ? ' svc-ended' : ''}">${bookingStatusLabel(b)}</span></div>
      <div class="bkt-act"><button class="btn-edit" data-edit-booking="${b.id}">編集</button></div>
    </div>`;
  }

  function wireBookingsList(el) {
    el.querySelectorAll('[data-edit-booking]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openBookingModal(Number(btn.dataset.editBooking)); });
    });
    el.querySelectorAll('.bkt-row[data-booking-id]').forEach(row => {
      row.addEventListener('click', () => openBookingModal(Number(row.dataset.bookingId)));
    });
    // 旧履歴は編集できないので、同じ見た目の読み取り専用モーダルで中身だけ見せる
    el.querySelectorAll('[data-view-legacy]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openLegacyDetail(btn.dataset.viewLegacy); });
    });
    el.querySelectorAll('.bkt-row[data-legacy-id]').forEach(row => {
      row.addEventListener('click', () => openLegacyDetail(row.dataset.legacyId));
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
  function customerNoteHead(btnLabel) {
    // 「✏️編集」の下に「🚫NG」（選んでいるキャストをこのお客様のNGにする・店長指定 2026-08-22）。
    // モーダル②でも重ならないよう、id には今のモーダルの印を付ける
    const ngBtn = `<button type="button" id="bmNgCastBtn${activeBmSuffix}" class="bm-ngcast-btn"
        title="選んでいるキャストをこのお客様のNGにする" style="display:none;">🚫 NG</button>`;
    return '<div class="bhn-head"><span class="bhn-title">👤 お客様メモ'
      + '<span class="bhn-sub">キャストには伝えない</span></span>'
      + '<span class="bhn-actions">'
      + (btnLabel ? `<button type="button" class="bhn-btn" data-note-edit>${btnLabel}</button>` : '')
      + ngBtn
      + '</span>'
      + '</div>';
  }
  // 追加した1件は「【2026/8/22 まどか】本文」の形で保存してある（店長指定 2026-08-22）。
  // 表示では日付＋キャスト名を小見出しに起こし、本文と分けて読ませる。
  // 印の無い行は追加方式より前に書かれた記録なので、本文だけを出す
  const NOTE_STAMP_RE = /^【\s*(\d{4}\/\d{1,2}\/\d{1,2})(?:[ \u3000]+([^】]*))?】[ \u3000]*/;
  // 「＋ 追加」より前に書かれたメモは、日付も書いた人も残っていない（旧システムの取込分も、
  // OPSのメモ欄に直接書いた分も同じ）。メモは接客の直後に書かれるので、
  // 「済んだご利用のうち一番新しいもの」の日付＋担当キャストを推定の見出しに充てる。
  // いま開いている予約も、済んでいるなら候補に入れる（そこで分かった話を書いていることが多い・
  // 店長指摘 2026-08-23: 3/26ゆあ ではなく 8/22まどか が正しい）。
  // これからの予約（未来日・問合せ・キャンセル・無連絡）は書きようがないので候補にしない
  const NOTE_STAMP_SKIP = ['cancelled', 'no_show', 'inquiry'];
  function presumedNoteStamp(bookings, legacyVisits) {
    const today = fmtDate(getBusinessDayDate());
    const cand = [];
    (bookings || []).filter(b => !NOTE_STAMP_SKIP.includes(String(b.status))).forEach(b => {
      const day = bizDateOf(b.booking_date, b.start_time || '00:00');
      if (day && day <= today) cand.push({ key: `${day} ${b.start_time || '00:00'}`, day, cast: String(b.staff_name || '').trim() });
    });
    (legacyVisits || []).filter(v => !NOTE_STAMP_SKIP.includes(String(v.status))).forEach(v => {
      const day = String(v.visit_at || '').slice(0, 10);
      if (day && day <= today) cand.push({ key: String(v.visit_at), day, cast: String(v.cast_name || '').trim() });
    });
    if (!cand.length) return null;
    cand.sort((x, y) => (x.key < y.key ? 1 : x.key > y.key ? -1 : 0));
    const m = cand[0].day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return { date: `${m[1]}/${Number(m[2])}/${Number(m[3])}`, cast: cand[0].cast };
  }
  /** いま開いている予約の「日付＋キャスト」＝これから付ける印 */
  function currentNoteStamp() {
    const dv = (bel('bmDate')?.value || '').trim();
    const dm = dv.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const d = new Date();
    const date = dm ? `${dm[1]}/${Number(dm[2])}/${Number(dm[3])}`
                    : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    const castId = Number(bel('bmAdminId')?.value || 0);
    const cast = castId ? (findStaffUser(castId)?.display_name || '') : '';
    return { date, cast };
  }
  /** メモ本文を1件ずつに割る。印の無い記録には推定の見出し(fallback)を当てる */
  function parseNoteEntries(main, fallback) {
    const entries = [];
    String(main || '').split('\n').forEach(line => {
      const m = line.match(NOTE_STAMP_RE);
      if (m) entries.push({ date: m[1], cast: (m[2] || '').trim(), body: line.slice(m[0].length), stamped: true });
      else if (entries.length) entries[entries.length - 1].body += '\n' + line;
      else entries.push({ date: '', cast: '', body: line, stamped: false });
    });
    return entries.filter(e => e.date || String(e.body).trim()).map(e => {
      const st = e.stamped ? e : (fallback || { date: '', cast: '' });
      return Object.assign({}, e, { showDate: st.date, showCast: st.cast, guess: !e.stamped && !!st.date });
    });
  }
  /** その予約で登録された記録＝いま開いている予約と印が同じもの（あれば編集、無ければ追加） */
  function noteEntryIndexFor(entries, stamp) {
    if (!stamp || !stamp.date) return -1;
    return entries.findIndex(e => e.showDate === stamp.date && (e.showCast || '') === (stamp.cast || ''));
  }
  /** NG登録を「登録した予約の印（日付＋キャスト）」に直す。深夜0〜10時は前営業日扱い */
  function ngNoteStamps(ngCasts) {
    return (ngCasts || []).map(n => {
      const m = String(n.created_at || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
      if (!m) return null;
      const day = bizDateOf(`${m[1]}-${m[2]}-${m[3]}`, `${m[4]}:${m[5]}`);
      const dm = String(day).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!dm) return null;
      return { date: `${dm[1]}/${Number(dm[2])}/${Number(dm[3])}`, cast: String(n.display_name || '').trim() };
    }).filter(Boolean);
  }
  /** 表示用に「NGにした」印を混ぜる。メモが無いNGはその1行だけ出す（店長要望 2026-08-23） */
  function mergeNgIntoEntries(entries, ngCasts) {
    const out = entries.map((e, i) => Object.assign({}, e, { realIdx: i }));
    ngNoteStamps(ngCasts).forEach(st => {
      const hit = out.find(e => e.showDate === st.date && (e.showCast || '') === st.cast);
      if (hit) hit.ng = true;
      else out.unshift({ showDate: st.date, showCast: st.cast, body: '', ng: true, realIdx: -1 });
    });
    return out;
  }
  function renderNoteEntries(entries, hideIdx) {
    return entries.map(e => ((e.realIdx !== undefined ? e.realIdx : -2) === hideIdx ? '' : '<div class="bhn-entry">'
      + (e.showDate
        ? `<div class="bhn-stamp${e.guess ? ' old' : ''}"`
          + (e.guess ? ' title="日付が残っていない記録です。直近のご利用の日付と担当キャストを当てて表示しています"' : '')
          + `>${escapeHtml(e.showDate)}${e.showCast ? ' ' + escapeHtml(e.showCast) : ''}`
          + (e.ng ? `<span class="bhn-ng">🚫 ${escapeHtml(e.showCast || '')}をNGに登録</span>` : '')
          + '</div>'
        : '<div class="bhn-stamp old">以前の記録（日付なし）</div>')
      + (String(e.body).trim() ? `<div class="bhn-body">${escapeHtml(String(e.body).trim())}</div>` : '')
      + '</div>')).join('');
  }
  /** 保存する本文を組み立て直す。触っていない記録は元の形のまま残す */
  function buildNoteMain(entries, idx, body, stamp) {
    return entries.map((e, i) => {
      if (i === idx) return `【${stamp.date}${stamp.cast ? ' ' + stamp.cast : ''}】${body}`;
      return e.stamped ? `【${e.date}${e.cast ? ' ' + e.cast : ''}】${e.body}` : e.body;
    }).join('\n');
  }
  function renderCustomerNote(notes, fallback, ngCasts) {
    const { main, meta } = splitCustomerNote(notes);
    const entries = parseNoteEntries(main, fallback);
    const shown = mergeNgIntoEntries(entries, ngCasts);
    // いま開いている予約で登録した記録があるなら「編集」、無ければ「追加」（店長指定 2026-08-23）
    const isEdit = noteEntryIndexFor(entries, currentNoteStamp()) >= 0;
    return '<div class="bm-history-note">'
      + customerNoteHead(isEdit ? '✏️ 編集' : '＋ 追加')
      + (shown.length ? `<div class="bhn-main">${renderNoteEntries(shown, -2)}</div>` : '')
      + (meta ? `<div class="bhn-meta">${escapeHtml(meta)}</div>` : '')
      + '</div>';
  }
  /** 予約モーダルの履歴パネル内で、お客様メモを編集・追加できるようにする */
  function wireCustomerNoteEdit(panelEl, customerId, getNotes, setNotes, fallback, ngCasts) {
    const rerender = () => {
      const host = panelEl.querySelector('.bm-history-note');
      if (!host) return;
      host.outerHTML = renderCustomerNote(getNotes(), fallback, ngCasts);
      wireCustomerNoteEdit(panelEl, customerId, getNotes, setNotes, fallback, ngCasts);
      renderNgAlert();
    };
    // 担当キャスト・日付を変えると「その予約で書いた記録か」が変わる（＝編集/追加が入れ替わる）
    panelEl._noteRerender = rerender;
    panelEl._noteNg = ngCasts;   // NGボタンを押した直後にメモ側の印も出し入れするため
    const editBtn = panelEl.querySelector('[data-note-edit]');
    if (!editBtn) return;
    // その予約で書いた記録は「編集」（書き直し）、それ以外の予約からは「追加」（書き足し）。
    // 1件ごとに「登録した予約の日付」と「そのときのキャスト名」が頭に付く
    editBtn.addEventListener('click', () => {
      const host = panelEl.querySelector('.bm-history-note');
      const { main, meta } = splitCustomerNote(getNotes());
      const entries = parseNoteEntries(main, fallback);
      const stamp = currentNoteStamp();
      const idx = noteEntryIndexFor(entries, stamp);
      const editing = idx >= 0;
      host.innerHTML = customerNoteHead('')
        + `<div class="bhn-stamp">${escapeHtml(stamp.date)}${stamp.cast ? ' ' + escapeHtml(stamp.cast) : ''}</div>`
        + '<textarea class="bhn-ta" rows="3" placeholder="キャストには伝えない、このお客様の情報"></textarea>'
        + '<div class="bhn-actions"><button type="button" class="bhn-btn" data-note-cancel>キャンセル</button>'
        + `<button type="button" class="bhn-btn primary" data-note-save>${editing ? '保存する' : '追加する'}</button></div>`
        + (entries.length ? `<div class="bhn-main">${renderNoteEntries(mergeNgIntoEntries(entries, ngCasts), idx)}</div>` : '')
        + (meta ? `<div class="bhn-meta">${escapeHtml(meta)}</div>` : '');
      const ta = host.querySelector('.bhn-ta');
      if (editing) ta.value = String(entries[idx].body).trim();
      ta.focus();
      host.querySelector('[data-note-cancel]').addEventListener('click', rerender);
      host.querySelector('[data-note-save]').addEventListener('click', async () => {
        const body = ta.value.trim();
        if (!body && !editing) { rerender(); return; }
        let nextMain;
        if (editing) {
          // 空にしたらその1件だけ消す
          nextMain = body
            ? buildNoteMain(entries, idx, body, stamp)
            : buildNoteMain(entries.filter((_, i) => i !== idx), -1, '', stamp);
        } else {
          // 新しい記録が上。触っていない記録は元の形のまま
          nextMain = [`【${stamp.date}${stamp.cast ? ' ' + stamp.cast : ''}】${body}`,
                      buildNoteMain(entries, -1, '', stamp)].filter(Boolean).join('\n');
        }
        // 移行情報（旧IDなど）は末尾のまま動かさない
        const next = [nextMain, meta].filter(Boolean).join('\n');
        try {
          await apiPost('/customers.php?action=update', { id: customerId, notes: next });
          setNotes(next);
          toast(editing ? '✓ お客様メモを保存しました' : '✓ お客様メモに追加しました', 'ok');
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

  /**
   * 予約(b)・旧履歴(v) を時系列（新しい順）に混ぜる。
   * 同じ予約を OPS にも入れてある旧履歴（日付・開始時刻が一致）は二重に出さない（店長指摘 2026-08-10）
   */
  function mergeHistoryRows(bookings, legacy) {
    const slots = bookedSlotsOf(bookings, false);
    const legacyRows = (legacy || []).filter(v => !legacyIsDup(v, slots, false));
    return [
      ...(bookings || []).map(b => ({ t: `${b.booking_date} ${(b.start_time || '00:00')}`, kind: 'b', b })),
      ...legacyRows.map(v => ({ t: String(v.visit_at), kind: 'l', v })),
    ].sort((a, b) => String(b.t).localeCompare(String(a.t)));
  }

  /** 日付「8/8(土)」＋時刻「10:15」 */
  function histDateCell(dateStr, timeStr) {
    const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return escapeHtml(String(dateStr || ''));
    const dow = ['日','月','火','水','木','金','土'][new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`).getDay()] || '';
    const hm = String(timeStr || '').substring(0, 5);
    // 旧システムからの履歴は数年分あるので西暦も出す（年は小さく添える）
    return `<span class="ht-year">${m[1]}</span>${parseInt(m[2],10)}/${parseInt(m[3],10)}${dow ? `(${dow})` : ''}`
      + (hm ? ` <span style="color:var(--deep);font-weight:700;">${escapeHtml(hm)}</span>` : '');
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

  /** 時刻表示。頭の0は落とす（05:00 → 5:00）。分はそのまま */
  function hhmm(v) {
    const s = String(v || '').slice(0, 5);
    return /^0\d:/.test(s) ? s.slice(1) : s;
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
  // その日「休み」にしたドライバーのID集合（勤務実績のお休みチップ・店長要望 2026-08-20）。
  // シフトの出勤状態(off)とは別管理なので、送迎ドライバー選択ではこちらも見て除外する
  const _driverOffCache = {};
  async function driverOffSetForDay(bizDay) {
    if (!bizDay) return new Set();
    if (_driverOffCache[bizDay]) return _driverOffCache[bizDay];
    try {
      const d = await api(`/admin-api.php?action=driver-off-list&date=${bizDay}`);
      const set = new Set((d.driver_ids || []).map(Number));
      _driverOffCache[bizDay] = set;
      return set;
    } catch (e) { return new Set(); }
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
    adSel.innerHTML = '<option value="">キャストは？</option>' +   // 未選択は問いかけで目立たせる（店長要望 2026-08-16）
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
      // 自宅の交通費（市区町村ごと）。マスタタブを開かなくても予約モーダルで効くように読む
      try {
        const cf = await api('/admin-api.php?action=city-fees');
        CITY_FEES = cf.fees || {};
      } catch (e) {}
    }
    if (adminUsersAll.length === 0) {
      // owner=admin-users / 他=staff-list (read-only)
      const ep = staffListEndpoint();
      try {
        const d = await api('/admin-api.php?action=' + ep);
        adminUsersAll = d.users || [];
      } catch (e) {}
    }
    const usersForSel = adminUsersAll.length ? adminUsersAll : [{ id: currentUser.id, display_name: currentUser.display_name, username: currentUser.email, role: currentUser.role }];
    // 担当キャストの選択肢は日付が決まってから populateCastSelect() が入れる
    // （その日の出勤者だけに絞るため。ここで全員を入れると一瞬全件が見えてしまう）
    // 送迎ドライバーは予約モーダルでは選ばない（タイムラインのカード下の
    // 行き/帰りボタン → openDriverAssign で、その日の出勤者から選ぶ）
  }

  // 深夜料金 (+¥3,300) — チェックは合計表示のみに反映 (bmPrice はコース料金のまま)
  const LATE_NIGHT_FEE = 3300;
  const CAMPAIGN_RATE = 0.1;  // キャンペーン割引: コース料金の 10%OFF (通常→オープニング特価と一致)
  // ホテル料金: ホテル利用×そのキャストと初対面のとき、コース管理の hotel_price に**置き換える**。
  // 引き算はしない（hotelFirstDiscount は常に0）。hotel_price 未設定のコースは対象外。
  // コース料金に対する割引額 (10%, 円未満切り捨て)
  function campaignDiscount(base) {
    return bel('bmCampaign')?.checked ? Math.floor(base * CAMPAIGN_RATE) : 0;
  }
  /**
   * キャンペーン割引は YLKA 向けの仕組みで、アドミでは使わない（店長判断 2026-08-05）。
   * ただし過去に割引が入って保存された予約もあるため、開いたときに割引が乗っている場合だけ
   * 外せるように出す。新規予約では常に非表示・OFF。
   */
  function syncCampaignFieldVisibility() {
    const f = bel('bmCampaignField');
    const cb = bel('bmCampaign');
    if (f) f.style.display = (cb && cb.checked) ? 'flex' : 'none';
  }
  // スタンプ特典: コース料金(キャンペーン割引後)から特典時間ぶんを按分割引。
  // 特典時間 ≥ コース時間なら全額無料 (円未満切り捨て)。延長・交通費・深夜料金は対象外。
  function stampDiscount(postCampaignCourse) {
    const rewardMin = parseInt(bel('bmStampReward')?.value || '0', 10) || 0;
    if (!rewardMin || postCampaignCourse <= 0) return 0;
    const courseMin = courseToMinutes();
    if (!courseMin) return 0;
    const ratio = Math.min(rewardMin, courseMin) / courseMin;
    return Math.floor(postCampaignCourse * ratio);
  }
  /** 併用のとき「現金で受け取る額」。未入力は0 */
  function bmCashAmount() {
    const raw = String(bel('bmCashAmount')?.value || '').replace(/[^\d]/g, '');
    return raw === '' ? 0 : (parseInt(raw, 10) || 0);
  }
  /**
   * クレジットでお客様の合計に上乗せする手数料。現金/振込は0。
   * 併用(split)は、現金で受け取るぶんを差し引いた「カードで切る額」にだけ上乗せする
   * （店長要望 2026-08-08）。
   */
  function cardSurcharge(subtotal) {
    const pm = bel('bmPayment')?.value;
    if (pm === 'credit') return Math.floor((subtotal || 0) * CARD_SURCHARGE_RATE / 100);
    if (pm === 'split') {
      const rest = Math.max(0, (subtotal || 0) - bmCashAmount());
      return Math.floor(rest * CARD_SURCHARGE_RATE / 100);
    }
    return 0;
  }
  /** 支払方法に応じて決済確認チェック・併用の入力欄・手数料の内訳を出し入れする */
  function syncCardUi() {
    const pm = bel('bmPayment')?.value;
    const usesCard = pm === 'credit' || pm === 'split';
    const wrap = bel('bmCardPaidWrap');
    if (wrap) wrap.style.display = usesCard ? 'flex' : 'none';
    if (!usesCard) {
      const chk = bel('bmCardPaid');
      if (chk) chk.checked = false;
      const at = bel('bmCardPaidAt');
      if (at) at.textContent = '';
    }
    const splitWrap = bel('bmSplitWrap');
    if (splitWrap) splitWrap.style.display = pm === 'split' ? 'flex' : 'none';
    if (pm !== 'split' && bel('bmCashAmount')) bel('bmCashAmount').value = '';
    updateBookingTotal();
  }
  /**
   * 「前回ご案内したときの交通費」を割り出す（店長要望 2026-08-24）。
   * 基本は以前と同じ額でご案内するので、今回の額が違うときに気づけるようにするための材料。
   * 済んだご利用のうち一番新しいもの（OPS予約＋旧履歴／今開いている予約は除く）を見る。
   * キャンセル・無連絡・問合せ、交通費が未記録のものは対象外
   */
  function lastTransportFee(d, excludeBookingId) {
    const SKIP = ['cancelled', 'no_show', 'inquiry'];
    const cand = [];
    (d.bookings || []).forEach(b => {
      if (Number(b.id) === Number(excludeBookingId)) return;
      if (SKIP.includes(String(b.status))) return;
      if (b.transport_fee === null || b.transport_fee === undefined || b.transport_fee === '') return;
      const day = bizDateOf(b.booking_date, b.start_time || '00:00');
      cand.push({ key: `${day} ${b.start_time || '00:00'}`, day, fee: parseInt(b.transport_fee, 10) || 0,
                  cast: String(b.staff_name || '').trim() });
    });
    (d.legacy_visits || []).forEach(v => {
      if (SKIP.includes(String(v.status))) return;
      if (v.transport_fee === null || v.transport_fee === undefined || v.transport_fee === '') return;
      const day = String(v.visit_at || '').slice(0, 10);
      if (!day) return;
      cand.push({ key: String(v.visit_at), day, fee: parseInt(v.transport_fee, 10) || 0,
                  cast: String(v.cast_name || '').trim() });
    });
    if (!cand.length) return null;
    cand.sort((x, y) => (x.key < y.key ? 1 : x.key > y.key ? -1 : 0));
    const m = cand[0].day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return { fee: cand[0].fee, cast: cand[0].cast, day: m ? `${Number(m[2])}/${Number(m[3])}` : cand[0].day };
  }
  /** 今回の交通費が前回と違うときだけ注意を出す。ボタンで前回の額に戻せる */
  function syncTransportHint() {
    const hint = bel('bmFeeHint');
    const sel = bel('bmTransport');
    if (!hint || !sel) return;
    const last = bmCust[activeBmSuffix]?.lastFee;
    const now = parseInt(String(sel.value || '').replace(/[^\d]/g, ''), 10) || 0;
    if (!last || last.fee === now) { hint.style.display = 'none'; hint.innerHTML = ''; return; }
    hint.style.display = '';
    hint.innerHTML = `▲ 前回は ¥${last.fee.toLocaleString()} でご案内`
      + `（${escapeHtml(last.day)}${last.cast ? ' ' + escapeHtml(last.cast) : ''}）`
      + `<button type="button" class="bm-fee-apply" data-fee-apply="${last.fee}">前回の額にする</button>`;
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
    let surchargeShown = 0, subtotalShown = 0;
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
      const hf = hotelFirstDiscount();
      const opt = optionTotal();
      const nomFee = nominationFeeTotal();
      const subtotal = price + transport + lateNight + ext + nomFee + opt - discount - stamp - hf;
      const surcharge = cardSurcharge(subtotal);
      totalEl.textContent = '¥' + (subtotal + surcharge).toLocaleString();
      // 割引額をチェック横に表示
      if (amtEl) amtEl.textContent = discount > 0 ? `(−¥${discount.toLocaleString()})` : '';
      if (stampEl) stampEl.textContent = stamp > 0 ? `−¥${stamp.toLocaleString()}` : '';
      surchargeShown = surcharge;
      subtotalShown = subtotal;
    }
    // 併用の内訳。お客様に「現金いくら・カードいくら」をそのまま読み上げられるように
    const splitNote = bel('bmSplitNote');
    if (splitNote) {
      if (bel('bmPayment')?.value === 'split' && !hasDepositOverride) {
        const cash = bmCashAmount();
        if (cash > subtotalShown) {
          splitNote.className = 'bm-split-note over';
          splitNote.textContent = `⚠ 現金の額が合計 ¥${subtotalShown.toLocaleString()} を超えています`;
        } else {
          const card = subtotalShown - cash + surchargeShown;
          splitNote.className = 'bm-split-note';
          splitNote.textContent = cash > 0
            ? `現金 ¥${cash.toLocaleString()} ／ カード ¥${card.toLocaleString()}`
              + (surchargeShown > 0 ? `（うち上乗せ +${CARD_SURCHARGE_RATE}% ¥${surchargeShown.toLocaleString()}）` : '')
            : '現金で受け取る額を入れると、残りがクレジットになります';
        }
      } else {
        splitNote.textContent = '';
      }
    }
    // カード手数料の内訳。手入力の預り金を使うときは「その額が最終」なので出さない
    const feeNote = bel('bmCardFeeNote');
    if (feeNote) {
      const show = !hasDepositOverride && surchargeShown > 0;
      feeNote.style.display = show ? 'block' : 'none';
      feeNote.textContent = show ? `うち 💳 カード手数料 +${CARD_SURCHARGE_RATE}% ¥${surchargeShown.toLocaleString()}` : '';
    }
    // キャンセル時の計上注記（合計は元料金のまま表示し、計上の有無/額を明示）
    const noteEl = bel('bmCancelNote');
    if (noteEl) {
      if (bmIsCancel(bel('bmStatus')?.value)) {
        if (bmCancelKindOf(bel('bmStatus')?.value) === 'customer') {
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
    updateCourseCalc();   // コース欄の金額メモ（合計を触るところは必ずここを通る）
    // 指名料の表示欄。指名方法に連動する自動表示（組み合わせコースは本数ぶん）。
    // お客様への最終確認で「コース料金／指名料／交通費」をそのまま読み上げられるようにするため
    const nomView = bel('bmNominationFeeView');
    if (nomView) {
      const nf = nominationFeeTotal();
      const cnt = nominationCount();
      nomView.value = nf ? nf.toLocaleString() + (cnt > 1 ? `（${cnt}本分）` : '') : '0';
    }
    // 交通費は自動計算でも手動でも、必ずここを通ってから表示が変わる
    try { syncTransportHint(); } catch (_) {}
  }
  /**
   * タイムラインのカードに出す「お約束の連絡」バッジ。事前予約のときだけ。
   * 未対応のものを1つだけ出す（①出勤確認 →②到着見込み）。予定時刻を過ぎていたら赤。
   * カードの形は変えず、💳未 と同じ行に小さく置く（店長要望 2026-08-10）。
   */
  /**
   * その日・そのキャストの「貴重品お預かり」「釣銭お渡し」（店長要望 2026-08-16）。
   * 大事なものなので、誰が預かった/渡した・誰が返した/回収した を残す。
   *   なし → 素の色 ／ 預かり中(まだ戻っていない) → オレンジ ／ 済み → 緑
   */
  const DAY_FLAG_LABELS = {
    valuables:    { on: '預かった人', off: '返した人' },
    change_given: { on: '渡した人',   off: '回収した人' },
  };
  const dayFlagOf = (adminId, bizDay) => tlDayFlags[adminId + '|' + bizDay] || {};
  function dayFlagBtn(adminId, bizDay, key, label) {
    const f = dayFlagOf(adminId, bizDay);
    const by = f[key + '_by'], offBy = f[key + '_off_by'];
    const state = by && !offBy ? 'is-on' : (by && offBy ? 'is-done' : '');
    const L = DAY_FLAG_LABELS[key];
    // nameOf は関数ごとのローカル定義なのでここでは使えない。名簿から直接引く
    const nm = (id) => {
      const u = (adminUsersAll || []).find(x => Number(x.id) === Number(id));
      return u ? (u.display_name || u.username) : '—';
    };
    // fmtRecvAt はまとめ画面の中だけの関数なのでここでは使わない。「M/D H:MM」に整えて出す
    const tm = (v) => {
      const m = String(v || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
      return m ? `（${parseInt(m[2], 10)}/${parseInt(m[3], 10)} ${parseInt(m[4], 10)}:${m[5]}）` : '';
    };
    const title = by
      ? `${label}／${L.on}: ${nm(by)}${tm(f[key + '_at'])}` + (offBy ? `／${L.off}: ${nm(offBy)}${tm(f[key + '_off_at'])}` : `／${L.off}: まだ`)
      : `${label}：クリックして記録`;
    return `<button type="button" class="tl-flag ${state}" data-day-flag="${key}" data-admin="${adminId}" data-date="${bizDay}" title="${escapeAttr(title)}">${label}${by && offBy ? '✓' : ''}</button>`;
  }
  /** 貴重品／釣銭の記録ポップ（誰が・誰が返した の2つを選んで保存） */
  function openDayFlagEdit(adminId, bizDay, key, anchorEl) {
    closeTimeAdjust();
    const L = DAY_FLAG_LABELS[key];
    const label = key === 'valuables' ? '貴重品' : '釣銭';
    const f = dayFlagOf(adminId, bizDay);
    // 候補はその日の出勤スタッフ（内勤・ドライバー）。すでに記録されている人は必ず残す
    const duty = opsOnDutySet(bizDay, [f[key + '_by'], f[key + '_off_by']]);
    const people = (adminUsersAll || []).filter(u => u.id && duty.has(Number(u.id)) && (isOfficeCapable(u) || isDriverCapable(u))).sort(opsStaffOrder(bizDay));
    const opts = (sel) => '<option value="">—</option>' + people.map(u =>
      `<option value="${u.id}"${Number(sel) === Number(u.id) ? ' selected' : ''}>${escapeHtml(u.display_name || u.username)}</option>`).join('');
    const pop = document.createElement('div');
    pop.id = 'tlFlagPop';
    pop.className = 'tl-time-pop';
    pop.innerHTML = `<div class="ttp-head"><span class="ttp-label">${label}</span><button class="ttp-close" type="button" aria-label="閉じる">×</button></div>
      <div class="ttp-flag-row"><span class="ttp-flag-l">${L.on}</span><select class="ttp-sel" id="tlFlagBy">${opts(f[key + '_by'])}</select></div>
      <div class="ttp-flag-row"><span class="ttp-flag-l">${L.off}</span><select class="ttp-sel" id="tlFlagOffBy">${opts(f[key + '_off_by'])}</select></div>
      <button type="button" class="ttp-copy" id="tlFlagSave">保存</button>`;
    document.body.appendChild(pop);
    const r = anchorEl.getBoundingClientRect();
    pop.style.top = (r.bottom + window.scrollY + 4) + 'px';
    pop.style.left = (r.left + window.scrollX) + 'px';
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) pop.style.left = (window.innerWidth - pr.width - 8 + window.scrollX) + 'px';
    pop.querySelector('.ttp-close').addEventListener('click', (e) => { e.stopPropagation(); closeTimeAdjust(); });
    pop.addEventListener('click', (e) => e.stopPropagation());
    pop.querySelector('#tlFlagSave').addEventListener('click', async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      btn.disabled = true;
      const by = pop.querySelector('#tlFlagBy').value;
      const offBy = pop.querySelector('#tlFlagOffBy').value;
      try {
        const res = await apiPost('/shifts.php?action=set-day-flag', { admin_user_id: adminId, biz_date: bizDay, key, by, off_by: offBy });
        const k = adminId + '|' + bizDay;
        tlDayFlags[k] = Object.assign({}, tlDayFlags[k], {
          [key + '_by']: res.by, [key + '_at']: res.at,
          [key + '_off_by']: res.off_by, [key + '_off_at']: res.off_at,
        });
        toast('✓ ' + label + 'を記録しました', 'ok');
        closeTimeAdjust();
        renderTimeline();
      } catch (err) { toast('保存失敗: ' + err.message, 'err'); btn.disabled = false; }
    });
    setTimeout(() => document.addEventListener('click', _ttpOutside, true), 0);
  }

  /**
   * 回収が必要な貸出品（バスタオル＋マスタで「貸出品」にしたオプション）。
   * 回収忘れが一番困るので、回収するまでタイムラインに出す（店長要望 2026-08-16）
   */
  function lentItemsOf(b) {
    if (!b) return [];
    const items = [];
    if (Number(b.towel_lent) === 1) items.push('バスタオル');
    const txt = String(b.menu_items || '');
    const hits = (optionsCache || [])
      .filter(o => Number(o.is_lendable) === 1 && String(o.name || '') && txt.includes(String(o.name)))
      .map(o => String(o.name));
    // 「無料ﾛｰﾀｰ」が入っているときに「ﾛｰﾀｰ」も拾ってしまうので、他の名前に含まれるものは落とす
    hits.filter(nm => !hits.some(other => other !== nm && other.includes(nm))).forEach(nm => items.push(nm));
    return items;
  }
  /** 貸出品を回収した人の名前（記録が無ければ空） */
  function lendReturnedByName(b) {
    const id = Number(b?.lend_returned_by || 0);
    if (!id) return '';
    const u = (adminUsersAll || []).find(x => Number(x.id) === id);
    return u ? String(u.display_name || u.username || '') : '';
  }

  /**
   * 貸出品の回収ポップ。「回収しましたか？」のはい/いいえだけだと誰が回収したか残らないため、
   * その日の出勤スタッフから選んで記録する（店長要望 2026-08-26）。
   * onDone は予約モーダルから開いたときの再描画用。
   */
  function openLendReturn(id, anchorEl, bookingObj, onDone) {
    closeTimeAdjust();
    const b = bookingObj || _tlBookingMap[id];
    if (!b) return;
    const items = lentItemsOf(b);
    const done = !!b.lend_returned_at;
    // 候補はその予約の営業日に出ている内勤・ドライバー。すでに記録されている人は必ず残す
    const bizDay = bizDateOf(String(b.booking_date || '').slice(0, 10), String(b.start_time || '10:00'));
    const duty = opsOnDutySet(bizDay, [b.lend_returned_by]);
    const people = (adminUsersAll || []).filter(u => u.id && duty.has(Number(u.id)) && (isOfficeCapable(u) || isDriverCapable(u))).sort(opsStaffOrder(bizDay));
    const sel = Number(b.lend_returned_by || 0) || Number(currentUser?.id || 0);
    const opts = '<option value="">—</option>' + people.map(u =>
      `<option value="${u.id}"${Number(sel) === Number(u.id) ? ' selected' : ''}>${escapeHtml(u.display_name || u.username)}</option>`).join('');

    const pop = document.createElement('div');
    pop.id = 'tlLendPop';
    pop.className = 'tl-time-pop';
    pop.innerHTML = `<div class="ttp-head"><span class="ttp-label">${done ? '回収済み' : '貸出品の回収'}</span>`
      + `<button class="ttp-close" type="button" aria-label="閉じる">×</button></div>`
      + `<div class="ttp-lend-items">🧺 ${escapeHtml(items.join('・'))}</div>`
      + `<div class="ttp-flag-row"><span class="ttp-flag-l">回収した人</span><select class="ttp-sel" id="tlLendBy">${opts}</select></div>`
      + `<button type="button" class="ttp-copy" id="tlLendSave">${done ? '担当を変更する' : '回収した'}</button>`
      + (done ? `<button type="button" class="ttp-undo" id="tlLendUndo">貸出中に戻す</button>` : '');
    document.body.appendChild(pop);
    const r = anchorEl.getBoundingClientRect();
    pop.style.top = (r.bottom + window.scrollY + 4) + 'px';
    pop.style.left = (r.left + window.scrollX) + 'px';
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) pop.style.left = (window.innerWidth - pr.width - 8 + window.scrollX) + 'px';
    pop.querySelector('.ttp-close').addEventListener('click', (e) => { e.stopPropagation(); closeTimeAdjust(); });
    pop.addEventListener('click', (e) => e.stopPropagation());

    const apply = async (returned, byVal, btn) => {
      btn.disabled = true;
      try {
        const res = await apiPost('/bookings.php?action=set-lend-returned', { id, returned: returned ? 1 : 0, by: byVal || '' });
        b.lend_returned_at = returned ? '1' : null;
        b.lend_returned_by = returned ? (res.by || null) : null;
        const cached = _tlBookingMap[id];
        if (cached && cached !== b) { cached.lend_returned_at = b.lend_returned_at; cached.lend_returned_by = b.lend_returned_by; }
        toast(returned ? '✓ 回収済みにしました' : '貸出中に戻しました', 'ok');
        closeTimeAdjust();
        if (typeof onDone === 'function') onDone();
        loadTimeline(true);
      } catch (err) { toast('更新失敗: ' + err.message, 'err'); btn.disabled = false; }
    };
    pop.querySelector('#tlLendSave').addEventListener('click', (e) => {
      e.stopPropagation();
      apply(true, pop.querySelector('#tlLendBy').value, e.target.closest('button'));
    });
    const undo = pop.querySelector('#tlLendUndo');
    if (undo) undo.addEventListener('click', (e) => { e.stopPropagation(); apply(false, '', e.target.closest('button')); });
    setTimeout(() => document.addEventListener('click', _ttpOutside, true), 0);
  }

  /** 貸出品バッジ。回収済み（lend_returned_at あり）になったら消える */
  function lendBadgeHtml(b) {
    const items = lentItemsOf(b);
    if (!items.length) return '';
    // 回収しても消さず、チェック付きで残す（何を貸したかを後から見たい・店長要望 2026-08-23）
    const done = !!b.lend_returned_at;
    const who = lendReturnedByName(b);
    const tip = done
      ? `回収済み${who ? '（' + who + '）' : ''}: ${items.join('・')}／クリックで担当の変更・「貸出中」に戻せます`
      : `貸出中: ${items.join('・')}／クリックで回収した人を選んで記録`;
    return `<span class="bk-lend${done ? ' is-returned' : ''}" data-bk-lend="${b.id}" title="${escapeAttr(tip)}">🧺${done ? '✓' : items.length}</span>`;
  }
  /**
   * 予約詳細（モーダル）の貸出品の状態表示。
   * タイムラインで回収してもチェックが入ったままで「まだ貸してる」ように見えたため、
   * 貸出中／回収済みをここにも出し、クリックで切り替えられるようにした（店長指摘 2026-08-16）
   */
  function renderBmLendState(b) {
    const el = bel('bmLendState');
    const wrap = bel('bmTowelWrap');
    const items = lentItemsOf(b);
    if (wrap) wrap.classList.toggle('is-returned', !!(b && b.lend_returned_at));
    if (!el) return;
    if (!b || !b.id || !items.length) { el.style.display = 'none'; el.onclick = null; return; }
    const done = !!b.lend_returned_at;
    el.style.display = 'inline-flex';
    el.className = 'bm-lend-state' + (done ? ' is-done' : '');
    const who = lendReturnedByName(b);
    el.textContent = done ? ('✅ 回収済み' + (who ? '（' + who + '）' : '')) : `🧺 貸出中: ${items.join('・')}`;
    el.title = done ? 'クリックで担当の変更・「貸出中」に戻す' : 'クリックで回収した人を選んで記録';
    el.onclick = (ev) => {
      ev.stopPropagation();
      openLendReturn(b.id, el, b, () => renderBmLendState(b));
    };
  }
  function prepBadgeHtml(b) {
    if (!b || b.status !== 'pre_reserved') return '';
    const kind = b.pre_kind || '';
    const due = String(b.pre_due || '').substring(0, 5);
    if (!kind && !due) return '';   // 何も決めていない事前予約には出さない
    const label = kind === 'eta' ? '到着見込みの連絡' : kind === 'confirm' ? '出勤確認の連絡' : 'お客様への連絡';
    const isLine = b.pre_contact_method === 'line';
    const method = isLine ? '💬' : b.pre_contact_method === 'tel' ? '☎' : '📞';
    // 営業日は 10:00〜翌10:00 なので、10時未満は「+24時間」として比べる（0:30 が 23:00 より後になる）
    const bizMin = (h, m) => ((h < 10 ? h + 24 : h) * 60 + m);
    const nowD = new Date();
    const nowMin = bizMin(nowD.getHours(), nowD.getMinutes());
    const dueMin = (t) => { const p = String(t).split(':'); return bizMin(parseInt(p[0], 10), parseInt(p[1], 10) || 0); };
    // 予定時刻が未入力なら「未」だけ。時刻があり、今日の営業日ぶんで予定を過ぎていれば赤
    const sameBizDay = bizDateOf(b.booking_date, b.start_time || '00:00') === fmtDate(getBusinessDayDate());
    const overdue = !!due && sameBizDay && dueMin(due) <= nowMin;
    const tip = `${label}${due ? '（' + due + '予定）' : ''} がまだです / クリックで「予約」に変えられます`;
    // 予定時刻を過ぎたら手段に関わらず赤。まだのうちは LINE=緑 / 電話=紫（店長要望 2026-08-10）
    const cls = overdue ? 'is-due' : (isLine ? 'is-wait is-line' : 'is-wait');
    return `<span class="bk-prewarn ${cls}" data-bk-flag="${b.id}" title="${escapeAttr(tip)}">${method}${due || '未'}</span>`;
  }

  // ===== 事前予約のお約束（出勤確認の連絡・到着見込みの連絡）=====
  // 事前予約のときだけ入力欄を出す。他のステータスでは値を持っていても隠すだけ（消さない）
  // ステータス欄はキャンセルを理由ごとに分けて出す（店長指定 2026-08-15）。値は "cancelled:shop" 形式。
  // DBは今まで通り status='cancelled' ＋ cancellation_reason_type に分けて保存する
  const bmIsCancel = (v) => String(v || '').split(':')[0] === 'cancelled';
  const bmCancelKindOf = (v) => String(v || '').split(':')[1] || 'customer';
  /** ステータス欄の値から、隠してある理由 select を合わせる（保存・計上の判定に使う） */
  function syncCancelTypeFromStatus() {
    const v = bel('bmStatus')?.value || '';
    const ct = bel('bmCancelType');
    if (ct && bmIsCancel(v)) ct.value = bmCancelKindOf(v);
  }
  function syncPrepWrap() {
    const wrap = bel('bmPreWrap');
    if (!wrap) return;
    wrap.style.display = bel('bmStatus')?.value === 'pre_reserved' ? 'block' : 'none';
  }
  /** チップの選択状態を反映（連絡手段 ☎/💬 と 内容 出勤確認/到着見込み の2組で共用） */
  function setPrepChip(kind, v) {
    const hid = bel(kind === 'method' ? 'bmPreMethod' : 'bmPreKind');
    if (hid) hid.value = v || '';
    const sel = kind === 'method' ? '.bm-prep-m' : '.bm-prep-k';
    const attr = kind === 'method' ? 'prepMethod' : 'prepKind';
    document.querySelectorAll(`#bmPreWrap${activeBmSuffix} ${sel}`).forEach(b => {
      b.classList.toggle('is-on', b.dataset[attr] === v);
    });
  }
  /** 予約データ → 入力欄 */
  function fillPrepFields(b) {
    setPrepChip('method', b?.pre_contact_method || '');
    setPrepChip('kind', b?.pre_kind || '');
    const preDue = String(b?.pre_due || '').substring(0, 5);
    if (bel('bmPreDueH')) bel('bmPreDueH').value = preDue ? preDue.slice(0, 2) : '';
    // 分は5分刻みの選択肢。5分刻みでない古いデータは近い値に丸める（選択肢に無いと空欄になるため）
    if (bel('bmPreDueM')) {
      let mv = '';
      if (preDue) { let m = Math.round((parseInt(preDue.slice(3, 5), 10) || 0) / 5) * 5; if (m >= 60) m = 55; mv = ('0' + m).slice(-2); }
      bel('bmPreDueM').value = mv;
    }
    syncPrepWrap();
  }
  /** 入力欄 → 保存する値。連絡が取れたら「事前予約→予約」に変える運用なので、済みフラグは持たない */
  function prepPayload() {
    return {
      pre_contact_method: bel('bmPreMethod')?.value || null,
      pre_kind: bel('bmPreKind')?.value || null,
      pre_due: bel('bmPreDueH')?.value ? (bel('bmPreDueH').value + ':' + (bel('bmPreDueM')?.value || '00')) : null,
    };
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
      // 過去に使ったご自宅住所（新しい順）。2つ以上あれば選べるようにする（店長要望 2026-08-14）
      const pastAddrs = collectHomeAddresses(d.bookings, c.default_location);
      // 顧客が確定したこの時点でも「いつもの場所」を試す（電話blur以外の経路をここで拾う）。
      // 既存予約を開いたときは場所が復元済み＝untouchedでないので何も起きない。
      withBmSuffix(suffix, () => { try { prefillUsualLocation(c, pastAddrs); } catch (_) {} });
      {
        const cur = joinAddressBuilding(
          (document.getElementById('bmHomeAddress' + suffix)?.value || '').trim(),
          (document.getElementById('bmHomeBuilding' + suffix)?.value || '').trim());
        renderPastAddrSelect(suffix, pastAddrs, cur);
      }
      // ご利用回数と「過去に会ったキャスト」は、実際のオーダーから数える。
      // キャンセル・無連絡は利用に数えない＝そのキャストとは会っていないまま（店長方針 2026-08-05）。
      // 予約ステータスで1回と判断する（店長方針 2026-08-05）。
      // 数える: 予約 / 事前予約 / 保留 / 接客中・接客完了
      // 数えない: 問合せ（まだ予約ではない） / キャンセル / 無連絡 / 休憩
      const COUNTED = (st) => !['cancelled', 'no_show', 'inquiry'].includes(String(st));
      // いま編集中の予約は「その人の過去の利用」ではないので除く（1回目なのに2回目と出ていた）
      const curRow = (d.bookings || []).find(x => Number(x.id) === Number(excludeBookingId));
      const usedCount = Math.max(0,
        (d.usage ? (parseInt(d.usage.legacy, 10) || 0) + (parseInt(d.usage.ops, 10) || 0) : 0)
        - (curRow && COUNTED(curRow.status) ? 1 : 0));
      {
        const doneRows = (d.bookings || [])
          .filter(x => Number(x.id) !== Number(excludeBookingId))
          .filter(x => COUNTED(x.status));
        const names = new Set();
        doneRows.forEach(x => { const n = String(x.staff_name || '').trim(); if (n) names.add(n); });
        (d.legacy_visits || []).filter(x => COUNTED(x.status))
          .forEach(x => { const n = String(x.cast_name || '').trim(); if (n) names.add(n); });
        bmCust[suffix] = { isNew: usedCount === 0, castNames: names, lastFee: lastTransportFee(d, excludeBookingId) };
        withBmSuffix(suffix, () => { try { syncDealBadges(); } catch (_) {} try { syncTransportHint(); } catch (_) {} });
      }
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
      summaryEl.textContent = usedCount > 0
        ? `リピーター・ご利用${usedCount}回` + lastLabel
        : (notesTrim ? '📝 お客様メモあり' : (histCount > 0 ? `予約履歴 ${histCount}件` : '新規のお客様'));
      let curNotes = notesTrim;
      const noteFallback = presumedNoteStamp(d.bookings || [], legacy);
      const noteHtml = renderCustomerNote(curNotes, noteFallback, d.ng_casts || []);
      // 旧システムの一覧と同じ表形式。件数が多いので直近30件まで
      const mergedRows = mergeHistoryRows(rows, legacy).slice(0, 30);
      const rowsHtml = renderHistoryTable(mergedRows, { clickable: false });
      panelEl.innerHTML = noteHtml + rowsHtml;
      wireCustomerNoteEdit(panelEl, customerId, () => curNotes, v => { curNotes = v; }, noteFallback, d.ng_casts || []);
      renderNgAlert();   // 差し込んだ 🚫NG ボタンの表示・文言を今の状態に合わせる
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

  // 電話番号の「🔍 照会」ボタン。押した時点でハッキリ結果を返す（blurだけだと気づきにくいため・店長要望 2026-08-16）
  async function lookupCustomerByPhoneManual() {
    const phone = bel('bmCustomerPhone').value.trim();
    if (!phone) { toast('電話番号を入力してください', 'err'); return; }
    const btn = bel('bmPhoneLookup');
    if (btn) { btn.disabled = true; btn.textContent = '照会中…'; }
    try {
      await lookupCustomerByPhone();
      const hit = !!bel('bmCustomerId').value;
      if (hit) {
        // 見つかったら履歴パネルをその場で開いて表示する
        const toggleBtn = bel('bmHistoryToggle');
        if (toggleBtn && toggleBtn.getAttribute('aria-expanded') !== 'true') toggleHistoryPanel();
        toast(`✓ 該当あり：${bel('bmCustomerName').value || '（お名前未登録）'} 様`, 'ok');
      } else {
        toast('該当するお客様はいません（ご新規様）', 'err');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔍 照会'; }
    }
  }
  // 電話番号 blur で既存顧客検索
  async function lookupCustomerByPhone() {
    const phone = bel('bmCustomerPhone').value.trim();
    if (!phone) { setBookingNg(null); resetBmCust(); try { syncDealBadges(); } catch (_) {} loadCustomerHistory(null); return; }
    try {
      const d = await api('/customers.php?action=find-by-phone&phone=' + encodeURIComponent(phone));
      if (d.customer) {
        bel('bmCustomerId').value = d.customer.id;
        setBookingNg({ level: Number(d.customer.ng_level || 0), reason: d.customer.ng_reason || '', castIds: d.ng_cast_ids || [] });
        prefillUsualLocation(d.customer);
        const nameField = bel('bmCustomerName');
        // 旧データの「（名前未登録）」は名前として入れない（そのまま保存されて未登録が残るため）
        const isNoName = (n) => !String(n || '').trim()
          || ['名称未設定', '名前未登録', '未登録', '名前なし', '匿名']
               .includes(String(n).replace(/[（）()\s　]/g, ''));
        if (!nameField.value.trim() && !isNoName(d.customer.name)) nameField.value = d.customer.name || '';
        const emailField = bel('bmCustomerEmail');
        if (!emailField.value.trim() && d.customer.email) emailField.value = d.customer.email;
        loadCustomerHistory(d.customer.id, getEditingBookingId());
      } else {
        bel('bmCustomerId').value = '';
        setBookingNg(null);
        bmCust[activeBmSuffix] = { isNew: true, castNames: new Set(), lastFee: null };   // 登録なし＝ご新規様
        try { syncDealBadges(); } catch (_) {}
        loadCustomerHistory(null);
      }
    } catch (e) {}
  }

  async function openBookingModal(id, prefill) {
    clearPrevJobCache();   // 「直前のお仕事」はその都度取り直す（保存直後の古い一覧を掴まないため）
    await ensureSelectsLoaded();
    await ensureCoursesLoaded();
    await ensureOptionsLoaded();
    renderBmOptions();
    // 開くたびに現在のモーダル(primary/-2)の bmCourse を最新の option(data-price付き)で再生成。
    // ensureCoursesLoaded は cache 済みだと populate を呼ばないため、ここで明示的に保証する
    populateCourseSelect();
    setEditingBookingId(id);
    if (id) acquireBookingLock(id);           // 既存予約 → 編集ロック（他端末は読み取り専用）
    else { releaseBookingLock(activeBmSuffix); _bmLoadedUpdatedAt[activeBmSuffix] = ''; }
    const labelSuffix = activeBmSuffix === '-2' ? '（②）' : (document.getElementById('bookingModal-2')?.classList.contains('show') ? '（①）' : '');
    bel('bmTitle').textContent = (id ? '予約編集' : '新規予約') + labelSuffix;
    // 電話番号の照会ボタンは新規受付のときだけ（編集中は電話が既に確定しているため・店長要望 2026-08-16）
    { const lb = bel('bmPhoneLookup'); if (lb) lb.style.display = id ? 'none' : ''; }
    bel('bmDelete').style.display = id && currentUser?.role !== 'staff' ? 'inline-flex' : 'none';
    // 休憩モードリセット (デフォルト OFF)
    const breakChk = bel('bmBreakMode');
    if (breakChk) { breakChk.checked = false; setBreakMode(false); }

    if (id) {
      try {
        const d = await api('/bookings.php?action=get&id=' + id);
        const b = d.booking;
        _bmLoadedUpdatedAt[activeBmSuffix] = b.updated_at || '';   // 保存時の追い越しチェック用
        bel('bmCustomerId').value = b.customer_id || '';
        bel('bmCustomerName').value = b.customer_name || b.customer_name_snapshot || '';
        bel('bmCustomerPhone').value = b.customer_phone || b.customer_phone_snapshot || '';
        bel('bmCustomerEmail').value = b.customer_email_snapshot || '';
        refreshBookingNg(b.customer_phone || b.customer_phone_snapshot || '');
        loadCustomerHistory(b.customer_id || null, id);
        // カレンダー日基準でそのまま表示
        bel('bmDate').value = bizDateOf(b.booking_date, b.start_time || '00:00');  // 日付欄は営業日で表示（深夜0-10時は前日）
        const sh = parseInt(String(b.start_time).substring(0, 2), 10);
        const sm = parseInt(String(b.start_time).substring(3, 5), 10);
        const eh = parseInt(String(b.end_time).substring(0, 2), 10);
        const em = parseInt(String(b.end_time).substring(3, 5), 10);
        bel('bmStartHour').value = sh;
        bel('bmStartMin').value = sm;
        bmStartTouched[activeBmSuffix] = true;   // 保存済みの時刻は日付変更で書き換えない
        setBmMedia(b.media || '');
        // コース復元: course_name からマスタを照合（端数や旧カスタムは分数で照合）
        let courseMin = null;
        let course2Min = null;
        if (b.course_name) {
          // 保存名は「90分コース ＋ 90分コース ＋10分」の形になりうる。
          // 末尾の「＋10分」を落としてから ＋ で分解し、1本目/2本目に割り当てる
          const cname = String(b.course_name).replace(/\s*＋\s*10\s*分\s*$/, '').trim();
          const toMin = (nm) => {
            const cm = (coursesCache || []).find(c => c.name === nm);
            if (cm) return parseInt(cm.duration_min, 10);
            const mm = String(nm).match(/(\d+)\s*分/);
            return mm ? parseInt(mm[1], 10) : null;
          };
          const parts = cname.split(/\s*[＋+]\s*/).map(x => x.trim()).filter(Boolean);
          if (parts.length === 1) {
            courseMin = toMin(parts[0]);
          } else if (parts.length > 1) {
            // 組み合わせコースは合計分数で1つの選択肢になっている
            course2Min = parts.reduce((n, nm) => n + (toMin(nm) || 0), 0);
          }
        }
        // マスタに一致する分数があれば選択、無ければ未選択（カスタムは廃止）
        const opt = courseMin != null && [...bel('bmCourse').options].find(o => o.value === String(courseMin));
        bel('bmCourse').value = opt ? String(courseMin) : '';
        const sel2r = bel('bmCourse2');
        if (sel2r) {
          const opt2 = course2Min != null && [...sel2r.options].find(o => o.value === String(course2Min));
          sel2r.value = opt2 ? String(course2Min) : '';
        }
        syncComboUi();
        // 延長回数の復元
        if (bel('bmExtCount')) bel('bmExtCount').value = String(b.extension_count || 0);
        updateEndTime();
        // ロケーションタイプ判定 + 復元
        const locType = detectLocType(b.hotel_id, b.hotel_name_snapshot);
        switchLocSection(locType);
        if (isHotelLoc(locType)) {
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
          renderBmHotelAddr();
          bel('bmHotelName').value = b.hotel_id ? '' : (b.hotel_name_snapshot || '');
          syncFreeHotelWrap();   // 手入力で登録された予約は開いた状態で出す
          bel('bmRoom').value = b.room_number || '';
        } else if (locType === 'home') {
          // 建物名が二重に入っている古いデータ（例「プレステージ立川 805 プレステージ立川 805」）は畳んで出す
          const [rAddr, rBld] = splitAddressBuilding(dedupeRepeatedSuffix((b.hotel_name_snapshot || '').replace(HOME_PREFIX, '').trim()));
          bel('bmHomeAddress').value = rAddr;
          bel('bmHomeBuilding').value = rBld;
          // 市区町村も戻す。保存値（display_city）が無い古い予約は住所から拾う
          // （入れないと開くたび「— すべて —」に見え、町名プルダウンも出なかった・店長指摘 2026-08-22）
          restoreBmCityFor(b, rAddr);
        } else if (locType === 'other') {
          bel('bmOtherLoc').value = (b.hotel_name_snapshot || '').replace(OTHER_PREFIX, '');
          restoreBmCityFor(b, bel('bmOtherLoc').value);
        }
        loadBmTowns();   // 市区町村が確定したので町名プルダウンを合わせる（前の予約の一覧を残さない）
        renderBmMapLinks();   // 開いた予約の住所にも地図リンクを出す
        // 担当プルダウンはその日の出勤者だけ。割当済みの担当は出勤外でも残す
        await populateCastSelect(bel('bmDate').value, b.assigned_admin_id || '');
        bel('bmAdminId').value = b.assigned_admin_id || '';
        renderCastAlert();
        // 送迎ドライバーはタイムラインで操作（モーダルでは扱わない）
        // 接客完了は予約としては「予約」。終わっているかはタイムラインの「終」で分かる
        bmKeptStatus[activeBmSuffix] = b.status === 'completed' ? 'completed' : null;
        bel('bmStatus').value = b.status === 'completed' ? 'reserved'
          : (b.status === 'cancelled' ? 'cancelled:' + (b.cancellation_reason_type || 'customer') : (b.status || 'reserved'));
        bel('bmCancelType').value = b.cancellation_reason_type || 'customer';
        bel('bmCancelReason').value = b.cancellation_reason || '';
        setMoney('bmCancelFee', b.cancellation_fee ?? '');
        setMoney('bmCancelReward', b.cancellation_reward ?? '');
        bel('bmCancelWrap').style.display = b.status === 'cancelled' ? 'block' : 'none';
        syncCancelTypeFromStatus();
        fillPrepFields(b);   // 事前予約のお約束（出勤確認・到着連絡）
        // コース料金はコースマスタの基本料金を入れる（保存値は延長/深夜/指名料込みのため二重計上を防ぐ）。
        // 組み合わせ（90＋90 など）は bmCourse の選択肢に無いので、そちらの料金を先に見る。
        // 見ないと保存値がそのまま入り、開いて保存し直すたびに指名料などが二重に乗っていた
        //（2026-08-08 店長指摘: 内訳の計 ¥44,000 に対しコース料金欄が ¥51,700 ＝指名料¥4,400込みの保存値）。
        const combo2El = bel('bmCourse2');
        const combo2Opt = combo2El && combo2El.value ? combo2El.options[combo2El.selectedIndex] : null;
        const courseOptEl = opt ? [...bel('bmCourse').options].find(o => o.value === String(courseMin)) : null;
        const basePrice = combo2Opt?.dataset?.price || courseOptEl?.dataset?.price;
        setMoney('bmPrice', basePrice ? basePrice : (b.price || ''));
        // 交通費セレクトに無い金額(旧・手入力データ等)なら選択肢として一時追加してから復元する
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
        // 併用の現金額は setBmPayment（→ syncCardUi）が併用以外で消すので、その後に入れる
        setBmPayment(b.payment_method || '');
        if (bel('bmCashAmount')) {
          bel('bmCashAmount').value = (b.payment_method === 'split' && b.cash_amount != null) ? String(b.cash_amount) : '';
          updateBookingTotal();
        }
        const paidChk = bel('bmCardPaid');
        if (paidChk) paidChk.checked = !!b.card_paid_at;
        const paidAt = bel('bmCardPaidAt');
        // 誰が確認したかも残す（後から「これ誰が通したの」を追えるように・店長要望 2026-08-08）
        if (paidAt) {
          paidAt.textContent = b.card_paid_at
            ? String(b.card_paid_at).slice(0, 16).replace('T', ' ') + (b.card_paid_by_name ? `　${b.card_paid_by_name}` : '')
            : '';
        }
        setReceiptBtn(Number(b.receipt_needed) === 1);
        if (bel('bmNomination')) bel('bmNomination').value = b.nomination_type || '';
        // 預り金は都度の手入力のため常に空欄（既存の報酬オーバーライドのみ編集時に復元）
        if (bel('bmDepositOverride')) bel('bmDepositOverride').value = '';
        if (bel('bmRewardOverride')) setMoney('bmRewardOverride', b.reward_override != null ? b.reward_override : '');
        bel('bmNotes').value = b.notes || '';
        { const tw = bel('bmTowelLent'); if (tw) tw.checked = Number(b.towel_lent) === 1; }
        renderBmLendState(b);   // 貸出中／回収済みをここでも出す（店長指摘 2026-08-16）
        // オプションは menu_items にテキストで保存している。名前で照合して選択を復元する
        // （マスタから消えたオプションは復元されないが、記録のテキストは残る）
        setBmOptionCounts(parseMenuItemCounts(b.menu_items));
        // 深夜料金・キャンペーン割引を保存値から復元（bmPrice はコース基本料金＝通常価格）。
        // 保存 price = 基本 + 深夜 + 延長 − 割引 − スタンプ。スタンプは保存されないため 0 とみなし逆算する。
        const stampSelEdit = bel('bmStampReward');
        if (stampSelEdit) stampSelEdit.value = '';
        const lateCbEdit = bel('bmLateNight');
        if (lateCbEdit) lateCbEdit.checked = Number(b.late_fee) > 0;   // 深夜料金は late_fee 列で確定
        const campCbEdit = bel('bmCampaign');
        const hfCbEdit = bel('bmHotelFirst');
        {
          const baseVal = parseInt(String(basePrice || b.price || '0').replace(/[^\d]/g, ''), 10) || 0;
          // 保存 price = コース + 深夜 + 延長 + 指名料 + オプション − 各割引。
          // 指名料とオプションを足し忘れると割引額を取り違える（指名料が0円の間は表面化しなかった）
          const impliedDisc = baseVal + (Number(b.late_fee) || 0) + extAmount()
            + nominationFeeFor(b.nomination_type) + optionTotal() - (Number(b.price) || 0);
          const expectDisc = Math.floor(baseVal * CAMPAIGN_RATE);
          // 逆算した割引額から キャンペーン(10%) / 初回ホテル(−5,500) / 両方 を推定
          const isCamp = !!opt && expectDisc > 0 && Math.abs(impliedDisc - expectDisc) <= 2;
          const hfDelta = hotelDeltaForCurrentCourse();
          const isHf = Math.abs(impliedDisc - hfDelta) <= 2;
          const isBoth = !!opt && expectDisc > 0 && Math.abs(impliedDisc - (expectDisc + hfDelta)) <= 2;
          if (campCbEdit) campCbEdit.checked = isBoth || (isCamp && !isHf);
          // 保存されたフラグが立っていればそれが正。立っていない旧データだけ金額から逆算する
          const savedHf = Number(b.hotel_price_applied) === 1;
          if (hfCbEdit) hfCbEdit.checked = savedHf || (isBoth || (isHf && !isCamp));
          syncCampaignFieldVisibility();
          // 保存済みの状態を自動判定で動かさない
          bmHotelFirstTouched[activeBmSuffix] = true;
          // ＋10分はコース名の末尾に記録している（「60分コース ＋10分」）ので、そこから戻す
          const p10Edit = bel('bmPlus10');
          if (p10Edit) p10Edit.checked = /＋\s*10\s*分\s*$/.test(String(b.course_name || ''));
          bmPlus10Touched[activeBmSuffix] = true;
          populateCourseSelect();
          // 選択肢を作り直したら金額も必ず入れ直す（内訳メモと同じ元データから作るため）。
          // 以前はホテル料金のときだけ呼んでいたので、前に開いた予約のホテル料金つき選択肢から
          // 拾った金額が残り、内訳¥44,000 に対しコース料金欄が¥38,500 とズレていた
          //（2026-08-08 店長指摘）。コースが特定できないときは applyCoursePrice が何もしないので
          // 手入力で調整した金額は消えない。
          applyCoursePrice();
        }
        updateBookingTotal();
        bel('bmSub').textContent = b.customer_name || b.customer_name_snapshot || '';
        // 休憩予約の自動判定
        const isBreakRow = (b.course_name === '休憩') || (b.customer_name_snapshot === '【休憩】');
        if (breakChk && isBreakRow) {
          breakChk.checked = true;
          setBreakMode(true);
          if (bel('bmStatus')) bel('bmStatus').value = 'break';
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
      ['bmCustomerId','bmCustomerName','bmCustomerPhone','bmCustomerEmail','bmCourse','bmCourse2','bmNomination','bmCustomMin','bmBreakDur','bmBreakCustomMin','bmBreakCity','bmHotelId','bmHotelName','bmRoom','bmHomeAddress','bmHomeBuilding','bmOtherLoc','bmPrice','bmNotes','bmStampReward','bmDepositOverride','bmRewardOverride','bmCashAmount'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
      setReceiptBtn(false);
      if (bel('bmTransport')) bel('bmTransport').value = '0';  // select化: 「なし(¥0)」がデフォルト
      loadCustomerHistory(null);
      // デフォルト: キャンペーン割引ON・深夜料金OFF
      const lateCb = bel('bmLateNight');
      if (lateCb) lateCb.checked = false;
      const campCbNew = bel('bmCampaign');
      if (campCbNew) campCbNew.checked = false;   // アドミではキャンペーン割引を使わない
      syncCampaignFieldVisibility();
      const hfCbNew = bel('bmHotelFirst');
      if (hfCbNew) hfCbNew.checked = false;
      syncFreeHotelWrap();
      const p10New = bel('bmPlus10');
      if (p10New) p10New.checked = false;
      bmPlus10Touched[activeBmSuffix] = false;
      setBmOptionIds([]);
      resetBmCust();
      try { syncDealBadges(); } catch (_) {}
      updateBookingTotal();
      const mainRegion = document.querySelector(`input[name="bmCityRegion${activeBmSuffix}"][value="main"]`);
      if (mainRegion) { mainRegion.checked = true; populateCitySelect('main'); }
      bel('bmCity').value = '';
      populateHotelSelect('');
      loadBmTowns();   // 市区町村が空になったので町名プルダウンも隠す
      switchLocSection('loveho');   // 新規予約の既定はラブホタブ（店長指定 2026-08-08）
      renderPastAddrSelect(activeBmSuffix, [], '');   // 前のお客様の住所候補を残さない
      const usualNote = bel('bmUsualLocNote');
      if (usualNote) usualNote.style.display = 'none';
      bel('bmDate').value = prefill?.date || fmtDate(getBusinessDayDate());  // 日付欄は営業日基準（深夜0-10時は前営業日）。保存時に開始時刻からカレンダー日へ変換
      bel('bmCancelType').value = 'customer';
      bel('bmCancelReason').value = '';
      setMoney('bmCancelFee', '');
      setMoney('bmCancelReward', '');
      bel('bmCancelWrap').style.display = 'none';
      // 開始時刻。タイムラインの枠から作った場合はその時刻、そうでなければ
      // 「今日なら現在時刻／別の日なら10:00」を既定にする
      const def = defaultStartFor(bel('bmDate').value);
      const sh = prefill?.startHour ?? def.h;
      const sm = prefill?.startMin ?? def.m;
      bel('bmStartHour').value = sh;
      bel('bmStartMin').value = sm;
      bmStartTouched[activeBmSuffix] = false;
      setBookingNg(null);   // 前に開いたお客様のNG警告が残らないように
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
      { const tw = bel('bmTowelLent'); if (tw) tw.checked = false; }
      renderBmLendState(null);
      setBmMedia('');   // 媒体・予約経路は既定で未チェック
      // デフォルト: 担当キャスト未割当なら「問合せ」、既に割当済み(タイムラインの担当行から作成)なら「予約」
      bmKeptStatus[activeBmSuffix] = null;
      bel('bmStatus').value = prefill?.adminId ? 'reserved' : 'inquiry';
      bel('bmSub').textContent = '';
      fillPrepFields(null);
    }
    const modalId = 'bookingModal' + activeBmSuffix;
    // 最小化中なら復元してから表示
    const m = document.getElementById(modalId);
    if (m?.classList.contains('minimized')) {
      m.classList.remove('minimized');
      document.querySelector(`#minDock [data-restore="${modalId}"]`)?.remove();
    }
    try { syncBmDateDisp(); } catch (e) {}
    // フッターの予約内容サマリーを全項目セット後に反映（編集時は場所・料金が updateEndTime より後に入るため）
    try { updateFooterStatus(); } catch (e) {}
    // 「直前」ボタンの出し入れは全項目が入ってから判定する。
    // 住所パネルは担当キャストより先に描かれるので、描画時だけの判定では常に「無し」になっていた
    try { refreshPrevJobButtons(); } catch (e) {}
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
    ['bmHotelFirstField','bmStampField','bmLateNightField','bmMediaField','bmOptionField'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = checked ? 'none' : 'flex';
    });
    // スタンプ特典と深夜料金は2列のラッパーに入っている。中身だけ隠すと枠の余白が残るので箱ごと消す
    const stampRow = document.getElementById('bmStampLateRow' + activeBmSuffix) || document.getElementById('bmStampLateRow');
    if (stampRow) stampRow.style.display = checked ? 'none' : 'grid';
    if (checked) { const cf = bel('bmCampaignField'); if (cf) cf.style.display = 'none'; } else { syncCampaignFieldVisibility(); }
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
      setText('odGo', b.driver_name ? `${b.driver_name}${go ? '（' + go + '）' : ''}` : 'キャスト');
      setText('odBack', b.back_driver_name ? `${b.back_driver_name}${back ? '（' + back + '）' : ''}` : 'キャスト');

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

      // キャスト個別のお客様メモ（本人専用・お客様に紐づく）。キャストかつ顧客が特定できるときだけ出す
      const cnRow = document.getElementById('odCastNoteRow');
      if (cnRow) {
        const canNote = currentUser?.role === 'staff' && b.customer_id;
        cnRow.style.display = canNote ? '' : 'none';
        if (canNote) {
          const ta = document.getElementById('odCastNote');
          if (ta) {
            ta.value = '';
            api('/customers.php?action=cast-note&customer_id=' + b.customer_id)
              .then(r => { ta.value = r.note || ''; }).catch(() => {});
          }
          const saveBtn = document.getElementById('odCastNoteSave');
          if (saveBtn) saveBtn.onclick = async () => {
            try {
              await apiPost('/customers.php?action=cast-note-save', { customer_id: b.customer_id, note: ta?.value || '' });
              toast('✓ メモを保存しました', 'ok');
            } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
          };
        }
      }

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
    if (!await opsConfirm('この予約を「接客完了」にしますか？')) return;
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
    const _hf = Number(b.hotel_first_discount) || 0;
    if (_hf > 0) lines.push(`🏨ホテル料金: -¥${_hf.toLocaleString()}`);
    if (b.price && (_trans > 0 || _disc > 0 || _stamp > 0 || _hf > 0)) lines.push(`合計: ¥${(Number(b.price) + _trans - _disc - _stamp - _hf).toLocaleString()}`);
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
  function buildCustomerBookingText(b) {
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
    if (b.therapist_name) lines.push(`■ キャスト：${b.therapist_name}`);   // 日時の次に置く（店長指定 2026-08-22）
    const nomLabelTxt = { first: '初指名', regular: '本指名', free: 'フリー' }[b.nomination_type] || '';
    if (nomLabelTxt) lines.push(`■ 指名方法：${nomLabelTxt}`);
    if (b.course_name) lines.push(`■ コース：${b.course_name}${String(b.media || '').split(',').includes('line') ? ' ＋ LINE予約特典10分（無料）' : ''}${b.extension_count ? ` ＋ 延長${b.ext_unit_min || 30}分×${b.extension_count}` : ''}`);
    if (b.media) lines.push(`■ 媒体：${mediaLabels(b.media)}`);
    const priceNum = Number(b.price) || 0;
    const transNum = (b.transport_fee != null && b.transport_fee !== '') ? Number(b.transport_fee) : 0;
    const discNum = Number(b.discount) || 0;
    const nomNum = Number(b.nomination_fee) || 0;
    if (priceNum) lines.push(`■ 料金：¥${priceNum.toLocaleString()}`);   // （税込）表記は付けない（店長指定 2026-08-22）
    if (nomNum > 0) lines.push(`■ 指名料：¥${nomNum.toLocaleString()}`);   // 店長要望 2026-08-22
    if (transNum > 0) lines.push(`■ 交通費：¥${transNum.toLocaleString()}`);
    if (discNum > 0) lines.push(`■ キャンペーン割引：-¥${discNum.toLocaleString()}`);
    const stampNum = Number(b.stamp_discount) || 0;
    if (stampNum > 0) lines.push(`■ スタンプ特典：-¥${stampNum.toLocaleString()}`);
    const hfNum = Number(b.hotel_first_discount) || 0;
    if (hfNum > 0) lines.push(`■ ホテル料金：-¥${hfNum.toLocaleString()}`);
    if (priceNum && (nomNum > 0 || transNum > 0 || discNum > 0 || stampNum > 0 || hfNum > 0)) {
      lines.push(`■ 合計：¥${(priceNum + nomNum + transNum - discNum - stampNum - hfNum).toLocaleString()}`);
    }
    // 訪問先 (内部プレフィックスは外して表示)
    const hotel = b.hotel_name_snapshot || b.hotel_name || '';
    if (hotel) {
      // 行き先に合わせて見出しを変える（ご自宅／ホテル）。その他はこれまでどおり「訪問先」
      let loc = hotel, locLabel = 'ホテル';
      if (hotel.startsWith(HOME_PREFIX)) { loc = hotel.replace(HOME_PREFIX, ''); locLabel = 'ご自宅'; }
      else if (hotel.startsWith(OTHER_PREFIX)) { loc = hotel.replace(OTHER_PREFIX, ''); locLabel = '訪問先'; }
      lines.push(`■ ${locLabel}：${loc}${b.room_number ? ' ' + b.room_number + '号室' : ''}`);
    }
    lines.push('');
    lines.push('当日はどうぞよろしくお願いいたします。');
    // ご案内文・スタンプカード・店舗の署名は入れない（店長指定 2026-08-22）。
    // 予約内容だけを渡し、あいさつはスタッフがその場の言葉で添える
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
    let courseName = bmCourseName(courseOpt);
    if (courseSel?.value === 'custom') courseName = `カスタム ${bel('bmCustomMin').value}分`;
    const locType = document.querySelector(`input[name="bmLocType${activeBmSuffix}"]:checked`)?.value
      || document.querySelector('input[name="bmLocType"]:checked')?.value || 'hotel';
    let hotelSnap = '';
    let roomNum = '';
    if (isHotelLoc(locType)) {
      const hid = bel('bmHotelId').value;
      if (hid) {
        const h = hotelsForSelect.find(x => Number(x.id) === Number(hid));
        hotelSnap = h ? h.name : '';
      } else {
        hotelSnap = bel('bmHotelName').value.trim();
      }
      if (!hotelSnap) hotelSnap = undecidedVenueName(locType);   // 未定のときは「立川市ラブホテル」
      roomNum = bel('bmRoom').value.trim();
    } else if (locType === 'home') {
      const addr = bel('bmHomeAddress').value.trim();
      const bld = bel('bmHomeBuilding').value.trim();
      hotelSnap = HOME_PREFIX + joinAddressBuilding(addr, bld);
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
      nomination_type: bel('bmNomination')?.value || null,
      nomination_fee: nominationFeeTotal(),
      discount: campaignDiscount(baseForCopy),
      stamp_discount: stampDiscount(baseForCopy - campaignDiscount(baseForCopy)),
      hotel_first_discount: hotelFirstDiscount(),
      transport_fee: bel('bmTransport').value,
      hotel_name_snapshot: hotelSnap,
      room_number: roomNum,
      therapist_name: therapistName,
    };
    // 文面にスタンプカードの案内は入れないので、会員URLの発行もしない（店長指定 2026-08-22）
    const text = buildCustomerBookingText(b);
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
    let courseName = bmCourseName(courseOpt);
    if (courseSel?.value === 'custom') courseName = `カスタム ${bel('bmCustomMin').value}分`;
    // 訪問先文字列構築
    const locType = document.querySelector('input[name="bmLocType"]:checked')?.value || 'hotel';
    let hotelSnap = '';
    let roomNum = '';
    if (isHotelLoc(locType)) {
      const hid = bel('bmHotelId').value;
      if (hid) {
        const h = hotelsForSelect.find(x => Number(x.id) === Number(hid));
        hotelSnap = h ? h.name : '';
      } else {
        hotelSnap = bel('bmHotelName').value.trim();
      }
      if (!hotelSnap) hotelSnap = undecidedVenueName(locType);   // 未定のときは「立川市ラブホテル」
      roomNum = bel('bmRoom').value.trim();
    } else if (locType === 'home') {
      const addr = bel('bmHomeAddress').value.trim();
      const bld = bel('bmHomeBuilding').value.trim();
      hotelSnap = HOME_PREFIX + joinAddressBuilding(addr, bld);
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
    const hfForCopy = hotelFirstDiscount();
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
    const lockSt = _bmLock[activeBmSuffix];
    if (lockSt && lockSt.readonly) { toast('別の端末が編集中のため保存できません（読み取り専用）', 'err'); return; }
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
    let courseName = bmCourseName(opt);
    if (courseSelect.value === 'custom') courseName = `カスタム${totalMin}分`;
    if (isBreak) courseName = '休憩';
    // ロケーション処理
    let hotelId = null;
    let hotelSnapshot = '';
    let roomNumber = '';
    let displayCity = null;
    if (!isBreak) {
      const locType = document.querySelector('input[name="bmLocType"]:checked')?.value || 'hotel';
      // ラブホもホテルと同じ欄・同じ保存（違うのは選べる一覧だけ）
      if (isHotelLoc(locType)) {
        hotelId = bel('bmHotelId').value || null;
        hotelSnapshot = bel('bmHotelName').value.trim();
        // 一覧からも選ばず手入力も無い＝「ホテルは未定」。市区町村だけで場所を残す
        if (!hotelId && !hotelSnapshot) hotelSnapshot = undecidedVenueName(locType);
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
        hotelSnapshot = HOME_PREFIX + joinAddressBuilding(addr, bld);
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
      hotel_price_applied: (!isBreak && bel('bmHotelFirst')?.checked) ? 1 : 0,
      // 接客完了の予約を「予約」と表示しているだけなので、そのまま保存されたら元に戻す
      //（キャンセル等に変えたときはその値を使う）
      status: (isBreak || bel('bmStatus').value === 'break')
        ? 'confirmed'
        : (bmKeptStatus[activeBmSuffix] === 'completed' && bel('bmStatus').value === 'reserved'
            ? 'completed'
            : String(bel('bmStatus').value).split(':')[0]),
      cancellation_reason_type: bmIsCancel(bel('bmStatus').value) && !isBreak ? bmCancelKindOf(bel('bmStatus').value) : null,
      cancellation_reason: bmIsCancel(bel('bmStatus').value) && !isBreak ? bel('bmCancelReason').value : null,
      cancellation_fee: bmIsCancel(bel('bmStatus').value) && bmCancelKindOf(bel('bmStatus').value) === 'customer' && !isBreak ? moneyVal('bmCancelFee') : null,
      cancellation_reward: bmIsCancel(bel('bmStatus').value) && bmCancelKindOf(bel('bmStatus').value) === 'customer' && !isBreak ? moneyVal('bmCancelReward') : null,
      // 事前予約のお約束（出勤確認の連絡・到着見込みの連絡）。休憩には無い
      ...(isBreak ? {} : prepPayload()),
      price: (() => {
        if (isBreak) return 0;
        // 預り金の手入力があれば自動計算をまるごと上書き（交通費込み・微調整用）
        const depositRaw = String(bel('bmDepositOverride')?.value || '').replace(/[^\d]/g, '');
        if (depositRaw !== '') return parseInt(depositRaw, 10) || 0;
        // コース料金欄が空ならコースマスタの基本料金で補完
        let base = parseInt(String(bel('bmPrice').value || '').replace(/[^\d]/g, ''), 10) || 0;
        if (!base) base = parseInt(opt?.dataset?.price || '0', 10) || 0;
        const late = bel('bmLateNight')?.checked ? LATE_NIGHT_FEE : 0;
        const nomFee = nominationFeeTotal();
        const disc = campaignDiscount(base);
        const stamp = stampDiscount(base - disc);
        return base + late + extAmount() + nomFee + optionTotal() - disc - stamp - hotelFirstDiscount();  // コース + 深夜 + 延長 + 指名料 + オプション − 各割引
      })(),
      late_fee: isBreak ? 0 : (bel('bmLateNight')?.checked ? LATE_NIGHT_FEE : 0),
      // 預り金の手入力があれば交通費込みで上書きするため、交通費は0にして二重計上を防ぐ
      transport_fee: isBreak ? 0 : (String(bel('bmDepositOverride')?.value || '').replace(/[^\d]/g, '') !== '' ? 0 : bel('bmTransport').value),
      extension_count: isBreak ? 0 : extCount(),
      payment_method: isBreak ? null : (bel('bmPayment')?.value || null),
      // クレジットのときお客様の合計に上乗せした手数料。合計 = price + transport_fee + card_fee
      // 併用(split)は「カードで切る額」にだけ上乗せする（cardSurcharge が判定する）
      card_fee: (() => {
        if (isBreak || !['credit', 'split'].includes(bel('bmPayment')?.value)) return 0;
        const depositRaw = String(bel('bmDepositOverride')?.value || '').replace(/[^\d]/g, '');
        if (depositRaw !== '') return 0;   // 手入力の預り金＝それが最終額なので上乗せしない
        const base = parseInt(String(bel('bmPrice').value || '').replace(/[^\d]/g, ''), 10) || 0;
        const late = bel('bmLateNight')?.checked ? LATE_NIGHT_FEE : 0;
        const nomFee = nominationFeeTotal();
        const disc = campaignDiscount(base);
        const stamp = stampDiscount(base - disc);
        const trans = parseInt(String(bel('bmTransport').value || '').replace(/[^\d]/g, ''), 10) || 0;
        return cardSurcharge(base + trans + late + extAmount() + nomFee + optionTotal() - disc - stamp - hotelFirstDiscount());
      })(),
      // 併用のとき現金で受け取る額。併用以外は null（サーバ側でも同じ判定をしている）
      cash_amount: (!isBreak && bel('bmPayment')?.value === 'split') ? bmCashAmount() : null,
      card_paid: isBreak ? false : !!bel('bmCardPaid')?.checked,
      // 領収証が必要なお客様（タイムラインで🧾が点滅する）
      receipt_needed: isBreak ? 0 : (bel('bmReceiptNeeded')?.value === '1' ? 1 : 0),
      nomination_type: isBreak ? null : (bel('bmNomination')?.value || null),
      nomination_fee: isBreak ? 0 : nominationFeeTotal(),
      media: isBreak ? '' : getBmMedia().join(','),
      menu_items: isBreak ? '' : optionText(),
      towel_lent: isBreak ? 0 : (bel('bmTowelLent')?.checked ? 1 : 0),   // バスタオル貸出（店長要望 2026-08-16）
      plus10: isBreak ? false : lineBonusExtra() > 0,
      notes: isBreak ? ('[休憩] ' + bel('bmNotes').value).trim() : bel('bmNotes').value,

      reward_override: (() => {
        const raw = String(bel('bmRewardOverride')?.value || '').replace(/[^\d]/g, '');
        return raw !== '' ? parseInt(raw, 10) : null;
      })(),
    };
    // NGのお客様・NGキャストの組み合わせは、保存の直前にもう一度確認する（登録自体は止めない）
    const ng = bmNg[activeBmSuffix];
    if (!isBreak && ng) {
      const warn = [];
      if (Number(ng.level) > 0) warn.push(`${Number(ng.level) === 2 ? '出禁' : '要注意'}のお客様です${ng.reason ? '（' + ng.reason + '）' : ''}`);
      const aId = Number(bel('bmAdminId').value || 0);
      if (aId && (ng.castIds || []).map(Number).includes(aId)) {
        warn.push(`${findStaffUser(aId)?.display_name || '担当キャスト'} はこのお客様NGです`);
      }
      if (warn.length && !await opsConfirm('⚠️ ' + warn.join('\n⚠️ ') + '\n\nこのまま登録しますか？')) return;
    }
    try {
      const editId = getEditingBookingId();
      if (editId) {
        await apiPost('/bookings.php?action=update', { id: editId, expected_updated_at: _bmLoadedUpdatedAt[activeBmSuffix] || '', ...payload });
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
    if (!await opsConfirm('この予約を削除しますか？')) return;
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
  // ===== NG登録 =====
  // 出禁/要注意（お店として受けるか）と、キャスト別NG（この客にこの女性を出さない）の2本立て。
  // これまで「お客様メモ」に文章で書いていたため、予約を取る瞬間に気づけなかった。
  const NG_LABEL = { 1: '要注意', 2: '出禁' };

  /** 一覧の名前の右に出すバッジ */
  function ngBadges(c) {
    const lv = Number(c.ng_level || 0);
    const casts = Number(c.ng_cast_count || 0);
    let out = '';
    if (lv > 0) out += `<span class="ng-badge lv${lv}">${NG_LABEL[lv]}</span>`;
    if (casts > 0) out += `<span class="ng-badge cast">キャストNG ${casts}</span>`;
    return out;
  }

  let cmNgCasts = [];   // [{cast_admin_id, display_name}] 編集中のNGキャスト

  function renderCmNgCasts() {
    const box = document.getElementById('cmNgCastList');
    if (!box) return;
    box.innerHTML = cmNgCasts.map(n => `
      <span class="ng-chip">${escapeHtml(n.display_name || '(不明)')}
        <button type="button" data-ng-cast-remove="${n.cast_admin_id}" aria-label="外す">×</button>
      </span>`).join('');
    box.querySelectorAll('[data-ng-cast-remove]').forEach(b => {
      b.addEventListener('click', () => {
        const id = Number(b.dataset.ngCastRemove);
        cmNgCasts = cmNgCasts.filter(n => Number(n.cast_admin_id) !== id);
        renderCmNgCasts();
        populateCmNgCastSelect();
      });
    });
  }

  /** 追加プルダウン: 既にNGにしているキャストは出さない */
  function populateCmNgCastSelect() {
    const sel = document.getElementById('cmNgCastAdd');
    if (!sel) return;
    const taken = new Set(cmNgCasts.map(n => Number(n.cast_admin_id)));
    const casts = (adminUsersAll || []).filter(u => isTherapistCapable(u) && !taken.has(Number(u.id)));
    sel.innerHTML = '<option value="">＋ キャストを追加</option>'
      + casts.map(u => `<option value="${u.id}">${escapeHtml(u.display_name || u.username || '')}</option>`).join('');
  }

  /** 区分に応じて理由欄と枠の色を出し分ける */
  function syncCmNgBox() {
    const lv = Number(document.getElementById('cmNgLevel')?.value || 0);
    const reason = document.getElementById('cmNgReasonField');
    const box = document.getElementById('cmNgBox');
    if (reason) reason.style.display = lv > 0 ? '' : 'none';
    if (box) box.classList.toggle('is-ng', lv === 2);
  }

  async function loadCustomers() {
    const el = document.getElementById('customerList');
    el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';
    const kw = document.getElementById('cuKeyword').value.trim();
    const sort = document.getElementById('cuSort')?.value || 'recent';
    const ng = document.getElementById('cuNg')?.value || '';
    const vd = document.getElementById('cuVisitDate')?.value || '';
    const clr = document.getElementById('cuVisitClear');
    if (clr) clr.style.display = vd ? '' : 'none';
    try {
      const d = await api('/customers.php?action=list&sort=' + sort
        + (ng ? '&ng=' + ng : '')
        + (vd ? '&visit_date=' + encodeURIComponent(vd) : '')
        + (kw ? '&keyword=' + encodeURIComponent(kw) : ''));
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
      // 行き先: 住所があれば住所、無ければ直近に使ったホテル（自宅派遣かホテルかが一目で分かる）
      const loc = (c.default_location || '').trim()
        ? `🏠 ${escapeHtml(c.default_location.trim())}`
        : ((c.last_hotel || '').trim() ? `🏨 ${escapeHtml(c.last_hotel.trim())}` : '');
      return `
      <div class="cu-row" data-customer-id="${c.id}">
        <div class="cu-name">${escapeHtml(c.name)}${c.name_kana ? `<span class="kana">${escapeHtml(c.name_kana)}</span>` : ''}${ngBadges(c)}</div>
        <div class="cu-contact">${c.phone ? '📞 ' + escapeHtml(c.phone) : ''} ${c.email ? '✉️ ' + escapeHtml(c.email) : ''}${last ? `<span class="cu-last">最終 ${escapeHtml(last)}</span>` : ''}${loc ? `<div class="cu-loc">${loc}</div>` : ''}</div>
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
    await ensureSelectsLoaded();   // NGキャストの選択肢に adminUsersAll が要る
    document.getElementById('cmTitle').textContent = id ? '顧客編集' : '新規顧客';
    // キャストのお客様メモ（内勤スタッフ以上のみ）。開くたびに取り直す
    const cnWrap = document.getElementById('cmCastNotes');
    if (cnWrap) {
      cnWrap.style.display = 'none';
      if (id && currentUser?.role !== 'staff') {
        api('/customers.php?action=cast-note&customer_id=' + id).then(r => {
          const list = r.notes || [];
          const logs = r.logs || [];
          if (!list.length && !logs.length) return;
          // 日付は「そのご利用の営業日」。時刻は先頭ゼロなし
          const ymd = (s) => {
            const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
            return m ? `${m[1]}/${+m[2]}/${+m[3]}` : '';
          };
          const stamp = (s) => {
            const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
            return m ? `${m[1]}/${+m[2]}/${+m[3]} ${+m[4]}:${m[5]}` : '';
          };
          const ACT = { create: '登録', update: '修正', delete: '削除' };
          const listEl = document.getElementById('cmCastNotesList');
          if (listEl) listEl.innerHTML = (list.map(n =>
            `<div style="padding:.45rem .6rem;border:1px solid var(--gray);border-radius:8px;margin-bottom:.4rem;background:#fbfcfb;">
               <b style="color:var(--deep);">${escapeHtml(n.cast_name || '(退職キャスト)')}</b>
               <span style="font-size:.72rem;color:var(--ink-soft);margin-left:.4rem;">ご利用 ${escapeHtml(ymd(n.used_at))}</span>
               <span style="font-size:.72rem;color:var(--ink-soft);margin-left:.4rem;">最終更新 ${escapeHtml(stamp(n.updated_at))}</span>
               <div style="margin-top:.2rem;white-space:pre-wrap;">${escapeHtml(n.note || '')}</div>
             </div>`).join('')
            // キャストが登録・修正・削除した記録。消したメモの中身もここに残る（店長要望 2026-08-16）
            + (logs.length
              ? `<details style="margin-top:.5rem;"><summary style="cursor:pointer;color:var(--ink-soft);">メモの操作記録（${logs.length}件）</summary>`
                + logs.map(l =>
                  `<div style="padding:.4rem .6rem;border-left:3px solid var(--gray);margin:.35rem 0 .35rem .2rem;">
                     <b style="color:var(--deep);">${escapeHtml(l.cast_name || '(退職キャスト)')}</b>
                     <span style="margin-left:.4rem;">${escapeHtml(ACT[l.action] || l.action)}</span>
                     <span style="font-size:.72rem;color:var(--ink-soft);margin-left:.4rem;">${escapeHtml(stamp(l.created_at))}</span>
                     ${l.before_note ? `<div style="margin-top:.15rem;white-space:pre-wrap;color:#a55;text-decoration:line-through;">${escapeHtml(l.before_note)}</div>` : ''}
                     ${l.after_note ? `<div style="margin-top:.15rem;white-space:pre-wrap;">${escapeHtml(l.after_note)}</div>` : ''}
                   </div>`).join('')
                + '</details>'
              : ''));
          cnWrap.style.display = '';
        }).catch(() => {});
      }
    }
    document.getElementById('cmDelete').style.display = id && currentUser?.role !== 'staff' ? 'inline-flex' : 'none';
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
        document.getElementById('cmNgLevel').value = String(c.ng_level || 0);
        document.getElementById('cmNgReason').value = c.ng_reason || '';
        renderCustomerReports(id);   // キャストからの報告（このお客様ぶん）
        cmNgCasts = (d.ng_casts || []).map(n => ({ cast_admin_id: Number(n.cast_admin_id), display_name: n.display_name }));
        syncCmNgBox();
        renderCmNgCasts();
        populateCmNgCastSelect();
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
      ['cmName','cmKana','cmPhone','cmPhone2','cmEmail','cmGender','cmLocation','cmLocation2','cmNotes','cmNgReason'].forEach(i => document.getElementById(i).value = '');
      document.getElementById('cmNgLevel').value = '0';
      cmNgCasts = [];
      syncCmNgBox();
      renderCmNgCasts();
      populateCmNgCastSelect();
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
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const i = Number(btn.dataset.delPledge);
        if (await opsConfirm('この誓約書画像を削除しますか？（保存ボタンで確定）')) {
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
      ng_level: Number(document.getElementById('cmNgLevel').value || 0),
      ng_reason: document.getElementById('cmNgReason').value,
      ng_cast_ids: cmNgCasts.map(n => Number(n.cast_admin_id)),
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
    if (!editingCustomerId || !await opsConfirm('この顧客を削除しますか？\n過去の予約データは残りますが顧客情報は失われます。')) return;
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
    const bulkBar = document.getElementById('shBulk');
    if (bulkBar) bulkBar.style.display = mode === 'timetable' ? '' : 'none';
    document.getElementById('shCalendar').style.display = mode === 'calendar' ? '' : 'none';
    // スタッフフィルタの「全スタッフ」オプションは表示モードで出し分け
    //   - タイムテーブル: 1日1行で1人分しか登録できないので「全スタッフ」非表示
    //   - カレンダー: 全員のシフトをピル表示できるので「全スタッフ」表示
    syncShiftStaffFilterForMode();
    // モード切替時は今日基準にリセット (起点が日/月で意味が違うので)
    shCurrent = getBusinessDayDate();   // 月表示も 10:00 で切り替え（深夜は前営業日の月）
    loadShifts();
  }

  function syncShiftStaffFilterForMode() {
    const sel = document.getElementById('shStaffFilter');
    if (!sel) return;
    const allOpt = sel.querySelector('option[value=""]');
    if (!allOpt) return;
    // タイムテーブルは「全スタッフ＝一覧グリッド」「個人＝1人ぶんの編集」の2通り。
    // 以前は全スタッフを隠して必ず1人に絞っていたが、CTRLの女性出勤表と同じ一覧が欲しいとの店長要望で開放（2026-08-09）
    allOpt.textContent = shViewMode === 'timetable' ? '📊 全スタッフ一覧' : '全スタッフ';
    allOpt.style.display = '';
    allOpt.disabled = false;
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

  // 他のスタッフのシフトを組めるか。制限はメニューのチェックだけ（店長指定 2026-08-15）。
  // キャストの出勤は CTRL の出勤管理が正なので、キャスト本人は自分ぶんのみ（API opsCanManageShifts と揃える）
  const canManageShifts = () => currentUser?.role !== 'staff' && userCanSeeTab('shifts');

  async function loadShifts() {
    // 一度作ったら作り直さない作りだと、古い一覧（キャストが混ざった状態）が残るので毎回組み直す
    if (canManageShifts()) {
      try {
        // staff-list は全ロールで使える（admin-users は owner 限定なので manager/office で 403 になる）
        const d = await api('/admin-api.php?action=staff-list');
        // キャストの出勤は CTRL(/ctrl/schedules.php)が正なのでここには出さない。
        // 権限=キャスト、またはCTRL同期のキャスト(girl_id あり)はどちらも除外する。
        // それ以外（内勤・ドライバー・管理者・オーナー）は全員ここで組む（店長指定 2026-08-07）
        const targets = (d.users || []).filter(u => u.role !== 'staff' && !u.girl_id);
        shStaffList = targets;
        const sel = document.getElementById('shStaffFilter');
        const keep = sel.value;
        sel.style.display = 'inline-block';
        sel.innerHTML = '<option value="">全スタッフ</option>' + targets.map(u => `<option value="${u.id}">${escapeHtml(u.display_name || u.username)}</option>`).join('');
        if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
        syncShiftStaffFilterForMode();
        if (targets.length === 0) {
          const msg = '<div class="view-empty">キャスト以外のスタッフがまだ登録されていません。<br>'
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
      const params = new URLSearchParams({ from: fmtDate(gridStart), to: fmtDate(gridEnd), exclude_casts: '1' });
      if (shSelectedStaff) params.set('admin_id', shSelectedStaff);
      const d = await api('/shifts.php?action=range&' + params.toString());
      shCachedShifts = d.shifts || [];
      renderShiftCalendar(gridStart, gridEnd, shCachedShifts);
      setupShiftBulk();  // カレンダーは複数人ぶんなので「まとめて設定」は隠す
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
    // スタッフ未選択 = 全員ぶんの一覧グリッド（横に10日）。個人を選ぶと従来の1人ぶん編集に切り替わる
    const isGrid = shBulkIsGrid();
    tt.classList.toggle('is-grid', isGrid);

    try {
      const params = new URLSearchParams({ from: fmtDate(start), to: fmtDate(end), exclude_casts: '1' });
      const targetAdminId = isGrid ? '' : (shSelectedStaff || currentUser?.id);
      if (targetAdminId) params.set('admin_id', targetAdminId);
      const d = await api('/shifts.php?action=range&' + params.toString());
      shCachedShifts = d.shifts || [];
      if (isGrid) renderShiftGrid(start, shCachedShifts);
      else renderShiftTimetable(start, shCachedShifts, targetAdminId);
      setupShiftBulk();
    } catch (e) {
      tt.innerHTML = '<div class="view-empty">読み込み失敗</div>';
    }
  }

  // 一覧グリッド: 行=スタッフ / 列=10日。CTRL の女性出勤表と同じ見え方にそろえてある（店長要望 2026-08-09）
  function renderShiftGrid(startDate, shifts) {
    const tt = document.getElementById('shTimetable');
    const todayStr = fmtDate(getBusinessDayDate());
    const WDAY = ['日','月','火','水','木','金','土'];
    const days = [];
    for (let i = 0; i < 10; i++) days.push(addDays(startDate, i));

    const staff = (shStaffList || []).slice();
    if (!staff.length) {
      tt.innerHTML = '<div class="view-empty">キャスト以外のスタッフがまだ登録されていません。</div>';
      return;
    }
    // admin_user_id + 日付 で引けるようにしておく
    const byKey = {};
    (shifts || []).forEach(s => { byKey[s.admin_user_id + '|' + s.shift_date] = s; });
    const isWork = (s) => s && (s.status === 'available' || s.status === 'tentative');
    const hm = (t) => String(t || '').substring(0, 5);
    // 終了が開始以前なら日をまたいでいる（22:00〜翌05:00 など）
    const endLabel = (s) => {
      const st = hm(s.start_time), en = hm(s.end_time);
      // 「ラスト」「未定」は終了時刻を持たない。そのまま比べると空文字が開始より前と見なされ、
      // 「〜翌」だけが出ていた（店長指摘 2026-08-22）
      if (!en) return s.end_open === 'last' ? 'ラスト' : '未定';
      if (s.shift_preset === '24h') return '24H';
      return (en <= st ? '翌' : '') + en;
    };
    // 24H・早番・遅番は時刻ではなく区分の名前で出す（時刻より速く読める・店長要望 2026-08-28）
    const kubunOf = (s) => ({ '24h': '24H', early: '早番', late: '遅番' })[s.shift_preset || ''] || '';
    const roleOf = (u) => u.role === 'owner' ? '' : u.role === 'manager' ? '管理者'
                        : u.role === 'office' ? '内勤' : u.role === 'driver' ? '送迎' : '';

    let head = '<tr><th class="sg-name">スタッフ</th>';
    days.forEach(d => {
      const ds = fmtDate(d);
      const dw = d.getDay();
      const cnt = staff.filter(u => isWork(byKey[u.id + '|' + ds])).length;
      const cls = [dw === 0 ? 'sg-sun' : dw === 6 ? 'sg-sat' : '', ds === todayStr ? 'is-today' : ''].filter(Boolean).join(' ');
      head += `<th class="${cls}">${d.getMonth()+1}/${d.getDate()}<span class="sg-dow">(${WDAY[dw]})</span><span class="sg-num">${cnt}人</span></th>`;
    });
    head += '<th class="sg-total">出勤計</th></tr>';

    let body = '';
    staff.forEach(u => {
      const role = roleOf(u);
      body += `<tr><td class="sg-name"><button type="button" class="sg-who" data-staff="${u.id}">${escapeHtml(u.display_name || u.username)}</button>`
            + (role ? `<span class="sg-role">${role}</span>` : '') + '</td>';
      let work = 0;
      days.forEach(d => {
        const ds = fmtDate(d);
        const s = byKey[u.id + '|' + ds] || null;
        if (isWork(s)) work++;
        const cls = ['sg-c', s ? 's-' + s.status : '', ds === todayStr ? 'is-today' : ''].filter(Boolean).join(' ');
        let inner;
        if (isWork(s)) {
          const kb = kubunOf(s);
          inner = (kb
                    ? `<span class="sg-t sg-kubun">${kb}</span>`
                    : `<span class="sg-t">${hm(s.start_time)}</span><span class="sg-t2">〜${endLabel(s)}</span>`)
                + (s.note ? `<span class="sg-memo" title="${escapeAttr(s.note)}">${escapeHtml(s.note)}</span>` : '');
        } else if (s && s.status === 'off') {
          inner = '休';
        } else {
          inner = '<span class="sg-un">＋</span>';
        }
        body += `<td class="${cls}" data-staff="${u.id}" data-date="${ds}" data-shift-id="${s?.id || ''}" tabindex="0" role="button">${inner}</td>`;
      });
      body += `<td class="sg-total">${work}<small>日</small></td></tr>`;
    });

    tt.innerHTML = `<div class="sh-grid-wrap"><table class="sh-grid"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <div class="sh-grid-legend">
        <span><i class="lg-available"></i>出勤</span>
        <span><i class="lg-tentative"></i>仮</span>
        <span><i class="lg-off"></i>休み</span>
        <span><i class="lg-unreg"></i>未登録（＋）</span>
        <span>マスをクリックで登録・変更／上の「まとめて設定」で選んだスタッフの10日ぶんを一括登録／名前をクリックでその人だけの画面へ</span>
      </div>`;

    // 名前クリック → その人の1人ぶん画面（まとめて設定が使える）へ
    tt.querySelectorAll('.sg-who').forEach(b => {
      b.addEventListener('click', () => {
        const sel = document.getElementById('shStaffFilter');
        if (sel) sel.value = b.dataset.staff;
        shSelectedStaff = b.dataset.staff;
        loadShiftsTimetable();
      });
    });
    // マスクリック → シフト登録/編集モーダル（その人・その日をあらかじめ入れておく）
    tt.querySelectorAll('td.sg-c').forEach(td => {
      const open = () => openShiftModal(td.dataset.shiftId ? Number(td.dataset.shiftId) : null, td.dataset.date, td.dataset.staff);
      td.addEventListener('click', open);
      td.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  // ===== 一括設定（表示中の10日ぶんをまとめて登録）=====
  let _shBulkInit = false;
  function setupShiftBulk() {
    const bar = document.getElementById('shBulk');
    if (!bar) return;
    // タイムテーブル表示のときだけ出す（カレンダーは月表示なので対象外）。
    // 一覧グリッドでも使えるよう、グリッドのときは対象スタッフの選択を横に出す
    bar.style.display = (shViewMode === 'timetable') ? '' : 'none';
    const staffSel = document.getElementById('shBulkStaff');
    if (staffSel) {
      const isGrid = shBulkIsGrid();
      staffSel.style.display = isGrid ? '' : 'none';
      if (isGrid) {
        const keep = staffSel.value;
        staffSel.innerHTML = (shStaffList || []).map(u => `<option value="${u.id}">${escapeHtml(u.display_name || u.username)}</option>`).join('');
        if (keep && [...staffSel.options].some(o => o.value === keep)) staffSel.value = keep;
      }
    }
    if (_shBulkInit) return;
    _shBulkInit = true;
    const fill = (id, opts, sel) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = opts.map(o => `<option value="${o.val}"${o.val === sel ? ' selected' : ''}>${o.label}</option>`).join('');
    };
    fill('shBulkStart', shiftTimeOptions(true), '10:00');
    fill('shBulkEnd', shiftTimeOptions(false), '22:00');

    document.querySelectorAll('#shBulkStatus [data-bulk-status]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#shBulkStatus [data-bulk-status]').forEach(c => c.classList.remove('is-on'));
        chip.classList.add('is-on');
        // 休み・未登録は時間を使わないので入力を伏せる
        const isOff = chip.dataset.bulkStatus === 'off' || chip.dataset.bulkStatus === 'unreg';
        ['shBulk24h', 'shBulkStart', 'shBulkEnd'].forEach(id => {
          const el = document.getElementById(id);
          if (!el) return;
          el.disabled = isOff;
          (el.closest('label') || el).style.opacity = isOff ? '.4' : '1';
        });
      });
    });
    // 24H・早番・遅番のときは時間欄そのものを隠す（決まっているので出す必要がない・店長指定 2026-08-25）
    const shBulkTimeVis = () => {
      const fixed = ['shBulk24h', 'shBulkEarly', 'shBulkLate'].some(id => document.getElementById(id)?.checked);
      ['shBulkStart', 'shBulkTilde', 'shBulkEnd'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = fixed ? 'none' : '';
      });
    };
    [['shBulkEarly', '10:00', '19:00'], ['shBulkLate', '19:00', '10:00']].forEach(([id, st, en]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => {
        if (!el.checked) return;
        ['shBulk24h', 'shBulkEarly', 'shBulkLate'].forEach(o => { if (o !== id) { const x = document.getElementById(o); if (x) x.checked = false; } });
        const ss = document.getElementById('shBulkStart'), es = document.getElementById('shBulkEnd');
        if (ss) { ss.disabled = false; ss.value = st; }
        if (es) { es.disabled = false; es.value = en; }
        // 状態も「出勤」に寄せる（時間を決めた＝出勤）
        document.querySelectorAll('#shBulkStatus [data-bulk-status]').forEach(c => c.classList.toggle('is-on', c.dataset.bulkStatus === 'available'));
        shBulkTimeVis();
      });
      el.addEventListener('change', shBulkTimeVis);
    });
    const cb24 = document.getElementById('shBulk24h');
    if (cb24) cb24.addEventListener('change', () => {
      ['shBulkStart', 'shBulkEnd'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = cb24.checked; });
      if (cb24.checked) {
        ['shBulkEarly', 'shBulkLate'].forEach(o => { const x = document.getElementById(o); if (x) x.checked = false; });
        document.querySelectorAll('#shBulkStatus [data-bulk-status]').forEach(c => c.classList.toggle('is-on', c.dataset.bulkStatus === 'available'));
      }
      shBulkTimeVis();
    });
    shBulkTimeVis();
    document.getElementById('shBulkApply')?.addEventListener('click', applyShiftBulk);
  }

  // まとめて設定が「一覧グリッド（複数人）」を相手にしているか
  const shBulkIsGrid = () => shViewMode === 'timetable' && !shSelectedStaff && canManageShifts();

  async function applyShiftBulk() {
    const isGrid = shBulkIsGrid();
    const targetAdminId = isGrid
      ? (document.getElementById('shBulkStaff')?.value || '')
      : (shSelectedStaff || currentUser?.id);
    if (!targetAdminId) { toast('スタッフを選んでください', 'err'); return; }
    const status = document.querySelector('#shBulkStatus .is-on')?.dataset.bulkStatus || 'available';
    const is24h = document.getElementById('shBulk24h')?.checked;
    const start = is24h ? '10:00' : (document.getElementById('shBulkStart')?.value || '10:00');
    const end = is24h ? '10:00' : (document.getElementById('shBulkEnd')?.value || '22:00');
    const scope = document.getElementById('shBulkDays')?.value || 'all';

    // 画面に出ている10日ぶんを {日付, 既存ID, メモ} に揃える（個人表示=行 / 一覧=その人の列）
    const cells = isGrid
      ? [...document.querySelectorAll(`#shTimetable td.sg-c[data-staff="${targetAdminId}"]`)].map(td => ({
          date: td.dataset.date,
          shiftId: td.dataset.shiftId,
          unreg: !td.dataset.shiftId,
          // 一覧にはメモの入力欄が無いので、既に入っているメモをそのまま引き継ぐ
          note: ((shCachedShifts || []).find(s => String(s.admin_user_id) === String(targetAdminId) && s.shift_date === td.dataset.date)?.note) || '',
        }))
      : [...document.querySelectorAll('#shTimetable .sh-tt-row')].map(row => ({
          date: row.dataset.date,
          shiftId: row.dataset.shiftId,
          unreg: row.classList.contains('is-unreg'),
          note: row.querySelector('.sh-tt-memo')?.value.trim() || '',
        }));
    const rows = cells.filter(c => {
      const dow = _parseYmd(c.date).getDay();
      if (scope === 'weekday') return dow >= 1 && dow <= 5;
      if (scope === 'weekend') return dow === 0 || dow === 6;
      if (scope === 'unreg') return c.unreg;
      return true;
    });
    if (!rows.length) { toast('対象の日がありません', 'err'); return; }

    const staffName = isGrid
      ? (document.getElementById('shBulkStaff')?.selectedOptions?.[0]?.textContent || 'このスタッフ')
      : (document.getElementById('shStaffFilter')?.selectedOptions?.[0]?.textContent || '自分');
    // 「○ 未登録」はまとめて登録を消す（各行のチップと同じ動き・店長要望 2026-08-16）
    if (status === 'unreg') {
      const targets = rows.filter(r => r.shiftId);
      if (!targets.length) { toast('消す登録がありません', 'err'); return; }
      if (!await opsConfirm(`${staffName} の ${targets.length}日ぶんの登録を消します（未登録に戻す）。よろしいですか？`)) return;
      const delBtn = document.getElementById('shBulkApply');
      if (delBtn) { delBtn.disabled = true; delBtn.textContent = '反映中…'; }
      let dOk = 0; let dNg = 0;
      for (const row of targets) {
        try { await apiPost('/shifts.php?action=delete', { id: Number(row.shiftId) }); dOk++; }
        catch (e) { dNg++; }
      }
      if (delBtn) { delBtn.disabled = false; delBtn.textContent = 'この内容で反映'; }
      toast(dNg ? `${dOk}日を未登録に（${dNg}日は失敗）` : `✓ ${dOk}日ぶんを未登録に戻しました`, dNg ? 'err' : 'ok');
      loadShiftsTimetable();
      return;
    }

    const label = status === 'off' ? '休み' : `${status === 'tentative' ? '仮シフト' : '出勤'} ${is24h ? '24時間' : start + '〜' + end}`;
    if (!await opsConfirm(`${staffName} の ${rows.length}日ぶんを「${label}」にします。\n既に登録済みの日も上書きします。よろしいですか？`)) return;

    const btn = document.getElementById('shBulkApply');
    if (btn) { btn.disabled = true; btn.textContent = '反映中…'; }
    let ok = 0; let ng = 0;
    // 連打で媒体側APIのように詰まらないよう、1件ずつ順番に投げる
    for (const row of rows) {
      const payload = {
        shift_date: row.date,
        start_time: start,
        end_time: end,
        status,
        note: row.note,
        // まとめて設定でチェックした区分も一緒に残す（店長指摘 2026-08-29）
        preset: document.getElementById('shBulk24h')?.checked ? '24h'
              : document.getElementById('shBulkEarly')?.checked ? 'early'
              : document.getElementById('shBulkLate')?.checked ? 'late' : '',
      };
      const existingId = row.shiftId ? Number(row.shiftId) : 0;
      if (existingId) payload.id = existingId;
      if (canManageShifts() && targetAdminId) payload.admin_user_id = targetAdminId;
      try { await apiPost('/shifts.php?action=upsert', payload); ok++; }
      catch (e) { ng++; }
    }
    if (btn) { btn.disabled = false; btn.textContent = 'この内容で反映'; }
    toast(ng ? `${ok}日を反映（${ng}日は失敗）` : `✓ ${ok}日ぶんを反映しました`, ng ? 'err' : 'ok');
    loadShiftsTimetable();
  }

  function renderShiftTimetable(startDate, shifts, targetAdminId) {
    const tt = document.getElementById('shTimetable');
    const todayStr = fmtDate(getBusinessDayDate());
    // 24H・早番・遅番のときは「--」を選んでおく（時間は決まっているので出さない・店長指定 2026-08-25）
    const startOpts = [{ val: '', label: '--' }].concat(shiftTimeOptions(true));
    const endOpts = [{ val: '', label: '--' }].concat(shiftTimeOptions(false));
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
      // 「ラスト」「未定」は end_time が空。素で substring すると一覧全体が落ちる（2026-08-16 修正）
      const start = (s && s.start_time) ? s.start_time.substring(0,5) : '10:00';
      const end = (s && s.end_time) ? s.end_time.substring(0,5) : '22:00';
      const note = s?.note || '';
      // 区分は「チェックを選んで保存したもの」だけ。時刻がたまたま同じでも区分にしない
      //（10:00〜19:00 のドライバーが早番になっていた・店長指摘 2026-08-29）
      const pset = s?.shift_preset || '';
      const is24h = isRegistered && pset === '24h';
      const isEarlyShift = isRegistered && pset === 'early';   // 早番
      const isLateShift  = isRegistered && pset === 'late';    // 遅番
      const shPreset = is24h || isEarlyShift || isLateShift;
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
        <label class="sh-tt-24h" title="10:00〜19:00"><input type="checkbox" class="sh-tt-early-cb"${isEarlyShift ? ' checked' : ''}>早番</label>
        <label class="sh-tt-24h" title="19:00〜翌10:00"><input type="checkbox" class="sh-tt-late-cb"${isLateShift ? ' checked' : ''}>遅番</label>
        <select class="sh-tt-start" data-field="start_time"${shPreset?' disabled':''}>${buildOpts(startOpts, shPreset ? '' : start)}</select>
        <select class="sh-tt-end" data-field="end_time"${shPreset?' disabled':''}>${buildOpts(endOpts, shPreset ? '' : end)}</select>
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

    // 時間を入れたら「出勤」にする（未登録・休みのままにしない・店長要望 2026-08-25）
    const shMakeAvailable = (row) => {
      const chipAvail = row.querySelector('.sh-tt-stchip[data-status="available"]');
      if (!chipAvail || chipAvail.classList.contains('is-on')) return;
      row.querySelectorAll('.sh-tt-stchip').forEach(c => c.classList.remove('is-on'));
      chipAvail.classList.add('is-on');
      row.classList.remove('is-unreg', 'is-off-only');
    };
    // 早番 / 遅番: チェックで時間が入り、状態も出勤になる（24Hと同時には選べない）
    [['.sh-tt-early-cb', '10:00', '19:00'], ['.sh-tt-late-cb', '19:00', '10:00']].forEach(([sel, st, en]) => {
      tt.querySelectorAll(sel).forEach(cb => {
        cb.addEventListener('change', () => {
          const row = cb.closest('.sh-tt-row');
          const startSel = row.querySelector('.sh-tt-start');
          const endSel = row.querySelector('.sh-tt-end');
          if (!cb.checked) {                              // 外したら時間欄を触れるように戻すだけ
            startSel.disabled = false; endSel.disabled = false;
            return;
          }
          row.querySelectorAll('.sh-tt-24h-cb, .sh-tt-early-cb, .sh-tt-late-cb').forEach(o => { if (o !== cb) o.checked = false; });
          startSel.value = ''; endSel.value = '';             // 画面は「--」。時刻は保存時に入れる
          startSel.disabled = true; endSel.disabled = true;
          row.classList.remove('is-24h');
          shMakeAvailable(row);
          saveShiftTimetableRow(row, targetAdminId);
        });
      });
    });

    // 24H チェック: ON で 10:00〜翌10:00 固定、プルダウンを disable
    tt.querySelectorAll('.sh-tt-24h-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const row = cb.closest('.sh-tt-row');
        const startSel = row.querySelector('.sh-tt-start');
        const endSel = row.querySelector('.sh-tt-end');
        if (cb.checked) {
          row.querySelectorAll('.sh-tt-early-cb, .sh-tt-late-cb').forEach(o => { o.checked = false; });
          startSel.value = '';
          endSel.value = '';
          startSel.disabled = true;
          endSel.disabled = true;
          row.classList.add('is-24h');
          shMakeAvailable(row);
        } else {
          startSel.disabled = false;
          endSel.disabled = false;
          if (startSel.value === '') startSel.value = '10:00';
          if (endSel.value === '' || endSel.value === '10:00') endSel.value = '22:00';
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
    // 24H・早番・遅番のチェックが入っていれば、その時刻で保存する（画面は「--」表示）
    const presetOf = (r) => r.querySelector('.sh-tt-24h-cb')?.checked ? ['10:00', '10:00']
      : r.querySelector('.sh-tt-early-cb')?.checked ? ['10:00', '19:00']
      : r.querySelector('.sh-tt-late-cb')?.checked ? ['19:00', '10:00'] : null;
    const presetIdOf = (r) => r.querySelector('.sh-tt-24h-cb')?.checked ? '24h'
      : r.querySelector('.sh-tt-early-cb')?.checked ? 'early'
      : r.querySelector('.sh-tt-late-cb')?.checked ? 'late' : '';
    const pre = presetOf(row);
    const presetId = presetIdOf(row);
    const start = pre ? pre[0] : row.querySelector('.sh-tt-start').value;
    const end = pre ? pre[1] : row.querySelector('.sh-tt-end').value;
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
        preset: presetId,
      };
      if (existingId) payload.id = existingId;
      if (canManageShifts() && targetAdminId) payload.admin_user_id = targetAdminId;
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
  /** 個人の色の上に置く文字色。明るい色なら黒寄せ（黄色に白文字だと読めない） */
  function textOnColor(hex) {
    const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || ''));
    if (!m) return '#fff';
    const n = parseInt(m[1], 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.62 ? '#3a2f00' : '#fff';
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
          ${dayShifts.map(s => {
            // 終了は「ラスト」「未定」で end_time が空のことがある。
            // そのまま substring すると全体が落ちてカレンダーが「読み込み失敗」になっていた（2026-08-16 修正）
            const st = hhmm(s.start_time) || '';
            const et = s.end_time ? hhmm(s.end_time) : (s.end_open === 'last' ? 'ラスト' : '未定');
            // 24時間・早番・遅番はその名前で出す（時刻より区分のほうが早く読める・店長要望 2026-08-25）。
            // 判定は保存された区分だけ。時刻がたまたま同じ人は時刻のまま（店長指摘 2026-08-29）
            const shiftLabel = ({ '24h': '24H', early: '早番', late: '遅番' })[s.shift_preset || ''] || `${st}-${et}`;
            // 内勤はスタッフ管理で決めた個人の色、ドライバーは送迎ボタンと同じ黄色（店長指定 2026-08-16）
            const col = /^#[0-9a-fA-F]{6}$/.test(String(s.staff_color || '')) ? String(s.staff_color) : '';
            const style = col ? ` style="background:${escapeAttr(col)};border-color:${escapeAttr(col)};color:${textOnColor(col)};"`
                        : (s.staff_role === 'driver' ? ' style="background:#ffd76a;border-color:#e6b93f;color:#5a4200;"' : '');
            return `<div class="sh-shift-pill s-${s.status}" data-shift-id="${s.id}"${style} title="${escapeAttr(s.staff_name || '')} ${escapeAttr(st)}〜${escapeAttr(et)}">${escapeHtml(s.staff_name || '').substring(0, 4)} ${escapeHtml(shiftLabel)}</div>`;
          }).join('')}
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

  async function openShiftModal(id, date, presetAdminId) {
    editingShiftId = id;
    document.getElementById('smTitle').textContent = id ? 'シフト編集' : 'シフト登録';
    document.getElementById('smDelete').style.display = id ? 'inline-flex' : 'none';

    if (canManageShifts()) {
      document.getElementById('smStaffField').style.display = 'block';
      // 内勤・送迎シフトの画面なので候補はキャストを除いた名簿（shStaffList）。
      // まだ取れていない場合だけ owner 用の admin-users にフォールバックする
      let list = shStaffList;
      if (!list.length) {
        if (adminUsersAll.length === 0 && currentUser?.role === 'owner') {
          try { const d = await api('/admin-api.php?action=admin-users'); adminUsersAll = d.users; } catch (e) {}
        }
        list = adminUsersAll;
      }
      document.getElementById('smStaff').innerHTML = list.map(u => `<option value="${u.id}">${escapeHtml(u.display_name || u.username)}</option>`).join('');
      document.getElementById('smStaff').value = presetAdminId || currentUser.id;
    }

    if (id) {
      try {
        // 表示中のぶんは取得済みなのでまずそこから。無ければ全期間から引く
        let s = (shCachedShifts || []).find(x => Number(x.id) === id);
        if (!s) {
          const d = await api(`/shifts.php?action=range&from=2020-01-01&to=2100-12-31`);
          s = (d.shifts || []).find(x => Number(x.id) === id);
        }
        if (!s) throw new Error('not found');
        document.getElementById('smSub').textContent = s.shift_date + (s.staff_name ? '　' + s.staff_name : '');
        smTimeSet('smStart', s.start_time ? s.start_time.substring(0,5) : '10:00');
        { const mode = s.end_time ? 'time' : (s.end_open === 'last' ? 'last' : 'undecided'); const em = document.getElementById('smEndMode'); if (em) em.value = mode; smTimeSet('smEnd', s.end_time ? s.end_time.substring(0,5) : '22:00'); const wrap = document.getElementById('smEndTimeWrap'); if (wrap) wrap.style.display = mode === 'time' ? '' : 'none'; }
        document.getElementById('smStatus').value = s.status;
        document.getElementById('smNote').value = s.note || '';
        document.getElementById('smStaff').value = s.admin_user_id;
        // 編集時の日付保持
        document.getElementById('smTitle').dataset.date = s.shift_date;
        document.getElementById('smTitle').dataset.preset = s.shift_preset || '';
      } catch (e) { toast('読み込み失敗', 'err'); return; }
    } else {
      const who = (shStaffList || []).find(u => String(u.id) === String(presetAdminId));
      document.getElementById('smSub').textContent = date + (who ? '　' + (who.display_name || who.username) : '');
      smTimeSet('smStart', '');   // 既定は「--」（店長指定 2026-08-25）
      smTimeSet('smEnd', '');
      { const em = document.getElementById('smEndMode'); if (em) em.value = 'time'; const wrap = document.getElementById('smEndTimeWrap'); if (wrap) wrap.style.display = ''; }
      document.getElementById('smStatus').value = 'undecided';   // 既定は未定（店長指定 2026-08-11）
      document.getElementById('smNote').value = '';
      document.getElementById('smTitle').dataset.date = date;
      document.getElementById('smTitle').dataset.preset = '';
    }
    // 24時間・早番・遅番のチェック状態は「保存された区分」だけで決める。
    // 時刻が偶然そろっているだけの人（10:00〜19:00 のドライバー等）は素の時刻のまま（店長指摘 2026-08-29）
    {
      const pset = document.getElementById('smTitle').dataset.preset || '';
      const isAll   = pset === '24h';
      const isEarly = pset === 'early';
      const isLate  = pset === 'late';
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
      set('sm24h', isAll); set('smEarly', isEarly); set('smLate', isLate);
      const fixed = isAll || isEarly || isLate;
      if (fixed) { smTimeSet('smStart', ''); smTimeSet('smEnd', ''); }   // 「--」表示（実時刻はチェックが持つ）
      smTimeSetDisabled('smStart', fixed);
      smTimeSetDisabled('smEnd', fixed);
      try { window._smTimeRowVis && window._smTimeRowVis(); } catch (_) {}
    }
    openModal('shiftModal');
  }
  async function saveShift() {
    const st = document.getElementById('smStatus').value;
    // 未定 = 行を持たない（カレンダーにも出さない）。既に入っていれば消す。
    // キャスト画面の「未定（登録なし）」と同じ扱いにそろえてある（店長指定 2026-08-11）
    if (st === 'undecided') {
      try {
        if (editingShiftId) await apiPost('/shifts.php?action=delete', { id: editingShiftId });
        toast('✓ 未定にしました', 'ok');
        closeModal('shiftModal');
        loadShifts();
      } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
      return;
    }
    let endMode = document.getElementById('smEndMode')?.value || 'time';
    // 24時間・早番・遅番のチェックが入っていれば、その時刻で登録する（画面は「--」のまま）
    const presetId = (typeof window._smActivePreset === 'function') ? window._smActivePreset() : null;
    const preset = presetId ? window._smPresetTimes(presetId) : null;
    let startVal = preset ? preset.start : smTimeGet('smStart');
    let endVal   = preset ? preset.end   : ((endMode === 'time') ? smTimeGet('smEnd') : '');
    if (preset) endMode = 'time';
    // 「--」のままでは出勤として登録できない（開始が無いとカレンダーに置けない）
    if (st !== 'off' && startVal === '') { toast('開始時刻を選んでください', 'err'); return; }
    const payload = {
      shift_date: document.getElementById('smTitle').dataset.date,
      preset: ({ sm24h: '24h', smEarly: 'early', smLate: 'late' })[presetId] || '',
      start_time: startVal,
      // 「時刻を指定」でも「--」のままなら未定として保存する
      end_time: (endMode === 'time' && endVal !== '') ? endVal : '',
      end_open: (endMode === 'time' && endVal !== '') ? '' : (endMode === 'time' ? 'undecided' : endMode),
      status: st,
      note: document.getElementById('smNote').value,
    };
    if (canManageShifts()) payload.admin_user_id = document.getElementById('smStaff').value;
    if (editingShiftId) payload.id = editingShiftId;
    try {
      await apiPost('/shifts.php?action=upsert', payload);
      toast('✓ 保存しました', 'ok');
      closeModal('shiftModal');
      loadShifts();
    } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
  }
  async function deleteShift() {
    if (!editingShiftId || !await opsConfirm('このシフトを削除しますか？')) return;
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
    el.innerHTML = coursesCache.map(c => {
      const bonus = c.bonus_course_id ? coursesCache.find(x => Number(x.id) === Number(c.bonus_course_id)) : null;
      return `
      <div class="bk-row sortable" draggable="true" data-course-id="${c.id}" style="grid-template-columns:auto auto 1fr auto;">
        <div class="drag-handle" title="ドラッグで並び替え">⋮⋮</div>
        <div class="bk-date-col"><div class="bd-date">${c.duration_min}</div><div class="bd-time">分</div></div>
        <div class="bk-info">
          <div class="bi-name">${escapeHtml(c.name)} ${Number(c.is_active) ? '' : '<span style="color:var(--red);font-size:.78rem;">[無効]</span>'}</div>
          <div class="bi-meta">
            ${c.price ? `<span>💴 ¥${Number(c.price).toLocaleString()}</span>` : '<span style="color:var(--ink-soft);">料金未設定</span>'}
            ${c.cast_reward != null && c.cast_reward !== '' ? `<span>💰 報酬 ¥${Number(c.cast_reward).toLocaleString()}</span>` : '<span style="color:var(--ink-soft);">報酬未設定</span>'}
            ${c.hotel_price != null && c.hotel_price !== '' ? `<span style="color:#28468a;">🏨 ホテル ¥${Number(c.hotel_price).toLocaleString()}${c.hotel_cast_reward != null && c.hotel_cast_reward !== '' ? ` / 報酬 ¥${Number(c.hotel_cast_reward).toLocaleString()}` : ''}</span>` : ''}
            ${bonus ? `<span style="color:#0d7a4a;">＋10分時: ${escapeHtml(bonus.name)}</span>` : ''}
            <span>表示順: ${c.sort_order}</span>
          </div>
        </div>
        <button class="btn-edit" data-course-edit="${c.id}">編集</button>
      </div>`;
    }).join('');
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
  /** 「＋10分のときのコース」の選択肢。自分自身と延長は除く */
  function populateBonusCourseSelect(selfId, current) {
    const sel = document.getElementById('coBonusCourse');
    if (!sel) return;
    let html = '<option value="">なし（終了時刻を10分のばすだけ）</option>';
    coursesCache.forEach(c => {
      if (Number(c.id) === Number(selfId) || /延長/.test(c.name)) return;
      html += `<option value="${c.id}">${escapeHtml(c.name)}（${c.duration_min}分${c.price ? ' ¥' + Number(c.price).toLocaleString() : ''}）</option>`;
    });
    sel.innerHTML = html;
    sel.value = current != null && current !== '' ? String(current) : '';
  }

  function openCourseModal(id) {
    editingCourseId = id;
    document.getElementById('coTitle').textContent = id ? 'コース編集' : '新規コース';
    document.getElementById('coDelete').style.display = id && currentUser?.role !== 'staff' ? 'inline-flex' : 'none';
    if (id) {
      const c = coursesCache.find(x => x.id === id);
      if (!c) return;
      document.getElementById('coName').value = c.name || '';
      document.getElementById('coDuration').value = c.duration_min || 60;
      setMoney('coPrice', c.price || '');
      setMoney('coCastReward', c.cast_reward != null ? c.cast_reward : '');
      setMoney('coHotelPrice', c.hotel_price != null ? c.hotel_price : '');
      setMoney('coHotelCastReward', c.hotel_cast_reward != null ? c.hotel_cast_reward : '');
      populateBonusCourseSelect(id, c.bonus_course_id);
      document.getElementById('coIsActive').checked = Number(c.is_active) === 1;
      document.getElementById('coIsCombinable').checked = Number(c.is_combinable) !== 0;
    } else {
      document.getElementById('coName').value = '';
      document.getElementById('coDuration').value = 60;
      setMoney('coPrice', '');
      setMoney('coCastReward', '');
      setMoney('coHotelPrice', '');
      setMoney('coHotelCastReward', '');
      populateBonusCourseSelect(0, '');
      document.getElementById('coIsActive').checked = true;
      document.getElementById('coIsCombinable').checked = true;
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
      bonus_course_id: document.getElementById('coBonusCourse')?.value || '',
      hotel_price: moneyVal('coHotelPrice'),
      hotel_cast_reward: moneyVal('coHotelCastReward'),
      is_active: document.getElementById('coIsActive').checked ? 1 : 0,
      is_combinable: document.getElementById('coIsCombinable').checked ? 1 : 0,
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
    if (!editingCourseId || !await opsConfirm('このコースを削除しますか？\n既存予約のコース名表示には影響しません。')) return;
    try {
      await apiPost('/courses.php?action=delete', { id: editingCourseId });
      toast('✓ 削除しました', 'ok');
      closeModal('courseModal');
      await ensureCoursesLoaded(true);
      renderCourses();
    } catch (e) { toast('削除失敗: ' + e.message, 'err'); }
  }

  // ========== オプション管理（ローター・バイブ等） ==========
  // 予約モーダルで選ぶと合計に加算される。キャスト報酬はオプションごとの固定額（空欄＝店の取り分）。
  let optionsCache = [];
  let optionsLoaded = false;
  let editingOptionId = null;

  async function ensureOptionsLoaded(force) {
    if (optionsLoaded && !force) return;
    try {
      const d = await api('/options.php?action=list&include_inactive=1');
      optionsCache = d.options || [];
      optionsLoaded = true;
      renderBmOptions();
    } catch (e) { optionsCache = []; }
  }

  async function loadOptions() {
    const el = document.getElementById('optionList');
    if (el) el.innerHTML = '<div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>';
    await ensureOptionsLoaded(true);
    renderOptions();
  }

  function renderOptions() {
    const el = document.getElementById('optionList');
    if (!el) return;
    if (optionsCache.length === 0) {
      el.innerHTML = '<div class="view-empty">オプションがありません</div>';
      return;
    }
    el.innerHTML = optionsCache.map(o => `
      <div class="bk-row sortable" draggable="true" data-option-id="${o.id}" style="grid-template-columns:auto 1fr auto;">
        <div class="drag-handle" title="ドラッグで並び替え">⋮⋮</div>
        <div class="bk-info">
          <div class="bi-name">${escapeHtml(o.name)} ${Number(o.is_active) ? '' : '<span style="color:var(--red);font-size:.78rem;">[無効]</span>'}</div>
          <div class="bi-meta">
            <span>💴 ¥${Number(o.price || 0).toLocaleString()}</span>
            ${o.cast_reward != null && o.cast_reward !== '' ? `<span>💰 報酬 ¥${Number(o.cast_reward).toLocaleString()}</span>` : '<span style="color:var(--ink-soft);">報酬なし（店の取り分）</span>'}
            <span>表示順: ${o.sort_order}</span>
          </div>
        </div>
        <button class="btn-edit" data-option-edit="${o.id}">編集</button>
      </div>`).join('');
    el.querySelectorAll('[data-option-edit]').forEach(b => {
      b.addEventListener('click', e => { e.stopPropagation(); openOptionModal(Number(b.dataset.optionEdit)); });
    });
    el.querySelectorAll('.bk-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('button, .drag-handle')) return;
        openOptionModal(Number(row.dataset.optionId));
      });
    });
    setupOptionSortable();
  }

  function setupOptionSortable() {
    const list = document.getElementById('optionList');
    if (!list) return;
    let dragSrc = null;
    list.querySelectorAll('.sortable').forEach(row => {
      row.addEventListener('dragstart', e => {
        dragSrc = row; row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
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
        const ids = [...list.querySelectorAll('.bk-row')].map(r => Number(r.dataset.optionId));
        try { await apiPost('/options.php?action=reorder', { ids }); await ensureOptionsLoaded(true); renderOptions(); }
        catch (err) { toast('並び替えに失敗: ' + err.message, 'err'); }
      });
    });
  }

  function openOptionModal(id) {
    editingOptionId = id || null;
    document.getElementById('opTitle').textContent = id ? 'オプションを編集' : '新規オプション';
    document.getElementById('opDelete').style.display = id ? '' : 'none';
    const o = id ? optionsCache.find(x => x.id === id) : null;
    document.getElementById('opName').value = o ? (o.name || '') : '';
    setMoney('opPrice', o ? (o.price || '') : '');
    setMoney('opCastReward', o && o.cast_reward != null ? o.cast_reward : '');
    document.getElementById('opIsActive').checked = o ? Number(o.is_active) === 1 : true;
    document.getElementById('opIsLendable').checked = o ? Number(o.is_lendable) === 1 : false;
    openModal('optionModal');
  }

  async function saveOption() {
    const name = document.getElementById('opName').value.trim();
    if (!name) { toast('オプション名を入力してください', 'err'); return; }
    const payload = {
      name,
      price: moneyVal('opPrice') || 0,
      cast_reward: moneyVal('opCastReward'),
      is_active: document.getElementById('opIsActive').checked ? 1 : 0,
      is_lendable: document.getElementById('opIsLendable').checked ? 1 : 0,   // 貸出品（店長要望 2026-08-16）
    };
    if (!editingOptionId) {
      payload.sort_order = optionsCache.reduce((m, o) => Math.max(m, Number(o.sort_order || 0)), 0) + 10;
    }
    try {
      if (editingOptionId) {
        await apiPost('/options.php?action=update', { id: editingOptionId, ...payload });
        toast('✓ 更新しました', 'ok');
      } else {
        await apiPost('/options.php?action=create', payload);
        toast('✓ 追加しました', 'ok');
      }
      closeModal('optionModal');
      await ensureOptionsLoaded(true);
      renderOptions();
    } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
  }

  async function deleteOption() {
    if (!editingOptionId || !await opsConfirm('このオプションを削除しますか？\n既存予約に記録済みの内容は消えません。')) return;
    try {
      await apiPost('/options.php?action=delete', { id: editingOptionId });
      toast('✓ 削除しました', 'ok');
      closeModal('optionModal');
      await ensureOptionsLoaded(true);
      renderOptions();
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
  /**
   * 入室方法の並び替え（コース・オプションと同じドラッグ方式）。
   * 2026-08-02 の一括削除で巻き込まれて消えており、renderEntryMethods() の末尾で
   * ReferenceError になって「読み込み失敗」と出ていた（2026-08-05 修復）。
   */
  function setupEntryMethodSortable() {
    const list = document.getElementById('entryMethodList');
    if (!list) return;
    let dragSrc = null;
    list.querySelectorAll('.sortable').forEach(row => {
      row.addEventListener('dragstart', e => {
        dragSrc = row; row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
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
        const ids = [...list.querySelectorAll('.bk-row')].map(r => Number(r.dataset.emId));
        try { await apiPost('/entry-methods.php?action=reorder', { ids }); await loadEntryMethods(); }
        catch (err) { toast('並び替えに失敗: ' + err.message, 'err'); }
      });
    });
  }
  function openEntryMethodModal(id) {
    editingEntryMethodId = id;
    document.getElementById('emaTitle').textContent = id ? '入室方法を編集' : '新規入室方法';
    document.getElementById('emaDelete').style.display = id && currentUser?.role !== 'staff' ? 'inline-flex' : 'none';
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
    if (!editingEntryMethodId || !await opsConfirm('この入室方法を削除しますか？\n既にホテルに設定されている場合、その表示は影響を受けます。')) return;
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

  // ========== 🔒 端末とログイン（スタッフ管理タブの中） ==========
  // CTRL は誰でも開けるので、端末の許可・解除はここに置く（店長要望 2026-08-17）
  const DEV_ROLE_LABEL = { owner: 'オーナー', manager: '店長', staff: 'スタッフ' };

  async function loadDeviceList() {
    const el = document.getElementById('devTable');
    if (!el) return;
    let d;
    try { d = await api('/devices.php?action=list'); }
    catch (e) { el.innerHTML = `<p style="color:var(--coral);">読み込み失敗: ${escapeHtml(e.message)}</p>`; return; }
    // 「n/j H:MM」（時刻は先頭ゼロなし）
    const when = (s) => {
      const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
      return m ? `${+m[2]}/${+m[3]} ${+m[4]}:${m[5]}` : '—';
    };
    el.innerHTML = '<div class="dev-card">' + (d.staff || []).map(s => `
      <div class="dev-row">
        <div>
          <div class="dev-name">${escapeHtml(s.name)}
            <span class="dev-tag ${s.role === 'owner' ? 'is-owner' : ''}">${escapeHtml(DEV_ROLE_LABEL[s.role] || s.role)}</span>
            ${s.granted ? '<span class="dev-tag is-grant">許可中</span>' : ''}
            ${s.dev_count === 0 ? '<span class="dev-tag is-none">端末なし</span>' : ''}
          </div>
          <div class="dev-meta">
            ${s.dev_count ? `端末 ${s.dev_count}台（${s.devices.map(x => escapeHtml(x.name)).join(' / ')}）　最終利用 ${escapeHtml(when(s.dev_last))}`
                          : 'まだ端末がありません。「次のログインを許可」を押してから、本人にログインしてもらってください'}
            <br>最終ログイン ${escapeHtml(when(s.last_login))}
          </div>
        </div>
        <div class="dev-acts">
          ${s.granted
            ? `<button type="button" class="dev-btn" data-dev-grant-cancel="${s.id}">許可を取り消す</button>`
            : `<button type="button" class="dev-btn is-go" data-dev-grant="${s.id}" data-name="${escapeAttr(s.name)}">次のログインを許可</button>`}
          ${s.dev_count ? `<button type="button" class="dev-btn is-danger" data-dev-revoke="${s.id}" data-name="${escapeAttr(s.name)}">端末を全部解除</button>` : ''}
        </div>
      </div>`).join('') + '</div>';

    const post = async (path, body, msg) => {
      try { await apiPost(path, body); toast(msg, 'ok'); await loadDeviceList(); }
      catch (e) { toast('失敗: ' + e.message, 'err'); }
    };
    el.querySelectorAll('[data-dev-grant]').forEach(b => b.addEventListener('click', async () => {
      if (!await opsConfirm(`${b.dataset.name} の次のログインを許可します。\n10分以内にご本人がログインした端末が登録されます。`)) return;
      post('/devices.php?action=grant', { admin_id: Number(b.dataset.devGrant) }, '✓ 次のログインを許可しました');
    }));
    el.querySelectorAll('[data-dev-grant-cancel]').forEach(b => b.addEventListener('click', () => {
      post('/devices.php?action=grant-cancel', { admin_id: Number(b.dataset.devGrantCancel) }, '許可を取り消しました');
    }));
    el.querySelectorAll('[data-dev-revoke]').forEach(b => b.addEventListener('click', async () => {
      if (!await opsConfirm(`${b.dataset.name} の端末をすべて解除します。\n次にログインした端末が新しく登録されます。よろしいですか？`)) return;
      post('/devices.php?action=revoke-user', { admin_id: Number(b.dataset.devRevoke) }, '✓ 端末を解除しました');
    }));
  }

  // ========== 📦 備品 ==========
  // 事務所にある数と、誰に貸しているかを常に出す。黙って無くなるのを防ぐのが目的なので、
  // 貸出中は「誰が・いつから」を必ず見せる（店長要望 2026-08-16）
  let _supData = { items: [], loans: [], users: [] };
  const SUP_ROLE_LABEL = { staff: 'キャスト', driver: 'ドライバー', office: '内勤', manager: '店長', owner: '' };

  function supMsg(text, isErr) {
    const el = document.getElementById('supMsg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-err', !!isErr);
    if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 4000);
  }

  async function loadSupplies() {
    const stockEl = document.getElementById('supStock');
    if (!stockEl) return;
    try {
      _supData = await api('/supplies.php?action=list');
    } catch (e) {
      stockEl.innerHTML = `<p style="color:var(--coral);">読み込み失敗: ${escapeHtml(e.message)}</p>`;
      return;
    }
    renderSupplyStock();
    renderSupplyLoans();
    fillSupplyPickers();
  }

  function renderSupplyStock() {
    const el = document.getElementById('supStock');
    if (!el) return;
    const rows = (_supData.items || []).filter(i => Number(i.is_active) === 1);
    el.innerHTML = `<div class="sup-card">
      <div class="sup-card-head">事務所にある数<small>数字を直すとその場で保存されます</small></div>
      <div class="sup-row head"><div>備品</div><div class="sup-num">事務所</div><div class="sup-num">貸出中</div><div class="sup-num">合計</div></div>
      ${rows.map(i => `<div class="sup-row">
        <div class="sup-name">${escapeHtml(i.name)}
          <span class="sup-kind ${i.kind === 'set' ? 'is-set' : 'is-each'}">${i.kind === 'set' ? 'セット' : '都度'}</span>
        </div>
        <div class="sup-num"><input class="sup-stock-in" type="number" min="0" inputmode="numeric"
          value="${Number(i.stock)}" data-sup-stock="${i.id}"></div>
        <div class="sup-num ${Number(i.lent) ? 'is-lent' : 'is-zero'}">${Number(i.lent)}</div>
        <div class="sup-num">${Number(i.total)}</div>
      </div>`).join('')}
    </div>`;
    el.querySelectorAll('[data-sup-stock]').forEach(inp => {
      inp.addEventListener('change', async () => {
        const id = Number(inp.dataset.supStock);
        const stock = Math.max(0, parseInt(inp.value, 10) || 0);
        try {
          await apiPost('/supplies.php?action=set-stock', { id, stock });
          supMsg('✓ 事務所の数を直しました');
          await loadSupplies();
        } catch (e) { supMsg(e.message || '保存できませんでした', true); }
      });
    });
  }

  function renderSupplyLoans() {
    const el = document.getElementById('supLoans');
    if (!el) return;
    const loans = _supData.loans || [];
    if (!loans.length) {
      el.innerHTML = '<div class="sup-card"><div class="sup-card-head">貸出中</div>'
        + '<div class="sup-empty">いま貸し出している備品はありません</div></div>';
      return;
    }
    // 人ごとにまとめる（誰が何を持ったままかを1か所で見る）
    const byUser = new Map();
    loans.forEach(l => {
      if (!byUser.has(l.admin_user_id)) byUser.set(l.admin_user_id, { name: l.user_name, role: l.user_role, list: [] });
      byUser.get(l.admin_user_id).list.push(l);
    });
    const now = Date.now();
    const daysOf = (s) => {
      const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
      if (!m) return null;
      const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
      return Math.floor((now - t) / 86400000);
    };
    let html = `<div class="sup-card"><div class="sup-card-head">貸出中<small>${loans.length}件</small></div>`;
    byUser.forEach(u => {
      html += `<div class="sup-person">
        <div class="sup-person-name">${escapeHtml(u.name || '(退職)')}
          <span class="role-mini">${escapeHtml(SUP_ROLE_LABEL[u.role] || u.role || '')}</span></div>
        ${u.list.map(l => {
          const d = daysOf(l.lent_at);
          const dayTxt = d === null ? '' : (d === 0 ? '今日から' : `${d}日前から`);
          return `<div class="sup-loan">
            <span class="sup-loan-name">${escapeHtml(l.supply_name)}${Number(l.qty) > 1 ? ` ×${Number(l.qty)}` : ''}</span>
            <span class="sup-loan-days${d !== null && d >= 7 ? ' is-long' : ''}">${escapeHtml(dayTxt)}</span>
            <button type="button" class="sup-ret" data-sup-return="${l.id}">返却</button>
          </div>`;
        }).join('')}
      </div>`;
    });
    html += '</div>';
    el.innerHTML = html;
    el.querySelectorAll('[data-sup-return]').forEach(b => b.addEventListener('click', async () => {
      const id = Number(b.dataset.supReturn);
      const l = (_supData.loans || []).find(x => x.id === id);
      if (!l) return;
      if (!await opsConfirm(`${l.user_name} から ${l.supply_name}${Number(l.qty) > 1 ? ' ×' + l.qty : ''} を返してもらいましたか？`)) return;
      try {
        await apiPost('/supplies.php?action=return', { loan_id: id });
        supMsg('✓ 返却しました');
        await loadSupplies();
      } catch (e) { supMsg(e.message || '戻せませんでした', true); }
    }));
  }

  /** 貸出先に選ばれている人（キャスト側・スタッフ側のどちらか）。両方空なら0 */
  function supSelectedUserId() {
    const c = Number(document.getElementById('supUserCast')?.value || 0);
    const s2 = Number(document.getElementById('supUserStaff')?.value || 0);
    return c || s2 || 0;
  }

  function fillSupplyPickers() {
    // 貸出先は「キャスト」と「スタッフ」で別々のプルダウン（店長要望 2026-08-22）。
    // どちらかを選ぶともう片方は空に戻す＝選び間違いを防ぐ
    const cSel = document.getElementById('supUserCast');
    const sSel = document.getElementById('supUserStaff');
    const iSel = document.getElementById('supItem');
    const qSel = document.getElementById('supQty');
    if (cSel && sSel) {
      const all = _supData.users || [];
      // キャストは入店日の新しい順 → 同じ日は名前順（探しやすさ）
      const casts = all.filter(u => u.role === 'staff').slice().sort((a, b) => {
        const da = String(a.in_date || ''), db = String(b.in_date || '');
        if (da !== db) return db.localeCompare(da);
        return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
      });
      const staffs = all.filter(u => u.role !== 'staff');
      const optOf = (u, withRole) => {
        const r = withRole ? (SUP_ROLE_LABEL[u.role] !== undefined ? SUP_ROLE_LABEL[u.role] : (u.role || '')) : '';
        return `<option value="${u.id}">${escapeHtml(u.name)}${r ? '（' + escapeHtml(r) + '）' : ''}</option>`;
      };
      const keepC = cSel.value, keepS = sSel.value;
      cSel.innerHTML = '<option value="">— キャスト —</option>' + casts.map(u => optOf(u, false)).join('');
      sSel.innerHTML = '<option value="">— スタッフ —</option>' + staffs.map(u => optOf(u, true)).join('');
      if (keepC) cSel.value = keepC;
      if (keepS) sSel.value = keepS;
      if (!cSel.dataset.wired) {
        cSel.dataset.wired = '1';
        sSel.dataset.wired = '1';
        cSel.addEventListener('change', () => { if (cSel.value) sSel.value = ''; });
        sSel.addEventListener('change', () => { if (sSel.value) cSel.value = ''; });
      }
    }
    if (iSel) {
      const keep = iSel.value;
      // お仕事セット（セット品を1つずつ）もここから選べるようにする（店長要望 2026-08-22）
      const setItems = (_supData.items || []).filter(i => i.kind === 'set' && Number(i.is_active) === 1);
      const setOpt = setItems.length
        ? `<option value="set">🧰 お仕事セット（${escapeHtml(setItems.map(i => i.name).join('・'))}）</option>`
        : '';
      iSel.innerHTML = '<option value="">— 備品 —</option>' + setOpt
        + (_supData.items || []).filter(i => Number(i.is_active) === 1).map(i =>
            `<option value="${i.id}">${escapeHtml(i.name)}（事務所 ${Number(i.stock)}）</option>`).join('');
      if (keep) iSel.value = keep;
    }
    if (qSel && !qSel.options.length) {
      qSel.innerHTML = Array.from({ length: 10 }, (_, n) => `<option value="${n + 1}">${n + 1}</option>`).join('');
    }
  }

  // ========== 権限管理 ==========
  const TAB_INFO = {
    timeline:    { label: 'タイムライン', desc: '日次予約タイムラインの閲覧・操作' },
    bookings:    { label: '予約管理',     desc: '予約一覧の閲覧と編集' },
    customers:   { label: '顧客管理',     desc: '顧客情報の閲覧・編集' },
    shifts:      { label: '内勤・送迎シフト', desc: '内勤スタッフ・ドライバーのスケジュール登録（キャストの出勤はCTRLの出勤管理が正）' },
    // 並び・名前はヘッダーのタブと必ず合わせる（店長指摘 2026-08-16）
    chat:        { label: '💬 チャット',  desc: 'お客様からのチャット問い合わせの受信・返信' },
    staffboard:  { label: '👥 キャスト管理', desc: '当日の売上・件数・報酬・出勤' },
    supplies:    { label: '📦 備品',      desc: '事務所にある数と、キャスト・ドライバーへの貸出' },
    staff:       { label: 'スタッフ管理', desc: 'スタッフアカウントの追加・削除・ログイン端末（必ずownerを含む）' },
    payroll:     { label: '💰 経理',      desc: '各キャストの報酬集計' },
    settlement:  { label: '💴 入金', desc: 'お店への現金の受け渡し確認（内勤・ドライバー本人の画面）' },
    courses:     { label: 'マスタ',       desc: 'コース・オプション・指名料・ホテル・駅・自宅の交通費など' },
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
      staffboard:  ['owner', 'manager'],
      staff:       ['owner', 'manager'],
      permissions: ['owner'],
    };
    // 管理タブ(マネージャー管理モードで出すもの)の可否判定。
    // 役職での決め打ちはしない。権限管理のチェック（未設定なら上の既定）だけで決める（店長指定 2026-08-15）
    const managerCanSee = (t) => {
      if (t === 'therapist' || t === 'myclients' || t === 'settlement') return false;
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
    // キャスト・ドライバーは OPS を見ない・操作しないので列自体を出さない（店長指定 2026-08-15）
    const roles = ['owner', 'manager', 'office'];
    // ドライバーのデフォルト可視タブ
    const driverDefault = { timeline: true, bookings: true, shifts: true };
    // 内勤スタッフのデフォルト可視タブ (施術はしないが予約/顧客/チャット対応)
    const officeDefault = { timeline: true, bookings: true, customers: true, chat: true, supplies: true };
    let html = `<div class="perm-row header">
      <div>タブ</div>
      <div class="perm-cell">オーナー</div>
      <div class="perm-cell">管理者</div>
      <div class="perm-cell">🪪 内勤</div>
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
      const allowed = tabPermissions[key] || defaultAllowed;
      const ownerLocked = (key === 'staff' || key === 'permissions');
      html += `<div class="perm-row" data-perm-tab="${key}">
        <div class="perm-name">${info.label}<span class="perm-desc">${info.desc}</span></div>
        ${roles.map(r => {
          const checked = allowed.includes(r) ? 'checked' : '';
          const disabled = (r === 'owner' && ownerLocked) ? 'disabled' : '';
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
      const [data] = await Promise.all([
        api('/admin-api.php?action=' + staffListEndpoint()),
        loadCastAccess(),                       // 専用URL・暗証番号の状態
      ]);
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

      el.innerHTML = `<div class="th-grid">${attHtml}<div class="th-card" id="thBookCard"></div><div class="th-card" id="thChatCard"></div><div class="th-card" id="thPerfCard"></div>${shiftHtml}</div>`;

      // 出勤/休みの自己切替は廃止（キャストは閲覧のみ・出勤はシフトで管理）
      document.getElementById('thToClients')?.addEventListener('click', () => switchView('myclients'));
      document.getElementById('thToShifts')?.addEventListener('click', () => switchView('shifts'));
      // 入金明細は「今日」を表示してから開く
      document.getElementById('thToSettleMenu')?.addEventListener('click', () => { msSetRange('today'); switchView('settlement'); });

      await Promise.all([renderThBookings(), renderThPerf(), renderThChat()]);
    } catch (e) {
      el.innerHTML = `<p style="color:var(--coral);">読み込み失敗: ${escapeHtml(e.message)}</p>`;
    }
  }

  // 💬 チャット: 自分宛（指名）のYobuChat受信箱をそのまま埋め込む（店長要望 2026-09-02）。
  // お店のチャットタブと同じ「本家をiframeで使う」方式。認証は受信箱URL（inbox_token）だけで完結する
  async function renderThChat() {
    const card = document.getElementById('thChatCard');
    if (!card) return;
    card.innerHTML = '<div class="th-card-h">💬 チャット</div><div style="color:var(--ink-soft);padding:.4rem 0;">読み込み中...</div>';
    let d;
    try { d = await api('/admin-api.php?action=my-chat-inbox'); }
    catch (e) {
      card.innerHTML = `<div class="th-card-h">💬 チャット</div><div style="color:var(--ink-soft);font-size:.84rem;">読み込めませんでした: ${escapeHtml(e.message)}</div>`;
      return;
    }
    const visBtn = (on) => `<label class="th-chat-vis${on ? ' on' : ''}">
        <input type="checkbox" id="thChatVis"${on ? ' checked' : ''}>
        指名チャット受付 <b>${on ? 'ON' : 'OFF'}</b></label>
      <span class="hko-note" style="font-size:.72rem;">ONにすると、お客様のチャット画面の指名一覧にあなたの名前が出ます</span>`;
    card.innerHTML = `<div class="th-card-h">💬 チャット <span style="font-size:.72rem;color:var(--ink-soft);font-weight:600;">あなた宛のお客様チャット</span></div>
      <div class="th-chat-visrow" id="thChatVisRow">${visBtn(!!d.visible)}</div>
      <iframe src="${escapeAttr(d.inbox_url)}" title="あなた宛のチャット"
              style="width:100%;height:60vh;min-height:380px;border:1.5px solid var(--gray);border-radius:12px;background:#fff;display:block;"></iframe>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.5rem;align-items:center;">
        <a class="btn-secondary" href="${escapeAttr(d.inbox_url)}" target="_blank" rel="noopener" style="text-decoration:none;font-size:.8rem;padding:.4rem .8rem;">別タブで開く ↗</a>
        <button class="btn-secondary" type="button" id="thChatShare" style="font-size:.8rem;padding:.4rem .8rem;">📋 あなたの指名チャットURLをコピー</button>
      </div>`;
    const bindVis = () => document.getElementById('thChatVis')?.addEventListener('change', async (e) => {
      const on = e.target.checked;
      try {
        await apiPost('/admin-api.php?action=my-chat-visible', { on: on ? 1 : 0 });
        toast(on ? '✓ 指名チャット受付をONにしました' : '指名チャット受付をOFFにしました', 'ok');
      } catch (err) { toast('切り替え失敗: ' + err.message, 'err'); }
      const row = document.getElementById('thChatVisRow');
      if (row) { row.innerHTML = visBtn(on); bindVis(); }
    });
    bindVis();
    document.getElementById('thChatShare')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(d.share_url); toast('✓ 指名チャットURLをコピーしました', 'ok'); }
      catch (e) { toast('コピーできませんでした', 'err'); }
    });
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
    const res = await api(`/bookings.php?action=range&from=${d}&to=${nextD}&admin_id=${me}&with_repeat=1`).catch(() => ({ bookings: [] }));
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
      // リピーター表示: お店として何回目か＋自分と会ったことがあるか（回数は予約ステータス基準）
      let repeatTag = '';
      if (!isBreakRow && b.repeat_shop_count != null) {
        const shopN = Number(b.repeat_shop_count) || 0;
        const withMe = Number(b.repeat_with_me) || 0;
        // この予約自身も1件に数えられているので、「これまで」は -1 して考える
        const isNew = shopN <= 1;
        const meTag = withMe <= 1 ? 'あなたと初対面' : `あなたと${withMe}回目`;
        repeatTag = isNew
          ? '<span class="th-rep new">🆕 ご新規様</span>'
          : `<span class="th-rep">♻ ${shopN}回目</span><span class="th-rep me">${meTag}</span>`;
      }
      // 前日までに入っていた予約（営業日の始まり10:00より前に受付）と事前予約の印（店長要望 2026-09-02）。
      // 当日出勤してから入る予約と違い、前もって約束が入っていたことが本人に一目で分かるように
      let advTag = '';
      if (!isBreakRow) {
        const madeBefore = b.created_at && String(b.created_at) < `${d} 10:00:00`;
        if (madeBefore) advTag = '<span class="th-adv">📌 前日予約</span>';
        else if (b.status === 'pre_reserved') advTag = '<span class="th-adv">📌 事前予約</span>';
      }
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
            : `${place ? `<div style="color:var(--ink-soft);font-size:.82rem;">${escapeHtml(place)}</div>` : ''}${advTag}${repeatTag}${badge}`}
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
    card.querySelectorAll('[data-svc-start]').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!await opsConfirm(`「${btn.dataset.svcDesc}」の接客を開始しますか？\n※ いま押した時刻が開始時刻として記録されます`)) return;
      svcAction(btn.dataset.svcStart, 'started', '▶ 接客を開始しました');
    }));
    card.querySelectorAll('[data-svc-end]').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!await opsConfirm(`「${btn.dataset.svcDesc}」の接客を終了しますか？\n※ 終了後はご自分では戻せません`)) return;
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

  // ─ 更新しても同じ画面・同じ日付に戻る（店長要望 2026-08-08）─
  // 別タブ・再ログイン後は消えてよいので sessionStorage。ログアウトの挙動は変えない
  const VIEW_KEY = 'ops_last_view', DAY_KEY = 'ops_last_day';
  function rememberPlace() {
    try {
      const v = document.querySelector('.view.active')?.id?.replace(/^view-/, '');
      if (v) sessionStorage.setItem(VIEW_KEY, v);
      sessionStorage.setItem(DAY_KEY, fmtDate(tlCurrentDate));
    } catch (e) { /* プライベートブラウズ等で使えない場合は諦める */ }
  }

  function switchView(name) {
    const tabName = (name === 'hotel' || name === 'stations' || name === 'cityfee') ? 'courses' : name;  // ホテル管理・駅マスタ・自宅交通費はマスタ配下
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === tabName));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    if (name === 'staff' && userCanSeeTab('staff')) { loadAdminUsers(); loadDeviceList(); }
    else if (name === 'therapist') loadTherapistHome();
    else if (name === 'myclients') loadMyClients();
    else if (name === 'timeline') loadTimeline();
    else if (name === 'bookings') loadBookings();
    else if (name === 'customers') loadCustomers();
    else if (name === 'shifts') loadShifts();
    else if (name === 'courses') { loadCourses(); loadOptions(); loadEntryMethods(); loadOfficeAddress(); loadCardSurchargeSetting(); loadNominationFeeSetting(); }
    else if (name === 'supplies') loadSupplies();
    else if (name === 'cityfee') loadCityFeeView();
    else if (name === 'stations') loadStations();
    else if (name === 'permissions' && userCanSeeTab('permissions')) renderPermissions();
    else if (name === 'chat' && userCanSeeTab('chat')) openChatFrame();
    else if (name === 'staffboard' && userCanSeeTab('staffboard')) loadStaffBoard();
    else if (name === 'payroll' && userCanSeeTab('payroll')) loadAccounting();
    else if (name === 'settlement') loadMySettlements();
    rememberPlace();
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
    else if (range === 'yesterday' || range === 'tomorrow') {
      // 表示中の日付を1日ずらす（連打で遡る／進める）。未設定なら今日を起点にする
      const cur = document.getElementById('acFrom').value;
      const base = cur ? new Date(cur + 'T00:00:00') : new Date(y, m, d);
      base.setDate(base.getDate() + (range === 'tomorrow' ? 1 : -1));
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
    // タイムラインで見ていた営業日をそのまま引き継ぐ（8/3 を見てから経理を開けば 8/3・店長要望 2026-08-08）。
    // 期間を手で広げていた場合は上書きしない
    const tlDay = fmtDate(tlCurrentDate);
    const fromEl = document.getElementById('acFrom'), toEl = document.getElementById('acTo');
    if (fromEl && toEl && fromEl.value === toEl.value && fromEl.value !== tlDay) {
      fromEl.value = tlDay;
      toEl.value = tlDay;
      document.querySelectorAll('.ac-range').forEach(x => x.classList.remove('active'));
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
    const bd = d.breakdown || { course:0, late:0, transport:0, card:0 };
    const subhead = (t) => `<div style="font-size:.72rem;color:var(--ink-soft);padding:.35rem 0 .1rem 1.2rem;letter-spacing:.04em;">${t}</div>`;
    const row = (label, val, opt = {}) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:${opt.big?'.8rem 0':'.45rem 0'};${opt.border?'border-top:1.5px solid var(--gray);':''}${opt.sub?'padding-left:1.2rem;':''}">
        <span style="color:${opt.sub?'var(--ink-soft)':'var(--deep)'};font-size:${opt.big?'1rem':opt.sub?'.85rem':'.92rem'};font-weight:${opt.big?'700':opt.sub?'500':'600'};">${label}</span>
        <span style="font-family:'Outfit';font-weight:${opt.big?'800':'700'};font-size:${opt.big?'1.4rem':opt.sub?'.9rem':'1.02rem'};color:${opt.accent||(opt.minus?'#c0392b':'var(--deep)')};">${opt.minus?'−':''}${val}</span>
      </div>`;
    const catRows = (d.expense_by_category || []).map(c =>
      row(`　・${escapeHtml(c.category)}`, yen(c.amount), { sub:true })).join('');
    // 店舗売上 = お預り金総額 − キャスト報酬（＝キャストから店が受け取る額）
    const shopSales = (s.total || 0) - (d.reward_total || 0);
    document.getElementById('ac-summary').innerHTML = `
      <div style="background:var(--white);border:1.5px solid var(--gray);border-radius:14px;padding:1.1rem 1.3rem;max-width:560px;">
        ${row(`お預り金総額 <span style="color:var(--ink-soft);font-weight:500;font-size:.8rem;">（完了 ${s.count}件）</span>`, yen(s.total))}
        ${subhead('料金内訳')}
        ${row('コース料金', yen(bd.course), { sub:true })}
        ${row('深夜料金', yen(bd.late), { sub:true })}
        ${row('交通費', yen(bd.transport), { sub:true })}
        ${bd.card ? row(`カード手数料（${CARD_SURCHARGE_RATE}%）`, yen(bd.card), { sub:true }) : ''}
        ${subhead('支払方法')}
        ${row('現金', yen(s.cash), { sub:true })}
        ${row('クレジット', yen(s.credit), { sub:true })}
        ${row('銀行振込', yen(s.bank), { sub:true })}
        ${s.unset ? row('支払方法 未設定', yen(s.unset), { sub:true }) : ''}
        ${row('キャスト報酬', yen(d.reward_total), { minus:true })}
        ${row('＝ 店舗売上（キャストからの入金）', yen(shopSales), { big:true, border:true })}
        ${/* カード会社へ払う手数料。実際は約8%だが、お客様からの上乗せ分と同額を計上して相殺する
              （店長指定 2026-08-08。厳密な経理は弥生会計側で行うため、ここはアバウトで良い）。
              上の「カード手数料」と必ず同額になる */''}
        ${row('クレジット手数料', yen(d.card_fee), { minus:true })}
        ${row(`経費合計`, yen(d.expense_total), { minus:true })}
        ${catRows}
        ${row('＝ 利益', yen(d.gross_profit), { big:true, border:true, accent:'var(--coral)' })}
      </div>`;
    // 指名料の設定はマスタタブへ移設（店長要望 2026-08-08）。損益は金額の集計だけを出す
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
        <div id="acCashBox"></div>
        <div id="acReportBox"></div>
        <div id="acHimitsuBox"></div>
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
    // 現金と日報は「1日ぶん」の話なので、期間の最終日を対象にする
    loadDailyReport(acPeriod().to);
  }

  // ─ 現金の状況と、社内報告用の日報テキスト（店長要望 2026-08-08）─
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const mdw = (ymd) => {
    const d = new Date(ymd + 'T12:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
  };
  /** 日報の数字は「1,234-」の形（末尾ハイフンは店の書式） */
  const rep = (n) => Number(n || 0).toLocaleString() + '-';

  function buildDailyReportText(d) {
    const L = [];
    L.push(mdw(d.date));
    // 名前に載せるのは「その日お仕事があった人」だけ。件数と金額を並べる（店長要望 2026-08-28）
    const onDuty = (d.today_shift?.casts || []).filter(c => !c.off);
    (d.casts || []).filter(c => Number(c.count) > 0)
      .forEach(c => L.push(`${c.name}${c.count}件${rep(c.sales)}`));
    L.push('');
    L.push(`出勤合計：${onDuty.length || (d.casts || []).length}名`);
    L.push(`合計本数：${d.booking_count}本`);
    L.push(`売上合計：${rep(d.sales_total)}`);
    L.push(`客単価：${rep(d.avg_price)}`);
    L.push(`月売上：${rep(d.month_sales)}`);
    L.push(`ペース：${rep(d.pace)}`);
    L.push('');
    L.push('スタッフ');
    (d.today_shift?.staff || []).forEach(s => L.push(s.name + (d.driver_logs?.[s.id] ? d.driver_logs[s.id] : '')));
    L.push('');
    L.push('明日');
    L.push(mdw(d.next_date));
    // 明日は開始時刻だけ（「にい10-」= 10時から）
    const hh = (t) => String(parseInt(String(t || '').slice(0, 2), 10) || 0);
    (d.tomorrow_shift?.casts || []).forEach(c => L.push(c.off ? `${c.name}休み` : `${c.name}${hh(c.start)}-`));
    L.push('');
    L.push('スタッフ');
    (d.tomorrow_shift?.staff || []).forEach(s => {
      // 24H・早番・遅番は時刻ではなく区分の名前で書く（店長要望 2026-08-28）。
      // 区分はチェックを選んで保存したものだけ（店長指摘 2026-08-29）
      const kubun = ({ '24h': '24H', early: '早番', late: '遅番' })[s.preset || ''] || '';
      if (kubun) { L.push(`${s.name}${kubun}`); return; }
      // 「ラスト」はそのままラストと書く（店長要望 2026-08-25）。
      // 開始と終わりが同じ人は時間未設定なので終わりは書かない
      const end = s.end_open === 'last' ? 'ラスト' : ((s.start === s.end) ? '' : hh(s.end));
      L.push(`${s.name}${hh(s.start)}-${end}`);
    });
    L.push('');
    L.push('『アドミ』');
    return L.join('\n');
  }

  /**
   * 立川秘密基地の日報（社内報告用）。数字は向こうのオーダーの「店落ち」から積む。
   * 並びはアドミの日報と揃えるが、スタッフ欄は「日報の出し先＝秘密基地」にしたスタッフだけ。
   */
  function buildHimitsuReportText(h, d) {
    const L = [];
    L.push(mdw(h.date));
    // お仕事があったセラピストだけ「◯件いくら」で並べる（店長要望 2026-08-28）
    (h.therapists || []).filter(t => Number(t.count) > 0)
      .forEach(t => L.push(`${t.name}${t.count}件${rep(t.sales)}`));
    L.push('');
    L.push('スタッフ');
    (d?.today_shift?.himitsu_staff || []).forEach(s => {
      const kubun = ({ '24h': '24H', early: '早番', late: '遅番' })[s.preset || ''] || '';
      if (kubun) { L.push(`${s.name}${kubun}`); return; }
      const end = s.end_open === 'last' ? 'ラスト' : (s.start === s.end ? '' : s.end);
      L.push(`${s.name}${s.start}${end ? '〜' + end : ''}`);
    });
    L.push('');
    L.push(`出勤合計：${h.on_duty}名`);
    L.push(`合計本数：${h.booking_count}本`);
    L.push(`売上合計：${rep(h.sales_total)}`);
    L.push(`客単価：${rep(h.avg_price)}`);
    L.push(`月売上：${rep(h.month_sales)}`);
    L.push(`ペース：${rep(h.pace)}`);
    L.push('');
    L.push('明日');
    L.push(mdw(h.next_date));
    const hh = (t) => String(parseInt(String(t || '').slice(0, 2), 10) || 0);
    (h.tomorrow || []).forEach(t => L.push(`${t.name}${hh(t.start)}-`));
    L.push('');
    L.push('スタッフ');
    (d?.tomorrow_shift?.himitsu_staff || []).forEach(s => {
      const kubun = ({ '24h': '24H', early: '早番', late: '遅番' })[s.preset || ''] || '';
      if (kubun) { L.push(`${s.name}${kubun}`); return; }
      const end = s.end_open === 'last' ? 'ラスト' : (s.start === s.end ? '' : s.end);
      L.push(`${s.name}${s.start}${end ? '〜' + end : ''}`);
    });
    L.push('');
    L.push('『秘密基地』');
    return L.join('\n');
  }

  /** 秘密基地の日報を、アドミの日報の下に足す（別システムなので取れなくても本体は出す） */
  async function loadHimitsuReport(date, d) {
    const box = document.getElementById('acHimitsuBox');
    if (!box || !date) return;
    let h;
    try { h = await api('/himitsu.php?action=report&date=' + encodeURIComponent(date)); }
    catch (e) { box.innerHTML = ''; return; }
    if (!h || !h.ok) { box.innerHTML = ''; return; }
    const warn = h.sales_ok ? ''
      : '<div style="font-size:.74rem;color:var(--coral);margin-bottom:.4rem;">⚠ 売上集計が取得できませんでした。金額はご確認ください</div>';
    box.innerHTML = `<div style="background:var(--white);border:1.5px solid var(--gray);border-radius:14px;padding:1rem 1.2rem;margin-top:1rem;">
      <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.35rem;">
        <div style="font-weight:700;">📝 日報（立川秘密基地）</div>
        <button class="sbtn" type="button" id="acHkCopy" style="padding:.35rem .8rem;font-size:.8rem;">📋 コピー</button>
        <button class="sbtn" type="button" id="acHkReset" style="padding:.35rem .8rem;font-size:.8rem;">↺ 作り直す</button>
        <span id="acHkMsg" style="font-size:.8rem;color:var(--ink-soft);"></span>
      </div>
      <div style="font-size:.76rem;color:var(--ink-soft);margin-bottom:.5rem;">金額は秘密基地の「売上集計（店舗）」の店落ちです。直してからコピーできます。</div>
      ${warn}
      <textarea id="acHkText" style="width:100%;min-height:20rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.86rem;line-height:1.7;padding:.7rem .8rem;border:1.5px solid var(--gray);border-radius:10px;"></textarea>
    </div>`;
    const ta = document.getElementById('acHkText');
    ta.value = buildHimitsuReportText(h, d);
    document.getElementById('acHkReset').addEventListener('click', () => {
      ta.value = buildHimitsuReportText(h, d);
      const m = document.getElementById('acHkMsg'); m.textContent = '作り直しました'; setTimeout(() => { m.textContent = ''; }, 2000);
    });
    document.getElementById('acHkCopy').addEventListener('click', async () => {
      const ok = await copyTextToClipboard(ta.value);
      const m = document.getElementById('acHkMsg');
      m.textContent = ok ? '✓ コピーしました' : 'コピーに失敗しました';
      setTimeout(() => { m.textContent = ''; }, 2500);
    });
  }

  async function loadDailyReport(date) {
    const cashBox = document.getElementById('acCashBox');
    const repBox = document.getElementById('acReportBox');
    if (!cashBox || !repBox || !date) return;
    let d;
    try { d = await api('/admin-api.php?action=daily-report&date=' + encodeURIComponent(date)); }
    catch (e) { cashBox.innerHTML = ''; repBox.innerHTML = ''; return; }

    const c = d.cash || {};
    const line = (label, val, opt) => `<div style="display:flex;justify-content:space-between;padding:.4rem 0;${opt?.border ? 'border-top:1.5px solid var(--gray);margin-top:.2rem;' : ''}">
      <span style="${opt?.big ? 'font-weight:800;' : ''}">${label}</span>
      <span style="font-weight:${opt?.big ? '800' : '700'};font-family:'Outfit';font-size:${opt?.big ? '1.15rem' : '1rem'};color:${opt?.minus ? '#c0392b' : (opt?.big ? 'var(--deep)' : 'inherit')};">${opt?.minus ? '−' : ''}${yen(Math.abs(Number(val) || 0))}</span></div>`;
    // お預り金総額 → カード等を引いて現金 → 報酬を引いて手元、の順で追えるようにする
    cashBox.innerHTML = `<div style="background:var(--white);border:1.5px solid var(--gray);border-radius:14px;padding:1rem 1.2rem;">
      <div style="font-weight:700;margin-bottom:.2rem;">💰 現金（${escapeHtml(formatDate(d.date))}）</div>
      <div style="font-size:.76rem;color:var(--ink-soft);margin-bottom:.4rem;">カード決済ぶんの報酬も、その日の現金から渡します。</div>
      ${line('お預り金総額', c.total)}
      ${Number(c.credit) ? line('クレジット <span style="font-size:.74rem;color:var(--ink-soft);">店の口座へ・現金にならない</span>', c.credit, { minus: true }) : ''}
      ${Number(c.bank) ? line('銀行振込 <span style="font-size:.74rem;color:var(--ink-soft);">店の口座へ</span>', c.bank, { minus: true }) : ''}
      ${line('＝ 現金で受け取った額', c.received, { border: true })}
      ${line('キャストへ渡した報酬', c.reward_paid, { minus: true })}
      ${line('＝ 手元の現金', c.on_hand, { big: true, border: true, minus: Number(c.on_hand) < 0 })}
    </div>`;

    repBox.innerHTML = `<div style="background:var(--white);border:1.5px solid var(--gray);border-radius:14px;padding:1rem 1.2rem;">
      <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.35rem;">
        <div style="font-weight:700;">📝 日報（社内報告用）</div>
        <button class="sbtn" type="button" id="acRepCopy" style="padding:.35rem .8rem;font-size:.8rem;">📋 コピー</button>
        <button class="sbtn" type="button" id="acRepReset" style="padding:.35rem .8rem;font-size:.8rem;">↺ 作り直す</button>
        <span id="acRepMsg" style="font-size:.8rem;color:var(--ink-soft);"></span>
      </div>
      <div style="font-size:.76rem;color:var(--ink-soft);margin-bottom:.5rem;">当日欠勤・ドライバーの実働時間・末尾のメモは、ここで直してからコピーしてください。</div>
      <textarea id="acRepText" style="width:100%;min-height:22rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.86rem;line-height:1.7;padding:.7rem .8rem;border:1.5px solid var(--gray);border-radius:10px;"></textarea>
    </div>`;
    const ta = document.getElementById('acRepText');
    ta.value = buildDailyReportText(d);
    document.getElementById('acRepReset').addEventListener('click', () => {
      ta.value = buildDailyReportText(d);
      const m = document.getElementById('acRepMsg'); m.textContent = '作り直しました'; setTimeout(() => { m.textContent = ''; }, 2000);
    });
    document.getElementById('acRepCopy').addEventListener('click', async () => {
      const ok = await copyTextToClipboard(ta.value);
      const m = document.getElementById('acRepMsg');
      m.textContent = ok ? '✓ コピーしました' : 'コピーに失敗しました';
      setTimeout(() => { m.textContent = ''; }, 2500);
    });
    // 立川秘密基地の日報（別システムなので後から足す）
    loadHimitsuReport(d.date, d).catch(() => {});
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
    else if (range === 'yesterday' || range === 'tomorrow') {
      const cur = document.getElementById('msFrom').value;
      const base = cur ? new Date(cur + 'T00:00:00') : new Date(y, m, d);
      base.setDate(base.getDate() + (range === 'tomorrow' ? 1 : -1));
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
          ${c.customer_id ? `<div class="mc-note-wrap" data-cid="${c.customer_id}">
            <div style="font-size:.78rem;font-weight:700;color:var(--deep);margin:.5rem 0 .25rem;">🗒 私のお客様メモ <span style="font-weight:500;color:var(--ink-soft);">（他のキャストには見えません）</span></div>
            <textarea class="mc-note" rows="2" placeholder="例: 会話は控えめが好み" style="width:100%;box-sizing:border-box;font-size:16px;"></textarea>
            <button class="btn-secondary mc-note-save" type="button" style="margin-top:.3rem;font-size:.78rem;">メモを保存</button>
          </div>` : ''}
        </div>
      </div>`).join('');
    el.querySelectorAll('.mc-card').forEach(card => card.addEventListener('click', (e) => {
      if (e.target.closest('.mc-note-wrap')) return;   // メモ入力中に畳まない
      const d = card.querySelector('.mc-detail');
      if (!d) return;
      const opening = d.style.display === 'none';
      d.style.display = opening ? 'block' : 'none';
      // 開いたときに自分のメモを読み込む（1回だけ）
      const wrap = card.querySelector('.mc-note-wrap');
      if (opening && wrap && !wrap.dataset.loaded) {
        wrap.dataset.loaded = '1';
        const ta = wrap.querySelector('.mc-note');
        api('/customers.php?action=cast-note&customer_id=' + wrap.dataset.cid)
          .then(r => { if (ta) ta.value = r.note || ''; }).catch(() => {});
      }
    }));
    el.querySelectorAll('.mc-note-save').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const wrap = btn.closest('.mc-note-wrap');
      const ta = wrap?.querySelector('.mc-note');
      try {
        await apiPost('/customers.php?action=cast-note-save', { customer_id: Number(wrap.dataset.cid), note: ta?.value || '' });
        toast('✓ メモを保存しました', 'ok');
      } catch (err) { toast('保存失敗: ' + err.message, 'err'); }
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
        // 報酬確定済み（渡し済み/本人確保）なら、預り金として動くのは残額（入金分）だけ。
        // 併用は現金で受け取ったぶんしか手元に無い
        const cash = cashTakenOf(r);
        const heldAmt = r.reward_paid_at ? cash - (Number(r.reward) || 0) : cash;
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
    if (!await opsConfirm('この経費を削除しますか？')) return;
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
          <!-- 歩合率は使わない運用なので出さない（報酬はマスタのコース別固定額・店長指定 2026-08-08） -->
          <div style="font-weight:700;">${escapeHtml(t.name)} <span style="color:var(--ink-soft);font-weight:500;font-size:.85rem;">（${t.count}件）</span></div>
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
              <tr><td colspan="6" style="padding:0 .4rem .45rem 1.2rem;color:var(--ink-soft);font-size:.73rem;line-height:1.5;">コース ${yen(x.course_reward || 0)}${x.late_self ? ` ＋ 深夜 ${yen(x.late_self)}` : (x.late_shop > 0 ? ` ＋ 深夜 ${yen(x.late_shop)}はお迎えで店` : '')} ＋ 交通費 ${yen(x.transport_self || 0)}${x.has_driver && x.transport_shop > 0 ? `（送迎で店 ${yen(x.transport_shop)}）` : ''}</td></tr>`).join('')}
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

  /**
   * 💬 チャットタブ。YobuChat の店舗受信箱（/chat/{slug}/）を iframe で開く。
   * 初回だけ src を入れる（タブを行き来するたびに読み直すと、入力中の返信が消えるため）。
   * 下の loadChatInbox 以下は ylka から移植した独自UIの名残で、OPS には API が無く動かない。
   * 呼び出し元はここだけだったので、今は使っていない（消すと参照が散らばっているため残置）。
   */
  async function openChatFrame() {
    const f = document.getElementById('caFrame');
    if (!f) return;
    // 保存済みの受信箱URL（?owner_token= 付き）があればそれを使う。
    // 別サイトの iframe には Cookie も localStorage も渡らないため、これが無いと訪問者画面になる
    let url = '';
    try {
      const d = await api('/admin-api.php?action=setting-get&key=chat_inbox_url');
      url = String(d.value || '').trim();
    } catch (e) {}
    const box = document.getElementById('caInboxUrl');
    if (box && !box.value) box.value = url;
    if (url) {
      f.dataset.src = url;
      const open = document.getElementById('caFrameOpen');
      if (open) open.href = url;
    }
    if (!f.src && f.dataset.src) f.src = f.dataset.src;
  }

  async function saveChatInboxUrl() {
    const box = document.getElementById('caInboxUrl');
    if (!box) return;
    const v = box.value.trim();
    if (v && !/^https:\/\/[^\/]+\/chat\/[^\/]+\/?\?owner_token=[a-f0-9]{96}$/.test(v)) {
      toast('URLの形式が違います。受信チャットの「🔗 管理画面用URL」でコピーしたものを貼ってください', 'err');
      return;
    }
    try {
      await apiPost('/admin-api.php?action=setting-set', { key: 'chat_inbox_url', value: v });
      toast(v ? '✓ 保存しました。枠を読み込み直します' : '✓ 設定を消しました', 'ok');
      const f = document.getElementById('caFrame');
      if (f) {
        const next = v || f.dataset.src;
        f.dataset.src = next;
        const open = document.getElementById('caFrameOpen');
        if (open && v) open.href = v;
        f.src = 'about:blank';
        setTimeout(() => { f.src = next; }, 50);
      }
    } catch (e) { toast('保存失敗: ' + e.message, 'err'); }
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
    wrap.querySelectorAll('.ct-del').forEach(b => b.addEventListener('click', async () => {
      if (!await opsConfirm('この定型文を削除しますか？')) return;
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
    // 受信箱を読み込み直す（相手の新着が来ているのに反映されないときの手動更新）
    document.getElementById('caInboxUrlSave')?.addEventListener('click', saveChatInboxUrl);
    document.getElementById('caFrameReload')?.addEventListener('click', () => {
      const f = document.getElementById('caFrame');
      if (!f) return;
      const src = f.src || f.dataset.src || '';
      f.src = 'about:blank';
      setTimeout(() => { f.src = src; }, 50);
    });
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
      if (cf && cf.card_surcharge_rate != null) CARD_SURCHARGE_RATE = parseFloat(cf.card_surcharge_rate) || CARD_SURCHARGE_RATE;
    } catch (e) {}
    // 指名料（初指名/本指名/フリーの固定額）を取得（予約合計への加算・フッターサマリー内訳に使用）
    try {
      const nf = await api('/admin-api.php?action=nomination-fees-get');
      if (nf && nf.nomination_fees) Object.assign(NOMINATION_FEES, nf.nomination_fees);
      if (nf && nf.nomination_rewards) Object.assign(NOMINATION_REWARDS, nf.nomination_rewards);
    } catch (e) {}
    // 事務所の住所（ルート案内の既定の出発地）
    try {
      const oa = await api('/admin-api.php?action=setting-get&key=office_address');
      _officeAddress = (oa && oa.value) || '';
    } catch (e) {}

    // 権限取得 → タブ表示制御
    await loadPermissions();
    applyTabVisibility();

    // 更新前に見ていた画面・日付に戻す（店長要望 2026-08-08）。
    // 日付はタブを描く前に戻さないと、当日ぶんを読んでから読み直すことになる
    let restoredView = '';
    // 管理者は入口の2択画面を出さず、そのままマネージャー管理で開く（店長指定 2026-08-15）。
    // 復元判定(userCanSeeTab)より前にモードを決めておかないと、全タブが「見えない」扱いになる
    if (currentUser?.role === 'manager') managerMode = 'manager';
    window._opsRestoredView = '';
    try {
      const savedDay = sessionStorage.getItem(DAY_KEY);
      if (savedDay && /^\d{4}-\d{2}-\d{2}$/.test(savedDay)) {
        const [yy, mm, dd] = savedDay.split('-').map(Number);
        tlCurrentDate = new Date(yy, mm - 1, dd);
        const dEl = document.getElementById('tlDatePicker');
        if (dEl) dEl.value = savedDay;
        syncDateDisp();
      }
      const savedView = sessionStorage.getItem(VIEW_KEY);
      // 見せてよいタブに限る（権限が変わっていても飛ばないように）
      if (savedView && document.getElementById('view-' + savedView) && userCanSeeTab(savedView)) {
        restoredView = savedView;
        window._opsRestoredView = savedView;
      }
    } catch (e) { /* sessionStorage が使えない環境ではそのまま既定の動きにする */ }

    // キャスト(staff)は専用マイページに自動分岐
    if (currentUser?.role === 'staff') switchView('therapist');
    // 管理者はマネージャー管理から。キャスト管理へは右上の名前プルダウンで切り替える
    else if (currentUser?.role === 'manager') {
      if (restoredView) applyTabVisibility();     // 更新で戻ったときは見ていた画面を優先
      else setManagerMode('manager');
    }
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
      // クレジット⇔他 の切替で、手数料の内訳と決済確認チェックを出し入れする
      withBmSuffix(modal?.id === 'bookingModal-2' ? '-2' : '', () => syncCardUi());
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
    document.getElementById('fHotelType')?.addEventListener('change', loadHotels);
    document.getElementById('fSort')?.addEventListener('change', loadHotels);
    document.getElementById('fKeyword').addEventListener('input', () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(loadHotels, 280);
    });
    document.getElementById('btnReset').addEventListener('click', () => {
      document.getElementById('fCity').value = '';
      document.getElementById('fStatus').value = '';
      document.getElementById('fKeyword').value = '';
      if (document.getElementById('fHotelType')) document.getElementById('fHotelType').value = '';
      if (document.getElementById('fSort')) document.getElementById('fSort').value = 'name';   // 既定はあいうえお順
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
    // 全て選択: いま絞り込まれて表示されている件数ぶんをまとめてチェック/解除する
    document.getElementById('selectAllHotels')?.addEventListener('change', e => {
      allHotels.forEach(h => { if (e.target.checked) selectedIds.add(h.id); else selectedIds.delete(h.id); });
      document.querySelectorAll('#hotelList .rowSelect').forEach(cb => { cb.checked = selectedIds.has(Number(cb.dataset.id)); });
      document.querySelectorAll('#hotelList .hotel-row').forEach(row => { row.classList.toggle('selected', selectedIds.has(Number(row.dataset.id))); });
      updateBulkBar();
      document.getElementById('filterNote').textContent = selectedIds.size > 0 ? `（${selectedIds.size}件選択中）` : '';
    });

    // 一括操作バー
    document.querySelectorAll('[data-bulk]').forEach(btn => {
      btn.addEventListener('click', () => bulkSetStatus(btn.dataset.bulk));
    });
    document.getElementById('btnBulkDelete')?.addEventListener('click', () => {
      deleteHotels(Array.from(selectedIds), `選択中の${selectedIds.size}件`);
    });
    document.getElementById('bulkFeeSelect')?.addEventListener('change', updateBulkFeeBtn);
    document.getElementById('btnBulkFee')?.addEventListener('click', bulkSetTransportFee);
    document.getElementById('btnHotelAdd')?.addEventListener('click', () => openEdit(null));
    document.getElementById('btnBulkClear').addEventListener('click', () => {
      selectedIds.clear();
      document.querySelectorAll('.rowSelect').forEach(cb => cb.checked = false);
      document.querySelectorAll('.hotel-row.selected').forEach(r => r.classList.remove('selected'));
      const feeSel = document.getElementById('bulkFeeSelect');
      if (feeSel) feeSel.value = '';
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

    // タイムラインを読み直す（クイック予約の左の ⟳ 更新・店長要望 2026-08-16）
    document.getElementById('tlReload')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = '更新中…';
      try { await loadTimeline(true); } catch (_) {}
      btn.textContent = old;
      btn.disabled = false;
    });

    // 予約モーダル: 選んでいるキャストをこのお客様のNGにする／外す（店長要望 2026-08-22）
    // 「前回の額にする」＝前回ご案内した交通費に合わせる（店長要望 2026-08-24）
    document.addEventListener('click', (e) => {
      const btn = e.target.closest?.('[data-fee-apply]');
      if (!btn) return;
      e.stopPropagation();
      const suffix = btn.closest('#bookingModal-2') ? '-2' : '';
      withBmSuffix(suffix, () => {
        const sel = bel('bmTransport');
        if (!sel) return;
        const fee = String(parseInt(btn.dataset.feeApply, 10) || 0);
        // 一覧に無い金額（旧システムの端数など）はその場で足す
        if (![...sel.options].some(o => o.value === fee)) {
          const o = document.createElement('option');
          o.value = fee;
          o.textContent = `¥${Number(fee).toLocaleString()}`;
          sel.appendChild(o);
        }
        sel.value = fee;
        updateBookingTotal();
        toast(`交通費を前回の ¥${Number(fee).toLocaleString()} にしました`, 'ok');
      });
    });

    // 合計バーの「保存」＝下の保存ボタンと同じ（下まで送らずに保存できるように・店長要望 2026-08-25）
    document.addEventListener('click', (e) => {
      const btn = e.target.closest?.('[id^="bmSaveMini"]');
      if (!btn) return;
      e.stopPropagation();
      const modal = btn.closest('.modal');
      const save = modal?.querySelector('[id^="bmSave"]:not([id^="bmSaveMini"])');
      if (save) save.click();
    });

    // 🧾 領収証が必要 のトグル（予約モーダル①②とも）
    document.addEventListener('click', (e) => {
      const btn = e.target.closest?.('[id^="bmReceiptBtn"]');
      if (!btn) return;
      e.stopPropagation();
      const suffix = btn.id === 'bmReceiptBtn-2' ? '-2' : '';
      withBmSuffix(suffix, () => setReceiptBtn(bel('bmReceiptNeeded')?.value !== '1'));
    });

    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[id^="bmNgCastBtn"]');
      if (!btn) return;
      e.stopPropagation();
      const suffix = btn.id === 'bmNgCastBtn-2' ? '-2' : '';
      await withBmSuffix(suffix, async () => {
        const custId = Number(bel('bmCustomerId')?.value || 0);
        const castId = Number(bel('bmAdminId')?.value || 0);
        if (!custId) { toast('お客様が特定できてからNGにできます', 'err'); return; }
        if (!castId) { toast('キャストを選んでください', 'err'); return; }
        const cur = bmNg[activeBmSuffix] || { level: 0, reason: '', castIds: [] };
        const isNg = (cur.castIds || []).map(Number).includes(castId);
        const name = findStaffUser(castId)?.display_name || '';
        // 確認ダイアログは出さない（押し間違えても同じボタンで戻せる）。
        // 効き目は「そのキャストを選んだときに出る注意書き」で分かる（店長指定 2026-08-22）
        btn.disabled = true;
        try {
          const r = await apiPost('/customers.php?action=ng-cast-toggle',
            { customer_id: custId, cast_admin_id: castId, on: isNg ? 0 : 1 });
          setBookingNg({ level: cur.level, reason: cur.reason, castIds: r.ng_cast_ids || [] });
          // お客様メモにも「その予約でNGにした」印を出す（書きかけの時は触らない）
          const pane = bel('bmHistoryPanel');
          if (pane && pane._noteNg && pane._noteRerender && !pane.querySelector('.bhn-ta')) {
            if (isNg) {
              const i = pane._noteNg.findIndex(n => Number(n.cast_admin_id) === castId);
              if (i >= 0) pane._noteNg.splice(i, 1);
            } else {
              const t = new Date();
              const p2 = v => String(v).padStart(2, '0');
              pane._noteNg.push({
                cast_admin_id: castId, display_name: name,
                created_at: `${fmtDate(t)} ${p2(t.getHours())}:${p2(t.getMinutes())}:00`,
              });
            }
            try { pane._noteRerender(); } catch (_) {}
          }
          toast(isNg ? `${name} のNGを外しました` : `✓ ${name} をNGにしました`, 'ok');
        } catch (err) {
          toast('更新失敗: ' + err.message, 'err');
        } finally { btn.disabled = false; }
      });
    });

    // 🔒 端末とログイン（スタッフ管理タブ内）
    document.getElementById('btnDevReload')?.addEventListener('click', () => loadDeviceList());

    // 📦 備品: 貸し出す / 読み直す
    document.getElementById('supReload')?.addEventListener('click', () => loadSupplies());
    document.getElementById('supLendSet')?.addEventListener('click', async () => {
      const uid = supSelectedUserId();
      if (!uid) { supMsg('誰に貸すか選んでください', true); return; }
      const who = (_supData.users || []).find(u => u.id === uid);
      const setNames = (_supData.items || []).filter(i => i.kind === 'set' && Number(i.is_active) === 1).map(i => i.name);
      if (!await opsConfirm(`${who ? who.name : ''} にお仕事セットを貸しますか？\n${setNames.join('・')}`)) return;
      try {
        const r = await apiPost('/supplies.php?action=lend-set', { user_id: uid });
        supMsg(r.lent ? `✓ ${r.lent}点を貸しました` : 'すでに全部お持ちです');
        await loadSupplies();
      } catch (e) { supMsg(e.message || '貸せませんでした', true); }
    });
    document.getElementById('supLendOne')?.addEventListener('click', async () => {
      const uid = supSelectedUserId();
      const raw = String(document.getElementById('supItem')?.value || '');
      const qty = Number(document.getElementById('supQty')?.value || 1);
      if (!uid) { supMsg('誰に貸すか選んでください', true); return; }
      // 「お仕事セット」を選んだときは、セット品を1つずつ貸す（数量は使わない）
      if (raw === 'set') {
        const who = (_supData.users || []).find(u => u.id === uid);
        const setNames = (_supData.items || []).filter(i => i.kind === 'set' && Number(i.is_active) === 1).map(i => i.name);
        if (!await opsConfirm(`${who ? who.name : ''} にお仕事セットを貸しますか？\n${setNames.join('・')}`)) return;
        try {
          const r = await apiPost('/supplies.php?action=lend-set', { user_id: uid });
          supMsg(r.lent ? `✓ ${r.lent}点を貸しました` : 'すでに全部お持ちです');
          await loadSupplies();
        } catch (e) { supMsg(e.message || '貸せませんでした', true); }
        return;
      }
      const sid = Number(raw || 0);
      if (!sid) { supMsg('備品を選んでください', true); return; }
      try {
        await apiPost('/supplies.php?action=lend', { supply_id: sid, user_id: uid, qty });
        supMsg('✓ 貸しました');
        await loadSupplies();
      } catch (e) { supMsg(e.message || '貸せませんでした', true); }
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
      { const li = document.getElementById('csLoginId'); if (li) li.value = ''; }
      document.getElementById('csEmail').value = '';
      document.getElementById('csPassword').value = '';
      { const cd = document.getElementById('csCanDrive'); if (cd) cd.checked = false; }
      { const it = document.getElementById('csIsTherapist'); if (it) it.checked = false; }
      { const io = document.getElementById('csIsOffice'); if (io) io.checked = false; }
      createRole = 'staff';
      document.querySelectorAll('[data-role-btn]').forEach(b => b.classList.toggle('active', b.dataset.role === 'staff'));
      syncConcurrentFields('cs', 'staff');
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
        syncConcurrentFields('cs', createRole);
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
    // ただし「モーダル内で押して外で離した（ドラッグ／文字選択）」では閉じない。
    // click は押した所と離した所の共通祖先で発火するため、mousedown も overlay 自身か確認する
    document.querySelectorAll('.modal-overlay:not(.transparent)').forEach(m => {
      let downOnOverlay = false;
      m.addEventListener('pointerdown', e => { downOnOverlay = (e.target === m); });
      m.addEventListener('click', e => {
        if (e.target === m && downOnOverlay) m.classList.remove('show');
        downOnOverlay = false;
      });
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
      // 予約モーダル（透過）は外側を触っても最小化しない。
      // 情報をコピーしている最中や、裏のタイムラインをドラッグしただけで
      // 消えてしまうため、＿ / × / 閉じる / 保存 の操作でのみ閉じる（店長指定 2026-08-09）
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
      } else if (btn.dataset.action === 'cast-url-copy') {
        copyTextToClipboard(btn.dataset.url).then(ok => toast(ok ? '✓ 専用URLをコピーしました' : 'コピーできませんでした', ok ? 'ok' : 'err'));
      } else if (btn.dataset.action === 'cast-url-issue') {
        castUrlIssue(btn);
      } else if (btn.dataset.action === 'cast-pin-reset') {
        castPinReset(btn);
      } else if (btn.dataset.action === 'cast-pin-set') {
        castPinSet(btn);
      }
    }

    async function castPinSet(btn) {
      const inp = document.getElementById('sraPin' + btn.dataset.id);
      const pin = String(inp?.value || '').replace(/[^0-9]/g, '');
      if (pin.length !== 4) { toast('4桁の数字で入れてください', 'err'); inp?.focus(); return; }
      if (!await opsConfirm(`${btn.dataset.name} の暗証番号を ${pin} にします。\n本人にこの番号を伝えてください。よろしいですか？`)) return;
      btn.disabled = true;
      try {
        await apiPost('/admin-api.php?action=cast-access-set-pin', { admin_user_id: Number(btn.dataset.id), pin });
        toast('✓ 暗証番号を設定しました', 'ok');
        await loadCastAccess();
        renderTherapistBoard();
      } catch (e) { toast('設定失敗: ' + e.message, 'err'); btn.disabled = false; }
    }

    async function castUrlIssue(btn) {
      const renew = btn.dataset.renew === '1';
      if (renew && !await opsConfirm(`${btn.dataset.name} の専用URLを作り直します。\n今のURLと暗証番号は使えなくなります。新しいURLを本人に渡してください。よろしいですか？`)) return;
      btn.disabled = true;
      try {
        await apiPost('/admin-api.php?action=cast-access-issue', { admin_user_id: Number(btn.dataset.id), renew });
        toast(renew ? '✓ 新しい専用URLを発行しました' : '✓ 専用URLを発行しました', 'ok');
        await loadCastAccess();
        renderTherapistBoard();
      } catch (e) { toast('発行失敗: ' + e.message, 'err'); btn.disabled = false; }
    }
    async function castPinReset(btn) {
      if (!await opsConfirm(`${btn.dataset.name} の暗証番号をリセットします。\n次にURLを開いたとき、本人が新しい4桁を決め直します。よろしいですか？`)) return;
      btn.disabled = true;
      try {
        await apiPost('/admin-api.php?action=cast-access-reset-pin', { admin_user_id: Number(btn.dataset.id) });
        toast('✓ 暗証番号をリセットしました', 'ok');
        await loadCastAccess();
        renderTherapistBoard();
      } catch (e) { toast('リセット失敗: ' + e.message, 'err'); btn.disabled = false; }
    }
    // キャスト一覧の並び順（選ぶと即反映。次に開いたときも同じ並びで出す）
    const sbSel = document.getElementById('sbSort');
    if (sbSel) {
      sbSel.value = sbSort;
      sbSel.addEventListener('change', () => {
        sbSort = sbSel.value;
        try { localStorage.setItem('opsCastSort', sbSort); } catch (e) {}
        renderTherapistBoard();
      });
    }
    document.getElementById('staffTable').addEventListener('click', handleStaffRowClick);
    document.getElementById('staffBoard')?.addEventListener('click', handleStaffRowClick);

    // スタッフ編集モーダル
    document.querySelectorAll('[data-es-role]').forEach(b => {
      b.addEventListener('click', () => {
        if (b.disabled) return;
        editingStaffRole = b.dataset.esRole;
        document.querySelectorAll('[data-es-role]').forEach(x => x.classList.toggle('active', x.dataset.esRole === editingStaffRole));
        syncConcurrentFields('es', editingStaffRole);
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
    // 預り金カード色: 選択と同時に右のスウォッチへ反映
    document.getElementById('esColor')?.addEventListener('change', e => {
      const pv = document.getElementById('esColorPreview');
      if (pv) pv.style.background = e.target.value || 'transparent';
    });

    // ========== Timeline / Bookings / Customers / Shifts events ==========
    document.getElementById('tlPrev').addEventListener('click', () => { tlCurrentDate = addDays(tlCurrentDate, -1); rememberPlace(); loadTimeline(); });
    document.getElementById('tlToday').addEventListener('click', () => { tlCurrentDate = getBusinessDayDate(); rememberPlace(); loadTimeline(); });
    document.getElementById('tlNext').addEventListener('click', () => { tlCurrentDate = addDays(tlCurrentDate, 1); rememberPlace(); loadTimeline(); });
    document.getElementById('tlDatePicker').addEventListener('change', e => {
      syncDateDisp();
      const [y,m,d] = e.target.value.split('-').map(Number);
      tlCurrentDate = new Date(y, m-1, d); rememberPlace(); loadTimeline();
    });
    document.getElementById('tlAddBooking').addEventListener('click', () => openBookingForAdd({ date: tlPrefillDate() }));
    const tlCashSummaryBtn = document.getElementById('tlCashSummary');
    if (tlCashSummaryBtn) tlCashSummaryBtn.addEventListener('click', () => openCashSummaryModal());
    document.getElementById('tlWorkLog')?.addEventListener('click', () => openWorkLogModal());
    // ⚠ キャストからの報告
    document.getElementById('tlCastReports')?.addEventListener('click', () => openCastReportModal());
    document.getElementById('crShowAll')?.addEventListener('change', () => renderCastReports());

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
    // コピーボタンを押した合図（1.2秒だけ緑に）。手応えが無いと二度押ししてしまうため。
    // モーダル①②どちらでも効くよう委譲で受ける
    document.addEventListener('click', e => {
      const btn = e.target?.closest?.('.bm-copy-btn');
      if (!btn) return;
      btn.classList.add('is-copied');
      setTimeout(() => btn.classList.remove('is-copied'), 1200);
    });
    // 休憩モードトグル
    const bmBreak = document.getElementById('bmBreakMode');
    if (bmBreak) bmBreak.addEventListener('change', e => setBreakMode(e.target.checked));

    // Customers
    document.getElementById('cuAddNew').addEventListener('click', () => openCustomerModal(null));
    let cuTimer;
    document.getElementById('cuKeyword').addEventListener('input', () => { clearTimeout(cuTimer); cuTimer = setTimeout(loadCustomers, 300); });
    document.addEventListener('input', e => {
      const id = e.target.id || '';
      if (id === 'bmHomeAddress' || id === 'bmHomeAddress-2') {
        const n = document.getElementById('bmUsualLocNote' + (id.endsWith('-2') ? '-2' : ''));
        if (n) n.style.display = 'none';
      }
      // 住所を打つそばから地図リンクを出し直す
      if (/^(bmHomeAddress|bmOtherLoc)(-2)?$/.test(id)) {
        withBmSuffix(id.endsWith('-2') ? '-2' : '', renderBmMapLinks);
      }
    });
    // 過去のご利用住所を選んだら、住所・建物・市区町村をその住所に入れ替える（店長要望 2026-08-14）
    document.addEventListener('change', e => {
      const id = e.target.id || '';
      if (!/^bmPastAddr(-2)?$/.test(id)) return;
      const suffix = id.endsWith('-2') ? '-2' : '';
      const picked = String(e.target.value || '').trim();
      if (!picked) return;
      const [pAddr, pBld] = splitAddressBuilding(picked);
      const a = document.getElementById('bmHomeAddress' + suffix);
      const b2 = document.getElementById('bmHomeBuilding' + suffix);
      if (a) a.value = pAddr;
      if (b2) b2.value = pBld;
      withBmSuffix(suffix, () => {
        const city = extractCityFromAddress(picked);
        if (city) {
          syncCityRegionTab(city);
          const citySel = bel('bmCity');
          if (citySel && [...citySel.options].some(o => o.value === city)) {
            citySel.value = city;
            populateHotelSelect(city);
          }
          loadBmTowns();
        }
        renderBmMapLinks();
        try { updateFooterStatus(); } catch (_) {}
      });
      const note = document.getElementById('bmUsualLocNote' + suffix);
      if (note) note.style.display = 'none';
    });
    document.getElementById('cuSort')?.addEventListener('change', loadCustomers);
    document.getElementById('cuVisitDate')?.addEventListener('change', loadCustomers);
    document.getElementById('cuVisitClear')?.addEventListener('click', () => {
      const el = document.getElementById('cuVisitDate');
      if (el) el.value = '';
      loadCustomers();
    });
    document.getElementById('cuNg')?.addEventListener('change', loadCustomers);
    // NG登録: 区分を変えたら理由欄の出し入れ、プルダウンで選んだキャストをチップに積む
    document.getElementById('cmNgLevel')?.addEventListener('change', syncCmNgBox);
    document.getElementById('cmNgCastAdd')?.addEventListener('change', e => {
      const id = Number(e.target.value || 0);
      e.target.value = '';
      if (!id || cmNgCasts.some(n => Number(n.cast_admin_id) === id)) return;
      const u = findStaffUser(id);
      cmNgCasts.push({ cast_admin_id: id, display_name: u?.display_name || u?.username || '' });
      renderCmNgCasts();
      populateCmNgCastSelect();
    });
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
      shCurrent = getBusinessDayDate();
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
    // シフトの開始/終了 時select（営業日順 10時〜翌9時）＋ 分select（15分刻み）を構築
    // 既定は「--」（未選択）。時刻を選んだ時点で状態が「出勤」に変わる（店長指定 2026-08-25）
    ['smStartH', 'smEndH'].forEach(idv => { const el = document.getElementById(idv); if (el) el.innerHTML = '<option value="">--</option>' + bizHourOptions(); });
    { let mh = '<option value="">--</option>'; for (let m = 0; m < 60; m += 15) mh += `<option value="${m}">${('0' + m).slice(-2)}</option>`;
      ['smStartM', 'smEndM'].forEach(idv => { const el = document.getElementById(idv); if (el) el.innerHTML = mh; }); }
    // 時刻を選んだら、状態が「未定」のままなら自動で「出勤」にする（CTRLの出勤管理と同じUX・店長要望 2026-08-25）。
    // 時間を入れたのに未定のままで保存され、カレンダーに出ない事故を防ぐ
    ['smStartH', 'smStartM', 'smEndH', 'smEndM'].forEach(idv => {
      const el = document.getElementById(idv);
      if (!el) return;
      el.addEventListener('change', () => {
        if (el.value === '') return;                 // 「--」に戻したときは触らない
        const st = document.getElementById('smStatus');
        if (st && st.value === 'undecided') st.value = 'available';
        // 時だけ選んだら分は自動で00（出勤管理と同じUX）
        if (idv === 'smStartH' || idv === 'smEndH') {
          const m = document.getElementById(idv.replace('H', 'M'));
          if (m && m.value === '') m.value = '0';
        }
      });
    });

    // よく使う時間のチェック（24時間 / 早番 / 遅番）。どれか1つだけ・選んだら状態も「出勤」に
    const SM_PRESETS = {
      sm24h:   { start: '10:00', end: '10:00', lock: true  },   // 10:00〜翌10:00（入力欄は固定）
      smEarly: { start: '10:00', end: '19:00', lock: true  },   // 早番（時間欄は固定）
      smLate:  { start: '19:00', end: '10:00', lock: true  },   // 遅番（翌10:00・時間欄は固定）
    };
    // 24時間・早番・遅番のときは時刻欄を「--」のままにする（時間は決まっているので選ばせない・店長指定 2026-08-25）。
    // 保存時はチェックに対応する時刻を使う（下の saveShift 参照）
    const smTimeRowVis = () => {
      const row = document.getElementById('smTimeRow');
      if (row) row.style.display = 'grid';
    };
    window._smTimeRowVis = smTimeRowVis;   // モーダルを開いたときにも呼ぶ
    /** チェックが入っているプリセット（無ければ null） */
    window._smActivePreset = () => Object.keys(SM_PRESETS).find(id => document.getElementById(id)?.checked) || null;
    window._smPresetTimes = (id) => SM_PRESETS[id] || null;
    Object.keys(SM_PRESETS).forEach(pid => {
      const el = document.getElementById(pid);
      if (!el) return;
      el.addEventListener('change', () => {
        const on = el.checked;
        // 他のチェックは外す（同時に2つは選べない）
        if (on) Object.keys(SM_PRESETS).forEach(other => {
          if (other === pid) return;
          const o = document.getElementById(other);
          if (o) o.checked = false;
        });
        const p = SM_PRESETS[pid];
        if (on) {
          smTimeSet('smStart', '');   // 画面は「--」のまま。実際の時刻は保存時に入れる
          smTimeSet('smEnd', '');
          const em = document.getElementById('smEndMode');
          if (em && em.value !== 'time') { em.value = 'time'; const wrap = document.getElementById('smEndTimeWrap'); if (wrap) wrap.style.display = ''; }
          const st = document.getElementById('smStatus');
          if (st && st.value === 'undecided') st.value = 'available';   // 時間が決まった＝出勤
        }
        // 24時間・早番・遅番は入力欄を固定（時間は決まっているので触らせない・店長指定 2026-08-25）
        smTimeSetDisabled('smStart', on);
        smTimeSetDisabled('smEnd', on);
        smTimeRowVis();
      });
    });
    const smEmEl = document.getElementById('smEndMode');
    if (smEmEl) {
      smEmEl.addEventListener('change', e => {
        const isTime = e.target.value === 'time';
        const wrap = document.getElementById('smEndTimeWrap');
        if (wrap) wrap.style.display = isTime ? '' : 'none';
        if (!isTime) { const s24 = document.getElementById('sm24h'); if (s24 && s24.checked) { s24.checked = false; smTimeSetDisabled('smStart', false); smTimeSetDisabled('smEnd', false); } }
      });
    }

    // ========== コース管理イベント ==========
    document.getElementById('coAddNew').addEventListener('click', () => openCourseModal(null));
    document.getElementById('opAddNew')?.addEventListener('click', () => openOptionModal(null));
    document.getElementById('opSave')?.addEventListener('click', saveOption);
    document.getElementById('opDelete')?.addEventListener('click', deleteOption);
    // オプションのチェック → 合計を再計算（動的生成なので委譲）
    document.addEventListener('change', e => {
      if (e.target.name === 'bmOption' || e.target.name === 'bmOption-2') {
        // 個数が入った項目は枠を色づけて、選ばれていることが一目で分かるようにする
        e.target.closest('.bm-opt')?.classList.toggle('has-count', (parseInt(e.target.value, 10) || 0) > 0);
      }
      // メイン側も明示的に '' で計算する。activeBmSuffix が '-2'（クローンを開いた残り）のままだと
      // optionTotal()→bmOptionCounts() が別モーダルを読み、オプションを選んでも合計に即反映されなかった
      if (e.target.name === 'bmOption') withBmSuffix('', () => { updateBmOptionSum(); updateBookingTotal(); });
      else if (e.target.name === 'bmOption-2') withBmSuffix('-2', () => { updateBmOptionSum(); updateBookingTotal(); });
      // 媒体チェック（メインモーダル）。クローン側(-2)にだけ配線があり、こちらが漏れていたため
      // 媒体を選んでも ＋10分 が連動しなかった（店長指摘 2026-08-08）
      else if (e.target.name === 'bmMedia') {
        bmPlus10Touched[''] = false;   // 自動判定に戻す
        withBmSuffix('', () => { syncDealBadges(); updateEndTime(); updateBookingTotal(); });
      }
    });
    document.getElementById('coSave').addEventListener('click', saveCourse);
    document.getElementById('coDelete').addEventListener('click', deleteCourse);
    // ホテル管理（マスタ内から開く）
    document.getElementById('openHotelMgr')?.addEventListener('click', () => switchView('hotel'));
    document.getElementById('hotelBackToMaster')?.addEventListener('click', () => switchView('courses'));
    // 自宅の交通費（マスタ内から開く）
    document.getElementById('openCityFeeMgr')?.addEventListener('click', () => switchView('cityfee'));
    document.getElementById('cityFeeBackToMaster')?.addEventListener('click', () => switchView('courses'));
    document.querySelectorAll('input[name="cfRegion"]').forEach(r => r.addEventListener('change', () => {
      cfState.region = r.value;
      cfState.city = '';
      renderCfCities();
      renderCfTownPanel();
    }));
    document.getElementById('cfCityChips')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cf-city]');
      if (!b) return;
      cfState.city = b.dataset.cfCity;
      renderCfCities();
      renderCfTownPanel();
    });
    // 金額を選んだら即保存（全域も町名も同じ経路。空=未設定に戻す）
    document.getElementById('cfTownPanel')?.addEventListener('change', async (e) => {
      const sel = e.target.closest('select[data-cf-fee]');
      if (!sel || !cfState.city) return;
      const city = cfState.city;
      const town = sel.getAttribute('data-town') || '';
      const raw = sel.value;
      const label = town ? `${city} ${town}` : `${city}（全域）`;
      try {
        await apiPost('/admin-api.php?action=city-fee-set', { city, town, transport_fee: raw === '' ? null : Number(raw) });
        if (!CITY_FEES[city]) CITY_FEES[city] = {};
        if (raw === '') {
          delete CITY_FEES[city][town];
          if (!Object.keys(CITY_FEES[city]).length) delete CITY_FEES[city];
        } else {
          CITY_FEES[city][town] = Number(raw);
        }
        toast(raw === '' ? `✓ ${label} を未設定に戻しました` : `✓ ${label} を ¥${Number(raw).toLocaleString()} にしました`, 'ok');
        renderCfCities();
        renderCfTownPanel();
      } catch (err) { toast('保存失敗: ' + err.message, 'err'); renderCfTownPanel(); }
    });
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

    // 開始時刻 select 構築。並びは営業日と同じ 10時〜翌9時（店長要望 2026-08-08）。
    // 0時始まりだと深夜の予約を入れるのに毎回いちばん下まで送ることになる
    const shSel = bel('bmStartHour');
    shSel.innerHTML = bizHourOptions();
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
    document.getElementById('bmPhoneLookup')?.addEventListener('click', () => withBmSuffix('', lookupCustomerByPhoneManual));
    // 予約モーダル: 時刻/コース/休憩時間 変更時に終了時刻再計算
    bel('bmStartHour').addEventListener('change', () => { bmStartTouched[activeBmSuffix] = true; updateEndTime(); autoToggleLateNight(); });
    bel('bmStartMin').addEventListener('change', () => { bmStartTouched[activeBmSuffix] = true; updateEndTime(); autoToggleLateNight(); });
    bel('bmCourse').addEventListener('change', () => {
      updateEndTime();
      // コース選択時はベース料金（1本目＋組み合わせ2本目）を入れて合計を再計算
      applyCoursePrice();
      autoToggleLateNight();
      syncDealBadges();   // ホテル料金の引き額はコースごとに違う
    });
    const course2Sel = bel('bmCourse2');
    if (course2Sel) course2Sel.addEventListener('change', () => {
      syncComboUi();
      updateEndTime();
      applyCoursePrice();
      autoToggleLateNight();
      syncDealBadges();
    });
    // ＋10分のチェック: 手で触ったら自動判定を止める
    const p10Cb = bel('bmPlus10');
    if (p10Cb) p10Cb.addEventListener('change', () => {
      bmPlus10Touched[activeBmSuffix] = true;
      updateEndTime(); applyBonusCoursePrice(); updateBookingTotal();
    });
    // 媒体・予約経路: LINE予約で +10分 になるので終了時刻を再計算
    // 媒体を変えたら＋10分の自動判定をやり直す（LINEを入れたら自動で付く）。
    // そのあと手で外せば、次に媒体を触るまではその指定が残る
    mediaCheckboxes().forEach(cb => cb.addEventListener('change', () => {
      bmPlus10Touched[activeBmSuffix] = false;
      syncDealBadges(); updateEndTime(); applyBonusCoursePrice();
    }));
    // 延長回数: 終了時刻と合計を再計算
    const extSel = bel('bmExtCount');
    if (extSel) extSel.addEventListener('change', () => { updateEndTime(); updateBookingTotal(); });
    // 深夜料金チェック: 合計表示を更新 (bmPrice はコース料金のまま、保存時に合算)
    const lateCb = bel('bmLateNight');
    if (lateCb) lateCb.addEventListener('change', updateBookingTotal);
    // キャンペーン割引チェック: 合計を再計算
    const campCb = bel('bmCampaign');
    if (campCb) campCb.addEventListener('change', () => { updateBookingTotal(); syncCampaignFieldVisibility(); });
    // 初回ホテル特別料金: 手で触ったら自動チェックを止める
    const hfCb = bel('bmHotelFirst');
    if (hfCb) hfCb.addEventListener('change', () => { bmHotelFirstTouched[activeBmSuffix] = true; populateCourseSelect(); applyCoursePrice(); updateBookingTotal(); });
    // スタンプ特典: 合計を再計算
    const stampSel = bel('bmStampReward');
    if (stampSel) stampSel.addEventListener('change', updateBookingTotal);
    // ステータスの「💤 休憩・私用」で休憩モードに入る（独立したチェック行は廃止してここに集約）
    const stSel = bel('bmStatus');
    if (stSel) stSel.addEventListener('change', () => {
      const cb = bel('bmBreakMode');
      const want = stSel.value === 'break';
      if (cb && cb.checked !== want) { cb.checked = want; setBreakMode(want); }
    });
    // 指名方法: 指名料を合計へ反映
    const nomSel = bel('bmNomination');
    if (nomSel) nomSel.addEventListener('change', () => { updateBookingTotal(); syncDealBadges(); });
    // 料金の手入力・交通費の選択で合計再計算
    bel('bmPrice').addEventListener('input', updateBookingTotal);
    bel('bmTransport').addEventListener('change', updateBookingTotal);
    bel('bmDepositOverride')?.addEventListener('input', updateBookingTotal);
    // 併用の現金額。入れるたびにカード側の額と上乗せを引き直す
    bel('bmCashAmount')?.addEventListener('input', updateBookingTotal);
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
      r.addEventListener('change', () => { switchLocSection(r.value); syncDealBadges(); });
    });
    // 市区町村のエリア切替 → 市区町村を組み直す
    document.querySelectorAll('input[name="bmCityRegion"]').forEach(r => {
      r.addEventListener('change', () => { populateCitySelect(r.value); populateHotelSelect(bel('bmCity').value); });
    });
    // 市区町村変更 → ホテル絞り込み
    bel('bmCity').addEventListener('change', e => { populateHotelSelect(e.target.value); onCityChangedForHome(); loadBmTowns().then(applyHomeTransportFee); });
    bel('bmTown')?.addEventListener('change', () => { onTownChangedForHome(); applyHomeTransportFee(); syncTownHint(); });
    // ホテル変更 → そのホテルの交通費を初期値に入れる
    bel('bmHotelId')?.addEventListener('change', e => { applyHotelTransportFee(e.target.value); renderBmHotelAddr(); });
    // 連絡する時刻: 時を選んだら分は自動で 00（毎回 00 を選び直す手間をなくす・店長要望 2026-08-20）。
    // 分を自分で選んだあとは尊重する。時を「--」に戻したら分も空にする
    bel('bmPreDueH')?.addEventListener('change', e => {
      const m = bel('bmPreDueM');
      if (!m) return;
      if (!e.target.value) { m.value = ''; return; }
      if (!m.value) m.value = '00';
    });
    // ステータス変更 → キャンセル理由欄の表示制御＋合計注記更新
    bel('bmStatus').addEventListener('change', e => {
      bel('bmCancelWrap').style.display = bmIsCancel(e.target.value) ? 'block' : 'none';
      syncCancelTypeFromStatus();
      syncPrepWrap();
      updateBookingTotal();
    });
    // 担当キャスト・日付・開始時刻が変わると「直前のお仕事」も変わる。
    // モーダル①②どちらでも効くよう、id の頭で見て委譲で拾う
    document.addEventListener('change', e => {
      const id = e.target?.id || '';
      if (/^(bmAdminId|bmDate|bmStartHour|bmStartMin)(-2)?$/.test(id)) refreshPrevJobButtons();
      // お客様メモの「編集/追加」もキャスト・日付で入れ替わる。書きかけの時は触らない
      if (/^(bmAdminId|bmDate)(-2)?$/.test(id)) {
        document.querySelectorAll('[id^=bmHistoryPanel]').forEach(pane => {
          if (pane._noteRerender && !pane.querySelector('.bhn-ta')) { try { pane._noteRerender(); } catch (_) {} }
        });
      }
    });
    // 事前予約の「連絡手段(☎/💬)」と「内容(出勤確認/到着見込み)」。どちらも1つだけ選ぶ。
    // モーダル①②どちらでも効くよう委譲で受ける（もう一度押すと解除）
    document.addEventListener('click', e => {
      const btn = e.target?.closest?.('[data-prep-method], [data-prep-kind]');
      if (!btn) return;
      const isMethod = btn.hasAttribute('data-prep-method');
      const wrap = btn.closest('.bm-prep');
      if (!wrap) return;
      const hid = wrap.querySelector(isMethod ? '[id^=bmPreMethod]' : '[id^=bmPreKind]');
      const val = isMethod ? btn.dataset.prepMethod : btn.dataset.prepKind;
      const next = (hid && hid.value === val) ? '' : val;
      if (hid) hid.value = next;
      wrap.querySelectorAll(isMethod ? '.bm-prep-m' : '.bm-prep-k').forEach(x => {
        x.classList.toggle('is-on', (isMethod ? x.dataset.prepMethod : x.dataset.prepKind) === next);
      });
    });
    // 担当キャスト選択 → 問合せ状態なら自動で「予約」へ（キャストが決まった＝実予約成立）
    bel('bmAdminId').addEventListener('change', e => { autoStatusOnAssign(); renderCastAlert(); renderNgAlert(); syncDealBadges(); });
    // 日付を変えたら、その日の出勤キャストで担当プルダウンを組み直す
    bel('bmDate')?.addEventListener('change', e => {
      syncBmDateDisp();
      applyDefaultStartOnDateChange();
      populateCastSelect(e.target.value, bel('bmAdminId').value);
    });
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
      if (ce && canManageStaffTab()) {
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

    // タイムラインとタブバーを掴んで動かせるようにする（縦のページ送りはタイムラインだけ）
    initDragScroll('.tl-wrap', true);
    initDragScroll('.tab-nav', false);
    initTableDragScroll();   // ご利用履歴の表（横に長い）を掴んで動かせるように
    // コース・オプションのマスタは報酬計算の元。読み終える前に画面を描くと
    // コース報酬が0円のまま（指名料ぶんだけ）の少額で出てしまうため、ここで待つ（店長指摘 2026-08-14）
    try { await Promise.all([ensureCoursesLoaded(), ensureOptionsLoaded()]); } catch (e) {}
    // 入室方法マスタを起動時にロード（select の選択肢で必要）
    loadEntryMethods();

    // チャット管理イベントバインド (owner のみ実質的に使う)
    bindChatEvents();

    // 初期表示。更新で戻ってきたときは、見ていた画面へ最後に切り替える
    // （途中で switchView すると、まだ組み立てていない部分を呼ぶ恐れがあるため最後に回す）
    const back = window._opsRestoredView;
    if (currentUser?.role === 'staff') { /* キャストは上でマイページに分岐済み */ }
    else if (back) switchView(back);            // タイムラインでも switchView 経由で読み込む
    else if (currentUser?.role !== 'manager') loadTimeline();

    // バックグラウンドで未読バッジ更新（チャットタブが見える人）
    if (userCanSeeTab('chat')) {
      updateChatBadgeOnly();
      setInterval(updateChatBadgeOnly, 30000);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
