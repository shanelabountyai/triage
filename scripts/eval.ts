// triage:eval -- [--provider scripted|recorded] [--fixtures <dir>] [--seed <n>]
// Runs the pipeline over both fixture batches and prints the brief §11 report line for line as
// tools/reference_pipeline.py prints it. Exits 1 if any per-ticket decision differs from
// fixtures/decisions_batch{1,2}.csv (scripted results only: the reference decisions are scripted).
import { parseArgs } from 'node:util';
import { decisionDiffs, evalReport, type ResultsSource } from '../src/eval/report.js';
import { loadPolicyData } from '../src/io/load.js';

const { values } = parseArgs({ options: { provider: { type: 'string', default: 'scripted' }, fixtures: { type: 'string', default: 'fixtures' }, seed: { type: 'string', default: '20261019' } } });
const results = values.provider as ResultsSource;
if (results !== 'scripted' && results !== 'recorded') {
  console.error(`triage:eval: --provider must be scripted or recorded (the eval never calls a model), got ${values.provider}`);
  process.exit(2);
}
if (!/^\d+$/.test(values.seed)) {
  console.error('triage:eval: --seed must be a non-negative integer');
  process.exit(2);
}
try {
  const { data, hashes } = loadPolicyData();
  const { lines, runs } = evalReport({ data, hashes, fixtures: values.fixtures, results, seed: Number(values.seed) });
  for (const line of lines) console.log(line);
  if (results === 'scripted') {
    const diffs = decisionDiffs(values.fixtures, runs);
    if (diffs.length) {
      console.error(`\ntriage:eval FAILED: ${diffs.length} per-ticket difference(s) from fixtures/decisions_batch{1,2}.csv`);
      for (const d of diffs.slice(0, 50)) console.error(`  ${d}`);
      process.exit(1);
    }
  }
} catch (e) {
  console.error(`triage:eval failed: ${(e as Error).message}`);
  process.exit(1);
}
