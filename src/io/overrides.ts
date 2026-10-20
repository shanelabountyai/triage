// Override intake (D-21, PRD): a person records the labels a ticket should have had, in
// data/overrides.jsonl, append-only. A correction is a new row; the latest row for a ticket wins.
// An override exists when the recorded category or priority differs from the run's.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_OVERRIDES = 'data/overrides.jsonl';

export interface OverrideRow {
  ticket_id: string;
  /** The run whose decision the person reviewed. */
  run_id: string;
  category: string;
  priority: string;
  /** Who recorded it; on the fixtures "answer-key stand-in (O-6)". */
  by: string;
  at: string;
}

export function appendOverrides(rows: readonly OverrideRow[], path = DEFAULT_OVERRIDES): void {
  for (const r of rows) {
    for (const k of ['ticket_id', 'run_id', 'category', 'priority', 'by', 'at'] as const) {
      if (typeof r[k] !== 'string' || r[k] === '') throw new Error(`override row missing ${k}: ${JSON.stringify(r)}`);
    }
  }
  if (!rows.length) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

/** Latest row per ticket (file order is time order: the file is only ever appended to). */
export function readOverrides(path = DEFAULT_OVERRIDES): Map<string, OverrideRow> {
  const out = new Map<string, OverrideRow>();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as OverrideRow;
    out.set(r.ticket_id, r);
  }
  return out;
}

/** A person changed the category or the priority (D-21). Only meaningful on a human-touched ticket. */
export const isOverridden = (d: { ticket_id: string; category: string; priority: string }, latest: ReadonlyMap<string, OverrideRow>): boolean => {
  const o = latest.get(d.ticket_id);
  return o !== undefined && (o.category !== d.category || o.priority !== d.priority);
};
