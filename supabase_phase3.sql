-- Supabase Phase 3: 백테스트 파이프라인 및 관심 종목 스키마

-- 1. watchlists (닉네임 기반 개인 관심종목)
CREATE TABLE IF NOT EXISTS watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname VARCHAR(5) NOT NULL,
  stock_code VARCHAR(10) NOT NULL,
  stock_name VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(nickname, stock_code)
);
CREATE INDEX IF NOT EXISTS idx_watchlists_nickname ON watchlists(nickname);

-- 2. backtest_targets (배치 처리를 위한 통합 타겟, 최대 150종목)
CREATE TABLE IF NOT EXISTS backtest_targets (
  stock_code VARCHAR(10) PRIMARY KEY,
  stock_name VARCHAR(50) NOT NULL,
  last_viewed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_backtest_targets_last_viewed ON backtest_targets(last_viewed_at);

-- 3. backtest_results (백테스트 캐싱 결과)
CREATE TABLE IF NOT EXISTS backtest_results (
  stock_code VARCHAR(10) PRIMARY KEY,
  best_strategy_name VARCHAR(50),
  best_strategy_desc TEXT,
  win_rate FLOAT,
  total_return FLOAT,
  mdd FLOAT,
  trade_count INT,
  analyzed_at TIMESTAMPTZ DEFAULT now()
);

-- 4. backtest_trades (차트 표시용 가상 매매 타점 내역)
CREATE TABLE IF NOT EXISTS backtest_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_code VARCHAR(10) NOT NULL,
  trade_date VARCHAR(10) NOT NULL, -- YYYY-MM-DD
  action VARCHAR(4) NOT NULL, -- 'Buy' or 'Sell'
  price BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_code ON backtest_trades(stock_code);
