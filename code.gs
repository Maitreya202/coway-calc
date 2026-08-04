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
  CARD_NOTE: '제휴카드_유의사항'
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

// 수정 가능한 필드 = 컬럼 번호(1-based) 매핑. 식별용 필드(모델명/제품명/관리방법/관리주기/약정년/분류/s)는 이 도구로 바꿀 수 없음 —
// 식별자를 바꾸면 다른 행과 헷갈릴 위험이 있어 시트에서 직접 수정하도록 의도적으로 제외함.
var PRODUCT_EDITABLE_FIELDS = {
  정상가:8, 프로모션:9, 재렌탈:10, 일시불:11,
  타사보상렌탈:12, 타사보상지로:13, 타사보상일시불:14,
  별매품명:15, 별매품가:16, 별매품가재렌탈:17, 별매품가일시불:18,
  프로모션사용:19
};
var PRODUCT_NUMERIC_FIELDS = ['정상가','프로모션','재렌탈','일시불','타사보상렌탈','타사보상지로','타사보상일시불','별매품가','별매품가재렌탈','별매품가일시불'];

function _updateProduct(body) {
  if (!_checkAdminPassword(body.password)) return {error: '비밀번호가 올바르지 않습니다'};

  var key = body.key || {};
  var fields = body.fields || {};
  if (!key.모델명 || !key.제품명 || key.약정년 === undefined) {
    return {error: '수정할 행을 식별할 수 없습니다 (모델명/제품명/약정년 누락)'};
  }

  // 필드 값 검증 — 숫자 필드는 유한하고 0 이상인지, 프로모션사용은 Y/N인지 확인
  for (var f in fields) {
    if (!PRODUCT_EDITABLE_FIELDS[f]) return {error: '수정할 수 없는 필드입니다: ' + f};
    if (PRODUCT_NUMERIC_FIELDS.indexOf(f) >= 0) {
      var n = Number(fields[f]);
      if (!isFinite(n) || n < 0) return {error: f + ' 값이 올바르지 않습니다: ' + fields[f]};
    }
    if (f === '프로모션사용' && ['Y','N'].indexOf(String(fields[f]).toUpperCase()) < 0) {
      return {error: '프로모션사용 값은 Y 또는 N 이어야 합니다'};
    }
  }

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return {error: '시트를 찾을 수 없음: "' + SHEET_NAME + '"'};

  var lastRow = sheet.getLastRow();
  if (lastRow < HEADER_ROW + 1) return {error: '제품 데이터가 없습니다'};

  var raw = sheet.getRange(HEADER_ROW + 1, 1, lastRow - HEADER_ROW, PRODUCT_COLS).getValues();
  var matches = [];
  raw.forEach(function(row, i) {
    if (String(row[2]).trim() === String(key.모델명).trim() &&
        String(row[3]).trim() === String(key.제품명).trim() &&
        String(row[4]).trim() === String(key.관리방법 || '').trim() &&
        String(row[5]).trim() === String(key.관리주기 || '').trim() &&
        Number(row[6]) === Number(key.약정년)) {
      matches.push(i);
    }
  });

  if (matches.length === 0) return {error: '일치하는 행을 찾지 못했습니다 (다른 사람이 먼저 삭제/수정했을 수 있어요 — 새로고침 후 다시 시도해주세요)'};
  if (matches.length > 1) return {error: '조건에 맞는 행이 ' + matches.length + '개 발견되어 안전하게 수정할 수 없습니다. 시트에서 직접 확인해주세요'};

  var sheetRow = HEADER_ROW + 1 + matches[0];
  for (var field in fields) {
    var col = PRODUCT_EDITABLE_FIELDS[field];
    var val = PRODUCT_NUMERIC_FIELDS.indexOf(field) >= 0 ? Number(fields[field]) : String(fields[field]);
    sheet.getRange(sheetRow, col).setValue(val);
  }

  CacheService.getScriptCache().remove('appData');
  return {ok: true, row: sheetRow};
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

  return result;
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

// 제품DB 컬럼 순서 (1-based). 19번째 "프로모션사용" 컬럼이 없는 시트도
// 하위 호환되도록 항상 비어있으면 'Y'(사용)로 취급한다.
var PRODUCT_COLS = 19;

function _fetchData() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('시트를 찾을 수 없음: "' + SHEET_NAME + '"');

  var lastRow = sheet.getLastRow();
  if (lastRow < HEADER_ROW + 1) return { products: [], conditions: getConditions() };

  var raw = sheet.getRange(HEADER_ROW + 1, 1, lastRow - HEADER_ROW, PRODUCT_COLS).getValues();
  var products = [];

  raw.forEach(function(row) {
    var prodName = String(row[3] || '').trim();
    if (!prodName) return;
    var yakj = Number(row[6]);
    if (!yakj || isNaN(yakj) || yakj <= 0) return;

    var bunryu = String(row[1] || '').trim();
    if (!bunryu || bunryu === '분류' || bunryu === '-') bunryu = String(row[0] || '').trim();
    var bmpName = String(row[14] || '').trim();
    if (bmpName === '-' || bmpName === '–') bmpName = '';
    var promoOn = String(row[18] || 'Y').trim().toUpperCase() !== 'N' ? 'Y' : 'N';

    products.push([
      String(row[0] || '').trim(), bunryu,
      String(row[2] || '').trim(), prodName,
      String(row[4] || '').trim(), String(row[5] || '').trim(),
      yakj,
      toNum(row[7]), toNum(row[8]), toNum(row[9]), toNum(row[10]),
      toNum(row[11]), toNum(row[12]), toNum(row[13]),
      bmpName,
      toNum(row[15]), toNum(row[16]), toNum(row[17]),
      promoOn
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
