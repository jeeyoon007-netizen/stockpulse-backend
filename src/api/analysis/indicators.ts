import { SMA, MFI, VWAP, RSI, ADX, ATR } from "technicalindicators";
import { type OHLCV, AnalysisError } from "../kis-stock-ohlcv.js";

export interface IndicatorsResult {
  sma5: number;
  sma20: number;
  sma60: number;
  mfi: number;
  vwap: number;
  rsi: number;
  adx: number;
  pdi: number; // +DI from ADX
  mdi: number; // -DI from ADX
  atr: number;
  lastClose: number;
  lastHigh: number;
  lastLow: number;
  recentHigh: number; // 최근 60일내 최고가
  recentLow: number;  // 최근 60일내 최저가
  rsiHistory: number[];  // 최근 5개 RSI (히스테리시스 판단용)
  adxHistory: number[];  // 최근 5개 ADX
}

/**
 * 수집된 OHLCV 데이터를 바탕으로 모든 기술적 지표를 한 번에 계산
 */
export function calculateIndicators(ohlcvs: OHLCV[]): IndicatorsResult {
  if (ohlcvs.length < 60) {
    throw new AnalysisError("기술적 지표 계산을 위해 최소 60개의 데이터가 필요합니다.");
  }

  // technicalindicators 패키지는 오름차순(과거->최신) 배열을 요구함
  const highs = ohlcvs.map((d) => d.high);
  const lows = ohlcvs.map((d) => d.low);
  const closes = ohlcvs.map((d) => d.close);
  const volumes = ohlcvs.map((d) => d.volume);

  const sma5Arr = SMA.calculate({ period: 5, values: closes });
  const sma20Arr = SMA.calculate({ period: 20, values: closes });
  const sma60Arr = SMA.calculate({ period: 60, values: closes });

  const mfiArr = MFI.calculate({
    high: highs,
    low: lows,
    close: closes,
    volume: volumes,
    period: 14,
  });

  const vwapArr = VWAP.calculate({
    high: highs,
    low: lows,
    close: closes,
    volume: volumes,
  });

  const rsiArr = RSI.calculate({ values: closes, period: 14 });

  const adxArr = ADX.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
  });

  const atrArr = ATR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
  });

  // 배열의 마지막 값이 가장 최신(현재) 지표값
  const last = <T>(arr: T[]): T => arr[arr.length - 1];

  const recent60 = closes.slice(-60);
  const recentHigh = Math.max(...recent60);
  const recentLow = Math.min(...recent60);

  const lastADX = last(adxArr) || { adx: 0, pdi: 0, mdi: 0 };

  const rsiHistory = rsiArr.slice(-5);
  const adxHistory = adxArr.slice(-5).map(v => v.adx || 0);

  return {
    sma5: last(sma5Arr) || 0,
    sma20: last(sma20Arr) || 0,
    sma60: last(sma60Arr) || 0,
    mfi: last(mfiArr) || 0,
    vwap: last(vwapArr) || 0,
    rsi: last(rsiArr) || 0,
    adx: lastADX.adx || 0,
    pdi: lastADX.pdi || 0,
    mdi: lastADX.mdi || 0,
    atr: last(atrArr) || 0,
    lastClose: last(closes),
    lastHigh: last(highs),
    lastLow: last(lows),
    recentHigh,
    recentLow,
    rsiHistory,
    adxHistory,
  };
}

export interface RollingIndicators {
  sma5: (number | null)[];
  sma20: (number | null)[];
  sma60: (number | null)[];
  rsi: (number | null)[];
  mfi: (number | null)[];
  vwap: (number | null)[];
}

/**
 * 백테스트용: 전체 OHLCV 기간에 대한 롤링 지표를 계산하고 원본 배열 길이에 맞게 패딩(null)하여 반환합니다.
 */
export function calculateRollingIndicators(ohlcvs: OHLCV[]): RollingIndicators {
  const highs = ohlcvs.map((d) => d.high);
  const lows = ohlcvs.map((d) => d.low);
  const closes = ohlcvs.map((d) => d.close);
  const volumes = ohlcvs.map((d) => d.volume);

  const pad = (arr: number[], length: number) => {
    const padding = new Array(length - arr.length).fill(null);
    return [...padding, ...arr];
  };

  const sma5Arr = SMA.calculate({ period: 5, values: closes });
  const sma20Arr = SMA.calculate({ period: 20, values: closes });
  const sma60Arr = SMA.calculate({ period: 60, values: closes });
  const rsiArr = RSI.calculate({ values: closes, period: 14 });
  const mfiArr = MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period: 14 });
  const vwapArr = VWAP.calculate({ high: highs, low: lows, close: closes, volume: volumes });

  const L = ohlcvs.length;

  return {
    sma5: pad(sma5Arr, L),
    sma20: pad(sma20Arr, L),
    sma60: pad(sma60Arr, L),
    rsi: pad(rsiArr, L),
    mfi: pad(mfiArr, L),
    vwap: pad(vwapArr, L),
  };
}

