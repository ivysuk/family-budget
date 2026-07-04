// ---- 아래 URL은 본인의 Apps Script 웹앱 배포 URL로 이미 맞춰져 있어야 합니다 ----
const API_URL = 'https://script.google.com/macros/s/AKfycbyU0pCYYAOeraIVX4toNZYANq3oohIT3aD3Q6vs-ep0UgcTWTEI7Z086bo-hvGjQ-r7/exec';

let PASS = localStorage.getItem('familyBudgetPass') || '';
let YM = currentYearMonth();
let lastData = null;

function currentYearMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function api(action, params) {
  params = Object.assign({}, params || {}, { action: action, pass: PASS });
  const qs = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k] == null ? '' : params[k])).join('&');
  return fetch(API_URL + '?' + qs)
    .then(r => r.json())
    .then(data => {
      if (data && data.error === 'unauthorized') throw { unauthorized: true };
      if (data && data.error) throw new Error(data.error);
      return data;
    });
}

function fmt(n) { return Number(n || 0).toLocaleString(); }
function rawNumber(el) { return el.value.replace(/[^\d]/g, ''); }

document.addEventListener('input', e => {
  if (e.target.classList && e.target.classList.contains('money')) {
    const raw = e.target.value.replace(/[^\d]/g, '');
    e.target.value = raw ? Number(raw).toLocaleString() : '';
  }
});

// ---------------------------------------------------------------------
// 탭 전환
// ---------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.getElementById('refresh-btn').addEventListener('click', () => loadDashboard(true));
  boot();
});

function switchTab(name) {
  document.querySelectorAll('.tab-view').forEach(v => v.classList.toggle('hidden', v.dataset.view !== name));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.getElementById('main').scrollTop = 0;
}

// ---------------------------------------------------------------------
// 부팅 / 인증
// ---------------------------------------------------------------------
// 화면은 항상 즉시 보여준다(스켈레톤으로). 이전에 불러온 데이터가 캐시에 있으면
// 그걸 먼저 그대로 그려서 체감 로딩을 없애고, 그 사이에 구글 서버에서 최신 데이터를
// 조용히 받아와서 덮어쓴다 (stale-while-revalidate).

function cacheKey(ym) { return 'familyBudgetCache_' + ym; }

function readCache(ym) {
  try { return JSON.parse(localStorage.getItem(cacheKey(ym))); } catch (e) { return null; }
}

function writeCache(ym, data) {
  try { localStorage.setItem(cacheKey(ym), JSON.stringify(data)); } catch (e) { /* 용량 초과 등은 무시 */ }
}

function showStatus(text) {
  const el = document.getElementById('status-banner');
  if (!text) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.textContent = text;
  el.classList.remove('hidden');
}

function boot() {
  document.getElementById('ym-label').textContent = YM + ' 기준';
  renderSkeleton();

  if (API_URL.indexOf('PUT_YOUR') === 0) {
    showStatus('app.js의 API_URL을 Apps Script 웹앱 URL로 바꿔주세요.');
    return;
  }

  const cached = readCache(YM);
  if (cached) {
    renderDashboard(cached);
    loadMonthPicker();
    unlockAndLoad(true); // 화면은 이미 떠 있으니 조용히 최신화만
  } else {
    unlockAndLoad(false);
  }
}

function unlockAndLoad(silent) {
  api('dashboard', { ym: YM }).then(data => {
    showStatus(null);
    renderDashboard(data);
    writeCache(YM, data);
    loadMonthPicker();
  }).catch(err => {
    if (err && err.unauthorized) {
      const input = prompt('비밀번호를 입력하세요');
      if (input === null) { if (!silent) showStatus('비밀번호가 필요합니다.'); return; }
      PASS = input;
      localStorage.setItem('familyBudgetPass', PASS);
      unlockAndLoad(silent);
    } else if (!silent) {
      showStatus('연결 오류가 발생했어요: ' + err.message);
    }
  });
}

// ---------------------------------------------------------------------
// 대시보드 로드 / 렌더
// ---------------------------------------------------------------------

function loadDashboard(showSpin) {
  const btn = document.getElementById('refresh-btn');
  if (showSpin) btn.classList.add('spinning');
  api('dashboard', { ym: YM }).then(data => {
    renderDashboard(data);
    btn.classList.remove('spinning');
  }).catch(e => { btn.classList.remove('spinning'); alert('불러오기 오류: ' + e.message); });
}

function renderSkeleton() {
  const balanceEl = document.getElementById('system-balance');
  balanceEl.closest('.hero').classList.add('skel-hero');
  balanceEl.textContent = '000,000';

  const ringGrid = document.getElementById('ring-grid');
  ringGrid.classList.add('skel-rings');
  ringGrid.innerHTML = Array(3).fill(0).map(() => `
    <div class="skel-ring">
      <div class="skel skel-circle"></div>
      <div class="skel skel-line"></div>
    </div>`).join('');

  const rowSkeleton = (n) => Array(n).fill(0).map(() => `
    <div class="skel-row">
      <div class="skel skel-icon"></div>
      <div class="skel-lines"><div class="skel"></div><div class="skel"></div></div>
    </div>`).join('');

  document.getElementById('breakdown-list').innerHTML = rowSkeleton(2);
  document.getElementById('payment-list').innerHTML = rowSkeleton(3);
  document.getElementById('claim-list').innerHTML = rowSkeleton(3);
  document.getElementById('recurring-list').innerHTML = rowSkeleton(2);
}

function loadMonthPicker() {
  api('availableMonths').then(months => {
    const sel = document.getElementById('month-picker');
    sel.innerHTML = months.map(m => `<option value="${m}" ${m === YM ? 'selected' : ''}>${m}${m === currentYearMonth() ? ' (이번달)' : ''}</option>`).join('');
    sel.onchange = () => { YM = sel.value; document.getElementById('ym-label').textContent = YM + ' 기준'; loadDashboard(); };
  });
}

function animateNumber(el, to) {
  const from = 0;
  const dur = 650;
  const t0 = performance.now();
  function step(t) {
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(Math.round(from + (to - from) * eased));
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function renderDashboard(data) {
  lastData = data;

  document.getElementById('system-balance').closest('.hero').classList.remove('skel-hero');
  document.getElementById('ring-grid').classList.remove('skel-rings');

  const activeMembers = data.members.filter(m => m.status !== '휴면');
  ['pay-name', 'claim-name'].forEach(id => {
    const sel = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = activeMembers.map(m => `<option>${m.name}</option>`).join('');
    if (activeMembers.some(m => m.name === prev)) sel.value = prev;
  });

  const catSel = document.getElementById('claim-category');
  const prevCat = catSel.value;
  catSel.innerHTML = data.categories.map(c => `<option>${c}</option>`).join('');
  if (data.categories.indexOf(prevCat) !== -1) catSel.value = prevCat;

  animateNumber(document.getElementById('system-balance'), data.systemBalance);
  document.getElementById('initial-balance-input').value = data.initialBalance ? fmt(data.initialBalance) : '';
  renderMemberList(data.members);

  renderRings(data);
  renderBreakdown(data.categoryBreakdown || []);
  renderHeroStats(data);
  renderPaymentList(data.payments);
  renderClaimList(data.claims);
  renderRecurringList(data.recurring);
}

function renderHeroStats(data) {
  const activeMembers = data.members.filter(m => m.status !== '휴면');
  const totalTarget = activeMembers.reduce((s, m) => s + (m.effectiveTarget != null ? m.effectiveTarget : (m.target || 0)), 0);
  const totalPaid = data.payments.reduce((s, p) => s + Number(p.amount), 0);
  const pct = totalTarget > 0 ? Math.min(100, Math.round(totalPaid / totalTarget * 100)) : 0;
  document.getElementById('hero-goal-progress').textContent = totalTarget > 0 ? pct + '%' : '목표 미설정';
  const totalSpent = (data.categoryBreakdown || []).reduce((s, b) => s + b.total, 0);
  document.getElementById('hero-spent').textContent = fmt(totalSpent) + '원';
}

const ICONS = {
  공과금: '<path d="M13 2L3 14h7l-1 8 11-14h-8l1-6z"/>',
  월세: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10"/>',
  생활비: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  기타: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  렌탈료: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  기본: '<circle cx="12" cy="12" r="9"/>',
};
function iconFor(cat) { return ICONS[cat] || ICONS.기본; }

function renderRings(data) {
  const paidByName = {};
  data.payments.forEach(p => { paidByName[p.name] = (paidByName[p.name] || 0) + Number(p.amount); });

  const list = document.getElementById('ring-grid');
  if (!data.members.length) {
    list.innerHTML = '<div class="msg">가족구성원 탭에 이름을 먼저 등록해주세요.</div>';
    return;
  }
  list.innerHTML = data.members.map(m => {
    const dormant = m.status === '휴면';
    const paid = paidByName[m.name] || 0;
    const target = m.target || 0;
    const carryover = m.carryover || 0;
    const effectiveTarget = m.effectiveTarget != null ? m.effectiveTarget : target;
    const pct = effectiveTarget > 0 ? Math.min(100, Math.round(paid / effectiveTarget * 100)) : 0;
    const complete = effectiveTarget > 0 && paid >= effectiveTarget;
    const size = 68, stroke = 6, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const offset = c * (1 - pct / 100);
    const color = complete ? 'var(--good)' : 'var(--accent)';
    const carryoverNote = (!dormant && carryover > 0)
      ? `<div class="ring-carry">이월 ${fmt(carryover)}원 포함</div>`
      : '';
    const controls = dormant
      ? `<div class="ring-dormant-pill">휴면중</div>`
      : `<button class="ring-goal-btn" type="button" onclick="openGoalModal('${m.name}')">목표 설정</button>`;
    return `<div class="ring-item${dormant ? ' dormant' : ''}">
      <div class="ring-wrap">
        <svg width="${size}" height="${size}">
          <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--accent-soft)" stroke-width="${stroke}"/>
          <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
            stroke-dasharray="${c}" stroke-dashoffset="${offset}"/>
        </svg>
        <div class="ring-label">${pct}%</div>
      </div>
      <div class="ring-name">${m.name}</div>
      <div class="ring-amt">${fmt(paid)}${effectiveTarget ? ' / ' + fmt(effectiveTarget) : ''}</div>
      ${carryoverNote}
      ${controls}
    </div>`;
  }).join('');
}

function renderBreakdown(items) {
  const box = document.getElementById('breakdown-list');
  if (!items.length) { box.innerHTML = '<div class="msg">이번 달 지출 청구가 아직 없어요.</div>'; return; }
  const max = Math.max(...items.map(i => i.total));
  box.innerHTML = items.map(i => `<div class="bar-row">
    <div class="bar-top"><span class="cat"><span class="dot"></span>${i.category}</span><span class="amt">${fmt(i.total)}원</span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${Math.round(i.total / max * 100)}%"></div></div>
  </div>`).join('');
}

function renderPaymentList(payments) {
  const box = document.getElementById('payment-list');
  if (!payments.length) { box.innerHTML = '<div class="empty-state">아직 이번 달 납부 기록이 없어요.</div>'; return; }
  box.innerHTML = payments.map(p => {
    const d = p.date ? new Date(p.date) : null;
    const dateStr = d ? (d.getMonth() + 1) + '월 ' + d.getDate() + '일' : '-';
    return `<div class="list-row">
      <div class="list-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></div>
      <div class="list-body"><div class="list-title">${p.name}</div><div class="list-sub">${dateStr}</div></div>
      <div class="list-right"><div class="list-amt">${fmt(p.amount)}원</div><span class="pill done">${p.status}</span></div>
    </div>`;
  }).join('');
}

function renderClaimList(claims) {
  const box = document.getElementById('claim-list');
  if (!claims.length) { box.innerHTML = '<div class="empty-state">아직 지출 청구가 없어요.</div>'; return; }
  box.innerHTML = claims.map(c => {
    const pillClass = c.status === '이체완료' ? 'done' : 'pending';
    const recurringBadge = c.isRecurring ? '<span class="pill recurring">정기</span>' : '';
    const btn = c.status === '청구중' ? `<button class="btn small" style="margin-top:6px;" onclick="markDone('${c.claimId}')">완료 처리</button>` : '';
    return `<div class="list-row">
      <div class="list-icon gold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconFor(c.category)}</svg></div>
      <div class="list-body"><div class="list-title">${c.claimant}${recurringBadge}</div><div class="list-sub">${c.category}${c.memo ? ' · ' + c.memo : ''}</div>${btn}</div>
      <div class="list-right"><div class="list-amt">${fmt(c.amount)}원</div><span class="pill ${pillClass}">${c.status}</span></div>
    </div>`;
  }).join('');
}

function renderMemberList(members) {
  const box = document.getElementById('member-list');
  if (!box) return;
  if (!members.length) { box.innerHTML = '<div class="empty-state">등록된 구성원이 없어요.</div>'; return; }
  box.innerHTML = members.map(m => {
    const dormant = m.status === '휴면';
    return `<div class="list-row">
      <div class="list-icon${dormant ? '' : ' gold'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1"/></svg></div>
      <div class="list-body"><div class="list-title">${m.name}</div><div class="list-sub">월 목표 ${fmt(m.target)}원</div></div>
      <div class="list-right"><button class="btn small" onclick="doToggleStatus('${m.name}','${m.status}')">${dormant ? '휴면 해제' : '휴면 전환'}</button></div>
    </div>`;
  }).join('');
}

function renderRecurringList(items) {
  const box = document.getElementById('recurring-list');
  if (!items.length) { box.innerHTML = '<div class="empty-state">등록된 정기지출이 없어요.</div>'; return; }
  box.innerHTML = items.map(r => `<div class="list-row">
    <div class="list-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconFor('렌탈료')}</svg></div>
    <div class="list-body"><div class="list-title">${r.name}</div><div class="list-sub">${r.cycle}</div></div>
    <div class="list-right"><div class="list-amt">${fmt(r.amount)}원</div></div>
  </div>`).join('');
}

// ---------------------------------------------------------------------
// 액션 핸들러
// ---------------------------------------------------------------------

function setMsg(id, text, ok) { const el = document.getElementById(id); el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'err'); }

function doSetInitialBalance() {
  const raw = rawNumber(document.getElementById('initial-balance-input'));
  if (!raw) { setMsg('initial-balance-msg', '금액을 입력해주세요.', false); return; }
  api('setInitialBalance', { amount: raw }).then(() => { setMsg('initial-balance-msg', '저장했습니다.', true); loadDashboard(); })
    .catch(e => setMsg('initial-balance-msg', '오류: ' + e.message, false));
}

let goalModalName = null;

function openGoalModal(name) {
  const m = (lastData && lastData.members || []).find(x => x.name === name);
  if (!m) return;
  goalModalName = name;
  document.getElementById('goal-modal-name').textContent = name + ' 목표 설정';
  document.getElementById('goal-modal-input').value = m.target ? fmt(m.target) : '';
  const carryBox = document.getElementById('goal-modal-carry');
  if (m.carryover > 0) {
    carryBox.style.display = '';
    document.getElementById('goal-modal-carry-amt').textContent = fmt(m.carryover) + '원';
  } else {
    carryBox.style.display = 'none';
  }
  document.getElementById('goal-modal').classList.remove('hidden');
}

function closeGoalModal() {
  document.getElementById('goal-modal').classList.add('hidden');
  goalModalName = null;
}

function doSetTargetModal() {
  if (!goalModalName) return;
  const raw = rawNumber(document.getElementById('goal-modal-input'));
  if (!raw) return;
  api('setTarget', { name: goalModalName, amount: raw }).then(() => {
    closeGoalModal();
    loadDashboard();
  });
}

function doAddMember() {
  const name = document.getElementById('member-name').value.trim();
  const target = rawNumber(document.getElementById('member-target'));
  if (!name) { setMsg('member-msg', '이름을 입력해주세요.', false); return; }
  api('addMember', { name: name, target: target || 0 }).then(r => {
    if (r.error) { setMsg('member-msg', r.error, false); return; }
    setMsg('member-msg', '추가했습니다.', true);
    document.getElementById('member-name').value = '';
    document.getElementById('member-target').value = '';
    loadDashboard();
  }).catch(e => setMsg('member-msg', '오류: ' + e.message, false));
}

function doToggleStatus(name, currentStatus) {
  const next = currentStatus === '휴면' ? '활성' : '휴면';
  api('setMemberStatus', { name: name, status: next }).then(loadDashboard);
}

function doPayment() {
  const name = document.getElementById('pay-name').value;
  const amount = rawNumber(document.getElementById('pay-amount'));
  if (!amount) { setMsg('pay-msg', '금액을 입력해주세요.', false); return; }
  api('recordPayment', { ym: YM, name: name, amount: amount }).then(() => {
    setMsg('pay-msg', '등록 완료했습니다.', true);
    document.getElementById('pay-amount').value = '';
    loadDashboard();
  }).catch(e => setMsg('pay-msg', '오류: ' + e.message, false));
}

function doClaim() {
  const claimant = document.getElementById('claim-name').value;
  const category = document.getElementById('claim-category').value;
  const amount = rawNumber(document.getElementById('claim-amount'));
  const memo = document.getElementById('claim-memo').value;
  if (!amount) { setMsg('claim-msg', '금액을 입력해주세요.', false); return; }
  api('submitClaim', { claimant: claimant, category: category, amount: amount, memo: memo }).then(() => {
    setMsg('claim-msg', '청구했습니다.', true);
    document.getElementById('claim-amount').value = '';
    document.getElementById('claim-memo').value = '';
    loadDashboard();
  }).catch(e => setMsg('claim-msg', '오류: ' + e.message, false));
}

function doAddCategory() {
  const name = prompt('추가할 지출 항목명을 입력하세요 (예: 관리비)');
  if (!name) return;
  api('addCategory', { name: name }).then(loadDashboard);
}

function markDone(claimId) { api('markReimbursed', { claimId: claimId }).then(loadDashboard); }

function doRecurring() {
  const name = document.getElementById('rec-name').value;
  const amount = rawNumber(document.getElementById('rec-amount'));
  const cycle = document.getElementById('rec-cycle').value;
  if (!name || !amount) { setMsg('rec-msg', '항목명/금액을 입력해주세요.', false); return; }
  api('registerRecurring', { name: name, amount: amount, cycle: cycle }).then(() => {
    setMsg('rec-msg', '등록했습니다.', true);
    document.getElementById('rec-name').value = '';
    document.getElementById('rec-amount').value = '';
    loadDashboard();
  }).catch(e => setMsg('rec-msg', '오류: ' + e.message, false));
}

function copyAccountNumber(btn) {
  const number = '3333340661190';
  const showCopied = () => {
    const original = btn.textContent;
    btn.textContent = '복사됨';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(number).then(showCopied).catch(() => fallbackCopyText(number, showCopied));
  } else {
    fallbackCopyText(number, showCopied);
  }
}

function fallbackCopyText(text, cb) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* 무시 */ }
  document.body.removeChild(ta);
  cb();
}

function doReconcile() {
  const actual = rawNumber(document.getElementById('actual-balance'));
  const box = document.getElementById('reconcile-msg');
  if (!actual) { box.innerHTML = '<div class="msg err">실제 잔액을 입력해주세요.</div>'; return; }
  api('reconcile', { ym: YM, amount: actual }).then(r => {
    const ok = r.diff === 0;
    box.innerHTML = `<div class="reconcile-result">시스템 ${fmt(r.systemBalance)}원 · 실제 ${fmt(r.actualBalance)}원<br>차이 <span class="diff ${ok ? 'ok' : 'bad'}">${fmt(r.diff)}원${ok ? ' (일치)' : ''}</span></div>`;
  }).catch(e => box.innerHTML = `<div class="msg err">오류: ${e.message}</div>`);
}
