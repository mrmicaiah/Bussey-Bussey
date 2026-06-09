// Business-day arithmetic for the Calls wizard's next_action_date pre-fills (§4.4).
//
// addBusinessDays(date, n) returns a NEW Date n business days after `date`,
// skipping Saturday (6) and Sunday (0). n=0 returns a copy of the input
// unchanged (even if it lands on a weekend — we only skip while advancing).
// Negative n walks backwards, also skipping weekends.

export function addBusinessDays(date: Date, n: number): Date {
  const result = new Date(date.getTime());
  if (n === 0) return result;
  const step = n > 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    result.setDate(result.getDate() + step);
    const day = result.getDay(); // 0 = Sun, 6 = Sat
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

// Format a Date as a local 'YYYY-MM-DD' string for <input type="date"> binding
// and the next_action_date payload (which is a date, not a datetime).
export function toDateInputValue(date: Date): string {
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
