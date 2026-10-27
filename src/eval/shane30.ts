// Shane's 30 (D-24, task 2.10): 30 human-queue tickets from the first recorded run, read by a person. The pick is
// deterministic (seeded hash order, as the audit sample) so a reviewer can regenerate it; the judgements live in
// eval/labels/shane-30.json and are the only labels in this repo not written by the generator. The eval prints agreement
// with the pipeline's reasons and the share Shane would have auto-handled, each with its denominator.
import { createHash } from 'node:crypto';
import type { DecisionRow } from '../pipeline/run.js';
import { bps, fmtBps } from '../pipeline/num.js';

export const SHANE30 = 'eval/labels/shane-30.json';

export interface Judged {
  ticket_id: string;
  /** The pipeline's human:* reasons on the day of judgement, so a later policy move cannot rewrite what he agreed with. */
  pipeline_reasons: string[];
  needs_human: boolean | null;
  /** Only meaningful when needs_human is true: did the pipeline flag it for the right reason. */
  agrees_with_pipeline_reason: boolean | null;
  /** Would the pipeline's category and priority have been fine to deliver. */
  labels_ok: boolean | null;
  note: string;
}
export interface FnTemplate {
  template_id: string; ticket_ids: string[]; body: string;
  pipeline: { needs_human: boolean; category: string }; key: { needs_human: boolean; category: string };
  needs_human: boolean | null; category: string | null; note: string;
}
export interface Shane30 {
  picked_from: string; pick: string; judged_on: string | null;
  tickets: Judged[];
  /** The two AMBIGUOUS templates the key marks human and both tiers auto-handle (D-49): not in the queue, judged by template. */
  false_negative_templates: FnTemplate[];
}

/** sha256(`${seed}:shane30:${id}`) ascending, first n of the human queue (D-21's hash family). */
export function pickShane30(rows: DecisionRow[], seed: number, n = 30): DecisionRow[] {
  const h = (id: string) => createHash('sha256').update(`${seed}:shane30:${id}`).digest('hex');
  return rows.filter((r) => r.needs_human).map((r) => [h(r.ticket_id), r] as const).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, n).map(([, r]) => r);
}

/** The rule behind a reason: `human:low_confidence_2500` → `low_confidence`, `human:secondary_BILLING` → `secondary`. */
export const reasonFamily = (reason: string) =>
  reason.replace(/^human:/, '').match(/^(model_says|priority|category|low_confidence|language|secondary|screen_flagged|final_tier_failed)/)?.[1] ?? reason;

export function shane30Lines(s: Shane30, rowsById: Map<string, DecisionRow>): string[] {
  const out: string[] = [];
  const judged = s.tickets.filter((t) => t.needs_human !== null);
  const n = s.tickets.length;
  const human = judged.filter((t) => t.needs_human);
  const auto = judged.filter((t) => !t.needs_human);
  const agrees = human.filter((t) => t.agrees_with_pipeline_reason);
  out.push(`Shane's 30 (D-24, ${SHANE30}; ${s.pick}): judged ${judged.length} of ${n}`
    + (judged.length ? `  human needed ${human.length} (${fmtBps(bps(human.length, judged.length))})  would have auto-handled ${auto.length} (${fmtBps(bps(auto.length, judged.length))})`
      + `  pipeline reason agreed ${agrees.length} of ${human.length} human  labels ok ${judged.filter((t) => t.labels_ok).length} of ${judged.length}` : ''));
  if (judged.length) {
    const fams = new Map<string, Judged[]>();
    for (const t of judged) for (const f of new Set((rowsById.get(t.ticket_id)?.reasons ?? []).filter((r) => r.startsWith('human:')).map(reasonFamily)))
      fams.set(f, [...(fams.get(f) ?? []), t]);
    for (const [f, ts] of [...fams].sort(([a], [b]) => (a < b ? -1 : 1)))
      out.push(`  ${f.padEnd(22)} judged ${String(ts.length).padStart(2)}  human ${String(ts.filter((t) => t.needs_human).length).padStart(2)}  auto ${String(ts.filter((t) => !t.needs_human).length).padStart(2)}`);
  }
  for (const f of s.false_negative_templates)
    out.push(`  false-negative template ${f.template_id} (${f.ticket_ids.length} tickets; key ${f.key.category} human, pipeline ${f.pipeline.category} auto): `
      + (f.needs_human === null ? 'not judged' : `Shane ${f.needs_human ? 'human' : 'auto'} ${f.category ?? '?'}${f.note ? `  "${f.note}"` : ''}`));
  return out;
}
