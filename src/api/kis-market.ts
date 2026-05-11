/**
 * KIS 시장 데이터 수집 모듈 (Render 백엔드 전용)
 * - Next.js "server-only", "cache: no-store" 등 제거
 * - 순수 Node.js fetch 기반으로 변환
 */
import { getAccessToken, KIS_BASE_URL, formatYYYYMMDD } from './kis.js';

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
    if (data.rt_cd !== "0" || !data.output) return null;

    const out = data.output;
    const prpr = Number(out.bstp_nmix_prpr || 0);
    const prdy_vrss = Number(out.bstp_nmix_prdy_vrss || 0);
    const direction: "up" | "down" | "flat" = prdy_vrss > 0 ? "up" : prdy_vrss < 0 ? "down" : "flat";

    return {
      label,
      value: prpr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      change: (prdy_vrss > 0 ? "+" : "") + prdy_vrss.toFixed(2),
      changePercent: (prdy_vrss > 0 ? "+" : "") + (out.bstp_nmix_prdy_ctrt || "0.00") + "%",
      direction,
      advanceCount: Number(out.ascn_issu_cnt || 0),
      declineCount: Number(out.down_issu_cnt || 0),
    };
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
    if (data.rt_cd !== "0" || !data.output1?.[0]) return null;

    const out = data.output1[0];
    const prpr = Number(out.bstp_nmix_prpr || 0);
    const prdy_vrss = Number(out.bstp_nmix_prdy_vrss || 0);
    const direction: "up" | "down" | "flat" = prdy_vrss > 0 ? "up" : prdy_vrss < 0 ? "down" : "flat";

    return {
      label,
      value: prpr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      change: (prdy_vrss > 0 ? "+" : "") + prdy_vrss.toFixed(2),
      changePercent: (prdy_vrss > 0 ? "+" : "") + (out.bstp_nmix_prdy_ctrt || "0.00") + "%",
      direction,
    };
  } catch {
    return null;
  }
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
    if (!data.StatisticSearch?.row || data.StatisticSearch.row.length < 2) return null;

    const rows = data.StatisticSearch.row;
    const latest = rows[rows.length - 1];
    const previous = rows[rows.length - 2];
    const prpr = Number(latest.DATA_VALUE || 0);
    const prevPrpr = Number(previous.DATA_VALUE || 0);
    const prdy_vrss = Number((prpr - prevPrpr).toFixed(2));
    const prdy_ctrt = Number(((prdy_vrss / prevPrpr) * 100).toFixed(2));
    const direction: "up" | "down" | "flat" = prdy_vrss > 0 ? "up" : prdy_vrss < 0 ? "down" : "flat";

    return {
      label: "원/달러",
      value: prpr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      change: (prdy_vrss > 0 ? "+" : "") + prdy_vrss.toFixed(2),
      changePercent: (prdy_vrss > 0 ? "+" : "") + prdy_ctrt.toFixed(2) + "%",
      direction,
    };
  } catch (error) {
    console.error("fetchExchangeRate exception:", error);
    return null;
  }
}

/**
 * 국내 증시자금 종합 (고객예탁금 등)
 */
export async function fetchMarketFunds(): Promise<MarketFundsData | null> {
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
    if (!res.ok) return null;
    const data = await res.json();
    if (data.rt_cd !== "0" || !data.output) return null;

    const latest = data.output;
    return {
      date: latest.stck_bsop_date || "",
      deposit: Number(latest.cstmr_u_ast_amt || 0) * 100000000,
      margin_loan: Number(latest.shcl_und_amt || 0) * 100000000,
      misu: Number(latest.entr_asst_amt || 0) * 100000000,
    };
  } catch (error) {
    console.error("fetchMarketFunds exception:", error);
    return null;
  }
}

/**
 * 신용잔고 일별 추이
 */
export async function fetchDailyCreditBalance(days = 20): Promise<CreditBalanceData[]> {
  const token = await getAccessToken();
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days + 20));
  const startStr = formatYYYYMMDD(startDate);

  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/daily-credit-balance?FID_COND_MRKT_DIV_CODE=J&FID_COND_SCR_DIV_CODE=20476&FID_INPUT_ISCD=0000&FID_INPUT_DATE_1=${startStr}`;
  const headers = {
    "Content-Type": "application/json",
    authorization: `Bearer ${token}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: "FHPST04760000",
    custtype: "P",
  };

  try {
    const res = await fetchWithTimeout(url, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.rt_cd !== "0" || !data.output) return [];

    return (data.output as any[]).slice(0, days).map(item => ({
      date: item.stck_bsop_date,
      amount: Number(item.shcl_und_amt || 0) * 100000000,
      ratio: Number(item.shcl_und_amt_icrt || 0),
    })).reverse();
  } catch {
    return [];
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
    if (data.rt_cd !== "0" || !data.output) return [];

    return (data.output as any[]).slice(0, 10).map((item, index) => {
      const foreignAmt = item.frgn_ntby_tr_pbmn || "0";
      const instAmt = item.orgn_ntby_tr_pbmn || "0";
      const rawAmount = type === '1' ? foreignAmt : instAmt;

      return {
        rank: index + 1,
        code: item.mksc_shrn_iscd || item.hts_shrn_iscd,
        name: item.hts_kor_isnm,
        price: Number(item.stck_prpr || 0),
        change: Number(item.prdy_vrss || 0),
        changePercent: Number(item.prdy_ctrt || 0),
        volume: Number(item.acml_vol || 0),
        amount: Number(rawAmount) * 1000000,
      };
    });
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
    if (data.rt_cd !== "0" || !data.output) return null;

    return {
      name: data.output.hts_kor_isnm,
      industry: data.output.bstp_kor_isnm,
      marketCap: Number(data.output.hts_avls || 0),
      currentPrice: Number(data.output.stck_prpr || 0),
    };
  } catch {
    return null;
  }
}
