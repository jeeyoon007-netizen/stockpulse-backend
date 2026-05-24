import 'dotenv/config';
import { fetchMajorIndex, fetchMarketFunds, fetchNewHighCount, fetchADRFromInfo } from './api/kis-market.js';

async function run() {
    console.log("=== Testing Unified Canary API ===");

    try {
        console.log("1. Fetching Market Funds & Credit History...");
        const canary = await fetchMarketFunds();
        console.log("Funds:", canary.funds);
        console.log("Credit History Length:", canary.creditHistory.length);
        if (canary.creditHistory.length > 0) {
            console.log("Latest Credit History:", canary.creditHistory[canary.creditHistory.length - 1]);
        }
    } catch (e) {
        console.error("Market Funds Error:", e);
    }

    try {
        console.log("\n2. Fetching New High Count...");
        const newHigh = await fetchNewHighCount();
        console.log("KRX New High:", newHigh);
    } catch (e) {
        console.error("New High Error:", e);
    }

    try {
        console.log("\n3. Fetching ADR from adrinfo.kr...");
        const adrData = await fetchADRFromInfo();
        console.log("KOSPI ADR:", adrData.kospi);
        console.log("KOSDAQ ADR:", adrData.kosdaq);
    } catch (e) {
        console.error("ADR Fetch Error:", e);
    }
}

run();
