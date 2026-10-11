import { fromBengaliDigits, MAX_AMOUNT, type Minor } from './money';

/**
 * Safe calculator for the amount field: "250 + 80 + 40", "1200 / 3", "(50+30)*2", "500 - 10%".
 * No eval. Works on exact decimal arithmetic (BigInt scaled), result is rounded half-up to paisa.
 *
 * Supported: + - × ÷ * / ( ) and postfix % (percentage of the left operand in + and -,
 * otherwise value / 100), decimals, Bengali digits.
 */

export class CalcError extends Error {}

// Rational number: num / den, both BigInt, den > 0.
interface Rat {
  n: bigint;
  d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}
function rat(n: bigint, d: bigint = 1n): Rat {
  if (d === 0n) throw new CalcError('Division by zero');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const add = (a: Rat, b: Rat) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const subR = (a: Rat, b: Rat) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rat, b: Rat) => rat(a.n * b.n, a.d * b.d);
const div = (a: Rat, b: Rat) => {
  if (b.n === 0n) throw new CalcError('Division by zero');
  return rat(a.n * b.d, a.d * b.n);
};

type Token =
  | { t: 'num'; v: Rat }
  | { t: 'op'; v: '+' | '-' | '*' | '/' }
  | { t: '%' }
  | { t: '(' }
  | { t: ')' };

function tokenize(input: string): Token[] {
  const s = fromBengaliDigits(input)
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/,/g, '');
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === ' ') {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j]!)) j++;
      const raw = s.slice(i, j);
      if (!/^(\d+\.?\d*|\.\d+)$/.test(raw)) throw new CalcError(`Bad number "${raw}"`);
      const [intPart = '0', fracPart = ''] = raw.split('.');
      const scale = 10n ** BigInt(fracPart.length);
      tokens.push({ t: 'num', v: rat(BigInt((intPart || '0') + fracPart), scale) });
      i = j;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') tokens.push({ t: 'op', v: c });
    else if (c === '%') tokens.push({ t: '%' });
    else if (c === '(') tokens.push({ t: '(' });
    else if (c === ')') tokens.push({ t: ')' });
    else throw new CalcError(`Unexpected "${c}"`);
    i++;
  }
  return tokens;
}

// Recursive descent: expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ;
// unary := '-' unary | postfix ; postfix := primary '%'? ; primary := num | '(' expr ')'
function parse(tokens: Token[]): Rat {
  let pos = 0;
  const peek = () => tokens[pos];

  function primary(): Rat {
    const tok = tokens[pos++];
    if (!tok) throw new CalcError('Incomplete expression');
    if (tok.t === 'num') return tok.v;
    if (tok.t === '(') {
      const v = expr();
      if (tokens[pos++]?.t !== ')') throw new CalcError('Missing )');
      return v;
    }
    throw new CalcError('Unexpected symbol');
  }
  // Returns value and whether it was written as a percentage.
  function postfix(): { v: Rat; pct: boolean } {
    const v = primary();
    if (peek()?.t === '%') {
      pos++;
      return { v, pct: true };
    }
    return { v, pct: false };
  }
  function unary(): { v: Rat; pct: boolean } {
    const tok = peek();
    if (tok?.t === 'op' && (tok.v === '-' || tok.v === '+')) {
      pos++;
      const r = unary();
      return { v: tok.v === '-' ? rat(-r.v.n, r.v.d) : r.v, pct: r.pct };
    }
    return postfix();
  }
  const resolvePct = (x: { v: Rat; pct: boolean }) => (x.pct ? div(x.v, rat(100n)) : x.v);

  function term(): { v: Rat; pct: boolean } {
    let left = unary();
    for (;;) {
      const tok = peek();
      if (tok?.t !== 'op' || (tok.v !== '*' && tok.v !== '/')) return left;
      pos++;
      const right = resolvePct(unary());
      const l = resolvePct(left);
      left = { v: tok.v === '*' ? mul(l, right) : div(l, right), pct: false };
    }
  }
  function expr(): Rat {
    let left = resolvePct(term());
    for (;;) {
      const tok = peek();
      if (tok?.t !== 'op' || (tok.v !== '+' && tok.v !== '-')) return left;
      pos++;
      const r = term();
      // "500 - 10%" means 500 minus 10% of 500.
      const right = r.pct ? mul(left, div(r.v, rat(100n))) : r.v;
      left = tok.v === '+' ? add(left, right) : subR(left, right);
    }
  }

  const result = expr();
  if (pos !== tokens.length) throw new CalcError('Unexpected symbol');
  return result;
}

/** Evaluates an expression and returns the exact rational result. */
function evaluateRat(input: string): Rat {
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new CalcError('Empty');
  return parse(tokens);
}

/** Evaluates to minor units (paisa), rounding half away from zero. */
export function evaluateToMinor(input: string): Minor {
  const r = evaluateRat(input);
  const scaled = r.n * 100n;
  const q = scaled / r.d;
  const rem = scaled % r.d;
  let result = q;
  if ((rem < 0n ? -rem : rem) * 2n >= r.d) result += scaled < 0n ? -1n : 1n;
  if (result > BigInt(MAX_AMOUNT) || result < -BigInt(MAX_AMOUNT)) throw new CalcError('Amount too large');
  return Number(result);
}

/** True if the text is an expression rather than a plain number (shows "= result" preview). */
export function isExpression(input: string): boolean {
  return /[+\-*/×÷%()−]/.test(input.trim().replace(/^-/, ''));
}
