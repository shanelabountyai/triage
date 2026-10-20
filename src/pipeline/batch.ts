// One batch through the pure stages (brief §4 steps 2–8): screen → tier A result → escalate →
// tier B result → decide → cost. Result lines come in already read (from a replay or a live provider);
// nothing here reads a file, a clock or the network, so the same inputs give the same decisions.
import { costPico } from './cost.js';
import { decide, escalate, type Decision } from './decide.js';
import { tierResult, type ResultLine } from './parse.js';
import { screen, screenText, type ScreenHit } from './screen.js';
import type { PolicyData, TierResult } from './types.js';

export interface TicketText { ticket_id: string; subject: string; body: string }

export interface TicketOutcome {
  decision: Decision; hits: ScreenHit[]; a: TierResult; b: TierResult | null;
  /** pico-USD for this ticket's tier calls, at batch and at standard prices (D-18). */
  costPicoBatch: bigint; costPicoStandard: bigint;
}

/** The tickets tier B must read, given tier A's lines: the escalated set (D-12). */
export function escalatedIds(data: PolicyData, tickets: readonly TicketText[], linesA: ReadonlyMap<string, ResultLine>): string[] {
  const model = data.policy.tiers.A.model;
  return tickets.filter((t) => escalate(data.policy, tierResult('A', model, linesA.get(t.ticket_id), data.schema)).escalate).map((t) => t.ticket_id);
}

/** Decide every ticket. `linesB` needs a line for each escalated ticket; a missing one is the failure "missing". */
export function decideBatch(
  data: PolicyData, tickets: readonly TicketText[],
  linesA: ReadonlyMap<string, ResultLine>, linesB: ReadonlyMap<string, ResultLine>,
): TicketOutcome[] {
  const { policy, schema, prices } = data;
  const cost = (t: TierResult | null, batch: boolean): bigint => (t?.usage ? costPico(prices, t.model, t.usage, batch) : 0n);
  return tickets.map((t) => {
    const hits = screen(screenText(t));
    const a = tierResult('A', policy.tiers.A.model, linesA.get(t.ticket_id), schema);
    const b = escalate(policy, a).escalate ? tierResult('B', policy.tiers.B.model, linesB.get(t.ticket_id), schema) : null;
    return {
      decision: decide(policy, t.ticket_id, hits, a, b), hits, a, b,
      costPicoBatch: cost(a, true) + cost(b, true), costPicoStandard: cost(a, false) + cost(b, false),
    };
  });
}
