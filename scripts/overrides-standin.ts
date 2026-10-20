// overrides:standin -- --run <run dir> --key <answer key csv> [--overrides <path>]
// Fixtures only (O-6): append the answer key's labels as the reviewer's for every human-touched
// ticket of a run, so drift:report has an override rate to measure. Never point it at real data.
import { parseArgs } from 'node:util';
import { readCsv } from '../src/io/csv.js';
import { appendOverrides, DEFAULT_OVERRIDES } from '../src/io/overrides.js';
import { readRunDir } from '../src/io/run.js';
import { standInOverrides } from '../src/eval/standin.js';

const { values } = parseArgs({ options: { run: { type: 'string' }, key: { type: 'string' }, overrides: { type: 'string' } } });
if (!values.run || !values.key) {
  console.error('usage: npm run overrides:standin -- --run <run dir> --key <answer key csv> [--overrides <path>]');
  process.exit(2);
}
const { row, decisions } = readRunDir(values.run);
const key = new Map(readCsv(values.key).map((r) => [r['ticket_id']!, r]));
const rows = standInOverrides(row.run_id, decisions, key, new Date().toISOString());
appendOverrides(rows, values.overrides ?? DEFAULT_OVERRIDES);
console.log(`overrides:standin ${row.run_id}: ${rows.length} human-touched tickets recorded with the answer key's labels (O-6 stand-in)`);
