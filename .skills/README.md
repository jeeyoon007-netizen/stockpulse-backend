# StockPulse Backend - AI Skill Engine

이 디렉토리는 AI가 `stockpulse-backend` 저장소에서 특정 작업(빌드, 테스트, 데이터 검증 등)을 지시받았을 때, **전체 소스코드나 문서를 스캔하지 않고 해당 파일만 로드하여 원클릭으로 안전하게 실행할 수 있도록 정의한 AI 전용 스킬 정의서**입니다.

## 🎯 AI 스킬 활용 가이드 (For Future AI Sessions)

사용자가 특정 명령(예: "빌드 확인해줘", "카나리아 수집 상태 점검해줘")을 내리면, AI는 다음 절차를 따릅니다:

1. **지문 검색 생략**: 전체 코드 검색(`grep`)이나 디렉토리 스캔을 생략하고, 즉시 `.skills/` 폴더에서 매칭되는 `skill_*.md` 파일을 찾아 [view_file]로 읽습니다.
2. **스킬 콘텍스트 격리**: 읽어들인 `skill_*.md` 파일에 정의된 **최소 요구 파일(Required Files)**과 **실행 명령어(Execution Command)**만 사용하여 수행합니다. 타 파일은 열지 않습니다.
3. **원클릭 실행 및 출력 검증**: 명령어 결과를 바탕으로 스킬 파일에 기재된 **검증 기준(Verification Criteria)**에 맞춰 사용자에게 성공/실패 여부를 간결하게 보고합니다.

---

## 📂 AI 스킬 목차 (Skills Index)

모든 링크는 프로젝트 루트 기준의 상대경로로 기술되어 이식성(Portability)을 보장합니다.

| 스킬 파일명 | 대상 작업 (Trigger) | 핵심 역할 | 필요한 최소 파일 |
| :--- | :--- | :--- | :--- |
| [**`skill_build_check.md`**](./skill_build_check.md) | "빌드 체크", "컴파일 확인", "타입 에러 검증" | TS 코드를 안전하게 컴파일하고 타입 무결성을 확인합니다. | `package.json`, `tsconfig.json` |
| [**`skill_test_canary.md`**](./skill_test_canary.md) | "카나리아 테스트", "실시간 KIS 연동 확인", "ADR 산출 검증" | KIS/ECOS 실시간 API를 호출하여 시장 데이터 변환 흐름을 단독 검증합니다. | `src/test_canary.ts`, `.env` |
| [**`skill_mock_harness.md`**](./skill_mock_harness.md) | "모크 하네스 테스트", "오프라인 검증", "파서 목 테스트" | 네트워크나 API 키 없이 Mock 데이터를 활용해 KIS/ECOS 파서 기능의 정밀 작동을 테스트합니다. | `test_harness/test_krx_parsers.ts` |
| [**`skill_restart_dev.md`**](./skill_restart_dev.md) | "로컬 서버 기동", "백엔드 시작", "데브 서버 켜줘" | 필수 환경변수의 유효성(Pre-flight)을 선제 체크한 후 로컬 Express/WS API 서버를 안전하게 기동합니다. | `package.json`, `src/server.ts`, `.env` |

---

## ⚡ Context-Reduction 프롬프트 규칙 (AI Rule)
> AI가 이 프로젝트에서 작업할 때, 사용자가 스킬 관련 명령을 내리면 **무조건 해당 `.skills/skill_*.md` 단일 파일만 읽은 상태에서 명령어 실행(run_command) 도구를 실행**해야 합니다.
