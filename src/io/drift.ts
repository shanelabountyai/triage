// drift:report (task 1.10, pooled windows task 3.3): resolve runs through the ledger, join each run's decisions with its
// overrides, pool each side, and return the brief §9 signal table as printed lines (the format of reference_pipeline.py).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Policy } from '../pipeline/decide.js';
import { driftSignals, sumStats, windowStats, type DriftPolicy } from '../pipeline/drift.js';
import type { DecisionRow } from '../pipeline/run.js';
import { readLedger, type LedgerRow } from './ledger.js';
import { readOverrides } from './overrides.js';

/** Each side is one or more ledger run_ids; their decisions are pooled (D-55). */
export interface DriftOptions { baseline: string[]; window: string[]; ledgerPath: string; overridesPath: string; root?: string }

const POLICY_FILE = 'routing/policy.v1.json';

function ledgerRow(ledgerPath: string, runId: string): LedgerRow {
  const row = readLedger(ledgerPath).find((r) => r.run_id === runId);
  if (!row) throw new Error(`DRIFT_UNKNOWN_RUN:${runId} (not in ${ledgerPath})`);
  return row;
}

/** A run is named by its ledger run_id; its decisions are `<out>/decisions.jsonl` from that ledger row. */
export function runDecisions(ledgerPath: string, runId: string): DecisionRow[] {
  const row = ledgerRow(ledgerPath, runId);
  if (row.out === null) throw new Error(`DRIFT_NO_DECISIONS:${runId} (a top-up row takes no decisions)`);
  return readFileSync(join(row.out, 'decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as DecisionRow);
}

/** `--last N` (D-52): the newest N ledger runs with decisions as the window, the N before them as the baseline.
 * Top-up rows (`out` null) take no decisions and are not runs here. Fewer than 2N runs is a refusal, not a shorter baseline. */
export function lastRuns(ledgerPath: string, n: number): { window: string[]; baseline: string[] } {
  const ids = readLedger(ledgerPath).filter((r) => r.out !== null).map((r) => r.run_id);
  if (!Number.isInteger(n) || n < 1 || ids.length < 2 * n) {
    throw new Error(`DRIFT_LAST_TOO_FEW:${n} (${ids.length} runs with decisions in ${ledgerPath}, need ${2 * Math.max(n, 1)})`);
  }
  return { window: ids.slice(-n), baseline: ids.slice(-2 * n, -n) };
}

export function driftReport(o: DriftOptions) {
  const root = o.root ?? '.';
  const json = <T>(p: string): T => JSON.parse(readFileSync(join(root, p), 'utf8')) as T;
  const policy = json<Policy>(POLICY_FILE), drift = json<DriftPolicy>('monitoring/drift.v1.json');
  const { byRun, errors } = readOverrides(o.overridesPath, policy);
  // Pooling sums each run's counts (every WindowStats field is a sum over rows, so this is concatenation); the shares are
  // then taken once over the pooled denominator. Overrides are looked up per run, since two runs can share ticket ids.
  const stats = (ids: string[]) => ids.map((id) => windowStats(runDecisions(o.ledgerPath, id), byRun.get(id) ?? new Map(), policy)).reduce(sumStats);
  const base = stats(o.baseline), win = stats(o.window);
  const signals = driftSignals(base, win, drift);
  // A policy change inside a side, or between the sides, shows up as a signal; say so next to the table rather than in the ledger only.
  const hashes = (ids: string[]) => [...new Set(ids.map((id) => ledgerRow(o.ledgerPath, id).hashes[POLICY_FILE] ?? ''))].map((h) => h.slice(0, 8));
  const hw = hashes(o.window), hb = hashes(o.baseline), tail = '(a signal may be the policy change, not drift)';
  const warn = (side: string, h: string[]) => (h.length > 1 ? [`  WARNING: ${side} pools runs under ${h.length} policy hashes: ${h.join(', ')} ${tail}`] : []);
  const lines = [
    `drift: ${o.window.join(',')} window (n ${win.n}) vs ${o.baseline.join(',')} baseline (n ${base.n}) (monitoring/drift.v1.json)`,
    ...warn('window', hw), ...warn('baseline', hb),
    ...(hw.length === 1 && hb.length === 1 && hw[0] !== hb[0] ? [`  WARNING: window policy hash ${hw[0]} differs from baseline ${hb[0]} ${tail}`] : []),
    `  override rate: ${win.overridden}/${win.reviewed} reviewed (of ${win.humanTouched} human-touched) in the window, ${base.overridden}/${base.reviewed} (of ${base.humanTouched}) in the baseline`,
    '  signal                              value     threshold  fired',
    ...signals.map((s) => `  ${s.id.padEnd(34)} ${String(s.valueBps).padStart(6)} bps  ${String(s.thresholdBps).padStart(6)} bps  ${s.fired ? 'YES' : 'no'}`),
    `  ${signals.filter((s) => s.fired).length} of ${signals.length} fired${win.n < drift.min_window_items ? ` (window under ${drift.min_window_items} items never fires)` : ''}`,
  ];
  return { signals, base, win, lines, overrideErrors: errors };
}
