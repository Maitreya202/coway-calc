# 코웨이 갤러리 전용 견적 계산기

## 프로젝트 구조

- **프론트엔드**: `index.html` (HTML/CSS/JS 단일 파일)
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
 별매품명, 별매품가, 별매품가재렌탈, 별매품가일시불]
```
