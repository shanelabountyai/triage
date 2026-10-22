// triage:run -- --in <jsonl> --provider <scripted|recorded|live> --out <dir> [--audit-seed N] [--acknowledge-over-cap] — tasks 1.9, 2.3.
// `live` spends money: it needs TRIAGE_LIVE=1 and a key (from .env.local, loaded here only; D-40) and passes the D-19 caps.
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { capsFromEnv } from '../src/io/caps.js';
import { triageRun } from '../src/io/run.js';
import { PROVIDERS, type ProviderName } from '../src/providers/index.js';
import { liveFromEnv } from '../src/providers/live.js';

const { values: v } = parseArgs({ options: {
  in: { type: 'string' }, provider: { type: 'string' }, out: { type: 'string' },
  'audit-seed': { type: 'string', default: '20261019' }, ledger: { type: 'string', default: 'data/runs.jsonl' },
  'acknowledge-over-cap': { type: 'boolean', default: false },
} });
if (!v.in || !v.out || !PROVIDERS.includes(v.provider as ProviderName) || !/^\d+$/.test(v['audit-seed'])) {
  console.error(`usage: triage:run -- --in <jsonl> --provider <${PROVIDERS.join('|')}> --out <dir> [--audit-seed N] [--ledger <jsonl>] [--acknowledge-over-cap]`);
  process.exit(2);
}
const live = v.provider === 'live';
try {
  if (live && existsSync('.env.local')) process.loadEnvFile('.env.local');
  const { row } = await triageRun({ inPath: v.in, provider: v.provider as ProviderName, outDir: v.out, ledgerPath: v.ledger,
    auditSeed: Number(v['audit-seed']), now: () => new Date().toISOString(),
    ...(live ? { live: (c) => liveFromEnv(process.env, c), caps: capsFromEnv(process.env), acknowledgeOverCap: v['acknowledge-over-cap'] } : {}) });
  console.log(live
    ? `run ${row.run_id}: ${row.tickets} tickets, ${row.intake_errors} intake errors, real cost ${row.cost_cents}¢ at batch prices from usage fields, cap ${row.cap_status}`
    : `run ${row.run_id}: ${row.tickets} tickets, ${row.intake_errors} intake errors, cost ${row.cost_cents}¢ at batch prices (${row.provider}, results not a measurement), 0 tokens spent`);
  console.log(`  ${v.out}/decisions.jsonl · ledger ${v.ledger}`);
} catch (e) {
  console.error(`triage:run refused: ${(e as Error).message}`);
  process.exit(1);
}
