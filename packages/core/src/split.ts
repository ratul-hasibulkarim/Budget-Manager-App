import { isValidAmount, sum, type Minor } from './money';

/** How an amount is divided between people. Used for both payers and beneficiaries. */
export type SplitSpec =
  | { method: 'equal'; members: string[] }
  | { method: 'exact'; amounts: Record<string, Minor> }
  /** Basis points: 100% = 10000, so 33.33% = 3333. Must add up to 10000. */
  | { method: 'percent'; basisPoints: Record<string, number> }
  | { method: 'shares'; shares: Record<string, number> };

export interface Portion {
  memberId: string;
  amount: Minor;
}

export class SplitError extends Error {}

export function splitMembers(spec: SplitSpec): string[] {
  switch (spec.method) {
    case 'equal':
      return [...spec.members];
    case 'exact':
      return Object.keys(spec.amounts);
    case 'percent':
      return Object.keys(spec.basisPoints);
    case 'shares':
      return Object.keys(spec.shares);
  }
}

/**
 * Orders ids by `order` (the project's join order); unknown ids go last, sorted by id.
 * This fixed order decides who receives leftover paisa, so every device gets the same result.
 */
function ordered(ids: string[], order: readonly string[]): string[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => {
    const ra = rank.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ra !== rb ? ra - rb : a < b ? -1 : a > b ? 1 : 0;
  });
}

/**
 * Largest-remainder apportionment: splits `total` by integer weights so the parts are whole
 * paisa and always add up exactly to `total`. Leftover paisa go to the largest fractional
 * remainders; ties are broken by the fixed member order.
 */
function apportion(total: Minor, weights: { id: string; w: bigint }[]): Portion[] {
  const W = weights.reduce((a, x) => a + x.w, 0n);
  if (W <= 0n) throw new SplitError('Weights must be positive');
  const T = BigInt(total);
  const parts = weights.map((x, index) => {
    const exact = T * x.w;
    return { id: x.id, base: exact / W, rem: exact % W, index };
  });
  let leftover = T - parts.reduce((a, p) => a + p.base, 0n);
  const byRemainder = [...parts].sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.index - b.index));
  for (const p of byRemainder) {
    if (leftover <= 0n) break;
    p.base += 1n;
    leftover -= 1n;
  }
  // People whose share rounds to 0 paisa (tiny amounts) are left out of the result.
  return parts.filter((p) => p.base > 0n).map((p) => ({ memberId: p.id, amount: Number(p.base) }));
}

function assertUnique(ids: string[]) {
  if (new Set(ids).size !== ids.length) throw new SplitError('A person is listed twice');
}

/** Turns a split spec into exact paisa amounts per person that add up to `total`. */
export function resolveSplit(total: Minor, spec: SplitSpec, order: readonly string[]): Portion[] {
  if (!isValidAmount(total)) throw new SplitError('Total must be a positive whole number of paisa');
  switch (spec.method) {
    case 'equal': {
      assertUnique(spec.members);
      if (spec.members.length === 0) throw new SplitError('Select at least one person');
      return apportion(
        total,
        ordered(spec.members, order).map((id) => ({ id, w: 1n })),
      );
    }
    case 'exact': {
      const ids = ordered(Object.keys(spec.amounts), order);
      if (ids.length === 0) throw new SplitError('Select at least one person');
      const portions = ids.map((id) => ({ memberId: id, amount: spec.amounts[id]! }));
      for (const p of portions) {
        if (!isValidAmount(p.amount, { allowZero: true })) throw new SplitError('Amounts must be whole paisa');
      }
      const s = sum(portions.map((p) => p.amount));
      if (s !== total) throw new SplitError(`Amounts add up to ${s}, expected ${total}`);
      return portions.filter((p) => p.amount > 0);
    }
    case 'percent': {
      const ids = ordered(Object.keys(spec.basisPoints), order);
      if (ids.length === 0) throw new SplitError('Select at least one person');
      const weights = ids.map((id) => {
        const bp = spec.basisPoints[id]!;
        if (!Number.isSafeInteger(bp) || bp < 0) throw new SplitError('Percentages must be positive');
        return { id, w: BigInt(bp) };
      });
      const s = weights.reduce((a, x) => a + x.w, 0n);
      if (s !== 10000n) throw new SplitError(`Percentages add up to ${Number(s) / 100}%, expected 100%`);
      return apportion(total, weights.filter((x) => x.w > 0n));
    }
    case 'shares': {
      const ids = ordered(Object.keys(spec.shares), order);
      if (ids.length === 0) throw new SplitError('Select at least one person');
      const weights = ids.map((id) => {
        const s = spec.shares[id]!;
        if (!Number.isSafeInteger(s) || s < 0 || s > 1_000_000) throw new SplitError('Shares must be whole numbers');
        return { id, w: BigInt(s) };
      });
      return apportion(total, weights.filter((x) => x.w > 0n));
    }
  }
}

/** Equal split by default, the most common case. */
export function equalSplit(members: string[]): SplitSpec {
  return { method: 'equal', members };
}
