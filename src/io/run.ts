// triage:run (task 1.9, brief §4): intake → provider A → escalated set → provider B → pure run →
// <out>/decisions.jsonl + one append-only row in the run ledger. The clock is injected (O-10 fields).
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Prices } from '../pipeline/cost.js';
import type { Policy } from '../pipeline/decide.js';
import { picoToCents } from '../pipeline/num.js';
import { needsTierB, runTickets } from '../pipeline/run.js';
import type { Schema } from '../pipeline/validate.js';
import { provider, type ProviderName } from '../providers/index.js';
import { sha256File, recordedHashes } from './hash.js';
import { readTickets } from './tickets.js';

export interface RunOptions {
  inPath: string; provider: ProviderName; outDir: string; ledgerPath: string; auditSeed: number; now: () => string; root?: string;
}

export async function triageRun(o: RunOptions) {
  const root = o.root ?? '.';
  const json = <T>(p: string): T => JSON.parse(readFileSync(join(root, p), 'utf8')) as T;
  const c = { policy: json<Policy>('routing/policy.v1.json'), prices: json<Prices>('pricing/prices.v1.json'),
    schema: json<Schema>('schemas/triage.v1.json'), auditSeed: o.auditSeed };
  const started = o.now();
  const { tickets, errors } = readTickets(o.inPath);
  for (const e of errors) console.error(`intake line ${e.line}: ${e.code} ${e.detail}`);
  const p = provider(o.provider);
  const ra = await p('A', tickets, o.inPath);
  const rb = await p('B', needsTierB(tickets, ra, c), o.inPath);
  const { rows, tokens, costPicoBatch } = runTickets(tickets, ra, rb, c);

  mkdirSync(o.outDir, { recursive: true });
  writeFileSync(join(o.outDir, 'decisions.jsonl'), rows.map((r) => JSON.stringify(r) + '\n').join(''), { flag: 'wx' });
  const finished = o.now();
  const row = {
    run_id: `${started.replace(/[-:]/g, '')}-${o.provider}`, provider: o.provider,
    input: o.inPath, input_sha256: sha256File(o.inPath), out: o.outDir,
    models: { A: c.policy.tiers.A.model, B: c.policy.tiers.B.model },
    hashes: Object.fromEntries(Object.keys(recordedHashes(join(root, 'docs/decisions.md'))).map((f) => [f, sha256File(join(root, f))])),
    audit_seed: o.auditSeed, tickets: rows.length, intake_errors: errors.length,
    tokens: { input: tokens.input, cache_read: tokens.cacheRead, cache_write_5m: tokens.cacheCreation5m, cache_write_1h: tokens.cacheCreation1h, output: tokens.output },
    cost_pico_batch: String(costPicoBatch), cost_cents: picoToCents(costPicoBatch),
    cap_status: 'n/a', // replays spend nothing; the D-19 caps arrive with the live provider in Phase 2
    started_at: started, finished_at: finished,
    submitted_at: null, completed_at: null, latency_s_p50: null, latency_s_p95: null, // O-10: measured from Phase 2
  };
  mkdirSync(dirname(o.ledgerPath), { recursive: true });
  appendFileSync(o.ledgerPath, JSON.stringify(row) + '\n');
  return { rows, row };
}
