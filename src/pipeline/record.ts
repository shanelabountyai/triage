// What a run writes (brief §4 steps 7–9): one decisions.jsonl row per ticket (the contract N9
// reads, O-9) and the run's totals for the ledger row. Pure; src/io/run.ts writes the files.
import { humanTouched } from './audit.js';
import type { TicketOutcome } from './batch.js';
import { centsPer1000, picoToCents } from './num.js';
import { minBps } from './parse.js';
import type { Policy, TierResult, Usage } from './types.js';

export interface DecisionRow {
  ticket_id: string; path: string; final_tier: string;
  category: string; priority: string; route: string; needs_human: boolean; language: string; min_bps: number;
  flags: string[]; reasons: string[];
  /** pico-USD as decimal strings: BigInt has no JSON form, and a float would lose the integer. */
  cost_pico_batch: string; cost_pico_standard: string;
  /** In the human queue or in the D-21 audit sample: a person reads it, so an override can exist. */
  human_touched: boolean;
  /** Tier A's minimum confidence, null when tier A failed (drift's low-confidence signal reads it). */
  tier_a_min_bps: number | null;
  /** Model results this ticket used (1 or 2) and the failed ones as `<tier>:<code>` (drift's parse-failure signal). */
  model_results: number; model_failures: string[];
}

export function decisionRow(policy: Policy, auditSeed: number, o: TicketOutcome): DecisionRow {
  const d = o.decision;
  const used = o.b ? [o.a, o.b] : [o.a];
  return {
    ticket_id: d.ticket_id, path: d.path, final_tier: d.final_tier,
    category: d.category, priority: d.priority, route: d.route, needs_human: d.needs_human, language: d.language, min_bps: d.min_bps,
    flags: d.flags, reasons: d.reasons,
    cost_pico_batch: String(o.costPicoBatch), cost_pico_standard: String(o.costPicoStandard),
    human_touched: humanTouched(policy, auditSeed, d.ticket_id, d.needs_human),
    tier_a_min_bps: o.a.parsed ? minBps(o.a.parsed) : null,
    model_results: used.length, model_failures: used.filter((t) => t.failure).map((t) => `${t.tier}:${t.failure}`),
  };
}

export interface TokenCounts { input: number; cache_read: number; cache_creation_5m: number; cache_creation_1h: number; output: number }

export interface RunTotals {
  tickets: number;
  paths: Record<string, number>;
  escalated: number; human_queue: number;
  model_results: number; model_failures: number;
  /** Summed from usage fields per tier; results without usage (not billed) add nothing. */
  tokens: { A: TokenCounts; B: TokenCounts };
  cost_pico_batch: string; cost_pico_standard: string;
  cost_cents_batch: number; cost_cents_standard: number;
  cents_per_1000_batch: number; cents_per_1000_standard: number;
}

const zero = (): TokenCounts => ({ input: 0, cache_read: 0, cache_creation_5m: 0, cache_creation_1h: 0, output: 0 });
const add = (c: TokenCounts, u: Usage) => {
  c.input += u.input;
  c.cache_read += u.cacheRead;
  c.cache_creation_5m += u.cacheCreation5m;
  c.cache_creation_1h += u.cacheCreation1h;
  c.output += u.output;
};

export function runTotals(outcomes: readonly TicketOutcome[]): RunTotals {
  const paths: Record<string, number> = {};
  const tokens = { A: zero(), B: zero() };
  let escalated = 0, queue = 0, results = 0, failures = 0, batch = 0n, standard = 0n;
  for (const o of outcomes) {
    paths[o.decision.path] = (paths[o.decision.path] ?? 0) + 1;
    if (o.b) escalated += 1;
    if (o.decision.needs_human) queue += 1;
    for (const t of [o.a, o.b].filter((x): x is TierResult => x !== null)) {
      results += 1;
      if (t.failure) failures += 1;
      if (t.usage) add(tokens[t.tier], t.usage);
    }
    batch += o.costPicoBatch;
    standard += o.costPicoStandard;
  }
  const n = outcomes.length;
  return {
    tickets: n, paths: Object.fromEntries(Object.entries(paths).sort(([x], [y]) => (x < y ? -1 : 1))),
    escalated, human_queue: queue, model_results: results, model_failures: failures, tokens,
    cost_pico_batch: String(batch), cost_pico_standard: String(standard),
    cost_cents_batch: picoToCents(batch), cost_cents_standard: picoToCents(standard),
    cents_per_1000_batch: centsPer1000(batch, n), cents_per_1000_standard: centsPer1000(standard, n),
  };
}
