// data/overrides.jsonl (task 1.10, D-21): append-only. One row is one person's labels for one ticket in one
// run; a correction is a new row, and the latest row for a (run, ticket) wins. A bad line is a typed error, never skipped silently.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Policy } from '../pipeline/decide.js';
import type { Override } from '../pipeline/drift.js';

export interface OverrideRow { run_id: string; ticket_id: string; category: string; priority: string; by: string; at: string }
export interface OverrideError { line: number; code: 'OVERRIDE_JSON' | 'OVERRIDE_FIELD'; detail: string }

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
