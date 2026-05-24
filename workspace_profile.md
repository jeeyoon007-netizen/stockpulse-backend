# StockPulse Backend - AI System Profile & Redesign Spec (context-reduction)

이 문서는 AI가 `stockpulse-backend` 시스템을 즉시 파악하고, 최소한의 Context 소비(Token 절감)만으로 개발, 리디자인, 하네스 엔지니어링(Harness Engineering), 그리고 Skill 작성을 수행할 수 있도록 돕는 **AI 전용 시스템 프로필 및 설계 청사진**입니다.

---

## 0. ⚠️ AI Git 배포 워크플로우 (필수 준수)

사용자가 "수정사항 깃해줘", "깃 푸시해줘", "배포해줘" 등을 말하면 **반드시 아래 순서를 따른다.**

### 백엔드 푸시 (Render 자동 배포 트리거)

```powershell
git -C "c:\Users\jeeyo\OneDrive\바탕 화면\study\backend" add -A
git -C "c:\Users\jeeyo\OneDrive\바탕 화면\study\backend" commit -m "<코밋 메시지>"
git -C "c:\Users\jeeyo\OneDrive\바탕 화면\study\backend" push origin main
```

### 프론트엔드 푸시 (Vercel 자동 배포 트리거)

```powershell
git -C "c:\Users\jeeyo\OneDrive\바탕 화면\study\pwa" add -A
git -C "c:\Users\jeeyo\OneDrive\바탕 화면\study\pwa" commit -m "<코밋 메시지>"
git -C "c:\Users\jeeyo\OneDrive\바탕 화면\study\pwa" push origin master
git -C "c:\Users\jeeyo\OneDrive\바탕 화면\study\pwa" push origin master:main
```

> **핵심**: 프론트엔드는 로친 브랜치가 `master`이지만 Vercel은 `main`을 추적한다.
> 반드시 `master:main`까지 푸시해야 Vercel 배포가 트리거된다.

### 프로젝트 배포 구조

| 레포지토리 | 로컈 경로 | 배포 플랫폼 | URL |
|---|---|---|---|
| 백엔드 | `study/backend` | **Render** | `https://stock-brv7.onrender.com` |
| 프론트엔드 | `study/pwa` | **Vercel** | Vercel 자동 도메인 |

### PowerShell 주의사항
- `&&` 사용 불가 → `;` 또는 별도 커맨드로 실행
- `push origin master:main` 시 리모트에 이미 다른 내용이 있으면 `--force` 필요

---


## 1. System Architecture & Flow (시스템 아키텍처 및 흐름)

`stockpulse-backend`는 실시간 국내/해외 금융 데이터 및 시장 심리 지표를 백그라운드에서 수집하여 캐싱하고, WebSocket 브로드캐스트와 REST API 폴백을 지원하는 데이터 미들웨어 서버입니다.

```mermaid
graph TD
    %% 외부 API 영역
    subgraph External APIs
        KIS[한국투자증권 KIS API]
        BOK[한국은행 ECOS API]
        FGI[Fear & Greed Index API]
    end

    %% 서버 내부 영역
    subgraph StockPulse Backend Server
        Scheduler[70초 주기 수집 스케줄러]
        Auth[KIS Auth Manager: token 캐싱/재사용]
        Parser[KIS & ECOS Parsers: 데이터 변환]
        Cache[(Global In-memory Cache)]
        WS_Server[WebSocket Server ws://...]
        REST_Server[Express REST API Server]
    end

    %% 클라이언트 영역
    subgraph Clients
        WS_Client[WebSocket Clients]
        REST_Client[REST Fallback Clients]
    end

    %% 데이터 흐름 정의
    Scheduler -->|1. 토큰 요청| Auth
    Auth -->|2. 토큰 반환| Scheduler
    Scheduler -->|3. 원시 데이터 Fetch| External APIs
    External APIs -->|4. 응답 데이터| Parser
    Parser -->|5. 구조화된 데이터| Cache
    Cache -->|6. 업데이트 브로드캐스트| WS_Server
    WS_Server -->|실시간 전송| WS_Client
    Cache -->|REST 응답| REST_Server
    REST_Server -->|폴백 요청| REST_Client

    %% 에러 처리 알림
    Scheduler -.->|에러 발생 시 Kakao Alert| Alert[Kakao Alert Sender]
```

### 핵심 수집 및 캐싱 주기 (70초)
1. **시장 지수 (Major Indices):** 코스피(`0001`), 코스닥(`1001`), 코스피200(`2001`), 원/달러 환율 (ECOS).
2. **카나리아 데이터 (Canary Data):** 증시자금 동향 (고객예탁금, 신용융자잔고, 미수금), 코스피 52주 신고가 종목 수, KOSPI/KOSDAQ ADR (외부 `adrinfo.kr` 사이트 크롤링 기준 과열/과매도 판별).
3. **공포탐욕지수 (Fear & Greed Index):** 국내(KR) 및 미국(US) 시장의 공포 탐욕 지수 수집.
4. **외인/기관 수급 데이터 (Investor Flow):** 코스피 기준 외국인/기관 순매수 상위 10개 종목 정보.

---

## 2. Directory Structure & File Roles (디렉토리 구조 및 파일 역할)

경로명에 기재된 `<PROJECT_ROOT>`는 사용자의 실제 백엔드 프로젝트 루트 디렉토리를 가리킵니다.

```
<PROJECT_ROOT>
├── .env                        # KIS_APP_KEY, KIS_APP_SECRET, BOK_API_KEY, PORT 등 설정
├── Dockerfile                  # 배포용 Docker 설정
├── tsconfig.json               # ES2022 및 NodeNext 모듈 해석용 TS 설정
├── package.json                # tsx (실행), typescript (빌드), ws, express, axios 의존성
├── src/
│   ├── server.ts               # Express & ws 서버 통합, 70초 스케줄링 루프, GlobalCache 관리
│   ├── api/
│   │   ├── kis.ts              # KIS API 토큰 관리 (OAuth 2.0 발급, 인메모리 캐싱, 중복 요청 방지)
│   │   ├── kis-market.ts       # KIS 및 BOK API 데이터 fetch 함수 모음
│   │   ├── feargreed.ts        # 공포탐욕지수 fetch 함수 및 타입 인터페이스
│   │   └── parsers/
│   │       └── kis_parser.ts   # KIS/ECOS 원시 응답을 StockPulse 공통 포맷으로 매핑 (Pure Functions)
│   ├── utils/
│   │   └── alert.ts            # 카카오 알림 발송 뼈대 (Mock 구현 포함)
│   └── (Test Scripts)          # 개발 및 진단용 독립 스크립트 모음
│       ├── test_adr.ts         # 지수 일별 차트 API 테스트
│       ├── test_adr2.ts        # 지수 일별 시세 API 테스트
│       ├── test_canary.ts      # 신용잔고, 신고가, ADR 등 카나리아 통합 API 검증
│       ├── test_krx.ts         # KRX 데이터 포털 직접 스크래핑 테스트
│       ├── test_newhigh_all.ts # 52주 신고가 API 테스트
│       └── test_raw_canary.ts  # 증시자금동향 및 신용잔고 원시 응답 검증
└── test_harness/
    └── test_krx_parsers.ts     # KIS & ECOS 파서 오프라인 Mock 테스트 하네스
```

> [!NOTE]
> **KRX 파서의 감폐(Deprecation) 및 KIS 이관 완료**
> 과거 직접 웹 크롤링 방식으로 구동되던 `krx_parser.ts` 및 레거시 `test_krx_parsers.ts`는 한국거래소 사이트의 스펙 변화 및 통신 안전성 한계로 인해 **완전히 제거/지원 중단**되었습니다.
> 현재 모든 시장 연동은 공식 OpenAPI인 **`kis_parser.ts`** 기반으로 이관되었으며, 이에 맞추어 오프라인 테스트 하네스 또한 **`test_harness/test_krx_parsers.ts`**로 새롭게 교체(Integration)되었습니다.

---

## 3. Data Contracts & Type Schemas (AI 데이터 스키마 계약)

AI가 코드를 직접 들여다보지 않고도 데이터 인터페이스를 완벽히 파악할 수 있도록 설계된 핵심 타입 정의입니다.

### 3.1. API Response & Cache Schema (`globalCache`)
```typescript
interface GlobalCache {
  marketOverview: IndexPriceData[]; // 시장 지수 리스트
  canaryData: CanaryData | null;    // 자금동향, 신용융자, ADR, 신고가 통합
  fearGreed: FearGreedResponse | null; // 한/미 공포탐욕지수 및 히스토리
  investorFlow: {                   // 외국인 및 기관 수급
    foreignTop10: InvestorFlowData[];
    instTop10: InvestorFlowData[];
  } | null;
  lastUpdated: number;              // 캐시 갱신 시각 타임스탬프 (ms)
  error: string | null;             // 최근 에러 메시지
}
/*
 * - error 필드는 70초 수집 루프에서 예외 발생 시 해당 에러 메시지를 저장한다.
 * - 정상 수집 시에는 null로 초기화된다.
 * - REST API 응답 시 globalCache.error 값을 response body의 `error` 키로 노출한다.
 * - WebSocket 브로드캐스트 시에도 error 필드를 포함하여 전송한다.
 * - 클라이언트는 error가 null이 아닌 경우 마지막 정상 데이터를 유지하며 경고를 표시해야 한다.
 */
```

### 3.2. 핵심 서브 인터페이스
```typescript
// 1. 시장 지수 및 환율 데이터 포맷
export interface IndexPriceData {
  label: string;                  // "코스피", "코스닥", "코스피200", "원/달러"
  value: string;                  // 포맷팅된 현재가 (예: "2,642.50")
  change: string;                 // 전일대비 변동액 (예: "+12.30", "-5.40")
  changePercent: string;          // 전일대비 변동률 (예: "+0.47%", "-0.20%")
  direction: "up" | "down" | "flat";
}

// 2. 카나리아 통합 데이터 포맷
export interface CanaryData {
  funds: {
    date: string;                 // YYYYMMDD
    deposit: number;              // 고객예탁금 (원화 환산 완료, * 100,000,000)
    margin_loan: number;          // 신용융자잔고 (원화 환산 완료)
    misu: number;                 // 미수금 (원화 환산 완료)
  } | null;
  creditHistory: {                // 신용 융자 추이 (최근 20일)
    date: string;
    amount: number;
    ratio: number;                // 전일 대비 증감율 (%)
  }[];
  adrKospi: {                     // KOSPI ADR (adrinfo.kr 연계)
    adr: string;                  // ADR 수치 (예: "70.27")
    time: string;                 // 수집/업데이트 시각 (예: "2026-05-22 (15:30)")
    signal: "매도 검토 (과열)" | "바닥권 신호 (과매도)" | "중립" | "데이터 부족" | string;
  } | null;
  adrKosdaq: {                    // KOSDAQ ADR (adrinfo.kr 연계)
    adr: string;                  // ADR 수치 (예: "66.21")
    time: string;                 // 수집/업데이트 시각 (예: "2026-05-22 (15:30)")
    signal: "매도 검토 (과열)" | "바닥권 신호 (과매도)" | "중립" | "데이터 부족" | string;
  } | null;
  newHighCount: number;           // 52주 신고가 종목 수 합산 (코스피 + 코스닥)
}

// 3. 투자자별 순매수 데이터 포맷
export interface InvestorFlowData {
  rank: number;                   // 1 ~ 10
  code: string;                   // 종목 코드 (6자리)
  name: string;                   // 종목명
  price: number;                  // 현재가 (원)
  change: number;                 // 전일대비 변동액
  changePercent: number;          // 변동률
  volume: number;                 // 누적 거래량
  amount: number;                 // 순매수 대금 (원화 환산 완료, * 1,000,000)
}
```

---

## 4. Test Harness Engineering Strategy (테스트 하네스 설계 전략)

현재 수집 로직은 실제 한국투자증권(KIS) OpenAPI와 한국은행(ECOS) API의 실시간 호출에 크게 의존하고 있습니다. AI가 코드를 안전하게 검증하고 리팩토링할 수 있도록 **Mock Test Harness** 인프라를 구축해야 합니다.

### 4.1. Mock 서버 및 Harness 파일 제안 (`test_harness/mock_api_server.ts`)
실제 API 키 없이도 로컬에서 100% 동일한 응답을 흉내내는 독립적인 Mock API Server를 구축합니다.

```typescript
// [Proposed] test_harness/mock_api_server.ts
import express from 'express';

const app = express();
const PORT = 9090;

// 1. KIS OAuth 토큰 발급 Mock
app.post('/oauth2/tokenP', (req, res) => {
  res.json({
    access_token: "mocked_access_token_123456789",
    token_type: "Bearer",
    expires_in: 86400
  });
});

// 2. KIS 지수 데이터 Mock
app.get('/uapi/domestic-stock/v1/quotations/inquire-index-price', (req, res) => {
  const iscd = req.query.FID_INPUT_ISCD;
  res.json({
    rt_cd: "0",
    msg_cd: "MCA00000",
    msg1: "정상 처리되었습니다.",
    output: {
      bstp_nmix_prpr: iscd === "0001" ? "2650.15" : "850.32",
      bstp_nmix_prdy_vrss: "15.40",
      bstp_nmix_prdy_ctrt: "0.58",
      ascn_issu_cnt: "520",
      down_issu_cnt: "310",
    }
  });
});

// ECOS, Fear & Greed 등 Mock API 추가 정의 가능...

app.listen(PORT, () => {
  console.log(`🚀 Mock Financial API Server running on port ${PORT}`);
});
```

### 4.2. 통합 Harness 검증 스크립트 작동
- `test_harness/run_integration_tests.ts`: `dotenv`에 `KIS_BASE_URL=http://localhost:9090`을 설정한 뒤, `src/api/kis-market.ts`를 실행하여 캐시 갱신 및 파싱 성공 여부를 Assert 합니다.
- **이점:** API 속도 제한(Rate Limit)을 피하고, 주말/야간에도 로컬에서 즉시 코드 무결성 검증이 가능합니다.

---

## 5. AI Skill Engineering Spec (AI 스킬 정의 및 자동화)

AI가 시스템 제어, 빌드 상태 검증, 테스트 실행을 context 소모 없이 원클릭으로 수행할 수 있도록 돕는 개별 스킬 가이드 라인입니다.

### 5.1. AI 스킬 목록 및 트리거
각 스킬의 실행 명령어 및 검증 기준은 `.skills/skill_*.md` 파일이 단일 정본입니다. 이 섹션에서는 스킬 목록과 트리거 키워드만 관리합니다.

| 스킬 파일명 | 대상 작업 (Trigger) | 핵심 역할 | 필요한 최소 파일 |
| :--- | :--- | :--- | :--- |
| [**`skill_build_check.md`**](./.skills/skill_build_check.md) | "빌드 체크", "컴파일 확인", "타입 에러 검증" | TS 코드를 안전하게 컴파일하고 타입 무결성을 확인합니다. | `package.json`, `tsconfig.json` |
| [**`skill_test_canary.md`**](./.skills/skill_test_canary.md) | "카나리아 테스트", "실시간 KIS 연동 확인", "ADR 산출 검증" | KIS/ECOS 실시간 API를 호출하여 시장 데이터 변환 흐름을 단독 검증합니다. | `src/test_canary.ts`, `.env` |
| [**`skill_mock_harness.md`**](./.skills/skill_mock_harness.md) | "모크 하네스 테스트", "오프라인 검증", "파서 목 테스트" | 네트워크나 API 키 없이 Mock 데이터를 활용해 KIS/ECOS 파서 기능의 정밀 작동을 테스트합니다. | `test_harness/test_krx_parsers.ts` |
| [**`skill_restart_dev.md`**](./.skills/skill_restart_dev.md) | "로컬 서버 기동", "백엔드 시작", "데브 서버 켜줘" | 필수 환경변수의 유효성(Pre-flight)을 선제 체크한 후 로컬 Express/WS API 서버를 안전하게 기동합니다. | `package.json`, `src/server.ts`, `.env` |

### 5.2. AI 전용 1-Line Context Injection 프롬프트
이후 대화 세션에서 AI의 기억력을 되살리고 Context Token 소모를 극도로 줄이기 위해, 아래 단 한 줄의 프롬프트만 주입하면 됩니다:
> *"`<PROJECT_ROOT>/workspace_profile.md`에 기록된 AI 시스템 사양과 데이터 스키마를 기준으로 작업할 것입니다. 이 구조와 의존성을 기억하고 다음 요청에 답변해주세요."*

---

## 6. System Redesign Proposals (시스템 리디자인 제안)

Context 소비를 원천적으로 절감하고 결합도(Coupling)를 낮추기 위한 단계별 서버 리디자인 계획입니다.

```
[AS-IS: server.ts에 복합적으로 얽혀 있는 구조]
- server.ts: [Express 라우팅] + [WebSocket 브로드캐스트] + [70초 수집 타이머] + [GlobalCache 저장소]
* 문제점: 파일이 크고 역할이 혼재되어 AI가 코드 수정 시 매번 250줄이 넘는 코드를 읽어야 함 (Context 낭비)

[TO-BE: 마이크로 분리 및 이벤트 기반 아키텍처]
1. src/core/cache.ts       -> In-memory Cache Singleton 관리
2. src/core/harvester.ts   -> 70초 주기 수집 루프 전담 (EventEmitter 상속)
3. src/api/routes.ts       -> Express API 엔드포인트 라우팅만 정의
4. src/ws/websocket.ts     -> WebSocket 브로드캐스트 로직 전담
5. src/server.ts           -> 엔트리 포인트 (인스턴스 조립 및 포트 리스닝 전용 - 30줄 이하로 축소)
```

### 리디자인 상세 로드맵
* **Phase 1: Collector(Harvester)와 HTTP/WS Server 분리 (관심사 분리)**
  - `src/api/harvester.ts`를 신설하여 `fetchAllMarketData` 함수와 70초 주기 타이머를 격리합니다.
  - Harvester가 데이터를 성공적으로 긁어오면 `harvester.emit('update', data)`를 호출합니다.
  - `server.ts`는 Harvester 이벤트를 리슨하여 GlobalCache를 업데이트하고 `ws` 브로드캐스트만 트리거합니다.
  - **효과:** AI가 수집 엔진만 손볼 때 Express/WS 코드를 컨텍스트에 담을 필요가 없어집니다. (Context 50% 이상 절감)
* **Phase 2: Types 모듈 통합**
  - `src/types/market.d.ts` 또는 `src/types/index.ts`를 생성하여 API 명세 및 파서 타입을 전역 집중 관리합니다.
  - **효과:** 파일 간 Import 관계가 간결해지고, 파서 내부의 중복된 타입 선언이 소멸합니다.
* **Phase 3: ECOS 및 FearGreed 모듈 독립적 파서 리디자인**
  - ECOS API 및 FearGreed API 통신 로직을 각각 `src/api/ecos.ts`, `src/api/feargreed.ts`로 완벽히 격리하고 통일성 있게 구조화합니다.
