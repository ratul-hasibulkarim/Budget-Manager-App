import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CalcError, evaluateToMinor, formatMoney, fromBengaliDigits, isExpression, isValidAmount, percentOf, toBengaliDigits } from '../src';

describe('formatMoney', () => {
  it('uses South Asian grouping', () => {
    expect(formatMoney(0)).toBe('৳0');
    expect(formatMoney(240000)).toBe('৳2,400');
    expect(formatMoney(12345678900)).toBe('৳12,34,56,789');
    expect(formatMoney(100000000)).toBe('৳10,00,000');
    expect(formatMoney(99999)).toBe('৳999.99');
  });
  it('shows paisa when present and handles negatives', () => {
    expect(formatMoney(240050)).toBe('৳2,400.50');
    expect(formatMoney(-150005)).toBe('−৳1,500.05');
    expect(formatMoney(5)).toBe('৳0.05');
    expect(formatMoney(240000, { trimZeroFraction: false })).toBe('৳2,400.00');
    expect(formatMoney(500, { signed: true })).toBe('+৳5');
  });
  it('writes Bengali digits in Bangla', () => {
    expect(formatMoney(123456700, { lang: 'bn' })).toBe('৳১২,৩৪,৫৬৭');
    expect(toBengaliDigits('2026')).toBe('২০২৬');
    expect(fromBengaliDigits('২০২৬')).toBe('2026');
  });
});

describe('isValidAmount', () => {
  it('accepts only positive safe integers', () => {
    expect(isValidAmount(1)).toBe(true);
    expect(isValidAmount(0)).toBe(false);
    expect(isValidAmount(0, { allowZero: true })).toBe(true);
    expect(isValidAmount(-1)).toBe(false);
    expect(isValidAmount(1.5)).toBe(false);
    expect(isValidAmount(NaN)).toBe(false);
    expect(isValidAmount('100')).toBe(false);
    expect(isValidAmount(Number.MAX_SAFE_INTEGER)).toBe(false);
  });
  it('percentOf is display-only rounding', () => {
    expect(percentOf(1, 3)).toBe(33.3);
    expect(percentOf(5, 0)).toBe(0);
  });
});

describe('calculator', () => {
  const cases: [string, number][] = [
    ['250', 25000],
    ['250 + 80 + 40', 37000],
    ['1200 / 3', 40000],
    ['100 / 3', 3333],
    ['200 / 3', 6667],
    ['(50+30)*2', 16000],
    ['50 + 30 * 2', 11000],
    ['500 - 10%', 45000],
    ['500 + 10%', 55000],
    ['10%', 10],
    ['200 * 15%', 3000],
    ['12.5 + 0.25', 1275],
    ['.5', 50],
    ['১২০০ + ৩০০', 150000],
    ['1,200 + 300', 150000],
    ['100 × 2 ÷ 4', 5000],
    ['-50 + 100', 5000],
    ['0.005', 1],
    ['0.004', 0],
  ];
  it.each(cases)('%s = %d paisa', (expr, expected) => {
    expect(evaluateToMinor(expr)).toBe(expected);
  });
  it.each(['', '5 +', '(5', '5)', '5 / 0', 'abc', '1..2', '5 5', '*5'])('rejects "%s"', (expr) => {
    expect(() => evaluateToMinor(expr)).toThrow(CalcError);
  });
  it('rejects overflow', () => {
    expect(() => evaluateToMinor('99999999999999 * 99999999')).toThrow(CalcError);
  });
  it('detects expressions for the preview', () => {
    expect(isExpression('250')).toBe(false);
    expect(isExpression('-250')).toBe(false);
    expect(isExpression('250+1')).toBe(true);
  });
  it('sums of whole numbers are exact (no float drift)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 20 }), (nums) => {
        const expr = nums.map((n) => (n / 100).toFixed(2)).join(' + ');
        expect(evaluateToMinor(expr)).toBe(nums.reduce((a, b) => a + b, 0));
      }),
    );
  });
});
