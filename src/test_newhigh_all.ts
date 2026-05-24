import 'dotenv/config';
import { getAccessToken, KIS_BASE_URL, formatYYYYMMDD } from './api/kis.js';

async function testNewHigh() {
  const token = await getAccessToken();
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/near-new-highlow?fid_cond_mrkt_div_code=J&fid_cond_scr_div_code=20187&fid_div_cls_code=0&fid_input_cnt_1=0&fid_input_cnt_2=0&fid_prc_cls_code=0&fid_input_iscd=0000&fid_trgt_cls_code=0&fid_trgt_exls_cls_code=0&fid_aply_rang_prc_1=0&fid_aply_rang_prc_2=1000000&fid_aply_rang_vol=0`;
  // fid_input_iscd=0000 is ALL markets? Let's check.
  const headers = {
    "Content-Type": "application/json",
    authorization: `Bearer ${token}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: "FHPST01870000",
    custtype: "P",
  };

  const res = await fetch(url, { headers });
  const data = await res.json();
  console.log("Total array length:", data.output?.length);
  if (data.output?.length > 0) {
      console.log("First item:", data.output[0]);
  }
}

testNewHigh();
