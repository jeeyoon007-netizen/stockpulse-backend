/**
 * KRX Market Capitalization Fetcher
 *
 * KRX 정보데이터시스템(data.krx.or.kr)의 공식 OPEN API 또는 공개 JSON 엔드포인트에서
 * "전종목 시세"를 시장별(STK/stk=KOSPI, KSQ/ksq=KOSDAQ)로 받아
 * 각 종목 시가총액(MKTCAP)을 합산하여 시장 전체 시가총액을 계산합니다.
 *
 * [수집 파이프라인 아키텍처]
 * - 1단계: 시스템 환경변수 `KRX_API_KEY`를 활용해 공식 OPEN API 테스트 서버(`https://data-dbg.krx.co.kr/svc/apis/sto/`) 호출 시도.
 * - 2단계: 공식 API 미승인(401) 또는 장애 발생 시, 공개 웹 JSON 엔드포인트에서 크롤링 백업 작동.
 * - 3단계: 모든 수단 실패 시, 서버 안정성을 위해 추정 상수(Estimated Fallback)로 평화로운 우회 기동.
 *
 * 반환 단위: KRW(원)
 */

import { todayKST, shiftYYYYMMDD } from './datetime.js';

const KRX_JSON_URL = 'http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';
const KRX_REFERER =
  'http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020101';
const KRX_BLD = 'dbms/MDC/STAT/standard/MDCSTAT01501';

// 실데이터 수집 실패 시 마지막 폴백(대략치). KOSPI ~2300조 / KOSDAQ ~400조.
const FALLBACK = { kospi: 2300_0000_0000_0000, kosdaq: 400_0000_0000_0000 };

export interface MarketCapResult {
  kospi: number;       // KOSPI 전체 시가총액 (원)
  kosdaq: number;      // KOSDAQ 전체 시가총액 (원)
  asOf?: string;       // 기준 영업일 (YYYYMMDD). 실데이터일 때만 채워짐
  estimated?: boolean; // true면 실데이터 수집 실패로 폴백 상수를 사용한 것
}

/** 콤마 포함 숫자 문자열("1,234,567") → number. 실패 시 NaN. */
function parseKRXNumber(raw: unknown): number {
  if (raw === null || raw === undefined) return NaN;
  return Number(String(raw).replace(/,/g, '').trim());
}

/** 
 * [1단계] KRX 공식 OPEN API(data-dbg.krx.co.kr)를 활용한 시가총액 합산 연산
 */
async function fetchMktCapViaOpenAPI(mkt: 'stk' | 'ksq', basDd: string): Promise<number | null> {
  const apiKey = process.env.KRX_API_KEY;
  if (!apiKey) return null;

  const url = `https://data-dbg.krx.co.kr/svc/apis/sto/${mkt}_bydd_trd?basDd=${basDd}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'AUTH_KEY': apiKey,
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!res.ok) {
    throw new Error(`KRX OPEN API HTTP ${res.status}`);
  }

  const data: any = await res.json();
  
  if (data.respCode && data.respCode !== '200') {
    throw new Error(`API ${data.respCode} - ${data.respMsg}`);
  }

  const rows = data?.OutBlock_1 ?? data?.output ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return null; // 비영업일
  }

  let sum = 0;
  let counted = 0;
  for (const r of rows) {
    const v = parseKRXNumber(r?.MKTCAP);
    if (Number.isFinite(v) && v > 0) {
      sum += v;
      counted++;
    }
  }

  if (counted < 100 || sum <= 0) {
    throw new Error(`OPEN API 데이터 불완전: counted=${counted}, sum=${sum}`);
  }

  return sum;
}

/**
 * [2단계] 일반 웹 JSON 크롤링 엔드포인트를 활용한 특정 영업일(trdDd) 시가총액 합산 연산
 */
/**
 * [2단계] 일반 웹 JSON 크롤링 엔드포인트를 활용한 특정 영업일(trdDd) 시가총액 합산 연산
 */
let cachedCookies: string | null = null;
let cookieExpiry = 0;

async function loginToKRX(): Promise<string | null> {
  const krxId = process.env.KRX_ID;
  const krxPw = process.env.KRX_PW;
  if (!krxId || !krxPw) {
    return null; // ID/PW가 없으면 로그인 생략
  }

  // 캐시된 쿠키 유효성 검사 (2시간 유효)
  if (cachedCookies && Date.now() < cookieExpiry) {
    return cachedCookies;
  }

  try {
    console.log('[KRX SESSION] KRX_ID/KRX_PW 환경변수를 감지하여 세션 로그인 시도중...');
    const portalUrl = 'https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020101';
    const loginUrl = 'https://data.krx.co.kr/contents/MDC/COMS/client/MDCCOMS001D1.cmd';

    // 1. Initial portal visit to grab baseline JSESSIONID and __smVisitorID
    const initRes = await fetch(portalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    });

    const initCookies = initRes.headers.getSetCookie();
    let jsessionId = '';
    let visitorId = '';
    for (const cStr of initCookies) {
      const firstPart = cStr.split(';')[0];
      const [key, value] = firstPart.split('=');
      if (key.trim() === 'JSESSIONID') jsessionId = value.trim();
      else if (key.trim() === '__smVisitorID') visitorId = value.trim();
    }

    let cookieHeader = `JSESSIONID=${jsessionId}${visitorId ? '; __smVisitorID=' + visitorId : ''}`;

    // 2. Perform authentication POST request to MDCCOMS001D1.cmd
    const loginBody = new URLSearchParams({
      mbrId: krxId,
      pw: krxPw,
      certType: '',
      mbrNm: '',
      telNo: '',
      di: '',
      skipDup: 'Y'
    });

    const loginRes = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Origin': 'https://data.krx.co.kr',
        'Referer': portalUrl,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookieHeader
      },
      body: loginBody.toString()
    });

    const loginText = await loginRes.text();
    if (loginText.includes('CD003') || loginText.includes('서비스 에러')) {
      throw new Error('KRX 로그인 서비스 에러');
    }

    // 로그인 성공 후 업데이트된 쿠키 캡처
    const loginCookies = loginRes.headers.getSetCookie();
    for (const cStr of loginCookies) {
      const firstPart = cStr.split(';')[0];
      const [key, value] = firstPart.split('=');
      if (key.trim() === 'JSESSIONID') jsessionId = value.trim();
    }

    cookieHeader = `JSESSIONID=${jsessionId}${visitorId ? '; __smVisitorID=' + visitorId : ''}`;
    
    cachedCookies = cookieHeader;
    cookieExpiry = Date.now() + 2 * 60 * 60 * 1000;
    console.log('[KRX SESSION] 로그인 세션 확보 성공!');
    return cookieHeader;
  } catch (err: any) {
    console.error('[KRX SESSION] 로그인 실패:', err.message);
    return null;
  }
}

async function fetchMktCapForDate(
  mktId: 'STK' | 'KSQ',
  trdDd: string,
  cookieHeader: string | null = null
): Promise<number | null> {
  const body = new URLSearchParams({
    bld: KRX_BLD,
    mktId,
    trdDd,
    share: '1', // 주식수 단위: 주
    money: '1', // 금액 단위: 원
    csvxls_isNo: 'false',
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Referer: KRX_REFERER,
  };

  if (cookieHeader) {
    headers['Cookie'] = cookieHeader;
  }

  const res = await fetch(KRX_JSON_URL, {
    method: 'POST',
    headers,
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`KRX HTTP ${res.status}`);
  }

  const data: any = await res.json();
  const rows: any[] = data?.OutBlock_1 ?? data?.output ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return null; // 비영업일이거나 데이터 미게시
  }

  let sum = 0;
  let counted = 0;
  for (const r of rows) {
    const v = parseKRXNumber(r?.MKTCAP);
    if (Number.isFinite(v) && v > 0) {
      sum += v;
      counted++;
    }
  }

  if (counted < 100 || sum <= 0) {
    throw new Error(`KRX 응답 비정상: counted=${counted}, sum=${sum}`);
  }
  return sum;
}

/**
 * KOSPI/KOSDAQ 전체 시가총액을 실제로 조회합니다.
 * 다계층 구조: 공식 OPEN API 시도 → 실패 시 크롤링 폴백 → 최종 실패 시 추정치 우회
 */
export async function fetchMarketCap(maxLookback = 7): Promise<MarketCapResult> {
  let trdDd = todayKST();

  // 1단계: 공식 OPEN API 시도 (환경변수 키가 설정되어 있을 때만)
  if (process.env.KRX_API_KEY) {
    for (let attempt = 0; attempt <= maxLookback; attempt++) {
      try {
        const [kospi, kosdaq] = await Promise.all([
          fetchMktCapViaOpenAPI('stk', trdDd),
          fetchMktCapViaOpenAPI('ksq', trdDd),
        ]);

        if (kospi !== null && kosdaq !== null) {
          console.log(`[KRX MKTCAP] 공식 OPEN API 기준 수집 완료: asOf=${trdDd}`);
          return { kospi, kosdaq, asOf: trdDd, estimated: false };
        }
      } catch (err) {
        console.warn(
          `[KRX MKTCAP] 공식 OPEN API ${trdDd} 조회 불가 (시도 ${attempt + 1}):`,
          (err as Error)?.message,
        );
      }
      trdDd = shiftYYYYMMDD(trdDd, -1);
    }
  }

  // 2단계: 일반 크롤링 폴백
  trdDd = todayKST();
  const cookieHeader = await loginToKRX();

  for (let attempt = 0; attempt <= maxLookback; attempt++) {
    try {
      const [kospi, kosdaq] = await Promise.all([
        fetchMktCapForDate('STK', trdDd, cookieHeader),
        fetchMktCapForDate('KSQ', trdDd, cookieHeader),
      ]);

      if (kospi !== null && kosdaq !== null) {
        console.log(`[KRX MKTCAP] 일반 크롤링 기준 수집 완료: asOf=${trdDd}`);
        return { kospi, kosdaq, asOf: trdDd, estimated: false };
      }
    } catch (err) {
      console.error(
        `[KRX MKTCAP] 일반 크롤링 ${trdDd} 조회 실패(시도 ${attempt + 1}):`,
        (err as Error)?.message,
      );
    }
    trdDd = shiftYYYYMMDD(trdDd, -1);
  }

  console.warn(
    '[KRX MKTCAP] 모든 수단 실데이터 수집 실패 → 추정 상수로 폴백(estimated=true).',
  );
  return { ...FALLBACK, estimated: true };
}

