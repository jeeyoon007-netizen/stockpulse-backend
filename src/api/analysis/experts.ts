import type { IndicatorsResult } from "./indicators.js";

export type OpinionType = "상승" | "하락" | "기록없음" | "횡보/보합" | "하락주의";

export interface ExpertOpinion {
  expertName: string;
  opinion: OpinionType;
  confidence: number; // 0 ~ 100
  reason: string;
  vetoTriggered: boolean;
  vetoReason?: string;
  vetoTriggerSource?: string;
}

/**
 * 1. [파동/추세 전문가]
 * 이동평균선(5, 20, 60) 정배열 여부와 최근 고점/저점을 비교해 추세를 판독합니다.
 */
export function evaluateTrend(data: IndicatorsResult): ExpertOpinion {
  const { sma5, sma20, sma60, lastClose, recentHigh, recentLow } = data;
  
  let opinion: OpinionType = "횡보/보합";
  let confidence = 50;
  const reasons: string[] = [];

  // 정배열 확인 (상승 추세)
  const isUpTrendMatch = sma5 > sma20 && sma20 > sma60;
  // 역배열 확인 (하락 추세)
  const isDownTrendMatch = sma5 < sma20 && sma20 < sma60;

  if (isUpTrendMatch) {
    opinion = "상승";
    confidence = 80;
    reasons.push("이동평균선(5,20,60)이 완벽한 정배열 상태입니다.");
  } else if (isDownTrendMatch) {
    opinion = "하락";
    confidence = 80;
    reasons.push("이동평균선(5,20,60)이 완벽한 역배열 상태입니다.");
  } else {
    // 꼬여있는 경우
    if (lastClose > sma60) {
      opinion = "상승";
      confidence = 60;
      reasons.push("단기 이평선이 혼조세이나 60일 장기 추세선 위에 위치하여 회복 국면입니다.");
    } else {
      opinion = "하락";
      confidence = 60;
      reasons.push("단기 이평선이 혼조세이나 60일 장기 추세선 아래에 위치하여 하방 압력이 존재합니다.");
    }
  }

  // 고점 갱신 여부
  const diffToHigh = (recentHigh - lastClose) / recentHigh;
  const diffToLow = (lastClose - recentLow) / recentLow;

  if (diffToHigh < 0.05) {
    reasons.push("최근 60일 신고가에 근접해 추가 파동 에너지가 강합니다.");
    confidence += 10;
  } else if (diffToLow < 0.05) {
    reasons.push("최근 60일 신저가에 근접해 바닥 확인이 아직 되지 않았습니다.");
  }

  return {
    expertName: "파동/추세 전문가",
    opinion,
    confidence: Math.min(confidence, 100),
    reason: reasons.join(" "),
    vetoTriggered: false,
  };
}

/**
 * 2. [에너지 전문가]
 * MFI(Money Flow Index)와 거래량 가중 평균(VWAP)을 계산하여 수급의 힘을 측정합니다.
 */
export function evaluateEnergy(data: IndicatorsResult): ExpertOpinion {
  const { mfi, vwap, lastClose } = data;
  
  let opinion: OpinionType = "횡보/보합";
  let confidence = 50;
  const reasons: string[] = [];

  // VWAP 분석
  if (lastClose > vwap * 1.02) {
    opinion = "상승";
    confidence += 20;
    reasons.push("주가가 거래량가중평균선(VWAP)보다 2% 이상 높아 매수 우위의 수급이 확인됩니다.");
  } else if (lastClose < vwap * 0.98) {
    opinion = "하락";
    confidence += 20;
    reasons.push("주가가 거래량가중평균선(VWAP)보다 낮아 매도 우위 상태입니다.");
  } else {
    reasons.push("주가가 거래량가중평균선(VWAP) 부근에서 등락 중이며 팽팽한 수급 공방이 이루어지고 있습니다.");
  }

  // MFI 분석
  if (mfi > 80) {
    opinion = opinion === "상승" ? "하락" : "하락"; // 과매수면 단기 하락위험
    reasons.push("자금흐름지수(MFI)가 80을 넘어 스마트머니의 단계적 차익실현에 주의해야 합니다(과매수 경계).");
    confidence = 70;
  } else if (mfi < 20) {
    opinion = "상승"; 
    reasons.push("자금흐름지수(MFI)가 20 미만으로 바닥권 수급 유입이 기대되는 과매도 구간입니다.");
    confidence = 75;
  } else if (mfi > 50) {
    if (opinion !== "하락") opinion = "상승";
    reasons.push("자금흐름지수(MFI)가 50 이상으로 기본 자금 유입 흐름은 긍정적입니다.");
  } else {
    reasons.push("자금흐름지수(MFI)가 50 미만으로 자금 이탈 현상이 지속 중입니다.");
  }

  return {
    expertName: "에너지 전문가",
    opinion,
    confidence: Math.min(confidence, 100),
    reason: reasons.join(" "),
    vetoTriggered: false,
  };
}

/**
 * 3. [모멘텀 전문가]
 * RSI와 ADX 수치를 계산하여 현재 추세의 강도와 과매수/과매도 상태를 진단합니다.
 */
export function evaluateMomentum(data: IndicatorsResult): ExpertOpinion {
  const { rsi, adx, pdi, mdi } = data;
  
  let opinion: OpinionType = "횡보/보합";
  let confidence = 50;
  const reasons: string[] = [];

  // ADX 추세 강도
  const hasStrongTrend = adx >= 25;
  if (!hasStrongTrend) {
    reasons.push(`추세강도지수(ADX)가 ${adx.toFixed(1)}로 25 미만이라 확고한 방향성은 부족합니다.`);
  } else {
    reasons.push(`추세강도지수(ADX)가 ${adx.toFixed(1)}로 강력한 추세가 형성되었습니다.`);
  }

  // RSI 과매수/매도 및 DI 교차 분석
  if (rsi > 70) {
    opinion = "하락";
    confidence += 20;
    reasons.push("상대강도지수(RSI)가 70을 상회하며 강력한 단기 고점(과매수) 징후를 나타냅니다.");
  } else if (rsi < 30) {
    opinion = "상승";
    confidence += 20;
    reasons.push("상대강도지수(RSI)가 30 미만으로 기술적 반등이 절실한 과매도 상태입니다.");
  } else {
    if (pdi > mdi) {
      opinion = "상승";
      confidence += hasStrongTrend ? 25 : 10;
      reasons.push("상승방향성지수(+DI)가 하락방향성지수(-DI)보다 위에 있어 매수 모멘텀이 지배적입니다.");
    } else {
      opinion = "하락";
      confidence += hasStrongTrend ? 25 : 10;
      reasons.push("하락방향성지수(-DI)가 상승방향성지수(+DI)보다 위에 있어 매도 압력이 지배적입니다.");
    }
  }

  return {
    expertName: "모멘텀 전문가",
    opinion,
    confidence: Math.min(confidence, 100),
    reason: reasons.join(" "),
    vetoTriggered: false,
  };
}
