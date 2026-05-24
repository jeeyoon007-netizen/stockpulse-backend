# AI Skill: Canary API Integration Test (카나리아 실시간 API 검증)

이 스킬은 한국투자증권(KIS) 및 한국은행(ECOS) 실시간 API 키 연동 상태 및 자금 동향, 신용 잔고, 코스피 지수를 활용한 ADR 계산 루틴이 실시간으로 완벽히 동작하는지 검증할 때 사용합니다. API 전체 구조를 스캔하지 않고 이 파일에 기술된 전용 진단 스크립트만 구동합니다.

---

## 1. Trigger Words (트리거 검색어)
- "카나리아 테스트", "실시간 KIS 테스트", "ADR 계산 검증", "test_canary"

---

## 2. Minimal Required Context (최소 요구 콘텍스트)
- **환경 변수**: `.env` (반드시 `KIS_APP_KEY`, `KIS_APP_SECRET`, `BOK_API_KEY`가 기재되어 있어야 함)
- **테스트 타겟**: `<PROJECT_ROOT>/src/test_canary.ts`
- *주의: 서버 소스코드 전체를 분석하지 마십시오.*

---

## 3. Execution Commands (실행 명령어)
프로젝트 루트 디렉토리(`<PROJECT_ROOT>`)에서 아래 명령어를 수행합니다.

```powershell
# tsx 도구를 이용해 독립적인 카나리아 진단 파일 즉시 실행
npx tsx src/test_canary.ts
```

---

## 4. Output Verification Criteria (출력 검증 기준)

### ✅ 성공 판단 기준
터미널 로그에 아래 항목들이 정상 출력될 때 성공으로 판정합니다:
1. `Funds: { date: '...', deposit: ..., margin_loan: ..., misu: ... }` 형태로 실제 자금액이 파싱되어 들어올 때 (원화 단위 환산 검증 완료).
2. `KRX New High:` 뒤에 0 이상의 정수가 출력될 때.
3. `KOSPI ADR:` 및 `KOSDAQ ADR:` 데이터가 `{ adr: '...', time: '...', signal: '...' }` 형태로 에러 없이 출력될 때 (www.adrinfo.kr 크롤링 정상 동작 검증).

### ❌ 실패 판단 기준
- `토큰 발급 실패`, `401 Unauthorized`, `Invalid AppKey` 등 KIS OAuth 인증 단계에서 거절되는 경우.
- `fetchMarketFunds exception` 또는 `fetchNewHighCount exception` 로그가 발생하고 결과가 `null` 혹은 `0`으로 비정상 처리되는 경우.
- `fetchMarketFunds` 또는 ECOS 관련 호출에서 `BOK_API_KEY` 미설정으로 인한 `401` 또는 `missing key` 에러가 발생하는 경우.
  - 해결 조치: `.env` 파일에 `BOK_API_KEY` 값이 누락되어 있는지 확인할 것.
