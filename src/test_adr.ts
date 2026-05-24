import 'dotenv/config';
import { getAccessToken, KIS_BASE_URL, formatYYYYMMDD } from './api/kis.js';

async function testIndexDaily() {
  const token = await getAccessToken();
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=0001&FID_INPUT_DATE_1=20260401&FID_INPUT_DATE_2=${formatYYYYMMDD(new Date())}&FID_PERIOD_DIV_CODE=D`;
  
  const headers = {
    "Content-Type": "application/json",
    authorization: `Bearer ${token}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: "FHKUP03500100", // Might need to check TR_ID
    custtype: "P",
  };

  const res = await fetch(url, { headers });
  const data = await res.json();
  console.log(data);
  if (data.output2) {
    console.log(data.output2.slice(0, 5));
  }
}

testIndexDaily();
