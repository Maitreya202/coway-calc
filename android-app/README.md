# 코웨이갤러리 견적계산기 — 안드로이드 앱

`https://coway-calc.pages.dev/` 를 감싼 WebView 기반 안드로이드 앱입니다.
웹앱(index.html) 코드는 전혀 건드리지 않고, 앱 쪽에서 두 가지만 추가로 처리합니다.

1. **Basic 인증 자동 입력** — `functions/_middleware.js`의 `gallery` / `gallerycalc01` 계정으로 자동 로그인 (비번창 안 뜸)
2. **PDF/이미지 다운로드 처리** — 순수 WebView는 `blob:`/`data:` 다운로드를 못 받으므로, 페이지 로드 후 JS 훅을 주입해서 다운로드 클릭을 가로채고 `휴대폰 다운로드/coway-calc` 폴더에 저장합니다 (네이버웍스 인앱브라우저에서 겪었던 "PDF 저장 안 됨" 문제의 해결책)

## 여는 방법

1. Android Studio 설치 (최신 안정 버전)
2. `File > Open` → 이 `android-app` 폴더 선택
3. 처음 열면 Gradle Sync가 자동으로 진행됩니다 (Gradle wrapper가 없으면 Android Studio가 자동 생성 제안 — 제안 뜨면 승인)
4. 상단 실행 버튼(▶)으로 에뮬레이터 또는 연결된 실제 폰에서 바로 실행 가능

## APK 만들기 (배포용)

- 테스트용: `Build > Build Bundle(s) / APK(s) > Build APK(s)`
- 정식 배포(서명 필요): `Build > Generate Signed Bundle / APK` → 키스토어 새로 만들거나 기존 것 사용 → APK 또는 AAB 생성

## 코드 위치

| 파일 | 역할 |
|---|---|
| `app/src/main/java/com/cowaygallery/calc/MainActivity.kt` | WebView 설정, Basic 인증 자동응답, 다운로드 훅 JS 주입 |
| `app/src/main/java/com/cowaygallery/calc/AndroidFileBridge.kt` | JS에서 넘어온 base64 데이터를 실제 파일로 저장 (`MediaStore.Downloads`) |
| `app/src/main/AndroidManifest.xml` | 인터넷 권한, 앱 이름/아이콘/테마 |

## 알아두어야 할 점

- **아이콘은 임시 플레이스홀더**입니다 (`res/drawable/ic_launcher.xml`, 파란 사각형 + 흰 줄무늬). 실제 로고로 교체하려면 Android Studio의 `Image Asset` 마법사(`res` 우클릭 → `New > Image Asset`)를 쓰는 게 가장 쉽습니다.
- **"바로 인쇄" 버튼(`window.print()`)은 WebView에서 기본 동작하지 않습니다.** 필요하면 안드로이드의 `PrintManager` + `WebView.createPrintDocumentAdapter()` 연동을 추가로 구현해야 합니다 (지금 프로젝트엔 미포함).
- 사이트 URL이나 인증 계정을 바꾸면 `MainActivity.kt` 상단의 `SITE_URL`/`AUTH_USER`/`AUTH_PASS` 상수만 고치면 됩니다. `functions/_middleware.js`의 계정과 항상 일치해야 자동 로그인이 됩니다.
- Google Play에 올릴 계획이면 `applicationId`(현재 `com.cowaygallery.calc`)를 고유하게 정해서 `app/build.gradle`에서 확정해두는 게 좋습니다.
