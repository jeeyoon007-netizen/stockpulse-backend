import 'dotenv/config';
import { getAccessToken, KIS_BASE_URL, formatYYYYMMDD } from './api/kis.js';

async function testIndexDailyPrice() {
  const token = await getAccessToken();
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-indexprice?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=0001&FID_PERIOD_DIV_CODE=D`;
  
  const headers = {
    "Content-Type": "application/json",
    authorization: `Bearer ${token}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: "FHPST01740000",
    custtype: "P",
  };

  const res = await fetch(url, { headers });
  const data = await res.json();
  console.log(data);
  if (data.output2) {
    console.log(data.output2.slice(0, 3));
  } else if (data.output1) {
    console.log(data.output1.slice(0, 3));
  }
}

testIndexDailyPrice();
