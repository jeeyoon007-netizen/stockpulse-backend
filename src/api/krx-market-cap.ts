/**
 * KRX Market Capitalization Fetcher
 *
 * KRX 정보데이터시스템(data.krx.or.kr)의 공개 JSON 엔드포인트에서
 * "전종목 시세"(MDCSTAT01501)를 시장별(STK=KOSPI, KSQ=KOSDAQ)로 받아
 * 각 종목 시가총액(MKTCAP)을 합산하여 시장 전체 시가총액을 계산합니다.
 *
 * - 별도 API 키가 필요 없습니다(공개 조회 엔드포인트).
 * - 주말/공휴일이면 응답이 비어 있으므로 영업일을 찾을 때까지 하루씩 거슬러 재시도합니다.
 * - 네트워크/형식 오류 시에는 추정 상수로 폴백하되 estimated=true로 표시합니다.
 *
 * 반환 단위: KRW(원)
 */

import { todayKST, shiftYYYYMMDD } from './datetime.js';

const KRX_JSON_URL = 'http://data.krx.or.kr/comm/bldAttendant/getJsonData.cmd';
const KRX_REFERER =
  'http://data.krx.or.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020101';
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
 * 특정 영업일(trdDd)의 시장별 전체 시가총액 합계를 조회.
 * 응답이 비어 있으면(=비영업일/데이터 없음) null 반환.
 */
async function fetchMktCapForDate(
  mktId: 'STK' | 'KSQ',
  trdDd: string,
): Promise<number | null> {
  const body = new URLSearchParams({
    bld: KRX_BLD,
    mktId,
    trdDd,
    share: '1', // 주식수 단위: 주
    money: '1', // 금액 단위: 원
    csvxls_isNo: 'false',
  });

  const res = await fetch(KRX_JSON_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: KRX_REFERER,
    },
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

  // 유효 종목이 비정상적으로 적으면 신뢰하지 않음(형식 변경 등)
  if (counted < 100 || sum <= 0) {
    throw new Error(`KRX 응답 비정상: counted=${counted}, sum=${sum}`);
  }
  return sum;
}

/**
 * KOSPI/KOSDAQ 전체 시가총액을 실제로 조회합니다.
 * 가장 최근 영업일을 찾을 때까지 최대 maxLookback일 거슬러 재시도합니다.
 * 모든 시도가 실패하면 추정 상수로 폴백(estimated=true)합니다.
 */
export async function fetchMarketCap(maxLookback = 7): Promise<MarketCapResult> {
  let trdDd = todayKST();

  for (let attempt = 0; attempt <= maxLookback; attempt++) {
    try {
      const [kospi, kosdaq] = await Promise.all([
        fetchMktCapForDate('STK', trdDd),
        fetchMktCapForDate('KSQ', trdDd),
      ]);

      // 두 시장 모두 데이터가 있어야 해당 영업일로 확정
      if (kospi !== null && kosdaq !== null) {
        return { kospi, kosdaq, asOf: trdDd, estimated: false };
      }
    } catch (err) {
      console.error(
        `[KRX MKTCAP] ${trdDd} 조회 실패(시도 ${attempt + 1}):`,
        (err as Error)?.message,
      );
    }
    // 직전 영업일로 한 칸 뒤로
    trdDd = shiftYYYYMMDD(trdDd, -1);
  }

  console.warn(
    '[KRX MKTCAP] 실데이터 수집 실패 → 추정 상수로 폴백(estimated=true).',
  );
  return { ...FALLBACK, estimated: true };
}
