import { getClock } from '../internal/clock.ts';

const SECONDS_PATTERN = /^\d+$/;
const HTTP_DATE_PATTERN =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (0[1-9]|[12]\d|3[01]) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d) GMT$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Parses a `Retry-After` header value into whole milliseconds to wait: delta seconds or an
 * IMF-fixdate (the day of the week is not validated). Dates in the past return 0. Malformed
 * values, and delays beyond `Number.MAX_SAFE_INTEGER` milliseconds, return null. Never throws.
 */
export function parseRetryAfter(header: string | null | undefined): number | null {
  if (typeof header !== 'string') return null;
  const value = header.trim();
  if (value === '') return null;
  if (SECONDS_PATTERN.test(value)) {
    const delayMs = Number(value) * 1000;
    return Number.isSafeInteger(delayMs) ? delayMs : null;
  }
  const match = HTTP_DATE_PATTERN.exec(value);
  if (match === null) return null;
  const day = Number(match[2]!);
  const month = MONTHS.indexOf(match[3]!);
  const year = Number(match[4]!);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (day > lastDay) return null;
  const epochMs = Date.UTC(year, month, day, Number(match[5]!), Number(match[6]!), Number(match[7]!));
  const delayMs = Math.ceil(epochMs - getClock().epochNow());
  return delayMs > 0 ? delayMs : 0;
}
