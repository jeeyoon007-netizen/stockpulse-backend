/**
 * KIS 시장 데이터 수집 모듈 (Render 백엔드 전용)
 * - Next.js "server-only", "cache: no-store" 등 제거
 * - 순수 Node.js fetch 기반으로 변환
 */
import { getAccessToken, KIS_BASE_URL, formatYYYYMMDD } from './kis.js';
import {
  parseMajorIndex,
  parseMajorIndexLatest,
  parseExchangeRate,
  parseCanaryCombined,
  parseInvestorRanking,
  parseStockDetail
} from './parsers/kis_parser.js';
// --- 타임아웃 fetch ---
async function fetchWithTimeout(url: string, options: RequestInit, timeout = 5000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// --- Interfaces ---

export interface ADRMarketData {
  adr: string;
  time: string;
  signal: string;
}

export interface ADRCombinedData {
  kospi: ADRMarketData | null;
  kosdaq: ADRMarketData | null;
}

export interface MarketFundsData {
  date: string;
  deposit: number;
  margin_loan: number;
  misu: number;
}

export interface CreditBalanceData {
  date: string;
  amount: number;
  ratio: number;
}

export interface InvestorFlowData {
  rank: number;
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
}

export interface IndexPriceData {
  label: string;
  value: string;
  change: string;
  changePercent: string;
  direction: "up" | "down" | "flat";
  advanceCount?: number;
  declineCount?: number;
}

// --- Functions ---

/**
 * 국내 주요 지수 (코스피, 코스닥, 코스피200)
 */
export async function fetchMajorIndex(code: string, label: string): Promise<IndexPriceData | null> {
  const token = await getAccessToken();
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  let result = await _fetchMajorIndexInternal(code, label, "U", token, appKey, appSecret);
  if (!result) {
    result = await _fetchMajorIndexInternal(code, label, "J", token, appKey, appSecret);
  }
  if (!result) {
    return fetchMajorIndexLatest(code, label);
  }
  return result;
}

async function _fetchMajorIndexInternal(
  code: string, label: string, market: string,
  token: string, appKey: string, appSecret: string
): Promise<IndexPriceData | null> {
  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-index-price?FID_COND_MRKT_DIV_CODE=${market}&FID_INPUT_ISCD=${code}`;
  const headers = {
    "Content-Type": "application/json",
    authorization: `Bearer ${token}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: "FHPUP02100000",
    custtype: "P",
  };

  try {
    const res = await fetchWithTimeout(url, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return parseMajorIndex(data, label);
  } catch {
    return null;
  }
}

async function fetchMajorIndexLatest(code: string, label: string): Promise<IndexPriceData | null> {
  const token = await getAccessToken();
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-indexprice?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=${code}&FID_PERIOD_DIV_CODE=D`;
  const headers = {
    "Content-Type": "application/json",
    authorization: `Bearer ${token}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: "FHPST01740000",
    custtype: "P",
  };

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return parseMajorIndexLatest(data, label);
  } catch {
    return null;
  }
}

/**
 * http://www.adrinfo.kr/ 에서 KOSPI/KOSDAQ 실시간 ADR 정보를 크롤링하여 파싱합니다.
 */
export async function fetchADRFromInfo(): Promise<ADRCombinedData> {
  const url = "http://www.adrinfo.kr/";
  const result: ADRCombinedData = { kospi: null, kosdaq: null };
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    
    // KOSPI 파싱
    const kospiBlockIndex = html.indexOf('<header>KOSPI</header>');
    if (kospiBlockIndex !== -1) {
      const kospiBlock = html.substring(kospiBlockIndex, kospiBlockIndex + 1000);
      const timeMatch = kospiBlock.match(/<small>\s*(\d{4}-\d{2}-\d{2}\s*\([^)]+\))\s*<\/small>/);
      const adrMatch = kospiBlock.match(/<h2 class="card-title">\s*([\d.]+)\s*<small>%<\/small>/);
      
      if (adrMatch && timeMatch) {
        const adrVal = parseFloat(adrMatch[1].trim());
        const signal = adrVal >= 120 ? "매도 검토 (과열)" : adrVal <= 80 ? "바닥권 신호 (과매도)" : "중립";
        result.kospi = {
          adr: adrMatch[1].trim(),
          time: timeMatch[1].trim(),
          signal
        };
      }
    }
    
    // KOSDAQ 파싱
    const kosdaqBlockIndex = html.indexOf('<header>KOSDAQ</header>');
    if (kosdaqBlockIndex !== -1) {
      const kosdaqBlock = html.substring(kosdaqBlockIndex, kosdaqBlockIndex + 1000);
      const timeMatch = kosdaqBlock.match(/<small>\s*(\d{4}-\d{2}-\d{2}\s*\([^)]+\))\s*<\/small>/);
      const adrMatch = kosdaqBlock.match(/<h2 class="card-title">\s*([\d.]+)\s*<small>%<\/small>/);
      
      if (adrMatch && timeMatch) {
        const adrVal = parseFloat(adrMatch[1].trim());
        const signal = adrVal >= 120 ? "매도 검토 (과열)" : adrVal <= 80 ? "바닥권 신호 (과매도)" : "중립";
        result.kosdaq = {
          adr: adrMatch[1].trim(),
          time: timeMatch[1].trim(),
          signal
        };
      }
    }
  } catch (error: any) {
    console.error("fetchADRFromInfo exception:", error.message);
  }
  
  return result;
}

/**
 * 원/달러 환율 (한국은행 ECOS API)
 */
export async function fetchExchangeRate(): Promise<IndexPriceData | null> {
  const BOK_API_KEY = process.env.BOK_API_KEY || "D7Z1MD14MIETKMYQBYYB";
  const today = new Date();
  const past = new Date();
  past.setDate(today.getDate() - 14);

  const startStr = formatYYYYMMDD(past);
  const endStr = formatYYYYMMDD(today);
  const url = `http://ecos.bok.or.kr/api/StatisticSearch/${BOK_API_KEY}/json/kr/1/10/731Y001/D/${startStr}/${endStr}/0000001`;

  try {
    const res = await fetchWithTimeout(url, {}, 7000);
    if (!res.ok) return null;
    const data = await res.json();
    return parseExchangeRate(data);
  } catch (error) {
    console.error("fetchExchangeRate exception:", error);
    return null;
  }
}

/**
 * 국내 증시자금 종합 및 신용잔고 내역 (통합)
 */
export async function fetchMarketFunds(): Promise<{ funds: MarketFundsData | null, creditHistory: CreditBalanceData[] }> {
  const token = await getAccessToken();
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const dateStr = formatYYYYMMDD(new Date());
  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/mktfunds?FID_INPUT_DATE_1=${dateStr}`;
  const headers = {
    "Content-Type": "application/json",
    authorization: `Bearer ${token}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: "FHKST649100C0",
    custtype: "P",
  };

  try {
    const res = await fetchWithTimeout(url, { headers });
    if (!res.ok) return { funds: null, creditHistory: [] };
    const data = await res.json();
    return parseCanaryCombined(data);
  } catch (error) {
    console.error("fetchMarketFunds exception:", error);
    return { funds: null, creditHistory: [] };
  }
}

interface SectorCacheEntry {
  sector: string;
  name: string;
}

// 인메모리 업종 캐시 (날짜별 초기화 지원)
const sectorCache = new Map<string, SectorCacheEntry>();
let sectorCacheDate: string = ""; // YYYYMMDD

function getSectorCache(code: string): SectorCacheEntry | undefined {
  const today = formatYYYYMMDD(new Date());
  if (sectorCacheDate !== today) {
    // 날짜가 바뀌면 캐시 초기화
    sectorCache.clear();
    sectorCacheDate = today;
    console.log(`[sectorCache] 날짜 변경으로 캐시 초기화: ${today}`);
  }
  return sectorCache.get(code);
}

function setSectorCache(code: string, sector: string, name: string) {
  sectorCache.set(code, { sector, name });
}

/**
 * 52주 신고가 종목 수 및 업종별 집계 (코스피 + 코스닥)
 * 2차 정밀 필터링(Defensive Filtering) 적용
 */
export async function fetchNewHighCount(): Promise<{ count: number; sectors: { sector: string; count: number }[] }> {
  const token = await getAccessToken();
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const fetchMarketHigh = async (marketCode: string) => {
    let totalItems: any[] = [];
    let trCont = "";
    
    for (let i = 0; i < 5; i++) {
        const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/near-new-highlow?fid_cond_mrkt_div_code=J&fid_cond_scr_div_code=20187&fid_div_cls_code=0&fid_input_cnt_1=0&fid_input_cnt_2=0&fid_prc_cls_code=0&fid_input_iscd=${marketCode}&fid_trgt_cls_code=0&fid_trgt_exls_cls_code=0&fid_aply_rang_prc_1=0&fid_aply_rang_prc_2=1000000&fid_aply_rang_vol=0`;

        const headers: any = {
            "Content-Type": "application/json",
            authorization: `Bearer ${token}`,
            appkey: appKey,
            appsecret: appSecret,
            tr_id: "FHPST01870000",
            custtype: "P",
        };
        
        if (trCont) {
            headers.tr_cont = trCont;
        }

        try {
            const res = await fetchWithTimeout(url, { headers });
            if (!res.ok) break;
            
            trCont = res.headers.get("tr_cont") || "";
            const data = await res.json();
            
            if (data.rt_cd === "0" && Array.isArray(data.output)) {
                totalItems = [...totalItems, ...data.output];
            } else {
                break;
            }
            
            if (trCont !== "M" && trCont !== "F") break;
        } catch (error) {
            console.error("fetchNewHighCount exception:", error);
            break;
        }
    }

    // 2차 정밀 필터링 (Defensive Filtering)
    // 괴리율(hprc_near_rate)이 '0.00'이거나 현재가(stck_prpr)가 52주 최고가(new_hgpr)와 완전히 일치하는 종목
    const filtered = totalItems.filter(item => {
      const hprcNearRate = parseFloat(item.hprc_near_rate || "");
      const stckPrpr = parseFloat(item.stck_prpr || "");
      const newHgpr = parseFloat(item.new_hgpr || "");
      
      const isNearZero = hprcNearRate === 0.0;
      const isPriceEqual = stckPrpr > 0 && stckPrpr === newHgpr;
      
      return isNearZero || isPriceEqual;
    });

    return filtered;
  };

  try {
    const kospiItems = await fetchMarketHigh('0001');
    const kosdaqItems = await fetchMarketHigh('1001');
    const allFilteredItems = [...kospiItems, ...kosdaqItems];

    const sectorsMap: Record<string, { count: number; stocks: { name: string; code: string }[] }> = {};

    for (const item of allFilteredItems) {
      const code = item.mksc_shrn_iscd || item.stck_shrn_iscd || item.hts_shrn_iscd || item.shrn_iscd;
      if (!code) continue;

      let cached = getSectorCache(code);
      let sector: string = cached?.sector || "미분류";
      let stockName: string = cached?.name || item.hts_kor_isnm || code;

      if (cached === undefined) {
        try {
          const detail = await fetchStockDetail(code, 'J');
          const industryName = detail?.industry || "미분류";
          const resolvedName = item.hts_kor_isnm || detail?.name || code;
          setSectorCache(code, industryName, resolvedName);
          sector = industryName;
          stockName = resolvedName;
          // KIS API 호출율 제한(Rate Limit) 방지를 위해 100ms 대기
          await delay(100);
        } catch (err) {
          console.error(`Failed to fetch sector for code ${code}:`, err);
          const resolvedName = item.hts_kor_isnm || code;
          sector = "미분류";
          stockName = resolvedName;
          setSectorCache(code, sector, stockName);
        }
      }
      
      const sectorKey = sector || "미분류";
      const finalName = stockName || item.hts_kor_isnm || code;

      if (!sectorsMap[sectorKey]) {
        sectorsMap[sectorKey] = { count: 0, stocks: [] };
      }
      
      // 중복 삽입 방지
      if (!sectorsMap[sectorKey].stocks.some(s => s.code === code)) {
        sectorsMap[sectorKey].stocks.push({ name: finalName, code });
        sectorsMap[sectorKey].count += 1;
      }
    }

    const sectorsList = Object.entries(sectorsMap)
      .map(([sector, data]) => ({ sector, count: data.count, stocks: data.stocks }))
      .sort((a, b) => b.count - a.count);

    return {
      count: allFilteredItems.length,
      sectors: sectorsList
    };
  } catch (error) {
    console.error("fetchNewHighCount main loop error:", error);
    return { count: 0, sectors: [] };
  }
}

/**
 * 외국인/기관 순매수 상위 종목
 */
export async function fetchInvestorRanking(type: '1' | '2', market = '0001'): Promise<InvestorFlowData[]> {
  const token = await getAccessToken();
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/foreign-institution-total?` +
    `FID_COND_MRKT_DIV_CODE=V&FID_COND_SCR_DIV_CODE=16449&FID_INPUT_ISCD=${market}&` +
    `FID_DIV_CLS_CODE=1&FID_RANK_SORT_CLS_CODE=0&FID_ETC_CLS_CODE=${type}`;
  const headers = {
    "Content-Type": "application/json",
    authorization: `Bearer ${token}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: "FHPTJ04400000",
    custtype: "P",
  };

  try {
    const res = await fetch(url, { headers });
    const data = await res.json();
    return parseInvestorRanking(data, type);
  } catch (error) {
    console.error("fetchInvestorRanking exception:", error);
    return [];
  }
}

/**
 * 종목 상세정보 (시가총액, 업종 등)
 */
export async function fetchStockDetail(code: string, marketDiv = 'J') {
  const token = await getAccessToken();
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=${marketDiv}&FID_INPUT_ISCD=${code}`;
  const headers = {
    "Content-Type": "application/json",
    authorization: `Bearer ${token}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: "FHKST01010100",
    custtype: "P",
  };

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return parseStockDetail(data);
  } catch {
    return null;
  }
}
