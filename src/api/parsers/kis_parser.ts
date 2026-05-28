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
  // KIS mktfunds API(FHKST649100C0)는 output이 배열 형태로 반환됨
  // 배열 또는 단일 객체 모두 처리
  if (!data || data.rt_cd !== "0") {
    console.error(`[parseCanaryCombined] API 오류: rt_cd=${data?.rt_cd}, msg=${data?.msg1}`);
    return { funds: null, creditHistory: [] };
  }

  // output을 배열로 정규화
  let outputArr: any[];
  if (Array.isArray(data.output)) {
    outputArr = data.output;
  } else if (data.output && typeof data.output === 'object') {
    // 단일 객체인 경우 배열로 감싸기
    outputArr = [data.output];
  } else {
    console.error(`[parseCanaryCombined] output 형태 불명: ${typeof data.output}`);
    return { funds: null, creditHistory: [] };
  }

  if (outputArr.length === 0) {
    console.error('[parseCanaryCombined] output 배열이 비어있음');
    return { funds: null, creditHistory: [] };
  }

  const latest = outputArr[0];

  // 고객예탁금 필드 디버그 로그 (처음 파싱 시 필드명 확인)
  console.log('[parseCanaryCombined] latest 필드 샘플:', JSON.stringify(latest).slice(0, 300));

  const funds: MarketFundsData = {
    // KIS FHKST649100C0 실제 필드명 (API 문서 기반)
    // cust_dpmn_amt (고객예탁금), crdt_loan_rmnd (신용융자잔고), uncl_amt (위탁매매미수금)
    // 단일 객체일 때: cstmr_u_ast_amt, shcl_und_amt 등으로 올 수도 있으므로 OR 처리
    date: latest.bsop_date || latest.stck_bsop_date || "",
    deposit: Number(latest.cust_dpmn_amt || latest.cstmr_u_ast_amt || 0) * 100000000,
    margin_loan: Number(latest.crdt_loan_rmnd || latest.shcl_und_amt || 0) * 100000000,
    misu: Number(latest.uncl_amt || latest.entr_asst_amt || 0) * 100000000,
  };

  console.log(`[parseCanaryCombined] 파싱 결과: date=${funds.date}, deposit=${funds.deposit}, margin_loan=${funds.margin_loan}`);

  const history = outputArr.slice(0, days + 1);
  const creditHistory: CreditBalanceData[] = [];
  
  const processCount = Math.min(days, history.length > 0 ? history.length - 1 : 0);
  for (let i = processCount - 1; i >= 0; i--) {
    const current = history[i];
    const previous = history[i + 1];
    
    const currentAmt = Number(current.crdt_loan_rmnd || current.shcl_und_amt || 0) * 100000000;
    let ratio = 0;
    if (previous) {
      const prevAmt = Number(previous.crdt_loan_rmnd || previous.shcl_und_amt || 0) * 100000000;
      if (prevAmt > 0) {
        ratio = ((currentAmt - prevAmt) / prevAmt) * 100;
      }
    }
    
    creditHistory.push({
      date: current.bsop_date || current.stck_bsop_date || "",
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
