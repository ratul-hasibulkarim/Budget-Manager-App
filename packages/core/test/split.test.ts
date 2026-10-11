import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { resolveSplit, SplitError, type SplitSpec } from '../src';

const order = ['a', 'b', 'c', 'd'];

describe('resolveSplit', () => {
  it('equal split gives leftover paisa to the earliest joined', () => {
    expect(resolveSplit(100, { method: 'equal', members: ['c', 'a', 'b'] }, order)).toEqual([
      { memberId: 'a', amount: 34 },
      { memberId: 'b', amount: 33 },
      { memberId: 'c', amount: 33 },
    ]);
    expect(resolveSplit(1200000, { method: 'equal', members: order }, order).map((p) => p.amount)).toEqual([300000, 300000, 300000, 300000]);
  });
  it('exact amounts must add up', () => {
    expect(resolveSplit(1000, { method: 'exact', amounts: { a: 700, b: 300 } }, order)).toEqual([
      { memberId: 'a', amount: 700 },
      { memberId: 'b', amount: 300 },
    ]);
    expect(() => resolveSplit(1000, { method: 'exact', amounts: { a: 700, b: 200 } }, order)).toThrow(SplitError);
    expect(() => resolveSplit(1000, { method: 'exact', amounts: { a: 1000.5 } }, order)).toThrow(SplitError);
  });
  it('exact split drops zero amounts', () => {
    expect(resolveSplit(1000, { method: 'exact', amounts: { a: 1000, b: 0 } }, order)).toEqual([{ memberId: 'a', amount: 1000 }]);
  });
  it('percentages use basis points and must total 100%', () => {
    expect(resolveSplit(10000, { method: 'percent', basisPoints: { a: 5000, b: 3000, c: 2000 } }, order).map((p) => p.amount)).toEqual([5000, 3000, 2000]);
    // 33.33/33.33/33.34 of ৳1
    expect(resolveSplit(100, { method: 'percent', basisPoints: { a: 3333, b: 3333, c: 3334 } }, order).map((p) => p.amount)).toEqual([33, 33, 34]);
    expect(() => resolveSplit(100, { method: 'percent', basisPoints: { a: 5000 } }, order)).toThrow(/100%/);
  });
  it('shares split proportionally', () => {
    expect(resolveSplit(900, { method: 'shares', shares: { a: 2, b: 1 } }, order).map((p) => p.amount)).toEqual([600, 300]);
    expect(() => resolveSplit(900, { method: 'shares', shares: { a: 0 } }, order)).toThrow(SplitError);
  });
  it('a share that rounds to zero is left out instead of creating a 0 entry', () => {
    expect(resolveSplit(1, { method: 'equal', members: ['a', 'b'] }, order)).toEqual([{ memberId: 'a', amount: 1 }]);
  });
  it('refuses empty, duplicate and invalid totals', () => {
    expect(() => resolveSplit(100, { method: 'equal', members: [] }, order)).toThrow(SplitError);
    expect(() => resolveSplit(100, { method: 'equal', members: ['a', 'a'] }, order)).toThrow(SplitError);
    expect(() => resolveSplit(0, { method: 'equal', members: ['a'] }, order)).toThrow(SplitError);
    expect(() => resolveSplit(1.5, { method: 'equal', members: ['a'] }, order)).toThrow(SplitError);
  });

  it('property: every split adds up exactly and is within 1 paisa of the ideal share', () => {
    const member = fc.constantFrom('a', 'b', 'c', 'd', 'e');
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.uniqueArray(member, { minLength: 1, maxLength: 5 }),
        fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 5, maxLength: 5 }),
        fc.constantFrom('equal', 'shares'),
        (total, members, weights, method) => {
          const spec: SplitSpec =
            method === 'equal'
              ? { method: 'equal', members }
              : { method: 'shares', shares: Object.fromEntries(members.map((m, i) => [m, weights[i]!])) };
          const parts = resolveSplit(total, spec, order);
          expect(parts.reduce((a, p) => a + p.amount, 0)).toBe(total);
          const W = method === 'equal' ? members.length : members.reduce((a, _, i) => a + weights[i]!, 0);
          for (const p of parts) {
            const w = method === 'equal' ? 1 : weights[members.indexOf(p.memberId as (typeof members)[number])]!;
            expect(Math.abs(p.amount - (total * w) / W)).toBeLessThan(1);
            expect(Number.isInteger(p.amount)).toBe(true);
          }
          // Deterministic regardless of input order.
          const reversed: SplitSpec = method === 'equal' ? { method: 'equal', members: [...members].reverse() } : spec;
          expect(resolveSplit(total, reversed, order)).toEqual(parts);
        },
      ),
    );
  });
});
