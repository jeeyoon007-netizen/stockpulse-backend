import 'dotenv/config';
import { getAccessToken, KIS_BASE_URL } from './src/api/kis.js';

async function testIndex() {
  const token = await getAccessToken();
  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-index-category-price?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=0001`;
  const res = await fetch(url, { headers: { authorization: 'Bearer '+token, appkey: process.env.KIS_APP_KEY!, appsecret: process.env.KIS_APP_SECRET!, tr_id: 'FHPUP02110000', custtype: 'P' } });
  const data = await res.json();
  console.log(data);
}

testIndex();
