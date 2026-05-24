import 'dotenv/config';
import { getAccessToken, KIS_BASE_URL, formatYYYYMMDD } from './api/kis.js';

async function run() {
    console.log("=== Testing Raw KIS API ===");
    try {
        const token = await getAccessToken();
        const appKey = process.env.KIS_APP_KEY!;
        const appSecret = process.env.KIS_APP_SECRET!;
        
        const dateStr = formatYYYYMMDD(new Date());
        const fundsUrl = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/mktfunds?FID_INPUT_DATE_1=${dateStr}`;
        const headers = {
            "Content-Type": "application/json",
            authorization: `Bearer ${token}`,
            appkey: appKey,
            appsecret: appSecret,
            tr_id: "FHKST649100C0",
            custtype: "P",
        };
        
        console.log("Fetching Funds...");
        const res = await fetch(fundsUrl, { headers });
        const data = await res.json();
        console.log("Funds Response:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Funds Error:", e);
    }

    try {
        const token = await getAccessToken();
        const appKey = process.env.KIS_APP_KEY!;
        const appSecret = process.env.KIS_APP_SECRET!;
        
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 40);
        const startStr = formatYYYYMMDD(startDate);
        
        const creditUrl = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/daily-credit-balance?FID_COND_MRKT_DIV_CODE=J&FID_COND_SCR_DIV_CODE=20476&FID_INPUT_ISCD=0000&FID_INPUT_DATE_1=${startStr}`;
        const headers = {
            "Content-Type": "application/json",
            authorization: `Bearer ${token}`,
            appkey: appKey,
            appsecret: appSecret,
            tr_id: "FHPST04760000",
            custtype: "P",
        };
        
        console.log("Fetching Credit...");
        const res = await fetch(creditUrl, { headers });
        const data = await res.json();
        console.log("Credit Response:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Credit Error:", e);
    }
}

run();
