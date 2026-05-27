import { getAccessToken, KIS_BASE_URL } from './kis.js';
import { supabase } from './supabase.js';

export interface InvestorDailyItem {
  stck_bsop_date: string;       // YYYYMMDD
  frgn_ntby_qty: string;        // 외국인 순매수 수량
  orgn_ntby_qty: string;        // 기관계 순매수 수량
  frgn_ntby_tr_pbmn: string;    // 외국인 순매수 대금
  orgn_ntby_tr_pbmn: string;    // 기관계 순매수 대금
}

/**
 * KIS 종목별 투자자매매동향(일별) API 호출
 */
export async function fetchInvestorTradeDaily(stockCode: string, baseDate: string): Promise<InvestorDailyItem[]> {
  const token = await getAccessToken();
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  // Parameters
  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${stockCode}&FID_INPUT_DATE_1=${baseDate}&FID_ORG_ADJ_PRC=&FID_ETC_CLS_CODE=`;

  const headers = {
    "Content-Type": "application/json",
    authorization: `Bearer ${token}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: "FHPTJ04160001",
    custtype: "P",
  };

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(`[KIS API] investor-trade-by-stock-daily error: ${res.statusText}`);
      return [];
    }
    const data = await res.json();
    if (data.rt_cd === "0" && Array.isArray(data.output2)) {
      return data.output2;
    }
    return [];
  } catch (error) {
    console.error(`[KIS API] investor-trade-by-stock-daily exception:`, error);
    return [];
  }
}

/**
 * 여러 종목에 대한 수급 데이터를 수집하고 Supabase에 Upsert
 */
export async function fetchAndStoreInvestorFlow(stockCodes: string[], baseDate: string): Promise<void> {
  console.log(`[FLOW COLLECT] Starting collection for ${stockCodes.length} stocks as of ${baseDate}`);

  for (let i = 0; i < stockCodes.length; i++) {
    const code = stockCodes[i];
    console.log(`[FLOW COLLECT] [${i + 1}/${stockCodes.length}] Fetching flow for ${code}...`);

    const items = await fetchInvestorTradeDaily(code, baseDate);
    if (items.length > 0) {
      // Map to Supabase rows
      const rows = items.map(item => {
        const yyyy = item.stck_bsop_date.substring(0, 4);
        const mm = item.stck_bsop_date.substring(4, 6);
        const dd = item.stck_bsop_date.substring(6, 8);
        const formattedDate = `${yyyy}-${mm}-${dd}`;

        return {
          stock_code: code,
          trade_date: formattedDate,
          frgn_ntby: parseFloat(item.frgn_ntby_qty) || 0,
          orgn_ntby: parseFloat(item.orgn_ntby_qty) || 0,
          frgn_ntby_amt: parseFloat(item.frgn_ntby_tr_pbmn) || 0,
          orgn_ntby_amt: parseFloat(item.orgn_ntby_tr_pbmn) || 0,
        };
      });

      if (!supabase) {
        console.error(`[FLOW COLLECT] Supabase client is not initialized.`);
        continue;
      }

      // Upsert into Supabase (UNIQUE constraint handles conflicts)
      const { error } = await supabase
        .from('stock_investor_flow')
        .upsert(rows, { onConflict: 'stock_code,trade_date' });

      if (error) {
        console.error(`[FLOW COLLECT] Supabase upsert error for ${code}:`, error.message);
      } else {
        console.log(`[FLOW COLLECT] Successfully upserted ${rows.length} rows for ${code}`);
      }
    }

    // Rate limit 0.3s sleep
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log(`[FLOW COLLECT] Completed collection for all stocks.`);
}
