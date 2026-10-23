// The one home for rounding (CLAUDE.md non-negotiable 6, D-10). Ported from LoanBook
// src/ledger/money.ts `roundHalfUp` (D-28): bigint, non-negative only. The oracle's
// triagelib.round_half_up also rounds negatives, but no call site in it ever passes one.
// This is the only file under src/pipeline/ allowed to divide.

export const BPS = 10_000n;
export const PICO_PER_CENT = 10_000_000_000n; // 1 cent = 10^10 pico-USD

/** floor(num/den + 1/2) over an exact rational. Throws on a negative or a zero denominator. */
export function roundHalfUp(num: bigint, den: bigint): bigint {
  if (num < 0n || den <= 0n) throw new RangeError(`roundHalfUp: invalid ${num}/${den}`);
  return (2n * num + den) / (2n * den);
}

function safe(n: bigint): number {
  const v = Number(n);
  if (!Number.isSafeInteger(v)) throw new RangeError(`not a safe integer: ${n}`);
  return v;
}

function int(n: number): bigint {
  if (!Number.isSafeInteger(n)) throw new RangeError(`not an integer: ${n}`);
  return BigInt(n);
}

/** num/den as integer basis points, half up. den 0 → 0 (reported, never divided), as triagelib.bps. */
export function bps(num: number, den: number): number {
  if (den === 0) return 0;
  return safe(roundHalfUp(int(num) * BPS, int(den)));
}

/** pico-USD → whole cents, half up. */
export function picoToCents(pico: bigint): number {
  return safe(roundHalfUp(pico, PICO_PER_CENT));
}

/** ceil(num/den) for non-negative integers. */
export function ceilDiv(num: bigint, den: bigint): bigint {
  if (num < 0n || den <= 0n) throw new RangeError(`ceilDiv: invalid ${num}/${den}`);
  return (num + den - 1n) / den;
}

/** Non-negative bps as a percent with two decimals (1912 → "19.12%"), by digits, never by float. */
export function fmtBps(v: number): string {
  if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`fmtBps: invalid ${v}`);
  const s = String(v).padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}%`;
}

/** Nearest-rank percentile of integers (p in 1..100): the value at rank ceil(p·n/100). No interpolation, so no float. */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Number(ceilDiv(BigInt(p * s.length), 100n)) - 1)]!;
}
