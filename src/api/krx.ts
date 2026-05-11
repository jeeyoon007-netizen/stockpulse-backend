/**
 * KRX (한국거래소) 데이터 연동 모듈
 */

const KRX_JSON_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";

function getTodayYYYYMMDD(): string {
  const now = new Date();
  const krTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  return krTime.toISOString().split('T')[0].replace(/-/g, '');
}

async function fetchKRXDirect(bld: string, params: Record<string, string>) {
  const body = new URLSearchParams({ bld, ...params });

  try {
    const response = await fetch(KRX_JSON_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: body.toString(),
    });

    if (!response.ok) throw new Error(`KRX API HTTP Error: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(`[KRX API] ${bld} 호출 중 오류:`, error);
    return null;
  }
}

/**
 * 52주 신고가 종목 수
 */
export async function fetchKRXNewHighCount(): Promise<number> {
  const today = getTodayYYYYMMDD();
  const data = await fetchKRXDirect("db/mdc/MDC/standard/MDCSTAT01601/data", {
    mktId: "ALL",
    trdDd: today,
    type: "1",
  });

  if (data && data.OutBlock_1) {
    return data.OutBlock_1.length;
  }
  return 0;
}

/**
 * 시장 요약 정보 (상승/하락 종목 수 - ADR 계산용)
 */
export async function fetchKRXMarketSummary(marketCode: '01' | '02' = '01') {
  const today = getTodayYYYYMMDD();
  const data = await fetchKRXDirect("db/mdc/MDC/standard/MDCSTAT00101/data", {
    idxIndMsclpCntnt: marketCode,
    trdDd: today,
  });

  if (data && (data.output || data.OutBlock_1)) {
    const out = data.output?.[0] || data.OutBlock_1?.[0];
    return {
      advanceCount: Number(out.ASCN_ISSU_CNT || 0),
      declineCount: Number(out.DOWN_ISSU_CNT || 0),
      upLimitCount: Number(out.UPLMT_ISSU_CNT || 0),
      downLimitCount: Number(out.DNLMT_ISSU_CNT || 0),
      flatCount: Number(out.STDY_ISSU_CNT || 0),
    };
  }
  return null;
}
