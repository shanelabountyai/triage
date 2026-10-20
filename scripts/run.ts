// triage:run -- --in <jsonl> --provider <scripted|recorded|live> --out <dir> [--recording <dir>] [--ledger <path>] [--audit-seed <n>]
// One run: decisions.jsonl + run.json in --out and a row appended to the ledger (default data/runs.jsonl).
// The `live` provider refuses before Phase 2 (D-2); scripted and recorded replay files and spend nothing.
import { parseArgs } from 'node:util';
import { runOnce } from '../src/io/run.js';
import { getProvider, ProviderError } from '../src/providers/index.js';

const { values } = parseArgs({
  options: {
    in: { type: 'string' }, provider: { type: 'string' }, out: { type: 'string' },
    recording: { type: 'string' }, ledger: { type: 'string' }, 'audit-seed': { type: 'string' },
  },
});
if (!values.in || !values.provider || !values.out) {
  console.error('usage: npm run triage:run -- --in <jsonl> --provider <scripted|recorded|live> --out <dir> [--recording <dir>] [--ledger <path>] [--audit-seed <n>]');
  process.exit(2);
}
try {
  const provider = getProvider(values.provider, { input: values.in, ...(values.recording ? { recording: values.recording } : {}), env: process.env });
  const seed = values['audit-seed'];
  if (seed !== undefined && !/^\d+$/.test(seed)) throw new Error('--audit-seed must be a non-negative integer');
  const { row, intakeErrors } = await runOnce({
    input: values.in, provider, out: values.out, now: () => new Date().toISOString(),
    ...(values.ledger ? { ledger: values.ledger } : {}), ...(seed !== undefined ? { auditSeed: Number(seed) } : {}),
  });
  console.log(`triage:run ${row.run_id}  provider=${row.provider}  tickets ${row.tickets}  intake errors ${intakeErrors.length}`);
  console.log(`paths: ${Object.entries(row.paths).map(([k, v]) => `${k} ${v}`).join('  ')}  escalated ${row.escalated}  human queue ${row.human_queue}`);
  console.log(`cost (from usage fields): batch ${row.cost_cents_batch} cents, ${row.cents_per_1000_batch} per 1,000; standard ${row.cost_cents_standard} cents  cap ${row.cap_status}`);
  if (row.provider === 'scripted') console.log('NOTE: scripted results (designed error model); token counts are estimates. Spend: $0.');
  console.log(`wrote ${values.out}/decisions.jsonl and run.json; ledger row appended`);
} catch (e) {
  console.error(e instanceof ProviderError ? e.message : `triage:run failed: ${(e as Error).message}`);
  process.exit(1);
}
