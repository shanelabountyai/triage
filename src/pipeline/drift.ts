// Drift signals (task 1.10, brief §9, D-20/D-21). Pure: decision rows and override labels in, eight
// signal rows out. Ported from triagelib.tvd_bps / WindowStats / drift_signals and
// reference_pipeline.window_stats.
import { bps, BPS, roundHalfUp } from './num.js';
import type { Policy } from './decide.js';
import type { DecisionRow } from './run.js';

export interface DriftPolicy {
  min_window_items: number;
  signals: { id: string; kind: 'distance' | 'delta' | 'absolute'; field?: string; threshold_bps: number }[];
}
export interface WindowStats {
  n: number; categoryCounts: Record<string, number>; priorityCounts: Record<string, number>;
  escalated: number; humanQueue: number; lowConfA: number; unsupportedLang: number;
  resultsTotal: number; resultsFailed: number; humanTouched: number; reviewed: number; overridden: number;
}
export interface Signal { id: string; valueBps: number; thresholdBps: number; fired: boolean }
/** A person's labels for one ticket (the latest override row wins). */
export type Override = { category: string; priority: string };

/** round_half_up(10000 × Σ|a_i/n_a − b_i/n_b| / 2), exact over the common denominator n_a·n_b. 0 when either side is empty. */
export function tvdBps(a: Record<string, number>, b: Record<string, number>): number {
  const sum = (c: Record<string, number>) => Object.values(c).reduce((s, v) => s + BigInt(v), 0n);
  const na = sum(a), nb = sum(b);
  if (na === 0n || nb === 0n) return 0;
  let s = 0n;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = BigInt(a[k] ?? 0) * nb - BigInt(b[k] ?? 0) * na;
    s += d < 0n ? -d : d;
  }
  return Number(roundHalfUp(s * BPS, 2n * na * nb));
}

const count = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

/** One window's counts. The override rate is over reviewed tickets: human-touched ones with an override row (D-37), so an
 * unreviewed backlog cannot dilute it; an override is a category or priority the person changed (D-21). */
export function windowStats(rows: DecisionRow[], overrides: Map<string, Override>, policy: Policy): WindowStats {
  const thr = policy.escalate_to_tier_b_when.min_confidence_bps_below;
  let escalated = 0, humanQueue = 0, lowConfA = 0, unsupportedLang = 0, resultsTotal = 0, resultsFailed = 0, humanTouched = 0, reviewed = 0, overridden = 0;
  for (const r of rows) {
    const esc = r.path.startsWith('A>B');
    escalated += +esc;
    humanQueue += +r.path.endsWith('>H');
    lowConfA += +(r.tier_a_min_bps !== null && r.tier_a_min_bps < thr);
    unsupportedLang += +(r.language !== '' && !policy.supported_languages.includes(r.language));
    // A failed tier A is flagged TIER_A_FAILED; a failed tier B (asked only when escalated) is the final tier's failure.
    resultsTotal += esc ? 2 : 1;
    resultsFailed += +(r.tier_a_min_bps === null) + +(esc && r.flags.some((f) => f.startsWith('FINAL_TIER_FAILED:')));
    if (!r.human_touched) continue;
    humanTouched++;
    const o = overrides.get(r.ticket_id);
    if (!o) continue;
    reviewed++;
    overridden += +(o.category !== r.category || o.priority !== r.priority);
  }
  return { n: rows.length, categoryCounts: count(rows.map((r) => r.category)), priorityCounts: count(rows.map((r) => r.priority)),
    escalated, humanQueue, lowConfA, unsupportedLang, resultsTotal, resultsFailed, humanTouched, reviewed, overridden };
}

const shares = (w: WindowStats): Record<string, number> => ({
  OVERRIDE_RATE_DELTA: bps(w.overridden, w.reviewed),
  ESCALATION_SHARE_DELTA: bps(w.escalated, w.n),
  HUMAN_QUEUE_SHARE_DELTA: bps(w.humanQueue, w.n),
  LOW_CONFIDENCE_SHARE_DELTA: bps(w.lowConfA, w.n),
  UNSUPPORTED_LANGUAGE_SHARE_DELTA: bps(w.unsupportedLang, w.n),
  PARSE_FAILURE_RATE: bps(w.resultsFailed, w.resultsTotal),
});

/** One row per signal in monitoring/drift.v1.json, in file order. Fires at value ≥ threshold; a window under min_window_items never fires. */
export function driftSignals(base: WindowStats, win: WindowStats, drift: DriftPolicy): Signal[] {
  const bs = shares(base), ws = shares(win);
  return drift.signals.map((s) => {
    let v: number | undefined;
    if (s.kind === 'distance') {
      const k = s.field === 'category' ? 'categoryCounts' : s.field === 'priority' ? 'priorityCounts' : undefined;
      if (k) v = tvdBps(base[k], win[k]);
    } else if (s.id in ws) v = s.kind === 'delta' ? ws[s.id]! - bs[s.id]! : ws[s.id];
    if (v === undefined) throw new Error(`DRIFT_UNKNOWN_SIGNAL:${s.id}`);
    return { id: s.id, valueBps: v, thresholdBps: s.threshold_bps, fired: win.n >= drift.min_window_items && v >= s.threshold_bps };
  });
}
