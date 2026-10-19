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
