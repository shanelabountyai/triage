// triage:run -- --in <jsonl> --provider <scripted|recorded|live> --out <dir> [--audit-seed N] — task 1.9.
// The `live` provider does not exist before Phase 2 (D-2): it throws and spends nothing.
import { parseArgs } from 'node:util';
import { triageRun } from '../src/io/run.js';
import { PROVIDERS, type ProviderName } from '../src/providers/index.js';

const { values: v } = parseArgs({ options: {
  in: { type: 'string' }, provider: { type: 'string' }, out: { type: 'string' },
  'audit-seed': { type: 'string', default: '20261019' }, ledger: { type: 'string', default: 'data/runs.jsonl' },
} });
if (!v.in || !v.out || !PROVIDERS.includes(v.provider as ProviderName) || !/^\d+$/.test(v['audit-seed'])) {
  console.error(`usage: triage:run -- --in <jsonl> --provider <${PROVIDERS.join('|')}> --out <dir> [--audit-seed N] [--ledger <jsonl>]`);
  process.exit(2);
}
try {
  const { row } = await triageRun({ inPath: v.in, provider: v.provider as ProviderName, outDir: v.out, ledgerPath: v.ledger,
    auditSeed: Number(v['audit-seed']), now: () => new Date().toISOString() });
  console.log(`run ${row.run_id}: ${row.tickets} tickets, ${row.intake_errors} intake errors, cost ${row.cost_cents}¢ at batch prices (${row.provider}, results not a measurement), 0 tokens spent`);
  console.log(`  ${v.out}/decisions.jsonl · ledger ${v.ledger}`);
} catch (e) {
  console.error(`triage:run refused: ${(e as Error).message}`);
  process.exit(1);
}
