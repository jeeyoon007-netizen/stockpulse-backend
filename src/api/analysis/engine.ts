import { calculateIndicators, type IndicatorsResult } from "./indicators.js";
import {
  evaluateTrend,
  evaluateEnergy,
  evaluateMomentum,
  type ExpertOpinion,
  type OpinionType,
} from "./experts.js";

export const WEIGHT_PROFILES = {
  scalp:    { trend: 0.20, energy: 0.30, momentum: 0.50 }, // 단타: 모멘텀 최우선
  swing:    { trend: 0.40, energy: 0.35, momentum: 0.25 }, // 스윙: 추세 중심
  position: { trend: 0.55, energy: 0.30, momentum: 0.15 }, // 장기: 구조 우선
} as const;

export type AnalysisMode = keyof typeof WEIGHT_PROFILES;

export type MarketState =
  | "AGGRESSIVE_LONG"
  | "CAUTIOUS_LONG"
  | "HOLD"
  | "EXIT_PRIORITY";

export const MARKET_STATE_LABELS: Record<MarketState, string> = {
  AGGRESSIVE_LONG: "🚀 강세 추세 진행 중",
  CAUTIOUS_LONG:   "⚡ 상승 과열 주의",
  HOLD:            "🔍 방향 탐색 중",
  EXIT_PRIORITY:   "🚨 탈출 우선 경보",
};

export interface AuditLog {
  step: number;
  expertName: string;
  message: string;
  vetoTriggered?: boolean;
  vetoSource?: string;
}

export interface VetoResult {
  triggered: boolean;
  priority: 'P1' | 'P2' | null;
  reason: string;
  source: string;
  forcedState: 'EXIT_PRIORITY' | 'HOLD' | null;
}

export interface StrategyScenario {
  currentPrice: number;
  entryRange: string;
  stopLoss: number;
  targetPrimary: number;
  targetSecondary: number;
}

export interface AIAnalysisResult {
  experts: ExpertOpinion[];
  auditLogs: AuditLog[];
  strategy: StrategyScenario;
  finalVerdict: OpinionType;
  weightedScore: number;
  mode: AnalysisMode;
  veto: VetoResult;
  marketState: MarketState;
  marketStateLabel: string;
  persistCycleRemaining: number;
}

type WeightProfile = { trend: number; energy: number; momentum: number };

function checkVeto(data: IndicatorsResult): VetoResult {
  if (data.rsi > 78) return {
    triggered: true, priority: 'P1',
    reason: `상대강도지수(RSI, ${data.rsi.toFixed(1)}) 78 초과 — 거부권(Veto) 발동`,
    source: `RSI=${data.rsi.toFixed(1)}`,
    forcedState: 'EXIT_PRIORITY'
  };
  if (data.mfi > 85 && data.lastClose < data.vwap) return {
    triggered: true, priority: 'P1',
    reason: `자금흐름지수(MFI, ${data.mfi.toFixed(1)}) 과매수 + 거래량가중평균선(VWAP) 이탈 — 분배 경고`,
    source: `MFI=${data.mfi.toFixed(1)}, VWAP 이탈`,
    forcedState: 'EXIT_PRIORITY'
  };
  if (data.lastClose < data.sma60) return {
    triggered: true, priority: 'P1',
    reason: `60일 이동평균선 하방 이탈 — 추세 구조 붕괴`,
    source: `SMA60 이탈 (${data.lastClose} < ${data.sma60.toFixed(0)})`,
    forcedState: 'EXIT_PRIORITY'
  };
  if (data.adx < 15) return {
    triggered: true, priority: 'P2',
    reason: `추세강도지수(ADX, ${data.adx.toFixed(1)}) 15 미만 — 추세 소멸`,
    source: `ADX=${data.adx.toFixed(1)}`,
    forcedState: 'HOLD'
  };
  return { triggered: false, priority: null, reason: "", source: "", forcedState: null };
}

/**
 * 3인의 의견을 교차 검증(CrossCheck)하여 상호 반박 및 Audit Log를 생성합니다.
 */
function crossCheck(
  experts: ExpertOpinion[],
  weights: WeightProfile
): {
  logs: AuditLog[];
  weightedScore: number;
  verdict: OpinionType;
} {
  const logs: AuditLog[] = [];
  
  const trend = experts.find((e) => e.expertName.includes("추세"))!;
  const energy = experts.find((e) => e.expertName.includes("에너지"))!;
  const momentum = experts.find((e) => e.expertName.includes("모멘텀"))!;

  const toScore = (op: OpinionType) =>
    op === "상승" ? 1 : op === "하락" ? -1 : 0;

  const weightedScore =
    toScore(trend.opinion)    * weights.trend    * (trend.confidence / 100) +
    toScore(energy.opinion)   * weights.energy   * (energy.confidence / 100) +
    toScore(momentum.opinion) * weights.momentum * (momentum.confidence / 100);

  const verdict: OpinionType =
    weightedScore > 0.2  ? "상승" :
    weightedScore < -0.2 ? "하락" : "횡보/보합";

  // 1단계: 논리적 충돌 탐지
  if (trend.opinion === "상승" && momentum.opinion === "하락") {
    logs.push({
      step: 1,
      expertName: momentum.expertName,
      message: `파동/추세 전문가는 [상승]을 주장하지만, 모멘텀 지표 측면에서 매도 압박 및 과매수 신호가 강해 단기 조정을 경고합니다.`,
    });
  } else if (trend.opinion === "하락" && energy.opinion === "상승") {
    logs.push({
      step: 1,
      expertName: energy.expertName,
      message: `전반적인 추세는 [하락]이나, 바닥권에서 자금흐름지수(MFI) 또는 거래량가중평균선(VWAP)을 상회하는 강력한 수급이 감지되어 반등을 시도 중입니다.`,
    });
  } else if (trend.opinion === energy.opinion && energy.opinion === momentum.opinion && trend.opinion !== "횡보/보합") {
    logs.push({
      step: 1,
      expertName: "System",
      message: `세 전문가의 방향성이 완벽히 일치합니다. [${trend.opinion}] 추세가 고착화되었습니다.`,
    });
  } else {
    logs.push({
      step: 1,
      expertName: "System",
      message: `전문가 간 혼조세 속 가중치 점수에 기반한 기본 방향성을 탐색 중입니다.`,
    });
  }

  // 2단계: 최종 합의
  logs.push({
    step: 2,
    expertName: "총괄 AI",
    message: `가중치 분석 결과 (모멘텀 ${Math.round(weights.momentum * 100)}%, 추세 ${Math.round(weights.trend * 100)}%, 에너지 ${Math.round(weights.energy * 100)}%), 최종 점수는 ${weightedScore.toFixed(2)}점이며 방향성은 [${verdict}]을 향하고 있습니다.`,
  });

  return { logs, weightedScore, verdict };
}

/**
 * 피보나치 + ATR 기준 전략 산출
 */
function calculateStrategy(data: IndicatorsResult): StrategyScenario {
  const { lastClose, recentHigh, recentLow, atr } = data;
  
  // 피보나치 되돌림 계산
  const diff = recentHigh - recentLow;
  const fibo382 = recentHigh - diff * 0.382;
  const fibo618 = recentHigh - diff * 0.618;
  
  // ATR을 활용한 변동성 계산 (안전마진 반영)
  // 매수 시점: 현재가 주변이나 주요 지지선
  const stopLoss = Math.floor(lastClose - atr * 1.5);
  let targetPrimary = Math.floor(lastClose + atr * 2.0);
  let targetSecondary = Math.floor(lastClose + atr * 3.5);

  // 피보나치 저항 및 지지 대조 (추가 보정)
  if (targetPrimary > recentHigh) targetPrimary = recentHigh;
  if (targetPrimary <= lastClose) targetPrimary = Math.floor(lastClose * 1.05);
  
  // 목표가가 피보나치 0.382 구간과 비슷하다면 수렴
  if (Math.abs(targetPrimary - fibo382) / targetPrimary < 0.03) {
    targetPrimary = Math.floor(fibo382);
  }

  const entryStart = Math.min(lastClose, Math.floor(fibo618));
  const entryEnd = Math.max(lastClose, Math.floor(fibo618));

  return {
    currentPrice: lastClose,
    entryRange: `${entryStart.toLocaleString()} ~ ${entryEnd.toLocaleString()}`,
    stopLoss,
    targetPrimary,
    targetSecondary,
  };
}

export function classifyMarketState(
  weightedScore: number,
  veto: VetoResult,
  data: IndicatorsResult,
  prevPersistCycle: number
): { state: MarketState; persistCycleRemaining: number } {
  // P1 Veto: 강제 EXIT_PRIORITY + 신호 고착 2사이클 설정
  if (veto.triggered && veto.priority === 'P1') {
    return { state: "EXIT_PRIORITY", persistCycleRemaining: 2 };
  }

  // 신호 고착 유지: 이전 사이클 잔여가 남아있으면 EXIT_PRIORITY 유지
  if (prevPersistCycle > 0) {
    return { state: "EXIT_PRIORITY", persistCycleRemaining: prevPersistCycle - 1 };
  }

  // P2 Veto: 추세 약하면 HOLD 강제
  if (veto.triggered && veto.priority === 'P2' && Math.abs(weightedScore) < 0.6) {
    return { state: "HOLD", persistCycleRemaining: 0 };
  }

  // 히스테리시스: 최근 5개 RSI 모두 임계값 초과해야 과열 인정
  const rsiConsistentlyHigh = data.rsiHistory.every(r => r > 65);

  if (weightedScore > 0.4 && data.rsi >= 50 && data.rsi <= 65 && data.adx >= 25) {
    return { state: "AGGRESSIVE_LONG", persistCycleRemaining: 0 };
  }
  if (weightedScore > 0.2 && (rsiConsistentlyHigh || data.mfi > 70)) {
    return { state: "CAUTIOUS_LONG", persistCycleRemaining: 0 };
  }
  if (Math.abs(weightedScore) <= 0.2 || data.adx < 20) {
    return { state: "HOLD", persistCycleRemaining: 0 };
  }
  return { state: "EXIT_PRIORITY", persistCycleRemaining: 2 };
}

/**
 * 입체 주식 분석 엔진 메인 오케스트레이션 함수
 */
export function runAnalysisEngine(
  ohlcvs: any[],
  mode: AnalysisMode = "scalp",
  prevPersistCycle = 0
): AIAnalysisResult {
  // 1. 기초 지표 계산
  const data = calculateIndicators(ohlcvs);

  // 2. 전문가 호출
  const tExpert = evaluateTrend(data);
  const eExpert = evaluateEnergy(data);
  const mExpert = evaluateMomentum(data);
  const experts = [tExpert, eExpert, mExpert];

  // 3. 상호 반박 및 교차 검증 (Audit Logs)
  const weights = WEIGHT_PROFILES[mode];
  const { logs, weightedScore, verdict } = crossCheck(experts, weights);

  // Phase 2: Veto Check
  const veto = checkVeto(data);
  let finalVerdict = verdict;

  if (veto.triggered) {
    logs.push({
      step: 3,
      expertName: "System",
      message: veto.reason,
      vetoTriggered: true,
      vetoSource: veto.source,
    });
    
    if (veto.priority === 'P1') {
      finalVerdict = "하락";
    } else if (veto.priority === 'P2' && Math.abs(weightedScore) < 0.6) {
      finalVerdict = "횡보/보합";
    }

    let targetExpertName = "";
    if (veto.source.includes("RSI")) targetExpertName = "모멘텀 전문가";
    else if (veto.source.includes("MFI")) targetExpertName = "에너지 전문가";
    else if (veto.source.includes("SMA60") || veto.source.includes("ADX")) targetExpertName = "파동/추세 전문가";
    
    const targetExpert = experts.find(e => e.expertName === targetExpertName);
    if (targetExpert) {
      targetExpert.vetoTriggered = true;
      targetExpert.vetoReason = veto.reason;
      targetExpert.vetoTriggerSource = veto.source;
    }
  }

  // 4. 전략(시나리오) 산출
  const strategy = calculateStrategy(data);

  const { state: marketState, persistCycleRemaining } = classifyMarketState(
    weightedScore,
    veto,
    data,
    prevPersistCycle
  );

  return {
    experts,
    auditLogs: logs,
    strategy,
    finalVerdict,
    weightedScore,
    mode,
    veto,
    marketState,
    marketStateLabel: MARKET_STATE_LABELS[marketState],
    persistCycleRemaining,
  };
}
