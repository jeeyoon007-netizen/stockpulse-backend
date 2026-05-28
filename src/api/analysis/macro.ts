import { supabase } from '../supabase.js';
import { formatYYYYMMDD } from '../kis.js';

export interface MacroAnalysisResult {
  consecutiveDepositDecline: number;
  consecutiveCreditIncrease: number;
  creditMinMax: number;
  creditPercentile: number;
}

export async function calculateMacroIndicators(): Promise<MacroAnalysisResult> {
  const result: MacroAnalysisResult = {
    consecutiveDepositDecline: 0,
    consecutiveCreditIncrease: 0,
    creditMinMax: 0,
    creditPercentile: 0,
  };

  if (!supabase) return result;

  try {
    // 1. Fetch recent funds history (for deposit decline)
    // 최대 20일 정도면 연속 하락일수 계산에 충분함
    const { data: fundsData, error: fundsError } = await supabase
      .from('market_funds_history')
      .select('trade_date, deposit')
      .order('trade_date', { ascending: false })
      .limit(20);

    if (!fundsError && fundsData && fundsData.length > 1) {
      let declineCount = 0;
      for (let i = 0; i < fundsData.length - 1; i++) {
        if (fundsData[i].deposit < fundsData[i + 1].deposit) {
          declineCount++;
        } else {
          break; // 연속 하락이 끊어지면 중단
        }
      }
      result.consecutiveDepositDecline = declineCount;
    }

    // 2. Fetch credit history (for percentile and min-max) - up to 240 days (52 weeks)
    const { data: creditData, error: creditError } = await supabase
      .from('market_credit_history')
      .select('trade_date, amount')
      .order('trade_date', { ascending: false })
      .limit(240);

    if (!creditError && creditData && creditData.length > 0) {
      // 2-1. 연속 신용 증가일수 계산
      let increaseCount = 0;
      if (creditData.length > 1) {
        for (let i = 0; i < creditData.length - 1; i++) {
          if (creditData[i].amount > creditData[i + 1].amount) {
            increaseCount++;
          } else {
            break;
          }
        }
      }
      result.consecutiveCreditIncrease = increaseCount;

      // 2-2. 신용 Min-Max & Percentile 계산
      const currentAmount = creditData[0].amount;
      const amounts = creditData.map(d => d.amount);
      const maxAmount = Math.max(...amounts);
      const minAmount = Math.min(...amounts);

      // Min-Max 정규화 (0~100 스케일)
      if (maxAmount > minAmount) {
        result.creditMinMax = ((currentAmount - minAmount) / (maxAmount - minAmount)) * 100;
      } else {
        result.creditMinMax = 50; // 데이터가 1개이거나 모두 같을 경우
      }

      // 진짜 Percentile (데이터 중 현재값보다 낮은 날의 비율)
      const lowerCount = amounts.filter(amt => amt < currentAmount).length;
      result.creditPercentile = (lowerCount / amounts.length) * 100;
    }

  } catch (error) {
    console.error('[calculateMacroIndicators] Error:', error);
  }

  return result;
}
