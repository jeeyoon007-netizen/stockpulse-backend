async function fetchKRXDirect(bld, params) {
  const KRX_JSON_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
  const body = new URLSearchParams({ bld, ...params });

  const response = await fetch(KRX_JSON_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': 'https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: body.toString(),
  });
  return response.json();
}

async function run() {
  const data = await fetchKRXDirect("db/mdc/MDC/standard/MDCSTAT00101/data", {
    idxIndMsclpCntnt: '01',
    trdDd: '20260514',
  });
  console.log("KOSPI:", data.output?.[0]);

  const data2 = await fetchKRXDirect("db/mdc/MDC/standard/MDCSTAT00101/data", {
    idxIndMsclpCntnt: '02',
    trdDd: '20260514',
  });
  console.log("KOSDAQ:", data2.output?.[0]);

  const newHigh = await fetchKRXDirect("db/mdc/MDC/standard/MDCSTAT01601/data", {
    mktId: "ALL",
    trdDd: '20260514',
    type: "1",
  });
  console.log("New High Count:", newHigh.OutBlock_1?.length);
}

run();
