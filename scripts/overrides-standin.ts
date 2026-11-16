// overrides:standin -- --run <run_id> --key <answer_key.csv> [--ledger <jsonl>] [--overrides <jsonl>] — task 1.10.
// The O-6 stand-in for a person, fixtures only: for every human-touched ticket in the run, append the answer
// key's category and priority as that person's labels. Not product code; nothing under src/ reads a key (D-36).
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { runDecisions } from '../src/io/drift.js';
import { appendOverrides } from '../src/io/overrides.js';

const { values: v } = parseArgs({ options: {
  run: { type: 'string' }, key: { type: 'string' },
  ledger: { type: 'string', default: 'data/runs.jsonl' }, overrides: { type: 'string', default: 'data/overrides.jsonl' },
} });
if (!v.run || !v.key) {
  console.error('usage: overrides:standin -- --run <run_id> --key <answer_key.csv> [--ledger <jsonl>] [--overrides <jsonl>]');
  process.exit(2);
}
const [head, ...lines] = readFileSync(v.key, 'utf8').trim().split('\n').map((l) => l.split(','));
const col = (n: string) => head!.indexOf(n);
const key = new Map(lines.map((f) => [f[col('ticket_id')]!, { category: f[col('category')]!, priority: f[col('priority')]! }]));
const rows = runDecisions(v.ledger, v.run).filter((r) => r.human_touched).map((r) => {
  const k = key.get(r.ticket_id);
  if (!k) throw new Error(`no key row for ${r.ticket_id}`);
  return { run_id: v.run!, ticket_id: r.ticket_id, ...k, by: 'answer-key (O-6 stand-in)', at: new Date().toISOString() };
});
appendOverrides(v.overrides, rows);
console.log(`overrides:standin: ${rows.length} rows for ${v.run} → ${v.overrides} (answer key as the person, O-6; fixtures only)`);
