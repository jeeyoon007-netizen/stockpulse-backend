import { getAccessToken, KIS_BASE_URL } from './kis.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** KST(Asia/Seoul) 기준 오늘 날짜를 YYYYMMDD로 반환. 서버 타임존(UTC 등)에 영향받지 않음. */
function todayKST(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/** YYYYMMDD 문자열에 일수를 더하거나 뺀다. UTC 기준으로만 계산하여 타임존 무관. */
function shiftYYYYMMDD(yyyymmdd: string, deltaDays: number): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6)) - 1;
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

let stockNameMap: Map<string, string> | null = null;

export function getStockName(code: string): string {
  if (!stockNameMap) {
    const map = new Map<string, string>();
    let loaded = false;
    try {
      // 1. __dirname/stocks.json (로컬 dev tsx 환경)
      let filePath = path.join(__dirname, 'stocks.json');

      // 2. process.cwd()/src/api/stocks.json (Render 배포 또는 로컬 tsc 실행 환경)
      if (!fs.existsSync(filePath)) {
        filePath = path.join(process.cwd(), 'src', 'api', 'stocks.json');
      }

      // 3. process.cwd()/dist/api/stocks.json
      if (!fs.existsSync(filePath)) {
        filePath = path.join(process.cwd(), 'dist', 'api', 'stocks.json');
      }

      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const stocks = JSON.parse(fileContent);
        if (Array.isArray(stocks)) {
          for (const s of stocks) {
            if (s.code && s.name) {
              map.set(s.code, s.name);
            }
          }
          loaded = true;
        }
      } else {
        console.error('stocks.json을 찾지 못했습니다. (탐색 경로 모두 실패)');
      }
    } catch (err) {
      console.error('Failed to load stocks.json in backend name resolver:', err);
    }

    // 로드에 성공한 경우에만 캐싱한다.
    // 실패 시 stockNameMap을 null로 두어 다음 호출에서 재시도하게 함.
    if (loaded) {
      stockNameMap = map;
    } else {
      return map.get(code) || '검색된 종목';
    }
  }
  return stockNameMap.get(code) || '검색된 종목';
}

export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisError';
  }
}

export interface OHLCV {
  date: string;       // YYYYMMDD
  open: number;       // 시가
  high: number;       // 고가
  low: number;        // 저가
  close: number;      // 종가
  volume: number;     // 누적 거래량
}

export interface StockData {
  code: string;
  name: string;
  currentPrice: number;
  change: number;
  changePercent: number;
  ohlcv: OHLCV[];     // [과거...최신] 순서
}

/**
 * 지정된 종목의 일봉(OHLCV) 데이터를 가져옵니다.
 * - 무결성 검증: 종가 0/NaN 또는 거래량 0/NaN인 행은 "치명적 오류"로 보지 않고
 *   해당 행만 건너뜁니다(거래정지·특수세션 등 정상적으로 발생 가능한 상태).
 *   최종 수집량이 부족(<60일)할 때만 AnalysisError를 던집니다.
 * - 240영업일 확보를 위해 날짜범위 기반 연속 조회(Pagination)를 수행합니다.
 */
export async function fetchStockOHLCV(code: string, daysRequired = 240): Promise<StockData> {
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new AnalysisError('KIS_APP_KEY / KIS_APP_SECRET 환경변수가 설정되지 않았습니다.');
  }

  const token = await getAccessToken();

  // KST 기준 기간 계산 (서버가 UTC여도 하루 밀리지 않도록)
  const endStr = todayKST();
  const startStr = shiftYYYYMMDD(endStr, -550); // 약 18개월

  const ohlcvList: OHLCV[] = [];
  const seenDates = new Set<string>(); // 페이지 경계 중복 방지

  const searchParams = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: code,
    FID_INPUT_DATE_1: startStr,
    FID_INPUT_DATE_2: endStr,
    FID_PERIOD_DIV_CODE: 'D',
    FID_ORG_ADJ_PRC: '0', // 0: 수정주가, 1: 원주가
  });

  let cursorEnd = endStr; // 이번 페이지의 조회 종료일(점점 과거로 이동)
  let prevOldest = '';    // 진척 없음(무한루프) 감지용
  let firstPage = true;

  while (ohlcvList.length < daysRequired) {
    if (!firstPage) {
      await sleep(120); // KIS 레이트리밋 완화 (페이지 사이 지연)
    }
    firstPage = false;

    searchParams.set('FID_INPUT_DATE_2', cursorEnd);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: 'FHKST03010100', // 국내주식 기간별 시세
    };

    const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?${searchParams.toString()}`;

    // 응답 무한 대기 방지를 위한 타임아웃
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let data: any;
    try {
      const res = await fetch(url, {
        headers,
        cache: 'no-store',
        signal: controller.signal,
      } as RequestInit);
      if (!res.ok) {
        throw new AnalysisError(`주가 조회 실패: ${res.status}`);
      }
      data = await res.json();
    } catch (err) {
      if (err instanceof AnalysisError) throw err;
      if ((err as Error)?.name === 'AbortError') {
        throw new AnalysisError('주가 조회 타임아웃(10초 초과).');
      }
      throw new AnalysisError(`주가 조회 중 네트워크 오류: ${(err as Error)?.message}`);
    } finally {
      clearTimeout(timeout);
    }

    if (data.rt_cd !== '0') {
      throw new AnalysisError(`API 응답 에러: ${data.msg1}`);
    }

    const dailyData = data.output2;
    if (!dailyData || !Array.isArray(dailyData) || dailyData.length === 0) {
      break;
    }

    for (const item of dailyData) {
      if (!item.stck_bsop_date) continue;
      const date = String(item.stck_bsop_date);
      if (seenDates.has(date)) continue; // 중복 일봉 스킵

      const open = Number(item.stck_oprc);
      const high = Number(item.stck_hgpr);
      const low = Number(item.stck_lwpr);
      const close = Number(item.stck_clpr);
      const volume = Number(item.acml_vol);

      // 종가 0/NaN: 명백히 무효한 행 → 중단하지 않고 스킵
      if (close === 0 || isNaN(close)) {
        console.warn(`[${code}] ${date} 종가 무효(0/NaN) → 스킵`);
        continue;
      }
      // 거래량 0/NaN: 거래정지·특수세션 등 정상적으로 발생 가능 → 중단하지 않고 스킵
      if (volume === 0 || isNaN(volume)) {
        console.warn(`[${code}] ${date} 거래량 0(거래정지 가능) → 스킵`);
        continue;
      }

      seenDates.add(date);
      ohlcvList.push({ date, open, high, low, close, volume });

      if (ohlcvList.length >= daysRequired) break;
    }

    if (ohlcvList.length >= daysRequired) break;

    // 다음 페이지 커서 계산 (가장 과거 일자의 하루 전)
    if (ohlcvList.length === 0) break; // 유효 데이터가 전혀 없으면 종료
    const oldest = ohlcvList[ohlcvList.length - 1].date;

    if (oldest <= startStr) break;        // 조회 시작일 도달 → 종료
    if (oldest === prevOldest) break;      // 진척 없음 → 무한루프 방지
    prevOldest = oldest;

    cursorEnd = shiftYYYYMMDD(oldest, -1);
  }

  if (ohlcvList.length < 60) {
    throw new AnalysisError(`데이터 부족: 최소 60일의 데이터가 필요하나 ${ohlcvList.length}일치만 수집되었습니다.`);
  }

  ohlcvList.reverse(); // [과거...최신] 순서로 정렬

  const currentPrice = ohlcvList[ohlcvList.length - 1].close;
  const prevPrice = ohlcvList[ohlcvList.length - 2]?.close || currentPrice;
  const change = currentPrice - prevPrice;
  const changePercent = prevPrice ? (change / prevPrice) * 100 : 0;

  return {
    code,
    name: getStockName(code),
    currentPrice,
    change,
    changePercent: parseFloat(changePercent.toFixed(2)),
    ohlcv: ohlcvList,
  };
}
