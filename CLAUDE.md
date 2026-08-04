# 코웨이 갤러리 전용 견적 계산기

## 프로젝트 구조

- **프론트엔드**: `index.html` (HTML/CSS/JS 단일 파일)
- **관리자 페이지**: `admin.html` — 제품 로우 데이터 조회/수정 (비밀번호 게이트, 별도 탭)
- **백엔드 API**: Google Apps Script (`code.gs`) → 개인 구글 계정
- **호스팅**: GitHub Pages (`https://maitreya202.github.io/coway-calc`)
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
GitHub Pages (index.html)
→ fetch(GAS_URL + '?action=getData')
→ GAS doGet() → CacheService → 구글 시트
→ { products: [...], conditions: { sunap2, tasab, korasol } }
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
- 배포: GitHub Pages (Settings → Pages → main/root)

## 제품 데이터 구조 (구글 시트 제품DB)
```
[s, 분류, 모델명, 제품명, 관리방법, 관리주기, 약정년,
 정상가, 프로모션, 재렌탈, 일시불,
 타사보상렌탈, 타사보상지로, 타사보상일시불,
 별매품명, 별매품가, 별매품가재렌탈, 별매품가일시불,
 프로모션사용]
```
- 19번째 컬럼 `프로모션사용`(Y/N)은 admin.html에서 추가한 필드. 비어있으면 하위 호환을 위해 'Y'(사용)로 취급됨.
  구글 시트 `제품DB`에 이 컬럼을 아직 추가하지 않았다면 헤더 행(3행) S열에 `프로모션사용` 텍스트를 넣어야 admin.html에서 다룰 수 있음 — 안 넣어도 계산기 자체는 기존과 동일하게 동작함(기본값 Y).
- `프로모션사용=N`이면 `calcItem()`이 프로모션가를 무시하고 정상가로 계산(`index.html`의 `hasPromo` 판정부).

## admin.html (제품 관리 페이지)
- 별도 파일, `index.html`과 무관하게 독립 로드. URL 예: `https://maitreya202.github.io/coway-calc/admin.html`
- 진입 시 비밀번호 입력 → GAS `doPost(action:'adminAuth')`로 서버 검증. 비밀번호는 코드에 없고 Apps Script **스크립트 속성**(`ADMIN_PASSWORD`)에 저장 — Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성에서 최초 1회 설정 필요. 속성이 없으면 항상 인증 실패(fail-closed).
- 이 비밀번호 게이트는 "진짜 로그인"이 아니라 약한 잠금임 — URL을 아는 사람이 직접 API 요청을 만들면 우회 가능. 내부용 도구로만 사용할 것.
- 검색은 모델명/제품명 기준, 같은 모델명이라도 관리방법·관리주기·약정년별로 행이 여러 개 나올 수 있어 목록에서 정확한 행을 선택해야 함(가격이 조합마다 다름).
- 저장 시 `doPost(action:'updateProduct')`로 {모델명, 제품명, 관리방법, 관리주기, 약정년} 조합으로 시트에서 유일한 행을 찾은 뒤에만 값을 덮어씀 — 일치하는 행이 0개나 2개 이상이면 에러를 반환하고 아무 것도 쓰지 않음(오작동 방지).
- 식별 필드(모델명/제품명/관리방법/관리주기/약정년/분류/s)는 admin.html에서 수정 불가 — 이 값들을 바꾸면 다른 행과 혼동될 위험이 있어 의도적으로 시트에서 직접 수정하도록 남겨둠.
- 저장 후 서버에서 자동으로 `clearCache()` 호출 — index.html은 다음 로드(또는 "데이터 업데이트" 버튼) 시 최신 값을 받음.
- **code.gs를 수정한 뒤에는 Apps Script 편집기에 붙여넣고 새 버전으로 재배포해야** 실제 GAS_URL에 반영됨 — 로컬 `code.gs` 파일을 고치는 것만으로는 라이브 배포가 바뀌지 않음.
