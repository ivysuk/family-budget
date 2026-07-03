/**
 * 가족 공동통장 관리 웹앱 (Apps Script, 구글시트 바인딩)
 * 시트 탭: 가족구성원 / 월별납부 / 지출청구 / 렌탈료(정기지출) / 거래원장 / 잔액대사
 *
 * 흐름:
 *  - 수입: 가족 구성원이 매달 자기 형편에 맞는 금액을 "월별납부"에 기록 -> 거래원장에 자동 분개
 *  - 지출: 가족 구성원이 먼저 쓰고 "지출청구"에 청구 -> 보스가 이체 후 "이체완료" 처리 -> 거래원장에 자동 분개
 *  - 거래원장은 모든 입출금의 차변/대변 쌍을 쌓는 단일 소스 (복식부기)
 *  - 잔액대사: 거래원장 기준 계산된 잔액 vs 실제 통장 잔액(수동 입력)을 대조
 */

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('가족 공동통장 관리')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getSS() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(name) {
  const sheet = getSS().getSheetByName(name);
  if (!sheet) throw new Error('시트를 찾을 수 없음: ' + name);
  return sheet;
}

// -------------------------------------------------------------------------
// 가족 구성원
// -------------------------------------------------------------------------

function getFamilyMembers() {
  const data = getSheet('가족구성원').getDataRange().getValues();
  return data.slice(1)
    .filter(row => row[0])
    .map(row => ({ name: row[0], contact: row[1] || '' }));
}

// -------------------------------------------------------------------------
// 월별 납부 (수입)
// -------------------------------------------------------------------------

function recordPayment(yearMonth, name, amount) {
  if (!yearMonth || !name || !amount) throw new Error('연월/이름/금액은 필수입니다.');
  const sheet = getSheet('월별납부');
  const today = new Date();
  sheet.appendRow([yearMonth, name, Number(amount), today, '완료']);
  postLedger(today, '공동통장', name + ' 납부금', Number(amount), name, yearMonth + ' 생활비 납부', '월별납부', sheet.getLastRow());
  return { ok: true };
}

function getMonthlyPayments(yearMonth) {
  const data = getSheet('월별납부').getDataRange().getValues();
  return data.slice(1)
    .filter(row => row[0] === yearMonth)
    .map(row => ({ yearMonth: row[0], name: row[1], amount: row[2], date: row[3], status: row[4] }));
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
      amount: row[4], memo: row[5], status: row[6], transferDate: row[7],
    }));
}

function markReimbursed(claimId) {
  const sheet = getSheet('지출청구');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === claimId) {
      const rowNum = i + 1;
      const today = new Date();
      sheet.getRange(rowNum, 7).setValue('이체완료');
      sheet.getRange(rowNum, 8).setValue(today);
      postLedger(today, data[i][3], '공동통장', data[i][4], data[i][2], '지출 정산: ' + data[i][5], '지출청구', data[i][0]);
      return { ok: true };
    }
  }
  return { ok: false, error: '청구ID를 찾을 수 없음: ' + claimId };
}

// -------------------------------------------------------------------------
// 렌탈료(정기지출) 등록
// -------------------------------------------------------------------------

function registerRecurring(itemName, amount, cycle, nextDate) {
  if (!itemName || !amount) throw new Error('항목명/금액은 필수입니다.');
  getSheet('렌탈료(정기지출)').appendRow([itemName, Number(amount), cycle || '매월', nextDate || '']);
  return { ok: true };
}

function getRecurringItems() {
  const data = getSheet('렌탈료(정기지출)').getDataRange().getValues();
  return data.slice(1)
    .filter(row => row[0])
    .map(row => ({ name: row[0], amount: row[1], cycle: row[2], nextDate: row[3] }));
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
// 잔액대사: 거래원장 기준 계산된 잔액 vs 실제 통장 잔액(수동입력)
// -------------------------------------------------------------------------

function computeSystemBalance() {
  const ledger = getLedger();
  let balance = 0;
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
// 대시보드 요약 (웹앱 첫 화면에서 한 번에 불러오는 용도)
// -------------------------------------------------------------------------

function getDashboard(yearMonth) {
  return {
    members: getFamilyMembers(),
    payments: getMonthlyPayments(yearMonth),
    claims: getExpenseClaims(null),
    recurring: getRecurringItems(),
    systemBalance: computeSystemBalance(),
  };
}
