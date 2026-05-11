/**
 * 공포탐욕지수 수집 모듈
 */

export interface FearGreedIndicator {
  name: string;
  value: number;
  raw?: number;
  unit?: string;
  barMax?: number;
}

export interface FearGreedMarketData {
  score: number;
  label: string;
  indicators: FearGreedIndicator[];
  previous_close?: number;
  previous_1_week?: number;
  kospi_price?: string;
  kospi_change?: string;
  kosdaq_change?: string;
  vkospi?: string;
}

export interface FearGreedHistory {
  date: string;
  us: number;
  kr: number;
}

export interface FearGreedResponse {
  success: boolean;
  timestamp: string;
  us: FearGreedMarketData;
  kr: FearGreedMarketData;
  history: FearGreedHistory[];
}

/**
 * 한국/미국 공포탐욕지수 데이터
 */
export async function fetchFearGreedIndex(): Promise<FearGreedResponse> {
  const url = "https://feargree-api.vercel.app/api";

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fear & Greed API 호출 실패: ${res.status}`);
  }

  return (await res.json()) as FearGreedResponse;
}
