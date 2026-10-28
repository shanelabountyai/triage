// data/overrides.jsonl (task 1.10, D-21): append-only. One row is one person's labels for one ticket in one
// run; a correction is a new row, and the latest row for a (run, ticket) wins. A bad line is a typed error, never skipped silently.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Policy } from '../pipeline/decide.js';
import type { Override } from '../pipeline/drift.js';
import { runDecisions } from './drift.js';
import { readLedger } from './ledger.js';

export interface OverrideRow { run_id: string; ticket_id: string; category: string; priority: string; by: string; at: string }
export interface OverrideError { line: number; code: 'OVERRIDE_JSON' | 'OVERRIDE_FIELD'; detail: string }

/** overrides:add (task 3.2): one person's labels for one ticket in one run. Refuses, before writing anything, a run not in
 * the ledger, a ticket not in that run's decisions.jsonl, or a label outside the policy enums; each a typed error. */
export function addOverride(o: { ledgerPath: string; overridesPath: string; policy: Policy; row: OverrideRow }): OverrideRow {
  const { row } = o;
  if (!o.policy.labels.category.includes(row.category)) throw new Error(`OVERRIDE_BAD_LABEL:category=${row.category} (policy: ${o.policy.labels.category.join(',')})`);
  if (!o.policy.labels.priority.includes(row.priority)) throw new Error(`OVERRIDE_BAD_LABEL:priority=${row.priority} (policy: ${o.policy.labels.priority.join(',')})`);
  if (!readLedger(o.ledgerPath).some((r) => r.run_id === row.run_id)) throw new Error(`OVERRIDE_UNKNOWN_RUN:${row.run_id} (not in ${o.ledgerPath})`);
  if (!runDecisions(o.ledgerPath, row.run_id).some((d) => d.ticket_id === row.ticket_id)) throw new Error(`OVERRIDE_UNKNOWN_TICKET:${row.ticket_id} (not in run ${row.run_id})`);
  appendOverrides(o.overridesPath, [row]);
  return row;
}

export function appendOverrides(path: string, rows: OverrideRow[]): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, rows.map((r) => JSON.stringify(r) + '\n').join(''));
}

/** run_id → ticket_id → the latest labels. A missing file is no overrides. */
export function readOverrides(path: string, policy: Policy) {
  const byRun = new Map<string, Map<string, Override>>();
  const errors: OverrideError[] = [];
  if (!existsSync(path)) return { byRun, errors };
  readFileSync(path, 'utf8').split('\n').forEach((raw, i) => {
    if (raw.trim() === '') return;
    let o: Partial<OverrideRow>;
    try {
      o = JSON.parse(raw);
    } catch (e) {
      errors.push({ line: i + 1, code: 'OVERRIDE_JSON', detail: (e as Error).message });
      return;
    }
    const bad = (['run_id', 'ticket_id', 'by', 'at'] as const).find((k) => typeof o[k] !== 'string' || o[k] === '')
      ?? (!policy.labels.category.includes(o.category!) ? 'category' : !policy.labels.priority.includes(o.priority!) ? 'priority' : undefined);
    if (bad) {
      errors.push({ line: i + 1, code: 'OVERRIDE_FIELD', detail: bad });
      return;
    }
    if (!byRun.has(o.run_id!)) byRun.set(o.run_id!, new Map());
    byRun.get(o.run_id!)!.set(o.ticket_id!, { category: o.category!, priority: o.priority! });
  });
  return { byRun, errors };
}
