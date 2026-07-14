/**
 * 가족 공동통장 관리 - 백엔드 (Apps Script를 JSON API로만 사용)
 * 화면(HTML)은 이제 여기서 안 만들고 GitHub Pages(docs/index.html)에서 fetch()로 이 API를 호출한다.
 * 이유: Apps Script의 HtmlService(google.script.run) 방식은 URL이 못생기고 로딩 화면이 튀는 등 불편해서,
 * 화면 호스팅과 데이터 백엔드를 분리했다. 둘 다 완전 무료로 유지 가능.
 *
 * API 호출 규약: 모든 요청(조회/등록/수정 전부)을 GET 쿼리 파라미터로 받는다.
 * (POST+JSON을 쓰면 브라우저가 CORS preflight를 보내는데 Apps Script가 이를 제대로 처리하지 못해
 *  외부 도메인에서 호출이 막히는 경우가 많다. GET은 이 문제가 없어서 안정적으로 동작한다.)
 * 예: https://script.google.com/macros/s/xxx/exec?action=dashboard&ym=2026-07&pass=1234
 *
 * 시트 탭: 가족구성원 / 월별납부 / 지출청구 / 렌탈료(정기지출) / 거래원장 / 잔액대사
 *          + 자동 생성: 설정 / 지출항목
 */

function doGet(e) { return handleApi(e); }
function doPost(e) { return handleApi(e); }

function handleApi(e) {
  ensureSheetsExist();
  const p = (e && e.parameter) || {};
  try {
    if (!checkPasscode(p.pass)) {
      return jsonOut({ error: 'unauthorized', message: '비밀번호가 올바르지 않습니다.' });
    }
    let result;
    switch (p.action) {
      case 'dashboard': result = getDashboard(p.ym); break;
      case 'recordPayment': result = recordPayment(p.ym, p.name, p.amount); break;
      case 'submitClaim': result = submitExpenseClaim(p.claimant, p.category, p.amount, p.memo); break;
      case 'markReimbursed': result = markReimbursed(p.claimId); break;
      case 'registerRecurring': result = registerRecurring(p.name, p.amount, p.cycle); break;
      case 'claimRecurring': result = claimRecurringForMonth(p.name, p.ym, p.amount); break;
      case 'addCategory': result = addCategory(p.name); break;
      case 'setTarget': result = setMemberTarget(p.name, p.amount); break;
      case 'addMember': result = addMember(p.name, p.target); break;
      case 'setMemberStatus': result = setMemberStatus(p.name, p.status); break;
      case 'setInitialBalance': result = setInitialBalance(p.amount); break;
      case 'reconcile': result = recordActualBalance(p.ym, p.amount); break;
      case 'categoryBreakdown': result = getCategoryBreakdown(p.ym); break;
      case 'availableMonths': result = getAvailableMonths(); break;
      case 'monthSummary': result = getMonthSummary(p.ym); break;
      default: result = { error: 'unknown action: ' + p.action };
    }
    return jsonOut(result);
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSS() { return SpreadsheetApp.getActiveSpreadsheet(); }

function getSheet(name) {
  const sheet = getSS().getSheetByName(name);
  if (!sheet) throw new Error('시트를 찾을 수 없음: ' + name);
  return sheet;
}

// -------------------------------------------------------------------------
// 자가치유: 이전 버전 시트에 없던 탭/컬럼을 처음 실행 시 자동으로 만들어준다
// -------------------------------------------------------------------------

function ensureSheetsExist() {
  const ss = getSS();

  if (!ss.getSheetByName('설정')) {
    const s = ss.insertSheet('설정');
    s.appendRow(['키', '값']);
    s.appendRow(['초기잔액', 0]);
    s.appendRow(['비밀번호', '']); // 비워두면 비밀번호 없이 누구나 접근 가능
  }

  if (!ss.getSheetByName('지출항목')) {
    const s = ss.insertSheet('지출항목');
    s.appendRow(['항목명']);
    ['공과금', '월세', '생활비', '기타'].forEach(c => s.appendRow([c]));
  }

  const fam = getSheet('가족구성원');
  const lastCol = Math.max(fam.getLastColumn(), 1);
  const headers = fam.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf('월목표금액') === -1) {
    fam.getRange(1, lastCol + 1).setValue('월목표금액');
  }
  if (headers.indexOf('상태') === -1) {
    fam.getRange(1, fam.getLastColumn() + 1).setValue('상태');
  }
}

// -------------------------------------------------------------------------
// 비밀번호 (간단한 가족 공용 암호 - 정식 계정/로그인 아님)
// -------------------------------------------------------------------------

function checkPasscode(pass) {
  const data = getSheet('설정').getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === '비밀번호') {
      const set = String(data[i][1] || '');
      return set === '' || set === String(pass || '');
    }
  }
  return true;
}

// -------------------------------------------------------------------------
// 연월 문자열 처리 (구글시트가 "2026-07" 같은 문자열을 날짜로 자동 변환해버리는
// 문제가 있어서, 쓸 때는 텍스트 서식을 강제하고 읽을 때는 날짜든 문자열이든
// 항상 "yyyy-MM" 문자열로 통일해서 비교한다)
// -------------------------------------------------------------------------

function ymString(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM');
  }
  return String(val || '');
}

// -------------------------------------------------------------------------
// 가족 구성원 (+ 월 목표금액)
// -------------------------------------------------------------------------

function getFamilyMembers() {
  const sheet = getSheet('가족구성원');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const targetIdx = headers.indexOf('월목표금액');
  const statusIdx = headers.indexOf('상태');
  return data.slice(1)
    .filter(row => row[0])
    .map(row => ({
      name: row[0],
      contact: row[1] || '',
      target: targetIdx >= 0 ? (Number(row[targetIdx]) || 0) : 0,
      status: (statusIdx >= 0 && row[statusIdx]) ? row[statusIdx] : '활성',
    }));
}

function addMember(name, target) {
  if (!name) throw new Error('이름이 필요합니다.');
  const sheet = getSheet('가족구성원');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const targetIdx = headers.indexOf('월목표금액');
  const statusIdx = headers.indexOf('상태');
  if (data.slice(1).some(row => row[0] === name)) {
    return { ok: false, error: '이미 있는 이름입니다: ' + name };
  }
  const rowNum = sheet.getLastRow() + 1;
  sheet.getRange(rowNum, 1).setValue(name);
  if (targetIdx >= 0) sheet.getRange(rowNum, targetIdx + 1).setValue(Number(target) || 0);
  if (statusIdx >= 0) sheet.getRange(rowNum, statusIdx + 1).setValue('활성');
  return { ok: true };
}

function setMemberTarget(name, amount) {
  const sheet = getSheet('가족구성원');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const targetIdx = headers.indexOf('월목표금액');
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === name) {
      sheet.getRange(i + 1, targetIdx + 1).setValue(Number(amount));
      return { ok: true };
    }
  }
  return { ok: false, error: '구성원을 찾을 수 없음: ' + name };
}

function setMemberStatus(name, status) {
  if (status !== '활성' && status !== '휴면') throw new Error('상태는 활성/휴면 중 하나여야 합니다.');
  const sheet = getSheet('가족구성원');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const statusIdx = headers.indexOf('상태');
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === name) {
      sheet.getRange(i + 1, statusIdx + 1).setValue(status);
      return { ok: true };
    }
  }
  return { ok: false, error: '구성원을 찾을 수 없음: ' + name };
}

// -------------------------------------------------------------------------
// 초기잔액 / 설정
// -------------------------------------------------------------------------

function getInitialBalance() {
  const data = getSheet('설정').getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === '초기잔액') return Number(data[i][1]) || 0;
  }
  return 0;
}

function setInitialBalance(amount) {
  const sheet = getSheet('설정');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === '초기잔액') {
      sheet.getRange(i + 1, 2).setValue(Number(amount));
      return { ok: true };
    }
  }
  sheet.appendRow(['초기잔액', Number(amount)]);
  return { ok: true };
}

// -------------------------------------------------------------------------
// 지출 항목 (사용자가 추가 가능)
// -------------------------------------------------------------------------

function getCategories() {
  const data = getSheet('지출항목').getDataRange().getValues();
  return data.slice(1).map(row => row[0]).filter(Boolean);
}

function addCategory(name) {
  if (!name) throw new Error('항목명이 필요합니다.');
  const existing = getCategories();
  if (existing.indexOf(name) === -1) {
    getSheet('지출항목').appendRow([name]);
  }
  return { ok: true };
}

// -------------------------------------------------------------------------
// 월별 납부 (수입)
// -------------------------------------------------------------------------

function recordPayment(yearMonth, name, amount) {
  if (!yearMonth || !name || !amount) throw new Error('연월/이름/금액은 필수입니다.');
  const sheet = getSheet('월별납부');
  const today = new Date();
  const rowNum = sheet.getLastRow() + 1;
  sheet.getRange(rowNum, 1).setNumberFormat('@').setValue(String(yearMonth));
  sheet.getRange(rowNum, 2, 1, 4).setValues([[name, Number(amount), today, '완료']]);
  postLedger(today, '공동통장', name + ' 납부금', Number(amount), name, yearMonth + ' 생활비 납부', '월별납부', rowNum);
  return { ok: true };
}

function getMonthlyPayments(yearMonth) {
  const data = getSheet('월별납부').getDataRange().getValues();
  return data.slice(1)
    .filter(row => row[0] && ymString(row[0]) === yearMonth)
    .map(row => ({ yearMonth: ymString(row[0]), name: row[1], amount: row[2], date: row[3], status: row[4] }));
}

// -------------------------------------------------------------------------
// 지출 청구 (가족이 먼저 쓰고 청구 -> 보스가 이체)
// -------------------------------------------------------------------------

function submitExpenseClaim(claimant, category, amount, memo) {
  if (!claimant || !category || !amount) throw new Error('청구자/항목/금액은 필수입니다.');
  const sheet = getSheet('지출청구');
  const today = new Date();
  const claimId = 'C' + today.getTime();
  sheet.appendRow([claimId, today, claimant, category, Number(amount), memo || '', '청구중', '']);
  return { ok: true, claimId };
}

function getExpenseClaims(status) {
  const data = getSheet('지출청구').getDataRange().getValues();
  return data.slice(1)
    .filter(row => row[0] && (!status || row[6] === status))
    .map(row => ({
      claimId: row[0], date: row[1], claimant: row[2], category: row[3],
      amount: row[4], memo: String(row[5] || '').replace(/^\[정기:[^\]]+\]\s*/, ''),
      status: row[6], transferDate: row[7],
      isRecurring: /^\[정기:/.test(String(row[5] || '')),
    }));
}

function markReimbursed(claimId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet('지출청구');
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === claimId) {
        if (data[i][6] === '이체완료') {
          // 이미 처리된 청구를 다시 완료 처리하면 거래원장에 같은 지출이 두 번
          // 기록돼서 잔액이 어긋난다 (중복 클릭/동시 접속 방지)
          return { ok: false, error: '이미 완료 처리된 청구입니다.' };
        }
        const rowNum = i + 1;
        const today = new Date();
        sheet.getRange(rowNum, 7).setValue('이체완료');
        sheet.getRange(rowNum, 8).setValue(today);
        postLedger(today, data[i][3], '공동통장', data[i][4], data[i][2], '지출 정산: ' + data[i][5], '지출청구', data[i][0]);
        return { ok: true };
      }
    }
    return { ok: false, error: '청구ID를 찾을 수 없음: ' + claimId };
  } finally {
    lock.releaseLock();
  }
}

// -------------------------------------------------------------------------
// 렌탈료(정기지출) 등록 + 이번 달 미입력 항목 확인 + 사용자가 직접 청구 확정
//
// (예전엔 대시보드를 열 때마다 자동으로 청구를 생성했는데, 가족이 동시에 여러
//  기기로 접속하면 잠금 없이 같은 달 같은 항목이 두 번 생기는 경쟁 상태가 있었고
//  그게 그대로 완료 처리되면서 잔액이 어긋나는 원인이었다. 이제는 자동 생성 대신
//  "이번 달에 아직 확정 안 된 정기지출" 목록만 보여주고, 금액을 확인/수정한 뒤
//  사용자가 직접 "청구하기"를 눌러야만 실제 청구 한 건이 생긴다. 등록 시 넣는
//  금액은 다음 달 입력창의 기본값(참고용)일 뿐, 매달 금액이 달라도 그때그때
//  입력해서 청구하면 된다.)
// -------------------------------------------------------------------------

function registerRecurring(itemName, amount, cycle) {
  if (!itemName) throw new Error('항목명은 필수입니다.');
  getSheet('렌탈료(정기지출)').appendRow([itemName, Number(amount) || 0, cycle || '매월', '']);
  return { ok: true };
}

function getRecurringItems() {
  const data = getSheet('렌탈료(정기지출)').getDataRange().getValues();
  return data.slice(1)
    .filter(row => row[0])
    .map(row => ({ name: row[0], amount: row[1], cycle: row[2], nextDate: row[3] }));
}

function getPendingRecurringForMonth(yearMonth) {
  const recurring = getRecurringItems();
  if (!recurring.length) return [];
  const rows = getSheet('지출청구').getDataRange().getValues().slice(1);
  return recurring
    .filter(item => {
      const tag = '[정기:' + item.name + ':' + yearMonth + ']';
      return !rows.some(row => String(row[5] || '').indexOf(tag) !== -1);
    })
    .map(item => ({ name: item.name, suggestedAmount: item.amount, cycle: item.cycle }));
}

function claimRecurringForMonth(itemName, yearMonth, amount) {
  if (!itemName || !yearMonth || !amount) throw new Error('항목/연월/금액은 필수입니다.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const tag = '[정기:' + itemName + ':' + yearMonth + ']';
    const sheet = getSheet('지출청구');
    const rows = sheet.getDataRange().getValues().slice(1);
    const already = rows.some(row => String(row[5] || '').indexOf(tag) !== -1);
    if (already) return { ok: false, error: '이미 이번 달에 등록된 정기지출입니다.' };

    const today = new Date();
    const claimId = 'R' + today.getTime() + Math.floor(Math.random() * 1000);
    sheet.appendRow([claimId, today, '정기지출', '렌탈료', Number(amount), tag + ' ' + itemName, '청구중', '']);
    updateRecurringReferenceAmount(itemName, Number(amount));
    return { ok: true, claimId };
  } finally {
    lock.releaseLock();
  }
}

function updateRecurringReferenceAmount(itemName, amount) {
  const sheet = getSheet('렌탈료(정기지출)');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === itemName) {
      sheet.getRange(i + 1, 2).setValue(amount);
      return;
    }
  }
}

// -------------------------------------------------------------------------
// 거래원장 (복식부기 단일 소스)
// -------------------------------------------------------------------------

function postLedger(date, debitAccount, creditAccount, amount, person, memo, sourceType, sourceId) {
  getSheet('거래원장').appendRow([date, debitAccount, creditAccount, amount, person, memo, sourceType, sourceId]);
}

function getLedger() {
  const data = getSheet('거래원장').getDataRange().getValues();
  return data.slice(1)
    .filter(row => row[0])
    .map(row => ({
      date: row[0], debit: row[1], credit: row[2], amount: row[3],
      person: row[4], memo: row[5], sourceType: row[6], sourceId: row[7],
    }));
}

// -------------------------------------------------------------------------
// 잔액대사
// -------------------------------------------------------------------------

function computeSystemBalance() {
  const ledger = getLedger();
  let balance = getInitialBalance();
  ledger.forEach(entry => {
    if (entry.debit === '공동통장') balance += Number(entry.amount);
    if (entry.credit === '공동통장') balance -= Number(entry.amount);
  });
  return balance;
}

function recordActualBalance(yearMonth, actualBalance) {
  const systemBalance = computeSystemBalance();
  const diff = Number(actualBalance) - systemBalance;
  getSheet('잔액대사').appendRow([yearMonth, systemBalance, Number(actualBalance), diff]);
  return { systemBalance, actualBalance: Number(actualBalance), diff };
}

// -------------------------------------------------------------------------
// 가계부다운 부가기능: 카테고리별 지출 통계, 지난달 이력, 월 요약
// -------------------------------------------------------------------------

function getCategoryBreakdown(yearMonth) {
  const data = getSheet('지출청구').getDataRange().getValues();
  const totals = {};
  data.slice(1).forEach(row => {
    if (!row[0]) return;
    const date = row[1] instanceof Date
      ? Utilities.formatDate(row[1], Session.getScriptTimeZone(), 'yyyy-MM')
      : ymString(row[1]);
    if (date !== yearMonth) return;
    totals[row[3]] = (totals[row[3]] || 0) + Number(row[4]);
  });
  return Object.keys(totals)
    .map(k => ({ category: k, total: totals[k] }))
    .sort((a, b) => b.total - a.total);
}

function getAvailableMonths() {
  const months = new Set();
  getSheet('월별납부').getDataRange().getValues().slice(1).forEach(row => {
    if (row[0]) months.add(ymString(row[0]));
  });
  getSheet('지출청구').getDataRange().getValues().slice(1).forEach(row => {
    if (row[1] instanceof Date) {
      months.add(Utilities.formatDate(row[1], Session.getScriptTimeZone(), 'yyyy-MM'));
    }
  });
  months.add(ymString(new Date()));
  return Array.from(months).sort().reverse();
}

function getMonthSummary(yearMonth) {
  const payments = getMonthlyPayments(yearMonth);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const breakdown = getCategoryBreakdown(yearMonth);
  const totalSpent = breakdown.reduce((s, b) => s + b.total, 0);
  return { yearMonth, totalPaid, totalSpent, breakdown };
}

// -------------------------------------------------------------------------
// 이월금액: 과거 달에 개인 목표금액을 못 채운 부족분을 다음 달로 누적 이월한다
// (예: 7월에 목표 50만원 중 30만원만 냈다면, 부족분 20만원이 8월로 넘어가서
//  8월 목표에 더해진다 -> "이월분 먼저 내주세요" 형태로 보여줌)
// -------------------------------------------------------------------------

function getMemberCarryover(name, uptoYearMonth, target) {
  if (!target) return 0;
  const pastMonths = getAvailableMonths().filter(m => m < uptoYearMonth);
  if (!pastMonths.length) return 0;

  const paidByMonth = {};
  getSheet('월별납부').getDataRange().getValues().slice(1).forEach(row => {
    if (!row[0] || row[1] !== name) return;
    const ym = ymString(row[0]);
    paidByMonth[ym] = (paidByMonth[ym] || 0) + Number(row[2]);
  });

  let carry = 0;
  pastMonths.forEach(ym => {
    const paid = paidByMonth[ym] || 0;
    carry += Math.max(0, target - paid);
  });
  return carry;
}

// -------------------------------------------------------------------------
// 대시보드 요약
// -------------------------------------------------------------------------

function getDashboard(yearMonth) {
  const members = getFamilyMembers().map(m => {
    const carryover = getMemberCarryover(m.name, yearMonth, m.target);
    return Object.assign({}, m, { carryover: carryover, effectiveTarget: m.target + carryover });
  });
  return {
    members: members,
    payments: getMonthlyPayments(yearMonth),
    claims: getExpenseClaims(null),
    recurring: getRecurringItems(),
    pendingRecurring: getPendingRecurringForMonth(yearMonth),
    categories: getCategories(),
    systemBalance: computeSystemBalance(),
    initialBalance: getInitialBalance(),
    categoryBreakdown: getCategoryBreakdown(yearMonth),
  };
}
