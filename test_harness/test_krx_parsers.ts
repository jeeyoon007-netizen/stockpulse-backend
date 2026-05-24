import { parseMajorIndex, parseExchangeRate, parseCanaryCombined } from '../src/api/parsers/kis_parser.js';

function runParserTests() {
  console.log('=== [START] Running KIS & ECOS Offline Parser Tests ===\n');
  let passCount = 0;
  let failCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passCount++;
    } else {
      console.error(`[FAIL] ${testName}`);
      if (detail) console.error(`       Detail: ${detail}`);
      failCount++;
    }
  }

  // 1. Test parseMajorIndex
  try {
    const mockIndexData = {
      rt_cd: "0",
      output: {
        bstp_nmix_prpr: "2650.15",
        bstp_nmix_prdy_vrss: "15.40",
        bstp_nmix_prdy_ctrt: "0.58",
        ascn_issu_cnt: "520",
        down_issu_cnt: "310",
      }
    };
    
    const parsed = parseMajorIndex(mockIndexData, "코스피");
    assert(parsed !== null, "parseMajorIndex - Null Check");
    if (parsed) {
      assert(parsed.label === "코스피", "parseMajorIndex - Label check");
      assert(parsed.value === "2,650.15", "parseMajorIndex - Value formating check");
      assert(parsed.change === "+15.40", "parseMajorIndex - Change format check");
      assert(parsed.changePercent === "+0.58%", "parseMajorIndex - ChangePercent check");
      assert(parsed.direction === "up", "parseMajorIndex - Direction check");
      assert(parsed.advanceCount === 520, "parseMajorIndex - Advance count check");
      assert(parsed.declineCount === 310, "parseMajorIndex - Decline count check");
    }
  } catch (e: any) {
    assert(false, "parseMajorIndex - Exception thrown", e.message);
  }

  // 2. Test parseExchangeRate
  try {
    const mockEcosData = {
      StatisticSearch: {
        row: [
          { DATA_VALUE: "1350.00" }, // Previous
          { DATA_VALUE: "1355.50" }  // Latest
        ]
      }
    };
    
    const parsedRate = parseExchangeRate(mockEcosData);
    assert(parsedRate !== null, "parseExchangeRate - Null Check");
    if (parsedRate) {
      assert(parsedRate.label === "원/달러", "parseExchangeRate - Label check");
      assert(parsedRate.value === "1,355.50", "parseExchangeRate - Value check");
      assert(parsedRate.change === "+5.50", "parseExchangeRate - Change check");
      assert(parsedRate.changePercent === "+0.41%", "parseExchangeRate - ChangePercent check");
      assert(parsedRate.direction === "up", "parseExchangeRate - Direction check");
    }
  } catch (e: any) {
    assert(false, "parseExchangeRate - Exception thrown", e.message);
  }

  // 3. Test parseCanaryCombined (Funds & Credit History)
  try {
    const mockMktFundsData = {
      rt_cd: "0",
      output: [
        {
          bsop_date: "20260524",
          cust_dpmn_amt: "50000",  // 50000 * 100M
          crdt_loan_rmnd: "20000", // 20000 * 100M
          uncl_amt: "1000"         // 1000 * 100M
        },
        {
          bsop_date: "20260523",
          cust_dpmn_amt: "49500",
          crdt_loan_rmnd: "19800",
          uncl_amt: "950"
        }
      ]
    };
    
    const canary = parseCanaryCombined(mockMktFundsData, 1);
    assert(canary.funds !== null, "parseCanaryCombined - Funds check");
    if (canary.funds) {
      assert(canary.funds.deposit === 5000000000000, "parseCanaryCombined - Deposit unit conversion check");
      assert(canary.funds.margin_loan === 2000000000000, "parseCanaryCombined - Margin loan unit conversion check");
    }
    assert(canary.creditHistory.length === 1, "parseCanaryCombined - Credit history slice length check");
    if (canary.creditHistory.length > 0) {
      const hist = canary.creditHistory[0];
      assert(hist.date === "20260524", "parseCanaryCombined - History date check");
      assert(hist.amount === 2000000000000, "parseCanaryCombined - History amount check");
      assert(Math.abs(hist.ratio - 1.01) < 0.001, "parseCanaryCombined - Credit growth ratio check (Expected: 1.01)");
    }
  } catch (e: any) {
    assert(false, "parseCanaryCombined - Exception thrown", e.message);
  }

  console.log(`\n=== [END] Tests Run Summary: ${passCount} Passed, ${failCount} Failed ===\n`);
  
  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runParserTests();
