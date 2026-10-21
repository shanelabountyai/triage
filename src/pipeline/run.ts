// One run over parsed inputs (task 1.9, brief §4 steps 2–8): tier A → escalate → tier B → decide → cost →
// audit sample. Pure: tickets and result lines in, decision rows and totals out. Ported from
// reference_pipeline.run_batch; `overridden` is null here because only a person's correction sets it
// (data/overrides.jsonl, joined by drift.windowStats).
import { createHash } from 'node:crypto';
import { costPico, type Prices } from './cost.js';
import { decide, escalate, minBps, type Policy } from './decide.js';
import { BPS } from './num.js';
import { tierResult, type BatchResult, type TierResult, type Usage } from './parse.js';
import { screenText } from './screen.js';
import type { Schema } from './validate.js';

type TicketText = { ticket_id: string; subject: string; body: string };
export interface RunConfig { policy: Policy; prices: Prices; schema: Schema; auditSeed: number }

/** One line of decisions.jsonl; columns as fixtures/decisions_batch{n}.csv, pico as decimal strings. */
export interface DecisionRow {
  ticket_id: string; path: string; final_tier: string; category: string; priority: string; route: string;
  needs_human: boolean; language: string; min_bps: number; flags: string[]; reasons: string[];
  cost_pico_batch: string; cost_pico_standard: string; human_touched: boolean; overridden: null;
  /** Tier A's min confidence, null when tier A failed: what drift's low-confidence and parse-failure counts need (D-36). */
  tier_a_min_bps: number | null;
}

/** D-21: sha256(`${seed}:audit:${id}`), first 8 hex as an integer, mod 10000 < audit_sample_bps. */
export function auditSampled(ticketId: string, seed: number, shareBps: number): boolean {
  const h = createHash('sha256').update(`${seed}:audit:${ticketId}`).digest('hex').slice(0, 8);
  return BigInt('0x' + h) % BPS < BigInt(shareBps);
}

/** The tickets tier B is asked about: those whose tier A result escalates. */
export const needsTierB = <T extends TicketText>(tickets: T[], ra: Map<string, BatchResult>, c: RunConfig): T[] =>
  tickets.filter((t) => escalate(tierResult(ra.get(t.ticket_id), c.schema), c.policy).escalate);

export function runTickets(tickets: TicketText[], ra: Map<string, BatchResult>, rb: Map<string, BatchResult>, c: RunConfig) {
  const tokens: Usage = { input: 0, cacheRead: 0, cacheCreation5m: 0, cacheCreation1h: 0, output: 0 };
  let costBatch = 0n;
  const tiers = new Map<string, { a: TierResult; b: TierResult | null }>();
  const rows = tickets.map((t): DecisionRow => {
    const a = tierResult(ra.get(t.ticket_id), c.schema);
    const b = escalate(a, c.policy).escalate ? tierResult(rb.get(t.ticket_id), c.schema) : null;
    const d = decide(t.ticket_id, screenText(t), a, b, c.policy);
    tiers.set(t.ticket_id, { a, b });
    const used: [TierResult, string][] = [[a, c.policy.tiers.A.model], ...(b ? [[b, c.policy.tiers.B.model] as [TierResult, string]] : [])];
    const cost = (batch: boolean) => used.reduce((s, [r, m]) => s + costPico(r.model ?? m, r.usage, batch, c.prices), 0n);
    for (const [r] of used) for (const k of Object.keys(tokens) as (keyof Usage)[]) tokens[k] += r.usage?.[k] ?? 0;
    const cb = cost(true);
    costBatch += cb;
    return {
      ticket_id: d.ticketId, path: d.path, final_tier: d.finalTier, category: d.category, priority: d.priority, route: d.route,
      needs_human: d.needsHuman, language: d.language, min_bps: d.minBps, flags: d.flags, reasons: d.reasons,
      cost_pico_batch: String(cb), cost_pico_standard: String(cost(false)),
      human_touched: d.needsHuman || auditSampled(t.ticket_id, c.auditSeed, c.policy.audit_sample_bps), overridden: null,
      tier_a_min_bps: a.parsed ? minBps(a.parsed) : null,
    };
  });
  return { rows, tiers, tokens, costPicoBatch: costBatch };
}
