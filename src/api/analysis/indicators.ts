import { SMA, MFI, RSI, ADX, ATR } from "technicalindicators";
import { type OHLCV, AnalysisError } from "../kis-stock-ohlcv.js";

const VWAP_PERIOD = 20;

/** 롤링 N일 VWAP = Σ(typicalPrice×volume, 최근 N) / Σ(volume, 최근 N) */
function calcRollingVWAP(
  highs: number[], lows: number[], closes: number[], volumes: number[], period = VWAP_PERIOD
): number[] {
  return closes.map((_, i) => {
    if (i < period - 1) return NaN;
    let sumTPV = 0, sumVol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const tp = (highs[j] + lows[j] + closes[j]) / 3;
      sumTPV += tp * volumes[j];
      sumVol += volumes[j];
    }
    return sumVol > 0 ? sumTPV / sumVol : closes[i];
  });
}

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

  const vwapArr = calcRollingVWAP(highs, lows, closes, volumes);

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

  // T7: 실제 고가/저가 기반으로 수정 (종가 기반이면 피보나치 범위가 실제 변동폭 미반영)
  const recentHigh = Math.max(...highs.slice(-60));
  const recentLow = Math.min(...lows.slice(-60));

  const lastADX = last(adxArr) || { adx: 0, pdi: 0, mdi: 0 };

  const rsiHistory = rsiArr.slice(-5);

  const lastVWAP = vwapArr[vwapArr.length - 1];

  return {
    sma5: last(sma5Arr) || 0,
    sma20: last(sma20Arr) || 0,
    sma60: last(sma60Arr) || 0,
    mfi: last(mfiArr) || 0,
    vwap: Number.isFinite(lastVWAP) ? lastVWAP : last(closes),
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
  const rawVwap = calcRollingVWAP(highs, lows, closes, volumes);

  const L = ohlcvs.length;

  // 롤링 VWAP는 이미 L 길이 배열이며 앞 (VWAP_PERIOD-1)개는 NaN → null로 변환
  const vwapPadded: (number | null)[] = rawVwap.map(v => (Number.isFinite(v) ? v : null));

  return {
    sma5: pad(sma5Arr, L),
    sma20: pad(sma20Arr, L),
    sma60: pad(sma60Arr, L),
    rsi: pad(rsiArr, L),
    mfi: pad(mfiArr, L),
    vwap: vwapPadded,
  };
}

