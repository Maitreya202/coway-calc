// ================================================================
// 코웨이 갤러리 전용 견적 계산기 — Code.gs
// ================================================================

var SPREADSHEET_ID = '17wd6OMYMazzveTZ6LcnMSi8a84XYuHSyWESYdwWCN8s'; // ← 반드시 변경
var SHEET_NAME     = '제품DB';
var HEADER_ROW     = 3;

// 조건 시트 이름 상수
var COND_SHEETS = {
  KORASOL  : '코라솔조건',
  SUNAP2   : '선납2조건',
  TASAB    : '타사보상조건',
  HEADBOARD: '헤드보드조건', // 미사용
  KOR_BASE:  '코라솔_기본',
  KOR_SUP:   '코라솔_지원금',
  KOR_PBK:   '코라솔_페이백',
  MEMBERSHIP: '멤버십요금',
  CARD_BASE: '제휴카드_기본',
  CARD_TIER: '제휴카드_구간',
  CARD_NOTE: '제휴카드_유의사항',
  BMP_PAIR:  '별매품페어링'
};

// ----------------------------------------------------------------
// doGet()
// ----------------------------------------------------------------
function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  // GitHub Pages에서 fetch로 데이터 요청 시
  var action = e && e.parameter && e.parameter.action;
  if (action === 'getData') {
    var data = getData();
    return _json(data);
  }
  if (action === 'clearCache') {
    clearCache();
    return _json({ok: true});
  }
  // GAS 직접 접속 시 (레거시)
  return HtmlService.createHtmlOutput('<p>API 서버입니다.</p>');
}


// ----------------------------------------------------------------
// doPost() — fetch POST 요청 처리
// ----------------------------------------------------------------
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    if (action === 'clearCache') {
      clearCache();
      return _json({ok: true});
    }
    if (action === 'adminAuth') {
      return _json({ok: _checkAdminPassword(body.password)});
    }
    if (action === 'updateProduct') {
      return _json(_updateProduct(body));
    }
    if (action === 'addBmpPairing') {
      return _json(_addBmpPairing(body));
    }
    if (action === 'updateBmpPairing') {
      return _json(_updateBmpPairing(body));
    }
    if (action === 'removeBmpPairing') {
      return _json(_removeBmpPairing(body));
    }
    if (action === 'bulkUpsertProducts') {
      return _json(_bulkUpsertProducts(body));
    }
    return _json({error: 'unknown action'});
  } catch(err) {
    return _json({error: err.message});
  }
}

// ----------------------------------------------------------------
// 관리자 페이지(admin.html) 전용 — 비밀번호 확인 + 제품DB 행 수정
// ----------------------------------------------------------------

// Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성에
// ADMIN_PASSWORD 키로 비밀번호를 미리 설정해두어야 함 (코드에 직접 적지 않음 — 이 파일은 공개 깃허브 저장소에 커밋됨)
function _checkAdminPassword(pw) {
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!expected) return false; // 속성 미설정 시 항상 거부 (fail-closed)
  return String(pw || '') === String(expected);
}

// 수정 가능한 필드 목록. 식별용 필드(모델명/제품명/관리방법/관리주기/약정년/분류/제품군)는 이 도구로 바꿀 수 없음 —
// 식별자를 바꾸면 다른 행과 혼동될 위험이 있어 시트에서 직접 수정하도록 의도적으로 제외함.
var PRODUCT_EDITABLE_FIELDS = ['정상가','프로모션','재렌탈','일시불','타사보상렌탈','타사보상일시불','프로모션사용','타사보상사용','재렌탈사용','타사보상일시불사용'];
var PRODUCT_NUMERIC_FIELDS = ['정상가','프로모션','재렌탈','일시불','타사보상렌탈','타사보상일시불'];
var PRODUCT_YN_FIELDS = ['프로모션사용','타사보상사용','재렌탈사용','타사보상일시불사용'];

function _updateProduct(body) {
  if (!_checkAdminPassword(body.password)) return {error: '비밀번호가 올바르지 않습니다'};

  var key = body.key || {};
  var fields = body.fields || {};
  if (!key.모델명 || !key.제품명 || key.약정년 === undefined) {
    return {error: '수정할 행을 식별할 수 없습니다 (모델명/제품명/약정년 누락)'};
  }

  // 필드 값 검증 — 숫자 필드는 유한하고 0 이상인지, 프로모션사용은 Y/N인지 확인
  for (var f in fields) {
    if (PRODUCT_EDITABLE_FIELDS.indexOf(f) < 0) return {error: '수정할 수 없는 필드입니다: ' + f};
    if (PRODUCT_NUMERIC_FIELDS.indexOf(f) >= 0) {
      var n = Number(fields[f]);
      if (!isFinite(n) || n < 0) return {error: f + ' 값이 올바르지 않습니다: ' + fields[f]};
    }
    if (PRODUCT_YN_FIELDS.indexOf(f) >= 0 && ['Y','N'].indexOf(String(fields[f]).toUpperCase()) < 0) {
      return {error: f + ' 값은 Y 또는 N 이어야 합니다'};
    }
  }

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return {error: '시트를 찾을 수 없음: "' + SHEET_NAME + '"'};

  var colMap = _headerColMap(sheet);
  var keyFields = ['모델명','제품명','관리방법','관리주기','약정년'];
  for (var i=0;i<keyFields.length;i++) {
    if (keyFields[i]==='관리방법'||keyFields[i]==='관리주기') continue; // 일부 제품군엔 없을 수 있어 선택 항목
    if (!colMap[keyFields[i]]) return {error: '"' + FIELD_HEADERS[keyFields[i]] + '" 헤더 컬럼을 시트에서 찾지 못했습니다'};
  }
  for (var field2 in fields) {
    if (!colMap[field2]) return {error: '"' + FIELD_HEADERS[field2] + '" 헤더 컬럼을 시트에서 찾지 못했습니다 — 3행 헤더 텍스트를 확인해주세요'};
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < HEADER_ROW + 1) return {error: '제품 데이터가 없습니다'};

  var lastCol = sheet.getLastColumn();
  var raw = sheet.getRange(HEADER_ROW + 1, 1, lastRow - HEADER_ROW, lastCol).getValues();
  function cellAt(row, field) { var c = colMap[field]; return c ? row[c-1] : ''; }
  var matches = [];
  raw.forEach(function(row, i) {
    // 약정(년) 셀이 비어있거나 "-"면(약정 없는 일시불 전용 제품) getData()가 0으로 내보내므로, 여기서도 NaN을 0으로 취급해 매칭
    var rowYakjRaw = Number(cellAt(row,'약정년'));
    var rowYakj = (!rowYakjRaw || isNaN(rowYakjRaw)) ? 0 : rowYakjRaw;
    if (String(cellAt(row,'모델명')).trim() === String(key.모델명).trim() &&
        String(cellAt(row,'제품명')).trim() === String(key.제품명).trim() &&
        String(cellAt(row,'관리방법')||'').trim() === String(key.관리방법 || '').trim() &&
        String(cellAt(row,'관리주기')||'').trim() === String(key.관리주기 || '').trim() &&
        rowYakj === Number(key.약정년)) {
      matches.push(i);
    }
  });

  if (matches.length === 0) return {error: '일치하는 행을 찾지 못했습니다 (다른 사람이 먼저 삭제/수정했을 수 있어요 — 새로고침 후 다시 시도해주세요)'};
  if (matches.length > 1) return {error: '조건에 맞는 행이 ' + matches.length + '개 발견되어 안전하게 수정할 수 없습니다. 시트에서 직접 확인해주세요'};

  var sheetRow = HEADER_ROW + 1 + matches[0];
  for (var field3 in fields) {
    var col = colMap[field3];
    var val = PRODUCT_NUMERIC_FIELDS.indexOf(field3) >= 0 ? Number(fields[field3]) : String(fields[field3]);
    sheet.getRange(sheetRow, col).setValue(val);
  }

  CacheService.getScriptCache().remove('appData');
  return {ok: true, row: sheetRow};
}

// 가격표(엑셀) 일괄 등록/업데이트 — admin.html "일괄 등록/업데이트" 화면에서 호출.
// 모델명+관리방법+관리주기+약정년 조합으로 기존 행을 찾아 가격 필드만 덮어쓰고,
// 못 찾으면 새 행을 만든다(제품명/분류/제품군은 입력값이 없으면 같은 모델명의 기존 행에서 복사).
function _bulkUpsertProducts(body) {
  if (!_checkAdminPassword(body.password)) return {error: '비밀번호가 올바르지 않습니다'};
  var rows = body.rows;
  if (!rows || !rows.length) return {error: '등록할 행이 없습니다'};

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return {error: '시트를 찾을 수 없음: "' + SHEET_NAME + '"'};

  var colMap = _headerColMap(sheet);
  if (!colMap.모델명 || !colMap.약정년) {
    return {error: '"' + FIELD_HEADERS.모델명 + '"/"' + FIELD_HEADERS.약정년 + '" 헤더 컬럼을 시트에서 찾지 못했습니다'};
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var raw = (lastRow >= HEADER_ROW + 1) ? sheet.getRange(HEADER_ROW + 1, 1, lastRow - HEADER_ROW, lastCol).getValues() : [];
  function cellAt(row, field) { var c = colMap[field]; return c ? row[c-1] : ''; }
  function normYakj(row) { var n = Number(cellAt(row,'약정년')); return (!n || isNaN(n)) ? 0 : n; }
  function normYakjInput(v) { if (v === undefined || v === null || String(v).trim() === '' || String(v).trim() === '-') return 0; var n = Number(v); return isNaN(n) ? null : n; }

  // 모델명 → 첫 번째로 발견된 행의 제품명/분류/제품군 (신규 행 만들 때 identity 복사용, 이번 배치에서 새로 만든 행도 반영)
  var identityByModel = {};
  raw.forEach(function(row) {
    var m = String(cellAt(row,'모델명')||'').trim();
    if (m && !identityByModel[m]) {
      identityByModel[m] = { 제품명: cellAt(row,'제품명'), 분류: cellAt(row,'분류'), s: cellAt(row,'s') };
    }
  });

  var results = [];
  rows.forEach(function(input, idx) {
    var 모델명 = String(input.모델명 || '').trim();
    if (!모델명) { results.push({index: idx, status: 'error', message: '모델명이 없습니다'}); return; }
    var 관리방법 = String(input.관리방법 || '').trim();
    var 관리주기 = String(input.관리주기 || '').trim();
    var 약정년 = normYakjInput(input.약정년);
    if (약정년 === null) { results.push({index: idx, status: 'error', message: '약정(년) 값이 올바르지 않습니다: ' + input.약정년}); return; }

    // 가격 필드 검증 (입력된 것만)
    var priceFields = {};
    var badField = null;
    PRODUCT_NUMERIC_FIELDS.forEach(function(f) {
      if (input[f] === undefined || input[f] === null || String(input[f]).trim() === '') return;
      var n = Number(input[f]);
      if (!isFinite(n) || n < 0) { badField = f; return; }
      priceFields[f] = n;
    });
    if (badField) { results.push({index: idx, status: 'error', message: badField + ' 값이 올바르지 않습니다: ' + input[badField]}); return; }

    var matches = [];
    raw.forEach(function(row, i) {
      if (String(cellAt(row,'모델명')||'').trim() === 모델명 &&
          String(cellAt(row,'관리방법')||'').trim() === 관리방법 &&
          String(cellAt(row,'관리주기')||'').trim() === 관리주기 &&
          normYakj(row) === 약정년) {
        matches.push(i);
      }
    });

    if (matches.length > 1) {
      results.push({index: idx, status: 'error', message: '조건에 맞는 행이 ' + matches.length + '개 있어 자동으로 수정할 수 없습니다'});
      return;
    }

    if (matches.length === 1) {
      var sheetRow = HEADER_ROW + 1 + matches[0];
      Object.keys(priceFields).forEach(function(f) {
        if (colMap[f]) sheet.getRange(sheetRow, colMap[f]).setValue(priceFields[f]);
      });
      results.push({index: idx, status: 'updated', sheetRow: sheetRow});
      return;
    }

    // 신규 행 — 제품명/분류/제품군 결정 (입력값 우선, 없으면 같은 모델명의 기존 행에서 복사)
    var sibling = identityByModel[모델명] || {};
    var 제품명 = String(input.제품명 || sibling.제품명 || '').trim();
    var 분류 = String(input.분류 || sibling.분류 || '').trim();
    var s = String(input.제품군 || input.s || sibling.s || '').trim();
    if (!제품명 || !분류 || !s) {
      results.push({index: idx, status: 'error', message: '완전 신규 모델은 제품명/분류/제품군을 함께 입력해야 합니다'});
      return;
    }
    if (!colMap.제품명 || !colMap.분류 || !colMap.s) {
      results.push({index: idx, status: 'error', message: '"제품명"/"분류"/"제품군" 헤더 컬럼을 시트에서 찾지 못했습니다'});
      return;
    }

    var newRow = [];
    for (var c = 0; c < lastCol; c++) newRow.push('');
    newRow[colMap.모델명 - 1] = 모델명;
    newRow[colMap.제품명 - 1] = 제품명;
    newRow[colMap.분류 - 1] = 분류;
    newRow[colMap.s - 1] = s;
    if (colMap.관리방법) newRow[colMap.관리방법 - 1] = 관리방법;
    if (colMap.관리주기) newRow[colMap.관리주기 - 1] = 관리주기;
    newRow[colMap.약정년 - 1] = 약정년 || '';
    Object.keys(priceFields).forEach(function(f) {
      if (colMap[f]) newRow[colMap[f] - 1] = priceFields[f];
    });

    sheet.appendRow(newRow);
    var newSheetRow = sheet.getLastRow();
    // 이번 배치의 다음 행들이 같은 모델명을 참조할 때 identity/matches에 반영되도록 raw에도 추가
    raw.push(newRow);
    if (!identityByModel[모델명]) identityByModel[모델명] = { 제품명: 제품명, 분류: 분류, s: s };
    results.push({index: idx, status: 'created', sheetRow: newSheetRow});
  });

  CacheService.getScriptCache().remove('appData');
  return {ok: true, results: results};
}

// doGet에서도 clearCache 처리 추가
// ----------------------------------------------------------------
// setupConditionSheets() ← Apps Script 에디터에서 처음 1회만 실행
// 조건 시트를 자동 생성하고 기본값을 입력합니다.
// ----------------------------------------------------------------
function setupConditionSheets() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // ── 코라솔조건 ────────────────────────────────────────────────
  // 코라솔조건: 상품별 납부금/만기환급/지원금/페이백을 3개 시트로 분리
  // [코라솔_기본] — 상품가·납부금·만기환급
  _ensureSheet(ss, '코라솔_기본', [
    ['상품키', '상품명', '상품가(만원)', '월납부금', '납부회차', '만기환급금'],
    ['499', 'CowayLife 499', 499, 33200, 150, 4990000],
    ['599', 'CowayLife 599', 599, 39900, 150, 5990000],
    ['699', 'CowayLife 699', 699, 46600, 150, 6990000],
  ]);
  // [코라솔_지원금] — 상품별/약정별 지원금 (총액·월액)
  _ensureSheet(ss, '코라솔_지원금', [
    ['상품키', '지원기간(개월)', '총지원금', '월지원금'],
    ['499', 60, 800000,  13300],
    ['599', 60, 1000000, 16600],
    ['599', 72, 1000000, 13800],
    ['599', 84, 1000000, 11900],
    ['699', 60, 1200000, 20000],
    ['699', 72, 1200000, 16600],
    ['699', 84, 1200000, 14200],
  ]);
  // [코라솔_페이백] — 상품별/구좌수별 월 페이백
  _ensureSheet(ss, '코라솔_페이백', [
    ['상품키', '구좌수', '월페이백'],
    ['499', 1, 600],
    ['499', 2, 4100],
    ['499', 3, 7600],
    ['599', 1, 600],
    ['599', 2, 4100],
    ['599', 3, 15100],
    ['699', 1, 600],
    ['699', 2, 4100],
    ['699', 3, 15100],
  ]);

  // ── 선납2조건 ─────────────────────────────────────────────────
  _ensureSheet(ss, COND_SHEETS.SUNAP2, [
    ['구분', '구분설명', '선납금', '할인총액'],
    ['A', '환경가전/매트리스',                          500000,  80000],
    ['A', '환경가전/매트리스',                         1000000, 160000],
    ['B', '페블체어/트리플/마인안마의자',               500000,  80000],
    ['B', '페블체어/트리플/마인안마의자',              1000000, 160000],
    ['B', '페블체어/트리플/마인안마의자',              1500000, 240000],
    ['C', '스마트매트리스/시그니처안마의자/마사지셋', 1000000, 200000],
    ['C', '스마트매트리스/시그니처안마의자/마사지셋', 2000000, 400000],
    ['C', '스마트매트리스/시그니처안마의자/마사지셋', 3000000, 600000],
  ]);

  // ── 타사보상조건 ──────────────────────────────────────────────
  _ensureSheet(ss, COND_SHEETS.TASAB, [
    ['약정년', '추가할인_없음', '추가할인_결합(-5%)', '추가할인_동시구매(-10%)', '비고'],
    [3, 0,     0,    0,     '타사보상 추가할인 없음'],
    [5, 0,     0,    0,     '타사보상 추가할인 없음'],
    [6, 20000, 9500, 9000,  '1년간 추가 할인'],
    [7, 20000, 9500, 9000,  '1년간 추가 할인'],
  ]);

  // 헤드보드 조건: 헤드보드가 제품DB에 편입됨 — 시트 생성 불필요
  // _ensureSheet(ss, COND_SHEETS.HEADBOARD, [...]);

  // ── 제휴카드_기본 ─────────────────────────────────────────────
  _ensureSheet(ss, COND_SHEETS.CARD_BASE, [
    ['카드ID','카드명','문의번호','프로모션여부','혜택개월수','기간','대상','프로모션제목','특이사항','연회비','신청안내','신청URL'],
    ['shinhan','코웨이 신한카드','1833-6013','Y',60,'2026.7.1 ~ 7.31','직전 6개월간 신한카드(신용카드) 청구 및 사용 이력이 없는 고객','60개월간 최대 3만원 청구할인','','국내 27,000원 / 해외 30,000원','QR코드 또는 ☎ 1833-6013','https://shcard.io/coway'],
    ['hyundai','코웨이 현대카드','1670-0443','Y',60,'2026.7.1 ~ 7.31','직전 6개월간 현대카드(신용카드) 청구 및 사용 이력이 없는 고객','60개월간 최대 3만원 청구할인','전국 코스트코에서 결제 가능, 애플페이 이용 가능','국내/해외 20,000원','QR코드 또는 ☎ 1670-0443',''],
    ['woori','코웨이 ICON 우리카드','1800-0859','Y',60,'2026.7.1 ~ 7.31','직전 6개월간 우리카드(신용카드) 청구 및 사용 이력이 없는 고객','60개월간 최대 3만원 청구할인','','국내/해외 25,000원','☎ 1800-0859',''],
    ['samsung','코웨이 삼성카드','1588-7540','Y',60,'2026.7.1 ~ 7.31','직전 6개월간 삼성카드(신용카드) 청구 및 사용 이력이 없는 고객','60개월간 최대 1만 5천원 추가 청구할인','본인/가족 통신비·아파트 관리비·4대 사회보험 등 생활 요금 정기 결제 시, 결제 건별 월 1,000원(최대 3,000원) 추가 할인','국내/해외 15,000원','☎ 1588-7540',''],
    ['loca','코웨이 X LOCA (롯데카드)','1577-5208','Y',60,'2026.7.1 ~ 7.31','직전 6개월간 롯데카드(신용카드) 청구 및 사용 이력이 없는 고객','60개월간 최대 8천원 추가 청구할인','','국내/해외 20,000원','6개월 무실적 대상 확인 및 카드 발급 페이지 · ☎ 1577-5208',''],
    ['kb','KB국민 코웨이Ⅱ카드','1644-8388','Y',36,'2026.7.1 ~ 7.31','직전 6개월간 KB국민카드(KB BC카드 포함) 청구 및 사용 이력이 없는 고객','36개월간 최대 3만원 청구할인','','국내/해외 30,000원','카드 신청 페이지(QR코드) · ☎ 1644-8388',''],
    ['nhbank','코웨이 NH농협카드','1644-2866','Y',60,'2026.7.1 ~ 7.31','직전 6개월간 NH농협 개인 신용카드 이용 실적이 없는 고객','60개월간 1만 2천원 추가 캐시백 프로모션','','국내 10,000원 / 국내외 12,000원','☎ 1644-2866','https://go.nhcard.com/GscljMo'],
    ['hana','마이 코웨이 하나카드','1588-1771','N',60,'','','','','','☎ 1588-1771',''],
    ['ibk','코웨이 IBK카드','1566-0088 → 14#','N',60,'','','','','','☎ 1566-0088 → 14#',''],
    ['nhall1','코웨이 NH올원카드','1644-2866 → 6#','N',60,'','','','','','☎ 1644-2866 → 6#',''],
    ['hyundaiM','코웨이 현대카드 M Edition3','02-2655-5003','N',60,'','','','코스트코에서 카드 사용 가능','','☎ 02-2655-5003',''],
  ]);

  // ── 제휴카드_구간 ─────────────────────────────────────────────
  _ensureSheet(ss, COND_SHEETS.CARD_TIER, [
    ['카드ID','실적기준','기본청구할인','프로모션추가할인','프로모션라벨'],
    ['shinhan','30만원 이상',13000,11000,''], ['shinhan','70만원 이상',17000,7000,''], ['shinhan','150만원 이상',30000,'',''],
    ['hyundai','40만원 이상',8000,17000,''], ['hyundai','80만원 이상',12000,14000,''], ['hyundai','120만원 이상',16000,14000,''],
    ['woori','30만원 이상',13000,11000,''], ['woori','80만원 이상',17000,7000,''], ['woori','150만원 이상',23000,7000,''],
    ['samsung','30만원 이상',7000,15000,''], ['samsung','70만원 이상',10000,14000,''], ['samsung','120만원 이상',13000,13000,''],
    ['loca','30만원 이상',13000,8000,''], ['loca','70만원 이상',16000,6000,''], ['loca','150만원 이상',25000,'',''],
    ['kb','40만원 이상',15000,11000,''], ['kb','80만원 이상',20000,10000,''],
    ['nhbank','30만원 이상',10000,12000,'캐시백'], ['nhbank','100만원 이상',15000,12000,'캐시백'], ['nhbank','200만원 이상',30000,12000,'캐시백'],
    ['hana','30만원 이상',13000,'',''], ['hana','80만원 이상',18000,'',''], ['hana','150만원 이상',25000,'',''],
    ['ibk','30만원 이상',13000,'',''], ['ibk','70만원 이상',17000,'',''], ['ibk','120만원 이상',23000,'',''],
    ['nhall1','30만원 이상',10000,'',''], ['nhall1','100만원 이상',15000,'',''], ['nhall1','200만원 이상',30000,'',''],
    ['hyundaiM','50만원 이상',15000,'',''], ['hyundaiM','100만원 이상',20000,'',''],
  ]);

  // ── 제휴카드_유의사항 ─────────────────────────────────────────
  _ensureSheet(ss, COND_SHEETS.CARD_NOTE, [
    ['카드ID','순번','내용'],
    ['shinhan',1,'코웨이 렌탈/멤버십료 자동이체 필수 (자동이체 결제가 아닌 경우 카드 할인 및 프로모션 적용 불가)'],
    ['shinhan',2,'카드 발급 후 카드 이용 실적 충족 및 자동납부 매출 발생 필수'],
    ['shinhan',3,'60개월간(카드 유효기간까지) 최대 추가 11,000원 청구할인 제공'],
    ['shinhan',4,'신한카드 신규 발급 고객 대상 (재발급, 기보유 회원, 해지 후 1년 미경과 회원 제외 · 본인 카드만, 가족카드 제외)'],
    ['shinhan',5,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 혜택 미적용'],
    ['hyundai',1,'코웨이 렌탈/멤버십료 자동이체 필수'],
    ['hyundai',2,'카드 발급 후 카드 이용실적 충족 및 자동납부 매출발생 필수'],
    ['hyundai',3,'렌탈료 자동이체 매입 시 추가 청구할인 최대 60회 제공'],
    ['hyundai',4,'현대카드 신규 발급 고객 대상 (재발급, 기보유 회원, 해지 후 1년 미경과 회원 제외 · 본인 카드만)'],
    ['hyundai',5,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 혜택 미적용'],
    ['hyundai',6,'우측 QR코드 혹은 ARS 전용번호(1670-0443)로 신청 시에만 혜택 적용'],
    ['woori',1,'코웨이 렌탈/멤버십료 자동이체 필수'],
    ['woori',2,'렌탈료 자동이체 매입 시 추가 청구할인 최대 60회 제공 (해당 월 실적 구간 미충족 시 횟수 차감)'],
    ['woori',3,'우리카드 신규/추가/교체 발급 고객 대상 (재발급, 기보유 회원, 해지 후 1년 미경과 회원 제외 · 본인 카드만)'],
    ['woori',4,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 혜택 미적용'],
    ['samsung',1,'코웨이 렌탈/멤버십료 자동이체 필수'],
    ['samsung',2,'카드 발급 후 카드 이용실적 충족 및 자동납부 매출발생 필수'],
    ['samsung',3,'60개월간(카드 유효기간까지) 최대 1만 5천원 추가 청구할인 제공'],
    ['samsung',4,'삼성카드 신규 발급 고객 대상 (재발급, 기보유 회원, 해지 후 1년 미경과 회원 제외 · 본인 카드만)'],
    ['samsung',5,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 혜택 미적용'],
    ['loca',1,'코웨이 렌탈/멤버십료 자동이체 필수'],
    ['loca',2,'카드 발급 후 카드 이용실적 충족 및 자동납부 매출발생 필수'],
    ['loca',3,'60개월간(카드 유효기간까지) 추가 청구할인 제공'],
    ['loca',4,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 혜택 미적용'],
    ['kb',1,'코웨이 렌탈/멤버십료 자동이체 필수'],
    ['kb',2,'자동납부 건당 결제금액이 전월실적 40만원 구간은 15,000원 이상, 80만원 구간은 20,000원 이상 결제 시 프로모션 적용 가능'],
    ['kb',3,'렌탈료 면제 프로모션 고객도 혜택 적용 가능 (렌탈료가 발생하는 월부터 청구할인 적용되며, 자동납부 매출 발생 시 36개월간 적용)'],
    ['nhbank',1,'렌탈 자동이체 매출 발생 필수'],
    ['nhbank',2,'프로모션 캐시백은 전월 실적 충족 시 제공 (단, 1회차는 미충족 시에도 제공)'],
    ['nhbank',3,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 및 캐시백이 미적용'],
  ]);

  return '조건 시트 생성/확인 완료: '
    + Object.values(COND_SHEETS).join(', ');
}

function _ensureSheet(ss, name, rows) {
  var ws = ss.getSheetByName(name);
  if (!ws) {
    ws = ss.insertSheet(name);
    rows.forEach(function(row, i) {
      ws.getRange(i + 1, 1, 1, row.length).setValues([row]);
    });
    // 헤더 행 굵게
    ws.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
    Logger.log('시트 생성: ' + name);
  } else {
    Logger.log('이미 존재: ' + name);
  }
}

// ----------------------------------------------------------------
// fixCardTargetText() ← 이미 생성된 "제휴카드_기본" 시트의 "대상" 컬럼을
// "2026년 1월~6월까지..." 같은 하드코딩된 날짜 문구에서
// "직전 6개월간..." 상대 표현으로 1회 일괄 교체합니다.
// Apps Script 에디터에서 한 번만 실행하면 됩니다.
// ----------------------------------------------------------------
function fixCardTargetText() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var ws = ss.getSheetByName(COND_SHEETS.CARD_BASE);
  if (!ws) return '제휴카드_기본 시트를 찾을 수 없음';

  var values = ws.getDataRange().getValues();
  var header = values[0];
  var colTarget = header.indexOf('대상');
  if (colTarget < 0) return '"대상" 컬럼을 찾을 수 없음';

  var replaced = 0;
  for (var r = 1; r < values.length; r++) {
    var cur = String(values[r][colTarget] || '');
    var m = cur.match(/까지\s*(모든\s*)?(.+?)(청구\s*및\s*사용\s*(이력|실적).*)/);
    if (m) {
      var newVal = '직전 6개월간 ' + m[2].trim() + m[3].trim();
      ws.getRange(r + 1, colTarget + 1).setValue(newVal);
      replaced++;
    }
  }
  CacheService.getScriptCache().remove('appData');
  return replaced + '개 행의 "대상" 문구를 상대 표현으로 교체 완료';
}

// ----------------------------------------------------------------
// reseedCardNotes() ← 이미 생성된 "제휴카드_유의사항" 시트를
// 코드의 최신 유의사항 배열(연월 하드코딩 제거된 버전)로 전체 재작성합니다.
// Apps Script 에디터에서 한 번만 실행하면 됩니다. 기존 행은 모두 지워지고 다시 채워집니다.
// ----------------------------------------------------------------
function reseedCardNotes() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var rows = [
    ['카드ID','순번','내용'],
    ['shinhan',1,'코웨이 렌탈/멤버십료 자동이체 필수 (자동이체 결제가 아닌 경우 카드 할인 및 프로모션 적용 불가)'],
    ['shinhan',2,'카드 발급 후 카드 이용 실적 충족 및 자동납부 매출 발생 필수'],
    ['shinhan',3,'60개월간(카드 유효기간까지) 최대 추가 11,000원 청구할인 제공'],
    ['shinhan',4,'신한카드 신규 발급 고객 대상 (재발급, 기보유 회원, 해지 후 1년 미경과 회원 제외 · 본인 카드만, 가족카드 제외)'],
    ['shinhan',5,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 혜택 미적용'],
    ['hyundai',1,'코웨이 렌탈/멤버십료 자동이체 필수'],
    ['hyundai',2,'카드 발급 후 카드 이용실적 충족 및 자동납부 매출발생 필수'],
    ['hyundai',3,'렌탈료 자동이체 매입 시 추가 청구할인 최대 60회 제공'],
    ['hyundai',4,'현대카드 신규 발급 고객 대상 (재발급, 기보유 회원, 해지 후 1년 미경과 회원 제외 · 본인 카드만)'],
    ['hyundai',5,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 혜택 미적용'],
    ['hyundai',6,'우측 QR코드 혹은 ARS 전용번호(1670-0443)로 신청 시에만 혜택 적용'],
    ['woori',1,'코웨이 렌탈/멤버십료 자동이체 필수'],
    ['woori',2,'렌탈료 자동이체 매입 시 추가 청구할인 최대 60회 제공 (해당 월 실적 구간 미충족 시 횟수 차감)'],
    ['woori',3,'우리카드 신규/추가/교체 발급 고객 대상 (재발급, 기보유 회원, 해지 후 1년 미경과 회원 제외 · 본인 카드만)'],
    ['woori',4,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 혜택 미적용'],
    ['samsung',1,'코웨이 렌탈/멤버십료 자동이체 필수'],
    ['samsung',2,'카드 발급 후 카드 이용실적 충족 및 자동납부 매출발생 필수'],
    ['samsung',3,'60개월간(카드 유효기간까지) 최대 1만 5천원 추가 청구할인 제공'],
    ['samsung',4,'삼성카드 신규 발급 고객 대상 (재발급, 기보유 회원, 해지 후 1년 미경과 회원 제외 · 본인 카드만)'],
    ['samsung',5,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 혜택 미적용'],
    ['loca',1,'코웨이 렌탈/멤버십료 자동이체 필수'],
    ['loca',2,'카드 발급 후 카드 이용실적 충족 및 자동납부 매출발생 필수'],
    ['loca',3,'60개월간(카드 유효기간까지) 추가 청구할인 제공'],
    ['loca',4,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 혜택 미적용'],
    ['kb',1,'코웨이 렌탈/멤버십료 자동이체 필수'],
    ['kb',2,'자동납부 건당 결제금액이 전월실적 40만원 구간은 15,000원 이상, 80만원 구간은 20,000원 이상 결제 시 프로모션 적용 가능'],
    ['kb',3,'렌탈료 면제 프로모션 고객도 혜택 적용 가능 (렌탈료가 발생하는 월부터 청구할인 적용되며, 자동납부 매출 발생 시 36개월간 적용)'],
    ['nhbank',1,'렌탈 자동이체 매출 발생 필수'],
    ['nhbank',2,'프로모션 캐시백은 전월 실적 충족 시 제공 (단, 1회차는 미충족 시에도 제공)'],
    ['nhbank',3,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 및 캐시백이 미적용'],
  ];
  var ws = ss.getSheetByName(COND_SHEETS.CARD_NOTE);
  if (!ws) ws = ss.insertSheet(COND_SHEETS.CARD_NOTE);
  ws.clear();
  ws.getRange(1, 1, rows.length, 3).setValues(rows);
  ws.getRange(1, 1, 1, 3).setFontWeight('bold');
  CacheService.getScriptCache().remove('appData');
  return '제휴카드_유의사항 시트 재작성 완료 (' + (rows.length - 1) + '행)';
}

// ----------------------------------------------------------------
// updateCardDataAug2026() ← "제휴카드_기본"/"제휴카드_구간"/"제휴카드_유의사항"
// 시트를 2026년 8월 프로모션 공지(260731_제휴카드 프로모션_26년_8월_3차.pdf) 기준으로
// 전체 재작성합니다. Apps Script 에디터에서 한 번만 실행하면 됩니다.
//
// 8월 변경 요약:
//  - 신한/우리/삼성/KB: 금액 동일, 기간만 8.1~8.31로 갱신
//  - 현대카드(플레인): 이번 달 프로모션 없음 → 프로모션여부 N, 프로모션 관련 컬럼/구간 promo 초기화
//  - 현대카드 M Edition3: 이번 달부터 프로모션 신규 적용 (36개월간 월 1만원 추가 청구할인)
//  - NH농협카드: 프로모션 추가할인 12,000원 → 10,000원으로 축소
//  - 롯데카드(loca)는 단종되어 목록에서 제외
// ----------------------------------------------------------------
function updateCardDataAug2026() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  var baseRows = [
    ['카드ID','카드명','문의번호','프로모션여부','혜택개월수','기간','대상','프로모션제목','특이사항','연회비','신청안내','신청URL'],
    ['shinhan','코웨이 신한카드','1833-6013','Y',60,'2026.8.1 ~ 8.31','직전 6개월간 신한카드(신용카드) 청구 및 사용 이력이 없는 고객','60개월간 최대 3만원 청구할인','','국내 27,000원 / 해외 30,000원','QR코드 또는 ☎ 1833-6013','https://shcard.io/coway'],
    ['hyundai','코웨이 현대카드','1670-0443','N',60,'','','','전국 코스트코에서 결제 가능, 애플페이 이용 가능','국내/해외 20,000원','☎ 1670-0443',''],
    ['woori','코웨이 ICON 우리카드','1800-0859','Y',60,'2026.8.1 ~ 8.31','직전 6개월간 우리카드(신용카드) 청구 및 사용 이력이 없는 고객','60개월간 최대 3만원 청구할인','','국내/해외 25,000원','☎ 1800-0859',''],
    ['samsung','코웨이 삼성카드','1588-7540','Y',60,'2026.8.1 ~ 8.31','직전 6개월간 삼성카드(신용카드) 청구 및 사용 이력이 없는 고객','60개월간 월 최대 1만 5천원 추가 할인','본인/가족 통신비·아파트 관리비·4대 사회보험 등 생활 요금 정기 결제 시, 결제 건별 월 1,000원(최대 3,000원) 추가 할인','국내/해외 15,000원','☎ 1588-7540',''],
    ['kb','KB국민 코웨이Ⅱ카드','1644-8388','Y',36,'2026.8.1 ~ 8.31','직전 6개월간 KB국민카드(KB BC카드 포함) 청구 및 사용 이력이 없는 고객','36개월간 최대 3만원 청구할인','','국내/해외 30,000원','카드 신청 페이지(QR코드) · ☎ 1644-8388',''],
    ['nhbank','코웨이 NH농협카드','1644-2866','Y',60,'2026.8.1 ~ 8.31','직전 6개월간 NH농협 개인 신용카드 이용 실적이 없는 고객','60개월간 1만원 추가 캐시백 프로모션','','국내 10,000원 / 국내외 12,000원','☎ 1644-2866','https://go.nhcard.com/GscljMo'],
    ['hana','마이 코웨이 하나카드','1588-1771','N',60,'','','','','','☎ 1588-1771',''],
    ['ibk','코웨이 IBK카드','1566-0088 → 14#','N',60,'','','','','','☎ 1566-0088 → 14#',''],
    ['nhall1','코웨이 NH올원카드','1644-2866 → 6#','N',60,'','','','','','☎ 1644-2866 → 6#',''],
    ['hyundaiM','코웨이 현대카드 M Edition3','02-2655-5003','Y',36,'2026.8.1 ~ 8.31','직전 6개월간 현대카드(신용카드) 청구 및 사용 이력이 없는 고객','36개월간 월 1만원 추가 청구할인','전국 코스트코에서 결제 가능, 애플페이 이용 가능','국내/해외 30,000원','QR코드 또는 ☎ 02-2655-5003',''],
  ];

  var tierRows = [
    ['카드ID','실적기준','기본청구할인','프로모션추가할인','프로모션라벨'],
    ['shinhan','30만원 이상',13000,11000,''], ['shinhan','70만원 이상',17000,7000,''], ['shinhan','150만원 이상',30000,'',''],
    ['hyundai','40만원 이상',8000,'',''], ['hyundai','80만원 이상',12000,'',''], ['hyundai','120만원 이상',16000,'',''],
    ['woori','30만원 이상',13000,11000,''], ['woori','80만원 이상',17000,7000,''], ['woori','150만원 이상',23000,7000,''],
    ['samsung','30만원 이상',7000,15000,''], ['samsung','70만원 이상',10000,14000,''], ['samsung','120만원 이상',13000,13000,''],
    ['kb','40만원 이상',15000,11000,''], ['kb','80만원 이상',20000,10000,''],
    ['nhbank','30만원 이상',10000,10000,'캐시백'], ['nhbank','100만원 이상',15000,10000,'캐시백'], ['nhbank','200만원 이상',30000,10000,'캐시백'],
    ['hana','30만원 이상',13000,'',''], ['hana','80만원 이상',18000,'',''], ['hana','150만원 이상',25000,'',''],
    ['ibk','30만원 이상',13000,'',''], ['ibk','70만원 이상',17000,'',''], ['ibk','120만원 이상',23000,'',''],
    ['nhall1','30만원 이상',10000,'',''], ['nhall1','100만원 이상',15000,'',''], ['nhall1','200만원 이상',30000,'',''],
    ['hyundaiM','50만원 이상',15000,10000,''], ['hyundaiM','100만원 이상',20000,10000,''],
  ];

  var noteRows = [
    ['카드ID','순번','내용'],
    ['shinhan',1,'코웨이 렌탈/멤버십료 자동이체 필수 (자동이체 결제가 아닌 경우 카드 할인 및 프로모션 적용 불가)'],
    ['shinhan',2,'카드 발급 후 카드 이용 실적 충족 및 자동납부 매출 발생 필수'],
    ['shinhan',3,'60개월간(카드 유효기간까지) 최대 추가 11,000원 청구할인 제공'],
    ['shinhan',4,'신한카드 신규 발급 고객 대상 (재발급, 기보유 회원, 해지 후 1년 미경과 회원 제외 · 본인 카드만, 가족카드 제외)'],
    ['shinhan',5,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 혜택 미적용'],
    ['woori',1,'코웨이 렌탈/멤버십료 자동이체 필수'],
    ['woori',2,'렌탈료 자동이체 매입 시 추가 청구할인 최대 60회 제공 (해당 월 실적 구간 미충족 시 횟수 차감)'],
    ['woori',3,'우리카드 신규/추가/교체 발급 고객 대상 (재발급, 기보유 회원, 해지 후 1년 미경과 회원 제외 · 본인 카드만)'],
    ['woori',4,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 혜택 미적용'],
    ['samsung',1,'코웨이 렌탈/멤버십료 자동이체 필수'],
    ['samsung',2,'카드 발급 후 카드 이용실적 충족 및 자동납부 매출발생 필수'],
    ['samsung',3,'60개월간(카드 유효기간까지) 최대 1만 5천원 추가 청구할인 제공'],
    ['samsung',4,'삼성카드 신규 발급 고객 대상 (재발급, 기보유 회원, 해지 후 1년 미경과 회원 제외 · 본인 카드만)'],
    ['samsung',5,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 혜택 미적용'],
    ['kb',1,'코웨이 렌탈/멤버십료 자동이체 필수'],
    ['kb',2,'자동납부 건당 결제금액이 전월실적 40만원 구간은 15,000원 이상, 80만원 구간은 20,000원 이상 결제 시 프로모션 적용 가능'],
    ['kb',3,'렌탈료 면제 프로모션 고객도 혜택 적용 가능 (렌탈료가 발생하는 월부터 청구할인 적용되며, 자동납부 매출 발생 시 36개월간 적용)'],
    ['nhbank',1,'렌탈 자동이체 매출 발생 필수'],
    ['nhbank',2,'프로모션 캐시백은 전월 실적 충족 시 제공 (단, 1회차는 미충족 시에도 제공)'],
    ['nhbank',3,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 및 캐시백이 미적용'],
    ['hyundaiM',1,'코웨이 렌탈/멤버십료 자동이체 필수'],
    ['hyundaiM',2,'카드 발급 후 카드 이용실적 충족 및 자동납부 매출발생 필수'],
    ['hyundaiM',3,'렌탈료 자동이체 매입 시 추가 청구할인 최대 60회 제공'],
    ['hyundaiM',4,'현대카드 신규 발급 고객 대상 (재발급, 기보유 회원, 해지 후 1년 미경과 회원 제외 · 본인 카드만)'],
    ['hyundaiM',5,'코웨이 렌탈료 면제 프로모션 고객은 면제 회차에 청구할인 혜택 미적용'],
    ['hyundaiM',6,'우측 QR코드 혹은 ARS 전용번호(02-2655-5003)로 신청 시에만 혜택 적용'],
  ];

  [[COND_SHEETS.CARD_BASE, baseRows], [COND_SHEETS.CARD_TIER, tierRows], [COND_SHEETS.CARD_NOTE, noteRows]].forEach(function(pair) {
    var name = pair[0], rows = pair[1];
    var ws = ss.getSheetByName(name);
    if (!ws) ws = ss.insertSheet(name);
    ws.clear();
    ws.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    ws.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
  });

  CacheService.getScriptCache().remove('appData');
  return '제휴카드 8월 데이터 갱신 완료 (기본/구간/유의사항 3개 탭 재작성)';
}

// ----------------------------------------------------------------
// getConditions() — 조건 시트를 읽어 반환
// ----------------------------------------------------------------
function getConditions() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var result = {};

  // 선납2
  var s2Sheet = ss.getSheetByName(COND_SHEETS.SUNAP2);
  if (s2Sheet) {
    var s2Data = s2Sheet.getDataRange().getValues().slice(1); // 헤더 제외
    var s2Map = {};
    s2Data.forEach(function(r) {
      var grade = String(r[0]).trim();
      if (!grade) return;
      if (!s2Map[grade]) s2Map[grade] = { label: String(r[1]).trim(), opts: [] };
      s2Map[grade].opts.push({ amt: Number(r[2]), disc: Number(r[3]) });
    });
    result.sunap2 = s2Map;
  }

  // 타사보상조건
  var tasabSheet = ss.getSheetByName(COND_SHEETS.TASAB);
  if (tasabSheet) {
    var tasabData = tasabSheet.getDataRange().getValues().slice(1);
    var tasabMap = {};
    tasabData.forEach(function(r) {
      var yr = Number(r[0]);
      if (!yr) return;
      tasabMap[yr] = {
        base:  Number(r[1]),
        결합:  Number(r[2]),
        동시구매: Number(r[3])
      };
    });
    result.tasab = tasabMap;
  }

  // 헤드보드: 제품DB에 편입됨 — 별매품가 필드로 직접 사용

  // 코라솔 — 3개 시트에서 구조화하여 파싱
  var korBase = ss.getSheetByName(COND_SHEETS.KOR_BASE);
  var korSup  = ss.getSheetByName(COND_SHEETS.KOR_SUP);
  var korPbk  = ss.getSheetByName(COND_SHEETS.KOR_PBK);
  if (korBase && korSup && korPbk) {
    var korMap = {};
    // 기본정보
    korBase.getDataRange().getValues().slice(1).forEach(function(r) {
      var key = String(r[0]).trim();
      if (!key) return;
      korMap[key] = { name:String(r[1]), 납부금:Number(r[3]), 납부회차:Number(r[4]), 만기환급금:Number(r[5]), 지원:[], 페이백:{} };
    });
    // 지원금
    korSup.getDataRange().getValues().slice(1).forEach(function(r) {
      var key = String(r[0]).trim();
      if (!key || !korMap[key]) return;
      korMap[key].지원.push({ months:Number(r[1]), total:Number(r[2]), monthly:Number(r[3]) });
    });
    // 페이백
    korPbk.getDataRange().getValues().slice(1).forEach(function(r) {
      var key = String(r[0]).trim();
      if (!key || !korMap[key]) return;
      korMap[key].페이백[String(r[1])] = Number(r[2]);
    });
    result.korasol = korMap;
  }

  // 멤버십요금 (일시불 비교용) — "일시불 멤버십" 표만 파싱
  var memSheet = ss.getSheetByName(COND_SHEETS.MEMBERSHIP);
  if (memSheet) {
    result.membershipCash = _parseMembershipCash(memSheet);
  }

  // 제휴카드
  var cardBaseSheet = ss.getSheetByName(COND_SHEETS.CARD_BASE);
  var cardTierSheet = ss.getSheetByName(COND_SHEETS.CARD_TIER);
  var cardNoteSheet = ss.getSheetByName(COND_SHEETS.CARD_NOTE);
  if (cardBaseSheet) {
    var cardMap = {};
    var cardOrder = [];
    cardBaseSheet.getDataRange().getValues().slice(1).forEach(function(r) {
      var id = String(r[0]).trim();
      if (!id) return;
      cardOrder.push(id);
      cardMap[id] = {
        id: id,
        name: String(r[1] || '').trim(),
        contact: String(r[2] || '').trim(),
        promo: String(r[3] || '').trim().toUpperCase() === 'Y',
        months: Number(r[4]) || 60,
        period: String(r[5] || '').trim(),
        target: String(r[6] || '').trim(),
        promoTitle: String(r[7] || '').trim(),
        extra: String(r[8] || '').trim(),
        fee: String(r[9] || '').trim(),
        issue: String(r[10] || '').trim(),
        url: String(r[11] || '').trim(),
        tiers: [],
        notes: []
      };
    });
    if (cardTierSheet) {
      cardTierSheet.getDataRange().getValues().slice(1).forEach(function(r) {
        var id = String(r[0]).trim();
        if (!id || !cardMap[id]) return;
        var base = toNum(r[2]);
        var promoAmt = (r[3] === '' || r[3] === null) ? null : toNum(r[3]);
        cardMap[id].tiers.push({
          th: String(r[1] || '').trim(),
          base: base,
          promo: promoAmt,
          total: base + (promoAmt || 0),
          promoLabel: String(r[4] || '').trim() || undefined
        });
      });
    }
    if (cardNoteSheet) {
      cardNoteSheet.getDataRange().getValues().slice(1).forEach(function(r) {
        var id = String(r[0]).trim();
        if (!id || !cardMap[id]) return;
        cardMap[id].notes.push(String(r[2] || '').trim());
      });
    }
    result.cards = cardOrder.map(function(id) { return cardMap[id]; });
  }

  // 별매품페어링 — 제품(모델명)당 여러 개 붙을 수 있는 별매품 옵션 (약정년별 가격 상이)
  var bmpSheet = ss.getSheetByName(COND_SHEETS.BMP_PAIR);
  if (bmpSheet) {
    result.bmpPairings = _parseBmpPairings(bmpSheet);
  }

  return result;
}

// 별매품페어링 시트 파싱 — 1행 헤더 텍스트로 컬럼을 찾음(제품DB와 별개로 이 시트는 헤더가 1행)
// 2026-08-04부터 가격 컬럼은 시트에 없음 — 별매품은 제품DB에 제품군(s)="별매품"으로 정식 등록된 행이고,
// 이 시트는 "메인 모델 ↔ 별매품 모델" 연결 관계만 저장함. 가격은 index.html에서 PRODUCTS를 그 별매품 모델명 +
// 카트 아이템의 약정년으로 조회해서 매번 최신값을 가져옴(정상가/프로모션가/재렌탈가 등 중복 저장 방지).
// 렌탈허용여부: 별매품 자신은 렌탈가격표가 있어도, "이 메인제품과의 연결"에서 렌탈로 팔지는 페어링별로 다를 수 있어서
// (예: 같은 P-3150C도 아이콘3에선 렌탈 가능, 아이콘 얼음정수기에선 일시불만) 페어링 단위 플래그로 따로 둠.
// 할인적용여부: 이 별매품이 메인 제품과 같이 살 때 동시구매/결합/일시불할인 등 % 할인에 같이 끼는지 — 페어링별로 다를 수 있음.
// 헤더가 없거나 셀이 비어있으면 "미설정"(null)으로 두고, 렌탈이면 기존처럼 기본 할인대상(true), 일시불이면 기본 비대상(false)으로
// index.html에서 문맥별 기본값을 적용함(둘 다 기존 동작 그대로 유지하기 위함).
var BMP_PAIR_HEADERS = { 모델명: '대상모델명', 별매품모델명: '별매품모델명', 개당여부: '1개당여부', 렌탈허용: '렌탈허용여부', 할인적용: '할인적용여부' };

function _bmpColMap(sheet) {
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var colMap = {};
  header.forEach(function(h, i) {
    var t = _norm(h);
    Object.keys(BMP_PAIR_HEADERS).forEach(function(f) {
      if (_norm(BMP_PAIR_HEADERS[f]) === t) colMap[f] = i;
    });
  });
  return colMap;
}

function _parseBmpPairings(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  var colMap = _bmpColMap(sheet);
  if (colMap.모델명 === undefined || colMap.별매품모델명 === undefined) return {};

  var lastCol = sheet.getLastColumn();
  var raw = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var map = {};
  raw.forEach(function(row) {
    var model = String(row[colMap.모델명] || '').trim();
    var bmpModel = String(row[colMap.별매품모델명] || '').trim();
    if (!model || !bmpModel) return;
    if (!map[model]) map[model] = [];
    var 할인적용Raw = colMap.할인적용 !== undefined ? String(row[colMap.할인적용] || '').trim().toUpperCase() : '';
    map[model].push({
      모델명: bmpModel,
      개당: colMap.개당여부 !== undefined ? (String(row[colMap.개당여부] || 'N').trim().toUpperCase() === 'Y') : false,
      렌탈허용: colMap.렌탈허용 !== undefined ? (String(row[colMap.렌탈허용] || 'N').trim().toUpperCase() === 'Y') : false,
      할인적용: 할인적용Raw === 'Y' ? true : (할인적용Raw === 'N' ? false : null)
    });
  });
  return map;
}

// ----------------------------------------------------------------
// admin.html "별매품 연결" UI 전용 — 별매품페어링 시트에 연결 행 추가/삭제
// ----------------------------------------------------------------
function _addBmpPairing(body) {
  if (!_checkAdminPassword(body.password)) return {error: '비밀번호가 올바르지 않습니다'};
  var 모델명 = String(body.모델명 || '').trim();
  var 별매품모델명 = String(body.별매품모델명 || '').trim();
  var 개당 = body.개당 ? 'Y' : 'N';
  var 렌탈허용 = body.렌탈허용 ? 'Y' : 'N';
  var 할인적용 = body.할인적용 ? 'Y' : 'N';
  if (!모델명 || !별매품모델명) return {error: '대상모델명/별매품모델명이 필요합니다'};

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(COND_SHEETS.BMP_PAIR);
  if (!sheet) return {error: '별매품페어링 시트를 찾을 수 없음'};

  var colMap = _bmpColMap(sheet);
  if (colMap.모델명 === undefined || colMap.별매품모델명 === undefined) {
    return {error: '별매품페어링 시트 헤더(대상모델명/별매품모델명)를 찾지 못했습니다'};
  }

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var lastCol = sheet.getLastColumn();
    var raw = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (var i = 0; i < raw.length; i++) {
      if (String(raw[i][colMap.모델명] || '').trim() === 모델명 &&
          String(raw[i][colMap.별매품모델명] || '').trim() === 별매품모델명) {
        return {error: '이미 연결되어 있습니다'};
      }
    }
  }

  var newRow = [];
  var lastCol2 = Math.max(
    sheet.getLastColumn(), colMap.모델명 + 1, colMap.별매품모델명 + 1,
    (colMap.개당여부 !== undefined ? colMap.개당여부 + 1 : 0),
    (colMap.렌탈허용 !== undefined ? colMap.렌탈허용 + 1 : 0),
    (colMap.할인적용 !== undefined ? colMap.할인적용 + 1 : 0)
  );
  for (var c = 0; c < lastCol2; c++) newRow.push('');
  newRow[colMap.모델명] = 모델명;
  newRow[colMap.별매품모델명] = 별매품모델명;
  if (colMap.개당여부 !== undefined) newRow[colMap.개당여부] = 개당;
  if (colMap.렌탈허용 !== undefined) newRow[colMap.렌탈허용] = 렌탈허용;
  if (colMap.할인적용 !== undefined) newRow[colMap.할인적용] = 할인적용;

  sheet.appendRow(newRow);
  CacheService.getScriptCache().remove('appData');
  return {ok: true};
}

// 기존 연결의 1개당여부/렌탈허용여부만 바꿀 때(재연결 없이 in-place로 수정) — admin.html 목록의 토글 스위치에서 호출
function _updateBmpPairing(body) {
  if (!_checkAdminPassword(body.password)) return {error: '비밀번호가 올바르지 않습니다'};
  var 모델명 = String(body.모델명 || '').trim();
  var 별매품모델명 = String(body.별매품모델명 || '').trim();
  if (!모델명 || !별매품모델명) return {error: '대상모델명/별매품모델명이 필요합니다'};

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(COND_SHEETS.BMP_PAIR);
  if (!sheet) return {error: '별매품페어링 시트를 찾을 수 없음'};

  var colMap = _bmpColMap(sheet);
  if (colMap.모델명 === undefined || colMap.별매품모델명 === undefined) {
    return {error: '별매품페어링 시트 헤더(대상모델명/별매품모델명)를 찾지 못했습니다'};
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {error: '연결된 행이 없습니다'};
  var lastCol = sheet.getLastColumn();
  var raw = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var i = 0; i < raw.length; i++) {
    if (String(raw[i][colMap.모델명] || '').trim() === 모델명 &&
        String(raw[i][colMap.별매품모델명] || '').trim() === 별매품모델명) {
      var sheetRow = i + 2;
      if (body.개당 !== undefined && colMap.개당여부 !== undefined) {
        sheet.getRange(sheetRow, colMap.개당여부 + 1).setValue(body.개당 ? 'Y' : 'N');
      }
      if (body.렌탈허용 !== undefined && colMap.렌탈허용 !== undefined) {
        sheet.getRange(sheetRow, colMap.렌탈허용 + 1).setValue(body.렌탈허용 ? 'Y' : 'N');
      }
      if (body.할인적용 !== undefined && colMap.할인적용 !== undefined) {
        sheet.getRange(sheetRow, colMap.할인적용 + 1).setValue(body.할인적용 ? 'Y' : 'N');
      }
      CacheService.getScriptCache().remove('appData');
      return {ok: true};
    }
  }
  return {error: '일치하는 연결을 찾지 못했습니다'};
}

function _removeBmpPairing(body) {
  if (!_checkAdminPassword(body.password)) return {error: '비밀번호가 올바르지 않습니다'};
  var 모델명 = String(body.모델명 || '').trim();
  var 별매품모델명 = String(body.별매품모델명 || '').trim();
  if (!모델명 || !별매품모델명) return {error: '대상모델명/별매품모델명이 필요합니다'};

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(COND_SHEETS.BMP_PAIR);
  if (!sheet) return {error: '별매품페어링 시트를 찾을 수 없음'};

  var colMap = _bmpColMap(sheet);
  if (colMap.모델명 === undefined || colMap.별매품모델명 === undefined) {
    return {error: '별매품페어링 시트 헤더(대상모델명/별매품모델명)를 찾지 못했습니다'};
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {error: '연결된 행이 없습니다'};
  var lastCol = sheet.getLastColumn();
  var raw = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var i = 0; i < raw.length; i++) {
    if (String(raw[i][colMap.모델명] || '').trim() === 모델명 &&
        String(raw[i][colMap.별매품모델명] || '').trim() === 별매품모델명) {
      sheet.deleteRow(i + 2);
      CacheService.getScriptCache().remove('appData');
      return {ok: true};
    }
  }
  return {error: '일치하는 연결을 찾지 못했습니다'};
}

// 멤버십요금 시트에서 "【 일시불 멤버십 】" 표만 파싱
// 결과 형태: { "정수기": { "일반": {2개월:.., 4개월:.., 6개월:.., 자가관리:..}, "얼음/탄산/이온/커피": {...}, ... }, "공기청정기": {...}, ... }
function _parseMembershipCash(sheet) {
  var values = sheet.getDataRange().getValues();
  var startIdx = -1;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).indexOf('일시불 멤버십') >= 0) { startIdx = i; break; }
  }
  if (startIdx < 0) return {};

  var map = {};
  // startIdx = 섹션 제목 행, startIdx+1 = 헤더 행(제품/기능구조/2개월/4개월/6개월/자가관리), startIdx+2부터 데이터
  for (var r = startIdx + 2; r < values.length; r++) {
    var row = values[r];
    var prod = String(row[0] || '').trim();
    if (!prod) break; // 빈 행 = 표 끝
    var feat = String(row[1] || '').trim();
    if (!map[prod]) map[prod] = {};
    map[prod][feat] = {
      '2개월':   _memNum(row[2]),
      '4개월':   _memNum(row[3]),
      '6개월':   _memNum(row[4]),
      '자가관리': _memNum(row[5])
    };
  }
  return map;
}
function _memNum(v) {
  if (v === null || v === undefined || v === '' || v === '-' || v === '–') return 0;
  var n = Number(v); return isNaN(n) ? 0 : n;
}

// ----------------------------------------------------------------
// getData() — 제품 데이터 + 조건 데이터 한번에 반환
// ----------------------------------------------------------------
function getData() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('appData');
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  var data = _fetchData();
  try { cache.put('appData', JSON.stringify(data), 21600); } catch(e) {}
  return data;
}

// ----------------------------------------------------------------
// 헤더 텍스트 기반 컬럼 매핑 — 위치(번호) 대신 3행 헤더 텍스트로 컬럼을 찾는다.
// 컬럼을 나중에 추가/삭제/재배치해도 헤더 텍스트만 유지되면 코드가 안 깨짐.
// ----------------------------------------------------------------

// 내부 필드명 → 실제 시트 헤더 텍스트. 시트 헤더를 바꾸면 이 표만 고치면 됨.
var FIELD_HEADERS = {
  s: '제품군', 분류: '분류', 모델명: '모델명', 제품명: '제품명',
  관리방법: '관리방법', 관리주기: '관리주기', 약정년: '약정(년)',
  정상가: '월렌탈료(정상)', 프로모션: '월렌탈료(프로모션)', 재렌탈: '재렌탈료(프로모션)', 일시불: '일시불가',
  타사보상렌탈: '타사보상_렌탈', 타사보상일시불: '타사보상_일시불',
  프로모션사용: '프로모션사용', 타사보상사용: '타사보상사용', 재렌탈사용: '재렌탈사용',
  타사보상일시불사용: '타사보상일시불사용'
};

function _norm(s) { return String(s || '').replace(/\s+/g, '').trim(); }

// 헤더 행을 읽어 {필드명: 1-based 컬럼번호} 맵을 만든다. 헤더에 없는 필드는 맵에서 빠짐(호출 쪽에서 처리).
function _headerColMap(sheet) {
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
  var textToCol = {};
  header.forEach(function(h, i) {
    var t = _norm(h);
    if (t) textToCol[t] = i + 1;
  });
  var colMap = {};
  Object.keys(FIELD_HEADERS).forEach(function(field) {
    var col = textToCol[_norm(FIELD_HEADERS[field])];
    if (col) colMap[field] = col;
  });
  return colMap;
}

// Apps Script 편집기에서 수동 실행 → 실행 로그(보기 → 로그)로 매핑 결과 확인용.
// 시트 헤더 문구를 바꿨을 때 코드가 제대로 컬럼을 찾는지 배포 전에 확인하는 용도.
function _testHeaderMap() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  var colMap = _headerColMap(sheet);
  var missing = Object.keys(FIELD_HEADERS).filter(function(f) { return !colMap[f]; });
  Logger.log('찾은 컬럼: ' + JSON.stringify(colMap));
  Logger.log('못 찾은 필드(헤더 텍스트 확인 필요): ' + JSON.stringify(missing));
  var sample = sheet.getRange(HEADER_ROW + 1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Object.keys(colMap).forEach(function(f) {
    Logger.log(f + ' = ' + sample[colMap[f] - 1]);
  });
  return {colMap: colMap, missing: missing};
}

function _fetchData() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('시트를 찾을 수 없음: "' + SHEET_NAME + '"');

  var colMap = _headerColMap(sheet);
  if (!colMap.제품명 || !colMap.약정년) {
    throw new Error('필수 헤더("' + FIELD_HEADERS.제품명 + '", "' + FIELD_HEADERS.약정년 + '")를 시트에서 찾지 못했습니다. 3행 헤더 텍스트를 확인해주세요');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < HEADER_ROW + 1) return { products: [], conditions: getConditions() };

  var lastCol = sheet.getLastColumn();
  var raw = sheet.getRange(HEADER_ROW + 1, 1, lastRow - HEADER_ROW, lastCol).getValues();
  var products = [];
  function cellAt(row, field) { var c = colMap[field]; return c ? row[c - 1] : ''; }

  raw.forEach(function(row) {
    var prodName = String(cellAt(row, '제품명') || '').trim();
    if (!prodName) return;
    var yakjRaw = Number(cellAt(row, '약정년'));
    var hasYakj = yakjRaw && !isNaN(yakjRaw) && yakjRaw > 0;
    // 약정(년)이 없는 행은 "약정 없이 일시불로만 구매하는 제품"(예: 수압펌프 등 부속품)으로 간주 —
    // 일시불가가 있으면 약정년=0(termless 표식)으로 포함, 둘 다 없으면 가격 정보가 아예 없는 행이라 제외
    var cashOnly = !hasYakj && toNum(cellAt(row, '일시불')) > 0;
    if (!hasYakj && !cashOnly) return;
    var yakj = hasYakj ? yakjRaw : 0;

    var bunryu = String(cellAt(row, '분류') || '').trim();
    if (!bunryu || bunryu === '분류' || bunryu === '-') bunryu = String(cellAt(row, 's') || '').trim();
    var promoOn = String(cellAt(row, '프로모션사용') || 'Y').trim().toUpperCase() !== 'N' ? 'Y' : 'N';
    var tasabOn = String(cellAt(row, '타사보상사용') || 'Y').trim().toUpperCase() !== 'N' ? 'Y' : 'N';
    var rerentalOn = String(cellAt(row, '재렌탈사용') || 'Y').trim().toUpperCase() !== 'N' ? 'Y' : 'N';
    var tasabCashOn = String(cellAt(row, '타사보상일시불사용') || 'Y').trim().toUpperCase() !== 'N' ? 'Y' : 'N';

    products.push([
      String(cellAt(row, 's') || '').trim(), bunryu,
      String(cellAt(row, '모델명') || '').trim(), prodName,
      String(cellAt(row, '관리방법') || '').trim(), String(cellAt(row, '관리주기') || '').trim(),
      yakj,
      toNum(cellAt(row, '정상가')), toNum(cellAt(row, '프로모션')), toNum(cellAt(row, '재렌탈')), toNum(cellAt(row, '일시불')),
      toNum(cellAt(row, '타사보상렌탈')), toNum(cellAt(row, '타사보상일시불')),
      promoOn, tasabOn, rerentalOn, tasabCashOn
    ]);
  });

  return { products: products, conditions: getConditions() };
}


function toNum(v) {
  if (v === null || v === undefined || v === '' || v === '-' || v === '–') return 0;
  var n = Number(v); return isNaN(n) ? 0 : n;
}

// ----------------------------------------------------------------
// testMailPermission()
// ----------------------------------------------------------------
function testMailPermission() {
  var me = Session.getActiveUser().getEmail();
  return 'Mail 권한 OK, 발송 계정: ' + me + ', 잔여: ' + MailApp.getRemainingDailyQuota() + '건';
}



// ----------------------------------------------------------------
// clearCache() ← 제품/가격 수정 후 앱 UI에서 호출
// ----------------------------------------------------------------
function clearCache() {
  CacheService.getScriptCache().remove('appData');
  return 'cache_cleared';
}

// ----------------------------------------------------------------
// onEdit() ← 제품DB 시트 수정 시 자동 캐시 삭제
// ----------------------------------------------------------------
function onEdit(e) {
  try {
    var sheet = e.source.getActiveSheet();
    if (sheet.getName() === SHEET_NAME) {
      CacheService.getScriptCache().remove('appData');
    }
  } catch(err) {}
}

// ----------------------------------------------------------------
// warmUpCache() ← 시간 트리거 등록 권장 (5시간마다)
// ----------------------------------------------------------------
function warmUpCache() {
  var data = _fetchData();
  try { CacheService.getScriptCache().put('appData', JSON.stringify(data), 21600); } catch(e) {}
}
// ----------------------------------------------------------------
// diagSheets() ← Apps Script 에디터에서 실행 후 로그 확인
// ----------------------------------------------------------------
function diagSheets() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var names = ss.getSheets().map(function(s){ return s.getName(); });
  Logger.log('스프레드시트 ID: ' + SPREADSHEET_ID);
  Logger.log('스프레드시트 이름: ' + ss.getName());
  Logger.log('전체 시트 목록 (' + names.length + '개): ' + names.join(', '));
  Logger.log('제품DB 존재 여부: ' + (names.indexOf('제품DB') >= 0 ? '✅ 있음' : '❌ 없음'));
}
