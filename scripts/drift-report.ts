// drift:report -- --baseline <run_id>[,…] --window <run_id>[,…] | --last N  [--ledger <jsonl>] [--overrides <jsonl>] — tasks 1.10, 3.3.
// Run ids are the ledger's (triage:run prints them); several per side are pooled. --last N takes the newest N ledger runs
// with decisions as the window and the N before as the baseline (D-52). Exits 0 whether or not a signal fired; 1 on a bad input.
import { parseArgs } from 'node:util';
import { driftReport, lastRuns } from '../src/io/drift.js';

const { values: v } = parseArgs({ options: {
  baseline: { type: 'string' }, window: { type: 'string' }, last: { type: 'string' },
  ledger: { type: 'string', default: 'data/runs.jsonl' }, overrides: { type: 'string', default: 'data/overrides.jsonl' },
} });
const ids = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
if (v.last ? v.baseline || v.window : !(v.baseline && v.window)) {
  console.error('usage: drift:report -- (--baseline <run_id>[,…] --window <run_id>[,…] | --last N) [--ledger <jsonl>] [--overrides <jsonl>]');
  process.exit(2);
}
try {
  const sides = v.last ? lastRuns(v.ledger, Number(v.last)) : { baseline: ids(v.baseline!), window: ids(v.window!) };
  const r = driftReport({ ...sides, ledgerPath: v.ledger, overridesPath: v.overrides });
  for (const e of r.overrideErrors) console.error(`overrides line ${e.line}: ${e.code} ${e.detail}`);
  console.log(r.lines.join('\n'));
} catch (e) {
  console.error(`drift:report refused: ${(e as Error).message}`);
  process.exit(1);
}
