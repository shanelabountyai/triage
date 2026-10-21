// drift:report -- --baseline <run_id> --window <run_id> [--ledger <jsonl>] [--overrides <jsonl>] — task 1.10.
// Run ids are the ledger's (triage:run prints them). Exits 0 whether or not a signal fired; 1 on a bad input.
import { parseArgs } from 'node:util';
import { driftReport } from '../src/io/drift.js';

const { values: v } = parseArgs({ options: {
  baseline: { type: 'string' }, window: { type: 'string' },
  ledger: { type: 'string', default: 'data/runs.jsonl' }, overrides: { type: 'string', default: 'data/overrides.jsonl' },
} });
if (!v.baseline || !v.window) {
  console.error('usage: drift:report -- --baseline <run_id> --window <run_id> [--ledger <jsonl>] [--overrides <jsonl>]');
  process.exit(2);
}
try {
  const r = driftReport({ baseline: v.baseline, window: v.window, ledgerPath: v.ledger, overridesPath: v.overrides });
  for (const e of r.overrideErrors) console.error(`overrides line ${e.line}: ${e.code} ${e.detail}`);
  console.log(r.lines.join('\n'));
} catch (e) {
  console.error(`drift:report refused: ${(e as Error).message}`);
  process.exit(1);
}
