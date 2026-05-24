import { IndexPriceData, MarketFundsData, CreditBalanceData, InvestorFlowData } from '../kis-market.js';

export function parseMajorIndex(data: any, label: string): IndexPriceData | null {
  if (!data || data.rt_cd !== "0" || !data.output) return null;

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
}

export function parseMajorIndexLatest(data: any, label: string): IndexPriceData | null {
  if (!data || data.rt_cd !== "0" || !data.output1?.[0]) return null;

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
}

export function parseExchangeRate(data: any): IndexPriceData | null {
  if (!data || !data.StatisticSearch?.row || data.StatisticSearch.row.length < 2) return null;

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
}

export function parseCanaryCombined(data: any, days = 20): { funds: MarketFundsData | null, creditHistory: CreditBalanceData[] } {
  if (!data || data.rt_cd !== "0" || !Array.isArray(data.output) || data.output.length === 0) {
    return { funds: null, creditHistory: [] };
  }

  const latest = data.output[0];
  const funds: MarketFundsData = {
    date: latest.bsop_date || "",
    deposit: Number(latest.cust_dpmn_amt || 0) * 100000000,
    margin_loan: Number(latest.crdt_loan_rmnd || 0) * 100000000,
    misu: Number(latest.uncl_amt || 0) * 100000000,
  };

  const history = data.output.slice(0, days + 1);
  const creditHistory: CreditBalanceData[] = [];
  
  const processCount = Math.min(days, history.length > 0 ? history.length - 1 : 0);
  for (let i = processCount - 1; i >= 0; i--) {
    const current = history[i];
    const previous = history[i + 1];
    
    const currentAmt = Number(current.crdt_loan_rmnd || 0) * 100000000;
    let ratio = 0;
    if (previous && previous.crdt_loan_rmnd) {
      const prevAmt = Number(previous.crdt_loan_rmnd || 0) * 100000000;
      if (prevAmt > 0) {
        ratio = ((currentAmt - prevAmt) / prevAmt) * 100;
      }
    }
    
    creditHistory.push({
      date: current.bsop_date,
      amount: currentAmt,
      ratio: Number(ratio.toFixed(2)),
    });
  }

  return { funds, creditHistory };
}

export function parseInvestorRanking(data: any, type: '1' | '2'): InvestorFlowData[] {
  if (!data || data.rt_cd !== "0" || !data.output) return [];

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
}

export function parseStockDetail(data: any) {
  if (!data || data.rt_cd !== "0" || !data.output) return null;

  return {
    name: data.output.hts_kor_isnm,
    industry: data.output.bstp_kor_isnm,
    marketCap: Number(data.output.hts_avls || 0),
    currentPrice: Number(data.output.stck_prpr || 0),
  };
}
