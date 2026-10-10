# 우리장부

개인·부부용 가계부의 검토 가능한 첫 버전입니다. 거래, 예산, 고정비, 투자, 부채와 가정 합산 대시보드를 한 화면 흐름으로 구성했습니다.

## 실행

```bash
pnpm install
pnpm dev
```

배포용 확인은 `pnpm build`로 실행합니다. Firebase 프로젝트 `uri-jangbu`와 연결한 뒤에는 `firebase deploy --only firestore,hosting`으로 규칙과 웹을 함께 배포합니다.

## 문서와 설정

- `docs/PRD.md`: 제품 범위와 요구사항
- `docs/IMPORT_SPEC.md`: 하나카드·IBK기업은행 파일 규칙
- `firestore.rules`: 로그인·가정 구성원·초대 권한을 강제하는 Firestore 규칙
- `firebase.json`: Firestore·Firebase Hosting 배포 설정

## 현재 구현 범위

- 반응형 가정 대시보드
- 직접 거래 입력
- 하나카드·IBK기업은행 `.xls/.xlsx/.csv` 브라우저 분석
- 기본 카테고리 추정
- 예산·고정비·투자·부채 화면
- Firebase Authentication Google 로그인
- 7일간 유효한 가정 초대 링크·코드
- Cloud Firestore 기반 공동 장부 저장과 구성원 동기화

국내주식·ETF/ETN 시세는 한국투자증권 Open API로 조회합니다. 발급받은 `App Key`와 `App Secret`은 Cloudflare Worker의 `KIS_APP_KEY`, `KIS_APP_SECRET` Secret으로만 등록합니다. Firebase Hosting은 정적 웹을 배포하므로 인증키를 브라우저 코드나 GitHub에 넣지 않습니다. Worker 주소만 `VITE_MARKET_WORKER_URL`로 설정하며, 이는 공개되어도 안전한 서비스 주소입니다.

Worker는 한국투자 API 접근 토큰을 서버에서 발급·캐시하고, ETF/ETN 현재가 조회 후 일반 국내주식 현재가 조회를 순서대로 시도합니다. 시세 원자료는 수정하지 않고, 평가금은 `최근 시세 × 보유수량`으로 별도 계산합니다.

## Google 로그인 설정

이 프로젝트는 로그인 없이 현재 브라우저의 개인 장부를 바로 사용할 수 있습니다. 가족과 공유하려면 설정 화면의 Google 로그인 옵션을 사용합니다. Firebase 프로젝트 `uri-jangbu`에 Google 제공자가 활성화되어 있어 별도의 OAuth 클라이언트 ID나 비밀번호를 만들 필요가 없습니다. 로그인 상태와 공유 장부 접근은 Firebase Authentication과 Firestore 보안 규칙으로 검증합니다.

로컬 테스트는 기본값으로 바로 가능하며, Firebase Hosting 배포 뒤에는 Firebase Authentication의 승인된 도메인에 `uri-jangbu.web.app`을 확인합니다.

로그인한 첫 사용자는 개인 가정을 자동으로 생성합니다. 설정 화면에서 7일간 유효한 초대 코드를 만든 뒤 상대방에게 전달할 수 있으며, 상대방은 자신의 Google 계정으로 로그인한 후 코드로 접속 권한을 요청합니다. 초대 링크를 열면 로그인만으로 요청할 수 있습니다. 장부 소유자가 요청자의 이름과 이메일을 확인해 승인하기 전에는 공동 장부 정보가 공개되지 않습니다. 초대 코드는 앱이 대신 이메일을 발송하지 않으며 사용자가 원하는 메신저·이메일로 직접 공유합니다.

배포 시에는 `firebase deploy --only firestore,hosting`으로 Firestore 규칙·색인과 Firebase Hosting을 함께 반영합니다.

