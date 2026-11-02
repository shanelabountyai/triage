// Task 4.2 (D-62): one recording's decisions against the answer key, by split, for the v1/v2 side by side in docs/EVAL.md.
// Route is judged from the key's category and priority through the policy table (D-13), so a queued ticket's misroute counts.
import { type Policy, routeFor } from '../pipeline/decide.js';
import type { DecisionRow } from '../pipeline/run.js';
import { parseCsv } from './report.js';

export interface Scorecard {
  n: number; nhRecall: [number, number]; p1Missed: [number, number]; delivered: [number, number];
  queuedMisroute: [number, number]; targetMisroute: number; targetCat: Record<string, [number, number]>; costPico: bigint;
}

const TARGETS = ['OUTAGE', 'PRIVACY_DATA'];

export function score(rows: DecisionRow[], keyCsv: string, policy: Policy, split?: string): Scorecard {
  const key = new Map(parseCsv(keyCsv).map((r) => [r['ticket_id']!, r]));
  const rs = rows.filter((r) => !split || key.get(r.ticket_id)?.['split'] === split);
  const k = (r: DecisionRow) => key.get(r.ticket_id)!;
  const count = (f: (r: DecisionRow) => boolean) => rs.filter(f).length;
  const queued = rs.filter((r) => r.needs_human), auto = rs.filter((r) => !r.needs_human);
  const misrouted = (r: DecisionRow) => r.route !== routeFor(k(r)['category']!, k(r)['priority']!, policy);
  return {
    n: rs.length,
    nhRecall: [count((r) => k(r)['needs_human'] === 'true' && r.needs_human), count((r) => k(r)['needs_human'] === 'true')],
    p1Missed: [count((r) => k(r)['priority'] === 'P1' && !r.needs_human), count((r) => k(r)['priority'] === 'P1')],
    delivered: [auto.filter((r) => r.category === k(r)['category']).length, auto.length],
    queuedMisroute: [queued.filter(misrouted).length, queued.length],
    targetMisroute: queued.filter((r) => misrouted(r) && TARGETS.includes(k(r)['category']!)).length,
    targetCat: Object.fromEntries(TARGETS.map((c) => [c, [count((r) => k(r)['category'] === c && r.category === c), count((r) => k(r)['category'] === c)]])),
    costPico: rs.reduce((s, r) => s + BigInt(r.cost_pico_batch), 0n),
  };
}
