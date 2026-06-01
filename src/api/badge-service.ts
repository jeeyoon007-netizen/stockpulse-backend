import { supabase } from './supabase.js';

/**
 * Supabase에서 stock_code의 수급 이력을 조회해서
 * asOfDate 기준으로 최근부터 역순으로 연속 순매수(> 0)인 날을 카운트
 * - actor: "frgn" 또는 "orgn" (또는 대금 기준일 경우 "frgn_amt", "orgn_amt")
 */
export async function calcConsecutiveDays(stockCode: string, actor: 'frgn' | 'orgn' | 'frgn_amt' | 'orgn_amt', asOfDate: string): Promise<number> {
  // YYYYMMDD -> YYYY-MM-DD 포맷 변환
  let formattedAsOfDate = asOfDate;
  if (asOfDate.length === 8 && !asOfDate.includes('-')) {
    const yyyy = asOfDate.substring(0, 4);
    const mm = asOfDate.substring(4, 6);
    const dd = asOfDate.substring(6, 8);
    formattedAsOfDate = `${yyyy}-${mm}-${dd}`;
  }

  if (!supabase) {
    console.error(`[BADGE] Supabase client is not initialized.`);
    return 0;
  }

  // 30 영업일 치의 이력 조회
  const { data, error } = await supabase
    .from('stock_investor_flow')
    .select('trade_date, frgn_ntby, orgn_ntby, frgn_ntby_amt, orgn_ntby_amt')
    .eq('stock_code', stockCode)
    .lte('trade_date', formattedAsOfDate)
    .order('trade_date', { ascending: false })
    .limit(30);

  if (error) {
    console.error(`[BADGE] Error fetching history for ${stockCode}:`, error.message);
    return 0;
  }

  if (!data || data.length === 0) {
    return 0;
  }

  // 대상 컬럼 결정
  let targetField: 'frgn_ntby' | 'orgn_ntby' | 'frgn_ntby_amt' | 'orgn_ntby_amt';
  if (actor === 'frgn') {
    targetField = 'frgn_ntby';
  } else if (actor === 'frgn_amt') {
    targetField = 'frgn_ntby_amt';
  } else if (actor === 'orgn') {
    targetField = 'orgn_ntby';
  } else if (actor === 'orgn_amt') {
    targetField = 'orgn_ntby_amt';
  } else {
    return 0;
  }

  let consecutiveDays = 0;
  for (let i = 0; i < data.length; i++) {
    // T10: 인접 두 행 날짜 간격이 5 캘린더일 초과면(주말+휴일 고려) 연속 단절
    if (i > 0) {
      const prev = new Date(data[i - 1].trade_date).getTime();
      const curr = new Date(data[i].trade_date).getTime();
      const gapDays = (prev - curr) / (1000 * 60 * 60 * 24);
      if (gapDays > 5) break;
    }
    const val = parseFloat(data[i][targetField] as string) || 0;
    if (val > 0) {
      consecutiveDays++;
    } else {
      break;
    }
  }

  return consecutiveDays;
}

/**
 * 외인/기관 연속일수를 받아 뱃지 문자열을 조합하여 반환
 */
export function getSupplyBadge(frgnDays: number, orgnDays: number): string {
  const BADGE_RULES = [
    { threshold: 7, label: "🔥 7일 연속" },
    { threshold: 5, label: "⚡ 5일 연속" },
    { threshold: 3, label: "📈 3일 연속" },
  ];

  const getLabel = (days: number): string | null => {
    for (const rule of BADGE_RULES) {
      if (days >= rule.threshold) {
        return rule.label;
      }
    }
    return null;
  };

  const frgnLabel = getLabel(frgnDays);
  const orgnLabel = getLabel(orgnDays);

  const parts: string[] = [];
  if (frgnLabel) {
    parts.push(`외인 ${frgnLabel}`);
  }
  if (orgnLabel) {
    parts.push(`기관 ${orgnLabel}`);
  }

  return parts.join(' / ');
}
