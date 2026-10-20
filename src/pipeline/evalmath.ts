// Eval arithmetic (brief §9): precision/recall/F1 and expected calibration error, in bps, exact
// then rounded once. 0 when undefined; the count columns beside it say why.
import { bps, BPS, roundHalfUp } from './num.js';

/** [precision, recall, f1] in bps from tp, fp, fn (GE-01, GE-02). */
export const prf = (tp: number, fp: number, fn: number): [number, number, number] =>
  [bps(tp, tp + fp), bps(tp, tp + fn), bps(2 * tp, 2 * tp + fp + fn)];

/**
 * ECE over (confidence_bps, correct) pairs, equal-width bins: Σ_b (n_b/n)·|acc_b − conf_b|.
 * Per bin that is |k_b·10000 − s_b| / (n·10000) with k_b correct and s_b the summed confidence,
 * so in bps the whole sum is Σ_b |k_b·10000 − s_b| / n: one rational, rounded once (GE-03).
 * A confidence of exactly 10000 falls in the last bin.
 */
export function eceBps(pairs: readonly (readonly [number, boolean])[], bins = 10): number {
  const n = pairs.length;
  if (n === 0) return 0;
  const B = BigInt(bins);
  const k = new Array<bigint>(bins).fill(0n), s = new Array<bigint>(bins).fill(0n);
  for (const [c, ok] of pairs) {
    if (!Number.isSafeInteger(c) || c < 0 || c > Number(BPS)) throw new RangeError(`eceBps: confidence ${c} outside 0..10000`);
    const cb = BigInt(c);
    let b = 0;
    while (b < bins - 1 && cb * B >= BPS * BigInt(b + 1)) b += 1; // bin b holds BPS·b/bins ≤ c < BPS·(b+1)/bins
    k[b]! += ok ? 1n : 0n;
    s[b]! += cb;
  }
  let num = 0n;
  for (let b = 0; b < bins; b += 1) {
    const d = k[b]! * BPS - s[b]!;
    num += d < 0n ? -d : d;
  }
  return Number(roundHalfUp(num, BigInt(n)));
}
