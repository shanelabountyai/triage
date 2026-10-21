// triage:eval -- [--provider scripted|recorded] — task 1.11. Prints the brief §11 report (the format of
// fixtures/samples/reference_pipeline.output.txt) on stdout; exits 1 if any per-ticket decision differs
// from fixtures/decisions_batch{1,2}.csv (checked for the scripted provider, whose frozen output they are).
import { parseArgs } from 'node:util';
import { evalReport } from '../src/eval/report.js';

const { values: v } = parseArgs({ options: { provider: { type: 'string', default: 'scripted' } } });
if (v.provider !== 'scripted' && v.provider !== 'recorded') {
  console.error('usage: triage:eval -- [--provider scripted|recorded]');
  process.exit(2);
}
const r = await evalReport(v.provider);
console.log(r.lines.join('\n'));
if (v.provider !== 'scripted') console.error('per-ticket decisions: not checked (fixtures/decisions_batch*.csv are the scripted reference)');
else if (r.diffs.length) {
  console.error(`per-ticket decisions: ${r.diffs.length} difference(s) from fixtures/decisions_batch{1,2}.csv`);
  for (const d of r.diffs.slice(0, 20)) console.error(d);
  process.exit(1);
} else console.error(`per-ticket decisions: ${r.tickets} of ${r.tickets} equal to fixtures/decisions_batch{1,2}.csv`);
