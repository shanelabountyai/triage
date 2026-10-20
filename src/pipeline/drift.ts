// Drift signals (brief §9, D-20, D-21) from monitoring/drift.v1.json. Every value is integer bps;
// TVD is exact then rounded once; a signal fires at value ≥ threshold; a window under
// min_window_items never fires.
import { bps, BPS, roundHalfUp } from './num.js';
import type { DriftConfig, Policy } from './types.js';

export type Counts = Record<string, number>;

/** round_half_up(10000 × Σ_k |a_k/n_a − b_k/n_b| / 2), over a common denominator so it stays exact. */
export function tvdBps(a: Counts, b: Counts): number {
  const sum = (c: Counts) => Object.values(c).reduce((s, v) => s + BigInt(v), 0n);
  const na = sum(a), nb = sum(b);
  if (na === 0n || nb === 0n) return 0;
  let num = 0n; // Σ |a_k·n_b − b_k·n_a|, over n_a·n_b
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = BigInt(a[k] ?? 0) * nb - BigInt(b[k] ?? 0) * na;
    num += d < 0n ? -d : d;
  }
  return Number(roundHalfUp(num * BPS, 2n * na * nb));
}

export interface WindowStats {
  n: number;
  category: Counts; priority: Counts;
  escalated: number; human_queue: number; low_conf_a: number; unsupported_lang: number;
  results_total: number; results_failed: number;
  human_touched: number; overridden: number;
}

/** The per-run fields drift reads from a decision row (src/pipeline/record.ts) plus whether a person overrode it. */
export interface DriftItem {
  category: string; priority: string; path: string; needs_human: boolean; language: string;
  tier_a_min_bps: number | null; model_results: number; model_failures: readonly string[];
  human_touched: boolean; overridden: boolean;
}

/** `threshold` is the escalation T the run used: low confidence means tier-A minimum below it. */
export function windowStats(policy: Policy, items: readonly DriftItem[], threshold: number): WindowStats {
  const s: WindowStats = { n: items.length, category: {}, priority: {}, escalated: 0, human_queue: 0, low_conf_a: 0, unsupported_lang: 0, results_total: 0, results_failed: 0, human_touched: 0, overridden: 0 };
  for (const d of items) {
    s.category[d.category] = (s.category[d.category] ?? 0) + 1;
    s.priority[d.priority] = (s.priority[d.priority] ?? 0) + 1;
    if (d.path.startsWith('A>B')) s.escalated += 1;
    if (d.path.endsWith('>H')) s.human_queue += 1;
    if (d.tier_a_min_bps !== null && d.tier_a_min_bps < threshold) s.low_conf_a += 1;
    if (d.language !== '' && !policy.supported_languages.includes(d.language)) s.unsupported_lang += 1;
    s.results_total += d.model_results;
    s.results_failed += d.model_failures.length;
    if (d.human_touched) s.human_touched += 1;
    if (d.human_touched && d.overridden) s.overridden += 1;
  }
  return s;
}

export const shares = (s: WindowStats) => ({
  escalation: bps(s.escalated, s.n),
  human_queue: bps(s.human_queue, s.n),
  low_confidence: bps(s.low_conf_a, s.n),
  unsupported_language: bps(s.unsupported_lang, s.n),
  parse_failure: bps(s.results_failed, s.results_total),
  override: bps(s.overridden, s.human_touched),
});

const DELTA: Record<string, keyof ReturnType<typeof shares>> = {
  OVERRIDE_RATE_DELTA: 'override', ESCALATION_SHARE_DELTA: 'escalation', HUMAN_QUEUE_SHARE_DELTA: 'human_queue',
  LOW_CONFIDENCE_SHARE_DELTA: 'low_confidence', UNSUPPORTED_LANGUAGE_SHARE_DELTA: 'unsupported_language',
};
const ABSOLUTE: Record<string, keyof ReturnType<typeof shares>> = { PARSE_FAILURE_RATE: 'parse_failure' };

export interface SignalValue { id: string; value_bps: number; threshold_bps: number; fired: boolean }

/** One row per signal in the drift file, in its order. A signal id the code does not know throws. */
export function driftSignals(drift: DriftConfig, baseline: WindowStats, window: WindowStats): SignalValue[] {
  const bs = shares(baseline), ws = shares(window);
  return drift.signals.map((sig) => {
    let v: number;
    if (sig.kind === 'distance') {
      if (sig.field !== 'category' && sig.field !== 'priority') throw new Error(`drift signal ${sig.id}: unknown field ${sig.field}`);
      v = tvdBps(baseline[sig.field], window[sig.field]);
    } else {
      const key = (sig.kind === 'delta' ? DELTA : ABSOLUTE)[sig.id];
      if (key === undefined) throw new Error(`drift signal ${sig.id} (${sig.kind}) has no formula`);
      v = sig.kind === 'delta' ? ws[key] - bs[key] : ws[key];
    }
    return { id: sig.id, value_bps: v, threshold_bps: sig.threshold_bps, fired: window.n >= drift.min_window_items && v >= sig.threshold_bps };
  });
}
