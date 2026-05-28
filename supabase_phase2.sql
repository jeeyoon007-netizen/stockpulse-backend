-- Supabase Phase 2 마이그레이션: 매크로 자금동향 시계열 테이블

-- 1. 예탁금 및 증시자금 추이
CREATE TABLE IF NOT EXISTS market_funds_history (
  trade_date  date PRIMARY KEY,
  deposit     bigint NOT NULL,
  margin_loan bigint NOT NULL,
  misu        bigint NOT NULL,
  created_at  timestamptz DEFAULT now()
);

-- 2. 신용잔고 추이 (상세 데이터)
CREATE TABLE IF NOT EXISTS market_credit_history (
  trade_date  date PRIMARY KEY,
  amount      bigint NOT NULL,
  ratio       float NOT NULL,
  created_at  timestamptz DEFAULT now()
);

-- 조회 성능 향상을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_funds_history_date ON market_funds_history (trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_credit_history_date ON market_credit_history (trade_date DESC);
