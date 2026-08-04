# 코웨이 갤러리 전용 견적 계산기

## 프로젝트 구조

- **프론트엔드**: `index.html` (HTML/CSS/JS 단일 파일)
- **관리자 페이지**: `admin.html` — 제품 로우 데이터 조회/수정 (비밀번호 게이트, 별도 탭)
- **백엔드 API**: Google Apps Script (`code.gs`) → 개인 구글 계정
- **호스팅**: Cloudflare Pages (`https://coway-calc.pages.dev`) — 이 GitHub 저장소(`main` 브랜치)와 연결되어 `git push` 시 자동 배포됨. GitHub Pages는 코드 노출 방지 목적으로 의도적으로 꺼둔 상태(계정 Settings → Pages에서 비활성화) — 다시 켜지 말 것.
  Cloudflare Access가 도메인 전체를 막고 있어 접속 시 로그인 필요(관리자 개인 인증 방식) — admin.html의 비밀번호 게이트와는 별개의, 그 앞단 보안 계층임.
- **데이터**: 구글 시트 (`17wd6OMYMazzveTZ6LcnMSi8a84XYuHSyWESYdwWCN8s`)

## GAS API URL
```
https://script.google.com/macros/s/AKfycbw_06KQ9F7v2qibjtlrm6s2qfysb0FSaCEVnijccb3-ANZu7ahER0W245c9lYoZ2UMMSA/exec
```

## index.html 주요 함수 구조

- `renderBoxRow()` — 제품 카드 한 줄 (능동형 태그)
- `renderOptionPanels()` — 구매방법/약정/관리방법 패널 (상단 sticky 가격 바 포함)
- `renderDiscPanels()` — 할인/별매품/반값/코라솔 패널
- `renderResultBox()` — 계산 결과 박스
- `renderCart()` — 위 4개 조립 (스크롤 위치 저장/복원 포함)
- `calcItem()` — 가격 계산 핵심 로직
- `toggleDetail(idx)` — 카드 펼침/닫힘

## 데이터 흐름

```
Cloudflare Pages (index.html)
→ fetch(GAS_URL + '?action=getData')
→ GAS doGet() → CacheService → 구글 시트
→ { products: [...], conditions: { sunap2, tasab, korasol, bmpPairings, ... } }
```

## 조건 데이터 (구글 시트 탭)
- `선납2조건` — 선납2 구분(A/B/C), 선납금, 할인총액
- `타사보상조건` — 약정년별 추가할인 (6·7년: 20,000원)
- `코라솔_기본` / `코라솔_지원금` / `코라솔_페이백`

## 코드 수정 시 주의사항

1. **JS 수정 후 반드시 문법 검증**: `node --check` 또는 내장 검증
2. **renderBoxRow/renderOptionPanels/renderDiscPanels/renderResultBox 분리 구조** 유지
3. **git push 후 GitHub Pages 반영까지 1~2분 소요**
4. **스크롤 복원**: `renderCart()` 상단의 `_scrollY` 저장/복원 로직 건드리지 말 것
5. **position:sticky**: `.cart-list { overflow:visible }` 필수 (hidden으로 바꾸면 sticky 깨짐)

## GitHub 저장소
- URL: `https://github.com/Maitreya202/coway-calc`
- Branch: `main`
- 배포: Cloudflare Pages(`coway-calc.pages.dev`)가 이 저장소 `main`과 연결되어 `git push` 시 자동 배포. GitHub Pages는 사용 안 함(의도적으로 꺼둠)

## 제품 데이터 구조 (구글 시트 제품DB)
```
[s, 분류, 모델명, 제품명, 관리방법, 관리주기, 약정년,
 정상가, 프로모션, 재렌탈, 일시불,
 타사보상렌탈, 타사보상지로, 타사보상일시불,
 별매품명, 별매품가, 별매품가재렌탈, 별매품가일시불,
 프로모션사용]
```
- 이 배열은 `getData()` 응답의 `products` 각 행 포맷(순서 고정, 프론트엔드 계약)일 뿐, **실제 시트 컬럼 위치와는 무관함** — `code.gs`는 3행 헤더 텍스트로 컬럼을 찾아서(`FIELD_HEADERS`/`_headerColMap()`) 이 순서로 재배열해 반환함. 시트에서 컬럼을 추가/삭제/재배치해도 헤더 텍스트만 유지되면 안 깨짐.
- 실제 시트(`제품DB`) 헤더 텍스트는 내부 필드명과 다름 — `code.gs`의 `FIELD_HEADERS` 참고:
  `제품군`→s, `분류`→분류, `모델명`→모델명, `제품명`→제품명, `관리방법`→관리방법, `관리주기`→관리주기,
  `약정(년)`→약정년, `월렌탈료(정상)`→정상가, `월렌탈료(프로모션)`→프로모션, `재렌탈료(프로모션)`→재렌탈, `일시불가`→일시불,
  `타사보상_렌탈`→타사보상렌탈, `타사보상_지로가`→타사보상지로, `타사보상_일시불`→타사보상일시불,
  `별매품명`→별매품명, `별매품_월렌탈 추가_신규`→별매품가, `별매품_월렌탈 추가_재렌탈`→별매품가재렌탈, `별매품_월렌탈 추가_일시불`→별매품가일시불,
  `프로모션사용`→프로모션사용(신규)
- `프로모션사용`(Y/N)은 admin.html에서 추가한 필드. 시트에 아직 이 헤더가 없으면 하위 호환으로 'Y'(사용) 취급 — 헤더 텍스트로 찾으므로 **어느 열에 추가해도 상관없음**, 헤더 행(3행)에 정확히 `프로모션사용` 텍스트만 있으면 됨.
- `프로모션사용=N`이면 `calcItem()`이 프로모션가를 무시하고 정상가로 계산(`index.html`의 `hasPromo` 판정부).
- 시트 헤더 텍스트를 바꾸거나 새 필드를 연결할 땐, `code.gs`에서 `_testHeaderMap()` 함수를 Apps Script 편집기에서 수동 실행 → 실행 로그로 매핑이 올바른지 배포 전에 확인할 것.

## admin.html (제품 관리 페이지)
- 별도 파일, `index.html`과 무관하게 독립 로드. URL: `https://coway-calc.pages.dev/admin.html`
- 진입 시 비밀번호 입력 → GAS `doPost(action:'adminAuth')`로 서버 검증. 비밀번호는 코드에 없고 Apps Script **스크립트 속성**(`ADMIN_PASSWORD`)에 저장 — Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성에서 최초 1회 설정 필요. 속성이 없으면 항상 인증 실패(fail-closed).
- 이 비밀번호 게이트는 "진짜 로그인"이 아니라 약한 잠금임 — URL을 아는 사람이 직접 API 요청을 만들면 우회 가능. 내부용 도구로만 사용할 것.
- 검색은 모델명/제품명 기준, 같은 모델명이라도 관리방법·관리주기·약정년별로 행이 여러 개 나올 수 있어 목록에서 정확한 행을 선택해야 함(가격이 조합마다 다름).
- 저장 시 `doPost(action:'updateProduct')`로 {모델명, 제품명, 관리방법, 관리주기, 약정년} 조합으로 시트에서 유일한 행을 찾은 뒤에만 값을 덮어씀 — 일치하는 행이 0개나 2개 이상이면 에러를 반환하고 아무 것도 쓰지 않음(오작동 방지).
- 식별 필드(모델명/제품명/관리방법/관리주기/약정년/분류/s)는 admin.html에서 수정 불가 — 이 값들을 바꾸면 다른 행과 혼동될 위험이 있어 의도적으로 시트에서 직접 수정하도록 남겨둠.
- 저장 후 서버에서 자동으로 `clearCache()` 호출 — index.html은 다음 로드(또는 "데이터 업데이트" 버튼) 시 최신 값을 받음.
- **code.gs를 수정한 뒤에는 Apps Script 편집기에 붙여넣고 새 버전으로 재배포해야** 실제 GAS_URL에 반영됨 — 로컬 `code.gs` 파일을 고치는 것만으로는 라이브 배포가 바뀌지 않음.

## 별매품 다중 선택 (별매품페어링 시트)
- 제품DB의 별매품 4개 컬럼(별매품명/가/재렌탈/일시불)은 "제품당 별매품 1개"만 표현 가능한 레거시 구조. 제품 하나에 별매품이 여러 개 붙어야 할 때는 별도 시트 `별매품페어링`(1행 헤더)을 씀:
  `대상모델명 | 별매품명 | 약정(년) | 월렌탈가 | 재렌탈가 | 일시불가 | 1개당여부`
  - 모델명당 여러 행 가능(별매품 종류별로, 약정년별로) — 관리방법/관리주기는 가격에 영향 없어서 키에서 제외
  - `code.gs`의 `_parseBmpPairings()`가 헤더 텍스트로 컬럼을 찾아 모델명별로 묶어서 `getConditions().bmpPairings`로 반환
  - `일시불가` 컬럼은 레거시 별매품가일시불과 마찬가지로 **아직 계산 로직에서 사용 안 함** (일시불 구매 모드엔 별매품 자체가 적용 안 되는 구조 — cash 분기가 `calcItem()` 초반에 별도 early return)
- `index.html`의 `itemBmpOptions(item)`이 레거시 필드 + `BMP_PAIRINGS[item.모델명]`(item.약정년과 일치하는 것만)을 합쳐 선택 가능한 옵션 목록을 만듦. `renderDiscPanels()`가 이 목록을 체크박스 여러 개로 렌더링하고, 선택 상태는 `item.별매품선택 = {별매품명: {on, cnt}}`에 저장(과거의 `item.별매품on`/`item.별매품cnt` 단일 필드는 제거됨).
- `calcItem()`은 선택된 옵션들의 가격(1개당 옵션은 수량 곱해서)을 전부 합산 — CFSS 프레임 헤드보드(`headType` 라디오)는 이 목록과 무관한 별도 로직으로 그대로 유지됨.
- admin.html에서는 아직 이 페어링 시트를 관리하는 UI가 없음 — 지금은 시트에서 직접 행을 추가/삭제해야 함.
