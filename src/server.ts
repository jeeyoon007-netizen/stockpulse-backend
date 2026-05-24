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
import { fetchMajorIndex, fetchExchangeRate, fetchMarketFunds, fetchNewHighCount, fetchInvestorRanking, fetchADRFromInfo, fetchStockDetail } from './api/kis-market.js';
import { fetchFearGreedIndex, type FearGreedResponse } from './api/feargreed.js';
import { sendKakaoAlert } from './utils/alert.js';

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

    // 2. 카나리아 데이터 (자금동향, 신용잔고, ADR, 신고가)
    console.log("[FETCH] 카나리아 데이터 수집 중...");
    const [combinedCanary, newHighCount, adrData] = await Promise.all([
      fetchMarketFunds().catch(e => { console.error("자금동향/신용잔고 에러:", e.message); return { funds: null, creditHistory: [] }; }),
      fetchNewHighCount().catch(e => { console.error("신고가 에러:", e.message); return 0; }),
      fetchADRFromInfo().catch(e => { console.error("ADR 크롤링 에러:", e.message); return { kospi: null, kosdaq: null }; }),
    ]);

    globalCache.canaryData = {
      funds: combinedCanary.funds,
      creditHistory: combinedCanary.creditHistory,
      adrKospi: adrData.kospi,
      adrKosdaq: adrData.kosdaq,
      newHighCount: newHighCount || 0,
    };
    console.log(`[FETCH] 카나리아: KOSPI ADR=${adrData.kospi?.adr || 'N/A'}% (${adrData.kospi?.signal || 'N/A'}), KOSDAQ ADR=${adrData.kosdaq?.adr || 'N/A'}% (${adrData.kosdaq?.signal || 'N/A'}), 신고가=${newHighCount}종목`);

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
      const foreignTop10 = foreign.slice(0, 10);
      const instTop10 = institutional.slice(0, 10);
      const overlap = foreignTop10
        .filter((f: any) => instTop10.some((i: any) => i.code === f.code))
        .map((s: any) => ({ name: s.name, code: s.code }));

      const uniqueCodes = Array.from(new Set([...foreignTop10.map((s: any) => s.code), ...instTop10.map((s: any) => s.code)]));
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
          return { name: stock?.name || d.name || '알 수 없음', code };
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
