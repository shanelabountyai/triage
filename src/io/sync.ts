// triageOne (task 3.5, O-10): one ticket → one decision, for POST /triage. The same pure run as triageRun over a
// one-ticket list (tier A → escalate → tier B → decide), the same ledger row shape, and for the `messages` provider the
// same D-19 gate per call: the latch, a projection before each tier at STANDARD prices, the real cost from usage fields
// after. Replays (`scripted`, `recorded`) go through provider() as they do in triageRun; `recorded` with batch `sync`
// replays what the `messages` calls recorded under recordings/sync/ (appended per call, a ticket recorded once).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { costPico, type Prices } from '../pipeline/cost.js';
import type { Policy } from '../pipeline/decide.js';
import { percentile, picoToCents } from '../pipeline/num.js';
import type { BatchResult } from '../pipeline/parse.js';
import { needsTierB, runTickets } from '../pipeline/run.js';
import type { Schema } from '../pipeline/validate.js';
import { provider, stem, type Provider } from '../providers/index.js';
import { buildRequests } from '../providers/live.js';
import type { CallInfo, SyncConfig } from '../providers/sync.js';
import { type Caps, headroomPico, ledgerState } from './caps.js';
import { recordedHashes, sha256File } from './hash.js';
import { readResults } from './results.js';
import { assertProjected, runId } from './run.js';
import { readTickets } from './tickets.js';

export const ONE_PROVIDERS = ['scripted', 'recorded', 'messages'] as const;
export type OneProvider = (typeof ONE_PROVIDERS)[number];

export interface OneOptions {
  /** a tickets_<stem>.jsonl holding exactly one ticket; the stem names the replay (scripted, recorded) or `sync` (messages) */
  inPath: string; provider: OneProvider; outDir: string; ledgerPath: string; auditSeed: number; now: () => string; root?: string;
  /** messages only: builds the provider (scripts/serve.ts passes messagesFromEnv; tests pass a fake client) */
  sync?: (c: Omit<SyncConfig, 'client'>) => Provider;
  caps?: Caps;
}

export async function triageOne(o: OneOptions) {
  const root = o.root ?? '.';
  const json = <T>(p: string): T => JSON.parse(readFileSync(join(root, p), 'utf8')) as T;
  const c = { policy: json<Policy>('routing/policy.v1.json'), prices: json<Prices>('pricing/prices.v1.json'),
    schema: json<Schema>('schemas/triage.v1.json'), auditSeed: o.auditSeed };
  const started = o.now();
  const { tickets, errors } = readTickets(o.inPath);
  if (tickets.length !== 1) throw new Error(`ONE_TICKET: ${o.inPath} must hold exactly one ticket (${tickets.length} read, ${errors.length} intake errors)`);
  const ticket = tickets[0]!;
  const models = { A: c.policy.tiers.A.model, B: c.policy.tiers.B.model };
  const sync = o.provider === 'messages';
  const base = () => ({
    run_id: runId(started, o.provider), provider: o.provider,
    input: o.inPath, input_sha256: sha256File(o.inPath), out: o.outDir, models,
    hashes: Object.fromEntries(Object.keys(recordedHashes(join(root, 'docs/decisions.md'))).map((f) => [f, sha256File(join(root, f))])),
    audit_seed: o.auditSeed,
  });
  const stamp = (ms: number) => new Date(ms).toISOString();
  // O-10: one sample per request, request → response, whole seconds as the batch rows, and the ms each call took
  const latency = () => ({
    latency_s_p50: percentile(calls.map((x) => Math.round((x.endedMs - x.startedMs) / 1000)), 50),
    latency_s_p95: percentile(calls.map((x) => Math.round((x.endedMs - x.startedMs) / 1000)), 95),
    latency_ms_per_call: calls.map((x) => ({ tier: x.tier, ms: x.endedMs - x.startedMs })),
    submitted_at: calls[0] ? stamp(calls[0].startedMs) : null, completed_at: calls.length ? stamp(calls.at(-1)!.endedMs) : null,
  });
  const append = (path: string, row: object) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(row) + '\n');
  };

  const ledger = ledgerState(o.ledgerPath);
  const calls: CallInfo[] = [];
  let spentStd = 0n, spentBatch = 0n; // real cost of the calls already answered: billed at standard, and the batch notional
  const recDir = join(root, 'recordings', stem(o.inPath).replace(/\.jsonl$/, ''));
  const p: Provider = sync ? gated() : provider(o.provider as Exclude<OneProvider, 'messages'>, root);
  function gated(): Provider {
    if (!o.sync || !o.caps) throw new Error('LIVE_ONLY_VIA_RUN: a messages call needs the caps and a provider builder; nothing was sent');
    // no acknowledge on this path on purpose: the latch is released from triage:run --acknowledge-over-cap only
    if (ledger.overCap.length) throw new Error(`CAP_LATCHED: ${ledger.overCap.join(', ')} went OVER_CAP; pass --acknowledge-over-cap to triage:run (D-19); nothing was sent`);
    const onCall = (ci: CallInfo) => {
      mkdirSync(recDir, { recursive: true });
      const file = join(recDir, `tier${ci.tier}.jsonl`);
      // the replay reader refuses a duplicate id, so a ticket triaged twice is recorded once (its first answer)
      if (!existsSync(file) || !readResults(file).results.has(ci.ticketId)) appendFileSync(file, ci.line + '\n');
      calls.push(ci);
    };
    const lc = { models, system: readFileSync(join(root, 'prompts/classify.v1.md'), 'utf8'), schema: c.schema as Record<string, unknown>, onCall };
    const raw = o.sync(lc), caps = o.caps;
    return async (tier, ts, inPath) => {
      if (!ts.length) return new Map<string, BatchResult>();
      assertProjected(tier, buildRequests(tier, ts, lc), models, c.prices, caps, ledger.livePico, spentStd, false);
      const res = await raw(tier, ts, inPath);
      for (const r of res.values()) {
        spentStd += costPico(r.model ?? models[tier], r.usage, false, c.prices);
        spentBatch += costPico(r.model ?? models[tier], r.usage, true, c.prices);
      }
      return res;
    };
  }

  let ra: Map<string, BatchResult>, rb: Map<string, BatchResult>;
  try {
    ra = await p('A', tickets, o.inPath);
    rb = await p('B', needsTierB(tickets, ra, c), o.inPath);
  } catch (e) {
    // money already went out on tier A: the ledger must carry it, or the project cap undercounts
    if (sync && spentStd > 0n) {
      const over = spentStd > headroomPico(o.caps!, ledger.livePico, 0n);
      append(o.ledgerPath, { ...base(), tickets: 0, intake_errors: errors.length, tokens: null, cost_pico_batch: String(spentBatch), cost_pico_standard: String(spentStd),
        cost_cents: picoToCents(spentStd), cap_status: over ? 'OVER_CAP' : 'INCOMPLETE', error: (e as Error).message, acknowledges: [],
        started_at: started, finished_at: o.now(), ...latency() });
    }
    throw e;
  }
  const { rows, tokens, costPicoBatch } = runTickets(tickets, ra, rb, c);
  const decision = rows[0]!;
  const billed = BigInt(decision.cost_pico_standard);

  mkdirSync(o.outDir, { recursive: true });
  const line = JSON.stringify(decision) + '\n';
  writeFileSync(join(o.outDir, 'decisions.jsonl'), line, { flag: 'wx' });
  const row = {
    ...base(), tickets: 1, intake_errors: errors.length,
    tokens: { input: tokens.input, cache_read: tokens.cacheRead, cache_write_5m: tokens.cacheCreation5m, cache_write_1h: tokens.cacheCreation1h, output: tokens.output },
    cost_pico_batch: String(costPicoBatch), cost_pico_standard: String(billed),
    // a messages call is billed at standard prices (D-57); a replay shows its notional batch cost and spends nothing (n/a)
    cost_cents: picoToCents(sync ? billed : costPicoBatch),
    cap_status: !sync ? 'n/a' : billed > headroomPico(o.caps!, ledger.livePico, 0n) ? 'OVER_CAP' : 'OK',
    ...(sync ? { acknowledges: [] } : {}),
    started_at: started, finished_at: o.now(), ...latency(),
  };
  if (sync) {
    // the recording carries the decision the call took (as D-49 for a batch) and one manifest line per call in place of meta.json
    appendFileSync(join(recDir, 'decisions.jsonl'), line);
    append(join(recDir, 'calls.jsonl'), { run_id: row.run_id, ticket_id: ticket.ticket_id, models, hashes: row.hashes, path: decision.path,
      cost_pico_standard: row.cost_pico_standard, latency_ms_per_call: row.latency_ms_per_call, started_at: started });
  }
  append(o.ledgerPath, row);
  return { decision, row };
}
