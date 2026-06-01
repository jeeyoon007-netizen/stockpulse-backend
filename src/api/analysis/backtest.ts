import { type OHLCV } from "../kis-stock-ohlcv.js";
import { calculateRollingIndicators } from "./indicators.js";

export interface Trade {
  trade_date: string;
  action: 'Buy' | 'Sell';
  price: number;
}

export interface StrategyResult {
  strategy_name: string;
  strategy_desc: string;
  win_rate: number;
  total_return: number;
  mdd: number;
  trade_count: number;
  trades: Trade[];
}

// 전략 1: RSI 스윙 매매
function simulateRSISwing(ohlcvs: OHLCV[], rsiArr: (number | null)[], rsiBuy: number, rsiSell: number): StrategyResult {
  let inPosition = false;
  let buyPrice = 0;
  let wins = 0;
  let tradesCount = 0;
  const trades: Trade[] = [];

  let closedEquity = 1; // 청산 기준 복리 자산 (T5)
  let peakEquity = 1;
  let maxDrawdown = 0;

  for (let i = 1; i < ohlcvs.length; i++) {
    const today = ohlcvs[i];
    const prevRSI = rsiArr[i - 1];
    const todayRSI = rsiArr[i];

    if (prevRSI === null || todayRSI === null) continue;

    if (!inPosition && prevRSI < rsiBuy && todayRSI >= rsiBuy) {
      inPosition = true;
      buyPrice = today.close;
      trades.push({ trade_date: today.date, action: 'Buy', price: buyPrice });
    } else if (inPosition && (todayRSI >= rsiSell || i === ohlcvs.length - 1)) {
      const sellPrice = today.close;
      const tradeReturn = (sellPrice - buyPrice) / buyPrice;
      closedEquity *= (1 + tradeReturn);
      if (tradeReturn > 0) wins++;
      tradesCount++;
      trades.push({ trade_date: today.date, action: 'Sell', price: sellPrice });
      inPosition = false;
    }

    // T6: 매 봉 mark-to-market으로 MDD 계산 (보유 중 미실현 손실 반영)
    const mtmEquity = inPosition ? closedEquity * (today.close / buyPrice) : closedEquity;
    if (mtmEquity > peakEquity) peakEquity = mtmEquity;
    const drawdown = (peakEquity - mtmEquity) / peakEquity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const win_rate = tradesCount > 0 ? (wins / tradesCount) * 100 : 0;

  return {
    strategy_name: `RSI 스윙 (${rsiBuy}/${rsiSell})`,
    strategy_desc: `RSI가 ${rsiBuy} 상향 돌파 시 매수, ${rsiSell} 이상 도달 시 매도하는 전략입니다.`,
    win_rate: Number(win_rate.toFixed(1)),
    total_return: Number(((closedEquity - 1) * 100).toFixed(2)), // T5: 복리 누적수익률
    mdd: Number((maxDrawdown * 100).toFixed(2)),
    trade_count: tradesCount,
    trades
  };
}

// 전략 2: 이동평균선 돌파 매매 (단기 이동평균선이 장기 이동평균선을 상향 돌파)
function simulateMACross(ohlcvs: OHLCV[], shortMa: (number | null)[], longMa: (number | null)[]): StrategyResult {
  let inPosition = false;
  let buyPrice = 0;
  let wins = 0;
  let tradesCount = 0;
  const trades: Trade[] = [];

  let closedEquity = 1; // 청산 기준 복리 자산 (T5)
  let peakEquity = 1;
  let maxDrawdown = 0;

  for (let i = 1; i < ohlcvs.length; i++) {
    const today = ohlcvs[i];
    const prevShort = shortMa[i - 1];
    const prevLong = longMa[i - 1];
    const todayShort = shortMa[i];
    const todayLong = longMa[i];

    if (prevShort === null || prevLong === null || todayShort === null || todayLong === null) continue;

    if (!inPosition && prevShort <= prevLong && todayShort > todayLong) {
      inPosition = true;
      buyPrice = today.close;
      trades.push({ trade_date: today.date, action: 'Buy', price: buyPrice });
    } else if (inPosition && (todayShort < todayLong || i === ohlcvs.length - 1)) {
      const sellPrice = today.close;
      const tradeReturn = (sellPrice - buyPrice) / buyPrice;
      closedEquity *= (1 + tradeReturn);
      if (tradeReturn > 0) wins++;
      tradesCount++;
      trades.push({ trade_date: today.date, action: 'Sell', price: sellPrice });
      inPosition = false;
    }

    // T6: 매 봉 mark-to-market으로 MDD 계산 (보유 중 미실현 손실 반영)
    const mtmEquity = inPosition ? closedEquity * (today.close / buyPrice) : closedEquity;
    if (mtmEquity > peakEquity) peakEquity = mtmEquity;
    const drawdown = (peakEquity - mtmEquity) / peakEquity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const win_rate = tradesCount > 0 ? (wins / tradesCount) * 100 : 0;

  return {
    strategy_name: `골든크로스 돌파`,
    strategy_desc: `단기 이평선이 장기 이평선을 상향 돌파 시 매수, 하향 이탈 시 매도하는 전략입니다.`,
    win_rate: Number(win_rate.toFixed(1)),
    total_return: Number(((closedEquity - 1) * 100).toFixed(2)), // T5: 복리 누적수익률
    mdd: Number((maxDrawdown * 100).toFixed(2)),
    trade_count: tradesCount,
    trades
  };
}


export function runBacktest(ohlcvs: OHLCV[]): StrategyResult {
  const indicators = calculateRollingIndicators(ohlcvs);
  
  const strategies: StrategyResult[] = [
    simulateRSISwing(ohlcvs, indicators.rsi, 30, 70),
    simulateRSISwing(ohlcvs, indicators.rsi, 25, 75),
    simulateRSISwing(ohlcvs, indicators.rsi, 35, 65),
    simulateMACross(ohlcvs, indicators.sma5, indicators.sma20),
    simulateMACross(ohlcvs, indicators.sma5, indicators.sma60),
    simulateMACross(ohlcvs, indicators.sma20, indicators.sma60),
  ];

  // Grid Search: 가장 총수익률이 높은 최적 전략 탐색
  let bestStrategy = strategies[0];
  for (const st of strategies) {
    if (st.total_return > bestStrategy.total_return) {
      bestStrategy = st;
    }
  }

  // 거래가 아예 없는 전략이라면 가장 첫번째 전략으로 Fallback
  if (bestStrategy.trade_count === 0 && strategies.some(s => s.trade_count > 0)) {
     bestStrategy = strategies.find(s => s.trade_count > 0)!;
  }

  return bestStrategy;
}
