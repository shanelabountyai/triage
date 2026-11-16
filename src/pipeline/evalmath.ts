// Eval arithmetic (task 1.11, brief §11). Ported from triagelib.prf / ece_bps; exact, rounded once.
import { bps, BPS, roundHalfUp } from './num.js';

/** precision, recall, f1 in bps; 0/0 is reported as 0 and the count columns say why. */
export const prf = (tp: number, fp: number, fn: number): [number, number, number] =>
  [bps(tp, tp + fp), bps(tp, tp + fn), bps(2 * tp, 2 * tp + fp + fn)];

/** ECE over (confidence bps, correct) with 10 equal-width bins (10000 falls in the last).
 * Σ_b (n_b/n)·|k_b/n_b − S_b/(n_b·10000)| × 10000 = Σ_b |k_b·10000 − S_b| / n, so one rounding over that rational. */
export function eceBps(pairs: [number, boolean][]): number {
  if (pairs.length === 0) return 0;
  const k = new Array<bigint>(10).fill(0n), s = new Array<bigint>(10).fill(0n);
  for (const [c, ok] of pairs) {
    let b = 0;
    while (b < 9 && BigInt(c) * 10n >= BigInt(b + 1) * BPS) b++;
    k[b]! += ok ? BPS : 0n;
    s[b]! += BigInt(c);
  }
  const tot = k.reduce((t, kb, b) => t + (kb > s[b]! ? kb - s[b]! : s[b]! - kb), 0n);
  return Number(roundHalfUp(tot, BigInt(pairs.length)));
}
