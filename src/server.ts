/**
 * StockPulse Backend Server
 * - 70초 주기 데이터 수집 → In-memory 캐시 → WebSocket 브로드캐스트
 * - /health 엔드포인트 (Render Sleep 방지)
 * - REST API 폴백 엔드포인트 (WebSocket 연결 불가 시)
 */
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';

dotenv.config();

// API 모듈 임포트
import { fetchMajorIndex, fetchExchangeRate, fetchMarketFunds, fetchNewHighCount, fetchInvestorRanking, fetchStockDetail } from './api/kis-market.js';
import { fetchFearGreedIndex, type FearGreedResponse } from './api/feargreed.js';
import { sendKakaoAlert } from './utils/alert.js';
import { fetchAndStoreInvestorFlow } from './api/kis-investor-daily.js';
import { calcConsecutiveDays, getSupplyBadge } from './api/badge-service.js';
import { supabase } from './api/supabase.js';
import cron from 'node-cron';
import { fetchStockOHLCV } from './api/kis-stock-ohlcv.js';
import { runAnalysisEngine, type AnalysisMode } from './api/analysis/engine.js';
import { fetchMarketCap } from './api/krx-market-cap.js';

// 날짜 포맷팅 헬퍼 (YYYYMMDD)
function getTodayDateStr(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${date}`;
}


const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 8080;
const FETCH_INTERVAL = 70 * 1000; // 70초

// ===== 70초 In-Memory 캐시 =====
interface GlobalCache {
  marketOverview: any | null;
  canaryData: any | null;
  fearGreed: FearGreedResponse | null;
  investorFlow: any | null;
  lastUpdated: number;
  error: string | null;
}

let globalCache: GlobalCache = {
  marketOverview: null,
  canaryData: null,
  fearGreed: null,
  investorFlow: null,
  lastUpdated: 0,
  error: null,
};

// ===== CORS 설정 =====
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // 배포 시 도메인으로 화이트리스트
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.use(express.json());

// ===== Health Check (Render Sleep 방지) =====
app.get('/health', (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "stockpulse-backend"
  });
});

// ===== REST API 폴백 =====
app.get('/api/v1/market/overview', (req, res) => {
  res.json(globalCache.marketOverview || []);
});

app.get('/api/v1/market/canary', (req, res) => {
  res.json(globalCache.canaryData || {});
});

app.get('/api/v1/market/fear-greed', (req, res) => {
  res.json(globalCache.fearGreed || {});
});

app.get('/api/v1/market/investor-flow', (req, res) => {
  const market = (req.query.market as string) || '0001';
  const flow = globalCache.investorFlow;
  if (!flow) return res.json({ foreignTop10: [], instTop10: [], overlap: [], dominantIndustries: [], highTurnover: [] });
  // market별 분석 결과 반환
  const key = market === '1001' ? 'kosdaq' : 'kospi';
  res.json(flow[key] || { foreignTop10: [], instTop10: [], overlap: [], dominantIndustries: [], highTurnover: [] });
});

app.get('/api/v1/cache-status', (req, res) => {
  res.json({
    lastUpdated: globalCache.lastUpdated ? new Date(globalCache.lastUpdated).toISOString() : null,
    hasMarketOverview: !!globalCache.marketOverview,
    hasCanaryData: !!globalCache.canaryData,
    hasFearGreed: !!globalCache.fearGreed,
    hasInvestorFlow: !!globalCache.investorFlow,
    connectedClients: wss.clients.size,
    error: globalCache.error,
  });
});

// ===== 수급 수집 크론 및 뱃지 수동 수집 트리거 =====
app.post('/api/v1/market/collect-flow', async (req, res) => {
  const { date } = req.body;
  const todayStr = date || getTodayDateStr();

  try {
    console.log(`[ROUTE] Triggered investor flow collection for date: ${todayStr}`);

    const [foreignKospi, instKospi, foreignKosdaq, instKosdaq] = await Promise.all([
      fetchInvestorRanking('1', '0001').catch(() => []),
      fetchInvestorRanking('2', '0001').catch(() => []),
      fetchInvestorRanking('1', '1001').catch(() => []),
      fetchInvestorRanking('2', '1001').catch(() => []),
    ]);

    const allStocks = [
      ...foreignKospi.slice(0, 10).map((s: any) => s.code),
      ...instKospi.slice(0, 10).map((s: any) => s.code),
      ...foreignKosdaq.slice(0, 10).map((s: any) => s.code),
      ...instKosdaq.slice(0, 10).map((s: any) => s.code)
    ];

    const uniqueCodes = Array.from(new Set(allStocks));

    if (uniqueCodes.length === 0) {
      return res.status(400).json({ error: "No active stock codes returned from KIS rankings." });
    }

    // 백그라운드 수집 실행 (비동기로 응답 후 대기)
    fetchAndStoreInvestorFlow(uniqueCodes, todayStr)
      .then(() => {
        console.log("[ROUTE] Background investor flow collection complete.");
        // 캐시 데이터 새로고침 트리거
        fetchAllMarketData().catch(e => console.error("Error refreshing cache:", e));
      })
      .catch(err => console.error("[ROUTE] Background investor flow collection error:", err));

    res.status(202).json({
      status: "processing",
      message: `Triggered collection for ${uniqueCodes.length} unique stocks.`,
      stocks: uniqueCodes
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ===== 주식 분석 엔진 통합 엔드포인트 =====
app.post('/api/v1/analysis/run', async (req, res) => {
  const code = (req.query.code as string) || req.body?.code;
  const mode = (req.query.mode as AnalysisMode) || req.body?.mode || 'scalp';
  
  if (!code) {
    return res.status(400).json({ success: false, error: "종목 코드가 필요합니다." });
  }

  try {
    const stockData = await fetchStockOHLCV(code, 240);
    let prevPersistCycle = 0;
    
    if (supabase) {
      const { data: prev } = await supabase
        .from('analysis_states')
        .select('market_state, persist_cycle_remaining, analyzed_at')
        .eq('stock_code', code)
        .order('analyzed_at', { ascending: false })
        .limit(1)
        .single();

      if (prev?.persist_cycle_remaining && prev.persist_cycle_remaining > 0) {
        const elapsed = Date.now() - new Date(prev.analyzed_at).getTime();
        const MIN_COOLDOWN_MS = 5 * 60 * 1000;
        if (elapsed < MIN_COOLDOWN_MS) {
          prevPersistCycle = prev.persist_cycle_remaining + 1;
        } else {
          prevPersistCycle = prev.persist_cycle_remaining;
        }
      }
    }

    const result = runAnalysisEngine(stockData.ohlcv, mode as AnalysisMode, prevPersistCycle);

    if (supabase) {
      const { error: dbError } = await supabase.from('analysis_logs').insert({
        stock_code: code,
        stock_name: stockData.name,
        current_price: stockData.currentPrice,
        audit_logs: result.auditLogs,
        strategy_scenario: result.strategy,
        experts_opinion: result.experts
      });

      const { error: stateError } = await supabase.from('analysis_states').insert({
        stock_code: code,
        market_state: result.marketState,
        mode,
        weighted_score: result.weightedScore,
        veto_triggered: result.veto.triggered,
        veto_source: result.veto.source || null,
        persist_cycle_remaining: result.persistCycleRemaining,
      });

      if (dbError || stateError) {
        console.error("[ANALYSIS DB ERROR] 분석 결과 저장 실패:", (dbError || stateError)?.message);
      }
    }

    res.json({
      success: true,
      stockData: {
        code: stockData.code,
        name: stockData.name,
        currentPrice: stockData.currentPrice,
        change: stockData.change,
        changePercent: stockData.changePercent,
        ohlcv: stockData.ohlcv
      },
      analysis: result
    });
  } catch (error: any) {
    console.error(`[ANALYSIS ERROR] ${code}: ${error.message}`);
    res.status(500).json({ success: false, error: error.message || "알 수 없는 에러가 발생했습니다." });
  }
});

// ===== 70초 주기 백그라운드 데이터 수집 =====
async function fetchAllMarketData() {
  const startTime = Date.now();
  console.log(`\n[${new Date().toISOString()}] ========== 데이터 수집 시작 ==========`);

  try {
    // 1. 시장 지수 (코스피, 코스닥, 코스피200, 환율) — 병렬
    console.log("[FETCH] 시장 지수 수집 중...");
    const [kospi, kosdaq, kospi200, exchangeRate] = await Promise.all([
      fetchMajorIndex("0001", "코스피").catch(e => { console.error("코스피 에러:", e.message); return null; }),
      fetchMajorIndex("1001", "코스닥").catch(e => { console.error("코스닥 에러:", e.message); return null; }),
      fetchMajorIndex("2001", "코스피200").catch(e => { console.error("코스피200 에러:", e.message); return null; }),
      fetchExchangeRate().catch(e => { console.error("환율 에러:", e.message); return null; }),
    ]);
    globalCache.marketOverview = [kospi, kosdaq, kospi200, exchangeRate].filter(Boolean);
    console.log(`[FETCH] 시장 지수: ${globalCache.marketOverview.length}개 수집 완료`);

    // 2. 카나리아 데이터 (자금동향, 신용잔고, 신고가)
    // ⚠️ ADR은 Render IP 차단(403)으로 크롤링 불가 → 프론트 Vercel에서 직접 수행
    console.log("[FETCH] 카나리아 데이터 수집 중...");
    const [combinedCanary, newHighResult, marketCaps] = await Promise.all([
      fetchMarketFunds().catch(e => { console.error("자금동향/신용잔고 에러:", e.message); return { funds: null, creditHistory: [] }; }),
      fetchNewHighCount().catch(e => { console.error("신고가 에러:", e.message); return { count: 0, sectors: [] }; }),
      fetchMarketCap().catch(e => { console.error("시가총액 에러:", e.message); return null; })
    ]);

    let creditDepositRatio = null;
    let creditMarketCapRatio = null;

    if (combinedCanary.funds && combinedCanary.funds.deposit > 0) {
      creditDepositRatio = (combinedCanary.funds.margin_loan / combinedCanary.funds.deposit) * 100;
    }
    
    if (combinedCanary.funds && marketCaps) {
      const totalCap = marketCaps.kospi + marketCaps.kosdaq;
      if (totalCap > 0) {
        creditMarketCapRatio = (combinedCanary.funds.margin_loan / totalCap) * 100;
      }
    }

    globalCache.canaryData = {
      funds: combinedCanary.funds,
      creditHistory: combinedCanary.creditHistory,
      adrKospi: null,   // ADR: Vercel 프론트에서 fetchADRFromInfo() 호출
      adrKosdaq: null,  // ADR: Vercel 프론트에서 fetchADRFromInfo() 호출
      newHighCount: newHighResult?.count || 0,
      newHighSectors: newHighResult?.sectors || [],
      creditDepositRatio,
      creditMarketCapRatio,
      marketCaps
    };

    // Supabase에 신고가 데이터 누적 저장 (실시간 T+0 영업일 기준)
    try {
      if (supabase && newHighResult && newHighResult.count > 0) {
        const kstDate = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const yyyy = kstDate.getUTCFullYear();
        const mm = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(kstDate.getUTCDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;

        const { error: upsertError } = await supabase
          .from('market_new_highs_history')
          .upsert({
            trade_date: todayStr,
            new_high_count: newHighResult.count,
            new_high_sectors: newHighResult.sectors,
          }, { onConflict: 'trade_date' });

        if (upsertError) {
          console.error("[SUPABASE] market_new_highs_history upsert error:", upsertError.message);
        } else {
          console.log(`[SUPABASE] Successfully upserted new highs for ${todayStr}: count=${newHighResult.count}`);
        }
      }
    } catch (dbErr: any) {
      console.error("[SUPABASE] DB exception:", dbErr.message);
    }
    console.log(`[FETCH] 카나리아: 신고가=${newHighResult?.count}종목, 업종수=${newHighResult?.sectors?.length || 0} (예탁금·신용잔고 포함, ADR은 프론트에서 크롤링)`);

    // 3. 공포탐욕지수
    console.log("[FETCH] 공포탐욕지수 수집 중...");
    globalCache.fearGreed = await fetchFearGreedIndex().catch(e => {
      console.error("공포탐욕지수 에러:", e.message);
      return null;
    });
    console.log(`[FETCH] 공포탐욕지수: ${globalCache.fearGreed ? '성공' : '실패'}`);

    // 4. 수급 데이터 (외인/기관) — KOSPI + KOSDAQ 분석 포함
    console.log("[FETCH] 수급 데이터 수집 중...");
    const [foreignKospi, instKospi, foreignKosdaq, instKosdaq] = await Promise.all([
      fetchInvestorRanking('1', '0001').catch(() => []),
      fetchInvestorRanking('2', '0001').catch(() => []),
      fetchInvestorRanking('1', '1001').catch(() => []),
      fetchInvestorRanking('2', '1001').catch(() => []),
    ]);
    console.log(`[FETCH] 수급 raw: KOSPI 외인=${foreignKospi.length}, 기관=${instKospi.length} / KOSDAQ 외인=${foreignKosdaq.length}, 기관=${instKosdaq.length}`);

    // 수급 분석 헬퍼 (백엔드에서 처리 → Vercel 타임아웃 방지)
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    async function analyzeInvestorFlow(foreign: any[], institutional: any[], market: string) {
      const foreignTop10Raw = foreign.slice(0, 10);
      const instTop10Raw = institutional.slice(0, 10);
      
      const uniqueCodes = Array.from(new Set([...foreignTop10Raw.map((s: any) => s.code), ...instTop10Raw.map((s: any) => s.code)]));
      
      // 1. Supabase 기반 연속 순매수 일수 계산 및 뱃지 생성
      const todayStr = getTodayDateStr();
      const badgeMap = new Map<string, string>();
      for (const code of uniqueCodes) {
        try {
          const frgnDays = await calcConsecutiveDays(code as string, 'frgn', todayStr);
          const orgnDays = await calcConsecutiveDays(code as string, 'orgn', todayStr);
          const badge = getSupplyBadge(frgnDays, orgnDays);
          badgeMap.set(code as string, badge);
        } catch (err: any) {
          console.error(`[BADGE CALCULATOR] Error for ${code}:`, err.message);
          badgeMap.set(code as string, "");
        }
      }

      const foreignTop10 = foreignTop10Raw.map((s: any) => ({
        ...s,
        badge: badgeMap.get(s.code) || ""
      }));

      const instTop10 = instTop10Raw.map((s: any) => ({
        ...s,
        badge: badgeMap.get(s.code) || ""
      }));

      const overlap = foreignTop10
        .filter((f: any) => instTop10.some((i: any) => i.code === f.code))
        .map((s: any) => ({ name: s.name, code: s.code, badge: badgeMap.get(s.code) || "" }));

      const detailMap = new Map();
      for (const code of uniqueCodes) {
        const d = await fetchStockDetail(code as string, 'J').catch(() => null);
        if (d) detailMap.set(code, d);
        await delay(150);
      }

      const industryCount: Record<string, number> = {};
      detailMap.forEach((d: any) => {
        if (d.industry) industryCount[d.industry] = (industryCount[d.industry] || 0) + 1;
      });
      const dominantIndustries = Object.entries(industryCount)
        .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name);

      const threshold = market === '1001' ? 0.5 : 0.15;
      const highTurnover = Array.from(detailMap.entries())
        .filter(([code, detail]: [any, any]) => {
          const stock = [...foreignTop10, ...instTop10].find((s: any) => s.code === code);
          if (!stock || detail.marketCap === 0) return false;
          const amountInEok = stock.amount / 100000000;
          const ratio = (amountInEok / detail.marketCap) * 100;
          return ratio > threshold;
        })
        .map(([code, d]: [any, any]) => {
          const stock = [...foreignTop10, ...instTop10].find((s: any) => s.code === code);
          return { name: stock?.name || d.name || '알 수 없음', code, badge: badgeMap.get(code) || "" };
        });

      return { foreignTop10, instTop10, overlap, dominantIndustries, highTurnover };
    }

    const [kospiAnalysis, kosdaqAnalysis] = await Promise.all([
      analyzeInvestorFlow(foreignKospi, instKospi, '0001').catch(() => ({ foreignTop10: foreignKospi.slice(0,10), instTop10: instKospi.slice(0,10), overlap: [], dominantIndustries: [], highTurnover: [] })),
      analyzeInvestorFlow(foreignKosdaq, instKosdaq, '1001').catch(() => ({ foreignTop10: foreignKosdaq.slice(0,10), instTop10: instKosdaq.slice(0,10), overlap: [], dominantIndustries: [], highTurnover: [] })),
    ]);

    globalCache.investorFlow = { kospi: kospiAnalysis, kosdaq: kosdaqAnalysis };
    console.log(`[FETCH] 수급 분석 완료: KOSPI overlap=${kospiAnalysis.overlap.length}, KOSDAQ overlap=${kosdaqAnalysis.overlap.length}`);

    // 캐시 갱신 시점 기록
    globalCache.lastUpdated = Date.now();
    globalCache.error = null;

    const elapsed = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ========== 수집 완료 (${elapsed}ms) ==========\n`);

    // 브로드캐스트
    broadcastToClients();

  } catch (error: any) {
    const errMsg = `[CRITICAL] 데이터 수집 실패: ${error.message}`;
    console.error(errMsg);
    globalCache.error = error.message;
    await sendKakaoAlert(errMsg);
  }
}

// ===== WebSocket 브로드캐스트 =====
function broadcastToClients() {
  if (wss.clients.size === 0) return;

  const payload = JSON.stringify({
    type: 'MARKET_UPDATE',
    data: {
      marketOverview: globalCache.marketOverview,
      canaryData: globalCache.canaryData,
      fearGreed: globalCache.fearGreed,
      investorFlow: globalCache.investorFlow,
      lastUpdated: globalCache.lastUpdated,
    },
  });

  let sent = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
      sent++;
    }
  });
  console.log(`[WS] ${sent}명에게 브로드캐스트 완료`);
}

// ===== WebSocket 연결 처리 =====
wss.on('connection', (ws) => {
  console.log(`[WS] 클라이언트 접속 (총 ${wss.clients.size}명)`);

  // 접속 즉시 캐시된 최신 데이터 전송
  if (globalCache.lastUpdated > 0) {
    ws.send(JSON.stringify({
      type: 'MARKET_UPDATE',
      data: {
        marketOverview: globalCache.marketOverview,
        canaryData: globalCache.canaryData,
        fearGreed: globalCache.fearGreed,
        investorFlow: globalCache.investorFlow,
        lastUpdated: globalCache.lastUpdated,
      },
    }));
  }

  ws.on('close', () => {
    console.log(`[WS] 클라이언트 종료 (남은 ${wss.clients.size}명)`);
  });

  ws.on('error', (err) => {
    console.error('[WS] 클라이언트 에러:', err.message);
  });
});

// ===== 서버 시작 =====
server.listen(PORT, () => {
  console.log(`\n🚀 StockPulse API Server running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`   Fetch Interval: ${FETCH_INTERVAL / 1000}초\n`);

  // 최초 1회 실행
  fetchAllMarketData();

  // 70초 주기 반복
  setInterval(fetchAllMarketData, FETCH_INTERVAL);
});

// YYYY-MM-DD 형식의 오늘 날짜 구하기
const todayStr = new Date().toISOString().split('T')[0];

// 스케줄러: 매일 오후 15시 40분에 실행 (월~금)
cron.schedule('40 15 * * 1-5', async () => {
  console.log('[CRON] 장마감 자동 분석 스케줄러 실행 (15:40)');
  // 추후 전 종목 또는 관심 종목 리스트를 불러와서 자동 분석을 돌리는 로직 추가
});