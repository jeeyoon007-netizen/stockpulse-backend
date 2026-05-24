# AI Skill: Mock Parser & Harness Test (모크 데이터 기반 하네스 검증)

이 스킬은 외부 API 실시간 호출에 의존하지 않고, 미리 정의된 모크 데이터를 활용해 한국투자증권(KIS) 및 한국은행(ECOS) 시장 지표 파서가 정상 응답을 완벽히 매핑하는지 오프라인 검증합니다. 인터넷 연결 상태나 토큰 한도를 우려할 필요가 없습니다.

---

## 1. Trigger Words (트리거 검색어)
- "하네스 테스트", "파서 테스트 해줘", "오프라인 검증", "test_krx_parsers"

---

## 2. Minimal Required Context (최소 요구 콘텍스트)
- **테스트 타겟**: `<PROJECT_ROOT>/test_harness/test_krx_parsers.ts`
- *주의: 실시간 API 연동 코드나 서버 구동 모듈을 들여다볼 필요가 없습니다.*

---

## 3. Execution Commands (실행 명령어)
프로젝트 루트 디렉토리(`<PROJECT_ROOT>`)에서 아래 명령어를 수행합니다.

```powershell
# 1. TypeScript Execution Engine(tsx)을 사용하여 모크 파서 검증 실행
npx tsx test_harness/test_krx_parsers.ts
```

---

## 4. Output Verification Criteria (출력 검증 기준)

### ✅ 성공 판단 기준
터미널 로그 결과에 **[PASS]** 표시가 정확히 21개 검출되고, 최하단 요약 메시지가 다음과 같아야 합니다:
- `=== [END] Tests Run Summary: 21 Passed, 0 Failed ===`
- 빌드 프로세스가 `exit code 0`으로 무결하게 리턴될 때.

### ❌ 실패 판단 기준
- 로그에 하나라도 **[FAIL]** 표시가 나오거나, 요약본에 `Failed` 숫자가 1 이상 적힌 경우.
- `Cannot find module ...` 등 NodeNext 모듈 해석 실패로 비정상 조기 종료(exit code 1)되는 경우.
- **조치 사항**: 파서 데이터의 필드 타입이나 유닛 변환 공식(배율 곱셈) 수정 중 깨진 로직이 있는지 `src/api/parsers/kis_parser.ts` 파일의 수식을 추적 점검하십시오.
