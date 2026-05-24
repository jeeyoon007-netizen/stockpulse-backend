# AI Skill: Build & Type Safety Validator (빌드체크 및 타입 안전성 검증)

이 스킬은 백엔드 소스코드 변경 이후 TypeScript 컴파일 및 문법적 오류가 없는지 독립적으로 신속하게 판단할 때 사용합니다. 다른 소스코드를 읽을 필요 없이 본 가이드의 명령어만 수행하십시오.

---

## 1. Trigger Words (트리거 검색어)
- "빌드 체크", "빌드 해봐", "컴파일 에러 확인해줘", "TS 검증", "npm run build"

---

## 2. Minimal Required Context (최소 요구 콘텍스트)
- **설정 파일**: `<PROJECT_ROOT>/package.json`, `<PROJECT_ROOT>/tsconfig.json`
- *주의: 개별 `src/*.ts` 파일은 읽을 필요가 전혀 없습니다.*

---

## 3. Execution Commands (실행 명령어)
프로젝트 루트 디렉토리(`<PROJECT_ROOT>`)에서 아래 명령어를 순차적으로 실행하십시오.

```powershell
# 1. 이전 빌드 산출물 제거 및 깨끗한 타입 빌드 수행
npm run build
```

---

## 4. Output Verification Criteria (출력 검증 기준)

### ✅ 성공 판단 기준
- 터미널 출력에 아무런 에러 메시지(또는 에러 코드)가 없고, 빌드 프로세스가 `exit code 0`으로 종료되었을 때.
- `<PROJECT_ROOT>/dist` 디렉토리에 `.js` 및 `.d.ts` 파일들이 생성되었을 때.

### ❌ 실패 판단 기준
- `error TSXXXX: ...` 형태의 TypeScript 컴파일 컴파일러 에러가 발견되는 경우.
- 빌드 에러 출력 시, 실패한 구체적 파일명과 라인 번호(예: `src/server.ts:145:10 - error TS...`)만 추출하여 사용자에게 출력하고 작업을 멈춤.

---

## 5. Troubleshooting (장애 해결 지침)
- **`tsc` 명령어를 찾을 수 없다고 하는 경우**: `npm install`을 수행하여 패키지를 재설치합니다.
- **모듈 해석 오류 (`Cannot find module ...` 또는 `.js` import 관련)**: `tsconfig.json` 파일의 `moduleResolution`이 `NodeNext`로 잡혀 있으므로, `import` 구문에 반드시 `.js` 확장자가 적혀 있는지 실패한 코드 라인을 찾아 검사하십시오. (예: `import { x } from './y.js'`)
