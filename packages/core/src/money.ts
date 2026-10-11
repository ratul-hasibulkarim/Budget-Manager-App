/**
 * Money is always an integer number of minor units (paisa / cents).
 * ৳2,400.00 is stored as 240000. Floating point is never used for amounts.
 */
export type Minor = number;

/** Largest amount accepted anywhere in the app: ৳100,000,000,000.00 */
export const MAX_AMOUNT: Minor = 10_000_000_000_000;

export function isValidAmount(value: unknown, { allowZero = false } = {}): value is Minor {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    (allowZero ? value >= 0 : value > 0) &&
    value <= MAX_AMOUNT
  );
}

export function sum(values: readonly Minor[]): Minor {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBengaliDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]!);
}

export function fromBengaliDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/** Groups an integer string the South Asian way: 12,34,567 */
function groupSouthAsian(intDigits: string): string {
  if (intDigits.length <= 3) return intDigits;
  const last3 = intDigits.slice(-3);
  let rest = intDigits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return `${parts.join(',')},${last3}`;
}

export interface FormatMoneyOptions {
  lang?: 'en' | 'bn';
  /** Currency symbol to prefix, e.g. "৳". Empty string for none. */
  symbol?: string;
  /** Hide ".00" when the amount has no fractional part. Default true. */
  trimZeroFraction?: boolean;
  /** Prefix positive amounts with "+". */
  signed?: boolean;
}

export function formatMoney(amount: Minor, opts: FormatMoneyOptions = {}): string {
  const { lang = 'en', symbol = '৳', trimZeroFraction = true, signed = false } = opts;
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const intPart = Math.floor(abs / 100);
  const frac = abs % 100;
  let text = groupSouthAsian(String(intPart));
  if (!(trimZeroFraction && frac === 0)) text += `.${String(frac).padStart(2, '0')}`;
  const sign = negative ? '−' : signed && amount > 0 ? '+' : '';
  text = `${sign}${symbol}${text}`;
  return lang === 'bn' ? toBengaliDigits(text) : text;
}

/** Percentage of part in whole, for display only (comparisons must use exact values). */
export function percentOf(part: Minor, whole: Minor): number {
  if (whole <= 0) return 0;
  return Math.round((part * 1000) / whole) / 10;
}
