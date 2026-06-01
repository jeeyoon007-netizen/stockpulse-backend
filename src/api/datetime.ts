/** KST(Asia/Seoul) 기준 오늘 YYYYMMDD. 서버 타임존(UTC 등) 무관. */
export function todayKST(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/** YYYYMMDD에 일수를 더하거나 뺀다(UTC 기준이라 타임존 무관). */
export function shiftYYYYMMDD(yyyymmdd: string, deltaDays: number): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6)) - 1;
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm2 = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd2 = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}${mm2}${dd2}`;
}
