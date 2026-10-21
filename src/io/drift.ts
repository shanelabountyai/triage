// drift:report (task 1.10): resolve two runs through the ledger, join each run's decisions with its
// overrides, and return the brief §9 signal table as printed lines (the format of reference_pipeline.py).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Policy } from '../pipeline/decide.js';
import { driftSignals, windowStats, type DriftPolicy } from '../pipeline/drift.js';
import type { DecisionRow } from '../pipeline/run.js';
import { readOverrides } from './overrides.js';

export interface DriftOptions { baseline: string; window: string; ledgerPath: string; overridesPath: string; root?: string }

/** A run is named by its ledger run_id; its decisions are `<out>/decisions.jsonl` from that ledger row. */
export function runDecisions(ledgerPath: string, runId: string): DecisionRow[] {
  const row = readFileSync(ledgerPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((r) => r.run_id === runId);
  if (!row) throw new Error(`DRIFT_UNKNOWN_RUN:${runId} (not in ${ledgerPath})`);
  return readFileSync(join(row.out, 'decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as DecisionRow);
}

export function driftReport(o: DriftOptions) {
  const root = o.root ?? '.';
  const json = <T>(p: string): T => JSON.parse(readFileSync(join(root, p), 'utf8')) as T;
  const policy = json<Policy>('routing/policy.v1.json'), drift = json<DriftPolicy>('monitoring/drift.v1.json');
  const { byRun, errors } = readOverrides(o.overridesPath, policy);
  const stats = (id: string) => windowStats(runDecisions(o.ledgerPath, id), byRun.get(id) ?? new Map(), policy);
  const base = stats(o.baseline), win = stats(o.window);
  const signals = driftSignals(base, win, drift);
  const lines = [
    `drift: ${o.window} window (n ${win.n}) vs ${o.baseline} baseline (n ${base.n}) (monitoring/drift.v1.json)`,
    `  override rate: ${win.overridden}/${win.reviewed} reviewed (of ${win.humanTouched} human-touched) in the window, ${base.overridden}/${base.reviewed} (of ${base.humanTouched}) in the baseline`,
    '  signal                              value     threshold  fired',
    ...signals.map((s) => `  ${s.id.padEnd(34)} ${String(s.valueBps).padStart(6)} bps  ${String(s.thresholdBps).padStart(6)} bps  ${s.fired ? 'YES' : 'no'}`),
    `  ${signals.filter((s) => s.fired).length} of ${signals.length} fired${win.n < drift.min_window_items ? ` (window under ${drift.min_window_items} items never fires)` : ''}`,
  ];
  return { signals, base, win, lines, overrideErrors: errors };
}
