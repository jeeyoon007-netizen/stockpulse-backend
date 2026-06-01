/**
 * KIS (한국투자증권) 인증 모듈
 * - OAuth 2.0 토큰 발급 및 캐싱
 * - 중복 토큰 요청 방지
 */

const IS_VTS = process.env.KIS_VTS === "true";
export const KIS_BASE_URL = IS_VTS 
  ? "https://openapivts.koreainvestment.com:29443" 
  : "https://openapi.koreainvestment.com:9443";

console.log(`[KIS API] Using ${IS_VTS ? "VIRTUAL" : "REAL"} server: ${KIS_BASE_URL}`);

// 인메모리 토큰 캐싱 (단일 인스턴스 전용)
// 스케일 아웃 시 각 인스턴스가 독립적으로 토큰을 발급해 KIS "분당 1회" 제한에 걸릴 수 있음.
// 복수 인스턴스 운영이 필요하면 토큰을 Supabase 테이블 또는 Redis로 옮겨야 함.
let cachedToken = "";
let tokenExpiry = 0;
let tokenPromise: Promise<string> | null = null;

/**
 * 한국투자증권 API OAuth 2.0 Access Token 발급
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();

  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  // 발급이 진행 중이면 기존 Promise 재사용 (중복 호출 방지)
  if (tokenPromise) {
    return tokenPromise;
  }

  tokenPromise = (async () => {
    try {
      const appKey = process.env.KIS_APP_KEY;
      const appSecret = process.env.KIS_APP_SECRET;

      if (!appKey || !appSecret) {
        throw new Error("환경변수에 KIS_APP_KEY 또는 KIS_APP_SECRET이 설정되지 않았습니다.");
      }

      console.log("[KIS AUTH] Requesting new access token...");
      const res = await fetch(`${KIS_BASE_URL}/oauth2/tokenP`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          appkey: appKey,
          appsecret: appSecret,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`토큰 발급 실패: ${res.status} ${errorBody}`);
      }

      const data = await res.json();
      console.log("[KIS AUTH] Access token acquired successfully.");
      
      cachedToken = data.access_token;
      tokenExpiry = now + data.expires_in * 1000 - 3600000; // 1시간 여유

      return cachedToken;
    } finally {
      tokenPromise = null;
    }
  })();

  return tokenPromise;
}

// YYYYMMDD 포맷 도우미
export function formatYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
