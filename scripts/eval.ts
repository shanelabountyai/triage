// triage:eval -- [--provider scripted|recorded] — tasks 1.11 and 2.8. Prints the brief §11 report (the format of
// fixtures/samples/reference_pipeline.output.txt) on stdout; exits 1 if any per-ticket decision differs from what the
// provider is held to: fixtures/decisions_batch{1,2}.csv for scripted (D-38), recordings/batch{1,2}/decisions.jsonl for
// recorded (D-49). Neither path needs a key.
import { parseArgs } from 'node:util';
import { evalReport } from '../src/eval/report.js';

const { values: v } = parseArgs({ options: { provider: { type: 'string', default: 'scripted' } } });
if (v.provider !== 'scripted' && v.provider !== 'recorded') {
  console.error('usage: triage:eval -- [--provider scripted|recorded]');
  process.exit(2);
}
const r = await evalReport(v.provider);
console.log(r.lines.join('\n'));
if (r.diffs.length) {
  console.error(`per-ticket decisions: ${r.diffs.length} difference(s) from ${r.heldTo}`);
  for (const d of r.diffs.slice(0, 20)) console.error(d);
  process.exit(1);
} else console.error(`per-ticket decisions: ${r.tickets} of ${r.tickets} equal to ${r.heldTo}`);
