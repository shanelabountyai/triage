// triage:run (task 1.9, brief §4): intake → provider A → escalated set → provider B → pure run →
// <out>/decisions.jsonl + one append-only row in the run ledger. The clock is injected (O-10 fields).
// A live run (task 2.3) passes the D-19 caps: the latch first, then a projection before each tier's submit.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { costPico, projectPico, type Prices } from '../pipeline/cost.js';
import type { Policy } from '../pipeline/decide.js';
import { percentile, picoToCents } from '../pipeline/num.js';
import type { BatchResult } from '../pipeline/parse.js';
import { needsTierB, runTickets } from '../pipeline/run.js';
import type { Schema } from '../pipeline/validate.js';
import { provider, stem, type Provider, type ProviderName } from '../providers/index.js';
import { type BatchInfo, buildRequests, type LiveConfig, MAX_TOKENS } from '../providers/live.js';
import { type Caps, headroomPico, ledgerState } from './caps.js';
import { sha256File, recordedHashes } from './hash.js';
import { readTickets } from './tickets.js';

export interface RunOptions {
  inPath: string; provider: ProviderName; outDir: string; ledgerPath: string; auditSeed: number; now: () => string; root?: string;
  /** live only: builds the provider (scripts/run.ts passes liveFromEnv; tests pass a fake client) */
  live?: (c: Omit<LiveConfig, 'client'>) => Provider;
  caps?: Caps; acknowledgeOverCap?: boolean;
}

export async function triageRun(o: RunOptions) {
  const root = o.root ?? '.';
  const json = <T>(p: string): T => JSON.parse(readFileSync(join(root, p), 'utf8')) as T;
  const c = { policy: json<Policy>('routing/policy.v1.json'), prices: json<Prices>('pricing/prices.v1.json'),
    schema: json<Schema>('schemas/triage.v1.json'), auditSeed: o.auditSeed };
  const started = o.now();
  const { tickets, errors } = readTickets(o.inPath);
  for (const e of errors) console.error(`intake line ${e.line}: ${e.code} ${e.detail}`);
  const models = { A: c.policy.tiers.A.model, B: c.policy.tiers.B.model };
  const base = () => ({
    run_id: `${started.replace(/[-:]/g, '')}-${o.provider}`, provider: o.provider,
    input: o.inPath, input_sha256: sha256File(o.inPath), out: o.outDir, models,
    hashes: Object.fromEntries(Object.keys(recordedHashes(join(root, 'docs/decisions.md'))).map((f) => [f, sha256File(join(root, f))])),
    audit_seed: o.auditSeed,
  });
  // O-10: one sample per tier batch, submit → results ready, whole seconds (a Batch has no per-request clock)
  const latency = () => {
    const xs = batches.map((b) => Math.round((b.completedMs - b.submittedMs) / 1000));
    return { latency_s_p50: percentile(xs, 50), latency_s_p95: percentile(xs, 95) };
  };
  const stamp = (ms: number) => new Date(ms).toISOString();
  const writeMeta = () => {
    if (!batches.length) return;
    const dir = join(root, 'recordings', stem(o.inPath).replace(/\.jsonl$/, ''));
    const { run_id, input, input_sha256, models: m, hashes } = base();
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ run_id, input, input_sha256, models: m, hashes, ...latency(),
      tiers: Object.fromEntries(batches.map((b) => [b.tier, { batch_id: b.batchId, requests: b.requests, submitted_at: stamp(b.submittedMs), completed_at: stamp(b.completedMs) }])) }, null, 2) + '\n');
  };
  const append = (row: object) => {
    mkdirSync(dirname(o.ledgerPath), { recursive: true });
    appendFileSync(o.ledgerPath, JSON.stringify(row) + '\n');
  };

  const live = o.provider === 'live';
  const ledger = ledgerState(o.ledgerPath);
  const batches: BatchInfo[] = []; // live only: what the recorder writes
  let spent = 0n; // real batch cost of the tiers this run has already got back
  const p: Provider = live ? gated() : provider(o.provider, root);
  function gated(): Provider {
    if (!o.live || !o.caps) throw new Error('LIVE_ONLY_VIA_RUN: a live run needs the caps and a provider builder; nothing was sent');
    if (ledger.overCap.length && !o.acknowledgeOverCap) {
      throw new Error(`CAP_LATCHED: ${ledger.overCap.join(', ')} went OVER_CAP; pass --acknowledge-over-cap to run again (D-19); nothing was sent`);
    }
    // task 2.5: each tier is recorded the moment it is read back (wx: a recording is never overwritten), so a failure later
    // in the run cannot lose results that were already paid for
    const recDir = join(root, 'recordings', stem(o.inPath).replace(/\.jsonl$/, ''));
    // checked before any money goes out: a refused write after tier A spent would lose paid-for results
    if (existsSync(recDir)) throw new Error(`RECORDING_EXISTS: ${recDir} is already there and a recording is never overwritten; rename the input or move the recording; nothing was sent`);
    const onBatch = (b: BatchInfo) => {
      mkdirSync(recDir, { recursive: true });
      writeFileSync(join(recDir, `tier${b.tier}.jsonl`), b.lines.map((l) => l + '\n').join(''), { flag: 'wx' });
      batches.push(b); // after the write: a refused write leaves no meta.json behind
    };
    const lc = { models, system: readFileSync(join(root, 'prompts/classify.v1.md'), 'utf8'), schema: c.schema as Record<string, unknown>, onBatch };
    const raw = o.live(lc), caps = o.caps;
    return async (tier, ts, inPath) => {
      if (!ts.length) return new Map<string, BatchResult>();
      const reqs = buildRequests(tier, ts, lc);
      const r0 = reqs[0]!.params; // the prefix is identical across the batch (non-negotiable 8; the provider asserts it)
      const proj = projectPico(models[tier], r0.system[0]!.text + JSON.stringify(r0.output_config),
        reqs.map((r) => r.params.messages[0]!.content), MAX_TOKENS, c.prices);
      const room = headroomPico(caps, ledger.livePico, spent);
      if (proj > room) {
        throw new Error(`CAP_PROJECTION: tier ${tier}, ${ts.length} requests project ${picoToCents(proj)}¢ (ceiling: cache miss, ${MAX_TOKENS} output tokens each) `
          + `over ${picoToCents(room > 0n ? room : 0n)}¢ left (run cap ${caps.runCents}¢, project cap ${caps.projectCents}¢, ledger live spend ${picoToCents(ledger.livePico)}¢); tier ${tier} was not sent`);
      }
      const res = await raw(tier, ts, inPath);
      for (const r of res.values()) spent += costPico(r.model ?? models[tier], r.usage, true, c.prices);
      return res;
    };
  }

  let ra: Map<string, BatchResult>, rb: Map<string, BatchResult>;
  try {
    ra = await p('A', tickets, o.inPath);
    rb = await p('B', needsTierB(tickets, ra, c), o.inPath);
  } catch (e) {
    writeMeta();
    // money already went out on tier A: the ledger must carry it, or the project cap undercounts
    // ponytail: a batch created but never read back (poll or stream failure) is not counted; reconcile from the console
    if (live && spent > 0n) {
      const over = spent > headroomPico(o.caps!, ledger.livePico, 0n);
      append({ ...base(), tickets: 0, intake_errors: errors.length, tokens: null, cost_pico_batch: String(spent), cost_cents: picoToCents(spent),
        cap_status: over ? 'OVER_CAP' : 'INCOMPLETE', error: (e as Error).message, acknowledges: o.acknowledgeOverCap ? ledger.overCap : [],
        started_at: started, finished_at: o.now(), submitted_at: null, completed_at: null, ...latency() });
    }
    throw e;
  }
  writeMeta();
  const { rows, tokens, costPicoBatch } = runTickets(tickets, ra, rb, c);

  mkdirSync(o.outDir, { recursive: true });
  writeFileSync(join(o.outDir, 'decisions.jsonl'), rows.map((r) => JSON.stringify(r) + '\n').join(''), { flag: 'wx' });
  const finished = o.now();
  const row = {
    ...base(), tickets: rows.length, intake_errors: errors.length,
    tokens: { input: tokens.input, cache_read: tokens.cacheRead, cache_write_5m: tokens.cacheCreation5m, cache_write_1h: tokens.cacheCreation1h, output: tokens.output },
    cost_pico_batch: String(costPicoBatch), cost_cents: picoToCents(costPicoBatch),
    // replays spend nothing (n/a); a live run is judged on its real cost against both caps (D-19)
    cap_status: !live ? 'n/a' : costPicoBatch > headroomPico(o.caps!, ledger.livePico, 0n) ? 'OVER_CAP' : 'OK',
    ...(live ? { acknowledges: o.acknowledgeOverCap ? ledger.overCap : [] } : {}),
    started_at: started, finished_at: finished,
    submitted_at: batches[0] ? stamp(Math.min(...batches.map((b) => b.submittedMs))) : null,
    completed_at: batches[0] ? stamp(Math.max(...batches.map((b) => b.completedMs))) : null, ...latency(), // O-10: null for replays
  };
  append(row);
  return { rows, row };
}
