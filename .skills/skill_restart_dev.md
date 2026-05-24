# AI Skill: Restart & Run Dev Server (로컬 개발 서버 기동)

이 스킬은 소스코드(API, 파서 등) 변경 후 메인 웹 서버 및 웹소켓(ws) 엔드포인트를 로컬에서 무결하게 빌드하고 안전하게 재부팅할 때 사용합니다. 구동 전 필수 환경변수가 존재하는지 미리 점검하는 Pre-flight 단계를 선행 수행합니다.

---

## 1. Trigger Words (트리거 검색어)
- "서버 켜줘", "개발 서버 기동", "백엔드 시작", "npm run dev", "서버 띄워줘"

---

## 2. Minimal Required Context (최소 요구 콘텍스트)
- **환경 변수**: `<PROJECT_ROOT>/.env` (포트 및 연동 키 점검)
- **설정 파일**: `<PROJECT_ROOT>/package.json`
- **진입 파일**: `<PROJECT_ROOT>/src/server.ts`

---

## 3. Execution Commands (실행 명령어)
프로젝트 루트 디렉토리(`<PROJECT_ROOT>`)에서 아래 명령어를 순차적으로 실행하십시오.

```powershell
# 0. 필수 환경변수 존재 여부 사전 확인
node -e "
  require('dotenv').config();
  const required = ['KIS_APP_KEY', 'KIS_APP_SECRET', 'BOK_API_KEY', 'PORT'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error('[PRE-FLIGHT FAIL] 누락된 환경변수:', missing.join(', '));
    process.exit(1);
  }
  console.log('[PRE-FLIGHT PASS] 환경변수 확인 완료');
"

# [주의] 위 pre-flight 단계가 [PRE-FLIGHT FAIL]로 종료되면 아래 단계를 수행하지 않습니다.
# 1. 의존성 패키지 존재 확인 및 미설치 라이브러리 보완
npm install --if-present

# 2. tsx(TypeScript Execute)를 이용해 핫리로딩 개발 서버 기동
npm run dev
```

---

## 4. Output Verification Criteria (출력 검증 기준)

### ✅ 성공 판단 기준
- Pre-flight 검사에서 `[PRE-FLIGHT PASS] 환경변수 확인 완료` 메시지가 보이고 빌드가 지속될 때.
- 터미널에 `🚀 StockPulse API Server running on port 8080` 메시지가 정상 출력될 때.
- `Health: http://localhost:8080/health` 및 `WebSocket: ws://localhost:8080` 활성화 상태 확인 시.
- 백그라운드 스케줄러가 최초 실행되어 `[FETCH] ========== 데이터 수집 시작 ==========` 로그가 발생하고 에러 없이 끝날 때.

### ❌ 실패 판단 기준
- Pre-flight 검사에서 `[PRE-FLIGHT FAIL] 누락된 환경변수:...` 메시지가 뜨며 즉각 종료될 때 (환경 변수 파일 생성 또는 입력 누락).
- `EADDRINUSE: address already in use :::8080` 에러가 발생하는 경우 (기존에 켜져 있는 Node.js 서버 프로세스가 8080 포트를 점유하고 있음).
  - **조치 사항**: 포트 충돌 시 기존 포트 프로세스를 종료(Kill)하거나 `PORT=8081` 등 다른 포트로 전환할 수 있도록 환경 변수를 임시 수정하여 재기동합니다.
