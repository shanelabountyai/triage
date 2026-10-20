// drift:report -- --baseline <run dir> --window <run dir> [--overrides <path>]
// The eight signals of monitoring/drift.v1.json for a window run against a baseline run.
import { parseArgs } from 'node:util';
import { driftReport, signalTable } from '../src/io/driftreport.js';

const { values } = parseArgs({ options: { baseline: { type: 'string' }, window: { type: 'string' }, overrides: { type: 'string' } } });
if (!values.baseline || !values.window) {
  console.error('usage: npm run drift:report -- --baseline <run dir> --window <run dir> [--overrides <path>]');
  process.exit(2);
}
try {
  const r = driftReport(values.baseline, values.window, values.overrides);
  const { baseline: b, window: w } = r.stats;
  console.log(`drift: window ${r.window} (n ${w.n}) vs baseline ${r.baseline} (n ${b.n}) (monitoring/drift.v1.json)`);
  console.log(`  human-touched ${w.human_touched}, overridden ${w.overridden} (window); ${b.human_touched}, ${b.overridden} (baseline)`);
  for (const l of signalTable(r.signals)) console.log(l);
  console.log(`${r.signals.filter((s) => s.fired).length} of ${r.signals.length} fired`);
} catch (e) {
  console.error(`drift:report failed: ${(e as Error).message}`);
  process.exit(1);
}
