import { getAccessToken, KIS_BASE_URL, formatYYYYMMDD } from './kis.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let stockNameMap: Map<string, string> | null = null;

export function getStockName(code: string): string {
  if (!stockNameMap) {
    stockNameMap = new Map();
    try {
      const filePath = path.join(__dirname, 'stocks.json');
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const stocks = JSON.parse(fileContent);
        if (Array.isArray(stocks)) {
          for (const s of stocks) {
            if (s.code && s.name) {
              stockNameMap.set(s.code, s.name);
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to load stocks.json in backend name resolver:", err);
    }
  }
  return stockNameMap.get(code) || "검색된 종목";
}

export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisError";
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
 * 무결성 검증 로직 포함: 거래량/가격이 0이거나 누락된 경우 즉시 에러 발생.
 * 240영업일 확보를 위해 연속 조회(Pagination)를 시도합니다.
 */
export async function fetchStockOHLCV(code: string, daysRequired = 240): Promise<StockData> {
  const token = await getAccessToken();
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 18);

  const startStr = formatYYYYMMDD(startDate);
  const endStr = formatYYYYMMDD(endDate);

  let ohlcvList: OHLCV[] = [];
  let isNext = false;
  let trCont = ""; 

  const searchParams = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: "J",
    FID_INPUT_ISCD: code,
    FID_INPUT_DATE_1: startStr,
    FID_INPUT_DATE_2: endStr,
    FID_PERIOD_DIV_CODE: "D",
    FID_ORG_ADJ_PRC: "1", // 1: 수정주가
  });

  while (ohlcvList.length < daysRequired) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: "FHKST03010100", // 국내주식 기간별 시세
    };

    if (isNext && trCont) {
      headers["tr_cont"] = "N";
    }

    const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?${searchParams.toString()}`;

    const res = await fetch(url, { headers, cache: "no-store" } as RequestInit);
    if (!res.ok) {
      throw new AnalysisError(`주가 조회 실패: ${res.status}`);
    }

    const data = await res.json();
    if (data.rt_cd !== "0") {
      throw new AnalysisError(`API 응답 에러: ${data.msg1}`);
    }

    const dailyData = data.output2;
    if (!dailyData || !Array.isArray(dailyData) || dailyData.length === 0) {
      break;
    }

    for (const item of dailyData) {
      if (!item.stck_bsop_date) continue;

      const open = Number(item.stck_oprc);
      const high = Number(item.stck_hgpr);
      const low = Number(item.stck_lwpr);
      const close = Number(item.stck_clpr);
      const volume = Number(item.acml_vol);

      if (close === 0 || isNaN(close)) {
        throw new AnalysisError(`데이터 무결성 오류: 종목 ${code}의 ${item.stck_bsop_date}일자 종가가 0입니다.`);
      }
      if (volume === 0 || isNaN(volume)) {
        throw new AnalysisError(`데이터 무결성 오류: 종목 ${code}의 ${item.stck_bsop_date}일자 거래량이 0입니다. 거래정지 종목이거나 데이터 누락일 수 있습니다.`);
      }

      ohlcvList.push({
        date: item.stck_bsop_date,
        open,
        high,
        low,
        close,
        volume,
      });

      if (ohlcvList.length >= daysRequired) break;
    }

    const trContNext = res.headers.get("tr_cont");
    if (trContNext === "D" || trContNext === "M") {
      break;
    }
    
    const oldestDateStr = ohlcvList[ohlcvList.length - 1].date;
    const oldYear = parseInt(oldestDateStr.slice(0, 4));
    const oldMonth = parseInt(oldestDateStr.slice(4, 6)) - 1;
    const oldDay = parseInt(oldestDateStr.slice(6, 8));

    const prevDate = new Date(oldYear, oldMonth, oldDay);
    prevDate.setDate(prevDate.getDate() - 1);

    searchParams.set("FID_INPUT_DATE_2", formatYYYYMMDD(prevDate));
    isNext = true;
  }

  if (ohlcvList.length < 60) {
    throw new AnalysisError(`데이터 부족: 최소 60일의 데이터가 필요하나 ${ohlcvList.length}일치만 수집되었습니다.`);
  }

  ohlcvList.reverse();

  const currentPrice = ohlcvList[ohlcvList.length - 1].close;
  const prevPrice = ohlcvList[ohlcvList.length - 2]?.close || currentPrice;
  const change = currentPrice - prevPrice;
  const changePercent = (change / prevPrice) * 100;

  return {
    code,
    name: getStockName(code),
    currentPrice,
    change,
    changePercent: parseFloat(changePercent.toFixed(2)),
    ohlcv: ohlcvList,
  };
}
