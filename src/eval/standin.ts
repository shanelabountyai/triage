// The fixture stand-in for a person (O-6): on every human-touched ticket of a run, the answer key's
// category and priority are recorded as the reviewer's labels, assumed perfect. This file and the
// eval are the only code that reads an answer key (non-negotiable 10); the pipeline never does.
import type { OverrideRow } from '../io/overrides.js';
import type { DecisionRow } from '../pipeline/record.js';

export const STANDIN = 'answer-key stand-in (O-6)';

export function standInOverrides(runId: string, decisions: readonly DecisionRow[], key: ReadonlyMap<string, Record<string, string>>, at: string): OverrideRow[] {
  return decisions.filter((d) => d.human_touched).map((d) => {
    const k = key.get(d.ticket_id);
    if (!k || !k['category'] || !k['priority']) throw new Error(`answer key has no labels for ${d.ticket_id}`);
    return { ticket_id: d.ticket_id, run_id: runId, category: k['category'], priority: k['priority'], by: STANDIN, at };
  });
}
