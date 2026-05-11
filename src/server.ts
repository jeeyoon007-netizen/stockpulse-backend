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
import { fetchMajorIndex, fetchExchangeRate, fetchMarketFunds, fetchDailyCreditBalance, fetchInvestorRanking } from './api/kis-market.js';
import { fetchKRXMarketSummary } from './api/krx.js';
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
  res.json(globalCache.investorFlow || {});
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

    // 2. 카나리아 데이터 (자금동향, 신용잔고, ADR)
    console.log("[FETCH] 카나리아 데이터 수집 중...");
    const [funds, creditHistory, kospiInfo, krxMarket] = await Promise.all([
      fetchMarketFunds().catch(e => { console.error("자금동향 에러:", e.message); return null; }),
      fetchDailyCreditBalance(20).catch(e => { console.error("신용잔고 에러:", e.message); return []; }),
      fetchMajorIndex("0001", "코스피").catch(() => null), // ADR용 재호출 (캐시 활용)
      fetchKRXMarketSummary('01').catch(e => { console.error("KRX 에러:", e.message); return null; }),
    ]);

    // ADR 계산
    const adv = krxMarket?.advanceCount || (kospiInfo as any)?.advanceCount || 0;
    const dec = krxMarket?.declineCount || (kospiInfo as any)?.declineCount || 0;
    let adr = 0;
    let adrSignal = "데이터 부족";
    if (adv && dec) {
      adr = (adv / dec) * 100;
      adrSignal = adr >= 120 ? "매도 검토 (과열)" : adr <= 80 ? "바닥권 신호 (과매도)" : "중립";
    }

    globalCache.canaryData = {
      funds,
      creditHistory,
      adr: adr.toFixed(1),
      adrSignal,
      advanceCount: adv,
      declineCount: dec,
      newHighCount: 0, // TODO: 52주 신고가 스크래퍼 연동
    };
    console.log(`[FETCH] 카나리아: ADR=${adr.toFixed(1)}% (${adrSignal})`);

    // 3. 공포탐욕지수
    console.log("[FETCH] 공포탐욕지수 수집 중...");
    globalCache.fearGreed = await fetchFearGreedIndex().catch(e => {
      console.error("공포탐욕지수 에러:", e.message);
      return null;
    });
    console.log(`[FETCH] 공포탐욕지수: ${globalCache.fearGreed ? '성공' : '실패'}`);

    // 4. 수급 데이터 (외인/기관)
    console.log("[FETCH] 수급 데이터 수집 중...");
    const [foreignKospi, instKospi] = await Promise.all([
      fetchInvestorRanking('1', '0001').catch(() => []),
      fetchInvestorRanking('2', '0001').catch(() => []),
    ]);
    globalCache.investorFlow = { foreignTop10: foreignKospi, instTop10: instKospi };
    console.log(`[FETCH] 수급: 외인=${foreignKospi.length}종목, 기관=${instKospi.length}종목`);

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
